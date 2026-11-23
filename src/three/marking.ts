// 采光标记:区域照度采样计算与标记可视化
import * as THREE from 'three';
import type { DaylightMark, RoomConfig, SunPosition, WindowConfig } from '../types';
import { diffuseIlluminance, directNormalIlluminance } from '../solar';
import { pointInOpening, wallFrame } from './geometry';

export interface MarkRect {
  cx: number;
  cz: number;
  w: number;
  d: number;
}

const WORK_PLANE = 0.75; // 工作面高度(米)
const GLASS_TRANSMITTANCE = 0.8;
const INDOOR_REFLECT_FACTOR = 0.08; // 室内漫反射近似系数

/**
 * 计算矩形区域工作面平均照度(lux)
 * 直射:采样点向太阳方向的光线穿过窗洞且未被家具遮挡
 * 漫射:与天空漫射照度成比例的室内近似
 */
export function computeRegionLux(
  rect: MarkRect,
  windows: WindowConfig[],
  room: RoomConfig,
  sunPos: SunPosition,
  sunDir: THREE.Vector3,
  furniture: THREE.Object3D[],
): number {
  const N = 8;
  const ray = new THREE.Raycaster();
  const p = new THREE.Vector3();
  const hit = new THREE.Vector3();
  let total = 0;

  const dni = directNormalIlluminance(sunPos.elevation);
  const indirect = diffuseIlluminance(sunPos.elevation) * INDOOR_REFLECT_FACTOR;

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = rect.cx - rect.w / 2 + ((i + 0.5) / N) * rect.w;
      const z = rect.cz - rect.d / 2 + ((j + 0.5) / N) * rect.d;
      p.set(x, WORK_PLANE, z);
      let direct = 0;

      if (sunPos.up && dni > 0) {
        for (const w of windows) {
          const f = wallFrame(w.wall, room);
          const denom = sunDir.dot(f.n);
          if (denom <= 1e-4) continue; // 阳光不朝向该墙内侧
          const t = f.origin.clone().sub(p).dot(f.n) / denom;
          if (t <= 0) continue;
          hit.copy(p).addScaledVector(sunDir, t);
          const u = hit.clone().sub(f.origin).dot(f.u);
          if (!pointInOpening(w, u, hit.y)) continue;
          // 家具遮挡检测
          ray.set(p, sunDir);
          ray.far = t - 0.05;
          if (ray.intersectObjects(furniture, false).length > 0) continue;
          // 水平工作面直射照度 = DNI × sin(高度角)
          direct = dni * Math.sin(sunPos.elevation) * GLASS_TRANSMITTANCE;
          break;
        }
      }
      total += direct + indirect;
    }
  }
  return total / (N * N);
}

/** 单个标记的可视化(地面色块 + 照度标签) */
function makeLabelSprite(mark: DaylightMark): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  const color = mark.deficient ? '#e05252' : '#3f9e4d';
  ctx.fillStyle = 'rgba(20,24,28,0.85)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 88, 12);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(mark.lux)} lx`, 128, 46);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillText(mark.deficient ? '采光不足' : '采光达标', 128, 78);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
  );
  sprite.scale.set(1.1, 0.41, 1);
  sprite.renderOrder = 20;
  return sprite;
}

/** 管理所有标记的 3D 可视化 */
export class MarkVisuals {
  readonly group = new THREE.Group();
  private preview: THREE.Mesh | null = null;

  setMarks(marks: DaylightMark[]): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      this.dispose(child);
    }
    for (const mark of marks) {
      const color = mark.deficient ? 0xe05252 : 0x3f9e4d;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(mark.w, mark.d),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(mark.cx, 0.02, mark.cz);
      plane.renderOrder = 10;
      this.group.add(plane);

      const sprite = makeLabelSprite(mark);
      sprite.position.set(mark.cx, 1.05, mark.cz);
      this.group.add(sprite);
    }
  }

  /** 框选过程中的预览矩形 */
  setPreview(rect: MarkRect | null): void {
    if (this.preview) {
      this.group.remove(this.preview);
      this.preview.geometry.dispose();
      (this.preview.material as THREE.Material).dispose();
      this.preview = null;
    }
    if (!rect) return;
    this.preview = new THREE.Mesh(
      new THREE.PlaneGeometry(rect.w, rect.d),
      new THREE.MeshBasicMaterial({
        color: 0x4da3ff,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    this.preview.rotation.x = -Math.PI / 2;
    this.preview.position.set(rect.cx, 0.025, rect.cz);
    this.preview.renderOrder = 11;
    this.group.add(this.preview);
  }

  private dispose(obj: THREE.Object3D): void {
    const m = obj as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | undefined;
    if (mat) {
      const sm = mat as THREE.SpriteMaterial;
      sm.map?.dispose();
      mat.dispose();
    }
  }
}
