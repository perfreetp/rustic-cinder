/**
 * 辉光渲染管线。
 *
 * 每帧：
 *   1. 把场景渲染到全分辨率 HDR 缓冲（beauty，线性，不做色调映射）
 *   2. 渲染遮挡掩码（每个自发光物体一个 ID + 当前可见比例）
 *   3. 增量执行辉光链：extract → down×4 → blur×5 → acc×5
 *   4. 最终合成 pass 输出到屏幕（ACES + sRGB）
 *
 * 所有渲染目标在尺寸变化时一次性分配，之后每帧复用；
 * 降采样链不会在渲染过程中新建纹理。
 */

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
  ACC_FRAG,
  BLUR_FRAG,
  DOWN_FRAG,
  EXTRACT_FRAG,
  FINAL_FRAG,
  MASK_FRAG,
  MESH_VERT,
  QUAD_VERT,
} from './shaders';
import {
  clearDirty,
  createDirtyFlags,
  levelDimensions,
  markRadiusDirty,
  markSourceDirty,
  markWeightDirty,
  planPasses,
  type DirtyFlags,
} from '../core/pipelinePlan';
import { LEVEL_COUNT, type LevelState, type ViewMode } from '../core/constants';
import type { SceneBundleWithUpdate } from '../scene/scene';

interface QuadMaterialSet {
  extract: THREE.ShaderMaterial;
  down: THREE.ShaderMaterial;
  blur: THREE.ShaderMaterial;
  acc: THREE.ShaderMaterial;
  final: THREE.ShaderMaterial;
}

export interface RenderStats {
  /** 本帧实际执行的全屏 pass 数量 */
  passes: number;
  /** 本帧执行的 pass 名称 */
  passNames: string[];
  /** 最近一次「有实际执行」的 pass 名称（空闲帧不覆盖） */
  lastActivePassNames: string[];
  /** 分配的渲染目标数量 */
  targets: number;
  /** 上一帧 GPU 估算耗时（ms，粗略） */
  cpuMs: number;
}

export interface OcclusionGain {
  visible: number;
  gain: number;
}

function makeHDRTarget(width: number, height: number, depth = false): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: depth,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

/** 9 抽头对称高斯的权重（σ = radius，抽头位于 0..4 像素）。 */
export function gaussianWeights(radius: number): number[] {
  const sigma = Math.max(0.35, radius);
  const w: number[] = [];
  let sum = 0;
  for (let i = 0; i <= 4; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    w.push(v);
    sum += i === 0 ? v : v * 2;
  }
  return w.map((v) => v / sum);
}

/** 从干净的脏标记出发，仅标记某一级的变化，得出应有的 pass 计划。 */
function previewPlan(level: number, kind: 'radius' | 'weight'): string[] {
  const d = createDirtyFlags(LEVEL_COUNT);
  clearDirty(d);
  if (kind === 'radius') markRadiusDirty(d, level);
  else markWeightDirty(d, level);
  return planPasses(d);
}

