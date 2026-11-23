// 模块一:房间加载
import { setState, state } from '../store';

export default function RoomPanel(props: { onLoadCloud: (url: string) => void }) {
  const num = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <section class="panel">
      <h2>① 房间加载</h2>
      <div class="row">
        <label>面宽(东西)</label>
        <input
          type="number"
          min="2"
          max="20"
          step="0.1"
          value={state.room.width}
          onInput={(e) => setState('room', 'width', num(e.currentTarget.value, 6))}
        />
        <span class="unit">m</span>
      </div>
      <div class="row">
        <label>进深(南北)</label>
        <input
          type="number"
          min="2"
          max="20"
          step="0.1"
          value={state.room.depth}
          onInput={(e) => setState('room', 'depth', num(e.currentTarget.value, 5))}
        />
        <span class="unit">m</span>
      </div>
      <div class="row">
        <label>层高</label>
        <input
          type="number"
          min="2"
          max="6"
          step="0.05"
          value={state.room.height}
          onInput={(e) => setState('room', 'height', num(e.currentTarget.value, 2.8))}
        />
        <span class="unit">m</span>
      </div>
      <div class="row">
        <label>点云地址</label>
        <input
          type="text"
          class="grow"
          placeholder="potree cloud.js 地址(可选)"
          value={state.room.pointCloudUrl}
          onInput={(e) => setState('room', 'pointCloudUrl', e.currentTarget.value)}
        />
      </div>
      <div class="row">
        <button onClick={() => props.onLoadCloud(state.room.pointCloudUrl)}>加载点云</button>
        <span class="hint">{state.pointCloudStatus}</span>
      </div>
    </section>
  );
}
