#!/usr/bin/env node
// Burned-in captions from the voice-over: the script's own words (spelling, punctuation), timed on the words the
// take was heard saying, shown in groups (a sentence, cut at a comma when too long) with the spoken word highlighted. Plain Node ESM.
//
//   node engine/captions.mjs --voice track.json [--start 0.3] --video in.mp4 --out out.mp4 --font Brand-SemiBold.ttf
//        [--color #0e172b] [--active #4f7d69] [--highlight color|box] [--active-text #ffffff] [--size 84] [--y 1555]
//        [--max-words 8] [--ass out.ass]
//
// `track.json` holds the take: { lines: [{ key, text, start, end }], words: [{ w, t, end }] }, times in the take;
// `--start` is where the take begins in the film. `--y` is the baseline of the caption block (default: 81 % of the
// height in portrait, 92 % in landscape).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { align, joinTimes, splitHeard, tokens } from './voice-align.mjs';

const NBSP = ' ';

/** The words of a line as they are displayed: punctuation that stands alone (« : », « ? ») and the hour unit (« 8 h ») stay with their word. */
export function displayWords(text) {
	const out = [];
	for (const w of text.trim().split(/\s+/).filter(Boolean)) {
		const prev = out[out.length - 1];
		if (prev && (!/[\p{L}\p{N}]/u.test(w) || (/^\d{1,2}$/.test(prev) && /^h\b/i.test(w)))) out[out.length - 1] = `${prev}${NBSP}${w}`;
		else out.push(w);
	}
	return out;
}

/**
 * Every displayed word of every line with its time in the take: aligned on the heard words (same normalization and
 * alignment as the voice check), the words the transcript missed spread over the gap between their neighbours.
 */
export function timeWords(lines, heardWords) {
	const got = joinTimes(splitHeard(heardWords), 'n', (a, b) => ({ ...a, end: b.end }));
	const shown = lines.map((l, li) => displayWords(l.text).map((text) => ({ text, li })));
	const flat = shown.flat();
	const script = flat.flatMap((d, di) => joinTimes(tokens(d.text).map((n) => ({ n })), 'n').map((x) => ({ n: x.n, di })));
	const map = align(script.map((s) => s.n), got.map((g) => g.n));
	const words = flat.map((d) => ({ ...d, t: null, end: null }));
	script.forEach((s, i) => {
		const g = map[i] >= 0 ? got[map[i]] : null;
		if (!g) return;
		const w = words[s.di];
		w.t = w.t == null ? g.t : Math.min(w.t, g.t);
		w.end = w.end == null ? g.end : Math.max(w.end, g.end);
	});
	// Missed words: share the gap between the last timed word before them and the next one after (bounded by their line).
	for (let i = 0; i < words.length; i++) {
		if (words[i].t != null) continue;
		let j = i;
		while (j < words.length && words[j].t == null && words[j].li === words[i].li) j++;
		// At a line's edge (the line's own times come from its heard words), they take up to `PER_WORD` each in
		// the pause next to it, never past the neighbouring line's words.
		const PER_WORD = 0.45;
		const li = words[i].li, line = lines[li];
		const before = i > 0 && words[i - 1].li === li ? words[i - 1].end : null;
		const after = j < words.length && words[j].li === li && words[j].t != null ? words[j].t : null;
		const prevEnd = i > 0 ? words[i - 1].end : 0;
		const nextStart = lines[li + 1]?.start ?? Infinity;
		const to = after ?? (before != null ? Math.min(nextStart, Math.max(line.end, before + PER_WORD * (j - i))) : line.end);
		const from = before ?? Math.max(prevEnd, Math.min(line.start, to - PER_WORD * (j - i)));
		const step = Math.max(0, to - from) / (j - i);
		for (let k = i; k < j; k++) Object.assign(words[k], { t: from + step * (k - i), end: from + step * (k - i + 1) });
		i = j - 1;
	}
	return words;
}

const chars = (ws) => ws.map((x) => x.text).join(' ').length;

