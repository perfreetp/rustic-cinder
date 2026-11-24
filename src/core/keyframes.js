/**
 * 折痕角度关键帧：存储、采样（线性插值）、序列化。
 * 动画时长上限 120 帧。
 */
export const MAX_FRAMES = 120
export const DEFAULT_FPS = 30

/** 对单条折痕在指定帧采样角度（度），线性插值，越界夹紧 */
export function sampleAngle(keyframes, frame) {
  if (!keyframes || keyframes.length === 0) return 0
  const kf = [...keyframes].sort((a, b) => a.frame - b.frame)
  if (frame <= kf[0].frame) return kf[0].angle
  const last = kf[kf.length - 1]
  if (frame >= last.frame) return last.angle
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i]
    const b = kf[i + 1]
    if (frame >= a.frame && frame <= b.frame) {
      const t = (frame - a.frame) / Math.max(1, b.frame - a.frame)
      return a.angle + (b.angle - a.angle) * t
    }
  }
  return last.angle
}

/** 对全部折痕采样一帧的角度表 */
export function sampleFrame(tracks, frame) {
  const angles = {}
  for (const [creaseId, keyframes] of Object.entries(tracks)) {
    angles[creaseId] = sampleAngle(keyframes, frame)
  }
  return angles
}

export function setKeyframe(tracks, creaseId, frame, angle) {
  frame = Math.max(0, Math.min(MAX_FRAMES, Math.round(frame)))
  if (!tracks[creaseId]) tracks[creaseId] = []
  const list = tracks[creaseId]
  const idx = list.findIndex((k) => k.frame === frame)
  if (idx >= 0) list[idx] = { frame, angle }
  else {
    list.push({ frame, angle })
    list.sort((a, b) => a.frame - b.frame)
  }
}

export function removeKeyframe(tracks, creaseId, frame) {
  const list = tracks[creaseId]
  if (!list) return
  tracks[creaseId] = list.filter((k) => k.frame !== frame)
}

export function removeCreaseTrack(tracks, creaseId) {
  delete tracks[creaseId]
}

export function countKeyframes(tracks) {
  return Object.values(tracks).reduce((n, list) => n + list.length, 0)
}

/** 关键帧文件格式（导出/导入） */
export function serializeKeyframes({
  tracks,
  totalFrames,
  fps,
  modelName,
  creaseTypes
}) {
  return JSON.stringify(
    {
      format: 'crease-fold-keyframes',
      version: 1,
      modelName: modelName ?? 'untitled',
      fps,
      totalFrames,
      exportedAt: new Date().toISOString(),
      creases: Object.entries(tracks).map(([id, keyframes]) => ({
        id,
        type: creaseTypes?.[id] ?? null,
        keyframes: keyframes.map((k) => ({ frame: k.frame, angle: k.angle }))
      }))
    },
    null,
    2
  )
}

export function parseKeyframes(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json
  if (data.format !== 'crease-fold-keyframes') {
    throw new Error('关键帧文件格式不匹配')
  }
  const tracks = {}
  for (const c of data.creases || []) {
    tracks[c.id] = c.keyframes.map((k) => ({ ...k }))
  }
  return {
    tracks,
    totalFrames: Math.min(MAX_FRAMES, data.totalFrames ?? MAX_FRAMES),
    fps: data.fps ?? DEFAULT_FPS
  }
}
