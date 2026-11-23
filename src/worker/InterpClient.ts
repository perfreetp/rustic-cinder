import type { InterpMode, Trajectory } from '../types'
import type { WorkerInMessage, WorkerOutMessage } from './protocol'
import InterpWorker from './interp.worker.ts?worker'

export interface FrameResult {
  positions: Float32Array
  frameIndex: number
  fraction: number
}

/**
 * Worker 客户端。
 * 性能关键:同一时刻只允许一个请求在飞,拖动时间轴产生的新请求只保留最新一个,
 * 千帧轨迹快速拖动也不会在 Worker 消息队列里堆积任务。
 */
export class InterpClient {
  private worker: Worker
  private seq = 0
  private inFlight = false
  private pending: { time: number; mode: InterpMode; seq: number } | null = null
  private waiters = new Map<number, (r: FrameResult) => void>()
  private initWaiter: ((cum: Float32Array) => void) | null = null
  private disposed = false

  constructor() {
    this.worker = new InterpWorker()
    this.worker.onmessage = (ev: MessageEvent<WorkerOutMessage>) => this.handle(ev.data)
  }

  /** 载入轨迹:transfer 一份坐标副本,返回每原子累计位移 */
  init(traj: Trajectory): Promise<Float32Array> {
    this.seq = 0
    this.pending = null
    this.inFlight = false
    this.waiters.clear()
    const buffer = traj.positions.buffer.slice(0) as ArrayBuffer
    this.worker.postMessage(
      {
        type: 'init',
        positions: buffer,
        frameCount: traj.frameCount,
        atomCount: traj.atomCount,
      } satisfies WorkerInMessage,
      [buffer],
    )
    return new Promise((resolve) => {
      this.initWaiter = resolve
    })
  }

  /** 请求某一时刻的插值帧;同一时刻的旧请求会被合并丢弃 */
  request(time: number, mode: InterpMode): Promise<FrameResult> {
    if (this.disposed) return Promise.reject(new Error('worker disposed'))
    const seq = ++this.seq
    return new Promise((resolve) => {
      this.waiters.set(seq, resolve)
      const job = { time, mode, seq }
      if (!this.inFlight) {
        this.inFlight = true
        this.fire(job)
      } else {
        // 排队中若已有请求,作废其回调,只保留最新
        if (this.pending) this.waiters.delete(this.pending.seq)
        this.pending = job
      }
    })
  }

  dispose(): void {
    this.disposed = true
    this.worker.terminate()
    this.waiters.clear()
    this.pending = null
  }

  private fire(job: { time: number; mode: InterpMode; seq: number }): void {
    this.worker.postMessage({ type: 'request', time: job.time, mode: job.mode, seq: job.seq } satisfies WorkerInMessage)
  }

  private handle(msg: WorkerOutMessage): void {
    if (msg.type === 'init') {
      const resolve = this.initWaiter
      this.initWaiter = null
      resolve?.(new Float32Array(msg.cumulative))
      return
    }
    const resolve = this.waiters.get(msg.seq)
    this.waiters.delete(msg.seq)
    this.inFlight = false
    if (this.pending) {
      const next = this.pending
      this.pending = null
      this.inFlight = true
      this.fire(next)
    }
    resolve?.({ positions: new Float32Array(msg.positions), frameIndex: msg.frameIndex, fraction: msg.fraction })
  }
}
