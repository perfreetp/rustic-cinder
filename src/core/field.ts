/**
 * 笔刷堆叠的隐式场 (SDF) 编译器。
 *
 * 整个造型 = 基础形体  →  第 1 笔  →  第 2 笔  →  …  →  第 n 笔
 *   添加笔刷: 平滑并集 (d ← smin(d, brush, k))，k 由"融合强度"档位决定
 *   橡皮笔刷: 平滑差集 (d ← smax(d, -brush, k))，表面自动重新闭合
 *   平滑笔刷: 曲面参考的平均曲率流 (只压低凸起、填平凹陷, 球面保持不动),
 *             强度随按住时间递增
 *
 * 每一笔可以开启镜像: 镜像副本在编译期生成，始终与主笔刷同步。
 */

import type { BaseShapeId, Stroke, SymAxis, Vec3 } from './types';

export const DOMAIN_HALF = 1.5;

export const BASE_SHAPE_IDS: BaseShapeId[] = ['sphere', 'cube', 'cylinder', 'capsule', 'torus'];

/** 三档精度对应的网格单元尺寸 (世界单位; 基础形体半径约 1) */
export const CELL_SIZE: Record<'draft' | 'standard' | 'fine', number> = {
  draft: 0.06,
  standard: 3.0 / 72,
  fine: 0.03,
};

/** 三档笔刷半径 */
export const BRUSH_RADIUS = [0.16, 0.24, 0.34] as const;
/** 三档硬度 (决定剖面接近扁透镜还是鼓起的球冠) */
export const BRUSH_HARDNESS = [0.12, 0.5, 0.92] as const;
/** 三档融合强度 (相对半径的焊缝宽度) */
export const BRUSH_BLEND = [0.26, 0.46, 0.72] as const;

export function blendWidth(radius: number, blendLevel: number) {
  const f = BRUSH_BLEND[Math.max(0, Math.min(2, blendLevel))];
  return Math.min(radius * 0.6, radius * f + 0.006);
}

/** 平滑笔刷的影响半径 */
export function smoothReach(radius: number, hardnessLevel: number) {
  return radius * [1.5, 1.28, 1.1][Math.max(0, Math.min(2, hardnessLevel))];
}

function reflect(p: Vec3, axis: SymAxis | null): Vec3 {
  if (axis === 'x') return [-p[0], p[1], p[2]];
  if (axis === 'y') return [p[0], -p[1], p[2]];
  if (axis === 'z') return [p[0], p[1], -p[2]];
  return [p[0], p[1], p[2]];
}

export type Bounds = { min: Vec3; max: Vec3 };

