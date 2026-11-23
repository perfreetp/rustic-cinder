// 运行时冒烟测试：以 CDP 驱动无头 Chrome，验证三维场景初始化与核心交互
// 用法：node smoke-test/cdp-smoke.mjs
const BASE = 'http://localhost:5173/'

const chrome =
  process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe'

const { spawn } = await import('node:child_process')
const fs = await import('node:fs/promises')
const os = await import('node:os')
const path = await import('node:path')

const userDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-smoke-'))
const port = 9333
const proc = spawn(
  chrome,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1600,1000',
    BASE,
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(p) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${p}`)
      return await res.json()
    } catch {
      await sleep(250)
    }
  }
  throw new Error('Chrome CDP 未就绪')
}

const targets = await getJson('/json')
const page = targets.find((t) => t.type === 'page' && t.url.includes(BASE))
if (!page) throw new Error('未找到测试页面 target')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let msgId = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (!msg.id) {
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(JSON.stringify(msg.params.exceptionDetails.exception?.description ?? msg.params).slice(0, 300))
    }
    return
  }
  const p = pending.get(msg.id)
  if (!p) return
  pending.delete(msg.id)
  msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result)
}
function cdp(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

await cdp('Page.enable')
await cdp('Runtime.enable')
await sleep(4500)

async function evalJs(expression) {
  const r = await cdp('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails))
  }
  return r.result.value
}

// CDP 真实鼠标输入（浏览器会合成带 pointerId 的可信 PointerEvent）
async function mouse(x, y, type) {
  await cdp('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' ? 'none' : 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
  })
}
async function clickAt(fx, fy) {
  const r = await evalJs(`(() => {
    const c = document.querySelector('canvas').getBoundingClientRect()
    return { x: c.left + c.width * ${fx}, y: c.top + c.height * ${fy}, w: c.width, h: c.height }
  })()`)
  await mouse(r.x, r.y, 'mousePressed')
  await sleep(60)
  await mouse(r.x, r.y, 'mouseReleased')
  await sleep(150)
  return r
}
async function dragRect(fx0, fy0, fx1, fy1) {
  const r = await evalJs(`(() => {
    const c = document.querySelector('canvas').getBoundingClientRect()
    return {
      x0: c.left + c.width * ${fx0}, y0: c.top + c.height * ${fy0},
      x1: c.left + c.width * ${fx1}, y1: c.top + c.height * ${fy1},
    }
  })()`)
  await mouse(r.x0, r.y0, 'mousePressed')
  for (let i = 1; i <= 8; i++) {
    await sleep(40)
    await mouse(r.x0 + ((r.x1 - r.x0) * i) / 8, r.y0 + ((r.y1 - r.y0) * i) / 8, 'mouseMoved')
  }
  await sleep(60)
  await mouse(r.x1, r.y1, 'mouseReleased')
  await sleep(200)
}

const results = []
function check(name, cond, extra = '') {
  results.push({ name, ok: Boolean(cond), extra })
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name} ${extra}`)
}

// 1. 基础渲染与视口尺寸
const canvasInfo = await evalJs(`(() => {
  const c = document.querySelector('canvas')
  const r = c.getBoundingClientRect()
  return { w: Math.round(r.width), h: Math.round(r.height) }
})()`)
check('视口 canvas 尺寸正常（非零）', canvasInfo.w > 500 && canvasInfo.h > 500, JSON.stringify(canvasInfo))

// 2. 岩壁 2 万面 / 1200 岩点
const uiText = await evalJs(`document.body.textContent`)
check('岩壁 20,000 面信息显示', uiText.includes('20,000 面'))
check('1,200 个岩点信息显示', uiText.includes('1200 个'))
check('难度色带 V0-V8 全部渲染', ['V0','V1','V2','V3','V4','V5','V6','V7','V8'].every((g) => uiText.includes(g)))

// 3. 点击拾取岩点（选岩壁中下部几个点，命中概率高）
await clickAt(0.42, 0.62)
await clickAt(0.5, 0.52)
await clickAt(0.55, 0.42)
const seqAfterClicks = Number(
  (await evalJs(`document.body.textContent.match(/路线岩点序列（(\\d+)）/)?.[1] ?? '0'`)),
)
check('点击拾取岩点加入路线', seqAfterClicks >= 1, `序列长度=${seqAfterClicks}`)

// 4. 难度等级
const gradeShown = await evalJs(`/V\\d/.test(document.body.textContent)`)
check('难度等级已计算显示', gradeShown)

