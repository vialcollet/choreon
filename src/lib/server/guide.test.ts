import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { getMigrations } from 'better-auth/db/migration';
import { db } from './db';
import { createProject, createVideo } from './store';

// `$app/server` is a SvelteKit virtual module (auth.ts reads the request event through it).
mock.module('$app/server', () => ({ getRequestEvent: () => ({}) }));
const { pageContext } = await import('./guide');

const member = { user: { id: 'u-gd', role: 'user' }, session: { activeOrganizationId: 'org-gd-a' }, lang: 'en' } as unknown as App.Locals;
const admin = { user: { id: 'u-gd-admin', role: 'admin' }, session: { activeOrganizationId: null }, lang: 'en' } as unknown as App.Locals;

beforeAll(async () => {
	// The real better-auth schema (user, organization, member), migrated the way hooks.server.ts does.
	const { auth } = await import('./auth');
	await (await getMigrations(auth.options)).runMigrations();
	const now = new Date().toISOString();
	db.query('INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run('u-gd', 'u-gd', 'u-gd@example.test', now, now);
	for (const org of ['org-gd-a', 'org-gd-b']) db.query('INSERT OR IGNORE INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)').run(org, org, org, now);
	db.query('INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)').run('m-u-gd', 'org-gd-a', 'u-gd', 'member', now);
	createProject('Guide Mine', 'guide-mine', 'org-gd-a');
	const secret = createProject('Guide Secret Name', 'guide-secret', 'org-gd-b');
	createVideo(secret.id, { title: 'Secret Video Title', brief: '', format: { width: 1920, height: 1080, fps: 30 }, targetDuration: 20 });
});

describe('pageContext (I1)', () => {
	test('names the project the user can open', () => {
		expect(pageContext(member, '/p/guide-mine')).toContain('project "Guide Mine" (projectId guide-mine)');
	});

	test('gives no project information for a project the user cannot open', () => {
		for (const url of ['/p/guide-secret', '/p/guide-secret/v/secret-video-title', '/p/guide%2Dsecret']) {
			const ctx = pageContext(member, url);
			expect(ctx).not.toContain('Guide Secret Name');
			expect(ctx).not.toContain('Secret Video Title');
			expect(ctx).not.toContain('projectId');
		}
	});

	test('the studio admin sees any project', () => {
		expect(pageContext(admin, '/p/guide-secret')).toContain('project "Guide Secret Name"');
	});
});
