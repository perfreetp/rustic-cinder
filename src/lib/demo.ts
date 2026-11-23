import type { AtomMeta, Trajectory } from '../types'

/**
 * 生成一条合成蛋白轨迹(默认 1200 帧),用于无文件体验与千帧性能验证。
 * 运动 = 整体扭转 + 呼吸缩放 + 每原子振动 + 10 个"热点"原子的大幅漂移,
 * 因此位移着色与 Top10 分析有明确的可视化差异。
 */
export function generateDemoTrajectory(options?: { residues?: number; frames?: number }): Trajectory {
  const residueCount = options?.residues ?? 24
  const frameCount = options?.frames ?? 1200
  const residueNames = ['ALA', 'GLY', 'SER', 'VAL', 'THR', 'LEU']
  // 每个残基 6 个原子:N / CA / C / O / CB / H
  const template: Array<{ name: string; element: string; kind: 'N' | 'CA' | 'C' | 'O' | 'CB' | 'H' }> = [
    { name: 'N', element: 'N', kind: 'N' },
    { name: 'CA', element: 'C', kind: 'CA' },
    { name: 'C', element: 'C', kind: 'C' },
    { name: 'O', element: 'O', kind: 'O' },
    { name: 'CB', element: 'C', kind: 'CB' },
    { name: 'H', element: 'H', kind: 'H' },
  ]
  const atomsPerResidue = template.length
  const atomCount = residueCount * atomsPerResidue

  // ---- 第 0 帧基准坐标:骨架沿螺旋折线步进,键长 1.45 Å ----
  const base = new Float32Array(atomCount * 3)
  const R = 1.2
  const pointAngleStep = (20 * Math.PI) / 180
  const pointRise = 0.47

  const pathPoint = (index: number): [number, number, number] => {
    const a = index * pointAngleStep
    return [R * Math.cos(a), R * Math.sin(a), index * pointRise]
  }

  for (let r = 0; r < residueCount; r++) {
    const nIdx = r * 3
    const pN = pathPoint(nIdx)
    const pCA = pathPoint(nIdx + 1)
    const pC = pathPoint(nIdx + 2)
    // 切线与径向局部坐标系
    const tangent = normalize(sub(pC, pN))
    const radial = normalize([pCA[0], pCA[1], 0])
    const binormal = cross(tangent, radial)
    const ca = pCA
    const placements: Record<typeof template[number]['kind'], [number, number, number]> = {
      N: pN,
      CA: ca,
      C: pC,
      O: add(pC, scale(add(scale(radial, 0.75), scale(tangent, -0.35)), 1.0)),
      CB: add(ca, scale(add(scale(radial, 1.15), scale(binormal, 0.35)), 1.0)),
      H: add(pN, scale(radial, -0.9)),
    }
    template.forEach((t, k) => {
      const p = placements[t.kind]
      const ai = (r * atomsPerResidue + k) * 3
      base[ai] = p[0]
      base[ai + 1] = p[1]
      base[ai + 2] = p[2]
    })
  }

  const atoms: AtomMeta[] = []
  for (let r = 0; r < residueCount; r++) {
    const resName = residueNames[r % residueNames.length]
    template.forEach((t, k) => {
      atoms.push({
        id: r * atomsPerResidue + k,
        element: t.element,
        residue: resName,
        residueId: r + 1,
        atomName: t.name,
      })
    })
  }

  // 10 个热点原子:最后若干残基的 CB / O,漂移方向确定性随机
  const hotIds = new Set<number>()
  for (let k = 0; k < 10; k++) {
    const r = residueCount - 1 - (k % 5)
    const kind = k < 5 ? 4 /* CB */ : 3 /* O */
    hotIds.add(r * atomsPerResidue + kind)
  }
  const hotDirs = new Map<number, [number, number, number]>()
  hotIds.forEach((id) => {
    const seed = id * 9301 + 49297
    hotDirs.set(id, [
      Math.sin(seed) * 2 + 2.6,
      Math.cos(seed * 1.7) * 1.6,
      Math.sin(seed * 0.7) * 1.2,
    ])
  })

  // 每原子确定性振动参数
  const phase = new Float32Array(atomCount * 3)
  const freq = new Float32Array(atomCount)
  for (let i = 0; i < atomCount; i++) {
    const seed = i * 2654435761
    phase[i * 3] = (Math.sin(seed) + 1) * Math.PI
    phase[i * 3 + 1] = (Math.sin(seed * 1.3) + 1) * Math.PI
    phase[i * 3 + 2] = (Math.sin(seed * 0.7) + 1) * Math.PI
    freq[i] = 1 + (i % 3)
  }

  // 质心
  let cx = 0
  let cy = 0
  let cz = 0
  for (let i = 0; i < atomCount; i++) {
    cx += base[i * 3]
    cy += base[i * 3 + 1]
    cz += base[i * 3 + 2]
  }
  cx /= atomCount
  cy /= atomCount
  cz /= atomCount

  const positions = new Float32Array(frameCount * atomCount * 3)
  for (let f = 0; f < frameCount; f++) {
    const u = frameCount === 1 ? 0 : f / (frameCount - 1)
    const twist = u * 0.8
    const cosT = Math.cos(twist)
    const sinT = Math.sin(twist)
    const breathe = 1 + 0.06 * Math.sin(2 * Math.PI * 1.5 * u)
    const outOffset = f * atomCount * 3
    for (let i = 0; i < atomCount; i++) {
      let x = base[i * 3]
      let y = base[i * 3 + 1]
      let z = base[i * 3 + 2]
      // 绕质心呼吸
      x = cx + (x - cx) * breathe
      y = cy + (y - cy) * breathe
      z = cz + (z - cz) * breathe
      // 绕 Z 扭转
      const dx = x - cx
      const dy = y - cy
      x = cx + dx * cosT - dy * sinT
      y = cy + dx * sinT + dy * cosT
      // 高频振动
      const w = 2 * Math.PI * freq[i] * u
      x += 0.12 * Math.sin(w + phase[i * 3])
      y += 0.12 * Math.sin(w + phase[i * 3 + 1])
      z += 0.12 * Math.sin(w + phase[i * 3 + 2])
      // 热点漂移
      if (hotIds.has(i)) {
        const d = hotDirs.get(i)!
        const amp = u * (0.75 + 0.25 * Math.sin(2 * Math.PI * 2 * u))
        x += d[0] * amp
        y += d[1] * amp
        z += d[2] * amp
      }
      positions[outOffset + i * 3] = x
      positions[outOffset + i * 3 + 1] = y
      positions[outOffset + i * 3 + 2] = z
    }
  }

  return {
    id: `demo-${Date.now().toString(36)}`,
    name: `演示轨迹 ${residueCount}残基/${frameCount}帧`,
    frameCount,
    atomCount,
    atoms,
    positions,
    frameDelta: 1 / 24,
    createdAt: Date.now(),
  }
}

type Vec3 = [number, number, number]
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}
function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
