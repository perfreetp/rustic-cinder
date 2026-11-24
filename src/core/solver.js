/**
 * 折痕树姿态求解（纯函数，零依赖）：
 * 给定每条折痕当前角度，沿折痕树 BFS 级联计算每个折面的世界变换。
 * Worker 与主线程回退路径共用本文件。
 */
import { hingeTransform, mat4Identity, mat4Mul, transformPoint } from './math.js'
import { hingeRotation } from './model.js'

function buildChildrenIndex(hinges) {
  const childrenOf = new Map()
  for (const h of hinges) {
    if (!childrenOf.has(h.parentFaceId)) childrenOf.set(h.parentFaceId, [])
    childrenOf.get(h.parentFaceId).push(h)
  }
  return childrenOf
}

/**
 * 全量求解：从根面（单位矩阵）出发的完整 BFS。
 * @param {Array} hinges model.hinges
 * @param {Object} anglesDeg {creaseId: 角度（度）}
 * @param {string[]} rootFaceIds 根面 id 列表
 * @returns {Map<string, number[]>} faceId -> 列主序 mat4
 */
export function solvePoses(hinges, anglesDeg, rootFaceIds) {
  const childrenOf = buildChildrenIndex(hinges)
  const mats = new Map()
  const queue = []
  for (const rid of rootFaceIds) {
    mats.set(rid, mat4Identity())
    queue.push(rid)
  }
  while (queue.length) {
    const fid = queue.shift()
    const parentMat = mats.get(fid)
    const kids = childrenOf.get(fid)
    if (!kids) continue
    for (const h of kids) {
      const theta = hingeRotation(h, anglesDeg)
      const local = hingeTransform(h.p, h.axis, theta)
      mats.set(h.faceId, mat4Mul(parentMat, local))
      queue.push(h.faceId)
    }
  }
  return mats
}

/**
 * 子树并行求解：主调已算好各入口面的矩阵，Worker 只在归属面集合内向下 BFS。
 * @param {Map<string, number[]>} entries faceId -> 已知矩阵（通常是分块的首面）
 * @param {Set<string>} owned 本分块拥有的面
 */
export function solveSubtrees(hinges, anglesDeg, entries, owned) {
  const childrenOf = buildChildrenIndex(hinges)
  const mats = new Map()
  const queue = []
  for (const [fid, m] of entries) {
    mats.set(fid, m)
    queue.push(fid)
  }
  while (queue.length) {
    const fid = queue.shift()
    const kids = childrenOf.get(fid)
    if (!kids) continue
    for (const h of kids) {
      if (!owned.has(h.faceId)) continue
      const theta = hingeRotation(h, anglesDeg)
      const local = hingeTransform(h.p, h.axis, theta)
      const m = mat4Mul(mats.get(fid), local)
      mats.set(h.faceId, m)
      queue.push(h.faceId)
    }
  }
  return mats
}

/**
 * 用各面矩阵把平面基准顶点变换到当前姿态。
 * 各 range 的顶点区间互不重叠，可在不同 Worker 中并行执行。
 * @param {Float32Array} base 平面基准位置（xyz 交错）
 * @param {Array<{faceId:string,vertexStart:number,vertexCount:number}>} ranges
 * @param {Map<string,number[]>} mats
 * @param {Float32Array} [out] 复用输出缓冲
 */
export function transformRanges(base, ranges, mats, out) {
  const total = base.length
  const target = out && out.length === total ? out : new Float32Array(total)
  for (const r of ranges) {
    const m = mats.get(r.faceId)
    if (!m) continue
    const start = r.vertexStart * 3
    const end = start + r.vertexCount * 3
    for (let i = start; i < end; i += 3) {
      const p = transformPoint(m, [base[i], base[i + 1], base[i + 2]])
      target[i] = p[0]
      target[i + 1] = p[1]
      target[i + 2] = p[2]
    }
  }
  return target
}

/**
 * 主线程计算分块入口面的矩阵（沿祖先链向上，最多 K 条短链，开销很小）。
 * 返回 { entries: Map, owned: Set } 列表，每个元素对应一个 Worker。
 */
export function partitionTree(hinges, anglesDeg, rootFaceIds, workerCount) {
  const byFace = new Map(hinges.map((h) => [h.faceId, h]))
  const allFaceIds = [...rootFaceIds, ...hinges.map((h) => h.faceId)]
  const k = Math.max(1, Math.min(workerCount, allFaceIds.length))
  const chunks = Array.from({ length: k }, () => [])
  // BFS 序均分，使每块面数接近、深度尽量错峰
  const order = bfsOrder(hinges, rootFaceIds)
  order.forEach((fid, i) => chunks[i % k].push(fid))

  return chunks.map((ownedList) => {
    const owned = new Set(ownedList)
    const entries = new Map()
    for (const fid of ownedList) {
      const h = byFace.get(fid)
      if (!h) {
        entries.set(fid, mat4Identity()) // 根面
        continue
      }
      if (owned.has(h.parentFaceId)) continue // 父在块内，BFS 时自然算出
      // 入口面：沿祖先链求矩阵
      entries.set(fid, ancestorMatrix(fid, hinges, anglesDeg, byFace))
    }
    return { entries, owned }
  })
}

function ancestorMatrix(faceId, hinges, anglesDeg, byFace) {
  const chain = []
  let cur = faceId
  let h = byFace.get(cur)
  while (h) {
    chain.push(h)
    cur = h.parentFaceId
    h = byFace.get(cur)
  }
  // chain 从面自身向上排到根的孩子；矩阵从根向下累乘
  let m = mat4Identity()
  for (let i = chain.length - 1; i >= 0; i--) {
    const hh = chain[i]
    const theta = hingeRotation(hh, anglesDeg)
    m = mat4Mul(m, hingeTransform(hh.p, hh.axis, theta))
  }
  return m
}

function bfsOrder(hinges, rootFaceIds) {
  const childrenOf = buildChildrenIndex(hinges)
  const order = []
  const queue = [...rootFaceIds]
  while (queue.length) {
    const fid = queue.shift()
    order.push(fid)
    const kids = childrenOf.get(fid)
    if (kids) for (const h of kids) queue.push(h.faceId)
  }
  return order
}
