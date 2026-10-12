import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { errMsg, str } from '$lib/server/forms';
import { bootstrapFirstUser, getInvitation, invitationValid, joinByInvitation, userCount } from '$lib/server/tenancy';
import { translate } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

// Signup: the studio's first account (admin + first organization), or an invited account.

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, '/');
	const first = userCount() === 0;
	const inv = getInvitation(url.searchParams.get('invitation') ?? '');
	return {
		first,
		invitation: invitationValid(inv) ? { id: inv.id, email: inv.email, orgName: inv.orgName, role: inv.role } : null,
		closed: !first && !invitationValid(inv)
	};
};

export const actions: Actions = {
	default: async ({ request, url, locals }) => {
		const f = await request.formData();
		const name = str(f, 'name');
		const email = str(f, 'email');
		const password = String(f.get('password') ?? '');
		const first = userCount() === 0;
		const inv = getInvitation(url.searchParams.get('invitation') ?? '');
		if (!first && !invitationValid(inv)) return fail(403, { name, email, error: translate(locals.lang, 'Sign-up by invitation only') });
		if (inv && !first && inv.email.toLowerCase() !== email.toLowerCase()) return fail(400, { name, email, error: translate(locals.lang, 'This invitation is for {email}', { email: inv.email }) });
		if (password.length < 10) return fail(400, { name, email, error: translate(locals.lang, 'Password: 10 characters minimum') });
		try {
			const res = await auth.api.signUpEmail({ body: { name, email, password }, headers: request.headers });
			if (first) await bootstrapFirstUser(res.user.id, str(f, 'org') || 'Mon studio');
			else if (inv) await joinByInvitation(res.user.id, email, inv.id);
		} catch (e) {
			return fail(400, { name, email, error: errMsg(e) });
		}
		redirect(303, '/');
	}
};
