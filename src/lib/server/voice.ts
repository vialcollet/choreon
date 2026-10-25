import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VoiceTrack } from '$lib/types';
import * as S from './store';

// The voice-over is recorded in one take from the storyboard's lines, then the film is cut to it: speech is
// never cut and the image follows the voice (each voiced shot starts just before its line and lasts until
// its last word, the unvoiced shots share the silences). See `retime` for the exact policy.

/** Breath between the first voiced shot's cut and the take's first word (the take starts after the opening unvoiced shots). */
export const VOICE_START = 0.3;
/** Prebuilt Gemini voices offered in the studio (the first is the default). */
export const VOICES = ['Charon', 'Sulafat', 'Achird', 'Aoede', 'Kore', 'Puck', 'Iapetus', 'Algieba'];
/** Director's notes for the reader: calm, premium, never salesy. */
export const VOICE_STYLE = 'Warm, calm and confident narrator of a premium product film. Mid-tempo, natural pauses between paragraphs, a hint of a smile, never salesy.';
/**
 * The notes for a script in the project's language. They stay in English and name the language: notes written in
 * the script's own language get read aloud with it (every take rejected), and without the hint the reading drifts
 * toward an English accent.
 */
export function voiceStyle(lang: string | undefined): string {
	if (!lang || lang === 'en') return VOICE_STYLE;
	let name = lang;
	try { name = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang; } catch {}
	return VOICE_STYLE.replace('premium product film.', `premium product film. The transcript is in ${name}: read it as a native ${name} speaker, with natural ${name} intonation.`);
}

export const voiceDir = (vdir: string) => join(vdir, 'audio', 'voice');
export const voiceJson = (vdir: string) => join(voiceDir(vdir), 'voice.json');

export function readVoice(vdir: string | null): VoiceTrack | null {
	if (!vdir || !existsSync(voiceJson(vdir))) return null;
	try {
		const v = JSON.parse(readFileSync(voiceJson(vdir), 'utf8')) as VoiceTrack;
		return v.file && existsSync(v.file) ? v : null;
	} catch {
		return null;
	}
}

/** A recorded take, as `voice_generate` keeps it next to the current track: `tag` names its files (`<tag>.wav`, `<tag>.json`). */
export interface VoiceTake { tag: string; voice: string; file: string; duration: number; createdAt: number }

/**
 * Every take recorded for these lines, newest first: each recording is kept, so a better earlier take can be
 * chosen again (`voice_generate` with `take`) instead of rolling the dice once more.
 */
export function listTakes(vdir: string | null, shots: { key: string; data: { voiceover?: string } }[]): VoiceTake[] {
	const dir = vdir ? voiceDir(vdir) : null;
	if (!dir || !existsSync(dir)) return [];
	const out: VoiceTake[] = [];
	for (const f of readdirSync(dir)) {
		const tag = f.replace(/\.json$/, '');
		if (tag === f || f === 'voice.json' || /\.(script|placed)$/.test(tag)) continue;
		const t = readTake(vdir!, tag);
		if (t && voiceMatches(t, shots)) out.push({ tag, voice: t.voice, file: t.file, duration: t.duration, createdAt: t.createdAt });
	}
	return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** The raw take `tag` (before any placement in the shots), or null when its files are gone or the tag is not a plain name. */
export function readTake(vdir: string, tag: string): VoiceTrack | null {
	if (!/^[\w-]+$/.test(tag)) return null;
	try {
		const t = JSON.parse(readFileSync(join(voiceDir(vdir), `${tag}.json`), 'utf8')) as VoiceTrack;
		return t.file && Array.isArray(t.lines) && existsSync(t.file) ? t : null;
	} catch {
		return null;
	}
}

/** The words actually spoken: quoted parts if the director annotated the line, without stage directions. */
export function spoken(text: string | undefined): string {
	const t = (text ?? '').trim();
	if (!t) return '';
	const quoted = [...t.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1].trim());
	const s = quoted.length ? quoted.join(' ') : t;
	return s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The brand's pronunciation lexicon (`brand/brand.json` → `pronunciation`: `{ "Omeon": "Oméone" }`): how the
 * reader should say a word it would get wrong. Only string entries count.
 */
export function lexiconOf(brandJson: Record<string, unknown>): Record<string, string> {
	const p = brandJson.pronunciation;
	if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
	return Object.fromEntries(Object.entries(p as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[0].trim() && !!e[1].trim()));
}

/** The line as it should be read: each lexicon word (whole word, any case) replaced by its respelling, longest first. */
export function respell(text: string, lexicon: Record<string, string>): string {
	const keys = Object.keys(lexicon).sort((a, b) => b.length - a.length);
	if (!keys.length) return text;
	const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const by = new Map(keys.map((k) => [k.toLowerCase(), lexicon[k]]));
	return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])(${keys.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'giu'), (m) => by.get(m.toLowerCase()) ?? m);
}

