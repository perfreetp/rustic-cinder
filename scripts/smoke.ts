/**
 * 浏览器端到端冒烟（puppeteer-core 驱动系统 Chrome，SwiftShader 软件 WebGL）：
 * - 捕获 console / pageerror / 崩溃
 * - 等待 Worker 首次构建完成（HUD 显示“就绪”）
 * - 校验 WebGL 画布存在、四个页签可切换、参数调整触发重建
 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5199/';

const logs: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--window-size=1600,1000',
  ],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  let crashed = false;
  page.on('error', (e) => {
    crashed = true;
    logs.push(`[crash] ${e.message}`);
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(4000);

  // WebGL 支持检测
  const glInfo = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return gl ? { ok: true, vendor: gl.getParameter(gl.VERSION) } : { ok: false };
  }).catch((e) => ({ ok: false, error: String(e) }));
  console.log('WebGL:', JSON.stringify(glInfo));
  if (crashed) {
    console.error('❌ 渲染器崩溃，日志:\n' + logs.join('\n'));
    process.exit(2);
  }

  // 等 Worker 构建（HUD 就绪徽标）
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('.hud-badge')).some((el) => el.textContent?.includes('就绪')),
    { timeout: 20000 },
  ).catch(() => {});
  await sleep(800);

  const hud = await page.evaluate(() => ({
    badge: document.querySelector('.hud-badge')?.textContent ?? null,
    text: document.querySelector('.hud-text')?.textContent ?? null,
    canvasCount: document.querySelectorAll('canvas').length,
    tabs: Array.from(document.querySelectorAll('.tab')).map((t) => t.textContent?.trim()),
    title: document.querySelector('.brand h1')?.textContent ?? null,
  }));
  console.log('HUD:', JSON.stringify(hud, null, 1));

  // 切到母线编辑页，确认 2D 画布与控制点表格
  await page.evaluate(() => Array.from(document.querySelectorAll('.tab')).find((t) => t.textContent?.includes('母线'))?.click());
  await sleep(400);
  const profileInfo = await page.evaluate(() => ({
    canvas2d: !!document.querySelector('.profile-canvas-wrap canvas'),
    pointRows: document.querySelectorAll('.points-table tbody tr').length,
    drawBtn: !!Array.from(document.querySelectorAll('.btn')).find((b) => b.textContent?.includes('手绘')),
  }));
  console.log('母线编辑页:', JSON.stringify(profileInfo));

  // 2000 根篾条性能：操作「每族篾条根数」滑块到 1000
  await page.evaluate(() => Array.from(document.querySelectorAll('.tab')).find((t) => t.textContent?.includes('编织'))?.click());
  await sleep(300);
  const sliderInfo = await page.evaluate(() => {
    const sliders = Array.from(document.querySelectorAll('input[type=range]')) as HTMLInputElement[];
    const target = sliders.find((s) => s.min === '8' && s.max === '1000');
    if (!target) return { found: false };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(target, '1000');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('pointerup', { bubbles: true }));
    return { found: true, value: target.value };
  });
  console.log('根数滑块操作:', JSON.stringify(sliderInfo));
  // 等待重建就绪（HUD 显示 2000 根）
  await page.waitForFunction(
    () => document.querySelector('.hud-text')?.textContent?.includes('篾条 2000 根'),
    { timeout: 20000 },
  );
  await sleep(500);
  const perfHud = await page.evaluate(() => document.querySelector('.hud-text')?.textContent ?? null);
  console.log('2000 根 HUD:', perfHud);

  // FPS 采样（requestAnimationFrame）
  const fps = await page.evaluate(() => new Promise<number>((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = () => {
      frames++;
      if (performance.now() - start >= 1500) resolve(Math.round((frames * 1000) / (performance.now() - start)));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  console.log('2000 根渲染 FPS(软件光栅):', fps);
  await page.screenshot({ path: 'C:/Users/Administrator/AppData/Local/Temp/smoke/app-2000.png' });

  // 切到光照页并切换背光
  await page.evaluate(() => Array.from(document.querySelectorAll('.tab')).find((t) => t.textContent?.includes('光照'))?.click());
  await sleep(300);
  await page.evaluate(() => Array.from(document.querySelectorAll('.mode-btn')).find((b) => b.textContent?.includes('背光'))?.click());
  await sleep(500);
  const backMode = await page.evaluate(() => document.querySelector('.mode-btn-active')?.textContent?.includes('背光'));
  console.log('背光模式激活:', backMode);

  // 切到导出页并生成配置
  await page.evaluate(() => Array.from(document.querySelectorAll('.tab')).find((t) => t.textContent?.includes('导出'))?.click());
  await sleep(300);
  const exportVisible = await page.evaluate(() => document.body.innerText.includes('配置文件'));
  console.log('导出页可见:', exportVisible);

  // 截图：背光 / 侧光（three.js 持有 WebGL 上下文，不再二次 getContext）
  await page.screenshot({ path: 'C:/Users/Administrator/AppData/Local/Temp/smoke/app-backlight.png' });
  // 回侧光再截一张
  await page.evaluate(() => Array.from(document.querySelectorAll('.tab')).find((t) => t.textContent?.includes('光照'))?.click());
  await sleep(200);
  await page.evaluate(() => Array.from(document.querySelectorAll('.mode-btn')).find((b) => b.textContent?.includes('侧光'))?.click());
  await sleep(600);
  await page.screenshot({ path: 'C:/Users/Administrator/AppData/Local/Temp/smoke/app-sidelight.png' });

  const errors = logs.filter((l) => l.includes('error') || l.includes('pageerror') || l.includes('fail'));
  console.log('\n--- 控制台日志（', logs.length, '条）---');
  console.log(logs.join('\n') || '(无)');
  if (errors.length) {
    console.error('\n❌ 发现错误日志');
    process.exit(1);
  }
  if (!hud.canvasCount || !backMode || !exportVisible || !profileInfo.canvas2d || !sliderInfo.found) {
    console.error('\n❌ 功能冒烟失败');
    process.exit(1);
  }
  console.log('\n✅ 浏览器端到端冒烟通过');
} finally {
  await browser.close();
}
