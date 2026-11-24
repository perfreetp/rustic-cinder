import type { ProfileConfig, WeaveBuffers, WeaveConfig, WeaveStats } from './types.ts';
import { sampleProfileCurve } from './spline.ts';
import { SurfaceOfRevolution } from './surface.ts';

/**
 * 平纹编织几何引擎（纯计算，可在 Worker 中运行）。
 *
 * 两族螺旋篾条 A/B 在回转曲面上按菱形棋盘格交替浮沉。
 * 路径统一参数化：θ(s) = sign·K·I(s) + 2πk/N，其中 I(s)=∫ ds/r(s)，
 *   K 为无量纲螺旋斜率常数，r·dθ/ds = ±K（周向速率，锥面上仍是测地螺旋）。
 *   - 自动模式：K = 1/tanβ，β 为篾条与周向的螺旋角，由 spacingFactor 缩放
 *   - 固定圈数模式：K = turns·2π / I(L)
 * 浮沉：菱形单元奇偶性决定浮/沉，中心线沿曲面法向余弦起伏，
 *   交叉处两中心线法向间距恰好 = 厚度 + 安全间隙，保证零穿插。
 * 截面为矩形，沿曲面法向 N 给厚度、沿 N×T 给宽度，四面独立面法线。
 */

const TWO_PI = Math.PI * 2;

export interface BuildResult {
  familyA: WeaveBuffers;
  familyB: WeaveBuffers;
  stats: WeaveStats;
}

/** 单调积分器：维护 G(s)=∫0^s g(u)du 的分段表，按弧长等距、线性插值查询 */
class IntegralTable {
  private readonly s: number[] = [0];
  private readonly cum: number[] = [0];
  constructor(samples: { s: number }[], g: (i: number) => number) {
    let acc = 0;
    for (let i = 1; i < samples.length; i++) {
      const gi = 0.5 * (g(i) + g(i - 1));
      acc += (samples[i].s - samples[i - 1].s) * gi;
      this.s.push(samples[i].s);
      this.cum.push(acc);
    }
  }
  get total(): number {
    return this.cum[this.cum.length - 1];
  }
  valueAt(s: number): number {
    if (s <= 0) return 0;
    const hi0 = this.s.length - 1;
    if (s >= this.s[hi0]) return this.cum[hi0];
    // 表按弧长等距，直接定位段
    const f0 = (s / (this.s[hi0] || 1e-12)) * hi0;
    const lo = Math.min(hi0 - 1, Math.floor(f0));
    const f = f0 - lo;
    return this.cum[lo] + (this.cum[lo + 1] - this.cum[lo]) * f;
  }
}

function newBuffers(stripCount: number, segments: number): WeaveBuffers {
  const rings = segments + 1;
  const cornerVerts = rings * 8; // 矩形截面 4 面 × 每面 2 个独立法线顶点
  return {
    positions: new Float32Array(cornerVerts * stripCount * 3),
    normals: new Float32Array(cornerVerts * stripCount * 3),
    uvs: new Float32Array(cornerVerts * stripCount * 2),
    // 每个环间隔 8 个三角：顶面 2 + 底面 2 + 两侧面各 2
    outerIndices: new Uint32Array(stripCount * segments * 6 * 3), // 顶面+侧面
    innerIndices: new Uint32Array(stripCount * segments * 2 * 3), // 底面
    vertexCount: cornerVerts * stripCount,
  };
}

