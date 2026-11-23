/** 2000 帧压力测试:生成大 JSON 轨迹 → 上传 → 拖动测帧率 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { generateDemoTrajectory } from '../src/lib/demo.ts'

mkdirSync('./test-output', { recursive: true })
const traj = generateDemoTrajectory({ residues: 30, frames: 2000 })
const payload = {
  name: '压力轨迹 2000帧',
  frameDelta: traj.frameDelta,
  atoms: traj.atoms,
  frames: Array.from({ length: traj.frameCount }, (_, f) =>
    Array.from(traj.positions.subarray(f * traj.atomCount * 3, (f + 1) * traj.atomCount * 3)),
  ),
}
const file = './test-output/stress-2000.json'
writeFileSync(file, JSON.stringify(payload))
console.log(`已生成压力文件:${traj.frameCount} 帧 × ${traj.atomCount} 原子`)

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
const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto('http://127.0.0.1:5173')
await page.waitForSelector('.dropzone')
await page.locator('input[type="file"]').setInputFiles(file)
await page.waitForSelector('span.tag.active', { timeout: 60000 })
check('2000 帧轨迹上传并激活', true)

await page.click('.nav-item:has-text("播放控制")')
const info = await page.locator('.card', { hasText: '轨迹信息' }).innerText()
check('显示 2,000 帧', /2,000/.test(info))
check('显示 180 原子', /180/.test(info))

// 高速来回拖动 120 次
const slider = page.locator('.transport input[type="range"]')
const fpsSamples: number[] = []
for (let i = 0; i < 120; i++) {
  const target = i % 2 === 0 ? (i / 119) * 1999 : 1999 - (i / 119) * 1999
  await slider.evaluate((el: Element, v: number) => {
    const input = el as HTMLInputElement
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, String(Math.round(v)))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, target)
  if (i % 12 === 0) {
    fpsSamples.push(Number((await page.locator('.fps-badge').innerText()).replace(' FPS', '')))
  }
  await page.waitForTimeout(12)
}
const readings = fpsSamples.slice(1)
const avg = readings.reduce((a, b) => a + b, 0) / readings.length
check('2000 帧来回拖动平均帧率 ≥ 30', avg >= 30, `平均 ${avg.toFixed(1)} FPS ${JSON.stringify(readings)}`)
check('2000 帧拖动无任何低于 30 的采样', readings.every((f) => f >= 30), JSON.stringify(readings))
check('压力期间无页面错误', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(failures === 0 ? '\n压力测试通过 ✅' : `\n${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
