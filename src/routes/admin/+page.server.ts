import { fail } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { errMsg, str } from '$lib/server/forms';
import { allOrgs, createOrg } from '$lib/server/tenancy';
import { getProject, listProjects, setProjectOrg } from '$lib/server/store';
import { translate } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

// Studio administration (global "admin" role): users, organizations, projects.
// Access to /admin is filtered in hooks.server.ts.

type U = { id: string; name: string; email: string; role: string | null; banned: number | null; createdAt: number; orgs: string | null };

export const load: PageServerLoad = ({ locals }) => ({
	me: locals.user!.id,
	users: db
		.query(
			`SELECT u.id, u.name, u.email, u.role, u.banned, u.createdAt,
				(SELECT group_concat(o.name || ' (' || m.role || ')', ', ') FROM member m JOIN organization o ON o.id = m.organizationId WHERE m.userId = u.id) AS orgs
			FROM user u ORDER BY u.createdAt`
		)
		.all() as U[],
	orgs: allOrgs(),
	projects: listProjects().map((p) => ({ id: p.id, name: p.name, orgId: p.orgId }))
});

const ORG_ROLES = ['member', 'admin', 'owner'] as const;
const orgRole = (x: string) => (ORG_ROLES.includes(x as never) ? (x as (typeof ORG_ROLES)[number]) : 'member');

async function run(fn: () => Promise<unknown> | unknown, ok: Record<string, unknown> = {}) {
	try {
		await fn();
		return ok;
	} catch (e) {
		return fail(400, { error: errMsg(e) });
	}
}

export const actions: Actions = {
	createUser: async ({ request, locals }) => {
		const f = await request.formData();
		const email = str(f, 'email');
		return run(async () => {
			const password = String(f.get('password') ?? '');
			if (password.length < 10) throw new Error(translate(locals.lang, 'Password: 10 characters minimum'));
			const res = await auth.api.createUser({ body: { name: str(f, 'name'), email, password, role: str(f, 'role') === 'admin' ? 'admin' : 'user' }, headers: request.headers });
			const orgId = str(f, 'orgId');
			if (orgId) await auth.api.addMember({ body: { userId: res.user.id, organizationId: orgId, role: orgRole(str(f, 'orgRole')) } });
		}, { created: email });
	},
	setRole: async ({ request, locals }) => {
		const f = await request.formData();
		const userId = str(f, 'userId');
		if (userId === locals.user!.id) return fail(400, { error: translate(locals.lang, 'You cannot change your own role') });
		return run(() => auth.api.setRole({ body: { userId, role: str(f, 'role') === 'admin' ? 'admin' : 'user' }, headers: request.headers }));
	},
	ban: async ({ request, locals }) => {
		const f = await request.formData();
		const userId = str(f, 'userId');
		if (userId === locals.user!.id) return fail(400, { error: translate(locals.lang, 'You cannot suspend yourself') });
		return run(() => (str(f, 'unban') ? auth.api.unbanUser({ body: { userId }, headers: request.headers }) : auth.api.banUser({ body: { userId }, headers: request.headers })));
	},
	password: async ({ request, locals }) => {
		const f = await request.formData();
		const newPassword = String(f.get('password') ?? '');
		if (newPassword.length < 10) return fail(400, { error: translate(locals.lang, 'Password: 10 characters minimum') });
		return run(() => auth.api.setUserPassword({ body: { userId: str(f, 'userId'), newPassword }, headers: request.headers }), { passwordSet: true });
	},
	removeUser: async ({ request, locals }) => {
		const f = await request.formData();
		const userId = str(f, 'userId');
		if (userId === locals.user!.id) return fail(400, { error: translate(locals.lang, 'You cannot delete your own account') });
		return run(() => auth.api.removeUser({ body: { userId }, headers: request.headers }));
	},
	createOrg: async ({ request, locals }) => {
		const f = await request.formData();
		const name = str(f, 'name');
		if (!name) return fail(400, { error: translate(locals.lang, 'Name required') });
		return run(() => createOrg(name, str(f, 'ownerId')));
	},
	addMember: async ({ request, locals }) => {
		const f = await request.formData();
		const userId = str(f, 'userId');
		const organizationId = str(f, 'orgId');
		if (db.query('SELECT 1 FROM member WHERE userId = ? AND organizationId = ?').get(userId, organizationId)) return fail(400, { error: translate(locals.lang, 'Already a member of this organization') });
		return run(() => auth.api.addMember({ body: { userId, organizationId, role: orgRole(str(f, 'role')) } }));
	},
	moveProject: async ({ request, locals }) => {
		const f = await request.formData();
		const pid = str(f, 'projectId');
		const orgId = str(f, 'orgId');
		if (!getProject(pid) || !db.query('SELECT 1 FROM organization WHERE id = ?').get(orgId)) return fail(400, { error: translate(locals.lang, 'Project or organization not found') });
		setProjectOrg(pid, orgId);
		return {};
	}
};
