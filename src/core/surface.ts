/**
 * 增量等值面提取 (marching tetrahedra, 6 四面体分解)。
 *
 * 笔刷栈被采样到固定栅格上 (节点值带缓存), 再逐单元提炼三角网格。
 * 每个表面顶点由一条栅格边唯一确定: 位置只取决于该边两端节点的值,
 * 因此局部重算出来的三角形和未改动区域在边界上逐顶点重合 —— 没有裂缝。
 *
 * 增量策略:
 *   · 每个单元保存自己的三角形 (顶点池 id)
 *   · 只失效脏区节点, 只重建「角点受影响」的单元
 *   · 旧三角形释放引用; 引用归零的顶点回到空闲表
 *   · 存活的边界顶点用新节点值重算 (保证局部重建 == 全量重建)
 */

import { DOMAIN_HALF, type CompiledField, type Bounds } from './field';

const TETS = [
  [0, 1, 3, 7],
  [0, 3, 2, 7],
  [0, 2, 6, 7],
  [0, 6, 4, 7],
  [0, 4, 5, 7],
  [0, 5, 1, 7],
];

/** 16 种符号组合对应的三角形表 (以顶点对表示, 绕序朝外) */
const TET_TABLE: number[][][] = buildTetTable();

/** 每个四面体相对单位立方体的手性; 镜像四面体需要翻转绕序 */
const TET_FLIP: number[] = TETS.map((tet) => {
  const p = tet.map((code) => [code & 1, (code >> 1) & 1, (code >> 2) & 1] as [number, number, number]);
  const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const w = [p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]];
  const det =
    u[0] * (v[1] * w[2] - v[2] * w[1]) -
    u[1] * (v[0] * w[2] - v[2] * w[0]) +
    u[2] * (v[0] * w[1] - v[1] * w[0]);
  return det > 0 ? 1 : -1;
});

function buildTetTable(): number[][][] {
  // 单位四面体 (右手系), 顶点编号 0..3; 内部为正
  const P: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  type Pair = [number, number];
  const table: number[][][] = [];

  for (let mask = 0; mask < 16; mask++) {
    const ins: number[] = [];
    const outs: number[] = [];
    for (let v = 0; v < 4; v++) (mask & (1 << v) ? ins : outs).push(v);
    if (ins.length === 0 || ins.length === 4) {
      table.push([]);
      continue;
    }

    // 内部参考点: 内部顶点质心
    const ref: [number, number, number] = [0, 0, 0];
    for (const v of ins) {
      ref[0] += P[v][0] / ins.length;
      ref[1] += P[v][1] / ins.length;
      ref[2] += P[v][2] / ins.length;
    }

    const pointOf = (pair: Pair): [number, number, number] => {
      const [a, b] = pair;
      // 取内部 +1 / 外部 -1: 交点落在中点, 非退化且绕序稳定
      const va = mask & (1 << a) ? 1 : -1;
      const vb = mask & (1 << b) ? 1 : -1;
      const t = (va + vb) === 0 ? 0.5 : va / (va - vb);
      return [
        P[a][0] + (P[b][0] - P[a][0]) * t,
        P[a][1] + (P[b][1] - P[a][1]) * t,
        P[a][2] + (P[b][2] - P[a][2]) * t,
      ];
    };

    // 候选三角形 (以顶点对表示)
    const tris: Pair[][] = [];
    if (ins.length === 1) {
      const l = ins[0];
      tris.push([
        [l, outs[0]],
        [l, outs[1]],
        [l, outs[2]],
      ]);
    } else if (ins.length === 3) {
      const l = outs[0];
      tris.push([
        [ins[0], l],
        [ins[1], l],
        [ins[2], l],
      ]);
    } else {
      const [a, b] = ins;
      const [c, d] = outs;
      tris.push([
        [a, c],
        [a, d],
        [b, d],
      ]);
      tris.push([
        [a, c],
        [b, d],
        [b, c],
      ]);
    }

    const cases: number[][] = [];
    for (const tri of tris) {
      let [p0, p1, p2] = tri.map(pointOf);
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const mx = (p0[0] + p1[0] + p2[0]) / 3 - ref[0];
      const my = (p0[1] + p1[1] + p2[1]) / 3 - ref[1];
      const mz = (p0[2] + p1[2] + p2[2]) / 3 - ref[2];
      let pairs: Pair[] = tri;
      if (nx * mx + ny * my + nz * mz < 0) pairs = [tri[0], tri[2], tri[1]];
      cases.push([pairs[0][0], pairs[0][1], pairs[1][0], pairs[1][1], pairs[2][0], pairs[2][1]]);
    }
    table.push(cases);
  }
  return table;
}


