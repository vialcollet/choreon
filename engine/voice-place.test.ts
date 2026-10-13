import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

/** RMS per 100 ms of a mono 16 kHz WAV. */
function energy(wav: string): number[] {
	const pcm = new Int16Array(readFileSync(wav).buffer.slice(44));
	const out: number[] = [];
	for (let i = 0; i + 1600 <= pcm.length; i += 1600) {
		let s = 0;
		for (let k = i; k < i + 1600; k++) s += pcm[k] * pcm[k];
		out.push(Math.sqrt(s / 1600));
	}
	return out;
}

describe('voice-place.mjs', () => {
	test('moves each segment of the take to its film time, silence elsewhere', () => {
		const dir = mkdtempSync(join(tmpdir(), 'voice-place-'));
		try {
			// A take: tone 0.5–1.0 s, silence, tone 1.5–2.0 s.
			const take = join(dir, 'take.wav');
			const tone = (a: number, b: number) => `sine=f=440:d=${b - a}:r=16000,adelay=${a * 1000}`;
			const g = spawnSync(ffmpegPath as unknown as string, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', tone(0.5, 1), '-f', 'lavfi', '-i', tone(1.5, 2), '-filter_complex', 'amix=inputs=2:normalize=0,apad=whole_dur=2.5,atrim=0:2.5', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', take]);
			expect(g.status).toBe(0);
			const plan = join(dir, 'plan.json');
			writeFileSync(plan, JSON.stringify({ voice: take, duration: 6, splices: [{ from: 0.4, to: 1.1, at: 0.4 }, { from: 1.4, to: 2.1, at: 4.4 }] }));
			const out = join(dir, 'placed.wav');
			const r = spawnSync('node', [join(import.meta.dir, 'voice-place.mjs'), '--plan', plan, '--out', out], { encoding: 'utf8' });
			expect(JSON.parse(r.stdout.trim().split('\n').pop()!)).toMatchObject({ splices: 2, duration: 6 });
			const conv = join(dir, 'conv.wav');
			spawnSync(ffmpegPath as unknown as string, ['-y', '-loglevel', 'error', '-i', out, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', conv]);
			const e = energy(conv);
			const loud = (t: number) => e[Math.round(t * 10)] > 1000;
			expect([0.7, 4.7].every(loud)).toBe(true); // both tones, the second moved to 4.5–5.0 s
			expect([1.7, 3.0, 5.5].some(loud)).toBe(false); // nothing left at the old place or between
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
