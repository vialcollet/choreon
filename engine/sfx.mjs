#!/usr/bin/env node
// Sound effects: real recordings only. Versioned UI bank (Kenney CC0,
// engine/sfx-bank) + banque locale choisie (Mixkit, Kenney Impact : data/sfx-bank, voir
// engine/sfx-bank/curation.json) whose families whoosh, swish, thump, swell, riser, ui-…
// replace the former synthesized voices. Synthesis is only a last resort
// (local bank missing) or on explicit request ("synth:whoosh"). Levels equalized, alignment
// on each sound's peak, light reflections; final mix with a fixed hierarchy (voice > music > effects), -14 LUFS.
//
//   node engine/sfx.mjs --cues cues.json --out sfx.wav [--duration 30]
//   node engine/sfx.mjs --mix --video in.mp4 [--sfx sfx.wav] [--music m.mp3 --music-gain 0.3 --music-start 0] [--voice vo.wav --voice-start 0.3] [--sfx-gain 1] --out out.mp4
//   node engine/sfx.mjs --catalog            (list of available sounds, for the agent)
//
// cues.json : { "cues": [...], "beds": [...], "reverb": 0.2 }
//  - cue ponctuel : { "t": 1.25, "sound": "click" | "kenney-interface/click_003" | "whoosh", "gain": 0.7, "pitch": 1, "pan": -0.3 }
//    "t" = instant at which the sound must HIT (its peak), not its start.
//  - extended cue (one sound per GESTURE): { "span": [0.8, 1.6], "sound": "whoosh", "gain": 0.5 } — the variant
//    whose rise is closest to the gesture's length is chosen; its peak lands at the end of the gesture (arrival).
//    Options: "at" = START instant (instead of the peak, for a rise), "until" = hard cut (25 ms fade).
//  - bed: { "bed": "bed" | "<id>", "from": 0, "to": 4, "gain": 0.15, "fadeIn": 0.4, "fadeOut": 0.4 } — looped.
//  - mute: [[start, end], …] — total silence (reverb included), 30 ms fades: the "hole" before an impact.
//  - reverb: shared reverb amount (0 to 0.4; default 0.18) that places all sounds in the same room.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const HERE = dirname(fileURLToPath(import.meta.url));
const BANK_DIR = join(HERE, 'sfx-bank');
const SR = 48000;

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) continue;
		const k = argv[i].slice(2);
		out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
	}
	return out;
}

const DATA_BANK_DIR = resolve(process.env.STUDIO_DATA || join(HERE, '..', 'data'), 'sfx-bank');
const ROOTS = { engine: BANK_DIR, data: DATA_BANK_DIR };
const readIndex = (dir) => (existsSync(join(dir, 'index.json')) ? JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) : []);
const BANK = [...readIndex(BANK_DIR), ...readIndex(DATA_BANK_DIR)].filter((b) => b.family !== 'music');
/** Music tracks from the local bank (Mixkit Stock Music Free License). */
const MUSIC = readIndex(DATA_BANK_DIR).filter((b) => b.family === 'music');
/** Path of a bank music track ("music:<id>"). */
export const musicPath = (id) => {
	const m = MUSIC.find((x) => x.id === id || x.id === `music/${id}` || `music:${x.id.split('/').pop()}` === id);
	return m ? join(DATA_BANK_DIR, m.file) : null;
};
const cache = new Map();
/** Decoded sample, at equalized level (norm factor from the index). */
function sample(item) {
	if (!cache.has(item.id)) {
		const r = spawnSync(ffmpegPath, ['-loglevel', 'error', '-i', join(ROOTS[item.root ?? 'engine'], item.file), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
		const buf = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4)).slice();
		const k = item.norm ?? 1;
		if (k !== 1) for (let i = 0; i < buf.length; i++) buf[i] *= k;
		cache.set(item.id, buf);
	}
	return cache.get(item.id);
}

// ---------- synthesis (sounds the bank lacks) ----------

let seed = 42;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2147483648) - 1;
const TAU = Math.PI * 2;

