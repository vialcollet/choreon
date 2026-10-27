import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

/** RGB of one pixel of a PNG. */
function pixel(png: string, x: number, y: number): number[] {
	const raw = join(png + '.rgb');
	spawnSync(ffmpegPath as unknown as string, ['-y', '-loglevel', 'error', '-i', png, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
	return [...readFileSync(raw)];
}

// The renderer drives a real Chromium (with Node, like the studio): skipped where Playwright's browser is not installed.
const hasBrowser = spawnSync('node', ['-e', "require('playwright').chromium.launch().then((b) => b.close(), () => process.exit(1))"], { cwd: import.meta.dir, timeout: 30000 }).status === 0;

describe.skipIf(!hasBrowser)('render.mjs --scale', () => {
	test('a DOM scene keeps its layout at every scale: only the pixel density changes', () => {
		const dir = mkdtempSync(join(tmpdir(), 'render-scale-'));
		try {
			mkdirSync(join(dir, 'brand'));
			writeFileSync(join(dir, 'brand', 'brand.json'), '{}');
			// 200×100 scene, white, with a red block over its right half.
			writeFileSync(join(dir, 'scene.html'), `<!doctype html><body><div id="root"><div style="position:absolute;left:100px;top:0;width:100px;height:100px;background:#ff0000"></div></div>
<script type="module">
import { scene } from '/engine/motion.js';
scene({ width: 200, height: 100, duration: 1, mode: 'dom', background: '#ffffff', draw() {} });
</script></body>`);
			for (const [scale, w, h] of [[2, 400, 200], [0.5, 100, 50]]) {
				const out = join(dir, `s${scale}`);
				const r = spawnSync('node', [join(import.meta.dir, 'render.mjs'), '--scene', dir, '--project', dir, '--stills', '0', '--stills-dir', out, '--scale', String(scale)], { encoding: 'utf8' });
				expect(JSON.parse(r.stdout).errors).toEqual([]);
				const png = join(out, 't0_00.png');
				const size = spawnSync(ffmpegPath as unknown as string, ['-i', png], { encoding: 'utf8' }).stderr;
				expect(size).toContain(`${w}x${h}`);
				const red = pixel(png, Math.round(w * 0.75), Math.round(h / 2));
				const white = pixel(png, Math.round(w * 0.25), Math.round(h / 2));
				expect(red[0]).toBeGreaterThan(200);
				expect(red[1]).toBeLessThan(60);
				expect(white[1]).toBeGreaterThan(200);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 60000);
});
