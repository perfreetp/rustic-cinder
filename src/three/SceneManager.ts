import * as THREE from 'three';
import type { LightingConfig, ProfilePoint, WeaveBuffers } from '../core/types';
import { createFamilyMeshes, type FamilyMeshes } from './geometry';

/**
 * three.js 场景管理：渲染器/相机/轨道控制、侧光与背光两套灯光、
 * 竹篾物理材质、内外层网格的遮挡与半透明叠加顺序。
 * 全部篾条仅 4 个网格（A/B 族 × 外/内层），draw call 与篾条数无关。
 */

interface OrbitState {
  theta: number;
  phi: number;
  radius: number;
  targetY: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
  vTheta: number;
  vPhi: number;
}

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly orbit: OrbitState;
  private readonly container: HTMLElement;
  private resizeObserver: ResizeObserver;

  private readonly weaveGroup = new THREE.Group();
  private families: FamilyMeshes[] = [];

  private readonly keyLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly backLight: THREE.PointLight;
  private readonly bulb: THREE.Mesh;

  private outerMaterial!: THREE.MeshPhysicalMaterial;
  private innerMaterial!: THREE.MeshPhysicalMaterial;
  private surfaceMaterial!: THREE.MeshPhysicalMaterial;
  private refSurface: THREE.Mesh | null = null;
  private profileLine: THREE.Line | null = null;

  private raf = 0;
  private disposed = false;

  constructor(container: HTMLElement) {
    this.container = container;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(38, w / h, 1, 20000);
    this.orbit = {
      theta: Math.PI * 0.25,
      phi: Math.PI * 0.42,
      radius: 320,
      targetY: 110,
      dragging: false,
      lastX: 0,
      lastY: 0,
      vTheta: 0,
      vPhi: 0,
    };

    this.scene.add(this.weaveGroup);

    // 灯光
    this.hemi = new THREE.HemisphereLight(0xfff4e0, 0x3a2c1c, 0.4);
    this.scene.add(this.hemi);

    this.keyLight = new THREE.DirectionalLight(0xfff1d6, 1.6);
    this.keyLight.position.set(180, 240, 160);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0xdfeaff, 0.7);
    this.rimLight.position.set(-160, 120, -180);
    this.scene.add(this.rimLight);

    this.backLight = new THREE.PointLight(0xffb85e, 0, 600, 1.6);
    this.backLight.position.set(0, 110, 0);
    this.scene.add(this.backLight);

    this.bulb = new THREE.Mesh(
      new THREE.SphereGeometry(6, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 }),
    );
    this.scene.add(this.bulb);

    this.buildMaterials();
    this.attachControls();
    this.applyCamera();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.loop();
  }

  private buildMaterials() {
    const common: Partial<THREE.MeshPhysicalMaterialParameters> = {
      color: new THREE.Color('#c9a063'),
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.85,
      clearcoatRoughness: 0.18,
      sheen: 0.25,
      sheenColor: new THREE.Color('#e8c98f'),
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
    };
    // 外层：负责主遮挡，深度写入
    this.outerMaterial = new THREE.MeshPhysicalMaterial({ ...common });
    // 内层：稍高透明度以体现叠层，渲染顺序先于外层
    this.innerMaterial = new THREE.MeshPhysicalMaterial({
      ...common,
      roughness: 0.5,
      clearcoat: 0.6,
      depthWrite: false,
    });
    this.surfaceMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#b9d6c8'),
      roughness: 0.25,
      metalness: 0,
      transmission: 0.6,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  // ---------- 编织网格 ----------

  setWeaveBuffers(familyA: WeaveBuffers, familyB: WeaveBuffers) {
    this.clearFamilies();
    // 渲染顺序：两族内层(10/11) → 两族外层(20/21)，同层内先 B 后 A 保证交叉遮挡一致
    const a = createFamilyMeshes(familyA, this.outerMaterial);
    const b = createFamilyMeshes(familyB, this.outerMaterial);
    a.inner.material = this.innerMaterial;
    b.inner.material = this.innerMaterial;
    a.outer.renderOrder = 21;
    b.outer.renderOrder = 20;
    a.inner.renderOrder = 11;
    b.inner.renderOrder = 10;
    this.weaveGroup.add(b.outer, b.inner, a.outer, a.inner);
    this.families = [a, b];
  }

  private clearFamilies() {
    for (const f of this.families) {
      this.weaveGroup.remove(f.outer, f.inner);
      f.dispose();
    }
    this.families = [];
  }

  // ---------- 参考曲面与母线 ----------

  setReferenceProfile(points: ProfilePoint[], showSurface: boolean, showProfile: boolean) {
    if (this.refSurface) {
      this.weaveGroup.remove(this.refSurface);
      this.refSurface.geometry.dispose();
      this.refSurface = null;
    }
    if (this.profileLine) {
      this.weaveGroup.remove(this.profileLine);
      this.profileLine.geometry.dispose();
      this.profileLine = null;
    }
    if (points.length < 2) return;

    if (showSurface) {
      const lathePts = points.map((p) => new THREE.Vector2(Math.max(0.1, p.r), p.z));
      const geo = new THREE.LatheGeometry(lathePts, 96);
      this.refSurface = new THREE.Mesh(geo, this.surfaceMaterial);
      this.refSurface.renderOrder = 1;
      this.weaveGroup.add(this.refSurface);
    }
    if (showProfile) {
      const geo = new THREE.BufferGeometry().setFromPoints(
        points.map((p) => new THREE.Vector3(p.r, p.z, 0)),
      );
      const mat = new THREE.LineBasicMaterial({ color: 0x2f6f5e, transparent: true, opacity: 0.9 });
      this.profileLine = new THREE.Line(geo, mat);
      this.profileLine.renderOrder = 30;
      this.weaveGroup.add(this.profileLine);
    }
  }

  /** 视口居中到灯罩高度，并按包围球+相机视场角精确取景 */
  setModelHeight(height: number, maxRadius: number) {
    this.weaveGroup.position.y = -height * 0.5;
    this.orbit.targetY = 0;
    this.bulb.position.y = 0;
    this.backLight.position.y = 0;
    // 包围球半径（模型已居中到原点）
    const boundR = Math.hypot(height * 0.5, maxRadius);
    // 让包围球在垂直+水平视场内都留 12% 边距
    const fovV = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1;
    const distV = boundR / Math.sin(fovV * 0.5);
    const fovH = 2 * Math.atan(Math.tan(fovV * 0.5) * aspect);
    const distH = boundR / Math.sin(fovH * 0.5);
    const fit = Math.max(distV, distH) * 1.12;
    this.orbit.radius = THREE.MathUtils.clamp(fit, 60, 8000);
    this.applyCamera();
  }

  // ---------- 光照/材质 ----------

  applyLighting(cfg: LightingConfig) {
    const col = new THREE.Color(cfg.color);
    for (const m of [this.outerMaterial, this.innerMaterial]) {
      m.color.copy(col);
      m.opacity = cfg.opacity;
      m.clearcoat = cfg.gloss;
      m.needsUpdate = true;
    }

    const side = cfg.mode === 'side';
    const ang = (cfg.sideAngle * Math.PI) / 180;
    this.keyLight.position.set(Math.cos(ang) * 220, 160, Math.sin(ang) * 220);
    this.keyLight.intensity = side ? cfg.sideIntensity : cfg.sideIntensity * 0.18;
    this.rimLight.intensity = side ? cfg.sideIntensity * 0.45 : 0.1;
    this.hemi.intensity = cfg.ambient;

    // 背光：内部点光源 + 低环境，观察透缝与油亮高光
    this.backLight.intensity = side ? 0 : cfg.backIntensity * 18;
    (this.bulb.material as THREE.MeshBasicMaterial).opacity = side ? 0 : 0.9;

    this.scene.background = new THREE.Color(side ? 0xf3efe6 : 0x141210);
    this.renderer.toneMappingExposure = side ? 1.05 : 1.15;
  }

  // ---------- 轨道控制 ----------

  private attachControls() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
  }

  private onContextMenu = (e: Event) => e.preventDefault();

  private onPointerDown = (e: PointerEvent) => {
    this.orbit.dragging = true;
    this.orbit.lastX = e.clientX;
    this.orbit.lastY = e.clientY;
    this.orbit.vTheta = 0;
    this.orbit.vPhi = 0;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.orbit.dragging) return;
    const dx = e.clientX - this.orbit.lastX;
    const dy = e.clientY - this.orbit.lastY;
    this.orbit.lastX = e.clientX;
    this.orbit.lastY = e.clientY;
    const k = 0.006;
    this.orbit.theta -= dx * k;
    this.orbit.phi = THREE.MathUtils.clamp(this.orbit.phi - dy * k, 0.08, Math.PI - 0.08);
    this.orbit.vTheta = -dx * k;
    this.orbit.vPhi = -dy * k;
  };

  private onPointerUp = () => {
    this.orbit.dragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0011);
    this.orbit.radius = THREE.MathUtils.clamp(this.orbit.radius * factor, 30, 6000);
  };

  private applyCamera() {
    const { theta, phi, radius, targetY } = this.orbit;
    this.camera.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      targetY + radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    );
    this.camera.lookAt(0, targetY, 0);
  }

  private handleResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.orbit.dragging) {
      // 惯性阻尼
      this.orbit.theta += this.orbit.vTheta;
      this.orbit.phi = THREE.MathUtils.clamp(this.orbit.phi + this.orbit.vPhi, 0.08, Math.PI - 0.08);
      this.orbit.vTheta *= 0.92;
      this.orbit.vPhi *= 0.92;
    }
    this.applyCamera();
    this.renderer.render(this.scene, this.camera);
  };

  getStats(): { drawCalls: number; triangles: number } {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
    this.clearFamilies();
    this.refSurface?.geometry.dispose();
    this.profileLine?.geometry.dispose();
    this.outerMaterial.dispose();
    this.innerMaterial.dispose();
    this.surfaceMaterial.dispose();
    this.renderer.dispose();
    el.parentElement?.removeChild(el);
  }
}
