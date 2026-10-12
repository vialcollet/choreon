import { readJson } from '$lib/server/body';
import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { enqueue, harvestUrls, type JobKind } from '$lib/server/jobs';
import { isStudioAdmin, requireProject, requireVideo } from '$lib/server/access';
import { isStudioOrigin, studioPort } from '$lib/server/service-auth';
import * as S from '$lib/server/store';
import { translate } from '$lib/i18n';
import type { RequestHandler } from './$types';

const KINDS: JobKind[] = ['storyboard_generate', 'storyboard_revise', 'shot_build', 'shot_fix', 'render', 'eval', 'assemble', 'asset_generate', 'sound_design', 'resolve_export', 'lesson_distill', 'reference_analyze', 'reference_scout', 'brief_review', 'stills_render', 'ui_harvest', 'ui_login', 'voice_generate', 'animatic'];

/** Starts a task. Body: { kind, projectId, videoId?, shotKey?, noteIds?, prompt?, name?, renderId?, auto? } */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const b = (await readJson(request)) as Record<string, any>;
	if (!KINDS.includes(b.kind)) error(400, translate(locals.lang, 'unknown task'));
	requireProject(locals, String(b.projectId));
	if (b.videoId && requireVideo(locals, String(b.videoId)).projectId !== String(b.projectId)) error(404, translate(locals.lang, 'video not found'));
	// Only an admin harvests the studio itself (it is the only one signed in with the service token, see uiHarvest).
	if (b.kind === 'ui_harvest' && !isStudioAdmin(locals)) {
		const origins = [url.origin, env.ORIGIN, env.BETTER_AUTH_URL].filter((o): o is string => !!o);
		if (harvestUrls(b).some((u) => isStudioOrigin(u, { port: studioPort(), origins }))) error(403, translate(locals.lang, 'Only studio administrators can harvest the studio itself'));
	}
	// A signed-in browser session opens a window on the studio's machine and is then reused by harvests: an operator action.
	if (b.kind === 'ui_login' && !isStudioAdmin(locals)) error(403, translate(locals.lang, 'Only studio administrators can save a browser session'));
	// Titles stored in English, translated at display time (translateTitle).
	const title =
		b.kind === 'shot_build' ? `Shot ${b.shotKey} — build`
		: b.kind === 'shot_fix' ? (b.title ? String(b.title) : `Shot ${b.shotKey} — fix (${(b.noteIds ?? []).length} note(s))`)
		: b.kind === 'render' ? `Render · ${b.shotKey}`
		: b.kind === 'eval' ? `Evaluation · ${b.shotKey ?? 'video'}`
		: b.kind === 'stills_render' ? `Stills · ${b.lot}`
		: b.kind === 'storyboard_revise' ? `Storyboard — revision (${(b.noteIds ?? []).length} note(s))`
		: undefined;
	// byAdmin is decided here, never by the body; harvests and sign-ins of a project always share the ui queue so they run one after the other (D-21).
	const lane = b.kind === 'ui_harvest' || b.kind === 'ui_login' ? { lane: 'ui' } : {};
	const run = enqueue(b.kind, { ...b, ...lane, byAdmin: isStudioAdmin(locals), projectId: String(b.projectId), videoId: b.videoId ?? null, round: 0, ...(title ? { title } : {}) });
	S.setAuthor('runs', run.id, locals.user!.id);
	return json(run);
};
