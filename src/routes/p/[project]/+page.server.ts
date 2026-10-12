import { error, fail, redirect } from '@sveltejs/kit';
import { translate } from '$lib/i18n';
import { FORMATS } from '$lib/server/defaults';
import { enqueue } from '$lib/server/jobs';
import * as S from '$lib/server/store';
import { brandCard } from '$lib/server/brandcard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const project = S.getProject(params.project);
	if (!project) error(404, translate(locals.lang, 'Project not found'));
	return {
		project: { id: project.id, name: project.name },
		brand: brandCard(project.id),
		videos: S.listVideos(project.id).map((v) => {
			const sb = S.getStoryboard(v.id);
			const full = S.listRenders(v.id, null)[0];
			return { ...v, storyboardVersion: sb?.version ?? null, shots: sb ? S.listShots(sb.id).length : 0, renders: S.listRenders(v.id).length, fullUrl: full?.url ?? null };
		}),
		runs: S.listRuns({ projectId: project.id, limit: 8 }),
		formats: Object.keys(FORMATS)
	};
};

export const actions: Actions = {
	video: async ({ request, params, locals }) => {
		const f = await request.formData();
		const title = String(f.get('title') ?? '').trim();
		if (!title) return fail(400, { error: translate(locals.lang, 'Title required') });
		const fmt = FORMATS[String(f.get('format') ?? '16:9') as keyof typeof FORMATS] ?? FORMATS['16:9'];
		const v = S.createVideo(params.project, {
			title,
			brief: String(f.get('brief') ?? ''),
			format: { ...fmt, fps: Number(f.get('fps') ?? 30) || 30 },
			targetDuration: Number(f.get('duration') ?? 30) || 30
		});
		// No storyboard without framing: the interview starts at creation.
		S.setBriefState(v.id, { ...v.briefState, status: 'reviewing' });
		enqueue('brief_review', { projectId: params.project, videoId: v.id });
		redirect(303, `/p/${params.project}/v/${v.slug}`);
	}
};
