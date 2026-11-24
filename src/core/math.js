/**
 * 纯 3D 数学工具（零依赖），Worker 与主线程回退求解器共用。
 * 矩阵为列主序 mat4（与 THREE.Matrix4.fromArray 二进制兼容）。
 */

export const EPS = 1e-8

export function v3(x = 0, y = 0, z = 0) {
  return [x, y, z]
}

export function vadd(a, b) {
  return [a[0] + b[0], a[1] + b[1], (a[2] || 0) + (b[2] || 0)]
}

export function vsub(a, b) {
  return [a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)]
}

export function vscale(a, s) {
  return [a[0] * s, a[1] * s, (a[2] || 0) * s]
}

export function vdot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + (a[2] || 0) * (b[2] || 0)
}

export function vcross(a, b) {
  return [
    a[1] * b[2] - (a[2] || 0) * b[1],
    (a[2] || 0) * b[0] - a[0] * (b[2] || 0),
    a[0] * b[1] - a[1] * b[0]
  ]
}

export function vlen(a) {
  return Math.hypot(a[0], a[1], a[2] || 0)
}

export function vnorm(a) {
  const l = vlen(a)
  if (l < EPS) return [0, 0, 1]
  return [a[0] / l, a[1] / l, (a[2] || 0) / l]
}

/**
 * 绕任意轴旋转（Rodrigues），返回列主序 mat3（9 个元素）。
 * @param {number[]} axis 单位向量
 * @param {number} theta 弧度
 */
export function rotAxisMat3(axis, theta) {
  const [x, y, z] = axis
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const t = 1 - c
  // 行主序 Rodrigues
  const m = [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c]
  ]
  // 转列主序
  return [
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2]
  ]
}

export function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** 列主序 mat4 相乘 a * b */
export function mat4Mul(a, b) {
  const out = new Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3]
    }
  }
  return out
}

/** 由平移向量构造 mat4 */
export function mat4Translation(p) {
  const m = mat4Identity()
  m[12] = p[0]
  m[13] = p[1]
  m[14] = p[2]
  return m
}

/** 由列主序 mat3 旋转构造 mat4 */
export function mat4FromMat3(r) {
  return [
    r[0], r[1], r[2], 0,
    r[3], r[4], r[5], 0,
    r[6], r[7], r[8], 0,
    0, 0, 0, 1
  ]
}

/**
 * 绕过点 p 的轴 axis 旋转 theta 的完整变换：
 * T(p) * R(axis, theta) * T(-p)
 */
export function hingeTransform(p, axis, theta) {
  const r = mat4FromMat3(rotAxisMat3(axis, theta))
  const tp = mat4Translation(p)
  const tneg = mat4Translation(vscale(p, -1))
  return mat4Mul(mat4Mul(tp, r), tneg)
}

export function transformPoint(m, p) {
  const [x, y, z] = p
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ]
}

/** 对向量（不含平移）做变换 */
export function transformDir(m, d) {
  const [x, y, z] = d
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z
  ]
}

/** 二维线段交点；返回 [x, y, t, u] 或 null（t、u 为两线段上的参数 0..1） */
export function segIntersect2D(p1, p2, p3, p4) {
  const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1]
  const x3 = p3[0], y3 = p3[1], x4 = p4[0], y4 = p4[1]
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(den) < EPS) return null
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1), t, u]
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

export function deg2rad(d) {
  return (d * Math.PI) / 180
}
