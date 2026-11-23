// 模块三:时段模拟
import { For } from 'solid-js';
import { setState, state } from '../store';
import { CITIES } from '../cities';

export default function TimePanel(props: {
  timeText: string;
  azimuth: number;
  elevation: number;
  compass: string;
  sunUp: boolean;
}) {
  return (
    <section class="panel">
      <h2>③ 时段模拟</h2>
      <div class="row">
        <label>城市</label>
        <select
          class="grow"
          value={state.cityIndex}
          onChange={(e) => setState('cityIndex', parseInt(e.currentTarget.value, 10))}
        >
          <For each={CITIES}>
            {(c, i) => (
              <option value={i()}>
                {c.name}({c.lat.toFixed(1)}°N)
              </option>
            )}
          </For>
        </select>
      </div>
      <div class="row">
        <label>日期</label>
        <input
          type="date"
          class="grow"
          value={state.date}
          onInput={(e) => setState('date', e.currentTarget.value)}
        />
      </div>
      <div class="row">
        <label>时刻</label>
        <input
          type="range"
          class="grow"
          min="6"
          max="18"
          step="0.0167"
          value={state.time}
          onInput={(e) => setState('time', parseFloat(e.currentTarget.value))}
        />
        <span class="unit time-text">{props.timeText}</span>
      </div>
      <div class="row">
        <button onClick={() => setState('playing', !state.playing)}>
          {state.playing ? '⏸ 暂停' : '▶ 播放全天'}
        </button>
        <span class="hint">
          {props.sunUp
            ? `太阳${props.compass}方 · 方位角 ${props.azimuth.toFixed(1)}° · 高度角 ${props.elevation.toFixed(1)}°`
            : '当前时刻太阳在地平线以下'}
        </span>
      </div>
    </section>
  );
}
