/* Node 端几何冒烟测试：数值有效性、法线朝向、索引范围、每帧耗时 */
import { CanopyModel } from '../src/geometry/canopy';
import { DEFAULT_KITE_PARAMS, DEFAULT_WIND, SPAN_SEGMENTS, CHORD_SEGMENTS } from '../src/types';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

const model = new CanopyModel();
const params = { ...DEFAULT_KITE_PARAMS, twistStations: [...DEFAULT_KITE_PARAMS.twistStations] };

console.log('— 默认状态更新 —');
model.update(params, { ...DEFAULT_WIND }, true);

const outer = model.outer;
const pos = outer.attributes.position.array as Float32Array;
const nor = outer.attributes.normal.array as Float32Array;
const col = outer.attributes.color.array as Float32Array;
const idx = outer.index!.array as Uint32Array;

assert(pos.length === (SPAN_SEGMENTS + 1) * (CHORD_SEGMENTS + 1) * 3, '顶点数 = 25×13 = 325');
assert(idx.length === SPAN_SEGMENTS * CHORD_SEGMENTS * 6, '索引数 = 24×12×2 三角形');
assert(pos.every(Number.isFinite), '所有位置有限');
assert(nor.every(Number.isFinite), '所有法线有限');
assert(col.every((v) => v >= 0 && v <= 1), '颜色分量在 0..1');

// 法线归一化
let normOk = true;
for (let i = 0; i < nor.length; i += 3) {
  const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]);
  if (Math.abs(l - 1) > 1e-4) {
    normOk = false;
    break;
  }
}
assert(normOk, '法线全部归一化');

// 索引不越界
const vCount = pos.length / 3;
assert(Array.from(idx).every((i) => i < vCount), '膜面索引不越界');
const fIdx = model.frame.index!.array as Uint32Array;
const fCount = (model.frame.attributes.position.array as Float32Array).length / 3;
assert(Array.from(fIdx).every((i) => i < fCount), '管架索引不越界');

// 法线朝向：中心展向站、弦向中部（上翼面轮廓 s≈0.75）法线应主要朝 +y
const centerI = Math.floor(SPAN_SEGMENTS / 2);
const upperJ = Math.round(CHORD_SEGMENTS * 0.75);
const vi = centerI * (CHORD_SEGMENTS + 1) + upperJ;
assert(nor[vi * 3 + 1] > 0.4, `上翼面法线朝外(+y)，实际 y=${nor[vi * 3 + 1].toFixed(2)}`);
// 下翼面 s≈0.25 法线朝 -y
const lowerJ = Math.round(CHORD_SEGMENTS * 0.25);
const vi2 = centerI * (CHORD_SEGMENTS + 1) + lowerJ;
assert(nor[vi2 * 3 + 1] < -0.4, `下翼面法线朝外(-y)，实际 y=${nor[vi2 * 3 + 1].toFixed(2)}`);

// 拱形：翼尖应低于翼中心（y），且左右对称
const le = Math.floor(CHORD_SEGMENTS / 2);
const rootY = pos[(centerI * (CHORD_SEGMENTS + 1) + le) * 3 + 1];
const tipY = pos[le * 3 + 1];
assert(tipY < rootY - 1, `翼尖低于翼根形成拱形 (根 ${rootY.toFixed(2)} > 尖 ${tipY.toFixed(2)})`);
const leftTipX = pos[le * 3];
const rightTipX = pos[(SPAN_SEGMENTS * (CHORD_SEGMENTS + 1) + le) * 3];
assert(Math.abs(leftTipX + rightTipX) < 1e-4, '左右翼尖关于中轴对称');

console.log('— 风窗极值联动 —');
const calm = { windSpeed: 3, azimuth: 0, elevation: 80 };
const storm = { windSpeed: 28, azimuth: 0, elevation: 15 };
model.update(params, calm, true);
const camberCalm = model.tensionRawMean;
model.update(params, storm, true);
const camberStorm = model.tensionRawMean;
assert(camberStorm > camberCalm, `动力区大风张力高于小风 (${camberStorm.toFixed(3)} > ${camberCalm.toFixed(3)})`);
assert(model.loadLevel > 0.5, `强风载荷系数升高 = ${model.loadLevel.toFixed(2)}`);

// 边缘位置功率接近 0 时仍能正常更新
model.update(params, { windSpeed: 25, azimuth: 89, elevation: 50 }, true);
assert((model.outer.attributes.position.array as Float32Array).every(Number.isFinite), '风窗边缘位置数值有效');

console.log('— 性能（500 次完整更新）—');
const N = 500;
const t0 = performance.now();
for (let k = 0; k < N; k++) {
  const w = { windSpeed: 8 + (k % 20), azimuth: ((k * 7) % 180) - 90, elevation: 15 + ((k * 13) % 65) };
  model.update(params, w, true);
}
const avg = (performance.now() - t0) / N;
console.log(`  平均每帧几何+法线+张力耗时: ${avg.toFixed(3)} ms（60fps 预算 16.6ms）`);
assert(avg < 4, `每帧耗时低于 4ms，实际 ${avg.toFixed(2)}ms`);

model.dispose();
console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
