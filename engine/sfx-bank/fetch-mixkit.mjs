#!/usr/bin/env node
// Fetches Mixkit sounds into data/sfx-bank/mixkit (not in git):
//  - sound effects ("Mixkit Sound Effects Free License": commercial use, no attribution);
//  - ambient beds (same sound-effect categories, longer);
//  - music tracks ("Mixkit Stock Music Free License": web, social media, online advertising,
//    commercial; NOT TV/radio, CD/DVD or video games) into data/sfx-bank/mixkit/music.
// No redistribution of the files on their own.
//   node engine/sfx-bank/fetch-mixkit.mjs                 (default selection)
//   node engine/sfx-bank/fetch-mixkit.mjs sfx:whoosh:2 bed:drone:1 music:ambient:12

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'data', 'sfx-bank', 'mixkit');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' };
const DEFAULT = [
	'sfx:whoosh:2', 'sfx:swoosh:2', 'sfx:transition:2', 'sfx:impact:2', 'sfx:swell:1', 'sfx:interface:1', 'sfx:pop:1', 'sfx:notification:1',
	'bed:ambience:1', 'bed:drone:1', 'bed:atmosphere:1',
	'music:ambient:12', 'music:corporate:10', 'music:technology:10'
];

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

/** Sound effects: HTML blocks of the grid (title, tags, duration). */
function parseSfx(html) {
	const items = [];
	for (const part of html.split('data-audio-player-item-id-value="').slice(1)) {
		const id = part.slice(0, part.indexOf('"'));
		const t = part.indexOf('item-grid-card__title">');
		if (!/^\d+$/.test(id) || t < 0) continue;
		const title = part.slice(t + 23, part.indexOf('</h2>', t)).replace(/<[^>]+>/g, '').trim();
		const tags = [...part.slice(t, t + 3000).matchAll(/href="\/free-sound-effects\/([a-z0-9-]+)\/">/g)].map((m) => m[1]);
		const d = /data-test-id="duration">\s*(\d+):(\d+)/.exec(part);
		items.push({ id, title, tags: [...new Set(tags)], duration: d ? Number(d[1]) * 60 + Number(d[2]) : null });
	}
	return items;
}

/** Music: structured data (JSON-LD MusicRecording) of the page. */
function parseMusic(html) {
	const out = [];
	const walk = (o) => {
		if (Array.isArray(o)) return o.forEach(walk);
		if (!o || typeof o !== 'object') return;
		if (o['@type'] === 'MusicRecording' && o.url) {
			const m = /PT(?:(\d+)M)?(?:(\d+)S)?/.exec(o.duration ?? '');
			const id = /music\/(\d+)\//.exec(o.url)?.[1];
			if (id) out.push({ id, title: o.name, artist: o.byArtist ?? '', genre: o.genre ?? '', duration: m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : null, url: o.url });
		}
		Object.values(o).forEach(walk);
	};
	for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
		try {
			walk(JSON.parse(m[1]));
		} catch {}
	}
	return out;
}

async function download(url, file) {
	if (existsSync(file)) return true;
	const a = await fetch(url, { headers: UA });
	if (!a.ok) return false;
	writeFileSync(file, Buffer.from(await a.arrayBuffer()));
	return true;
}

const manifestFile = join(OUT, 'manifest.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { source: 'https://mixkit.co/', items: {} };
manifest.licenses = {
	sfx: 'Mixkit Sound Effects Free License: commercial use allowed, no attribution',
	music: 'Mixkit Stock Music Free License: web, social media, online advertising, commercial; no TV/radio, CD/DVD, video games'
};
manifest.music ??= {};

for (const spec of process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT) {
	const [kind, cat, n = '1'] = spec.split(':');
	let got = 0;
	if (kind === 'music') {
		const dir = join(OUT, 'music');
		mkdirSync(dir, { recursive: true });
		const res = await fetch(`https://mixkit.co/free-stock-music/${cat}/`, { headers: UA });
		if (!res.ok) continue;
		for (const it of parseMusic(await res.text()).slice(0, Number(n))) {
			const file = join(dir, `${it.id}-${slug(it.title)}.mp3`);
			if (!(await download(it.url, file))) continue;
			manifest.music[it.id] = { ...it, category: cat, file: `music/${file.split(/[\\/]/).pop()}` };
			got++;
		}
		console.log(`musique ${cat} : ${got}`);
		continue;
	}
	// sfx (≤ 8 s) or bed (beds: 4 to 60 s), n = number of pages
	const dir = join(OUT, cat);
	mkdirSync(dir, { recursive: true });
	for (let p = 1; p <= Number(n); p++) {
		const res = await fetch(`https://mixkit.co/free-sound-effects/${cat}/${p > 1 ? `?page=${p}` : ''}`, { headers: UA });
		if (!res.ok) break;
		const items = parseSfx(await res.text());
		if (!items.length) break;
		for (const it of items) {
			const d = it.duration;
			if (kind === 'sfx' && d !== null && d > 8) continue;
			if (kind === 'bed' && (d === null || d < 4 || d > 60)) continue;
			const file = join(dir, `${it.id}-${slug(it.title)}.mp3`);
			if (!(await download(`https://assets.mixkit.co/active_storage/sfx/${it.id}/${it.id}-preview.mp3`, file))) continue;
			manifest.items[it.id] = { ...it, category: cat, kind, file: `${cat}/${file.split(/[\\/]/).pop()}` };
			got++;
		}
	}
	console.log(`${kind} ${cat} : ${got}`);
}
writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
