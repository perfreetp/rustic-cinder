import { describe, expect, it } from 'vitest';
import { brightnessWeight, extractBrightSource, levelDimensions, linearLuminance } from '../src/core/brightness';

describe('亮度提取', () => {
  it('Rec.709 亮度', () => {
    expect(linearLuminance(1, 0, 0)).toBeCloseTo(0.2126, 5);
    expect(linearLuminance(0, 1, 0)).toBeCloseTo(0.7152, 5);
    expect(linearLuminance(1, 1, 1)).toBeCloseTo(1, 5);
  });

  it('阈值为 0 时全部保留（但仍是按亮度加权）', () => {
    expect(brightnessWeight(0.5, 0, 0.3)).toBeCloseTo(1, 6);
  });

  it('低于阈值完全剔除', () => {
    expect(brightnessWeight(0.99, 1.0, 0.3)).toBe(0);
    expect(brightnessWeight(0.0, 0.0, 0.5)).toBe(0);
  });

  it('高于阈值+宽度时为 1', () => {
    expect(brightnessWeight(1.31, 1.0, 0.3)).toBeCloseTo(1, 6);
    expect(brightnessWeight(5, 2, 0.1)).toBeCloseTo(1, 6);
  });

  it('过渡带内单调递增且在两端连续', () => {
    const lo = brightnessWeight(1.0, 1.0, 0.4);
    const mid = brightnessWeight(1.2, 1.0, 0.4);
    const hi = brightnessWeight(1.4, 1.0, 0.4);
    expect(lo).toBeCloseTo(0, 6);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(hi).toBeCloseTo(1, 6);
    expect(mid).toBeGreaterThan(lo);
    expect(hi).toBeGreaterThan(mid);
  });

  it('knee = 0 时退化为硬阈值', () => {
    expect(brightnessWeight(1.0, 1.0, 0)).toBe(0);
    expect(brightnessWeight(1.0001, 1.0, 0)).toBe(1);
  });

  it('NaN 亮度不会被当成辉光', () => {
    expect(brightnessWeight(Number.NaN, 1, 0.3)).toBe(0);
  });

  it('extractBrightSource 保持颜色比例、只做加权', () => {
    // 两个像素：一个远超阈值，一个低于阈值
    const src = new Float32Array([4, 2, 1, 1, 0.1, 0.1, 0.1, 1]);
    const dst = new Float32Array(8);
    extractBrightSource(src, dst, 1.0, 0.3);
    expect(dst[0]).toBe(4);
    expect(dst[1]).toBe(2);
    expect(dst[2]).toBe(1);
    expect(dst[4]).toBe(0);
    expect(dst[5]).toBe(0);
    expect(dst[6]).toBe(0);
    expect(dst[3]).toBe(1);
    expect(dst[7]).toBe(1);
  });

  it('extractBrightSource 在过渡带内输出少于原值', () => {
    // luma = 1.1 → weight 在 0..1 之间
    const src = new Float32Array([1.1, 1.1, 1.1, 1]);
    const dst = new Float32Array(4);
    extractBrightSource(src, dst, 1.0, 0.4);
    expect(dst[0]!).toBeGreaterThan(0);
    expect(dst[0]!).toBeLessThan(1.1);
  });
});

describe('分级尺寸', () => {
  it('L0..L4 依次为 1/2 .. 1/32', () => {
    const dims = [0, 1, 2, 3, 4].map((l) => levelDimensions(1920, 1080, l));
    expect(dims).toEqual([
      { width: 960, height: 540 },
      { width: 480, height: 270 },
      { width: 240, height: 135 },
      { width: 120, height: 67 },
      { width: 60, height: 33 },
    ]);
  });

  it('极小分辨率不会退化为 0', () => {
    for (let l = 0; l < 5; l++) {
      const d = levelDimensions(4, 4, l);
      expect(d.width).toBeGreaterThanOrEqual(1);
      expect(d.height).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('受控随机：阈值单调性', () => {
  it('阈值升高时保留的像素数不增加', () => {
    const rand = (seed: number) => {
      let s = seed >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
      };
    };
    const r = rand(42);
    const src = new Float32Array(400);
    for (let i = 0; i < src.length; i++) src[i] = r() * 3;

    const count = (threshold: number) => {
      const dst = new Float32Array(src.length);
      extractBrightSource(src, dst, threshold, 0.2);
      let n = 0;
      for (let i = 0; i < dst.length; i += 4) if (dst[i]! > 0) n++;
      return n;
    };

    const a = count(0.5);
    const b = count(1.0);
    const c = count(1.8);
    expect(a).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThanOrEqual(c);
  });
});
