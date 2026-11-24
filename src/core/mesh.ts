/**
 * Mesh post-processing.
 *
 * - `weldAndNormals`: 合并重合顶点, 剔除退化 / 重复面, 生成折痕感知的光滑法线
 * - `cleanMesh`:      导出前的网格清理 (同一套流程, 更宽的焊接容差)
 */

export interface RawMesh {
  /** flat xyz */
  positions: Float32Array;
  /** triangle indices into positions (3 per tri) */
  indices: Uint32Array;
}

export interface RenderMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  weldedVertices: number;
  droppedTriangles: number;
}

function quantKey(x: number, y: number, z: number, inv: number) {
  const qx = Math.round(x * inv);
  const qy = Math.round(y * inv);
  const qz = Math.round(z * inv);
  return (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) | 0;
}

/** 按位置焊接顶点, 返回旧顶点 -> 焊接后顶点 */
function weldVertices(P: Float32Array, inv: number) {
  const n = P.length / 3;
  const remap = new Uint32Array(n);
  const buckets = new Map<number, number[]>();
  const weldPos: number[] = [];
  for (let v = 0; v < n; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const key = quantKey(x, y, z, inv);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    let found = -1;
    for (const cand of bucket) {
      if (
        Math.abs(weldPos[cand * 3] - x) * inv < 0.5 &&
        Math.abs(weldPos[cand * 3 + 1] - y) * inv < 0.5 &&
        Math.abs(weldPos[cand * 3 + 2] - z) * inv < 0.5
      ) {
        found = cand;
        break;
      }
    }
    if (found < 0) {
      found = weldPos.length / 3;
      weldPos.push(x, y, z);
      bucket.push(found);
    }
    remap[v] = found;
  }
  return { remap, weldPos: new Float32Array(weldPos), count: weldPos.length / 3 };
}

