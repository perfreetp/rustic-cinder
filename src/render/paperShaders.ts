/**
 * Paper shaders.
 *
 * The sheet is one indexed mesh of the folded faces. Lighting is per-pixel on
 * the interpolated face normal, so brightness follows the actual folded
 * orientation every frame, and crease seams come from a small sheet-space
 * crease texture (drawn once per topology change) sampled with the same UV the
 * paper uses.
 *
 * Material model:
 *  - fibrous diffuse: tint × key-light N·L with wrap ambient,
 *  - procedural fibre grain (two noise octaves) as a height field,
 *  - three translucency grades: opaque / translucent / vellum, where the last
 *    two add back-light transmission through the sheet,
 *  - a subtle back-side colour shift, because origami paper reads differently
 *    from its reverse.
 *
 * WGSL is used on WebGPU; the GLSL twin keeps the page usable on WebGL.
 */

export const PAPER_WGSL = /* wgsl */ `
struct Camera {
  uViewProj: mat4x4<f32>,
  uEye: vec4<f32>,
  uLightDir: vec4<f32>,
  uLightColor: vec4<f32>,
  uAmbient: vec4<f32>,
  uPaperColor: vec4<f32>,
  uParams: vec4<f32>,   // x: translucency grade 0..2, y: fibre strength, z: crease darkening, w: backlight
  uFade: vec4<f32>,     // x: overall exposure
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var uCreaseTex: texture_2d<f32>;
@group(0) @binding(2) var uCreaseSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) world: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

@vertex
fn mainVS(
  @location(0) aPosition: vec3<f32>,
  @location(1) aNormal: vec3<f32>,
  @location(2) aUv: vec2<f32>,
) -> VSOut {
  var o: VSOut;
  o.pos = cam.uViewProj * vec4<f32>(aPosition, 1.0);
  o.normal = aNormal;
  o.world = aPosition;
  o.uv = aUv;
  return o;
}

fn hash21(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Two-scale fibre field: long strands across the sheet + fine grain.
fn paperFibre(uv: vec2<f32>) -> f32 {
  let strand = vnoise(vec2<f32>(uv.x * 120.0, uv.y * 7.0));
  let cross = vnoise(vec2<f32>(uv.x * 8.0, uv.y * 130.0)) * 0.5;
  let fine = vnoise(uv * vec2<f32>(260.0, 300.0));
  let clump = vnoise(uv * 14.0);
  return clamp(strand * 0.42 + cross * 0.18 + fine * 0.26 + clump * 0.14, 0.0, 1.0);
}

@fragment
fn mainFS(in: VSOut) -> @location(0) vec4<f32> {
  let geoNormal = normalize(in.normal);
  let viewDir = normalize(cam.uEye.xyz - in.world);
  // Double-sided shading: flip the normal toward the viewer.
  let facing = dot(geoNormal, viewDir) >= 0.0;
  var n = select(-geoNormal, geoNormal, facing);

  let L = normalize(cam.uLightDir.xyz);
  let ndl = dot(n, L);
  // Half-Lambert-ish wrap keeps the shadowed side legible without flattening
  // the difference between panels; the squared term deepens the falloff so a
  // panel turning away from the key reads clearly darker.
  let wrap = pow(clamp((ndl + 0.25) / 1.25, 0.0, 1.0), 1.25);

  // Crease texture: red channel = distance-ish field, 1 away from creases.
  let creaseTex = textureSample(uCreaseTex, uCreaseSampler, in.uv).r;
  let seam = clamp(1.0 - creaseTex, 0.0, 1.0);

  let fibre = paperFibre(in.uv);
  let fib = mix(1.0, 0.80 + 0.40 * fibre, cam.uParams.y);

  // Reverse of the sheet: slightly cooler and less bright, so the fold's
  // inside and outside read apart.
  var base = cam.uPaperColor.rgb;
  if (!facing) {
    base = base * vec3<f32>(0.90, 0.935, 0.985);
  }

  let key = cam.uLightColor.rgb * wrap;
  // Ambient sky/ground tint: a little cool from above, warm bounce from below.
  let sky = clamp(n.z * 0.5 + 0.5, 0.0, 1.0);
  let ambient = cam.uAmbient.rgb * (0.52 + 0.55 * sky);
  // Creases: a dark core with a soft lift beside it so folds read as folds.
  let creaseTone = 1.0 - cam.uParams.z * seam * (0.65 + 0.35 * seam);

  var color = base * (key * 1.05 + ambient) * fib * creaseTone;

  // Grade 1/2: back-lit transmission through the paper.
  let grade = cam.uParams.x;
  if (grade > 0.5) {
    let transmit = clamp(-dot(geoNormal, L) * select(-1.0, 1.0, facing), 0.0, 1.0);
    let thickness = 0.55 + 0.45 * fibre;
    let scatter = transmit * (0.60 / max(thickness, 0.35));
    color = color + base * cam.uLightColor.rgb * scatter * 0.50 * cam.uParams.w;

    if (grade > 1.5) {
      color = mix(color, base * 1.04, 0.14);
      let glow = pow(clamp(1.0 - abs(ndl), 0.0, 1.0), 1.6);
      color = color + base * vec3<f32>(1.0, 0.93, 0.80) * glow * 0.20;
    } else {
      color = mix(color, base * 1.01, 0.04);
    }
  }

  // Slight sheen where the key light grazes the paper.
  let H = normalize(L + viewDir);
  color = color + cam.uLightColor.rgb * pow(max(dot(n, H), 0.0), 26.0) * 0.05;

  // Compress highlights, then gamma.
  color = color / (color + vec3<f32>(1.05)) * 1.35;
  color = pow(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));

  return vec4<f32>(color, 1.0);
}
`;

