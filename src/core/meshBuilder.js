/**
 * 由二维折面构建三角网格：
 *  - low：每个折面扇形三角化（顶点少，播放时先更新）
 *  - high：网格线细分后三角化（顶点密，用于纤维着色器精绘）
 * 输出带逐面顶点区间（供 Worker 并行变换）与共享边（折痕线）。
 */
import { subdividePolygon, polygonArea } from './geometry.js'
import { vsub, vlen } from './math.js'

const TOL = 1e-6

/**
 * @param {Object} model buildModel 产物
 * @param {{lowStep?:number, highStep?:number}} options
 */
export function buildMeshes(model, options = {}) {
  const span = Math.max(model.bounds.width, model.bounds.height)
  const highStep = options.highStep ?? span / 26
  const low = buildQualityMesh(model, span / 8, false)
  const high = buildQualityMesh(model, highStep, true)
  return { low, high }
}

function buildQualityMesh(model, step, subdivide) {
  const positions = []
  const uvs = []
  const indices = []
  const ranges = []
  const { minX, minY, width, height } = model.bounds
  const toUv = (p) => [
    (p[0] - minX) / Math.max(EPS_VAL(width), 1),
    (p[1] - minY) / Math.max(EPS_VAL(height), 1)
  ]

  for (const face of model.faces) {
    const cells = subdivide
      ? subdividePolygon(face.poly, step).filter(
          (c) => Math.abs(polygonArea(c)) > 1e-7
        )
      : [face.poly]

    const vertexStart = positions.length / 3
    let vertexCount = 0
    for (const cell of cells) {
      const tris = fanTriangulate(cell)
      for (const tri of tris) {
        const base = positions.length / 3
        for (const p of tri) {
          positions.push(p[0], p[1], 0)
          const uv = toUv(p)
          uvs.push(uv[0], uv[1])
          vertexCount++
        }
        indices.push(base, base + 1, base + 2)
      }
    }
    ranges.push({ faceId: face.id, vertexStart, vertexCount })
  }

  const creaseEdges = collectCreaseEdges(model)
  const borderEdges = collectBorderEdges(model)

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: indices.length > 65535
      ? new Uint32Array(indices)
      : new Uint16Array(indices),
    ranges,
    creaseEdges,
    borderEdges
  }
}

/** 凸多边形/凸小格的扇形三角化，保证逆时针环绕 */
function fanTriangulate(poly) {
  const c = centroid(poly)
  const tris = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const tri = [a, b, c]
    const area =
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    tris.push(area >= 0 ? tri : [a, c, b])
  }
  return tris
}

function centroid(poly) {
  let x = 0, y = 0
  for (const p of poly) {
    x += p[0]
    y += p[1]
  }
  return [x / poly.length, y / poly.length]
}

function collectCreaseEdges(model) {
  const seen = new Set()
  const edges = []
  for (const face of model.faces) {
    if (!face.parent) continue
    const poly = face.poly
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const key = edgeKey(a, b)
      if (seen.has(key)) continue
      const seg = model.segments.find(
        (s) => pointOnSeg(a, s.a, s.b) && pointOnSeg(b, s.a, s.b)
      )
      if (seg) {
        seen.add(key)
        edges.push({
          a,
          b,
          creaseId: seg.parentId,
          segmentId: seg.id,
          type: seg.type
        })
      }
    }
  }
  return edges
}

function collectBorderEdges(model) {
  const border = model.border
  const edges = []
  for (let i = 0; i < border.length; i++) {
    edges.push({ a: border[i], b: border[(i + 1) % border.length] })
  }
  return edges
}

function edgeKey(a, b) {
  const k = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`
  const ka = k(a), kb = k(b)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

function pointOnSeg(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1]
  const apx = p[0] - a[0], apy = p[1] - a[1]
  const len2 = abx * abx + aby * aby
  if (len2 < TOL) return vlen(vsub(p, a)) < TOL
  let t = (apx * abx + apy * aby) / len2
  t = Math.max(0, Math.min(1, t))
  const qx = a[0] + t * abx
  const qy = a[1] + t * aby
  return Math.hypot(p[0] - qx, p[1] - qy) < 1e-5
}

function EPS_VAL(v) {
  return Math.abs(v) < 1e-9 ? 1e-9 : v
}
