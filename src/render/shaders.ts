/**
 * 所有全屏 pass 与遮挡掩码 pass 的 GLSL。
 *
 * 约定：所有渲染目标都是线性 HDR（HalfFloat），只有最终合成 pass
 * 负责 ACES 色调映射与 sRGB 编码。
 */

/** 覆盖整个视口的三角形（clip space 直接输出） */
export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** 物体的顶点着色器（用于遮挡掩码 pass） */
export const MESH_VERT = /* glsl */ `
varying vec3 vViewNormal;
void main() {
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * 遮挡掩码：把「物体 ID」与「可见比例」编码进颜色。
 *   R = (index + 1) / 16   （0 表示背景）
 *   G = 可见比例 → 辉光增益
 */
export const MASK_FRAG = /* glsl */ `
uniform float uIndex;
uniform float uGain;
varying vec3 vViewNormal;
void main() {
  gl_FragColor = vec4(uIndex, uGain, 0.0, 1.0);
}
`;

/**
 * 亮度提取：
 *  - 2x2 盒式降采样（同时把全分辨率降到 L0 的 1/2）
 *  - Rec.709 亮度，与阈值比较；软阈值用 smoothstep 过渡
 *  - 乘以遮挡增益（来自掩码的 G 通道）
 */
export const EXTRACT_FRAG = /* glsl */ `
uniform sampler2D uBeauty;
uniform sampler2D uMask;
uniform vec2 uTexel;        // 输入（全分辨率）的 1/像素
uniform float uThreshold;
uniform float uKnee;
uniform float uUseMask;

varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 o = uTexel * 0.5;
  vec3 c = (
    texture2D(uBeauty, vUv + vec2(-o.x, -o.y)).rgb +
    texture2D(uBeauty, vUv + vec2( o.x, -o.y)).rgb +
    texture2D(uBeauty, vUv + vec2(-o.x,  o.y)).rgb +
    texture2D(uBeauty, vUv + vec2( o.x,  o.y)).rgb
  ) * 0.25;

  float gain = mix(1.0, texture2D(uMask, vUv).g, uUseMask);

  float l = luma(c);
  float w = uKnee > 0.0001
    ? smoothstep(uThreshold, uThreshold + uKnee, l)
    : step(uThreshold, l);

  gl_FragColor = vec4(c * w * gain, 1.0);
}
`;

/** 2x2 盒式降采样（线性过滤 + 半像素偏移 = 精确 2x2 平均） */
export const DOWN_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 o = uTexel * 0.5;
  vec3 c = (
    texture2D(uTex, vUv + vec2(-o.x, -o.y)).rgb +
    texture2D(uTex, vUv + vec2( o.x, -o.y)).rgb +
    texture2D(uTex, vUv + vec2(-o.x,  o.y)).rgb +
    texture2D(uTex, vUv + vec2( o.x,  o.y)).rgb
  ) * 0.25;
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * 可分离高斯模糊（9 抽头，权重由半径在 CPU 侧算好）。
 * uDir 为一次抽样步进：水平 (1/w, 0) 或垂直 (0, 1/h)。
 */
export const BLUR_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uW0;
uniform float uW1;
uniform float uW2;
uniform float uW3;
uniform float uW4;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * uW0;
  c += (texture2D(uTex, vUv + uDir).rgb     + texture2D(uTex, vUv - uDir).rgb)     * uW1;
  c += (texture2D(uTex, vUv + uDir * 2.0).rgb + texture2D(uTex, vUv - uDir * 2.0).rgb) * uW2;
  c += (texture2D(uTex, vUv + uDir * 3.0).rgb + texture2D(uTex, vUv - uDir * 3.0).rgb) * uW3;
  c += (texture2D(uTex, vUv + uDir * 4.0).rgb + texture2D(uTex, vUv - uDir * 4.0).rgb) * uW4;
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * 累加：acc[i] = acc[i-1] + upsample(blur[i]) * weight
 * uCur 是较粗一级的模糊结果，按 L0 的 UV 采样即为双线性升采样。
 */
export const ACC_FRAG = /* glsl */ `
uniform sampler2D uPrev;
uniform sampler2D uCur;
uniform float uWeight;
uniform float uHasPrev;
varying vec2 vUv;
void main() {
  vec3 cur = texture2D(uCur, vUv).rgb * uWeight;
  vec3 prev = uHasPrev > 0.5 ? texture2D(uPrev, vUv).rgb : vec3(0.0);
  gl_FragColor = vec4(prev + cur, 1.0);
}
`;

/**
 * 最终合成：
 *   0 合成     beauty + glow → ACES → sRGB
 *   1 仅辉光   glow → ACES → sRGB
 *   2 亮度源   阈值提取后的 L0 → ACES → sRGB
 *   3 遮挡掩码 物体色 × 可见比例（数据视图，不做色调映射）
 */
export const FINAL_FRAG = /* glsl */ `
uniform sampler2D uBeauty;
uniform sampler2D uGlow;
uniform sampler2D uSource;
uniform sampler2D uMask;
uniform float uExposure;
uniform float uIntensity;
uniform int uView;

uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
uniform vec3 uC5;

varying vec2 vUv;

vec3 aces(vec3 color) {
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 ACESOutputMat = mat3(
    vec3( 1.60475, -0.10208, -0.00327),
    vec3(-0.53108,  1.10813, -0.07276),
    vec3(-0.07367, -0.00605,  1.07602)
  );
  color = ACESInputMat * (color / 0.6);
  color = (color * (color + 0.0245786) - 0.000090537) /
          (color * (0.983729 * color + 0.4329510) + 0.238081);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = pow(max(c, vec3(0.0)), vec3(0.41666)) * 1.055 - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

void main() {
  if (uView == 0) {
    vec3 beauty = texture2D(uBeauty, vUv).rgb;
    vec3 glow = texture2D(uGlow, vUv).rgb * uIntensity;
    gl_FragColor = vec4(toSRGB(aces((beauty + glow) * uExposure)), 1.0);
  } else if (uView == 1) {
    vec3 glow = texture2D(uGlow, vUv).rgb * uIntensity;
    gl_FragColor = vec4(toSRGB(aces(glow * uExposure)), 1.0);
  } else if (uView == 2) {
    gl_FragColor = vec4(toSRGB(aces(texture2D(uSource, vUv).rgb)), 1.0);
  } else {
    vec4 m = texture2D(uMask, vUv);
    float id = floor(m.r * 16.0 + 0.5);
    vec3 col = vec3(0.02);
    if (id > 0.5 && id < 1.5) col = uC0;
    else if (id > 1.5 && id < 2.5) col = uC1;
    else if (id > 2.5 && id < 3.5) col = uC2;
    else if (id > 3.5 && id < 4.5) col = uC3;
    else if (id > 4.5 && id < 5.5) col = uC4;
    else if (id > 5.5 && id < 6.5) col = uC5;
    float k = 0.05 + 0.95 * clamp(m.g, 0.0, 1.0);
    gl_FragColor = vec4(toSRGB(col * k), 1.0);
  }
}
`;
