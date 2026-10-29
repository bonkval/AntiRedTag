const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const directory = path.resolve(__dirname, '../anti-red-tag/icons');
  await fs.mkdir(directory, { recursive: true });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="#d84660"/><g transform="translate(7 7) scale(1.08)" fill="none" stroke="white" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h7l10.5 10.5a1.8 1.8 0 0 1 0 2.5L16 20.5a1.8 1.8 0 0 1-2.5 0L3 10V3Zm1 17L20 4"/><circle cx="7" cy="7" r="1"/></g></svg>';
  await fs.writeFile(path.join(directory, 'mark.svg'), svg);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{width:100%;height:100%;display:block}</style>${svg}`);
    for (const size of [16,32,48,128]) {
      await page.setViewportSize({ width: size, height: size });
      await page.screenshot({ path: path.join(directory, `icon${size}.png`), omitBackground: true });
    }
  } finally { await browser.close(); }
  console.log('Anti Red-Tag icons generated.');
})().catch(error => { console.error(error); process.exitCode = 1; });
