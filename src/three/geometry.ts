import * as THREE from 'three';
import type { WeaveBuffers } from '../core/types';

/**
 * 将 Worker 产出的共享顶点缓冲映射为「外层 / 内层」两个网格：
 * 同一份 position/normal/uv BufferGeometry，索引分两套，零拷贝。
 */
export interface FamilyMeshes {
  outer: THREE.Mesh;
  inner: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  dispose(): void;
}

export function createFamilyMeshes(buffers: WeaveBuffers, material: THREE.Material): FamilyMeshes {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(buffers.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(buffers.outerIndices, 1));
  geometry.computeBoundingSphere();

  const outerGeo = geometry; // 主几何体携带外层索引
  const innerGeo = new THREE.BufferGeometry();
  innerGeo.setAttribute('position', geometry.getAttribute('position'));
  innerGeo.setAttribute('normal', geometry.getAttribute('normal'));
  innerGeo.setAttribute('uv', geometry.getAttribute('uv'));
  innerGeo.setIndex(new THREE.BufferAttribute(buffers.innerIndices, 1));
  innerGeo.computeBoundingSphere();

  const outer = new THREE.Mesh(outerGeo, material);
  const inner = new THREE.Mesh(innerGeo, material);
  outer.frustumCulled = true;
  inner.frustumCulled = true;

  return {
    outer,
    inner,
    geometry,
    dispose() {
      geometry.dispose();
      innerGeo.dispose();
    },
  };
}
