import type { JointConfig, Keyframe } from '../types';
import { GEAR_SHARPNESS } from '../constants';

/** 线性插值 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * 依据关键帧求关节在归一化时间 t(0..1)处的角度。
 * 关键帧之间线性插值;档位通过对段内进度做幂次变换体现快慢:
 *   slow  → 缓入缓出明显(幂 < 1,起步慢)
 *   fast  → 快速到位(幂 > 1,前期快速推进)
 */
export function angleAt(joint: JointConfig, t: number): number {
  if (!joint.enabled || joint.keyframes.length === 0) return 0;
  const kf = joint.keyframes;
  const tt = clamp(t, 0, 1);

  let first = kf[0];
  if (tt <= first.t) return first.angle;
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i];
    const b = kf[i + 1];
    if (tt >= a.t && tt <= b.t) {
      const span = b.t - a.t;
      const raw = span === 0 ? 1 : (tt - a.t) / span;
      const sharp = GEAR_SHARPNESS[joint.gear];
      // 幂次曲线:sharp<1 慢速缓启,sharp>1 快速突进
      const eased = Math.pow(raw, sharp);
      return lerp(a.angle, b.angle, eased) * joint.direction;
    }
  }
  return kf[kf.length - 1].angle * joint.direction;
}

/** 生成默认两段关键帧(合拢 0° → 拆卸 travel°) */
export function defaultKeyframes(travel: number): Keyframe[] {
  return [
    { t: 0, angle: 0 },
    { t: 1, angle: travel },
  ];
}

/** 角度限制到 0..90 */
export function clampTravel(v: number): number {
  return clamp(Math.round(v * 10) / 10, 0, 90);
}
