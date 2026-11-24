import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import * as THREE from 'three';
import { ModelImporter, type ImportResult } from '../three/ModelImporter';
import type {
  FaultType,
  JointConfig,
  PartNode,
  PartStatus,
  ProjectFile,
} from '../types';
import { defaultKeyframes, clampTravel } from '../utils/anim';
import { applyStatus, collectLeaves, resolveStatus } from '../utils/tree';
import { modelFingerprint, storage } from '../utils/storage';
import { FRAME_COUNT } from '../constants';

/**
 * 模型与装配状态中枢。
 * 渲染重对象(RenderModel / three 材质)用 shallowRef 避免 Vue 深代理拖慢万件场景。
 */
export const useModelStore = defineStore('model', () => {
  const importer = new ModelImporter();

  const nodes = ref<Map<string, PartNode>>(new Map());
  const renderModel = shallowRef<ImportResult | null>(null);
  const sourceMaterials = shallowRef<THREE.Material[]>([]);

  const joints = ref<Map<string, JointConfig>>(new Map());
  const selectedPaths = ref<Set<string>>(new Set());
  const activePath = ref<string | null>(null);

  const modelFileName = ref('');
  const modelFingerprintValue = ref('');
  const loading = ref(false);
  const loadProgress = ref(0);
  const loadMessage = ref('');
  const warnings = ref<string[]>([]);

  const hasModel = computed(() => renderModel.value !== null);
  const partCount = computed(() => renderModel.value?.model.partIdToPath.length ?? 0);
  const triangleCount = computed(() => renderModel.value?.model.totalTriangles ?? 0);
  const jointCount = computed(() => joints.value.size);

  // ---------------- 导入 ----------------

  async function importModel(file: File): Promise<void> {
    loading.value = true;
    loadProgress.value = 0;
    warnings.value = [];
    try {
      const fingerprint = await modelFingerprint(file, file.name);
      const result = await importer.import(file, (pct, msg) => {
        loadProgress.value = pct;
        loadMessage.value = msg;
      });
      renderModel.value = result;
      sourceMaterials.value = result.sourceMaterials;
      nodes.value = result.model.nodes;
      modelFileName.value = file.name;
      modelFingerprintValue.value = fingerprint;

      // 自动为识别出的关节生成默认配置
      const map = new Map<string, JointConfig>();
      for (const baked of result.model.joints.values()) {
        map.set(baked.path, {
          partPath: baked.path,
          enabled: true,
          axis: baked.axis,
          travel: 45,
          gear: 'normal',
          direction: 1,
          keyframes: defaultKeyframes(45),
        });
      }
      joints.value = map;
      selectedPaths.value = new Set();
      activePath.value = null;
      warnings.value = result.warnings;

      // 模型 Blob 存入 IndexedDB,重载工程时可直接取回
      await storage.putModel(fingerprint, file);
    } finally {
      loading.value = false;
    }
  }

  function unload(): void {
    renderModel.value = null;
    sourceMaterials.value = [];
    nodes.value = new Map();
    joints.value = new Map();
    selectedPaths.value = new Set();
    activePath.value = null;
    warnings.value = [];
  }

  // ---------------- 关节 ----------------

  function updateJoint(path: string, patch: Partial<JointConfig>): void {
    const cur = joints.value.get(path);
    if (!cur) return;
    const next: JointConfig = { ...cur, ...patch };
    if (patch.travel !== undefined) {
      next.travel = clampTravel(patch.travel);
      next.keyframes = defaultKeyframes(next.travel);
    }
    joints.value = new Map(joints.value).set(path, next);
  }

  function getJoint(path: string): JointConfig | undefined {
    return joints.value.get(path);
  }

  // ---------------- 选择 ----------------

  function selectOnly(path: string | null): void {
    selectedPaths.value = path === null ? new Set() : new Set([path]);
    activePath.value = path;
  }

  function toggleSelect(path: string): void {
    const next = new Set(selectedPaths.value);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    selectedPaths.value = next;
    activePath.value = path;
  }

  function selectMany(paths: string[], additive: boolean): void {
    const next = additive ? new Set(selectedPaths.value) : new Set<string>();
    for (const p of paths) next.add(p);
    selectedPaths.value = next;
    if (paths.length) activePath.value = paths[0];
  }

  function clearSelection(): void {
    selectedPaths.value = new Set();
  }

  // ---------------- 工况状态(继承 + 覆盖) ----------------

  /** 解析某节点有效状态(沿父链继承) */
  function effectiveStatus(path: string): PartStatus {
    return resolveStatus(path, nodes.value);
  }

  /** 批量设置选中零件状态;inherit 清除覆盖恢复继承 */
  function setStatus(paths: string[], status: PartStatus | 'inherit'): void {
    nodes.value = applyStatus(paths, status, nodes.value);
  }

  /** 故障注入:设置目标零件(及其叶子)状态 */
  function applyFault(path: string, type: FaultType): void {
    const leaves = collectLeaves(path, nodes.value);
    const targets = leaves.length ? leaves : [path];
    nodes.value = applyStatus(targets, type, nodes.value);
  }

  /** 清除故障:目标子树全部恢复继承 */
  function clearFault(path: string): void {
    const leaves = collectLeaves(path, nodes.value);
    const targets = leaves.length ? leaves : [path];
    nodes.value = applyStatus(targets, 'inherit', nodes.value);
  }

  /** 供引擎批量同步:叶子路径 → 有效状态 */
  function leafStatusMap(): Map<string, PartStatus> {
    const out = new Map<string, PartStatus>();
    if (!renderModel.value) return out;
    for (const path of renderModel.value.model.parts.keys()) {
      out.set(path, resolveStatus(path, nodes.value));
    }
    return out;
  }

  /** 供引擎同步的选中叶子集合(父节点选中展开到叶子) */
  function selectedLeafPaths(): Set<string> {
    const out = new Set<string>();
    if (!renderModel.value) return out;
    const allLeafPaths = [...renderModel.value.model.parts.keys()];
    for (const sel of selectedPaths.value) {
      for (const leaf of allLeafPaths) {
        if (leaf === sel || leaf.startsWith(`${sel}/`)) out.add(leaf);
      }
    }
    return out;
  }

  // ---------------- 工程序列化 ----------------

  function toProjectFile(name: string, faults: ProjectFile['faults'], section: ProjectFile['section']): ProjectFile {
    const statuses: Record<string, PartStatus> = {};
    for (const node of nodes.value.values()) {
      if (node.ownStatus !== null) statuses[node.path] = node.ownStatus;
    }
    const jointRecord: Record<string, JointConfig> = {};
    for (const [k, v] of joints.value) jointRecord[k] = v;
    return {
      format: 'line-fault-studio',
      version: 1,
      name,
      exportedAt: Date.now(),
      model: {
        fileName: modelFileName.value,
        fingerprint: modelFingerprintValue.value,
        partCount: partCount.value,
        triangleCount: triangleCount.value,
      },
      joints: jointRecord,
      statuses,
      faults,
      section,
      frameCount: FRAME_COUNT,
    };
  }

  /** 从工程文件恢复关节与状态(模型需已导入且指纹匹配) */
  function applyProjectFile(data: ProjectFile): void {
    const map = new Map<string, JointConfig>();
    for (const [path, cfg] of Object.entries(data.joints)) {
      if (nodes.value.has(path)) map.set(path, cfg);
    }
    joints.value = map;
    const next = new Map(nodes.value);
    for (const node of next.values()) node.ownStatus = null;
    for (const [path, status] of Object.entries(data.statuses)) {
      const node = next.get(path);
      if (node) node.ownStatus = status;
    }
    nodes.value = next;
    selectedPaths.value = new Set();
  }

  return {
    // state
    nodes,
    renderModel,
    sourceMaterials,
    joints,
    selectedPaths,
    activePath,
    modelFileName,
    modelFingerprintValue,
    loading,
    loadProgress,
    loadMessage,
    warnings,
    hasModel,
    partCount,
    triangleCount,
    jointCount,
    // actions
    importModel,
    unload,
    updateJoint,
    getJoint,
    selectOnly,
    toggleSelect,
    selectMany,
    clearSelection,
    effectiveStatus,
    setStatus,
    applyFault,
    clearFault,
    leafStatusMap,
    selectedLeafPaths,
    toProjectFile,
    applyProjectFile,
  };
});
