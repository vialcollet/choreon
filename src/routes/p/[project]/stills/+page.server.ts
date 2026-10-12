import { error, fail, redirect } from '@sveltejs/kit';
import { translate } from '$lib/i18n';
import * as S from '$lib/server/store';
import { createLot, FORMATS, getTemplate, listLots, listTemplates } from '$lib/server/stills';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const project = S.getProject(params.project);
	if (!project) error(404, translate(locals.lang, 'Project not found'));
	return {
		project: { id: project.id, name: project.name },
		templates: listTemplates(project.id).map((t) => ({ slug: t.slug, name: t.name, description: t.description, formats: t.formats })),
		lots: listLots(project.id),
		formats: FORMATS
	};
};

export const actions: Actions = {
	create: async ({ request, params, locals }) => {
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim();
		const template = String(f.get('template') ?? '');
		const formats = f.getAll('formats').map(String);
		if (!name) return fail(400, { error: translate(locals.lang, 'Give the batch a name.') });
		if (!getTemplate(params.project, template)) return fail(400, { error: translate(locals.lang, 'Choose a template.') });
		if (!formats.length) return fail(400, { error: translate(locals.lang, 'Choose at least one format.') });
		let slug: string;
		try {
			slug = createLot(params.project, name, template, formats);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : String(e) });
		}
		redirect(303, `/p/${params.project}/stills/${slug}`);
	}
};
