import { readJson } from '$lib/server/body';
import { error, json } from '@sveltejs/kit';
import { join } from 'node:path';
import { canAccessProject, renderOf, requireVideo } from '$lib/server/access';
import { engine } from '$lib/server/jobs';
import { routeNote } from '$lib/server/jev';
import { ensureDir, videoDir } from '$lib/server/paths';
import * as S from '$lib/server/store';
import type { Region } from '$lib/types';
import { translate } from '$lib/i18n';
import type { RequestHandler } from './$types';

/**
  * Creates an annotation. On a render: extracts the exact frame at t with the area framed
  * (what the agent will see), then has Jev route the note (heuristic fallback).
 * Body: { videoId, target, body, storyboardVersion?, shotKey?, renderId?, t?, region? }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const b = (await readJson(request)) as Record<string, any>;
	const video = requireVideo(locals, String(b.videoId));
	const body = String(b.body ?? '').trim();
	if (!body) error(400, translate(locals.lang, 'empty annotation'));
	const target = b.target === 'render' ? 'render' : b.target === 'shot' ? 'shot' : 'storyboard';
	const t = typeof b.t === 'number' && Number.isFinite(b.t) ? b.t : null;
	const region: Region | null = b.region && [b.region.x, b.region.y, b.region.w, b.region.h].every((v: unknown) => typeof v === 'number') ? b.region : null;

	let frame: string | null = null;
	const render = b.renderId ? renderOf(video.id, String(b.renderId)) : null;
	if (b.renderId && !render) error(404, translate(locals.lang, 'render not found'));
	if (render && t !== null) {
		const dir = ensureDir(join(videoDir(video.projectId, video.slug), 'notes'));
		frame = join(dir, `${render.shotKey ?? 'video'}-r${render.version}-${Math.round(t * 1000)}-${Date.now().toString(36)}.png`);
		try {
			await engine('qa.mjs', ['--video', render.file, '--frame', String(t), '--out', frame, ...(region ? ['--box', [region.x, region.y, region.w, region.h].join(',')] : [])], 'notes');
		} catch {
			frame = null;
		}
	}

	const shotKey = b.shotKey ? String(b.shotKey) : render?.shotKey ?? null;
	const sb = S.getStoryboard(video.id, b.storyboardVersion ? Number(b.storyboardVersion) : undefined);
	const shot = sb && shotKey ? S.listShots(sb.id).find((s) => s.key === shotKey) : null;
	const context = [
		`Motion design video "${video.title}".`,
		target === 'render' ? `Annotation placed on the animated render of shot ${shotKey}${t !== null ? ` at ${t.toFixed(2)} s` : ''}${region ? ', on a specific region of the frame' : ''}.` : `Annotation placed on the storyboard${shotKey ? `, shot ${shotKey}` : ' (global)'}.`,
		shot ? `Shot intent: ${shot.data.intent}` : ''
	].join(' ');
	const route = await routeNote({ body, context, hasTimestamp: target === 'render' });

	const note = S.createNote({ videoId: video.id, target, storyboardVersion: sb?.version ?? null, shotKey, renderId: render?.id ?? null, t, region, frame, body, route });
	S.setAuthor('notes', note.id, locals.user!.id);
	return json(note);
};

/** A note can only be edited by a member of the tenant of its video. */
function requireNote(locals: App.Locals, id: string) {
	const n = S.getNotes([id])[0];
	const v = n ? S.getVideo(n.videoId) : null;
	if (!v || !canAccessProject(locals, v.projectId)) error(404, translate(locals.lang, 'note not found'));
}

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const b = (await readJson(request)) as { id: string; status: 'open' | 'applied' | 'dismissed' };
	requireNote(locals, b.id);
	S.setNotesStatus([b.id], b.status);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	requireNote(locals, String(url.searchParams.get('id')));
	S.deleteNote(String(url.searchParams.get('id')));
	return json({ ok: true });
};
