import type { CurveSample2D } from './spline.ts';

/**
 * 回转曲面：母线 (r(s), z(s)) 绕 Y 轴旋转生成。
 * s 为母线弧长，θ 为方位角。提供曲面上任意 (s, θ) 处的
 * 位置 P、外法向 N、母线切向 Ts 与周向切向 Eθ（均为单位向量）。
 * 向量以三元组 [x, y, z] 存储，y 为高度轴。
 */
export class SurfaceOfRevolution {
  readonly samples: CurveSample2D[];
  readonly length: number;
  readonly height: number;
  readonly maxRadius: number;
  private readonly invDs: number;

  constructor(samples: CurveSample2D[]) {
    this.samples = samples;
    this.length = samples[samples.length - 1].s;
    this.invDs = (samples.length - 1) / this.length;
    let h = 0, rMax = 0;
    for (const p of samples) {
      h = Math.max(h, p.z);
      rMax = Math.max(rMax, p.r);
    }
    this.height = h;
    this.maxRadius = rMax;
  }

  /** 按弧长 s 线性插值取母线样本（含切向量） */
  sampleAt(s: number): CurveSample2D {
    const x = Math.min(Math.max(s, 0), this.length) * this.invDs;
    const i = Math.min(Math.floor(x), this.samples.length - 2);
    const f = x - i;
    const a = this.samples[i];
    const b = this.samples[i + 1];
    return {
      r: a.r + (b.r - a.r) * f,
      z: a.z + (b.z - a.z) * f,
      tr: a.tr + (b.tr - a.tr) * f,
      tz: a.tz + (b.tz - a.tz) * f,
      s,
    };
  }

  /** ∫ ds / r(s)，螺旋方位角积分的核（梯形法） */
  integrateInvRadius(): number {
    let acc = 0;
    const p = this.samples;
    for (let i = 1; i < p.length; i++) {
      const rm = 0.5 * (p[i].r + p[i - 1].r) || 1e-6;
      acc += (p[i].s - p[i - 1].s) / rm;
    }
    return acc;
  }

  /** 母线中点半径，用于自动覆盖估算 */
  midRadius(): number {
    return this.sampleAt(this.length * 0.5).r;
  }

  /**
   * 曲面活动标架。
   * 母线外法向（rz 平面）= (tz, -tr)，旋转后：
   * N = (tz·cosθ, -tr, tz·sinθ)
   */
  frame(s: number, theta: number) {
    const q = this.sampleAt(s);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const P: [number, number, number] = [q.r * cos, q.z, q.r * sin];
    const N: [number, number, number] = [q.tz * cos, -q.tr, q.tz * sin];
    const Ts: [number, number, number] = [q.tr * cos, q.tz, q.tr * sin];
    const Etheta: [number, number, number] = [-sin, 0, cos];
    return { P, N, Ts, Etheta, q };
  }
}

/** 三维向量小工具（worker 内不能依赖 three） */
export const v3 = {
  add(a: number[], b: number[], out: number[]): number[] {
    out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2];
    return out;
  },
  scale(a: number[], k: number, out: number[]): number[] {
    out[0] = a[0] * k; out[1] = a[1] * k; out[2] = a[2] * k;
    return out;
  },
  /** a × b */
  cross(ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number] {
    return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  },
  normalize(x: number, y: number, z: number): [number, number, number] {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  },
};
