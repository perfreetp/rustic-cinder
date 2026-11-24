<script setup lang="ts">
import { computed, ref } from 'vue';
import { useModelStore } from '../stores/model';
import type { PartNode, PartStatus } from '../types';
import TreeNodeRow from './TreeNodeRow.vue';

const modelStore = useModelStore();

const expanded = ref<Set<string>>(new Set(['']));
const filterText = ref('');

const rootNode = computed<PartNode | null>(() => modelStore.nodes.get('') ?? null);

function toggleExpand(path: string): void {
  const next = new Set(expanded.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expanded.value = next;
}

function isExpanded(path: string): boolean {
  return expanded.value.has(path);
}

function isSelected(path: string): boolean {
  return modelStore.selectedPaths.has(path);
}

function statusOf(path: string): PartStatus {
  return modelStore.effectiveStatus(path);
}

const selectedCount = computed(() => modelStore.selectedPaths.size);

function expandAll(): void {
  expanded.value = new Set(modelStore.nodes.keys());
}

function collapseAll(): void {
  expanded.value = new Set(['']);
}

function matchFilter(path: string): boolean {
  if (!filterText.value.trim()) return true;
  return path.toLowerCase().includes(filterText.value.trim().toLowerCase());
}

/** 过滤时:若后代命中则祖先保持可见 */
function subtreeVisible(path: string): boolean {
  if (matchFilter(path)) return true;
  const node = modelStore.nodes.get(path);
  return !!node?.children.some((c) => subtreeVisible(c));
}

/** 过滤态自动展开命中路径 */
function forceExpand(path: string): boolean {
  if (!filterText.value.trim()) return isExpanded(path);
  const node = modelStore.nodes.get(path);
  return !!node?.children.some((c) => subtreeVisible(c));
}
</script>

<template>
  <div class="panel tree-panel">
    <div class="panel-header">
      <span>零件树 / 装配层级</span>
      <span class="muted mono">{{ selectedCount }} 选中</span>
    </div>
    <div class="filter-bar">
      <input
        v-model="filterText"
        type="text"
        placeholder="筛选零件名称…"
      />
      <button class="ghost" @click="expandAll">全展</button>
      <button class="ghost" @click="collapseAll">折叠</button>
    </div>
    <div class="panel-body tree-body">
      <div v-if="!modelStore.hasModel" class="muted empty">导入模型后自动生成零件树</div>
      <TreeNodeRow
        v-else-if="rootNode && subtreeVisible(rootNode.path)"
        :node="rootNode"
        :depth="0"
        :is-expanded="forceExpand(rootNode.path)"
        :is-selected="isSelected(rootNode.path)"
        :status="statusOf(rootNode.path)"
        :visible-check="subtreeVisible"
        :force-expand="forceExpand"
        @toggle="toggleExpand"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-panel {
  flex: 1;
}

.filter-bar {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  flex: none;
}

.filter-bar input {
  flex: 1;
  min-width: 0;
}

.tree-body {
  padding: 6px;
}

.empty {
  padding: 20px 8px;
}
</style>
