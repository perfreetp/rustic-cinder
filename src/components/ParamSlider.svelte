<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit?: string;
    decimals?: number;
    onInput: (v: number) => void;
  }

  let { label, value, min, max, step, unit = '', decimals = 2, onInput }: Props = $props();
</script>

<div class="field">
  <div class="row" style="justify-content: space-between">
    <label for="slider-{label}">{label}</label>
    <span class="value-pill">{value.toFixed(decimals)}{unit}</span>
  </div>
  <input
    id="slider-{label}"
    type="range"
    {min}
    {max}
    {step}
    {value}
    oninput={(e) => onInput(parseFloat((e.currentTarget as HTMLInputElement).value))}
  />
</div>
