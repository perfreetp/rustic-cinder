import { create } from 'zustand';
import type {
  BaseShapeId,
  BrushSettings,
  MaterialSettings,
  PrecisionId,
  Stroke,
  SymAxis,
  ToolId,
  Vec3,
} from '../core/types';
import type { EngineStats } from '../core/engine';

export interface HistoryEntry {
  id: string;
  kind: Stroke['kind'];
  label: string;
  at: number;
  /** 这一笔完成后的完整笔刷栈快照 */
  strokes: Stroke[];
}

export interface StudioState {
  phase: 'start' | 'editing';
  projectName: string;
  baseShape: BaseShapeId;
  precision: PrecisionId;
  strokes: Stroke[];
  material: MaterialSettings;
  mirrorAxis: SymAxis | null;
  tool: ToolId;
  brush: BrushSettings;
  /** 选中的笔 (移动工具 / 高亮) */
  selectedStrokeId: string | null;
  history: HistoryEntry[];
  /** 当前生效的历史位置 (-1 = 初始形体, 未落下任何一笔) */
  historyIndex: number;
  stats: EngineStats | null;
  busy: boolean;
  error: string | null;
  /** 每次几何输入变化 +1, 运行时据此触发重建 */
  revision: number;
  /** 网格或材质变化 +1, 视口据此刷新 */
  meshRevision: number;
  exportStatus: 'idle' | 'busy' | 'done' | 'error';
  exportMessage: string | null;
  showStats: boolean;
  autoRotate: boolean;
  /** 平滑笔刷按住时的实时强度 (0..1); null = 未按住 */
  holdStrength: number | null;
}

const MATERIAL_PRESETS: Record<string, MaterialSettings> = {
  clay: {
    preset: 'clay',
    color: '#c96f52',
    roughness: 0.62,
    metalness: 0.02,
    clearcoat: 0.18,
    clearcoatRoughness: 0.5,
    envIntensity: 0.85,
  },
  porcelain: {
    preset: 'porcelain',
    color: '#e9e6df',
    roughness: 0.36,
    metalness: 0.0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.22,
    envIntensity: 1.0,
  },
  resin: {
    preset: 'resin',
    color: '#4c6f8f',
    roughness: 0.3,
    metalness: 0.08,
    clearcoat: 0.95,
    clearcoatRoughness: 0.14,
    envIntensity: 1.15,
  },
  graphite: {
    preset: 'graphite',
    color: '#3b3f45',
    roughness: 0.52,
    metalness: 0.55,
    clearcoat: 0.35,
    clearcoatRoughness: 0.4,
    envIntensity: 1.1,
  },
};

export function materialPreset(id: MaterialSettings['preset']): MaterialSettings {
  return { ...MATERIAL_PRESETS[id] };
}

export const MATERIAL_PRESET_ORDER: MaterialSettings['preset'][] = ['clay', 'porcelain', 'resin', 'graphite'];

export const MATERIAL_LABELS: Record<MaterialSettings['preset'], string> = {
  clay: '陶土',
  porcelain: '素瓷',
  resin: '树脂',
  graphite: '石墨',
};

let strokeSeq = 0;
export function nextStrokeId() {
  strokeSeq += 1;
  return `stroke-${Date.now().toString(36)}-${strokeSeq}`;
}

export const DEFAULT_BRUSH: BrushSettings = {
  shape: 'sphere',
  radiusLevel: 1,
  hardnessLevel: 1,
  blendLevel: 1,
};

const STORAGE_KEY = 'form-studio.project.v1';

export function loadSavedProject(): {
  baseShape: BaseShapeId;
  strokes: Stroke[];
  precision: PrecisionId;
  material: MaterialSettings;
  mirrorAxis: SymAxis | null;
  name: string;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || p.version !== 1 || !Array.isArray(p.strokes)) return null;
    return {
      baseShape: p.baseShape ?? 'sphere',
      strokes: p.strokes,
      precision: p.precision ?? 'standard',
      material: { ...materialPreset('clay'), ...(p.material ?? {}) },
      mirrorAxis: p.mirrorAxis ?? null,
      name: p.name ?? '未命名造型',
    };
  } catch {
    return null;
  }
}

