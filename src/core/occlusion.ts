/**
 * 遮挡联动 —— 可见比例估算（CPU 射线，可单测的纯几何部分）。
 *
 * 语义：辉光强度 = 全量辉光 × 可见比例。
 * 可见比例 = 物体在屏幕投影范围内，未被其它几何体挡住的比例。
 *
 * 每个自发光物体：
 *   1. 取包围球的屏幕投影（用相机基向量构造），内部做 Vogel 螺旋低差异采样；
 *   2. 采样点取球面朝向相机一侧的表面点 P；
 *   3. 从 P 向相机打一条短射线，若被遮挡体拦住，则该采样被遮挡。
 *
 * 起点放在球面上而非相机上，结果才严格等于「屏幕上被挡住的比例」，
 * 也不会因为物体自身几何或靠得很近的相机而失真。
 */

import * as THREE from 'three';

const GOLDEN_ANGLE = 2.399963229728653;

/** 帧率无关的指数平滑；目标为 0 时也会收敛到 0，不会残留辉光。 */
export function smoothVisibility(current: number, target: number, dt: number, tau = 0.075): number {
  if (tau <= 1e-6) return target;
  if (!Number.isFinite(dt) || dt <= 0) return current;
  const k = 1 - Math.exp(-dt / tau);
  return current + (target - current) * k;
}

/**
 * 可见比例 → 辉光增益。
 *  strength = 0：关闭联动（可复现「被挡住仍有满额辉光」的问题）
 *  strength = 1：严格按可见比例线性衰减
 */
export function visibilityToGain(visible: number, strength: number): number {
  const s = Math.min(1, Math.max(0, strength));
  const v = Math.min(1, Math.max(0, visible));
  return 1 - (1 - v) * s;
}

export interface VisibilityResult {
  visible: number;
  blocked: number;
  samples: number;
}

const _center = new THREE.Vector3();
const _toCamera = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _p = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _scale = new THREE.Vector3();

/** 复用单个 Raycaster；firstHitOnly 让 BVH 遇到首个命中即终止。 */
export function createVisibilityRaycaster(): THREE.Raycaster {
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  return ray;
}

/**
 * 计算单个自发光物体当前的可见比例。
 * @param mesh      目标自发光网格
 * @param camera    相机
 * @param occluders 会阻挡辉光的网格（不含 mesh 自身）
 * @param raycaster 复用实例（需开启 firstHitOnly）
 * @param samples   采样数
 */
export function sampleVisibility(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  occluders: readonly THREE.Object3D[],
  raycaster: THREE.Raycaster,
  samples = 16,
): VisibilityResult {
  if (occluders.length === 0 || !mesh.visible) return { visible: 1, blocked: 0, samples: 0 };

  mesh.updateWorldMatrix(true, false);
  mesh.getWorldPosition(_center);

  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const bs = mesh.geometry.boundingSphere;
  if (!bs) return { visible: 1, blocked: 0, samples: 0 };

  mesh.getWorldScale(_scale);
  const worldRadius = bs.radius * Math.max(Math.abs(_scale.x), Math.abs(_scale.y), Math.abs(_scale.z));
  if (worldRadius <= 1e-6) return { visible: 1, blocked: 0, samples: 0 };

  camera.getWorldPosition(_toCamera);
  _toCamera.sub(_center); // 物体 → 相机
  const distToCamera = _toCamera.length();
  if (distToCamera <= worldRadius * 1.02) return { visible: 1, blocked: 0, samples: 0 }; // 相机贴着物体
  _toCamera.divideScalar(distToCamera);

  // 相机基向量
  _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  _up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

  // 只在其它网格里找遮挡
  const blockers = occluders.filter((o) => o !== mesh && o.visible);

  const n = Math.max(1, Math.floor(samples));
  const sampleRadius = worldRadius * 0.94;
  const rayMax = distToCamera - worldRadius * 0.04;

  let blocked = 0;

  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const r = sampleRadius * Math.sqrt(t);
    const theta = i * GOLDEN_ANGLE;
    const ox = Math.cos(theta) * r;
    const oy = Math.sin(theta) * r;

    const rr = Math.min(worldRadius * worldRadius, ox * ox + oy * oy);
    const sag = Math.sqrt(Math.max(0, worldRadius * worldRadius - rr));

    // 球面朝相机一侧的表面点
    _p.copy(_center).addScaledVector(_right, ox).addScaledVector(_up, oy).addScaledVector(_toCamera, sag);

    _rayDir.copy(camera.position).sub(_p);
    const rayLen = _rayDir.length();
    if (rayLen <= 1e-5) continue;
    _rayDir.divideScalar(rayLen);

    raycaster.set(_p, _rayDir);
    raycaster.near = 0;
    raycaster.far = Math.min(rayMax, rayLen);

    const hits = raycaster.intersectObjects(blockers as THREE.Object3D[], false);
    if (hits.length > 0) blocked++;
  }

  return { visible: (n - blocked) / n, blocked, samples: n };
}
