import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as V from './voice';

// Fixtures: `shots(3, 3)` are s01, s02 of 3 s; a line is [key, first word, end of last word] in the take.
const FPS = 30;
const shots = (...d: number[]) => d.map((duration, i) => ({ key: `s${String(i + 1).padStart(2, '0')}`, duration }));
const ln = (key: string, start: number, end: number) => ({ key, text: key, start, end });
const track = (start: number, ...lines: ReturnType<typeof ln>[]) => ({ start, lines });
/** Film time at which each shot starts, plus the end of the film. */
const cuts = (d: number[]) => d.reduce((a, x) => [...a, a[a.length - 1] + x], [0]);
/** The two instants are on the same frame, or neighbours when the exact instant falls between two. */
const near = (a: number, b: number, fps = FPS) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.5 / fps + 1e-6);
const words = (...at: number[]) => at.map((t) => ({ w: 'w', t, end: t + 0.1 }));

describe('retime (I2): speech is never cut, the image follows the voice', () => {
	test('AC-I2-1: no word of a later line lands in another shot', () => {
		const tr = { ...track(0.3, ln('s01', 0, 2), ln('s03', 3, 4)), words: words(0, 0.5, 1.9, 3, 3.4, 3.9) };
		const d = V.retime(shots(3, 3, 3), tr, FPS);
		const per = V.wordsPerShot(d, tr);
		expect(per.map((p) => p.length)).toEqual([3, 0, 3]);
	});

	test('AC-I2-2: a voiced shot lasts until its last word plus hold when the silence allows it', () => {
		const d = V.retime(shots(1, 3, 3), track(0.3, ln('s01', 0, 1), ln('s03', 5, 6)), FPS);
		near(d[0], 1.8);
		near(cuts(d)[2], 5.05);
	});

	test('AC-I2-3: a short silence takes the hold first, then squeezes the unvoiced shots', () => {
		// Last word ends at 1.3, next shot starts at 2.55: 1.25 s left for hold (0.5) + one unvoiced shot (min 1).
		const holdGivesWay = V.retime(shots(1, 3, 3), track(0.3, ln('s01', 0, 1), ln('s03', 2.5, 3.5)), FPS);
		expect(holdGivesWay[0]).toBeGreaterThanOrEqual(1.3 - 1e-6);
		expect(holdGivesWay[0]).toBeLessThan(1.8 - 0.1);
		expect(holdGivesWay[1]).toBeGreaterThanOrEqual(1 - 1 / FPS);
		// Next shot starts at 1.95: only 0.65 s after the last word, the unvoiced shot is squeezed below min.
		const squeezed = V.retime(shots(1, 3, 3), track(0.3, ln('s01', 0, 1), ln('s03', 1.9, 2.9)), FPS);
		near(squeezed[0], 1.3);
		expect(squeezed[1]).toBeLessThan(1);
		near(cuts(squeezed)[2], 1.95);
	});

	test('AC-I2-4: unvoiced shots between two voiced ones share the silence in proportion to their planned length', () => {
		const d = V.retime(shots(2, 3, 1, 2), track(0.3, ln('s01', 0, 1), ln('s04', 6, 7)), FPS);
		const c = cuts(d);
		near(c[3], 6.05);
		expect(Math.abs(d[1] - 3 * d[2])).toBeLessThanOrEqual(4 / FPS);
		expect(d[1] + d[2]).toBeCloseTo(c[3] - c[1], 6);
	});

	test('AC-I2-4: when the silence allows min for each, no unvoiced shot falls below min (the reviewer case)', () => {
		// Shots 3, 2, 1, 3 s: the first line ends at 1.3, the next shot starts at 3.8. Proportions would give 1.33 and 0.67.
		const d = V.retime(shots(3, 2, 1, 3), track(0.3, ln('s01', 0, 1), ln('s04', 3.75, 4.75)), FPS);
		const c = cuts(d);
		near(c[3], 3.8);
		expect(d[1]).toBeCloseTo(1, 6);
		expect(d[2]).toBeCloseTo(1, 6);
		expect(d[0]).toBeGreaterThanOrEqual(1.3 - 1e-6);
	});

	test('AC-I2-4: shots below min get min and the others share the rest in proportion', () => {
		// 1 s voiced shot, then 0.2, 0.2 and 6 s unvoiced shots over a long silence: the two short ones are raised to min.
		const d = V.retime(shots(1, 0.2, 0.2, 6, 3), track(0.3, ln('s01', 0, 0.5), ln('s05', 9.95, 10.5)), FPS);
		const c = cuts(d);
		near(c[4], 10);
		expect(d[1]).toBeGreaterThanOrEqual(1 - 1 / FPS);
		expect(d[2]).toBeGreaterThanOrEqual(1 - 1 / FPS);
		near(d[3], c[4] - c[1] - d[1] - d[2]);
		expect(d[3]).toBeGreaterThan(6);
	});

	test('AC-I2-5: a later voiced shot starts on the frame nearest to its first word minus lead, but not before the previous last word', () => {
		const fps = 20;
		const lead = V.retime(shots(3, 3), track(0.3, ln('s01', 0, 1), ln('s02', 3, 4)), fps);
		expect(cuts(lead)[1]).toBeCloseTo(3.05, 6);
		// s01 ends at 3.5 (3.2 + 0.3): the previous word wins over 3.7 - 0.25 = 3.45.
		const after = V.retime(shots(3, 3), track(0.3, ln('s01', 0, 3.2), ln('s02', 3.4, 4.4)), fps);
		expect(cuts(after)[1]).toBeCloseTo(3.5, 6);
	});

	test('AC-I2-6: opening unvoiced shots keep their length and voiceStart waits for them', () => {
		const s = shots(2, 3, 3);
		const lines = [ln('s02', 0, 2), ln('s03', 2.5, 4)];
		expect(V.voiceStart(s, lines, FPS)).toBeCloseTo(2 + V.VOICE_START, 6);
		expect(V.voiceStart(shots(2.02, 3), [ln('s02', 0, 1)], FPS)).toBeCloseTo(2.0333333 + V.VOICE_START, 5);
		expect(V.voiceStart(shots(3, 3), [ln('s01', 0, 1)], FPS)).toBeCloseTo(V.VOICE_START, 6);
		const tr = { ...track(V.voiceStart(s, lines, FPS), ...lines), words: words(0, 1, 1.9, 2.5, 3.5) };
		const d = V.retime(s, tr, FPS);
		expect(d[0]).toBe(2);
		const per = V.wordsPerShot(d, tr);
		expect(per[0]).toEqual([]);
		expect(per.slice(1).flat().length).toBe(5);
		// The first word lands VOICE_START after the cut of its shot, the way it does at film start.
		near(cuts(d)[1] + V.VOICE_START, tr.start);
	});

	test('AC-I2-7: the last voiced shot covers its last word plus hold, closing shots keep their length', () => {
		const d = V.retime(shots(3, 3, 3), track(0.3, ln('s01', 0, 1), ln('s02', 3, 6)), FPS);
		near(d[1], 6.8 - 3.05);
		expect(d[2]).toBe(3);
		const short = V.retime(shots(3, 3, 3), track(0.3, ln('s01', 0, 1), ln('s02', 3, 3.5)), FPS);
		expect(short[1]).toBe(3);
		expect(short[2]).toBe(3);
	});

	test('AC-I2-8: no drift, the durations add up to the rounded film end', () => {
		const fps = 20;
		const s = shots(3, 1.3, 2.1, 0.7, 1.9, 2.3, 0.9, 1.7, 3);
		const d = V.retime(s, track(0.3, ln('s01', 0, 2), ln('s09', 20, 21)), fps);
		expect(d.reduce((a, x) => a + x, 0)).toBeCloseTo(23.05, 5);
		expect(cuts(d)[8]).toBeCloseTo(20.05, 5);
		for (const c of cuts(d)) expect(Math.abs(c * fps - Math.round(c * fps))).toBeLessThan(1e-4);
		for (const x of d) expect(x).toBeGreaterThanOrEqual(1 / fps - 1e-6);
	});

	test('AC-I2-9: the audit repro, a long first line leaves the silent shot only what remains', () => {
		const tr = { ...track(0.3, ln('s01', 0, 4), ln('s03', 4.6, 5.5)), words: words(0, 1, 2, 3.6, 4.6, 5) };
		const d = V.retime(shots(3, 3, 3), tr, FPS);
		expect(d[0]).toBeCloseTo(4.3, 4);
		expect(cuts(d)[2]).toBeCloseTo(Math.round(4.65 * FPS) / FPS, 4);
		const per = V.wordsPerShot(d, tr);
		expect(per.map((p) => p.length)).toEqual([4, 0, 2]);
	});

	test('AC-I2-10: with no silence left, each unvoiced shot lasts one frame and the voiced shot ends right before them', () => {
		const d = V.retime(shots(3, 3, 3, 3), track(0.3, ln('s01', 0, 2), ln('s04', 2.2, 3.2)), FPS);
		const c = cuts(d);
		expect(d[1]).toBeCloseTo(1 / FPS, 6);
		expect(d[2]).toBeCloseTo(1 / FPS, 6);
		expect(c[3]).toBeCloseTo(69 / FPS, 6);
		expect(d[0]).toBeCloseTo(67 / FPS, 6);
	});

	test('AC-I2-11: two cuts that round to the same frame: the later one moves a frame forward', () => {
		const d = V.retime(shots(3, 5, 0.01, 3), track(0.3, ln('s01', 0, 2), ln('s04', 2.75, 3.75)), FPS);
		const c = cuts(d);
		for (const x of d) expect(x).toBeGreaterThanOrEqual(1 / FPS - 1e-6);
		expect(d[2]).toBeCloseTo(1 / FPS, 6);
		expect(c[3]).toBeCloseTo(84 / FPS, 6); // 103e8586: the anchor (2.8 s) stays, the unvoiced shots share the frames before it
	});

	test('AC-I2-12: when the previous last word ends after the next first word, the shot starts at its first word', () => {
		const d = V.retime(shots(3, 3, 3), track(0.3, ln('s01', 0, 4), ln('s02', 3.5, 5)), FPS);
		expect(cuts(d)[1]).toBeCloseTo(3.8, 6);
	});

	test('4ba0497b: a cut that ends a voiced shot is rounded up to its last word, not down', () => {
		// The last word starts at 1.605 and ends at 1.61: the nearest frame is 1.60, the frame at or after the word is 1.633.
		const tr = { ...track(0.3, ln('s01', 0, 1.31), ln('s03', 5, 6)), words: [{ w: 'a', t: 0, end: 0.5 }, { w: 'z', t: 1.305, end: 1.31 }] };
		const unvoiced = V.retime(shots(1, 3, 3), tr, FPS, { hold: 0 });
		expect(unvoiced[0]).toBeGreaterThanOrEqual(1.61 - 1e-6);
		expect(V.wordsPerShot(unvoiced, tr).map((p) => p.length)).toEqual([2, 0, 0]);
		// Same line followed directly by a voiced shot whose first word is a bit later.
		const direct = { ...tr, lines: [ln('s01', 0, 1.31), ln('s02', 1.4, 2.4)] };
		const d = V.retime(shots(3, 3), direct, FPS);
		expect(d[0]).toBeGreaterThanOrEqual(1.61 - 1e-6);
		expect(V.wordsPerShot(d, direct).map((p) => p.length)).toEqual([2, 0]);
	});

	test('4ba0497b: a last word that ends exactly on a frame is not pushed to the next one', () => {
		const tr = { ...track(0.3, ln('s01', 0, 1.3), ln('s03', 5, 6)), words: [{ w: 'a', t: 0, end: 0.5 }, { w: 'z', t: 1.2, end: 1.3 }] };
		const d = V.retime(shots(1, 3, 3), tr, FPS, { hold: 0 });
		expect(d[0]).toBeCloseTo(1.6, 6);
		expect(V.wordsPerShot(d, tr).map((p) => p.length)).toEqual([2, 0, 0]);
	});

	test('103e8586: many short unvoiced shots between two voiced ones do not push the next anchor past its first word', () => {
		// One voiced shot, eleven unvoiced (the first much longer than the ten others), then a voiced shot whose first word is at 3.3 s.
		const s = shots(3, 40, ...new Array<number>(10).fill(0.1), 3);
		const tr = { ...track(0.3, ln('s01', 0, 0.5), ln('s13', 3, 4)), words: words(0, 0.3, 3, 3.5) };
		const d = V.retime(s, tr, FPS);
		const c = cuts(d);
		expect(Math.round(c[12] * FPS)).toBeLessThanOrEqual(99);
		expect(Math.round(c[12] * FPS)).toBe(92);
		expect(V.wordsPerShot(d, tr)[12].map((w) => w.w).length).toBe(2);
		for (const x of d) expect(x).toBeGreaterThanOrEqual(1 / FPS - 1e-6);
		expect(d.reduce((a, x) => a + x, 0) * FPS).toBeCloseTo(Math.round(d.reduce((a, x) => a + x, 0) * FPS), 4);
		expect(c[13]).toBeCloseTo(Math.round(c[13] * FPS) / FPS, 6);
	});

	test('103e8586: with fewer frames than unvoiced shots, the preceding voiced shot gives up frames and the anchor stays', () => {
		// s01 runs over s04 (glitch): the anchor is frame 114 (first word 3.82 s), only one frame is left for two unvoiced shots.
		const d = V.retime(shots(3, 3, 3, 3), track(0.3, ln('s01', 0, 4), ln('s04', 3.52, 5)), FPS);
		const c = cuts(d);
		expect(c[3]).toBeCloseTo(114 / FPS, 6);
		expect(d[1]).toBeCloseTo(1 / FPS, 6);
		expect(d[2]).toBeCloseTo(1 / FPS, 6);
		expect(d[0]).toBeCloseTo(112 / FPS, 6);
	});

	test('103e8586: when even the voiced shot has no frame to give, the next anchor starts later (last resort)', () => {
		const s = shots(3, ...new Array<number>(20).fill(1), 3);
		const d = V.retime(s, track(0.3, ln('s01', 0, 0.05), ln('s22', 0.2, 1)), FPS);
		expect(d[0]).toBeCloseTo(1 / FPS, 6);
		for (const x of d) expect(x).toBeGreaterThanOrEqual(1 / FPS - 1e-6);
		expect(cuts(d)[21]).toBeCloseTo(21 / FPS, 6);
	});

	test('a take without any line of this storyboard leaves the planned lengths', () => {
		expect(V.retime(shots(2, 3), track(0.3, ln('zz', 0, 1)), FPS)).toEqual([2, 3]);
	});
});

