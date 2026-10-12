#!/usr/bin/env node
// Indexes the sound banks: duration, peak instant (to align the sound on the event, not
// on the file start), energy, brightness and level-equalization factor.
//  - engine/sfx-bank (versioned): Kenney CC0 interface packs → engine/sfx-bank/index.json
//  - data/sfx-bank (local, not in git): real recordings chosen in curation.json
//    (Mixkit, Kenney Impact) → data/sfx-bank/index.json. Their families carry the role
//    names (whoosh, swish, thump, swell, riser, ui-…), which take precedence over synthesis.
//   node engine/sfx-bank/build-index.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..', 'data', 'sfx-bank');
const SR = 48000;

export function decode(file) {
	const r = spawnSync(ffmpegPath, ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
	const b = r.stdout;
	return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}

/** Measures of a sample; activeRms = energy over the audible part (above -40 dB from the peak). */
function measure(file) {
	const s = decode(file);
	let peak = 0, pi = 0, sum = 0, zc = 0;
	for (let i = 0; i < s.length; i++) {
		const a = Math.abs(s[i]);
		if (a > peak) (peak = a), (pi = i);
		sum += s[i] * s[i];
		if (i && (s[i] >= 0) !== (s[i - 1] >= 0)) zc++;
	}
	const gate = peak * 0.01;
	let as = 0, an = 0;
	for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) > gate) (as += s[i] * s[i]), an++;
	return {
		duration: +(s.length / SR).toFixed(3),
		peakAt: +(pi / SR).toFixed(4),
		peak: +peak.toFixed(3),
		rms: +Math.sqrt(sum / Math.max(1, s.length)).toFixed(4),
		activeRms: Math.sqrt(as / Math.max(1, an)),
		brightness: +(zc / Math.max(1e-3, s.length / SR) / 1000).toFixed(2)
	};
}

// ---------- versioned bank (Kenney interface) ----------
const engineItems = [];
for (const pack of readdirSync(HERE)) {
	const dir = join(HERE, pack);
	if (!statSync(dir).isDirectory()) continue;
	for (const f of readdirSync(dir)) {
		if (!/\.(ogg|wav|mp3)$/.test(f) || /^preview/i.test(f)) continue;
		const name = f.replace(/\.(ogg|wav|mp3)$/, '');
		engineItems.push({ id: `${pack}/${name}`, root: 'engine', file: `${pack}/${f}`, family: name.replace(/[_-]?\d+$/, ''), pack, license: 'CC0', ...measure(join(dir, f)) });
	}
}

// Reference level: median of the Kenney bank, so its gains stay unchanged.
const ref = engineItems.map((x) => x.activeRms).sort((a, b) => a - b)[Math.floor(engineItems.length / 2)] || 0.1;
const norm = (x) => +Math.min(4, Math.max(0.1, ref / Math.max(1e-4, x.activeRms))).toFixed(3);
const finish = (list) => list.map(({ activeRms, ...x }) => ({ ...x, norm: norm({ activeRms }) })).sort((a, b) => a.id.localeCompare(b.id));

writeFileSync(join(HERE, 'index.json'), JSON.stringify(finish(engineItems), null, 1));

// ---------- local bank (real recordings, hand-picked) ----------
const cur = JSON.parse(readFileSync(join(HERE, 'curation.json'), 'utf8'));
const dataItems = [];
const missing = [];
for (const [role, list] of Object.entries(cur.roles ?? {})) {
	for (const x of list) {
		const file = join(DATA, 'mixkit', x.file);
		if (!existsSync(file)) {
			missing.push(x.title);
			continue;
		}
		dataItems.push({ id: `mixkit/${x.id}`, root: 'data', file: `mixkit/${x.file}`, family: role, pack: 'mixkit', title: x.title, license: 'Mixkit SFX Free', ...measure(file) });
	}
}
for (const [role, names] of Object.entries(cur.kenney?.roles ?? {})) {
	const dir = join(DATA, cur.kenney.pack);
	if (!existsSync(dir)) continue;
	for (const f of readdirSync(dir).filter((f) => f.endsWith('.ogg') && names.some((n) => f.startsWith(`${n}_`)))) {
		dataItems.push({ id: `${cur.kenney.pack}/${f.replace(/\.ogg$/, '')}`, root: 'data', file: `${cur.kenney.pack}/${f}`, family: role, pack: cur.kenney.pack, license: 'CC0', ...measure(join(dir, f)) });
	}
}
// Music (not measured: only their duration and metadata are used).
const music = (cur.music ?? [])
	.filter((x) => existsSync(join(DATA, 'mixkit', x.file)))
	.map((x) => ({ id: `music/${x.id}`, root: 'data', file: `mixkit/${x.file}`, family: 'music', pack: 'mixkit', title: x.title, artist: x.artist, genre: x.genre, duration: x.duration, license: 'Mixkit Stock Music Free' }));
if (existsSync(DATA)) writeFileSync(join(DATA, 'index.json'), JSON.stringify([...finish(dataItems), ...music], null, 1));

const fam = {};
for (const it of [...engineItems, ...dataItems]) fam[it.family] = (fam[it.family] ?? 0) + 1;
console.log(JSON.stringify({ engine: engineItems.length, data: dataItems.length, missing, families: fam }));
