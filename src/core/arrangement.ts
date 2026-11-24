/**
 * Planar arrangement → fold faces + hinge tree.
 *
 * The resolved creases plus the sheet boundary form a planar straight-line
 * graph. Enumerating its inner faces (via a half-edge walk) gives the rigid
 * panels of the fold. Panels are then connected by a spanning tree over the
 * shared interior edges; each tree edge becomes a hinge. Cycles in the hinge
 * graph (a "cycle fold") are detected and reported, because a rigid tree fold
 * cannot honour them — they are resolved by cutting them out of the tree.
 */

import {
  type Vec2,
  clamp,
  cross2,
  dist2,
  normalize2,
  sub2,
  triArea2,
} from './math';
import {
  clipSegmentToSquare,
  resolveCreases,
  splitAtIntersections,
} from './creases';
import type {
  Diagnostics,
  Face,
  FoldType,
  Hinge,
  HingeEdge,
  ResolvedCrease,
  Topology,
} from './types';

export const BOUNDARY_ID = '__boundary__';

interface Vertex {
  id: number;
  p: Vec2;
}

interface OutEdge {
  /** index into half-edge arrays */
  he: number;
  angle: number;
}

interface HalfEdge {
  from: number;
  to: number;
  creaseId: string;
  twin: number;
  next: number;
  face: number;
}

const WELD = 1e-6;

