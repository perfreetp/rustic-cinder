/** 核心纯逻辑数值验证(无 DOM 依赖),用 node --experimental-vm-modules 直接跑 */
import { parseMultiXyz, parseTrajectoryJson } from '../src/lib/parsers.ts'
import { inferBonds, boundingSphere } from '../src/lib/geometry.ts'
import { generateDemoTrajectory } from '../src/lib/demo.ts'

let failed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failed++
    console.error(`✗ ${msg}`)
  } else {
    console.log(`✓ ${msg}`)
  }
}
function approx(a: number, b: number, eps = 1e-5): boolean {
  return Math.abs(a - b) < eps
}

// 1. 多帧 XYZ 解析
const xyz = `2
frame 0
C 0 0 0
O 1.2 0 0
2
frame 1
C 0 0 0.5
O 1.2 0 0.9
2
frame 2
C 0 0 1.0
O 1.2 0 1.3
`
const t1 = parseMultiXyz(xyz, 'test-xyz')
assert(t1.frameCount === 3, 'XYZ 解析出 3 帧')
assert(t1.atomCount === 2, 'XYZ 解析出 2 原子')
assert(t1.atoms[0].element === 'C' && t1.atoms[1].element === 'O', '元素符号正确')
assert(approx(t1.positions[1 * 6 + 2], 0.5), '第2帧 C 的 z=0.5')
assert(approx(t1.positions[2 * 6 + 5], 1.3), '第3帧 O 的 z=1.3')

// 错误帧应抛异常
let threw = false
try {
  parseMultiXyz('3\nx\nC 0 0 0\n', 'bad')
} catch {
  threw = true
}
assert(threw, '截断的 XYZ 文件抛出 ParseError')

// 2. JSON 解析(含残基)
const json = JSON.stringify({
  name: 'j',
  frameDelta: 0.5,
  atoms: [
    { element: 'N', residue: 'ALA', residueId: 1, atomName: 'N' },
    { element: 'CA', residue: 'ALA', residueId: 1, atomName: 'CA' },
  ],
  frames: [
    [0, 0, 0, 1.45, 0, 0],
    [0, 0, 1, 1.45, 0, 1],
  ],
})
const t2 = parseTrajectoryJson(json, 'j')
assert(t2.frameCount === 2 && t2.atomCount === 2, 'JSON 帧数/原子数正确')
assert(t2.atoms[1].residue === 'ALA' && t2.atoms[1].atomName === 'CA', 'JSON 残基元数据保留')
assert(t2.frameDelta === 0.5, 'frameDelta 保留')

// 3. 成键推断
const bonds = inferBonds(t2.positions, 2)
assert(bonds.length === 2 && bonds[0] === 0 && bonds[1] === 1, '1.45 Å 的 N-CA 被识别为键')
const far = new Float32Array([0, 0, 0, 5, 0, 0])
assert(inferBonds(far, 2).length === 0, '5 Å 距离不成键')

// 4. 包围球
const bs = boundingSphere(t2.positions, 2)
assert(approx(bs.center[0], 0.725), '包围球质心 x 正确')
assert(bs.radius > 0, '包围球半径为正')

// 5. 演示轨迹:规模、Top10 热点、累计位移单调性
const demo = generateDemoTrajectory({ residues: 24, frames: 1200 })
assert(demo.frameCount === 1200, '演示轨迹 1200 帧')
assert(demo.atomCount === 144, '演示轨迹 144 原子(24 残基 × 6)')
const stride = demo.atomCount * 3
const cum = new Float32Array(demo.atomCount)
for (let f = 1; f < demo.frameCount; f++) {
  for (let i = 0; i < demo.atomCount; i++) {
    const dx = demo.positions[f * stride + i * 3] - demo.positions[(f - 1) * stride + i * 3]
    const dy = demo.positions[f * stride + i * 3 + 1] - demo.positions[(f - 1) * stride + i * 3 + 1]
    const dz = demo.positions[f * stride + i * 3 + 2] - demo.positions[(f - 1) * stride + i * 3 + 2]
    cum[i] += Math.hypot(dx, dy, dz)
  }
}
const top10Set = new Set(
  Array.from({ length: demo.atomCount }, (_, i) => i)
    .sort((a, b) => cum[b] - cum[a])
    .slice(0, 10),
)
assert(cum[Array.from(top10Set)[0]] > 0, 'Top10 原子存在非零累计位移')
const allPositive = Array.from(cum).every((v) => v > 0)
assert(allPositive, '所有原子累计位移为正(存在运动)')

// 6. 插值数学:线性中点 + Catmull-Rom 过控制点
// 线性:帧 0→1 中点
{
  const src = new Float32Array([0, 0, 0, 10, 0, 0, 20, 0, 0])
  const i0 = 0
  const t = 0.5
  const lin = src[i0 * 3] + (src[(i0 + 1) * 3] - src[i0 * 3]) * t
  assert(approx(lin, 5), '线性插值中点为 5')
}
// Catmull-Rom 在 t=0 与 t=1 必须精确经过控制点
{
  const p = [0, 8, 4, 12]
  const cr = (t: number) => {
    const w0 = -0.5 * t ** 3 + t ** 2 - 0.5 * t
    const w1 = 1.5 * t ** 3 - 2.5 * t ** 2 + 1
    const w2 = -1.5 * t ** 3 + 2 * t ** 2 + 0.5 * t
    const w3 = 0.5 * t ** 3 - 0.5 * t ** 2
    return w0 * p[0] + w1 * p[1] + w2 * p[2] + w3 * p[3]
  }
  assert(approx(cr(0), p[1]), 'Catmull-Rom t=0 经过 P1')
  assert(approx(cr(1), p[2]), 'Catmull-Rom t=1 经过 P2')
  const mid = cr(0.5)
  assert(mid > Math.min(p[1], p[2]) && mid < Math.max(p[1], p[2]) + 1, 'Catmull-Rom 中点落在合理区间')
}

// 7. 千帧规模内存检查
const big = generateDemoTrajectory({ residues: 40, frames: 1500 })
assert(big.positions.length === 40 * 6 * 1500 * 3, '1500 帧大轨迹缓冲长度正确')
assert(big.positions instanceof Float32Array, '坐标为 Float32Array')

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
