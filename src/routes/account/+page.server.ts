import { fail } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { errMsg, str } from '$lib/server/forms';
import { translate } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({ me: { name: locals.user!.name, email: locals.user!.email } });

export const actions: Actions = {
	name: async ({ request, locals }) => {
		const name = str(await request.formData(), 'name');
		if (!name) return fail(400, { error: translate(locals.lang, 'Name required') });
		try {
			await auth.api.updateUser({ body: { name }, headers: request.headers });
		} catch (e) {
			return fail(400, { error: errMsg(e) });
		}
		return { saved: 'name' };
	},
	password: async ({ request, locals }) => {
		const f = await request.formData();
		const newPassword = String(f.get('new') ?? '');
		if (newPassword.length < 10) return fail(400, { error: translate(locals.lang, 'New password: 10 characters minimum') });
		if (newPassword !== String(f.get('confirm') ?? '')) return fail(400, { error: translate(locals.lang, 'The two entries differ') });
		try {
			await auth.api.changePassword({ body: { currentPassword: String(f.get('current') ?? ''), newPassword, revokeOtherSessions: true }, headers: request.headers });
		} catch (e) {
			const m = errMsg(e);
			return fail(400, { error: /invalid password/i.test(m) ? translate(locals.lang, 'Current password is incorrect') : m });
		}
		return { saved: 'password' };
	}
};
