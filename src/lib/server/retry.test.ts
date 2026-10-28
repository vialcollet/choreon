import { describe, expect, test } from 'bun:test';
import type { Run } from './store';
import { retryOf } from './retry';

const run = (status: Run['status']): Run => ({
	id: 'r1', projectId: 'p', videoId: 'v', kind: 'shot_fix', title: 'Shot s01 — auto fix (round 1)', status,
	input: { projectId: 'p', videoId: 'v', shotKey: 's01', round: 1, findings: [{ axis: 'mouvement', problem: 'p', fix: 'f' }], byAdmin: true },
	output: null, error: 'limit', costUsd: 0, parentId: 'eval-run', createdAt: 0, startedAt: 0, finishedAt: 0
});

describe('retryOf', () => {
	test('a failed run starts again with the same kind, input, round, title and parent', () => {
		expect(retryOf(run('error'), true)).toEqual({
			kind: 'shot_fix',
			input: { projectId: 'p', videoId: 'v', shotKey: 's01', round: 1, findings: [{ axis: 'mouvement', problem: 'p', fix: 'f' }], parentId: 'eval-run', title: 'Shot s01 — auto fix (round 1)', byAdmin: true }
		});
	});

	test('a stopped run can be retried too', () => {
		expect(retryOf(run('cancelled'), false)?.kind).toBe('shot_fix');
	});

	test('admin rights come from who retries, not from the stored input', () => {
		expect(retryOf(run('error'), false)!.input.byAdmin).toBe(false);
	});

	test('a finished, queued or running run is not retried', () => {
		for (const s of ['done', 'queued', 'running'] as const) expect(retryOf(run(s), true)).toBeNull();
	});
});
