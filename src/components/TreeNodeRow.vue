<script setup lang="ts">
import { computed } from 'vue';
import type { PartNode, PartStatus } from '../types';
import { useModelStore } from '../stores/model';
import { STATUS_LABEL } from '../constants';

const props = defineProps<{
  node: PartNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  status: PartStatus;
  visibleCheck: (path: string) => boolean;
  forceExpand: (path: string) => boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle', path: string): void;
}>();

const modelStore = useModelStore();

const visibleChildren = computed(() =>
  props.node.children.filter((c) => props.visibleCheck(c)),
);

const childNodes = computed(() =>
  visibleChildren.value
    .map((p) => modelStore.nodes.get(p))
    .filter((n): n is PartNode => !!n),
);

function onClick(e: MouseEvent): void {
  if (e.ctrlKey || e.metaKey) modelStore.toggleSelect(props.node.path);
  else modelStore.selectOnly(props.node.path);
  if (props.node.children.length) emit('toggle', props.node.path);
}

function onChevron(e: MouseEvent): void {
  e.stopPropagation();
  emit('toggle', props.node.path);
}

function statusLabel(path: string): string {
  return STATUS_LABEL[modelStore.effectiveStatus(path)];
}
</script>

<template>
  <div class="tree-node">
    <div
      class="node-row"
      :class="{ selected: isSelected, joint: node.isJoint }"
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
      @click="onClick"
    >
      <span
        v-if="node.children.length"
        class="chevron"
        :class="{ open: isExpanded }"
        @click="onChevron"
      >▸</span>
      <span v-else class="chevron placeholder">·</span>

      <span class="node-icon">{{ node.isJoint ? '🔗' : node.children.length ? '📦' : '🔩' }}</span>
      <span class="node-name" :title="node.path">{{ node.name }}</span>

      <span v-if="node.isJoint" class="joint-flag">关节</span>
      <span class="tag" :class="status">{{ statusLabel(node.path) }}</span>
    </div>

    <div v-if="isExpanded && node.children.length">
      <TreeNodeRow
        v-for="child in childNodes"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :is-expanded="visibleCheck(child.path) && forceExpand(child.path)"
        :is-selected="modelStore.selectedPaths.has(child.path)"
        :status="modelStore.effectiveStatus(child.path)"
        :visible-check="visibleCheck"
        :force-expand="forceExpand"
        @toggle="emit('toggle', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.node-row {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding-right: 8px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.node-row:hover {
  background: var(--bg-2);
}

.node-row.selected {
  background: var(--accent-soft);
  outline: 1px solid rgba(47, 124, 246, 0.5);
}

.chevron {
  width: 14px;
  flex: none;
  color: var(--fg-2);
  font-size: 10px;
  transition: transform 0.15s;
}

.chevron.open {
  transform: rotate(90deg);
}

.chevron.placeholder {
  visibility: hidden;
}

.node-icon {
  flex: none;
  font-size: 12px;
}

.node-name {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.joint-flag {
  flex: none;
  font-size: 10px;
  color: var(--accent);
  border: 1px solid rgba(47, 124, 246, 0.5);
  border-radius: 8px;
  padding: 0 6px;
  line-height: 16px;
}

.tag {
  flex: none;
}
</style>
