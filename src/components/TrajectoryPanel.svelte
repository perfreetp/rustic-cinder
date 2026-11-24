<script lang="ts">
  import { studio } from "../state/state.svelte";
  import { stressTrajectory } from "../lib/sample";
  import type { TrajectoryKey } from "../lib/types";
  import { clamp } from "../lib/math";

  let fileInput: HTMLInputElement;
  let pasteText = $state("");
  let showPaste = $state(false);

  const BANDS = ["#268cf2", "#19ccc9", "#26d973", "#8cd933", "#f2c726", "#f2801f", "#eb4733", "#cc2673"];

  function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => studio.importText(text, file.name));
    input.value = "";
  }

  function applyPaste() {
    if (pasteText.trim()) studio.importText(pasteText, "粘贴数据");
  }

  function patch(k: TrajectoryKey, field: keyof TrajectoryKey, raw: string) {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    if (field === "kiteHeading") {
      studio.updateTrajectoryKey(k.frame, { kiteHeading: (v * Math.PI) / 180 });
    } else {
      studio.updateTrajectoryKey(k.frame, { [field]: v } as Partial<TrajectoryKey>);
    }
  }

  function loadStress() {
    studio.setTrajectory(stressTrajectory(1200));
    studio.status = "已载入 1200 帧压测轨迹,可拖动时间轴验证流畅度";
  }

  const deg = (r: number) => Math.round((r * 180) / Math.PI);
</script>

<div class="panel">
  <h3>数据导入</h3>
  <div class="row" style="flex-wrap: wrap">
    <button class="primary" onclick={() => fileInput.click()}>导入轨迹 / 工程文件</button>
    <button onclick={() => (showPaste = !showPaste)}>{showPaste ? "收起粘贴框" : "粘贴 JSON / CSV"}</button>
    <button onclick={() => studio.resetSample()}>内置示例</button>
    <button onclick={loadStress}>1200 帧压测</button>
  </div>
  <input
    bind:this={fileInput}
    type="file"
    accept=".json,.csv,application/json,text/csv"
    hidden
    onchange={onFile}
  />
  {#if showPaste}
    <textarea
      rows="6"
      placeholder={'[{"frame":0,"height":0,"distance":0,"lateral":0,"kiteHeading":0}, ...] 或 CSV: frame,height,distance,lateral,kiteHeading'}
      bind:value={pasteText}
      style="margin-top: 8px; font-family: monospace; font-size: 11px"
    ></textarea>
    <button class="primary" style="margin-top: 6px" onclick={applyPaste}>解析导入</button>
  {/if}
</div>

<div class="panel" style="margin-top: 12px">
  <h3>轨迹关键点({studio.trajectoryKeys.length})</h3>
  <p class="muted" style="margin: 0 0 8px; font-size: 11px">
    每点含高度、水平位移、侧向漂移与伞翼朝向(度);修改后相邻点自动重新插值。
  </p>
  <div class="table-wrap scroll">
    <table>
      <thead>
        <tr>
          <th>帧</th><th>高度 m</th><th>位移 m</th><th>侧向 m</th><th>朝向 °</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each studio.trajectoryKeys as k (k.frame)}
          <tr>
            <td>{k.frame}</td>
            <td><input type="number" step="0.1" value={k.height.toFixed(2)} onchange={(e) => patch(k, "height", e.currentTarget.value)} /></td>
            <td><input type="number" step="0.1" value={k.distance.toFixed(2)} onchange={(e) => patch(k, "distance", e.currentTarget.value)} /></td>
            <td><input type="number" step="0.1" value={k.lateral.toFixed(2)} onchange={(e) => patch(k, "lateral", e.currentTarget.value)} /></td>
            <td><input type="number" step="1" value={deg(k.kiteHeading)} onchange={(e) => patch(k, "kiteHeading", e.currentTarget.value)} /></td>
            <td>
              <button
                class="danger"
                disabled={studio.trajectoryKeys.length <= 2}
                onclick={() => studio.deleteTrajectoryKey(k.frame)}
              >删</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<div class="panel" style="margin-top: 12px">
  <h3>高度分段着色</h3>
  <div class="legend">
    {#each BANDS as c, i (c)}
      <div class="band">
        <span class="swatch" style="background: {c}"></span>
        <span class="muted">{Math.round((i / BANDS.length) * 100)}–{Math.round(((i + 1) / BANDS.length) * 100)}%</span>
      </div>
    {/each}
  </div>
  <p class="muted" style="margin: 8px 0 0; font-size: 11px">
    空间曲线按相对最大高度分为 8 个色带,蓝色为低空、品红为最高点。
  </p>
</div>

<style>
  .table-wrap {
    max-height: 320px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  th {
    text-align: left;
    color: var(--text-dim);
    font-weight: 500;
    padding: 4px 6px;
    position: sticky;
    top: 0;
    background: var(--panel);
  }
  td {
    padding: 3px 6px;
    border-top: 1px solid var(--border);
  }
  td input {
    width: 72px;
    padding: 3px 5px;
  }
  .legend {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .band {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }
  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    display: inline-block;
  }
</style>
