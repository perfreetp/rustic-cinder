import {
  type Vec2,
  clamp,
  cross2,
  dist2,
  length2,
  normalize2,
  sub2,
} from './math';
import type { Crease, ResolvedCrease } from './types';

/**
 * Crease resolution.
 *
 * Users draw finite crease segments, but an origami fold only makes physical
 * sense when a crease runs between two fixed supports: another crease or the
 * paper edge. A crease that stops in mid-paper is ambiguous (which side moves?),
 * so we resolve such "dangling" ends by extending them along their own direction
 * until they meet the paper edge or another crease. This mirrors how a real fold
 * propagates across the paper, and it makes the face decomposition well defined.
 *
 * Every crease is reported back with an `adjusted` flag so the editor can tell
 * the user which creases were extended.
 */

/** Distance below which two points are considered the same point. */
export const WELD_EPS = 1e-6;

export function onBoundary(p: Vec2, half: number, eps = 1e-6): boolean {
  return (
    Math.abs(Math.abs(p.x) - half) <= eps ||
    Math.abs(Math.abs(p.y) - half) <= eps
  );
}

/**
 * Liang–Barsky clip of segment a→b against the square [-half, half]².
 * Returns the clipped endpoints, or null when the segment lies outside, or is
 * shortened to (numerically) nothing.
 */
export function clipSegmentToSquare(a: Vec2, b: Vec2, half: number): { a: Vec2; b: Vec2 } | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  const p = [-dx, dx, -dy, dy];
  const q = [a.x + half, half - a.x, a.y + half, half - a.y];

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-14) {
      if (q[i] < 0) return null;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }

  if (t1 - t0 < 1e-9) return null;
  return {
    a: { x: a.x + t0 * dx, y: a.y + t0 * dy },
    b: { x: a.x + t1 * dx, y: a.y + t1 * dy },
  };
}

/** Parameter t along a→b (a + t*(b-a)) of the intersection with c→d, or null. */
export function segmentIntersection(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
  eps = 1e-9,
): { t: number; u: number; p: Vec2 } | null {
  const r = sub2(b, a);
  const s = sub2(d, c);
  const denom = cross2(r, s);
  const qp = sub2(c, a);
  if (Math.abs(denom) < 1e-12) return null; // parallel / collinear

  const t = cross2(qp, s) / denom;
  const u = cross2(qp, r) / denom;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return {
    t: clamp(t, 0, 1),
    u: clamp(u, 0, 1),
    p: { x: a.x + r.x * clamp(t, 0, 1), y: a.y + r.y * clamp(t, 0, 1) },
  };
}

/** Does point `p` lie on segment a→b (within eps)? */
export function pointOnSegment(p: Vec2, a: Vec2, b: Vec2, eps = WELD_EPS): boolean {
  const ab = sub2(b, a);
  const len = length2(ab);
  if (len < eps) return dist2(p, a) <= eps;
  const ap = sub2(p, a);
  const t = (ap.x * ab.x + ap.y * ab.y) / (len * len);
  if (t < -eps || t > 1 + eps) return false;
  const proj = { x: a.x + ab.x * clamp(t, 0, 1), y: a.y + ab.y * clamp(t, 0, 1) };
  return dist2(p, proj) <= eps;
}

/**
 * Distance along a ray from `origin` in direction `dir` (unit) to the square edge,
 * or Infinity if the direction is zero.
 */
function rayExitDistance(origin: Vec2, dir: Vec2, half: number): number {
  let tBest = Infinity;
  if (Math.abs(dir.x) > 1e-12) {
    const t = ((dir.x > 0 ? half : -half) - origin.x) / dir.x;
    if (t > 0) tBest = Math.min(tBest, t);
  }
  if (Math.abs(dir.y) > 1e-12) {
    const t = ((dir.y > 0 ? half : -half) - origin.y) / dir.y;
    if (t > 0) tBest = Math.min(tBest, t);
  }
  return tBest;
}

/** Are two creases practically the same (identical or collinear-overlapping)? */
export function creasesOverlap(c1: Crease, c2: Crease, eps = 1e-4): boolean {
  // Same endpoints in either order.
  if (
    (dist2(c1.a, c2.a) < eps && dist2(c1.b, c2.b) < eps) ||
    (dist2(c1.a, c2.b) < eps && dist2(c1.b, c2.a) < eps)
  ) {
    return true;
  }
  // Collinear and overlapping over a meaningful length.
  const d1 = normalize2(sub2(c1.b, c1.a));
  const d2 = normalize2(sub2(c2.b, c2.a));
  if (Math.abs(cross2(d1, d2)) > 1e-4) return false;
  const off = Math.abs(cross2(d1, sub2(c2.a, c1.a)));
  if (off > eps) return false;
  const proj = (p: Vec2) =>
    (p.x - c1.a.x) * d1.x + (p.y - c1.a.y) * d1.y;
  const len1 = length2(sub2(c1.b, c1.a));
  const lo2 = Math.min(proj(c2.a), proj(c2.b));
  const hi2 = Math.max(proj(c2.a), proj(c2.b));
  const overlap = Math.min(len1, hi2) - Math.max(0, lo2);
  return overlap > 0.02;
}

