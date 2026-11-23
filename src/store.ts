import { createStore } from "solid-js/store";

export interface DnaParams {
  /** 螺距 (nm),3.0 - 3.6 */
  pitch: number;
  /** 每圈碱基数 */
  basesPerTurn: number;
}

export interface DnaSequence {
  id: string;
  name: string;
  sequence: string;
  params: DnaParams;
}

interface AppState {
  sequences: DnaSequence[];
  currentId: string;
}

const STORAGE_KEY = "dna-helix-assembler-v1";

export const DEFAULT_PARAMS: DnaParams = { pitch: 3.4, basesPerTurn: 10.5 };

export const PITCH_MIN = 3.0;
export const PITCH_MAX = 3.6;

const DEFAULT_SEQ =
  "ATGCGTACGTTAGCCGGATCGATCGTACGATCGTAGCTAGCATCGATGCTAGCTAGCGGCTA";

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function initialState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (Array.isArray(parsed.sequences) && parsed.sequences.length > 0) {
        // 兼容旧数据:补齐缺失的参数
        for (const s of parsed.sequences) {
          s.params = { ...DEFAULT_PARAMS, ...(s.params ?? {}) };
        }
        if (!parsed.sequences.some((s) => s.id === parsed.currentId)) {
          parsed.currentId = parsed.sequences[0].id;
        }
        return parsed;
      }
    }
  } catch {
    // 本地数据损坏时回退到默认
  }
  const first: DnaSequence = {
    id: uid(),
    name: "示例序列",
    sequence: DEFAULT_SEQ,
    params: { ...DEFAULT_PARAMS },
  };
  return { sequences: [first], currentId: first.id };
}

export const [state, setState] = createStore<AppState>(initialState());

/** 把全部序列与参数保存到浏览器本地 */
export function saveState(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sequences: state.sequences, currentId: state.currentId }),
    );
  } catch {
    // 存储已满或被禁用时静默失败
  }
}

export function currentSequence(): DnaSequence {
  return (
    state.sequences.find((s) => s.id === state.currentId) ?? state.sequences[0]
  );
}

export function addSequence(name: string, sequence: string): string {
  const id = uid();
  setState("sequences", state.sequences.length, {
    id,
    name: name || `序列 ${state.sequences.length + 1}`,
    sequence,
    params: { ...DEFAULT_PARAMS },
  });
  setState("currentId", id);
  return id;
}

export function removeSequence(id: string): void {
  if (state.sequences.length <= 1) return; // 至少保留一条
  const idx = state.sequences.findIndex((s) => s.id === id);
  if (idx < 0) return;
  setState(
    "sequences",
    state.sequences.filter((s) => s.id !== id),
  );
  if (state.currentId === id) {
    setState("currentId", state.sequences[0].id);
  }
}

export function updateSequence(
  id: string,
  patch: Partial<Pick<DnaSequence, "name" | "sequence">>,
): void {
  const idx = state.sequences.findIndex((s) => s.id === id);
  if (idx < 0) return;
  if (patch.name !== undefined) setState("sequences", idx, "name", patch.name);
  if (patch.sequence !== undefined)
    setState("sequences", idx, "sequence", patch.sequence);
}

export function updateParams(id: string, patch: Partial<DnaParams>): void {
  const idx = state.sequences.findIndex((s) => s.id === id);
  if (idx < 0) return;
  if (patch.pitch !== undefined)
    setState("sequences", idx, "params", "pitch", patch.pitch);
  if (patch.basesPerTurn !== undefined)
    setState("sequences", idx, "params", "basesPerTurn", patch.basesPerTurn);
}
