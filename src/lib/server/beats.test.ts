import { describe, expect, test } from 'bun:test';

const load = () => import('./beats');

describe('normBeats', () => {
	test('ordinary beats are unchanged', async () => {
		const { normBeats } = await load();
		const raw = [
			{ t: 0, state: 'Empty board', cursor: '', sound: '' },
			{ t: 1.2, state: 'Card added', cursor: 'click on Create', sound: 'click' }
		];
		expect(normBeats(raw, 4)).toEqual(raw);
	});

	test('missing text fields become empty strings, others are stringified', async () => {
		const { normBeats } = await load();
		expect(normBeats([{ t: 1 }, { t: 2, state: 3, cursor: 4, sound: 5 }], 4)).toEqual([
			{ t: 1, state: '', cursor: '', sound: '' },
			{ t: 2, state: '3', cursor: '4', sound: '5' }
		]);
	});

	test('drops entries that are not objects', async () => {
		const { normBeats } = await load();
		const got = normBeats([null, 'x', 3, undefined, [1], { t: 1, state: 'ok' }], 4);
		expect(got).toEqual([{ t: 1, state: 'ok', cursor: '', sound: '' }]);
	});

	test('a non-finite t becomes 0', async () => {
		const { normBeats } = await load();
		const got = normBeats([{ t: Infinity, state: 'a' }, { t: '1e309', state: 'b' }, { t: NaN, state: 'c' }, { t: 'abc', state: 'd' }, { state: 'e' }], 4);
		expect(got.map((b) => b.t)).toEqual([0, 0, 0, 0, 0]);
	});

	test('t is clamped to [0, duration]', async () => {
		const { normBeats } = await load();
		const got = normBeats([{ t: -1, state: 'a' }, { t: 99, state: 'b' }, { t: '2.5', state: 'c' }, { t: 4, state: 'd' }], 4);
		expect(got.map((b) => b.t)).toEqual([0, 4, 2.5, 4]);
	});

	test('anything that is not an array gives []', async () => {
		const { normBeats } = await load();
		for (const raw of [null, undefined, 'x', 3, { t: 1 }]) expect(normBeats(raw, 4)).toEqual([]);
	});

	test('the result survives JSON (no null from Infinity)', async () => {
		const { normBeats } = await load();
		const got = normBeats([{ t: Infinity, state: 'a' }], 4);
		expect(JSON.parse(JSON.stringify(got))[0].t).toBe(0);
	});
});

describe('planAfterFix', () => {
	test('lays the fix plan over the shot as it is now and keeps what changed meanwhile', async () => {
		const { planAfterFix } = await load();
		const now = { intent: 'i', visual: 'old', voiceover: 'Line edited meanwhile.', voiceWords: [{ w: 'line', t: 0.3 }], beats: [{ t: 0, state: 'a' }], directorNotes: ['first'] };
		const { data, beats } = planAfterFix(now, { beats: [{ t: 0, state: 'b' }, { t: 9, state: 'c' }], visual: ' new ', onScreenText: 'Hello' }, ['second'], 4);
		expect(beats?.map((b) => [b.t, b.state])).toEqual([[0, 'b'], [4, 'c']]);
		expect(data).toMatchObject({ visual: 'new', onScreenText: 'Hello', voiceover: 'Line edited meanwhile.', voiceWords: [{ w: 'line', t: 0.3 }], directorNotes: ['first', 'second'] });
	});

	test('without a plan, only the decisions are recorded', async () => {
		const { planAfterFix } = await load();
		const now = { intent: 'i', visual: 'v', beats: [{ t: 0, state: 'a' }] };
		const { data, beats } = planAfterFix(now, null, ['note'], 3);
		expect(beats).toBeNull();
		expect(data).toEqual({ ...now, directorNotes: ['note'] });
	});
});