/** The script: one line per voiced shot, in order. */
export const scriptOf = (shots: { key: string; data: { voiceover?: string } }[]) => shots.map((s) => ({ key: s.key, text: spoken(s.data.voiceover) })).filter((l) => l.text);

/** True when the recorded take reads exactly the current script, line for line and shot for shot (so a storyboard revision that kept the lines keeps the voice). */
export function voiceMatches(track: VoiceTrack | null, shots: { key: string; data: { voiceover?: string } }[]): boolean {
	if (!track) return false;
	const script = scriptOf(shots);
	return script.length === track.lines.length && script.every((l, i) => l.key === track.lines[i].key && l.text === track.lines[i].text);
}

/** The take's start in the film: the opening unvoiced shots (the title card) play in silence, then `VOICE_START` before the first word. */
export function voiceStart(shots: { key: string; duration: number }[], lines: { key: string }[], fps?: number): number {
	const keys = new Set(lines.map((l) => l.key));
	const f = shots.findIndex((s) => keys.has(s.key));
	const h = f > 0 ? shots.slice(0, f).reduce((a, s) => a + s.duration, 0) : 0;
	return +((fps ? Math.round(+(h * fps).toFixed(6)) / fps : h) + VOICE_START).toFixed(6);
}

/** Splits `total` between shots in proportion to their planned lengths, none below `min` (iterative clamp: the shots under `min` get `min`, the rest shares what is left). */
function unvoicedShares(planned: number[], total: number, min: number): number[] {
	const sum = planned.reduce((a, x) => a + x, 0) || 1;
	const out = planned.map((x) => (total * x) / sum);
	if (!min || total < planned.length * min) return out;
	const fixed = new Set<number>();
	for (;;) {
		const free = planned.map((_, i) => i).filter((i) => !fixed.has(i));
		const left = total - fixed.size * min, w = free.reduce((a, i) => a + planned[i], 0) || 1;
		free.forEach((i) => (out[i] = (left * planned[i]) / w));
		const low = free.filter((i) => out[i] < min);
		if (!low.length) break;
		low.forEach((i) => { fixed.add(i); out[i] = min; });
	}
	return out;
}

/** Splits `frames` between shots by largest remainder in proportion to `weights`, none below one frame (`frames` is at least `weights.length`). */
export function allocate(frames: number, weights: number[]): number[] {
	const share = unvoicedShares(weights.some((w) => w > 0) ? weights : weights.map(() => 1), frames, 1);
	const out = share.map((x) => Math.floor(x + 1e-9));
	const order = share.map((x, i) => i).sort((i, j) => share[j] - out[j] - (share[i] - out[i]) || i - j);
	for (let n = frames - out.reduce((a, x) => a + x, 0), k = 0; n > 0; n--, k++) out[order[k % order.length]]++;
	return out;
}

/**
 * Shot durations cut to the recorded voice: speech is never cut, the image follows it.
 * - The opening unvoiced shots keep their planned length; the first voiced shot starts right after them
 *   (`voiceStart` puts the take `VOICE_START` later, so no word plays over them).
 * - A later voiced shot starts `lead` before its first word, but never before the previous shot's last word
 *   and never after its own first word. These cuts are never moved to satisfy `min`.
 * - A voiced shot lasts until the later of its planned share of the silence and its last word plus `hold`.
 *   The unvoiced shots after it share the rest in proportion to their planned length with `min` as a floor
 *   (the shorter ones get `min`, the others share what is left) if the silence allows it; otherwise `hold` gives way first, then they are squeezed. Only when less than a frame
 *   per unvoiced shot remains does the voiced shot end before its last word.
 * - The last voiced shot lasts at least until its last word plus `hold`; the closing shots keep their planned length.
 * - Cuts are rounded to the nearest frame (a cut that ends a voiced shot rounds up to the frame at or after its
 *   last word when the next anchor allows it) and durations are their differences (no drift). The anchors of the
 *   voiced shots keep their frame: the unvoiced shots between two of them share the frames in between by largest
 *   remainder (`allocate`), and with fewer frames than shots the preceding voiced shot gives frames up first.
 *   Elsewhere a cut that does not land after the previous one moves to the next frame, so every shot lasts one frame at least.
 * - If a line ends after the next one starts (a glitch of the transcript), the next shot starts at its first word.
 */
