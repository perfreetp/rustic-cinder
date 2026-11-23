// 场景总控:渲染器、相机、光照、阴影、各模块协调
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DaylightMark, RoomConfig, SunPosition, WindowConfig } from '../types';
import { sunDirection } from '../solar';
import { buildRoom, buildWindowFrame, type RoomBuild } from './room';
import { rebuildPatches } from './lightpatch';
import { MarkVisuals, type MarkRect } from './marking';
import { loadPointCloud, type LoadedCloud } from './pointcloud';

export class DaylightScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private dirLight = new THREE.DirectionalLight(0xffffff, 0);
  private hemi = new THREE.HemisphereLight(0xcfe4ff, 0x8a7a66, 0.5);
  private roomGroup = new THREE.Group();
  private frameGroup = new THREE.Group();
  private patchGroup = new THREE.Group();
  private marks = new MarkVisuals();
  private cloud: LoadedCloud | null = null;
  private sunArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(),
    3,
    0xffc04d,
    0.5,
    0.3,
  );

  private roomBuild: RoomBuild | null = null;
  private room: RoomConfig = { width: 6, depth: 5, height: 2.8, pointCloudUrl: '' };
  private sunPos: SunPosition = { azimuth: 0, elevation: 0, up: false };
  private sunDir = new THREE.Vector3(0, 1, 0);
  private patchDirty = false;
  private windows: WindowConfig[] = [];

  /** 框选完成回调 */
  onMarkRect: ((rect: MarkRect) => void) | null = null;
  private markMode = false;
  private dragStart: THREE.Vector2 | null = null;

  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.camera.position.set(5.5, 4.5, 6.5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = true;
    this.controls.maxDistance = 40;

    this.scene.background = new THREE.Color(0x1a2028);
    this.scene.fog = new THREE.Fog(0x1a2028, 30, 90);

    // 太阳光(投射实时阴影)
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 80;
    this.dirLight.shadow.bias = -0.0004;
    this.dirLight.shadow.normalBias = 0.02;
    this.scene.add(this.dirLight, this.dirLight.target, this.hemi);

    // 太阳方位指示
    this.scene.add(this.sunArrow);

    this.scene.add(this.roomGroup, this.frameGroup, this.patchGroup, this.marks.group);

    // 地面参考网格
    const grid = new THREE.GridHelper(40, 40, 0x33404e, 0x252e39);
    grid.position.y = -0.06;
    this.scene.add(grid);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);

    this.loop();
  }

  // ---------- 房间与窗户 ----------

  setRoom(room: RoomConfig, windows: WindowConfig[]): void {
    this.room = { ...room };
    this.windows = [...windows];
    if (this.roomBuild) {
      this.roomGroup.remove(this.roomBuild.group);
      this.roomBuild.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
      });
    }
    this.roomBuild = buildRoom(this.room, this.windows);
    this.roomGroup.add(this.roomBuild.group);
    this.rebuildFrames();
    this.updateShadowFrustum();
    this.patchDirty = true;
  }

  setWindows(windows: WindowConfig[]): void {
    this.setRoom(this.room, windows);
  }

  private rebuildFrames(): void {
    for (const child of [...this.frameGroup.children]) {
      this.frameGroup.remove(child);
    }
    for (const w of this.windows) {
      this.frameGroup.add(buildWindowFrame(w, this.room));
    }
  }

  private updateShadowFrustum(): void {
    const r = Math.max(this.room.width, this.room.depth, this.room.height) * 1.5 + 2;
    const cam = this.dirLight.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.updateProjectionMatrix();
  }

  // ---------- 太阳 ----------

  setSun(pos: SunPosition, dni: number, diffuse: number): void {
    this.sunPos = pos;
    const [x, y, z] = sunDirection(pos);
    this.sunDir.set(x, y, z);

    if (pos.up) {
      this.dirLight.position.copy(this.sunDir).multiplyScalar(30);
      this.dirLight.intensity = 3.2 * Math.min(1, dni / 90000);
      // 低角度偏暖色
      const t = Math.min(1, pos.elevation / (Math.PI / 3));
      this.dirLight.color.setHSL(0.09 + 0.04 * t, 0.75 - 0.55 * t, 0.62 + 0.3 * t);
    } else {
      this.dirLight.intensity = 0;
    }
    this.hemi.intensity = 0.12 + Math.min(0.6, diffuse / 40000);

    this.sunArrow.position.set(0, this.room.height + 0.4, 0);
    this.sunArrow.setDirection(this.sunDir.clone().negate());
    this.sunArrow.visible = pos.up;

    this.patchDirty = true;
  }

  /** 重建光斑(在渲染循环里按需执行,避免频繁卡顿) */
  private flushPatches(): void {
    if (!this.patchDirty || !this.roomBuild) return;
    this.patchDirty = false;
    if (!this.sunPos.up) {
      rebuildPatches(this.patchGroup, [], this.room, null);
      return;
    }
    const t = Math.min(1, this.sunPos.elevation / (Math.PI / 3));
    const color = new THREE.Color().setHSL(0.1 + 0.03 * t, 0.6 - 0.35 * t, 0.6);
    rebuildPatches(this.patchGroup, this.windows, this.room, {
      sunDir: this.sunDir.clone(),
      intensity: 0.85,
      color,
      colliders: this.roomBuild.colliders,
    });
  }

  // ---------- 采光标记 ----------

  setMarks(marks: DaylightMark[]): void {
    this.marks.setMarks(marks);
  }

  /** 家具遮挡体(供标记照度采样) */
  getFurniture(): THREE.Object3D[] {
    return this.roomBuild?.furniture ?? [];
  }

  /** 当前太阳方向(指向太阳) */
  getSunDir(): THREE.Vector3 {
    return this.sunDir.clone();
  }

  setMarkMode(enabled: boolean): void {
    this.markMode = enabled;
    this.controls.enabled = !enabled;
    if (!enabled) {
      this.dragStart = null;
      this.marks.setPreview(null);
    }
    this.renderer.domElement.style.cursor = enabled ? 'crosshair' : '';
  }

  private floorPoint(e: PointerEvent): THREE.Vector2 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, p)) return null;
    const hw = this.room.width / 2;
    const hd = this.room.depth / 2;
    return new THREE.Vector2(
      Math.max(-hw, Math.min(hw, p.x)),
      Math.max(-hd, Math.min(hd, p.z)),
    );
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.markMode || e.button !== 0) return;
    const p = this.floorPoint(e);
    if (p) {
      this.dragStart = p;
      e.stopPropagation();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.markMode || !this.dragStart) return;
    const p = this.floorPoint(e);
    if (!p) return;
    this.marks.setPreview(this.rectFrom(this.dragStart, p));
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.markMode || !this.dragStart) return;
    const p = this.floorPoint(e);
    const start = this.dragStart;
    this.dragStart = null;
    this.marks.setPreview(null);
    if (!p) return;
    const rect = this.rectFrom(start, p);
    if (rect.w > 0.2 && rect.d > 0.2 && this.onMarkRect) {
      this.onMarkRect(rect);
    }
  };

  private rectFrom(a: THREE.Vector2, b: THREE.Vector2): MarkRect {
    return {
      cx: (a.x + b.x) / 2,
      cz: (a.y + b.y) / 2,
      w: Math.abs(a.x - b.x),
      d: Math.abs(a.y - b.y),
    };
  }

  // ---------- 点云 ----------

  async loadCloud(url: string): Promise<void> {
    this.unloadCloud();
    const cloud = await loadPointCloud(url);
    if (this.disposed) return;
    this.cloud = cloud;
    this.scene.add(cloud.object);
  }

  unloadCloud(): void {
    if (this.cloud) {
      this.scene.remove(this.cloud.object);
      this.cloud = null;
    }
  }

  // ---------- 渲染循环 ----------

  private loop = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    this.controls.update();
    this.flushPatches();
    if (this.cloud) this.cloud.update(this.camera, this.renderer);
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
