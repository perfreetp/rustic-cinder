<script setup lang="ts">
import { computed } from 'vue';
import { useModelStore } from '../stores/model';
import { GEAR_LABEL, MAX_TRAVEL, MIN_TRAVEL } from '../constants';
import type { SpeedGear } from '../types';

const modelStore = useModelStore();

const activeJointPath = computed(() => {
  let cur = modelStore.activePath;
  while (cur !== null) {
    if (modelStore.joints.has(cur)) return cur;
    const node = modelStore.nodes.get(cur);
    cur = node?.parentPath ?? null;
  }
  return null;
});

const joint = computed(() => (activeJointPath.value ? modelStore.getJoint(activeJointPath.value) : null));

const gearOptions: SpeedGear[] = ['slow', 'normal', 'fast'];
const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];

const allJoints = computed(() => [...modelStore.joints.keys()]);
</script>

<template>
  <div class="joint-panel">
    <div class="panel-header">关节行程与档位</div>
    <div class="panel-body">
      <template v-if="joint && activeJointPath">
        <div class="joint-title" :title="activeJointPath">
          🔗 {{ modelStore.nodes.get(activeJointPath)?.name }}
        </div>

        <div class="field">
          <label>启用关节</label>
          <input
            type="checkbox"
            :checked="joint.enabled"
            @change="modelStore.updateJoint(activeJointPath!, { enabled: ($event.target as HTMLInputElement).checked })"
          />
        </div>

        <div class="field column">
          <label>
            行程角度:<b class="mono">{{ joint.travel }}°</b>
            <span class="muted">(范围 {{ MIN_TRAVEL }}–{{ MAX_TRAVEL }}°)</span>
          </label>
          <input
            type="range"
            :min="MIN_TRAVEL"
            :max="MAX_TRAVEL"
            :value="joint.travel"
            @input="modelStore.updateJoint(activeJointPath!, { travel: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>

        <div class="field">
          <label>快慢档位</label>
          <div class="seg">
            <button
              v-for="g in gearOptions"
              :key="g"
              class="seg-btn"
              :class="{ active: joint.gear === g }"
              @click="modelStore.updateJoint(activeJointPath!, { gear: g })"
            >
              {{ GEAR_LABEL[g] }}
            </button>
          </div>
        </div>

        <div class="field">
          <label>旋转轴</label>
          <div class="seg">
            <button
              v-for="a in axes"
              :key="a"
              class="seg-btn"
              :class="{ active: joint.axis === a }"
              @click="modelStore.updateJoint(activeJointPath!, { axis: a })"
            >
              {{ a.toUpperCase() }}
            </button>
          </div>
        </div>

        <div class="field">
          <label>拆卸方向</label>
          <div class="seg">
            <button
              class="seg-btn"
              :class="{ active: joint.direction === 1 }"
              @click="modelStore.updateJoint(activeJointPath!, { direction: 1 })"
            >
              正向
            </button>
            <button
              class="seg-btn"
              :class="{ active: joint.direction === -1 }"
              @click="modelStore.updateJoint(activeJointPath!, { direction: -1 })"
            >
              反向
            </button>
          </div>
        </div>

        <div class="keyframes muted">
          关键帧:合拢 0° @t=0 → 拆卸 {{ joint.travel }}° @t=1,档位曲线实时作用于时间轴播放
        </div>
      </template>

      <div v-else class="muted empty">
        <p>在零件树中选择带 <b>关节</b> 标记的节点后,在此编辑行程与档位。</p>
      </div>

      <div class="section-title">全部可动关节({{ allJoints.length }})</div>
      <div class="joint-list">
        <div
          v-for="p in allJoints"
          :key="p"
          class="joint-row"
          :class="{ active: p === activeJointPath }"
          @click="modelStore.selectOnly(p)"
        >
          <span>🔗 {{ modelStore.nodes.get(p)?.name }}</span>
          <span class="muted mono">{{ modelStore.getJoint(p)?.travel }}°</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.joint-title {
  font-weight: 700;
  margin-bottom: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field.column {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.seg {
  display: flex;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}

.seg-btn {
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 5px 10px;
}

.seg-btn.active {
  background: var(--accent);
}

.keyframes {
  margin-top: 14px;
  font-size: 11px;
  line-height: 1.6;
  background: var(--bg-2);
  border-radius: 6px;
  padding: 8px 10px;
}

.empty {
  line-height: 1.7;
}

.section-title {
  margin: 16px 0 8px;
  font-weight: 600;
}

.joint-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.joint-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 9px;
  border-radius: 6px;
  background: var(--bg-2);
  border: 1px solid transparent;
  cursor: pointer;
  overflow: hidden;
}

.joint-row:hover {
  border-color: var(--line);
}

.joint-row.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
</style>
