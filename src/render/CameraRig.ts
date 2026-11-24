import { ArcRotateCamera, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { clamp, lerp } from "../lib/math";
import type { CameraMode } from "../lib/types";

const MODE_PRESETS: Record<CameraMode, { alpha: number; beta: number }> = {
  follow: { alpha: -Math.PI / 2, beta: Math.PI / 2.6 },
  // 侧拍:与跟随同侧的正交方位角,只改变俯仰与构图,避免跳到轨迹背面
  side: { alpha: -Math.PI / 2, beta: Math.PI / 2.05 },
  // 地面仰视:beta 接近水平(小角度),相机贴近地面上仰
  ground: { alpha: -Math.PI / 2, beta: Math.PI / 2.35 },
};

/**
 * 三机位:
 * - follow 跟随:环绕目标锁定人体,距离随高度拉大(高空中看得更全)
 * - side   侧拍:固定在轨迹侧面
 * - ground 地面仰视:贴近地面、低角度
 * 切换时进入约 0.8s 的阻尼过渡,期间临时解绑指针输入,
 * 避免 ArcRotateCamera 的输入处理器把程序设定的角度立即覆盖。
 */
export class CameraRig {
  readonly camera: ArcRotateCamera;
  private mode: CameraMode = "follow";
  private userAlpha: number;
  private userBeta: number;
  private readonly damping = 4.5;
  private transition = 0; // 剩余过渡时间(秒)
  private attached = true;

  constructor(private readonly scene: Scene, private readonly canvas: HTMLCanvasElement) {
    this.camera = new ArcRotateCamera(
      "cam",
      MODE_PRESETS.follow.alpha,
      MODE_PRESETS.follow.beta,
      9,
      new Vector3(0, 2, 0),
      scene,
    );
    this.camera.minZ = 0.1;
    this.camera.maxZ = 500;
    this.camera.lowerRadiusLimit = 1.5;
    this.camera.upperRadiusLimit = 120;
    this.camera.wheelDeltaPercentage = 0.01;
    this.camera.attachControl(canvas, true);
    this.userAlpha = this.camera.alpha;
    this.userBeta = this.camera.beta;
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const preset = MODE_PRESETS[mode];
    this.userAlpha = preset.alpha;
    this.userBeta = preset.beta;
    this.transition = 0.8;
    if (this.attached) {
      this.camera.detachControl();
      this.attached = false;
    }
  }

  getMode(): CameraMode {
    return this.mode;
  }

  /** 每帧调用:target 为人体世界坐标,dt 秒;height 决定跟随距离 */
  update(target: Vector3, height: number, dt: number): void {
    const k = 1 - Math.exp(-this.damping * dt);
    let desiredRadius: number;
    const desiredTarget = new Vector3();

    if (this.mode === "follow") {
      const desiredAlpha = this.userAlpha;
      const desiredBeta = clamp(this.userBeta, 0.25, Math.PI / 2 - 0.05);
      desiredRadius = 6 + height * 0.9; // 随高度调整距离
      desiredTarget.copyFrom(target).addInPlace(new Vector3(0, 1.1, 0));
      this.camera.alpha = lerp(this.camera.alpha, desiredAlpha, k);
      this.camera.beta = lerp(this.camera.beta, desiredBeta, k);
      this.camera.radius = lerp(this.camera.radius, desiredRadius, k);
    } else if (this.mode === "side") {
      desiredRadius = 14;
      desiredTarget.set(target.x, height * 0.55 + 1.5, target.z);
      this.camera.alpha = lerp(this.camera.alpha, this.userAlpha, k);
      this.camera.beta = lerp(this.camera.beta, this.userBeta, k);
      this.camera.radius = lerp(this.camera.radius, desiredRadius, k);
    } else {
      // 地面仰视:相机贴近地面、低角度上仰,目标抬高
      desiredRadius = 5.5 + height * 0.3;
      desiredTarget.copyFrom(target).addInPlace(new Vector3(0, 2.6 + height * 0.45, 0));
      this.camera.alpha = lerp(this.camera.alpha, this.userAlpha, k);
      this.camera.beta = lerp(this.camera.beta, this.userBeta, k);
      this.camera.radius = lerp(this.camera.radius, desiredRadius, k);
    }

    this.camera.target = Vector3.Lerp(this.camera.target, desiredTarget, k);

    // 过渡结束后重新交还输入控制;之后用户拖拽由 ArcRotateCamera 直接写入
    if (this.transition > 0) {
      this.transition -= dt;
      if (this.transition <= 0 && !this.attached) {
        this.camera.attachControl(this.canvas, true);
        this.attached = true;
        // 把程序角同步为用户角,后续拖拽以此为基准
        this.userAlpha = this.camera.alpha;
        this.userBeta = this.camera.beta;
      }
    } else if (this.mode === "follow") {
      // 跟随模式下持续吸收用户的环绕角度,目标仍锁定人体
      this.userAlpha = this.camera.alpha;
      this.userBeta = this.camera.beta;
    }
  }
}