export function emptyBounds(): Bounds {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export function boundsEmpty(b: Bounds) {
  return !(b.max[0] >= b.min[0]);
}

/** 一笔影响到的世界空间包围盒 (已计入镜像与融合宽度) */
export function strokeBounds(stroke: Stroke): Bounds {
  return strokeBoundsFrom(stroke, 0);
}

/**
 * 只取笔触轨迹从 index 起的部分 (含前一个点, 因为段是相邻两点连成的)。
 * 拖动时用它来算"这一笔新增长出来的部分"的脏区。
 */
export function strokeBoundsFrom(stroke: Stroke, index: number): Bounds {
  const from = Math.max(0, index - 1);
  if (from === 0) return fullStrokeBounds(stroke);
  const partial: Stroke = {
    ...stroke,
    points: stroke.points.slice(from),
    normals: stroke.normals.slice(from),
  };
  return fullStrokeBounds(partial);
}

function fullStrokeBounds(stroke: Stroke): Bounds {
  const hl = Math.round(stroke.hardness * 2);
  const bl = Math.round(stroke.blend * 2);
  const reach =
    stroke.kind === 'smooth'
      ? smoothReach(stroke.radius, hl) * 1.04
      : stroke.radius * 1.06 + blendWidth(stroke.radius, bl) * 1.5;

  const b = emptyBounds();
  const addPoint = (p: Vec3) => {
    for (let i = 0; i < 3; i++) {
      if (p[i] - reach < b.min[i]) b.min[i] = p[i] - reach;
      if (p[i] + reach > b.max[i]) b.max[i] = p[i] + reach;
    }
  };
  if (stroke.points.length === 0) return b;
  for (const p of stroke.points) addPoint(p);
  if (stroke.mirrorAxis) {
    for (const p of stroke.points) addPoint(reflect(p, stroke.mirrorAxis));
  }
  return b;
}

/* ------------------------------------------------------------------ */
/* 编译后的场                                                          */
/* ------------------------------------------------------------------ */

const SEG_STRIDE = 13;
const PROG_STRIDE = 8;

export interface CompiledField {
  eval: (x: number, y: number, z: number) => number;
  /** 仅用于调试 / 统计 */
  segmentCount: number;
  opCount: number;
}

export function baseSdf(id: BaseShapeId, x: number, y: number, z: number): number {
  switch (id) {
    case 'sphere':
      return Math.sqrt(x * x + y * y + z * z) - 1.0;
    case 'cube': {
      const r = 0.11;
      const hx = Math.abs(x) - 0.74 + r;
      const hy = Math.abs(y) - 0.74 + r;
      const hz = Math.abs(z) - 0.74 + r;
      const mx = Math.max(hx, 0);
      const my = Math.max(hy, 0);
      const mz = Math.max(hz, 0);
      return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(hx, hy, hz), 0) - r;
    }
    case 'cylinder': {
      const r = 0.12;
      const rr = Math.sqrt(x * x + z * z) - 0.72 + r;
      const hy = Math.abs(y) - 0.80 + r;
      const mx = Math.max(rr, 0);
      const my = Math.max(hy, 0);
      return Math.min(Math.max(rr, hy), 0) + Math.sqrt(mx * mx + my * my) - r;
    }
    case 'capsule': {
      const t = Math.min(0.58, Math.max(-0.58, y));
      const dy = y - t;
      return Math.sqrt(x * x + dy * dy + z * z) - 0.56;
    }
    case 'torus': {
      const q = Math.sqrt(x * x + z * z) - 0.86;
      return Math.sqrt(q * q + y * y) - 0.315;
    }
    default:
      return Math.sqrt(x * x + y * y + z * z) - 1.0;
  }
}

