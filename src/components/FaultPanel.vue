<script setup lang="ts">
import { computed } from 'vue';
import { useModelStore } from '../stores/model';
import { useSessionStore } from '../stores/session';
import { FAULT_META } from '../constants';
import type { FaultType } from '../types';

const modelStore = useModelStore();
const session = useSessionStore();

const targetName = computed(() => {
  const p = modelStore.activePath;
  if (!p) return null;
  const node = modelStore.nodes.get(p);
  return node?.name ?? null;
});

const faultTypes: FaultType[] = ['jam', 'overheat', 'shaftBreak'];

function inject(type: FaultType): void {
  if (!modelStore.activePath) return;
  session.injectFault(type, modelStore.activePath);
}
</script>

<template>
  <div class="fault-panel">
    <div class="panel-header">故障注入</div>
    <div class="panel-body">
      <div class="target-box">
        <span class="muted">目标零件:</span>
        <span v-if="targetName" class="target-name" :title="modelStore.activePath ?? ''">
          {{ targetName }}
        </span>
        <span v-else class="muted">未选择(请在零件树或三维视图中拾取)</span>
      </div>

      <div class="inject-grid">
        <button
          v-for="t in faultTypes"
          :key="t"
          class="inject-btn"
          :class="t"
          :disabled="!modelStore.activePath"
          @click="inject(t)"
        >
          <span class="dot" :style="{ background: FAULT_META[t].cssColor }"></span>
          <span class="inject-label">{{ FAULT_META[t].label }}</span>
          <span class="inject-desc">{{ FAULT_META[t].desc }}</span>
        </button>
      </div>

      <div class="section-title">
        已注入故障({{ session.faults.length }})
        <button
          v-if="session.faults.length"
          class="ghost mini danger"
          @click="session.clearFaults()"
        >
          全部清除
        </button>
      </div>

      <div v-if="session.faults.length === 0" class="muted empty">
        暂无故障。注入后零件立即换色高亮,时间轴自动跳转故障帧。
      </div>

      <div v-else class="fault-list">
        <div v-for="f in session.faults" :key="f.id" class="fault-row">
          <span class="tag" :class="f.type">{{ FAULT_META[f.type].label }}</span>
          <div class="fault-meta">
            <div class="fault-part" :title="f.partPath">
              {{ modelStore.nodes.get(f.partPath)?.name ?? f.partPath }}
            </div>
            <div class="muted mono">@帧 {{ f.frame }}</div>
          </div>
          <div class="fault-actions">
            <button class="ghost mini" @click="session.setFrame(f.frame)">跳转</button>
            <button class="ghost mini danger" @click="session.removeFault(f.id)">清除</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.target-box {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.target-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inject-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inject-btn {
  display: grid;
  grid-template-columns: 12px 56px 1fr;
  align-items: center;
  gap: 8px;
  text-align: left;
  padding: 10px 12px;
}

.inject-btn .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.inject-label {
  font-weight: 700;
}

.inject-desc {
  color: var(--fg-2);
  font-size: 11px;
}

.inject-btn.jam {
  border-color: rgba(255, 138, 0, 0.5);
}
.inject-btn.overheat {
  border-color: rgba(255, 68, 68, 0.5);
}
.inject-btn.shaftBreak {
  border-color: rgba(141, 75, 255, 0.5);
}

.section-title {
  margin: 16px 0 8px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mini {
  padding: 2px 8px;
  font-size: 11px;
}

.empty {
  font-size: 12px;
  line-height: 1.7;
}

.fault-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fault-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 7px 9px;
}

.fault-meta {
  flex: 1;
  min-width: 0;
}

.fault-part {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fault-actions {
  display: flex;
  gap: 4px;
  flex: none;
}

.danger {
  color: var(--danger);
}
</style>
