import * as THREE from 'three'
import type { Hold, WallDataset } from '@/types'
import { HOLD_COLORS } from '@/types'

/** 确定性伪随机，保证每次加载得到同一套岩壁/岩点编号 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const WALL_WIDTH = 8
export const WALL_HEIGHT = 5

/**
 * 岩壁高度场：x/y 决定墙面 z（朝向攀爬者为 +z）。
 * 带仰角（越高越向外）+ 起伏波浪，模拟室内造型墙。
 */
export function wallZ(x: number, y: number): number {
  const overhang = 0.12 * y
  const wave =
    0.18 * Math.sin(1.3 * x) * Math.cos(0.9 * y) +
    0.1 * Math.sin(2.1 * x + 1.7 * y) +
    0.12 * Math.cos(0.6 * x - 0.8 * y)
  return overhang + wave
}

/** 高度场法线（有限差分），指向 +z 一侧 */
export function wallNormal(x: number, y: number): THREE.Vector3 {
  const e = 0.02
  const dx = (wallZ(x + e, y) - wallZ(x - e, y)) / (2 * e)
  const dy = (wallZ(x, y + e) - wallZ(x, y - e)) / (2 * e)
  // z = f(x,y) 曲面法线：(-fx, -fy, 1)
  return new THREE.Vector3(-dx, -dy, 1).normalize()
}

/**
 * 生成演示岩壁数据：
 * - 岩壁 100x100 网格 = 20000 三角面
 * - 30x40 抖动栅格 = 1200 个岩点实例
 */
export function createDemoDataset(seed = 20261124): WallDataset {
  const rand = mulberry32(seed)

  // ---- 岩壁网格（约 2 万面）----
  const geometry = new THREE.PlaneGeometry(
    WALL_WIDTH,
    WALL_HEIGHT,
    100,
    100,
  )
  geometry.translate(0, WALL_HEIGHT / 2, 0)
  const pos = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    pos.setZ(i, wallZ(x, y))
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  // ---- 1200 个岩点 ----
  const cols = 30
  const rows = 40
  const holds: Hold[] = []
  let id = 1
  const dx = WALL_WIDTH / cols
  const dy = WALL_HEIGHT / rows

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x =
        -WALL_WIDTH / 2 + (c + 0.5) * dx + (rand() - 0.5) * dx * 0.7
      const y = (r + 0.5) * dy + (rand() - 0.5) * dy * 0.7
      const n = wallNormal(x, y)
      const z = wallZ(x, y) + 0.035
      holds.push({
        id: id++,
        position: [x, y, z],
        normal: [n.x, n.y, n.z],
        color: HOLD_COLORS[Math.floor(rand() * HOLD_COLORS.length)],
        scale: 0.055 + rand() * 0.06,
      })
    }
  }

  // 指纹：编号数量 + 首尾岩点坐标，导入时校验是否同一面墙
  const first = holds[0]
  const last = holds[holds.length - 1]
  const fingerprint = `wall:${holds.length}:${first.position.map((v) => v.toFixed(3)).join(',')}:${last.position
    .map((v) => v.toFixed(3))
    .join(',')}`

  return { fingerprint, wallGeometry: geometry, holds }
}
