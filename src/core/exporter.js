/**
 * 导出：逐帧求解 → 渲染 → PNG 序列帧 + 折痕角度关键帧 JSON，打包 ZIP。
 * 导出帧使用高精度姿态，逐帧串行，避免与播放调度竞争 Worker。
 */
import JSZip from 'jszip'
import { sampleFrame, serializeKeyframes, MAX_FRAMES } from '../core/keyframes.js'
import { solvePoses, transformRanges } from '../core/solver.js'
import { editorState } from '../store/editorStore.js'

function dataUrlToBlob(url) {
  const [head, body] = url.split(',')
  const mime = /:(.*?);/.exec(head)[1]
  const bin = atob(body)
  const len = bin.length
  const arr = new Uint8Array(len)
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

/**
 * @param {Object} viewport Viewport 实例
 * @param {(done:number,total:number)=>void} onProgress
 */
export async function exportSequence(viewport, onProgress) {
  const state = editorState
  const { model, meshes, tracks, totalFrames, fps } = state
  if (!model || !meshes) throw new Error('没有可导出的模型')

  const zip = new JSZip()
  const frameFolder = zip.folder('frames')
  const savedFrame = state.currentFrame
  const total = totalFrames + 1

  // 导出期间关闭播放，固定高精度渲染
  const wasPlaying = state.playing
  state.playing = false

  const creaseTypes = {}
  for (const c of model.creases) creaseTypes[c.id] = c.type

  for (let f = 0; f <= totalFrames; f++) {
    const angles = sampleFrame(tracks, f)
    const mats = solvePoses(model.hinges, angles, [model.rootFaceId])
    const positions = transformRanges(
      meshes.high.positions,
      meshes.high.ranges,
      mats
    )
    viewport.applyHighPositions(positions)
    viewport.setQualityMode(true)
    // 等一帧确保合成与阴影完成，再截屏
    await nextFrame()
    viewport.composer.render()
    const url = viewport.capturePNG()
    const name = `frame_${String(f).padStart(4, '0')}.png`
    frameFolder.file(name, dataUrlToBlob(url))
    onProgress?.(f + 1, total)
    // 让出主线程，保持 UI 响应
    if (f % 4 === 0) await new Promise((r) => setTimeout(r, 0))
  }

  const json = serializeKeyframes({
    tracks,
    totalFrames,
    fps,
    modelName: state.modelName,
    creaseTypes
  })
  zip.file('keyframes.json', json)
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        modelName: state.modelName,
        fps,
        totalFrames,
        frameCount: total,
        creaseCount: model.creases.length,
        faceCount: model.faces.length,
        lightRig: state.lightRig,
        maxFrames: MAX_FRAMES,
        exportedAt: new Date().toISOString()
      },
      null,
      2
    )
  )

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'STORE' // PNG 已压缩，不再 deflate
  })

  // 恢复时间轴位置与姿态
  state.currentFrame = savedFrame
  if (wasPlaying) state.playing = true
  return blob
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}
