import type { Crease, Keyframe, OrigamiDoc } from './types';
import { DEFAULT_MATERIAL, DEFAULT_TIMELINE } from './types';

/**
 * Sample sequences.
 *
 * Two teaching README sequences, both expressed as flat crease layouts with
 * keyframed angles. They exist so the tool opens with something to play, and so
 * each module has meaningful content immediately: a two-panel book fold where a
 * single hinge sweeps 0→180°, and a four-panel cross fold that exercises
 * multi-hinge interpolation and the cycle diagnostics.
 */

interface SeedCrease {
  id: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
  type: 'mountain' | 'valley';
  angle: number;
  keys: [number, number][]; // time, angle
}

function docFromSeeds(name: string, duration: number, seeds: SeedCrease[]): OrigamiDoc {
  const creases: Crease[] = [];
  const keyframes: Record<string, Keyframe[]> = {};
  seeds.forEach((s, i) => {
    creases.push({
      id: s.id,
      a: { ...s.a },
      b: { ...s.b },
      type: s.type,
      angle: s.angle,
      slot: i,
    });
    keyframes[s.id] = s.keys.map(([time, angle], k) => ({ id: `${s.id}-k${k}`, time, angle }));
  });
  return {
    version: 1,
    name,
    sheet: { size: 2 },
    creases,
    keyframes,
    material: { ...DEFAULT_MATERIAL },
    timeline: { ...DEFAULT_TIMELINE, duration },
  };
}

/** 对折书页: one central valley, folded over and back. */
export function sampleBookFold(): OrigamiDoc {
  return docFromSeeds('对折书页', 4, [
    {
      id: 'c1',
      a: { x: 0, y: -1 },
      b: { x: 0, y: 1 },
      type: 'valley',
      angle: 0,
      keys: [
        [0, 0],
        [1.4, 180],
        [2.6, 180],
        [3.6, 0],
      ],
    },
  ]);
}

/** 十字折: a cross layout, the four quadrants easing shut in sequence. */
export function sampleCrossFold(): OrigamiDoc {
  return docFromSeeds('十字折', 6, [
    {
      id: 'v',
      a: { x: 0, y: -1 },
      b: { x: 0, y: 1 },
      type: 'valley',
      angle: 0,
      keys: [
        [0, 0],
        [1.8, 100],
        [4.4, 100],
        [5.8, 0],
      ],
    },
    {
      id: 'h',
      a: { x: -1, y: 0 },
      b: { x: 1, y: 0 },
      type: 'mountain',
      angle: 0,
      keys: [
        [0, 0],
        [2.2, 90],
        [4.6, 90],
        [5.6, 0],
      ],
    },
  ]);
}

/** 双翼: two parallel creases, the outer panels folding inward like a pamphlet. */
export function sampleWings(): OrigamiDoc {
  return docFromSeeds('双翼内折', 5, [
    {
      id: 'l',
      a: { x: -0.45, y: -1 },
      b: { x: -0.45, y: 1 },
      type: 'valley',
      angle: 0,
      keys: [
        [0, 0],
        [2.0, 150],
        [3.6, 150],
        [4.6, 0],
      ],
    },
    {
      id: 'r',
      a: { x: 0.45, y: -1 },
      b: { x: 0.45, y: 1 },
      type: 'valley',
      angle: 0,
      keys: [
        [0, 0],
        [1.4, 150],
        [3.2, 150],
        [4.8, 0],
      ],
    },
  ]);
}

/** 风筝底: diagonal folds with a corner tuck, a classic teaching sequence. */
export function sampleKiteBase(): OrigamiDoc {
  return docFromSeeds('风筝基础折', 6, [
    {
      id: 'd1',
      a: { x: -1, y: -1 },
      b: { x: 1, y: 1 },
      type: 'valley',
      angle: 0,
      keys: [
        [0, 0],
        [2.2, 90],
        [4.6, 90],
      ],
    },
    {
      id: 'd2',
      a: { x: -1, y: 1 },
      b: { x: 0, y: 0 },
      type: 'mountain',
      angle: 0,
      keys: [
        [1.2, 0],
        [3.4, 80],
        [5.2, 80],
      ],
    },
  ]);
}

export const SAMPLES: { id: string; name: string; blurb: string; make: () => OrigamiDoc }[] = [
  { id: 'book', name: '对折书页', blurb: '单铰链 0→180° 折叠', make: sampleBookFold },
  { id: 'cross', name: '十字折', blurb: '四象限交叉折', make: sampleCrossFold },
  { id: 'wings', name: '双翼内折', blurb: '两条平行折痕', make: sampleWings },
  { id: 'kite', name: '风筝基础折', blurb: '对角折 + 山折收角', make: sampleKiteBase },
];
