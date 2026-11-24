/**
 * 纸面着色器：程序化纤维纹理 + 多方向漫反射 + 轮廓光（rim light）。
 * 折面朝向光源时漫反射强度随法线-光照夹角变化。
 * 三组布光方向可切换（uLightRig 0/1/2）。
 */
import * as THREE from 'three'

const VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vViewDir;
varying vec2 vUv;
varying vec3 vPosW;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vPosW = worldPos.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 mvPos = viewMatrix * worldPos;
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`

const FRAG = /* glsl */ `
precision highp float;

varying vec3 vNormalW;
varying vec3 vViewDir;
varying vec2 vUv;
varying vec3 vPosW;

uniform vec3 uPaperColor;
uniform vec3 uFiberColor;
uniform float uTime;
uniform int uLightRig;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec2 uShadowTexel;
uniform float uShadowStrength;
uniform float uHighQuality;

// 三组布光方向（单位向量，指向光源）
const vec3 RIG_A = normalize(vec3(0.55, 0.62, 0.56));
const vec3 RIG_B = normalize(vec3(-0.72, 0.35, 0.60));
const vec3 RIG_C = normalize(vec3(0.12, -0.55, 0.82));

// --- 哈希与值噪声（纤维纹理用） ---
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
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

// 拉长的各向异性噪声 → 纸纤维
float fiberField(vec2 uv) {
  vec2 p = uv * 140.0;
  float n1 = vnoise(p * vec2(1.0, 5.5));
  float n2 = vnoise(p * vec2(2.4, 11.0) + 17.3);
  float n3 = vnoise(p * 0.35 + 31.7);
  return n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
}

vec3 currentLightDir() {
  if (uLightRig == 1) return RIG_B;
  if (uLightRig == 2) return RIG_C;
  return RIG_A;
}

// 5 抽头 PCF 软阴影
float sampleShadow(vec3 worldPos) {
  vec4 sp = uShadowMatrix * vec4(worldPos, 1.0);
  vec3 ndc = sp.xyz / sp.w;
  vec2 uv = ndc.xy * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  float ref = ndc.z * 0.5 + 0.5;
  float bias = 0.0025;
  float sum = 0.0;
  sum += texture2D(uShadowMap, uv).r < ref - bias ? 0.0 : 1.0;
  sum += texture2D(uShadowMap, uv + uShadowTexel * vec2( 1.0, 0.0)).r < ref - bias ? 0.0 : 1.0;
  sum += texture2D(uShadowMap, uv + uShadowTexel * vec2(-1.0, 0.0)).r < ref - bias ? 0.0 : 1.0;
  sum += texture2D(uShadowMap, uv + uShadowTexel * vec2( 0.0, 1.0)).r < ref - bias ? 0.0 : 1.0;
  sum += texture2D(uShadowMap, uv + uShadowTexel * vec2( 0.0,-1.0)).r < ref - bias ? 0.0 : 1.0;
  return mix(1.0, sum / 5.0, uShadowStrength);
}

void main() {
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 L = currentLightDir();
  vec3 V = normalize(vViewDir);

  // 漫反射：折面朝向光源时强度最大
  float ndl = max(dot(N, L), 0.0);
  float diffuse = 0.30 + 0.70 * ndl;

  // 两组补光，让背光折面仍有细节
  float fill1 = 0.10 * max(dot(N, normalize(vec3(-0.4, 0.2, 0.9))), 0.0);
  float fill2 = 0.07 * max(dot(N, normalize(vec3(0.3, -0.7, 0.6))), 0.0);

  // 轮廓光：视线与法线接近垂直、且与光源同侧时增强
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  rim *= 0.35 + 0.65 * max(dot(N, L), 0.0);
  vec3 rimColor = mix(vec3(0.62, 0.72, 0.95), uPaperColor, 0.35);

  // 纤维纹理
  float fiber = fiberField(vUv);
  vec3 paper = mix(uPaperColor * 0.94, uPaperColor * 1.05, fiber);
  paper = mix(paper, uFiberColor, 0.10 * fiber);
  // 极细微的纸面色差
  paper *= 0.97 + 0.06 * vnoise(vUv * 300.0);

  float shadow = sampleShadow(vPosW);
  vec3 color = paper * (diffuse * shadow + fill1 + fill2);
  color += rimColor * rim * 0.55 * shadow;

  // 低精度模式降低纤维细节，保证播放流畅
  if (uHighQuality < 0.5) {
    color = mix(paper * (0.35 + 0.65 * ndl) * shadow, color, 0.35);
  }

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`

export function createPaperMaterial(shadowUniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uPaperColor: { value: new THREE.Color('#f2ead8') },
      uFiberColor: { value: new THREE.Color('#b9a98c') },
      uTime: { value: 0 },
      uLightRig: { value: 0 },
      uShadowMap: shadowUniforms.shadowMap,
      uShadowMatrix: shadowUniforms.shadowMatrix,
      uShadowTexel: shadowUniforms.shadowTexel,
      uShadowStrength: { value: 0.85 },
      uHighQuality: { value: 1 }
    }
  })
}

export const LIGHT_RIGS = [
  { name: '布光 A · 右上主光', dir: [0.55, 0.62, 0.56] },
  { name: '布光 B · 左侧逆光', dir: [-0.72, 0.35, 0.6] },
  { name: '布光 C · 低角度侧光', dir: [0.12, -0.55, 0.82] }
]