export function weldAndNormals(raw: RawMesh, creaseDeg = 38, inv = 1e5): RenderMesh {
  const P = raw.positions;
  const I = raw.indices;
  const rawTri = I.length / 3;

  // ---- 1. 焊接 ----------------------------------------------------------
  const { remap, weldPos, count: weldCount } = weldVertices(P, inv);

  // ---- 2. 剔除退化面与重复面 -------------------------------------------
  const tris = new Uint32Array(I.length);
  let faceCount = 0;
  let dropped = 0;
  const seen = new Set<string>();
  for (let t = 0; t < rawTri; t++) {
    const a = remap[I[t * 3]];
    const b = remap[I[t * 3 + 1]];
    const c = remap[I[t * 3 + 2]];
    if (a === b || b === c || a === c) {
      dropped++;
      continue;
    }
    const ax = weldPos[a * 3], ay = weldPos[a * 3 + 1], az = weldPos[a * 3 + 2];
    const ux = weldPos[b * 3] - ax, uy = weldPos[b * 3 + 1] - ay, uz = weldPos[b * 3 + 2] - az;
    const vx = weldPos[c * 3] - ax, vy = weldPos[c * 3 + 1] - ay, vz = weldPos[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    // 面积为零 (三点共线) 的三角形如果直接删掉会撕开拓扑; 保留它们、只把重复面去掉。
    // 真正的退化 (索引重复) 已被上面的检查剔除。
    void nx;
    void ny;
    void nz;
    // 规范化三角形 key: 同一组三个顶点只保留一个朝向 (无向去重)
    const lo = Math.min(a, b, c);
    const hi = Math.max(a, b, c);
    const mid = a + b + c - lo - hi;
    const key = `${lo},${mid},${hi}`;
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    tris[faceCount * 3] = a;
    tris[faceCount * 3 + 1] = b;
    tris[faceCount * 3 + 2] = c;
    faceCount++;
  }
  const idx = tris.subarray(0, faceCount * 3);

  // ---- 3. 面法线 --------------------------------------------------------
  const fn = new Float32Array(faceCount * 3);
  const fnU = new Float32Array(faceCount * 3);
  for (let t = 0; t < faceCount; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const ax = weldPos[a * 3], ay = weldPos[a * 3 + 1], az = weldPos[a * 3 + 2];
    const ux = weldPos[b * 3] - ax, uy = weldPos[b * 3 + 1] - ay, uz = weldPos[b * 3 + 2] - az;
    const vx = weldPos[c * 3] - ax, vy = weldPos[c * 3 + 1] - ay, vz = weldPos[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    fn[t * 3] = nx;
    fn[t * 3 + 1] = ny;
    fn[t * 3 + 2] = nz;
    const L = Math.hypot(nx, ny, nz) || 1;
    fnU[t * 3] = nx / L;
    fnU[t * 3 + 1] = ny / L;
    fnU[t * 3 + 2] = nz / L;
  }

  // ---- 4. 顶点 -> 相邻面 (CSR) ------------------------------------------
  const vfStart = new Uint32Array(weldCount + 1);
  for (let i = 0; i < faceCount * 3; i++) vfStart[idx[i] + 1]++;
  for (let v = 0; v < weldCount; v++) vfStart[v + 1] += vfStart[v];
  const vfFaces = new Uint32Array(faceCount * 3);
  const cursor = vfStart.slice(0, weldCount);
  for (let t = 0; t < faceCount; t++) {
    vfFaces[cursor[idx[t * 3]]++] = t;
    vfFaces[cursor[idx[t * 3 + 1]]++] = t;
    vfFaces[cursor[idx[t * 3 + 2]]++] = t;
  }

  // ---- 5. 每个焊接顶点按折痕角聚簇, 输出顶点 ----------------------------
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  const outPos: number[] = [];
  const outNrm: number[] = [];
  const outIdx = new Uint32Array(faceCount * 3);
  const cornerCluster = new Int32Array(faceCount * 3).fill(-1);

  const rep: number[] = [];
  const clusterOf: number[] = [];

  for (let v = 0; v < weldCount; v++) {
    const start = vfStart[v];
    const end = vfStart[v + 1];
    if (start === end) continue;
    rep.length = 0;
    clusterOf.length = 0;
    for (let k = start; k < end; k++) {
      const f = vfFaces[k];
      const nx = fnU[f * 3], ny = fnU[f * 3 + 1], nz = fnU[f * 3 + 2];
      let placed = -1;
      for (let c = 0; c < rep.length; c++) {
        const r = rep[c];
        if (nx * fnU[r * 3] + ny * fnU[r * 3 + 1] + nz * fnU[r * 3 + 2] >= cosCrease) {
          placed = c;
          break;
        }
      }
      if (placed < 0) {
        rep.push(f);
        placed = rep.length - 1;
      }
      clusterOf.push(placed);
    }
    const nc = rep.length;
    const sumX = new Float64Array(nc);
    const sumY = new Float64Array(nc);
    const sumZ = new Float64Array(nc);
    for (let k = start; k < end; k++) {
      const f = vfFaces[k];
      const c = clusterOf[k - start];
      sumX[c] += fn[f * 3];
      sumY[c] += fn[f * 3 + 1];
      sumZ[c] += fn[f * 3 + 2];
    }
    const base = outPos.length / 3;
    for (let c = 0; c < nc; c++) {
      const L = Math.hypot(sumX[c], sumY[c], sumZ[c]) || 1;
      outPos.push(weldPos[v * 3], weldPos[v * 3 + 1], weldPos[v * 3 + 2]);
      outNrm.push(sumX[c] / L, sumY[c] / L, sumZ[c] / L);
    }
    for (let k = start; k < end; k++) {
      const f = vfFaces[k];
      const c = clusterOf[k - start];
      // 找到该面中属于 v 的角
      for (let j = 0; j < 3; j++) {
        if (idx[f * 3 + j] === v) {
          outIdx[f * 3 + j] = base + c;
          cornerCluster[f * 3 + j] = c;
          break;
        }
      }
    }
  }

  return {
    positions: new Float32Array(outPos),
    normals: new Float32Array(outNrm),
    indices: outIdx,
    vertexCount: outPos.length / 3,
    triangleCount: faceCount,
    weldedVertices: weldCount,
    droppedTriangles: dropped,
  };
}

export function cleanMesh(raw: RawMesh): RenderMesh {
  return weldAndNormals(raw, 46, 2e5);
}

export function meshBounds(pos: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!Number.isFinite(min[0])) return null;
  return { min: min as [number, number, number], max: max as [number, number, number] };
}