describe('allocate', () => {
	test('103e8586: largest remainder, in proportion to the weights, at least one each, exact total', () => {
		expect(V.allocate(10, [1, 1, 1])).toEqual([4, 3, 3]);
		expect(V.allocate(10, [5, 3, 2])).toEqual([5, 3, 2]);
		expect(V.allocate(7, [10, 0.1, 0.1, 0.1])).toEqual([4, 1, 1, 1]);
		expect(V.allocate(3, [9, 1, 1])).toEqual([1, 1, 1]);
		expect(V.allocate(5, [0, 0])).toEqual([3, 2]);
		const out = V.allocate(30, [8, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]);
		expect(out.reduce((a, x) => a + x, 0)).toBe(30);
		for (const x of out) expect(x).toBeGreaterThanOrEqual(1);
	});
});

describe('voiceMatches (I3)', () => {
	const sb = (...pairs: [string, string][]) => pairs.map(([key, voiceover]) => ({ key, data: { voiceover } }));
	const take = (...pairs: [string, string][]) => ({ lines: pairs.map(([key, text]) => ({ ...ln(key, 0, 1), text })) }) as any;

	test('AC-I3-1: a line that moved to another shot key with the same texts no longer matches', () => {
		const t = take(['s01', 'Hello there.'], ['s02', 'Goodbye.']);
		expect(V.voiceMatches(t, sb(['s01', 'Hello there.'], ['s02', 'Goodbye.']))).toBe(true);
		expect(V.voiceMatches(t, sb(['s01', ''], ['s02', 'Hello there.'], ['s03', 'Goodbye.']))).toBe(false);
	});

	test('a changed text or a different number of lines still does not match', () => {
		const t = take(['s01', 'Hello there.']);
		expect(V.voiceMatches(t, sb(['s01', 'Hello you.']))).toBe(false);
		expect(V.voiceMatches(t, sb(['s01', 'Hello there.'], ['s02', 'More.']))).toBe(false);
		expect(V.voiceMatches(null, sb(['s01', 'Hello there.']))).toBe(false);
	});
});

