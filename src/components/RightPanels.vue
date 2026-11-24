<script setup lang="ts">
import { ref } from 'vue';
import FaultPanel from './FaultPanel.vue';
import JointPanel from './JointPanel.vue';
import SectionPanel from './SectionPanel.vue';
import BatchStatusPanel from './BatchStatusPanel.vue';

const tab = ref<'fault' | 'joint' | 'section' | 'batch'>('fault');
const tabs = [
  { key: 'fault', label: '故障工况' },
  { key: 'joint', label: '关节行程' },
  { key: 'section', label: '剖切' },
  { key: 'batch', label: '批量状态' },
] as const;
</script>

<template>
  <div class="panel right-panel">
    <div class="tab-bar">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ active: tab === t.key }"
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="tab-content">
      <FaultPanel v-show="tab === 'fault'" />
      <JointPanel v-show="tab === 'joint'" />
      <SectionPanel v-show="tab === 'section'" />
      <BatchStatusPanel v-show="tab === 'batch'" />
    </div>
  </div>
</template>

<style scoped>
.right-panel {
  flex: 1;
}

.tab-bar {
  display: flex;
  flex: none;
  border-bottom: 1px solid var(--line);
}

.tab {
  flex: 1;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 11px 4px;
  color: var(--fg-1);
}

.tab.active {
  color: var(--fg-0);
  box-shadow: inset 0 -2px 0 var(--accent);
  background: var(--bg-2);
}

.tab-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tab-content > * {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
