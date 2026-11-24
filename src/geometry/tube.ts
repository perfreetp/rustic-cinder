// 轻量管状体生成器：沿三维折线扫掠圆环，用于前缘管与翼尖管骨架
// 索引只生成一次，位置每帧更新，法线复用通用累积算法

export interface TubeLayout {
  pathPoints: number;
  radialSegments: number;
  closed: boolean;
  vertexOffset: number;
  indexOffset: number;
}

export function tubeVertexCount(pathPoints: number, radialSegments: number): number {
  return pathPoints * radialSegments;
}

export function tubeIndexCount(pathPoints: number, radialSegments: number, closed: boolean): number {
  const rings = closed ? pathPoints : pathPoints - 1;
  return rings * radialSegments * 2 * 3;
}

/** 生成管状体索引（四边形环 → 两个三角形） */
export function writeTubeIndices(
  index: Uint32Array,
  layout: TubeLayout,
): void {
  const { pathPoints: pp, radialSegments: rs, closed, vertexOffset: vo, indexOffset: io } = layout;
  const rings = closed ? pp : pp - 1;
  let w = io;
  for (let i = 0; i < rings; i++) {
    const i0 = i;
    const i1 = (i + 1) % pp;
    for (let j = 0; j < rs; j++) {
      const j1 = (j + 1) % rs;
      const a = vo + i0 * rs + j;
      const b = vo + i1 * rs + j;
      const c = vo + i1 * rs + j1;
      const d = vo + i0 * rs + j1;
      index[w++] = a;
      index[w++] = b;
      index[w++] = d;
      index[w++] = b;
      index[w++] = c;
      index[w++] = d;
    }
  }
}

export interface RingFrame {
  /** 路径切线上的环面基向量 */
  n1x: Float32Array;
  n1y: Float32Array;
  n1z: Float32Array;
  n2x: Float32Array;
  n2y: Float32Array;
  n2z: Float32Array;
}

/**
 * 根据路径中心线计算每一点的环面坐标系
 * @param refX/refY/refZ 参考向量（不能与切线平行）
 */
export function writeTubePositions(
  positions: Float32Array,
  layout: TubeLayout,
  path: Float32Array, // pp*3 紧凑数组
  radius: number,
  refX: number,
  refY: number,
  refZ: number,
): void {
  const { pathPoints: pp, radialSegments: rs, closed, vertexOffset: vo } = layout;
  for (let i = 0; i < pp; i++) {
    const iPrev = closed ? (i - 1 + pp) % pp : Math.max(i - 1, 0);
    const iNext = closed ? (i + 1) % pp : Math.min(i + 1, pp - 1);
    // 切线
    let tx = path[iNext * 3] - path[iPrev * 3];
    let ty = path[iNext * 3 + 1] - path[iPrev * 3 + 1];
    let tz = path[iNext * 3 + 2] - path[iPrev * 3 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // n1 = normalize(ref × T)
    let n1x = refY * tz - refZ * ty;
    let n1y = refZ * tx - refX * tz;
    let n1z = refX * ty - refY * tx;
    const n1l = Math.hypot(n1x, n1y, n1z) || 1;
    n1x /= n1l;
    n1y /= n1l;
    n1z /= n1l;
    // n2 = T × n1
    const n2x = ty * n1z - tz * n1y;
    const n2y = tz * n1x - tx * n1z;
    const n2z = tx * n1y - ty * n1x;

    const cx = path[i * 3];
    const cy = path[i * 3 + 1];
    const cz = path[i * 3 + 2];
    for (let j = 0; j < rs; j++) {
      const theta = (j / rs) * Math.PI * 2;
      const co = Math.cos(theta) * radius;
      const si = Math.sin(theta) * radius;
      const vi = vo + i * rs + j;
      positions[vi * 3] = cx + n1x * co + n2x * si;
      positions[vi * 3 + 1] = cy + n1y * co + n2y * si;
      positions[vi * 3 + 2] = cz + n1z * co + n2z * si;
    }
  }
}
