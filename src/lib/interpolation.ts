import {
  catmullRom,
  clamp,
  easeInOut,
  lerp,
  lerpAngle,
  normalizeAngle,
} from "./math";
import {
  DEFAULT_POSE,
  type FrameTable,
  type PoseKey,
  type TrajectoryKey,
} from "./types";

/** 把关键点烘焙成逐帧 TypedArray:一次 O(N) 计算,之后任意帧拖动都是 O(1) */
export function bakeFrames(
  trajKeys: TrajectoryKey[],
  poseKeys: PoseKey[],
  fps: number,
): FrameTable {
  const sorted = [...trajKeys].sort((a, b) => a.frame - b.frame);
  if (sorted.length === 0) {
    return emptyTable(1);
  }
  const frameCount = Math.max(1, sorted[sorted.length - 1].frame + 1);
  const pos = new Float32Array(frameCount * 3);
  const heading = new Float32Array(frameCount);
  const tuck = new Float32Array(frameCount);
  const torsoPitch = new Float32Array(frameCount);
  const torsoRoll = new Float32Array(frameCount);
  const armSpread = new Float32Array(frameCount);
  const armReach = new Float32Array(frameCount);
  const hasPose = new Uint8Array(frameCount);

  // ---- 轨迹:向心 Catmull-Rom 插值位置,最短弧插值朝向 ----
  const n = sorted.length;
  const at = (i: number): TrajectoryKey => sorted[clamp(i, 0, n - 1)];

  for (let f = 0; f < frameCount; f++) {
    // 找到 f 落在哪两个关键点之间
    let i = 0;
    while (i < n - 1 && at(i + 1).frame <= f) i++;
    const k0 = at(i);
    const k1 = at(i + 1);
    const span = Math.max(1, k1.frame - k0.frame);
    const t = clamp((f - k0.frame) / span, 0, 1);

    const km = at(i - 1);
    const kp = at(i + 2);
    pos[f * 3] = catmullRom(km.distance, k0.distance, k1.distance, kp.distance, t);
    pos[f * 3 + 1] = catmullRom(km.height, k0.height, k1.height, kp.height, t);
    pos[f * 3 + 2] = catmullRom(km.lateral, k0.lateral, k1.lateral, kp.lateral, t);
    heading[f] = normalizeAngle(lerpAngle(k0.kiteHeading, k1.kiteHeading, t));
  }

  // ---- 姿态:姿态关键帧之间 smoothstep 插值;两端向自动姿态平滑淡出 ----
  const poses = [...poseKeys].sort((a, b) => a.frame - b.frame);
  const auto = autoPoseTable(sorted, frameCount);

  for (let f = 0; f < frameCount; f++) {
    hasPose[f] = poses.length > 0 ? 1 : 0;
    if (poses.length === 0) {
      tuck[f] = auto.tuck[f];
      torsoPitch[f] = auto.torsoPitch[f];
      torsoRoll[f] = auto.torsoRoll[f];
      armSpread[f] = auto.armSpread[f];
      armReach[f] = auto.armReach[f];
      continue;
    }

    const sampled = samplePoseKeys(poses, f);
    // 权重:两关键帧之间完全由关键帧控制;首尾关键帧之外按距离淡出回自动姿态
    let w = 1;
    const first = poses[0];
    const last = poses[poses.length - 1];
    const fade = 14; // 淡出帧数
    if (f < first.frame) w = easeInOut(Math.max(0, (fade - (first.frame - f)) / fade));
    else if (f > last.frame) w = easeInOut(Math.max(0, (fade - (f - last.frame)) / fade));

    tuck[f] = lerp(auto.tuck[f], sampled.tuck, w);
    torsoPitch[f] = lerpAngle(auto.torsoPitch[f], sampled.torsoPitch, w);
    torsoRoll[f] = lerpAngle(auto.torsoRoll[f], sampled.torsoRoll, w);
    armSpread[f] = lerp(auto.armSpread[f], sampled.armSpread, w);
    armReach[f] = lerp(auto.armReach[f], sampled.armReach, w);
  }

  return {
    frameCount,
    pos,
    heading,
    tuck,
    torsoPitch,
    torsoRoll,
    armSpread,
    armReach,
    hasPose,
  };
}

