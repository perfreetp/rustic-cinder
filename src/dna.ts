/**
 * DNA 双螺旋几何计算模块。
 * 所有长度单位为纳米(nm),螺旋轴为 Y 轴。
 * 修改任一参数(螺距 / 每圈碱基数 / 序列)后,调用 computeLayout 全量重算
 * 骨架与碱基对位置,保证整条链联动更新。
 */

export type Base = "A" | "T" | "G" | "C";

export const COMPLEMENT: Record<Base, Base> = { A: "T", T: "A", G: "C", C: "G" };

/** 按碱基类型着色 (RGB 0-1):A 绿 / T 红 / G 琥珀 / C 蓝 */
export const BASE_COLORS: Record<Base, [number, number, number]> = {
  A: [0.3, 0.72, 0.35],
  T: [0.9, 0.25, 0.25],
  G: [0.98, 0.75, 0.1],
  C: [0.2, 0.55, 0.92],
};

export const BASE_COLOR_HEX: Record<Base, string> = {
  A: "#4db859",
  T: "#e54040",
  G: "#fabf1a",
  C: "#338ceb",
};

const PURINES = new Set<Base>(["A", "G"]);

/** 骨架(磷酸)到螺旋轴的距离 */
export const BACKBONE_RADIUS = 1.0;
/** 碱基平面厚度 */
export const BASE_THICKNESS = 0.12;
/** 嘌呤(双环)比嘧啶(单环)更长更宽 */
export const PURINE_LEN = 1.02;
export const PYRIM_LEN = 0.78;
export const PURINE_W = 0.52;
export const PYRIM_W = 0.42;

export interface ValidationResult {
  /** 去空白并转大写后的序列 */
  cleaned: string;
  /** 仅含合法碱基的部分 */
  validPart: string;
  /** 出现的非法字符(去重) */
  invalidChars: string[];
  valid: boolean;
}

export function validateSequence(input: string): ValidationResult {
  const cleaned = input.toUpperCase().replace(/\s+/g, "");
  const invalid = new Set<string>();
  let validPart = "";
  for (const ch of cleaned) {
    if (ch === "A" || ch === "T" || ch === "G" || ch === "C") validPart += ch;
    else invalid.add(ch);
  }
  return {
    cleaned,
    validPart,
    invalidChars: [...invalid],
    valid: invalid.size === 0 && cleaned.length > 0,
  };
}

/** GC 含量(百分比) */
export function gcContent(seq: string): number {
  if (!seq.length) return 0;
  let gc = 0;
  for (const ch of seq) if (ch === "G" || ch === "C") gc++;
  return (gc / seq.length) * 100;
}

export interface HelixLayout {
  /** 碱基对数量 */
  count: number;
  /** 每个碱基的轴向上升高度 (nm) */
  rise: number;
  /** 螺旋总高度 (nm) */
  totalHeight: number;
  /** 链 A 骨架(磷酸)坐标,xyz * count */
  backboneA: Float32Array;
  /** 链 B 骨架坐标,xyz * count */
  backboneB: Float32Array;
  /** 碱基盒体中心坐标,实例顺序为 [A0,B0,A1,B1,...],xyz * 2n */
  basePositions: Float32Array;
  /** 每个碱基实例绕 Y 轴的旋转角 */
  baseAngles: Float32Array;
  /** 每个碱基实例的缩放(长,厚,宽),xyz * 2n */
  baseScales: Float32Array;
  /** 每个碱基实例的颜色 RGBA * 2n */
  baseColors: Float32Array;
  /** 每对碱基的氢键数(A-T=2,G-C=3) */
  hbondCounts: Uint8Array;
  /** 链 A 碱基内端点(氢键起点),xyz * n */
  pairInnerA: Float32Array;
  /** 链 B 碱基内端点,xyz * n */
  pairInnerB: Float32Array;
}

/**
 * 根据序列与螺旋参数计算整条链的布局。
 * @param pitch 螺距 (nm),范围 3.0 - 3.6
 * @param basesPerTurn 每圈碱基数
 */