describe('spoken and scriptOf', () => {
	test('spoken: a text without quotes is read whole, whitespace collapsed', () => {
		expect(V.spoken('  Hello   world \n again ')).toBe('Hello world again');
		expect(V.spoken(undefined)).toBe('');
		expect(V.spoken('   ')).toBe('');
	});

	test('spoken: only the quoted parts are read, straight or curly quotes', () => {
		expect(V.spoken('Narrator says "Cold." then \u201cBrain freeze\u201d softly')).toBe('Cold. Brain freeze');
	});

	test('spoken: stage directions in () and [] are dropped', () => {
		expect(V.spoken('Three scoops (smiling) and [beat] a cone')).toBe('Three scoops and a cone');
		expect(V.spoken('"Go (whisper) now [pause]"')).toBe('Go now');
	});

	test('scriptOf: one line per voiced shot, in order, empty lines filtered', () => {
		const shots = [
			{ key: 's01', data: { voiceover: 'First.' } },
			{ key: 's02', data: {} },
			{ key: 's03', data: { voiceover: '(silence)' } },
			{ key: 's04', data: { voiceover: 'Last [x]' } }
		];
		expect(V.scriptOf(shots)).toEqual([{ key: 's01', text: 'First.' }, { key: 's04', text: 'Last' }]);
	});
});

