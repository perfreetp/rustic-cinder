// 模块四:采光标记
import { For } from 'solid-js';
import { currentCity, setState, state } from '../store';
import { exportDaylightFile, parseDaylightFile } from '../persistence';
import { CITIES } from '../cities';
import { formatTime } from '../utils';

export default function MarkPanel() {
  function doExport() {
    exportDaylightFile({
      room: { ...state.room },
      windows: state.windows.map((w) => ({ ...w })),
      city: currentCity(),
      date: state.date,
      threshold: state.threshold,
      marks: state.marks.map((m) => ({ ...m })),
    });
  }

  function doImport(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        const data = parseDaylightFile(text);
        const cityIdx = CITIES.findIndex((c) => c.name === data.city?.name);
        setState({
          room: { ...data.room },
          windows: data.windows ?? [],
          marks: data.marks ?? [],
          threshold: data.threshold ?? 300,
          date: data.date ?? state.date,
          cityIndex: cityIdx >= 0 ? cityIdx : state.cityIndex,
        });
      } catch (err) {
        alert(err instanceof Error ? err.message : '导入失败');
      }
      input.value = '';
    });
  }

  return (
    <section class="panel">
      <h2>④ 采光标记</h2>
      <div class="row">
        <label>不足阈值</label>
        <input
          type="number"
          min="0"
          max="2000"
          step="50"
          value={state.threshold}
          onInput={(e) => {
            const n = parseFloat(e.currentTarget.value);
            if (Number.isFinite(n)) setState('threshold', n);
          }}
        />
        <span class="unit">lx</span>
      </div>
      <div class="row">
        <button
          classList={{ primary: state.markMode }}
          onClick={() => setState('markMode', !state.markMode)}
        >
          {state.markMode ? '✓ 框选中…(点击退出)' : '▢ 框选标记'}
        </button>
        <button onClick={() => setState('marks', [])} disabled={state.marks.length === 0}>
          清空
        </button>
      </div>
      <div class="mark-list">
        <For each={state.marks} fallback={<div class="hint">暂无标记,点击「框选标记」后在地面拖拽绘制</div>}>
          {(m) => (
            <div class="mark-item" classList={{ deficient: m.deficient }}>
              <div class="mark-main">
                <strong>{m.name}</strong>
                <span class="lux">{Math.round(m.lux)} lx</span>
                <span class="badge">{m.deficient ? '采光不足' : '达标'}</span>
              </div>
              <div class="mark-sub">
                {m.city} {m.date} {formatTime(m.time)} · {m.w.toFixed(1)}×{m.d.toFixed(1)}m
              </div>
              <button
                class="del"
                title="删除"
                onClick={() => setState('marks', (ms) => ms.filter((x) => x.id !== m.id))}
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
      <div class="row">
        <button onClick={doExport} disabled={state.marks.length === 0}>
          ⬇ 导出采光记录
        </button>
        <label class="import-btn">
          ⬆ 导入
          <input type="file" accept=".json,application/json" style="display:none" onChange={doImport} />
        </label>
      </div>
    </section>
  );
}
