<script lang="ts">
  import { appState, type PageId } from './lib/appState.svelte';
  import EditPage from './pages/EditPage.svelte';
  import GeneratePage from './pages/GeneratePage.svelte';
  import ResultsPage from './pages/ResultsPage.svelte';

  const tabs: { id: PageId; label: string; index: number }[] = [
    { id: 'edit', label: '① 质量点编辑', index: 0 },
    { id: 'generate', label: '② 流线生成', index: 1 },
    { id: 'results', label: '③ 结果查看', index: 2 }
  ];

  const currentIndex = $derived(tabs.find((t) => t.id === appState.page)?.index ?? 0);
</script>

<div class="app-shell">
  <header class="topbar">
    <div class="brand">引力场<span>流线</span>可视化</div>
    <nav class="steps">
      {#each tabs as tab (tab.id)}
        <button
          class="step-tab"
          class:active={appState.page === tab.id}
          class:done={tab.index < currentIndex}
          onclick={() => (appState.page = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </nav>
    <div style="flex: 1"></div>
    <span class="hint">TypeScript · Svelte 5 · Babylon.js · Web Worker</span>
  </header>

  {#key appState.page}
    {#if appState.page === 'edit'}
      <EditPage />
    {:else if appState.page === 'generate'}
      <GeneratePage />
    {:else}
      <ResultsPage />
    {/if}
  {/key}
</div>
