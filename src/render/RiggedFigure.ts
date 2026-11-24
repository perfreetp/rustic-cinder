import {
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { twoBoneIK, type IKResult } from "./ik";

export interface FrameSample {
  x: number;
  y: number;
  z: number;
  heading: number;
  tuck: number;
  torsoPitch: number;
  torsoRoll: number;
  armSpread: number;
  armReach: number;
}

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(1, 0, 0);
const qYaw = new Quaternion();
const qPitch = new Quaternion();
const qRoll = new Quaternion();

/**
 * 过程化骨骼人体:TransformNode 层级 + 胶囊体网格。
 * 手臂用两轴 IK 把手部约束到控制杆端点;腿部按收腿系数做髋/膝弯曲。
 */
export class RiggedFigure {
  readonly root: TransformNode;
  readonly torso: TransformNode;
  readonly handL: TransformNode;
  readonly handR: TransformNode;

  private readonly upperArmL: TransformNode;
  private readonly foreArmL: TransformNode;
  private readonly upperArmR: TransformNode;
  private readonly foreArmR: TransformNode;
  private readonly thighL: TransformNode;
  private readonly shinL: TransformNode;
  private readonly thighR: TransformNode;
  private readonly shinR: TransformNode;
  private readonly bar: Mesh;

  private readonly ikL: IKResult = {
    elbow: new Vector3(),
    hand: new Vector3(),
    upperDir: new Vector3(),
    foreDir: new Vector3(),
  };
  private readonly ikR: IKResult = {
    elbow: new Vector3(),
    hand: new Vector3(),
    upperDir: new Vector3(),
    foreDir: new Vector3(),
  };
  private readonly ikLegL: IKResult = {
    elbow: new Vector3(),
    hand: new Vector3(),
    upperDir: new Vector3(),
    foreDir: new Vector3(),
  };
  private readonly ikLegR: IKResult = {
    elbow: new Vector3(),
    hand: new Vector3(),
    upperDir: new Vector3(),
    foreDir: new Vector3(),
  };

  private static readonly UPPER_ARM = 0.3;
  private static readonly FORE_ARM = 0.28;
  private static readonly THIGH = 0.46;
  private static readonly SHIN = 0.44;

  constructor(scene: Scene) {
    const skin = new StandardMaterial("fig-skin", scene);
    skin.diffuseColor = new Color3(0.86, 0.62, 0.45);
    skin.specularColor = new Color3(0.1, 0.1, 0.1);

    const suit = new StandardMaterial("fig-suit", scene);
    suit.diffuseColor = new Color3(0.08, 0.28, 0.55);

    const dark = new StandardMaterial("fig-dark", scene);
    dark.diffuseColor = new Color3(0.12, 0.14, 0.18);

    this.root = new TransformNode("fig-root", scene);
    this.torso = new TransformNode("fig-torso", scene);
    this.torso.parent = this.root;
    this.torso.position.set(0, 0.98, 0); // 髋部高度

    // 躯干胶囊 + 头
    const trunk = MeshBuilder.CreateCapsule("fig-trunk", { height: 0.62, radius: 0.17 }, scene);
    trunk.parent = this.torso;
    trunk.position.set(0, 0.3, 0);
    trunk.material = suit;

    const head = MeshBuilder.CreateSphere("fig-head", { diameter: 0.24 }, scene);
    head.parent = this.torso;
    head.position.set(0.02, 0.72, 0);
    head.material = skin;

    // 肩
    const shoulderL = this.joint("shoulder-l", this.torso, new Vector3(0, 0.5, 0.2), scene);
    const shoulderR = this.joint("shoulder-r", this.torso, new Vector3(0, 0.5, -0.2), scene);
    const hipL = this.joint("hip-l", this.torso, new Vector3(0, 0, 0.12), scene);
    const hipR = this.joint("hip-r", this.torso, new Vector3(0, 0, -0.12), scene);

    this.upperArmL = this.bone("upper-l", shoulderL, RiggedFigure.UPPER_ARM, 0.055, skin, scene);
    this.foreArmL = this.bone("fore-l", this.upperArmL, RiggedFigure.FORE_ARM, 0.05, skin, scene);
    this.handL = this.joint("hand-l", this.foreArmL, Vector3.Zero(), scene);
    this.upperArmR = this.bone("upper-r", shoulderR, RiggedFigure.UPPER_ARM, 0.055, skin, scene);
    this.foreArmR = this.bone("fore-r", this.upperArmR, RiggedFigure.FORE_ARM, 0.05, skin, scene);
    this.handR = this.joint("hand-r", this.foreArmR, Vector3.Zero(), scene);

    this.thighL = this.bone("thigh-l", hipL, RiggedFigure.THIGH, 0.085, dark, scene);
    this.shinL = this.bone("shin-l", this.thighL, RiggedFigure.SHIN, 0.07, dark, scene);
    this.foot("foot-l", this.shinL, 0.1, scene, dark);
    this.thighR = this.bone("thigh-r", hipR, RiggedFigure.THIGH, 0.085, dark, scene);
    this.shinR = this.bone("shin-r", this.thighR, RiggedFigure.SHIN, 0.07, dark, scene);
    this.foot("foot-r", this.shinR, -0.1, scene, dark);

    // 控制杆(横杆),挂在躯干下,每帧更新到双手之间
    this.bar = MeshBuilder.CreateCylinder(
      "control-bar",
      { height: 0.5, diameter: 0.035, tessellation: 12 },
      scene,
    );
    this.bar.parent = this.torso;
    this.bar.material = dark;
    // 圆柱默认沿 Y,转成沿 Z(左右方向)
    this.bar.rotation.x = Math.PI / 2;

    // 冲浪板
    const board = MeshBuilder.CreateBox("board", { width: 0.42, height: 0.05, depth: 1.5 }, scene);
    board.parent = this.root;
    board.position.set(0.05, 0.06, 0);
    const boardMat = new StandardMaterial("board-mat", scene);
    boardMat.diffuseColor = new Color3(0.85, 0.45, 0.15);
    board.material = boardMat;
  }

  update(s: FrameSample): void {
    this.root.position.set(s.x, s.y, s.z);

    // 躯干朝向跟随伞翼转向(偏航)+ 姿态关键帧的俯仰/滚转
    Quaternion.RotationAxisToRef(UP, s.heading, qYaw);
    Quaternion.RotationAxisToRef(new Vector3(1, 0, 0), s.torsoRoll, qRoll);
    Quaternion.RotationAxisToRef(new Vector3(0, 0, 1), s.torsoPitch, qPitch);
    this.torso.rotationQuaternion = qYaw.multiply(qRoll).multiply(qPitch);

    // ---- 手臂:IK 约束到控制杆两端 ----
    const halfW = 0.22 * s.armSpread;
    const barCenter = new Vector3(s.armReach, 0.42, 0);
    const targetL = barCenter.add(new Vector3(0, 0, halfW));
    const targetR = barCenter.add(new Vector3(0, 0, -halfW));
    this.bar.position.copyFrom(barCenter);
    this.bar.scaling.z = Math.max(0.5, halfW * 2 / 0.5);

    const shoulderLpos = new Vector3(0, 0.5, 0.2);
    const shoulderRpos = new Vector3(0, 0.5, -0.2);
    const elbowPole = new Vector3(0.35, -1, 0); // 肘朝斜下方
    twoBoneIK(shoulderLpos, targetL, RiggedFigure.UPPER_ARM, RiggedFigure.FORE_ARM, elbowPole, this.ikL);
    twoBoneIK(shoulderRpos, targetR, RiggedFigure.UPPER_ARM, RiggedFigure.FORE_ARM, elbowPole, this.ikR);
    this.orientBone(this.upperArmL, this.ikL.upperDir);
    this.orientBone(this.foreArmL, this.ikL.foreDir);
    this.orientBone(this.upperArmR, this.ikR.upperDir);
    this.orientBone(this.foreArmR, this.ikR.foreDir);

    // ---- 腿:按腾空阶段收腿/伸展 ----
    const tuck = Math.min(1, Math.max(0, s.tuck));
    const hipAngle = tuck * 1.9; // 大腿最大前抬 ~109°
    const kneeBend = tuck * 2.15;
    const legReach = RiggedFigure.THIGH + RiggedFigure.SHIN * Math.cos(kneeBend);
    const thighDir = new Vector3(Math.sin(hipAngle), -Math.cos(hipAngle), 0);
    const kneePole = FORWARD; // 膝盖始终朝前弯

    for (const [hipZ, thigh, shin, ik] of [
      [0.12, this.thighL, this.shinL, this.ikLegL],
      [-0.12, this.thighR, this.shinR, this.ikLegR],
    ] as const) {
      const hip = new Vector3(0, 0, hipZ);
      const footTarget = hip.add(thighDir.scale(legReach));
      twoBoneIK(hip, footTarget, RiggedFigure.THIGH, RiggedFigure.SHIN, kneePole, ik);
      this.orientBone(thigh, ik.upperDir);
      this.orientBone(shin, ik.foreDir);
    }

    // 强制刷新世界矩阵,外部可立即读取手部世界坐标
    this.root.computeWorldMatrix(true);
  }

  /** 手部世界坐标(伞绳连接点) */
  handWorldPositions(outL: Vector3, outR: Vector3): void {
    outL.copyFrom(this.handL.getAbsolutePosition());
    outR.copyFrom(this.handR.getAbsolutePosition());
  }

  private orientBone(bone: TransformNode, dir: Vector3): void {
    bone.rotationQuaternion = Quaternion.FromUnitVectorsToRef(UP, dir, new Quaternion());
  }

  private joint(name: string, parent: TransformNode, local: Vector3, scene: Scene): TransformNode {
    const n = new TransformNode(name, scene);
    n.parent = parent;
    n.position = local.clone();
    return n;
  }

  private bone(
    name: string,
    parent: TransformNode,
    len: number,
    radius: number,
    mat: StandardMaterial,
    scene: Scene,
  ): TransformNode {
    const node = new TransformNode(name, scene);
    node.parent = parent;
    const mesh = MeshBuilder.CreateCapsule(`${name}-mesh`, { height: len, radius }, scene);
    mesh.parent = node;
    mesh.position.y = len / 2;
    mesh.material = mat;
    const joint = MeshBuilder.CreateSphere(`${name}-joint`, { diameter: radius * 2.1 }, scene);
    joint.parent = node;
    joint.material = mat;
    return node;
  }

  private foot(name: string, parent: TransformNode, zOffset: number, scene: Scene, mat: StandardMaterial): void {
    const mesh = MeshBuilder.CreateBox(name, { width: 0.22, height: 0.07, depth: 0.11 }, scene);
    mesh.parent = parent;
    mesh.position.set(0.09, -0.02, zOffset * 0.3);
    mesh.material = mat;
  }
}