/**
 * Caption groups that never span two lines of the script: a group ends with a sentence (« . », « ? », « ! », « : »),
 * and a sentence over `maxWords` / `maxChars` is cut into the fewest groups that fit, balanced by length and cut at
 * a comma when one is near (« Omeon répond avec vos notes, » / « vos fichiers et vos clients. »).
 */
export function groupWords(words, { maxWords = 8, maxChars = 34 } = {}) {
	const phrases = [];
	let cur = [];
	for (const w of words) {
		if (cur.length && cur[0].li !== w.li) (phrases.push(cur), (cur = []));
		cur.push(w);
		if (/[.:?!…]$/.test(w.text)) (phrases.push(cur), (cur = []));
	}
	if (cur.length) phrases.push(cur);
	const groups = [];
	for (const p of phrases) {
		let k = Math.max(Math.ceil(p.length / maxWords), Math.ceil(chars(p) / maxChars));
		let rest = p;
		// Each cut goes where the part best matches an even share of what is left, a comma counting as a third of a share closer.
		while (k > 1 && rest.length > 1) {
			const share = chars(rest) / k;
			const cost = (n) => Math.abs(chars(rest.slice(0, n)) - share) - (/[,;]$/.test(rest[n - 1].text) ? share / 3 : 0);
			let best = 1;
			for (let n = 1; n <= Math.min(maxWords, rest.length - 1); n++) if (cost(n) < cost(best)) best = n;
			groups.push(rest.slice(0, best));
			rest = rest.slice(best);
			k--;
		}
		while (rest.length > maxWords) (groups.push(rest.slice(0, maxWords)), (rest = rest.slice(maxWords)));
		if (rest.length) groups.push(rest);
	}
	return groups;
}

/** Display window of each group: from its first word to the next group (a pause holds the group up to `hold` s after its last word). */
export function groupTimes(groups, { hold = 0.5 } = {}) {
	return groups.map((g, i) => {
		const start = g[0].t, last = g[g.length - 1].end;
		const next = groups[i + 1]?.[0].t ?? Infinity;
		return { words: g, start, end: Math.min(next, last + hold) };
	});
}

const assTime = (s) => {
	const cs = Math.max(0, Math.round(s * 100));
	return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
/** "#rrggbb" → ASS "&H00bbggrr". */
export const assColor = (hex) => {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!m) throw new Error(`bad colour: ${hex}`);
	return `&H00${m[3]}${m[2]}${m[1]}`.toUpperCase();
};
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/[{}]/g, (c) => `\\${c}`);

/**
 * The ASS subtitle file: one event per spoken word, the whole group shown and that word highlighted. `highlight`:
 * "color" sets the word in the active colour, slightly larger; "box" puts it in white (`activeText`) on a box of the
 * active colour (libass draws the opaque box per glyph run: it is only made visible on the spoken word).
 * `offset` moves take times to film times.
 */
