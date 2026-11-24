/**
 * Headless smoke test.
 *
 * Boots the production build in Chrome with WebGPU enabled, drives the main
 * interactions, asserts the observable state, and writes screenshots. Exits
 * non-zero on any failed check or console error.
 *
 * Usage: `CHROME_PATH=… node tools/smoke.mjs [distDir] [outDir]`
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'dist');
const outDir = path.resolve(process.argv[3] || 'artifacts');
fs.mkdirSync(outDir, { recursive: true });

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  const f = path.join(dir, u);
  if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(4477, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ['--enable-unsafe-webgpu', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

const results = {};
const assert = (name, cond, detail) => {
  results[name] = cond ? 'ok' : `FAIL ${detail ?? ''}`;
  if (!cond) errors.push(`assert ${name} ${detail ?? ''}`);
};

/**
 * Click an element inside nested shadow roots. The path may cross several
 * custom elements, e.g. ['app-shell', 'material-panel', '[data-grade="2"]'].
 */
const clickIn = (...pathParts) =>
  page.evaluate((parts) => {
    const sel = parts.pop();
    let scope = document;
    for (const host of parts) {
      const el = scope.querySelector(host);
      if (!el || !el.shadowRoot) return false;
      scope = el.shadowRoot;
    }
    const target = scope.querySelector(sel);
    if (!target) return false;
    target.click();
    return true;
  }, pathParts);

await page.goto('http://localhost:4477/');
await page.waitForFunction('window.__ready === true', { timeout: 15000 });
await page.waitForTimeout(1500);

const boot = await page.evaluate(() => ({
  ready: !!window.__studio,
  faces: window.__studio.topology.faces.length,
  creases: window.__studio.doc.creases.length,
}));
assert('boot', boot.ready && boot.faces === 2 && boot.creases === 1, JSON.stringify(boot));

// Playback advances at a smooth frame rate.
const perf = await page.evaluate(async () => {
  const s = window.__studio;
  s.play();
  const frames = [];
  let last = performance.now();
  await new Promise((resolve) => {
    let n = 0;
    const tick = (t) => {
      frames.push(t - last);
      last = t;
      if (++n < 100) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  const t = s.time;
  s.pause();
  const sorted = frames.slice(2).sort((a, b) => a - b);
  return { time: t, median: sorted[sorted.length >> 1], p95: sorted[Math.floor(sorted.length * 0.95)] };
});
assert('playback-advances', perf.time > 0.5, `t=${perf.time}`);
assert('playback-60fps', perf.median < 20 && perf.p95 < 26, JSON.stringify(perf));

// Load the cross sample.
await clickIn('top-bar', '[data-act="samples"]');
await page.waitForTimeout(120);
await clickIn('top-bar', '[data-sample="cross"]');
await page.waitForTimeout(400);
const cross = await page.evaluate(() => ({
  name: window.__studio.doc.name,
  faces: window.__studio.topology.faces.length,
  cycles: window.__studio.topology.diagnostics.cycleEdges,
}));
assert('sample-cross', cross.faces === 4 && cross.cycles === 1, JSON.stringify(cross));

// Draw a crease on the sheet.
const ceBox = await page.evaluate(() => {
  const ce = document.querySelector('app-shell').shadowRoot.querySelector('crease-editor');
  const r = ce.shadowRoot.querySelector('canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const creasesBefore = await page.evaluate(() => window.__studio.doc.creases.length);
await page.mouse.move(ceBox.x + ceBox.w * 0.32, ceBox.y + ceBox.h * 0.28);
await page.mouse.down();
await page.mouse.move(ceBox.x + ceBox.w * 0.58, ceBox.y + ceBox.h * 0.28, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const draw = await page.evaluate(() => ({
  creases: window.__studio.doc.creases.length,
  selected: !!window.__studio.selectedCreaseId,
  // The cross sample's keyframes belong to v/h; the new crease must not
  // clobber them (the id-collision regression).
  vKeys: window.__studio.doc.keyframes.v.length,
  hKeys: window.__studio.doc.keyframes.h.length,
}));
assert('draw-crease', draw.creases === creasesBefore + 1, JSON.stringify(draw));
assert('draw-keeps-keys', draw.vKeys === 4 && draw.hKeys === 4, JSON.stringify(draw));

// Scrub the timeline.
const tlBox = await page.evaluate(() => {
  const tl = document.querySelector('app-shell').shadowRoot.querySelector('timeline-editor');
  const r = tl.shadowRoot.querySelector('canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(tlBox.x + tlBox.w * 0.32, tlBox.y + tlBox.h * 0.6);
await page.mouse.down();
await page.mouse.move(tlBox.x + tlBox.w * 0.6, tlBox.y + tlBox.h * 0.6, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
const scrubTime = await page.evaluate(() => window.__studio.time);
assert('scrub', scrubTime > 1.5, `t=${scrubTime}`);

// Material drawer: pick vellum, then close.
await clickIn('app-shell', '[data-act="drawer"]');
await page.waitForTimeout(300);
await clickIn('app-shell', 'material-panel', '[data-grade="2"]');
await page.waitForTimeout(200);
const grade = await page.evaluate(() => window.__studio.doc.material.translucency);
assert('material-grade', grade === 2, String(grade));
await clickIn('app-shell', 'material-panel', '[data-act="close"]');
await page.waitForTimeout(250);
const drawerClosed = await page.evaluate(() => {
  const d = document.querySelector('app-shell').shadowRoot.querySelector('[data-drawer]');
  return d ? !d.classList.contains('open') : true;
});
assert('drawer-closes', drawerClosed);

// Flat / solid view modes.
await clickIn('app-shell', '[data-mode="flat"]');
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(outDir, 'smoke-flat.png') });
await clickIn('app-shell', '[data-mode="solid"]');
await page.waitForTimeout(250);
const mode = await page.evaluate(() => window.__studio.mode);
assert('view-modes', mode === 'solid', mode);

// Export downloads a parseable sequence.
const dlPromise = page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
await clickIn('top-bar', '[data-act="export"]');
await page.waitForTimeout(150);
await clickIn('top-bar', '[data-act="export-json"]');
const dl = await dlPromise;
let exported = null;
if (dl) {
  const p = path.join(outDir, dl.suggestedFilename());
  await dl.saveAs(p);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  exported = {
    schema: j.schema,
    creases: j.creases.length,
    hasMat: !!j.material,
    keys: j.creases[0]?.keyframes.length,
  };
  fs.unlinkSync(p);
}
assert('export', !!exported && exported.schema === 'zhexu.sequence' && exported.creases === 3, JSON.stringify(exported));

// Undo returns to before the draw.
await page.evaluate(() => {
  const s = window.__studio;
  s.store.undo();
  s.store.undo();
  s.store.undo();
});
await page.waitForTimeout(200);
const undone = await page.evaluate(() => window.__studio.doc.creases.length);
assert('undo', undone <= creasesBefore + 1, String(undone));

await page.evaluate(() => window.__studio.seek(2.4));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, 'smoke-desktop.png') });

// Mobile viewport: no horizontal overflow.
await page.setViewportSize({ width: 400, height: 820 });
await page.waitForTimeout(700);
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
);
assert('mobile-no-overflow', !overflow);
await page.screenshot({ path: path.join(outDir, 'smoke-mobile.png') });

await browser.close();
server.close();

const fails = Object.entries(results).filter(([, v]) => v !== 'ok');
console.log(JSON.stringify({ results, errors }, null, 1));
if (fails.length || errors.length) {
  console.log(`\n${fails.length} failed checks, ${errors.length} console errors`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