export function retime(shots: { key: string; duration: number }[], track: Pick<VoiceTrack, 'lines' | 'start'>, fps: number, opts: { lead?: number; hold?: number; min?: number } = {}): number[] {
	const lead = opts.lead ?? 0.25, hold = opts.hold ?? 0.5, min = opts.min ?? 1;
	const line = new Map(track.lines.map((l) => [l.key, l]));
	const voiced = shots.map((s, i) => (line.has(s.key) ? i : -1)).filter((i) => i >= 0);
	if (!voiced.length) return shots.map((s) => s.duration);
	const first = (i: number) => track.start + line.get(shots[i].key)!.start, last = (i: number) => track.start + line.get(shots[i].key)!.end;
	const d = (i: number) => shots[i].duration;
	const cut = new Array<number>(shots.length + 1).fill(0); // film time at which each shot starts, then the end of the film
	const firstWord: number[] = []; // a later voiced shot may not start after its own first word
	const ends: [cut: number, lastWord: number, next: number, between: number][] = []; // the cut that ends each voiced shot but the last
	for (let i = 0; i < voiced[0]; i++) cut[i + 1] = cut[i] + d(i);
	let at = cut[voiced[0]];
	for (let k = 0; k < voiced.length; k++) {
		const a = voiced[k];
		cut[a] = at;
		if (k + 1 === voiced.length) {
			cut[a + 1] = at + Math.max(d(a), last(a) + hold - at, min);
			for (let i = a + 1; i < shots.length; i++) cut[i + 1] = cut[i] + d(i);
			break;
		}
		const b = voiced[k + 1], m = b - a - 1;
		const atB = Math.min(Math.max(first(b) - lead, last(a)), first(b));
		firstWord[b] = first(b);
		ends.push([a + 1, last(a), b, m]);
		if (!m) cut[a + 1] = atB;
		else {
			const rest = shots.slice(a + 1, b).reduce((x, s) => x + s.duration, 0);
			const lo = last(a), hi = atB - m * min;
			cut[a + 1] = lo > hi ? Math.min(lo, atB - m / fps) : Math.min(Math.max(at + ((atB - at) * d(a)) / (d(a) + rest), lo + hold), hi);
			const share = unvoicedShares(shots.slice(a + 1, b).map((s) => s.duration), atB - cut[a + 1], lo > hi ? 0 : min);
			for (let j = a + 1; j < b; j++) cut[j + 1] = cut[j] + share[j - a - 1];
		}
		at = atB;
	}
	// Whole frames from the cut instants, one frame at least per shot.
	const frame = (t: number) => Math.round(+(t * fps).toFixed(6));
	const f = cut.map((t, i) => (firstWord[i] === undefined ? frame(t) : Math.min(frame(t), Math.floor(+(firstWord[i] * fps).toFixed(6)))));
	// A cut that ends a voiced shot lands on the frame at or after its last word when the next anchor allows it.
	for (const [i, e, b, m] of ends) {
		const t = Math.ceil(+(e * fps).toFixed(6)), limit = m ? f[b] - m : Math.floor(+(firstWord[b] * fps).toFixed(6));
		if (f[i] < t && t <= limit) f[i] = t;
		if (!m) continue;
		// The unvoiced shots share the frames up to the anchor; the voiced shot gives up frames first, the anchor moves as a last resort.
		f[i] = Math.max(Math.min(f[i], f[b] - m), f[i - 1] + 1);
		f[b] = Math.max(f[b], f[i] + m);
		allocate(f[b] - f[i], Array.from({ length: m }, (_, j) => cut[i + j + 1] - cut[i + j])).forEach((n, j) => (f[i + j + 1] = f[i + j] + n));
	}
	for (let i = 1; i < f.length; i++) f[i] = Math.max(f[i], f[i - 1] + 1);
	return shots.map((_, i) => (f[i + 1] - f[i]) / fps);
}

/** The take's words that fall in each shot, timed from the shot's start. */
export function wordsPerShot(durations: number[], track: Pick<VoiceTrack, 'words' | 'start'>): { w: string; t: number }[][] {
	let t0 = 0;
	return durations.map((d) => {
		const from = t0, to = t0 + d;
		t0 = to;
		return track.words.filter((w) => track.start + w.t + 1e-6 >= from && track.start + w.t + 1e-6 < to).map((w) => ({ w: w.w, t: +(track.start + w.t - from).toFixed(2) }));
	});
}

/** True when a shot of the current take is already rendered: the shots' lengths are baked into their animation. */
export function shotsBuilt(video: { id: string }, shots: S.Shot[]): boolean {
	const since = S.takeStart(video.id);
	return shots.some((s) => S.listRenders(video.id, s.key).some((x) => x.createdAt >= since));
}

