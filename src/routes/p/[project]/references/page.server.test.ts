import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { getRef, upsertRef, videoRefIds } from '$lib/server/refs';
import * as S from '$lib/server/store';

// enqueue() would start the job (an agent): the spy only records the call.
const realJobs = await import('$lib/server/jobs');
const enqueued: { kind: string; input: Record<string, unknown> }[] = [];
mock.module('$lib/server/jobs', () => ({ ...realJobs, enqueue: (kind: string, input: Record<string, unknown>) => void enqueued.push({ kind, input }) }));
afterAll(() => mock.module('$lib/server/jobs', () => realJobs));
const { actions } = await import('./+page.server');

type Action = (e: never) => unknown;
/** Runs a form action for the project in the URL. */
const run = (name: keyof typeof actions, project: string, form: Record<string, string>) =>
	(actions[name] as unknown as Action)({ request: new Request('http://x/', { method: 'POST', body: new URLSearchParams(form) }), params: { project }, locals: { lang: 'en' } } as never);

let a: S.Project, b: S.Project, va: S.Video, vb: S.Video;
const mkRef = (pid: string, slug: string) => upsertRef({ projectId: pid, source: 'upload', slug, title: slug, company: '', category: '', pageUrl: null, xUrl: null, videoUrl: null, poster: null, duration: null, relevance: {} });
beforeAll(() => {
	a = S.createProject('Refs A', 'refs-a');
	b = S.createProject('Refs B', 'refs-b');
	va = S.createVideo(a.id, { title: 'VA', brief: '', format: { width: 1920, height: 1080, fps: 30 }, targetDuration: 20 });
	vb = S.createVideo(b.id, { title: 'VB', brief: '', format: { width: 1920, height: 1080, fps: 30 }, targetDuration: 20 });
});

describe('references actions act on the URL project only (I1)', () => {
	test('remove deletes a reference of the project, not one of another project', async () => {
		const [own, foreign] = [mkRef(a.id, 'rm-own'), mkRef(b.id, 'rm-foreign')];
		await run('remove', a.id, { id: foreign.id });
		expect(getRef(foreign.id)).not.toBeNull();
		await run('remove', a.id, { id: own.id });
		expect(getRef(own.id)).toBeNull();
	});

	test('reject toggles a reference of the project, not one of another project', async () => {
		const [own, foreign] = [mkRef(a.id, 'rj-own'), mkRef(b.id, 'rj-foreign')];
		await run('reject', a.id, { id: foreign.id });
		expect(getRef(foreign.id)?.status).toBe('candidate');
		await run('reject', a.id, { id: own.id });
		expect(getRef(own.id)?.status).toBe('rejected');
	});

	test('analyze queues a reference of the project, not one of another project', async () => {
		const [own, foreign] = [mkRef(a.id, 'an-own'), mkRef(b.id, 'an-foreign')];
		enqueued.length = 0;
		await run('analyze', a.id, { id: foreign.id });
		expect(enqueued).toEqual([]);
		await run('analyze', a.id, { id: own.id });
		expect(enqueued.map((e) => e.input.refId)).toEqual([own.id]);
	});

	test('attach links only a reference and a video of the project', async () => {
		const [own, foreign] = [mkRef(a.id, 'at-own'), mkRef(b.id, 'at-foreign')];
		await run('attach', a.id, { id: own.id, video: vb.id, on: '1' });
		await run('attach', a.id, { id: foreign.id, video: va.id, on: '1' });
		await run('attach', a.id, { id: foreign.id, video: vb.id, on: '1' });
		expect([...videoRefIds(va.id), ...videoRefIds(vb.id)]).toEqual([]);
		await run('attach', a.id, { id: own.id, video: va.id, on: '1' });
		expect(videoRefIds(va.id)).toEqual([own.id]);
	});
});
