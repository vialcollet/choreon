#!/usr/bin/env node
// Animatic: the storyboard as a film in seconds, before any shot is animated. Each shot's reference
// image is held for its planned duration, captioned with its key and title, over the recorded
// voice-over. It validates the story, the voice and the timing for the price of one ffmpeg pass.
//
//   node engine/animatic.mjs --plan plan.json --out animatic.mp4
//   plan.json: { "width": 1920, "height": 1080, "fps": 30, "font": "…/Geist-Medium.ttf" | null,
//                "shots": [{ "key": "s01", "title": "…", "image": "…/t0_00.png" | null, "duration": 3.5 }],
//                "voice": { "file": "…/voice.wav", "start": 0.3 } | null }

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
	const { width: W, height: H, fps } = plan;
	const shots = plan.shots.filter((s) => s.duration > 0);
	if (!shots.length) throw new Error('no shots');
	const total = shots.reduce((a, s) => a + s.duration, 0);
	// ffmpeg runs in a scratch folder holding the font and the captions under plain names: no path escaping in drawtext.
	const tmp = mkdtempSync(join(tmpdir(), 'animatic-'));
	const font = plan.font && existsSync(plan.font) ? (copyFileSync(plan.font, join(tmp, 'font.ttf')), 'font.ttf') : null;
	const inputs = [];
	const chains = [];
	const size = Math.round(H / 30);
	shots.forEach((s, i) => {
		if (s.image && existsSync(s.image)) inputs.push('-loop', '1', '-framerate', String(fps), '-t', s.duration.toFixed(3), '-i', resolve(s.image));
		else inputs.push('-f', 'lavfi', '-t', s.duration.toFixed(3), '-i', `color=c=0x0c0c0c:s=${W}x${H}:r=${fps}`);
		let c = `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0c0c0c,setsar=1,fps=${fps},format=yuv420p`;
		if (font) {
			writeFileSync(join(tmp, `c${i}.txt`), `${s.key}  ${s.title}`);
			c += `,drawtext=fontfile=${font}:textfile=c${i}.txt:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=${Math.round(size * 0.5)}:x=${Math.round(size * 1.2)}:y=h-th-${Math.round(size * 1.4)}`;
		}
		chains.push(`${c}[v${i}]`);
	});
	const n = shots.length;
	const voice = plan.voice?.file && existsSync(plan.voice.file) ? plan.voice : null;
	if (voice) inputs.push('-i', resolve(voice.file));
	else inputs.push('-f', 'lavfi', '-t', total.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
	const ms = voice ? Math.round((voice.start ?? 0) * 1000) : 0;
	const audio = voice ? `[${n}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[a]` : `[${n}:a]atrim=0:${total.toFixed(3)}[a]`;
	const graph = `${chains.join(';')};${shots.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[v];${audio}`;
	const out = resolve(o.out);
	const r = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(3), '-movflags', '+faststart', out], { cwd: tmp, encoding: 'utf8' });
	rmSync(tmp, { recursive: true, force: true });
	if (r.status !== 0) throw new Error(`ffmpeg: ${(r.stderr || '').slice(-600)}`);
	console.log(JSON.stringify({ out, duration: +total.toFixed(3), shots: n, voice: !!voice }));
} catch (e) {
	console.log(JSON.stringify({ error: String(e.message || e) }));
	process.exit(1);
}
