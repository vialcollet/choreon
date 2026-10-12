#!/usr/bin/env node
// Check sheet for a UI harvest: for each element, original capture,
// SVG rebuild (text kept) and simplified variant (bars), side by side.
//   node engine/ui-sheet.mjs --dir <harvest folder> --out sheet.png [--ids 3,5,12] [--max 24]

import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1]]] : acc), []));
const dir = resolve(a.dir);
const data = JSON.parse(readFileSync(join(dir, 'candidates.json'), 'utf8'));
const ids = a.ids ? new Set(a.ids.split(',').map(Number)) : null;
const list = data.candidates.filter((c) => !ids || ids.has(c.id)).slice(0, Number(a.max ?? 24));
const url = (f) => pathToFileURL(join(dir, 'c', f)).href;
const cell = (src, w) => (existsSync(join(dir, 'c', src)) ? `<img src="${url(src)}" style="max-width:${w}px;max-height:260px">` : '<i>—</i>');
const rows = list
	.map((c) => `<tr><td class="m"><b>#${c.id}</b> ${c.role}<br><small>${c.box.w}×${c.box.h}${c.repeats > 1 ? ` · ×${c.repeats}` : ''}</small><br><small>${(c.text || '').slice(0, 40).replace(/</g, '&lt;')}</small></td><td>${cell(`${c.id}.png`, 420)}</td><td>${cell(`${c.id}.svg`, 420)}</td><td>${cell(`${c.id}-bars.svg`, 420)}</td></tr>`)
	.join('');
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#eef1f5;font:13px system-ui;color:#0e172b}table{border-collapse:separate;border-spacing:10px}td{background:#fff;padding:10px;vertical-align:middle;border-radius:6px}td.m{width:150px;background:#f6f7f9}th{text-align:left;font-weight:600;color:#49546b;padding:0 10px}</style><table><tr><th></th><th>Original</th><th>SVG (text kept)</th><th>SVG simplified</th></tr>${rows}</table>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 800 } });
// Page written next to the files: an in-memory page can't load local images.
const page = join(dir, '_sheet.html');
writeFileSync(page, html);
await p.goto(pathToFileURL(page).href, { waitUntil: 'load' });
await p.screenshot({ path: resolve(a.out), fullPage: true });
await b.close();
console.log(JSON.stringify({ out: resolve(a.out), count: list.length }));
