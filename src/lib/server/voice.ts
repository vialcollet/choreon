import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/** The words actually spoken: quoted parts if the director annotated the line, without stage directions. */
export function spoken(text: string | undefined): string {
	const t = (text ?? '').trim();
	if (!t) return '';
	const quoted = [...t.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1].trim());
	const s = quoted.length ? quoted.join(' ') : t;
	return s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
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

/**
 * Fits the storyboard's shots to a recorded take, the same way after `voice_generate` and after a storyboard import
 * that kept the script: the take always moves to `voiceStart` of the current shots, and unless a shot of this take is
 * already rendered (or `retime` is false) the shots are cut to it; either way each shot gets its words. Rewrites
 * `voice.json` (the take's current placement) together with the shots, all or nothing; the per-take record next to
 * the WAV stays as recorded.
 */
export function fitToVoice(video: { id: string; format: { fps: number } }, shots: S.Shot[], track: VoiceTrack, vdir: string, opts: { retime?: boolean } = {}): { track: VoiceTrack; durations: number[]; cut: boolean } {
	const since = S.takeStart(video.id);
	const built = shots.some((s) => S.listRenders(video.id, s.key).some((x) => x.createdAt >= since));
	const cut = opts.retime !== false && !built;
	const fitted = { ...track, start: voiceStart(shots, track.lines, video.format.fps) }; // the opening shots may have changed since the take was placed
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