describe('wordsPerShot', () => {
	test('gives each shot its words with times relative to the shot start', () => {
		const tr = { start: 0.5, words: [{ w: 'a', t: 0, end: 0.2 }, { w: 'b', t: 1, end: 1.2 }, { w: 'c', t: 2.6, end: 2.8 }] };
		expect(V.wordsPerShot([2, 2], tr)).toEqual([[{ w: 'a', t: 0.5 }, { w: 'b', t: 1.5 }], [{ w: 'c', t: 1.1 }]]);
	});

	test('a word starting exactly on a cut belongs to the next shot; words past the film are dropped', () => {
		const tr = { start: 0, words: [{ w: 'a', t: 2, end: 2.1 }, { w: 'z', t: 9, end: 9.1 }] };
		expect(V.wordsPerShot([2, 2], tr)).toEqual([[], [{ w: 'a', t: 0 }]]);
	});

	test('no shot gives no list', () => {
		expect(V.wordsPerShot([], { start: 0, words: [] })).toEqual([]);
	});
});

describe('placeLines (shots already animated)', () => {
	// A take read fast: line 2 starts at 2.0 s in the take, but its shot only starts at 4.5 s in the film.
	const take = {
		duration: 6,
		lines: [{ key: 's01', text: 'one two', start: 0.3, end: 1.6 }, { key: 's02', text: 'three four', start: 2.0, end: 3.4 }, { key: 's03', text: 'five', start: 4.0, end: 4.6 }],
		words: [{ w: 'one', t: 0.3, end: 0.8 }, { w: 'two', t: 1.0, end: 1.6 }, { w: 'three', t: 2.0, end: 2.6 }, { w: 'four', t: 2.8, end: 3.4 }, { w: 'five', t: 4.0, end: 4.6 }]
	};
	const keys = ['s01', 's02', 's03'];

	test('each line starts in its own shot: VOICE_START in the opening shot, lead after the others', () => {
		const p = V.placeLines([4.5, 3.5, 5], keys, take);
		expect(p.track.lines.map((l) => l.start)).toEqual([V.VOICE_START, 4.75, 8.25]);
		expect(p.track.start).toBe(0);
		expect(p.late).toEqual([]);
	});

	test('the words move with their line, in film time', () => {
		const p = V.placeLines([4.5, 3.5, 5], keys, take);
		expect(p.track.words.map((w) => w.t)).toEqual([0.3, 1, 4.75, 5.55, 8.25]);
		expect(p.track.words[1].end).toBe(1.6);
	});

	test('a line never overlaps the previous one, and one too long for its shot is reported', () => {
		const p = V.placeLines([1, 0.5, 5], keys, take);
		for (let i = 1; i < p.splices.length; i++) expect(p.splices[i].at).toBeGreaterThanOrEqual(p.splices[i - 1].at + p.splices[i - 1].to - p.splices[i - 1].from);
		expect(p.late).toContain('s01');
		expect(p.late).toContain('s02');
	});

	test('segments do not reach into the neighbouring lines', () => {
		const p = V.placeLines([4.5, 3.5, 5], keys, take);
		for (let i = 1; i < p.splices.length; i++) expect(p.splices[i].from).toBeGreaterThanOrEqual(p.splices[i - 1].to - 1e-9);
	});
});