export function buildWeave(profileCfg: ProfileConfig, weave: WeaveConfig, segments: number): BuildResult {
  const t0 = (globalThis.performance?.now?.() ?? Date.now()) as number;

  const curve = sampleProfileCurve(profileCfg.points, profileCfg.samples);
  const surface = new SurfaceOfRevolution(curve);
  const L = surface.length;
  const N = Math.max(2, Math.round(weave.familyCount));
  const beta = (weave.helixAngle * Math.PI) / 180;
  const w = weave.stripWidth;
  const t = weave.stripThickness;
  const clearance = Math.max(0, weave.clearance);

  // I(s) = ∫ ds/r，量程 I(L)
  const invRTable = new IntegralTable(curve, (i) => 1 / (curve[i].r || 1e-6));
  const I = (s: number) => invRTable.valueAt(s);
  const Iend = invRTable.total;

  // 统一螺旋斜率 K：r·dθ/ds = ±K
  // 自动模式按螺旋角（spacingFactor>1 增大螺距留缝，等价于减小有效角）；
  // 固定圈数模式由总方位扫掠反解 K。
  let K: number;
  let effectiveBeta: number;
  if (weave.turns > 0) {
    const sweep = weave.turns * TWO_PI;
    K = sweep / (Iend || 1e-9);
    effectiveBeta = Math.atan(1 / K);
  } else {
    // spacingFactor 缩放螺距：1=按螺旋角紧密排布，>1 螺距加大（K 增大）留缝，<1 加密
    K = (1 / Math.tan(beta)) * Math.max(0.2, weave.spacingFactor);
    effectiveBeta = Math.atan(1 / K);
  }
  const sweep = K * Iend;
  const effectiveTurns = sweep / TWO_PI;

  // 浮沉幅度：交叉处两中心线法向间距 = t + clearance
  const amp = 0.5 * (t + clearance);

  function buildFamily(sign: 1 | -1): WeaveBuffers {
    const buf = newBuffers(N, segments);
    const { positions: P, normals: NN, uvs: UV, outerIndices: oi, innerIndices: ii } = buf;
    let outerPtr = 0;
    let innerPtr = 0;
    let uvptr = 0;
    const signBias = sign; // A=+1, B=-1，B 族浮沉奇偶取反

    for (let k = 0; k < N; k++) {
      const baseVertex = k * (segments + 1) * 8;

      for (let j = 0; j <= segments; j++) {
        const u = j / segments;
        const s = u * L;
        const q = surface.sampleAt(s);

        const theta = sign * K * I(s) + (sign * TWO_PI * k) / N;
        const cos = Math.cos(theta), sin = Math.sin(theta);
        // 外法向 N 与母线切向 Ts、周向 Eθ
        const Nx = q.tz * cos, Ny = -q.tr, Nz = q.tz * sin;
        const Tsx = q.tr * cos, Tsy = q.tz, Tsz = q.tr * sin;
        const Ex = -sin, Ez = cos;

        // 篾条前进方向 T = normalize(dP/ds)，r·dθ/ds = sign·K
        let Tx = Tsx + sign * K * Ex;
        let Ty = Tsy;
        let Tz = Tsz + sign * K * Ez;
        const tl = Math.hypot(Tx, Ty, Tz) || 1;
        Tx /= tl; Ty /= tl; Tz /= tl;

        // 菱形棋盘格指标（a 为公共经线坐标，b 为各自路径坐标）
        const aRaw = (N / TWO_PI) * (K * I(s));
        const bRaw = (N / TWO_PI) * theta;
        const parity = (Math.floor(aRaw) + Math.floor(bRaw)) & 1;
        // 浮沉余弦的相位取「本族路径坐标」b 的小数部分：
        // 交叉点位于 bRaw 整数处，cos(2π·frac) 在该处取 ±1，波峰/波谷正对交叉
        const phase = bRaw - Math.floor(bRaw);
        const bump = Math.cos(TWO_PI * phase);

        // A 族 parity=0 浮起；B 族取反 → 交叉点两族一浮一沉
        const over = signBias === 1 ? parity === 0 : parity === 1;
        const h = (over ? 1 : -1) * signBias * amp * bump;

        const px = q.r * cos, py = q.z, pz = q.r * sin;

        // 宽度方向 W = N × T（单位，切平面内垂直于篾条走向）
        let Wx = Ny * Tz - Nz * Ty;
        let Wy = Nz * Tx - Nx * Tz;
        let Wz = Nx * Ty - Ny * Tx;
        const wl = Math.hypot(Wx, Wy, Wz) || 1;
        Wx /= wl; Wy /= wl; Wz /= wl;

        const hw = w * 0.5, ht = t * 0.5;
        // 8 顶点：每面两个独立法线顶点
        // 0/1 顶面(+N): ±W；2/3 底面(-N): ±W；4/5 W+侧面(+W): ±N；6/7 W-侧面(-W): ±N
        const ring = baseVertex + j * 8;
        const put = (slot: number, ow: number, on: number, nx: number, ny: number, nz: number, vu: number, vv: number) => {
          const vi = (ring + slot) * 3;
          P[vi] = px + Wx * ow + Nx * (h + on);
          P[vi + 1] = py + Wy * ow + Ny * (h + on);
          P[vi + 2] = pz + Wz * ow + Nz * (h + on);
          NN[vi] = nx; NN[vi + 1] = ny; NN[vi + 2] = nz;
          UV[uvptr * 2] = vu; UV[uvptr * 2 + 1] = vv;
          uvptr++;
        };
        const vu = u * effectiveTurns;
        put(0, hw, ht, Nx, Ny, Nz, vu, 1);
        put(1, -hw, ht, Nx, Ny, Nz, vu, 0);
        put(2, hw, -ht, -Nx, -Ny, -Nz, vu, 0);
        put(3, -hw, -ht, -Nx, -Ny, -Nz, vu, 1);
        put(4, hw, ht, Wx, Wy, Wz, vu, 1);
        put(5, hw, -ht, Wx, Wy, Wz, vu, 0);
        put(6, -hw, ht, -Wx, -Wy, -Wz, vu, 1);
        put(7, -hw, -ht, -Wx, -Wy, -Wz, vu, 0);
      }

      for (let j = 0; j < segments; j++) {
        const r0 = baseVertex + j * 8;
        const r1 = baseVertex + (j + 1) * 8;
        // 顶面（外）：0-1-1', 0-1'-0'
        oi[outerPtr++] = r0 + 0; oi[outerPtr++] = r0 + 1; oi[outerPtr++] = r1 + 1;
        oi[outerPtr++] = r0 + 0; oi[outerPtr++] = r1 + 1; oi[outerPtr++] = r1 + 0;
        // W+ 侧面（外）：4-5-5', 4-5'-4'
        oi[outerPtr++] = r0 + 4; oi[outerPtr++] = r0 + 5; oi[outerPtr++] = r1 + 5;
        oi[outerPtr++] = r0 + 4; oi[outerPtr++] = r1 + 5; oi[outerPtr++] = r1 + 4;
        // W- 侧面（外）：6-7'-7, 6-6'-7'（绕序与 W+ 相反）
        oi[outerPtr++] = r0 + 6; oi[outerPtr++] = r1 + 7; oi[outerPtr++] = r0 + 7;
        oi[outerPtr++] = r0 + 6; oi[outerPtr++] = r1 + 6; oi[outerPtr++] = r1 + 7;
        // 底面（内）：2-3'-3, 2-2'-3'
        ii[innerPtr++] = r0 + 2; ii[innerPtr++] = r1 + 3; ii[innerPtr++] = r0 + 3;
        ii[innerPtr++] = r0 + 2; ii[innerPtr++] = r1 + 2; ii[innerPtr++] = r1 + 3;
      }
    }
    return buf;
  }

  const familyA = buildFamily(1);
  const familyB = buildFamily(-1);

  const t1 = (globalThis.performance?.now?.() ?? Date.now()) as number;
  // 中点处相邻篾条的切平面垂直间距：周向弧距 × sin(实际螺旋角)
  const rMid = surface.midRadius();
  const stripSpacing = ((2 * Math.PI * rMid) / N) * Math.sin(effectiveBeta);
  // 覆盖率 = 篾宽/间距，可超过 100%（>100% 表示篾条相互重叠）
  const coverage = (w / stripSpacing) * 100;
  const stats: WeaveStats = {
    totalStrips: N * 2,
    totalVertices: familyA.vertexCount + familyB.vertexCount,
    totalTriangles: N * segments * 8 * 2,
    buildMs: Math.max(0.01, t1 - t0),
    heightMm: surface.height,
    maxRadiusMm: surface.maxRadius,
    effectiveTurns,
    effectiveHelixAngle: (effectiveBeta * 180) / Math.PI,
    stripSpacing,
    coverage,
  };
  return { familyA, familyB, stats };
}
