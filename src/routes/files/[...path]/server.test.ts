import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMigrations } from 'better-auth/db/migration';
import { db } from '$lib/server/db';
import { DATA_DIR, PROJECTS_DIR } from '$lib/server/paths';
import { createProject } from '$lib/server/store';
import { GET } from './+server';

// `$app/server` is a SvelteKit virtual module (auth.ts reads the request event through it).
mock.module('$app/server', () => ({ getRequestEvent: () => ({}) }));

const CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";
const locals = (id: string, orgId: string) => ({ user: { id, role: 'user' }, session: { activeOrganizationId: orgId }, lang: 'en' }) as unknown as App.Locals;
const call = (path: string, l: App.Locals, headers: Record<string, string> = {}) =>
	GET({ params: { path }, request: new Request('http://x/files/' + path, { headers }), locals: l } as unknown as Parameters<typeof GET>[0]);
const status = async (path: string, l: App.Locals) => {
	try {
		return (await call(path, l)).status;
	} catch (e) {
		return (e as { status: number }).status;
	}
};

const mine = locals('u-mine', 'org-a');
const outsider = locals('u-out', 'org-b');

beforeAll(async () => {
	// The real better-auth schema (user, organization, member), migrated the way hooks.server.ts does.
	const { auth } = await import('$lib/server/auth');
	await (await getMigrations(auth.options)).runMigrations();
	const now = new Date().toISOString();
	for (const [id, org] of [['u-mine', 'org-a'], ['u-out', 'org-b']]) {
		db.query('INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run(id, id, `${id}@example.test`, now, now);
		db.query('INSERT OR IGNORE INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)').run(org, org, org, now);
		db.query('INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)').run(`m-${id}`, org, id, 'member', now);
	}
	createProject('Alpha', 'alpha', 'org-a');
	createProject('Beta', 'beta', 'org-b');
	writeFileSync(join(PROJECTS_DIR, 'alpha', 'library', 'note.txt'), '0123456789');
	writeFileSync(join(PROJECTS_DIR, 'beta', 'library', 'secret.txt'), 'beta only');
	mkdirSync(join(PROJECTS_DIR, 'alpha', 'ui-auth'), { recursive: true });
	writeFileSync(join(PROJECTS_DIR, 'alpha', 'ui-auth', 'host.json'), '{"cookies":[]}');
});

describe('GET /files/[...path]', () => {
	test('serves a file of an accessible project with hardening headers', async () => {
		const r = await call('projects/alpha/library/note.txt', mine);
		expect(r.status).toBe(200);
		expect(await r.text()).toBe('0123456789');
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('content-security-policy')).toBe(CSP);
	});

	test('answers a Range request with 206 and the same headers', async () => {
		const r = await call('projects/alpha/library/note.txt', mine, { range: 'bytes=2-4' });
		expect(r.status).toBe(206);
		expect(await r.text()).toBe('234');
		expect(r.headers.get('content-range')).toBe('bytes 2-4/10');
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('content-security-policy')).toBe(CSP);
	});

	test('404 for a project the user cannot access (decoded path)', async () => {
		expect(await status('projects/beta/library/secret.txt', mine)).toBe(404);
		expect(await status('projects/alpha/library/note.txt', outsider)).toBe(404);
	});

	test('404 for the studio database, secrets and sessions', async () => {
		for (const p of ['studio.db', 'studio.db-wal', 'projects/alpha/ui-auth/host.json', 'projects/alpha/CLAUDE.md/../../../studio.db']) expect(await status(p, mine)).toBe(404);
	});

	test('404 for a missing file', async () => {
		expect(await status('projects/alpha/library/nope.txt', mine)).toBe(404);
	});

	test('the 404 response carries the hardening headers too', async () => {
		for (const [p, l] of [['projects/alpha/library/nope.txt', mine], ['projects/beta/library/secret.txt', mine], ['studio.db', mine]] as const) {
			const r = await call(p, l);
			expect(r.status).toBe(404);
			expect(r.headers.get('x-content-type-options')).toBe('nosniff');
			expect(r.headers.get('content-security-policy')).toBe(CSP);
		}
	});
});
