import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { getMigrations } from 'better-auth/db/migration';
import { db } from '$lib/server/db';
import { createLesson, getLesson } from '$lib/server/lessons';
import { createProject } from '$lib/server/store';
import { PATCH } from './+server';

// `$app/server` is a SvelteKit virtual module (auth.ts reads the request event through it).
mock.module('$app/server', () => ({ getRequestEvent: () => ({}) }));

const member = { user: { id: 'u-les', role: 'user' }, session: { activeOrganizationId: 'org-les-a' }, lang: 'en' } as unknown as App.Locals;
const patch = async (body: Record<string, unknown>) => {
	try {
		return (await PATCH({ request: new Request('http://x/api/lessons', { method: 'PATCH', body: JSON.stringify(body) }), locals: member } as unknown as Parameters<typeof PATCH>[0])).status;
	} catch (e) {
		return (e as { status: number }).status;
	}
};

let own: string, other: string;
const fresh = () => createLesson({ scope: 'project', projectId: own, rule: 'keep it short', status: 'active' }).id;
beforeAll(async () => {
	// The real better-auth schema (user, organization, member), migrated the way hooks.server.ts does.
	const { auth } = await import('$lib/server/auth');
	await (await getMigrations(auth.options)).runMigrations();
	const now = new Date().toISOString();
	db.query('INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run('u-les', 'u-les', 'u-les@example.test', now, now);
	for (const org of ['org-les-a', 'org-les-b']) db.query('INSERT OR IGNORE INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)').run(org, org, org, now);
	db.query('INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)').run('m-u-les', 'org-les-a', 'u-les', 'member', now);
	own = createProject('Lessons own', 'lessons-own', 'org-les-a').id;
	other = createProject('Lessons other', 'lessons-other', 'org-les-b').id;
});

describe('PATCH /api/lessons (I1)', () => {
	test('moving a lesson to a project the user cannot open gets a 403, with or without scope', async () => {
		const [a, b] = [fresh(), fresh()];
		expect(await patch({ id: a, projectId: other })).toBe(403);
		expect(await patch({ id: b, scope: 'project', projectId: other })).toBe(403);
		expect([a, b].map((x) => getLesson(x)?.projectId)).toEqual([own, own]);
	});

	test('an edit that keeps the project still works', async () => {
		const lessonId = fresh();
		expect(await patch({ id: lessonId, rule: 'keep it very short' })).toBe(200);
		expect(getLesson(lessonId)?.rule).toBe('keep it very short');
	});

	test('moving a lesson to a project the user can open works', async () => {
		const mine2 = createProject('Lessons own 2', 'lessons-own-2', 'org-les-a').id;
		const lessonId = fresh();
		expect(await patch({ id: lessonId, projectId: mine2 })).toBe(200);
		expect(getLesson(lessonId)?.projectId).toBe(mine2);
	});
});
