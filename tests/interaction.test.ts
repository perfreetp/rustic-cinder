import { describe, expect, it, beforeEach } from 'vitest';
import { DocStore, emptyDoc, cloneDoc } from '../src/core/doc';
import { buildExportPayload, parseImportedDoc } from '../src/core/exporter';
import { buildTopology } from '../src/core/arrangement';
import { sampleBookFold, sampleCrossFold } from '../src/core/samples';
import { buildCurve, sampleAngles, bakeSamples, advanceTime } from '../src/core/timeline';
import { buildMeshTemplate, createMeshBuffers, solveFold, assembleMesh, maxNormalDelta } from '../src/core/fold';
import type { Crease } from '../src/core/types';
import { DEFAULT_TIMELINE, MAX_CREASES } from '../src/core/types';

describe('DocStore', () => {
  let store: DocStore;
  beforeEach(() => {
    store = new DocStore(emptyDoc('test'));
  });

  it('adds and removes creases with keyframe buckets', () => {
    const c = store.addCrease({ a: { x: 0, y: -1 }, b: { x: 0, y: 1 }, type: 'valley', angle: 0 });
    expect(c).not.toBeNull();
    expect(store.current.creases).toHaveLength(1);
    expect(store.current.keyframes[c!.id]).toEqual([]);
    store.removeCrease(c!.id);
    expect(store.current.creases).toHaveLength(0);
    expect(store.current.keyframes[c!.id]).toBeUndefined();
  });

  it('refuses more than 32 creases', () => {
    for (let i = 0; i < MAX_CREASES; i++) {
      const x = -1 + i * 0.06;
      const c = store.addCrease({ a: { x, y: -1 }, b: { x, y: 1 }, type: 'valley', angle: 0 });
      expect(c).not.toBeNull();
    }
    const extra = store.addCrease({ a: { x: 0, y: 0 }, b: { x: 0.5, y: 0.5 }, type: 'valley', angle: 0 });
    expect(extra).toBeNull();
  });

  it('never reuses an id already present in the document', () => {
    // Regression: a counter-based id handed out `c1` again and clobbered the
    // existing crease's keyframe bucket.
    const seeded = sampleBookFold();
    const s = new DocStore(seeded);
    const added = s.addCrease({ a: { x: 0.5, y: -1 }, b: { x: 0.5, y: 1 }, type: 'mountain', angle: 0 })!;
    expect(added.id).not.toBe('c1');
    expect(s.current.keyframes['c1']).toHaveLength(seeded.keyframes['c1'].length);
    const ids = s.current.creases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns unique stable slots', () => {
    const a = store.addCrease({ a: { x: 0, y: -1 }, b: { x: 0, y: 1 }, type: 'valley', angle: 0 })!;
    const b = store.addCrease({ a: { x: -1, y: 0 }, b: { x: 1, y: 0 }, type: 'valley', angle: 0 })!;
    expect(a.slot).not.toBe(b.slot);
  });

  it('undo/redo round-trips', () => {
    const c = store.addCrease({ a: { x: 0, y: -1 }, b: { x: 0, y: 1 }, type: 'valley', angle: 0 })!;
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.current.creases).toHaveLength(0);
    store.redo();
    expect(store.current.creases).toHaveLength(1);
    expect(store.current.creases[0].id).toBe(c.id);
  });

  it('coalesces a gesture into one undo entry', () => {
    const c = store.addCrease({ a: { x: 0, y: -1 }, b: { x: 0, y: 1 }, type: 'valley', angle: 0 })!;
    const before = store.current.creases[0].angle;
    store.beginGesture();
    for (let i = 0; i < 10; i++) store.updateCrease(c.id, { angle: i }, false);
    store.endGesture();
    expect(store.current.creases[0].angle).toBe(9);
    store.undo();
    expect(store.current.creases[0].angle).toBe(before);
  });

  it('adds keyframes idempotently at the same time', () => {
    const c = store.addCrease({ a: { x: 0, y: -1 }, b: { x: 0, y: 1 }, type: 'valley', angle: 0 })!;
    store.addKeyframe(c.id, 1.0, 45);
    store.addKeyframe(c.id, 1.0, 90);
    expect(store.current.keyframes[c.id]).toHaveLength(1);
    expect(store.current.keyframes[c.id][0].angle).toBe(90);
  });

  it('clamps keyframe times to the timeline duration', () => {
    const c = store.addCrease({ a: { x: 0, y: -1 }, b: { x: 0, y: 1 }, type: 'valley', angle: 0 })!;
    store.addKeyframe(c.id, 1, 45);
    const k = store.current.keyframes[c.id][0];
    store.moveKeyframe(c.id, k.id, 99);
    expect(store.current.keyframes[c.id][0].time).toBe(store.current.timeline.duration);
  });
});

