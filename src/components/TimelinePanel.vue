<template>
  <section class="timeline panel">
    <div class="tl-head">
      <div class="transport">
        <button class="tbtn" title="回到首帧" @click="goFirst">⏮</button>
        <button class="tbtn primary" title="播放/暂停" @click="togglePlayback">
          {{ editorState.playing ? '⏸' : '▶' }}
        </button>
        <button class="tbtn" title="末帧" @click="goLast">⏭</button>
      </div>
      <div class="frame-readout mono">
        <input
          type="number"
          min="0"
          :max="editorState.totalFrames"
          :value="editorState.currentFrame"
          @change="onFrameInput"
        />
        / {{ editorState.totalFrames }} 帧
      </div>
      <div class="tl-actions">
        <button class="mini" @click="bakeAll" title="给所有折痕在首尾打关键帧">
          一键首尾姿态
        </button>
        <button class="mini danger" @click="clearTracks">清空全部关键帧</button>
        <span class="muted small">共 {{ totalKeyframeCount() }} 个关键帧</span>
      </div>
    </div>

    <div
      ref="rulerRef"
      class="ruler"
      @pointerdown="onScrubStart"
      @pointermove="onScrubMove"
      @pointerup="onScrubEnd"
    >
      <div
        v-for="f in frameTicks"
        :key="f"
        class="tick"
        :style="{ left: pct(f) + '%' }"
      >
        <span class="tick-label" v-if="f % step === 0">{{ f }}</span>
      </div>
      <div class="playhead" :style="{ left: pct(editorState.currentFrame) + '%' }">
        <div class="playhead-grip">◆</div>
      </div>
    </div>

    <div ref="tracksRef" class="tracks scroll-y" @pointerdown.self="noop">
      <div
        v-for="c in creaseRows"
        :key="c.id"
        class="track-row"
        :class="{ active: c.id === editorState.selectedCreaseId }"
        @click="selectCrease(c.id)"
      >
        <div class="track-label">
          <span class="mono">{{ c.id }}</span>
          <span class="tag" :class="c.type">{{ c.type === 'valley' ? '谷' : '峰' }}</span>
        </div>
        <div class="track-lane">
          <span
            v-for="kf in c.keyframes"
            :key="kf.frame"
            class="kf-diamond"
            :class="{ now: kf.frame === editorState.currentFrame }"
            :style="{ left: pct(kf.frame) + '%' }"
            :title="`F${kf.frame} · ${kf.angle.toFixed(1)}°`"
            @click.stop="selectCrease(c.id); setFrame(kf.frame)"
          >◆</span>
        </div>
      </div>
      <div v-if="!creaseRows.length" class="muted empty-tracks">
        暂无折痕轨道
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import {
  editorState,
  togglePlayback,
  setFrame,
  selectCrease,
  totalKeyframeCount,
  seedFoldPose
} from '../store/editorStore.js'

const rulerRef = ref(null)
const tracksRef = ref(null)
let scrubbing = false

const step = computed(() => (editorState.totalFrames > 60 ? 10 : 5))
const frameTicks = computed(() => {
  const out = []
  for (let f = 0; f <= editorState.totalFrames; f += step.value) out.push(f)
  if (out[out.length - 1] !== editorState.totalFrames) {
    out.push(editorState.totalFrames)
  }
  return out
})

const creaseRows = computed(() => {
  if (!editorState.model) return []
  return editorState.model.creases.map((c) => ({
    id: c.id,
    type: c.type,
    keyframes: [...(editorState.tracks[c.id] || [])].sort(
      (a, b) => a.frame - b.frame
    )
  }))
})

function pct(frame) {
  return (frame / editorState.totalFrames) * 100
}

function frameFromEvent(e) {
  const rect = rulerRef.value.getBoundingClientRect()
  const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  return Math.round(t * editorState.totalFrames)
}

function onScrubStart(e) {
  scrubbing = true
  rulerRef.value.setPointerCapture(e.pointerId)
  setFrame(frameFromEvent(e))
}

function onScrubMove(e) {
  if (!scrubbing) return
  setFrame(frameFromEvent(e))
}

function onScrubEnd() {
  scrubbing = false
}

function onFrameInput(e) {
  setFrame(Number(e.target.value) || 0)
}

function goFirst() {
  setFrame(0)
}

function goLast() {
  setFrame(editorState.totalFrames)
}

function bakeAll() {
  seedFoldPose(60)
  setFrame(editorState.currentFrame)
}

function clearTracks() {
  if (!confirm('确定清空全部折痕关键帧？')) return
  editorState.tracks = {}
  setFrame(0)
}

function noop() {}
</script>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.tl-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
}

.transport {
  display: flex;
  gap: 5px;
}

.tbtn {
  width: 34px;
  height: 28px;
  padding: 0;
  font-size: 12px;
}

.frame-readout {
  font-size: 13px;
  color: var(--fg-dim);
  display: flex;
  align-items: center;
  gap: 6px;
}

.frame-readout input {
  width: 64px;
  font-family: var(--mono);
}

.tl-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.mini {
  padding: 3px 9px;
  font-size: 11px;
}

.mini.danger {
  color: #f0968b;
}

.ruler {
  position: relative;
  height: 26px;
  margin: 0 12px;
  background: var(--bg-panel-2);
  border-radius: 5px;
  cursor: ew-resize;
  touch-action: none;
}

.tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--border);
}

.tick-label {
  position: absolute;
  top: 7px;
  left: 3px;
  font-size: 10px;
  color: var(--fg-faint);
  font-family: var(--mono);
}

.playhead {
  position: absolute;
  top: -2px;
  bottom: 0;
  width: 2px;
  background: var(--accent);
  pointer-events: none;
}

.playhead-grip {
  position: absolute;
  top: -7px;
  left: -6px;
  font-size: 11px;
  color: var(--accent);
}

.tracks {
  flex: 1;
  min-height: 0;
  margin: 6px 12px 10px;
  overflow-y: auto;
}

.track-row {
  display: flex;
  align-items: center;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
}

.track-row:hover {
  background: var(--bg-panel-2);
}

.track-row.active {
  background: rgba(79, 140, 255, 0.12);
}

.track-label {
  width: 118px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 6px;
  font-size: 11px;
}

.track-lane {
  position: relative;
  flex: 1;
  height: 100%;
  border-left: 1px solid var(--border);
}

.kf-diamond {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 11px;
  color: var(--warn);
  cursor: pointer;
  user-select: none;
}

.kf-diamond.now {
  color: #fff;
  text-shadow: 0 0 6px var(--accent);
}

.empty-tracks {
  padding: 18px;
  text-align: center;
  font-size: 12px;
}

.small { font-size: 11px; }
</style>