export const PAPER_GLSL_VERT = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vWorld;
out vec2 vUv;
void main() {
  vNormal = aNormal;
  vWorld = aPosition;
  vUv = aUv;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}
`;

export const PAPER_GLSL_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec2 vUv;
uniform vec3 uEye;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uPaperColor;
uniform vec4 uParams;
uniform vec4 uFade;
uniform sampler2D uCreaseTex;
out vec4 fragColor;

float hash21(vec2 p) {
  vec2 q = fract(p * vec2(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float paperFibre(vec2 uv) {
  float strand = vnoise(vec2(uv.x * 120.0, uv.y * 7.0));
  float cross_ = vnoise(vec2(uv.x * 8.0, uv.y * 130.0)) * 0.5;
  float fine = vnoise(uv * vec2(260.0, 300.0));
  float clump = vnoise(uv * 14.0);
  return clamp(strand * 0.42 + cross_ * 0.18 + fine * 0.26 + clump * 0.14, 0.0, 1.0);
}

void main() {
  vec3 geoNormal = normalize(vNormal);
  vec3 viewDir = normalize(uEye - vWorld);
  bool facing = dot(geoNormal, viewDir) >= 0.0;
  vec3 n = facing ? geoNormal : -geoNormal;

  vec3 L = normalize(uLightDir);
  float ndl = dot(n, L);
  float wrap = pow(clamp((ndl + 0.25) / 1.25, 0.0, 1.0), 1.25);

  float creaseTex = texture(uCreaseTex, vUv).r;
  float seam = clamp(1.0 - creaseTex, 0.0, 1.0);

  float fibre = paperFibre(vUv);
  float fib = mix(1.0, 0.80 + 0.40 * fibre, uParams.y);

  vec3 base = uPaperColor;
  if (!facing) base *= vec3(0.90, 0.935, 0.985);

  vec3 key = uLightColor * wrap;
  float sky = clamp(n.z * 0.5 + 0.5, 0.0, 1.0);
  vec3 ambient = uAmbient * (0.52 + 0.55 * sky);
  float creaseTone = 1.0 - uParams.z * seam * (0.65 + 0.35 * seam);

  vec3 color = base * (key * 1.05 + ambient) * fib * creaseTone;

  float grade = uParams.x;
  if (grade > 0.5) {
    float transmit = clamp(-dot(geoNormal, L) * (facing ? 1.0 : -1.0), 0.0, 1.0);
    float thickness = 0.55 + 0.45 * fibre;
    float scatter = transmit * (0.60 / max(thickness, 0.35));
    color += base * uLightColor * scatter * 0.50 * uParams.w;

    if (grade > 1.5) {
      color = mix(color, base * 1.04, 0.14);
      float glow = pow(clamp(1.0 - abs(ndl), 0.0, 1.0), 1.6);
      color += base * vec3(1.0, 0.93, 0.80) * glow * 0.20;
    } else {
      color = mix(color, base * 1.01, 0.04);
    }
  }

  vec3 H = normalize(L + viewDir);
  color += uLightColor * pow(max(dot(n, H), 0.0), 26.0) * 0.05;

  color = color / (color + vec3(1.05)) * 1.35;
  color = pow(clamp(color, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2));

  fragColor = vec4(color, 1.0);
}
`;

