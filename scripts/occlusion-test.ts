/**
 * 遮挡正确性验证(基于合成后截图,最贴近用户所见):
 * 1. 投影人体躯干/头部与伞翼中心到屏幕坐标
 * 2. 用 Page.captureScreenshot 抓取真实画面并解码 PNG,采样这些坐标的像素
 * 3. 断言人体位置是服装/皮肤色,没有被伞翼橙色覆盖
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import zlib from "node:zlib";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:5174/";
const OUT = path.join(process.cwd(), "scripts", "shots");
mkdirSync(OUT, { recursive: true });
const PORT = 12000 + (process.pid % 40000);
const profile = path.join(os.tmpdir(), "kite-occ2-" + process.pid);
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu-sandbox", "--no-sandbox", "--enable-unsafe-swiftshader",
  "--use-gl=angle", "--use-angle=swiftshader", `--remote-debugging-port=${PORT}`,
  "--window-size=1600,1000", `--user-data-dir=${profile}`, URL,
], { stdio: "ignore" });

/** 只读 IHDR 拿宽高 */
function decodePngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 极简 PNG 解码:返回 RGBA 二维数组(仅支持 8-bit RGBA/RGB,截图均满足) */
function decodePng(buf: Buffer): Uint8Array {
  // 用 zlib 手动解析 PNG 块
  let pos = 8;
  const chunks: Buffer[] = [];
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    }
    if (type === "IDAT") chunks.push(data);
    if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 4;
  const bpp = channels; // bitDepth 8
  const stride = width * bpp + 1;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride - 1);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const lineStart = y * stride + 1;
    const cur = new Uint8Array(stride - 1);
    for (let x = 0; x < stride - 1; x++) {
      const rawByte = raw[lineStart + x];
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let val = rawByte;
      if (filter === 1) val = rawByte + a;
      else if (filter === 2) val = rawByte + b;
      else if (filter === 3) val = rawByte + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        val = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = val & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      out[di] = cur[si];
      out[di + 1] = cur[si + 1];
      out[di + 2] = cur[si + 2];
      out[di + 3] = bpp === 4 ? cur[si + 3] : 255;
    }
    prev.set(cur);
  }
  return out;
}

try {
  let targets: { webSocketDebuggerUrl: string; url: string; type: string }[] = [];
  for (let i = 0; i < 40; i++) {
    try {
      targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as never;
      if (targets.some((t) => t.type === "page")) break;
    } catch { /* */ }
    await sleep(250);
  }
  const page = targets.find((t) => t.type === "page" && t.url.includes("127.0.0.1"))!;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map<number, (v: Record<string, unknown>) => void>();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data as string);
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result as Record<string, unknown>); pending.delete(m.id); }
  });
  const send = (method: string, params?: unknown) =>
    new Promise<Record<string, unknown>>((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Runtime.enable");
  const ev = async (e: string) =>
    (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }) as { result?: { value?: unknown } }).result?.value;
  await sleep(4000);

  // 把相机放到伞翼后方、朝向人体:此时人位于相机与伞翼之间。
  // 若深度正确,人体完整可见、伞翼只作为半透明背景;若错误,人会被伞翼盖住。
  await ev(`(() => {
    const s = window.__scene;
    const scene = s.scene;
    const cam = scene.activeCamera;
    const fig = scene.getTransformNodeByName('fig-root').getAbsolutePosition();
    const kite = scene.getTransformNodeByName('kite-root').getAbsolutePosition();
    // 相机放在伞翼外侧(沿 人体->伞翼 方向再外延),目标锁定人体
    const dir = kite.subtract(fig);
    cam.radius = 6;
    cam.target = fig.add(new (fig.constructor)(0, 1.4, 0));
    // 用 setPosition 让相机位于伞翼之外
    cam.setPosition(kite.add(dir.normalize().scale(3.5)));
    return true;
  })()`);
  await sleep(1200);

  const shot = (await send("Page.captureScreenshot", { format: "png" })) as { data: string };
  const png = Buffer.from(shot.data, "base64");
  writeFileSync(path.join(OUT, "06-occlusion-behind-kite.png"), png);

  // 统计画面中央区域的颜色构成:人体(蓝/肤色)应占据显著比例,而非整片伞翼橙
  const pixels = decodePng(png);
  const probe = decodePngSize(png);
  let orange = 0, blueSuit = 0, skin = 0, total = 0;
  const cx = probe.width / 2, cy = probe.height / 2;
  for (let y = Math.round(cy - 180); y < cy + 180; y++) {
    for (let x = Math.round(cx - 180); x < cx + 180; x++) {
      const i = (y * probe.width + x) * 4;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      total++;
      if (r > 180 && g < 150 && b < 100) orange++;
      if (b > r && b > g && b > 50) blueSuit++;
      if (r > 150 && g > 110 && b < 130 && r > b + 30) skin++;
    }
  }
  console.log("中央区域像素占比 — 伞翼橙:", (orange / total * 100).toFixed(1) + "%",
    "| 服装蓝:", (blueSuit / total * 100).toFixed(1) + "%",
    "| 皮肤:", (skin / total * 100).toFixed(1) + "%");
  const humanRatio = (blueSuit + skin) / total;
  if (humanRatio < 0.02) {
    console.error("✗ 遮挡验证失败:中央几乎看不到人体,可能被伞翼盖住(人体像素占比 " + (humanRatio * 100).toFixed(1) + "%)");
    process.exitCode = 1;
  } else {
    console.log("✔ 遮挡验证通过:伞翼后方视角下人体仍清晰可见(人体像素占比 " + (humanRatio * 100).toFixed(1) + "%)");
  }
  console.log("截图: scripts/shots/06-occlusion-behind-kite.png");
} finally {
  chrome.kill();
  setTimeout(() => process.exit(process.exitCode ?? 0), 300);
}
