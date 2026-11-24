/**
 * 折痕树重算 Worker：
 *  - 子树姿态矩阵 BFS（solveSubtrees）
 *  - 高精度顶点变换（按所属面分区，回传紧凑缓冲 + 偏移，transfer 回主线程）
 * 纯计算，不接触 DOM/WebGL。
 */
import { solveSubtrees } from '../core/solver.js'
import { transformPoint } from '../core/math.js'

let seq = 0

self.onmessage = (e) => {
  const msg = e.data
  if (!msg || msg.type !== 'solve') return
  const { requestId, payload } = msg
  try {
    const entries = new Map(
      payload.entries.map(([faceId, m]) => [faceId, Float32Array.from(m)])
    )
    const owned = new Set(payload.owned)
    const mats = solveSubtrees(payload.hinges, payload.angles, entries, owned)

    // 只变换本 Worker 负责的面，逐 range 产出紧凑分区，
    // 避免回传全尺寸缓冲时未负责区域的零值在主线程互相覆盖
    const parts = []
    const transferables = []
    if (payload.base && payload.ranges && payload.ranges.length) {
      const base = new Float32Array(payload.base)
      for (const r of payload.ranges) {
        const m = mats.get(r.faceId)
        if (!m) continue
        const start = r.vertexStart * 3
        const count = r.vertexCount * 3
        const data = new Float32Array(count)
        for (let i = 0; i < count; i += 3) {
          const p = transformPoint(m, [
            base[start + i],
            base[start + i + 1],
            base[start + i + 2]
          ])
          data[i] = p[0]
          data[i + 1] = p[1]
          data[i + 2] = p[2]
        }
        parts.push({ offset: start, data })
        transferables.push(data.buffer)
      }
    }

    self.postMessage(
      {
        type: 'result',
        requestId,
        workerSeq: seq++,
        payload: {
          matrices: [...mats.entries()].map(([faceId, m]) => [
            faceId,
            Array.from(m)
          ]),
          parts
        }
      },
      transferables
    )
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      message: String(err && err.stack ? err.stack : err)
    })
  }
}
