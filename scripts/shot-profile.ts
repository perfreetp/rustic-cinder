import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 4500));
  await page.evaluate(() => Array.from(document.querySelectorAll('.tab')).find((t) => t.textContent?.includes('母线'))?.click());
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: 'C:/Users/Administrator/AppData/Local/Temp/smoke/app-profile.png' });
  console.log('profile screenshot done');
} finally {
  await browser.close();
}