/**
 * 自动姿态:按腾空阶段(起跳 -> 上升收腿 -> 顶点团身 -> 下落伸展 -> 落地)
 * 生成收腿/俯仰曲线。姿态关键帧在其淡出范围之外保留这套自动值。
 */
function autoPoseTable(traj: TrajectoryKey[], frameCount: number) {
  const tuck = new Float32Array(frameCount);
  const torsoPitch = new Float32Array(frameCount);
  const torsoRoll = new Float32Array(frameCount);
  const armSpread = new Float32Array(frameCount);
  const armReach = new Float32Array(frameCount);

  for (let f = 0; f < frameCount; f++) {
    const u = frameCount <= 1 ? 0 : f / (frameCount - 1);
    // 收腿:两端 0,顶点附近接近 1(钟形曲线)
    const bell = Math.sin(Math.PI * clamp(u, 0, 1));
    tuck[f] = bell * bell * 0.85;
    // 躯干:起跳前俯、顶点后仰、落地回正
    torsoPitch[f] = 0.35 * Math.cos(Math.PI * u) * (1 - 0.4 * bell);
    torsoRoll[f] = 0;
    armSpread[f] = lerp(1.05, 0.9, bell);
    armReach[f] = lerp(DEFAULT_POSE.armReach, 0.38, bell);
  }
  void traj;
  return { tuck, torsoPitch, torsoRoll, armSpread, armReach };
}

/** 在姿态关键帧序列上采样某一帧:帧间 smoothstep,区间外取端点值 */
function samplePoseKeys(
  poses: PoseKey[],
  f: number,
): Omit<PoseKey, "frame"> {
  if (f <= poses[0].frame) {
    const { frame: _frame, ...v } = poses[0];
    return v;
  }
  const last = poses[poses.length - 1];
  if (f >= last.frame) {
    const { frame: _frame, ...v } = last;
    return v;
  }
  let i = 0;
  while (i < poses.length - 1 && poses[i + 1].frame <= f) i++;
  const a = poses[i];
  const b = poses[i + 1];
  const t = easeInOut((f - a.frame) / Math.max(1, b.frame - a.frame));
  return {
    tuck: lerp(a.tuck, b.tuck, t),
    torsoPitch: lerpAngle(a.torsoPitch, b.torsoPitch, t),
    torsoRoll: lerpAngle(a.torsoRoll, b.torsoRoll, t),
    armSpread: lerp(a.armSpread, b.armSpread, t),
    armReach: lerp(a.armReach, b.armReach, t),
  };
}

function emptyTable(frameCount: number): FrameTable {
  return {
    frameCount,
    pos: new Float32Array(frameCount * 3),
    heading: new Float32Array(frameCount),
    tuck: new Float32Array(frameCount),
    torsoPitch: new Float32Array(frameCount),
    torsoRoll: new Float32Array(frameCount),
    armSpread: new Float32Array(frameCount),
    armReach: new Float32Array(frameCount),
    hasPose: new Uint8Array(frameCount),
  };
}

/** 在指定帧插入/覆盖一个姿态关键帧,并让前后帧重新插值(返回新数组) */
export function upsertPoseKey(keys: PoseKey[], key: PoseKey): PoseKey[] {
  const next = keys.filter((k) => k.frame !== key.frame);
  next.push({ ...key });
  return next.sort((a, b) => a.frame - b.frame);
}

/** 在指定帧插入轨迹关键点(取当前烘焙值),用于时间轴上补点 */
export function insertTrajectoryKey(
  keys: TrajectoryKey[],
  frame: number,
  table: FrameTable,
): TrajectoryKey[] {
  if (keys.some((k) => k.frame === frame)) return keys;
  const f = clamp(frame, 0, table.frameCount - 1);
  const next: TrajectoryKey[] = [
    ...keys,
    {
      frame,
      height: table.pos[f * 3 + 1],
      distance: table.pos[f * 3],
      lateral: table.pos[f * 3 + 2],
      kiteHeading: table.heading[f],
    },
  ];
  return next.sort((a, b) => a.frame - b.frame);
}