export interface SurfaceMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface SurfaceStats {
  dirtyCells: number;
  rebuiltTriangles: number;
  totalTriangles: number;
  vertices: number;
  ms: number;
}

export class SurfaceBuilder {
  readonly half: number;
  readonly step: number;
  readonly cells: number;
  readonly dim: number;

  private field: CompiledField;
  /** 节点值 (正值 = 实体内部)。NaN = 尚未求值 */
  private values: Float32Array;
  /** 单元 -> 三角形 (顶点池 id, 每 3 个一组) */
  private cellTris = new Map<number, Int32Array>();
  private computed: Uint8Array;
  private triTotal = 0;

  /** 边 key -> 顶点 的开放寻址哈希 */
  private hashKeys: Float64Array;
  private hashVals: Int32Array;
  private hashStamp: Uint8Array;
  private hashMask: number;

  /** 顶点池 */
  private poolPos: Float32Array;
  private poolNrm: Float32Array;
  private vertRef: Int32Array;
  private poolCount = 0;
  private poolCap: number;
  private freeVerts: number[] = [];

  constructor(field: CompiledField, cell: number, half = DOMAIN_HALF) {
    this.field = field;
    this.half = half;
    this.cells = Math.max(8, Math.round((2 * half) / cell));
    this.step = (2 * half) / this.cells;
    this.dim = this.cells + 1;
    this.values = new Float32Array(this.dim ** 3).fill(NaN);
    this.computed = new Uint8Array(this.cells ** 3);
    const approxTris = this.cells * this.cells * 3.6 * 7;
    let cap = 2048;
    while (cap < approxTris * 2) cap <<= 1;
    this.hashKeys = new Float64Array(cap);
    this.hashVals = new Int32Array(cap);
    this.hashStamp = new Uint8Array(cap);
    this.hashMask = cap - 1;
    this.poolCap = 8192;
    this.poolPos = new Float32Array(this.poolCap * 3);
    this.poolNrm = new Float32Array(this.poolCap * 3);
    this.vertRef = new Int32Array(this.poolCap);
  }

  /** 换场但保留节点缓存 (调用方保证只有脏区变化; 全量重建走 rebuildAll) */
  setField(field: CompiledField) {
    this.field = field;
  }

  /* ---------------- 节点采样 ---------------- */

