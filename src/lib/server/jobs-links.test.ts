import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { upsertRef } from './refs';
import * as S from './store';

// A handler that reaches the agent would spend money: the agent is replaced by a recorder that stops the run.
const realAgent = await import('./agent');
const prompts: string[] = [];
mock.module('./agent', () => ({
	...realAgent,
	runAgent: async (task: { prompt: string }) => {
		prompts.push(task.prompt);
		throw new Error('agent stopped');
	}
}));
const { assetFile, enqueue } = await import('./jobs');
afterAll(() => mock.module('./agent', () => realAgent));

/** Waits for a run to leave the queue. */
const finished = async (id: string) => {
	for (let i = 0; i < 200; i++) {
		const r = S.getRun(id)!;
		if (r.status !== 'queued' && r.status !== 'running') return r;
		await Bun.sleep(10);
	}
	throw new Error('run never finished');
};

const mkVideo = (pid: string, title: string) => S.createVideo(pid, { title, brief: 'a brief', format: { width: 1920, height: 1080, fps: 30 }, targetDuration: 20 });
const mkNote = (videoId: string, body: string) => S.createNote({ videoId, target: 'storyboard', storyboardVersion: null, shotKey: null, renderId: null, t: null, region: null, frame: null, body, route: null });

let a: S.Project, b: S.Project, va: S.Video, vb: S.Video;
beforeAll(() => {
	a = S.createProject('Links A', 'links-a');
	b = S.createProject('Links B', 'links-b');
	va = mkVideo(a.id, 'Video A');
	vb = mkVideo(b.id, 'Video B');
});

describe('job inputs only reach what belongs to the run (I1)', () => {
	test('eval refuses a render of another video', async () => {
		const foreign = S.createRender({ videoId: vb.id, shotKey: null, version: 1, file: 'x.mp4', qa: {} as any, runId: null });
		const run = await finished(enqueue('eval', { projectId: a.id, videoId: va.id, renderId: foreign.id }).id);
		expect(run.status).toBe('error');
		expect(run.error).toBe('render not found');
	});

	test('reference_analyze refuses a reference of another project and leaves it alone', async () => {
		const foreign = upsertRef({ projectId: b.id, source: 'upload', slug: 'foreign', title: 'foreign', company: '', category: '', pageUrl: null, xUrl: null, videoUrl: null, poster: null, duration: null, relevance: {} });
		const run = await finished(enqueue('reference_analyze', { projectId: a.id, lane: 'refs', refId: foreign.id }).id);
		expect(run.status).toBe('error');
		expect(run.error).toBe('reference not found');
		expect(S.getProject(b.id)).toBeTruthy();
		const { getRef } = await import('./refs');
		expect(getRef(foreign.id)?.status).toBe('candidate');
	});

	test('reference_scout refuses a forVideo of another project', async () => {
		const run = await finished(enqueue('reference_scout', { projectId: a.id, lane: 'refs', forVideo: vb.id }).id);
		expect(run.status).toBe('error');
		expect(run.error).toBe('video not found');
	});

	test('storyboard_revise ignores the notes of another video: not read, not sent, status untouched', async () => {
		S.createStoryboard(va.id, { logline: 'l', summary: 's', shots: [] }, null);
		const own = mkNote(va.id, 'OWN-NOTE-BODY');
		const foreign = mkNote(vb.id, 'FOREIGN-NOTE-BODY');
		prompts.length = 0;
		const run = await finished(enqueue('storyboard_revise', { projectId: a.id, videoId: va.id, noteIds: [own.id, foreign.id] }).id);
		expect(run.error).toBe('agent stopped');
		expect(prompts[0]).toContain('OWN-NOTE-BODY');
		expect(prompts[0]).not.toContain('FOREIGN-NOTE-BODY');
		const [o, f] = S.getNotes([own.id, foreign.id]);
		expect(o.runId).toBe(run.id);
		expect(f.runId).toBeNull();
		expect(f.status).toBe('open');
	});

	test('lesson_distill has no material from the notes of another video', async () => {
		const foreign = mkNote(vb.id, 'FOREIGN-DISTILL-BODY');
		prompts.length = 0;
		const run = await finished(enqueue('lesson_distill', { projectId: a.id, videoId: va.id, noteIds: [foreign.id] }).id);
		expect(run.status).toBe('done');
		expect(run.output).toEqual({ lessons: 0 });
		expect(prompts).toEqual([]);
	});

	test('lesson_distill keeps the notes of its project when the run has no video', async () => {
		const own = mkNote(va.id, 'OWN-DISTILL-BODY');
		const foreign = mkNote(vb.id, 'FOREIGN-DISTILL-BODY-2');
		prompts.length = 0;
		const run = await finished(enqueue('lesson_distill', { projectId: a.id, noteIds: [own.id, foreign.id] }).id);
		expect(run.error).toBe('agent stopped');
		expect(prompts[0]).toContain('OWN-DISTILL-BODY');
		expect(prompts[0]).not.toContain('FOREIGN-DISTILL-BODY-2');
	});
});

describe('asset_generate file name', () => {
	test('a name with path segments lands in the library of the project under a slug', () => {
		const file = assetFile('/data/projects/p', '../../other/library/x').replaceAll('\\', '/');
		expect(file).toMatch(/^\/data\/projects\/p\/library\/[a-z0-9-]+-[a-z0-9]+\.png$/);
		expect(file).not.toContain('..');
	});
	test('an empty name falls back to image', () => expect(assetFile('/data/projects/p', '').replaceAll('\\', '/')).toMatch(/\/library\/image-[a-z0-9]+\.png$/));
});
