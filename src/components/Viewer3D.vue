<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { SceneEngine } from '../three/SceneEngine';
import { useModelStore } from '../stores/model';
import { useSessionStore } from '../stores/session';
import { PERF_TARGET_FPS } from '../constants';
import type { MarqueeRect } from '../types';

const modelStore = useModelStore();
const session = useSessionStore();

const host = ref<HTMLDivElement | null>(null);
const engine = shallowRef<SceneEngine | null>(null);
const fps = ref(60);
const marquee = ref<MarqueeRect | null>(null);
const statusCostMs = ref(0);
const sectionCostMs = ref(0);
const perfHealthy = ref(true);

let marqueeStart: { x: number; y: number } | null = null;

onMounted(() => {
  if (!host.value) return;
  const eng = new SceneEngine(host.value);
  engine.value = eng;
  // 调试/自动化测试钩子(只读检查渲染信息,不参与业务逻辑)
  (window as unknown as { __sceneEngine?: SceneEngine }).__sceneEngine = eng;
  eng.onFps = (v) => {
    fps.value = v;
    perfHealthy.value = v >= PERF_TARGET_FPS;
  };
  eng.onPick = (path) => {
    modelStore.selectOnly(path);
  };
});

onBeforeUnmount(() => {
  engine.value?.dispose();
});

// 模型装载 → 送入引擎
watch(
  () => modelStore.renderModel,
  (result) => {
    if (!engine.value) return;
    if (result) {
      engine.value.loadModel(result.model, modelStore.sourceMaterials);
      engine.value.syncJoints(modelStore.joints);
      engine.value.setTime(session.timeT);
      syncStates();
    } else {
      engine.value.clearModel();
    }
  },
);

// 关节配置变化 → 同步并重算当前帧
watch(
  () => modelStore.joints,
  (map) => {
    engine.value?.syncJoints(map);
    engine.value?.setTime(session.timeT);
  },
  { deep: false },
);

// 时间轴 → 引擎姿态
watch(
  () => session.timeT,
  (t) => engine.value?.setTime(t),
);

// 零件状态/选中变化 → 状态纹理批量更新(预算 300ms)
function syncStates(): void {
  if (!engine.value || !modelStore.renderModel) return;
  const cost = engine.value.updatePartStates(
    modelStore.leafStatusMap(),
    modelStore.selectedLeafPaths(),
  );
  statusCostMs.value = Math.round(cost * 10) / 10;
}

watch(
  () => [modelStore.nodes, modelStore.selectedPaths] as const,
  syncStates,
  { deep: false },
);

// 剖切配置 → 裁剪平面 + 模板 cap 重算(预算 300ms)
watch(
  () => session.section,
  (cfg) => {
    if (!engine.value) return;
    sectionCostMs.value = Math.round(engine.value.setSection(cfg) * 10) / 10;
  },
  { deep: true },
);

// ---------------- 框选 ----------------

function localPoint(e: PointerEvent): { x: number; y: number } {
  const rect = host.value!.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || !e.shiftKey) return; // Shift + 左键框选
  const p = localPoint(e);
  marqueeStart = p;
  marquee.value = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
}

function onPointerMove(e: PointerEvent): void {
  if (!marqueeStart) return;
  const p = localPoint(e);
  marquee.value = { x0: marqueeStart.x, y0: marqueeStart.y, x1: p.x, y1: p.y };
}

function onPointerUp(e: PointerEvent): void {
  if (!marqueeStart || !marquee.value || !engine.value) {
    marqueeStart = null;
    marquee.value = null;
    return;
  }
  const rect = marquee.value;
  const w = Math.abs(rect.x1 - rect.x0);
  const h = Math.abs(rect.y1 - rect.y0);
  if (w >= 4 && h >= 4) {
    const hit = engine.value.marqueeSelect(rect);
    modelStore.selectMany(hit.paths, e.ctrlKey || e.metaKey);
  }
  marqueeStart = null;
  marquee.value = null;
}
</script>

<template>
  <div class="panel viewer-panel">
    <div class="viewer-header">
      <span>三维视图</span>
      <div class="hud">
        <span class="hud-item" :class="{ bad: !perfHealthy }" title="装配动画播放帧率目标 ≥ 50 FPS">
          {{ fps }} FPS
        </span>
        <span class="hud-item" title="故障换色状态纹理更新耗时,预算 300ms">
          换色 {{ statusCostMs }}ms
        </span>
        <span class="hud-item" title="剖切面重算耗时,预算 300ms">剖切 {{ sectionCostMs }}ms</span>
        <span class="hud-item muted" v-if="modelStore.hasModel">
          {{ modelStore.partCount.toLocaleString() }} 件 /
          {{ modelStore.triangleCount.toLocaleString() }} 面 /
          {{ modelStore.jointCount }} 关节
        </span>
      </div>
    </div>
    <div
      ref="host"
      class="viewer-host"
      :class="{ marqueeing: marquee !== null }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <div v-if="!modelStore.hasModel" class="empty-hint">
        <div class="empty-title">尚未导入产线装配模型</div>
        <div class="empty-sub">点击左上角「导入模型」,支持 .glb / .gltf / .obj / .stl</div>
      </div>
      <div v-if="modelStore.loading" class="loading-mask">
        <div class="loading-box">
          <div class="loading-title">{{ modelStore.loadMessage || '解析中…' }}</div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: `${modelStore.loadProgress}%` }"></div>
          </div>
          <div class="mono muted">{{ Math.round(modelStore.loadProgress) }}%</div>
        </div>
      </div>
      <div
        v-if="marquee"
        class="marquee"
        :style="{
          left: Math.min(marquee.x0, marquee.x1) + 'px',
          top: Math.min(marquee.y0, marquee.y1) + 'px',
          width: Math.abs(marquee.x1 - marquee.x0) + 'px',
          height: Math.abs(marquee.y1 - marquee.y0) + 'px',
        }"
      ></div>
    </div>
    <div class="viewer-tip muted">
      左键旋转 · 右键平移 · 滚轮缩放 · 单击拾取零件 ·
      <b>Shift+左键</b> 框选批量零件(Ctrl 追加)
    </div>
  </div>
</template>

<style scoped>
.viewer-panel {
  flex: 1;
  min-height: 0;
}

.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  font-weight: 600;
  flex: none;
}

.hud {
  display: flex;
  gap: 8px;
  font-weight: 400;
}

.hud-item {
  font-family: var(--mono);
  font-size: 11px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 2px 8px;
}

.hud-item.bad {
  color: var(--danger);
  border-color: var(--danger);
}

.viewer-host {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.viewer-host.marqueeing {
  cursor: crosshair;
}

.viewer-host :deep(canvas) {
  width: 100%;
  height: 100%;
}

.empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
}

.empty-sub {
  color: var(--fg-2);
}

.loading-mask {
  position: absolute;
  inset: 0;
  background: rgba(15, 19, 25, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-box {
  width: 320px;
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 18px;
  text-align: center;
}

.progress-track {
  height: 8px;
  background: var(--bg-3);
  border-radius: 4px;
  overflow: hidden;
  margin: 12px 0 8px;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
}

.marquee {
  position: absolute;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  pointer-events: none;
}

.viewer-tip {
  flex: none;
  padding: 6px 12px;
  border-top: 1px solid var(--line);
  font-size: 11px;
}
</style>
