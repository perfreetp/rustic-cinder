import type { InterpMode } from '../types'

export interface WorkerInitMessage {
  type: 'init'
  positions: ArrayBufferLike
  frameCount: number
  atomCount: number
}

export interface WorkerRequestMessage {
  type: 'request'
  /** 连续时间,范围 [0, frameCount - 1] */
  time: number
  mode: InterpMode
  /** 单调请求序号,过期结果会被丢弃 */
  seq: number
}

export type WorkerInMessage = WorkerInitMessage | WorkerRequestMessage

export interface WorkerFrameResult {
  type: 'frame'
  seq: number
  positions: ArrayBufferLike
  frameIndex: number
  fraction: number
}

export interface WorkerInitResult {
  type: 'init'
  /** 每个原子从首帧起的累计位移长度 */
  cumulative: ArrayBufferLike
}

export type WorkerOutMessage = WorkerFrameResult | WorkerInitResult
