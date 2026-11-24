/**
 * 核心逻辑冒烟测试（node --test 风格，直接 node 运行）：
 * 1. 折痕切分与折痕树完整性
 * 2. 全量求解 vs 子树分块求解结果一致（Worker 路径的等价性）
 * 3. 父子联动：改父折痕角度，子树姿态变化且非子树不动
 * 4. 顶点变换区间覆盖全部顶点且互不重叠
 * 5. 60+ 折痕模型性能
 */
import { presetMiura, presetCross, presetFan, presetWindmill } from '../src/core/presets.js'
import { buildModel } from '../src/core/model.js'
import { buildMeshes } from '../src/core/meshBuilder.js'
import {
  solvePoses,
  solveSubtrees,
  transformRanges,
  partitionTree
} from '../src/core/solver.js'
import { sampleFrame, setKeyframe, MAX_FRAMES } from '../src/core/keyframes.js'

let pass = 0
let fail = 0
function assert(cond, msg) {
  if (cond) {
    pass++
  } else {
    fail++
    console.error('  ✗ FAIL:', msg)
  }
}
function approx(a, b, tol = 1e-5) {
  return Math.abs(a - b) <= tol
}

// ---------- 1. 各预设模型结构 ----------
for (const [name, cp] of [
  ['cross', presetCross()],
  ['fan', presetFan()],
  ['windmill', presetWindmill()],
  ['miura', presetMiura()]
]) {
  const model = buildModel(cp)
  assert(model.creases.length === cp.creases.length, `${name}: 折痕数保留`)
  assert(model.faces.length >= 2, `${name}: 至少切出 2 个折面 (got ${model.faces.length})`)
  assert(
    model.hinges.length === model.faces.length - 1,
    `${name}: 树边数=面数-1 (${model.hinges.length} vs ${model.faces.length - 1})`
  )
  // 树连通：每个面都能沿 parent 走到根
  const ids = new Set(model.faces.map((f) => f.id))
  for (const f of model.faces) {
    let cur = f
    let guard = 0
    while (cur.id !== model.rootFaceId && guard++ < 1000) {
      if (!cur.parent) break
      const p = model.faces.find((x) => x.id === cur.parent.faceId)
      assert(!!p && ids.has(p.id), `${name}: ${f.id} 父面存在`)
      cur = p
    }
    assert(cur.id === model.rootFaceId, `${name}: ${f.id} 可追溯到根`)
  }
  // 每条非冗余折痕（生成树铰链）至少驱动一个折面；
  // 含环图案（如辐射共点）中冗余折痕的角度由相邻折痕运动学决定
  const redundant = new Set(model.redundantCreases || [])
  for (const c of model.creases) {
    if (redundant.has(c.id)) continue
    assert(
      (model.creaseHinges[c.id] || []).length >= 1,
      `${name}: 折痕 ${c.id} 驱动至少一个折面`
    )
  }
  // 冗余折痕数量 = 折痕数 - 树边数（环的阶数）
  const treeCreaseCount = new Set(
    model.hinges.map((h) => h.parentCreaseId).filter(Boolean)
  ).size
  assert(
    redundant.size === model.creases.length - treeCreaseCount,
    `${name}: 冗余折痕数与环阶一致`
  )
  // 铰链参数合法性
  for (const h of model.hinges) {
    const al = Math.hypot(...h.axis)
    assert(approx(al, 1, 1e-4), `${name}: 铰链轴单位化`)
    assert([-1, 1].includes(h.sideSign), `${name}: sideSign ±1`)
    assert([-1, 1].includes(h.typeSign), `${name}: typeSign ±1`)
  }
}

// ---------- 2. 三浦：全量 vs 4 路分块求解一致 ----------
{
  const cp = presetMiura()
  const model = buildModel(cp)
  const angles = {}
  for (const c of model.creases) angles[c.id] = (hash(c.id) % 90) - 45

  const full = solvePoses(model.hinges, angles, [model.rootFaceId])
  const chunks = partitionTree(model.hinges, angles, [model.rootFaceId], 4)
  assert(chunks.length === 4, 'miura: 分成 4 块')
  let covered = 0
  const merged = new Map()
  for (const ch of chunks) {
    covered += ch.owned.size
    const part = solveSubtrees(model.hinges, angles, ch.entries, ch.owned)
    for (const [fid, m] of part) merged.set(fid, m)
  }
  assert(covered === model.faces.length, 'miura: 分块覆盖全部折面')
  assert(merged.size === model.faces.length, 'miura: 合并后每面都有矩阵')
  let maxErr = 0
  for (const [fid, m] of full) {
    const mm = merged.get(fid)
    assert(!!mm, `miura: ${fid} 在分块结果中存在`)
    for (let i = 0; i < 16; i++) maxErr = Math.max(maxErr, Math.abs(m[i] - mm[i]))
  }
  assert(maxErr < 1e-8, `miura: 全量/分块矩阵一致 (err=${maxErr.toExponential(2)})`)

  // 根面为单位阵
  const rootM = full.get(model.rootFaceId)
  assert(rootM.every((v, i) => approx(v, i % 5 === 0 ? 1 : 0)), 'miura: 根面单位矩阵')
}

