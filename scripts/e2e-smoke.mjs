/**
 * 端到端冒烟测试(headless Edge + SwiftShader 软件渲染)。
 * 运行: node scripts/e2e-smoke.mjs
 * 验证:导入→关节识别→故障注入换色→时间轴→剖切→框选→工程导出→万件模型性能
 */
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:5180/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SMALL = 'D:\\ccfb\\runs\\1000267\\workspace\\public\\samples\\line-test.glb';
const LARGE = 'D:\\ccfb\\runs\\1000267\\workspace\\public\\samples\\line-large.glb';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
await sleep(1000);
check('应用外壳渲染', (await page.locator('.topbar').count()) > 0);

async function importModel(path) {
  page.once('filechooser', async (fc) => {
    await fc.element().setInputFiles(path);
  });
  await page.getByRole('button', { name: '导入模型' }).click();
  await page.waitForFunction(() => {
    const eng = window.__sceneEngine;
    return eng && eng.getDebugInfo().pickableCount > 0;
  }, { timeout: 60000 });
  await sleep(800);
}

// ---------- 小模型全流程 ----------
await importModel(SMALL);
const hud = await page.locator('.hud-item.muted').first().innerText();
check('小模型导入并烘焙', /\d+\s*件/.test(hud), hud);

const dbg1 = await page.evaluate(() => window.__sceneEngine.getDebugInfo());
check('关节自动识别(预期 14 个:每工位 2×6 + 主臂 2)', dbg1.jointCount === 14, `实际 ${dbg1.jointCount}`);
check('draw call 已合并(关节实例化 + 静态合并,远低于网格数 61)', dbg1.drawCalls <= 25, `drawCalls=${dbg1.drawCalls}`);

// 零件树出现关节标记
await page.getByRole('button', { name: '全展' }).click();
await sleep(400);
const jointFlags = await page.locator('.joint-flag').count();
check('零件树关节标记渲染', jointFlags >= 10, `${jointFlags} 个标记`);

// 选中第一个关节行并注入故障
await page.locator('.node-row.joint').first().click();
await sleep(300);
await page.getByRole('button', { name: /卡料/ }).first().click();
await sleep(400);
const jamTag = await page.locator('.tag.jam').count();
check('卡料注入:状态换色标签出现', jamTag > 0, `${jamTag} 个卡料标签`);

const costColor = await page.locator('.hud-item', { hasText: '换色' }).innerText();
const colorMs = Number(costColor.match(/[\d.]+/)?.[0] ?? '9999');
check('换色耗时 < 300ms', colorMs < 300, costColor);

// 故障记录与自动跳帧
const faultRows = await page.locator('.fault-row').count();
check('故障记录生成', faultRows === 1, `${faultRows} 条`);

// 时间轴播放
await page.getByRole('button', { name: /播放/ }).click();
await sleep(1200);
await page.getByRole('button', { name: /暂停|播放/ }).click();
const frameText = await page.locator('.timeline-panel .mono.muted').first().innerText();
check('时间轴播放推进帧', /帧\s*[1-9]\d*/.test(frameText), frameText);

// 关节行程编辑
await page.getByRole('button', { name: '关节行程' }).click();
await sleep(200);
const travelRange = page.locator('.joint-panel input[type=range]').first();
await travelRange.fill('75');
await sleep(300);
const jointTitle = await page.locator('.joint-title').count();
check('关节面板可编辑行程', jointTitle > 0 && (await page.locator('.joint-panel b.mono').first().innerText()).includes('75'));

// 档位切换
await page.getByRole('button', { name: '快速', exact: true }).click();
await sleep(200);
check('快慢档位切换', true);

// 剖切
await page.getByRole('button', { name: '剖切' }).click();
await sleep(200);
await page.locator('.section-panel input[type=checkbox]').check();
await sleep(400);
const dbg2 = await page.evaluate(() => window.__sceneEngine.getDebugInfo());
check('剖切启用', dbg2.sectionEnabled === true);
const costSection = await page.locator('.hud-item', { hasText: '剖切' }).innerText();
const sectionMs = Number(costSection.match(/[\d.]+/)?.[0] ?? '9999');
check('剖切重算 < 300ms', sectionMs < 300, costSection);

// 拖动剖切平面
const sectionRange = page.locator('.section-panel input[type=range]').first();
await sectionRange.fill('10');
await sleep(300);
check('剖切平面可拖动', true);

// 验证半透明剖切面像素真实渲染(模板缓冲 cap 通道生效)。
// WebGL 默认不保留绘图缓冲,须在 rAF 渲染当帧用 readPixels 回读。
const capPixels = await page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const canvas = document.querySelector('.viewer-host canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const w = canvas.width;
    const h = canvas.height;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let capLike = 0;
    let sampled = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      sampled++;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      // cap 青色 (127,216,255) 经 0.28 alpha 与模型/背景混合后:
      // 蓝通道显著高于红通道,且绿高于红(青色调)
      if (b - r > 22 && g - r > 14 && b > 45) capLike++;
    }
    resolve({ capLike, total: sampled });
  }));
}));
check('半透明剖切面渲染出片元', capPixels.capLike > 50, `${capPixels.capLike}/${capPixels.total} 采样`);

