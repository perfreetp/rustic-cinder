// 全局共享类型定义

/** 岩点颜色类别（馆内常用岩点色） */
export type HoldColor =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'purple'
  | 'white'
  | 'black'

export const HOLD_COLORS: HoldColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'orange',
  'purple',
  'white',
  'black',
]

/** 岩点实例：定位在岩壁局部坐标系中 */
export interface Hold {
  /** 岩点编号，全局唯一，导入导出以此回填 */
  id: number
  /** 世界/岩壁局部坐标（岩壁建模时即放在原点，二者一致） */
  position: [number, number, number]
  /** 朝外单位法线（朝向攀爬者） */
  normal: [number, number, number]
  color: HoldColor
  /** 岩点几何尺寸（用于实例缩放与拖拽容差） */
  scale: number
}

export type EndpointKind = 'start' | 'bonus' | 'top'

/** 路线中的一个岩点条目 */
export interface RouteHold {
  holdId: number
  /** 端点样式，普通点为 null */
  endpoint: EndpointKind | null
}

/** V0 - V8 难度等级 */
export type Grade = `V${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`

export const GRADES: Grade[] = [
  'V0',
  'V1',
  'V2',
  'V3',
  'V4',
  'V5',
  'V6',
  'V7',
  'V8',
]

/** 色带阈值配置：间距（米）与转角（度）超过阈值则升档 */
export interface GradeThresholds {
  /** 相邻岩点平均间距阈值，逐档递增 */
  spacing: number[]
  /** 相邻岩点法线/方向夹角阈值，逐档递增（度） */
  angle: number[]
}

/** 导出/持久化的路线 JSON 结构 */
export interface RouteData {
  version: 1
  id: string
  name: string
  color: string
  createdAt: number
  updatedAt: number
  /** 有序岩点编号序列 */
  holds: RouteHold[]
  thresholds: GradeThresholds
  /** 归档时计算的难度，仅作展示 */
  grade: Grade
  /** 对应岩壁数据指纹，导入时校验 */
  wallFingerprint: string
}

/** 岩点几何资产（演示数据/外部加载统一入口） */
export interface WallDataset {
  fingerprint: string
  wallGeometry: import('three').BufferGeometry
  holds: Hold[]
}
