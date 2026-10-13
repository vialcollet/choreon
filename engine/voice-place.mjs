#!/usr/bin/env node
// Places a recorded take line by line on a film whose shots are already animated: each segment of the take
// (take time from → to) is moved to its film time `at`, with short fades so no cut clicks.
//
//   node engine/voice-place.mjs --plan plan.json --out placed.wav
//   plan.json: { "voice": "…/take.wav", "duration": 18, "splices": [{ "from": 0.3, "to": 2.6, "at": 0.3 }, …] }

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) continue;
		const k = argv[i].slice(2);
		out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
	}
	return out;
}

try {
	const o = args(process.argv.slice(2));
	const plan = JSON.parse(readFileSync(resolve(o.plan), 'utf8'));
	const S = plan.splices ?? [];
	if (!S.length) throw new Error('no splices');
	const total = Math.max(plan.duration ?? 0, ...S.map((s) => s.at + s.to - s.from));
	const chains = S.map((s, i) => {
		const d = s.to - s.from, ms = Math.round(s.at * 1000);
		return `[in${i}]atrim=${s.from.toFixed(3)}:${s.to.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, d - 0.03).toFixed(3)}:d=0.03,adelay=delays=${ms}:all=1[s${i}]`;
	});
	// The segments are mixed over a bed of silence that starts at 0 and lasts the whole film: amix alone starts at the
	// first segment's timestamp, and the lead-in would be lost.
	const graph = `[0:a]asplit=${S.length}${S.map((_, i) => `[in${i}]`).join('')};${chains.join(';')};anullsrc=r=48000:cl=mono,atrim=0:${total.toFixed(3)}[bed];[bed]${S.map((_, i) => `[s${i}]`).join('')}amix=inputs=${S.length + 1}:normalize=0:duration=first:dropout_transition=0[a]`;
	const out = resolve(o.out);
	const r = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', '-i', resolve(plan.voice), '-filter_complex', graph, '-map', '[a]', '-c:a', 'pcm_s16le', out], { encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`ffmpeg: ${(r.stderr || '').slice(-600)}`);
	console.log(JSON.stringify({ out, duration: +total.toFixed(3), splices: S.length }));
} catch (e) {
	console.log(JSON.stringify({ error: String(e.message || e) }));
	process.exit(1);
}
