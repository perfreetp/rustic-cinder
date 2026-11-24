/**
 * 分级缓冲的「脏标记 + 执行计划」——纯逻辑，可单元测试。
 *
 * 缓冲结构（五级，L0 = 1/2 分辨率 … L4 = 1/32）：
 *
 *   extract ─► L0 ─┬─ blurH/V0 ─► blur0
 *                  └─ down1 ─► L1 ─┬─ blurH/V1 ─► blur1
 *                                  └─ down2 ─► L2 …
 *
 *   合成（由细到粗叠加，累加缓冲始终在 L0 分辨率，保证细节不丢）：
 *     acc0 = blur0 * w0
 *     acc1 = acc0 + upsample(blur1) * w1
 *     acc2 = acc1 + upsample(blur2) * w2
 *     acc3 = acc2 + upsample(blur3) * w3
 *     acc4 = acc3 + upsample(blur4) * w4   ← 完整辉光
 *
 * 依赖关系由此确定：
 *   - 源变化（相机/场景/阈值/尺寸）→ 整条链
 *   - 半径 r_i 变化 → blur[i] 与 acc[i..4]（本级及以上 = 本级与更粗的层级）
 *   - 权重 w_i 变化 → acc[i..4]
 *
 * 这就是「半径改动只重算该级及以上的缓冲」：更细的 acc[0..i-1] 直接复用。
 */

export const LEVEL_COUNT = 5;

export type PassName =
  | 'extract'
  | `down${number}`
  | `blurH${number}`
  | `blurV${number}`
  | `acc${number}`;

export interface DirtyFlags {
  /** 整条降采样链 */
  source: boolean;
  blur: boolean[];
  acc: boolean[];
}

export interface LevelSize {
  width: number;
  height: number;
}

/** 五级缓冲尺寸：L0 = 1/2，L1 = 1/4 … L4 = 1/32。 */
export function levelDimensions(width: number, height: number, level: number): LevelSize {
  const divisor = 2 ** (level + 1);
  return {
    width: Math.max(1, Math.floor(width / divisor)),
    height: Math.max(1, Math.floor(height / divisor)),
  };
}

export function createDirtyFlags(count = LEVEL_COUNT): DirtyFlags {
  return {
    source: true,
    blur: Array.from({ length: count }, () => true),
    acc: Array.from({ length: count }, () => true),
  };
}

/** 源变化：整条链重算。 */
export function markSourceDirty(d: DirtyFlags): void {
  d.source = true;
  d.blur.fill(true);
  d.acc.fill(true);
}

/** 半径变化：本级 blur + 本级及更粗的 acc。 */
export function markRadiusDirty(d: DirtyFlags, level: number): void {
  if (level < 0 || level >= d.blur.length) return;
  d.blur[level] = true;
  for (let i = level; i < d.acc.length; i++) d.acc[i] = true;
}

/** 权重变化：本级及更粗的 acc。 */
export function markWeightDirty(d: DirtyFlags, level: number): void {
  if (level < 0 || level >= d.acc.length) return;
  for (let i = level; i < d.acc.length; i++) d.acc[i] = true;
}

/** 按依赖顺序给出本帧需要执行的全屏 pass（不含最终合成到屏幕）。 */
export function planPasses(d: DirtyFlags): PassName[] {
  const out: PassName[] = [];
  const n = d.blur.length;

  if (d.source) {
    out.push('extract');
    for (let i = 0; i < n; i++) {
      if (i > 0) out.push(`down${i}`);
      out.push(`blurH${i}`, `blurV${i}`);
    }
    // 源变化时 blur 全脏，acc 由下方统一处理
  } else {
    for (let i = 0; i < n; i++) {
      if (d.blur[i]) out.push(`blurH${i}`, `blurV${i}`);
      // 半径只影响本级 blur；更粗的 blur 与更细的 acc 不受影响
    }
  }
  for (let i = 0; i < n; i++) {
    if (d.acc[i]) out.push(`acc${i}`);
  }
  return out;
}

export function clearDirty(d: DirtyFlags): void {
  d.source = false;
  d.blur.fill(false);
  d.acc.fill(false);
}

export interface BloomParamSnapshot {
  threshold: number;
  knee: number;
  levels: readonly { radius: number; weight: number }[];
}

export interface ParamDiff {
  sourceDirty: boolean;
  radiusChanged: number[];
  weightChanged: number[];
}

/** 比较两帧参数，得出需要重算的部分。 */
export function diffParams(prev: BloomParamSnapshot, next: BloomParamSnapshot): ParamDiff {
  const sourceDirty = prev.threshold !== next.threshold || prev.knee !== next.knee;
  const radiusChanged: number[] = [];
  const weightChanged: number[] = [];
  const n = Math.min(prev.levels.length, next.levels.length);
  for (let i = 0; i < n; i++) {
    const a = prev.levels[i]!;
    const b = next.levels[i]!;
    if (a.radius !== b.radius) radiusChanged.push(i);
    if (a.weight !== b.weight) weightChanged.push(i);
  }
  return { sourceDirty, radiusChanged, weightChanged };
}

/** 把参数差异写进脏标记。 */
export function applyParamDiff(d: DirtyFlags, diff: ParamDiff): void {
  if (diff.sourceDirty) markSourceDirty(d);
  for (const i of diff.radiusChanged) markRadiusDirty(d, i);
  for (const i of diff.weightChanged) markWeightDirty(d, i);
}
