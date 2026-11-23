import { useState } from 'react'
import { useStore } from '../store'
import { exportTrajectoryGlb } from '../lib/exporter'
import type { InterpMode } from '../types'

export function ExportPage(): JSX.Element {
  const trajectory = useStore((s) => s.trajectory)
  const interpMode = useStore((s) => s.interpMode)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState<number | null>(null)
  const [step, setStep] = useState(1)
  const [mode, setMode] = useState<InterpMode | 'follow'>('follow')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)

  if (!trajectory) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="icon">💾</div>
          载入轨迹后可导出帧区间为 GLB
        </div>
      </div>
    )
  }

  const lastFrame = trajectory.frameCount - 1
  const startClamped = Math.min(Math.max(0, start), lastFrame)
  const endClamped = Math.min(Math.max(startClamped, end ?? lastFrame), lastFrame)
  const effectiveMode: InterpMode = mode === 'follow' ? interpMode : mode
  const exportFrames = Math.floor((endClamped - startClamped) / Math.max(1, step)) + 1

  const runExport = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setDoneMsg(null)
    try {
      await exportTrajectoryGlb(trajectory, {
        startFrame: startClamped,
        endFrame: endClamped,
        step: Math.max(1, step),
        mode: effectiveMode,
      })
      setDoneMsg(`已导出 ${exportFrames} 个采样帧,浏览器已开始下载 GLB 文件`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h2>导出帧区间为 GLB</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          导出的 GLB 中每个原子为一个节点,所选区间的位置写入 glTF 动画轨道(VectorKeyframeTrack),
          可在 Blender、Windows 3D 查看器等支持 glTF 动画的工具中回放。
        </p>

        <h3>帧区间</h3>
        <div className="row">
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">起始帧</span>
            <input type="number" min={0} max={lastFrame} value={startClamped} onChange={(e) => setStart(Number(e.target.value))} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">结束帧</span>
            <input
              type="number"
              min={startClamped}
              max={lastFrame}
              value={endClamped}
              onChange={(e) => setEnd(Number(e.target.value))}
            />
          </label>
          <button
            className="btn small"
            onClick={() => {
              setStart(0)
              setEnd(lastFrame)
            }}
          >
            全选(0–{lastFrame})
          </button>
        </div>

        <h3>采样间隔与插值</h3>
        <div className="row">
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">每 N 帧取 1 帧</span>
            <input type="number" min={1} max={Math.max(1, lastFrame)} value={step} onChange={(e) => setStep(Number(e.target.value))} />
          </label>
          <div className="segmented">
            <button className={mode === 'follow' ? 'active' : ''} onClick={() => setMode('follow')}>
              跟随当前({interpMode === 'smooth' ? '平滑' : '线性'})
            </button>
            <button className={mode === 'linear' ? 'active' : ''} onClick={() => setMode('linear')}>
              强制线性
            </button>
            <button className={mode === 'smooth' ? 'active' : ''} onClick={() => setMode('smooth')}>
              强制平滑
            </button>
          </div>
        </div>

        <h3>导出预览</h3>
        <div className="stat-grid">
          <div className="stat">
            <div className="label">采样帧数</div>
            <div className="value">{exportFrames.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="label">节点数(原子)</div>
            <div className="value">{trajectory.atomCount.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="label">动画时长</div>
            <div className="value">{((endClamped - startClamped) * trajectory.frameDelta).toFixed(2)} s</div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" disabled={busy} onClick={() => void runExport()}>
            {busy ? <span className="spinner" /> : null}
            {busy ? '正在构建 GLB…' : '导出并下载 GLB'}
          </button>
          {busy && <span className="muted">大区间导出需要逐节点写入关键帧,请稍候</span>}
        </div>
        {error && <div className="error-box" style={{ marginTop: 12 }}>导出失败:{error}</div>}
        {doneMsg && <div className="progress-hint" style={{ color: 'var(--ok)' }}>✓ {doneMsg}</div>}
      </div>
    </div>
  )
}
