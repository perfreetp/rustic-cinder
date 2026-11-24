/**
 * Small 2D/3D math library for the folder.
 *
 * Matrices are column-major, stored as plain `number[16]` or `number[9]` arrays,
 * matching the memory layout WGSL / GLSL expect, so they can be uploaded to the
 * GPU without transposition.
 *
 * Convention: right-handed, +Y up, camera looks down -Z in view space.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Mat3 = number[];
export type Mat4 = number[];

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite smoothstep on a normalised parameter. */
export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale2 = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length2 = (a: Vec2): number => Math.hypot(a.x, a.y);

export function normalize2(a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y);
  if (len < 1e-12) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

/** Rotate `a` by `angle` radians (counter-clockwise in a +Y-up frame). */
export function rotate2(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Shortest distance from `p` to the infinite line through `a` with unit direction `d`. */
export function distanceToLine(p: Vec2, a: Vec2, d: Vec2): number {
  return Math.abs(cross2(d, sub2(p, a)));
}

/** Signed area of a triangle; positive when wound counter-clockwise. */
export function triArea2(a: Vec2, b: Vec2, c: Vec2): number {
  return 0.5 * cross2(sub2(b, a), sub2(c, a));
}

// ---------------------------------------------------------------------------
// 3D vectors
// ---------------------------------------------------------------------------

export const add3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
export const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export function normalize3(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z);
  if (len < 1e-12) return { x: 0, y: 0, z: 1 };
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

// ---------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------

export function mat3Identity(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Column-major 4x4 product `a * b`. */
export function mat4Mul(a: Mat4, b: Mat4, out: Mat4 = new Array<number>(16)): Mat4 {
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function mat4FromMat3(m: Mat3, out: Mat4 = new Array<number>(16)): Mat4 {
  out[0] = m[0];
  out[1] = m[1];
  out[2] = m[2];
  out[3] = 0;
  out[4] = m[3];
  out[5] = m[4];
  out[6] = m[5];
  out[7] = 0;
  out[8] = m[6];
  out[9] = m[7];
  out[10] = m[8];
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}

export function mat4Translation(x: number, y: number, z: number): Mat4 {
  const m = mat4Identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

/** Apply a column-major 4x4 to the point (x, y, z, 1). */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
  const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
  const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
  const inv = Math.abs(w) > 1e-12 ? 1 / w : 1;
  return { x: x * inv, y: y * inv, z: z * inv };
}

/** Upper-left 3x3 of `m`, useful for carrying a rotation without translation. */
export function mat3FromMat4(m: Mat4): Mat3 {
  return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
}

export function mat3Mul(a: Mat3, b: Mat3, out: Mat3 = new Array<number>(9)): Mat3 {
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] =
        a[row] * b[col * 3] +
        a[3 + row] * b[col * 3 + 1] +
        a[6 + row] * b[col * 3 + 2];
    }
  }
  return out;
}

/** Orthonormal rotation about an arbitrary unit axis. */
export function mat3Rotation(axis: Vec3, angle: number): Mat3 {
  const { x, y, z } = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,

    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,

    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
  ];
}

/** Rotation by `angle` radians about the X axis. */
export function mat3RotationX(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

/** Rotation by `angle` radians about the Y axis. */
export function mat3RotationY(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}

export function mat3TransformVec(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[3] * v.y + m[6] * v.z,
    y: m[1] * v.x + m[4] * v.y + m[7] * v.z,
    z: m[2] * v.x + m[5] * v.y + m[8] * v.z,
  };
}

/**
 * Right-handed perspective projection (WebGPU depth range 0..1, OpenGL-style
 * clip space with -w <= x,y,z <= w).
 */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * nf, -1,
    0, 0, far * near * nf, 0,
  ];
}

/** Orthographic projection (right-handed, depth 0..1). */
export function orthographic(
  halfHeight: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  const h = Math.max(1e-4, halfHeight);
  const w = h * aspect;
  const nf = 1 / (near - far);
  return [
    1 / w, 0, 0, 0,
    0, 1 / h, 0, 0,
    0, 0, nf, 0,
    0, 0, near * nf, 1,
  ];
}

export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const zx = eye.x - center.x;
  const zy = eye.y - center.y;
  const zz = eye.z - center.z;
  let len = Math.hypot(zx, zy, zz) || 1;
  const fz = { x: zx / len, y: zy / len, z: zz / len };

  let xx = up.y * fz.z - up.z * fz.y;
  let xy = up.z * fz.x - up.x * fz.z;
  let xz = up.x * fz.y - up.y * fz.x;
  len = Math.hypot(xx, xy, xz) || 1;
  const fx = { x: xx / len, y: xy / len, z: xz / len };

  const fy = {
    x: fz.y * fx.z - fz.z * fx.y,
    y: fz.z * fx.x - fz.x * fx.z,
    z: fz.x * fx.y - fz.y * fx.x,
  };

  return [
    fx.x, fy.x, fz.x, 0,
    fx.y, fy.y, fz.y, 0,
    fx.z, fy.z, fz.z, 0,
    -dot3(fx, eye), -dot3(fy, eye), -dot3(fz, eye), 1,
  ];
}

/** General 4x4 inverse; returns identity when singular. */
export function invert4(m: Mat4, out: Mat4 = new Array<number>(16)): Mat4 {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-14) {
    return mat4Identity().slice();
  }
  det = 1 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/** Project a world point through the view-projection, returning NDC and depth. */
export function projectPoint(vp: Mat4, p: Vec3): { x: number; y: number; z: number; w: number } {
  const x = vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12];
  const y = vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13];
  const z = vp[2] * p.x + vp[6] * p.y + vp[10] * p.z + vp[14];
  const w = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
  return { x, y, z, w };
}
