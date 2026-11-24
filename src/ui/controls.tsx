import { Show, type JSX } from 'solid-js';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onInput: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
  disabled?: boolean;
}

/** 统一风格的参数滑块，带填充轨道与数值显示。 */
export function Slider(props: SliderProps): JSX.Element {
  const pct = () => {
    const span = props.max - props.min;
    if (span <= 0) return 0;
    return Math.min(100, Math.max(0, ((props.value - props.min) / span) * 100));
  };
  const text = () => (props.format ? props.format(props.value) : props.value.toFixed(2));

  return (
    <div class="field">
      <div class="field-head">
        <label class="field-label" for={`slider-${props.label}`}>
          {props.label}
        </label>
        <span class="field-value">{text()}</span>
      </div>
      <input
        id={`slider-${props.label}`}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        style={{ '--fill': `${pct()}%` }}
        aria-valuetext={text()}
        onInput={(e) => props.onInput(Number(e.currentTarget.value))}
      />
      <Show when={props.hint}>
        <div class="field-hint">{props.hint}</div>
      </Show>
    </div>
  );
}

export interface ToggleProps {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleRow(props: ToggleProps): JSX.Element {
  return (
    <div class="toggle-row">
      <div class="toggle-row-text">
        <b>{props.title}</b>
        <Show when={props.description}>
          <small>{props.description}</small>
        </Show>
      </div>
      <button
        class="toggle"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.title}
        data-on={String(props.checked)}
        onClick={() => props.onChange(!props.checked)}
        type="button"
      />
    </div>
  );
}

export interface SectionProps {
  index: string;
  title: string;
  note?: string;
  children: JSX.Element;
}

export function Section(props: SectionProps): JSX.Element {
  return (
    <section class="section">
      <div class="section-head">
        <div class="section-title">
          <span class="section-index">{props.index}</span>
          {props.title}
        </div>
        <Show when={props.note}>
          <span class="section-note">{props.note}</span>
        </Show>
      </div>
      {props.children}
    </section>
  );
}
