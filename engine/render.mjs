#!/usr/bin/env node
// Deterministic renderer: loads a shot (scene.html), calls window.seek(t) frame by
// frame in headless Chromium, and encodes with ffmpeg. Run by Node (not Bun):
// Playwright is fully supported there, including on Windows.
//
//   node engine/render.mjs --scene <dir|scene.html> --out out.mp4
//        [--project <dir>] [--fps 30] [--from 0] [--to <dur>] [--sub 1] [--scale 1]
//        [--audio file] [--stills 0,1.5,3 --stills-dir <dir>] [--crf 16]
//
// The internal static server exposes: /engine/* (runtime), /project/* (project folder,
// including brand/ and library/), /scene/* (shot folder). Output: one JSON line on stdout.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const HERE = dirname(fileURLToPath(import.meta.url));

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) continue;
		const k = a.slice(2);
		const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
		out[k] = v;
	}
	return out;
}

const MIME = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
	'.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
	'.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg'
};

/** Static server on a free port. Paths cannot escape their root. */
export function serve(roots) {
	const server = createServer((req, res) => {
		const url = decodeURIComponent((req.url || '/').split('?')[0]);
		const [, mount, ...rest] = url.split('/');
		const root = roots[mount];
		if (!root) return res.writeHead(404).end();
		const file = resolve(root, rest.join('/'));
		if (!(file + sep).startsWith(resolve(root) + sep) && file !== resolve(root)) return res.writeHead(403).end();
		if (!existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
		res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
		createReadStream(file).pipe(res);
	});
	return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

export async function render(opts) {
	const sceneFile = opts.scene.endsWith('.html') ? resolve(opts.scene) : resolve(opts.scene, 'scene.html');
	if (!existsSync(sceneFile)) throw new Error(`scene not found: ${sceneFile}`);
	const sceneDir = dirname(sceneFile);
	const projectDir = opts.project ? resolve(opts.project) : null;
	const roots = { engine: join(HERE, 'runtime'), scene: sceneDir };
	if (projectDir) roots.project = projectDir;
	const server = await serve(roots);
	const port = server.address().port;
	const scale = Number(opts.scale || 1);

	const browser = await chromium.launch();
	const errors = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
		page.on('pageerror', (e) => errors.push(String(e)));
		page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
		await page.goto(`http://127.0.0.1:${port}/scene/${sceneFile.slice(sceneDir.length + 1)}?scale=${scale}&preview=0`);
		await page.waitForFunction(() => typeof window.seek === 'function' && window.SCENE, null, { timeout: 15000 });
		const S = await page.evaluate(() => window.SCENE);
		await page.setViewportSize({ width: Math.round(S.width * scale), height: Math.round(S.height * scale) });
		await page.evaluate(() => window.seek(0));

		const fps = Number(opts.fps || S.fps || 30);
		const from = Number(opts.from || 0);
		const to = Math.min(Number(opts.to || S.duration), S.duration);
		const target = S.mode === 'dom' ? page : page.locator('#stage');
		const shot = async (t) => {
			await page.evaluate((tt) => window.seek(tt), t);
			return target.screenshot({ type: 'png', animations: 'disabled' });
		};

		const result = { scene: sceneFile, width: S.width, height: S.height, duration: S.duration, fps, errors };

		if (opts.stills) {
			const dir = resolve(opts['stills-dir'] || join(sceneDir, 'stills'));
			mkdirSync(dir, { recursive: true });
			result.stills = [];
			const { writeFileSync } = await import('node:fs');
			for (const raw of String(opts.stills).split(',')) {
				const t = Math.min(Number(raw), S.duration - 1 / fps);
				const file = join(dir, `t${t.toFixed(2).replace('.', '_')}.png`);
				writeFileSync(file, await shot(t));
				result.stills.push({ t, file });
			}
		}

		if (opts.out) {
			const subAsked = Math.max(1, Number(opts.sub || 1));
			// Canvas: the blur is computed in the page (seekBlur), one capture per frame.
			const inPage = subAsked > 1 && S.mode !== 'dom' && (await page.evaluate(() => typeof window.seekBlur === 'function'));
			const sub = inPage ? 1 : subAsked;
			const out = resolve(opts.out);
			mkdirSync(dirname(out), { recursive: true });
			const vf = [sub > 1 ? `tmix=frames=${sub},select='eq(mod(n\\,${sub})\\,${sub - 1})',setpts=N/${fps}/TB` : null, 'format=yuv420p']
				.filter(Boolean)
				.join(',');
			const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps * sub), '-i', '-'];
			if (opts.audio) ffArgs.push('-i', resolve(opts.audio));
			ffArgs.push('-vf', vf, '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', String(opts.crf || 16));
			if (opts.audio) ffArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
			ffArgs.push('-movflags', '+faststart', out);
			const ff = spawn(ffmpegPath, ffArgs, { stdio: ['pipe', 'inherit', 'pipe'] });
			let ffErr = '';
			ff.stderr.on('data', (d) => (ffErr += d));
			// Motion blur: `sub` samples per frame, spread over the shutter
			// (0.5 = 180°, as in film) then averaged by tmix. A full shutter at
			// 2 samples produces two ghost copies instead of a continuous blur.
			const shutter = Math.min(1, Math.max(0.05, Number(opts.shutter ?? 0.5)));
			const frames = Math.round((to - from) * fps);
			const total = frames * sub;
			const t0 = Date.now();
			for (let f = 0; f < frames; f++) {
				if (inPage) {
					await page.evaluate(([tt, n, span]) => window.seekBlur(tt, n, span), [from + f / fps, subAsked, shutter / fps]);
					const png = await target.screenshot({ type: 'png', animations: 'disabled' });
					if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
				} else for (let k = 0; k < sub; k++) {
					const png = await shot(from + f / fps + (sub > 1 ? (k / sub) * (shutter / fps) : 0));
					if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
				}
				if (opts.progress && f % fps === 0) process.stderr.write(`progress ${f}/${frames}\n`);
			}
			ff.stdin.end();
			const code = await new Promise((r) => ff.on('close', r));
			if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${ffErr}`);
			result.out = out;
			result.frames = total / sub;
			result.renderMs = Date.now() - t0;
		}
		return result;
	} finally {
		await browser.close();
		server.close();
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const opts = args(process.argv.slice(2));
	if (!opts.scene) {
		console.error('usage: node engine/render.mjs --scene <dir|scene.html> --out out.mp4 [--project dir] [--stills 0,1.5]');
		process.exit(2);
	}
	render(opts)
		.then((r) => {
			console.log(JSON.stringify(r));
			if (r.errors.length) process.exitCode = 3;
		})
		.catch((e) => {
			console.log(JSON.stringify({ error: String(e.message || e) }));
			process.exit(1);
		});
}
