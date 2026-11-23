import * as THREE from 'three'
import type { Hold } from '@/types'
import { GRADE_COLORS, type RouteMetrics } from './grade'

export interface CurveBuildResult {
  geometry: THREE.BufferGeometry
  /** 弧线总长度（米） */
  length: number
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _n = new THREE.Vector3()
const _tan = new THREE.Vector3()
const _side = new THREE.Vector3()
const _center = new THREE.Vector3()
const _c1 = new THREE.Color()
const _c2 = new THREE.Color()

/**
 * 由有序岩点构建平滑路线弧。
 *
 * - 锚点沿各岩点法线向外侧（攀爬者一侧）偏移 offset；
 * - Catmull-Rom 样条做平滑，centripetal 参数化避免过冲；
 * - 曲线重采样后生成管状几何，顶点色按段难度色带插值；
 * - 拖动中间岩点时以新锚点重新调用本函数即可重算全部切线。
 */
export function buildRouteCurve(
  orderedHolds: Hold[],
  metrics: RouteMetrics | null,
  offset = 0.18,
  radius = 0.022,
  fallbackColorHex = '#3aa0ff',
): CurveBuildResult | null {
  if (orderedHolds.length < 2) return null

  const anchors = orderedHolds.map((h) =>
    new THREE.Vector3(...h.position).addScaledVector(
      _n.set(...h.normal).normalize(),
      offset,
    ),
  )

  const curve = new THREE.CatmullRomCurve3(anchors, false, 'centripetal', 0.5)
  const length = curve.getLength()

  // 每个岩点间隔至少 12 段，保证拖动后切线过渡平滑
  const tubularSegments = Math.max(32, (orderedHolds.length - 1) * 16)
  const radialSegments = 8

  // 各锚点在弧长上的累计位置，用于把段色带映射到采样点
  const anchorLens: number[] = [0]
  for (let i = 1; i < anchors.length; i++) {
    anchorLens[i] = anchorLens[i - 1] + anchors[i].distanceTo(anchors[i - 1])
  }
  const totalAnchorLen = anchorLens[anchorLens.length - 1] || 1

  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  const segmentColors =
    metrics?.segmentGrades.map((g) => new THREE.Color(GRADE_COLORS[g])) ?? []
  const fallback = new THREE.Color(fallbackColorHex)

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments
    curve.getPointAt(t, _center)
    curve.getTangentAt(t, _tan).normalize()

    // 以最近岩点法线作为管壁参考朝向，避免 Frenet 标架翻转
    const distAlong = t * totalAnchorLen
    let seg = 0
    while (seg < anchorLens.length - 2 && anchorLens[seg + 1] < distAlong) seg++
    const hold = orderedHolds[Math.min(seg, orderedHolds.length - 1)]
    _n.set(...hold.normal).normalize()
    _side.crossVectors(_tan, _n)
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0)
    _side.normalize()
    _n.crossVectors(_side, _tan).normalize()

    // 当前点的色带：在相邻两段颜色间按弧长插值
    let color: THREE.Color
    if (segmentColors.length) {
      const localT =
        (distAlong - anchorLens[seg]) /
        Math.max(1e-6, anchorLens[seg + 1] - anchorLens[seg])
      _c1.copy(segmentColors[Math.min(seg, segmentColors.length - 1)])
      _c2.copy(segmentColors[Math.min(seg + 1, segmentColors.length - 1)])
      color = _c1.clone().lerp(_c2, THREE.MathUtils.clamp(localT, 0, 1))
    } else {
      color = fallback
    }

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2
      const cos = Math.cos(v)
      const sin = Math.sin(v)
      _a.copy(_center)
        .addScaledVector(_n, cos * radius)
        .addScaledVector(_side, sin * radius)
      positions.push(_a.x, _a.y, _a.z)
      _b.copy(_a).sub(_center).normalize()
      normals.push(_b.x, _b.y, _b.z)
      colors.push(color.r, color.g, color.b)
    }
  }

  const ring = radialSegments + 1
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = ring * i + j
      const b = ring * (i + 1) + j
      const c = ring * (i + 1) + j + 1
      const d = ring * i + j + 1
      indices.push(a, b, d, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()

  return { geometry, length }
}