export function toAss(timed, { width, height, family, size, y, color, active, activeText = '#ffffff', highlight = 'color', offset = 0, scale = 108 }) {
	const margin = Math.round(width * 0.08);
	const box = highlight === 'box';
	const hidden = (c) => c.replace(/^&H00/, '&HFF');
	const look = box ? `${assColor(color)},${assColor(color)},${hidden(assColor(active))},&HFF000000,0,0,0,0,100,100,0,0,3,${Math.round(size * 0.12)},0` : `${assColor(color)},${assColor(color)},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0`;
	const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,${family},${size},${look},2,${margin},${margin},${Math.max(0, height - y)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
	const on = box ? `{\\c${assColor(activeText)}\\3a&H00&}` : `{\\c${assColor(active)}\\fscx${scale}\\fscy${scale}}`;
	const off = box ? `{\\c${assColor(color)}\\3a&HFF&}` : '{\\r}';
	const ev = [];
	for (const g of timed) {
		g.words.forEach((w, i) => {
			const start = i === 0 ? g.start : w.t;
			const end = i === g.words.length - 1 ? g.end : g.words[i + 1].t;
			if (end <= start) return;
			const fade = i === 0 ? '{\\fad(80,0)}' : '';
			// The box eats into the spaces around the word: in "box", every space is widened (all of them, so the
			// line does not shift as the highlight moves).
			const text = g.words.map((x, k) => (k === i ? `${on}${esc(x.text)}${off}` : esc(x.text))).join(box ? '  ' : ' ');
			ev.push(`Dialogue: 0,${assTime(start + offset)},${assTime(end + offset)},Caption,,0,0,0,,${fade}${text}`);
		});
	}
	return head + ev.join('\n') + '\n';
}

/** Full name of a TrueType/OpenType font (name table, id 4, else id 1): what libass matches the style's Fontname on. */
export function fontName(file) {
	const b = readFileSync(file);
	const n = b.readUInt16BE(4);
	for (let i = 0; i < n; i++) {
		const r = 12 + i * 16;
		if (b.toString('latin1', r, r + 4) !== 'name') continue;
		const at = b.readUInt32BE(r + 8), count = b.readUInt16BE(at + 2), strings = at + b.readUInt16BE(at + 4);
		const found = {};
		for (let k = 0; k < count; k++) {
			const e = at + 6 + k * 12;
			const [pid, , , id, len, off] = [0, 2, 4, 6, 8, 10].map((o) => b.readUInt16BE(e + o));
			if ((id !== 4 && id !== 1) || found[id]) continue;
			const raw = b.subarray(strings + off, strings + off + len);
			found[id] = pid === 1 ? raw.toString('latin1') : Buffer.from(raw).swap16().toString('utf16le');
		}
		return found[4] || found[1] || null;
	}
	return null;
}

function probe(video) {
	const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', resolve(video)], { encoding: 'utf8' });
	const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(r.stderr || '');
	if (!m) throw new Error(`cannot read the video size: ${video}`);
	return { width: Number(m[1]), height: Number(m[2]) };
}

/** Writes the ASS next to `out` and burns it into the video (audio copied). */
export function burn({ video, track, start = 0, out, font, color = '#111111', active = '#2563eb', activeText, highlight = 'color', size, y, maxWords = 8, ass }) {
	const { width, height } = probe(video);
	const portrait = height > width;
	const words = timeWords(track.lines, track.words);
	const timed = groupTimes(groupWords(words, { maxWords, maxChars: portrait ? 34 : 56 }));
	const family = (font && fontName(font)) || 'Arial';
	const file = resolve(ass ?? out.replace(/\.[^.]+$/, '.ass'));
	writeFileSync(file, toAss(timed, { width, height, family, size: size ?? Math.round(Math.min(width, height) * (portrait ? 0.078 : 0.06)), y: y ?? Math.round(height * (portrait ? 0.81 : 0.92)), color, active, activeText, highlight, offset: start }));
	// Filter arguments are relative to the ASS folder: no drive letter to escape on Windows.
	const cwd = dirname(file);
	const fonts = font ? relative(cwd, dirname(resolve(font))).replace(/\\/g, '/') || '.' : null;
	const vf = `ass=${basename(file)}${fonts ? `:fontsdir=${fonts}` : ''}`;
	const r = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', '-i', resolve(video), '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', resolve(out)], { encoding: 'utf8', cwd });
	if (r.status !== 0) throw new Error(`captions: ${(r.stderr || '').slice(-400)}`);
	return { out: resolve(out), ass: file, groups: timed.length, family };
}

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) continue;
		const k = argv[i].slice(2);
		out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
	}
	return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const o = args(process.argv.slice(2));
	try {
		const track = JSON.parse(readFileSync(resolve(o.voice), 'utf8'));
		const num = (k) => (o[k] != null ? Number(o[k]) : undefined);
		console.log(JSON.stringify(burn({ video: o.video, track, start: num('start') ?? 0, out: o.out, font: o.font, color: o.color, active: o.active, activeText: o['active-text'], highlight: o.highlight, size: num('size'), y: num('y'), maxWords: num('max-words'), ass: o.ass })));
	} catch (e) {
		console.log(JSON.stringify({ error: String(e.message || e) }));
		process.exitCode = 1;
	}
}