/** State-variable band-pass filter (Chamberlin), frequency modulated sample by sample. */
function svf() {
	let low = 0, band = 0;
	return (x, fc, q = 0.7) => {
		const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR);
		low += f * band;
		const high = x - low - q * band;
		band += f * high;
		return band;
	};
}

/** Each synth returns { buf, peakAt }. `len` in seconds, `p` = relative pitch. */
const SYNTH = {
	// Whoosh: filtered noise whose frequency sweeps up then falls back (object passing).
	whoosh(p = 1, len = 0.6) {
		const n = Math.floor(len * SR), buf = new Float32Array(n), f = svf();
		for (let i = 0; i < n; i++) {
			const k = i / n, env = Math.sin(Math.PI * k) ** 2;
			buf[i] = f(noise(), (400 + 2600 * Math.sin(Math.PI * k)) * p, 0.5) * env * 0.9;
		}
		return { buf, peakAt: len / 2 };
	},
	// Short soft whoosh (card slide).
	swish(p = 1) {
		return SYNTH.whoosh(p * 1.4, 0.28);
	},
	// Muted low impact: descending sub + small transient (logo arrival, anchoring).
	thump(p = 1) {
		const len = 0.7, n = Math.floor(len * SR), buf = new Float32Array(n), f = svf();
		let ph = 0;
		for (let i = 0; i < n; i++) {
			const t = i / SR;
			ph += (TAU * (70 + 50 * Math.exp(-t * 18)) * p) / SR;
			buf[i] = Math.sin(ph) * Math.exp(-t * 6) * 0.9 + f(noise(), 1800, 0.8) * Math.exp(-t * 90) * 0.25;
		}
		return { buf, peakAt: 0.01 };
	},
	// Pad that rises and falls (switch, breathing): soft, slightly detuned chord.
	swell(p = 1, len = 1.8) {
		const n = Math.floor(len * SR), buf = new Float32Array(n);
		const fr = [220, 277.2, 329.6, 440].map((x) => x * p);
		for (let i = 0; i < n; i++) {
			const t = i / SR, k = i / n, env = Math.sin(Math.PI * k) ** 1.5;
			let v = 0;
			fr.forEach((f0, j) => (v += Math.sin(TAU * f0 * t * (1 + (j - 1.5) * 0.002)) / (j + 1.5)));
			buf[i] = v * env * 0.35;
		}
		return { buf, peakAt: len / 2 };
	},
	// Tension riser (filtered noise that opens + rising tone), peaking at the end.
	riser(p = 1, len = 1.4) {
		const n = Math.floor(len * SR), buf = new Float32Array(n), f = svf();
		let ph = 0;
		for (let i = 0; i < n; i++) {
			const k = i / n;
			ph += (TAU * (180 + 520 * k * k) * p) / SR;
			buf[i] = (f(noise(), 300 + 4000 * k * k, 0.6) * 0.6 + Math.sin(ph) * 0.25) * k ** 2.2;
		}
		return { buf, peakAt: len * 0.98 };
	},
	// Very discreet air bed (continuity under a sequence).
	air(p = 1, len = 2) {
		const n = Math.floor(len * SR), buf = new Float32Array(n), f = svf();
		for (let i = 0; i < n; i++) {
			const k = i / n;
			buf[i] = f(noise(), 900 * p, 1.2) * Math.min(1, k * 4, (1 - k) * 4) * 0.12;
		}
		return { buf, peakAt: len / 2 };
	}
};

// ---------- resolving a sound ----------

const rr = new Map(); // round-robin per family (avoids playing the same sample twice in a row)
function resolveSound(name, idx) {
	if (!name) return null;
	if (name.startsWith('synth:') && SYNTH[name.slice(6)]) return { kind: 'synth', name: name.slice(6) };
	const exact = BANK.find((b) => b.id === name || b.id.endsWith(`/${name}`));
	if (exact) return { kind: 'bank', item: exact };
	const fam = BANK.filter((b) => b.family === name);
	if (fam.length) {
		const k = (rr.get(name) ?? idx) % fam.length;
		rr.set(name, k + 1);
		return { kind: 'bank', item: fam[k] };
	}
	// Old names (v1): mapped to the bank.
	const legacy = { tick: 'tick', click: 'click', pop: 'select', blip: 'rollover', glass: 'glass', chime: 'confirmation' }[name];
	if (legacy) return resolveSound(legacy, idx);
	// Last resort: local bank missing → synthesized voice of the same name.
	return SYNTH[name] ? { kind: 'synth', name } : null;
}

