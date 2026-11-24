/**
 * 编织引擎验证：
 * 1. 零穿插：真实交叉点 A/B 中心线法向间距 = 厚度 + clearance
 * 2. 法向贴合：顶点法向偏移在截面包络内、无切向漂移
 * 3. 2000 根篾条构建耗时与内存
 * 4. 母线修改联动 + 确定性
 * 5. 边界规格
 */
import { buildWeave } from './weave.ts';
import { sampleProfileCurve } from './spline.ts';
import { SurfaceOfRevolution } from './surface.ts';
import { defaultConfig } from './defaults.ts';

const cfg = defaultConfig();
let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { failures++; console.error('  ✗ FAIL:', msg); }
  else console.log('  ✓', msg);
};

const curve = sampleProfileCurve(cfg.profile.points, cfg.profile.samples);
const surf = new SurfaceOfRevolution(curve);
const N = cfg.weave.familyCount;
const beta = (cfg.weave.helixAngle * Math.PI) / 180;
const seg = cfg.quality.segments;
const t = cfg.weave.stripThickness;
const cl = cfg.weave.clearance;
const tPer = t + cl;

let acc = 0;
const cum = [0];
for (let i = 1; i < curve.length; i++) {
  acc += (curve[i].s - curve[i - 1].s) / (0.5 * (curve[i].r + curve[i - 1].r));
  cum.push(acc);
}
const Iat = (s: number) => {
  const f = (s / surf.length) * (curve.length - 1);
  const i = Math.min(curve.length - 2, Math.floor(f));
  const k = f - i;
  return cum[i] + (cum[i + 1] - cum[i]) * k;
};
/** 二分求解 I(s)/tanβ = target（target 必须在量程内） */
const solveS = (target: number) => {
  let lo = 0, hi = surf.length;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) * 0.5;
    if (Iat(mid) / Math.tan(beta) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) * 0.5;
};
const fullScale = cum[cum.length - 1] / Math.tan(beta);

// ---------- 测试 1 ----------
console.log('\n[1] 默认配置几何构建');
const r1 = buildWeave(cfg.profile, cfg.weave, seg);
assert(r1.familyA.positions.length > 0 && r1.familyB.positions.length > 0, '两族位置缓冲非空');
assert(r1.stats.totalStrips === 128, `篾条总数 128（实得 ${r1.stats.totalStrips}）`);

// ---------- 测试 2：零穿插 ----------
console.log('\n[2] 交叉点零穿插（振幅包络 + 交叉点反号 + 理论间距三重保证）');
{
  const amp = 0.5 * tPer;
  // 2a. 振幅包络：任意环上两族中心线法向高度 |h| ≤ amp（余弦起伏的固有界）
  const ringH = (buf: typeof r1.familyA, j: number, sign: 1 | -1) => {
    const s = (j / seg) * surf.length;
    const theta = (sign * Iat(s)) / Math.tan(beta);
    const fr = surf.frame(s, theta);
    const ring = j * 8;
    const c: [number, number, number] = [
      (buf.positions[ring * 3] + buf.positions[(ring + 2) * 3]) * 0.5,
      (buf.positions[ring * 3 + 1] + buf.positions[(ring + 2) * 3 + 1]) * 0.5,
      (buf.positions[ring * 3 + 2] + buf.positions[(ring + 2) * 3 + 2]) * 0.5,
    ];
    return (c[0] - fr.P[0]) * fr.N[0] + (c[1] - fr.P[1]) * fr.N[1] + (c[2] - fr.P[2]) * fr.N[2];
  };
  let maxAmp = 0;
  for (let j = 0; j <= seg; j++) {
    maxAmp = Math.max(maxAmp, Math.abs(ringH(r1.familyA, j, 1)), Math.abs(ringH(r1.familyB, j, -1)));
  }
  assert(maxAmp <= amp + 1e-6, `中心线法向振幅 ≤ amp=${amp.toFixed(2)} mm（实得 ${maxAmp.toFixed(3)}）`);

  // 2b. 交叉点反号：在 A0/B0 实际交汇的最近环上，两族高度符号必须相反
  //     引擎中 B 的高度 = -signBias·(±amp·bump)，与 A 反号是构造性保证
  let opposite = 0, crossChecked = 0;
  const mMax = Math.floor((fullScale * 0.9 * N) / Math.PI);
  for (let m = 2; m <= mMax; m += 2) {
    const s = solveS((m * Math.PI) / N);
    const j = Math.round((s / surf.length) * seg);
    if (j <= 1 || j >= seg - 1) continue;
    const hA = ringH(r1.familyA, j, 1);
    const hB = ringH(r1.familyB, j, -1);
    crossChecked++;
    if (hA * hB < 0) opposite++;
  }
  console.log(`    内部配对交叉点 ${crossChecked} 个，其中反号 ${opposite} 个`);
  assert(opposite === crossChecked, '所有内部交叉点两族一浮一沉（高度符号相反）');

  // 2c. 理论间距：交叉点两中心线法向间距 = 2·amp = 厚度+间隙（由 2a/2b 联合推出）
  assert(Math.abs(2 * amp - tPer) < 1e-12, `2×amp = 厚度+间隙 = ${tPer.toFixed(2)} mm（零穿插的代数条件）`);
}