/** 拉伸普拉斯用的 6 个轴向邻域 */
const AXIS_SAMPLES: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function compileField(base: BaseShapeId, strokes: Stroke[]): CompiledField {
  // --- 展平: 每一笔 → 若干段 (profile 胶囊) + 若开启镜像再来一份 ---
  const segs: number[] = [];
  const progs: number[] = [];
  let segCount = 0;

  const pushSegment = (
    a: Vec3,
    b: Vec3,
    n: Vec3,
    radius: number,
    ns: number,
    ts: number,
  ) => {
    segs.push(
      a[0], a[1], a[2],
      b[0], b[1], b[2],
      n[0], n[1], n[2],
      ns, ts, radius, 0,
    );
    segCount++;
  };

  const emitOp = (stroke: Stroke, axis: SymAxis | null) => {
    const hl = Math.round(stroke.hardness * 2);
    const bl = Math.round(stroke.blend * 2);
    const segoff = segCount;

    if (stroke.kind === 'smooth') {
      // 布局: [2, R, cx, cy, cz, sigma, strength, 0]
      const c = reflect(stroke.points[0] ?? [0, 0, 0], axis);
      const R = smoothReach(stroke.radius, hl);
      // 平滑核尺度: 与笔刷半径成比例, 但不能太大 (否则会把整个造型当成凸起削掉)
      const sigma = Math.min(0.35, stroke.radius * (0.5 + 0.2 * (1 - hl / 2)));
      progs.push(2, R, c[0], c[1], c[2], sigma, stroke.strength, 0);
      return;
    }

    const hard = BRUSH_HARDNESS[hl];
    // 剖面: 单点笔触沿法线略压扁 (像抹上去的粘土); 多段笔触保持各向同性,
    // 否则笔触沿曲面延伸时, 每段的"扁面"会随法线转向而切进宿主表面, 出现斜向棱线。
    const nsRatio = stroke.points.length > 1 ? 1 : 0.9 + 0.1 * hard;
    const tsRatio = 1.0;
    const radius = stroke.radius;
    const k = blendWidth(radius, bl);
    const pts = stroke.points.map((p) => reflect(p, axis));
    const nrm = stroke.normals.map((p) => reflect(p, axis));
    // 把笔刷球心沿法线压入表面: 露出圆润的球冠。
    // 压入量略小于半个半径, 这样球冠与底面的交线 (赤道) 会落在宿主表面之内,
    // 过渡处由融合宽度平滑掉 —— 不会出现"半透镜"那种生硬的环形棱线。
    const sink = radius * (0.18 + 0.08 * (1 - hard));
    const sunk = (p: Vec3, n: Vec3): Vec3 => [p[0] - n[0] * sink, p[1] - n[1] * sink, p[2] - n[2] * sink];

    if (stroke.shape === 'capsule' && pts.length > 1) {
      for (let i = 0; i < pts.length - 1; i++) {
        const na = nrm[i] ?? [0, 1, 0];
        const nb = nrm[i + 1] ?? na;
        const n: Vec3 = [na[0] + nb[0], na[1] + nb[1], na[2] + nb[2]];
        const L = Math.hypot(n[0], n[1], n[2]) || 1;
        n[0] /= L;
        n[1] /= L;
        n[2] /= L;
        pushSegment(sunk(pts[i], na), sunk(pts[i + 1], nb), n, radius, nsRatio, tsRatio);
      }
    } else {
      for (let i = 0; i < pts.length; i++) {
        const n = nrm[i] ?? [0, 1, 0];
        pushSegment(sunk(pts[i], n), sunk(pts[i], n), n, radius, nsRatio, tsRatio);
      }
    }

    const used = segCount - segoff;
    // 同一笔内的多段体积用较小的平滑并集互相融合, 避免拖动时出现"串珠"棱线
    const groupK = pts.length > 1 ? Math.min(radius * 0.55, k + radius * 0.42) : 0;
    progs.push(stroke.kind === 'erase' ? 1 : 0, segoff, used, k, groupK, 0, 0, 0);
  };

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    emitOp(stroke, null);
    if (stroke.mirrorAxis) emitOp(stroke, stroke.mirrorAxis);
  }

  const SEG = new Float64Array(segs);
  const PROG = new Float64Array(progs);
  const nProg = PROG.length / PROG_STRIDE;

  // 段级包围盒 (用于剪枝)
  const segBox = new Float64Array(segCount * 6);
  for (let i = 0; i < segCount; i++) {
    const o = i * SEG_STRIDE;
    const r = SEG[o + 11] * 1.08;
    for (let k = 0; k < 3; k++) {
      segBox[i * 6 + k] = Math.min(SEG[o + k], SEG[o + 3 + k]) - r;
      segBox[i * 6 + 3 + k] = Math.max(SEG[o + k], SEG[o + 3 + k]) + r;
    }
  }

  function evalSegments(from: number, to: number, x: number, y: number, z: number, groupK: number): number {
    let d = 1e30;
    const invGroup = groupK > 0 ? 1 / groupK : 0;
    for (let i = from; i < to; i++) {
      const o = i * SEG_STRIDE;
      const b = i * 6;
      // 剪枝: 到 AABB 的距离是段距离的下界; 与当前 d + 半径 比较 (免开方)
      const qx = x < segBox[b] ? segBox[b] - x : x > segBox[b + 3] ? x - segBox[b + 3] : 0;
      const qy = y < segBox[b + 1] ? segBox[b + 1] - y : y > segBox[b + 4] ? y - segBox[b + 4] : 0;
      const qz = z < segBox[b + 2] ? segBox[b + 2] - z : z > segBox[b + 5] ? z - segBox[b + 5] : 0;
      if (qx !== 0 || qy !== 0 || qz !== 0) {
        const r = SEG[o + 11];
        const lim = (d < 1e29 ? d : 0) + r * 1.35;
        if (qx * qx + qy * qy + qz * qz > lim * lim) continue;
      }
      const ax = SEG[o], ay = SEG[o + 1], az = SEG[o + 2];
      const nx = SEG[o + 6], ny = SEG[o + 7], nz = SEG[o + 8];
      const ns = SEG[o + 9], r = SEG[o + 11];
      const dx0 = x - ax, dy0 = y - ay, dz0 = z - az;
      const bxv = SEG[o + 3] - ax, byv = SEG[o + 4] - ay, bzv = SEG[o + 5] - az;
      const len2 = bxv * bxv + byv * byv + bzv * bzv;
      let dx = dx0, dy = dy0, dz = dz0;
      if (len2 > 1e-12) {
        let t = (dx0 * bxv + dy0 * byv + dz0 * bzv) / len2;
        if (t > 1) t = 1;
        else if (t < 0) t = 0;
        dx = dx0 - bxv * t;
        dy = dy0 - byv * t;
        dz = dz0 - bzv * t;
      }
      const dn = dx * nx + dy * ny + dz * nz;
      const dns = dn / ns;
      let dt2 = dx * dx + dy * dy + dz * dz - dn * dn;
      if (dt2 < 0) dt2 = 0;
      const dist = Math.sqrt(dns * dns + dt2) - r;
      if (invGroup !== 0 && d < 1e29) {
        // 同一笔内的平滑并集 (smin)
        const h = groupK - (d > dist ? d - dist : dist - d);
        if (h <= 0) {
          if (dist < d) d = dist;
        } else {
          const hh = h * invGroup;
          d = (dist < d ? dist : d) - hh * hh * groupK * 0.25;
        }
      } else if (dist < d) {
        d = dist;
      }
    }
    return d;
  }

  function evalRange(upTo: number, x: number, y: number, z: number, allowSmooth: boolean): number {
    let d = baseSdf(base, x, y, z);
    for (let p = 0; p < upTo; p++) {
      const o = p * PROG_STRIDE;
      const kind = PROG[o];
      if (kind === 2) {
        if (!allowSmooth) continue;
        /**
         * 曲率平滑 (平均曲率流): d ← d - w * (σ²/2) * ∇²d 的隐式近似 ——
         * 用邻域均值减去中心值得到拉普拉斯算子, 再乘上"外张"系数。
         *
         * 关键在于对位移 (而非距离) 做低通: 球面上 ∇²d 约等于 2/r, 直接
         * 用它会整体收缩; 因此用 d 的邻域均值减去 d, 只保留二阶变化量。
         */
        const R = PROG[o + 1];
        const cx = PROG[o + 2], cy = PROG[o + 3], cz = PROG[o + 4];
        const sigma = PROG[o + 5];
        const strength = PROG[o + 6];
        const dx = x - cx, dy = y - cy, dz = z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= R * R) continue;
        const t = Math.sqrt(d2) / R;
        const fall = 1 - t * t;
        const w = strength * fall * fall;
        if (w < 1e-4) continue;

        // 平均曲率流的一步 (显式):
        //   d ← d - w·κ·(每个邻域 d 与球面基准 d̂ 的偏差之和)
        // 球面基准 d̂(p) = d(c) - |p-c| 是"若无凹凸则应有的距离";
        // 邻域偏差为正 = 邻域更向外 (凸起), 为负 = 凹陷。
        // 把偏差的平均值叠加回中心, 凸起被压低、凹陷被填平, 而光滑球面偏差恒为 0。
        const dc = evalRange(p, cx, cy, cz, false);
        const radius = Math.sqrt(d2);
        const baseDist = dc - radius;
        let devSum = 0;
        for (let s = 0; s < AXIS_SAMPLES.length; s++) {
          const off = AXIS_SAMPLES[s];
          const nx = x + off[0] * sigma;
          const ny = y + off[1] * sigma;
          const nz = z + off[2] * sigma;
          const en = evalRange(p, nx, ny, nz, false);
          const rn = Math.sqrt(
            (nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) + (nz - cz) * (nz - cz),
          );
          devSum += en - (dc - rn);
        }
        d = d + w * 0.5 * (devSum / AXIS_SAMPLES.length) * (1 + radius);
        continue;
      }
      const segStart = PROG[o + 1];
      const segUsed = PROG[o + 2];
      const k = PROG[o + 3];
      const groupK = PROG[o + 4];
      const brush = evalSegments(segStart, segStart + segUsed, x, y, z, groupK);
      if (kind === 0) {
        const h = k - Math.abs(d - brush);
        if (h <= 0) {
          if (brush < d) d = brush;
        } else {
          const hh = h / k;
          d = (brush < d ? brush : d) - hh * hh * k * 0.25;
        }
      } else {
        // 平滑差集: d ← smax(d, -brush, k)，即从实体里挖去笔刷体积
        const e = -brush;
        const h = k - Math.abs(d - e);
        if (h <= 0) {
          d = d > e ? d : e;
        } else {
          const hh = h / k;
          d = (d > e ? d : e) + hh * hh * k * 0.25;
        }
      }
    }
    return d;
  }

  return {
    eval: (x, y, z) => evalRange(nProg, x, y, z, true),
    segmentCount: segCount,
    opCount: nProg,
  };
}