describe('voiceStyle', () => {
	test("notes stay in English and name the script's language (notes in the script's language get read aloud)", () => {
		expect(V.voiceStyle('fr')).toContain('The transcript is in French');
		expect(V.voiceStyle('fr')).toContain('premium product film');
		expect(V.voiceStyle('en')).toBe(V.VOICE_STYLE);
		expect(V.voiceStyle(undefined)).toBe(V.VOICE_STYLE);
	});
});

describe('pronunciation lexicon', () => {
	test('lexiconOf keeps only word → respelling strings', () => {
		expect(V.lexiconOf({ pronunciation: { Omeon: 'Oméone', bad: 3, '': 'x', empty: ' ' } })).toEqual({ Omeon: 'Oméone' });
		expect(V.lexiconOf({})).toEqual({});
		expect(V.lexiconOf({ pronunciation: ['Omeon'] })).toEqual({});
	});

	test('lexiconOf: a respelling written for one language stays with it, plain entries apply to all', () => {
		const brand = { pronunciation: { 'omeon.ai': 'Omeon dot A I', fr: { Omeon: 'Oméonne' }, en: { Omeon: 'Oh-may-on' } } };
		expect(V.lexiconOf(brand, 'fr')).toEqual({ 'omeon.ai': 'Omeon dot A I', Omeon: 'Oméonne' });
		expect(V.lexiconOf(brand, 'en')).toEqual({ 'omeon.ai': 'Omeon dot A I', Omeon: 'Oh-may-on' });
		expect(V.lexiconOf(brand)).toEqual({ 'omeon.ai': 'Omeon dot A I' });
	});

	test('respell replaces whole words in any case, and nothing inside another word', () => {
		const lex = { Omeon: 'Oméone', 'omeon.ai': 'Oméone point A I' };
		expect(V.respell("Omeon la lit. Avec omeon, c'est fait.", lex)).toBe("Oméone la lit. Avec Oméone, c'est fait.");
		expect(V.respell('Rendez-vous sur omeon.ai', lex)).toBe('Rendez-vous sur Oméone point A I');
		expect(V.respell('Omeonix et préomeon restent.', lex)).toBe('Omeonix et préomeon restent.');
		expect(V.respell('Rien à changer.', {})).toBe('Rien à changer.');
	});
});

