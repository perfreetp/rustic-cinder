/**
 * 内置示例折痕图（CP, Crease Pattern）。
 * 返回 { name, border, creases:[{id,type,a,b}] }，单位为纸面平面坐标。
 */

let cid = 0
function crease(type, a, b, id) {
  return { id: id ?? `c${++cid}`, type, a, b }
}

function resetCounter() {
  cid = 0
}

/** 简单十字折：2 条折痕 4 个折面，快速上手 */
export function presetCross() {
  resetCounter()
  const border = [
    [-3, -3], [3, -3], [3, 3], [-3, 3]
  ]
  const creases = [
    crease('valley', [0, -3], [0, 3]),
    crease('mountain', [-3, 0], [3, 0])
  ]
  return { name: '十字双折', border, creases }
}

/** 扇形八折：共点辐射折痕，峰谷交替 */
export function presetFan() {
  resetCounter()
  const s = 3.2
  const border = [
    [-s, -s], [s, -s], [s, s], [-s, s]
  ]
  const center = [0, 0]
  // 端点取在边界外接圆内、与正方形边相交的位置：整体偏置角度避开四角
  const n = 8
  const creases = []
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + Math.PI / 4 + 0.13
    const p = squareBoundaryPoint(ang, s)
    creases.push(crease(i % 2 === 0 ? 'valley' : 'mountain', center, p))
  }
  return { name: '扇形八折', border, creases }
}

/** 方向角 ang 的射线与中心在原点、半边长 s 的轴对齐正方形的交点 */
function squareBoundaryPoint(ang, s) {
  const dx = Math.cos(ang)
  const dy = Math.sin(ang)
  const tx = Math.abs(dx) < 1e-9 ? Infinity : s / Math.abs(dx)
  const ty = Math.abs(dy) < 1e-9 ? Infinity : s / Math.abs(dy)
  const t = Math.min(tx, ty)
  return [dx * t, dy * t]
}

/**
 * 三浦折纸（Miura-ori）网格：竖线峰谷交替 + 之字形谷线。
 * Nx=9, Ny=7 → 62 条折痕，用于 60 折痕级交互性能验证。
 */
export function presetMiura(nx = 9, ny = 7) {
  resetCounter()
  const w = 1.0
  const h = 0.9
  const zig = 0.22
  const W = nx * w
  const H = ny * h
  const x0 = -W / 2
  const y0 = -H / 2
  const border = [
    [x0, y0], [x0 + W, y0], [x0 + W, y0 + H], [x0, y0 + H]
  ]
  const creases = []

  // 纵向折痕（贯穿，端点严格落在外边界上），峰谷交替
  for (let i = 1; i < nx; i++) {
    const x = x0 + i * w
    creases.push(
      crease(i % 2 === 1 ? 'mountain' : 'valley', [x, y0], [x, y0 + H])
    )
  }
  // 内部之字形横向折痕（谷线），每条由 nx 段组成
  for (let j = 1; j < ny; j++) {
    const yBase = y0 + j * h
    for (let i = 0; i < nx; i++) {
      const xa = x0 + i * w
      const xb = x0 + (i + 1) * w
      const ya = yBase + (i % 2 === 0 ? -zig : zig)
      const yb = yBase + (i % 2 === 0 ? zig : -zig)
      creases.push(crease('valley', [xa, ya], [xb, yb]))
    }
  }
  return { name: `三浦折叠 ${creases.length} 折痕`, border, creases }
}

/** 风车四角折：经典平面可折图案 */
export function presetWindmill() {
  resetCounter()
  const s = 3.2
  const border = [[-s, -s], [s, -s], [s, s], [-s, s]]
  const creases = [
    crease('valley', [0, -s], [0, s]),
    crease('valley', [-s, 0], [s, 0]),
    crease('mountain', [-s, -s], [0, 0]),
    crease('mountain', [s, s], [0, 0]),
    crease('valley', [-s, s], [0, 0]),
    crease('valley', [s, -s], [0, 0])
  ]
  return { name: '风车六角', border, creases }
}

export const PRESETS = {
  cross: presetCross,
  fan: presetFan,
  miura: presetMiura,
  windmill: presetWindmill
}
