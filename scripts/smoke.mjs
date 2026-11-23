// 冒烟测试:验证渲染、联动重算、光斑生成、标记创建
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:5273/';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 3000));

const setTime = (h) =>
  page.evaluate((hh) => {
    const slider = document.querySelector('input[type="range"][min="6"]');
    slider.value = String(hh);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, h);

const setCam = (px, py, pz, tx, ty, tz) =>
  page.evaluate(
    (a) => {
      const s = window.__daylight.scene;
      s.camera.position.set(a[0], a[1], a[2]);
      s.controls.target.set(a[3], a[4], a[5]);
    },
    [px, py, pz, tx, ty, tz],
  );

const patchCount = () =>
  page.evaluate(() => window.__daylight.scene.patchGroup.children.length);

// ① 上午 10:00,室内视角看光斑
await setTime(10);
await setCam(2.2, 2.3, 2.0, -1.2, 0.3, -1.3);
await new Promise((r) => setTimeout(r, 800));
const patches10 = await patchCount();
await page.screenshot({ path: 'smoke-10am.png' });

// ② 下午 15:30,光斑应移动
await setTime(15.5);
await new Promise((r) => setTimeout(r, 800));
const patches15 = await patchCount();
await page.screenshot({ path: 'smoke-1530.png' });

// ③ 框选标记
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('框选标记'))?.click();
});
await new Promise((r) => setTimeout(r, 300));
const box = await (await page.$('.viewport canvas')).boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx - 60, cy - 30);
await page.mouse.down();
await page.mouse.move(cx + 80, cy + 60, { steps: 10 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 800));
const markCount = await page.evaluate(() => document.querySelectorAll('.mark-item').length);

// ④ localStorage 持久化
const persisted = await page.evaluate(() => {
  const raw = localStorage.getItem('daylight-sim-v1');
  if (!raw) return null;
  const d = JSON.parse(raw);
  return { windows: d.windows?.length, marks: d.marks?.length };
});

console.log(JSON.stringify({ patches10, patches15, markCount, persisted, errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
