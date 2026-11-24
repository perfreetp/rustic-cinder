import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  FaultInjection,
  FaultType,
  ProjectFile,
  SavedProject,
  SectionPlaneConfig,
} from '../types';
import { FRAME_COUNT } from '../constants';
import { storage, downloadProjectFile } from '../utils/storage';
import { uid } from '../utils/path';
import { useModelStore } from './model';

const DEFAULT_SECTION: SectionPlaneConfig = {
  enabled: false,
  axis: 'y',
  offset: 0,
  capOpacity: 0.28,
};

export const useSessionStore = defineStore('session', () => {
  const model = useModelStore();

  // ---------------- 时间轴 ----------------
  const currentFrame = ref(0);
  const playing = ref(false);
  /** 播放方向:1 拆卸 → -1 合拢 */
  const playDirection = ref<1 | -1>(1);
  const frameCount = ref(FRAME_COUNT);

  const timeT = computed(() => currentFrame.value / Math.max(1, frameCount.value - 1));

  function setFrame(frame: number): void {
    currentFrame.value = Math.min(frameCount.value - 1, Math.max(0, Math.round(frame)));
  }

  function setTime(t: number): void {
    setFrame(t * (frameCount.value - 1));
  }

  function play(): void {
    playing.value = true;
  }

  function pause(): void {
    playing.value = false;
  }

  function togglePlay(): void {
    playing.value = !playing.value;
  }

  function setDirection(dir: 1 | -1): void {
    playDirection.value = dir;
  }

  // ---------------- 故障注入 ----------------
  const faults = ref<FaultInjection[]>([]);

  function injectFault(type: FaultType, partPath: string): FaultInjection {
    const record: FaultInjection = {
      id: uid('fault'),
      type,
      partPath,
      frame: currentFrame.value,
      createdAt: Date.now(),
    };
    faults.value = [...faults.value, record];
    // 换色 + 高亮由 model store 状态驱动;时间轴自动跳转到故障发生帧
    model.applyFault(partPath, type);
    setFrame(record.frame);
    return record;
  }

  function removeFault(id: string): void {
    const target = faults.value.find((f) => f.id === id);
    if (target) model.clearFault(target.partPath);
    faults.value = faults.value.filter((f) => f.id !== id);
  }

  function clearFaults(): void {
    for (const f of faults.value) model.clearFault(f.partPath);
    faults.value = [];
  }

  // ---------------- 剖切 ----------------
  const section = ref<SectionPlaneConfig>({ ...DEFAULT_SECTION });

  function patchSection(patch: Partial<SectionPlaneConfig>): void {
    section.value = { ...section.value, ...patch };
  }

  function resetSection(): void {
    section.value = { ...DEFAULT_SECTION };
  }

  // ---------------- 工程持久化(浏览器本地) ----------------
  const projectName = ref('未命名工况');
  const projectId = ref(uid('proj'));
  const savedProjects = ref<SavedProject[]>([]);
  const lastSaveCost = ref(0);

  async function refreshProjectList(): Promise<void> {
    savedProjects.value = await storage.listProjects();
  }

  function buildProjectFile(): ProjectFile {
    return model.toProjectFile(projectName.value, faults.value, section.value);
  }

  async function saveCurrent(): Promise<void> {
    const data = buildProjectFile();
    const record: SavedProject = {
      id: projectId.value,
      name: projectName.value,
      updatedAt: Date.now(),
      modelFileName: model.modelFileName,
      modelFingerprint: model.modelFingerprintValue,
      data,
    };
    await storage.saveProject(record);
    await refreshProjectList();
  }

  function exportFile(): void {
    downloadProjectFile(buildProjectFile());
  }

  /**
   * 载入分享来的工况文件。
   * 要求本地已导入同指纹模型;返回警告信息(如关节/零件路径缺失)。
   */
  async function importProjectFile(file: File): Promise<string[]> {
    const text = await file.text();
    const data = JSON.parse(text) as ProjectFile;
    if (data.format !== 'line-fault-studio') {
      throw new Error('文件格式不正确:缺少 line-fault-studio 标识');
    }
    if (!model.hasModel) {
      throw new Error('请先导入对应的产线装配模型,再载入工况文件');
    }
    if (data.model.fingerprint !== model.modelFingerprintValue) {
      throw new Error(
        `模型不匹配:工况文件基于「${data.model.fileName}」,当前模型为「${model.modelFileName}」`,
      );
    }
    model.applyProjectFile(data);
    faults.value = data.faults;
    section.value = data.section;
    frameCount.value = data.frameCount || FRAME_COUNT;
    projectName.value = data.name;
    setFrame(0);
    const warnings: string[] = [];
    const jointPaths = Object.keys(data.joints);
    const missingJoints = jointPaths.filter((p) => !model.joints.has(p));
    if (missingJoints.length) {
      warnings.push(`${missingJoints.length} 个关节路径在当前模型中不存在,已忽略`);
    }
    return warnings;
  }

  async function loadSaved(id: string): Promise<void> {
    const record = savedProjects.value.find((p) => p.id === id);
    if (!record) return;
    if (!model.hasModel || record.modelFingerprint !== model.modelFingerprintValue) {
      throw new Error('请先导入与该工程匹配的模型');
    }
    model.applyProjectFile(record.data);
    faults.value = record.data.faults;
    section.value = record.data.section;
    projectName.value = record.name;
    projectId.value = record.id;
    setFrame(0);
  }

  async function deleteSaved(id: string): Promise<void> {
    await storage.deleteProject(id);
    await refreshProjectList();
  }

  function rename(name: string): void {
    projectName.value = name || '未命名工况';
  }

  return {
    // timeline
    currentFrame,
    playing,
    playDirection,
    frameCount,
    timeT,
    setFrame,
    setTime,
    play,
    pause,
    togglePlay,
    setDirection,
    // faults
    faults,
    injectFault,
    removeFault,
    clearFaults,
    // section
    section,
    patchSection,
    resetSection,
    // persistence
    projectName,
    projectId,
    savedProjects,
    lastSaveCost,
    refreshProjectList,
    saveCurrent,
    exportFile,
    importProjectFile,
    loadSaved,
    deleteSaved,
    rename,
  };
});
