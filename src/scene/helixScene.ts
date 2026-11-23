import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { HelixLayout } from "../dna";

/** 优先创建 WebGPU 引擎,不支持时回退 WebGL */
export async function createEngine(
  canvas: HTMLCanvasElement,
): Promise<AbstractEngine> {
  try {
    if (await WebGPUEngine.IsSupportedAsync) {
      const gpu = new WebGPUEngine(canvas, {
        antialias: true,
        adaptToDeviceRatio: true,
      });
      await gpu.initAsync();
      return gpu;
    }
  } catch (err) {
    console.warn("WebGPU 初始化失败,回退到 WebGL:", err);
  }
  return new Engine(canvas, true, { adaptToDeviceRatio: true });
}

export function engineLabel(engine: AbstractEngine): string {
  return engine instanceof WebGPUEngine ? "WebGPU" : "WebGL2";
}

export interface HelixViewOptions {
  showBackbone: boolean;
  showBases: boolean;
  showAllBonds: boolean;
  /** 高亮的碱基对索引(0 起),-1 表示不高亮 */
  highlightPair: number;
}

const DEFAULT_OPTIONS: HelixViewOptions = {
  showBackbone: true,
  showBases: true,
  showAllBonds: false,
  highlightPair: -1,
};

/**
 * 双螺旋场景。碱基与磷酸骨架全部使用薄实例(thin instances)渲染,
 * 200+ 碱基对时每个对象仍只有一次绘制调用,保证旋转流畅。
 */
export class HelixScene {
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;

  private baseMesh: Mesh;
  private phosMesh: Mesh;
  private backboneMat: StandardMaterial;
  private tubeA: Mesh | null = null;
  private tubeB: Mesh | null = null;
  private bondLines: LinesMesh | null = null;
  private layout: HelixLayout | null = null;
  private options: HelixViewOptions = { ...DEFAULT_OPTIONS };

