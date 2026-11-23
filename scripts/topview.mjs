// 俯视验证:光斑随时间移动
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 900 });
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto('http://localhost:5273/', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));

// 俯视相机
await page.evaluate(() => {
  const s = window.__daylight.scene;
  s.camera.position.set(0, 9, 0.01);
  s.controls.target.set(0, 0, 0);
});

for (const h of [8, 10, 12, 15.5, 17.5]) {
  await page.evaluate((hh) => {
    const slider = document.querySelector('input[type="range"][min="6"]');
    slider.value = String(hh);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, h);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `top-${String(h).replace('.', '_')}.png` });
}
await browser.close();
console.log('done');
