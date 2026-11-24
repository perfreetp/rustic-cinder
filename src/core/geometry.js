/**
 * 平面多边形几何工具：折痕切分、三角化、细分（用于高精度纸面网格）。
 * 所有点为二维 [x, y]。
 */
import { EPS, segIntersect2D, vsub, vlen } from './math.js'

export function polygonArea(poly) {
  let s = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

export function polygonCentroid(poly) {
  let cx = 0, cy = 0, a0 = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % n]
    const f = p[0] * q[1] - q[0] * p[1]
    a0 += f
    cx += (p[0] + q[0]) * f
    cy += (p[1] + q[1]) * f
  }
  if (Math.abs(a0) < EPS) {
    const m = poly.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0])
    return [m[0] / poly.length, m[1] / poly.length]
  }
  return [cx / (3 * a0), cy / (3 * a0)]
}

function cross2(a, b) {
  return a[0] * b[1] - a[1] * b[0]
}

/** 点到线段距离 */
export function pointSegDist(p, a, b) {
  const ab = vsub(b, a)
  const ap = vsub(p, a)
  const l2 = ab[0] * ab[0] + ab[1] * ab[1]
  if (l2 < EPS) return vlen(ap)
  let t = (ap[0] * ab[0] + ap[1] * ab[1]) / l2
  t = Math.max(0, Math.min(1, t))
  const q = [a[0] + t * ab[0], a[1] + t * ab[1]]
  return vlen(vsub(p, q))
}

/**
 * 求直线（过 a、b）与多边形边界的两个交点。
 * 只有直线真正横穿多边形（两侧各有顶点）时才返回，
 * 端点恰好落在顶点上的接触不算横穿。
 * 返回 [q1, q2] 或 null。
 */
function linePolygonCrossings(poly, a, b) {
  const d = vsub(b, a)
  const sides = poly.map((p) => cross2(d, vsub(p, a)))
  const hasLeft = sides.some((s) => s > EPS)
  const hasRight = sides.some((s) => s < -EPS)
  if (!hasLeft || !hasRight) return null

  const hits = []
  for (let i = 0, n = poly.length; i < n; i++) {
    const p1 = poly[i]
    const p2 = poly[(i + 1) % n]
    const e = vsub(p2, p1)
    const den = cross2(d, e)
    if (Math.abs(den) < EPS) continue
    const ap = vsub(p1, a)
    const t = cross2(ap, e) / den
    const u = cross2(ap, d) / den
    if (u >= -EPS && u <= 1 + EPS) {
      const q = [a[0] + d[0] * t, a[1] + d[1] * t]
      if (!hits.some((h) => vlen(vsub(h, q)) < 1e-6)) hits.push(q)
    }
  }
  if (hits.length < 2) return null
  // 取沿直线方向最远的两个交点
  hits.sort((p, q) => {
    const tp = (p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]
    const tq = (q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]
    return tp - tq
  })
  return [hits[0], hits[hits.length - 1]]
}

function clipHalfPlane(poly, a, b, wantLeft) {
  const out = []
  const d = vsub(b, a)
  const side = (p) => cross2(d, vsub(p, a))
  for (let i = 0, n = poly.length; i < n; i++) {
    const cur = poly[i]
    const nxt = poly[(i + 1) % n]
    const sc = side(cur)
    const sn = side(nxt)
    const inC = wantLeft ? sc >= -EPS : sc <= EPS
    const inN = wantLeft ? sn >= -EPS : sn <= EPS
    if (inC && inN) {
      out.push(nxt)
    } else if (inC && !inN) {
      const hit = segIntersect2D(cur, nxt, a, b)
      if (hit) out.push([hit[0], hit[1]])
    } else if (!inC && inN) {
      const hit = segIntersect2D(cur, nxt, a, b)
      if (hit) {
        out.push([hit[0], hit[1]])
        out.push(nxt)
      }
    }
  }
  return out
}

/**
 * 用折痕线段把一个多边形切成两块。
 * 若折痕未横穿该多边形，返回 null。
 * @returns {{left:number[][], right:number[][], q1:number[], q2:number[]}|null}
 */
export function splitPolygonBySegment(poly, a, b) {
  const cross = linePolygonCrossings(poly, a, b)
  if (!cross) return null
  const [q1, q2] = cross
  if (vlen(vsub(q1, q2)) < EPS) return null
  const left = clipHalfPlane(poly, q1, q2, true)
  const right = clipHalfPlane(poly, q1, q2, false)
  if (left.length < 3 || right.length < 3) return null
  return { left, right, q1, q2 }
}

/** 判断折痕线段是否落在多边形某条边上（用于面-折痕邻接关系） */
export function edgeOnSegment(e1, e2, a, b, tol = 1e-3) {
  return (
    pointSegDist(e1, a, b) < tol &&
    pointSegDist(e2, a, b) < tol &&
    vlen(vsub(e1, e2)) > EPS
  )
}

/**
 * 网格细分：用步长 step 的 x/y 网格线递归切分多边形，
 * 得到密集小多边形，供高精度纸面着色使用。凸多边形安全。
 */
export function subdividePolygon(poly, step) {
  let cells = [poly]
  const MAX_CELLS = 400
  const xs = collectGridLines(poly, 0, step)
  const ys = collectGridLines(poly, 1, step)
  for (const x of xs) {
    if (cells.length >= MAX_CELLS) break
    cells = cutCells(cells, [x, -1e6], [x, 1e6])
  }
  for (const y of ys) {
    if (cells.length >= MAX_CELLS) break
    cells = cutCells(cells, [-1e6, y], [1e6, y])
  }
  return cells.filter((c) => c.length >= 3 && Math.abs(polygonArea(c)) > EPS)
}

function collectGridLines(poly, axis, step) {
  let lo = Infinity, hi = -Infinity
  for (const p of poly) {
    lo = Math.min(lo, p[axis])
    hi = Math.max(hi, p[axis])
  }
  const lines = []
  for (let v = Math.ceil((lo + 1e-9) / step) * step; v < hi - 1e-9; v += step) {
    lines.push(v)
  }
  return lines
}

function cutCells(cells, a, b) {
  const out = []
  for (const poly of cells) {
    const r = splitPolygonBySegment(poly, a, b)
    if (!r) {
      out.push(poly)
    } else {
      out.push(r.left, r.right)
    }
  }
  return out
}
