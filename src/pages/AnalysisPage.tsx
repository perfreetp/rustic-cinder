import { useMemo } from 'react'
import { useStore } from '../store'

export function AnalysisPage(): JSX.Element {
  const trajectory = useStore((s) => s.trajectory)
  const cumulative = useStore((s) => s.cumulative)
  const maxDisplacement = useStore((s) => s.maxDisplacement)
  const interpMode = useStore((s) => s.interpMode)
  const setInterpMode = useStore((s) => s.setInterpMode)
  const colorMode = useStore((s) => s.colorMode)
  const setColorMode = useStore((s) => s.setColorMode)

  const top10 = useMemo(() => {
    if (!trajectory || !cumulative) return []
    return Array.from({ length: trajectory.atomCount }, (_, i) => i)
      .sort((a, b) => cumulative[b] - cumulative[a])
      .slice(0, 10)
      .map((id, rank) => ({
        rank: rank + 1,
        id,
        atom: trajectory.atoms[id],
        displacement: cumulative[id],
        normalized: cumulative[id] / (maxDisplacement || 1),
      }))
  }, [trajectory, cumulative, maxDisplacement])

  if (!trajectory || !cumulative) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="icon">📈</div>
          载入轨迹后查看位移分析
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="card">
        <h2>插值方式(Worker 计算)</h2>
        <div className="row">
          <div className="segmented">
            <button className={interpMode === 'linear' ? 'active' : ''} onClick={() => setInterpMode('linear')}>
              线性插值
            </button>
            <button className={interpMode === 'smooth' ? 'active' : ''} onClick={() => setInterpMode('smooth')}>
              平滑插值(Catmull-Rom)
            </button>
          </div>
          <span className="muted">
            切换后由 Web Worker 重新计算后续帧;平滑模式在四个相邻关键帧间做三次样条插值,端点自动钳制。
          </span>
        </div>
      </div>

      <div className="card">
        <h2>位移统计</h2>
        <div className="stat-grid">
          <div className="stat">
            <div className="label">最大累计位移</div>
            <div className="value">{maxDisplacement.toFixed(2)} Å</div>
          </div>
          <div className="stat">
            <div className="label">平均累计位移</div>
            <div className="value">{average(cumulative).toFixed(2)} Å</div>
          </div>
          <div className="stat">
            <div className="label">位移中位数</div>
            <div className="value">{median(cumulative).toFixed(2)} Å</div>
          </div>
          <div className="stat">
            <div className="label">着色模式联动</div>
            <div className="row" style={{ marginTop: 6 }}>
              <button
                className={`btn small ${colorMode === 'displacement' ? 'primary' : ''}`}
                onClick={() => setColorMode('displacement')}
              >
                按位移着色
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>累计位移 Top 10 原子</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          这 10 个原子在 3D 视口中以 troika-three-text 文字标注残基名(可在播放页开关),随原子运动实时跟随。
        </p>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>原子序号</th>
              <th>元素</th>
              <th>残基</th>
              <th>原子名</th>
              <th>累计位移 (Å)</th>
              <th>相对位移</th>
            </tr>
          </thead>
          <tbody>
            {top10.map((row) => (
              <tr key={row.id}>
                <td>{row.rank}</td>
                <td>{row.id + 1}</td>
                <td>{row.atom.element}</td>
                <td>
                  {row.atom.residue ?? row.atom.element}
                  {row.atom.residueId != null ? ` ${row.atom.residueId}` : ''}
                </td>
                <td>{row.atom.atomName ?? '-'}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{row.displacement.toFixed(3)}</td>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <div style={{ width: 120, height: 8, background: 'var(--panel-2)', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${(row.normalized * 100).toFixed(1)}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, #214df2, #1abff2, #33d94d, #fad926, #f2332e)',
                        }}
                      />
                    </div>
                    <span className="muted">{(row.normalized * 100).toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function average(arr: Float32Array): number {
  let sum = 0
  for (let i = 0; i < arr.length; i++) sum += arr[i]
  return sum / arr.length
}

function median(arr: Float32Array): number {
  const sorted = Float32Array.from(arr).sort()
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
