/**
 * 几何引擎 (不依赖运行环境)。
 *
 * 由 worker 注入 manifold 的 WASM 模块后调用; 同一套代码在 node 里也能跑,
 * 因此离线一致性测试覆盖的就是视口里实际跑的路径。
 *
 * 表面由 core/surface.ts 的增量 marching tetrahedra 生成:
 *   · 全量重建: 采样整张栅格 → 重建所有单元
 *   · 局部重建: 只让脏区覆盖的节点失效 → 只重算脏区单元
 * 顶点只取决于栅格边上两端的值, 因此局部重建的接缝与旧网格逐顶点重合。
 */

import {
  compileField,
  strokeBounds,
  strokeBoundsFrom,
  CELL_SIZE,
  DOMAIN_HALF,
  emptyBounds,
  boundsEmpty,
  type Bounds,
  type CompiledField,
} from './field';
import { SurfaceBuilder, type SurfaceMesh } from './surface';
import { weldAndNormals, meshBounds, type RenderMesh } from './mesh';
import type { BaseShapeId, PrecisionId, Stroke, Vec3 } from './types';

export interface EngineDeps {
  Manifold: any;
}

export interface EngineStats {
  triangles: number;
  vertices: number;
  bbox: { min: Vec3; max: Vec3 } | null;
  rebuildMs: number;
  watertight: boolean;
  cellSize: number;
  domainHalf: number;
  volume: number;
  /** 本次重建覆盖的脏区 (局部重建时) */
  partial: Bounds | null;
  mode: 'full' | 'local';
  dirtyCells: number;
  rebuiltTriangles: number;
  /** 罩面用的实体 (manifold) 是否可用 */
  solidVolume: number;
  gridDim: number;
}

export interface EngineResult {
  render: RenderMesh;
  stats: EngineStats;
  /** 只含几何变化的包围盒; 供视口做局部闪烁提示 */
  changed: Bounds | null;
}

export class SculptEngine {
  private Manifold: any;
  private builder: SurfaceBuilder | null = null;
  private field: CompiledField | null = null;
  private strokes: Stroke[] = [];
  private base: BaseShapeId = 'sphere';
  private cell = 0;

  constructor(deps: EngineDeps) {
    this.Manifold = deps.Manifold;
  }

  dispose() {
    this.builder = null;
    this.field = null;
  }

  get hasSurface() {
    return this.builder !== null;
  }

  rebuild(base: BaseShapeId, strokes: Stroke[], precision: PrecisionId): EngineResult {
    const cell = CELL_SIZE[precision];
    const field = compileField(base, strokes);
    const gridCells = Math.max(8, Math.round((2 * DOMAIN_HALF) / cell));
    const needFull = !this.builder || this.builder.cells !== gridCells || this.base !== base;

    if (needFull) {
      return this.rebuildFull(base, strokes, precision, field);
    }
    const builder = this.builder;
    if (!builder) return this.rebuildFull(base, strokes, precision, field);
    const dirty = this.computeDirty(strokes, field);
    if (boundsEmpty(dirty)) {
      this.strokes = strokes;
      this.field = field;
      const snap = builder.compile();
      return {
        render: { ...snap, weldedVertices: snap.vertexCount, droppedTriangles: 0 },
        stats: this.statsFor(snap, 0, null, 'local', 0, 0),
        changed: null,
      };
    }
    const t0 = performance.now();
    builder.setField(field);
    const s = builder.rebuildRegion(dirty);
    const snap = builder.compile();
    const ms = performance.now() - t0;
    this.strokes = strokes;
    this.base = base;
    this.cell = cell;
    this.field = field;
    const stats = this.statsFor(snap, ms, clampBounds(dirty), 'local', s.dirtyCells, s.rebuiltTriangles);
    return {
      render: { ...snap, weldedVertices: snap.vertexCount, droppedTriangles: 0 },
      stats,
      changed: clampBounds(dirty),
    };
  }

  private rebuildFull(base: BaseShapeId, strokes: Stroke[], precision: PrecisionId, field: CompiledField): EngineResult {
    const cell = CELL_SIZE[precision];
    const t0 = performance.now();
    const builder = new SurfaceBuilder(field, cell, DOMAIN_HALF);
    const s = builder.rebuildAll();
    const snap = builder.compile();
    const ms = performance.now() - t0;
    this.builder = builder;
    this.field = field;
    this.strokes = strokes;
    this.base = base;
    this.cell = cell;
    return {
      render: { ...snap, weldedVertices: snap.vertexCount, droppedTriangles: 0 },
      stats: this.statsFor(snap, ms, null, 'full', s.dirtyCells, s.rebuiltTriangles),
      changed: null,
    };
  }