/** Variant of a family whose rise (start → peak) is closest to the gesture's duration. */
function fitVariant(name, gesture) {
	const fam = BANK.filter((b) => b.family === name);
	if (!fam.length) return null;
	return fam.reduce((best, b) => (Math.abs(b.peakAt - gesture) < Math.abs(best.peakAt - gesture) ? b : best));
}

/** Bed looped over [from, to] with fades (in/out 0.4 s, seams 0.25 s). */
function renderBed(item, from, to, fadeIn = 0.4, fadeOut = 0.4) {
	const src = sample(item);
	const n = Math.max(1, Math.floor((to - from) * SR));
	const out = new Float32Array(n);
	const xf = Math.min(Math.floor(0.25 * SR), Math.floor(src.length / 4));
	const hop = Math.max(1, src.length - xf);
	for (let start = 0; start < n; start += hop) {
		for (let i = 0; i < src.length && start + i < n; i++) {
			let g = 1;
			if (start > 0 && i < xf) g = i / xf;
			if (i > src.length - xf) g = Math.min(g, (src.length - i) / xf);
			out[start + i] += src[i] * g;
		}
	}
	const fi = Math.min(Math.floor(fadeIn * SR), Math.floor(n / 2)), fo = Math.min(Math.max(1, Math.floor(fadeOut * SR)), Math.floor(n / 2));
	for (let i = 0; i < fi; i++) out[i] *= i / fi;
	for (let i = 0; i < fo; i++) out[n - 1 - i] *= i / fo;
	return out;
}

/** Room reverb (Schroeder: 4 damped comb filters + 2 all-pass), decorrelated stereo. */
function reverb(x, amount, spread = 0) {
	if (!amount) return null;
	const combs = [1557, 1617, 1491, 1422].map((d) => ({ buf: new Float32Array(d + spread), i: 0, lp: 0 }));
	const aps = [556, 441].map((d) => ({ buf: new Float32Array(d + spread), i: 0 }));
	const fb = 0.8, damp = 0.25, out = new Float32Array(x.length);
	for (let n = 0; n < x.length; n++) {
		let y = 0;
		for (const c of combs) {
			const v = c.buf[c.i];
			c.lp = v * (1 - damp) + c.lp * damp;
			c.buf[c.i] = x[n] * 0.5 + c.lp * fb;
			c.i = (c.i + 1) % c.buf.length;
			y += v;
		}
		for (const a of aps) {
			const v = a.buf[a.i];
			const w = y + v * 0.5;
			a.buf[a.i] = w;
			a.i = (a.i + 1) % a.buf.length;
			y = v - w * 0.5;
		}
		out[n] = y * amount;
	}
	return out;
}

/** Variable-pitch playback (linear interpolation). */
function repitch(src, p) {
	if (!p || p === 1) return src;
	const n = Math.floor(src.length / p), out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const x = i * p, j = Math.floor(x), f = x - j;
		out[i] = (src[j] ?? 0) * (1 - f) + (src[j + 1] ?? 0) * f;
	}
	return out;
}

