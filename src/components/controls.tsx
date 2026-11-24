import type { ReactNode } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
  onCommit?: () => void;
  hint?: string;
}

export function Slider({ label, value, min, max, step, unit, disabled, onChange, onCommit, hint }: SliderProps) {
  return (
    <label className={`field ${disabled ? 'field-disabled' : ''}`}>
      <span className="field-label">
        {label}
        {hint ? <em className="field-hint">{hint}</em> : null}
      </span>
      <span className="field-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
        />
        <span className="field-value">
          {value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}
          {unit ? <i>{unit}</i> : null}
        </span>
      </span>
    </label>
  );
}

interface NumberInputProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}

export function NumberInput({ label, value, min, max, step = 1, unit, onChange }: NumberInputProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-row">
        <input
          type="number"
          className="number-input"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
        />
        {unit ? <i className="unit">{unit}</i> : null}
      </span>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field field-toggle">
      <span className="field-label">{label}</span>
      <button
        type="button"
        className={`switch ${checked ? 'switch-on' : ''}`}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </label>
  );
}

export function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="panel-section">
      <header className="section-header">
        <h3>{title}</h3>
        {extra}
      </header>
      {children}
    </section>
  );
}

export function ActionButton({
  children,
  onClick,
  variant = 'default',
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`btn btn-${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