export class BloomPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private readonly sceneBundle: SceneBundleWithUpdate;

  private width = 1;
  private height = 1;

  private beautyRT!: THREE.WebGLRenderTarget;
  private maskRT!: THREE.WebGLRenderTarget;
  private downRT: THREE.WebGLRenderTarget[] = [];
  private blurTmpRT: THREE.WebGLRenderTarget[] = [];
  private blurRT: THREE.WebGLRenderTarget[] = [];
  private accRT: THREE.WebGLRenderTarget[] = [];

  private materials!: QuadMaterialSet;
  private quad!: FullScreenQuad;

  // 遮挡掩码代理
  private maskScene = new THREE.Scene();
  private maskMaterials: THREE.ShaderMaterial[] = [];

  private dirty: DirtyFlags = createDirtyFlags(LEVEL_COUNT);
  private levels: LevelState[] = [];
  private threshold = 1;
  private knee = 0.3;
  private intensity = 1;
  private exposure = 1;
  private view: ViewMode = 'final';
  private occlusionStrength = 1;
  private occlusionEnabled = true;
  private gains: OcclusionGain[] = [];

  readonly stats: RenderStats = {
    passes: 0,
    passNames: [],
    lastActivePassNames: [],
    targets: 0,
    cpuMs: 0,
  };

  private exportRT: THREE.WebGLRenderTarget | null = null;

  constructor(renderer: THREE.WebGLRenderer, sceneBundle: SceneBundleWithUpdate, levels: LevelState[]) {
    this.renderer = renderer;
    this.sceneBundle = sceneBundle;
    this.levels = levels.map((l) => ({ ...l }));

    renderer.autoClear = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.buildMaterials();
    this.buildMaskProxies(sceneBundle);
    this.gains = sceneBundle.emissives.map(() => ({ visible: 1, gain: 1 }));

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.allocate(size.x, size.y);
  }

  private buildMaterials(): void {
    const extract = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: EXTRACT_FRAG,
      uniforms: {
        uBeauty: { value: null },
        uMask: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uThreshold: { value: 1 },
        uKnee: { value: 0.3 },
        uUseMask: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });

    const down = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: DOWN_FRAG,
      uniforms: { uTex: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) } },
      depthTest: false,
      depthWrite: false,
    });

    const blur = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: {
        uTex: { value: null },
        uDir: { value: new THREE.Vector2() },
        uW0: { value: 0.2 },
        uW1: { value: 0.2 },
        uW2: { value: 0.2 },
        uW3: { value: 0.2 },
        uW4: { value: 0.2 },
      },
      depthTest: false,
      depthWrite: false,
    });

    const acc = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: ACC_FRAG,
      uniforms: {
        uPrev: { value: null },
        uCur: { value: null },
        uWeight: { value: 1 },
        uHasPrev: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    const final = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: FINAL_FRAG,
      uniforms: {
        uBeauty: { value: null },
        uGlow: { value: null },
        uSource: { value: null },
        uMask: { value: null },
        uExposure: { value: 1 },
        uIntensity: { value: 1 },
        uView: { value: 0 },
        uC0: { value: new THREE.Vector3() },
        uC1: { value: new THREE.Vector3() },
        uC2: { value: new THREE.Vector3() },
        uC3: { value: new THREE.Vector3() },
        uC4: { value: new THREE.Vector3() },
        uC5: { value: new THREE.Vector3() },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.materials = { extract, down, blur, acc, final };
    this.quad = new FullScreenQuad(extract);
  }

  private buildMaskProxies(bundle: SceneBundleWithUpdate): void {
    this.maskScene = new THREE.Scene();
    this.maskMaterials = [];
    for (const emissive of bundle.emissives) {
      const material = new THREE.ShaderMaterial({
        vertexShader: MESH_VERT,
        fragmentShader: MASK_FRAG,
        uniforms: {
          uIndex: { value: (emissive.index + 1) / 16 },
          uGain: { value: 1 },
        },
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
      });
      const proxy = new THREE.Mesh(emissive.mesh.geometry, material);
      proxy.name = `mask-${emissive.spec.id}`;
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      this.maskScene.add(proxy);
      this.maskMaterials.push(material);
    }

    // 物体颜色的线性值，用于遮挡掩码视图
    const colors = bundle.emissives.map((e) => {
      const c = new THREE.Color().setRGB(
        e.spec.color[0],
        e.spec.color[1],
        e.spec.color[2],
        THREE.LinearSRGBColorSpace,
      );
      const m = Math.max(c.r, c.g, c.b, 1e-4);
      return new THREE.Vector3(c.r / m, c.g / m, c.b / m);
    });
    const keys = ['uC0', 'uC1', 'uC2', 'uC3', 'uC4', 'uC5'] as const;
    keys.forEach((key, i) => {
      const c = colors[i];
      if (c) (this.materials.final.uniforms[key]!.value as THREE.Vector3).copy(c);
    });
  }

  /** 尺寸变化时重建所有渲染目标（唯一一次分配点）。 */
  private allocate(width: number, height: number): void {
    this.disposeTargets();

    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));

    this.beautyRT = makeHDRTarget(this.width, this.height, true);
    this.maskRT = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    this.downRT = [];
    this.blurTmpRT = [];
    this.blurRT = [];
    this.accRT = [];

    for (let i = 0; i < LEVEL_COUNT; i++) {
      const dim = levelDimensions(this.width, this.height, i);
      this.downRT.push(makeHDRTarget(dim.width, dim.height));
      this.blurTmpRT.push(makeHDRTarget(dim.width, dim.height));
      this.blurRT.push(makeHDRTarget(dim.width, dim.height));

      // 累加缓冲统一在 L0 分辨率
      const l0 = levelDimensions(this.width, this.height, 0);
      this.accRT.push(makeHDRTarget(l0.width, l0.height));
    }

    this.exportRT?.dispose();
    this.exportRT = null;

    markSourceDirty(this.dirty);

    this.stats.targets =
      2 + this.downRT.length + this.blurTmpRT.length + this.blurRT.length + this.accRT.length;
  }

  private disposeTargets(): void {
    this.beautyRT?.dispose();
    this.maskRT?.dispose();
    for (const rt of this.downRT) rt.dispose();
    for (const rt of this.blurTmpRT) rt.dispose();
    for (const rt of this.blurRT) rt.dispose();
    for (const rt of this.accRT) rt.dispose();
    this.downRT = [];
    this.blurTmpRT = [];
    this.blurRT = [];
    this.accRT = [];
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  get drawingBufferSize(): { width: number; height: number } {
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return { width: v.x, height: v.y };
  }

  setSize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    const w = Math.max(1, Math.floor(cssWidth * pixelRatio));
    const h = Math.max(1, Math.floor(cssHeight * pixelRatio));
    if (w === this.width && h === this.height) return;
    this.allocate(w, h);
  }

  setParams(next: {
    threshold: number;
    knee: number;
    intensity: number;
    exposure: number;
    levels: readonly LevelState[];
    view: ViewMode;
    occlusionEnabled: boolean;
    occlusionStrength: number;
  }): void {
    const sourceChanged = next.threshold !== this.threshold || next.knee !== this.knee;

    this.threshold = next.threshold;
    this.knee = next.knee;
    this.intensity = next.intensity;
    this.exposure = next.exposure;
    this.view = next.view;
    this.occlusionEnabled = next.occlusionEnabled;
    this.occlusionStrength = next.occlusionStrength;

    for (let i = 0; i < LEVEL_COUNT; i++) {
      const cur = next.levels[i];
      const old = this.levels[i];
      if (!cur || !old) continue;
      if (cur.radius !== old.radius) {
        // 半径变化：本级 blur + 本级及更粗的 acc
        this.dirty.blur[i] = true;
        for (let k = i; k < LEVEL_COUNT; k++) this.dirty.acc[k] = true;
        old.radius = cur.radius;
      }
      if (cur.weight !== old.weight) {
        for (let k = i; k < LEVEL_COUNT; k++) this.dirty.acc[k] = true;
        old.weight = cur.weight;
      }
    }

    if (sourceChanged) markSourceDirty(this.dirty);
    this.dirty.source = this.dirty.source || sourceChanged;
  }

  /** 相机/场景发生变化时调用。 */
  invalidateSource(): void {
    markSourceDirty(this.dirty);
  }

  /** 当前脏标记对应的待执行 pass 计划（不消耗脏标记，供调试/自动化验证）。 */
  pendingPasses(): string[] {
    return planPasses(this.dirty);
  }

  /**
   * 假设只改动某一级半径，会执行哪些 pass（纯计算，不改动任何状态）。
   * 用于验证「半径改动只重算该级及以上」。
   */
  previewRadiusPlan(level: number): string[] {
    return previewPlan(level, 'radius');
  }

  /** 假设只改动某一级权重，会执行哪些 pass。 */
  previewWeightPlan(level: number): string[] {
    return previewPlan(level, 'weight');
  }

  /** 上一帧实际执行过的 pass。 */
  get lastPassNames(): readonly string[] {
    return this.stats.passNames;
  }

  /** 最近一次有实际执行的 pass（空闲帧不覆盖）。 */
  get lastActivePassNames(): readonly string[] {
    return this.stats.lastActivePassNames;
  }

  /** 设置每个物体的开关状态（与场景里的 bundle.emissives 顺序一致）。 */
  setObjectsEnabled(enabled: readonly boolean[]): void {
    const bundle = this.sceneBundle;
    for (let i = 0; i < bundle.emissives.length; i++) {
      const on = enabled[i] ?? true;
      const e = bundle.emissives[i]!;
      if (e.enabled === on) continue;
      e.enabled = on;
      e.mesh.visible = on;
      const proxy = this.maskScene.children[i];
      if (proxy) proxy.visible = on;
      markSourceDirty(this.dirty);
    }
  }

  /** 遮挡采样得到的增益（供 UI 显示）。 */
  get occlusionGains(): readonly OcclusionGain[] {
    return this.gains;
  }

  /**
   * 更新遮挡增益。
   * 可见比例明显变化时（> 2%）标脏源，让辉光源按新增益重新提取；
   * 阈值避免平滑收敛过程中的微抖动导致整链每帧重算。
   * @param visibles 每个物体平滑后的可见比例（0..1）
   */
  applyVisibility(visibles: readonly number[]): void {
    const w = this.occlusionEnabled ? this.occlusionStrength : 0;
    let significantlyChanged = false;

    for (let i = 0; i < this.gains.length; i++) {
      const v = visibles[i] ?? 1;
      const gain = 1 - (1 - v) * w;
      const prev = this.gains[i];
      if (!prev || Math.abs(prev.gain - gain) > 0.02) significantlyChanged = true;
      this.gains[i] = { visible: v, gain };
      const mat = this.maskMaterials[i];
      if (mat) mat.uniforms.uGain!.value = gain;
    }

    if (significantlyChanged) markSourceDirty(this.dirty);
  }

  /** 同步掩码代理的变换（每帧，跟随自转/浮动）。 */
  private syncMaskProxies(): void {
    const emissives = this.sceneBundle.emissives;
    for (let i = 0; i < emissives.length; i++) {
      const src = emissives[i]!;
      const proxy = this.maskScene.children[i];
      if (!proxy) continue;
      src.mesh.updateWorldMatrix(true, false);
      proxy.matrix.copy(src.mesh.matrixWorld);
      proxy.matrixWorldNeedsUpdate = false;
    }
  }

  private runPass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  /** 渲染一帧并返回执行的 pass 列表。 */
  render(): void {
    const start = performance.now();
    const names: string[] = [];
    const camera = this.sceneBundle.camera;

    this.syncMaskProxies();

    // 源脏时才需要重画场景与掩码（画面与遮挡数据都来自它们）
    const sourceDirty = this.dirty.source;

    if (sourceDirty) {
      // 1. beauty（全分辨率 HDR）
      this.renderer.setRenderTarget(this.beautyRT);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.sceneBundle.scene, camera);

      // 2. 遮挡掩码
      this.renderer.setRenderTarget(this.maskRT);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.maskScene, camera);
    }

    // 3. 辉光链（增量）
    const passes = planPasses(this.dirty);

    const extract = this.materials.extract;
    extract.uniforms.uBeauty!.value = this.beautyRT.texture;
    extract.uniforms.uMask!.value = this.maskRT.texture;
    (extract.uniforms.uTexel!.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
    extract.uniforms.uThreshold!.value = this.threshold;
    extract.uniforms.uKnee!.value = this.knee;
    extract.uniforms.uUseMask!.value = this.occlusionEnabled ? 1 : 0;

    const down = this.materials.down;
    const blur = this.materials.blur;
    const acc = this.materials.acc;

    for (const pass of passes) {
      names.push(pass);

      if (pass === 'extract') {
        this.runPass(extract, this.downRT[0]!);
        continue;
      }

      const downMatch = /^down(\d+)$/.exec(pass);
      if (downMatch) {
        const i = Number(downMatch[1]);
        const src = this.downRT[i - 1]!;
        down.uniforms.uTex!.value = src.texture;
        (down.uniforms.uTexel!.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
        this.runPass(down, this.downRT[i]!);
        continue;
      }

      const blurH = /^blurH(\d+)$/.exec(pass);
      if (blurH) {
        const i = Number(blurH[1]);
        const level = this.levels[i]!;
        const src = this.downRT[i]!;
        const w = gaussianWeights(level.radius);
        blur.uniforms.uTex!.value = src.texture;
        blur.uniforms.uW0!.value = w[0];
        blur.uniforms.uW1!.value = w[1];
        blur.uniforms.uW2!.value = w[2];
        blur.uniforms.uW3!.value = w[3];
        blur.uniforms.uW4!.value = w[4]!;
        (blur.uniforms.uDir!.value as THREE.Vector2).set(1 / src.width, 0);
        this.runPass(blur, this.blurTmpRT[i]!);
        continue;
      }

      const blurV = /^blurV(\d+)$/.exec(pass);
      if (blurV) {
        const i = Number(blurV[1]);
        const src = this.blurTmpRT[i]!;
        (blur.uniforms.uTex!.value as THREE.Texture) = src.texture;
        (blur.uniforms.uDir!.value as THREE.Vector2).set(0, 1 / src.height);
        this.runPass(blur, this.blurRT[i]!);
        continue;
      }

      const accMatch = /^acc(\d+)$/.exec(pass);
      if (accMatch) {
        const i = Number(accMatch[1]);
        const level = this.levels[i]!;
        acc.uniforms.uCur!.value = this.blurRT[i]!.texture;
        acc.uniforms.uWeight!.value = level.weight;
        acc.uniforms.uHasPrev!.value = i > 0 ? 1 : 0;
        if (i > 0) acc.uniforms.uPrev!.value = this.accRT[i - 1]!.texture;
        this.runPass(acc, this.accRT[i]!);
        continue;
      }
    }

    clearDirty(this.dirty);

    // 4. 最终合成
    this.compositeTo(null);

    this.stats.passes = passes.length;
    this.stats.passNames = names;
    if (names.length > 0) this.stats.lastActivePassNames = [...names];
    this.stats.cpuMs = performance.now() - start;
  }

  private compositeTo(target: THREE.WebGLRenderTarget | null): void {
    const final = this.materials.final;
    final.uniforms.uBeauty!.value = this.beautyRT.texture;
    final.uniforms.uGlow!.value = this.accRT[LEVEL_COUNT - 1]!.texture;
    final.uniforms.uSource!.value = this.downRT[0]!.texture;
    final.uniforms.uMask!.value = this.maskRT.texture;
    final.uniforms.uExposure!.value = this.exposure;
    final.uniforms.uIntensity!.value = this.intensity;
    final.uniforms.uView!.value = this.view === 'final' ? 0 : this.view === 'bloom' ? 1 : this.view === 'source' ? 2 : 3;
    this.runPass(final, target);
    this.renderer.setRenderTarget(null);
  }

  /**
   * 把当前视图合成到离屏 8bit 缓冲并读回（行序自下而上）。
   * 导出 PNG 与自动化验证共用。
   */
  private renderCompositeBytes(): { bytes: Uint8Array; width: number; height: number } {
    const { width, height } = this.drawingBufferSize;
    if (!this.exportRT || this.exportRT.width !== width || this.exportRT.height !== height) {
      this.exportRT?.dispose();
      this.exportRT = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
    }
    this.compositeTo(this.exportRT);
    const bytes = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(this.exportRT, 0, 0, width, height, bytes);
    this.renderer.setRenderTarget(null);
    return { bytes, width, height };
  }

  /** 读取合成结果字节（自下而上行序），供自动化验证。 */
  readCompositeBytes(): { bytes: Uint8Array; width: number; height: number } {
    return this.renderCompositeBytes();
  }

  /**
   * 以当前绘制缓冲分辨率导出 PNG（sRGB 编码，与屏幕显示一致）。
   */
  async exportPNG(): Promise<{ blob: Blob; width: number; height: number }> {
    const { bytes, width, height } = this.renderCompositeBytes();

    // WebGL 行序自下而上，翻转为自上而下
    const rowBytes = width * 4;
    const flipped = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * rowBytes;
      flipped.set(bytes.subarray(src, src + rowBytes), y * rowBytes);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 画布上下文');
    ctx.putImageData(new ImageData(flipped, width, height), 0, 0);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png');
    });

    return { blob, width, height };
  }

  /** 读取某个 HDR 缓冲的统计（调试用）：返回最大通道值与均值。 */
  debugReadTarget(kind: 'acc' | 'down' | 'blur' | 'beauty' | 'source', level = 0): {
    width: number;
    height: number;
    max: number;
    avg: number;
    nonZeroRatio: number;
  } {
    let rt: THREE.WebGLRenderTarget | undefined;
    if (kind === 'acc') rt = this.accRT[level];
    else if (kind === 'down') rt = this.downRT[level];
    else if (kind === 'blur') rt = this.blurRT[level];
    else if (kind === 'beauty') rt = this.beautyRT;
    else rt = this.downRT[0];
    if (!rt) return { width: 0, height: 0, max: 0, avg: 0, nonZeroRatio: 0 };

    const w = rt.width;
    const h = rt.height;
    // HalfFloat 目标必须用 Uint16Array 读，再解码为 float
    const half = new Uint16Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, half);
    let max = 0;
    let sum = 0;
    let nonZero = 0;
    const DataUtils = (THREE as unknown as { DataUtils: { fromHalfFloat(v: number): number } }).DataUtils;
    for (let i = 0; i < half.length; i += 4) {
      const r = DataUtils.fromHalfFloat(half[i]!);
      const g = DataUtils.fromHalfFloat(half[i + 1]!);
      const b = DataUtils.fromHalfFloat(half[i + 2]!);
      const v = Math.max(r, g, b);
      sum += v;
      if (v > 0.01) nonZero++;
      if (v > max) max = v;
    }
    const n = half.length / 4;
    return { width: w, height: h, max, avg: sum / n, nonZeroRatio: nonZero / n };
  }

  dispose(): void {
    this.quad.dispose();
    for (const key of Object.keys(this.materials) as (keyof QuadMaterialSet)[]) {
      this.materials[key].dispose();
    }
    for (const m of this.maskMaterials) m.dispose();
    this.exportRT?.dispose();
    this.maskScene.clear();
    this.disposeTargets();
  }
}
