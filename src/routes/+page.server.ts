import { fail, redirect } from '@sveltejs/kit';
import { translate } from '$lib/i18n';
import { visibleProjects } from '$lib/server/access';
import { brandCard } from '$lib/server/brandcard';
import { createProject, listVideos } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	projects: visibleProjects(locals).map((p) => {
		const b = brandCard(p.id);
		return { id: p.id, name: p.name, shared: !p.orgId, videos: listVideos(p.id).length, logoUrl: b.logoUrl, plate: b.plate, colors: Object.values(b.colors).slice(0, 8), tagline: b.tagline };
	})
});

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim();
		if (!name) return fail(400, { error: translate(locals.lang, 'Name required') });
		const orgId = locals.session?.activeOrganizationId;
		if (!orgId) return fail(400, { error: translate(locals.lang, 'No active organization: join or select an organization') });
		let id: string;
		try {
			id = createProject(name, undefined, orgId, locals.lang).id;
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : String(e) });
		}
		redirect(303, `/p/${id}`);
	}
};
