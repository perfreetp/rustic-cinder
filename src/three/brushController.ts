/**
 * 笔刷交互控制器。
 *
 * 负责把视口指针事件翻译成「一笔」:
 *   · 落笔时先做一次预览 (立即出现体积)
 *   · 拖动时按距离补点, 形成胶囊体积; 同时限制重建频率 (约 30~40 fps)
 *   · 平滑笔刷: 按住不动时强度按时间递增, 并周期性重新提交
 *   · 镜像: 落笔 / 拖动时同步更新镜像副本
 *
 * 重建请求走 GeometryClient, 只保留最新一件, 因此快速拖动时视口不卡。
 */

import * as THREE from 'three';
import { GeometryClient } from '../worker/client';
import { getStudio, nextStrokeId, useStudio } from '../state/store';
import {
  BRUSH_RADIUS,
  smoothReach,
  strokeBounds,
  blendWidth,
  type Bounds,
} from '../core/field';
import type { BrushKind, BrushShape, Stroke, SymAxis, Vec3 } from '../core/types';
import type { StrokePointer, Viewport } from './viewport';

type Point = { p: THREE.Vector3; n: THREE.Vector3 };

/** 平滑笔刷按住时的强度递增曲线 */
function dwellStrength(t: number) {
  // 0.35s 起步, ~2.6s 达到满强度
  return Math.min(1, 0.32 + 0.68 * (1 - Math.exp(-t / 1.15)));
}

export class BrushController {
  private client: GeometryClient;
  private viewport: Viewport;
  private active: Stroke | null = null;
  private activeBasePoints: Point[] = [];
  private lastCommit = 0;
  private commitTimer: number | null = null;
  private raf = 0;
  private pdown = 0;
  private rebuildQueued = false;
  private lastRebuildAt = 0;
  private disposed = false;
  private pendingBuild = false;
  private buildStartedAt = 0;
  private dwellTimer: number | null = null;
  private strokeSeqInSession = 0;
  private lastMeshRevision = -1;
  private selectionDrag: { strokeId: string; grabPoint: THREE.Vector3; original: Stroke } | null = null;