/** Spatial weld of points into unique vertices. */
class VertexPool {
  readonly verts: Vertex[] = [];
  private readonly grid = new Map<string, number[]>();
  private readonly cell = 0.02;

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)}:${Math.floor(y / this.cell)}`;
  }

  add(p: Vec2): number {
    const gx = Math.floor(p.x / this.cell);
    const gy = Math.floor(p.y / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.grid.get(`${gx + dx}:${gy + dy}`);
        if (!bucket) continue;
        for (const id of bucket) {
          if (dist2(this.verts[id].p, p) <= WELD) return id;
        }
      }
    }
    const id = this.verts.length;
    this.verts.push({ id, p: { ...p } });
    const k = this.key(p.x, p.y);
    const bucket = this.grid.get(k);
    if (bucket) bucket.push(id);
    else this.grid.set(k, [id]);
    return id;
  }
}

/** Signed area of a polygon; positive for CCW. */
export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/** Remove duplicate and collinear points from a CCW polygon. */
function cleanPolygon(poly: Vec2[], eps = 1e-7): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    if (!out.length || dist2(out[out.length - 1], p) > eps) out.push(p);
  }
  while (out.length > 1 && dist2(out[0], out[out.length - 1]) <= eps) out.pop();

  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const ab = sub2(b, a);
      const bc = sub2(c, b);
      const len = Math.hypot(ab.x, ab.y) * Math.hypot(bc.x, bc.y);
      if (len < 1e-12) {
        out.splice(i, 1);
        changed = true;
        break;
      }
      if (Math.abs(cross2(ab, bc)) / len < 1e-6) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

interface Arrangement {
  faces: Vec2[][];
  hingeEdges: HingeEdge[];
  vertices: Vertex[];
}

/** Build the planar arrangement and enumerate its inner faces. */
function buildArrangement(creases: ResolvedCrease[], half: number): Arrangement {
  const pool = new VertexPool();

  // Boundary corners.
  const corners: Vec2[] = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];
  for (const c of corners) pool.add(c);

  // Points on each boundary side get welded in, in perimeter order.
  const sidePoints: Vec2[][] = [[], [], [], []];
  const pushSide = (p: Vec2) => {
    const onX = Math.abs(Math.abs(p.x) - half) <= 1e-6;
    const onY = Math.abs(Math.abs(p.y) - half) <= 1e-6;
    if (onY && Math.abs(p.x) < half - 1e-6) sidePoints[p.y > 0 ? 2 : 0].push(p);
    else if (onX && Math.abs(p.y) < half - 1e-6) sidePoints[p.x > 0 ? 1 : 3].push(p);
    else if (onX && onY) {
      // A corner — already present.
    }
  };

  for (const c of creases) {
    for (const p of c.points) {
      pool.add(p);
      pushSide(p);
    }
  }
  // Also weld crease endpoints exactly onto the square corners.
  for (const c of creases) {
    for (const p of [c.a, c.b]) {
      if (Math.abs(Math.abs(p.x) - half) < 1e-6 && Math.abs(Math.abs(p.y) - half) < 1e-6) {
        pushSide(p);
      }
    }
  }

  interface RawEdge {
    a: number;
    b: number;
    creaseId: string;
  }
  const edges: RawEdge[] = [];
  const edgeKey = (i: number, j: number) => (i < j ? `${i}_${j}` : `${j}_${i}`);
  const seen = new Set<string>();
  const addEdge = (p: Vec2, q: Vec2, creaseId: string) => {
    if (dist2(p, q) < WELD) return;
    const i = pool.add(p);
    const j = pool.add(q);
    if (i === j) return;
    const key = edgeKey(i, j);
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ a: i, b: j, creaseId });
  };

  // Crease edges.
  for (const c of creases) {
    for (let i = 0; i + 1 < c.points.length; i++) {
      addEdge(c.points[i], c.points[i + 1], c.id);
    }
  }

  // Boundary edges, walking each side CCW around the square.
  const sideOrder = [
    { fixed: 'y', v: -half, from: -half, to: half }, // bottom, +X
    { fixed: 'x', v: half, from: -half, to: half }, // right, +Y
    { fixed: 'y', v: half, from: half, to: -half }, // top, -X
    { fixed: 'x', v: -half, from: half, to: -half }, // left, -Y
  ];
  for (let s = 0; s < 4; s++) {
    const spec = sideOrder[s];
    const pts = sidePoints[s]
      .map((p) => (spec.fixed === 'y' ? p.x : p.y))
      .map((v, i) => ({ v, p: sidePoints[s][i] }))
      .sort((m, n) => (spec.to >= spec.from ? m.v - n.v : n.v - m.v))
      .map((e) => e.p);
    const chain: Vec2[] = [{ x: spec.fixed === 'y' ? spec.from : spec.v, y: spec.fixed === 'y' ? spec.v : spec.from }];
    for (const p of pts) {
      const last = chain[chain.length - 1];
      if (dist2(last, p) > WELD) chain.push({ ...p });
    }
    const end = { x: spec.fixed === 'y' ? spec.to : spec.v, y: spec.fixed === 'y' ? spec.v : spec.to };
    if (dist2(chain[chain.length - 1], end) > WELD) chain.push(end);
    for (let i = 0; i + 1 < chain.length; i++) {
      addEdge(chain[i], chain[i + 1], BOUNDARY_ID);
    }
  }

  // Build half-edges.
  const hes: HalfEdge[] = [];
  const out: OutEdge[][] = Array.from({ length: pool.verts.length }, () => []);
  for (const e of edges) {
    const id0 = hes.length;
    const id1 = id0 + 1;
    const pa = pool.verts[e.a].p;
    const pb = pool.verts[e.b].p;
    hes.push({ from: e.a, to: e.b, creaseId: e.creaseId, twin: id1, next: -1, face: -1 });
    hes.push({ from: e.b, to: e.a, creaseId: e.creaseId, twin: id0, next: -1, face: -1 });
    out[e.a].push({ he: id0, angle: Math.atan2(pb.y - pa.y, pb.x - pa.x) });
    out[e.b].push({ he: id1, angle: Math.atan2(pa.y - pb.y, pa.x - pb.x) });
  }
  for (const list of out) list.sort((m, n) => m.angle - n.angle);

  // next(h) = outgoing edge at h.to, immediately before twin(h) in CCW order.
  for (let i = 0; i < hes.length; i++) {
    const h = hes[i];
    const list = out[h.to];
    let idx = 0;
    for (let k = 0; k < list.length; k++) {
      if (list[k].he === h.twin) {
        idx = k;
        break;
      }
    }
    h.next = list[(idx - 1 + list.length) % list.length].he;
  }

  // Trace faces.
  const facePolys: Vec2[][] = [];
  const exterior: boolean[] = [];
  for (let i = 0; i < hes.length; i++) {
    if (hes[i].face !== -1) continue;
    const faceId = facePolys.length;
    const poly: Vec2[] = [];
    let h = i;
    let guard = 0;
    do {
      hes[h].face = faceId;
      poly.push(pool.verts[hes[h].from].p);
      h = hes[h].next;
      if (++guard > hes.length + 4) break;
    } while (h !== i);
    const cleaned = cleanPolygon(poly);
    const area = polygonArea(cleaned);
    facePolys.push(area >= 0 ? cleaned : cleaned.slice().reverse());
    exterior.push(area < 0);
  }

  // Keep only interior faces (positive area, and not the outside).
  const interiorIdx: number[] = [];
  for (let i = 0; i < facePolys.length; i++) {
    const a = polygonArea(facePolys[i]);
    if (a > 1e-10 && !exterior[i]) interiorIdx.push(i);
  }
  const remap = new Map<number, number>();
  interiorIdx.forEach((f, i) => remap.set(f, i));

  const faces = interiorIdx.map((f) => facePolys[f]);

  // Hinge edges: original edges between two interior faces.
  const hingeEdges: HingeEdge[] = [];
  for (const e of edges) {
    const id0 = hes.findIndex((h) => h.from === e.a && h.to === e.b && h.creaseId === e.creaseId);
    if (id0 < 0) continue;
    const f0 = hes[id0].face;
    const f1 = hes[id0 + 1].face;
    if (!remap.has(f0) || !remap.has(f1)) continue;
    const faceL = remap.get(f0)!;
    const faceR = remap.get(f1)!;
    hingeEdges.push({
      creaseId: e.creaseId,
      a: pool.verts[e.a].p,
      b: pool.verts[e.b].p,
      faceL,
      faceR,
      treeChild: -1,
    });
  }

  return { faces, hingeEdges, vertices: pool.verts };
}

/** Adjacency from hinge edges between faces. */
function buildHingeAdjacency(hingeEdges: HingeEdge[], faceCount: number) {
  const adj: { edge: number; other: number }[][] = Array.from({ length: faceCount }, () => []);
  hingeEdges.forEach((e, i) => {
    adj[e.faceL].push({ edge: i, other: e.faceR });
    adj[e.faceR].push({ edge: i, other: e.faceL });
  });
  for (const list of adj) list.sort((a, b) => a.edge - b.edge);
  return adj;
}

export interface BuildOptions {
  /** Anchor point (sheet space) whose containing face becomes the fixed root. */
  anchor?: Vec2;
}

/**
 * Build the full fold topology from raw creases.
 * Pure and deterministic: same creases in ⇒ same faces, hinge tree and rooting.
 */
export function buildTopology(
  rawCreases: { id: string; a: Vec2; b: Vec2; type: FoldType; angle: number; slot: number }[],
  half: number,
  options: BuildOptions = {},
): Topology {
  const resolved = resolveCreases(
    rawCreases.map((c) => ({ ...c })),
    half,
  );
  splitAtIntersections(resolved);
  const arrangement = buildArrangement(resolved, half);
  const faceCount = arrangement.faces.length;

  // Root: the face under the anchor point, else the largest face.
  const anchor = options.anchor ?? { x: 0, y: 0 };
  let rootFace = -1;
  for (let i = 0; i < faceCount; i++) {
    if (pointInPolygon(anchor, arrangement.faces[i])) {
      rootFace = i;
      break;
    }
  }
  if (rootFace < 0 && faceCount > 0) {
    let best = -Infinity;
    for (let i = 0; i < faceCount; i++) {
      const a = Math.abs(polygonArea(arrangement.faces[i]));
      if (a > best) {
        best = a;
        rootFace = i;
      }
    }
  }
  if (rootFace < 0) {
    // Degenerate: no creases at all — one face covering the sheet.
    const sheet: Vec2[] = [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half },
    ];
    return {
      faces: [
        {
          index: 0,
          polygon: sheet,
          area: (2 * half) * (2 * half),
          parent: -1,
          hinge: null,
          depth: 0,
        },
      ],
      creases: resolved,
      hingeEdges: [],
      rootFace: 0,
      half,
      diagnostics: {
        faceCount: 1,
        hingeCount: 0,
        cycleEdges: 0,
        cycleCreases: [],
        maekawaViolations: 0,
        interiorVertices: 0,
        isolatedCreases: resolved.map((c) => c.id),
      },
    };
  }

  const adj = buildHingeAdjacency(arrangement.hingeEdges, faceCount);

  // BFS spanning tree over faces.
  const parent = new Array<number>(faceCount).fill(-2);
  const depth = new Array<number>(faceCount).fill(0);
  const parentHinge: (Hinge | null)[] = new Array(faceCount).fill(null);
  const usedEdges = new Set<number>();
  parent[rootFace] = -1;
  const queue = [rootFace];
  while (queue.length) {
    const f = queue.shift()!;
    for (const link of adj[f]) {
      if (parent[link.other] !== -2) continue;
      const e = arrangement.hingeEdges[link.edge];
      parent[link.other] = f;
      depth[link.other] = depth[f] + 1;
      usedEdges.add(link.edge);
      e.treeChild = link.other;

      // The child's side of the hinge decides the rotation sign.
      // Which side of the hinge the child's centroid sits on decides the
      // rotation sign, so a positive angle always folds with the crease's
      // mountain/valley meaning regardless of polygon orientation.
      const d = normalize2(sub2(e.b, e.a));
      const centroid = polygonCentroid(arrangement.faces[link.other]);
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      const onPositive = cross2(d, sub2(centroid, mid)) >= 0;
      const type = resolved.find((c) => c.id === e.creaseId)?.type ?? 'valley';
      // sign * θ, θ ∈ [0, π]: child on +n side rises for +θ (valley).
      const foldSign = (onPositive ? 1 : -1) * (type === 'valley' ? 1 : -1);
      parentHinge[link.other] = {
        a: e.a,
        b: e.b,
        creaseId: e.creaseId,
        foldType: type,
        foldSign,
      };
      queue.push(link.other);
    }
  }

  // Anything unreached (shouldn't happen for a connected sheet) gets reset.
  const faces: Face[] = arrangement.faces.map((poly, i) => ({
    index: i,
    polygon: poly,
    area: Math.abs(polygonArea(poly)),
    parent: parent[i] === -2 ? -1 : parent[i],
    hinge: parentHinge[i],
    depth: depth[i],
  }));

  // Cycle edges: hinge edges not in the tree.
  const cycleEdges = arrangement.hingeEdges.filter((_, i) => !usedEdges.has(i));
  const cycleCreases = [...new Set(cycleEdges.map((e) => e.creaseId))];

  const diagnostics = computeDiagnostics(
    faces,
    arrangement.hingeEdges,
    resolved,
    cycleEdges,
    cycleCreases,
    half,
  );

  return {
    faces,
    creases: resolved,
    hingeEdges: arrangement.hingeEdges,
    rootFace,
    half,
    diagnostics,
  };
}

function computeDiagnostics(
  faces: Face[],
  hingeEdges: HingeEdge[],
  resolved: ResolvedCrease[],
  cycleEdges: HingeEdge[],
  cycleCreases: string[],
  half: number,
): Diagnostics {
  // Interior vertices: crease split points strictly inside the sheet.
  const vertexMap = new Map<string, { p: Vec2; creases: Set<string>; types: Set<FoldType> }>();
  const keyOf = (p: Vec2) => `${Math.round(p.x * 1e5)}:${Math.round(p.y * 1e5)}`;
  for (const c of resolved) {
    for (const p of c.points) {
      const inside = Math.abs(p.x) < half - 1e-6 && Math.abs(p.y) < half - 1e-6;
      if (!inside) continue;
      const k = keyOf(p);
      let v = vertexMap.get(k);
      if (!v) {
        v = { p, creases: new Set(), types: new Set() };
        vertexMap.set(k, v);
      }
      v.creases.add(c.id);
      v.types.add(c.type);
    }
  }

  let maekawaViolations = 0;
  for (const v of vertexMap.values()) {
    // Maekawa: at an interior vertex in a flat fold, folds (degree) is even and
    // mountains - valleys = ±2. We only check the parity/closedness criterion,
    // since angles are animated.
    const mountains = [...v.types].filter((t) => t === 'mountain').length;
    const valleys = [...v.types].filter((t) => t === 'valley').length;
    const degree = v.creases.size;
    if (degree >= 3 && (degree % 2 !== 0 || Math.abs(mountains - valleys) !== 2)) {
      maekawaViolations++;
    }
  }

  const isolated = resolved
    .filter((c) => !resolved.some((o) => o.id !== c.id && sharesEndpoint(c, o)))
    .map((c) => c.id);

  return {
    faceCount: faces.length,
    hingeCount: hingeEdges.length,
    cycleEdges: cycleEdges.length,
    cycleCreases,
    maekawaViolations,
    interiorVertices: vertexMap.size,
    isolatedCreases: isolated,
  };
}

function sharesEndpoint(a: ResolvedCrease, b: ResolvedCrease): boolean {
  for (const p of a.points) {
    for (const q of b.points) {
      if (dist2(p, q) < 1e-5) return true;
    }
  }
  return false;
}

/** Clamp a crease endpoint helper kept for the editor's snapping. */
export function snapPoint(p: Vec2, half: number, grid: number): Vec2 {
  if (grid <= 0) return p;
  return {
    x: clamp(Math.round(p.x / grid) * grid, -half, half),
    y: clamp(Math.round(p.y / grid) * grid, -half, half),
  };
}

/**
 * Triangulate a simple polygon (CCW) by ear clipping.
 * Returns index triples into the polygon's own vertex list.
 */
export function triangulate(poly: Vec2[]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];

  const idx = poly.map((_, i) => i);
  if (polygonArea(poly) < 0) idx.reverse();

  const tris: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n + 32) {
    let earFound = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = poly[i0];
      const b = poly[i1];
      const c = poly[i2];
      const area = triArea2(a, b, c);
      if (area <= 1e-12) continue; // reflex or degenerate
      let contains = false;
      for (let k = 0; k < idx.length; k++) {
        const j = idx[k];
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTriangle(poly[j], a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      tris.push(i0, i1, i2);
      idx.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) break; // non-simple input; emit a fan fallback
  }
  if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
  else if (tris.length === 0) {
    for (let i = 1; i + 1 < poly.length; i++) tris.push(0, i, i + 1);
  }
  return tris;
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = triArea2(a, b, p);
  const d2 = triArea2(b, c, p);
  const d3 = triArea2(c, a, p);
  const hasNeg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
  const hasPos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
  return !(hasNeg && hasPos);
}

/** Convenience: clip a raw crease to the sheet, exposed for the editor preview. */
export function previewClip(a: Vec2, b: Vec2, half: number): { a: Vec2; b: Vec2 } | null {
  return clipSegmentToSquare(a, b, half);
}
