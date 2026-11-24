<script setup lang="ts">
import { onMounted } from 'vue';
import TopBar from './components/TopBar.vue';
import PartTreePanel from './components/PartTreePanel.vue';
import Viewer3D from './components/Viewer3D.vue';
import TimelinePanel from './components/TimelinePanel.vue';
import RightPanels from './components/RightPanels.vue';
import { useSessionStore } from './stores/session';

const session = useSessionStore();

onMounted(() => {
  session.refreshProjectList();
});
</script>

<template>
  <div class="app-shell">
    <TopBar />
    <div class="workspace">
      <aside class="left-pane">
        <PartTreePanel />
      </aside>
      <main class="center-pane">
        <Viewer3D />
        <TimelinePanel />
      </main>
      <aside class="right-pane">
        <RightPanels />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 290px minmax(0, 1fr) 330px;
  gap: 10px;
  padding: 10px;
}

.left-pane,
.right-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.center-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