export function computeLayout(
  sequence: string,
  pitch: number,
  basesPerTurn: number,
): HelixLayout {
  const n = sequence.length;
  const rise = pitch / basesPerTurn;
  const step = (Math.PI * 2) / basesPerTurn;
  const R = BACKBONE_RADIUS;

  const backboneA = new Float32Array(n * 3);
  const backboneB = new Float32Array(n * 3);
  const basePositions = new Float32Array(n * 2 * 3);
  const baseAngles = new Float32Array(n * 2);
  const baseScales = new Float32Array(n * 2 * 3);
  const baseColors = new Float32Array(n * 2 * 4);
  const hbondCounts = new Uint8Array(n);
  const pairInnerA = new Float32Array(n * 3);
  const pairInnerB = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    const theta = i * step;
    const y = i * rise;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    // 两条链的磷酸骨架位置(相差 180°)
    backboneA[i * 3] = R * cos;
    backboneA[i * 3 + 1] = y;
    backboneA[i * 3 + 2] = R * sin;
    backboneB[i * 3] = -R * cos;
    backboneB[i * 3 + 1] = y;
    backboneB[i * 3 + 2] = -R * sin;

    const bA = (sequence[i] as Base) ?? "A";
    const bB = COMPLEMENT[bA];
    const lenA = PURINES.has(bA) ? PURINE_LEN : PYRIM_LEN;
    const lenB = PURINES.has(bB) ? PURINE_LEN : PYRIM_LEN;
    const wA = PURINES.has(bA) ? PURINE_W : PYRIM_W;
    const wB = PURINES.has(bB) ? PURINE_W : PYRIM_W;
    const rA = R - lenA / 2;
    const rB = R - lenB / 2;

    // 链 A 碱基实例(索引 2i)
    basePositions[i * 6] = rA * cos;
    basePositions[i * 6 + 1] = y;
    basePositions[i * 6 + 2] = rA * sin;
    baseAngles[i * 2] = -theta;
    baseScales[i * 6] = lenA;
    baseScales[i * 6 + 1] = BASE_THICKNESS;
    baseScales[i * 6 + 2] = wA;

    // 链 B 碱基实例(索引 2i+1),位于对侧
    basePositions[i * 6 + 3] = -rB * cos;
    basePositions[i * 6 + 4] = y;
    basePositions[i * 6 + 5] = -rB * sin;
    baseAngles[i * 2 + 1] = -theta + Math.PI;
    baseScales[i * 6 + 3] = lenB;
    baseScales[i * 6 + 4] = BASE_THICKNESS;
    baseScales[i * 6 + 5] = wB;

    const cA = BASE_COLORS[bA];
    const cB = BASE_COLORS[bB];
    baseColors[i * 8] = cA[0];
    baseColors[i * 8 + 1] = cA[1];
    baseColors[i * 8 + 2] = cA[2];
    baseColors[i * 8 + 3] = 1;
    baseColors[i * 8 + 4] = cB[0];
    baseColors[i * 8 + 5] = cB[1];
    baseColors[i * 8 + 6] = cB[2];
    baseColors[i * 8 + 7] = 1;

    hbondCounts[i] = bA === "A" || bA === "T" ? 2 : 3;

    const inA = R - lenA;
    const inB = R - lenB;
    pairInnerA[i * 3] = inA * cos;
    pairInnerA[i * 3 + 1] = y;
    pairInnerA[i * 3 + 2] = inA * sin;
    pairInnerB[i * 3] = -inB * cos;
    pairInnerB[i * 3 + 1] = y;
    pairInnerB[i * 3 + 2] = -inB * sin;
  }

  return {
    count: n,
    rise,
    totalHeight: n * rise,
    backboneA,
    backboneB,
    basePositions,
    baseAngles,
    baseScales,
    baseColors,
    hbondCounts,
    pairInnerA,
    pairInnerB,
  };
}
