<script setup lang="ts">
import { computed } from 'vue';
import { useModelStore } from '../stores/model';
import { STATUS_LABEL } from '../constants';
import type { PartStatus } from '../types';

const modelStore = useModelStore();

const selectedNodes = computed(() =>
  [...modelStore.selectedPaths]
    .map((p) => modelStore.nodes.get(p))
    .filter((n): n is NonNullable<typeof n> => !!n)
    .sort((a, b) => a.path.localeCompare(b.path)),
);

const leafCount = computed(() => modelStore.selectedLeafPaths().size);

const statuses: Array<{ value: PartStatus | 'inherit'; label: string }> = [
  { value: 'normal', label: '置为正常' },
  { value: 'jam', label: '卡料' },
  { value: 'overheat', label: '过热' },
  { value: 'shaftBreak', label: '断轴' },
  { value: 'inherit', label: '恢复继承' },
];

function apply(value: PartStatus | 'inherit'): void {
  modelStore.setStatus([...modelStore.selectedPaths], value);
}
</script>

<template>
  <div class="batch-panel">
    <div class="panel-header">批量状态 / 层级联动</div>
    <div class="panel-body">
      <div class="summary-box">
        <div>选中节点:<b class="mono">{{ selectedNodes.length }}</b> 个</div>
        <div>展开叶子零件:<b class="mono">{{ leafCount }}</b> 个</div>
      </div>

      <div v-if="selectedNodes.length === 0" class="muted empty">
        <p>在三维视图中 <b>Shift+左键</b> 框选,或在零件树 Ctrl 点选多个零件。</p>
        <p>父节点状态改变时,所有未单独覆盖的子节点自动继承;子节点可独立设置覆盖值。</p>
      </div>

      <template v-else>
        <div class="section-title">批量设置(作用于全部选中节点)</div>
        <div class="status-grid">
          <button
            v-for="s in statuses"
            :key="s.value"
            class="status-btn"
            :class="s.value"
            @click="apply(s.value)"
          >
            {{ s.label }}
          </button>
        </div>

        <div class="section-title">
          选中集与有效状态
          <button class="ghost mini" @click="modelStore.clearSelection()">清空</button>
        </div>
        <div class="selected-list">
          <div v-for="n in selectedNodes" :key="n.path" class="selected-row">
            <div class="row-main">
              <span class="row-icon">{{ n.isJoint ? '🔗' : n.children.length ? '📦' : '🔩' }}</span>
              <span class="row-name" :title="n.path">{{ n.name }}</span>
            </div>
            <div class="row-tags">
              <span
                class="tag"
                :class="n.ownStatus === null ? 'inherit' : n.ownStatus"
                :title="n.ownStatus === null ? '未覆盖:继承父节点状态' : '已单独覆盖'"
              >
                {{ n.ownStatus === null ? `继承→${STATUS_LABEL[modelStore.effectiveStatus(n.path)]}` : `覆盖:${STATUS_LABEL[n.ownStatus]}` }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.summary-box {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.empty {
  line-height: 1.8;
}

.section-title {
  margin: 14px 0 8px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.status-btn {
  padding: 9px 6px;
}

.status-btn.jam {
  border-color: rgba(255, 138, 0, 0.5);
}
.status-btn.overheat {
  border-color: rgba(255, 68, 68, 0.5);
}
.status-btn.shaftBreak {
  border-color: rgba(141, 75, 255, 0.5);
}
.status-btn.inherit {
  grid-column: span 2;
}

.mini {
  padding: 2px 8px;
  font-size: 11px;
}

.selected-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.selected-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 9px;
}

.row-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
