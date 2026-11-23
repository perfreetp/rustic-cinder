import { createEffect, createMemo, on, onCleanup, onMount, Show } from 'solid-js';
import { setState, state, currentCity, nextId } from './store';
import { sunPosition, directNormalIlluminance, diffuseIlluminance, sunDirection } from './solar';
import { DaylightScene } from './three/scene';
import { computeRegionLux, type MarkRect } from './three/marking';
import RoomPanel from './ui/RoomPanel';
import WindowPanel from './ui/WindowPanel';
import TimePanel from './ui/TimePanel';
import MarkPanel from './ui/MarkPanel';
import { formatTime } from './utils';

export default function App() {
  let container!: HTMLDivElement;
  let scene: DaylightScene | null = null;

  const city = () => currentCity();
  const sunPos = createMemo(() => {
    const c = city();
    const date = new Date(`${state.date}T12:00:00`);
    return sunPosition(c.lat, c.lon, c.tz, date, state.time);
  });
  const dni = createMemo(() => directNormalIlluminance(sunPos().elevation));
  const diffuse = createMemo(() => diffuseIlluminance(sunPos().elevation));

  const azimuthDeg = createMemo(() => (sunPos().azimuth * 180) / Math.PI);
  const elevationDeg = createMemo(() => (sunPos().elevation * 180) / Math.PI);
  const compass = createMemo(() => {
    const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    return dirs[Math.round(azimuthDeg() / 45) % 8];
  });

  onMount(() => {
    scene = new DaylightScene(container);
    scene.onMarkRect = onMarkRect;
    scene.setRoom(state.room, state.windows);
    scene.setSun(sunPos(), dni(), diffuse());
    scene.setMarks(state.marks);
    // 供调试/自动化测试访问
    (window as unknown as { __daylight: unknown }).__daylight = { scene };
  });
  onCleanup(() => scene?.dispose());

  // 联动①:太阳方位/高度 → 平行光与阴影贴图
  createEffect(() => {
    scene?.setSun(sunPos(), dni(), diffuse());
  });

  // 联动②:房间结构 / 窗户变化 → 重建房间与窗框(光斑在渲染循环内自动重算)
  createEffect(
    on(
      () => JSON.stringify([state.room.width, state.room.depth, state.room.height, state.windows]),
      () => scene?.setRoom(state.room, state.windows),
      { defer: true },
    ),
  );

  // 联动③:太阳/窗户/房间变化 → 重算所有采光标记照度
  createEffect(
    on(
      () => [state.time, state.cityIndex, state.date, JSON.stringify(state.windows), JSON.stringify([state.room.width, state.room.depth, state.room.height])],
      () => {
        if (!scene) return;
        const dir = scene.getSunDir();
        const furniture = scene.getFurniture();
        const pos = sunPos();
        state.marks.forEach((mark, i) => {
          const lux = computeRegionLux(mark, state.windows, state.room, pos, dir, furniture);
          setState('marks', i, 'lux', Math.round(lux));
          setState('marks', i, 'deficient', lux < state.threshold);
        });
      },
      { defer: true },
    ),
  );

  // 阈值变化 → 重判达标状态
  createEffect(
    on(
      () => state.threshold,
      (th) => {
        state.marks.forEach((mark, i) => setState('marks', i, 'deficient', mark.lux < th));
      },
      { defer: true },
    ),
  );

  // 联动④:标记数据 → 3D 可视化
  createEffect(
    on(
      () => JSON.stringify(state.marks),
      () => scene?.setMarks(state.marks),
      { defer: true },
    ),
  );

  // 框选模式开关
  createEffect(() => scene?.setMarkMode(state.markMode));

  // 时间自动播放
  createEffect(() => {
    if (!state.playing) return;
    const id = window.setInterval(() => {
      const next = state.time + 0.05;
      if (next >= 18) {
        setState('time', 18);
        setState('playing', false);
      } else {
        setState('time', Math.round(next * 100) / 100);
      }
    }, 100);
    onCleanup(() => window.clearInterval(id));
  });

  function onMarkRect(rect: MarkRect) {
    if (!scene) return;
    const lux = computeRegionLux(
      rect,
      state.windows,
      state.room,
      sunPos(),
      scene.getSunDir(),
      scene.getFurniture(),
    );
    const mark = {
      id: nextId('m'),
      name: `标记 ${state.marks.length + 1}`,
      ...rect,
      lux: Math.round(lux),
      time: state.time,
      date: state.date,
      city: city().name,
      deficient: lux < state.threshold,
    };
    setState('marks', (marks) => [...marks, mark]);
  }

  async function loadCloud(url: string) {
    if (!scene || !url.trim()) return;
    setState('pointCloudStatus', '点云加载中…');
    try {
      await scene.loadCloud(url);
      setState('pointCloudStatus', '点云加载完成');
    } catch (err) {
      setState('pointCloudStatus', `点云加载失败:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div class="app">
      <aside class="sidebar">
        <h1>住宅室内采光时段模拟</h1>
        <RoomPanel onLoadCloud={loadCloud} />
        <WindowPanel />
        <TimePanel
          timeText={formatTime(state.time)}
          azimuth={azimuthDeg()}
          elevation={elevationDeg()}
          compass={compass()}
          sunUp={sunPos().up}
        />
        <MarkPanel />
      </aside>
      <main class="viewport" ref={container}>
        <div class="hud">
          <span>{city().name}</span>
          <span>{state.date}</span>
          <span>{formatTime(state.time)}</span>
          <Show when={sunPos().up} fallback={<span class="dim">太阳已落山</span>}>
            <span>
              方位 {compass()} {azimuthDeg().toFixed(1)}° · 高度角 {elevationDeg().toFixed(1)}°
            </span>
          </Show>
        </div>
        <Show when={state.markMode}>
          <div class="mark-hint">框选模式:在地面拖拽绘制采光标记区域,再次点击「框选标记」退出</div>
        </Show>
      </main>
    </div>
  );
}
