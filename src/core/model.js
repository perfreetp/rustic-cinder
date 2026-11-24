/**
 * 平面折痕图（planar graph）构建：
 * 所有折痕交点/端点统一吸附为节点 → 边在节点处自动分裂（含 T 型接合）
 * → 半边表读取两侧折面 → BFS 折痕树 → 铰链参数。
 * 不依赖增量多边形切分，从根本上保证顶点共享与邻接完整。
 */
import { vsub, vnorm, vlen, deg2rad } from './math.js'
import { polygonArea, polygonCentroid } from './geometry.js'

const TOL = 1e-6
const SNAP = 1e-3

function cross2(a, b) {
  return a[0] * b[1] - a[1] * b[0]
}

let _faceSeq = 0
function nextFaceId() {
  return `f${_faceSeq++}`
}

/**
 * @param {Object} input
 * @param {number[][]} input.border
 * @param {{id:string,type:'mountain'|'valley',a:number[],b:number[]}[]} input.creases
 */
export function buildModel(input) {
  _faceSeq = 0
  const border = input.border.map((p) => [p[0], p[1]])
  const userCreases = input.creases.map((c) => ({
    id: c.id,
    type: c.type,
    a: [c.a[0], c.a[1]],
    b: [c.b[0], c.b[1]]
  }))

  // ---- 1. 全局节点池：吸附所有折痕端点与交点 ----
  const nodes = []
  const nodeIdx = (n) => nodes.indexOf(n)
  const nodeOf = (p) => {
    for (const n of nodes) {
      if (vlen(vsub(p, n)) < SNAP) return n
    }
    nodes.push([p[0], p[1]])
    return nodes[nodes.length - 1]
  }

  // 每条折痕收集沿线参数点（自身端点 + 与其他折痕的交点 + 落在其上的外边界点）
  const splitPoints = userCreases.map(() => [])
  for (let i = 0; i < userCreases.length; i++) {
    const c = userCreases[i]
    nodeOf(c.a)
    nodeOf(c.b)
    splitPoints[i].push({ t: 0, p: c.a }, { t: 1, p: c.b })
  }
  for (let i = 0; i < userCreases.length; i++) {
    for (let j = i + 1; j < userCreases.length; j++) {
      const hit = segSegIntersection(userCreases[i], userCreases[j])
      if (!hit) continue
      splitPoints[i].push({ t: hit.t1, p: hit.p })
      splitPoints[j].push({ t: hit.t2, p: hit.p })
    }
  }

  // T 接 / 端点接合：任一折痕的端点落在另一条折痕中段时，
  // 必须在该点切开另一条，否则共享节点对缺失会让整片面无法分隔
  for (let i = 0; i < userCreases.length; i++) {
    for (let j = 0; j < userCreases.length; j++) {
      if (i === j) continue
      const host = userCreases[j]
      for (const ep of [userCreases[i].a, userCreases[i].b]) {
        const t = pointOnLineParam(ep, host.a, host.b)
        if (t != null && t > 1e-6 && t < 1 - 1e-6) {
          splitPoints[j].push({ t, p: ep })
        }
      }
    }
  }

  // ---- 2. 生成折痕子段（节点-节点边），带 parentId/type ----
  const segments = []
  for (let i = 0; i < userCreases.length; i++) {
    const c = userCreases[i]
    const cuts = splitPoints[i]
      .map((s) => ({ ...s, t: Math.max(0, Math.min(1, s.t)) }))
      .sort((a, b) => a.t - b.t)
    const uniq = []
    for (const s of cuts) {
      if (!uniq.length || Math.abs(s.t - uniq[uniq.length - 1].t) > 1e-6) {
        uniq.push(s)
      }
    }
    for (let k = 0; k < uniq.length - 1; k++) {
      const a = nodeOf(uniq[k].p)
      const b = nodeOf(uniq[k + 1].p)
      if (vlen(vsub(b, a)) < TOL) continue
      segments.push({
        id: `${c.id}__s${k}`,
        parentId: c.id,
        type: c.type,
        a,
        b
      })
    }
  }

  // ---- 3. 外边界边：用全局节点中落在边界线段上的所有节点统一分裂，
  //    保证边界边与内部面环在 T 接处使用完全相同的节点序列 ----
  const borderEdges = []
  for (let i = 0; i < border.length; i++) {
    const a0 = nodeOf(border[i])
    const b0 = nodeOf(border[(i + 1) % border.length])
    const ia = nodeIdx(a0)
    const ib = nodeIdx(b0)
    const d = vsub(b0, a0)
    const onLine = nodes
      .map((n, idx) => ({ n, idx, t: collinearParam(n, a0, d) }))
      .filter((o) => o.t != null && o.t > 1e-6 && o.t < 1 - 1e-6)
    onLine.sort((p, q) => p.t - q.t)
    let prev = ia
    for (const o of onLine) {
      if (o.idx === prev) continue
      borderEdges.push({ a: nodes[prev], b: nodes[o.idx] })
      prev = o.idx
    }
    borderEdges.push({ a: nodes[prev], b: nodes[ib] })
  }

  // ---- 4. 半边表：每条无向边登记两条方向半边 ----
  const edgeKey = (a, b) => idxKey(nodeIdx(a), nodeIdx(b))
  const edgeList = [
    ...borderEdges.map((e) => ({ ...e, kind: 'border', segment: null })),
    ...segments.map((s) => ({
      a: s.a,
      b: s.b,
      kind: 'crease',
      segment: s
    }))
  ]
  // 去重无向边（同节点对）：折痕边优先，避免边界边覆盖内部折痕
  const undirected = []
  const seenEdge = new Map()
  for (const e of edgeList) {
    const key = edgeKey(e.a, e.b)
    const exist = seenEdge.get(key)
    if (exist == null) {
      seenEdge.set(key, undirected.length)
      undirected.push(e)
    } else if (undirected[exist].kind === 'border' && e.kind === 'crease') {
      undirected[exist] = e
    }
  }

  // ---- 5. 面环提取（标准孪生半边法） ----
  // 为每条无向边生成两条有向半边；在每个顶点按极角排序出边，
  // 半边 (u->v) 的 next = v 出边中极角仅次于反向半边 (v->u) 的那一条。
  const halfEdges = [] // {u, v, edge, twin, next}
  const halfByDir = new Map()
  for (const e of undirected) {
    const ia = nodeIdx(e.a)
    const ib = nodeIdx(e.b)
    const h1 = { u: ia, v: ib, edge: e, twin: null, next: null }
    const h2 = { u: ib, v: ia, edge: e, twin: null, next: null }
    h1.twin = h2
    h2.twin = h1
    halfEdges.push(h1, h2)
    halfByDir.set(`${ia}>${ib}`, h1)
    halfByDir.set(`${ib}>${ia}`, h2)
  }

  // 每个顶点的出半边按出射方向极角排序
  const outgoing = new Map()
  for (const n of nodes) outgoing.set(nodeIdx(n), [])
  for (const h of halfEdges) outgoing.get(h.u).push(h)
  for (const [, list] of outgoing) {
    list.sort((h1, h2) => {
      const a1 = Math.atan2(
        nodes[h1.v][1] - nodes[h1.u][1],
        nodes[h1.v][0] - nodes[h1.u][0]
      )
      const a2 = Math.atan2(
        nodes[h2.v][1] - nodes[h2.u][1],
        nodes[h2.v][0] - nodes[h2.u][0]
      )
      return a1 - a2
    })
  }
  // next：在 v 的排序出边中，取 twin 的下一条（循环）
  for (const h of halfEdges) {
    const list = outgoing.get(h.v)
    const twinPos = list.indexOf(h.twin)
    h.next = list[(twinPos + 1) % list.length]
  }

  const faces = []
  const visited = new Set()
  for (const start of halfEdges) {
    if (visited.has(start)) continue
    const ring = []
    let h = start
    let guard = 0
    do {
      if (visited.has(h) || guard++ > halfEdges.length) {
        h = null
        break
      }
      visited.add(h)
      ring.push(h.u)
      h = h.next
    } while (h !== start)
    if (!h || ring.length < 3) continue
    const poly = ring.map((idx) => [...nodes[idx]])
    const area = polygonArea(poly)
    if (Math.abs(area) < 1e-7) continue
    faces.push({ id: nextFaceId(), poly, ring, signedArea: area })
  }

  // 外环是所有面环中面积绝对值最大的那个；其余为内部折面
  let outerRing = faces[0]
  for (const f of faces) {
    if (Math.abs(f.signedArea) > Math.abs(outerRing.signedArea)) outerRing = f
  }
  const innerFaces = faces.filter((f) => f !== outerRing)

  // ---- 6. 面邻接：共享折痕边的两个面 ----
  const faceOfEdge = new Map() // 节点索引无向键 -> [faceId...]
  for (const f of innerFaces) {
    const ring = f.ring
    for (let i = 0; i < ring.length; i++) {
      const key = idxKey(ring[i], ring[(i + 1) % ring.length])
      if (!faceOfEdge.has(key)) faceOfEdge.set(key, [])
      faceOfEdge.get(key).push(f.id)
    }
  }

  const adj = new Map()
  for (const f of innerFaces) adj.set(f.id, [])
  for (const e of undirected) {
    if (e.kind !== 'crease') continue
    const key = idxKey(nodeIdx(e.a), nodeIdx(e.b))
    const owners = faceOfEdge.get(key)
    if (!owners || owners.length !== 2) continue
    const [f1, f2] = owners
    adj.get(f1).push({ faceId: f2, segmentId: e.segment.id, edge: [e.a, e.b] })
    adj.get(f2).push({ faceId: f1, segmentId: e.segment.id, edge: [e.a, e.b] })
  }

  // ---- 7. BFS 折痕树 ----
  let root = innerFaces[0]
  for (const f of innerFaces) {
    if (Math.abs(f.signedArea) > Math.abs(root.signedArea)) root = f
  }
  const parent = new Map()
  parent.set(root.id, null)
  const queue = [root.id]
  while (queue.length) {
    const fid = queue.shift()
    for (const nb of adj.get(fid)) {
      if (parent.has(nb.faceId)) continue
      parent.set(nb.faceId, {
        parentFaceId: fid,
        segmentId: nb.segmentId,
        edge: nb.edge
      })
      queue.push(nb.faceId)
    }
  }
  for (const f of innerFaces) {
    if (!parent.has(f.id)) {
      parent.set(f.id, { parentFaceId: root.id, segmentId: null, edge: null })
    }
  }

  // ---- 8. 铰链参数 ----
  const typeSign = { valley: 1, mountain: -1 }
  const hinges = []
  const faceDepth = new Map([[root.id, 0]])
  const centroidMap = new Map()
  for (const f of innerFaces) centroidMap.set(f.id, polygonCentroid(f.poly))

  for (const f of innerFaces) {
    if (f.id === root.id) continue
    const node = parent.get(f.id)
    const seg = segments.find((s) => s.id === node.segmentId)
    let hinge
    if (!seg || !node.edge) {
      hinge = {
        faceId: f.id,
        parentFaceId: node.parentFaceId,
        creaseId: node.segmentId,
        parentCreaseId: null,
        p: [0, 0, 0],
        axis: [1, 0, 0],
        sideSign: 1,
        typeSign: 1
      }
    } else {
      const d = vnorm(vsub(seg.b, seg.a))
      const c = centroidMap.get(f.id)
      const s = cross2(d, vsub(c, seg.a))
      const sideSign = s >= 0 ? 1 : -1
      const mid = [
        (node.edge[0][0] + node.edge[1][0]) / 2,
        (node.edge[0][1] + node.edge[1][1]) / 2
      ]
      hinge = {
        faceId: f.id,
        parentFaceId: node.parentFaceId,
        creaseId: seg.id,
        parentCreaseId: seg.parentId,
        p: [mid[0], mid[1], 0],
        axis: [d[0], d[1], 0],
        sideSign,
        typeSign: typeSign[seg.type] ?? 1
      }
    }
    hinges.push(hinge)
    faceDepth.set(f.id, (faceDepth.get(node.parentFaceId) ?? 0) + 1)
  }

  // ---- 8b. 用户折痕 -> 驱动面 ----
  // 姿态求解沿 BFS 生成树铰链级联，因此「驱动面」以树铰链为权威来源。
  // 共点辐射等含环图案中，未被选为树边的折痕是运动学冗余约束（其角度
  // 由相邻折痕的折叠决定），会在 UI 标注为「冗余」，不单独产生铰链。
  const creaseHinges = new Map()
  for (const c of userCreases) creaseHinges.set(c.id, [])
  for (const h of hinges) {
    if (h.parentCreaseId && creaseHinges.has(h.parentCreaseId)) {
      creaseHinges.get(h.parentCreaseId).push(h.faceId)
    }
  }
  // 邻接表中存在但未进生成树的折痕（环边），单独标记供 UI 提示
  const redundantCreases = new Set()
  const usedCreaseIds = new Set(hinges.map((h) => h.parentCreaseId).filter(Boolean))
  for (const nbList of adj.values()) {
    for (const nb of nbList) {
      const seg = segments.find((s) => s.id === nb.segmentId)
      if (seg && !usedCreaseIds.has(seg.parentId)) {
        redundantCreases.add(seg.parentId)
      }
    }
  }
  const creaseHingesObj = {}
  for (const [cid, list] of creaseHinges) creaseHingesObj[cid] = list
  const segmentParent = {}
  for (const s of segments) segmentParent[s.id] = s.parentId

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of border) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0])
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1])
  }

  return {
    border,
    creases: userCreases,
    segments,
    segmentParent,
    redundantCreases: [...redundantCreases],
    faces: innerFaces.map((f) => ({
      id: f.id,
      poly: f.poly,
      centroid: centroidMap.get(f.id),
      depth: faceDepth.get(f.id) ?? 0,
      parent: parent.get(f.id)
        ? {
            faceId: parent.get(f.id).parentFaceId,
            creaseId: parent.get(f.id).segmentId
          }
        : null
    })),
    rootFaceId: root.id,
    hinges,
    creaseHinges: creaseHingesObj,
    bounds: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY }
  }
}

