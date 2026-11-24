import { useStudio } from '../state/store';
import type { MaterialPresetId } from '../core/types';

const SWATCHES = ['#c96f52', '#e9e6df', '#4c6f8f', '#3b3f45', '#8fae86', '#c8b06a', '#b4738a', '#6b7078'];

export function MaterialPanel() {
  const material = useStudio((s) => s.material);
  const setMaterial = useStudio((s) => s.setMaterial);
  const setPreset = useStudio((s) => s.setMaterialPreset);

  return (
    <>
      <div className="section">
        <div className="section-title">材质预览</div>
        <div className="seg">
          {(
            [
              ['clay', '陶土'],
              ['porcelain', '素瓷'],
              ['resin', '树脂'],
              ['graphite', '石墨'],
            ] as [MaterialPresetId, string][]
          ).map(([id, label]) => (
            <button key={id} className={material.preset === id ? 'active' : ''} onClick={() => setPreset(id)}>
              {label}
            </button>
          ))}
        </div>

        <div className="field-label" style={{ marginTop: 14 }}>
          <span>颜色</span>
          <span className="val">{material.color.toUpperCase()}</span>
        </div>
        <div className="swatch-row">
          {SWATCHES.map((c) => (
            <button
              key={c}
              className={`swatch ${material.color.toLowerCase() === c ? 'active' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => setMaterial({ color: c })}
            />
          ))}
        </div>

        <SliderRow
          label="粗糙度"
          value={material.roughness}
          onChange={(v) => setMaterial({ roughness: v })}
        />
        <SliderRow
          label="高光清漆"
          value={material.clearcoat}
          onChange={(v) => setMaterial({ clearcoat: v, clearcoatRoughness: Math.max(0.08, 0.45 - v * 0.3) })}
        />
        <SliderRow
          label="环境反射"
          value={material.envIntensity}
          min={0.2}
          max={2}
          onChange={(v) => setMaterial({ envIntensity: v })}
        />
        {material.preset === 'graphite' && (
          <SliderRow label="金属度" value={material.metalness} onChange={(v) => setMaterial({ metalness: v })} />
        )}
      </div>
    </>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="field-label" style={{ margin: '0 0 2px' }}>
        <span>{label}</span>
        <span className="val">{value.toFixed(2)}</span>
      </div>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}
