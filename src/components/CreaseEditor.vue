<template>
  <div class="crease-editor">
    <div class="toolbar">
      <label class="tool">
        <input type="radio" value="valley" v-model="drawType" />
        <span class="tag valley">谷折</span>
      </label>
      <label class="tool">
        <input type="radio" value="mountain" v-model="drawType" />
        <span class="tag mountain">峰折</span>
      </label>
      <button class="mini ghost" @click="removeLast" title="删除最后一条">撤销</button>
      <button class="mini ghost" @click="clearAll" title="清空折痕">清空</button>
    </div>
    <canvas
      ref="canvasRef"
      class="draw-canvas"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointerleave="onUp"
    ></canvas>
    <p class="hint muted">在纸面上按下并拖拽绘制折痕，松手完成；点击已有折痕可选中后删除。</p>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, onBeforeUnmount } from 'vue'
import { editorState, loadCreasePattern, selectCrease } from '../store/editorStore.js'

const canvasRef = ref(null)
const drawType = ref('valley')
const W = 252
const H = 252
let ctx = null
let drag = null
let seq = 0

onMounted(() => {
  ctx = canvasRef.value.getContext('2d')
  draw()
})

watch(
  () => editorState.input,
  () => {
    seq = 0
    draw()
  },
  { deep: false }
)

function toWorld(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  const px = ((e.clientX - rect.left) / rect.width) * W
  const py = ((e.clientY - rect.top) / rect.height) * H
  const { bounds } = editorState.model
  const x = bounds.minX + (px / W) * bounds.width
  const y = bounds.minY + (py / H) * bounds.height
  return [x, y]
}

function toScreen(p) {
  const b = editorState.model.bounds
  return [
    ((p[0] - b.minX) / b.width) * W,
    ((p[1] - b.minY) / b.height) * H
  ]
}

function onDown(e) {
  canvasRef.value.setPointerCapture(e.pointerId)
  const p = toWorld(e)
  // 先尝试选中已有折痕
  const hit = hitTest(p)
  if (hit) {
    selectCrease(hit)
    return
  }
  drag = { start: p, end: p }
}

function onMove(e) {
  if (!drag) return
  drag.end = toWorld(e)
  draw()
}

function onUp() {
  if (!drag) return
  const { start, end } = drag
  drag = null
  const len = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (len < 0.15) {
    draw()
    return
  }
  const input = editorState.input
  const id = `u${Date.now().toString(36)}_${seq++}`
  input.creases.push({ id, type: drawType.value, a: start, b: end })
  rebuild()
}

function hitTest(p) {
  const tol = 0.18
  for (const c of editorState.input.creases) {
    if (pointSegDist(p, c.a, c.b) < tol) return c.id
  }
  return null
}

function pointSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  const qx = a[0] + t * dx
  const qy = a[1] + t * dy
  return Math.hypot(p[0] - qx, p[1] - qy)
}

function removeLast() {
  const input = editorState.input
  input.creases.pop()
  rebuild()
}

function clearAll() {
  editorState.input.creases = []
  rebuild()
}

function rebuild() {
  const old = JSON.parse(JSON.stringify(editorState.tracks))
  loadCreasePattern(editorState.input, editorState.modelName)
  // 保留仍存在折痕的轨道
  const keep = {}
  const ids = new Set(editorState.input.creases.map((c) => c.id))
  for (const [k, v] of Object.entries(old)) if (ids.has(k)) keep[k] = v
  editorState.tracks = keep
  draw()
}

function draw() {
  if (!ctx || !editorState.model) return
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#f2ead8'
  ctx.fillRect(0, 0, W, H)

  const border = editorState.model.border.map(toScreen)
  ctx.beginPath()
  border.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1.5
  ctx.stroke()

  for (const c of editorState.input.creases) {
    const a = toScreen(c.a)
    const b = toScreen(c.b)
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    ctx.strokeStyle = c.type === 'valley' ? '#2f7de1' : '#e14b3c'
    ctx.lineWidth = c.id === editorState.selectedCreaseId ? 3 : 1.6
    if (c.type === 'mountain') ctx.setLineDash([6, 3])
    else ctx.setLineDash([])
    ctx.stroke()
  }
  ctx.setLineDash([])

  if (drag) {
    const a = toScreen(drag.start)
    const b = toScreen(drag.end)
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    ctx.strokeStyle = drawType.value === 'valley' ? '#2f7de1' : '#e14b3c'
    ctx.lineWidth = 2
    ctx.setLineDash([3, 3])
    ctx.stroke()
    ctx.setLineDash([])
  }
}

onBeforeUnmount(() => {})
</script>

<style scoped>
.crease-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.draw-canvas {
  width: 100%;
  height: 252px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #f2ead8;
  touch-action: none;
  cursor: crosshair;
}

.mini {
  padding: 2px 8px;
  font-size: 11px;
}

.hint {
  font-size: 11px;
  margin: 0;
  line-height: 1.4;
}
</style>
