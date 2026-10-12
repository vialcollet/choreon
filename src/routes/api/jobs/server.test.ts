import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { db } from '$lib/server/db';
import * as S from '$lib/server/store';

// enqueue() would start the job (a real browser for ui_harvest): the spy only records the run, as enqueue does.
const real = await import('$lib/server/jobs');
const enqueued: { kind: string; input: Record<string, unknown> }[] = [];
mock.module('$lib/server/jobs', () => ({
	...real,
	enqueue: (kind: string, input: Record<string, unknown> & { projectId: string }) => {
		enqueued.push({ kind, input });
		return S.insertRun({ projectId: input.projectId, videoId: null, kind, title: kind, input });
	}
}));
const { POST } = await import('./+server');

const user = { user: { id: 'u-member', role: 'user' }, session: { activeOrganizationId: null }, lang: 'en' } as unknown as App.Locals;
const admin = { user: { id: 'u-admin', role: 'admin' }, session: { activeOrganizationId: null }, lang: 'en' } as unknown as App.Locals;
const fr = { ...user, lang: 'fr' } as App.Locals;

const runs = () => (db.query('SELECT count(*) AS n FROM runs').get() as { n: number }).n;
const post = (body: Record<string, unknown>, l: App.Locals, origin = 'http://127.0.0.1:5610') =>
	POST({ request: new Request(origin + '/api/jobs', { method: 'POST', body: JSON.stringify({ kind: 'ui_harvest', projectId: 'harvest', ...body }) }), url: new URL(origin + '/api/jobs'), locals: l } as unknown as Parameters<typeof POST>[0]);
/** Status and message of the response or of the thrown HttpError. */
const outcome = async (body: Record<string, unknown>, l: App.Locals, origin?: string) => {
	const before = runs();
	try {
		const r = await post(body, l, origin);
		return { status: r.status, created: runs() - before };
	} catch (e) {
		const h = e as { status: number; body: { message: string } };
		return { status: h.status, message: h.body.message, created: runs() - before };
	}
};

const saved = { port: process.env.PORT, origin: process.env.ORIGIN, auth: process.env.BETTER_AUTH_URL };
const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
beforeAll(() => {
	S.createProject('Harvest', 'harvest'); // shared project (no organization): any signed-in user opens it
	process.env.PORT = '5610';
	delete process.env.ORIGIN;
	delete process.env.BETTER_AUTH_URL;
});
afterAll(() => {
	restore('PORT', saved.port);
	restore('ORIGIN', saved.origin);
	restore('BETTER_AUTH_URL', saved.auth);
	mock.module('$lib/server/jobs', () => real);
});

describe('POST /api/jobs ui_harvest: a member cannot harvest the studio itself (AC-B2-4)', () => {
	test('refuses the loopback addresses at the studio port with a 403 and creates no run', async () => {
		for (const url of ['http://127.0.0.1:5610/admin', 'http://localhost:5610/', 'http://[::1]:5610/settings']) {
			expect(await outcome({ url }, user)).toMatchObject({ status: 403, created: 0 });
		}
		expect(enqueued).toHaveLength(0);
	});

	test('refuses the request\'s own origin (how the member reached the studio)', async () => {
		expect(await outcome({ url: 'https://studio.example.test/p/harvest' }, user, 'https://studio.example.test')).toMatchObject({ status: 403, created: 0 });
	});

	test('refuses ORIGIN and BETTER_AUTH_URL', async () => {
		process.env.ORIGIN = 'https://origin.example.test';
		process.env.BETTER_AUTH_URL = 'https://auth.example.test:8443';
		try {
			expect(await outcome({ url: 'https://origin.example.test/' }, user)).toMatchObject({ status: 403, created: 0 });
			expect(await outcome({ url: 'https://auth.example.test:8443/login' }, user)).toMatchObject({ status: 403, created: 0 });
		} finally {
			delete process.env.ORIGIN;
			delete process.env.BETTER_AUTH_URL;
		}
	});

	test('refuses when any address of the list is the studio (urls array, spaces, commas)', async () => {
		expect(await outcome({ urls: ['ftp://example.com/', 'http://127.0.0.1:5610/'] }, user)).toMatchObject({ status: 403, created: 0 });
		expect(await outcome({ url: 'ftp://example.com/a, http://localhost:5610/b' }, user)).toMatchObject({ status: 403, created: 0 });
		expect(await outcome({ url: 'ftp://example.com/a\nhttp://localhost:5610/b' }, user)).toMatchObject({ status: 403, created: 0 });
	});

	test('the message is translated', async () => {
		expect(await outcome({ url: 'http://localhost:5610/' }, user)).toMatchObject({ message: 'Only studio administrators can harvest the studio itself' });
		expect(await outcome({ url: 'http://localhost:5610/' }, fr)).toMatchObject({ message: 'Seuls les administrateurs du studio peuvent récolter le studio lui-même' });
	});

	test('a studio admin is accepted', async () => {
		expect(await outcome({ url: 'http://127.0.0.1:5610/admin' }, admin)).toMatchObject({ status: 200, created: 1 });
		expect(await outcome({ url: 'https://studio.example.test/p/harvest' }, admin, 'https://studio.example.test')).toMatchObject({ status: 200, created: 1 });
	});

	test('non-string entries are ignored, the route answers normally (669fffa5)', async () => {
		expect(await outcome({ urls: [42, null, {}] }, user)).toMatchObject({ status: 200, created: 1 });
		expect(await outcome({ url: 42 }, user)).toMatchObject({ status: 200, created: 1 });
		expect(await outcome({ urls: [42, 'http://localhost:5610/'] }, user)).toMatchObject({ status: 403, created: 0 });
	});

	test('a member harvesting another site is accepted', async () => {
		expect(await outcome({ url: 'https://example.com/' }, user)).toMatchObject({ status: 200, created: 1 });
		expect(await outcome({ url: 'http://127.0.0.1:3000/' }, user)).toMatchObject({ status: 200, created: 1 });
	});
});

