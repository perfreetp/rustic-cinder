<script setup lang="ts">
import { computed } from 'vue';
import { useSessionStore } from '../stores/session';
import { useModelStore } from '../stores/model';

const session = useSessionStore();
const modelStore = useModelStore();

/** 沿当前轴的模型范围,用于归一化滑动条 */
const range = computed(() => {
  const b = modelStore.renderModel?.model.bounds;
  if (!b) return { min: -100, max: 100 };
  const axis = session.section.axis;
  const min = axis === 'x' ? b.min.x : axis === 'y' ? b.min.y : b.min.z;
  const max = axis === 'x' ? b.max.x : axis === 'y' ? b.max.y : b.max.z;
  const pad = (max - min) * 0.08 || 1;
  return { min: min - pad, max: max + pad };
});

const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];

function onOffset(e: Event): void {
  session.patchSection({ offset: Number((e.target as HTMLInputElement).value) });
}
</script>

<template>
  <div class="section-panel">
    <div class="panel-header">剖切模块</div>
    <div class="panel-body">
      <div class="field">
        <label>启用剖切</label>
        <input
          type="checkbox"
          :checked="session.section.enabled"
          @change="session.patchSection({ enabled: ($event.target as HTMLInputElement).checked })"
        />
      </div>

      <div class="field">
        <label>平面法线</label>
        <div class="seg">
          <button
            v-for="a in axes"
            :key="a"
            class="seg-btn"
            :class="{ active: session.section.axis === a }"
            :disabled="!session.section.enabled"
            @click="session.patchSection({ axis: a, offset: 0 })"
          >
            {{ a.toUpperCase() }} 轴
          </button>
        </div>
      </div>

      <div class="field column">
        <label>
          平面位置(拖动):<b class="mono">{{ session.section.offset.toFixed(1) }}</b>
        </label>
        <input
          type="range"
          :min="range.min"
          :max="range.max"
          step="0.5"
          :value="session.section.offset"
          :disabled="!session.section.enabled"
          @input="onOffset"
        />
        <div class="range-end muted mono">
          <span>{{ range.min.toFixed(0) }}</span>
          <span>{{ range.max.toFixed(0) }}</span>
        </div>
      </div>

      <div class="field column">
        <label>
          剖切面不透明度:<b class="mono">{{ Math.round(session.section.capOpacity * 100) }}%</b>
        </label>
        <input
          type="range"
          min="0.05"
          max="0.7"
          step="0.01"
          :value="session.section.capOpacity"
          :disabled="!session.section.enabled"
          @input="session.patchSection({ capOpacity: Number(($event.target as HTMLInputElement).value) })"
        />
      </div>

      <button
        class="ghost reset"
        :disabled="!session.section.enabled"
        @click="session.patchSection({ offset: 0 })"
      >
        平面归中
      </button>

      <div class="note muted">
        剖切面采用模板缓冲生成:半透明切面仅出现在模型实体内部,
        深度测试保证内部零件遮挡关系正确、不会被错误穿透。
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.range-end {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
}

.reset {
  width: 100%;
  margin-top: 6px;
}

.note {
  margin-top: 14px;
  font-size: 11px;
  line-height: 1.7;
  background: var(--bg-2);
  border-radius: 6px;
  padding: 8px 10px;
}
</style>
