<script lang="ts">
  import { studio } from "../state/state.svelte";

  let track: HTMLDivElement;
  let dragging = false;

  const table = $derived(studio.bake());
  const maxFrame = $derived(Math.max(1, table.frameCount - 1));
  const pct = $derived((studio.currentFrame / maxFrame) * 100);

  function frameFromEvent(e: PointerEvent | MouseEvent): number {
    const rect = track.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return Math.round(t * maxFrame);
  }

  function down(e: PointerEvent) {
    dragging = true;
    studio.playing = false;
    studio.currentFrame = frameFromEvent(e);
    track.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    studio.currentFrame = frameFromEvent(e);
  }
  function up(e: PointerEvent) {
    dragging = false;
    track.releasePointerCapture(e.pointerId);
  }
</script>

<div class="bar">
  <button class="play" onclick={() => (studio.playing = !studio.playing)}>
    {studio.playing ? "⏸" : "▶"}
  </button>
  <span class="frame-label">{Math.round(studio.currentFrame)} / {maxFrame}</span>

  <div
    class="track"
    bind:this={track}
    role="slider"
    tabindex="0"
    aria-label="时间轴播放头"
    aria-valuemin="0"
    aria-valuemax={maxFrame}
    aria-valuenow={Math.round(studio.currentFrame)}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    <div class="fill" style="width: {pct}%"></div>

    {#each studio.trajectoryKeys as k (k.frame)}
      <span class="tick traj" style="left: {(k.frame / maxFrame) * 100}%" title="轨迹关键点 第{k.frame}帧"></span>
    {/each}
    {#each studio.poseKeys as k (k.frame)}
      <span class="tick pose" style="left: {(k.frame / maxFrame) * 100}%" title="姿态关键帧 第{k.frame}帧"></span>
    {/each}

    <div class="head" style="left: {pct}%">
      <div class="grip"></div>
    </div>
  </div>

  <span class="muted">{studio.fps} fps</span>
</div>

<style>
  .bar {
    height: 56px;
    background: var(--panel);
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 14px;
    flex-shrink: 0;
  }
  .play {
    width: 34px;
    height: 34px;
    padding: 0;
    border-radius: 50%;
    font-size: 13px;
  }
  .frame-label {
    font-variant-numeric: tabular-nums;
    min-width: 86px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .track {
    position: relative;
    flex: 1;
    height: 26px;
    background: #10161e;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    touch-action: none;
  }
  .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: rgba(56, 160, 232, 0.22);
    border-radius: 5px 0 0 5px;
    pointer-events: none;
  }
  .tick {
    position: absolute;
    top: 2px;
    width: 3px;
    height: 8px;
    border-radius: 2px;
    transform: translateX(-50%);
    pointer-events: none;
  }
  .tick.traj {
    background: var(--accent-2);
  }
  .tick.pose {
    background: var(--ok);
    height: 8px;
    top: auto;
    bottom: 2px;
  }
  .head {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 12px;
    transform: translateX(-50%);
    pointer-events: none;
  }
  .grip {
    width: 12px;
    height: 32px;
    border-radius: 4px;
    background: var(--accent);
    border: 1px solid #8fd0ff;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
  }
</style>