  constructor(
    readonly engine: AbstractEngine,
    canvas: HTMLCanvasElement,
  ) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.045, 0.055, 0.085, 1);

    const camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      Math.PI / 2.6,
      14,
      new Vector3(0, 4, 0),
      this.scene,
    );
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 3;
    camera.minZ = 0.05;
    camera.maxZ = 2000;
    camera.lowerRadiusLimit = 1.5;
    this.camera = camera;

    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.95;
    const dir = new DirectionalLight("dir", new Vector3(-1, -2, -1), this.scene);
    dir.intensity = 0.7;

    // 碱基:单位盒体 + 薄实例,颜色由实例颜色缓冲提供
    const baseMat = new StandardMaterial("baseMat", this.scene);
    baseMat.specularColor = new Color3(0.12, 0.12, 0.12);
    this.baseMesh = MeshBuilder.CreateBox("bases", { size: 1 }, this.scene);
    this.baseMesh.material = baseMat;
    this.baseMesh.isPickable = false;

    // 磷酸基团:球体薄实例
    const phosMat = new StandardMaterial("phosMat", this.scene);
    phosMat.diffuseColor = new Color3(0.95, 0.58, 0.25);
    phosMat.specularColor = new Color3(0.25, 0.25, 0.25);
    this.phosMesh = MeshBuilder.CreateSphere(
      "phosphates",
      { diameter: 0.24, segments: 8 },
      this.scene,
    );
    this.phosMesh.material = phosMat;
    this.phosMesh.isPickable = false;

    // 骨架连接管材质
    this.backboneMat = new StandardMaterial("backboneMat", this.scene);
    this.backboneMat.diffuseColor = new Color3(0.85, 0.72, 0.55);
    this.backboneMat.specularColor = new Color3(0.15, 0.15, 0.15);
  }

  /** 参数或序列变化后调用:全量重算实例缓冲与骨架网格 */
  setLayout(layout: HelixLayout): void {
    this.layout = layout;
    const n = layout.count;
    if (n === 0) return;

    // ---- 碱基实例矩阵 ----
    const matData = new Float32Array(n * 2 * 16);
    const m = new Matrix();
    const scale = new Vector3();
    const pos = new Vector3();
    for (let i = 0; i < 2 * n; i++) {
      scale.set(
        layout.baseScales[i * 3],
        layout.baseScales[i * 3 + 1],
        layout.baseScales[i * 3 + 2],
      );
      pos.set(
        layout.basePositions[i * 3],
        layout.basePositions[i * 3 + 1],
        layout.basePositions[i * 3 + 2],
      );
      Matrix.ComposeToRef(
        scale,
        Quaternion.RotationYawPitchRoll(layout.baseAngles[i], 0, 0),
        pos,
        m,
      );
      m.copyToArray(matData, i * 16);
    }
    this.baseMesh.thinInstanceSetBuffer("matrix", matData, 16, false);
    this.updateBaseColors();

    // ---- 磷酸实例矩阵 ----
    const pm = new Float32Array(n * 2 * 16);
    for (let i = 0; i < n; i++) {
      Matrix.TranslationToRef(
        layout.backboneA[i * 3],
        layout.backboneA[i * 3 + 1],
        layout.backboneA[i * 3 + 2],
        m,
      );
      m.copyToArray(pm, i * 16);
      Matrix.TranslationToRef(
        layout.backboneB[i * 3],
        layout.backboneB[i * 3 + 1],
        layout.backboneB[i * 3 + 2],
        m,
      );
      m.copyToArray(pm, (n + i) * 16);
    }
    this.phosMesh.thinInstanceSetBuffer("matrix", pm, 16, false);

    // ---- 骨架连接管 ----
    this.tubeA?.dispose();
    this.tubeB?.dispose();
    const pathA: Vector3[] = [];
    const pathB: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      pathA.push(
        new Vector3(
          layout.backboneA[i * 3],
          layout.backboneA[i * 3 + 1],
          layout.backboneA[i * 3 + 2],
        ),
      );
      pathB.push(
        new Vector3(
          layout.backboneB[i * 3],
          layout.backboneB[i * 3 + 1],
          layout.backboneB[i * 3 + 2],
        ),
      );
    }
    this.tubeA = MeshBuilder.CreateTube(
      "backboneA",
      { path: pathA, radius: 0.07, tessellation: 8 },
      this.scene,
    );
    this.tubeA.material = this.backboneMat;
    this.tubeA.isPickable = false;
    this.tubeB = MeshBuilder.CreateTube(
      "backboneB",
      { path: pathB, radius: 0.07, tessellation: 8 },
      this.scene,
    );
    this.tubeB.material = this.backboneMat;
    this.tubeB.isPickable = false;

    // ---- 相机取景:目标对准链中心,链变长时自动拉远 ----
    const h = layout.totalHeight;
    this.camera.target.set(0, h / 2, 0);
    this.camera.radius = Math.max(
      this.camera.radius,
      Math.min(h * 0.8, 120),
    );

    this.rebuildBonds();
    this.applyVisibility();
  }

  setOptions(patch: Partial<HelixViewOptions>): void {
    this.options = { ...this.options, ...patch };
    this.updateBaseColors();
    this.rebuildBonds();
    this.applyVisibility();
  }

  setAutoRotate(on: boolean): void {
    this.camera.useAutoRotationBehavior = on;
  }

  /**
   * 轴向剖面视图:相机转到螺旋轴正上方俯视,
   * 并用裁剪平面在指定高度截断,查看该层面的碱基堆叠。
   * @param cutFraction 剖面位置,0(底)- 1(顶)
   */
  setAxialView(enabled: boolean, cutFraction = 1): void {
    if (!this.layout) return;
    if (enabled) {
      this.camera.alpha = -Math.PI / 2;
      this.camera.beta = 0.03;
      const cutY = this.layout.totalHeight * cutFraction + 0.01;
      this.scene.clipPlane = new Plane(0, -1, 0, cutY);
    } else {
      this.scene.clipPlane = null;
      this.camera.beta = Math.PI / 2.6;
    }
  }

  dispose(): void {
    this.scene.dispose();
  }

  /** 高亮选中碱基对:选中提亮,其余变暗 */
  private updateBaseColors(): void {
    if (!this.layout) return;
    const src = this.layout.baseColors;
    const hl = this.options.highlightPair;
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length / 4; i++) {
      const pair = i >> 1;
      let f = 1;
      if (hl >= 0) f = pair === hl ? 1.4 : 0.22;
      out[i * 4] = Math.min(1, src[i * 4] * f);
      out[i * 4 + 1] = Math.min(1, src[i * 4 + 1] * f);
      out[i * 4 + 2] = Math.min(1, src[i * 4 + 2] * f);
      out[i * 4 + 3] = 1;
    }
    this.baseMesh.thinInstanceSetBuffer("color", out, 4, false);
  }

  /** 重建氢键连线(全部或仅高亮对) */
  private rebuildBonds(): void {
    this.bondLines?.dispose();
    this.bondLines = null;
    const L = this.layout;
    if (!L) return;

    const lines: Vector3[][] = [];
    const pushPair = (i: number) => {
      const bonds = L.hbondCounts[i];
      const y = L.pairInnerA[i * 3 + 1];
      for (let b = 0; b < bonds; b++) {
        const off =
          bonds === 2 ? (b === 0 ? -0.05 : 0.05) : (b - 1) * 0.06;
        lines.push([
          new Vector3(
            L.pairInnerA[i * 3],
            y + off,
            L.pairInnerA[i * 3 + 2],
          ),
          new Vector3(
            L.pairInnerB[i * 3],
            y + off,
            L.pairInnerB[i * 3 + 2],
          ),
        ]);
      }
    };

    if (this.options.showAllBonds) {
      for (let i = 0; i < L.count; i++) pushPair(i);
    } else if (
      this.options.highlightPair >= 0 &&
      this.options.highlightPair < L.count
    ) {
      pushPair(this.options.highlightPair);
    }

    if (lines.length > 0) {
      this.bondLines = MeshBuilder.CreateLineSystem(
        "hbonds",
        { lines },
        this.scene,
      );
      this.bondLines.color = new Color3(0.85, 0.95, 1);
      this.bondLines.isPickable = false;
    }
  }

  private applyVisibility(): void {
    this.baseMesh.setEnabled(this.options.showBases);
    this.phosMesh.setEnabled(this.options.showBackbone);
    this.tubeA?.setEnabled(this.options.showBackbone);
    this.tubeB?.setEnabled(this.options.showBackbone);
  }
}
