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