interface WorkingCrease {
  id: string;
  type: Crease['type'];
  a: Vec2;
  b: Vec2;
  adjusted: boolean;
  slot: number;
}

/**
 * Resolve a raw crease list into clipped, extended segments.
 * Deterministic: the result only depends on the crease order and geometry.
 */
export function resolveCreases(raw: Crease[], half: number): ResolvedCrease[] {
  const working: WorkingCrease[] = [];
  const kept: Crease[] = [];

  for (const c of raw) {
    if (length2(sub2(c.b, c.a)) < 0.01) continue; // ignore dots
    if (kept.some((k) => creasesOverlap(k, c))) continue; // ignore duplicates
    const clipped = clipSegmentToSquare(c.a, c.b, half);
    if (!clipped) continue;
    if (length2(sub2(clipped.b, clipped.a)) < 0.01) continue;
    kept.push(c);
    working.push({
      id: c.id,
      type: c.type,
      a: clipped.a,
      b: clipped.b,
      adjusted:
        dist2(clipped.a, c.a) > 1e-6 || dist2(clipped.b, c.b) > 1e-6,
      slot: c.slot,
    });
  }

  // Extend dangling ends until nothing moves.
  for (let iter = 0; iter < 8; iter++) {
    let changed = false;
    const next = working.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));

    for (let i = 0; i < working.length; i++) {
      const w = working[i];
      for (const end of [0, 1] as const) {
        const p = end === 0 ? w.a : w.b;
        const other = end === 0 ? w.b : w.a;
        if (onBoundary(p, half)) continue;

        // Already touching another crease?
        let touches = false;
        for (let j = 0; j < working.length && !touches; j++) {
          if (j === i) continue;
          const o = working[j];
          if (pointOnSegment(p, o.a, o.b, 1e-5)) touches = true;
        }
        if (touches) continue;

        const dir = normalize2(sub2(p, other));
        if (length2(dir) < 0.5) continue;

        let tBest = rayExitDistance(p, dir, half);
        for (let j = 0; j < working.length; j++) {
          if (j === i) continue;
          const o = working[j];
          // Ray/segment intersection: p + t*dir = o.a + u*(o.b-o.a), t > 0, u in [0,1].
          const seg = sub2(o.b, o.a);
          const denom = cross2(dir, seg);
          if (Math.abs(denom) < 1e-12) continue;
          const qp = sub2(o.a, p);
          const t = cross2(qp, seg) / denom;
          const u = cross2(qp, dir) / denom;
          if (t > 1e-6 && u > -1e-6 && u < 1 + 1e-6 && t < tBest) tBest = t;
        }
        if (!Number.isFinite(tBest) || tBest <= 1e-6) continue;

        const np = { x: p.x + dir.x * tBest, y: p.y + dir.y * tBest };
        if (dist2(np, p) < 1e-6) continue;
        // Snap exactly onto the boundary when that is what we hit.
        if (Math.abs(Math.abs(np.x) - half) < 1e-6) np.x = Math.sign(np.x) * half;
        if (Math.abs(Math.abs(np.y) - half) < 1e-6) np.y = Math.sign(np.y) * half;

        const target = next[i];
        if (end === 0) target.a = np;
        else target.b = np;
        target.adjusted = true;
        changed = true;
      }
    }

    for (let i = 0; i < working.length; i++) {
      working[i].a = next[i].a;
      working[i].b = next[i].b;
      working[i].adjusted = next[i].adjusted;
    }
    if (!changed) break;
  }

  return working.map((w) => ({
    id: w.id,
    type: w.type,
    a: w.a,
    b: w.b,
    adjusted: w.adjusted,
    points: [w.a, w.b],
  }));
}

/**
 * Compute the split points of every resolved crease against every other crease
 * and the sheet boundary is already handled (ends lie on it). Mutates `points`.
 */
export function splitAtIntersections(creases: ResolvedCrease[]): void {
  const params: number[][] = creases.map(() => [0, 1]);

  for (let i = 0; i < creases.length; i++) {
    for (let j = i + 1; j < creases.length; j++) {
      const A = creases[i];
      const B = creases[j];
      const hit = segmentIntersection(A.a, A.b, B.a, B.b);
      if (!hit) continue;
      params[i].push(hit.t);
      params[j].push(hit.u);
    }
  }

  for (let i = 0; i < creases.length; i++) {
    const c = creases[i];
    const d = sub2(c.b, c.a);
    const ts = [...new Set(params[i].map((t) => Number(t.toFixed(9))))].sort((x, y) => x - y);
    const pts: Vec2[] = [];
    for (const t of ts) {
      const p = { x: c.a.x + d.x * t, y: c.a.y + d.y * t };
      if (pts.length && dist2(pts[pts.length - 1], p) < WELD_EPS) continue;
      pts.push(p);
    }
    if (pts.length >= 2) c.points = pts;
  }
}
