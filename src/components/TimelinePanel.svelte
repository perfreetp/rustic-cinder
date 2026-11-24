<script lang="ts">
  import { studio } from "../state/state.svelte";

  const table = $derived(studio.bake());
  const frameInt = $derived(Math.min(Math.round(studio.currentFrame), table.frameCount - 1));

  const jump = (f: number) => {
    studio.playing = false;
    studio.currentFrame = Math.max(0, Math.min(f, table.frameCount - 1));
  };

  const step = (d: number) => jump(frameInt + d);
</script>

<div class="panel">
  <h3>播放控制</h3>
  <div class="row" style="flex-wrap: wrap">
    <button class="primary" onclick={() => (studio.playing = !studio.playing)}>
      {studio.playing ? "⏸ 暂停" : "▶ 播放"}
    </button>
    <button onclick={() => step(-1)}>◀ 单帧</button>
    <button onclick={() => step(1)}>单帧 ▶</button>
    <button onclick={() => jump(0)}>⏮ 起点</button>
    <button onclick={() => jump(table.frameCount - 1)}>终点 ⏭</button>
  </div>
  <div class="row" style="margin-top: 10px">
    <label style="margin: 0; white-space: nowrap">播放帧率</label>
    <input type="number" min="1" max="120" value={studio.fps}
      onchange={(e) => (studio.fps = Math.max(1, +e.currentTarget.value || 30))} />
    <span class="muted">fps</span>
  </div>
</div>

<div class="panel" style="margin-top: 12px">
  <h3>当前帧插入关键点</h3>
  <p class="muted" style="font-size: 11px; margin: 0 0 8px">
    播放头可停在任意帧;插入后系统以该点为新控制点,让前后帧重新插值。
  </p>
  <div class="row">
    <button class="primary" onclick={() => studio.insertTrajectoryKeyAtCurrent()}>
      插入轨迹关键点
    </button>
    <button class="primary" onclick={() => studio.insertPoseKeyAtFrame(frameInt)}>
      插入姿态关键帧
    </button>
  </div>
</div>

<div class="panel" style="margin-top: 12px">
  <h3>关键帧导航</h3>
  <div class="scroll" style="max-height: 260px">
    <p class="muted" style="font-size: 11px; margin: 4px 0">轨迹关键点</p>
    {#each studio.trajectoryKeys as k (k.frame)}
      <div class="krow">
        <button class="link" onclick={() => jump(k.frame)}>第 {k.frame} 帧</button>
        <span class="muted">高 {k.height.toFixed(1)}m · 位移 {k.distance.toFixed(1)}m</span>
      </div>
    {/each}
    <p class="muted" style="font-size: 11px; margin: 10px 0 4px">姿态关键帧</p>
    {#each studio.poseKeys as k (k.frame)}
      <div class="krow">
        <button class="link" onclick={() => jump(k.frame)}>第 {k.frame} 帧</button>
        <span class="muted">收腿 {k.tuck.toFixed(2)}</span>
      </div>
    {/each}
    {#if studio.poseKeys.length === 0}
      <p class="muted" style="font-size: 11px; margin: 2px 0">无</p>
    {/if}
  </div>
</div>

<div class="panel" style="margin-top: 12px">
  <h3>逐帧数据</h3>
  <div class="grid2 muted" style="font-size: 11px; line-height: 1.9">
    <span>位置 X(位移)</span><b>{table.pos[frameInt * 3].toFixed(2)} m</b>
    <span>位置 Y(高度)</span><b>{table.pos[frameInt * 3 + 1].toFixed(2)} m</b>
    <span>位置 Z(侧向)</span><b>{table.pos[frameInt * 3 + 2].toFixed(2)} m</b>
    <span>伞翼朝向</span><b>{((table.heading[frameInt] * 180) / Math.PI).toFixed(1)}°</b>
    <span>收腿系数</span><b>{table.tuck[frameInt].toFixed(2)}</b>
  </div>
</div>

<style>
  .krow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 4px;
    font-size: 11px;
  }
  .link {
    background: none;
    border: none;
    color: var(--accent);
    padding: 2px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 10px;
  }
  .grid2 b {
    color: var(--text);
  }
</style>