describe('POST /api/jobs ui_login: a signed-in browser session is an admin feature (1704b480)', () => {
	test('a member is refused with a 403 and a translated message, and no run is created', async () => {
		expect(await outcome({ kind: 'ui_login', url: 'https://example.com/' }, user)).toMatchObject({ status: 403, created: 0 });
		expect(await outcome({ kind: 'ui_login', url: 'https://example.com/' }, fr)).toMatchObject({ status: 403, message: 'Seuls les administrateurs du studio peuvent enregistrer une session de navigateur', created: 0 });
	});

	test('an admin is accepted', async () => {
		expect(await outcome({ kind: 'ui_login', url: 'https://example.com/' }, admin)).toMatchObject({ status: 200, created: 1 });
	});

	test('a member harvest of an ordinary https site is accepted but never carries byAdmin', async () => {
		expect(await outcome({ url: 'https://example.com/app' }, user)).toMatchObject({ status: 200, created: 1 });
		expect(enqueued.at(-1)).toMatchObject({ kind: 'ui_harvest', input: { byAdmin: false } });
	});
});

describe('POST /api/jobs: byAdmin comes from the session, never from the body (AC-B2-3)', () => {
	test('a member cannot claim it', async () => {
		enqueued.length = 0;
		await post({ url: 'https://example.com/', byAdmin: true }, user);
		expect(enqueued.at(-1)!.input.byAdmin).toBe(false);
	});

	test('an admin harvest carries byAdmin even when the body says otherwise', async () => {
		await post({ url: 'https://example.com/', byAdmin: false }, admin);
		expect(enqueued.at(-1)!.input.byAdmin).toBe(true);
	});

	test('the other kinds are not claimable either', async () => {
		await post({ kind: 'eval', url: 'x', byAdmin: true }, user);
		expect(enqueued.at(-1)!.input.byAdmin).toBe(false);
	});
});

describe('POST /api/jobs: harvests and sign-ins of a project share the ui queue (3065bb19, D-21)', () => {
	for (const kind of ['ui_harvest', 'ui_login']) {
		test(`${kind} is enqueued on lane ui whatever the body says`, async () => {
			await post({ kind, url: 'https://example.com/', lane: 'other' }, admin);
			expect(enqueued.at(-1)).toMatchObject({ kind, input: { lane: 'ui' } });
			await post({ kind, url: 'https://example.com/' }, admin);
			expect(enqueued.at(-1)).toMatchObject({ kind, input: { lane: 'ui' } });
		});
	}

	test('a member harvest is forced onto lane ui too', async () => {
		await post({ url: 'https://example.com/', lane: 'other' }, user);
		expect(enqueued.at(-1)).toMatchObject({ kind: 'ui_harvest', input: { lane: 'ui' } });
	});
});
