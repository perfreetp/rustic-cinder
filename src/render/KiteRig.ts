import {
  Color3,
  Effect,
  Mesh,
  MeshBuilder,
  Quaternion,
  ShaderMaterial,
  StandardMaterial,
  TransformNode,
  VertexData,
  Vector3,
} from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

const UP = new Vector3(0, 1, 0);
const tmpDir = new Vector3();
const tmpMid = new Vector3();
const tmpQuat = new Quaternion();

let depthShaderRegistered = false;

/**
 * 注册一个"只写深度、不写颜色"的着色器。
 * 顶点着色器照常输出裁剪空间位置(深度由此写入),片元着色器把 gl_FragColor
 * 的 alpha 设为 0 并配合 colorWrite 关闭 —— 双保险,保证深度预通道不留任何颜色。
 */
function ensureDepthShader(scene: Scene): ShaderMaterial {
  if (!depthShaderRegistered) {
    Effect.ShadersStore["kiteDepthVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      void main(void) {
        gl_Position = worldViewProjection * vec4(position, 1.0);
      }`;
    Effect.ShadersStore["kiteDepthFragmentShader"] = `
      precision highp float;
      void main(void) {
        gl_FragColor = vec4(0.0);
      }`;
    depthShaderRegistered = true;
  }
  const mat = new ShaderMaterial(
    "kite-depth-mat",
    scene,
    { vertex: "kiteDepth", fragment: "kiteDepth" },
    {
      attributes: ["position"],
      uniforms: ["worldViewProjection"],
      needAlphaBlending: false,
    },
  );
  // 关闭颜色写入,仅保留深度写入
  mat.backFaceCulling = false;
  const engine = scene.getEngine();
  mat.onBindObservable.add(() => {
    engine.setColorWrite(false);
  });
  mat.onUnBindObservable.add(() => {
    engine.setColorWrite(true);
  });
  return mat;
}

/**
 * 伞翼 + 伞绳系统。
 * 伞翼为自定义弧面网格,半透明;额外挂一个只写深度的同形网格,
 * 保证透明伞翼不会盖住本应在它前面的人体/伞绳。
 */
export class KiteRig {
  readonly root: TransformNode;
  readonly tipL: TransformNode;
  readonly tipR: TransformNode;

  private readonly lines: Mesh[] = [];
  private readonly halfSpan: number;

  constructor(scene: Scene) {
    this.root = new TransformNode("kite-root", scene);
    this.halfSpan = 1.35;

    const canopy = this.buildCanopy(scene);
    canopy.parent = this.root;
    const canopyMat = new StandardMaterial("canopy-mat", scene);
    canopyMat.diffuseColor = new Color3(0.95, 0.32, 0.12);
    canopyMat.emissiveColor = new Color3(0.25, 0.07, 0.02);
    canopyMat.specularColor = new Color3(0.2, 0.2, 0.2);
    canopyMat.alpha = 0.55;
    canopyMat.backFaceCulling = false;
    canopyMat.twoSidedLighting = true;
    canopyMat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    canopy.material = canopyMat;
    canopy.renderingGroupId = 1; // 透明物体最后渲染

    // 深度预通道:同形网格 + 只写深度的自定义 ShaderMaterial,渲染组 0(不透明阶段)。
    // 它先于透明伞翼(渲染组 1)写入深度,使位于伞翼前方的人体/伞绳不被半透明伞翼错误覆盖。
    const depthClone = canopy.clone("canopy-depth") as Mesh;
    depthClone.parent = this.root;
    depthClone.material = ensureDepthShader(scene);
    depthClone.renderingGroupId = 0;

    // 两角端点(局部坐标与网格尖端一致)
    this.tipL = new TransformNode("kite-tip-l", scene);
    this.tipL.parent = this.root;
    this.tipL.position.set(-0.25, 0.05, this.halfSpan);
    this.tipR = new TransformNode("kite-tip-r", scene);
    this.tipR.parent = this.root;
    this.tipR.position.set(-0.25, 0.05, -this.halfSpan);

    // 4 根伞绳:双手分别连到伞翼两角,每帧按姿态拉伸
    const lineMat = new StandardMaterial("line-mat", scene);
    lineMat.diffuseColor = new Color3(0.85, 0.85, 0.8);
    lineMat.specularColor = new Color3(0.05, 0.05, 0.05);
    for (let i = 0; i < 4; i++) {
      const line = MeshBuilder.CreateCylinder(
        `kite-line-${i}`,
        { height: 1, diameter: 0.012, tessellation: 6 },
        scene,
      );
      line.material = lineMat;
      line.renderingGroupId = 0;
      this.lines.push(line);
    }
  }

  /** 每帧更新:伞翼位置/朝向跟随人体与伞翼朝向,伞绳从手部拉到两角 */
  update(
    figurePos: Vector3,
    heading: number,
    handL: Vector3,
    handR: Vector3,
    tuck: number,
  ): void {
    const fwdX = Math.cos(heading);
    const fwdZ = Math.sin(heading);
    const fwdDist = 1.7;
    const kiteUp = 2.55 - tuck * 0.25;
    this.root.position.set(
      figurePos.x + fwdX * fwdDist,
      figurePos.y + 1.05 + kiteUp,
      figurePos.z + fwdZ * fwdDist,
    );
    Quaternion.RotationAxisToRef(UP, heading, tmpQuat);
    this.root.rotationQuaternion = tmpQuat;
    this.root.computeWorldMatrix(true);

    const tipL = this.tipL.getAbsolutePosition();
    const tipR = this.tipR.getAbsolutePosition();
    const pairs: Array<[Vector3, Vector3]> = [
      [handL, tipL],
      [handL, tipR],
      [handR, tipL],
      [handR, tipR],
    ];
    for (let i = 0; i < this.lines.length; i++) {
      this.stretch(this.lines[i], pairs[i][0], pairs[i][1]);
    }
  }

  private stretch(line: Mesh, a: Vector3, b: Vector3): void {
    b.subtractToRef(a, tmpDir);
    const len = Math.max(0.001, tmpDir.length());
    tmpMid.copyFrom(a).addInPlace(b).scaleInPlace(0.5);
    line.position.copyFrom(tmpMid);
    line.scaling.set(1, len, 1);
    tmpDir.scaleInPlace(1 / len);
    line.rotationQuaternion = Quaternion.FromUnitVectorsToRef(UP, tmpDir, new Quaternion());
  }

  /** 自定义弧面伞翼:u 沿翼展(-1..1),v 沿弦向(0..1) */
  private buildCanopy(scene: Scene): Mesh {
    const uSeg = 28;
    const vSeg = 6;
    const positions: number[] = [];
    const indices: number[] = [];
    const arch = 0.55;
    const chord = 0.72;
    const billow = 0.16;

    for (let iu = 0; iu <= uSeg; iu++) {
      const u = (iu / uSeg) * 2 - 1;
      const spanZ = u * this.halfSpan;
      const archY = arch * (1 - u * u);
      const sweepX = -0.28 * u * u;
      for (let iv = 0; iv <= vSeg; iv++) {
        const v = iv / vSeg;
        const x = sweepX + (v - 0.5) * chord * (1 - 0.22 * u * u);
        const y = archY + billow * Math.sin(Math.PI * v) * (1 - 0.35 * u * u);
        const z = spanZ;
        positions.push(x, y, z);
      }
    }
    const row = vSeg + 1;
    for (let iu = 0; iu < uSeg; iu++) {
      for (let iv = 0; iv < vSeg; iv++) {
        const a = iu * row + iv;
        const b = (iu + 1) * row + iv;
        const c = b + 1;
        const d = a + 1;
        indices.push(a, b, d, b, c, d);
      }
    }

    const mesh = new Mesh("canopy", scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = new Array<number>(positions.length).fill(0);
    VertexData.ComputeNormals(positions, indices, data.normals);
    data.applyToMesh(mesh);
    return mesh;
  }
}
