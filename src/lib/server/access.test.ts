import { beforeAll, describe, expect, test } from 'bun:test';
import { notesOf, projectNotesOf, refOf, renderOf, videoOf } from './access';
import { upsertRef } from './refs';
import { createNote, createProject, createRender, createVideo } from './store';

const mkVideo = (pid: string, title: string) => createVideo(pid, { title, brief: '', format: { width: 1920, height: 1080, fps: 30 }, targetDuration: 20 });
const mkNote = (videoId: string, body: string, renderId: string | null = null) =>
	createNote({ videoId, target: 'storyboard', storyboardVersion: null, shotKey: null, renderId, t: null, region: null, frame: null, body, route: null });

let a: ReturnType<typeof createProject>, b: ReturnType<typeof createProject>;
let va: ReturnType<typeof mkVideo>, vb: ReturnType<typeof mkVideo>;
let refA: ReturnType<typeof upsertRef>, refB: ReturnType<typeof upsertRef>;
let renA: ReturnType<typeof createRender>, renB: ReturnType<typeof createRender>;
let noteA1: ReturnType<typeof mkNote>, noteA2: ReturnType<typeof mkNote>, noteB: ReturnType<typeof mkNote>;

beforeAll(() => {
	a = createProject('Access A', 'access-a');
	b = createProject('Access B', 'access-b');
	va = mkVideo(a.id, 'Video A');
	vb = mkVideo(b.id, 'Video B');
	const ref = (pid: string, slug: string) => upsertRef({ projectId: pid, source: 'whatships', slug, title: slug, company: '', category: '', pageUrl: null, xUrl: null, videoUrl: null, poster: null, duration: null, relevance: {} });
	refA = ref(a.id, 'ref-a');
	refB = ref(b.id, 'ref-b');
	const render = (videoId: string) => createRender({ videoId, shotKey: null, version: 1, file: 'x.mp4', qa: {} as any, runId: null });
	renA = render(va.id);
	renB = render(vb.id);
	noteA1 = mkNote(va.id, 'first');
	noteA2 = mkNote(va.id, 'second');
	noteB = mkNote(vb.id, 'foreign');
});

describe('refOf', () => {
	test('returns a reference of the project', () => expect(refOf(a.id, refA.id)?.id).toBe(refA.id));
	test('returns null for a reference of another project', () => expect(refOf(a.id, refB.id)).toBeNull());
	test('returns null for an unknown id', () => expect(refOf(a.id, 'nope')).toBeNull());
});

describe('videoOf', () => {
	test('returns a video of the project', () => expect(videoOf(a.id, va.id)?.id).toBe(va.id));
	test('returns null for a video of another project', () => expect(videoOf(a.id, vb.id)).toBeNull());
	test('returns null for an unknown id', () => expect(videoOf(a.id, 'nope')).toBeNull());
});

describe('renderOf', () => {
	test('returns a render of the video', () => expect(renderOf(va.id, renA.id)?.id).toBe(renA.id));
	test('returns null for a render of another video', () => expect(renderOf(va.id, renB.id)).toBeNull());
	test('returns null for an unknown id', () => expect(renderOf(va.id, 'nope')).toBeNull());
});

describe('notesOf', () => {
	test('returns the notes of the video, in the requested order', () => {
		expect(notesOf(va.id, [noteA2.id, noteA1.id]).map((n) => n.id)).toEqual([noteA2.id, noteA1.id]);
	});
	test('drops the notes of another video and unknown ids', () => {
		expect(notesOf(va.id, [noteA1.id, noteB.id, 'nope']).map((n) => n.id)).toEqual([noteA1.id]);
	});
	test('returns nothing when every id is foreign', () => expect(notesOf(va.id, [noteB.id])).toEqual([]));
});

describe('projectNotesOf', () => {
	test('keeps the notes of the videos of the project, in the requested order', () => {
		expect(projectNotesOf(a.id, [noteA2.id, noteA1.id]).map((n) => n.id)).toEqual([noteA2.id, noteA1.id]);
	});
	test('drops the notes of another project and unknown ids', () => {
		expect(projectNotesOf(a.id, [noteA1.id, noteB.id, 'nope']).map((n) => n.id)).toEqual([noteA1.id]);
	});
	test('returns nothing when every id is foreign', () => expect(projectNotesOf(a.id, [noteB.id])).toEqual([]));
});
