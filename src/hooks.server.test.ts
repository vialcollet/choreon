import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

// `$app/server` is a SvelteKit virtual module (auth.ts reads the request event through it).
mock.module('$app/server', () => ({ getRequestEvent: () => ({}) }));
const { handle } = await import('./hooks.server');

const { db } = await import('$lib/server/db');

const CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";
const signedOut = (path: string) =>
	({ url: new URL('http://x' + path), request: new Request('http://x' + path), cookies: { get: () => undefined }, locals: {} }) as unknown as Parameters<typeof handle>[0]['event'];
const resolve = (() => Promise.reject(new Error('must not reach the route'))) as unknown as Parameters<typeof handle>[0]['resolve'];
const TOKEN = 'k2-test-service-token';
// Signed in through the service token (acts as the first admin), so no better-auth session is needed.
const signedIn = (path: string, method = 'GET') =>
	({ url: new URL('http://x' + path), request: new Request('http://x' + path, { method, headers: { authorization: `Bearer ${TOKEN}` } }), cookies: { get: () => undefined }, locals: {} }) as unknown as Parameters<typeof handle>[0]['event'];
// Route responses: a file for GET, a 405 for the other methods (as SvelteKit answers a route without that handler).
const routeResponse = ((e: { request: Request }) => Promise.resolve(e.request.method === 'GET' ? new Response('file', { status: 200 }) : new Response('Method Not Allowed', { status: 405 }))) as unknown as Parameters<typeof handle>[0]['resolve'];
const expectHardened = (r: Response) => {
	expect(r.headers.get('x-content-type-options')).toBe('nosniff');
	expect(r.headers.get('content-security-policy')).toBe(CSP);
};
const runEvent = async (event: Parameters<typeof handle>[0]['event']) => {
	try {
		return await handle({ event, resolve });
	} catch (e) {
		return e;
	}
};
const run = (path: string) => runEvent(signedOut(path));

describe('handle (hooks.server.ts)', () => {
	beforeAll(() => {
		process.env.STUDIO_TOKEN = TOKEN;
		const now = new Date().toISOString();
		db.query("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES ('u-hook-admin', 'Admin', 'hook-admin@example.test', 1, ?, ?, 'admin')").run(now, now);
	});
	afterAll(() => {
		delete process.env.STUDIO_TOKEN;
		db.run("DELETE FROM user WHERE id = 'u-hook-admin'");
	});

	test('a signed-out GET /files/... is a 401 carrying nosniff and the CSP', async () => {
		const r = (await run('/files/projects/alpha/library/note.txt')) as Response;
		expect(r).toBeInstanceOf(Response);
		expect(r.status).toBe(401);
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('content-security-policy')).toBe(CSP);
		expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(await r.text()).toBe('Not signed in');
	});

	test('a signed-out /api/ request keeps the plain 401 error', async () => {
		expect(await run('/api/jobs')).toMatchObject({ status: 401 });
	});

	test('a signed-out /files (exact) is a 401 carrying the hardening headers', async () => {
		const r = (await run('/files')) as Response;
		expect(r).toBeInstanceOf(Response);
		expect(r.status).toBe(401);
		expectHardened(r);
	});

	test('a signed-in /files and /files/... response carries the hardening headers', async () => {
		for (const p of ['/files', '/files/', '/files/projects/alpha/library/note.txt']) {
			const r = await handle({ event: signedIn(p), resolve: routeResponse });
			expectHardened(r);
		}
	});

	test('a non-GET to /files/... carries the hardening headers too', async () => {
		for (const method of ['POST', 'PUT', 'DELETE']) {
			const r = await handle({ event: signedIn('/files/projects/alpha/library/note.txt', method), resolve: routeResponse });
			expect(r.status).toBe(405);
			expectHardened(r);
		}
	});

	test('a wrong, malformed or empty service token does not sign in', async () => {
		const withAuth = (authorization: string) => ({ ...signedIn('/p/abc'), request: new Request('http://x/p/abc', { headers: { authorization } }) }) as unknown as Parameters<typeof handle>[0]['event'];
		for (const h of ['Bearer wrong', TOKEN, `bearer ${TOKEN}`, 'Bearer ']) expect(await runEvent(withAuth(h))).toMatchObject({ status: 303, location: '/login?next=%2Fp%2Fabc' });
		process.env.STUDIO_TOKEN = '';
		try {
			expect(await runEvent(withAuth('Bearer '))).toMatchObject({ status: 303 });
		} finally {
			process.env.STUDIO_TOKEN = TOKEN;
		}
	});

	test('other paths are left untouched', async () => {
		const r = await handle({ event: signedIn('/filesystem'), resolve: (() => Promise.resolve(new Response('ok'))) as unknown as Parameters<typeof handle>[0]['resolve'] });
		expect(r.headers.get('content-security-policy')).toBeNull();
	});
});
