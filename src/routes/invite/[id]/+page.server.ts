import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { errMsg } from '$lib/server/forms';
import { getInvitation, invitationValid, joinByInvitation } from '$lib/server/tenancy';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const inv = getInvitation(params.id);
	if (!invitationValid(inv)) return { invitation: null, me: locals.user?.email ?? null, hasAccount: false };
	const hasAccount = !!db.query('SELECT 1 FROM user WHERE lower(email) = lower(?)').get(inv.email);
	return { invitation: { id: inv.id, email: inv.email, role: inv.role, orgName: inv.orgName, inviterName: inv.inviterName }, me: locals.user?.email ?? null, hasAccount };
};

export const actions: Actions = {
	default: async ({ params, locals }) => {
		if (!locals.user) redirect(303, `/login?next=/invite/${params.id}`);
		try {
			await joinByInvitation(locals.user.id, locals.user.email, params.id);
		} catch (e) {
			return fail(400, { error: errMsg(e) });
		}
		redirect(303, '/');
	}
};
