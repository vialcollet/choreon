// Screenshot of a studio page + console errors: node scripts/shot.mjs <path> <output.png> [width]
// STUDIO_URL (default http://127.0.0.1:5610); STUDIO_TOKEN to pass authentication (service token).
import { chromium } from 'playwright';
const [, , path, out, width = '1600'] = process.argv;
const base = process.env.STUDIO_URL ?? 'http://127.0.0.1:5610';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: Number(width), height: 1000 }, extraHTTPHeaders: process.env.STUDIO_TOKEN ? { Authorization: `Bearer ${process.env.STUDIO_TOKEN}` } : {} });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text()));
await p.goto(base + path, { waitUntil: 'load' }).catch((e) => errs.push(String(e)));
await p.waitForTimeout(2500);
await p.screenshot({ path: out, fullPage: false });
console.log(JSON.stringify({ errs }));
await b.close();
