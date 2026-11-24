import { describe, expect, it } from 'vitest';
import { buildTopology, polygonArea, triangulate } from '../src/core/arrangement';
import { clipSegmentToSquare, resolveCreases, splitAtIntersections } from '../src/core/creases';
import { assembleMesh, buildMeshTemplate, createMeshBuffers, maxNormalDelta, solveFold } from '../src/core/fold';
import { buildCurve, sampleAngles, sampleTrack, normalizeKeys, monotoneTangents, advanceTime } from '../src/core/timeline';
import type { Crease, Keyframe, TimelineSettings } from '../src/core/types';
import { DEFAULT_TIMELINE } from '../src/core/types';
import { dot3 } from '../src/core/math';

const mk = (id: string, ax: number, ay: number, bx: number, by: number, type: 'mountain' | 'valley', angle = 90): Crease => ({
  id,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  type,
  angle,
  slot: 0,
});

describe('crease resolution', () => {
  it('clips a segment crossing the sheet to the square', () => {
    const c = clipSegmentToSquare({ x: -3, y: 0 }, { x: 3, y: 0 }, 1);
    expect(c).not.toBeNull();
    expect(c!.a.x).toBeCloseTo(-1);
    expect(c!.b.x).toBeCloseTo(1);
  });

  it('rejects a segment entirely outside', () => {
    expect(clipSegmentToSquare({ x: 2, y: 2 }, { x: 3, y: 3 }, 1)).toBeNull();
  });

  it('extends a dangling interior crease to both edges', () => {
    const out = resolveCreases([mk('a', -0.2, -0.2, 0.2, 0.2, 'valley')], 1);
    expect(out).toHaveLength(1);
    expect(out[0].adjusted).toBe(true);
    // 45° line through origin must exit at corners.
    expect(Math.abs(out[0].a.x)).toBeCloseTo(1, 5);
    expect(Math.abs(out[0].b.x)).toBeCloseTo(1, 5);
  });

  it('drops duplicate creases', () => {
    const out = resolveCreases(
      [mk('a', 0, -1, 0, 1, 'valley'), mk('b', 0, 1, 0, -1, 'mountain')],
      1,
    );
    expect(out).toHaveLength(1);
  });

  it('splits creases at intersections', () => {
    const cs = resolveCreases(
      [mk('h', -1, 0, 1, 0, 'valley'), mk('v', 0, -1, 0, 1, 'mountain')],
      1,
    );
    splitAtIntersections(cs);
    expect(cs[0].points).toHaveLength(3);
    expect(cs[1].points).toHaveLength(3);
  });
});

describe('arrangement → faces', () => {
  it('splits a square into two faces with one hinge', () => {
    const topo = buildTopology([mk('mid', 0, -1, 0, 1, 'valley')], 1);
    expect(topo.faces).toHaveLength(2);
    expect(topo.hingeEdges).toHaveLength(1);
    expect(topo.diagnostics.faceCount).toBe(2);
    const total = topo.faces.reduce((s, f) => s + f.area, 0);
    expect(total).toBeCloseTo(4, 5);
  });

  it('splits a square into four faces with a cross', () => {
    const topo = buildTopology(
      [mk('v', 0, -1, 0, 1, 'valley'), mk('h', -1, 0, 1, 0, 'mountain')],
      1,
    );
    expect(topo.faces).toHaveLength(4);
    expect(topo.hingeEdges).toHaveLength(4); // four spokes from centre to corners
    // One cycle in the hinge graph: the four spokes form a cycle through faces.
    expect(topo.diagnostics.cycleEdges).toBe(1);
    const total = topo.faces.reduce((s, f) => s + f.area, 0);
    expect(total).toBeCloseTo(4, 5);
  });

  it('builds a valid tree parent for every face', () => {
    const topo = buildTopology(
      [mk('v', 0, -1, 0, 1, 'valley'), mk('h', -1, 0, 1, 0, 'mountain')],
      1,
    );
    expect(topo.faces[topo.rootFace].parent).toBe(-1);
    for (const f of topo.faces) {
      if (f.index !== topo.rootFace) {
        expect(f.parent).toBeGreaterThanOrEqual(0);
        expect(f.hinge).not.toBeNull();
        expect(f.depth).toBe(topo.faces[f.parent].depth + 1);
      }
    }
  });

  it('handles diagonal corner-to-corner fold', () => {
    const topo = buildTopology([mk('diag', -1, -1, 1, 1, 'valley')], 1);
    expect(topo.faces).toHaveLength(2);
    expect(topo.faces[0].area + topo.faces[1].area).toBeCloseTo(4, 4);
  });

  it('keeps faces CCW and convex-ish polygons triangulable', () => {
    const topo = buildTopology(
      [
        mk('v', 0, -1, 0, 1, 'valley'),
        mk('h', -1, 0, 1, 0, 'mountain'),
        mk('d', -1, -1, 0, 0, 'valley'),
      ],
      1,
    );
    for (const f of topo.faces) {
      expect(polygonArea(f.polygon)).toBeGreaterThan(0);
      const tris = triangulate(f.polygon);
      expect(tris.length).toBeGreaterThanOrEqual(3);
      expect(tris.length % 3).toBe(0);
    }
  });

  it('returns a single face when there are no creases', () => {
    const topo = buildTopology([], 1);
    expect(topo.faces).toHaveLength(1);
    expect(topo.faces[0].area).toBeCloseTo(4, 5);
  });
});

