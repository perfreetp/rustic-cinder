import type { ProfilePoint } from './types.ts';

/**
 * 二维 centripetal Catmull-Rom（α=0.5）参数样条。
 * 输入 z 单调的控制点，按弧长重采样为等距点，并给出单位切向量。
 * centripetal 参数化可抑制过冲与自交，适合手工编辑的母线。
 *
 * 节点参数：t_{i+1} = t_i + |P_{i+1}-P_i|^{0.5}
 * 切线：m_i = (P_{i+1}-P_i)/(t_{i+1}-t_i) − (P_i-P_{i-1})/(t_i-t_{i-1})
 *       （分量分别计算，再做 Hermite 插值）
 */

export interface CurveSample2D {
  r: number;
  z: number;
  /** 单位切向量（母线切向，位于 rz 平面） */
  tr: number;
  tz: number;
  /** 从底端起算的累计弧长 */
  s: number;
}

interface Knot {
  r: number;
  z: number;
  t: number;
  mr: number;
  mz: number;
}

function buildKnots(points: ProfilePoint[]): Knot[] {
  const n = points.length;
  // 节点参数 t
  const ts = new Array<number>(n);
  ts[0] = 0;
  for (let i = 1; i < n; i++) {
    const dr = points[i].r - points[i - 1].r;
    const dz = points[i].z - points[i - 1].z;
    ts[i] = ts[i - 1] + Math.sqrt(Math.hypot(dr, dz)); // α=0.5 → 距离的 1/2 次方
  }
  // 端点切线：复制端点（P-1=P0, Pn=Pn-1）
  const knots: Knot[] = points.map((p, i) => ({ r: p.r, z: p.z, t: ts[i], mr: 0, mz: 0 }));
  const tangent = (i: number, dim: 'r' | 'z'): number => {
    const p = (idx: number) => (dim === 'r' ? points[idx].r : points[idx].z);
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const fwd = (p(i1) - p(i)) / ((ts[i1] - ts[i]) || 1e-9);
    const bwd = (p(i) - p(i0)) / ((ts[i] - ts[i0]) || 1e-9);
    return fwd - bwd;
  };
  for (let i = 0; i < n; i++) {
    knots[i].mr = tangent(i, 'r');
    knots[i].mz = tangent(i, 'z');
  }
  return knots;
}

/** 单段 Hermite 插值，u∈[0,1] 为段内局部参数 */
function hermite(p0: number, p1: number, m0: number, m1: number, dt: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  // 切线需乘以段参数宽度 dt
  return h00 * p0 + h10 * dt * m0 + h01 * p1 + h11 * dt * m1;
}

/**
 * 将控制点采样为等弧长序列：
 * 先按全局参数细采样（每段固定细分数），再按累计弧长等距重采样。
 */
export function sampleProfileCurve(points: ProfilePoint[], count: number): CurveSample2D[] {
  if (points.length < 2 || count < 2) {
    throw new Error('母线至少需要 2 个控制点');
  }
  const ordered = [...points].sort((a, b) => a.z - b.z);
  const knots = buildKnots(ordered);

  // 阶段 1：逐段细采样
  const perSeg = 96;
  const fine: CurveSample2D[] = [];
  let prevR = 0, prevZ = 0, totalLen = 0;
  for (let seg = 0; seg < knots.length - 1; seg++) {
    const k0 = knots[seg];
    const k1 = knots[seg + 1];
    const dt = k1.t - k0.t || 1e-9;
    const steps = seg === knots.length - 2 ? perSeg : perSeg - 1;
    for (let q = 0; q <= steps; q++) {
      const u = q / perSeg;
      const r = hermite(k0.r, k1.r, k0.mr, k1.mr, dt, u);
      const z = hermite(k0.z, k1.z, k0.mz, k1.mz, dt, u);
      // 解析导数（Hermite 基函数求导）
      const u2 = u * u;
      const dh00 = 6 * u2 - 6 * u;
      const dh10 = 3 * u2 - 4 * u + 1;
      const dh01 = -6 * u2 + 6 * u;
      const dh11 = 3 * u2 - 2 * u;
      let dr = (dh00 * k0.r + dh10 * dt * k0.mr + dh01 * k1.r + dh11 * dt * k1.mr) / dt;
      let dz = (dh00 * k0.z + dh10 * dt * k0.mz + dh01 * k1.z + dh11 * dt * k1.mz) / dt;
      const dl = Math.hypot(dr, dz) || 1;
      dr /= dl; dz /= dl;
      if (fine.length > 0) totalLen += Math.hypot(r - prevR, z - prevZ);
      fine.push({ r, z, tr: dr, tz: dz, s: totalLen });
      prevR = r; prevZ = z;
    }
  }

  // 阶段 2：按等弧长重采样
  const out: CurveSample2D[] = [];
  let fi = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / (count - 1)) * totalLen;
    while (fi < fine.length - 2 && fine[fi + 1].s < target) fi++;
    const a = fine[fi], b = fine[fi + 1];
    const f = (target - a.s) / ((b.s - a.s) || 1e-9);
    const r = a.r + (b.r - a.r) * f;
    const z = a.z + (b.z - a.z) * f;
    let tr = a.tr + (b.tr - a.tr) * f;
    let tz = a.tz + (b.tz - a.tz) * f;
    const tl = Math.hypot(tr, tz) || 1;
    tr /= tl; tz /= tl;
    out.push({ r, z, tr, tz, s: target });
  }
  return out;
}
