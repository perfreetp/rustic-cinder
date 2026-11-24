import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  Vector3,
  WebGPUEngine,
} from "@babylonjs/core";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import { RiggedFigure, type FrameSample } from "./RiggedFigure";
import { KiteRig } from "./KiteRig";
import { TrajectoryLine } from "./TrajectoryLine";
import { CameraRig } from "./CameraRig";
import { clamp, lerp, lerpAngle } from "../lib/math";
import type { CameraMode, FrameTable, TrajectoryKey } from "../lib/types";

export interface EngineInfo {
  engine: "WebGPU" | "WebGL";
  fps: number;
}

/**
 * 场景总装:负责引擎初始化(WebGPU 优先,失败回退 WebGL)、
 * 场景环境、渲染循环,以及把烘焙帧表按(小数)帧号驱动到骨骼/伞翼/相机。
 */
export class StudioScene {
  readonly scene: Scene;
  private readonly engine: Engine;
  private readonly figure: RiggedFigure;
  private readonly kite: KiteRig;
  private readonly line: TrajectoryLine;
  private readonly rig: CameraRig;
  private readonly shadow: ShadowGenerator;
  private table: FrameTable | null = null;
  private frame = 0;
  private readonly sample: FrameSample = {
    x: 0, y: 0, z: 0, heading: 0,
    tuck: 0, torsoPitch: 0, torsoRoll: 0, armSpread: 1, armReach: 0.45,
  };
  private readonly handL = new Vector3();
  private readonly handR = new Vector3();

  static async create(canvas: HTMLCanvasElement): Promise<StudioScene> {
    let engine: Engine;
    let kind: EngineInfo["engine"] = "WebGPU";
    try {
      const gpu = new WebGPUEngine(canvas, {
        antialias: true,
        stencil: true,
        powerPreference: "high-performance",
      });
      await gpu.initAsync();
      engine = gpu as unknown as Engine;
    } catch (err) {
      console.warn("[StudioScene] WebGPU 不可用,回退 WebGL:", err);
      kind = "WebGL";
      engine = new Engine(canvas, true, { stencil: true, powerPreference: "high-performance" });
    }
    return new StudioScene(canvas, engine, kind);
  }

  private constructor(
    canvas: HTMLCanvasElement,
    engine: Engine,
    readonly engineKind: EngineInfo["engine"],
  ) {
    this.engine = engine;
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.07, 0.09, 0.13, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogColor = new Color3(0.07, 0.09, 0.13);
    this.scene.fogDensity = 0.008;

    // 灯光
    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.3), this.scene);
    hemi.intensity = 0.75;
    const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.3), this.scene);
    sun.position.set(20, 40, 15);
    sun.intensity = 1.1;
    this.shadow = new ShadowGenerator(1024, sun);
    this.shadow.useBlurExponentialShadowMap = true;
    this.shadow.blurKernel = 16;

    // 网格地面(仅接收阴影)
    const ground = MeshBuilder.CreateGround("ground", { width: 120, height: 120, subdivisions: 2 }, this.scene);
    const grid = new GridMaterial("grid", this.scene);
    grid.majorUnitFrequency = 5;
    grid.minorUnitVisibility = 0.35;
    grid.gridRatio = 2;
    grid.mainColor = new Color3(0.1, 0.13, 0.18);
    grid.lineColor = new Color3(0.35, 0.55, 0.75);
    grid.opacity = 0.92;
    ground.material = grid;
    ground.receiveShadows = true;

    this.figure = new RiggedFigure(this.scene);
    this.kite = new KiteRig(this.scene);
    this.line = new TrajectoryLine(this.scene);
    this.rig = new CameraRig(this.scene, canvas);

    // 阴影只覆盖人体与冲浪板,避免透明伞翼和上千 thin instance 拖慢阴影 pass
    for (const mesh of this.scene.meshes) {
      if (mesh.name.startsWith("fig-") || mesh.name === "board") {
        this.shadow.addShadowCaster(mesh);
      }
    }

    this.scene.onBeforeRenderObservable.add(() => this.tick());
    engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", this.onResize);
  }

  private readonly onResize = (): void => {
    this.engine.resize();
  };

  setTrajectory(table: FrameTable, keys: TrajectoryKey[]): void {
    this.table = table;
    this.line.rebuild(table, keys);
    this.frame = clamp(this.frame, 0, Math.max(0, table.frameCount - 1));
    this.applyFrame();
  }

  setFrame(frame: number): void {
    this.frame = frame;
    this.applyFrame();
  }

  setCameraMode(mode: CameraMode): void {
    this.rig.setMode(mode);
  }

  getCameraMode(): CameraMode {
    return this.rig.getMode();
  }

  /** 调试用:当前相机姿态 */
  cameraDebug(): { alpha: number; beta: number; radius: number; mode: CameraMode } {
    const c = this.rig.camera;
    return { alpha: c.alpha, beta: c.beta, radius: c.radius, mode: this.rig.getMode() };
  }

  /** 调试/自动化测试用:把世界坐标投影到屏幕像素坐标 */
  projectToScreen(world: Vector3): { x: number; y: number } {
    const engine = this.scene.getEngine();
    const camera = this.scene.activeCamera!;
    const p = Vector3.Project(
      world,
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    );
    return { x: p.x, y: p.y };
  }

  /** 读取当前帧指定像素的 RGB(readPixels 原点在左下,这里入参用左上屏幕坐标) */
  async readPixel(x: number, y: number): Promise<[number, number, number]> {
    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const data = await engine.readPixels(0, 0, w, h);
    const arr = data as Uint8Array;
    const yy = h - 1 - y;
    const i = (yy * w + x) * 4;
    return [arr[i], arr[i + 1], arr[i + 2]];
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.scene.dispose();
    this.engine.dispose();
  }

  private tick(): void {
    if (!this.table) return;
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    const pos = this.figure.root.position;
    this.rig.update(pos, Math.max(0, pos.y - 0.5), dt);
  }

  /** 小数帧:相邻烘焙帧间线性混合,保证 30fps 关键帧在 60fps 播放下平滑 */
  private applyFrame(): void {
    const t = this.table;
    if (!t) return;
    const f = clamp(this.frame, 0, t.frameCount - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(t.frameCount - 1, i0 + 1);
    const u = f - i0;

    this.sample.x = lerp(t.pos[i0 * 3], t.pos[i1 * 3], u);
    this.sample.y = lerp(t.pos[i0 * 3 + 1], t.pos[i1 * 3 + 1], u);
    this.sample.z = lerp(t.pos[i0 * 3 + 2], t.pos[i1 * 3 + 2], u);
    this.sample.heading = lerpAngle(t.heading[i0], t.heading[i1], u);
    this.sample.tuck = lerp(t.tuck[i0], t.tuck[i1], u);
    this.sample.torsoPitch = lerpAngle(t.torsoPitch[i0], t.torsoPitch[i1], u);
    this.sample.torsoRoll = lerpAngle(t.torsoRoll[i0], t.torsoRoll[i1], u);
    this.sample.armSpread = lerp(t.armSpread[i0], t.armSpread[i1], u);
    this.sample.armReach = lerp(t.armReach[i0], t.armReach[i1], u);

    this.figure.update(this.sample);
    this.figure.handWorldPositions(this.handL, this.handR);
    this.kite.update(this.figure.root.position, this.sample.heading, this.handL, this.handR, this.sample.tuck);
    this.line.setCurrentFrame(i0, t);
  }
}
