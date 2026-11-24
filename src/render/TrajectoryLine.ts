import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { FrameTable, TrajectoryKey } from "../lib/types";
import { clamp } from "../lib/math";

const UP = new Vector3(0, 1, 0);
const SEGMENT_COLORS: Color3[] = [
  new Color3(0.15, 0.55, 0.95), // 低:蓝
  new Color3(0.1, 0.8, 0.85),
  new Color3(0.15, 0.85, 0.45),
  new Color3(0.55, 0.85, 0.2),
  new Color3(0.95, 0.78, 0.15),
  new Color3(0.95, 0.5, 0.12),
  new Color3(0.92, 0.28, 0.2),
  new Color3(0.8, 0.15, 0.45), // 高:品红
];

/**
 * 逐帧空间曲线:每个帧间段一个 thin instance(单次 draw call),
 * 颜色按高度分段。关键帧位置用小球标记,当前帧用高亮球。
 */
export class TrajectoryLine {
  private readonly segments: Mesh;
  private readonly currentMarker: Mesh;
  private keyMarkers: Mesh[] = [];
  private frameCount = 0;

  constructor(private readonly scene: Scene) {
    const mat = new StandardMaterial("traj-mat", scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    mat.emissiveColor = new Color3(0.08, 0.08, 0.08);

    this.segments = MeshBuilder.CreateCylinder(
      "traj-segments",
      { height: 1, diameter: 0.035, tessellation: 8 },
      scene,
    );
    this.segments.material = mat;
    this.segments.isVisible = false;

    const markerMat = new StandardMaterial("traj-marker", scene);
    markerMat.diffuseColor = new Color3(1, 1, 1);
    markerMat.emissiveColor = new Color3(0.35, 0.35, 0.35);

    this.currentMarker = MeshBuilder.CreateSphere(
      "traj-current",
      { diameter: 0.16, segments: 12 },
      scene,
    );
    const curMat = new StandardMaterial("traj-cur", scene);
    curMat.diffuseColor = new Color3(1, 0.95, 0.3);
    curMat.emissiveColor = new Color3(0.6, 0.5, 0.05);
    this.currentMarker.material = curMat;
    this.currentMarker.isVisible = false;
  }

  /** 烘焙表或关键点变化时重建(上千帧也是一次 buffer 提交) */
  rebuild(table: FrameTable, keys: TrajectoryKey[]): void {
    this.frameCount = table.frameCount;
    const n = Math.max(0, table.frameCount - 1);
    let maxH = 0.1;
    for (let i = 0; i < table.frameCount; i++) {
      maxH = Math.max(maxH, table.pos[i * 3 + 1]);
    }
    this.maxH = maxH;

    if (n === 0) {
      this.segments.isVisible = false;
      this.currentMarker.isVisible = false;
    } else {
      this.segments.isVisible = true;
      this.currentMarker.isVisible = true;
      const matrices: Matrix[] = new Array(n);
      const colors: Color3[] = new Array(n);
      const a = new Vector3();
      const b = new Vector3();
      const mid = new Vector3();
      const dir = new Vector3();

      for (let i = 0; i < n; i++) {
        a.set(table.pos[i * 3], table.pos[i * 3 + 1], table.pos[i * 3 + 2]);
        b.set(
          table.pos[(i + 1) * 3],
          table.pos[(i + 1) * 3 + 1],
          table.pos[(i + 1) * 3 + 2],
        );
        const len = Vector3.Distance(a, b);
        mid.copyFrom(a).addInPlace(b).scaleInPlace(0.5);
        b.subtractToRef(a, dir);
        dir.scaleInPlace(1 / Math.max(len, 1e-6));
        const q = Quaternion.FromUnitVectorsToRef(UP, dir, new Quaternion());
        matrices[i] = Matrix.Compose(
          new Vector3(1, Math.max(len, 0.02), 1),
          q,
          mid,
        );
        colors[i] = this.heightColor(table.pos[(i + 1) * 3 + 1]);
      }
      this.segments.thinInstanceSetBuffer("matrix", this.flattenMatrices(matrices), 16);
      this.segments.thinInstanceSetBuffer("color", this.flattenColors(colors), 4);
    }

    // 关键帧标记:数量过多时抽样显示,避免上百个球体铺满曲线
    for (const m of this.keyMarkers) m.dispose();
    this.keyMarkers = [];
    const markerStep = Math.max(1, Math.ceil(keys.length / 40));
    keys.forEach((key, idx) => {
      if (idx % markerStep !== 0 && key.frame !== keys[keys.length - 1].frame) return;
      if (key.frame >= table.frameCount) return;
      const m = MeshBuilder.CreateSphere(
        `key-${key.frame}`,
        { diameter: 0.13, segments: 10 },
        this.scene,
      );
      m.position.set(
        table.pos[key.frame * 3],
        table.pos[key.frame * 3 + 1],
        table.pos[key.frame * 3 + 2],
      );
      m.material = this.segments.material;
      this.keyMarkers.push(m);
    });
  }

  setCurrentFrame(frame: number, table: FrameTable): void {
    if (!this.currentMarker.isVisible || frame >= this.frameCount) return;
    this.currentMarker.position.set(
      table.pos[frame * 3],
      table.pos[frame * 3 + 1],
      table.pos[frame * 3 + 2],
    );
  }

  private heightColor(h: number): Color3 {
    // 按高度离散到色带 —— 分段着色而非平滑渐变
    const maxH = this.maxHeight();
    const t = clamp(h / Math.max(maxH, 0.01), 0, 1);
    const band = Math.min(
      SEGMENT_COLORS.length - 1,
      Math.floor(t * SEGMENT_COLORS.length),
    );
    return SEGMENT_COLORS[band];
  }

  private maxH = 1;
  private maxHeight(): number {
    return this.maxH;
  }

  private flattenMatrices(matrices: Matrix[]): Float32Array {
    const out = new Float32Array(matrices.length * 16);
    matrices.forEach((m, i) => m.copyToArray(out, i * 16));
    return out;
  }

  private flattenColors(colors: Color3[]): Float32Array {
    const out = new Float32Array(colors.length * 4);
    colors.forEach((c, i) => {
      out[i * 4] = c.r;
      out[i * 4 + 1] = c.g;
      out[i * 4 + 2] = c.b;
      out[i * 4 + 3] = 1;
    });
    return out;
  }
}
