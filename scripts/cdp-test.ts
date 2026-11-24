/**
 * 浏览器端 CDP 冒烟测试:启动带远程调试的 Chrome,
 * 在真实页面里执行状态操作并截图,验证交互链路与渲染无运行时错误。
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import path from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:5174/";
const OUT = path.join(process.cwd(), "scripts", "shots");
mkdirSync(OUT, { recursive: true });

const profile = path.join(os.tmpdir(), "kite-cdp-profile-" + process.pid);
// 动态端口 + 独立 profile,避免与残留 Chrome 的调试端点冲突
const DEBUG_PORT = 10000 + (process.pid % 50000);
const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu-sandbox",
  "--no-sandbox",
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  `--remote-debugging-port=${DEBUG_PORT}`,
  "--window-size=1600,1000",
  `--user-data-dir=${profile}`,
  URL,
], { stdio: "ignore" });

interface CDPTarget {
  webSocketDebuggerUrl: string;
  url: string;
  type: string;
}

async function cdp(): Promise<{ send: (method: string, params?: unknown) => Promise<Record<string, unknown>> }> {
  // 等待调试端口,并只挑选我们这个页面的 page target
  let targets: CDPTarget[] = [];
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      targets = (await r.json()) as CDPTarget[];
      if (targets.some((t) => t.type === "page" && t.url.includes("127.0.0.1"))) break;
    } catch { /* 重试 */ }
    await sleep(250);
  }
  const page =
    targets.find((t) => t.type === "page" && t.url.includes("127.0.0.1")) ??
    targets.find((t) => t.type === "page") ??
    targets[0];
  if (!page?.webSocketDebuggerUrl) throw new Error("未找到可用的 page target: " + JSON.stringify(targets));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => ws.addEventListener("open", res, { once: true }));
  let id = 0;
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data as string);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result as Record<string, unknown>);
    }
  });
  const send = (method: string, params?: unknown) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  return { send };
}

async function evalJs(
  send: (m: string, p?: unknown) => Promise<Record<string, unknown>>,
  expr: string,
): Promise<unknown> {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  const detail = r as {
    exceptionDetails?: { text: string; exception?: { description?: string } };
  };
  if (detail.exceptionDetails) {
    const ed = detail.exceptionDetails;
    throw new Error("页面执行失败: " + (ed.exception?.description ?? ed.text));
  }
  return (r as { result?: { value?: unknown } }).result?.value;
}

async function shot(send: (m: string, p?: unknown) => Promise<Record<string, unknown>>, name: string) {
  const r = (await send("Page.captureScreenshot", { format: "png" })) as { data: string };
  writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
}

