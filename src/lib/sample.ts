import type { TrajectoryKey } from "./types";

/**
 * 内置示例:一次风筝冲浪腾空(起跳 -> 升空转向 -> 顶点 -> 回转落地)。
 * 30fps,关键点间隔 8~12 帧,烘焙后约 100 帧;也可用于性能压测复制扩展。
 */
export function sampleTrajectory(): TrajectoryKey[] {
  return [
    { frame: 0, height: 0.0, distance: 0.0, lateral: 0.0, kiteHeading: 0.0 },
    { frame: 8, height: 1.2, distance: 3.5, lateral: 0.3, kiteHeading: 0.15 },
    { frame: 18, height: 3.6, distance: 7.5, lateral: 1.4, kiteHeading: 0.45 },
    { frame: 28, height: 5.8, distance: 11.0, lateral: 2.6, kiteHeading: 0.7 },
    { frame: 38, height: 7.0, distance: 13.5, lateral: 3.0, kiteHeading: 0.55 },
    { frame: 48, height: 6.5, distance: 15.5, lateral: 2.2, kiteHeading: 0.1 },
    { frame: 58, height: 4.8, distance: 18.0, lateral: 0.8, kiteHeading: -0.35 },
    { frame: 68, height: 2.6, distance: 21.0, lateral: -0.2, kiteHeading: -0.25 },
    { frame: 78, height: 0.8, distance: 24.0, lateral: -0.1, kiteHeading: -0.05 },
    { frame: 88, height: 0.0, distance: 26.5, lateral: 0.0, kiteHeading: 0.0 },
  ];
}

/** 生成上千帧的长轨迹用于流畅度压测 */
export function stressTrajectory(frameCount = 1200): TrajectoryKey[] {
  const keys: TrajectoryKey[] = [];
  const step = 12;
  for (let f = 0; f <= frameCount; f += step) {
    const u = f / frameCount;
    keys.push({
      frame: f,
      height: 4 + 4 * Math.sin(u * Math.PI * 3) * Math.sin(u * Math.PI),
      distance: 30 * u,
      lateral: 3 * Math.sin(u * Math.PI * 2),
      kiteHeading: 0.8 * Math.sin(u * Math.PI * 4),
    });
  }
  return keys;
}
