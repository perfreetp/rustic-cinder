// 阳光穿过窗户在室内形成的光斑:网格化窗口 + 光线投射 + 柔和边缘着色器
import * as THREE from 'three';
import type { RoomConfig, WindowConfig } from '../types';
import { windowPointAt } from './geometry';

const MAX_MULLIONS = 6;

const vertexShader = /* glsl */ `
  attribute vec2 winUv;
  attribute float light;
  varying vec2 vUv;
  varying float vLight;
  void main() {
    vUv = winUv;
    vLight = light;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform vec2 uFrame;    // 边框宽度(uv 单位)
  uniform vec2 uMull;     // 横竖梃数量
  uniform vec2 uMullW;    // 梃半宽(uv 单位)
  uniform float uFeather; // 柔和宽度(uv 单位)
  varying vec2 vUv;
  varying float vLight;

  void main() {
    // 到边框遮挡区的距离
    float e = min(min(vUv.x, 1.0 - vUv.x) - uFrame.x,
                  min(vUv.y, 1.0 - vUv.y) - uFrame.y);
    // 到竖梃遮挡区的距离
    float dx = 1.0e9;
    for (int i = 1; i <= ${MAX_MULLIONS}; i++) {
      if (float(i) > uMull.x) break;
      float mu = float(i) / (uMull.x + 1.0);
      dx = min(dx, abs(vUv.x - mu) - uMullW.x);
    }
    float dy = 1.0e9;
    for (int i = 1; i <= ${MAX_MULLIONS}; i++) {
      if (float(i) > uMull.y) break;
      float mu = float(i) / (uMull.y + 1.0);
      dy = min(dy, abs(vUv.y - mu) - uMullW.y);
    }
    float d = min(e, min(dx, dy));
    float alpha = smoothstep(0.0, uFeather, d);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor * uIntensity * vLight, alpha * 0.9);
  }
`;

export interface PatchOptions {
  /** 太阳方向(指向太阳,单位向量) */
  sunDir: THREE.Vector3;
  /** 光强 0~1.5 */
  intensity: number;
  /** 光色 */
  color: THREE.Color;
  colliders: THREE.Object3D[];
}

/** 为单扇窗生成光斑网格(可能落在地面与墙面上) */
export function buildLightPatch(
  w: WindowConfig,
  room: RoomConfig,
  opts: PatchOptions,
): THREE.Mesh | null {
  const nx = Math.max(6, Math.min(36, Math.round(w.width * 16)));
  const ny = Math.max(6, Math.min(36, Math.round(w.height * 16)));
  const dir = opts.sunDir.clone().negate(); // 光线传播方向
  const ray = new THREE.Raycaster();
  const maxDist = Math.sqrt(room.width ** 2 + room.depth ** 2 + room.height ** 2) * 2;

  const positions: number[] = [];
  const uvs: number[] = [];
  const lights: number[] = [];
  const indices: number[] = [];
  const tmpN = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const hitP = new THREE.Vector3();

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cu = (i + 0.5) / nx;
      const cv = (j + 0.5) / ny;
      const center = windowPointAt(w, room, cu, cv);
      ray.set(center.clone().addScaledVector(opts.sunDir, 0.08), dir);
      ray.far = maxDist;
      const hits = ray.intersectObjects(opts.colliders, false);
      if (hits.length === 0) continue;
      const hit = hits[0];
      hitP.copy(hit.point);
      // 命中面法线(世界系),确保朝向光线来向
      tmpN.copy(hit.face?.normal ?? new THREE.Vector3(0, 1, 0));
      tmpN.transformDirection(hit.object.matrixWorld);
      if (tmpN.dot(dir) > 0) tmpN.negate();

      const cosI = Math.max(0, tmpN.dot(opts.sunDir));
      if (cosI < 0.02) continue;

      // 四个角点沿光线方向投射到命中平面
      const base = positions.length / 3;
      const uvLen = uvs.length;
      const lightLen = lights.length;
      let ok = true;
      const quad: THREE.Vector3[] = [];
      for (const [du, dv] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ] as const) {
        const u = (i + du) / nx;
        const v = (j + dv) / ny;
        windowPointAt(w, room, u, v, corner);
        corner.addScaledVector(opts.sunDir, 0.08);
        const denom = dir.dot(tmpN);
        if (Math.abs(denom) < 1e-6) {
          ok = false;
          break;
        }
        const t = hitP.clone().sub(corner).dot(tmpN) / denom;
        if (t < 0 || t > maxDist) {
          ok = false;
          break;
        }
        quad.push(corner.clone().addScaledVector(dir, t).addScaledVector(tmpN, 0.012));
        uvs.push(u, v);
        lights.push(cosI);
      }
      if (!ok) {
        uvs.length = uvLen;
        lights.length = lightLen;
        continue;
      }
      for (const p of quad) positions.push(p.x, p.y, p.z);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  if (indices.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('winUv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('light', new THREE.Float32BufferAttribute(lights, 1));
  geo.setIndex(indices);

  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: opts.color },
      uIntensity: { value: opts.intensity },
      uFrame: {
        value: new THREE.Vector2(w.frameWidth / w.width, w.frameWidth / w.height),
      },
      uMull: {
        value: new THREE.Vector2(
          Math.min(MAX_MULLIONS, w.mullionsX),
          Math.min(MAX_MULLIONS, w.mullionsY),
        ),
      },
      uMullW: {
        value: new THREE.Vector2(
          (w.frameWidth * 0.7) / w.width / 2,
          (w.frameWidth * 0.7) / w.height / 2,
        ),
      },
      // 柔和度:窗框越复杂边缘越柔
      uFeather: { value: 0.01 + w.softness * 0.09 },
    },
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  return mesh;
}

/** 重建整组光斑 */
export function rebuildPatches(
  group: THREE.Group,
  windows: WindowConfig[],
  room: RoomConfig,
  opts: PatchOptions | null,
): void {
  for (const child of [...group.children]) {
    group.remove(child);
    const m = child as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material)?.dispose();
  }
  if (!opts) return;
  for (const w of windows) {
    const mesh = buildLightPatch(w, room, opts);
    if (mesh) group.add(mesh);
  }
}
