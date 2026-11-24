/** 逻辑层冒烟测试:node --experimental-strip-types 直接跑 TS */
import assert from "node:assert";
import { bakeFrames, insertTrajectoryKey, upsertPoseKey } from "../src/lib/interpolation";
import { exportProject, parseProject, parseTrajectoryInput } from "../src/lib/io";
import { sampleTrajectory, stressTrajectory } from "../src/lib/sample";
import { lerpAngle } from "../src/lib/math";

let pass = 0;
const ok = (name: string) => {
  pass++;
  console.log(`  ✓ ${name}`);
};

// 1. 基础烘焙
const keys = sampleTrajectory();
const table = bakeFrames(keys, [], 30);
assert.equal(table.frameCount, 89, "帧号 0..88 -> 89 帧");
ok("烘焙帧数 = 末关键帧+1");

// 关键点值精确落在烘焙表上
const k0 = keys[0];
assert.ok(Math.abs(table.pos[k0.frame * 3 + 1] - k0.height) < 1e-5, "关键点高度应精确命中");
ok("Catmull-Rom 经过所有关键点(无偏差)");

// 2. 中间插值合理且不过冲
const midH = table.pos[43 * 3 + 1];
assert.ok(midH > 6.4 && midH < 7.1, `中间帧高度 ${midH} 应在两端点之间`);
ok("相邻点间高度插值在合理区间");

// 3. 角度最短弧插值
const a = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
assert.ok(Math.abs(Math.abs(a) - Math.PI) < 0.11, "跨 ±π 应走最短弧");
ok("伞翼朝向走最短弧,不出现 2π 反转");

// 4. 自动姿态:顶点收腿、两端伸展
const apexIdx = table.tuck.indexOf(Math.max(...table.tuck));
assert.ok(apexIdx > 20 && apexIdx < 70, `收腿峰值应在腾空中段,实际帧 ${apexIdx}`);
assert.ok(table.tuck[0] < 0.05 && table.tuck[88] < 0.05, "首尾应收腿为 0");
ok("自动姿态:顶点团身、起跳/落地伸展");

// 5. 任意帧插入姿态关键帧后前后重新插值(局部覆盖自动姿态,两端淡出)
const withPose = upsertPoseKey([], { frame: 44, tuck: 1, torsoPitch: 0.2, torsoRoll: 0, armSpread: 1, armReach: 0.4 });
const t2 = bakeFrames(keys, withPose, 30);
assert.equal(t2.tuck[44], 1, "关键帧本帧应精确为 1");
assert.ok(t2.tuck[20] < 0.99, "淡出范围外应回落到自动姿态");
assert.ok(Math.abs(t2.tuck[0] - table.tuck[0]) < 1e-6, "起点未受关键帧影响");
assert.ok(t2.tuck[40] > table.tuck[40], "关键帧前方应处于向关键帧的过渡中");
assert.ok(t2.tuck[60] < 1 && t2.tuck[60] > table.tuck[60] - 1e-9, "关键帧后方应平滑淡出");
ok("姿态关键帧局部覆盖,前后帧 smoothstep 过渡、远处回到自动姿态");
// 同帧覆盖
const withPose2 = upsertPoseKey(withPose, { frame: 44, tuck: 0.3, torsoPitch: 0, torsoRoll: 0, armSpread: 1, armReach: 0.4 });
assert.equal(withPose2.length, 1);
assert.equal(withPose2[0].tuck, 0.3);
ok("同帧插入为覆盖语义");

// 6. 任意帧插入轨迹关键点,取当前插值值;原关键点保持精确命中
const before = Float32Array.from(table.pos);
const newKeys = insertTrajectoryKey(keys, 43, table);
assert.equal(newKeys.length, keys.length + 1);
assert.equal(newKeys.find((k) => k.frame === 43)?.height, before[43 * 3 + 1], "新点取烘焙插值值");
const t3 = bakeFrames(newKeys, [], 30);
for (const k of keys) {
  assert.ok(Math.abs(t3.pos[k.frame * 3 + 1] - k.height) < 1e-5, "原关键点高度仍精确命中");
  assert.ok(Math.abs(t3.pos[k.frame * 3] - k.distance) < 1e-5, "原关键点位移仍精确命中");
}
let maxDiff = 0;
for (let i = 0; i < before.length; i++) maxDiff = Math.max(maxDiff, Math.abs(before[i] - t3.pos[i]));
assert.ok(maxDiff < 0.12, `样条重分段后整体偏差应可控,实际 ${maxDiff.toFixed(3)}m`);
ok(`时间轴补轨迹点:新点取插值值、原关键点全部保持命中(整体偏差 ${(maxDiff * 100).toFixed(0)}cm)`);

// 7. 工程文件往返
const json = exportProject(keys, withPose, 30);
const proj = parseProject(json);
assert.equal(proj.trajectoryKeys.length, keys.length);
assert.equal(proj.poseKeys.length, 1);
assert.equal(proj.fps, 30);
const t4 = bakeFrames(proj.trajectoryKeys, proj.poseKeys, proj.fps);
assert.deepEqual(Array.from(t4.pos), Array.from(table.pos));
ok("导出 -> 重新导入后烘焙结果一致,可继续编辑");

// 8. 裸 JSON 与 CSV 导入
const bare = parseTrajectoryInput(JSON.stringify([
  { frame: 0, height: 0, distance: 0, lateral: 0, kiteHeading: 0 },
  { frame: 10, height: 2, distance: 4, lateral: 1, kiteHeading: 0.5 },
]));
assert.equal(bare.trajectoryKeys.length, 2);
const csv = parseTrajectoryInput(
  ["frame,height,distance,lateral,kiteHeading", "0,0,0,0,0", "10,2,4,1,30", ""].join("\n"),
);
assert.equal(csv.trajectoryKeys[1].height, 2);
ok("支持裸 JSON 与 CSV 两种轨迹导入格式");

// 9. 长轨迹性能:1200 帧烘焙耗时与表结构
const longKeys = stressTrajectory(1200);
const t0 = performance.now();
const long = bakeFrames(longKeys, [], 30);
const ms = performance.now() - t0;
assert.ok(long.frameCount >= 1200);
assert.ok(long.pos instanceof Float32Array && long.tuck instanceof Float32Array);
assert.ok(ms < 200, `1200 帧烘焙应 <200ms,实际 ${ms.toFixed(1)}ms`);
ok(`1200 帧烘焙耗时 ${ms.toFixed(1)}ms,TypedArray 单帧查找 O(1)`);

// 10. 单帧定位是纯下标访问 —— 验证 10 万次随机取帧耗时
const t1 = performance.now();
let acc = 0;
for (let i = 0; i < 100000; i++) {
  const f = (i * 37) % long.frameCount;
  acc += long.pos[f * 3 + 1] + long.tuck[f];
}
const seekMs = performance.now() - t1;
assert.ok(seekMs < 100, `10 万次帧定位应 <100ms,实际 ${seekMs.toFixed(1)}ms`);
ok(`10 万次随机帧定位 ${seekMs.toFixed(1)}ms(拖动播放头零压力),acc=${acc.toFixed(0)}`);

console.log(`\n全部 ${pass} 项逻辑测试通过 ✔`);