export type Splice = { from: number; to: number; at: number };

/**
 * When the shots are already animated (their lengths are baked in), the take is cut line by line and each line
 * placed in its own shot instead of the shots following the take: a line starts `lead` after its shot's cut
 * (`VOICE_START` for the opening shot), never sooner than `gap` after the previous line ends. A segment keeps a
 * little air around its words without reaching into the next line. `late` lists the lines that end after their shot.
 * Returns the cuts (take time `from`→`to`, film time `at`) and the track as heard in the film, starting at 0.
 */
export function placeLines(durations: number[], keys: string[], track: Pick<VoiceTrack, 'lines' | 'words' | 'duration'>, opts: { lead?: number; gap?: number } = {}): { splices: Splice[]; track: Pick<VoiceTrack, 'lines' | 'words' | 'duration' | 'start'>; late: string[] } {
	const lead = opts.lead ?? 0.25, gap = opts.gap ?? 0.15;
	const at0 = new Map<string, { start: number; end: number }>();
	let t = 0;
	keys.forEach((k, i) => { at0.set(k, { start: t, end: t + durations[i] }); t += durations[i]; });
	const L = track.lines;
	const splices: Splice[] = [];
	const late: string[] = [];
	let free = 0;
	L.forEach((l, i) => {
		const from = Math.max(0, l.start - 0.08, i ? (L[i - 1].end + l.start) / 2 : 0);
		const to = Math.min(track.duration, l.end + 0.25, i + 1 < L.length ? (l.end + L[i + 1].start) / 2 : Infinity);
		const shot = at0.get(l.key) ?? { start: free, end: Infinity };
		const at = Math.max(shot.start + (shot.start === 0 ? VOICE_START : lead) - (l.start - from), free);
		splices.push({ from: +from.toFixed(3), to: +to.toFixed(3), at: +at.toFixed(3) });
		if (at + (l.end - from) > shot.end + 1e-6) late.push(l.key);
		free = at + (to - from) + gap;
	});
	const move = (x: number) => { const s = splices.find((p) => x >= p.from - 1e-6 && x < p.to + 1e-6); return s ? +(s.at + x - s.from).toFixed(3) : null; };
	const words = track.words.flatMap((w) => { const t = move(w.t); return t === null ? [] : [{ w: w.w, t, end: +(t + w.end - w.t).toFixed(3) }]; });
	const lines = L.map((l, i) => ({ ...l, start: +(splices[i].at + l.start - splices[i].from).toFixed(3), end: +(splices[i].at + l.end - splices[i].from).toFixed(3) }));
	const last = splices[splices.length - 1];
	return { splices, track: { lines, words, start: 0, duration: last ? +(last.at + last.to - last.from).toFixed(3) : 0 }, late };
}

/**
 * Fits the storyboard's shots to a recorded take, the same way after `voice_generate` and after a storyboard import
 * that kept the script: the take always moves to `voiceStart` of the current shots, and unless a shot of this take is
 * already rendered (or `retime` is false) the shots are cut to it; either way each shot gets its words. Rewrites
 * `voice.json` (the take's current placement) together with the shots, all or nothing; the per-take record next to
 * the WAV stays as recorded.
 */
export function fitToVoice(video: { id: string; format: { fps: number } }, shots: S.Shot[], track: VoiceTrack, vdir: string, opts: { retime?: boolean } = {}): { track: VoiceTrack; durations: number[]; cut: boolean } {
	const cut = opts.retime !== false && !shotsBuilt(video, shots);
	// The opening shots may have changed since the take was placed; a take placed line by line is already in film time.
	const fitted = track.placed ? track : { ...track, start: voiceStart(shots, track.lines, video.format.fps) };
	const durations = cut ? retime(shots, fitted, video.format.fps) : shots.map((s) => s.duration);
	const words = wordsPerShot(durations, fitted);
	// All or nothing: voice.json is replaced atomically, then every shot in one transaction; a failure puts voice.json back.
	const file = voiceJson(vdir), previous = existsSync(file) ? readFileSync(file) : null;
	const put = (content: string | Buffer) => { writeFileSync(`${file}.tmp`, content); renameSync(`${file}.tmp`, file); };
	put(JSON.stringify(fitted, null, 1));
	try {
		S.updateShots(shots.map((s, i) => ({ id: s.id, patch: { duration: durations[i], data: { ...s.data, voiceWords: words[i] } } })));
	} catch (e) {
		if (previous) put(previous);
		else rmSync(file, { force: true });
		throw e;
	}
	return { track: fitted, durations, cut };
}
