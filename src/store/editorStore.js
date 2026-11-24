/**
 * 编辑器核心状态（Vue reactive）：折痕模型、关键帧轨道、播放控制、
 * 低/高精度两级姿态调度与 Worker 求解对接。
 */
import { reactive, computed, shallowRef } from 'vue'
import { buildModel } from '../core/model.js'
import { buildMeshes } from '../core/meshBuilder.js'
import { SolverPool } from '../core/solverPool.js'
import {
  MAX_FRAMES,
  DEFAULT_FPS,
  sampleFrame,
  setKeyframe,
  removeKeyframe,
  countKeyframes
} from '../core/keyframes.js'

export const editorState = reactive({
  modelName: '',
  input: null, // {border, creases}
  model: null, // buildModel 产物
  meshes: null, // {low, high}
  tracks: {}, // {creaseId: [{frame, angle}]}
  totalFrames: 120,
  fps: DEFAULT_FPS,
  currentFrame: 0,
  playing: false,
  loop: true,
  selectedCreaseId: null,
  lightRig: 0,
  quality: 'high', // 'high' | 'low'
  stats: {
    faceCount: 0,
    creaseCount: 0,
    highVerts: 0,
    lowVerts: 0,
    solverMs: 0,
    fps: 0,
    workerCount: 0,
    mode: 'idle'
  },
  exportProgress: null
})

export const selectedCrease = computed(() => {
  if (!editorState.model || !editorState.selectedCreaseId) return null
  return editorState.model.creases.find(
    (c) => c.id === editorState.selectedCreaseId
  )
})

export const selectedTrack = computed(() => {
  const id = editorState.selectedCreaseId
  if (!id) return []
  return [...(editorState.tracks[id] || [])].sort((a, b) => a.frame - b.frame)
})

export const currentAngles = computed(() =>
  sampleFrame(editorState.tracks, editorState.currentFrame)
)

/** 当前选中折痕在当前帧的角度（无关键帧时为插值结果） */
export const selectedCurrentAngle = computed(() => {
  const id = editorState.selectedCreaseId
  if (!id) return 0
  return currentAngles.value[id] ?? 0
})

let pool = null
const viewportRef = shallowRef(null)
let highToken = 0
let lastFrameTime = performance.now()
let fpsAccum = 0, fpsCount = 0

export function bindViewport(vp) {
  viewportRef.value = vp
}

function ensurePool() {
  if (!pool) {
    pool = new SolverPool()
    editorState.stats.workerCount = pool.enabled ? pool.size : 0
  }
  return pool
}

/** 载入新的折痕标注并重建模型/网格/场景 */
export function loadCreasePattern(input, name = '未命名') {
  stopPlayback()
  editorState.modelName = name
  editorState.input = JSON.parse(JSON.stringify(input))
  const model = buildModel(editorState.input)
  const meshes = buildMeshes(model)
  editorState.model = model
  editorState.meshes = meshes
  editorState.tracks = {}
  editorState.currentFrame = 0
  editorState.selectedCreaseId = null
  editorState.stats.faceCount = model.faces.length
  editorState.stats.creaseCount = model.creases.length
  editorState.stats.highVerts = meshes.high.positions.length / 3
  editorState.stats.lowVerts = meshes.low.positions.length / 3

  const vp = viewportRef.value
  if (vp) {
    vp.setModel(model, meshes, (id) => selectCrease(id))
    vp.setLightRig(editorState.lightRig)
  }
  ensurePool()
  requestPose(true)
}

export function selectCrease(id) {
  editorState.selectedCreaseId = id
  viewportRef.value?.selectCrease(id)
}

export function setLightRig(index) {
  editorState.lightRig = index
  viewportRef.value?.setLightRig(index)
}

/** 在指定帧为折痕写入关键帧 */
export function addKeyframe(creaseId, frame, angle) {
  setKeyframe(editorState.tracks, creaseId, frame, angle)
  requestPose(true)
}

export function deleteKeyframe(creaseId, frame) {
  removeKeyframe(editorState.tracks, creaseId, frame)
  requestPose(true)
}

/**
 * 批量播种关键帧（如初始化首尾姿态），只在最后触发一次求解，
 * 避免 N 条折痕各自 requestPose 造成上百次重叠 Worker 派发。
 * @param {{creaseId:string, frame:number, angle:number}[]} entries
 */
export function seedKeyframes(entries) {
  for (const { creaseId, frame, angle } of entries) {
    setKeyframe(editorState.tracks, creaseId, frame, angle)
  }
  requestPose(true)
}

