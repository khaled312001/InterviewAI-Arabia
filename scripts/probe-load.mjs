import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setCacheEnabled(false);
const t0 = Date.now();
const rows = [];
const started = new Map();
page.on('request', (r) => started.set(r, Date.now() - t0));
page.on('requestfinished', async (r) => {
  const res = r.response();
  let size = 0; try { size = (await res.buffer()).length; } catch {}
  rows.push({ s: started.get(r), e: Date.now() - t0, st: res?.status(), size, url: r.url().replace('https://interprova.com', '').slice(0, 90) });
});
page.on('requestfailed', (r) => rows.push({ s: started.get(r), e: Date.now() - t0, st: 'FAIL ' + r.failure()?.errorText, size: 0, url: r.url().slice(0, 90) }));
page.on('pageerror', (e) => console.log('PAGEERROR', Date.now() - t0, String(e).slice(0, 200)));
await page.goto('https://interprova.com/app/', { waitUntil: 'domcontentloaded', timeout: 90000 });
const dcl = Date.now() - t0;
await page.waitForSelector('[data-testid="onboarding"],[data-testid="login"]', { timeout: 90000 });
console.log('DOMContentLoaded', dcl, 'ms; first screen', Date.now() - t0, 'ms');
await new Promise((r) => setTimeout(r, 3000));
rows.sort((a, b) => a.s - b.s);
for (const r of rows) console.log(String(r.s).padStart(6), String(r.e).padStart(6), String(r.e - r.s).padStart(6) + 'ms', String(r.st).padEnd(4), String(Math.round(r.size / 1024)).padStart(6) + 'KB', r.url);
await browser.close();
