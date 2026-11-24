import { describe, expect, it } from 'vitest';
import {
  applyParamDiff,
  clearDirty,
  createDirtyFlags,
  diffParams,
  levelDimensions,
  markRadiusDirty,
  markSourceDirty,
  markWeightDirty,
  planPasses,
} from '../src/core/pipelinePlan';

describe('降采样链的脏标记调度', () => {
  it('初始状态：全链重算，且顺序正确', () => {
    const d = createDirtyFlags(5);
    const passes = planPasses(d);
    expect(passes[0]).toBe('extract');
    // 降采样和模糊按 0..4
    for (let i = 0; i < 5; i++) {
      expect(passes).toContain(`blurH${i}`);
      expect(passes).toContain(`blurV${i}`);
      expect(passes).toContain(`acc${i}`);
    }
    // down1..4 存在，但不存在 down0（extract 直接写入 L0）
    for (let i = 1; i < 5; i++) expect(passes).toContain(`down${i}`);
    expect(passes).not.toContain('down0');
  });

  it('每次 pass 只出现一次', () => {
    const passes = planPasses(createDirtyFlags(5));
    expect(new Set(passes).size).toBe(passes.length);
  });

  it('清空后没有 pass（纯相机不动、参数不变时应零开销）', () => {
    const d = createDirtyFlags(5);
    clearDirty(d);
    expect(planPasses(d)).toEqual([]);
  });

  it('只改某一级半径：只重算该级 blur 与该级及更粗的 acc', () => {
    const d = createDirtyFlags(5);
    clearDirty(d);
    markRadiusDirty(d, 2);
    const passes = planPasses(d);

    expect(passes).toContain('blurH2');
    expect(passes).toContain('blurV2');
    // 更细的层级不受影响
    expect(passes).not.toContain('blurH0');
    expect(passes).not.toContain('blurH1');
    expect(passes).not.toContain('blurH3');
    expect(passes).not.toContain('blurH4');
    // 该级及更粗的 acc
    expect(passes).toEqual(expect.arrayContaining(['acc2', 'acc3', 'acc4']));
    expect(passes).not.toContain('acc0');
    expect(passes).not.toContain('acc1');
    // 不重跑降采样
    expect(passes.some((p) => p.startsWith('down'))).toBe(false);
    expect(passes).not.toContain('extract');
  });

  it('改最粗一级半径：只重算 L4 与该级 acc', () => {
    const d = createDirtyFlags(5);
    clearDirty(d);
    markRadiusDirty(d, 4);
    const passes = planPasses(d);
    expect(passes.sort()).toEqual(['acc4', 'blurH4', 'blurV4'].sort());
  });

  it('改最细一级半径：重算 L0 blur 与全部 acc', () => {
    const d = createDirtyFlags(5);
    clearDirty(d);
    markRadiusDirty(d, 0);
    const passes = planPasses(d);
    expect(passes).toContain('blurH0');
    expect(passes).not.toContain('blurH1');
    for (let i = 0; i < 5; i++) expect(passes).toContain(`acc${i}`);
  });

  it('改权重不影响 blur', () => {
    const d = createDirtyFlags(5);
    clearDirty(d);
    markWeightDirty(d, 3);
    const passes = planPasses(d);
    expect(passes.some((p) => p.startsWith('blur'))).toBe(false);
    expect(passes).toEqual(expect.arrayContaining(['acc3', 'acc4']));
    expect(passes).not.toContain('acc2');
  });

  it('源变化会重算整条链', () => {
    const d = createDirtyFlags(5);
    clearDirty(d);
    markSourceDirty(d);
    const passes = planPasses(d);
    expect(passes[0]).toBe('extract');
    for (let i = 0; i < 5; i++) {
      expect(passes).toContain(`blurH${i}`);
      expect(passes).toContain(`acc${i}`);
    }
  });

  it('acc 按由细到粗的顺序执行（保证累加缓冲可用）', () => {
    const passes = planPasses(createDirtyFlags(5));
    const accOrder = passes.filter((p) => p.startsWith('acc')).map((p) => Number(p.slice(3)));
    expect(accOrder).toEqual([0, 1, 2, 3, 4]);
  });

  it('越界索引安全忽略', () => {
    const d = createDirtyFlags(5);
    clearDirty(d);
    markRadiusDirty(d, -1);
    markRadiusDirty(d, 99);
    markWeightDirty(d, 42);
    expect(planPasses(d)).toEqual([]);
  });
});

describe('参数差异比对', () => {
  const base = {
    threshold: 1,
    knee: 0.3,
    levels: [
      { radius: 1, weight: 1 },
      { radius: 1.5, weight: 0.8 },
    ],
  };

  it('无变化时无脏标记', () => {
    const diff = diffParams(base, { ...base, levels: base.levels.map((l) => ({ ...l })) });
    expect(diff.sourceDirty).toBe(false);
    expect(diff.radiusChanged).toEqual([]);
    expect(diff.weightChanged).toEqual([]);
  });

  it('阈值/软阈值变化触发源脏', () => {
    expect(diffParams(base, { ...base, threshold: 1.1 }).sourceDirty).toBe(true);
    expect(diffParams(base, { ...base, knee: 0.4 }).sourceDirty).toBe(true);
  });

  it('仅某级半径变化时只有该级被标记', () => {
    const next = {
      ...base,
      levels: [{ radius: 1, weight: 1 }, { radius: 2.0, weight: 0.8 }],
    };
    const diff = diffParams(base, next);
    expect(diff.sourceDirty).toBe(false);
    expect(diff.radiusChanged).toEqual([1]);
    expect(diff.weightChanged).toEqual([]);
  });

  it('applyParamDiff 落到正确的 pass 集合', () => {
    const d = createDirtyFlags(5);
    clearDirty(d);
    const diff = { sourceDirty: false, radiusChanged: [3], weightChanged: [] };
    applyParamDiff(d, diff);
    const passes = planPasses(d);
    expect(passes.sort()).toEqual(['acc3', 'acc4', 'blurH3', 'blurV3'].sort());
  });

  it('分级尺寸与 planPasses 使用的 levelDimensions 一致', () => {
    expect(levelDimensions(1920, 1080, 0)).toEqual({ width: 960, height: 540 });
    expect(levelDimensions(1920, 1080, 4)).toEqual({ width: 60, height: 33 });
  });
});
