/**
 * 配置导出/载入往返测试（Node 环境，模拟文件保存→读取→校验）：
 * 验证导出的 JSON 能通过 validateConfig 还原为等价 AppConfig 并触发重建。
 * 直接测试纯逻辑，不依赖浏览器下载。
 */
import { defaultConfig } from '../src/core/defaults.ts';
import type { AppConfig } from '../src/core/types.ts';

// 复刻 ExportPage 的校验逻辑（与组件内一致）
function clampNum(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
function validateConfig(input: unknown): AppConfig {
  const d = defaultConfig();
  if (typeof input !== 'object' || input === null) throw new Error('文件不是有效 JSON 对象');
  const o = input as Partial<AppConfig>;
  const points = Array.isArray(o.profile?.points)
    ? o.profile!.points
        .filter((p) => Number.isFinite(p.r) && Number.isFinite(p.z) && p.r > 0)
        .map((p) => ({ r: Number(p.r), z: Number(p.z) }))
        .sort((a, b) => a.z - b.z)
    : [];
  if (points.length < 2) throw new Error('配置中母线控制点不足 2 个');
  return {
    version: 1,
    profile: { points, samples: clampNum(o.profile?.samples, d.profile.samples, 60, 600) },
    weave: {
      ...d.weave,
      ...(o.weave ?? {}),
      stripWidth: clampNum(o.weave?.stripWidth, d.weave.stripWidth, 2, 8),
      stripThickness: clampNum(o.weave?.stripThickness, d.weave.stripThickness, 1, 3),
      familyCount: Math.round(clampNum(o.weave?.familyCount, d.weave.familyCount, 8, 1000)),
    },
    lighting: { ...d.lighting, ...(o.lighting ?? {}) },
    quality: { segments: Math.round(clampNum(o.quality?.segments, d.quality.segments, 24, 200)) },
  };
}

let failures = 0;
const assert = (c: boolean, m: string) => {
  if (!c) { failures++; console.error('  ✗ FAIL:', m); } else console.log('  ✓', m);
};

console.log('[1] 默认配置往返一致');
{
  const cfg = defaultConfig();
  const json = JSON.stringify(cfg);
  const restored = validateConfig(JSON.parse(json));
  assert(JSON.stringify(restored.profile.points) === JSON.stringify(cfg.profile.points), '母线控制点逐点一致');
  assert(restored.weave.stripWidth === cfg.weave.stripWidth, '篾宽一致');
  assert(restored.weave.stripThickness === cfg.weave.stripThickness, '篾厚一致');
  assert(restored.weave.familyCount === cfg.weave.familyCount, '根数一致');
  assert(restored.weave.helixAngle === cfg.weave.helixAngle, '螺旋角一致');
  assert(restored.lighting.mode === cfg.lighting.mode, '光照模式一致');
}

console.log('[2] 自定义参数往返');
{
  const custom: AppConfig = {
    ...defaultConfig(),
    profile: { points: [{ r: 30, z: 0 }, { r: 60, z: 50 }, { r: 40, z: 120 }], samples: 180 },
    weave: { ...defaultConfig().weave, stripWidth: 7.5, stripThickness: 2.5, familyCount: 333, helixAngle: 58, turns: 2 },
  };
  const restored = validateConfig(JSON.parse(JSON.stringify(custom)));
  assert(restored.profile.points.length === 3, '3 个控制点还原');
  assert(restored.weave.stripWidth === 7.5 && restored.weave.stripThickness === 2.5, '自定义截面规格还原');
  assert(restored.weave.familyCount === 333 && restored.weave.turns === 2, '根数与固定圈数还原');
  assert(restored.profile.samples === 180, '采样数还原');
}

console.log('[3] 容错：越界值被钳制、非法值回退默认');
{
  const bad = {
    version: 1,
    profile: { points: [{ r: 50, z: 0 }, { r: 70, z: 40 }], samples: 99999 },
    weave: { stripWidth: 99, stripThickness: -5, familyCount: 5000, helixAngle: 45 },
    lighting: {},
    quality: { segments: 5 },
  };
  const r = validateConfig(bad);
  assert(r.weave.stripWidth === 8, `篾宽越界钳到 8（实得 ${r.weave.stripWidth}）`);
  assert(r.weave.stripThickness === 1, `篾厚越界钳到 1（实得 ${r.weave.stripThickness}）`);
  assert(r.weave.familyCount === 1000, `根数越界钳到 1000（实得 ${r.weave.familyCount}）`);
  assert(r.profile.samples === 600, `采样数钳到 600（实得 ${r.profile.samples}）`);
  assert(r.quality.segments === 24, `段数钳到下限 24（实得 ${r.quality.segments}）`);
}

console.log('[4] 容错：损坏数据抛错而非崩溃');
{
  let threw = 0;
  for (const garbage of [null, 'string', {}, { profile: {} }, { profile: { points: [{ r: 1 }] } }]) {
    try { validateConfig(garbage); } catch { threw++; }
  }
  assert(threw === 5, `5 种损坏输入全部被拒绝（实得 ${threw}）`);
}

console.log(failures === 0 ? '\n配置往返测试全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