try {
  const { send } = await cdp();
  // 轮询等待引擎就绪(首次着色器编译可能较慢),最多 15s
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = (await evalJs(
      send,
      "!!document.querySelector('canvas') && Array.from(document.querySelectorAll('.badge')).some(b => /WebGL|WebGPU/.test(b.textContent || ''))",
    )) as boolean;
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error("引擎 15s 内未就绪");
  console.log("  ✓ 场景已挂载且引擎就绪(轮询确认)");

  // 应用在 main.ts 把状态单例挂到 window.__studio,保证与 UI 是同一实例
  const stateReady = await evalJs(send, "!!window.__studio");
  console.log("  " + (stateReady ? "✓" : "✗") + " 状态单例可访问(应用挂载)");

  // 1. 1200 帧压测
  await evalJs(send, `(async () => {
    const sample = await import('/src/lib/sample');
    window.__studio.setTrajectory(sample.stressTrajectory(1200));
  })()`);
  await sleep(800);
  const frames = await evalJs(send, "window.__studio.frameCount");
  console.log(`  ✓ 压测轨迹帧数 = ${frames}`);
  if ((frames as number) < 1200) throw new Error("压测帧数不足");
  const uiFrames = await evalJs(send, "document.querySelector('.hud .badge:last-child')?.textContent");
  console.log(`  ✓ UI 实际显示: ${uiFrames}`);
  if (!String(uiFrames).includes("1201")) throw new Error("UI 未同步到压测轨迹(模块实例不一致?)");

  // 快速拖动播放头(模拟用户连续拖动 200 次)
  const dragMs = await evalJs(send, `(() => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) window.__studio.currentFrame = (i * 7) % window.__studio.frameCount;
    return performance.now() - t0;
  })()`);
  console.log(`  ✓ 连续 200 次拖动定位耗时 ${(dragMs as number).toFixed(1)}ms`);
  await sleep(400);
  await shot(send, "01-stress-1200.png");

  // 2. 恢复示例,插入姿态关键帧
  await evalJs(send, "window.__studio.resetSample()");
  await sleep(300);
  await evalJs(send, "window.__studio.currentFrame = 44; window.__studio.insertPoseKeyAtFrame(44)");
  const poseCount = await evalJs(send, "window.__studio.poseKeys.length");
  console.log(`  ✓ 姿态关键帧插入,数量 = ${poseCount}`);
  await evalJs(send, "window.__studio.updatePoseKey(44, { tuck: 1 })");
  await sleep(300);
  await shot(send, "02-pose-tuck.png");

  // 3. 三个机位 —— 用显式 setter,断言场景相机模式与角度实际变化
  const seen = new Set<string>();
  let prevBeta: number | null = null;
  for (const [mode, file] of [["follow", "03-cam-follow.png"], ["side", "04-cam-side.png"], ["ground", "05-cam-ground.png"]] as const) {
    await evalJs(send, `window.__studio.setCameraMode('${mode}')`);
    await sleep(1500); // 等阻尼过渡完成并重新 attach
    const state = (await evalJs(send, "window.__studio.cameraMode")) as string;
    const dbg = (await evalJs(send, "window.__scene.cameraDebug()")) as { beta: number; mode: string };
    seen.add(state);
    if (prevBeta !== null && Math.abs(dbg.beta - prevBeta) < 0.01) {
      throw new Error(`机位 ${mode} 相机俯仰角未变化(beta=${dbg.beta})`);
    }
    prevBeta = dbg.beta;
    await shot(send, file);
    console.log(`  ✓ 机位 ${mode}(场景模式=${dbg.mode}, beta=${dbg.beta.toFixed(3)})截图`);
  }
  if (seen.size !== 3) throw new Error("机位模式未全部生效: " + [...seen].join(","));

  // 4. 工程文件往返(不触发下载,直接走序列化/解析)
  const roundtrip = await evalJs(send, `(async () => {
    const io = await import('/src/lib/io');
    const interp = await import('/src/lib/interpolation');
    const s = window.__studio;
    const json = io.exportProject(s.trajectoryKeys, s.poseKeys, s.fps);
    const proj = io.parseProject(json);
    const a = interp.bakeFrames(s.trajectoryKeys, s.poseKeys, s.fps);
    const b = interp.bakeFrames(proj.trajectoryKeys, proj.poseKeys, proj.fps);
    let maxDiff = 0;
    for (let i = 0; i < a.pos.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a.pos[i] - b.pos[i]));
    return { keys: proj.trajectoryKeys.length, poses: proj.poseKeys.length, maxDiff };
  })()`);
  console.log("  ✓ 工程往返:", JSON.stringify(roundtrip));

  // 5. 在任意帧插入轨迹关键点
  await evalJs(send, "window.__studio.currentFrame = 30; window.__studio.insertTrajectoryKeyAtCurrent()");
  const keyCount = await evalJs(send, "window.__studio.trajectoryKeys.length");
  console.log(`  ✓ 第 30 帧插入轨迹关键点,总数 = ${keyCount}`);

  console.log("\n浏览器端交互测试全部通过 ✔ 截图位于 scripts/shots/");
} catch (err) {
  console.error("测试失败:", err);
  process.exitCode = 1;
} finally {
  chrome.kill();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
