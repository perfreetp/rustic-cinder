import { chromium, type ConsoleMessage } from 'playwright'

const BASE = 'http://127.0.0.1:5173'
let failures = 0
const check = (name: string, cond: boolean, extra = ''): void => {
  if (cond) console.log(`✓ ${name} ${extra}`)
  else {
    failures++
    console.error(`✗ ${name} ${extra}`)
  }
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const consoleErrors: string[] = []
page.on('console', (msg: ConsoleMessage) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err.message}`))

await page.goto(BASE)
await page.waitForSelector('.app')
check('应用启动并渲染外壳', true)

// 1. 生成 1200 帧演示轨迹
await page.click('text=生成 1200 帧演示轨迹')
await page.waitForSelector('text=/当前/', { timeout: 30000 })
check('演示轨迹生成并出现在本地列表', true)

const statText = await (async () => {
  await page.click('.nav-item:has-text("播放控制")')
  await page.waitForSelector('.stat .value')
  return page.locator('.card', { hasText: '轨迹信息' }).innerText()
})()
check('轨迹信息显示 1200 帧', /1,200/.test(statText))
check('轨迹信息显示 144 原子', /144/.test(statText))

// 2. 视口 canvas 与 troika 文字渲染
await page.click('text=位移分析')
await page.waitForSelector('table tbody tr')
const rows = await page.locator('table tbody tr').count()
check('位移分析页列出 Top10 原子', rows === 10, `实际 ${rows} 行`)
const topRow = await page.locator('table tbody tr').first().innerText()
check('Top10 表格包含残基名(三字母)', /ALA|GLY|SER|VAL|THR|LEU/.test(topRow), topRow.replace(/\n/g, ' | '))

// 3. WebGL canvas 存在且在绘制
const canvasCount = await page.locator('canvas').count()
check('three.js WebGL canvas 已挂载', canvasCount >= 1)

// 4. 播放 / 暂停
await page.click('.nav-item:has-text("播放控制")')
await page.click('.play-btn')
await page.waitForTimeout(600)
const readout1 = await page.locator('.frame-readout b').innerText()
check('播放后帧号前进', Number(readout1) > 1, `当前帧 ${readout1}`)
await page.click('.play-btn') // 暂停
const pausedFrame = Number(await page.locator('.frame-readout b').innerText())
await page.waitForTimeout(400)
const stillFrame = Number(await page.locator('.frame-readout b').innerText())
check('暂停后帧号冻结', pausedFrame === stillFrame)

// 5. 倍速档位
const speedButtons = await page.locator('.speed-grid button').allInnerTexts()
check('具备 0.5–4 倍速 6 档位', JSON.stringify(speedButtons) === JSON.stringify(['0.5×', '1×', '1.5×', '2×', '3×', '4×']))
await page.locator('.speed-grid button', { hasText: '4×' }).click()
check('可切换 4 倍速', (await page.locator('.speed-grid button.active').innerText()) === '4×')
await page.locator('.speed-grid button', { hasText: '1×' }).click()

// 6. 插值模式切换(Worker)
await page.click('text=位移分析')
const interpCard = page.locator('.card', { hasText: '插值方式' })
await interpCard.locator('button:has-text("平滑插值")').click()
check('平滑插值按钮激活', (await interpCard.locator('button.active').innerText()).includes('Catmull-Rom'))
await interpCard.locator('button:has-text("线性插值")').click()
check('切回线性插值', (await interpCard.locator('button.active').innerText()) === '线性插值')

// 7. 时间轴拖动性能:程序化快速拖动 100 次,统计 rAF 帧率
await page.click('.nav-item:has-text("播放控制")')
const slider = page.locator('.transport input[type="range"]')
const fpsReadings: number[] = []
const maxT = 1199
let lastReadout = 0
for (let i = 0; i < 100; i++) {
  const target = Math.round((i / 99) * maxT)
  await slider.evaluate((el: Element, value: number) => {
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, target)
  if (i % 10 === 0) {
    const fpsText = await page.locator('.fps-badge').innerText()
    fpsReadings.push(Number(fpsText.replace(' FPS', '')))
    lastReadout = Number((await page.locator('.frame-readout b').innerText()).replace(/,/g, ''))
  }
  await page.waitForTimeout(16)
}
const finalReadout = Number((await page.locator('.frame-readout b').innerText()).replace(/,/g, ''))
check('拖轴过程帧号跟随变化', lastReadout > 100, `中途读到 ${lastReadout}`)
check('拖轴到末尾帧号正确(1200)', finalReadout === 1200, `读到 ${finalReadout}`)
const stableFps = fpsReadings.slice(1) // 首个读数可能未满 1s 统计窗口
const avgFps = stableFps.reduce((a, b) => a + b, 0) / stableFps.length
check('千帧轨迹拖轴平均帧率 ≥ 30', avgFps >= 30, `平均 ${avgFps.toFixed(1)} FPS,读数 ${JSON.stringify(stableFps)}`)
check('全部 FPS 读数 ≥ 30', stableFps.every((f) => f >= 30), JSON.stringify(stableFps))

// 8. 拖尾开关
await page.locator('.checkbox-row', { hasText: '原子轨迹拖尾' }).locator('input').uncheck()
await page.waitForTimeout(100)
await page.locator('.checkbox-row', { hasText: '原子轨迹拖尾' }).locator('input').check()
check('拖尾开关可切换', true)

// 9. GLB 导出(下载事件)
await page.click('text=导出')
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  (async () => {
    await page.fill('.card input[type="number"] >> nth=0', '100')
    await page.fill('.card input[type="number"] >> nth=1', '120')
    await page.fill('.card input[type="number"] >> nth=2', '2')
    await page.click('button:has-text("导出并下载")')
  })(),
])
const suggested = download.suggestedFilename()
check('GLB 文件触发下载', /\.glb$/.test(suggested), suggested)
const downloadPath = `./test-output/${suggested}`
await download.saveAs(downloadPath)
const fs = await import('node:fs')
const bytes = fs.readFileSync(downloadPath)
check('GLB 文件非空', bytes.length > 1000, `${bytes.length} 字节`)
check('GLB 魔数正确(glTF)', bytes.subarray(0, 4).toString('ascii') === 'glTF')
const version = bytes.readUInt32LE(4)
check('GLB 版本为 2', version === 2, `v${version}`)
// JSON chunk 里应包含动画
const jsonLen = bytes.readUInt32LE(12)
const glbJson = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'))
check('GLB 含 animations', Array.isArray(glbJson.animations) && glbJson.animations.length === 1)
// 4 种元素(H/C/N/O)共享几何与材质 → 4 个 mesh 定义被节点复用,控制 GLB 体积
check('GLB 去重后 mesh 定义数等于元素种类数(4)', glbJson.meshes?.length === 4, `${glbJson.meshes?.length} 个 mesh`)
check('GLB 节点数为 145(原子节点 + 根 Group)', glbJson.nodes?.length === 145, `${glbJson.nodes?.length} 节点`)
const meshNodes = glbJson.nodes.filter((n: { mesh?: number }) => typeof n.mesh === 'number').length
check('引用 mesh 的节点数等于原子数(144)', meshNodes === 144, `${meshNodes} 个 mesh 节点`)
const trackCount = glbJson.animations[0].channels.length
check('GLB 动画通道数等于原子数(144)', trackCount === 144, `${trackCount} 通道`)

// 10. 多轨迹:再生成一条并切换
await page.click('text=轨迹载入')
await page.click('text=生成 1200 帧演示轨迹')
await page.waitForTimeout(2000)
const trajRows = await page.locator('table tbody tr').count()
check('本地存在多条轨迹可切换', trajRows >= 2, `${trajRows} 条`)
await page.locator('table tbody tr').nth(1).locator('button:has-text("切换")').click()
await page.waitForTimeout(1500)
const activeTags = await page.locator('span.tag.active').count()
check('切换后标记当前轨迹', activeTags >= 1)

// 11. 控制台无错误
check('运行期间无 console error / pageerror', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' || '))

await browser.close()
console.log(failures === 0 ? '\nE2E 全部通过 ✅' : `\n${failures} 项 E2E 失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