describe('takes: every recording is kept and can be chosen again', () => {
	const sh = (text: string) => [{ key: 's01', data: { voiceover: text } }];
	/** A take as voice_generate writes it: `<tag>.wav` and its `<tag>.json` record, plus the files kept beside it. */
	function take(vdir: string, tag: string, text: string, createdAt: number, wav = true) {
		const dir = V.voiceDir(vdir);
		mkdirSync(dir, { recursive: true });
		const file = join(dir, `${tag}.wav`);
		if (wav) writeFileSync(file, '');
		writeFileSync(join(dir, `${tag}.json`), JSON.stringify({ storyboardVersion: 1, voice: 'Algieba', file, start: 0.3, duration: 2, words: [], lines: [{ key: 's01', text, start: 0, end: 2 }], createdAt }));
		writeFileSync(join(dir, `${tag}.script.json`), '{}');
	}

	test('lists the takes of the current lines, newest first, and skips voice.json, script and placement files', () => {
		const vdir = mkdtempSync(join(tmpdir(), 'choreon-takes-'));
		try {
			take(vdir, 'v1-a', 'Hello.', 1);
			take(vdir, 'v1-b', 'Hello.', 3);
			take(vdir, 'v1-old', 'Goodbye.', 2);
			take(vdir, 'v1-gone', 'Hello.', 4, false);
			writeFileSync(join(V.voiceDir(vdir), 'voice.json'), '{}');
			writeFileSync(join(V.voiceDir(vdir), 'v1-b.placed.json'), '{}');
			expect(V.listTakes(vdir, sh('Hello.')).map((k) => k.tag)).toEqual(['v1-b', 'v1-a']);
			expect(V.listTakes(vdir, sh('Goodbye.')).map((k) => k.tag)).toEqual(['v1-old']);
			expect(V.listTakes(null, sh('Hello.'))).toEqual([]);
		} finally {
			rmSync(vdir, { recursive: true, force: true });
		}
	});

	test('readTake only reads a plain tag inside the voice folder', () => {
		const vdir = mkdtempSync(join(tmpdir(), 'choreon-takes-'));
		try {
			take(vdir, 'v1-a', 'Hello.', 1);
			expect(V.readTake(vdir, 'v1-a')?.voice).toBe('Algieba');
			expect(V.readTake(vdir, '../v1-a')).toBeNull();
			expect(V.readTake(vdir, 'missing')).toBeNull();
		} finally {
			rmSync(vdir, { recursive: true, force: true });
		}
	});
});