function persist(state: StudioState) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        baseShape: state.baseShape,
        strokes: state.strokes,
        precision: state.precision,
        material: state.material,
        mirrorAxis: state.mirrorAxis,
        name: state.projectName,
        updatedAt: Date.now(),
      }),
    );
  } catch {
    /* 配额或隐私模式: 静默忽略 */
  }
}

let persistTimer: number | undefined;
function schedulePersist(state: StudioState) {
  if (typeof window === 'undefined') return;
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => persist(state), 350);
}

const initial: StudioState = {
  phase: 'start',
  projectName: '未命名造型',
  baseShape: 'sphere',
  precision: 'standard',
  strokes: [],
  material: materialPreset('clay'),
  mirrorAxis: null,
  tool: 'add',
  brush: DEFAULT_BRUSH,
  selectedStrokeId: null,
  history: [],
  historyIndex: -1,
  stats: null,
  busy: false,
  error: null,
  revision: 0,
  meshRevision: 0,
  exportStatus: 'idle',
  exportMessage: null,
  showStats: true,
  autoRotate: false,
  holdStrength: null,
};

interface Actions {
  beginProject: (base: BaseShapeId, saved?: ReturnType<typeof loadSavedProject>) => void;
  resetProject: () => void;
  setTool: (t: ToolId) => void;
  setBrush: (patch: Partial<BrushSettings>) => void;
  setMirrorAxis: (a: SymAxis | null) => void;
  setPrecision: (p: PrecisionId) => void;
  setMaterial: (patch: Partial<MaterialSettings>) => void;
  setMaterialPreset: (id: MaterialSettings['preset']) => void;
  /** 提交一笔 (完成落笔) */
  commitStroke: (stroke: Stroke) => void;
  /** 拖动中更新最后一笔 */
  liveUpdateStroke: (stroke: Stroke) => void;
  /** 删除一笔 */
  removeStroke: (id: string) => void;
  selectStroke: (id: string | null) => void;
  undo: () => void;
  restoreHistory: (index: number) => void;
  setStats: (s: EngineStats | null) => void;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  bumpMesh: () => void;
  setExport: (status: StudioState['exportStatus'], message?: string | null) => void;
  setProjectName: (n: string) => void;
  setAutoRotate: (v: boolean) => void;
  setHoldStrength: (v: number | null) => void;
}

function labelFor(kind: Stroke['kind'], i: number) {
  const verb = kind === 'add' ? '添加' : kind === 'erase' ? '削除' : '平滑';
  return `${verb}笔 #${i}`;
}