export function render(cues, duration, opts = {}) {
	const placed = [];
	cues.forEach((c, i) => {
		const name = c.sound ?? c.type;
		const p = c.pitch ?? 1;
		const pan = Math.max(-1, Math.min(1, c.pan ?? 0));
		// Gesture: the variant whose rise matches the movement's duration, peak on arrival.
		if (Array.isArray(c.span) && c.span.length === 2) {
			const [t0, t1] = c.span.map(Number);
			const item = BANK.find((b) => b.id === name) ?? fitVariant(name, Math.max(0.1, t1 - t0));
			if (!item) return;
			let buf = repitch(sample(item), p);
			let start = t1 - item.peakAt / p;
			// Rise longer than the gesture: start it at the beginning of the movement, with a short fade.
			const early = Math.floor((t0 - 0.12 - start) * SR);
			if (early > 0 && early < buf.length) {
				buf = buf.slice(early);
				const f = Math.min(Math.floor(0.06 * SR), buf.length);
				for (let k = 0; k < f; k++) buf[k] *= k / f;
				start += early / SR;
			}
			placed.push({ buf, start: Math.max(0, start), gain: c.gain ?? 0.5, pan });
			return;
		}
		const r = resolveSound(name, i);
		if (!r) return;
		let buf, peakAt;
		if (r.kind === 'synth') ({ buf, peakAt } = SYNTH[r.name](p, c.len));
		else {
			buf = repitch(sample(r.item), p);
			peakAt = r.item.peakAt / p;
		}
		let start = c.at !== undefined ? Number(c.at) : c.t - peakAt;
		// Start before 0: cut into the sound rather than shifting it.
		if (start < 0) {
			buf = buf.slice(Math.floor(-start * SR));
			start = 0;
		}
		// Clean cut (25 ms fade): silence before an impact.
		if (c.until !== undefined) {
			const end = Math.max(0, Math.floor((Number(c.until) - start) * SR));
			if (end < buf.length) {
				buf = buf.slice(0, end);
				const f = Math.min(Math.floor(0.025 * SR), buf.length);
				for (let k = 0; k < f; k++) buf[buf.length - 1 - k] *= k / f;
			}
		}
		placed.push({ buf, start, gain: c.gain ?? 0.7, pan });
	});
	for (const b of opts.beds ?? []) {
		const item = BANK.find((x) => x.id === b.bed) ?? BANK.filter((x) => x.family === (b.bed || 'bed'))[0];
		if (!item) continue;
		const from = Number(b.from ?? 0), to = Number(b.to ?? duration);
		placed.push({ buf: renderBed(item, from, to, b.fadeIn ?? 0.4, b.fadeOut ?? 0.4), start: from, gain: b.gain ?? 0.15, pan: 0 });
	}
	const end = Math.max(duration || 0, ...placed.map((x) => x.start + x.buf.length / SR + 0.3));
	const n = Math.ceil(end * SR);
	const L = new Float32Array(n), R = new Float32Array(n);
	for (const { buf, start, gain, pan } of placed) {
		const s0 = Math.floor(start * SR);
		const gl = Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2 * gain, gr = Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2 * gain;
		for (let i = 0; i < buf.length && s0 + i < n; i++) {
			L[s0 + i] += buf[i] * gl;
			R[s0 + i] += buf[i] * gr;
		}
	}
	// Small room: two crossed early reflections (ties the sounds together, without "echo").
	const d1 = Math.floor(0.023 * SR), d2 = Math.floor(0.041 * SR);
	for (let i = n - 1; i >= d2; i--) {
		L[i] += R[i - d1] * 0.12 + L[i - d2] * 0.08;
		R[i] += L[i - d1] * 0.12 + R[i - d2] * 0.08;
	}
	// Shared reverb tail: all sounds play in the same space.
	const amount = opts.reverb ?? 0.18;
	if (amount > 0) {
		const mono = new Float32Array(n);
		for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) / 2;
		const wl = reverb(mono, amount), wr = reverb(mono, amount, 23);
		for (let i = 0; i < n; i++) {
			L[i] += wl[i];
			R[i] += wr[i];
		}
	}
	// Intentional silences: everything is cut, reverb tails included.
	for (const [a, b] of opts.mute ?? []) {
		const i0 = Math.floor(a * SR), i1 = Math.floor(b * SR), f = Math.floor(0.03 * SR);
		for (let i = Math.max(0, i0 - f); i < Math.min(n, i1 + f); i++) {
			const g = i < i0 ? (i0 - i) / f : i >= i1 ? (i - i1) / f : 0;
			L[i] *= g;
			R[i] *= g;
		}
	}
	for (let i = 0; i < n; i++) {
		L[i] = Math.tanh(L[i] * 1.1) / 1.1;
		R[i] = Math.tanh(R[i] * 1.1) / 1.1;
	}
	return { L, R, placed: placed.length };
}

