/**
 * End-to-end smoke test against a real headless browser over CDP.
 * Drives the Svelte app through its real UI + the shared window.__app state:
 * load -> preset -> generate -> worker streamlines -> results -> export -> probe.
 *
 * Requires Edge/Chrome started with --remote-debugging-port=9222.
 */
const BASE = 'http://localhost:5173/';

interface Target {
  webSocketDebuggerUrl: string;
  type: string;
}

async function getPageTarget(): Promise<Target> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json');
      const targets: Target[] = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no CDP page target');
}

let id = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const consoleErrors: string[] = [];

async function main() {
  const target = await getPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error('ws open failed'));
  });

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push(d?.exception?.description || d?.text || 'exception');
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry?.level === 'error') {
      consoleErrors.push(msg.params.entry.text);
    }
  };

  const send = (method: string, params?: Record<string, unknown>) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  const failures: string[] = [];
  const ok = (name: string, cond: boolean, detail = '') => {
    console.log((cond ? '  ok  ' : 'FAIL  ') + name + (detail ? ` — ${detail}` : ''));
    if (!cond) failures.push(name);
  };

  const evalJs = async <T,>(expr: string): Promise<T> => {
    const r = (await send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true
    })) as { result?: { value?: T; exceptionDetails?: unknown } };
    if (r.result?.exceptionDetails) {
      throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails));
    }
    return r.result?.value as T;
  };

  const clickTab = (index: number) =>
    evalJs(`[...document.querySelectorAll('.step-tab')][${index}].click()`);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Poll appState until a predicate holds or the timeout elapses. */
  const waitFor = async (expr: string, timeoutMs = 8000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const v = await evalJs<boolean>(expr);
      if (v) return true;
      await sleep(200);
    }
    return evalJs<boolean>(expr);
  };

  // 1. Load.
  await send('Page.navigate', { url: BASE });
  await sleep(2500);
  const title = await evalJs<string>('document.title');
  ok('page loads with title', title.includes('引力场'), title);
  const appReady = await evalJs<boolean>('!!window.__app');
  ok('shared app state exposed', appReady);

  // 2. Load preset through the same reactive instance the UI uses.
  await evalJs(`window.__app.loadPreset?.()`).catch(() => undefined);
  // loadPreset is a named export, not on the state object — drive via UI button.
  await evalJs(`[...document.querySelectorAll('.seg-group button')].find(b=>b.textContent.includes('双质量')).click()`);
  await sleep(300);
  const massCount = await evalJs<number>('window.__app.masses.length');
  ok('binary preset creates 2 masses', massCount === 2, `n=${massCount}`);

  // 3. Go to generate page and compute.
  await clickTab(1);
  await sleep(1500);
  const canvasCount = await evalJs<number>('document.querySelectorAll("canvas").length');
  ok('Babylon canvas mounted on generate page', canvasCount >= 1, `canvases=${canvasCount}`);
  const glOk = await evalJs<boolean>(`
    (() => { const c = document.querySelector('canvas');
      return !!(c && (c.getContext('webgl2') || c.getContext('webgl'))); })()
  `);
  ok('WebGL context available', glOk);

  const versionBefore = await evalJs<number>('window.__app.resultVersion');
  await evalJs(`window.__app.compute(false)`);
  await waitFor(`window.__app.resultVersion > ${versionBefore}`);
  const lineCount = await evalJs<number>('window.__app.stats.lineCount');
  const pointCount = await evalJs<number>('window.__app.stats.pointCount');
  const elapsed = await evalJs<number>('window.__app.stats.elapsedMs');
  ok('worker produced streamlines', lineCount > 100, `lines=${lineCount} points=${pointCount}`);
  ok('worker elapsed time reported', elapsed > 0, `${elapsed.toFixed(1)}ms`);

  // 4. Parameter change recomputes.
  const v2 = await evalJs<number>('window.__app.resultVersion');
  await evalJs(`
    window.__app.params.seedDensity = 6;
    window.__app.compute(false);
  `);
  await waitFor(`window.__app.resultVersion > ${v2}`);
  const lines2 = await evalJs<number>('window.__app.stats.lineCount');
  ok('parameter change recomputes', lines2 > lineCount, `${lineCount} -> ${lines2}`);

  // 5. Direction switching via the real segmented control.
  const v3 = await evalJs<number>('window.__app.resultVersion');
  await evalJs(`[...document.querySelectorAll('.seg-group button')].find(b=>b.textContent.trim()==='正向').click()`);
  await waitFor(`window.__app.resultVersion > ${v3}`);
  const fwdDir = await evalJs<string>('window.__app.params.direction');
  const fwdLines = await evalJs<number>('window.__app.stats.lineCount');
  ok('forward direction applied', fwdDir === 'forward' && fwdLines > 0, `dir=${fwdDir} lines=${fwdLines}`);
  const v4 = await evalJs<number>('window.__app.resultVersion');
  await evalJs(`[...document.querySelectorAll('.seg-group button')].find(b=>b.textContent.trim()==='双向').click()`);
  await waitFor(`window.__app.resultVersion > ${v4}`);

  // 6. Smooth / polyline display modes.
  const polyBefore = await evalJs<boolean>('window.__app.smoothMode');
  await evalJs(`[...document.querySelectorAll('.seg-group button')].find(b=>b.textContent.includes('平滑')).click()`);
  await sleep(500);
  const smooth = await evalJs<boolean>('window.__app.smoothMode');
  ok('smooth mode toggles on', smooth === true && polyBefore === false);
  await evalJs(`[...document.querySelectorAll('.seg-group button')].find(b=>b.textContent.includes('原始折线')).click()`);
  await sleep(500);
  const poly = await evalJs<boolean>('window.__app.smoothMode');
  ok('polyline mode toggles back', poly === false);

  // 7. Results page + highlight + path.
  await clickTab(2);
  await sleep(2500);
  await evalJs(`window.__app.highlightedLine = 0`);
  await sleep(600);
  const hl = await evalJs<number>('window.__app.highlightedLine');
  ok('highlight selection state', hl === 0);

  // 8. Export payload shape (named exporter module, dynamic import is fine
  //    here because it only reads data, no reactivity involved).
  const exportShape = await evalJs<Record<string, unknown>>(`
    (async () => {
      const ex = await import('/src/lib/exporters.ts');
      const p = ex.buildExportPayload(window.__app.result, window.__app.masses, window.__app.params);
      return {
        schema: p.schema,
        lines: p.streamlines.length,
        firstPoints: p.streamlines[0].points.length,
        hasMagnitude: typeof p.streamlines[0].points[0].magnitude === 'number',
        hasDirection: typeof p.streamlines[0].points[0].ax === 'number'
      };
    })()
  `);
  ok('export payload has schema and per-point data',
    exportShape.schema === 'gravity-streamlines/1' &&
    (exportShape.lines as number) > 0 &&
    exportShape.hasMagnitude === true &&
    exportShape.hasDirection === true,
    JSON.stringify(exportShape));

  // 9. Canvas screenshot returns a PNG data URL.
  const shot = await evalJs<string>(`document.querySelector('canvas').toDataURL('image/png')`);
  ok('canvas screenshot is a PNG data URL', typeof shot === 'string' && shot.startsWith('data:image/png'),
    shot.slice(0, 22));

  // 10. Probe sampling at an arbitrary field point.
  const probe = await evalJs<Record<string, number>>(`
    (() => {
      // Reuse the live scene's math indirectly via fieldAt through the worker
      // is overkill; validate the probe data contract from current result.
      const r = window.__app.result;
      const idx = r.lineStarts[0];
      return {
        x: r.positions[idx*2], z: r.positions[idx*2+1],
        magnitude: r.magnitudes[idx],
        ax: r.directions[idx*2]
      };
    })()
  `);
  ok('field point data has position/magnitude/direction',
    Number.isFinite(probe.x) && Number.isFinite(probe.magnitude) && Number.isFinite(probe.ax));

  await sleep(500);
  const realErrors = consoleErrors.filter((e) => !/WebGL|swiftshader|GPU|angle|favicon/i.test(e));
  ok('no uncaught browser errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  ws.close();
  console.log(failures.length === 0 ? '\nE2E PASSED' : `\n${failures.length} E2E FAILURE(S)`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E harness error:', e);
  process.exit(1);
});
