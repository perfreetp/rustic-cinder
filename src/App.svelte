<script lang="ts">
  import { studio } from "./state/state.svelte";
  import Viewport from "./components/Viewport.svelte";
  import TimelineBar from "./components/TimelineBar.svelte";
  import TrajectoryPanel from "./components/TrajectoryPanel.svelte";
  import PosePanel from "./components/PosePanel.svelte";
  import TimelinePanel from "./components/TimelinePanel.svelte";
  import CameraPanel from "./components/CameraPanel.svelte";

  const pages = [
    { id: "trajectory", name: "轨迹", icon: "〽" },
    { id: "pose", name: "姿态", icon: "🏃" },
    { id: "timeline", name: "时间轴", icon: "⏱" },
    { id: "camera", name: "机位", icon: "🎥" },
  ] as const;
</script>

<div class="app">
  <header>
    <div class="brand">🪁 风筝冲浪腾空姿态工作室</div>
    <nav>
      {#each pages as p (p.id)}
        <button class:on={studio.activePage === p.id} onclick={() => (studio.activePage = p.id)}>
          <span class="icon">{p.icon}</span>{p.name}
        </button>
      {/each}
    </nav>
    <div class="header-right">
      <button class="primary" onclick={() => studio.exportProjectFile()}>导出工程文件</button>
    </div>
  </header>

  <main>
    <section class="stage">
      <Viewport />
    </section>
    <aside class="sidebar scroll">
      {#if studio.activePage === "trajectory"}
        <TrajectoryPanel />
      {:else if studio.activePage === "pose"}
        <PosePanel />
      {:else if studio.activePage === "timeline"}
        <TimelinePanel />
      {:else}
        <CameraPanel />
      {/if}
    </aside>
  </main>

  <TimelineBar />

  <footer class="status">
    <span>{studio.status}</span>
    <span class="muted">TypeScript · Svelte 5 · Babylon.js {studio.activePage === "camera" ? "" : ""}</span>
  </footer>
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: 52px 1fr auto 26px;
    height: 100%;
  }
  header {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 0 14px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    font-weight: 700;
    font-size: 14px;
    white-space: nowrap;
  }
  nav {
    display: flex;
    gap: 6px;
    flex: 1;
  }
  nav button {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  nav button.on {
    border-color: var(--accent);
    background: rgba(56, 160, 232, 0.16);
    color: #9fd4ff;
  }
  .icon {
    font-size: 13px;
  }
  main {
    display: grid;
    grid-template-columns: 1fr 360px;
    min-height: 0;
  }
  .stage {
    min-width: 0;
    min-height: 0;
  }
  .sidebar {
    border-left: 1px solid var(--border);
    background: var(--bg);
    padding: 12px;
    min-height: 0;
  }
  .status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 12px;
    font-size: 11px;
    background: var(--panel);
    border-top: 1px solid var(--border);
    color: var(--text-dim);
  }
  @media (max-width: 900px) {
    main {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr auto;
    }
    .sidebar {
      border-left: none;
      border-top: 1px solid var(--border);
      max-height: 42vh;
    }
  }
</style>
