import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Viewport } from '../three/viewport';
import { BrushController } from '../three/brushController';
import { GeometryClient } from '../worker/client';
import { exportGlb } from '../three/exporter';
import { useStudio, getStudio } from '../state/store';
import {
  BRUSH_RADIUS,
  smoothReach,
  type Bounds,
} from '../core/field';
import type { BrushShape, SymAxis, ToolId } from '../core/types';
import { TOOL_META, TOOL_HINTS, IconExport, IconHome, IconTrash, IconUndo } from './icons';
import { StartScreen } from './StartScreen';
import { HistoryList } from './HistoryRow';
import { MaterialPanel } from './MaterialPanel';
import { TopologyPanel } from './TopologyPanel';

const RADIUS_LABEL = ['小', '中', '大'];
const HARDNESS_LABEL = ['柔', '中', '锐'];
const BLEND_LABEL = ['弱', '中', '强'];

export default function App() {
  const phase = useStudio((s) => s.phase);
  const tool = useStudio((s) => s.tool);
  const brush = useStudio((s) => s.brush);
  const mirrorAxis = useStudio((s) => s.mirrorAxis);
  const projectName = useStudio((s) => s.projectName);
  const stats = useStudio((s) => s.stats);
  const busy = useStudio((s) => s.busy);
  const error = useStudio((s) => s.error);
  const exportStatus = useStudio((s) => s.exportStatus);
  const exportMessage = useStudio((s) => s.exportMessage);
  const showStats = useStudio((s) => s.showStats);
  const history = useStudio((s) => s.history);
  const strokes = useStudio((s) => s.strokes);
  const autoRotate = useStudio((s) => s.autoRotate);
  const holdStrength = useStudio((s) => s.holdStrength);

  const canvasHost = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const clientRef = useRef<GeometryClient | null>(null);
  const brushRef = useRef<BrushController | null>(null);
  const [ready, setReady] = useState(false);

  /* --- 视图初始化 --- */
  useEffect(() => {
    if (phase !== 'editing' || !canvasHost.current) return;
    const client = new GeometryClient();
    clientRef.current = client;
    const viewport = new Viewport(canvasHost.current, {
      onStrokeStart: (info) => brushRef.current?.handleStart(info) ?? false,
      onStrokeMove: (info) => brushRef.current?.handleMove(info),
      onStrokeEnd: (info) => brushRef.current?.handleEnd(info),
    });
    viewportRef.current = viewport;
    const bc = new BrushController(client, viewport);
    brushRef.current = bc;
    viewport.setMaterial(getStudio().material);
    void bc.rebuild(true).then(() => setReady(true));

    return () => {
      bc.dispose();
      viewport.dispose();
      client.dispose();
      viewportRef.current = null;
      clientRef.current = null;
      brushRef.current = null;
      setReady(false);
    };
  }, [phase]);

  /* --- 材质变化 --- */
  const meshRevision = useStudio((s) => s.meshRevision);
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.setMaterial(getStudio().material);
  }, [meshRevision]);

  useEffect(() => {
    viewportRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  /* --- 键盘快捷键 --- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.code === 'Space') {
        // 按住空格临时进入观察模式 (旋转视角而不落笔)
        e.preventDefault();
        viewportRef.current?.setSpaceDown(true);
        return;
      }
      if (e.key === '1') useStudio.getState().setTool('add');
      else if (e.key === '2') useStudio.getState().setTool('erase');
      else if (e.key === '3') useStudio.getState().setTool('smooth');
      else if (e.key === '4') useStudio.getState().setTool('move');
      else if (e.key === 'q' || e.key === 'Q') useStudio.getState().setTool('orbit');
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const s = getStudio();
        s.undo();
      } else if (e.key === '[') {
        useStudio.getState().setBrush({ radiusLevel: Math.max(0, brush.radiusLevel - 1) as 0 | 1 | 2 });
      } else if (e.key === ']') {
        useStudio.getState().setBrush({ radiusLevel: Math.min(2, brush.radiusLevel + 1) as 0 | 1 | 2 });
      } else if (e.key === 'x' || e.key === 'X') {
        const s = getStudio();
        s.setMirrorAxis(s.mirrorAxis === 'x' ? null : 'x');
      } else if (e.key === 'Escape') {
        useStudio.getState().selectStroke(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') viewportRef.current?.setSpaceDown(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [brush.radiusLevel]);

  const doExport = useCallback(async () => {
    const s = getStudio();
    if (!brushRef.current) return;
    s.setExport('busy', '正在清理网格…');
    try {
      // 再走一次重建, 确保导出的就是视口里当前的几何; 随后在 worker 里做导出清理
      await clientRef.current!.build(s.baseShape, s.strokes, s.precision);
      const cleaned = await clientRef.current!.clean();
      if (!cleaned.render) throw new Error('网格清理失败');
      const report = await exportGlb({
        name: getStudio().projectName,
        positions: cleaned.render.positions,
        normals: cleaned.render.normals,
        indices: cleaned.render.indices,
        material: getStudio().material,
      });
      s.setExport(
        'done',
        `${report.fileName} · ${fmtInt(report.triangles)} 面 · ${(report.bytes / 1024 / 1024).toFixed(2)} MB`,
      );
    } catch (err: any) {
      s.setExport('error', String(err?.message ?? err));
    }
  }, []);

  if (phase === 'start') return <StartScreen />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">FORM</span>
          <span className="brand-sub">生成式三维造型工作台</span>
        </div>
        <input
          className="project-name"
          value={projectName}
          onChange={(e) => useStudio.getState().setProjectName(e.target.value)}
          maxLength={40}
          aria-label="项目名称"
        />
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          <button
            className="btn small"
            onClick={() => useStudio.getState().undo()}
            disabled={useStudio.getState().historyIndex < 0}
            title="撤销上一笔 (Ctrl+Z)"
          >
            <IconUndo />
            撤销
          </button>
          <button
            className="btn small"
            onClick={() => {
              if (confirm('清空当前造型并返回起点？')) useStudio.getState().resetProject();
            }}
            title="返回开场"
          >
            <IconHome />
            新建
          </button>
          <button className="btn primary small" onClick={doExport} disabled={exportStatus === 'busy' || strokes.length === 0}>
            {exportStatus === 'busy' ? <span className="spinner" /> : <IconExport />}
            {exportStatus === 'busy' ? '导出中…' : '导出 GLB'}
          </button>
        </div>
      </header>

      <aside className="left-panel">
        <div className="section">
          <div className="section-title">
            笔刷
            <span className="hint">1 / 2 / 3 / 4</span>
          </div>
          <div className="tool-grid">
            {TOOL_META.map((t) => (
              <button
                key={t.id}
                className={`tool-btn ${tool === t.id ? 'active' : ''}`}
                onClick={() => useStudio.getState().setTool(t.id)}
                title={`${t.label} (${t.kbd})`}
              >
                <t.icon />
                {t.label}
                <span className="kbd">{t.kbd}</span>
              </button>
            ))}
          </div>
          <div className="hint-row">{TOOL_HINTS[tool]}</div>
        </div>

        <div className="section">
          <div className="section-title">
            笔刷参数
            <span className="hint">[ / ] 调半径</span>
          </div>

          <div className="field-label">
            <span>形状</span>
            <span className="val">{brush.shape === 'sphere' ? '球状' : '胶囊'}</span>
          </div>
          <div className="seg">
            {(['sphere', 'capsule'] as BrushShape[]).map((sh) => (
              <button
                key={sh}
                className={brush.shape === sh ? 'active' : ''}
                onClick={() => useStudio.getState().setBrush({ shape: sh })}
              >
                {sh === 'sphere' ? '球状' : '胶囊'}
              </button>
            ))}
          </div>

          <LevelRow
            label="半径"
            value={brush.radiusLevel}
            options={RADIUS_LABEL}
            onChange={(v) => useStudio.getState().setBrush({ radiusLevel: v })}
            hint={BRUSH_RADIUS[brush.radiusLevel].toFixed(2)}
          />
          <LevelRow
            label="硬度"
            value={brush.hardnessLevel}
            options={HARDNESS_LABEL}
            onChange={(v) => useStudio.getState().setBrush({ hardnessLevel: v })}
            hint={['扁平剖面', '标准', '鼓起'][brush.hardnessLevel]}
          />
          <LevelRow
            label="融合强度"
            value={brush.blendLevel}
            options={BLEND_LABEL}
            onChange={(v) => useStudio.getState().setBrush({ blendLevel: v })}
            hint={['衔接利落', '平滑过渡', '大幅融合'][brush.blendLevel]}
          />

          <div className="mini-divider" />
          <div className="mirror-row">
            <span className="label">对称轴</span>
            {(['x', 'y', 'z'] as SymAxis[]).map((a) => (
              <button
                key={a}
                className={`axis-btn ${mirrorAxis === a ? 'active' : ''}`}
                onClick={() => useStudio.getState().setMirrorAxis(mirrorAxis === a ? null : a)}
                title={`沿 ${a.toUpperCase()} 轴镜像 (X 键)`}
              >
                {a.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="hint-row" style={{ marginTop: 8 }}>
            {mirrorAxis
              ? `镜像已开启: 每一笔都会沿 ${mirrorAxis.toUpperCase()} 轴生成同步副本`
              : '选择轴后, 之后每一笔都会镜像; 副本与主笔刷同步更新'}
          </div>
        </div>

        <HistoryList />
      </aside>

      <main className="viewport-wrap">
        <div className="viewport-canvas" ref={canvasHost} id="viewport" />
        <div className="vp-overlay">
          <div className="vp-top">
            <div className="pill-row">
              <span className={`pill ${mirrorAxis ? 'accent' : ''}`}>
                <span className="lbl">对称</span>
                {mirrorAxis ? mirrorAxis.toUpperCase() : '关'}
              </span>
              <span className="pill live">
                <span className="lbl">工具</span>
                {TOOL_META.find((t) => t.id === tool)?.label ?? (tool === 'orbit' ? '观察' : tool)}
              </span>
            </div>
            <div className="pill-row">
              {exportStatus === 'done' && exportMessage && (
                <span className="pill" style={{ color: 'var(--good)', borderColor: 'rgba(127,201,154,.35)' }}>
                  {exportMessage}
                </span>
              )}
            </div>
          </div>

          <div className={`busy-flag ${busy && !ready ? 'on' : ''}`}>
            <span className="spinner" />
            正在生成初始网格…
          </div>

          {holdStrength !== null && (
            <div className="hold-meter">
              <span className="hold-label">平滑力度</span>
              <span className="hold-track">
                <span className="hold-fill" style={{ width: `${Math.round(holdStrength * 100)}%` }} />
              </span>
              <span className="hold-val">{Math.round(holdStrength * 100)}%</span>
            </div>
          )}

          {error && (
            <div className="toast">
              <span>重建失败: {error}</span>
              <button className="btn small ghost" onClick={() => useStudio.getState().setError(null)}>
                关闭
              </button>
            </div>
          )}

          <div className="vp-hud">
            {showStats && <TopologyPanel stats={stats} />}
          </div>

          <div className="vp-bottom-right">
            <div className="mini-actions">
              <button
                className="hud-toggle"
                onClick={() => {
                  const v = !getStudio().showStats;
                  useStudio.setState({ showStats: v });
                }}
              >
                {showStats ? '隐藏拓扑' : '显示拓扑'}
              </button>
              <button className="hud-toggle" onClick={() => viewportRef.current?.resetCamera()}>
                复位视角
              </button>
              <button
                className={`hud-toggle ${autoRotate ? 'active' : ''}`}
                onClick={() => useStudio.getState().setAutoRotate(!autoRotate)}
                style={autoRotate ? { color: 'var(--accent)', borderColor: 'rgba(224,160,106,.4)' } : undefined}
              >
                自动旋转
              </button>
            </div>
          </div>
        </div>
      </main>

      <aside className="right-panel">
        <MaterialPanel />
      </aside>

      <footer className="statusbar">
        <span>{stats ? `${fmtInt(stats.triangles)} 面 · ${fmtInt(stats.vertices)} 顶点` : '等待网格'}</span>
        <span>{stats ? `单元 ${stats.cellSize.toFixed(3)}` : ''}</span>
        <span>{stats ? (stats.mode === 'local' ? `局部重建 ${fmtInt(stats.dirtyCells)} 格` : '全量重建') : ''}</span>
        <span style={{ marginLeft: 'auto' }}>
          {stats ? `上次重建 ${stats.rebuildMs} ms` : ''} · 历史 {history.length} 笔
        </span>
      </footer>
    </div>
  );
}

function LevelRow({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: 0 | 1 | 2;
  options: string[];
  onChange: (v: 0 | 1 | 2) => void;
  hint: string;
}) {
  return (
    <>
      <div className="field-label">
        <span>{label}</span>
        <span className="val">{hint}</span>
      </div>
      <div className="levels">
        {options.map((o, i) => (
          <button
            key={o}
            className={`level ${value === i ? 'active' : ''}`}
            onClick={() => onChange(i as 0 | 1 | 2)}
          >
            {o}
          </button>
        ))}
      </div>
    </>
  );
}

export function fmtInt(n: number) {
  return n.toLocaleString('en-US');
}
