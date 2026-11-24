/**
 * 查看器控制器：把渲染器、场景、辉光管线、遮挡采样串成一个每帧循环。
 */

import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { BloomPipeline, type RenderStats } from './pipeline';
import { createScene, type SceneBundleWithUpdate } from '../scene/scene';
import { createVisibilityRaycaster, sampleVisibility, smoothVisibility } from '../core/occlusion';
import type { LevelState, ViewMode } from '../core/constants';

// 全部网格启用 BVH 加速射线查询（遮挡采样每帧要打几十条射线）
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

export interface ViewerParams {
  threshold: number;
  knee: number;
  intensity: number;
  exposure: number;
  levels: LevelState[];
  view: ViewMode;
  occlusionEnabled: boolean;
  occlusionStrength: number;
  autoRotate: boolean;
  objectsEnabled: boolean[];
}

export interface ViewerSnapshot {
  fps: number;
  stats: RenderStats;
  width: number;
  height: number;
  occlusion: { visible: number; gain: number }[];
  occluderCount: number;
  triangles: number;
}

export interface ViewerOptions {
  container: HTMLElement;
  params: ViewerParams;
  onSnapshot?: (snapshot: ViewerSnapshot) => void;
}

const MAX_PIXEL_RATIO = 2;

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly pipeline: BloomPipeline;
  readonly bundle: SceneBundleWithUpdate;

  private readonly container: HTMLElement;
  private readonly raycaster = createVisibilityRaycaster();
  private readonly visibles: number[];
  private readonly raws: number[];
  private params: ViewerParams;
  private onSnapshot?: (snapshot: ViewerSnapshot) => void;

  private rafId = 0;
  private running = false;
  private lastTime = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fps = 0;
  private snapshotTimer = 0;
  private disposed = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(options: ViewerOptions) {
    this.container = options.container;
    this.params = options.params;
    this.onSnapshot = options.onSnapshot;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('aria-label', '辉光场景视图');
    this.renderer.domElement.tabIndex = 0;

    const size = this.measure();
    this.renderer.setSize(size.width, size.height, false);

    const bundle = createScene({
      renderer: this.renderer,
      domElement: this.renderer.domElement,
      width: size.width,
      height: size.height,
    });
    this.bundle = bundle;
    this.bundle.camera.aspect = size.width / size.height;
    this.bundle.camera.updateProjectionMatrix();

    // 为遮挡几何体构建 BVH，加速射线查询
    for (const occluder of this.bundle.occluders) {
      if (occluder instanceof THREE.Mesh) {
        occluder.geometry.computeBoundsTree();
      }
    }

    this.pipeline = new BloomPipeline(this.renderer, this.bundle, this.params.levels);
    this.pipeline.setParams({
      threshold: this.params.threshold,
      knee: this.params.knee,
      intensity: this.params.intensity,
      exposure: this.params.exposure,
      levels: this.params.levels,
      view: this.params.view,
      occlusionEnabled: this.params.occlusionEnabled,
      occlusionStrength: this.params.occlusionStrength,
    });
    this.pipeline.setObjectsEnabled(this.params.objectsEnabled);
    this.bundle.controls.autoRotate = this.params.autoRotate;

    this.visibles = this.bundle.emissives.map(() => 1);
    this.raws = this.bundle.emissives.map(() => 1);
    this.pipeline.applyVisibility(this.visibles);

    // 相机/控制器改变 → 源变脏
    this.bundle.controls.addEventListener('change', () => this.pipeline.invalidateSource());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', this.resize);

    // 初始尺寸校正（容器可能刚挂载）
    this.resize();
  }

  private measure(): { width: number; height: number } {
    const rect = this.container.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  }

  private resize(): void {
    if (this.disposed) return;
    const { width, height } = this.measure();
    if (width < 2 || height < 2) return;

    this.renderer.setSize(width, height, false);
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(ratio);

    this.bundle.camera.aspect = width / height;
    this.bundle.camera.updateProjectionMatrix();

    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.pipeline.setSize(width, height, ratio);
    void buffer;
    this.pipeline.invalidateSource();
  }

  setParams(next: Partial<ViewerParams>): void {
    const merged: ViewerParams = { ...this.params, ...next };
    if (next.levels) merged.levels = next.levels.map((l) => ({ ...l }));
    if (next.objectsEnabled) merged.objectsEnabled = [...next.objectsEnabled];
    this.params = merged;

    this.pipeline.setParams({
      threshold: merged.threshold,
      knee: merged.knee,
      intensity: merged.intensity,
      exposure: merged.exposure,
      levels: merged.levels,
      view: merged.view,
      occlusionEnabled: merged.occlusionEnabled,
      occlusionStrength: merged.occlusionStrength,
    });
    this.pipeline.setObjectsEnabled(merged.objectsEnabled);
    this.bundle.controls.autoRotate = merged.autoRotate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.frame(dt);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame(dt: number): void {
    // 场景是静态的；唯一的动态来源是环绕相机。
    const sceneAnimated = this.bundle.update();

    // 控制器阻尼 + 自动环绕
    const cameraMoved = this.bundle.controls.update(dt);

    // 遮挡采样：相机或物体变化时可见比例会变，必须每帧重新估算
    this.updateOcclusion(dt);

    if (cameraMoved || sceneAnimated) this.pipeline.invalidateSource();

    this.pipeline.render();

    // FPS
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    this.snapshotTimer += dt;
    if (this.snapshotTimer >= 0.25) {
      this.snapshotTimer = 0;
      this.emitSnapshot();
    }
  }

  private updateOcclusion(dt: number): void {
    const emissives = this.bundle.emissives;
    const camera = this.bundle.camera;
    let changed = false;

    for (let i = 0; i < emissives.length; i++) {
      const e = emissives[i]!;
      if (!e.enabled) {
        // 关闭的物体不产生辉光，可见比例无关紧要
        this.raws[i] = 1;
        this.visibles[i] = 1;
        continue;
      }
      const result = sampleVisibility(e.mesh, camera, this.bundle.occluders, this.raycaster, 16);
      // 完全被遮挡时直接归零，不留残影；其余平滑跟随
      const target = result.samples === 0 ? 1 : result.visible;
      this.raws[i] = target;
      const next = smoothVisibility(this.visibles[i]!, target, dt, 0.07);
      if (Math.abs(next - this.visibles[i]!) > 1e-4) changed = true;
      this.visibles[i] = next;
    }

    if (changed || this.params.occlusionEnabled) {
      this.pipeline.applyVisibility(this.visibles);
    }
  }

  /** 当前帧的辉光 pass 计划（自动化验证用，不触发渲染）。 */
  debugState(): {
    width: number;
    height: number;
    pending: string[];
    last: string[];
    lastActive: string[];
    gains: { visible: number; gain: number }[];
    visibles: number[];
    occluderCount: number;
    levels: { radius: number; weight: number }[];
    view: ViewMode;
  } {
    return {
      width: this.pipeline.size.width,
      height: this.pipeline.size.height,
      pending: this.pipeline.pendingPasses(),
      last: [...this.pipeline.lastPassNames],
      lastActive: [...this.pipeline.lastActivePassNames],
      gains: this.pipeline.occlusionGains.map((g) => ({ ...g })),
      visibles: [...this.visibles],
      occluderCount: this.bundle.occluders.length,
      levels: this.params.levels.map((l) => ({ ...l })),
      view: this.params.view,
    };
  }

  /** 读取当前视图合成后的像素统计（自动化验证用）。 */
  debugPixelStats(): { litRatio: number; avg: number; max: number; width: number; height: number } {
    const { bytes, width, height } = this.pipeline.readCompositeBytes();
    let lit = 0;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      const l = Math.max(bytes[i]!, bytes[i + 1]!, bytes[i + 2]!);
      sum += l;
      if (l > 24) lit++;
      if (l > max) max = l;
    }
    const n = bytes.length / 4;
    return { litRatio: lit / n, avg: sum / n, max, width, height };
  }

  private emitSnapshot(): void {
    if (!this.onSnapshot) return;
    const size = this.pipeline.size;
    this.onSnapshot({
      fps: this.fps,
      stats: this.pipeline.stats,
      width: size.width,
      height: size.height,
      occlusion: this.pipeline.occlusionGains.map((g) => ({ visible: g.visible, gain: g.gain })),
      occluderCount: this.bundle.occluders.length,
      triangles: this.renderer.info.render.triangles,
    });
  }

  /** 供 UI 读取当前可见比例（原始，不经过平滑）。 */
  get visibility(): readonly number[] {
    return this.raws;
  }

  get gains(): readonly { visible: number; gain: number }[] {
    return this.pipeline.occlusionGains;
  }

  get currentParams(): ViewerParams {
    return this.params;
  }

  /** 设置自发光强度（调参用：平衡核心色彩与辉光提取）。 */
  debugSetEmissiveIntensity(value: number): void {
    for (const e of this.bundle.emissives) {
      e.material.emissiveIntensity = value;
      e.material.needsUpdate = true;
    }
    this.pipeline.invalidateSource();
  }

  /** 标脏整条辉光链（自动化验证用）。 */
  invalidateSource(): void {
    this.pipeline.invalidateSource();
  }

  /**
   * 计算「只改某一级半径」时会执行的 pass 计划（纯计算，不改任何状态）。
   * 供自动化验证「半径改动只重算该级及以上」。
   */
  debugProbeRadius(level: number): string[] {
    return this.pipeline.previewRadiusPlan(level);
  }

  /** 计算「只改某一级权重」时会执行的 pass 计划。 */
  debugProbeWeight(level: number): string[] {
    return this.pipeline.previewWeightPlan(level);
  }

  async capturePNG(): Promise<{ blob: Blob; width: number; height: number }> {
    return this.pipeline.exportPNG();
  }

  /** 同步读取最终合成后的字节像素（用于自动化验证）。 */
  readCompositeBytes(): { bytes: Uint8Array; width: number; height: number } {
    return this.pipeline.readCompositeBytes();
  }

  /** 读取某屏幕像素处的辉光峰值（验证遮挡联动用）。 */
  readGlowPeak(): number {
    return this.pipeline.debugReadTarget('down', 0).max;
  }

  /** 直接设置相机环绕角度（自动化验证用）。 */
  setCameraOrbit(azimuth: number, polar: number, distance?: number): void {
    const camera = this.bundle.camera;
    const target = this.bundle.controls.target;
    const radius = distance ?? camera.position.distanceTo(target);
    camera.position.set(
      target.x + radius * Math.sin(polar) * Math.sin(azimuth),
      target.y + radius * Math.cos(polar),
      target.z + radius * Math.sin(polar) * Math.cos(azimuth),
    );
    camera.lookAt(target);
    this.bundle.controls.update();
    this.pipeline.invalidateSource();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.resize);
    this.pipeline.dispose();
    this.bundle.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
