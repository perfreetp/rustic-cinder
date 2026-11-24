/**
 * 亮度提取的纯数学部分（无 WebGL 依赖，便于单元测试）。
 *
 * 规则与着色器保持一致：
 *  - 亮度 = 线性 RGB 的 Rec.709 亮度
 *  - 低于阈值的像素完全不参与辉光（weight = 0）
 *  - 阈值到 阈值+宽度 之间做 smoothstep 过渡
 *  - 高于过渡带的像素 weight = 1
 */

export function linearLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 亮度权重，与 extract 着色器中的 smoothstep 完全一致。 */
export function brightnessWeight(luma: number, threshold: number, knee: number): number {
  if (!(luma > threshold)) return 0; // 同时挡掉 NaN
  if (knee <= 1e-6) return 1;
  const t = Math.min(1, (luma - threshold) / knee);
  return t * t * (3 - 2 * t);
}

/**
 * CPU 参考实现：对 RGBA Float32 像素数组做阈值提取，写入 rgb 输出（alpha 恒为 1）。
 * 用于单元测试与「亮度源」视图的一致性校验。
 */
export function extractBrightSource(
  src: ArrayLike<number>,
  dst: Float32Array,
  threshold: number,
  knee: number,
): void {
  const pixels = Math.floor(src.length / 4);
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const r = src[o]!;
    const g = src[o + 1]!;
    const b = src[o + 2]!;
    const w = brightnessWeight(linearLuminance(r, g, b), threshold, knee);
    dst[o] = r * w;
    dst[o + 1] = g * w;
    dst[o + 2] = b * w;
    dst[o + 3] = 1;
  }
}

/** 五级缓冲尺寸：L0 = 1/2，L4 = 1/32。 */
export function levelDimensions(width: number, height: number, level: number): {
  width: number;
  height: number;
} {
  const divisor = 2 ** (level + 1);
  return {
    width: Math.max(1, Math.floor(width / divisor)),
    height: Math.max(1, Math.floor(height / divisor)),
  };
}
