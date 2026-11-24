import { bakeFrames, insertTrajectoryKey, upsertPoseKey } from "../lib/interpolation";
import { downloadTextFile, exportProject, parseProject, parseTrajectoryInput } from "../lib/io";
import { sampleTrajectory } from "../lib/sample";
import { DEFAULT_POSE, type CameraMode, type FrameTable, type PoseKey, type TrajectoryKey } from "../lib/types";

/**
 * 全局状态(Svelte 5 runes)。烘焙表走懒缓存:
 * 编辑关键点只改源数据,拖动播放头时才重新 bake —— 单次 O(N),之后全 O(1)。
 */
class StudioState {
  fps = $state(30);
  trajectoryKeys = $state<TrajectoryKey[]>(sampleTrajectory());
  poseKeys = $state<PoseKey[]>([]);
  currentFrame = $state(0);
  playing = $state(false);
  cameraMode = $state<CameraMode>("follow");
  activePage = $state<"trajectory" | "pose" | "timeline" | "camera">("trajectory");
  status = $state("已加载内置示例轨迹");

  private baked: FrameTable | null = null;
  private dirty = true;
  private cameraListeners = new Set<(mode: CameraMode) => void>();
  private frameListeners = new Set<(frame: number) => void>();

  /** 显式订阅:供非模板上下文(3D 视口、自动化)可靠响应状态变化 */
  onCameraMode(fn: (mode: CameraMode) => void): () => void {
    this.cameraListeners.add(fn);
    fn(this.cameraMode);
    return () => this.cameraListeners.delete(fn);
  }

  onFrame(fn: (frame: number) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  get frameCount(): number {
    return this.bake().frameCount;
  }

  /** 获取(必要时重新烘焙)逐帧表 */
  bake(): FrameTable {
    if (this.dirty || !this.baked) {
      this.baked = bakeFrames(this.trajectoryKeys, this.poseKeys, this.fps);
      this.dirty = false;
      if (this.currentFrame > this.baked.frameCount - 1) {
        this.currentFrame = this.baked.frameCount - 1;
      }
    }
    return this.baked;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** 显式 action:外部(含自动化测试、非编译上下文)通过方法赋值才能触发 $state 响应性 */
  setCameraMode(mode: CameraMode): void {
    if (mode === this.cameraMode) return;
    this.cameraMode = mode;
    this.cameraListeners.forEach((fn) => fn(mode));
  }

  setCurrentFrame(frame: number): void {
    this.currentFrame = frame;
    this.frameListeners.forEach((fn) => fn(frame));
  }

  setPlaying(v: boolean): void {
    this.playing = v;
  }

  setTrajectory(keys: TrajectoryKey[], fps?: number): void {
    this.trajectoryKeys = [...keys].sort((a, b) => a.frame - b.frame);
    if (fps && fps > 0) this.fps = Math.round(fps);
    this.poseKeys = [];
    this.currentFrame = 0;
    this.markDirty();
  }

  updateTrajectoryKey(frame: number, patch: Partial<TrajectoryKey>): void {
    this.trajectoryKeys = this.trajectoryKeys.map((k) =>
      k.frame === frame ? { ...k, ...patch } : k,
    );
    this.markDirty();
  }

  deleteTrajectoryKey(frame: number): void {
    if (this.trajectoryKeys.length <= 2) {
      this.status = "至少保留 2 个轨迹关键点";
      return;
    }
    this.trajectoryKeys = this.trajectoryKeys.filter((k) => k.frame !== frame);
    this.markDirty();
  }

  /** 在当前帧插入轨迹关键点(取烘焙后的插值值),前后帧随后重新插值 */
  insertTrajectoryKeyAtCurrent(): void {
    const table = this.bake();
    const frame = Math.round(this.currentFrame);
    this.trajectoryKeys = insertTrajectoryKey(this.trajectoryKeys, frame, table);
    this.markDirty();
    this.status = `已在第 ${frame} 帧插入轨迹关键点`;
  }

  /** 在任意帧插入姿态关键帧(默认取当前自动姿态值),前后帧重新插值 */
  insertPoseKeyAtFrame(frame: number): PoseKey {
    const table = this.bake();
    const f = Math.max(0, Math.min(frame, table.frameCount - 1));
    const key: PoseKey = {
      frame: f,
      tuck: table.tuck[f],
      torsoPitch: table.torsoPitch[f],
      torsoRoll: table.torsoRoll[f],
      armSpread: table.armSpread[f],
      armReach: table.armReach[f],
    };
    this.poseKeys = upsertPoseKey(this.poseKeys, key);
    this.markDirty();
    this.status = `已在第 ${f} 帧插入姿态关键帧`;
    return key;
  }

  updatePoseKey(frame: number, patch: Partial<PoseKey>): void {
    this.poseKeys = this.poseKeys.map((k) =>
      k.frame === frame ? { ...k, ...patch } : k,
    );
    this.markDirty();
  }

  deletePoseKey(frame: number): void {
    this.poseKeys = this.poseKeys.filter((k) => k.frame !== frame);
    this.markDirty();
  }

  // ---- 导入 / 导出:一个工程文件带走全部数据,重新导入可继续编辑 ----
  importText(text: string, filename: string): void {
    try {
      if (text.includes('"kite-air-pose-studio"')) {
        const proj = parseProject(text);
        this.fps = proj.fps;
        this.trajectoryKeys = proj.trajectoryKeys;
        this.poseKeys = proj.poseKeys;
        this.currentFrame = 0;
        this.markDirty();
        this.status = `已打开工程 ${filename}:${proj.trajectoryKeys.length} 个轨迹点、${proj.poseKeys.length} 个姿态关键帧`;
      } else {
        const imported = parseTrajectoryInput(text);
        this.setTrajectory(imported.trajectoryKeys, imported.fps);
        this.status = `已导入 ${imported.trajectoryKeys.length} 个轨迹关键点`;
      }
    } catch (err) {
      this.status = `导入失败:${(err as Error).message}`;
    }
  }

  exportProjectFile(): void {
    const json = exportProject(this.trajectoryKeys, this.poseKeys, this.fps);
    downloadTextFile(`kite-air-${Date.now()}.json`, json);
    this.status = "工程文件已导出(轨迹点 + 姿态关键帧)";
  }

  resetSample(): void {
    this.trajectoryKeys = sampleTrajectory();
    this.poseKeys = [];
    this.currentFrame = 0;
    this.markDirty();
    this.status = "已恢复内置示例";
  }

  defaultPose(): typeof DEFAULT_POSE {
    return DEFAULT_POSE;
  }
}

export const studio = new StudioState();
