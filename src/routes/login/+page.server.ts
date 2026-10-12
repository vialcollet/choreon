import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { errMsg, safeNext, str } from '$lib/server/forms';
import { userCount } from '$lib/server/tenancy';
import { translate } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
	if (userCount() === 0) redirect(303, '/signup');
	return {};
};

export const actions: Actions = {
	default: async ({ request, url, locals }) => {
		const f = await request.formData();
		const email = str(f, 'email');
		try {
			await auth.api.signInEmail({ body: { email, password: str(f, 'password') }, headers: request.headers });
		} catch (e) {
			const m = errMsg(e);
			return fail(400, { email, error: /invalid/i.test(m) ? translate(locals.lang, 'Incorrect email or password') : /banned/i.test(m) ? translate(locals.lang, 'Account suspended') : m });
		}
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
