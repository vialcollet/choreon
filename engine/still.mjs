#!/usr/bin/env node
// Advertising stills: a template (scene.html) + variables → PNGs, in one or
// several formats. The template reads window.VARS (including VARS.format = {width, height});
// the instant `t` is captured (default: last frame). Run by Node, like render.mjs.
//
//   node engine/still.mjs --template <dir|scene.html> --project <dir> --batch lot.json
//        [--out <dir>] [--formats 1080x1350,1080x1920] [--t <s>]
//
// lot.json : [{ "id": "K-0001", "template"?: "<dir>", "formats"?: [...], "vars": {...} }, ...]
// Output: <out>/<id>-<width>x<height>.png and <out>/manifest.json; one JSON line on stdout.

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) continue;
		const k = argv[i].slice(2);
		out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
	}
	return out;
}

const parseFormat = (f) => {
	const [w, h] = String(f).toLowerCase().split('x').map(Number);
	if (!w || !h) throw new Error(`invalid format: ${f} (expected 1080x1350)`);
	return { width: w, height: h };
};

export async function stills(opts) {
	const projectDir = resolve(opts.project);
	const items = opts.items;
	const outDir = resolve(opts.out);
	mkdirSync(outDir, { recursive: true });

	// One server per template folder (the /scene/ root changes from one template to another).
	const templates = new Map();
	const sceneOf = (tpl) => {
		const file = tpl.endsWith('.html') ? resolve(tpl) : resolve(tpl, 'scene.html');
		if (!existsSync(file)) throw new Error(`template not found: ${file}`);
		return file;
	};

	const browser = await chromium.launch();
	const manifest = [];
	const errors = [];
	try {
		for (const item of items) {
			const sceneFile = sceneOf(item.template || opts.template);
			let srv = templates.get(sceneFile);
			if (!srv) {
				srv = await serve({ engine: join(HERE, 'runtime'), scene: dirname(sceneFile), project: projectDir });
				templates.set(sceneFile, srv);
			}
			const port = srv.address().port;
			for (const f of item.formats || opts.formats) {
				const format = parseFormat(f);
				const page = await browser.newPage({ viewport: format, deviceScaleFactor: 1 });
				const pageErrors = [];
				page.on('pageerror', (e) => pageErrors.push(String(e)));
				page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
				await page.addInitScript((vars) => (window.VARS = vars), { ...item.vars, format });
				await page.goto(`http://127.0.0.1:${port}/scene/scene.html?preview=0`);
				await page.waitForFunction(() => typeof window.seek === 'function' && window.SCENE, null, { timeout: 15000 });
				const S = await page.evaluate(() => window.SCENE);
				if (S.width !== format.width || S.height !== format.height) {
					pageErrors.push(`template ignores VARS.format: ${S.width}x${S.height} instead of ${format.width}x${format.height}`);
				}
				const t = Math.min(opts.t ?? S.duration, S.duration - 1 / S.fps);
				await page.evaluate((tt) => window.seek(tt), t);
				const target = S.mode === 'dom' ? page : page.locator('#stage');
				const file = join(outDir, `${item.id}-${format.width}x${format.height}.png`);
				writeFileSync(file, await target.screenshot({ type: 'png', animations: 'disabled' }));
				await page.close();
				manifest.push({ id: item.id, format: `${format.width}x${format.height}`, file, template: sceneFile, vars: item.vars });
				for (const e of pageErrors) errors.push(`${item.id} ${format.width}x${format.height} : ${e}`);
			}
		}
	} finally {
		await browser.close();
		for (const s of templates.values()) s.close();
	}
	writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, '\t'));
	return { out: outDir, count: manifest.length, files: manifest.map((m) => m.file), errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const opts = args(process.argv.slice(2));
	if (!opts.project || !opts.batch) {
		console.error('usage: node engine/still.mjs --project <dir> --batch lot.json [--template <dir>] [--out <dir>] [--formats 1080x1350,1080x1920] [--t <s>]');
		process.exit(2);
	}
	const batch = JSON.parse(readFileSync(resolve(opts.batch), 'utf8'));
	stills({
		project: opts.project,
		template: opts.template,
		items: Array.isArray(batch) ? batch : batch.items,
		out: opts.out || join(dirname(resolve(opts.batch)), 'stills'),
		formats: (opts.formats || '1080x1350').split(','),
		t: opts.t !== undefined ? Number(opts.t) : undefined
	})
		.then((r) => {
			console.log(JSON.stringify(r));
			if (r.errors.length) process.exitCode = 3;
		})
		.catch((e) => {
			console.log(JSON.stringify({ error: String(e.message || e) }));
			process.exit(1);
		});
}