/** Background: soft studio gradient with a warm key-side vignette. */
export const BG_WGSL = /* wgsl */ `
struct Bg {
  uRes: vec4<f32>,
  uParams: vec4<f32>,
};
@group(0) @binding(0) var<uniform> bg: Bg;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn mainVS(@location(0) aPosition: vec2<f32>) -> VSOut {
  var o: VSOut;
  o.pos = vec4<f32>(aPosition, 0.0, 1.0);
  o.uv = aPosition * 0.5 + 0.5;
  return o;
}

@fragment
fn mainFS(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let top = vec3<f32>(0.085, 0.095, 0.125);
  let bottom = vec3<f32>(0.028, 0.032, 0.046);
  var c = mix(bottom, top, smoothstep(0.0, 1.0, uv.y));
  let d = distance(uv, vec2<f32>(0.62, 0.74));
  c = c + vec3<f32>(0.105, 0.088, 0.062) * (1.0 - smoothstep(0.0, 0.85, d)) * bg.uParams.x;
  let aspect = bg.uRes.x / max(bg.uRes.y, 1.0);
  let g = distance(uv * vec2<f32>(aspect, 1.0), vec2<f32>(0.5 * aspect, 0.48));
  c = c - vec3<f32>(0.022) * (1.0 - smoothstep(0.0, 0.62, g));
  return vec4<f32>(c, 1.0);
}
`;

export const BG_GLSL_VERT = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const BG_GLSL_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uRes;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 uv = vUv;
  vec3 top = vec3(0.085, 0.095, 0.125);
  vec3 bottom = vec3(0.028, 0.032, 0.046);
  vec3 c = mix(bottom, top, smoothstep(0.0, 1.0, uv.y));
  float d = distance(uv, vec2(0.62, 0.74));
  c += vec3(0.105, 0.088, 0.062) * (1.0 - smoothstep(0.0, 0.85, d)) * uParams.x;
  float aspect = uRes.x / max(uRes.y, 1.0);
  float g = distance(uv * vec2(aspect, 1.0), vec2(0.5 * aspect, 0.48));
  c -= vec3(0.022) * (1.0 - smoothstep(0.0, 0.62, g));
  fragColor = vec4(c, 1.0);
}
`;

/** Floor grid: a screen-space quad raymarched against the z = FLOOR_Z plane. */
export const FLOOR_WGSL = /* wgsl */ `
struct Cam {
  uViewProj: mat4x4<f32>,
  uEye: vec4<f32>,
  uLightDir: vec4<f32>,
  uLightColor: vec4<f32>,
  uAmbient: vec4<f32>,
  uPaperColor: vec4<f32>,
  uParams: vec4<f32>,
  uFade: vec4<f32>,
};
@group(0) @binding(0) var<uniform> cam: Cam;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn mainVS(@location(0) aPosition: vec2<f32>) -> VSOut {
  var o: VSOut;
  o.pos = vec4<f32>(aPosition, 1.0, 1.0);
  o.ndc = aPosition;
  return o;
}

