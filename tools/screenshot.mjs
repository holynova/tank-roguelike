import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5299/', { waitUntil: 'networkidle' });

await page.waitForSelector('#boot.hidden', { timeout: 30000 });
await page.waitForSelector('#app canvas', { timeout: 30000 });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const c = document.querySelector('#app canvas');
  return c ? { width: c.width, height: c.height } : null;
});
console.log('canvas:', JSON.stringify(info));

await page.screenshot({ path: 'screenshot.png' });
await browser.close();
console.log('saved screenshot.png');
