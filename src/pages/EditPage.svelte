<script lang="ts">
  import { appState, clearMasses, loadPreset, removeMass, updateMass } from '../lib/appState.svelte';
  import MassEditor from '../components/MassEditor.svelte';
  import { MAX_MASSES } from '../lib/types';

  let selectedId = $state<number | null>(null);
  const selected = $derived(appState.masses.find((m) => m.id === selectedId) ?? null);

  const removeSelected = () => {
    if (selectedId === null) return;
    removeMass(selectedId);
    selectedId = null;
  };
</script>

<div class="page">
  <aside class="sidebar">
    <div class="card">
      <h3>质量点</h3>
      <p class="hint">
        平面范围 ±10，最多 {MAX_MASSES} 个质量点。质量影响引力加速度
        <b>a = G·m/r²</b>（含软化项，奇点处有限）。
      </p>
      <div class="row" style="margin-top: 10px">
        <button
          class="ghost"
          onclick={() => {
            clearMasses();
            selectedId = null;
          }}
          disabled={appState.masses.length === 0}
        >
          清空全部
        </button>
      </div>
    </div>

    <div class="card">
      <h3>预设场景</h3>
      <div class="seg-group" style="flex-wrap: wrap">
        <button onclick={() => loadPreset('single')}>单质量</button>
        <button onclick={() => loadPreset('binary')}>双质量</button>
        <button onclick={() => loadPreset('triple')}>三质量</button>
        <button onclick={() => loadPreset('ring')}>六质量环</button>
      </div>
    </div>

    {#if selected}
      <div class="card" style="border-color: var(--accent)">
        <h3>编辑质量点 #{selected.id}</h3>
        <div class="field">
          <label for="mass-value">质量 m（1 – 500）</label>
          <input
            id="mass-value"
            type="number"
            min="1"
            max="500"
            step="1"
            value={selected.mass}
            oninput={(e) =>
              updateMass(selected!.id, {
                mass: Math.max(1, Math.min(500, parseFloat((e.currentTarget as HTMLInputElement).value) || 1))
              })}
          />
          <input
            type="range"
            min="1"
            max="500"
            step="1"
            value={selected.mass}
            oninput={(e) =>
              updateMass(selected!.id, {
                mass: parseFloat((e.currentTarget as HTMLInputElement).value)
              })}
            style="margin-top: 6px"
          />
        </div>
        <div class="field">
          <label for="mass-x">x 坐标</label>
          <input
            id="mass-x"
            type="number"
            min="-10"
            max="10"
            step="0.1"
            value={selected.x}
            oninput={(e) =>
              updateMass(selected!.id, {
                x: parseFloat((e.currentTarget as HTMLInputElement).value) || 0
              })}
          />
        </div>
        <div class="field">
          <label for="mass-z">z 坐标</label>
          <input
            id="mass-z"
            type="number"
            min="-10"
            max="10"
            step="0.1"
            value={selected.z}
            oninput={(e) =>
              updateMass(selected!.id, {
                z: parseFloat((e.currentTarget as HTMLInputElement).value) || 0
              })}
          />
        </div>
        <button class="ghost" style="margin-top: 10px; width: 100%; color: var(--danger)" onclick={removeSelected}>
          删除该质量点
        </button>
      </div>
    {/if}

    <div class="card" style="flex: 1">
      <h3>质量清单（{appState.masses.length}/{MAX_MASSES}）</h3>
      {#if appState.masses.length === 0}
        <p class="hint">尚未放置质量点，在右侧平面上点击空白处开始。</p>
      {:else}
        <div class="mass-list">
          {#each appState.masses as m (m.id)}
            <button
              class="mass-item"
              class:selected={m.id === selectedId}
              style="text-align: left; font: inherit"
              onclick={() => (selectedId = m.id)}
            >
              <span class="mass-dot"></span>
              <span>
                <span style="font-weight: 600">#{m.id} · m = {m.mass.toFixed(0)}</span>
                <span class="hint" style="display: block">x={m.x.toFixed(2)}, z={m.z.toFixed(2)}</span>
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <button
      class="primary"
      disabled={appState.masses.length === 0}
      onclick={() => (appState.page = 'generate')}
    >
      下一步：生成流线 →
    </button>
  </aside>

  <main class="stage">
    <MassEditor {selectedId} onSelect={(id) => (selectedId = id)} />
  </main>
</div>
