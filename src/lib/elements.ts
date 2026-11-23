import * as THREE from 'three'

/** CPK 风格元素配色与显示半径(半径为渲染用经验值,非严格 vdW) */
interface ElementInfo {
  color: number
  radius: number
}

const FALLBACK: ElementInfo = { color: 0xff77ff, radius: 0.35 }

const TABLE: Record<string, ElementInfo> = {
  H:  { color: 0xffffff, radius: 0.18 },
  C:  { color: 0x909090, radius: 0.32 },
  N:  { color: 0x3050f8, radius: 0.34 },
  O:  { color: 0xff2020, radius: 0.34 },
  F:  { color: 0x90e050, radius: 0.30 },
  P:  { color: 0xff8000, radius: 0.38 },
  S:  { color: 0xffff30, radius: 0.36 },
  Cl: { color: 0x1ff01f, radius: 0.35 },
  Br: { color: 0xa62929, radius: 0.40 },
  I:  { color: 0x940094, radius: 0.43 },
  Fe: { color: 0xe06633, radius: 0.38 },
  Zn: { color: 0x7d80b0, radius: 0.38 },
  Mg: { color: 0x8aff00, radius: 0.34 },
  Ca: { color: 0x3dff00, radius: 0.38 },
  Na: { color: 0xab5cf2, radius: 0.34 },
  K:  { color: 0x8f40d4, radius: 0.38 },
}

export function elementInfo(symbol: string): ElementInfo {
  return TABLE[symbol] ?? FALLBACK
}

export function elementColor(symbol: string): THREE.Color {
  return new THREE.Color(elementInfo(symbol).color)
}

export function elementRadius(symbol: string): number {
  return elementInfo(symbol).radius
}

/** 累计位移着色:蓝(小) → 青 → 绿 → 黄 → 红(大) */
const RAMP_STOPS: Array<[number, number, number]> = [
  [0.13, 0.30, 0.95],
  [0.10, 0.75, 0.95],
  [0.20, 0.85, 0.30],
  [0.98, 0.85, 0.15],
  [0.95, 0.20, 0.18],
]

const tmpColor = new THREE.Color()

export function displacementColor(normalized: number, out: THREE.Color = tmpColor): THREE.Color {
  const t = Math.min(1, Math.max(0, normalized)) * (RAMP_STOPS.length - 1)
  const i = Math.min(RAMP_STOPS.length - 2, Math.floor(t))
  const f = t - i
  const a = RAMP_STOPS[i]
  const b = RAMP_STOPS[i + 1]
  out.setRGB(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f)
  return out
}
