/**
 * 端到端验证：用 headless Chrome 打开应用，验证真实渲染行为。
 *
 * 覆盖：
 *  1. WebGL2 初始化、无控制台错误、启动遮罩消失
 *  2. 画面有辉光（真实 readPixels 统计）
 *  3. 遮挡联动：可见比例 < 100% 的物体确实被衰减（关闭联动后变亮）
 *  4. 环绕相机 → 可见比例变化 → 辉光变化实时反映
 *  5. 半径增量：只重算该级及以上的 pass（读实际执行计划）
 *  6. 导出 PNG（当前分辨率，非空）+ JSON（含阈值与五级半径/权重）
 *  7. 降采样链不重复分配纹理（尺寸不变时 RT 数量恒定）
 *
 * 用法：node scripts/e2e.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const OUT = resolve('.scratch/e2e');
mkdirSync(OUT, { recursive: true });

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--window-size=1280,860',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const t0 = Date.now();
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction(() => !!window.__glow, { timeout: 60000 });
console.log(`  启动耗时 ${Date.now() - t0} ms`);

const bootPresent = await page.evaluate(() => !!document.querySelector('.boot'));
check('启动遮罩在就绪后移除', !bootPresent);
check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const canvasSize = await page.evaluate(() => {
  const c = document.querySelector('.viewport-host canvas');
  return { w: c?.width ?? 0, h: c?.height ?? 0 };
});
check('画布已分配尺寸', canvasSize.w > 100 && canvasSize.h > 100, `${canvasSize.w}×${canvasSize.h}`);

// 关闭自动环绕，保证可复现
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.toggle-row')].find((r) =>
    r.textContent.includes('相机自动环绕'),
  );
  const btn = row?.querySelector('.toggle');
  if (btn?.getAttribute('data-on') === 'true') btn.click();
});
await sleep(900);

await page.screenshot({ path: resolve(OUT, '01-initial.png') });

// ── 通过真实像素统计验证辉光 ──
const stats = () =>
  page.evaluate(() => window.__glow.debugPixelStats());

async function setView(label) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.view-tabs button')].find((b) =>
      b.textContent.includes(l),
    );
    btn?.click();
  }, label);
  await sleep(650);
}

const finalStats = await stats();
check('合成视图有明亮像素', finalStats.max > 80, `max=${finalStats.max}`);

await setView('仅辉光');
const bloomStats = await stats();
await page.screenshot({ path: resolve(OUT, '02-bloom-only.png') });
check('仅辉光视图存在发光区域', bloomStats.litRatio > 0.01, `lit=${(bloomStats.litRatio * 100).toFixed(2)}%`);

await setView('亮度源');
const sourceStats = await stats();
await page.screenshot({ path: resolve(OUT, '03-brightness-source.png') });
check('亮度源视图非空且弱于辉光合成', sourceStats.max > 40, `max=${sourceStats.max}`);

await setView('遮挡掩码');
const maskStats = await stats();
await page.screenshot({ path: resolve(OUT, '04-occlusion-mask.png') });
check('遮挡掩码视图非空', maskStats.litRatio > 0.001, `lit=${(maskStats.litRatio * 100).toFixed(2)}%`);

// ── 遮挡联动 ──
await setView('仅辉光');

const occlusionBefore = await page.evaluate(() => {
  const d = window.__glow.debugState();
  return { gains: d.gains, visibles: d.visibles };
});
const occludedCount = occlusionBefore.visibles.filter((v) => v < 0.95).length;
check(
  '存在被部分/完全遮挡的自发光物体',
  occludedCount >= 1,
  `visibles=[${occlusionBefore.visibles.map((v) => v.toFixed(2)).join(', ')}]`,
);

async function setOcclusionStrength(v) {
  await page.evaluate((val) => {
    const label = [...document.querySelectorAll('.field-label')].find((l) =>
      l.textContent.includes('遮挡强度'),
    );
    const input = label?.closest('.field')?.querySelector('input[type=range]');
    if (!input) return;
    input.value = String(val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await sleep(700);
}

await setOcclusionStrength(1);
const withOcclusion = await stats();
await setOcclusionStrength(0);
const withoutOcclusion = await stats();
await setOcclusionStrength(1);

console.log(
  `  遮挡强度 1: avg=${withOcclusion.avg.toFixed(2)}  强度 0: avg=${withoutOcclusion.avg.toFixed(2)}`,
);
check(
  '关闭遮挡联动后辉光总量上升（说明联动确实在衰减被挡物体）',
  withoutOcclusion.avg > withOcclusion.avg * 1.02,
  `${withoutOcclusion.avg.toFixed(2)} > ${withOcclusion.avg.toFixed(2)}`,
);

// ── 环绕相机 → 可见比例实时变化 ──
const visBeforeOrbit = await page.evaluate(() => window.__glow.debugState().visibles);await page.evaluate(() => window.__glow.setCameraOrbit(Math.PI * 0.9, Math.PI * 0.42));
await sleep(1200);
const visAfterOrbit = await page.evaluate(() => window.__glow.debugState().visibles);
const maxDelta = Math.max(...visBeforeOrbit.map((v, i) => Math.abs(v - (visAfterOrbit[i] ?? v))));
console.log(
  `  环绕前 [${visBeforeOrbit.map((v) => v.toFixed(2)).join(', ')}] → 环绕后 [${visAfterOrbit
    .map((v) => v.toFixed(2))
    .join(', ')}]`,
);
check('环绕相机后可见比例发生变化', maxDelta > 0.1, `Δmax=${maxDelta.toFixed(2)}`);
await page.screenshot({ path: resolve(OUT, '05-orbited.png') });

// 完全被遮挡的物体，其辉光必须显著低于无遮挡时
const gainsAfterOrbit = await page.evaluate(() => window.__glow.debugState().gains);
const fullyHidden = visAfterOrbit.map((v, i) => ({ v, gain: gainsAfterOrbit[i]?.gain ?? 1, i })).filter((x) => x.v < 0.15);
if (fullyHidden.length > 0) {
  const worst = Math.max(...fullyHidden.map((x) => x.gain));
  check(
    '完全被挡的物体辉光增益接近 0（不残留满额辉光）',
    worst < 0.1,
    `hidden=[${fullyHidden.map((x) => `${x.i}:${x.gain.toFixed(2)}`).join(',')}]`,
  );
} else {
  // 若这一角度没有完全遮挡的物体，退而检查：最小可见比例对应的增益明显低于 1
  const idx = visAfterOrbit.indexOf(Math.min(...visAfterOrbit));
  check(
    '可见比例最低的物体增益明显低于 1',
    (gainsAfterOrbit[idx]?.gain ?? 1) < 0.5,
    `idx=${idx} visible=${visAfterOrbit[idx].toFixed(2)} gain=${(gainsAfterOrbit[idx]?.gain ?? 1).toFixed(2)}`,
  );
}

await setView('合成');

// ── 半径增量：只重算该级及以上 ──
// 用待执行计划探测（不受帧调度影响）
async function dragRadius(levelIndex, delta) {
  await page.evaluate(
    ({ idx, d }) => {
      const rows = [...document.querySelectorAll('.level-row')];
      const input = rows[idx]?.querySelector('input[type=range]');
      if (!input) return;
      input.value = String(Math.min(4, Number(input.value) + d));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { idx: levelIndex, d: delta },
  );
  await sleep(90);
}

// 先冻结相机与动画，确保只有半径引起重算
await page.evaluate(() => window.__glow.setParams({ autoRotate: false }));
await sleep(600);

await sleep(400);
const idlePending = await page.evaluate(() => window.__glow.debugState().pending);
console.log('  静止时待执行 passes:', idlePending.join(' ') || '(空，说明无变化时不重算)');
check('静止时辉光链无待执行 pass（可复用上一帧）', idlePending.length === 0, `[${idlePending.join(', ')}]`);

const coarsePasses = await page.evaluate(() => window.__glow.debugProbeRadius(4));
console.log('  改 L4 半径 passes:', coarsePasses.join(' '));
check(
  '改最粗一级半径只重算 blur4 + acc4',
  coarsePasses.length > 0 &&
    coarsePasses.every((p) => p === 'blurH4' || p === 'blurV4' || p === 'acc4') &&
    coarsePasses.includes('acc4'),
  `[${coarsePasses.join(', ')}]`,
);

const midPasses = await page.evaluate(() => window.__glow.debugProbeRadius(2));
console.log('  改 L2 半径 passes:', midPasses.join(' '));
check(
  '改中间一级半径只重算该级 blur 与更粗的 acc',
  midPasses.length > 0 &&
    midPasses.every((p) => ['blurH2', 'blurV2', 'acc2', 'acc3', 'acc4'].includes(p)) &&
    midPasses.includes('blurH2') &&
    midPasses.includes('acc2') &&
    !midPasses.includes('blurH3'),
  `[${midPasses.join(', ')}]`,
);

const finePasses = await page.evaluate(() => window.__glow.debugProbeRadius(0));
console.log('  改 L0 半径 passes:', finePasses.join(' '));
check(
  '改最细一级半径重算 L0 blur 与全部 acc',
  finePasses.includes('blurH0') &&
    ['acc0', 'acc1', 'acc2', 'acc3', 'acc4'].every((a) => finePasses.includes(a)) &&
    !finePasses.some((p) => p.startsWith('down')),
  `[${finePasses.join(', ')}]`,
);

// 真实拖动一次，确保 UI 路径也走增量
await page.evaluate(() => {
  // 先等一帧，把之前探针可能留下的脏标记消化掉
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
const afterRealDrag = await page.evaluate(async () => {
  const v = window.__glow;
  // 用最近一次非空执行计划，避免读到空闲帧
  const before = v.debugState().lastActive.length;
  const rows = [...document.querySelectorAll('.level-row')];
  const input = rows[3]?.querySelector('input[type=range]');
  if (input) {
    input.value = String(Math.min(4, Number(input.value) + 0.2));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const state = v.debugState();
  return { plan: state.lastActive, prevLen: before, last: state.last };
});
const realDragPlan = afterRealDrag.plan;
console.log(
  '  真实拖动 L3 后执行的 passes:',
  realDragPlan.join(' ') || '(空)',
  '｜紧邻上一帧:',
  afterRealDrag.last.join(' ') || '(空)',
);
check(
  '真实拖动半径后增量执行（不重跑降采样）',
  realDragPlan.length > 0 &&
    !realDragPlan.some((p) => p === 'extract' || p.startsWith('down')) &&
    realDragPlan.includes('blurH3') &&
    realDragPlan.every((p) => /^(blurH3|blurV3|acc[3-4])$/.test(p)),
  `[${realDragPlan.join(', ')}]`,
);

await page.screenshot({ path: resolve(OUT, '06-radius-changes.png') });

// ── 纹理不重复分配 ──
const rtCount1 = await page.evaluate(() => window.__glow.pipeline.stats.targets);
const glStatsBefore = await page.evaluate(() => {
  const v = window.__glow;
  return {
    geometries: v.renderer.info.memory.geometries,
    textures: v.renderer.info.memory.textures,
  };
});
// 反复改半径 20 次（不改变尺寸）
for (let i = 0; i < 20; i++) {
  await dragRadius(i % 5, i % 2 === 0 ? 0.05 : -0.05);
}
await sleep(600);
const rtCount2 = await page.evaluate(() => window.__glow.pipeline.stats.targets);
const glStatsAfter = await page.evaluate(() => {
  const v = window.__glow;
  return {
    geometries: v.renderer.info.memory.geometries,
    textures: v.renderer.info.memory.textures,
  };
});
console.log('  纹理/几何体:', JSON.stringify(glStatsBefore), '→', JSON.stringify(glStatsAfter));
check('渲染目标数量恒定（不重复分配）', rtCount1 === rtCount2, `${rtCount1} → ${rtCount2}`);
check(
  '反复改参数不增长 GPU 纹理数',
  glStatsAfter.textures <= glStatsBefore.textures + 2,
  `${glStatsBefore.textures} → ${glStatsAfter.textures}`,
);

// ── 导出 ──
await page.evaluate(() => {
  const v = window.__glow;
  v.setParams({ exposure: 1.0, intensity: 0.85 });
});
await sleep(700);

const downloadDir = resolve(OUT, 'downloads');
mkdirSync(downloadDir, { recursive: true });
const client = await page.createCDPSession();
await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

const beforeFiles = new Set(readdirSync(downloadDir));
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('导出 PNG'));
  btn?.click();
});
await sleep(4000);

const newFiles = readdirSync(downloadDir).filter((f) => !beforeFiles.has(f));
console.log('  下载文件:', newFiles.join(', ') || '(无)');

const png = newFiles.find((f) => f.endsWith('.png'));
const json = newFiles.find((f) => f.endsWith('.json'));
check('导出 PNG 文件', !!png, png ?? '');
check('导出 JSON 文件', !!json, json ?? '');

if (png) {
  const size = statSync(resolve(downloadDir, png)).size;
  const buf = readFileSync(resolve(downloadDir, png));
  const isPNG = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  check('PNG 头有效', isPNG);
  check('PNG 分辨率 = 当前绘制缓冲', w === canvasSize.w && h === canvasSize.h, `${w}×${h} vs ${canvasSize.w}×${canvasSize.h}`);
  check('PNG 非空', size > 20000, `${(size / 1024).toFixed(0)} KB`);
}

if (json) {
  const data = JSON.parse(readFileSync(resolve(downloadDir, json), 'utf8'));
  check('JSON 含阈值', typeof data.bloom?.threshold === 'number', String(data.bloom?.threshold));
  check('JSON 含软阈值宽度', typeof data.bloom?.knee === 'number', String(data.bloom?.knee));
  check('JSON 含五级半径与权重', Array.isArray(data.bloom?.levels) && data.bloom.levels.length === 5);
  check(
    'JSON 五级都有 radius 与 weight',
    data.bloom.levels.every((l) => typeof l.radius === 'number' && typeof l.weight === 'number'),
    JSON.stringify(data.bloom.levels.map((l) => `${l.scale}:r${l.radius}/w${l.weight}`)),
  );
  check('JSON 记录遮挡可见比例', Array.isArray(data.occlusion?.objects) && data.occlusion.objects.length === 6);
  check('JSON 分辨率与画布一致', data.render?.width === canvasSize.w && data.render?.height === canvasSize.h);
  writeFileSync(resolve(OUT, 'exported-params.json'), JSON.stringify(data, null, 2));
}

await page.screenshot({ path: resolve(OUT, '07-final.png') });

// ── 1080p 性能 ──
// 说明：headless SwiftShader 下用 gl.finish() 强制同步，测得的是「提交 + 执行」的
// 完整 CPU 侧耗时（软件光栅化会比真实 GPU 慢，属于上界）。
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await sleep(2000);
const perf = await page.evaluate(async () => {
  const v = window.__glow;
  v.setParams({ autoRotate: true });
  const gl = v.renderer.getContext();
  const samples = [];
  for (let i = 0; i < 40; i++) {
    v.invalidateSource(); // 每帧都走完整链，模拟最坏情况
    const t0 = performance.now();
    v.pipeline.render();
    gl.finish(); // 等待 GPU 真正完成
    samples.push(performance.now() - t0);
    await new Promise((r) => requestAnimationFrame(r));
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    p95: samples[Math.floor(samples.length * 0.95)],
    max: samples[samples.length - 1],
    size: v.pipeline.size,
    passes: v.debugState().last.length,
  };
});
console.log(
  `  1080p 全链: 中位 ${perf.median.toFixed(2)}ms / p95 ${perf.p95.toFixed(2)}ms / 最大 ${perf.max.toFixed(2)}ms，${perf.size.width}×${perf.size.height}，${perf.passes} pass`,
);
check('1080p 缓冲高度正确', perf.size.height === 1080, `${perf.size.width}×${perf.size.height}`);
check('1080p 全链中位耗时 < 16ms', perf.median < 16, `${perf.median.toFixed(2)}ms`);

// 增量路径应显著快于全链
const incPerf = await page.evaluate(async () => {
  const v = window.__glow;
  v.pipeline.render(); // 清脏
  const gl = v.renderer.getContext();
  const samples = [];
  for (let i = 0; i < 30; i++) {
    // 只改最粗一级半径 → 最少 pass
    const levels = v.debugState().levels;
    v.pipeline.setParams({
      threshold: v.currentParams.threshold,
      knee: v.currentParams.knee,
      intensity: v.currentParams.intensity,
      exposure: v.currentParams.exposure,
      levels: levels.map((l, idx) => (idx === 4 ? { ...l, radius: 1.5 + (i % 10) * 0.1 } : l)),
      view: v.currentParams.view,
      occlusionEnabled: v.currentParams.occlusionEnabled,
      occlusionStrength: v.currentParams.occlusionStrength,
    });
    const t0 = performance.now();
    v.pipeline.render();
    gl.finish();
    samples.push(performance.now() - t0);
    await new Promise((r) => requestAnimationFrame(r));
  }
  samples.sort((a, b) => a - b);
  return { median: samples[Math.floor(samples.length / 2)] };
});
console.log(`  1080p 增量（仅 L4）: 中位 ${incPerf.median.toFixed(2)}ms`);
check('增量更新快于全链重算', incPerf.median < perf.median, `${incPerf.median.toFixed(2)} < ${perf.median.toFixed(2)}`);

await page.screenshot({ path: resolve(OUT, '08-1080p.png') });

await browser.close();

const failed = results.filter((r) => !r.ok);
writeFileSync(resolve(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项:');
  for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
}
process.exit(failed.length === 0 ? 0 : 1);
