import { Vector3 } from "@babylonjs/core";

export interface IKResult {
  elbow: Vector3;
  hand: Vector3;
  upperDir: Vector3;
  foreDir: Vector3;
}

const tmp = {
  toTarget: new Vector3(),
  pole: new Vector3(),
  elbowDir: new Vector3(),
};

/**
 * 两轴解析 IK:给定肩/髋起点、手部目标点和两段骨骼长度,
 * 用极向量决定肘/膝弯曲平面,返回肘关节位置与两段骨骼朝向。
 * 目标超出可达范围时自动钳制到最大臂展。
 */
export function twoBoneIK(
  origin: Vector3,
  target: Vector3,
  l1: number,
  l2: number,
  poleHint: Vector3,
  out: IKResult,
): IKResult {
  const maxReach = l1 + l2 - 0.001;
  target.subtractToRef(origin, tmp.toTarget);
  let d = tmp.toTarget.length();
  if (d < 0.0001) d = 0.0001;

  const dir0 = tmp.toTarget.scale(1 / d);
  const clampedD = Math.min(d, maxReach);

  // 余弦定理求肩角与肘角
  const cosShoulder = clampValue((l1 * l1 + clampedD * clampedD - l2 * l2) / (2 * l1 * clampedD), -1, 1);
  const shoulderAngle = Math.acos(cosShoulder);

  // 极向量投影到与 dir0 垂直的平面
  Vector3.CrossToRef(dir0, poleHint, tmp.pole);
  if (tmp.pole.lengthSquared() < 1e-8) {
    // 极向量与骨骼平行时的兜底垂直轴
    const fallback = Math.abs(dir0.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    Vector3.CrossToRef(dir0, fallback, tmp.pole);
  }
  tmp.pole.normalize();
  Vector3.CrossToRef(tmp.pole, dir0, tmp.elbowDir); // 垂直平面内的第二轴
  tmp.elbowDir.normalize();

  // elbowDir = dir0 绕 pole 轴转 shoulderAngle
  const upper = out.upperDir;
  upper.copyFrom(dir0).scaleInPlace(Math.cos(shoulderAngle));
  upper.addInPlace(tmp.elbowDir.scale(Math.sin(shoulderAngle)));
  upper.normalize();

  out.elbow.copyFrom(origin).addInPlace(upper.scale(l1));

  // 实际手部点:超出臂展时沿方向钳制
  if (d > maxReach) {
    out.hand.copyFrom(origin).addInPlace(dir0.scale(maxReach));
  } else {
    out.hand.copyFrom(target);
  }
  out.hand.subtractToRef(out.elbow, out.foreDir);
  out.foreDir.normalize();
  return out;
}

function clampValue(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
