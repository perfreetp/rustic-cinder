/** 应用核心数据类型 */

export interface AtomMeta {
  id: number
  /** 元素符号,如 C / O / N */
  element: string
  /** 残基名,如 ALA(自定义 JSON 可携带,XYZ 缺省按元素回退) */
  residue?: string
  /** 残基序号 */
  residueId?: number
  /** 原子名,如 CA */
  atomName?: string
}

export interface Trajectory {
  id: string
  name: string
  frameCount: number
  atomCount: number
  atoms: AtomMeta[]
  /** 长度 frameCount * atomCount * 3 的扁平坐标缓冲 */
  positions: Float32Array
  /** 每帧名义时间间隔(秒),仅用于导出动画节奏 */
  frameDelta: number
  createdAt: number
}

export interface TrajectorySummary {
  id: string
  name: string
  frameCount: number
  atomCount: number
  sizeBytes: number
  createdAt: number
}

export type InterpMode = 'linear' | 'smooth'
export type ColorMode = 'element' | 'displacement'

/** Worker 插值返回的一帧结果 */
export interface InterpolatedFrame {
  positions: Float32Array
  /** 所在关键帧下标(下界) */
  frameIndex: number
  /** 到下一帧的插值因子 0~1 */
  fraction: number
}
