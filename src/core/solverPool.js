/**
 * 主线程求解器封装：
 *  - 小模型/无 Worker 时走同步回退（同一份纯函数）
 *  - 大模型按折痕树分块派发到 Worker 池并行求解
 *  - 请求带 requestId，过期结果自动丢弃，绝不回写到更新的姿态
 */
import PoseWorker from '../workers/poseWorker.js?worker'
import {
  solvePoses,
  transformRanges,
  partitionTree
} from '../core/solver.js'

function getHardwareConcurrency() {
  try {
    return Math.max(2, Math.min(6, navigator.hardwareConcurrency || 4))
  } catch {
    return 4
  }
}

export class SolverPool {
  constructor(size) {
    this.size = size ?? getHardwareConcurrency()
    this.workers = []
    this.available = []
    this.queue = []
    this.requestSeq = 0
    this.enabled = typeof Worker !== 'undefined'
    this._initWorkers()
  }

  _initWorkers() {
    if (!this.enabled) return
    try {
      for (let i = 0; i < this.size; i++) {
        const w = new PoseWorker()
        this.workers.push(w)
        this.available.push(w)
      }
    } catch (err) {
      console.warn('[SolverPool] Worker 初始化失败，回退同步求解', err)
      this.enabled = false
      this.workers = []
      this.available = []
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate()
    this.workers = []
    this.available = []
    this.queue = []
  }

  /**
   * 求解一帧姿态。
   * @param {Object} model buildModel 产物
   * @param {Object} angles {creaseId: 角度（度）}
   * @param {Object} meshes 可选 { base: Float32Array, rangesByFace: Map }
   * @param {boolean} highQuality 是否计算高精度顶点（Worker 路径才异步）
   * @returns {Promise<{matrices:Map, positions:Float32Array|null, requestId:number}>}
   */
  solve(model, angles, meshes = null, highQuality = true) {
    const requestId = ++this.requestSeq
    const rootFaceIds = [model.rootFaceId]

    // 同步路径：面数少或 Worker 不可用
    if (!this.enabled || model.faces.length < 24 || !highQuality) {
      const matrices = solvePoses(model.hinges, angles, rootFaceIds)
      let positions = null
      if (meshes && meshes.base) {
        positions = transformRanges(meshes.base, meshes.ranges, matrices)
      }
      return Promise.resolve({ matrices, positions, requestId })
    }

    return this._dispatchParallel(model, angles, meshes, requestId)
  }

  _dispatchParallel(model, angles, meshes, requestId) {
    const chunks = partitionTree(
      model.hinges,
      angles,
      [model.rootFaceId],
      this.size
    )
    return new Promise((resolve, reject) => {
      const matrices = new Map()
      matrices.set(model.rootFaceId, identityArray())
      // 以基准顶点初始化，各 Worker 只覆盖自己负责的分区偏移
      let positions = null
      if (meshes && meshes.base) positions = meshes.base.slice()

      let pending = 0
      let settled = false

      const finish = () => {
        if (settled) return
        settled = true
        if (requestId !== this.requestSeq) {
          reject(new Error('stale'))
          return
        }
        resolve({ matrices, positions, requestId })
      }

      chunks.forEach((chunk, idx) => {
        const ranges = meshes
          ? meshes.ranges.filter((r) => chunk.owned.has(r.faceId))
          : []
        // 每个 Worker 需要独立的 base 副本：同一 ArrayBuffer 不能被
        // 多次结构化克隆/转移，否则第二个 Worker 抛 DOMException
        const base =
          meshes && ranges.length ? meshes.base.slice() : null
        pending++
        const payload = {
          hinges: model.hinges,
          angles,
          entries: [...chunk.entries.entries()].map(([fid, m]) => [
            fid,
            Array.from(m)
          ]),
          owned: [...chunk.owned],
          base,
          ranges
        }
        this._run(payload)
          .then((res) => {
            if (requestId !== this.requestSeq) {
              if (--pending === 0) reject(new Error('stale'))
              return
            }
            for (const [fid, m] of res.matrices) matrices.set(fid, m)
            // 紧凑分区按偏移回填，互不重叠
            if (res.parts && positions) {
              for (const part of res.parts) {
                positions.set(part.data, part.offset)
              }
            }
            if (--pending === 0) finish()
          })
          .catch((err) => {
            if (!settled) {
              settled = true
              reject(err)
            }
          })
      })
    })
  }

  _run(payload) {
    return new Promise((resolve, reject) => {
      const task = { payload, resolve, reject }
      const w = this.available.pop()
      if (w) this._launch(w, task)
      else this.queue.push(task)
    })
  }

  _launch(w, task) {
    const onMsg = (e) => {
      w.removeEventListener('message', onMsg)
      w.removeEventListener('error', onErr)
      this.available.push(w)
      this._pump()
      const msg = e.data
      if (msg.type === 'result') task.resolve(msg.payload)
      else task.reject(new Error(msg.message || 'worker error'))
    }
    const onErr = (err) => {
      w.removeEventListener('message', onMsg)
      w.removeEventListener('error', onErr)
      this.available.push(w)
      this._pump()
      task.reject(err)
    }
    w.addEventListener('message', onMsg)
    w.addEventListener('error', onErr)
    w.postMessage({ type: 'solve', requestId: -1, payload: task.payload })
  }

  _pump() {
    while (this.available.length && this.queue.length) {
      const w = this.available.pop()
      const task = this.queue.shift()
      this._launch(w, task)
    }
  }

  /** 使所有在途结果失效（角度已被更新的请求取代） */
  invalidate() {
    this.requestSeq++
  }
}

function identityArray() {
  const m = new Array(16).fill(0)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}