// ---------- 辅助 ----------

function idxKey(ia, ib) {
  return ia < ib ? `${ia}_${ib}` : `${ib}_${ia}`
}

function sub2(a, b) {
  return [a[0] - b[0], a[1] - b[1]]
}
function dot2(a, b) {
  return a[0] * b[0] + a[1] * b[1]
}
function normalize2(a) {
  const l = Math.hypot(a[0], a[1]) || 1
  return [a[0] / l, a[1] / l]
}

function segSegIntersection(c1, c2) {
  const d1 = vsub(c1.b, c1.a)
  const d2 = vsub(c2.b, c2.a)
  const den = cross2(d1, d2)
  if (Math.abs(den) < TOL) return null
  const ap = vsub(c2.a, c1.a)
  const t1 = cross2(ap, d2) / den
  const t2 = cross2(ap, d1) / den
  if (t1 < -TOL || t1 > 1 + TOL || t2 < -TOL || t2 > 1 + TOL) return null
  return {
    t1,
    t2,
    p: [c1.a[0] + d1[0] * t1, c1.a[1] + d1[1] * t1]
  }
}

function pointOnLineParam(p, a, b) {
  const d = vsub(b, a)
  const l2 = d[0] * d[0] + d[1] * d[1]
  if (l2 < TOL) return null
  const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2
  if (t < -1e-4 || t > 1 + 1e-4) return null
  const q = [a[0] + d[0] * t, a[1] + d[1] * t]
  if (vlen(vsub(p, q)) > SNAP) return null
  return Math.max(0, Math.min(1, t))
}

/** 节点 n 是否落在过 a、方向 d 的线段上（含端点），返回参数 t */
function collinearParam(n, a, d) {
  const l2 = d[0] * d[0] + d[1] * d[1]
  if (l2 < TOL) return null
  const ap = vsub(n, a)
  if (Math.abs(cross2(d, ap)) > SNAP * 20) return null
  const t = (ap[0] * d[0] + ap[1] * d[1]) / l2
  if (t < -1e-5 || t > 1 + 1e-5) return null
  return Math.max(0, Math.min(1, t))
}

export function hingeRotation(hinge, anglesDeg) {
  const angle =
    anglesDeg[hinge.parentCreaseId ?? hinge.creaseId] ??
    anglesDeg[hinge.creaseId] ??
    0
  return hinge.sideSign * hinge.typeSign * deg2rad(angle)
}
