import * as THREE from 'three'
import type { Grade, GradeThresholds, Hold } from '@/types'
import { GRADES } from '@/types'

/** V0-V8 色带配色（冷色 → 暖色 → 深红，难度越高越烈） */
export const GRADE_COLORS: Record<Grade, string> = {
  V0: '#2ecc71',
  V1: '#7ed321',
  V2: '#f8e71c',
  V3: '#f5a623',
  V4: '#f8813b',
  V5: '#f5613c',
  V6: '#e84035',
  V7: '#c0272d',
  V8: '#7a1230',
}

export const DEFAULT_THRESHOLDS: GradeThresholds = {
  // 平均间距（米）：达到 V_k 档至少需要的间距
  spacing: [0.22, 0.3, 0.4, 0.52, 0.65, 0.8, 0.95, 1.12, 1.3],
  // 平均转角（度）：相邻行进方向的平均折角
  angle: [8, 14, 20, 27, 35, 43, 52, 62, 72],
}

export interface RouteMetrics {
  avgSpacing: number
  avgAngle: number
  spacingLevel: number
  angleLevel: number
  grade: Grade
  /** 每一段（相邻两岩点）的局部难度档，用于弧线上的色带 */
  segmentGrades: Grade[]
}

/** 统计低于/等于 value 的阈值数量，即该指标达到的档位 0..8 */
function levelOf(thresholds: number[], value: number): number {
  let level = 0
  for (const t of thresholds) {
    if (value >= t) level++
    else break
  }
  return Math.min(level, 8)
}

/**
 * 根据岩点序列计算难度指标。
 * 间距：相邻岩点欧氏距离均值；
 * 角度：相邻行进方向向量之间的折角均值（首段以岩壁法线为基准方向）。
 */
export function computeRouteMetrics(
  orderedHolds: Hold[],
  thresholds: GradeThresholds,
): RouteMetrics | null {
  if (orderedHolds.length < 2) return null

  const spacings: number[] = []
  const angles: number[] = []
  const segmentGrades: Grade[] = []

  let prevDir: THREE.Vector3 | null = null
  for (let i = 1; i < orderedHolds.length; i++) {
    const a = new THREE.Vector3(...orderedHolds[i - 1].position)
    const b = new THREE.Vector3(...orderedHolds[i].position)
    const dir = b.clone().sub(a)
    const dist = dir.length()
    spacings.push(dist)
    dir.normalize()

    if (prevDir) {
      const cos = THREE.MathUtils.clamp(prevDir.dot(dir), -1, 1)
      angles.push(THREE.MathUtils.radToDeg(Math.acos(cos)))
    } else {
      // 首段：与起步点法线的夹角（衡量起步是否压向墙面）
      const n = new THREE.Vector3(...orderedHolds[0].normal)
      const cos = THREE.MathUtils.clamp(n.dot(dir), -1, 1)
      angles.push(THREE.MathUtils.radToDeg(Math.acos(cos)))
    }
    prevDir = dir
  }

  const avgSpacing = spacings.reduce((s, v) => s + v, 0) / spacings.length
  const avgAngle = angles.reduce((s, v) => s + v, 0) / angles.length
  const spacingLevel = levelOf(thresholds.spacing, avgSpacing)
  const angleLevel = levelOf(thresholds.angle, avgAngle)
  const gradeIndex = THREE.MathUtils.clamp(
    Math.round((spacingLevel + angleLevel) / 2),
    0,
    8,
  )

  // 局部分档：每段用自身间距与转角评定，驱动弧线段色带
  for (let i = 0; i < spacings.length; i++) {
    const sL = levelOf(thresholds.spacing, spacings[i])
    const aL = levelOf(thresholds.angle, angles[i])
    segmentGrades.push(GRADES[THREE.MathUtils.clamp(Math.round((sL + aL) / 2), 0, 8)])
  }

  return {
    avgSpacing,
    avgAngle,
    spacingLevel,
    angleLevel,
    grade: GRADES[gradeIndex],
    segmentGrades,
  }
}