  private statsFor(
    snap: SurfaceMesh,
    ms: number,
    partial: Bounds | null,
    mode: 'full' | 'local',
    dirtyCells: number,
    rebuiltTriangles: number,
  ): EngineStats {
    const bbox = meshBounds(snap.positions);
    return {
      triangles: snap.triangleCount,
      vertices: snap.vertexCount,
      bbox,
      rebuildMs: Math.round(ms),
      watertight: true,
      cellSize: this.builder?.step ?? this.cell,
      domainHalf: DOMAIN_HALF,
      volume: this.meshSignedVolume(snap),
      partial,
      mode,
      dirtyCells,
      rebuiltTriangles,
      solidVolume: 0,
      gridDim: this.builder?.dim ?? 0,
    };
  }

  private meshSignedVolume(mesh: SurfaceMesh): number {
    const P = mesh.positions;
    const I = mesh.indices;
    let vol = 0;
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
      vol +=
        (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
          P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
          P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) /
        6;
    }
    return Math.abs(vol);
  }

  /** 当前最新网格 (供导出) */
  currentMesh(): SurfaceMesh | null {
    return this.builder ? this.builder.compile() : null;
  }

  /** 体积: 用 manifold 的 ofMesh 精确计算 (导出 / 统计时按需调用) */
  measureVolume(): number {
    const mesh = this.currentMesh();
    if (!mesh || mesh.triangleCount === 0) return 0;
    try {
      const m = this.Manifold.ofMesh({
        numProp: 3,
        vertProperties: mesh.positions,
        triVerts: mesh.indices,
        mergeFromVert: new Uint32Array(0),
        mergeToVert: new Uint32Array(0),
      });
      const v = m.volume();
      m.delete?.();
      return v;
    } catch {
      let vol = 0;
      const P = mesh.positions;
      const I = mesh.indices;
      for (let i = 0; i < I.length; i += 3) {
        const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
        vol +=
          (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
            P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
            P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) /
          6;
      }
      return Math.abs(vol);
    }
  }

  /**
   * 导出前的网格清理。
   *
   * 步骤:
   *   1. 把三角剖分交给 manifold —— 它枚举重合顶点 (mergeFrom/mergeTo)、
   *      剔除零面积面, 并保证结果是 2-流形
   *   2. 用 calculateNormals 生成带折痕保护的顶点法线
   *   3. 按 merge 映射把属性顶点压平成最终网格 (位置去重, 法线保留折痕差异)
   *
   * 任何一步失败都退回本地焊接, 保证导出流程不会中断。
   */
  cleanForExport(): RenderMesh | null {
    const mesh = this.currentMesh();
    if (!mesh || mesh.triangleCount === 0) return null;
    try {
      const m = this.Manifold.ofMesh({
        numProp: 3,
        vertProperties: mesh.positions,
        triVerts: mesh.indices,
        mergeFromVert: new Uint32Array(0),
        mergeToVert: new Uint32Array(0),
      });
      if (m.status() !== 'NoError') {
        m.delete?.();
        return weldAndNormals({ positions: mesh.positions, indices: mesh.indices }, 42, 3e5);
      }

      // 折痕法线: 属性顶点会因法线不连续而分裂, 但位置仍然重合
      const withNormals = m.calculateNormals(0, 42);
      const out = withNormals.getMesh(0);
      const n = out.numVert;
      const np = out.numProp;
      const props = out.vertProperties;

      // 把属性顶点按位置压平为最终顶点, 每个位置只保留一份法线 (按面平均)
      const posKey = new Map<string, number>();
      const positions: number[] = [];
      const normals: number[] = [];
      const remap = new Int32Array(n).fill(-1);
      const normalSum: number[] = [];
      for (let i = 0; i < n; i++) {
        const x = props[i * np];
        const y = props[i * np + 1];
        const z = props[i * np + 2];
        const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
        let idx = posKey.get(k);
        if (idx === undefined) {
          idx = positions.length / 3;
          posKey.set(k, idx);
          positions.push(x, y, z);
          normalSum.push(0, 0, 0);
        }
        remap[i] = idx;
        if (np >= 6) {
          normalSum[idx * 3] += props[i * np + 3];
          normalSum[idx * 3 + 1] += props[i * np + 4];
          normalSum[idx * 3 + 2] += props[i * np + 5];
        }
      }
      for (let i = 0; i < positions.length / 3; i++) {
        let nx = normalSum[i * 3];
        let ny = normalSum[i * 3 + 1];
        let nz = normalSum[i * 3 + 2];
        const L = Math.hypot(nx, ny, nz);
        if (L > 1e-9) {
          nx /= L;
          ny /= L;
          nz /= L;
        } else {
          nx = 0;
          ny = 1;
          nz = 0;
        }
        normals.push(nx, ny, nz);
      }

      const tris = out.triVerts;
      const indices: number[] = [];
      for (let t = 0; t < tris.length; t += 3) {
        const a = remap[tris[t]];
        const b = remap[tris[t + 1]];
        const c = remap[tris[t + 2]];
        if (a === b || b === c || a === c) continue;
        indices.push(a, b, c);
      }

      m.delete?.();
      withNormals.delete?.();
      return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: new Uint32Array(indices),
        vertexCount: positions.length / 3,
        triangleCount: indices.length / 3,
        weldedVertices: positions.length / 3,
        droppedTriangles: out.numTri - indices.length / 3,
      };
    } catch {
      return weldAndNormals({ positions: mesh.positions, indices: mesh.indices }, 42, 3e5);
    }
  }

  /** 包围盒 (不含清理) */
  bounds(): Bounds | null {
    const mesh = this.currentMesh();
    if (!mesh) return null;
    const b = meshBounds(mesh.positions);
    return b ? { min: b.min, max: b.max } : null;
  }

  /**
   * 脏区: 比较新旧笔刷栈。
   * 平滑笔刷会读取它下方所有笔刷的场, 因此下方一旦变化, 它的整球都要重算。
   */
  private computeDirty(next: Stroke[], _field: CompiledField): Bounds {
    const prev = this.strokes;
    const prevById = new Map<string, Stroke>();
    prev.forEach((s) => prevById.set(s.id, s));
    const nextIdx = new Map<string, number>();
    next.forEach((s, i) => nextIdx.set(s.id, i));

    const dirty = emptyBounds();
    const pad = this.builder ? this.builder.step * 3 : 0.1;
    const add = (b: Bounds, extra = 0) => {
      for (let i = 0; i < 3; i++) {
        dirty.min[i] = Math.min(dirty.min[i], b.min[i] - extra);
        dirty.max[i] = Math.max(dirty.max[i], b.max[i] + extra);
      }
    };

    const changedNext: Stroke[] = [];
    const grownOnly: { stroke: Stroke; from: number }[] = [];
    for (const s of next) {
      const old = prevById.get(s.id);
      if (!old || old !== s) {
        changedNext.push(s);
        // 拖动中的笔触: 只增长 (旧点前缀相同) 时只需重建新增段的邻域
        if (old && s.kind !== 'smooth' && isPrefix(old.points, s.points) && s.points.length > old.points.length) {
          grownOnly.push({ stroke: s, from: old.points.length });
        }
      }
    }
    const grownIds = new Set(grownOnly.map((g) => g.stroke.id));
    for (const s of changedNext) {
      if (grownIds.has(s.id)) continue;
      add(strokeBounds(s), pad);
    }
    for (const g of grownOnly) add(strokeBoundsFrom(g.stroke, g.from), pad);
    for (const s of prev) if (!nextIdx.has(s.id)) add(strokeBounds(s), pad);

    for (const s of next) {
      if (s.kind !== 'smooth') continue;
      const i = nextIdx.get(s.id)!;
      let below = false;
      for (const c of changedNext) {
        if (nextIdx.get(c.id)! < i) {
          below = true;
          break;
        }
      }
      if (!below) {
        for (const p of prev) {
          if (!nextIdx.has(p.id) && prev.indexOf(p) < i) {
            below = true;
            break;
          }
        }
      }
      if (below) add(strokeBounds(s), s.radius * 2.4);
    }
    return dirty;
  }
}

function isPrefix(prev: Vec3[], next: Vec3[]): boolean {
  if (prev.length === 0 || prev.length > next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (Math.abs(a[0] - b[0]) > 1e-6 || Math.abs(a[1] - b[1]) > 1e-6 || Math.abs(a[2] - b[2]) > 1e-6) return false;
  }
  return true;
}

function clampBounds(b: Bounds): Bounds {
  return {
    min: [Math.max(-DOMAIN_HALF, b.min[0]), Math.max(-DOMAIN_HALF, b.min[1]), Math.max(-DOMAIN_HALF, b.min[2])],
    max: [Math.min(DOMAIN_HALF, b.max[0]), Math.min(DOMAIN_HALF, b.max[1]), Math.min(DOMAIN_HALF, b.max[2])],
  };
}
