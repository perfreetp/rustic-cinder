<template>
  <aside class="right panel">
    <div class="panel-title">折痕与关键帧</div>
    <div class="body scroll-y">
      <section v-if="!selectedCrease" class="empty muted">
        在视口或左侧列表选择一条折痕
      </section>

      <template v-else>
        <section class="block">
          <div class="row between">
            <strong class="mono">{{ selectedCrease.id }}</strong>
            <span class="tag" :class="selectedCrease.type">
              {{ selectedCrease.type === 'valley' ? '谷折 Valley' : '峰折 Mountain' }}
            </span>
          </div>
          <p class="muted small">
            驱动折面：{{ childFaces.length }} 个 · 树深 {{ depthText }}
          </p>
        </section>

        <section class="block">
          <label class="block-label">
            当前角度（第 {{ editorState.currentFrame }} 帧）
            <span class="mono angle-num">{{ angle.toFixed(1) }}°</span>
          </label>
          <input
            type="range"
            min="-180"
            max="180"
            step="0.5"
            :value="angle"
            class="angle-range"
            @input="onAngleInput"
          />
          <div class="row between ticks">
            <span>-180°</span><span>0°</span><span>180°</span>
          </div>
          <div class="row" style="margin-top: 8px">
            <button class="primary grow" @click="keyHere">
              在第 {{ editorState.currentFrame }} 帧打关键帧
            </button>
          </div>
        </section>

        <section class="block">
          <label class="block-label">该折痕关键帧（{{ selectedTrack.length }}）</label>
          <div v-if="!selectedTrack.length" class="muted small">尚无关键帧</div>
          <div
            v-for="kf in selectedTrack"
            :key="kf.frame"
            class="kf-row"
            :class="{ now: kf.frame === editorState.currentFrame }"
          >
            <span class="mono">F{{ kf.frame }}</span>
            <input
              type="number"
              step="1"
              :value="kf.angle"
              @change="(e) => editAngle(kf, e.target.value)"
            />
            <span>°</span>
            <button class="mini" @click="jumpTo(kf.frame)">跳转</button>
            <button class="mini danger" @click="deleteKf(kf)">删除</button>
          </div>
        </section>

        <section class="block">
          <label class="block-label">子树联动预览</label>
          <div class="subtree muted small">
            <div v-for="fid in childFaces.slice(0, 8)" :key="fid" class="mono">
              └ {{ fid }}
            </div>
            <div v-if="childFaces.length > 8" class="muted">
              … 共 {{ childFaces.length }} 个折面随该折痕联动
            </div>
          </div>
        </section>
      </template>

      <section class="block">
        <label class="block-label">播放设置</label>
        <div class="setting-row">
          <span>总帧数（上限 120）</span>
          <input
            type="number"
            min="1"
            max="120"
            :value="editorState.totalFrames"
            @change="onTotalFrames"
          />
        </div>
        <div class="setting-row">
          <span>帧率 FPS</span>
          <input
            type="number"
            min="1"
            max="60"
            :value="editorState.fps"
            @change="onFps"
          />
        </div>
        <label class="setting-row">
          <span>循环播放</span>
          <input
            type="checkbox"
            :checked="editorState.loop"
            @change="editorState.loop = $event.target.checked"
          />
        </label>
      </section>

      <section class="block">
        <label class="block-label">渲染质量</label>
        <div class="rig-group">
          <button
            :class="{ active: editorState.quality === 'low' }"
            @click="forceLow"
          >
            低精度
          </button>
          <button
            :class="{ active: editorState.quality === 'high' }"
            @click="forceHigh"
          >
            高精度
          </button>
        </div>
        <p class="muted small" style="margin-top: 6px">
          播放时先更新低精度折面，再由 Worker 补全高精度纸面着色。
        </p>
      </section>
    </div>
  </aside>
</template>

<script setup>
import { computed, inject } from 'vue'
import {
  editorState,
  selectedCrease,
  selectedTrack,
  selectedCurrentAngle,
  addKeyframe,
  deleteKeyframe,
  setFrame,
  setTotalFrames,
  requestPose
} from '../store/editorStore.js'

const viewport = inject('viewport')
const angle = selectedCurrentAngle

const childFaces = computed(() => {
  const cid = editorState.selectedCreaseId
  if (!cid || !editorState.model) return []
  return editorState.model.creaseHinges[cid] || []
})

const depthText = computed(() => {
  const fid = childFaces.value[0]
  if (!fid) return '-'
  const face = editorState.model.faces.find((f) => f.id === fid)
  return face ? face.depth : '-'
})

function onAngleInput(e) {
  const v = Number(e.target.value)
  const cid = editorState.selectedCreaseId
  // 直接在当前帧写关键帧，触发子树联动重算
  addKeyframe(cid, editorState.currentFrame, v)
}

function keyHere() {
  addKeyframe(
    editorState.selectedCreaseId,
    editorState.currentFrame,
    Number(angle.value.toFixed(1))
  )
}

function editAngle(kf, value) {
  addKeyframe(editorState.selectedCreaseId, kf.frame, Number(value))
}

function deleteKf(kf) {
  deleteKeyframe(editorState.selectedCreaseId, kf.frame)
}

function jumpTo(frame) {
  setFrame(frame)
}

function onTotalFrames(e) {
  setTotalFrames(Number(e.target.value) || 1)
}

function onFps(e) {
  editorState.fps = Math.max(1, Math.min(60, Number(e.target.value) || 30))
}

function forceLow() {
  editorState.quality = 'low'
  viewport?.value?.setQualityMode(false)
}

function forceHigh() {
  editorState.quality = 'high'
  viewport?.value?.setQualityMode(true)
  requestPose(true)
}
</script>

<style scoped>
.right {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.block-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg-dim);
  margin-bottom: 7px;
}

.empty {
  padding: 24px 8px;
  text-align: center;
}

.angle-num {
  color: var(--accent-2);
  font-size: 13px;
}

.angle-range {
  width: 100%;
}

.ticks {
  font-size: 10px;
  color: var(--fg-faint);
}

.grow { flex: 1; }

.kf-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 6px;
  border-radius: 5px;
  background: var(--bg-panel-2);
  margin-bottom: 4px;
}

.kf-row.now {
  outline: 1px solid var(--accent);
}

.kf-row input[type='number'] {
  width: 64px;
}

.mini {
  padding: 1px 7px;
  font-size: 11px;
}

.mini.danger {
  color: #f0968b;
}

.subtree {
  max-height: 130px;
  overflow: auto;
  background: var(--bg-panel-2);
  border-radius: 6px;
  padding: 6px 8px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 12px;
}

.rig-group {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.rig-group button {
  flex: 1;
  border: none;
  border-radius: 0;
}

.rig-group button.active {
  background: var(--accent);
  color: #fff;
}

.small { font-size: 11px; }
.row.between { justify-content: space-between; }
</style>