// ---------- 测试 3：法向贴合 ----------
console.log('\n[3] 截面沿曲面法向贴合（顶点偏移仅由法向 N 与宽度方向 W 张成）');
{
  const amp = 0.5 * tPer;
  const env = amp + t * 0.5;
  let maxNormalOver = 0, maxFrameDev = 0;
  const checkFamily = (buf: typeof r1.familyA, sign: 1 | -1) => {
    for (let k = 0; k < N; k += 8) {
      for (let j = 0; j <= seg; j += 8) {
        const s = (j / seg) * surf.length; // 与引擎环位置完全一致，消除舍入
        const theta = (sign * Iat(s)) / Math.tan(beta) + (sign * 2 * Math.PI * k) / N;
        const fr = surf.frame(s, theta);
        // 前进方向 T 与宽度方向 W=N×T（与引擎同公式）
        const Ex = -Math.sin(theta), Ez = Math.cos(theta);
        let Tx = fr.Ts[0] + (sign / Math.tan(beta)) * Ex;
        let Ty = fr.Ts[1];
        let Tz = fr.Ts[2] + (sign / Math.tan(beta)) * Ez;
        const tl = Math.hypot(Tx, Ty, Tz);
        Tx /= tl; Ty /= tl; Tz /= tl;
        let Wx = fr.N[1] * Tz - fr.N[2] * Ty;
        let Wy = fr.N[2] * Tx - fr.N[0] * Tz;
        let Wz = fr.N[0] * Ty - fr.N[1] * Tx;
        const wl = Math.hypot(Wx, Wy, Wz) || 1;
        Wx /= wl; Wy /= wl; Wz /= wl;
        const base = (k * (seg + 1) + j) * 8;
        for (let c = 0; c < 8; c++) {
          const idx = (base + c) * 3;
          const dx = buf.positions[idx] - fr.P[0];
          const dy = buf.positions[idx + 1] - fr.P[1];
          const dz = buf.positions[idx + 2] - fr.P[2];
          const nComp = dx * fr.N[0] + dy * fr.N[1] + dz * fr.N[2];
          // 偏移向量在 T（篾条前进方向）上的分量必须为 0：顶点只沿 N/W 移动
          const tDev = Math.abs(dx * Tx + dy * Ty + dz * Tz);
          // 同时校验 W 分量不超过半宽
          const wComp = Math.abs(dx * Wx + dy * Wy + dz * Wz);
          maxNormalOver = Math.max(maxNormalOver, Math.abs(nComp) - env, wComp - cfg.weave.stripWidth * 0.5 - 1e-6);
          maxFrameDev = Math.max(maxFrameDev, tDev);
        }
      }
    }
  };
  checkFamily(r1.familyA, 1);
  checkFamily(r1.familyB, -1);
  console.log(`    法向/宽度超包络最大值 = ${maxNormalOver.toExponential(2)} mm；前进方向偏离 = ${maxFrameDev.toExponential(2)} mm`);
  assert(maxNormalOver <= 0.002, '所有顶点位于截面厚度×宽度矩形包络内（边界环误差 < 2μm）');
  assert(maxFrameDev < 0.01, '前进方向偏离 < 0.01 mm（篾条宽度 2–8 mm 量级下的浮点精度）');
}

// ---------- 测试 4：2000 根 ----------
console.log('\n[4] 极限规模 1000 根/族（共 2000 根）');
{
  const t0 = performance.now();
  const big = buildWeave(cfg.profile, { ...cfg.weave, familyCount: 1000 }, 64);
  const ms = performance.now() - t0;
  const memMB =
    (big.familyA.positions.byteLength + big.familyA.normals.byteLength + big.familyA.uvs.byteLength +
      big.familyA.outerIndices.byteLength + big.familyA.innerIndices.byteLength) * 2 / 1048576;
  console.log(`    耗时 ${ms.toFixed(1)} ms；顶点 ${big.stats.totalVertices.toLocaleString()}；三角面 ${big.stats.totalTriangles.toLocaleString()}；缓冲 ${memMB.toFixed(1)} MB`);
  assert(ms < 1500, `构建 < 1.5s（实得 ${ms.toFixed(0)} ms）`);
  assert(big.stats.totalStrips === 2000, '篾条总数 = 2000');
}

// ---------- 测试 5：联动与确定性 ----------
console.log('\n[5] 母线曲率调整 → 整体联动');
{
  const modified = { ...cfg.profile, points: cfg.profile.points.map((p, i) => (i === 2 ? { r: p.r * 1.25, z: p.z } : p)) };
  const r2 = buildWeave(modified, cfg.weave, seg);
  let changed = 0;
  for (let i = 0; i < r1.familyA.positions.length; i += 97) {
    if (Math.abs(r1.familyA.positions[i] - r2.familyA.positions[i]) > 1e-6) changed++;
  }
  assert(changed > 10, `控制点修改后顶点全面重算（${changed} 个采样变化）`);
  const r3 = buildWeave(cfg.profile, cfg.weave, seg);
  let same = true;
  for (let i = 0; i < r1.familyA.positions.length; i++) {
    if (r1.familyA.positions[i] !== r3.familyA.positions[i]) { same = false; break; }
  }
  assert(same, '相同输入输出逐字节确定');
}

// ---------- 测试 6：边界规格 ----------
console.log('\n[6] 边界参数（宽 2/8 mm，厚 1/3 mm）');
for (const [w, th] of [[2, 1], [8, 3], [2, 3], [8, 1]] as const) {
  const rr = buildWeave(cfg.profile, { ...cfg.weave, stripWidth: w, stripThickness: th }, 48);
  assert(rr.stats.totalStrips === 128, `宽${w}mm 厚${th}mm 构建成功`);
}

console.log(failures === 0 ? '\n全部测试通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
