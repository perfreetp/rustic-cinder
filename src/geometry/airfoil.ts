// 参数化翼型截面：NACA 四位数风格的拱弧线 + 厚度分布
// 截面局部坐标：x ∈ [0,1] 为弦向（前缘 0 → 后缘 1），y 为厚度方向

export interface SectionPoint {
  x: number;
  y: number;
}

/**
 * 拱弧线（camber line）纵坐标
 * @param xc 弦向归一化位置 0..1
 * @param m  最大拱度（弦长比例）
 * @param p  最大拱度位置（弦长比例）
 */
export function camberLine(xc: number, m: number, p: number): number {
  if (m <= 1e-5) return 0;
  if (xc <= p) {
    return (m / (p * p)) * (2 * p * xc - xc * xc);
  }
  const q = 1 - p;
  return (m / (q * q)) * (1 - 2 * p + 2 * p * xc - xc * xc);
}

/** 拱弧线斜率（用于厚度方向的倾斜） */
export function camberSlope(xc: number, m: number, p: number): number {
  if (m <= 1e-5) return 0;
  if (xc <= p) {
    return (2 * m / (p * p)) * (p - xc);
  }
  const q = 1 - p;
  return (2 * m / (q * q)) * (p - xc);
}

/** NACA 标准厚度分布（闭合后缘） */
export function thicknessAt(xc: number, t: number): number {
  return (
    5 *
    t *
    (0.2969 * Math.sqrt(Math.max(xc, 0)) -
      0.126 * xc -
      0.3516 * xc * xc +
      0.2843 * xc * xc * xc -
      0.1015 * xc * xc * xc * xc)
  );
}

/**
 * 翼型轮廓点：s ∈ [0,1] 沿闭合轮廓一周
 * s=0 下表面后缘 → s=0.5 前缘 → s=1 上表面后缘
 * 弦向共 CHORD_SEGMENTS(12) 段、13 个轮廓点
 */
export function contourPoint(s: number, m: number, p: number, t: number): SectionPoint {
  let xc: number;
  let upper: boolean;
  if (s <= 0.5) {
    xc = 1 - 2 * s; // 1 → 0
    upper = false;
  } else {
    xc = 2 * s - 1; // 0 → 1
    upper = true;
  }
  const zc = camberLine(xc, m, p);
  const yt = thicknessAt(xc, t);
  const dy = camberSlope(xc, m, p);
  const theta = Math.atan(dy);
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  if (upper) {
    return { x: xc - yt * sin, y: zc + yt * cos };
  }
  return { x: xc + yt * sin, y: zc - yt * cos };
}

/**
 * 展向扭转插值：5 个控制点（根→尖），v ∈ [0,1] 为归一化展向位置
 */
export function interpTwist(
  stations: readonly [number, number, number, number, number],
  v: number,
): number {
  const x = Math.min(Math.max(v, 0), 1) * (stations.length - 1);
  const i = Math.min(Math.floor(x), stations.length - 2);
  const f = x - i;
  return stations[i] * (1 - f) + stations[i + 1] * f;
}
