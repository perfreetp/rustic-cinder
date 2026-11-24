import type { ReactNode } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** 拖拽过程中的高频回调（直接写 store，不经过 React 提交） */
  onChange: (v: number) => void;
  hint?: string;
  accent?: string;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = '',
  onChange,
  hint,
  accent = '#4da3ff',
}: SliderProps): ReactNode {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-row">
      <div className="slider-head">
        <span className="slider-label">{label}</span>
        <span className="slider-value">
          {value.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          background: `linear-gradient(90deg, ${accent} ${pct}%, rgba(255,255,255,0.12) ${pct}%)`,
        }}
      />
      {hint && <div className="slider-hint">{hint}</div>}
    </div>
  );
}