  constructor(client: GeometryClient, viewport: Viewport) {
    this.client = client;
    this.viewport = viewport;
    this.lastSeenRevision = getStudio().revision;
    this.revisionAtBoot = this.lastSeenRevision;
    this.tick();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.commitTimer) window.clearTimeout(this.commitTimer);
    if (this.dwellTimer) window.clearInterval(this.dwellTimer);
  }

  /** 初始 / 历史回退后的全量重建 */
  async rebuild(force = false) {
    if (this.disposed) return;
    const s = getStudio();
    this.pendingBuild = true;
    this.buildStartedAt = performance.now();
    useStudio.getState().setBusy(true);
    try {
      const res = await this.client.build(s.baseShape, s.strokes, s.precision);
      if (this.disposed) return;
      if (res.render) {
        this.viewport.setGeometry(res.render.positions, res.render.normals, res.render.indices);
        this.lastMeshRevision = getStudio().meshRevision;
      }
      if (res.stats) {
        useStudio.getState().setStats(res.stats);
      }
      if (force) this.viewport.frameModel(1.45);
      useStudio.getState().setError(null);
    } catch (err: any) {
      if (String(err?.message) === 'superseded') return;
      useStudio.getState().setError(String(err?.message ?? err));
      useStudio.getState().setBusy(false);
    } finally {
      this.pendingBuild = false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* 视口回调                                                          */
  /* ---------------------------------------------------------------- */

  handleStart(info: StrokePointer): boolean {
    const state = getStudio();
    if (info.button !== 0) return false;
    if (!info.point) return false;
    // 笔刷必须落在造型表面上: 在空白处起笔会把体积堆到空中
    if (state.tool !== 'orbit' && !info.hit) return false;

    if (state.tool === 'move') {
      // 移动工具: 选中最近的笔, 并开始拖动
      const hit = this.pickStroke(info.point);
      if (!hit) {
        useStudio.getState().selectStroke(null);
        return false;
      }
      useStudio.getState().selectStroke(hit.id);
      this.selectionDrag = {
        strokeId: hit.id,
        grabPoint: info.point.clone(),
        original: structuredCloneish(hit),
      };
      return true;
    }

    if (state.tool === 'smooth') {
      useStudio.getState().selectStroke(null);
      this.beginStroke('smooth', info, []);
      return true;
    }

    if (state.tool === 'orbit') return false;

    const kind: BrushKind = state.tool === 'erase' ? 'erase' : 'add';
    useStudio.getState().selectStroke(null);
    this.beginStroke(kind, info, []);
    return true;
  }

  handleMove(info: StrokePointer) {
    const state = getStudio();

    if (this.selectionDrag) {
      if (!info.point) return;
      this.dragSelection(info);
      return;
    }

    // 光标预览
    const radius = this.currentBrushWorldRadius(info);
    const color = state.tool === 'erase' ? '#ff8a7a' : state.tool === 'smooth' ? '#8fd1ff' : '#ffffff';
    // 只有悬停在表面上才显示笔刷环 (提示"这里可以落笔")
    const showCursor = !!info.point && (info.hit || this.active !== null);
    this.viewport.setCursor(radius, color, state.tool === 'move' ? 0.35 : 0.95, showCursor);
    if (info.point && info.hit && state.mirrorAxis && state.tool !== 'move' && state.tool !== 'orbit') {
      this.viewport.setMirrorGhost(info.point.x, info.point.y, info.point.z, state.mirrorAxis, true);
    } else {
      this.viewport.setMirrorGhost(0, 0, 0, null, false);
    }

    if (!this.active || !info.point) return;
    // 划出造型之外时保持停留在表面上的最后一个点 (不要在空中补体积)
    if (!info.hit) return;

    if (this.active.kind === 'smooth') {
      // 平滑笔刷不跟随拖动 (一支笔固定在一处), 强度由按住时长决定
      return;
    }

    const pts = this.activeBasePoints;
    const last = pts[pts.length - 1];
    // 采样间距: 更密才能让拖出来的笔触像"一笔", 而不是被拉长的胶囊
    const spacing = Math.max(0.012, this.active.radius * 0.16);
    if (!last || last.p.distanceTo(info.point) >= spacing) {
      pts.push({ p: info.point.clone(), n: (info.normal ?? new THREE.Vector3(0, 1, 0)).clone() });
      // 拖动过程中实时更新这一笔的点位
      this.syncActiveStroke();
      this.scheduleRebuild(false);
    }
  }

  handleEnd(info: StrokePointer) {
    if (this.selectionDrag) {
      const drag = this.selectionDrag;
      this.selectionDrag = null;
      const s = getStudio();
      const cur = s.strokes.find((x) => x.id === drag.strokeId);
      if (cur) {
        // 用当前状态作为新历史条目
        this.finalizeStroke(cur);
      }
      return;
    }
    if (!this.active) return;
    if (this.active.kind === 'add' || this.active.kind === 'erase') {
      if (info.point) this.handleMove(info);
    }
    const stroke = this.active;
    this.active = null;
    this.activeBasePoints = [];
    if (this.dwellTimer) {
      window.clearInterval(this.dwellTimer);
      this.dwellTimer = null;
    }
    this.viewport.setCursor(0.2, '#ffffff', 0.0, false);
    this.viewport.setMirrorGhost(0, 0, 0, null, false);
    useStudio.getState().setHoldStrength(null);
    this.finalizeStroke(stroke);
    // 最终一次精确重建
    this.flushRebuild();
  }

  /* ---------------------------------------------------------------- */
  /* 内部                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 笔刷在世界空间的半径。数值就是三档设定值 —— 这样落笔位置与视口里
   * 预览环的大小始终一致, 不会因为相机远近而改变造型的尺度。
   */
  private currentBrushWorldRadius(_info: StrokePointer | null) {
    const s = getStudio();
    return BRUSH_RADIUS[s.brush.radiusLevel];
  }

  private beginStroke(kind: BrushKind, info: StrokePointer, extra: Point[]) {
    const s = getStudio();
    const radius = this.currentBrushWorldRadius(info);
    const p = info.point!.clone();
    const n = (info.normal ?? new THREE.Vector3(0, 1, 0)).clone();
    this.activeBasePoints = [{ p, n }, ...extra];
    this.pdown = performance.now();
    this.strokeSeqInSession += 1;
    const stroke: Stroke = {
      id: nextStrokeId(),
      kind,
      shape: s.brush.shape,
      points: [[p.x, p.y, p.z]],
      normals: [[n.x, n.y, n.z]],
      radius: kind === 'smooth' ? smoothReach(radius, s.brush.hardnessLevel) : radius,
      hardness: [0.12, 0.5, 0.92][s.brush.hardnessLevel],
      blend: [0, 0.5, 1][s.brush.blendLevel],
      strength: kind === 'smooth' ? 0.34 : 1,
      mirrorAxis: s.mirrorAxis,
      createdAt: Date.now(),
      dwellTicks: 0,
    };
    this.active = stroke;
    useStudio.getState().liveUpdateStroke(stroke);
    this.selfRevision = getStudio().revision;
    if (kind === 'smooth') {
      useStudio.getState().setHoldStrength(0.34);
      // 按住时强度递增, 并在停止后按周期提交
      let lastTick = 0;
      this.dwellTimer = window.setInterval(() => {
        if (!this.active) return;
        const t = (performance.now() - this.pdown) / 1000;
        const strength = dwellStrength(t);
        const cur = this.active;
        if (strength - (cur.strength ?? 0) < 0.02) return;
        this.active = { ...cur, strength, dwellTicks: (cur.dwellTicks ?? 0) + 1 };
        useStudio.getState().setHoldStrength(strength);
        useStudio.getState().liveUpdateStroke(this.active);
        this.selfRevision = getStudio().revision;
        const now = performance.now();
        if (now - lastTick > 320) {
          lastTick = now;
          void this.rebuild(false);
        }
      }, 120);
    }
    this.scheduleRebuild(true);
  }

  private syncActiveStroke() {
    if (!this.active) return;
    const pts = this.activeBasePoints;
    if (this.active.kind === 'smooth') return;
    const points = pts.map((q) => [q.p.x, q.p.y, q.p.z] as Vec3);
    const normals = pts.map((q) => [q.n.x, q.n.y, q.n.z] as Vec3);
    this.active = { ...this.active, points, normals };
    useStudio.getState().liveUpdateStroke(this.active);
    this.selfRevision = getStudio().revision;
  }

  /** 拖动已有笔 (移动工具) */
  private dragSelection(info: StrokePointer) {
    if (!this.selectionDrag || !info.point) return;
    const delta = info.point.clone().sub(this.selectionDrag.grabPoint);
    const orig = this.selectionDrag.original;
    const moved: Stroke = {
      ...orig,
      points: orig.points.map((p) => [p[0] + delta.x, p[1] + delta.y, p[2] + delta.z] as Vec3),
    };
    useStudio.getState().liveUpdateStroke(moved);
    this.selfRevision = getStudio().revision;
    this.scheduleRebuild(false);
  }

  private finalizeStroke(stroke: Stroke) {
    useStudio.getState().commitStroke(stroke);
    this.selfRevision = getStudio().revision;
  }

  private scheduleRebuild(immediate: boolean) {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    const delay = immediate ? 0 : 40;
    this.commitTimer = window.setTimeout(() => {
      this.rebuildQueued = false;
      this.commitTimer = null;
      void this.rebuild(false);
    }, delay);
  }

  /** 立即提交 (落笔结束时) */
  private flushRebuild() {
    if (this.commitTimer) {
      window.clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    this.rebuildQueued = false;
    void this.rebuild(false);
  }

  /** 每帧: 材质刷新 + 外部变化 (历史回退 / 精度切换) 触发的重建 */
  private tick = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const s = getStudio();
    if (s.meshRevision !== this.lastMeshRevision) {
      this.lastMeshRevision = s.meshRevision;
      this.viewport.setMaterial(s.material);
    }
    // 外部改动: 由不是本控制器发起的 revision 变化触发
    if (this.revisionAtBoot !== null && s.revision !== this.lastSeenRevision) {
      this.lastSeenRevision = s.revision;
      if (s.revision !== this.selfRevision) {
        this.scheduleRebuild(true);
      }
    }
    // 选中笔的高亮框: 只在移动工具下显示
    const bounds = s.tool === 'move' ? this.selectedBounds() : null;
    this.viewport.showSelection(bounds ? bounds.min : null, bounds ? bounds.max : null);
  };

  private lastSeenRevision = 0;
  private selfRevision = -1;
  private revisionAtBoot: number | null = null;

  /** 选中最近的一笔 (移动工具) */
  private pickStroke(point: THREE.Vector3): Stroke | null {
    const s = getStudio();
    let best: Stroke | null = null;
    let bestD = Infinity;
    for (const stroke of s.strokes) {
      const p = new THREE.Vector3(...stroke.points[0]);
      const d = p.distanceTo(point);
      if (d < stroke.radius * 1.25 && d < bestD) {
        bestD = d;
        best = stroke;
      }
    }
    return best;
  }

  /** 当前选中笔的包围盒 (视口高亮用) */
  selectedBounds(): Bounds | null {
    const s = getStudio();
    if (!s.selectedStrokeId) return null;
    const stroke = s.strokes.find((x) => x.id === s.selectedStrokeId);
    return stroke ? strokeBounds(stroke) : null;
  }
}

function structuredCloneish<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