export function wav({ L, R }, file) {
	const n = L.length;
	const b = Buffer.alloc(44 + n * 4);
	b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8);
	b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
	b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
	b.write('data', 36); b.writeUInt32LE(n * 4, 40);
	for (let i = 0; i < n; i++) {
		b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
		b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
	}
	writeFileSync(file, b);
	return file;
}

function durationOf(video) {
	const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(ffmpegPath, ['-i', resolve(video)], { encoding: 'utf8' }).stderr || '');
	return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 30;
}

/** Integrated loudness (LUFS) of one input through a filter chain. */
function loudness(input, chain, d) {
	const r = spawnSync(ffmpegPath, ['-hide_banner', ...input, '-af', `${chain ? chain + ',' : ''}loudnorm=print_format=json`, '-t', String(d), '-f', 'null', '-'], { encoding: 'utf8' });
	const m = /"input_i"\s*:\s*"(-?[\d.]+|-inf)"/.exec(r.stderr || '');
	return m && m[1] !== '-inf' ? Number(m[1]) : null;
}
const dB = (x) => 20 * Math.log10(x);
const clampDb = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Final mix, with a fixed hierarchy: voice > music > effects. Each stem is first brought to its own
 * loudness (voice -16 LUFS, music -25 under a voice or -19 alone, effects 5 to 6 LU under the music),
 * the music and the effects duck under the voice (sidechain), the music opens up once the voice is
 * done, then the whole mix gets one linear gain to -14 LUFS and a true-peak limiter (-1.5 dBTP).
 * musicGain / sfxGain are trims around the defaults (0.3 and 1), bounded so they cannot break the order.
 */
