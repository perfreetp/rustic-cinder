<template>
  <header class="topbar panel">
    <div class="brand">
      <span class="logo">▸</span>
      <strong>折痕折叠动画编辑器</strong>
      <span class="model-name muted">{{ editorState.modelName || '未载入模型' }}</span>
    </div>

    <div class="actions">
      <div class="rig-group" title="切换三组布光方向">
        <button
          v-for="(rig, i) in LIGHT_RIGS"
          :key="i"
          :class="{ active: editorState.lightRig === i }"
          @click="setLightRig(i)"
        >
          {{ rig.name.split(' · ')[0] }}
        </button>
      </div>
      <span class="divider" />
      <button @click="exportKeyframesOnly" :disabled="!hasModel">
        导出关键帧 JSON
      </button>
      <button class="primary" :disabled="exporting || !hasModel" @click="onExport">
        {{ exporting ? `导出中 ${editorState.exportProgress ?? 0}%` : '导出 PNG 序列帧' }}
      </button>
    </div>
  </header>
</template>

<script setup>
import { computed, inject } from 'vue'
import { editorState, setLightRig } from '../store/editorStore.js'
import { LIGHT_RIGS } from '../render/paperShader.js'
import { exportSequence, downloadBlob } from '../core/exporter.js'
import { serializeKeyframes } from '../core/keyframes.js'

const viewport = inject('viewport')
const hasModel = computed(() => !!editorState.model)
const exporting = computed(() => editorState.exportProgress != null)

async function onExport() {
  const vp = viewport?.value
  if (!vp) return
  editorState.exportProgress = 0
  try {
    const blob = await exportSequence(vp, (done, total) => {
      editorState.exportProgress = Math.round((done / total) * 100)
    })
    downloadBlob(blob, `${editorState.modelName || 'crease-fold'}_sequence.zip`)
  } catch (err) {
    alert('导出失败：' + err.message)
  } finally {
    editorState.exportProgress = null
  }
}

function exportKeyframesOnly() {
  const creaseTypes = {}
  for (const c of editorState.model.creases) creaseTypes[c.id] = c.type
  const json = serializeKeyframes({
    tracks: editorState.tracks,
    totalFrames: editorState.totalFrames,
    fps: editorState.fps,
    modelName: editorState.modelName,
    creaseTypes
  })
  const blob = new Blob([json], { type: 'application/json' })
  downloadBlob(blob, `${editorState.modelName || 'crease-fold'}_keyframes.json`)
}
</script>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-radius: var(--radius);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo {
  color: var(--accent);
  font-size: 18px;
}

.model-name {
  margin-left: 8px;
  font-size: 12px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rig-group {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.rig-group button {
  border: none;
  border-radius: 0;
  padding: 5px 10px;
}

.rig-group button.active {
  background: var(--accent);
  color: #fff;
}

.divider {
  width: 1px;
  height: 22px;
  background: var(--border);
  margin: 0 4px;
}
</style>
