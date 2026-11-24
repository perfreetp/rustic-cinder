// Node worker_threads 版求解 Worker，复刻浏览器 poseWorker.js 的处理逻辑。
// 只回传本 Worker 负责分区的紧凑缓冲（offset + data），而非全尺寸数组，
// 避免主线程合并时不同 Worker 的未初始化零值互相覆盖。
import { parentPort, workerData } from 'node:worker_threads'
import { solveSubtrees } from '../src/core/solver.js'
import { transformPoint } from '../src/core/math.js'

const payload = workerData
const entries = new Map(
  payload.entries.map(([faceId, m]) => [faceId, Float32Array.from(m)])
)
const owned = new Set(payload.owned)
const mats = solveSubtrees(payload.hinges, payload.angles, entries, owned)
const base = new Float32Array(payload.base)

// 逐 range 产出紧凑分区
const parts = []
for (const r of payload.ranges) {
  const m = mats.get(r.faceId)
  if (!m) continue
  const start = r.vertexStart * 3
  const count = r.vertexCount * 3
  const data = new Float32Array(count)
  for (let i = 0; i < count; i += 3) {
    const p = transformPoint(m, [base[start + i], base[start + i + 1], base[start + i + 2]])
    data[i] = p[0]; data[i + 1] = p[1]; data[i + 2] = p[2]
  }
  parts.push({ offset: start, data })
}

parentPort.postMessage({
  matrices: [...mats.entries()].map(([faceId, m]) => [faceId, Array.from(m)]),
  parts
})