describe('fold solver', () => {
  it('keeps a flat sheet flat at angle 0', () => {
    const topo = buildTopology(
      [mk('v', 0, -1, 0, 1, 'valley'), mk('h', -1, 0, 1, 0, 'mountain')],
      1,
    );
    const angles = new Map(topo.creases.map((c) => [c.id, 0]));
    const tf = solveFold(topo, angles);
    for (const n of tf.normals) expect(Math.abs(n.z)).toBeCloseTo(1, 5);
  });

  it('rotates the child face by the keyed angle', () => {
    const topo = buildTopology([mk('mid', 0, -1, 0, 1, 'valley')], 1);
    const child = topo.faces.find((f) => f.parent >= 0)!;
    const parent = topo.faces[child.parent];

    const flat0 = solveFold(topo, new Map([['mid', 0]]));
    const fold90 = solveFold(topo, new Map([['mid', 90]]));

    // Parent must never move.
    for (let i = 0; i < 16; i++) expect(fold90.matrices[parent.index][i]).toBeCloseTo(flat0.matrices[parent.index][i], 9);

    const n0 = flat0.normals[child.index];
    const n90 = fold90.normals[child.index];
    const delta = (Math.acos(Math.max(-1, Math.min(1, dot3(n0, n90)))) * 180) / Math.PI;
    expect(delta).toBeCloseTo(90, 3);
  });

  it('mountain and valley fold the child to opposite sides of the sheet', () => {
    const probe = (type: 'valley' | 'mountain') => {
      const topo = buildTopology([mk('mid', 0, -1, 0, 1, type)], 1);
      const tf = solveFold(topo, new Map([['mid', 60]]));
      const child = topo.faces.find((f) => f.parent >= 0)!;
      let sx = 0;
      let sy = 0;
      for (const p of child.polygon) {
        sx += p.x;
        sy += p.y;
      }
      sx /= child.polygon.length;
      sy /= child.polygon.length;
      const m = tf.matrices[child.index];
      return m[2] * sx + m[6] * sy + m[14];
    };
    const zv = probe('valley');
    const zm = probe('mountain');
    expect(Math.abs(zv)).toBeGreaterThan(0.1);
    expect(Math.sign(zv)).toBe(-Math.sign(zm));
  });

  it('is continuous across a 180° fold sweep (no normals jump)', () => {
    const topo = buildTopology([mk('mid', 0, -1, 0, 1, 'valley')], 1);
    let prev = solveFold(topo, new Map([['mid', 0]]));
    let worst = 0;
    for (let deg = 1; deg <= 180; deg++) {
      const cur = solveFold(topo, new Map([['mid', deg]]));
      worst = Math.max(worst, maxNormalDelta(prev, cur));
      prev = cur;
    }
    // 1° steps must never produce more than ~1° of normal change.
    expect(worst).toBeLessThan(1.5);
  });
});

