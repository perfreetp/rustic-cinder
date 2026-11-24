/** 标量与角度插值工具 */

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** 最短弧角度插值(处理 ±π 跳变) */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * 向心 Catmull-Rom —— 经过全部控制点且不会像均匀参数化那样产生过冲/环。
 * 边界用端点外推一个幻影点。
 */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** 两帧之间的双端缓动权重(用于姿态关键帧间平滑) */
export function easeInOut(t: number): number {
  return smoothstep(clamp(t, 0, 1));
}

/** 角度归一化到 [-π, π) */
export function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r >= Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}
