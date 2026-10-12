import { fail } from '@sveltejs/kit';
import { existsSync, rmSync } from 'node:fs';
import { translate } from '$lib/i18n';
import * as S from '$lib/server/store';
import { hasAuth, kitDir, listKits } from '$lib/server/uikit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const kits = listKits(params.project);
	return {
		kits,
		auth: Object.fromEntries(kits.map((k) => [k.slug, hasAuth(params.project, k.url)])),
		runs: S.listRuns({ projectId: params.project, limit: 30 }).filter((r) => r.kind === 'ui_harvest' || r.kind === 'ui_login').slice(0, 6)
	};
};

export const actions: Actions = {
	remove: async ({ request, params, locals }) => {
		const slug = String((await request.formData()).get('kit') ?? '');
		const dir = kitDir(params.project, slug);
		if (!slug || !existsSync(dir)) return fail(404, { error: translate(locals.lang, 'Kit not found') });
		rmSync(dir, { recursive: true, force: true });
		return { removed: slug };
	}
};
