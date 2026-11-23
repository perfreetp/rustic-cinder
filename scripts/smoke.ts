/**
 * Node-side smoke test for the field math and streamline engine.
 * Run: npx tsx scripts/smoke.ts  (or via vite-node). Plain assertions,
 * no test framework, so a failure exits non-zero.
 */
import { fieldAt } from '../src/lib/fieldMath';
import { computeStreamlines } from '../src/lib/streamlineEngine';
import { FIELD_HALF, MassPoint, StreamParams } from '../src/lib/types';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name} ${detail}`);
  }
};

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// 1. Single mass at origin: field points inward, magnitude ~ Gm/r^2.
{
  const masses: MassPoint[] = [{ id: 1, x: 0, z: 0, mass: 100 }];
  const [ax, az] = fieldAt(5, 0, masses);
  check('single mass field points inward (-x)', ax < 0 && approx(az, 0, 1e-12), `ax=${ax}`);
  const expected = (100 * 5) / Math.pow(25 + 0.12 * 0.12, 1.5);
  check('single mass magnitude matches softened formula', approx(ax, -expected, 1e-9), `ax=${ax} exp=${-expected}`);

  const [sx, sz] = fieldAt(0, 0, masses);
  check('field finite at singularity (softening)', Number.isFinite(sx) && Number.isFinite(sz));
}

// 2. Symmetry: field at midpoint of two equal masses on x-axis is zero.
{
  const masses: MassPoint[] = [
    { id: 1, x: -3, z: 0, mass: 50 },
    { id: 2, x: 3, z: 0, mass: 50 }
  ];
  const [ax, az] = fieldAt(0, 0, masses);
  check('equal-mass midpoint has zero field', approx(ax, 0, 1e-12) && approx(az, 0, 1e-12), `ax=${ax}`);
}

// 3. RK4: every forward trace around a central mass either ends inside the
//    capture radius or exhausts the length budget — none may cross the mass.
{
  const masses: MassPoint[] = [{ id: 1, x: 0, z: 0, mass: 100 }];
  const params: StreamParams = {
    seedDensity: 1,
    stepSize: 0.05,
    maxLength: 60,
    direction: 'forward'
  };
  const result = computeStreamlines(
    { msgId: 99, masses, params, interactive: false },
    () => false
  );
  let captured = 0;
  let crossed = 0;
  let minEndRadius = Infinity;
  for (let i = 0; i < result.lineCount; i++) {
    const s = result.lineStarts[i];
    const c = result.lineCounts[i];
    const endIdx = s + c - 1;
    const ex = result.positions[endIdx * 2];
    const ez = result.positions[endIdx * 2 + 1];
    const endR = Math.hypot(ex, ez);
    if (endR < minEndRadius) minEndRadius = endR;
    if (endR < 0.4) captured++;
    // No interior point may enter the capture radius (tunneling check).
    for (let j = 0; j < c - 1; j++) {
      const rr = Math.hypot(result.positions[(s + j) * 2], result.positions[(s + j) * 2 + 1]);
      if (rr < 0.35) {
        crossed++;
        break;
      }
    }
  }
  check('most forward traces are captured by the mass', captured > result.lineCount * 0.8,
    `${captured}/${result.lineCount}`);
  check('no streamline tunnels through the mass', crossed === 0, `crossed=${crossed}`);
  check('closest endpoint lies within the capture radius', minEndRadius < 0.4, `r=${minEndRadius}`);
}

// 4. Engine: jittered grid produces lines under budget, all inside domain.
{
  const masses: MassPoint[] = [
    { id: 1, x: -3, z: 0, mass: 80 },
    { id: 2, x: 3, z: 0, mass: 80 }
  ];
  const params: StreamParams = {
    seedDensity: 4,
    stepSize: 0.1,
    maxLength: 50,
    direction: 'bidirectional'
  };
  const result = computeStreamlines(
    { msgId: 1, masses, params, interactive: false },
    () => false
  );
  check('engine produced lines', result.lineCount > 50, `lines=${result.lineCount}`);
  check('pointCount consistent with counts array', (() => {
    let sum = 0;
    for (let i = 0; i < result.lineCount; i++) sum += result.lineCounts[i];
    return sum === result.pointCount;
  })());
  check('all positions inside extended domain', (() => {
    for (let i = 0; i < result.pointCount; i++) {
      const x = result.positions[i * 2];
      const z = result.positions[i * 2 + 1];
      if (Math.abs(x) > FIELD_HALF + 1 || Math.abs(z) > FIELD_HALF + 1) return false;
    }
    return true;
  })());
  check('magnitudes are finite and non-negative', (() => {
    for (let i = 0; i < result.pointCount; i++) {
      if (!Number.isFinite(result.magnitudes[i]) || result.magnitudes[i] < 0) return false;
    }
    return true;
  })());
  check('line offsets in range', (() => {
    for (let i = 0; i < result.lineCount; i++) {
      if (result.lineStarts[i] + result.lineCounts[i] > result.pointCount) return false;
    }
    return true;
  })());
}

// 5. Cap enforcement: extreme density stays at or below 20000 lines.
{
  const masses: MassPoint[] = [{ id: 1, x: 0, z: 0, mass: 100 }];
  const params: StreamParams = {
    seedDensity: 40,
    stepSize: 0.2,
    maxLength: 20,
    direction: 'forward'
  };
  const result = computeStreamlines(
    { msgId: 2, masses, params, interactive: true },
    () => false
  );
  check('line cap 20000 respected', result.lineCount <= 20000, `lines=${result.lineCount}`);
  check('truncated flag set when budget hit', result.lineCount >= 19000 ? result.truncated : true);
}

// 6. Backward direction traces away from a single mass.
{
  const masses: MassPoint[] = [{ id: 1, x: 0, z: 0, mass: 100 }];
  const params: StreamParams = {
    seedDensity: 0.5,
    stepSize: 0.1,
    maxLength: 30,
    direction: 'backward'
  };
  const result = computeStreamlines(
    { msgId: 3, masses, params, interactive: false },
    () => false
  );
  check('backward run produced lines', result.lineCount > 0);
  // first point of each line should generally be farther from origin than last
  let outward = 0;
  for (let i = 0; i < result.lineCount; i++) {
    const s = result.lineStarts[i];
    const e = s + result.lineCounts[i] - 1;
    const r0 = Math.hypot(result.positions[s * 2], result.positions[s * 2 + 1]);
    const r1 = Math.hypot(result.positions[e * 2], result.positions[e * 2 + 1]);
    if (r1 > r0) outward++;
  }
  check('most backward traces move outward', outward > result.lineCount * 0.7, `${outward}/${result.lineCount}`);
}

console.log(failures === 0 ? '\nALL SMOKE TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