// ---------- 3. 父子联动 ----------
{
  const cp = presetCross()
  const model = buildModel(cp)
  const flat = solvePoses(model.hinges, {}, [model.rootFaceId])
  const angles = {}
  const firstCrease = model.creases[0].id
  angles[firstCrease] = 90
  const folded = solvePoses(model.hinges, angles, [model.rootFaceId])

  // 被驱动子面发生旋转，未驱动的面保持单位姿态
  const drivenFaces = new Set(model.creaseHinges[firstCrease])
  let moved = 0
  let untouched = 0
  for (const f of model.faces) {
    const a = flat.get(f.id)
    const b = folded.get(f.id)
    const diff = a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0)
    if (drivenFaces.has(f.id)) {
      if (diff > 1e-6) moved++
    } else if (f.id !== model.rootFaceId) {
      if (diff < 1e-9) untouched++
    }
  }
  assert(moved === drivenFaces.size, 'cross: 该折痕的子面全部联动')
  assert(untouched >= 1, 'cross: 无关折面保持不动')

  // 90° 折叠后子面法线不再平行于 z 轴
  const anyH = model.hinges.find((h) => h.parentCreaseId === firstCrease)
  assert(!!anyH, 'cross: 找到该折痕的铰链树边')
  const m = folded.get(anyH.faceId)
  const nz = Math.abs(m[2] * 0 + m[6] * 0 + m[10] * 1) // 原法线 (0,0,1) 变换后 z 分量
  assert(nz < 0.999, 'cross: 90° 折叠后法线确实改变')
}

// ---------- 4. 网格顶点区间完整且不重叠 ----------
{
  const cp = presetMiura()
  const model = buildModel(cp)
  const meshes = buildMeshes(model)
  for (const q of [meshes.low, meshes.high]) {
    const total = q.positions.length / 3
    let sum = 0
    const seen = new Set()
    for (const r of q.ranges) {
      sum += r.vertexCount
      for (let v = r.vertexStart; v < r.vertexStart + r.vertexCount; v++) {
        assert(!seen.has(v), 'mesh: 顶点区间无重叠')
        seen.add(v)
      }
    }
    assert(sum === total, `mesh: 区间覆盖全部顶点 (${sum}/${total})`)
    assert(seen.size === total, 'mesh: 覆盖顶点数正确')
  }
  // 高模显著比低模密
  assert(
    meshes.high.positions.length > meshes.low.positions.length * 3,
    'mesh: 高模顶点数 > 低模 3 倍'
  )
  // 变换结果长度与基准一致且平面 z=0 输入在零角度时保持原位
  const mats = solvePoses(model.hinges, {}, [model.rootFaceId])
  const out = transformRanges(meshes.low.positions, meshes.low.ranges, mats)
  assert(out.length === meshes.low.positions.length, 'mesh: 变换输出长度一致')
  let err = 0
  for (let i = 0; i < out.length; i++) err = Math.max(err, Math.abs(out[i] - meshes.low.positions[i]))
  assert(err < 1e-7, 'mesh: 零角度时顶点不动')
}

// ---------- 5. 关键帧采样与 120 帧上限 ----------
{
  const tracks = {}
  setKeyframe(tracks, 'c1', 0, 0)
  setKeyframe(tracks, 'c1', 60, 90)
  setKeyframe(tracks, 'c1', 120, 0)
  assert(approx(sampleFrame(tracks, 0).c1, 0), 'kf: 首帧')
  assert(approx(sampleFrame(tracks, 30).c1, 45), 'kf: 线性插值 45°')
  assert(approx(sampleFrame(tracks, 90).c1, 45), 'kf: 反向插值 45°')
  assert(approx(sampleFrame(tracks, 200).c1, 0), 'kf: 越界夹紧末帧')
  assert(MAX_FRAMES === 120, 'kf: 上限 120 帧')
}

// ---------- 6. 60+ 折痕求解性能 ----------
{
  const cp = presetMiura()
  const model = buildModel(cp)
  const meshes = buildMeshes(model)
  const angles = Object.fromEntries(model.creases.map((c) => [c.id, 50]))
  const t0 = performance.now()
  const N = 20
  for (let i = 0; i < N; i++) {
    const mats = solvePoses(model.hinges, angles, [model.rootFaceId])
    transformRanges(meshes.high.positions, meshes.high.ranges, mats)
  }
  const ms = (performance.now() - t0) / N
  console.log(`  miura: ${model.creases.length} 折痕 / ${model.faces.length} 面 / ${(meshes.high.positions.length / 3).toLocaleString()} 高模顶点，单帧全量求解+变换 ${ms.toFixed(2)}ms`)
  assert(ms < 50, `perf: 单帧求解 < 50ms (got ${ms.toFixed(1)}ms)`)

  // 分块（模拟 Worker 派发准备）开销
  const t1 = performance.now()
  for (let i = 0; i < N; i++) partitionTree(model.hinges, angles, [model.rootFaceId], 4)
  const pms = (performance.now() - t1) / N
  console.log(`  miura: 分块准备 ${pms.toFixed(2)}ms/帧`)
  assert(pms < 30, `perf: 分块 < 30ms (got ${pms.toFixed(1)}ms)`)
}

function hash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