export function mix({ video, sfx, music, musicGain = 0.3, musicStart = 0, sfxGain = 1, voice, voiceStart = 0, fade = 1.2, out }) {
	const d = durationOf(video);
	const inputs = ['-i', resolve(video)];
	const pre = [];
	const labels = [];
	const fit = `aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${d},atrim=0:${d}`;
	const T = voice ? { v: -16, m: -25, s: -30 } : music ? { m: -19, s: -25 } : { s: -20 };
	let k = 1, vEnd = 0;
	const gains = {};
	if (voice) {
		const vIn = ['-i', resolve(voice)];
		const lv = loudness(vIn, '', d) ?? T.v;
		gains.voice = +(T.v - lv).toFixed(2);
		vEnd = voiceStart + durationOf(voice);
		const ms = Math.round(voiceStart * 1000);
		inputs.push(...vIn);
		pre.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},${fit.replace('aresample=48000,aformat=channel_layouts=stereo,', '')},highpass=f=80,equalizer=f=3000:t=q:w=1:g=2,acompressor=threshold=0.12:ratio=3:attack=5:release=120,volume=${gains.voice}dB,asplit=3[v][vsm][vss]`);
		labels.push('[v]');
		k++;
	}
	if (music) {
		const mIn = [...(musicStart > 0 ? ['-ss', String(musicStart)] : []), '-i', resolve(music)];
		const lm = loudness(mIn, '', d) ?? T.m;
		gains.music = +(T.m - lm + clampDb(dB(musicGain / 0.3), -6, 3)).toFixed(2);
		inputs.push(...mIn);
		const base = `[${k}:a]${fit},afade=t=in:d=0.6,volume=${gains.music}dB`;
		// Under the voice: a dip in the presence band, ducking, then the music opens up (+4 dB) once the voice is done.
		pre.push(voice ? `${base},equalizer=f=2500:t=q:w=1.2:g=-3[m0];[m0][vsm]sidechaincompress=threshold=0.02:ratio=5:attack=80:release=600:knee=4,volume='1+0.6*clip((t-${(vEnd + 0.2).toFixed(2)})/0.8\,0\,1)':eval=frame[m]` : `${base}[m]`);
		labels.push('[m]');
		k++;
	} else if (voice) pre.push('[vsm]anullsink');
	if (sfx) {
		const sIn = ['-i', resolve(sfx)];
		const ls = loudness(sIn, '', d);
		gains.sfx = +((ls == null ? 0 : T.s - ls) + clampDb(dB(sfxGain), -6, 3)).toFixed(2);
		inputs.push(...sIn);
		pre.push(voice ? `[${k}:a]${fit},volume=${gains.sfx}dB[s0];[s0][vss]sidechaincompress=threshold=0.03:ratio=2.5:attack=30:release=300[s]` : `[${k}:a]${fit},volume=${gains.sfx}dB[s]`);
		labels.push('[s]');
		k++;
	} else if (voice) pre.push('[vss]anullsink');
	if (!labels.length) throw new Error('nothing to mix');
	const bus = `${pre.join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0,afade=t=out:st=${Math.max(0, d - fade)}:d=${fade}`;
	// Pass 1: loudness of the mix. Pass 2: one linear gain to -14 LUFS, then the limiter (no pumping).
	const m1 = spawnSync(ffmpegPath, ['-hide_banner', ...inputs, '-filter_complex', `${bus},loudnorm=print_format=json[a]`, '-map', '[a]', '-t', String(d), '-f', 'null', '-'], { encoding: 'utf8' });
	const li = /"input_i"\s*:\s*"(-?[\d.]+)"/.exec(m1.stderr || '');
	if (!li) throw new Error(`mix measure failed: ${(m1.stderr || '').slice(-400)}`);
	gains.master = +(-14 - Number(li[1])).toFixed(2);
	const r = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${bus},volume=${gains.master}dB,alimiter=limit=0.84:attack=2:release=50:level=0,aresample=48000[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(d), '-movflags', '+faststart', resolve(out)], { encoding: 'utf8' });
	if (r.status !== 0) throw new Error(r.stderr);
	return { out: resolve(out), gains };
}

export function catalog() {
	const fam = {};
	for (const b of BANK) (fam[b.family] ??= []).push(b);
	return {
		bank: Object.entries(fam).map(([family, list]) => ({ family, variants: list.length, duration: +(list.reduce((a, x) => a + x.duration, 0) / list.length).toFixed(2), brightness: +(list.reduce((a, x) => a + x.brightness, 0) / list.length).toFixed(1), ...(list[0].pack !== 'kenney-interface' && list[0].pack !== 'kenney-ui-audio' ? { examples: list.slice(0, 4).map((x) => x.title ?? x.id.split('/').pop()) } : {}) })),
		music: MUSIC.map((m) => ({ id: m.id, title: m.title, artist: m.artist, genre: m.genre, duration: m.duration })),
		synth: Object.keys(SYNTH).map((n) => `synth:${n}`)
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const o = args(process.argv.slice(2));
	try {
		if (o.catalog) console.log(JSON.stringify(catalog()));
		else if (o.mix) {
			const music = o.music ? (o.music.startsWith('music:') ? musicPath(o.music) : o.music) : null;
			if (o.music && !music) throw new Error(`unknown music: ${o.music}`);
			console.log(JSON.stringify(mix({ video: o.video, sfx: o.sfx, music, musicGain: Number(o['music-gain'] ?? 0.3), musicStart: Number(o['music-start'] ?? 0), sfxGain: Number(o['sfx-gain'] ?? 1), voice: o.voice, voiceStart: Number(o['voice-start'] ?? 0), fade: Number(o.fade ?? 1.2), out: o.out })));
		}
		else {
			const data = JSON.parse(readFileSync(resolve(o.cues), 'utf8'));
			const cues = Array.isArray(data) ? data : data.cues ?? [];
			const r = render(cues, Number(o.duration || 0), { beds: Array.isArray(data) ? [] : data.beds ?? [], reverb: Array.isArray(data) ? undefined : data.reverb, mute: Array.isArray(data) ? [] : data.mute ?? [] });
			console.log(JSON.stringify({ out: wav(r, resolve(o.out)), cues: cues.length, placed: r.placed }));
		}
	} catch (e) {
		console.log(JSON.stringify({ error: String(e.message || e) }));
		process.exit(1);
	}
}
