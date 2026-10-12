import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import * as S from '$lib/server/store';

// No ffmpeg and no model: the frame extraction is recorded, the router answers a fixed route.
const realJobs = await import('$lib/server/jobs');
const realJev = await import('$lib/server/jev');
const extracted: string[][] = [];
mock.module('$lib/server/jobs', () => ({
	...realJobs,
	engine: async (_script: string, args: string[]) => {
		extracted.push(args);
		return {};
	}
}));
mock.module('$lib/server/jev', () => ({ ...realJev, routeNote: async () => null }));
afterAll(() => {
	mock.module('$lib/server/jobs', () => realJobs);
	mock.module('$lib/server/jev', () => realJev);
});
const { POST } = await import('./+server');

const user = { user: { id: 'u-notes', role: 'user' }, session: { activeOrganizationId: null }, lang: 'en' } as unknown as App.Locals;
const post = (body: Record<string, unknown>) =>
	POST({ request: new Request('http://x/api/notes', { method: 'POST', body: JSON.stringify(body) }), locals: user } as unknown as Parameters<typeof POST>[0]);
const status = async (body: Record<string, unknown>) => {
	try {
		return (await post(body)).status;
	} catch (e) {
		return (e as { status: number }).status;
	}
};

let video: S.Video, renderOwn: S.Render, renderForeign: S.Render;
beforeAll(() => {
	const a = S.createProject('Notes A', 'notes-a');
	const b = S.createProject('Notes B', 'notes-b');
	const mk = (pid: string, title: string) => S.createVideo(pid, { title, brief: '', format: { width: 1920, height: 1080, fps: 30 }, targetDuration: 20 });
	video = mk(a.id, 'Notes video');
	const other = mk(b.id, 'Other video');
	const render = (videoId: string) => S.createRender({ videoId, shotKey: null, version: 1, file: 'x.mp4', qa: {} as any, runId: null });
	renderOwn = render(video.id);
	renderForeign = render(other.id);
});

describe('POST /api/notes (I1)', () => {
	test('a render of another video gets a 404 and no frame is extracted', async () => {
		extracted.length = 0;
		expect(await status({ videoId: video.id, target: 'render', body: 'hello', renderId: renderForeign.id, t: 1 })).toBe(404);
		expect(extracted).toEqual([]);
		expect(S.listNotes(video.id)).toEqual([]);
	});

	test('a render of the video extracts its frame and keeps the note', async () => {
		extracted.length = 0;
		const r = await post({ videoId: video.id, target: 'render', body: 'hello', renderId: renderOwn.id, t: 1 });
		expect(r.status).toBe(200);
		expect(extracted.length).toBe(1);
		expect((await r.json()).renderId).toBe(renderOwn.id);
	});
});
