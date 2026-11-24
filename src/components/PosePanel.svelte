<script lang="ts">
  import { studio } from "../state/state.svelte";
  import type { PoseKey } from "../lib/types";

  let selectedFrame = $state<number | null>(null);

  const table = $derived(studio.bake());
  const frameInt = $derived(Math.min(Math.round(studio.currentFrame), table.frameCount - 1));
  const selected = $derived(studio.poseKeys.find((k) => k.frame === selectedFrame) ?? null);

  function insertKey() {
    const key = studio.insertPoseKeyAtFrame(frameInt);
    selectedFrame = key.frame;
  }

  function selectKey(k: PoseKey) {
    selectedFrame = k.frame;
    studio.currentFrame = k.frame;
  }

  function patch(field: keyof PoseKey, v: number) {
    if (selectedFrame === null) return;
    studio.updatePoseKey(selectedFrame, { [field]: v } as Partial<PoseKey>);
  }

  const deg = (r: number) => +((r * 180) / Math.PI).toFixed(1);
  const rad = (d: number) => (d * Math.PI) / 180;
</script>

<div class="panel">
  <h3>当前帧姿态(第 {frameInt} 帧)</h3>
  <div class="grid2">
    <div><label>收腿系数</label><b>{table.tuck[frameInt].toFixed(2)}</b></div>
    <div><label>躯干俯仰</label><b>{deg(table.torsoPitch[frameInt])}°</b></div>
    <div><label>躯干滚转</label><b>{deg(table.torsoRoll[frameInt])}°</b></div>
    <div><label>展臂系数</label><b>{table.armSpread[frameInt].toFixed(2)}</b></div>
    <div><label>前伸量</label><b>{table.armReach[frameInt].toFixed(2)} m</b></div>
  </div>
  <button class="primary" style="width: 100%; margin-top: 10px" onclick={insertKey}>
    在第 {frameInt} 帧插入姿态关键帧
  </button>
  <p class="muted" style="font-size: 11px; margin: 8px 0 0">
    插入后前后帧自动重新插值;无关键帧时使用基于腾空阶段的自动姿态(顶点收腿、两端伸展)。
  </p>
</div>

{#if selected}
  <div class="panel" style="margin-top: 12px">
    <h3>编辑关键帧 · 第 {selected.frame} 帧</h3>

    <label>收腿系数(0 伸展 → 1 团身):{selected.tuck.toFixed(2)}</label>
    <input type="range" min="0" max="1" step="0.01" value={selected.tuck}
      oninput={(e) => patch("tuck", +e.currentTarget.value)} />

    <label style="margin-top: 8px">躯干俯仰(°):{deg(selected.torsoPitch)}</label>
    <input type="range" min="-60" max="60" step="1" value={deg(selected.torsoPitch)}
      oninput={(e) => patch("torsoPitch", rad(+e.currentTarget.value))} />

    <label style="margin-top: 8px">躯干滚转(°):{deg(selected.torsoRoll)}</label>
    <input type="range" min="-45" max="45" step="1" value={deg(selected.torsoRoll)}
      oninput={(e) => patch("torsoRoll", rad(+e.currentTarget.value))} />

    <label style="margin-top: 8px">展臂系数:{selected.armSpread.toFixed(2)}</label>
    <input type="range" min="0.6" max="1.5" step="0.01" value={selected.armSpread}
      oninput={(e) => patch("armSpread", +e.currentTarget.value)} />

    <label style="margin-top: 8px">手臂前伸(m):{selected.armReach.toFixed(2)}</label>
    <input type="range" min="0.2" max="0.7" step="0.01" value={selected.armReach}
      oninput={(e) => patch("armReach", +e.currentTarget.value)} />

    <button class="danger" style="width: 100%; margin-top: 10px"
      onclick={() => { studio.deletePoseKey(selected.frame); selectedFrame = null; }}>
      删除该姿态关键帧
    </button>
  </div>
{/if}

<div class="panel" style="margin-top: 12px">
  <h3>姿态关键帧({studio.poseKeys.length})</h3>
  <div class="scroll" style="max-height: 180px">
    {#each studio.poseKeys as k (k.frame)}
      <div class="key-row" class:active={k.frame === selectedFrame}>
        <button class="link" onclick={() => selectKey(k)}>第 {k.frame} 帧</button>
        <span class="muted">收腿 {k.tuck.toFixed(2)} · 俯 {deg(k.torsoPitch)}°</span>
      </div>
    {/each}
    {#if studio.poseKeys.length === 0}
      <p class="muted" style="font-size: 11px; margin: 4px 0">尚无姿态关键帧,人体按自动姿态运动。</p>
    {/if}
  </div>
</div>

<div class="panel" style="margin-top: 12px">
  <h3>约束说明</h3>
  <ul class="muted" style="font-size: 11px; margin: 0; padding-left: 16px; line-height: 1.7">
    <li>躯干偏航跟随伞翼朝向转向</li>
    <li>双手由两轴 IK 约束到控制杆端点</li>
    <li>四根伞绳从手部连至伞翼两角并逐帧拉伸</li>
    <li>腿部按收腿系数做髋/膝弯曲,0 为完全伸展</li>
  </ul>
</div>

<style>
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .grid2 b {
    font-size: 13px;
  }
  .key-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 6px;
    border-radius: 6px;
    font-size: 11px;
  }
  .key-row.active {
    background: var(--panel-2);
    outline: 1px solid var(--accent);
  }
  .link {
    background: none;
    border: none;
    color: var(--accent);
    padding: 2px 4px;
  }
</style>
