import type { EngineStats } from '../core/engine';
import type { PrecisionId } from '../core/types';
import { useStudio } from '../state/store';

const PRECISION: { id: PrecisionId; label: string; note: string }[] = [
  { id: 'draft', label: '草稿', note: '~51³ 栅格' },
  { id: 'standard', label: '标准', note: '~73³ 栅格' },
  { id: 'fine', label: '精细', note: '~101³ 栅格' },
];

export function TopologyPanel({ stats }: { stats: EngineStats | null }) {
  const precision = useStudio((s) => s.precision);
  const setPrecision = useStudio((s) => s.setPrecision);
  const busy = useStudio((s) => s.busy);

  const bb = stats?.bbox;
  const size = bb ? [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]] : null;

  return (
    <div className="stats-card">
      <div className="row">
        <span className="k">三角面数</span>
        <span className="v">{stats ? stats.triangles.toLocaleString('en-US') : '—'}</span>
      </div>
      <div className="row">
        <span className="k">顶点数</span>
        <span className="v">{stats ? stats.vertices.toLocaleString('en-US') : '—'}</span>
      </div>
      <div className="sep" />
      <div className="row">
        <span className="k">包围盒</span>
        <span className="v">
          {size
            ? `${size[0].toFixed(2)} × ${size[1].toFixed(2)} × ${size[2].toFixed(2)}`
            : '—'}
        </span>
      </div>
      <div className="row">
        <span className="k">体积</span>
        <span className="v">{stats ? stats.volume.toFixed(3) : '—'}</span>
      </div>
      <div className="row">
        <span className="k">闭合性</span>
        <span className="v" style={{ color: 'var(--good)' }}>
          {stats?.watertight ? '水密' : '—'}
        </span>
      </div>
      <div className="sep" />
      <div className="row">
        <span className="k">重建精度</span>
        <span className="v">{stats ? `单元 ${stats.cellSize.toFixed(3)}` : '—'}</span>
      </div>
      <div className="seg" style={{ marginTop: 7 }}>
        {PRECISION.map((p) => (
          <button
            key={p.id}
            className={precision === p.id ? 'active' : ''}
            onClick={() => setPrecision(p.id)}
            disabled={busy && precision === p.id}
            title={p.note}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8, paddingBottom: 0 }}>
        <span className="k">
          {stats?.mode === 'local' ? (
            <span className="tag">
              <span className="dot" />
              局部重建
            </span>
          ) : (
            <span className="tag warn">
              <span className="dot" />
              全量重建
            </span>
          )}
        </span>
        <span className="v" style={{ color: 'var(--fg-faint)' }}>
          {stats ? `${stats.rebuildMs} ms` : ''}
        </span>
      </div>
    </div>
  );
}
