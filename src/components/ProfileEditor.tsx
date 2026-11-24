import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProfilePoint } from '../core/types';
import { sampleProfileCurve } from '../core/spline';
import { defaultProfilePoints } from '../core/defaults';
import { appStore, useAppState } from '../core/store';
import { ActionButton, Section } from './controls';

/**
 * 母线编辑器（r-z 平面，r 水平向右，z 竖直向上）。
 * - 拖拽控制点：低 LOD 联动重算；松手 flushFullQuality 全量重建
 * - 双击空白处加点；双击控制点删除（至少保留 2 点）
 * - 手绘模式：沿笔画采样并按 z 单调化
 * - 支持 CSV / JSON 导入
 */

type Mode = 'edit' | 'draw';

const PAD = 42;

export function ProfileEditor() {
  const points = useAppState((s) => s.config.profile.points);
  const samples = useAppState((s) => s.config.profile.samples);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('edit');
  const [size, setSize] = useState({ w: 520, h: 560 });
  const dragIndexRef = useRef<number | null>(null);
  const drawStrokeRef = useRef<ProfilePoint[]>([]);
  const [drawTick, setDrawTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const curvePreview = useMemo(() => {
    try {
      return sampleProfileCurve(points, samples);
    } catch {
      return [];
    }
  }, [points, samples]);

  const bounds = useMemo(() => {
    const rMax = Math.max(60, ...points.map((p) => p.r)) * 1.12;
    const zMax = Math.max(60, ...points.map((p) => p.z)) * 1.08;
    return { rMax, zMax };
  }, [points]);

  const toScreen = useCallback(
    (r: number, z: number) => ({
      x: PAD + (r / bounds.rMax) * (size.w - PAD * 2),
      y: size.h - PAD - (z / bounds.zMax) * (size.h - PAD * 2),
    }),
    [bounds, size],
  );
  const toData = useCallback(
    (x: number, y: number) => ({
      r: ((x - PAD) / (size.w - PAD * 2)) * bounds.rMax,
      z: ((size.h - PAD - y) / (size.h - PAD * 2)) * bounds.zMax,
    }),
    [bounds, size],
  );

  // 自适应宽度
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(() => {
      const w = wrapRef.current?.clientWidth ?? 520;
      setSize({ w, h: Math.max(460, Math.min(640, w * 1.08)) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // 绘制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    // 网格
    ctx.strokeStyle = '#e3ddd1';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#8a8175';
    ctx.font = '11px system-ui, sans-serif';
    const gridR = niceStep(bounds.rMax / 5);
    const gridZ = niceStep(bounds.zMax / 5);
    for (let r = 0; r <= bounds.rMax + 1e-6; r += gridR) {
      const { x } = toScreen(r, 0);
      ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, size.h - PAD); ctx.stroke();
      ctx.fillText(`${Math.round(r)}`, x - 8, size.h - PAD + 16);
    }
    for (let z = 0; z <= bounds.zMax + 1e-6; z += gridZ) {
      const { y } = toScreen(0, z);
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(size.w - PAD, y); ctx.stroke();
      ctx.fillText(`${Math.round(z)}`, 6, y + 4);
    }
    // 轴标签
    ctx.fillStyle = '#6b6256';
    ctx.fillText('r / mm 半径 →', size.w - PAD - 86, size.h - PAD + 32);
    ctx.save();
    ctx.translate(14, PAD + 60);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('z / mm 高度 →', 0, 0);
    ctx.restore();

    // 回转轴
    const axis = toScreen(0, 0);
    ctx.strokeStyle = '#9a9184';
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(axis.x, PAD - 10); ctx.lineTo(axis.x, size.h - PAD); ctx.stroke();
    ctx.setLineDash([]);

    // 样条曲线
    if (curvePreview.length > 1) {
      ctx.strokeStyle = '#2f6f5e';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      curvePreview.forEach((q, i) => {
        const s = toScreen(q.r, q.z);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }

    // 手绘笔画
    if (drawStrokeRef.current.length > 1) {
      ctx.strokeStyle = '#c26a3a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      drawStrokeRef.current.forEach((p, i) => {
        const s = toScreen(p.r, p.z);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }

    if (mode === 'edit') {
      // 控制点连线
      ctx.strokeStyle = '#b8a88f';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      points.forEach((p, i) => {
        const s = toScreen(p.r, p.z);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
      // 控制点
      points.forEach((p, i) => {
        const s = toScreen(p.r, p.z);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = i === dragIndexRef.current ? '#b44a1f' : '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#7a5a34';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#4a4034';
        ctx.font = '10px system-ui';
        ctx.fillText(`P${i + 1}`, s.x + 9, s.y - 8);
      });
    }
  }, [points, curvePreview, size, bounds, toScreen, mode, drawTick]);

  const hitPoint = useCallback(
    (x: number, y: number): number => {
      for (let i = 0; i < points.length; i++) {
        const s = toScreen(points[i].r, points[i].z);
        if (Math.hypot(s.x - x, s.y - y) <= 10) return i;
      }
      return -1;
    },
    [points, toScreen],
  );

  const commitPoints = useCallback((next: ProfilePoint[], lowQuality: boolean) => {
    const sorted = [...next].sort((a, b) => a.z - b.z);
    appStore.updateProfile(sorted, lowQuality);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (mode === 'draw') {
      const d = toData(x, y);
      drawStrokeRef.current = [{ r: Math.max(2, d.r), z: clampZ(d.z) }];
      return;
    }
    const idx = hitPoint(x, y);
    dragIndexRef.current = idx >= 0 ? idx : null;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const d = toData(x, y);

    if (mode === 'draw') {
      const stroke = drawStrokeRef.current;
      const last = stroke[stroke.length - 1];
      const nd = { r: Math.max(2, d.r), z: clampZ(d.z) };
      if (!last || Math.hypot(nd.r - last.r, nd.z - last.z) > 3) {
        stroke.push(nd);
        setDrawTick((v) => v + 1);
      }
      return;
    }
    const idx = dragIndexRef.current;
    if (idx === null) return;
    const next = points.map((p, i) =>
      i === idx
        ? {
            r: THREE_clamp(d.r, 2, bounds.rMax * 0.99),
            z: THREE_clamp(d.z, 0, bounds.zMax * 0.99),
          }
        : p,
    );
    commitPoints(next, true);
  };

  const onPointerUp = () => {
    if (mode === 'draw') {
      const stroke = drawStrokeRef.current;
      if (stroke.length >= 2) {
        const simplified = monotonicSimplify(stroke, 8);
        commitPoints(simplified, false);
        appStore.flushFullQuality();
      }
      drawStrokeRef.current = [];
      setMode('edit');
      return;
    }
    if (dragIndexRef.current !== null) appStore.flushFullQuality();
    dragIndexRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== 'edit') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const idx = hitPoint(x, y);
    if (idx >= 0) {
      if (points.length <= 2) return;
      commitPoints(points.filter((_, i) => i !== idx), false);
      appStore.flushFullQuality();
    } else {
      const d = toData(x, y);
      commitPoints([...points, { r: Math.max(2, d.r), z: clampZ(d.z) }], false);
      appStore.flushFullQuality();
    }
  };

  const onImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const imported = parseProfileFile(text);
        if (imported.length < 2) throw new Error('至少需要 2 个有效点');
        commitPoints(imported, false);
        appStore.flushFullQuality();
      } catch (err) {
        alert(`导入失败：${err instanceof Error ? err.message : err}`);
      }
    };
    reader.readAsText(file);
  };

  const addPoint = () => {
    const maxZ = Math.max(...points.map((p) => p.z));
    const tail = points[points.length - 1];
    commitPoints(
      [...points, { r: Math.max(8, tail.r * 0.92), z: maxZ + Math.max(12, bounds.zMax * 0.06) }],
      false,
    );
    appStore.flushFullQuality();
  };

  const resetProfile = () => {
    commitPoints(defaultProfilePoints(), false);
    appStore.flushFullQuality();
  };

  return (
    <div className="page" ref={wrapRef}>
      <Section
        title="灯罩母线（r–z 轮廓）"
        extra={
          <span className="section-extra">
            双击空白加点 · 双击控制点删除 · 拖拽实时联动
          </span>
        }
      >
        <div className={`profile-canvas-wrap mode-${mode}`}>
          <canvas
            ref={canvasRef}
            style={{ width: size.w, height: size.h }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={onDoubleClick}
          />
          {mode === 'draw' ? <div className="draw-banner">手绘中：按下并描出轮廓，松手自动生成控制点</div> : null}
        </div>

        <div className="btn-row">
          <ActionButton variant={mode === 'draw' ? 'primary' : 'default'} onClick={() => setMode(mode === 'draw' ? 'edit' : 'draw')}>
            {mode === 'draw' ? '取消手绘' : '✎ 手绘母线'}
          </ActionButton>
          <ActionButton onClick={addPoint}>＋ 增加控制点（{points.length}）</ActionButton>
          <ActionButton onClick={() => fileInputRef.current?.click()}>导入 CSV / JSON</ActionButton>
          <ActionButton onClick={resetProfile}>恢复默认轮廓</ActionButton>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json,.txt"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </Section>

      <Section title="控制点数据">
        <div className="points-table-wrap">
          <table className="points-table">
            <thead>
              <tr><th>#</th><th>半径 r (mm)</th><th>高度 z (mm)</th><th></th></tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={i}>
                  <td>P{i + 1}</td>
                  <td>
                    <input
                      type="number"
                      value={Math.round(p.r * 100) / 100}
                      min={2}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          commitPoints(points.map((q, j) => (j === i ? { ...q, r: Math.max(2, v) } : q)), true);
                        }
                      }}
                      onBlur={() => appStore.flushFullQuality()}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={Math.round(p.z * 100) / 100}
                      min={0}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          commitPoints(points.map((q, j) => (j === i ? { ...q, z: Math.max(0, v) } : q)), true);
                        }
                      }}
                      onBlur={() => appStore.flushFullQuality()}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-danger"
                      disabled={points.length <= 2}
                      onClick={() => {
                        commitPoints(points.filter((_, j) => j !== i), false);
                        appStore.flushFullQuality();
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function THREE_clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
function clampZ(z: number) {
  return Math.max(0.5, z);
}
function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const step = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return step * pow;
}

/** 手绘笔画 → z 单调、点数受限的控制点序列 */
function monotonicSimplify(stroke: ProfilePoint[], maxPoints: number): ProfilePoint[] {
  // 强制 z 单调递增：扫描保留包络
  const mono: ProfilePoint[] = [];
  let zCursor = -Infinity;
  for (const p of stroke) {
    if (p.z > zCursor + 1e-6) {
      mono.push(p);
      zCursor = p.z;
    } else if (mono.length) {
      mono[mono.length - 1] = { r: (mono[mono.length - 1].r + p.r) * 0.5, z: mono[mono.length - 1].z };
    }
  }
  if (mono.length < 2) return stroke.slice(0, maxPoints);
  // 等距抽稀
  const out: ProfilePoint[] = [];
  const n = Math.min(maxPoints, mono.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (mono.length - 1)) / (n - 1));
    out.push(mono[idx]);
  }
  return out;
}

/** 解析 CSV（r,z 每行）或 JSON（[{r,z}] / 配置文件） */
function parseProfileFile(text: string): ProfilePoint[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const json = JSON.parse(trimmed);
    const arr: unknown = Array.isArray(json) ? json : (json as { profile?: { points?: unknown } }).profile?.points;
    if (!Array.isArray(arr)) throw new Error('JSON 中未找到控制点数组');
    return arr.map((item) => {
      const o = item as Record<string, unknown>;
      const r = Number(o.r ?? o.radius ?? o[0]);
      const z = Number(o.z ?? o.height ?? o[1]);
      if (!Number.isFinite(r) || !Number.isFinite(z)) throw new Error('点格式应为 {r, z}');
      return { r, z };
    });
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(/[,\t;]/).map((s) => Number(s.trim()));
      if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
        throw new Error(`无法解析行：${line}`);
      }
      return { r: parts[0], z: parts[1] };
    });
}