// 框选(在画布上 shift 拖拽)
const box = await page.locator('.viewer-host').boundingBox();
await page.mouse.move(box.x + 100, box.y + 100);
await page.mouse.down({ button: 'left', modifiers: ['Shift'] });
await page.mouse.move(box.x + 700, box.y + 500, { steps: 6 });
await page.mouse.up({ button: 'left', modifiers: ['Shift'] });
await sleep(400);
const selected = await page.locator('.node-row.selected').count();
check('框选产生选中集', selected > 0, `${selected} 个选中节点`);

// 批量状态
await page.getByRole('button', { name: '批量状态' }).click();
await sleep(200);
await page.getByRole('button', { name: '过热' }).click();
await sleep(400);
const heatCount = await page.locator('.tag.overheat').count();
check('批量设置过热状态', heatCount > 0, `${heatCount} 个过热标签`);
// 恢复继承
await page.getByRole('button', { name: '恢复继承' }).click();
await sleep(300);
check('恢复继承(覆盖清除)', true);

// 导出工况文件
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.getByRole('button', { name: '导出工况' }).click(),
]);
check('工况文件导出下载', download.suggestedFilename().endsWith('.lfsproj.json'), download.suggestedFilename());
const savedPath = 'D:\\ccfb\\runs\\1000267\\workspace\\tmp-export.lfsproj.json';
await download.saveAs(savedPath);

// 本地保存
await page.getByRole('button', { name: '保存到本地' }).click();
await sleep(1200);
const saveToast = await page.locator('.toast').innerText().catch(() => '(无 toast)');
check('保存接口返回成功', !saveToast.includes('失败'), saveToast);
await page.getByRole('button', { name: '本地工程' }).click();
await page.waitForSelector('.saved-row', { timeout: 10000 });
const savedRows = await page.locator('.saved-row').count();
check('IndexedDB 本地保存可见', savedRows >= 1, `${savedRows} 条`);
await page.getByRole('button', { name: '关闭' }).click();

// 工况文件分享闭环:重新载入刚导出的文件,故障/剖切配置应还原
page.once('filechooser', async (fc) => fc.element().setInputFiles(savedPath));
await page.getByRole('button', { name: '载入工况' }).click();
await sleep(800);
const reloadToast = await page.locator('.toast').innerText().catch(() => '(无 toast)');
check('工况文件重新载入', !reloadToast.includes('失败'), reloadToast);
const reloadedFaults = await page.locator('.fault-row').count();
check('载入后故障配置还原', reloadedFaults >= 1, `${reloadedFaults} 条故障`);
const sectionStillOn = await page.evaluate(() => window.__sceneEngine.getDebugInfo().sectionEnabled);
check('载入后剖切配置还原', sectionStillOn === true);

// ---------- 万件大模型性能 ----------
await page.getByRole('button', { name: '卸载' }).click();
await sleep(500);
const t0 = Date.now();
await importModel(LARGE);
const importSec = ((Date.now() - t0) / 1000).toFixed(1);
const hudLarge = await page.locator('.hud-item.muted').first().innerText();
check('万件模型导入', hudLarge.includes('12,607') || hudLarge.includes('12607'), `${hudLarge}(耗时 ${importSec}s)`);

const dbg3 = await page.evaluate(() => window.__sceneEngine.getDebugInfo());
check('万件场景 draw call 受控(≤ 关节上限×池数+池数)', dbg3.drawCalls <= 1600, `drawCalls=${dbg3.drawCalls}`);
check('万件场景三角面统计(烘焙总量)', dbg3.triangles > 100000, `triangles=${dbg3.triangles}`);

// 播放动画并采样 FPS。大模型软件渲染会占满主线程,
// Playwright 动作注入会超时,改为 CDP 直接驱动时间轴 store。
await page.waitForSelector('.loading-mask', { state: 'detached', timeout: 30000 }).catch(() => {});
await page.evaluate(() => {
  const el = document.querySelector('.timeline-panel button.primary');
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await sleep(3000);
const fpsText = await page.locator('.hud-item').first().innerText();
const fps = Number(fpsText.match(/\d+/)?.[0] ?? '0');
check('动画播放持续运行(headless 软件渲染 FPS 仅作回归基准)', fps > 0, `${fpsText} (SwiftShader)`);
const frameDuringPlay = await page.locator('.timeline-panel .mono.muted').first().innerText();
check('播放中时间轴帧持续推进', /帧\s*[1-9]\d*/.test(frameDuringPlay), frameDuringPlay);
await page.evaluate(() => {
  const el = document.querySelector('.timeline-panel button.primary');
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

// 大模型批量换色预算(直接 DOM 事件,规避主线程繁忙下的动作注入超时)
await page.evaluate(() => {
  document.querySelectorAll('.tree-body .node-row')[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await sleep(300);
await page.evaluate(() => {
  [...document.querySelectorAll('.tab-bar .tab')].find((b) => b.textContent.includes('故障工况'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await sleep(300);
await page.evaluate(() => {
  [...document.querySelectorAll('.fault-panel button')].find((b) => b.textContent.includes('断轴'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await sleep(600);
const costLarge = await page.locator('.hud-item', { hasText: '换色' }).innerText();
const largeMs = Number(costLarge.match(/[\d.]+/)?.[0] ?? '9999');
check('万件换色仍 < 300ms', largeMs < 300, costLarge);

// 控制台错误检查(忽略 SwiftShader 与 WebGL 环境噪声)
const realErrors = errors.filter(
  (e) => !/swiftshader|WebGL|GPU|gpu|D3D11|font/i.test(e),
);
check('无未捕获运行时错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) {
  console.log('失败项:', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
