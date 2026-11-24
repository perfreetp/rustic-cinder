/**
 * 用 Node worker_threads 模拟浏览器 Worker 池的端到端并行：
 * 主线程分块 → 子线程 solveSubtrees + transformRanges → 回传 → 合并，
 * 验证与单线程全量求解逐顶点一致（poseWorker.js 运行的同一套纯函数）。
 */
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { presetMiura } from '../src/core/presets.js'
import { buildModel } from '../src/core/model.js'
import { buildMeshes } from '../src/core/meshBuilder.js'
import { solvePoses, transformRanges, partitionTree } from '../src/core/solver.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const workerFile = join(__dir, 'nodeWorker.mjs')

function runWorker(payload) {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerFile, { workerData: payload })
    w.on('message', resolve)
    w.on('error', reject)
  })
}

let pass = 0, fail = 0
const assert = (c, m) => { c ? pass++ : (fail++, console.error('  ✗', m)) }

const model = buildModel(presetMiura())
const meshes = buildMeshes(model)
const angles = Object.fromEntries(model.creases.map((c) => [c.id, 55]))

// 单线程基准
const baseMats = solvePoses(model.hinges, angles, [model.rootFaceId])
const basePos = transformRanges(meshes.high.positions, meshes.high.ranges, baseMats)

// 4 路并行（模拟 SolverPool 分块派发）
const chunks = partitionTree(model.hinges, angles, [model.rootFaceId], 4)
const merged = new Float32Array(meshes.high.positions.length)
const mergedMats = new Map()
const t0 = performance.now()
const results = await Promise.all(
  chunks.map((chunk) => {
    const ranges = meshes.high.ranges.filter((r) => chunk.owned.has(r.faceId))
    return runWorker({
      hinges: model.hinges,
      angles,
      entries: [...chunk.entries.entries()],
      owned: [...chunk.owned],
      base: meshes.high.positions.slice(),
      ranges
    })
  })
)
const parMs = performance.now() - t0
for (const res of results) {
  // 按各分区偏移紧凑回填，避免全尺寸缓冲的零值互相覆盖
  for (const part of res.parts) {
    merged.set(part.data, part.offset)
  }
  for (const [fid, m] of res.matrices) mergedMats.set(fid, m)
}

// 逐顶点比对
let maxErr = 0
for (let i = 0; i < basePos.length; i++) {
  maxErr = Math.max(maxErr, Math.abs(basePos[i] - merged[i]))
}
assert(maxErr < 1e-5, `并行结果与单线程基准逐顶点一致 (err=${maxErr.toExponential(2)})`)
assert(mergedMats.size === model.faces.length, `并行矩阵覆盖全部 ${model.faces.length} 面`)
assert(results.length === 4, '4 个 Worker 全部返回')
console.log(`  并行(4线程)耗时 ${parMs.toFixed(2)}ms，${model.creases.length} 折痕 / ${(meshes.high.positions.length/3).toLocaleString()} 顶点`)
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
