#!/usr/bin/env node
// Generates an image with Codex (ChatGPT subscription) and copies it to the wanted location.
//
//   node engine/codex-image.mjs --prompt "..." --out library/img.png [--ref ref.png] [--size 1536x1024]
//
// Codex stores its images in ~/.codex/generated_images/<session>/; the session id is read
// from the --json stream, then the most recent image of that folder is copied (only when codex exits 0).

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) continue;
		const k = argv[i].slice(2);
		out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
	}
	return out;
}

const GEN = join(homedir(), '.codex', 'generated_images');

/** What to spawn (never through a shell): outside Windows the `codex` found on PATH; on Windows `codex.exe`, or the npm shim's JS entry run with node. */
export function codexCommand(platform, pathDirs, exists) {
	const find = (name) => pathDirs.map((d) => join(d, name)).find((f) => exists(f));
	if (platform !== 'win32') {
		const bin = find('codex');
		if (bin) return { cmd: bin, args: [] };
		throw new Error('codex CLI not found');
	}
	const exe = find('codex.exe');
	if (exe) return { cmd: exe, args: [] };
	const shim = find('codex.cmd');
	const dir = shim && dirname(shim);
	// local install: <project>/node_modules/.bin/codex.cmd, package beside .bin; global prefix: package under the shim's directory
	const local = dir && basename(dir) === '.bin' && basename(dirname(dir)) === 'node_modules';
	const entry = shim && join(local ? dirname(dir) : join(dir, 'node_modules'), '@openai', 'codex', 'bin', 'codex.js');
	if (entry && exists(entry)) return { cmd: process.execPath, args: [entry] };
	throw new Error('codex CLI not found');
}

function newestPng(dir, after) {
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir)
		.filter((f) => f.endsWith('.png'))
		.map((f) => ({ f: join(dir, f), m: statSync(join(dir, f)).mtimeMs }))
		.filter((x) => x.m >= after)
		.sort((a, b) => b.m - a.m);
	return files[0]?.f ?? null;
}

/** The newest image of the session codex identified, only when codex exited 0; never another session's. */
export function producedImage(gen, session, code, since, err = '') {
	const img = code === 0 && session ? newestPng(join(gen, session), since) : null;
	if (!img) throw new Error(`codex produced no image (exit code ${code})${err ? `: ${err}` : ''}`);
	return img;
}

export function codexImage({ prompt, out, ref, size = '1536x1024', timeoutMs = 300000 }) {
	return new Promise((ok, fail) => {
		const started = Date.now();
		const cwd = mkdtempSync(join(tmpdir(), 'codex-img-'));
		const instructions =
			`Generate ONE image with your image generation tool, nothing else (do not write any file, do not run any command).\n` +
			`Format ${size} (landscape if wider than tall). Brief:\n${prompt}`;
		const cmdArgs = ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-C', cwd];
		if (ref) cmdArgs.push('-i', resolve(ref));
		cmdArgs.push('-');
		const win = process.platform === 'win32';
		const dirs = (process.env.PATH ?? process.env.Path ?? '').split(win ? ';' : ':').filter(Boolean);
		let run;
		try {
			run = codexCommand(process.platform, dirs, existsSync);
		} catch (e) {
			return fail(e);
		}
		const child = spawn(run.cmd, [...run.args, ...cmdArgs], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
		let session = null;
		let buf = '';
		const timer = setTimeout(() => child.kill(), timeoutMs);
		child.on('error', (e) => (clearTimeout(timer), fail(e)));
		child.stdout.on('data', (d) => {
			buf += d;
			let i;
			while ((i = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, i);
				buf = buf.slice(i + 1);
				try {
					const ev = JSON.parse(line);
					session ??= ev.thread_id || ev.session_id || ev?.msg?.session_id || null;
				} catch {}
			}
		});
		let err = '';
		child.stderr.on('data', (d) => (err += d));
		child.stdin.on('error', () => {});
		child.stdin.end(instructions);
		child.on('close', (code) => {
			clearTimeout(timer);
			let img;
			try {
				img = producedImage(GEN, session, code, started - 1000, err.slice(-400));
			} catch (e) {
				return fail(e);
			}
			mkdirSync(dirname(resolve(out)), { recursive: true });
			copyFileSync(img, resolve(out));
			ok({ out: resolve(out), source: img, session, ms: Date.now() - started });
		});
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const o = args(process.argv.slice(2));
	if (!o.prompt || !o.out) {
		console.error('usage: node engine/codex-image.mjs --prompt "..." --out file.png [--ref img] [--size 1536x1024]');
		process.exit(2);
	}
	codexImage(o)
		.then((r) => console.log(JSON.stringify(r)))
		.catch((e) => {
			console.log(JSON.stringify({ error: String(e.message || e) }));
			process.exit(1);
		});
}
