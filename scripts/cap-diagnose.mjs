import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text()); });
await page.goto('http://127.0.0.1:5180/');
page.once('filechooser', async (fc) => fc.element().setInputFiles('D:/ccfb/runs/1000267/workspace/public/samples/line-test.glb'));
await page.getByRole('button', { name: '导入模型' }).click();
await page.waitForFunction(() => window.__sceneEngine?.getDebugInfo().pickableCount > 0);
await page.waitForTimeout(1000);

// 启用剖切
await page.getByRole('button', { name: '剖切' }).click();
await page.locator('.section-panel input[type=checkbox]').check();
await page.waitForTimeout(600);

const report = await page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const canvas = document.querySelector('.viewer-host canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const w = canvas.width, h = canvas.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // 颜色直方图(量化到 32 级)
    const histo = new Map();
    let nonBg = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i] >> 5, g = px[i+1] >> 5, b = px[i+2] >> 5;
      const key = `${r*32},${g*32},${b*32}`;
      histo.set(key, (histo.get(key) ?? 0) + 1);
      // 背景深色 ~ (20,24,31)
      if (px[i] > 60 || px[i+1] > 60 || px[i+2] > 80) nonBg++;
    }
    const top = [...histo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    // 中心区域像素
    const cx = w >> 1, cy = h >> 1;
    const center = [];
    for (let dy = -2; dy <= 2; dy++) {
      const idx = ((cy + dy) * w + cx) * 4;
      center.push([px[idx], px[idx+1], px[idx+2], px[idx+3]]);
    }
    resolve({ w, h, top, nonBg, center, stencilBits: gl.getParameter(gl.STENCIL_BITS) });
  }));
}));
console.log(JSON.stringify(report, null, 1));
await browser.close();
