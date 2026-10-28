import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import * as S from '$lib/server/store';

// enqueue() would start the framing review (an agent): replaced by a no-op. Under the full suite Bun may keep another
// file's replacement of the same module, so the tests check the review through its visible effects (status, no real run).
const realJobs = await import('$lib/server/jobs');
mock.module('$lib/server/jobs', () => ({ ...realJobs, enqueue: () => {} }));
afterAll(() => mock.module('$lib/server/jobs', () => realJobs));
const { actions } = await import('./+page.server');

type Action = (e: never) => unknown;
const run = (name: keyof typeof actions, project: S.Project, video: S.Video, form: Record<string, string>) =>
	(actions[name] as unknown as Action)({ request: new Request('http://x/', { method: 'POST', body: new URLSearchParams(form) }), params: { project: project.id, video: video.slug }, locals: { lang: 'en' } } as never);

let p: S.Project;
const framed = (title: string) => {
	const v = S.createVideo(p.id, { title, brief: 'Old brief.', format: { width: 1920, height: 1080, fps: 30 }, targetDuration: 30 });
	S.setBriefState(v.id, { status: 'ready', decisions: { message: 'old end line', plan_final: 'no call to action', cible: 'small business owners' }, inferred: ['message', 'plan_final'], ignored: [], questions: [] });
	return S.getVideo(v.id)!;
};
beforeAll(() => {
	p = S.createProject('Framing', 'framing-actions');
});

describe('framing after a brief edit', () => {
	test('a new brief re-derives the inferred decisions and keeps the user\'s', async () => {
		const v = framed('Edited');
		await run('brief', p, v, { brief: 'New brief: new end line and a call to action.', duration: '30' });
		const st = S.getVideo(v.id)!.briefState;
		expect(st.decisions).toEqual({ cible: 'small business owners' });
		expect(st.status).toBe('reviewing');
		expect(S.listRuns({ projectId: p.id, limit: 5 })).toEqual([]);
	});

	test('the same brief saved again changes nothing', async () => {
		const v = framed('Unchanged');
		await run('brief', p, v, { brief: 'Old brief.', duration: '30' });
		const st = S.getVideo(v.id)!.briefState;
		expect(st.decisions.message).toBe('old end line');
		expect(st.status).toBe('ready');
	});

	test('an axis the user edits is no longer inferred: a later brief edit keeps it', async () => {
		const v = framed('Owned');
		await run('decision', p, v, { field: 'message', value: 'my own end line' });
		expect(S.getVideo(v.id)!.briefState.inferred).toEqual(['plan_final']);
		await run('brief', p, S.getVideo(v.id)!, { brief: 'Another brief.', duration: '30' });
		expect(S.getVideo(v.id)!.briefState.decisions).toEqual({ message: 'my own end line', cible: 'small business owners' });
	});
});