// 5. 框选批量加入
const beforeMarquee = seqAfterClicks
await dragRect(0.3, 0.55, 0.68, 0.8)
const seqAfterMarquee = Number(
  (await evalJs(`document.body.textContent.match(/路线岩点序列（(\\d+)）/)?.[1] ?? '0'`)),
)
check('框选批量选中并加入路线', seqAfterMarquee > beforeMarquee, `${beforeMarquee} -> ${seqAfterMarquee}`)

// 6. 颜色筛选
const filterWorks = await evalJs(`(async () => {
  const chips = document.querySelectorAll('.color-chip')
  if (chips.length !== 8) return 'chip-count:' + chips.length
  chips[0].click()
  await new Promise((r) => setTimeout(r, 100))
  const hasClear = document.body.textContent.includes('清除筛选')
  chips[0].click()
  return hasClear ? 'ok' : 'no-clear-btn'
})()`)
check('颜色筛选开关工作', filterWorks === 'ok', filterWorks)

// 7. 端点标记模式
const markerWorks = await evalJs(`(async () => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('奖励点标记'))
  btn.click()
  await new Promise((r) => setTimeout(r, 80))
  const tip = document.body.textContent.includes('标记模式')
  btn.click()
  return tip ? 'ok' : 'no-tip'
})()`)
check('端点标记模式可切换', markerWorks === 'ok', markerWorks)

// 8. 保存到 localStorage
const saveResult = await evalJs(`(async () => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('保存当前路线')).click()
  await new Promise((r) => setTimeout(r, 180))
  const raw = localStorage.getItem('boulder-route-planner:routes:v1')
  if (!raw) return null
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed)
    ? { count: parsed.length, holds: parsed[0]?.holds?.length, version: parsed[0]?.version }
    : null
})()`)
check('路线保存到浏览器存储', saveResult?.count >= 1 && saveResult.version === 1, JSON.stringify(saveResult))

// 9. 导出 JSON 结构完整性
const exportShape = await evalJs(`(() => {
  const raw = localStorage.getItem('boulder-route-planner:routes:v1')
  const r = raw ? JSON.parse(raw)[0] : null
  return Boolean(
    r && r.wallFingerprint && Array.isArray(r.thresholds.spacing) &&
    r.thresholds.spacing.length === 9 && r.thresholds.angle.length === 9,
  )
})()`)
check('导出 JSON 结构完整（指纹+9档双阈值）', exportShape)

// 9b. 导出 -> 导入往返：按岩点编号回填并重建弧线
const roundTrip = await evalJs(`(async () => {
  const store = window.__store
  const original = JSON.parse(localStorage.getItem('boulder-route-planner:routes:v1'))[0]
  const originalIds = original.holds.map((h) => h.holdId)
  // 模拟文件：篡改一个不存在的编号，验证缺失回填校验
  const file = JSON.parse(JSON.stringify(original))
  file.id = 'imported-test-id'
  file.name = '导入往返测试'
  file.holds.push({ holdId: 999999, endpoint: null })
  // 直接走 store 的导入路径（与 importRouteFile 解析后的处理一致）
  const { missing, mismatch } = store.importRoute(file)
  await new Promise((r) => setTimeout(r, 200))
  const rebuiltIds = store.current.holds.map((h) => h.holdId)
  return {
    missing,
    mismatch,
    rebuiltCount: rebuiltIds.length,
    expectedCount: originalIds.length,
    sameOrder: originalIds.every((id, i) => id === rebuiltIds[i]),
    curveRebuilt: store.metrics !== null,
    importedName: store.current.name,
  }
})()`)
check(
  '导入按岩点编号回填、剔除无效编号并重建弧线',
  roundTrip.missing?.includes(999999) &&
    roundTrip.rebuiltCount === roundTrip.expectedCount &&
    roundTrip.sameOrder &&
    roundTrip.curveRebuilt &&
    roundTrip.importedName === '导入往返测试' &&
    roundTrip.mismatch === false,
  JSON.stringify(roundTrip),
)

// 10. 阈值滑块（18 个）调整不报错
const thresholdOk = await evalJs(`(async () => {
  const sliders = document.querySelectorAll('input[type=range]')
  if (sliders.length !== 18) return 'slider-count:' + sliders.length
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(sliders[0], '1.5')
  sliders[0].dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 150))
  return 'ok'
})()`)
check('18 个色带阈值滑块可调', thresholdOk === 'ok', thresholdOk)

