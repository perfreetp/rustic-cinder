import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { makeMaterial } from './viewport';
import type { MaterialSettings } from '../core/types';

export interface ExportInput {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  material: MaterialSettings;
}

export interface ExportReport {
  fileName: string;
  bytes: number;
  triangles: number;
  vertices: number;
  durationMs: number;
}

/**
 * 导出 GLB:
 *   · 几何已经是导出前清理过的 (合并顶点 / 剔除退化面)
 *   · 使用 MeshPhysicalMaterial, 由 GLTFExporter 转成 KHR_materials_clearcoat 等扩展
 *   · 法线来自网格顶点属性, 因此 GLB 里能保留法线与材质
 */
export async function exportGlb(input: ExportInput): Promise<ExportReport> {
  const t0 = performance.now();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(input.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(input.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(input.indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mat = makeMaterial(input.material);
  mat.name = `scene-material-${input.material.preset}`;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'form-studio-sculpt';

  const scene = new THREE.Scene();
  scene.add(mesh);

  const exporter = new GLTFExporter();
  const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('导出结果不是二进制 GLB'));
      },
      (err) => reject(err),
      { binary: true, onlyVisible: true, includeCustomExtensions: false },
    );
  });

  const safe = input.name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'sculpt';
  const fileName = `${safe}.glb`;
  downloadBlob(new Blob([arrayBuffer], { type: 'model/gltf-binary' }), fileName);

  geo.dispose();
  mat.dispose();

  return {
    fileName,
    bytes: arrayBuffer.byteLength,
    triangles: input.indices.length / 3,
    vertices: input.positions.length / 3,
    durationMs: Math.round(performance.now() - t0),
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
