import { error, fail } from '@sveltejs/kit';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { translate } from '$lib/i18n';
import { projectDir } from '$lib/server/paths';
import { studioSettings } from '$lib/server/lessons';
import * as S from '$lib/server/store';
import type { EvalConfig, ModelChoice, Role } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const project = S.getProject(params.project);
	if (!project) error(404, translate(locals.lang, 'Project not found'));
	const brand = S.readBrand(project.id);
	const legacy: Partial<Record<Role, ModelChoice>> = {};
	if (project.settings.eval.builder) legacy.animator = legacy.director = project.settings.eval.builder;
	if (project.settings.eval.critic) legacy.critic = project.settings.eval.critic;
	return { project: { id: project.id, name: project.name }, evalConfig: project.settings.eval, models: project.settings.models ?? legacy, studioModels: studioSettings().models, motion: brand.motion, brandJson: JSON.stringify(brand.json, null, 1), language: (project.settings.language === 'en' ? 'en' : 'fr') as 'en' | 'fr' };
};

export const actions: Actions = {
	eval: async ({ request, params, locals }) => {
		const project = S.getProject(params.project);
		if (!project) return fail(404);
		const raw = String((await request.formData()).get('config') ?? '');
		let cfg: EvalConfig;
		try {
			cfg = JSON.parse(raw);
		} catch {
			return fail(400, { error: translate(locals.lang, 'Unreadable configuration') });
		}
		if (!Array.isArray(cfg.axes) || !cfg.axes.length) return fail(400, { error: translate(locals.lang, 'At least one axis') });
		cfg.axes = cfg.axes.map((a) => ({ ...a, key: String(a.key).trim() || 'axe', weight: Number(a.weight) || 1, threshold: Math.max(1, Math.min(10, Number(a.threshold) || 7)), required: !!a.required }));
		cfg.maxRounds = Math.max(1, Math.min(8, Number(cfg.maxRounds) || 3));
		S.saveProjectSettings(project.id, { ...project.settings, eval: cfg });
		return { saved: 'eval' };
	},
	models: async ({ request, params, locals }) => {
		const project = S.getProject(params.project);
		if (!project) return fail(404);
		let models: Partial<Record<Role, ModelChoice>>;
		try {
			models = JSON.parse(String((await request.formData()).get('models') ?? '{}'));
		} catch {
			return fail(400, { error: translate(locals.lang, 'Unreadable models') });
		}
		const { critic: _c, builder: _b, ...evalRest } = project.settings.eval;
		S.saveProjectSettings(project.id, { ...project.settings, eval: evalRest as EvalConfig, models });
		return { saved: 'models' };
	},
	language: async ({ request, params }) => {
		const project = S.getProject(params.project);
		if (!project) return fail(404);
		const language = String((await request.formData()).get('language')) === 'en' ? 'en' : 'fr';
		S.saveProjectSettings(project.id, { ...project.settings, language });
		return { saved: 'language' };
	},
	motion: async ({ request, params }) => {
		const text = String((await request.formData()).get('motion') ?? '');
		writeFileSync(join(projectDir(params.project), 'brand', 'motion.md'), text);
		S.syncWorkspace(params.project);
		return { saved: 'motion' };
	}
};