describe('mesh assembly', () => {
  it('produces finite world positions for every vertex', () => {
    const topo = buildTopology(
      [mk('v', 0, -1, 0, 1, 'valley'), mk('h', -1, 0, 1, 0, 'mountain')],
      1,
    );
    const template = buildMeshTemplate(topo);
    const buffers = createMeshBuffers(template);
    const tf = solveFold(topo, new Map(topo.creases.map((c) => [c.id, 45])));
    assembleMesh(template, tf, buffers);
    for (let i = 0; i < buffers.positions.length; i++) {
      expect(Number.isFinite(buffers.positions[i])).toBe(true);
    }
    for (let i = 0; i < buffers.normals.length; i += 3) {
      const len = Math.hypot(buffers.normals[i], buffers.normals[i + 1], buffers.normals[i + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
    expect(buffers.indices.length % 3).toBe(0);
    expect(template.totalVertexCount).toBeGreaterThanOrEqual(4);
  });

  it('gives distinct points distinct uvs covering the sheet', () => {
    const topo = buildTopology([mk('mid', 0, -1, 0, 1, 'valley')], 1);
    const t = buildMeshTemplate(topo);
    for (const f of t.faces) {
      for (let i = 0; i < f.vertexCount; i++) {
        const x = f.positions[i * 2];
        // uv.x is derived from sheet x
        expect(x).toBeGreaterThanOrEqual(-1.0001);
        expect(x).toBeLessThanOrEqual(1.0001);
      }
    }
    for (let i = 0; i < t.uvs.length; i++) {
      expect(t.uvs[i]).toBeGreaterThanOrEqual(0);
      expect(t.uvs[i]).toBeLessThanOrEqual(1);
    }
  });
});

describe('keyframes', () => {
  it('normalises, sorts and collapses near-duplicates', () => {
    const keys: Keyframe[] = [
      { id: 'k2', time: 1, angle: 30 },
      { id: 'k1', time: 0, angle: 90 },
      { id: 'k3', time: 1.00001, angle: 40 },
    ];
    const n = normalizeKeys(keys);
    expect(n).toHaveLength(2);
    expect(n[1].angle).toBe(40);
  });

  it('is exact at keyframe times and monotone between them', () => {
    const crease = mk('a', 0, -1, 0, 1, 'valley', 0);
    const keys = [
      { id: '1', time: 0, angle: 180 },
      { id: '2', time: 1, angle: 90 },
      { id: '3', time: 2, angle: 0 },
    ];
    const curve = buildCurve([crease], { a: keys }, DEFAULT_TIMELINE);
    const track = curve.tracks.get('a')!;
    expect(sampleTrack(track, 0)).toBeCloseTo(180);
    expect(sampleTrack(track, 1)).toBeCloseTo(90);
    expect(sampleTrack(track, 2)).toBeCloseTo(0);
    let prev = 200;
    for (let t = 0; t <= 2; t += 0.01) {
      const v = sampleTrack(track, t);
      expect(v).toBeLessThanOrEqual(prev + 1e-6);
      expect(v).toBeGreaterThanOrEqual(-1e-6);
      prev = v;
    }
  });

  it('never overshoots a local extremum', () => {
    const crease = mk('a', 0, -1, 0, 1, 'valley', 0);
    const keys = [
      { id: '1', time: 0, angle: 0 },
      { id: '2', time: 1, angle: 90 },
      { id: '3', time: 2, angle: 0 },
    ];
    const curve = buildCurve([crease], { a: keys }, DEFAULT_TIMELINE);
    const track = curve.tracks.get('a')!;
    for (let t = 0; t <= 2; t += 0.005) {
      const v = sampleTrack(track, t);
      expect(v).toBeLessThanOrEqual(90 + 1e-6);
      expect(v).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('is C¹ continuous across a keyframe (slopes match)', () => {
    const crease = mk('a', 0, -1, 0, 1, 'valley', 0);
    const keys = [
      { id: '1', time: 0, angle: 0 },
      { id: '2', time: 1, angle: 60 },
      { id: '3', time: 2, angle: 120 },
    ];
    const curve = buildCurve([crease], { a: keys }, DEFAULT_TIMELINE);
    const track = curve.tracks.get('a')!;
    const h = 1e-4;
    const left = (sampleTrack(track, 1) - sampleTrack(track, 1 - h)) / h;
    const right = (sampleTrack(track, 1 + h) - sampleTrack(track, 1)) / h;
    expect(Math.abs(left - right)).toBeLessThan(1e-2);
  });

  it('holds the static angle outside the key range', () => {
    const crease = mk('a', 0, -1, 0, 1, 'valley', 42);
    const curve = buildCurve([crease], { a: [] }, DEFAULT_TIMELINE);
    expect(sampleTrack(curve.tracks.get('a')!, 0)).toBe(42);
    expect(sampleTrack(curve.tracks.get('a')!, 99)).toBe(42);
  });

  it('samples all creases and handles loop wrap', () => {
    const c1 = mk('a', 0, -1, 0, 1, 'valley', 0);
    const curve = buildCurve([c1], { a: [{ id: '1', time: 0, angle: 10 }] }, DEFAULT_TIMELINE);
    const angles = sampleAngles(curve, 0.5);
    expect(angles.get('a')).toBeCloseTo(10);
    const settings: TimelineSettings = { ...DEFAULT_TIMELINE, duration: 2, loop: true, speed: 1 };
    expect(advanceTime(1.9, 0.2, settings)).toBeCloseTo(0.1);
    expect(advanceTime(1.9, 0.2, { ...settings, loop: false })).toBeCloseTo(2);
  });

  it('computes flat tangents at extrema', () => {
    const m = monotoneTangents([0, 1, 2], [0, 1, 0]);
    expect(m[1]).toBeCloseTo(0);
  });
});
