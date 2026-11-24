<template>
  <section class="viewport panel">
    <div class="panel-title">
      <span>3D 折展视口</span>
      <span class="hud">
        <span class="hud-item">模式 <b>{{ editorState.stats.mode }}</b></span>
        <span class="hud-item">求解 <b>{{ editorState.stats.solverMs }}ms</b></span>
        <span class="hud-item">FPS <b>{{ editorState.stats.fps }}</b></span>
        <span class="hud-item">Worker <b>{{ editorState.stats.workerCount }}</b></span>
      </span>
    </div>
    <div ref="hostRef" class="canvas-host">
      <canvas ref="canvasRef"></canvas>
      <div v-if="!editorState.model" class="empty-tip">
        从左侧选择示例折痕图开始
      </div>
      <div class="legend">
        <span><i class="dot valley"></i>谷折 Valley</span>
        <span><i class="dot mountain"></i>峰折 Mountain</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, shallowRef, provide } from 'vue'
import { Viewport } from '../render/viewport.js'
import { bindViewport, selectCrease, editorState } from '../store/editorStore.js'

const hostRef = ref(null)
const canvasRef = ref(null)
const viewport = shallowRef(null)
provide('viewport', viewport)

let ro = null
let downPos = null

onMounted(() => {
  const vp = new Viewport(canvasRef.value)
  viewport.value = vp
  bindViewport(vp)
  ro = new ResizeObserver(() => {
    const r = hostRef.value.getBoundingClientRect()
    vp.setSize(r.width, r.height)
  })
  ro.observe(hostRef.value)
  const r = hostRef.value.getBoundingClientRect()
  vp.setSize(r.width, r.height)

  canvasRef.value.addEventListener('pointerdown', onDown)
  canvasRef.value.addEventListener('pointerup', onUp)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  canvasRef.value?.removeEventListener('pointerdown', onDown)
  canvasRef.value?.removeEventListener('pointerup', onUp)
  viewport.value?.dispose()
})

function onDown(e) {
  downPos = [e.clientX, e.clientY]
}

function onUp(e) {
  if (!downPos) return
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1])
  downPos = null
  if (moved > 5) return // 拖拽轨道相机，不拾取
  const rect = canvasRef.value.getBoundingClientRect()
  const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
  const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1
  const id = viewport.value.pickCrease(ndcX, ndcY)
  if (id) selectCrease(id)
}
</script>

<style scoped>
.viewport {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.canvas-host {
  position: relative;
  flex: 1;
  min-height: 0;
}

canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}

canvas:active {
  cursor: grabbing;
}

.hud {
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: var(--fg-faint);
  text-transform: none;
  letter-spacing: 0;
}

.hud-item b {
  color: var(--accent-2);
  font-family: var(--mono);
  font-weight: 600;
}

.empty-tip {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--fg-faint);
  pointer-events: none;
}

.legend {
  position: absolute;
  left: 12px;
  bottom: 10px;
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: var(--fg-dim);
  background: rgba(20, 22, 27, 0.7);
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 5px;
}

.dot.valley { background: var(--valley); }
.dot.mountain { background: var(--mountain); }
</style>