describe('samples drive the whole pipeline', () => {
  const cases = [
    ['book', sampleBookFold],
    ['cross', sampleCrossFold],
  ] as const;

  for (const [name, make] of cases) {
    it(`${name}: topology, mesh and export agree`, () => {
      const doc = make();
      const half = doc.sheet.size / 2;
      const topo = buildTopology(
        doc.creases.map((c) => ({ ...c })),
        half,
        { anchor: { x: -half / 2, y: -half / 2 } },
      );
      expect(topo.faces.length).toBeGreaterThan(0);

      const template = buildMeshTemplate(topo);
      const buffers = createMeshBuffers(template);
      const curve = buildCurve(doc.creases, doc.keyframes, doc.timeline);

      for (let t = 0; t <= doc.timeline.duration; t += 0.5) {
        const angles = sampleAngles(curve, t);
        const tf = solveFold(topo, angles);
        assembleMesh(template, tf, buffers);
        for (let i = 0; i < buffers.positions.length; i++) {
          expect(Number.isFinite(buffers.positions[i])).toBe(true);
        }
      }

      const payload = buildExportPayload(doc, topo, { includeSamples: true, sampleHz: 30 });
      expect(payload.creases.length).toBe(doc.creases.length);
      expect(payload.samples!.frames.length).toBeGreaterThan(10);

      const reimported = parseImportedDoc(JSON.stringify(payload));
      expect(reimported.creases.length).toBe(doc.creases.length);
      expect(reimported.timeline.duration).toBe(doc.timeline.duration);
      expect(reimported.material).toEqual(doc.material);
      const reCurve = buildCurve(reimported.creases, reimported.keyframes, reimported.timeline);
      for (const t of [0, 0.5, 1.5, doc.timeline.duration]) {
        const a = sampleAngles(curve, t);
        const b = sampleAngles(reCurve, t);
        for (const [id, v] of a) expect(b.get(id)).toBeCloseTo(v, 1);
      }
    });
  }
});

describe('animation continuity', () => {
  it('folded normals never jump more than the angle step', () => {
    const doc = sampleCrossFold();
    const half = 1;
    const topo = buildTopology(
      doc.creases.map((c) => ({ ...c })),
      half,
      { anchor: { x: -0.5, y: -0.5 } },
    );
    const curve = buildCurve(doc.creases, doc.keyframes, doc.timeline);

    const dt = 1 / 240;
    let prev = solveFold(topo, sampleAngles(curve, 0));
    let worst = 0;
    for (let t = dt; t <= doc.timeline.duration; t += dt) {
      const cur = solveFold(topo, sampleAngles(curve, t));
      worst = Math.max(worst, maxNormalDelta(prev, cur));
      prev = cur;
    }
    expect(worst).toBeLessThan(2.0);
  });

  it('is continuous in time at a keyframe boundary', () => {
    const doc = sampleBookFold();
    const curve = buildCurve(doc.creases, doc.keyframes, doc.timeline);
    const eps = 1e-4;
    for (const key of doc.keyframes['c1']) {
      const before = sampleAngles(curve, key.time - eps).get('c1')!;
      const after = sampleAngles(curve, key.time + eps).get('c1')!;
      expect(Math.abs(after - before)).toBeLessThan(0.5);
    }
  });

  it('bakeSamples matches the live sampler', () => {
    const doc = sampleBookFold();
    const curve = buildCurve(doc.creases, doc.keyframes, doc.timeline);
    const baked = bakeSamples(curve, doc.timeline.duration, 0.1);
    for (const frame of baked) {
      expect(frame.angles['c1']).toBeCloseTo(sampleAngles(curve, frame.time).get('c1')!, 9);
    }
  });

  it('loop playback wraps cleanly', () => {
    const s = { ...DEFAULT_TIMELINE, duration: 4, loop: true };
    expect(advanceTime(3.99, 0.02, s)).toBeCloseTo(0.01, 5);
  });
});

describe('export validation', () => {
  it('rejects non-sequence files', () => {
    expect(() => parseImportedDoc('{}')).toThrow();
    expect(() => parseImportedDoc('null')).toThrow();
    expect(() => parseImportedDoc('not json')).toThrow();
  });

  it('normalises partial imports with defaults', () => {
    const doc = parseImportedDoc(
      JSON.stringify({
        version: 1,
        creases: [{ id: 'a', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, type: 'mountain', staticAngle: 30 }],
      }),
    );
    expect(doc.creases[0].type).toBe('mountain');
    expect(doc.creases[0].angle).toBe(30);
    expect(doc.material.translucency).toBe(1);
    expect(doc.timeline.duration).toBe(4);
  });

  it('preserves keyframes through clone', () => {
    const doc = sampleBookFold();
    const copy = cloneDoc(doc);
    copy.keyframes['c1'][0].angle = 999;
    expect(doc.keyframes['c1'][0].angle).not.toBe(999);
  });
});

describe('edge cases', () => {
  it('handles a crease that touches the sheet corner', () => {
    const topo = buildTopology(
      [{ id: 'd', a: { x: -1, y: -1 }, b: { x: 1, y: 1 }, type: 'valley', angle: 0, slot: 0 }],
      1,
    );
    expect(topo.faces.length).toBe(2);
    const total = topo.faces.reduce((s, f) => s + f.area, 0);
    expect(total).toBeCloseTo(4, 4);
  });

  it('handles many parallel creases', () => {
    const creases: Crease[] = [];
    for (let i = 1; i <= 8; i++) {
      const x = -1 + (2 * i) / 9;
      creases.push({
        id: `p${i}`,
        a: { x, y: -1 },
        b: { x, y: 1 },
        type: i % 2 ? 'valley' : 'mountain',
        angle: 0,
        slot: i,
      });
    }
    const topo = buildTopology(creases, 1);
    expect(topo.faces).toHaveLength(9);
    const total = topo.faces.reduce((s, f) => s + f.area, 0);
    expect(total).toBeCloseTo(4, 4);
  });

  it('does not crash on degenerate input', () => {
    const topo = buildTopology(
      [{ id: 'tiny', a: { x: 0, y: 0 }, b: { x: 0.001, y: 0.001 }, type: 'valley', angle: 0, slot: 0 }],
      1,
    );
    expect(topo.faces.length).toBeGreaterThanOrEqual(1);
  });
});
