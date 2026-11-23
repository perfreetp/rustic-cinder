<script lang="ts">
  import { appState } from '../lib/appState.svelte';
  import FieldCanvas from '../components/FieldCanvas.svelte';
  import type { FieldScene, LinePickResult, ProbeResult } from '../lib/fieldScene';
  import {
    buildExportPayload,
    buildPathPayload,
    downloadDataUrl,
    downloadJson,
    estimatePayloadBytes,
    formatBytes
  } from '../lib/exporters';

  let scene = $state<FieldScene | null>(null);
  let probe = $state<ProbeResult | null>(null);
  let busy = $state(false);
  let exportMsg = $state('');

  const path = $derived.by(() => {
    if (appState.highlightedLine < 0 || !scene) return [];
    return scene.getLinePath(appState.highlightedLine);
  });

  const pickLine = (r: LinePickResult) => {
    appState.highlightedLine = r.lineIndex;
  };

  const selectLine = (i: number) => {
    appState.highlightedLine = i;
  };

  const exportAll = () => {
    const result = appState.result;
    if (!result) return;
    const payload = buildExportPayload(result, appState.masses, appState.params);
    downloadJson(payload, `streamlines-${result.lineCount}lines.json`);
    exportMsg = `已导出 ${result.lineCount} 条流线 / ${result.pointCount} 个顶点`;
  };

  const exportPath = () => {
    if (appState.highlightedLine < 0 || !scene) return;
    const payload = buildPathPayload(appState.highlightedLine, path, appState.masses);
    downloadJson(payload, `streamline-${appState.highlightedLine}-path.json`);
    exportMsg = `已导出流线 #${appState.highlightedLine} 的 ${path.length} 个路径点`;
  };

  const exportImage = async () => {
    if (!scene) return;
    busy = true;
    try {
      const url = await scene.screenshot();
      downloadDataUrl(url, `gravity-field-${Date.now()}.png`);
      exportMsg = '当前画面已导出为 PNG';
    } finally {
      busy = false;
    }
  };

  const estimatedSize = $derived(
    appState.result ? formatBytes(estimatePayloadBytes(appState.result)) : '0 B'
  );

  const lineChoices = $derived(
    appState.result
      ? Array.from({ length: appState.result.lineCount }, (_, i) => i)
      : []
  );
</script>

<div class="page">
  <aside class="sidebar">
    <div class="card">
      <h3>流线高亮</h3>
      {#if appState.result === null}
        <p class="hint">还没有流线数据，请先到生成页计算。</p>
      {:else}
        <p class="hint">在右侧画面点击任意流线，或从下方选择编号，查看其 RK4 积分路径点序列。</p>
        <div class="field">
          <label for="line-select">流线编号（共 {appState.result.lineCount} 条）</label>
          <select
            id="line-select"
            value={appState.highlightedLine}
            onchange={(e) => selectLine(parseInt((e.currentTarget as HTMLSelectElement).value, 10))}
          >
            <option value={-1}>— 未选择 —</option>
            {#each lineChoices as i (i)}
              <option value={i}>流线 #{i}</option>
            {/each}
          </select>
        </div>
        <div class="row" style="margin-top: 10px">
          <button
            class="ghost"
            disabled={appState.highlightedLine < 0}
            onclick={() => (appState.highlightedLine = -1)}
          >
            清除高亮
          </button>
        </div>
      {/if}
    </div>

    {#if path.length > 0}
      <div class="card">
        <h3>积分路径点（{path.length}）</h3>
        <div class="path-table">
          <table>
            <thead>
              <tr>
                <th>n</th>
                <th>x</th>
                <th>z</th>
                <th>|a|</th>
              </tr>
            </thead>
            <tbody>
              {#each path as p, i (i)}
                <tr>
                  <td>{i}</td>
                  <td>{p.x.toFixed(4)}</td>
                  <td>{p.z.toFixed(4)}</td>
                  <td>{p.magnitude.toExponential(3)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <button class="ghost" style="margin-top: 8px; width: 100%" onclick={exportPath}>
          导出该路径点序列 JSON
        </button>
      </div>
    {/if}

    <div class="card">
      <h3>显示模式</h3>
      <div class="seg-group">
        <button class={!appState.smoothMode ? 'active' : ''} onclick={() => (appState.smoothMode = false)}>
          原始折线
        </button>
        <button class={appState.smoothMode ? 'active' : ''} onclick={() => (appState.smoothMode = true)}>
          平滑曲线
        </button>
      </div>
    </div>

    <div class="card">
      <h3>数据导出</h3>
      <p class="hint">JSON 包含每条流线的全部顶点、场分量与场强，预估大小约 {estimatedSize}。</p>
      <button class="primary" style="width: 100%" onclick={exportAll} disabled={!appState.result}>
        导出流线顶点 JSON
      </button>
      <button style="width: 100%; margin-top: 8px" onclick={exportImage} disabled={busy || !appState.result}>
        导出当前画面 PNG
      </button>
      {#if exportMsg}
        <p class="hint" style="margin-top: 8px; color: var(--ok)">{exportMsg}</p>
      {/if}
    </div>

    <button class="ghost" onclick={() => (appState.page = 'generate')}>← 返回生成页</button>
  </aside>

  <main class="stage">
    {#if appState.result === null}
      <div style="position: absolute; inset: 0; display: grid; place-items: center">
        <div class="card" style="text-align: center">
          <p>暂无流线数据</p>
          <button class="primary" onclick={() => (appState.page = 'generate')}>前往生成页</button>
        </div>
      </div>
    {:else}
      <FieldCanvas
        enableProbe={true}
        onReady={(s) => (scene = s)}
        onProbe={(p) => (probe = p)}
        onLinePick={pickLine}
      />

      <div class="legend">
        场强 |a|（对数着色）· 锥体箭头标示场方向
        <div class="legend-bar"></div>
        <div class="legend-labels">
          <span>弱</span>
          <span>强</span>
        </div>
      </div>

      {#if probe}
        <div class="overlay probe">
          <h3 style="margin: 0 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase">
            场点数值
          </h3>
          <div>位置：x = <b>{probe.x.toFixed(3)}</b>，z = <b>{probe.z.toFixed(3)}</b></div>
          <div>场强 |a| = <b class="value-pill">{probe.magnitude.toExponential(3)}</b></div>
          <div>
            分量 aₓ = <b>{probe.ax.toExponential(3)}</b>，a_z = <b>{probe.az.toExponential(3)}</b>
          </div>
          <div>方向角 θ = <b>{(probe.angle * 180 / Math.PI).toFixed(2)}°</b></div>
        </div>
      {/if}

      <div class="overlay status">
        <span>流线 <b>{appState.stats.lineCount}</b></span>
        <span>顶点 <b>{appState.stats.pointCount.toLocaleString()}</b></span>
        {#if appState.highlightedLine >= 0}
          <span style="color: var(--accent-2)">已高亮 #<b>{appState.highlightedLine}</b></span>
        {/if}
      </div>
    {/if}
  </main>
</div>
