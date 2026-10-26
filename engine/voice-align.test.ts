import { describe, expect, test } from 'bun:test';

// engine/voice-align.mjs is plain Node ESM (engine/voice.mjs imports it): loaded here the same way.
const load = () => import('./voice-align.mjs');

const lines = [{ key: 's01', text: ' Every video starts. ' }, { key: 's02', text: 'Choreon makes it easy.' }];
const scriptOf = (A: any, ls: { text: string }[]) => ls.flatMap((l, li) => A.tokens(l.text).map((w: string) => ({ w, li })));
/** Heard words one every half second, as the transcript returns them. */
const heard = (...ws: string[]) => ws.map((w, i) => ({ w, t: i * 0.5, end: i * 0.5 + 0.4 }));
const place = (A: any, ls: { key: string; text: string }[], got: ReturnType<typeof heard>) => {
	const script = scriptOf(A, ls);
	const map = A.align(script.map((s: any) => s.w), got.map((x) => A.norm(x.w)));
	return { map, placed: A.placeLines(ls, script, got, map) };
};

describe('voice-align', () => {
	test('an exact transcript aligns every word and places each line from its first to its last word', async () => {
		const A = await load();
		const { map, placed } = place(A, lines, heard('Every', 'video', 'starts.', 'Choreon', 'makes', 'it', 'easy.'));
		expect(map).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(placed).toEqual([
			{ key: 's01', text: 'Every video starts.', start: 0, end: 1.4 },
			{ key: 's02', text: 'Choreon makes it easy.', start: 1.5, end: 3.4 }
		]);
	});

	test('a misheard brand word still counts as a match when the spelling is close', async () => {
		const A = await load();
		expect(A.close('choreon', 'corian')).toBe(true);
		expect(A.close('video', 'audio')).toBe(false);
		const { map } = place(A, lines, heard('Every', 'video', 'starts.', 'Corian', 'makes', 'it', 'easy.'));
		expect(map[3]).toBe(3);
	});

	test('a missing word is tolerated: the line is placed from the words that were heard', async () => {
		const A = await load();
		const { map, placed } = place(A, lines, heard('Every', 'video', 'Choreon', 'makes', 'it', 'easy.'));
		expect(map[2]).toBe(-1);
		expect(placed).toEqual([
			{ key: 's01', text: 'Every video starts.', start: 0, end: 0.9 },
			{ key: 's02', text: 'Choreon makes it easy.', start: 1, end: 2.9 }
		]);
	});

	test('AC-M4-2: a one-word line with an empty transcript is not placed', async () => {
		const A = await load();
		const { map, placed } = place(A, [{ key: 's01', text: 'Hello' }], []);
		expect(map).toEqual([-1]);
		expect(placed).toBeNull();
	});

	test('AC-M4-1: a line whose words were all missed is not placed, never stored as 0-0', async () => {
		const A = await load();
		const { placed } = place(A, lines, heard('Choreon', 'makes', 'it', 'easy.'));
		expect(placed).toBeNull();
	});
	test('a time written "8 h" matches the transcript whether it hears "8 heures", "8h" or "8 hours"', async () => {
		const A = await load();
		const ls = [{ key: 's01', text: '8 h. Omeon starts.' }, { key: 's02', text: '14 h, a meeting.' }];
		const script = A.joinTimes(scriptOf(A, ls));
		expect(script.map((s: any) => s.w)).toEqual(['8h', 'omeon', 'starts', '14h', 'a', 'meeting']);
		expect(script[3].li).toBe(1);
		for (const said of [['8', 'heures'], ['8h'], ['8', 'hours']]) {
			const got = A.joinTimes(heard(...said, 'Omeon', 'starts.', '14h,', 'a', 'meeting.').map((x) => ({ ...x, n: A.norm(x.w) })), 'n', (a: any, b: any) => ({ ...a, w: `${a.w} ${b.w}`, end: b.end }));
			const map = A.align(script.map((s: any) => s.w), got.map((x: any) => x.n));
			expect(map.every((x: number) => x >= 0)).toBe(true);
			const placed = A.placeLines(ls, script, got, map);
			expect(placed[0].start).toBe(0);
			expect(placed[0].end).toBe(got[2].end);
		}
		// "8 heures" becomes one word spanning both.
		const two = A.joinTimes(heard('8', 'heures').map((x) => ({ ...x, n: A.norm(x.w) })), 'n', (a: any, b: any) => ({ ...a, w: `${a.w} ${b.w}`, end: b.end }));
		expect(two).toEqual([{ w: '8 heures', n: '8h', t: 0, end: 0.9 }]);
	});

	test('a line whose first word was misheard keeps the heard word before it, so the take is not cut there', async () => {
		const A = await load();
		const ls = [{ key: 's05', text: 'vos clients.' }, { key: 's06', text: 'Oméonne. Plus de temps.' }];
		const got = heard('vos', 'clients.', 'Hommeon.', 'Plus', 'de', 'temps.');
		const { map, placed } = place(A, ls, got);
		expect(map[2]).toBe(-1);
		expect(placed[1].start).toBe(got[2].t);
		expect(placed[0].end).toBe(got[1].end);
		// Same at the end of a line; a heard word between two matched edges stays unclaimed.
		const tail = place(A, [{ key: 'a', text: 'merci Oméonne.' }, { key: 'b', text: 'Plus tard.' }], heard('merci', 'Hommeon.', 'Plus', 'tard.'));
		expect(tail.placed[0].end).toBe(0.9);
		const noise = place(A, [{ key: 'a', text: 'un deux.' }, { key: 'b', text: 'trois quatre.' }], heard('un', 'deux.', 'euh', 'trois', 'quatre.'));
		expect(noise.placed.map((l: any) => [l.start, l.end])).toEqual([[0, 0.9], [1.5, 2.4]]);
	});

	test('a number without an hour unit, or a lone "h", is left alone', async () => {
		const A = await load();
		expect(A.joinTimes([{ w: '12' }, { w: 'm2' }, { w: 'h' }]).map((x: any) => x.w)).toEqual(['12', 'm2', 'h']);
		expect(A.joinTimes([{ w: '8h30' }, { w: '120' }, { w: 'h' }]).map((x: any) => x.w)).toEqual(['8h30', '120', 'h']);
	});
});

describe('heard words that are not the script words one for one', () => {
	test('splitHeard: a word that normalizes to several tokens ("a.m.") becomes one per part, sharing its time', async () => {
		const A: any = await load();
		const got = A.splitHeard([{ w: '8', t: 0, end: 0.2 }, { w: 'a.m.', t: 0.2, end: 0.6 }, { w: '—', t: 0.6, end: 0.6 }]);
		expect(got.map((x: any) => [x.n, x.t, x.end])).toEqual([['8', 0, 0.2], ['a', 0.2, 0.4], ['m', 0.4, 0.6]]);
	});

	test('closest: a respelled name may be written either way; the closer version of the script counts', async () => {
		const A: any = await load();
		const said = scriptOf(A, [{ text: 'Oh-may-on answers.' }]), spelled = scriptOf(A, [{ text: 'Omeon answers.' }]);
		const best = A.closest([said, spelled], ['omeon', 'answers']);
		expect(best.script).toBe(spelled);
		expect([best.missing, best.extra]).toEqual([0, 0]);
		expect(A.closest([said, spelled], ['oh', 'may', 'on', 'answers']).script).toBe(said);
	});
});
