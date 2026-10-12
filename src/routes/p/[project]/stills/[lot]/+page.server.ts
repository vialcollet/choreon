import { error, fail } from '@sveltejs/kit';
import { translate } from '$lib/i18n';
import * as S from '$lib/server/store';
import { getLot, getTemplate, lotRenders, saveLot, type LotItem } from '$lib/server/stills';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const project = S.getProject(params.project);
	if (!project) error(404, translate(locals.lang, 'Project not found'));
	const lot = getLot(project.id, params.lot);
	if (!lot) error(404, translate(locals.lang, 'Batch not found'));
	const template = getTemplate(project.id, lot.template);
	return {
		project: { id: project.id, name: project.name },
		lot,
		template,
		renders: lotRenders(project.id, lot),
		runs: S.listRuns({ projectId: project.id, limit: 40 }).filter((r) => r.kind === 'stills_render' && r.input?.lot === lot.slug).slice(0, 8)
	};
};

export const actions: Actions = {
	/** Saves the whole batch (name, formats, items) sent as JSON by the editor. */
	save: async ({ request, params, locals }) => {
		const f = await request.formData();
		const current = getLot(params.project, params.lot);
		if (!current) error(404, translate(locals.lang, 'Batch not found'));
		let body: { name?: string; formats?: string[]; items?: LotItem[] };
		try {
			body = JSON.parse(String(f.get('lot') ?? '{}'));
		} catch {
			return fail(400, { error: translate(locals.lang, 'Unreadable batch.') });
		}
		const err = saveLot(params.project, {
			...current,
			name: String(body.name ?? current.name).trim() || current.name,
			formats: Array.isArray(body.formats) ? body.formats.map(String) : current.formats,
			items: Array.isArray(body.items) ? body.items.map((i) => ({ id: String(i.id ?? '').trim(), vars: i.vars ?? {} })) : current.items
		});
		if (err) return fail(400, { error: err });
		return { saved: Date.now() };
	}
};