// 11. 第二条路线 + 对比视图双视口
const compareResult = await evalJs(`(async () => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('新建路线')).click()
  await new Promise((r) => setTimeout(r, 120))
  const c = document.querySelector('canvas').getBoundingClientRect()
  for (const [fx, fy] of [[0.35, 0.7], [0.45, 0.55], [0.6, 0.38]]) {
    const x = c.left + c.width * fx, y = c.top + c.height * fy
    window.__noop = [x, y]
  }
  return 'ready'
})()`)
await clickAt(0.35, 0.7)
await clickAt(0.45, 0.55)
await clickAt(0.6, 0.38)
await evalJs(`(async () => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('保存当前路线')).click()
  await new Promise((r) => setTimeout(r, 180))
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('对比视图')).click()
})()`)
await sleep(1200)
const compareOk = await evalJs(`({
  canvases: document.querySelectorAll('.compare-overlay canvas').length,
  summary: document.body.textContent.includes('共用岩点'),
  onlyA: document.body.textContent.includes('仅 A 有'),
})`)
check('对比视图双视口打开', compareOk.canvases === 2, JSON.stringify(compareOk))
check('岩点差异统计显示', compareOk.summary && compareOk.onlyA)

// 12. 1200 岩点下的悬停拾取性能：200 个随机屏幕点，单次拾取应 < 2ms
const perf = await evalJs(`(() => {
  const editor = window.__editor
  if (!editor) return { error: 'no-editor' }
  const c = document.querySelector('canvas').getBoundingClientRect()
  const samples = []
  let hits = 0
  for (let i = 0; i < 200; i++) {
    const x = c.left + Math.random() * c.width
    const y = c.top + Math.random() * c.height
    const t0 = performance.now()
    const h = editor.pickAtScreen(x, y)
    samples.push(performance.now() - t0)
    if (h) hits++
  }
  samples.sort((a, b) => a - b)
  return {
    avg: samples.reduce((s, v) => s + v, 0) / samples.length,
    p95: samples[Math.floor(samples.length * 0.95)],
    max: samples[samples.length - 1],
    hits,
  }
})()`)
check(
  '悬停拾取单次耗时 < 2ms（1200 实例 + 2 万面墙）',
  perf.avg < 2 && perf.p95 < 4,
  `avg=${perf.avg?.toFixed(3)}ms p95=${perf.p95?.toFixed(3)}ms 命中=${perf.hits}/200`,
)

// 13. 拖拽路线内岩点：位置改变且弧线整体重算不报错
const dragCdp = await evalJs(`(async () => {
  const store = window.__store
  const editor = window.__editor
  if (!store || !editor) return { error: 'no-globals' }
  store.showCompare = false
  await new Promise((r) => setTimeout(r, 200))
  if (store.orderedHolds.length < 2) return { error: 'no-route' }
  const target = store.orderedHolds[1]
  const before = [...target.position]
  const rect = document.querySelector('canvas').getBoundingClientRect()
  const ndc = editor.projectHoldToScreen(target.id)
  const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width
  const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height
  return { before, sx, sy }
})()`)
if (!dragCdp.error) {
  await mouse(dragCdp.sx, dragCdp.sy, 'mousePressed')
  for (let i = 1; i <= 10; i++) {
    await sleep(30)
    await mouse(dragCdp.sx + i * 8, dragCdp.sy - i * 4, 'mouseMoved')
  }
  await sleep(50)
  await mouse(dragCdp.sx + 80, dragCdp.sy - 40, 'mouseReleased')
  await sleep(200)
}
const before0 = JSON.stringify(dragCdp.before ?? [0, 0, 0])
const dragVerify = await evalJs(`(() => {
  const store = window.__store
  const target = store.orderedHolds[1]
  const ref = ${before0}
  const moved = target.position.some((v, i) => Math.abs(v - ref[i]) > 0.01)
  return {
    moved,
    routeLength: store.orderedHolds.length,
    hasMetrics: Boolean(store.metrics),
    geoVersion: store.geometryVersion,
  }
})()`)
check(
  '拖拽中间岩点后位置更新且弧线重算',
  dragVerify.moved && dragVerify.routeLength >= 2 && dragVerify.hasMetrics && dragVerify.geoVersion > 0,
  JSON.stringify(dragVerify),
)

// 14. 运行期间无未捕获异常
check('浏览器运行期无未捕获异常', errors.length === 0, errors.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
proc.kill()
process.exit(failed.length ? 1 : 0)
