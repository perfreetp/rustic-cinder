import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStudioEnvironment } from './environment';
import type { MaterialSettings } from '../core/types';

export interface ViewportCallbacks {
  /** 主键按下: 返回是否消费 (false 时交给 orbit) */
  onStrokeStart: (info: StrokePointer) => boolean;
  onStrokeMove: (info: StrokePointer) => void;
  onStrokeEnd: (info: StrokePointer) => void;
  /** 单独取景 (相机变化) */
  onCameraChange?: () => void;
}

export interface StrokePointer {
  /** 命中点 (世界坐标); 未命中表面时为 null */
  point: THREE.Vector3 | null;
  /** 命中点法线 (世界坐标) */
  normal: THREE.Vector3 | null;
  /** 射线方向 */
  ray: THREE.Ray;
  /** NDC 坐标 */
  ndc: THREE.Vector2;
  /** 是否命中模型 */
  hit: boolean;
  shift: boolean;
  alt: boolean;
  button: number;
}

/**
 * three.js 视口: 相机 / 控制器 / 材质 / 网格替换 / 笔刷光标 / 环境反射。
 * 所有 DOM 事件在这里转成 StrokePointer 交给上层, 保持渲染与交互解耦。
 */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private container: HTMLElement;
  private envTexture: THREE.Texture;
  private raycaster = new THREE.Raycaster();
  private material: THREE.MeshPhysicalMaterial;
  private mesh: THREE.Mesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private brushCursor: THREE.Group;
  private brushRing: THREE.Mesh;
  private brushRingSoft: THREE.Mesh;
  private mirrorGhosts: THREE.Group;
  private resizeObserver: ResizeObserver;
  private lastFrame = performance.now();
  private callbacks: ViewportCallbacks;
  private pointers = new Map<number, { x: number; y: number; button: number }>();
  private dragging = false;
  private orbiting = false;
  private animationId = 0;
  private autoRotate = false;
  private groundPlane: THREE.Mesh;
  private gridHelper: THREE.Group;
  private disposed = false;

  constructor(container: HTMLElement, callbacks: ViewportCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#111316');

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
    this.camera.position.set(2.15, 1.55, 2.75);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 1.1;
    this.controls.maxDistance = 12;
    this.controls.target.set(0, 0.02, 0);
    this.controls.rotateSpeed = 0.9;
    this.controls.zoomSpeed = 0.8;
    this.controls.panSpeed = 0.7;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.callbacks.onCameraChange?.());

    this.envTexture = createStudioEnvironment(this.renderer);
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 1;

    // 主光 (给几何一点方向性, 环境光负责大部分反射)
    const key = new THREE.DirectionalLight(0xfff2e2, 2.1);
    key.position.set(4.2, 6.2, 4.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 24;
    key.shadow.camera.left = -3.2;
    key.shadow.camera.right = 3.2;
    key.shadow.camera.top = 3.2;
    key.shadow.camera.bottom = -3.2;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xa9c2ff, 0.55);
    fill.position.set(-5.4, 2.4, -3.2);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffd9b0, 0.6);
    rim.position.set(-1.6, 3.2, -5.2);
    this.scene.add(rim);

    // 地面 + 网格
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9, 96),
      new THREE.MeshStandardMaterial({
        color: 0x1a1d22,
        roughness: 0.92,
        metalness: 0.0,
        envMapIntensity: 0.35,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.42;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.groundPlane = ground;

    this.gridHelper = buildGrid();
    this.gridHelper.position.y = -1.415;
    this.scene.add(this.gridHelper);

    this.material = makeMaterial({
      preset: 'clay',
      color: '#c96f52',
      roughness: 0.62,
      metalness: 0.02,
      clearcoat: 0.18,
      clearcoatRoughness: 0.5,
      envIntensity: 0.85,
    });

    // 笔刷光标
    this.brushCursor = new THREE.Group();
    // 笔刷环在表面上做标记: 用 polygonOffset 避免与表面 z-fighting, 但仍接受深度遮挡
    this.brushRing = new THREE.Mesh(
      new THREE.RingGeometry(0.975, 1.0, 72),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.brushRingSoft = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 72),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.brushRing.renderOrder = 20;
    this.brushRingSoft.renderOrder = 19;
    this.brushCursor.add(this.brushRing, this.brushRingSoft);
    this.brushCursor.visible = false;
    this.scene.add(this.brushCursor);

    this.mirrorGhosts = new THREE.Group();
    this.scene.add(this.mirrorGhosts);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.bindEvents();
    this.loop();
  }

  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
    el.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    el.addEventListener('pointerup', this.handlePointerUp, { passive: false });
    el.addEventListener('pointercancel', this.handlePointerUp, { passive: false });
    el.addEventListener('pointerleave', this.handlePointerLeave);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private lastNdc = new THREE.Vector2();

  private makePointer(e: PointerEvent): StrokePointer {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.lastNdc.copy(ndc);
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray.clone();
    let point: THREE.Vector3 | null = null;
    let normal: THREE.Vector3 | null = null;
    let hit = false;
    if (this.mesh) {
      const hits = this.raycaster.intersectObject(this.mesh, false);
      if (hits.length) {
        hit = true;
        point = hits[0].point.clone();
        const n = hits[0].face?.normal.clone() ?? new THREE.Vector3(0, 1, 0);
        n.applyQuaternion(this.mesh.quaternion);
        normal = n.normalize();
      }
    }
    if (!hit) {
      // 没打中模型: 用一个经过相机视点的正中平面承接, 方便在空白处起笔
      const plane = new THREE.Plane();
      const camDir = this.camera.getWorldDirection(new THREE.Vector3());
      plane.setFromNormalAndCoplanarPoint(camDir.clone().negate(), new THREE.Vector3(0, 0.02, 0));
      const pt = ray.intersectPlane(plane, new THREE.Vector3());
      if (pt) {
        point = pt;
        normal = camDir.clone().negate();
      }
    }
    return {
      point,
      normal,
      ray,
      ndc,
      hit,
      shift: e.shiftKey,
      alt: e.altKey,
      button: e.button,
    };
  }

  private handlePointerDown = (e: PointerEvent) => {
    if (e.button === 0 && !e.altKey && !this.spaceDown) {
      const info = this.makePointer(e);
      const consumed = this.callbacks.onStrokeStart(info);
      if (consumed) {
        e.preventDefault();
        this.controls.enabled = false;
        this.dragging = true;
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
      }
    }
  };

  private handlePointerMove = (e: PointerEvent) => {
    const info = this.makePointer(e);
    if (this.dragging) {
      e.preventDefault();
      this.callbacks.onStrokeMove(info);
    } else {
      this.callbacks.onStrokeMove({ ...info, hit: false, point: info.point });
    }
    this.updateCursor(info);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
  };

  private handlePointerUp = (e: PointerEvent) => {
    if (this.dragging) {
      const info = this.makePointer(e);
      this.dragging = false;
      this.controls.enabled = true;
      try {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      this.callbacks.onStrokeEnd(info);
    }
    this.pointers.delete(e.pointerId);
  };

  private handlePointerLeave = () => {
    this.brushCursor.visible = false;
    this.mirrorGhosts.visible = false;
  };

  /** 观察模式 (按住空格临时切换) 由上层控制 */
  private spaceDown = false;
  setSpaceDown(v: boolean) {
    this.spaceDown = v;
  }

  setCursor(radius: number, color: string, opacity: number, visible: boolean) {
    this.brushRing.scale.setScalar(radius);
    this.brushRingSoft.scale.setScalar(radius * 1.06);
    (this.brushRing.material as THREE.MeshBasicMaterial).color.set(color);
    (this.brushRing.material as THREE.MeshBasicMaterial).opacity = opacity;
    (this.brushRingSoft.material as THREE.MeshBasicMaterial).color.set(color);
    this.brushCursor.visible = visible;
  }

  private updateCursor(info: StrokePointer) {
    if (!info.point || !info.normal) {
      this.brushCursor.visible = false;
      return;
    }
    // 环稍微抬离表面, 沿法线朝向观察者可见
    this.brushCursor.position.copy(info.point).addScaledVector(info.normal, 0.002);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), info.normal);
    this.brushCursor.quaternion.copy(q);
  }

  /** 选中笔的高亮虚线包围盒 */
  private selectionBox: THREE.LineSegments | null = null;
  showSelection(min: [number, number, number] | null, max: [number, number, number] | null) {
    if (!this.selectionBox) {
      const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
      const mat = new THREE.LineBasicMaterial({ color: 0xe0a06a, transparent: true, opacity: 0.85 });
      this.selectionBox = new THREE.LineSegments(geo, mat);
      this.selectionBox.renderOrder = 30;
      (this.selectionBox.material as THREE.Material).depthTest = false;
      this.scene.add(this.selectionBox);
    }
    if (!min || !max) {
      this.selectionBox.visible = false;
      return;
    }
    this.selectionBox.visible = true;
    this.selectionBox.scale.set(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    this.selectionBox.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  }

  /** 镜像提示环 */
  setMirrorGhost(x: number, y: number, z: number, axis: 'x' | 'y' | 'z' | null, visible: boolean) {
    while (this.mirrorGhosts.children.length) {
      const c = this.mirrorGhosts.children.pop()!;
      if (c instanceof THREE.Mesh) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    }
    this.mirrorGhosts.visible = visible && !!axis;
    if (!axis) return;
    const mirrored = new THREE.Vector3(
      axis === 'x' ? -x : x,
      axis === 'y' ? -y : y,
      axis === 'z' ? -z : z,
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1.0, 64),
      new THREE.MeshBasicMaterial({
        color: 0x7fd3ff,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.scale.setScalar(0.24);
    ring.position.copy(mirrored);
    ring.renderOrder = 18;
    this.mirrorGhosts.add(ring);
  }

  setMaterial(settings: MaterialSettings) {
    const m = this.material;
    m.color.set(settings.color);
    m.roughness = settings.roughness;
    m.metalness = settings.metalness;
    m.clearcoat = settings.clearcoat;
    m.clearcoatRoughness = settings.clearcoatRoughness;
    m.envMapIntensity = settings.envIntensity;
    m.needsUpdate = true;
    this.scene.environmentIntensity = settings.envIntensity;
  }

  /** 用新的网格替换视口里的造型 (同一 mesh 实例, 便于拾取) */
  setGeometry(positions: Float32Array, normals: Float32Array, indices: Uint32Array) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
    } else {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geo;
    }
    this.geometry = geo;
  }

  /** 根据当前几何把相机的观察中心与距离调好 (只在初次 / 显式取景时调用) */
  frameModel(padding = 1.35) {
    if (!this.mesh) return;
    const box = new THREE.Box3().setFromObject(this.mesh);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = (sphere.radius * padding) / Math.sin((this.camera.fov * Math.PI) / 360);
    const dir = new THREE.Vector3(0.62, 0.42, 0.78).normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, Math.max(1.6, dist));
    this.controls.update();
  }

  setAutoRotate(v: boolean) {
    this.autoRotate = v;
    this.controls.autoRotate = v;
    this.controls.autoRotateSpeed = 0.55;
  }

  setGridVisible(v: boolean) {
    this.gridHelper.visible = v;
    this.groundPlane.visible = v;
  }

  resetCamera() {
    this.camera.position.set(2.15, 1.55, 2.75);
    this.controls.target.set(0, 0.02, 0);
    this.controls.update();
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.animationId = requestAnimationFrame(this.loop);
    this.lastFrame = performance.now();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  get canvas() {
    return this.renderer.domElement;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.handlePointerDown);
    el.removeEventListener('pointermove', this.handlePointerMove);
    el.removeEventListener('pointerup', this.handlePointerUp);
    el.removeEventListener('pointercancel', this.handlePointerUp);
    el.removeEventListener('pointerleave', this.handlePointerLeave);
    this.controls.dispose();
    if (this.selectionBox) {
      this.selectionBox.geometry.dispose();
      (this.selectionBox.material as THREE.Material).dispose();
    }
    this.geometry?.dispose();
    this.material.dispose();
    this.envTexture.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

export function makeMaterial(s: MaterialSettings): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(s.color),
    roughness: s.roughness,
    metalness: s.metalness,
    clearcoat: s.clearcoat,
    clearcoatRoughness: s.clearcoatRoughness,
    envMapIntensity: s.envIntensity,
    sheen: 0.25,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0xffffff),
  });
}

function buildGrid(): THREE.Group {
  const group = new THREE.Group();
  const size = 6;
  const div = 24;
  const positions: number[] = [];
  for (let i = 0; i <= div; i++) {
    const t = (i / div) * size - size / 2;
    positions.push(t, 0, -size / 2, t, 0, size / 2);
    positions.push(-size / 2, 0, t, size / 2, 0, t);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x2a3038, transparent: true, opacity: 0.55 });
  group.add(new THREE.LineSegments(geo, mat));
  return group;
}