/** 一键首尾姿态：0 帧全平，末帧按峰谷折叠到 foldAngle */
export function seedFoldPose(foldAngle = 60) {
  const { model, totalFrames } = editorState
  if (!model) return
  const entries = []
  for (const c of model.creases) {
    entries.push({ creaseId: c.id, frame: 0, angle: 0 })
    entries.push({
      creaseId: c.id,
      frame: totalFrames,
      angle: c.type === 'valley' ? foldAngle : -foldAngle
    })
  }
  seedKeyframes(entries)
}

export function totalKeyframeCount() {
  return countKeyframes(editorState.tracks)
}

/**
 * 姿态求解调度（两级）：
 * 1) 同步算低精度（粗网格立刻更新，保证交互手感）
 * 2) 高精度 Worker 求解经 rAF 合并：同一帧内的多次 requestPose
 *    （拖滑杆、拖播放头、播放逐帧）只派发一次最新角度的高精度任务，
 *    过期结果按 token 丢弃。
 */
export async function requestPose(forceHigh = false) {
  const vp = viewportRef.value
  const { model, meshes } = editorState
  if (!vp || !model || !meshes) return
  const angles = sampleFrame(editorState.tracks, editorState.currentFrame)
  const p = ensurePool()

  // —— 低精度（同步，粗网格）——
  const t0 = performance.now()
  const low = await p.solve(
    model,
    angles,
    { base: meshes.low.positions, ranges: meshes.low.ranges },
    false
  )
  vp.applyLowPositions(low.positions)
  vp.setQualityMode(false)
  editorState.stats.mode = 'low'
  scheduleHighSolve(p, vp, model, meshes, t0)
}

let highScheduled = false
const scheduleFrame =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16)

function scheduleHighSolve(pool, vp, model, meshes, t0) {
  if (highScheduled) return
  highScheduled = true
  scheduleFrame(() => {
    highScheduled = false
    // 回调时读取最新帧角度，确保用的是当前状态而非排队时的快照
    const angles = sampleFrame(editorState.tracks, editorState.currentFrame)
    const token = ++highToken
    pool
      .solve(
        model,
        angles,
        { base: meshes.high.positions, ranges: meshes.high.ranges },
        true
      )
      .then((high) => {
        if (token !== highToken) return // 已被更新的请求取代
        vp.applyHighPositions(high.positions)
        vp.setQualityMode(true)
        editorState.stats.mode = 'high'
        editorState.stats.solverMs =
          Math.round((performance.now() - t0) * 10) / 10
      })
      .catch((err) => {
        if (String(err.message) !== 'stale') {
          console.warn('高精度求解失败', err)
        }
      })
  })
}

export function setFrame(frame, { fromPlayback = false } = {}) {
  editorState.currentFrame = Math.max(
    0,
    Math.min(editorState.totalFrames, Math.round(frame))
  )
  requestPose(true)
}

let playTimer = null

export function startPlayback() {
  if (editorState.playing) return
  editorState.playing = true
  const frameMs = 1000 / editorState.fps
  let last = performance.now()
  let acc = 0

  const tick = (now) => {
    if (!editorState.playing) return
    const delta = now - last
    last = now
    acc += delta
    trackFps(now)
    while (acc >= frameMs) {
      acc -= frameMs
      let f = editorState.currentFrame + 1
      if (f > editorState.totalFrames) {
        if (editorState.loop) f = 0
        else {
          stopPlayback()
          return
        }
      }
      editorState.currentFrame = f
      requestPose(true)
    }
    playTimer = requestAnimationFrame(tick)
  }
  playTimer = requestAnimationFrame(tick)
}

export function stopPlayback() {
  editorState.playing = false
  if (playTimer) {
    cancelAnimationFrame(playTimer)
    playTimer = null
  }
}

export function togglePlayback() {
  editorState.playing ? stopPlayback() : startPlayback()
}

function trackFps(now) {
  fpsAccum += now - lastFrameTime
  lastFrameTime = now
  fpsCount++
  if (fpsAccum >= 500) {
    editorState.stats.fps = Math.round((fpsCount * 1000) / fpsAccum)
    fpsAccum = 0
    fpsCount = 0
  }
}

export function setTotalFrames(n) {
  editorState.totalFrames = Math.max(1, Math.min(MAX_FRAMES, Math.round(n)))
  if (editorState.currentFrame > editorState.totalFrames) {
    editorState.currentFrame = editorState.totalFrames
    requestPose(true)
  }
}

/** 批量改角度时让在途 Worker 结果立即失效 */
export function invalidateWorkers() {
  pool?.invalidate()
  highToken++
}

export function disposeEditor() {
  stopPlayback()
  pool?.dispose()
  pool = null
}
