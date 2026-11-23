// potree-core 点云加载
import * as THREE from 'three';
import { Potree, type PointCloudOctree } from 'potree-core';

const potree = new Potree();
potree.pointBudget = 1_000_000;

export interface LoadedCloud {
  object: THREE.Object3D;
  update: (camera: THREE.Camera, renderer: THREE.WebGLRenderer) => void;
}

/**
 * 加载 potree 格式点云
 * @param url cloud.js 的地址(或所在目录地址)
 */
export async function loadPointCloud(url: string): Promise<LoadedCloud> {
  const trimmed = url.trim();
  const isFile = /cloud\.js(on)?$/i.test(trimmed);
  const base = isFile ? trimmed.slice(0, trimmed.lastIndexOf('/')) : trimmed.replace(/\/$/, '');
  const file = isFile ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : 'cloud.js';

  const pco: PointCloudOctree = await potree.loadPointCloud(file, base);
  const object: THREE.Object3D = pco;

  // 居中并缩放到房间尺度附近
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  if (maxDim > 20 || maxDim < 2) {
    const s = 8 / maxDim;
    object.scale.setScalar(s);
  }
  const box2 = new THREE.Box3().setFromObject(object);
  const center = box2.getCenter(new THREE.Vector3());
  object.position.sub(new THREE.Vector3(center.x, box2.min.y, center.z));

  return {
    object,
    update: (camera, renderer) => {
      try {
        potree.updatePointClouds([pco], camera, renderer);
      } catch {
        /* 点云更新失败不阻断主流程 */
      }
    },
  };
}
