import { useStore, SPEEDS } from '../store'
import { getScene } from '../components/Viewport'

export function PlayPage(): JSX.Element {
  const trajectory = useStore((s) => s.trajectory)
  const colorMode = useStore((s) => s.colorMode)
  const setColorMode = useStore((s) => s.setColorMode)
  const trailEnabled = useStore((s) => s.trailEnabled)
  const setTrailEnabled = useStore((s) => s.setTrailEnabled)
  const trailLength = useStore((s) => s.trailLength)
  const setTrailLength = useStore((s) => s.setTrailLength)
  const labelsVisible = useStore((s) => s.labelsVisible)
  const setLabelsVisible = useStore((s) => s.setLabelsVisible)
  const interpMode = useStore((s) => s.interpMode)

  if (!trajectory) return <EmptyHint />

  return (
    <div className="page">
      <div className="card">
        <h2>显示设置</h2>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <span className="muted">原子着色</span>
            <div className="segmented">
              <button className={colorMode === 'displacement' ? 'active' : ''} onClick={() => setColorMode('displacement')}>
                累计位移
              </button>
              <button className={colorMode === 'element' ? 'active' : ''} onClick={() => setColorMode('element')}>
                元素 CPK
              </button>
            </div>
            {colorMode === 'displacement' && (
              <div className="legend">
                <span className="muted">小</span>
                <div className="ramp" />
                <span className="muted">大</span>
              </div>
            )}
          </div>
          <button className="btn small" onClick={() => getScene()?.resetView()}>
            重置视角
          </button>
        </div>
      </div>

      <div className="card">
        <h2>拖尾与标注</h2>
        <div className="row" style={{ gap: 26 }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={trailEnabled} onChange={(e) => setTrailEnabled(e.target.checked)} />
            原子轨迹拖尾
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={labelsVisible} onChange={(e) => setLabelsVisible(e.target.checked)} />
            显示 Top10 残基标注
          </label>
          <div className="row" style={{ gap: 8 }}>
            <span className="muted">拖尾长度</span>
            <input
              type="range"
              min={4}
              max={120}
              value={trailLength}
              disabled={!trailEnabled}
              onChange={(e) => setTrailLength(Number(e.target.value))}
              style={{ width: 180 }}
            />
            <span className="tag">{trailLength} 帧</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>轨迹信息</h2>
        <div className="stat-grid">
          <div className="stat">
            <div className="label">总帧数</div>
            <div className="value">{trajectory.frameCount.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="label">原子数</div>
            <div className="value">{trajectory.atomCount.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="label">帧间隔</div>
            <div className="value">{trajectory.frameDelta} s</div>
          </div>
          <div className="stat">
            <div className="label">插值方式</div>
            <div className="value" style={{ fontSize: 16 }}>
              {interpMode === 'smooth' ? 'Catmull-Rom 平滑' : '线性'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function TransportBar(): JSX.Element {
  const trajectory = useStore((s) => s.trajectory)
  const playing = useStore((s) => s.playing)
  const speed = useStore((s) => s.speed)
  const time = useStore((s) => s.time)
  const setPlaying = useStore((s) => s.setPlaying)
  const setSpeed = useStore((s) => s.setSpeed)
  const setTime = useStore((s) => s.setTime)

  if (!trajectory) {
    return (
      <div className="transport">
        <div className="muted">尚未载入轨迹,请先到「轨迹载入」页选择文件或生成演示轨迹。</div>
      </div>
    )
  }

  const maxT = trajectory.frameCount - 1
  const frameNo = Math.round(time)

  return (
    <div className="transport">
      <div className="transport-top">
        <button className="play-btn" onClick={() => setPlaying(!playing)} title={playing ? '暂停' : '播放'}>
          {playing ? '⏸' : '▶'}
        </button>
        <div className="frame-readout">
          <b>{frameNo + 1}</b> / {trajectory.frameCount} 帧
        </div>
        <div className="timeline-wrap">
          <input
            type="range"
            min={0}
            max={maxT}
            step={0.01}
            value={time}
            onChange={(e) => {
              setPlaying(false)
              setTime(Number(e.target.value))
            }}
            aria-label="时间轴"
          />
          <div className="timeline-meta">
            <span>第 1 帧</span>
            <span>连续时间 {time.toFixed(2)} 帧</span>
            <span>第 {trajectory.frameCount} 帧</span>
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <span className="muted">倍速</span>
        <div className="speed-grid segmented">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <span className="muted" style={{ marginLeft: 'auto' }}>
          拖动时间轴可精确定位(支持亚帧插值),拖动时自动暂停
        </span>
      </div>
    </div>
  )
}

function EmptyHint(): JSX.Element {
  return (
    <div className="page">
      <div className="empty-state">
        <div className="icon">🧬</div>
        载入轨迹后即可在此调整播放与显示选项
      </div>
    </div>
  )
}
