/** 纯几何工具(不依赖 three,Worker 与主线程均可复用) */

/**
 * 依据第 0 帧距离推断成键对。
 * 经验阈值:距离 < 1.85 Å,且每个原子最多保留 4 个最近邻,避免密堆积误连。
 */
export function inferBonds(positions: Float32Array, atomCount: number): Uint32Array {
  const THRESHOLD = 1.85
  const MAX_NEIGHBORS = 4
  const neighbors: number[][] = Array.from({ length: atomCount }, () => [])
  const d2Limit = THRESHOLD * THRESHOLD

  for (let i = 0; i < atomCount; i++) {
    for (let j = i + 1; j < atomCount; j++) {
      const dx = positions[i * 3] - positions[j * 3]
      const dy = positions[i * 3 + 1] - positions[j * 3 + 1]
      const dz = positions[i * 3 + 2] - positions[j * 3 + 2]
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < d2Limit) {
        neighbors[i].push(j)
        neighbors[j].push(i)
      }
    }
  }

  const pairs: number[] = []
  for (let i = 0; i < atomCount; i++) {
    const list = neighbors[i].sort((a, b) => dist2(positions, i, a) - dist2(positions, i, b)).slice(0, MAX_NEIGHBORS)
    for (const j of list) if (j > i) pairs.push(i, j)
  }
  return Uint32Array.from(pairs)
}

function dist2(p: Float32Array, a: number, b: number): number {
  const dx = p[a * 3] - p[b * 3]
  const dy = p[a * 3 + 1] - p[b * 3 + 1]
  const dz = p[a * 3 + 2] - p[b * 3 + 2]
  return dx * dx + dy * dy + dz * dz
}

/** 求原子集合的质心与包围球半径 */
export function boundingSphere(positions: Float32Array, atomCount: number): { center: [number, number, number]; radius: number } {
  let cx = 0
  let cy = 0
  let cz = 0
  for (let i = 0; i < atomCount; i++) {
    cx += positions[i * 3]
    cy += positions[i * 3 + 1]
    cz += positions[i * 3 + 2]
  }
  cx /= atomCount
  cy /= atomCount
  cz /= atomCount
  let radius = 0
  for (let i = 0; i < atomCount; i++) {
    const dx = positions[i * 3] - cx
    const dy = positions[i * 3 + 1] - cy
    const dz = positions[i * 3 + 2] - cz
    radius = Math.max(radius, Math.hypot(dx, dy, dz))
  }
  return { center: [cx, cy, cz], radius: Math.max(radius, 1) }
}