export const useStudio = create<StudioState & Actions>((set, get) => ({
  ...initial,

  beginProject: (base, saved) =>
    set(() => ({
      ...initial,
      phase: 'editing',
      baseShape: saved?.baseShape ?? base,
      strokes: saved?.strokes ?? [],
      precision: saved?.precision ?? 'standard',
      material: saved?.material ?? materialPreset('clay'),
      mirrorAxis: saved?.mirrorAxis ?? null,
      projectName: saved?.name ?? '未命名造型',
      // 从已保存笔刷栈恢复: 历史栈按笔重建
      history: (saved?.strokes ?? []).map((s, i) => ({
        id: s.id,
        kind: s.kind,
        label: labelFor(s.kind, i + 1),
        at: s.createdAt,
        strokes: (saved?.strokes ?? []).slice(0, i + 1),
      })),
      historyIndex: (saved?.strokes?.length ?? 0) - 1,
      revision: 1,
    })),

  resetProject: () => {
    set({ ...initial });
  },

  setTool: (t) => set({ tool: t, selectedStrokeId: t === 'move' ? get().selectedStrokeId : null }),

  setBrush: (patch) => set({ brush: { ...get().brush, ...patch } }),

  setMirrorAxis: (a) => {
    // 对称轴是"当前笔刷设置": 对已有笔触不追溯, 只影响之后的落笔
    set({ mirrorAxis: a });
    schedulePersist(get());
  },

  setPrecision: (p) => {
    set({ precision: p, busy: true, revision: get().revision + 1 });
    schedulePersist(get());
  },

  setMaterial: (patch) => {
    set({ material: { ...get().material, ...patch }, meshRevision: get().meshRevision + 1 });
    schedulePersist(get());
  },

  setMaterialPreset: (id) =>
    set({ material: materialPreset(id), meshRevision: get().meshRevision + 1 }),

  commitStroke: (stroke) => {
    const s = get();
    // 在历史中间回退后继续编辑: 先丢掉"未来"的条目
    const base = s.history.slice(0, s.historyIndex + 1);
    const existingIdx = base.findIndex((h) => h.id === stroke.id);
    const strokes = existingIdx >= 0 || s.strokes.some((x) => x.id === stroke.id)
      ? [...s.strokes.filter((x) => x.id !== stroke.id), stroke]
      : [...s.strokes, stroke];
    let history: HistoryEntry[];
    let index: number;
    if (existingIdx >= 0) {
      history = base.slice();
      history[existingIdx] = {
        ...history[existingIdx],
        strokes: strokes.slice(),
        at: Date.now(),
      };
      index = existingIdx;
    } else {
      history = base.slice();
      history.push({
        id: stroke.id,
        kind: stroke.kind,
        label: labelFor(stroke.kind, history.length + 1),
        at: Date.now(),
        strokes: strokes.slice(),
      });
      index = history.length - 1;
    }
    set({
      strokes,
      history,
      historyIndex: index,
      busy: true,
      revision: s.revision + 1,
      selectedStrokeId: stroke.id,
    });
    schedulePersist(get());
  },

  liveUpdateStroke: (stroke) => {
    const s = get();
    const idx = s.strokes.findIndex((x) => x.id === stroke.id);
    const strokes = idx >= 0 ? s.strokes.map((x) => (x.id === stroke.id ? stroke : x)) : [...s.strokes, stroke];
    set({ strokes, busy: true, revision: s.revision + 1 });
  },

  removeStroke: (id) => {
    const s = get();
    const idx = s.history.findIndex((h) => h.id === id);
    if (idx < 0) {
      const strokes = s.strokes.filter((x) => x.id !== id);
      set({ strokes, revision: s.revision + 1, busy: true });
      schedulePersist(get());
      return;
    }
    // 删除一笔后, 它之后的所有快照都需要去掉这一笔
    const history = s.history
      .filter((h) => h.id !== id)
      .map((h) => ({ ...h, strokes: h.strokes.filter((x) => x.id !== id) }));
    const nextIndex = Math.min(history.length - 1, Math.max(-1, s.historyIndex - (idx <= s.historyIndex ? 1 : 0)));
    const strokes = nextIndex >= 0 ? history[nextIndex].strokes.slice() : [];
    set({
      strokes,
      history,
      historyIndex: nextIndex,
      selectedStrokeId: s.selectedStrokeId === id ? null : s.selectedStrokeId,
      revision: s.revision + 1,
      busy: true,
    });
    schedulePersist(get());
  },

  selectStroke: (id) => set({ selectedStrokeId: id }),

  undo: () => {
    const s = get();
    if (s.historyIndex < 0) return;
    get().restoreHistory(s.historyIndex - 1);
  },

  restoreHistory: (index) => {
    const s = get();
    const clamped = Math.max(-1, Math.min(s.history.length - 1, index));
    const entry = clamped >= 0 ? s.history[clamped] : null;
    set({
      strokes: entry ? entry.strokes.slice() : [],
      historyIndex: clamped,
      selectedStrokeId: null,
      revision: s.revision + 1,
      busy: true,
    });
    schedulePersist(get());
  },

  setStats: (stats) => set({ stats, busy: false }),
  setBusy: (b) => set({ busy: b }),
  setError: (e) => set({ error: e }),
  bumpMesh: () => set({ meshRevision: get().meshRevision + 1 }),
  setExport: (status, message = null) => set({ exportStatus: status, exportMessage: message }),
  setProjectName: (n) => {
    set({ projectName: n });
    schedulePersist(get());
  },
  setAutoRotate: (v) => set({ autoRotate: v }),
  setHoldStrength: (v) => set({ holdStrength: v }),
}));

/** 供运行时读取最新值 (避免闭包过期) */
export const getStudio = useStudio.getState;
