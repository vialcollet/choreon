import { error, fail, redirect } from '@sveltejs/kit';
import { isOrgAdmin, orgRole } from '$lib/server/access';
import { auth } from '$lib/server/auth';
import { errMsg, safeNext, str } from '$lib/server/forms';
import { getOrg, orgPeople } from '$lib/server/tenancy';
import { listProjects } from '$lib/server/store';
import { translate } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

// Active organization: members, roles, invitations (links to share, no mail).

const ROLES = ['member', 'admin', 'owner'] as const;
type R = (typeof ROLES)[number];
const role = (x: string): R => (ROLES.includes(x as R) ? (x as R) : 'member');

export const load: PageServerLoad = ({ locals, url }) => {
	const orgId = locals.session?.activeOrganizationId;
	const org = orgId ? getOrg(orgId) : null;
	if (!org) return { org: null, people: null, projects: [], myRole: null, canManage: false, origin: url.origin };
	return { org, people: orgPeople(org.id), projects: listProjects(org.id).map((p) => ({ id: p.id, name: p.name })), myRole: orgRole(locals, org.id), canManage: isOrgAdmin(locals), origin: url.origin };
};

/** Management actions: reserved for the tenant's owners/admins (or the studio admin). */
function manager(locals: App.Locals) {
	const orgId = locals.session?.activeOrganizationId;
	if (!orgId || !isOrgAdmin(locals)) error(403, translate(locals.lang, 'reserved for organization administrators'));
	return orgId;
}

async function run(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (e) {
		return fail(400, { error: errMsg(e) });
	}
}

export const actions: Actions = {
	switch: async ({ request }) => {
		const f = await request.formData();
		const r = await run(() => auth.api.setActiveOrganization({ body: { organizationId: str(f, 'orgId') }, headers: request.headers }));
		if (r) return r;
		redirect(303, safeNext(str(f, 'next')) === '/org' ? '/org' : '/');
	},
	invite: async ({ request, locals }) => {
		const organizationId = manager(locals);
		const f = await request.formData();
		const email = str(f, 'email');
		const r = await run(() => auth.api.createInvitation({ body: { email, role: role(str(f, 'role')), organizationId, resend: true }, headers: request.headers }));
		return r ?? { invited: email };
	},
	cancel: async ({ request, locals }) => {
		manager(locals);
		const f = await request.formData();
		return run(() => auth.api.cancelInvitation({ body: { invitationId: str(f, 'id') }, headers: request.headers }));
	},
	role: async ({ request, locals }) => {
		const organizationId = manager(locals);
		const f = await request.formData();
		return run(() => auth.api.updateMemberRole({ body: { memberId: str(f, 'memberId'), role: role(str(f, 'role')), organizationId }, headers: request.headers }));
	},
	remove: async ({ request, locals }) => {
		const organizationId = manager(locals);
		const f = await request.formData();
		return run(() => auth.api.removeMember({ body: { memberIdOrEmail: str(f, 'memberId'), organizationId }, headers: request.headers }));
	},
	rename: async ({ request, locals }) => {
		const organizationId = manager(locals);
		const f = await request.formData();
		const name = str(f, 'name');
		if (!name) return fail(400, { error: translate(locals.lang, 'Name required') });
		return run(() => auth.api.updateOrganization({ body: { data: { name }, organizationId }, headers: request.headers }));
	},
	leave: async ({ request, locals }) => {
		const organizationId = locals.session?.activeOrganizationId;
		if (!organizationId) return fail(400, { error: translate(locals.lang, 'No active organization') });
		const r = await run(() => auth.api.leaveOrganization({ body: { organizationId }, headers: request.headers }));
		if (r) return r;
		redirect(303, '/');
	}
};
