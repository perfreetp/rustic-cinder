/// <reference lib="webworker" />
import type { WorkerInMessage, WorkerOutMessage } from './protocol'

/**
 * 插值 Worker:
 *  - 持有整条轨迹的坐标(init 时 transfer,主线程不再复制)
 *  - 线性插值 / Catmull-Rom 平滑插值
 *  - init 阶段一次性计算每原子累计位移(着色与 Top10 分析共用)
 * 结果通过 transfer 回传,零拷贝。
 */
let positions: Float32Array | null = null
let frameCount = 0
let atomCount = 0
let output: Float32Array | null = null
let cumulative: Float32Array | null = null

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (ev: MessageEvent<WorkerInMessage>) => {
  const msg = ev.data
  if (msg.type === 'init') {
    positions = new Float32Array(msg.positions)
    frameCount = msg.frameCount
    atomCount = msg.atomCount
    output = new Float32Array(atomCount * 3)
    cumulative = computeCumulative(positions, frameCount, atomCount)
    const reply: WorkerOutMessage = {
      type: 'init',
      cumulative: cumulative.buffer.slice(0),
    }
    ctx.postMessage(reply)
    return
  }

  if (!positions) return
  const { time, mode, seq } = msg
  const result = interpolate(positions, frameCount, atomCount, time, mode)
  const reply: WorkerOutMessage = {
    type: 'frame',
    seq,
    // transfer 后该 buffer 所有权移交主线程,下一帧在 ensureOutput 中重新分配
    positions: result.buffer,
    frameIndex: result.frameIndex,
    fraction: result.fraction,
  }
  ctx.postMessage(reply, [reply.positions as ArrayBuffer])
  output = null
}

function ensureOutput(): Float32Array {
  if (!output) output = new Float32Array(atomCount * 3)
  return output
}

interface InterpResult {
  frameIndex: number
  fraction: number
  buffer: ArrayBufferLike
}

function interpolate(
  src: Float32Array,
  frames: number,
  atoms: number,
  time: number,
  mode: 'linear' | 'smooth',
): InterpResult {
  const clamped = Math.min(frames - 1, Math.max(0, time))
  const i0 = Math.min(frames - 2, Math.max(0, Math.floor(clamped)))
  const t = frames === 1 ? 0 : clamped - i0
  const dst = ensureOutput()
  const stride = atoms * 3

  if (mode === 'linear' || frames < 2) {
    const a = i0 * stride
    const b = (i0 + 1) * stride
    for (let k = 0; k < stride; k++) {
      dst[k] = src[a + k] + (src[b + k] - src[a + k]) * t
    }
  } else {
    // 均匀 Catmull-Rom,端点处复制边界帧
    const iPrev = Math.max(0, i0 - 1)
    const iNext = Math.min(frames - 1, i0 + 2)
    const p0 = iPrev * stride
    const p1 = i0 * stride
    const p2 = (i0 + 1) * stride
    const p3 = iNext * stride
    const t2 = t * t
    const t3 = t2 * t
    // 标准基函数
    const w0 = -0.5 * t3 + t2 - 0.5 * t
    const w1 = 1.5 * t3 - 2.5 * t2 + 1
    const w2 = -1.5 * t3 + 2 * t2 + 0.5 * t
    const w3 = 0.5 * t3 - 0.5 * t2
    for (let k = 0; k < stride; k++) {
      dst[k] = w0 * src[p0 + k] + w1 * src[p1 + k] + w2 * src[p2 + k] + w3 * src[p3 + k]
    }
  }

  return { frameIndex: i0, fraction: t, buffer: dst.buffer }
}

function computeCumulative(src: Float32Array, frames: number, atoms: number): Float32Array {
  const cum = new Float32Array(atoms)
  if (frames < 2) return cum
  const stride = atoms * 3
  for (let f = 1; f < frames; f++) {
    const prev = (f - 1) * stride
    const cur = f * stride
    for (let i = 0; i < atoms; i++) {
      const dx = src[cur + i * 3] - src[prev + i * 3]
      const dy = src[cur + i * 3 + 1] - src[prev + i * 3 + 1]
      const dz = src[cur + i * 3 + 2] - src[prev + i * 3 + 2]
      cum[i] += Math.sqrt(dx * dx + dy * dy + dz * dz)
    }
  }
  return cum
}
