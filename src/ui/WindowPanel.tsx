// 模块二:窗户布置
import { For, Show } from 'solid-js';
import { nextId, setState, state } from '../store';
import type { WallSide, WindowConfig } from '../types';

const WALL_NAMES: Record<WallSide, string> = {
  south: '南墙',
  north: '北墙',
  east: '东墙',
  west: '西墙',
};

export default function WindowPanel() {
  const selected = () => state.windows.find((w) => w.id === state.selectedWindowId) ?? null;

  function addWindow() {
    const w: WindowConfig = {
      id: nextId('w'),
      wall: 'south',
      offset: 0,
      width: 1.5,
      height: 1.4,
      sill: 0.9,
      mullionsX: 1,
      mullionsY: 1,
      frameWidth: 0.05,
      softness: 0.35,
    };
    setState('windows', (ws) => [...ws, w]);
    setState('selectedWindowId', w.id);
  }

  function update<K extends keyof WindowConfig>(key: K, value: WindowConfig[K]) {
    const id = state.selectedWindowId;
    if (!id) return;
    setState('windows', (w) => w.id === id, key, value);
  }

  function removeSelected() {
    const id = state.selectedWindowId;
    if (!id) return;
    setState('windows', (ws) => ws.filter((w) => w.id !== id));
    setState('selectedWindowId', null);
  }

  const num = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <section class="panel">
      <h2>② 窗户布置</h2>
      <div class="row">
        <button onClick={addWindow}>+ 添加窗户</button>
        <Show when={selected()}>
          <button class="danger" onClick={removeSelected}>删除选中</button>
        </Show>
      </div>
      <div class="win-list">
        <For each={state.windows}>
          {(w, i) => (
            <button
              class="win-item"
              classList={{ active: w.id === state.selectedWindowId }}
              onClick={() => setState('selectedWindowId', w.id)}
            >
              窗{i() + 1} · {WALL_NAMES[w.wall]} · {w.width.toFixed(1)}×{w.height.toFixed(1)}m
            </button>
          )}
        </For>
      </div>
      <Show when={selected()}>
        {(w) => (
          <div class="win-editor">
            <div class="row">
              <label>所在墙(朝向)</label>
              <select
                value={w().wall}
                onChange={(e) => update('wall', e.currentTarget.value as WallSide)}
              >
                <For each={Object.entries(WALL_NAMES)}>
                  {([key, name]) => <option value={key}>{name}</option>}
                </For>
              </select>
            </div>
            <div class="row">
              <label>沿墙偏移</label>
              <input
                type="number"
                step="0.1"
                value={w().offset}
                onInput={(e) => update('offset', num(e.currentTarget.value, 0))}
              />
              <span class="unit">m</span>
            </div>
            <div class="row">
              <label>窗宽</label>
              <input
                type="number"
                min="0.3"
                max="6"
                step="0.1"
                value={w().width}
                onInput={(e) => update('width', num(e.currentTarget.value, 1.5))}
              />
              <span class="unit">m</span>
            </div>
            <div class="row">
              <label>窗高</label>
              <input
                type="number"
                min="0.3"
                max="3"
                step="0.1"
                value={w().height}
                onInput={(e) => update('height', num(e.currentTarget.value, 1.4))}
              />
              <span class="unit">m</span>
            </div>
            <div class="row">
              <label>窗台高</label>
              <input
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={w().sill}
                onInput={(e) => update('sill', num(e.currentTarget.value, 0.9))}
              />
              <span class="unit">m</span>
            </div>
            <div class="row">
              <label>竖梃 / 横梃</label>
              <input
                type="number"
                min="0"
                max="6"
                step="1"
                value={w().mullionsX}
                onInput={(e) => update('mullionsX', Math.round(num(e.currentTarget.value, 0)))}
              />
              <input
                type="number"
                min="0"
                max="6"
                step="1"
                value={w().mullionsY}
                onInput={(e) => update('mullionsY', Math.round(num(e.currentTarget.value, 0)))}
              />
            </div>
            <div class="row">
              <label>边框宽度</label>
              <input
                type="number"
                min="0.02"
                max="0.2"
                step="0.01"
                value={w().frameWidth}
                onInput={(e) => update('frameWidth', num(e.currentTarget.value, 0.05))}
              />
              <span class="unit">m</span>
            </div>
            <div class="row">
              <label>边缘柔和度</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                class="grow"
                value={w().softness}
                onInput={(e) => update('softness', num(e.currentTarget.value, 0.35))}
              />
              <span class="unit">{Math.round(w().softness * 100)}%</span>
            </div>
          </div>
        )}
      </Show>
    </section>
  );
}