fn gridLine(p: vec2<f32>, spacing: f32, width: f32) -> f32 {
  let q = abs(fract(p / spacing + 0.5) - 0.5) * spacing;
  let d = min(q.x, q.y);
  return 1.0 - smoothstep(0.0, width, d);
}

@fragment
fn mainFS(in: VSOut) -> @location(0) vec4<f32> {
  let floorZ = -0.36;
  let m = cam.uViewProj;
  // Rows of the view rotation are the camera axes in world space.
  let viewX = normalize(vec3<f32>(m[0].x, m[0].y, m[0].z));
  let viewY = normalize(vec3<f32>(m[1].x, m[1].y, m[1].z));
  let viewZ = normalize(vec3<f32>(m[2].x, m[2].y, m[2].z));
  let tanHalf = vec2<f32>(length(viewX), length(viewY));
  let dir = normalize(-viewZ + in.ndc.x * tanHalf.x * viewX + in.ndc.y * tanHalf.y * viewY);

  let eye = cam.uEye.xyz;
  var color = vec3<f32>(0.0);
  var alpha = 0.0;
  if (abs(dir.z) > 1e-4) {
    let t = (floorZ - eye.z) / dir.z;
    if (t > 0.0) {
      let hit = eye + dir * t;
      let dist = length(hit.xy - eye.xy);
      let fade = 1.0 - smoothstep(1.4, 6.0, dist);
      let g1 = gridLine(hit.xy, 0.5, 0.006);
      let g2 = gridLine(hit.xy, 2.5, 0.012);
      let line = clamp(g1 * 0.40 + g2 * 0.65, 0.0, 1.0);
      color = vec3<f32>(0.40, 0.43, 0.52) * line * fade;
      alpha = fade * (0.08 + line * 0.28);
    }
  }
  return vec4<f32>(color, alpha);
}
`;

export const FLOOR_GLSL_VERT = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vNdc;
void main() {
  vNdc = aPosition;
  gl_Position = vec4(aPosition, 1.0, 1.0);
}
`;

export const FLOOR_GLSL_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uViewProj;
uniform vec4 uEye;
out vec4 fragColor;
float gridLine(vec2 p, float spacing, float w) {
  vec2 q = abs(fract(p / spacing + 0.5) - 0.5) * spacing;
  float d = min(q.x, q.y);
  return 1.0 - smoothstep(0.0, w, d);
}
void main() {
  float floorZ = -0.36;
  vec3 viewX = normalize(vec3(uViewProj[0].x, uViewProj[0].y, uViewProj[0].z));
  vec3 viewY = normalize(vec3(uViewProj[1].x, uViewProj[1].y, uViewProj[1].z));
  vec3 viewZ = normalize(vec3(uViewProj[2].x, uViewProj[2].y, uViewProj[2].z));
  vec2 tanHalf = vec2(length(viewX), length(viewY));
  vec3 dir = normalize(-viewZ + vNdc.x * tanHalf.x * viewX + vNdc.y * tanHalf.y * viewY);
  vec3 eye = uEye.xyz;
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  if (abs(dir.z) > 1e-4) {
    float t = (floorZ - eye.z) / dir.z;
    if (t > 0.0) {
      vec3 hit = eye + dir * t;
      float dist = length(hit.xy - eye.xy);
      float fade = 1.0 - smoothstep(1.4, 6.0, dist);
      float g1 = gridLine(hit.xy, 0.5, 0.006);
      float g2 = gridLine(hit.xy, 2.5, 0.012);
      float line = clamp(g1 * 0.40 + g2 * 0.65, 0.0, 1.0);
      color = vec3(0.40, 0.43, 0.52) * line * fade;
      alpha = fade * (0.08 + line * 0.28);
    }
  }
  fragColor = vec4(color, alpha);
}
`;
