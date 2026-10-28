import { describe, expect, test } from 'bun:test';
import type { BriefState } from '$lib/types';
import { forgetInferred } from './brief';

const state = (over: Partial<BriefState> = {}): BriefState => ({
	status: 'ready',
	decisions: { message: 'old end line', plan_final: 'no call to action', cible: 'answered by the user' },
	inferred: ['message', 'plan_final'],
	ignored: ['references'],
	questions: [],
	...over
});

describe('forgetInferred', () => {
	test('drops the decisions the director inferred, keeps what the user answered', () => {
		const next = forgetInferred(state());
		expect(next.decisions).toEqual({ cible: 'answered by the user' });
		expect(next.inferred).toEqual([]);
		expect(next.ignored).toEqual(['references']);
	});

	test('keeps every decision of a state saved before inferences were tracked', () => {
		const old = state({ inferred: undefined });
		expect(forgetInferred(old).decisions).toEqual(old.decisions);
	});

	test('leaves the given state untouched', () => {
		const s = state();
		forgetInferred(s);
		expect(Object.keys(s.decisions)).toEqual(['message', 'plan_final', 'cible']);
	});
});
