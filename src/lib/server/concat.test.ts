import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const load = () => import('./concat');

describe('concatList', () => {
	test('one quoted line per file', async () => {
		const { concatList } = await load();
		expect(concatList(['/a/v001.mp4', '/a/v002.mp4'])).toBe("file '/a/v001.mp4'\nfile '/a/v002.mp4'");
	});

	test('turns backslashes into slashes', async () => {
		const { concatList } = await load();
		expect(concatList(['C:\\data\\p\\v001.mp4'])).toBe("file 'C:/data/p/v001.mp4'");
	});

	test("escapes a quote as '\\''", async () => {
		const { concatList } = await load();
		expect(concatList(["/a/it's here/v.mp4"])).toBe("file '/a/it'\\''s here/v.mp4'");
		expect(concatList(["/a/''/v.mp4"])).toBe("file '/a/'\\'''\\''/v.mp4'");
	});
});

describe('concat demuxer', () => {
	const dir = mkdtempSync(join(tmpdir(), 'concat-'));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	test("ffmpeg reads a list holding a path with a quote", async () => {
		const { concatList } = await load();
		const ffmpeg = (await import('ffmpeg-static')).default as unknown as string;
		if (!ffmpeg || !existsSync(ffmpeg)) return;
		const files = [join(dir, "it's a.mp4"), join(dir, 'b.mp4')];
		for (const f of files) {
			const r = Bun.spawnSync([ffmpeg, '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=0.2:r=10', '-pix_fmt', 'yuv420p', f]);
			expect(r.exitCode).toBe(0);
		}
		const list = join(dir, 'list.txt');
		writeFileSync(list, concatList(files));
		const r = Bun.spawnSync([ffmpeg, '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-f', 'null', '-']);
		expect(r.stderr.toString()).toBe('');
		expect(r.exitCode).toBe(0);
	});
});
