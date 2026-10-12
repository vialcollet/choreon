#!/usr/bin/env node
// Sheet of numbered images (candidate video posters) for a visual choice by an agent.
//
//   node engine/grid.mjs --list items.json --out grid.png [--cols 4]
//   items.json : [{ "src": "https://…/poster.webp", "label": "1 · Nom" }, …]

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) continue;
		out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
	}
	return out;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function grid({ list, out, cols = 4 }) {
	const items = JSON.parse(readFileSync(resolve(list), 'utf8'));
	const html = `<!doctype html><html><body style="margin:0;background:#222;font:600 22px system-ui;color:#fff">
<div style="display:grid;grid-template-columns:repeat(${cols},480px);gap:8px;padding:8px">
${items.map((it) => `<div><img src="${esc(it.src)}" style="width:480px;height:270px;object-fit:cover;display:block;background:#444"/><div style="padding:4px 2px">${esc(it.label)}</div></div>`).join('\n')}
</div></body></html>`;
	const b = await chromium.launch();
	try {
		const p = await b.newPage({ viewport: { width: cols * 488 + 8, height: 800 } });
		await p.setContent(html, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
		await p.screenshot({ path: resolve(out), fullPage: true });
	} finally {
		await b.close();
	}
	return { out: resolve(out), count: items.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const o = args(process.argv.slice(2));
	grid({ list: o.list, out: o.out, cols: Number(o.cols || 4) })
		.then((r) => console.log(JSON.stringify(r)))
		.catch((e) => {
			console.log(JSON.stringify({ error: String(e.message || e) }));
			process.exit(1);
		});
}