  private domainClamp(x: number, y: number, z: number) {
    const inner = this.half - this.step * 2.2;
    const qx = Math.abs(x) - inner;
    const qy = Math.abs(y) - inner;
    const qz = Math.abs(z) - inner;
    const mx = Math.max(qx, 0);
    const my = Math.max(qy, 0);
    const mz = Math.max(qz, 0);
    return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0);
  }

  private value(i: number, j: number, k: number): number {
    const idx = (i * this.dim + j) * this.dim + k;
    let v = this.values[idx];
    if (v === v) return v;
    const x = -this.half + i * this.step;
    const y = -this.half + j * this.step;
    const z = -this.half + k * this.step;
    const d = this.field.eval(x, y, z);
    v = -Math.max(d, this.domainClamp(x, y, z)); // 内部为正
    // 等值面正好穿过栅格节点时, 节点值可能恰好是 0; 这会同时污染
    // 多个相邻四面体的角点符号, 产生退化三角形。这里把 0 归入"外部"一侧,
    // 让每个节点都有确定的符号 (内部 = 严格正)。
    if (v <= 0 && v > -1e-12) v = -1e-12;
    this.values[idx] = v;
    return v;
  }

  private invalidateNodes(lo: number[], hi: number[]) {
    const D = this.dim;
    const v = this.values;
    for (let i = lo[0]; i <= hi[0]; i++) {
      const baseI = i * D * D;
      for (let j = lo[1]; j <= hi[1]; j++) {
        const baseJ = baseI + j * D;
        for (let k = lo[2]; k <= hi[2]; k++) v[baseJ + k] = NaN;
      }
    }
  }

  /* ---------------- 顶点池 ---------------- */

  private growPool() {
    const cap = this.poolCap * 2;
    const pos = new Float32Array(cap * 3);
    pos.set(this.poolPos);
    const nrm = new Float32Array(cap * 3);
    nrm.set(this.poolNrm);
    const ref = new Int32Array(cap);
    ref.set(this.vertRef);
    this.poolPos = pos;
    this.poolNrm = nrm;
    this.vertRef = ref;
    this.poolCap = cap;
  }

  private acquireVertex(): number {
    if (this.freeVerts.length) return this.freeVerts.pop()!;
    if (this.poolCount >= this.poolCap) this.growPool();
    return this.poolCount++;
  }

  private releaseVertex(v: number) {
    if (v >= 0 && this.vertRef[v] > 0) this.vertRef[v]--;
  }

  /* ---------------- 边 -> 顶点哈希 ---------------- */

  private pairKey(na: number, nb: number) {
    return na < nb ? na * 8388608 + nb : nb * 8388608 + na;
  }

  private hashOf(key: number) {
    const kLo = key % 4294967296;
    const kHi = Math.floor(key / 4294967296);
    return ((Math.imul(kLo | 0, 2654435761) ^ Math.imul(kHi | 0, 40503)) >>> 0) & this.hashMask;
  }

  private slotFor(key: number): number {
    const mask = this.hashMask;
    let h = this.hashOf(key);
    while (this.hashStamp[h] !== 0) {
      if (this.hashKeys[h] === key) return this.hashVals[h];
      h = (h + 1) & mask;
    }
    return -1;
  }

  private insertSlot(key: number, slot: number) {
    const mask = this.hashMask;
    let h = this.hashOf(key);
    while (this.hashStamp[h] !== 0) h = (h + 1) & mask;
    this.hashStamp[h] = 1;
    this.hashKeys[h] = key;
    this.hashVals[h] = slot;
  }

  /** 取得一条边对应的顶点 (必要时新建并求值) */
  private vertexForEdge(key: number): number {
    let slot = this.slotFor(key);
    if (slot >= 0) {
      this.vertRef[slot]++;
      return slot;
    }
    slot = this.acquireVertex();
    this.insertSlot(key, slot);
    this.computeEdgePoint(key, slot);
    this.vertRef[slot] = 1;
    return slot;
  }

  private computeEdgePoint(key: number, slot: number) {
    const D = this.dim;
    const S2 = D * D;
    const lo = Math.floor(key / 8388608);
    const hi = key - lo * 8388608;
    const li = Math.floor(lo / S2);
    const lj = Math.floor(lo / D) % D;
    const lk = lo % D;
    const hii = Math.floor(hi / S2);
    const hij = Math.floor(hi / D) % D;
    const hik = hi % D;
    const ca = this.value(li, lj, lk);
    const cb = this.value(hii, hij, hik);
    let t = ca / (ca - cb);
    if (!Number.isFinite(t)) t = 0.5;
    else if (t < 1e-4) t = 1e-4;
    else if (t > 1 - 1e-4) t = 1 - 1e-4;
    this.poolPos[slot * 3] = -this.half + (li + (hii - li) * t) * this.step;
    this.poolPos[slot * 3 + 1] = -this.half + (lj + (hij - lj) * t) * this.step;
    this.poolPos[slot * 3 + 2] = -this.half + (lk + (hik - lk) * t) * this.step;

    const gA = NORMAL_SCRATCH_A;
    const gB = NORMAL_SCRATCH_B;
    this.nodeNormal(li, lj, lk, gA);
    this.nodeNormal(hii, hij, hik, gB);
    let nx = gA[0] + (gB[0] - gA[0]) * t;
    let ny = gA[1] + (gB[1] - gA[1]) * t;
    let nz = gA[2] + (gB[2] - gA[2]) * t;
    const L = Math.hypot(nx, ny, nz) || 1;
    this.poolNrm[slot * 3] = nx / L;
    this.poolNrm[slot * 3 + 1] = ny / L;
    this.poolNrm[slot * 3 + 2] = nz / L;
  }

  private nodeNormal(i: number, j: number, k: number, out: Float32Array) {
    const D = this.dim;
    const xp = this.value(Math.min(D - 1, i + 1), j, k);
    const xm = this.value(Math.max(0, i - 1), j, k);
    const yp = this.value(i, Math.min(D - 1, j + 1), k);
    const ym = this.value(i, Math.max(0, j - 1), k);
    const zp = this.value(i, j, Math.min(D - 1, k + 1));
    const zm = this.value(i, j, Math.max(0, k - 1));
    let nx = xm - xp;
    let ny = ym - yp;
    let nz = zm - zp;
    const L = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / L;
    out[1] = ny / L;
    out[2] = nz / L;
  }

  /* ---------------- 单元三角化 ---------------- */

  private buildCell(i: number, j: number, k: number): Int32Array {
    const D = this.dim;
    const S2 = D * D;
    const base = (i * D + j) * D + k;
    // 角点编号与 DI/DJ/DK 一致: bit0=+i, bit1=+j, bit2=+k
    const nodes = [
      base,
      base + S2,
      base + D,
      base + S2 + D,
      base + 1,
      base + S2 + 1,
      base + D + 1,
      base + S2 + D + 1,
    ];
    const vals = [
      this.value(i, j, k),
      this.value(i + 1, j, k),
      this.value(i, j + 1, k),
      this.value(i + 1, j + 1, k),
      this.value(i, j, k + 1),
      this.value(i + 1, j, k + 1),
      this.value(i, j + 1, k + 1),
      this.value(i + 1, j + 1, k + 1),
    ];
    let allIn = true;
    let allOut = true;
    for (let c = 0; c < 8; c++) {
      if (vals[c] <= 0) allIn = false;
      else allOut = false;
    }
    if (allIn || allOut) return EMPTY;

    const out: number[] = [];
    const local = [0, 0, 0, 0];
    for (let t = 0; t < 6; t++) {
      const tet = TETS[t];
      local[0] = tet[0];
      local[1] = tet[1];
      local[2] = tet[2];
      local[3] = tet[3];
      let mask = 0;
      for (let q = 0; q < 4; q++) if (vals[local[q]] > 0) mask |= 1 << q;
      if (mask === 0 || mask === 15) continue;
      const cases = TET_TABLE[mask];
      const flip = TET_FLIP[t] < 0;
      for (const tri of cases) {
        const k0 = this.pairKey(nodes[local[tri[0]]], nodes[local[tri[1]]]);
        const k1 = this.pairKey(nodes[local[tri[2]]], nodes[local[tri[3]]]);
        const k2 = this.pairKey(nodes[local[tri[4]]], nodes[local[tri[5]]]);
        // 三条边都收敛到同一节点时是退化情形 (等值面恰好穿过栅格节点), 直接跳过;
        // 这种三角形面积为 0, 对表面没有贡献, 保留反而会让网格不合法。
        const n0 = nodes[local[tri[0]]];
        const n1 = nodes[local[tri[2]]];
        const n2 = nodes[local[tri[4]]];
        const b0 = nodes[local[tri[1]]];
        const b1 = nodes[local[tri[3]]];
        const b2 = nodes[local[tri[5]]];
        if (n0 === n1 && n1 === n2 && b0 === b1 && b1 === b2) continue;
        if (!flip) out.push(this.vertexForEdge(k0), this.vertexForEdge(k1), this.vertexForEdge(k2));
        else out.push(this.vertexForEdge(k0), this.vertexForEdge(k2), this.vertexForEdge(k1));
      }
    }
    return out.length ? new Int32Array(out) : EMPTY;
  }

  /* ---------------- 重建 ---------------- */

  /**
   * 全量重建 (粗到细):
   * 先用隔格采样的粗网格 + Lipschitz 判据剔除「整块无表面」的 2×2×2 单元,
   * 再对剩下的区域精确求值。表面是二维的, 因此求值次数从 O(N³) 降到约 O(N²)。
   */
  rebuildAll(): SurfaceStats {
    const t0 = performance.now();
    this.cellTris.clear();
    this.computed.fill(0);
    this.values.fill(NaN);
    this.hashStamp.fill(0);
    this.poolCount = 0;
    this.freeVerts.length = 0;
    this.triTotal = 0;
    const C = this.cells;

    const coarseN = Math.floor(C / 2) + 1;
    const coarse = new Float32Array(coarseN * coarseN * coarseN);
    for (let ci = 0; ci < coarseN; ci++)
      for (let cj = 0; cj < coarseN; cj++)
        for (let ck = 0; ck < coarseN; ck++)
          coarse[(ci * coarseN + cj) * coarseN + ck] = this.value(ci * 2, cj * 2, ck * 2);

    const diag = this.step * 2 * Math.sqrt(3);
    const coarseCells = Math.floor(C / 2);
    const uniform = new Uint8Array(coarseCells * coarseCells * coarseCells);
    for (let ci = 0; ci < coarseCells; ci++)
      for (let cj = 0; cj < coarseCells; cj++)
        for (let ck = 0; ck < coarseCells; ck++) {
          let allPos = true;
          let allNeg = true;
          let minAbs = Infinity;
          for (let d = 0; d < 8; d++) {
            const v =
              coarse[
                ((ci + (d & 1)) * coarseN + (cj + ((d >> 1) & 1))) * coarseN + (ck + ((d >> 2) & 1))
              ];
            if (v > 0) allNeg = false;
            else allPos = false;
            const a = Math.abs(v);
            if (a < minAbs) minAbs = a;
          }
          uniform[(ci * coarseCells + cj) * coarseCells + ck] =
            (allPos || allNeg) && minAbs > diag ? 1 : 0;
        }

    let rebuilt = 0;
    for (let i = 0; i < C; i++)
      for (let j = 0; j < C; j++)
        for (let k = 0; k < C; k++) {
          const cell = (i * C + j) * C + k;
          if (uniform[(((i / 2) | 0) * coarseCells + ((j / 2) | 0)) * coarseCells + ((k / 2) | 0)]) {
            this.computed[cell] = 1;
            continue;
          }
          const tris = this.buildCell(i, j, k);
          this.computed[cell] = 1;
          if (tris.length) {
            this.cellTris.set(cell, tris);
            rebuilt += tris.length / 3;
          }
        }
    this.triTotal = rebuilt;
    return {
      dirtyCells: C * C * C,
      rebuiltTriangles: rebuilt,
      totalTriangles: rebuilt,
      vertices: this.poolCount - this.freeVerts.length,
      ms: performance.now() - t0,
    };
  }

  /**
   * 局部重建:
   *   1. 只失效脏区覆盖的节点 (外扩 2 格以覆盖法线取样)
   *   2. 重建所有「角点落在受影响节点内」的单元
   *   3. 回收旧三角形引用归零的顶点
   *   4. 用新节点值重算仍然存活的边界顶点
   * 因为顶点位置只取决于边两端节点的值, 第 4 步保证局部结果与全量重建一致。
   */
  rebuildRegion(bounds: Bounds): SurfaceStats {
    const t0 = performance.now();
    const C = this.cells;
    const D = this.dim;

    const lo = [0, 0, 0];
    const hi = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.max(0, Math.floor((this.half + bounds.min[a]) / this.step) - 1);
      hi[a] = Math.min(C - 1, Math.ceil((this.half + bounds.max[a]) / this.step));
    }
    if (hi[0] < lo[0] || hi[1] < lo[1] || hi[2] < lo[2]) {
      return { dirtyCells: 0, rebuiltTriangles: 0, totalTriangles: this.triTotal, vertices: 0, ms: 0 };
    }

    // 节点失效范围 (比脏单元各外扩 2 格)
    const nlo = [0, 1, 2].map((a) => Math.max(0, lo[a] - 2));
    const nhi = [0, 1, 2].map((a) => Math.min(D - 1, hi[a] + 3));
    this.invalidateNodes(nlo, nhi);

    // 重建范围: 任何角点落在失效节点内的单元
    const elo = [0, 1, 2].map((a) => Math.max(0, nlo[a] - 1));
    const ehi = [0, 1, 2].map((a) => Math.min(C - 1, nhi[a] + 1));

    let dirty = 0;
    let rebuilt = 0;
    const released: number[] = [];
    for (let i = elo[0]; i <= ehi[0]; i++)
      for (let j = elo[1]; j <= ehi[1]; j++)
        for (let k = elo[2]; k <= ehi[2]; k++) {
          const cell = (i * C + j) * C + k;
          if (this.computed[cell]) dirty++;
          const prev = this.cellTris.get(cell);
          const prevCount = prev ? prev.length / 3 : 0;
          const tris = this.buildCell(i, j, k);
          const nextCount = tris.length / 3;
          rebuilt += nextCount;
          this.triTotal += nextCount - prevCount;
          if (tris.length) this.cellTris.set(cell, tris);
          else this.cellTris.delete(cell);
          if (prev) for (let q = 0; q < prev.length; q++) released.push(prev[q]);
          this.computed[cell] = 1;
        }

    for (const v of released) this.releaseVertex(v);
    this.reclaim(released);
    this.refreshLiveVertices(elo, ehi);
    return {
      dirtyCells: dirty,
      rebuiltTriangles: rebuilt,
      totalTriangles: this.triTotal,
      vertices: this.poolCount - this.freeVerts.length,
      ms: performance.now() - t0,
    };
  }

  /** 回收引用归零的顶点 (只为被释放的顶点做反查, 成本与脏区成正比) */
  private reclaim(released: number[]) {
    if (!released.length) return;
    const need = new Set<number>();
    for (const v of released) if (this.vertRef[v] <= 0) need.add(v);
    if (!need.size) return;
    for (let h = 0; h <= this.hashMask && need.size; h++) {
      if (this.hashStamp[h] === 0) continue;
      const v = this.hashVals[h];
      if (need.has(v)) {
        this.hashStamp[h] = 0;
        this.freeVerts.push(v);
        need.delete(v);
      }
    }
    for (const v of need) this.freeVerts.push(v);
  }

  /** 用当前节点值重算仍然存活的顶点 (只触碰重建范围附近的) */
  private refreshLiveVertices(elo: number[], ehi: number[]) {
    const D = this.dim;
    const S2 = D * D;
    const inRange = (i: number, j: number, k: number) =>
      i >= elo[0] - 1 &&
      i <= ehi[0] + 2 &&
      j >= elo[1] - 1 &&
      j <= ehi[1] + 2 &&
      k >= elo[2] - 1 &&
      k <= ehi[2] + 2;
    for (let h = 0; h <= this.hashMask; h++) {
      if (this.hashStamp[h] === 0) continue;
      const slot = this.hashVals[h];
      if (this.vertRef[slot] <= 0) continue;
      const key = this.hashKeys[h];
      const lo = Math.floor(key / 8388608);
      const hi = key - lo * 8388608;
      if (
        inRange(Math.floor(lo / S2), Math.floor(lo / D) % D, lo % D) ||
        inRange(Math.floor(hi / S2), Math.floor(hi / D) % D, hi % D)
      ) {
        this.computeEdgePoint(key, slot);
      }
    }
  }

  /* ---------------- 导出 ---------------- */

  /** 把三角剖分导出成紧凑网格 (只读: 不改动顶点池) */
  compile(): SurfaceMesh {
    const keys = Array.from(this.cellTris.keys()).sort((a, b) => a - b);
    let totalTris = 0;
    for (const c of keys) totalTris += this.cellTris.get(c)!.length / 3;

    const indices = new Uint32Array(totalTris * 3);
    const remap = new Int32Array(this.poolCount).fill(-1);
    const pos: number[] = [];
    const nrm: number[] = [];
    let ii = 0;
    for (const c of keys) {
      const tris = this.cellTris.get(c)!;
      for (let t = 0; t < tris.length; t++) {
        const slot = tris[t];
        let out = remap[slot];
        if (out < 0) {
          out = pos.length / 3;
          remap[slot] = out;
          pos.push(this.poolPos[slot * 3], this.poolPos[slot * 3 + 1], this.poolPos[slot * 3 + 2]);
          nrm.push(this.poolNrm[slot * 3], this.poolNrm[slot * 3 + 1], this.poolNrm[slot * 3 + 2]);
        }
        indices[ii++] = out;
      }
    }
    return {
      positions: new Float32Array(pos),
      normals: new Float32Array(nrm),
      indices,
      vertexCount: pos.length / 3,
      triangleCount: totalTris,
    };
  }

  get triangleCount() {
    return this.triTotal;
  }
}

const EMPTY = new Int32Array(0);
const NORMAL_SCRATCH_A = new Float32Array(3);
const NORMAL_SCRATCH_B = new Float32Array(3);
