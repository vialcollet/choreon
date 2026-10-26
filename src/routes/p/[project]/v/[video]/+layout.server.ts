import { error } from '@sveltejs/kit';
import { translate } from '$lib/i18n';
import { db } from '$lib/server/db';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileUrl, videoDir } from '$lib/server/paths';
import { listTakes, readVoice, voiceMatches, VOICES } from '$lib/server/voice';
import * as S from '$lib/server/store';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ params, url, locals }) => {
	const project = S.getProject(params.project);
	if (!project) error(404, translate(locals.lang, 'Project not found'));
	const video = S.getVideoBySlug(project.id, params.video);
	if (!video) error(404, translate(locals.lang, 'Video not found'));
	const versions = S.listStoryboards(video.id).map((s) => ({ version: s.version, status: s.status, createdAt: s.createdAt }));
	const wanted = Number(url.searchParams.get('sb')) || undefined;
	const storyboard = S.getStoryboard(video.id, wanted) ?? null;
	const shots = storyboard ? S.listShots(storyboard.id) : [];
	const renders = S.listRenders(video.id).map((r) => ({ ...r, qa: { ...r.qa, contactUrl: fileUrl(r.qa.contact), phoneUrl: fileUrl(r.qa.phone) } }));
	const runs = S.listRuns({ videoId: video.id, limit: 60 });
	const vdir = videoDir(project.id, video.slug);
	const track = readVoice(vdir);
	const anim = storyboard ? join(vdir, 'storyboard', `animatic-v${storyboard.version}.mp4`) : null;
	const stamp = (f: string) => `${fileUrl(f)}?v=${Math.round(statSync(f).mtimeMs)}`;
	return {
		project: { id: project.id, name: project.name, eval: project.settings.eval },
		video,
		// Language of the film's content: its own when it is a translated version, otherwise the project's.
		language: video.language ?? project.settings.language ?? 'fr',
		versions,
		storyboard,
		shots,
		notes: S.listNotes(video.id),
		// The recorded voice-over (current = it reads this storyboard's lines) and the animatic of this storyboard.
		voice: track ? { voice: track.voice, url: stamp(track.file), start: track.start, duration: track.duration, lines: track.lines, current: voiceMatches(track, shots), createdAt: track.createdAt } : null,
		// Every take of the current lines, so an earlier one can be chosen again (current = the one the film uses).
		takes: listTakes(vdir, shots).map((k) => ({ tag: k.tag, voice: k.voice, duration: k.duration, createdAt: k.createdAt, url: stamp(k.file), current: k.createdAt === track?.createdAt })),
		animatic: anim && existsSync(anim) ? { url: stamp(anim), createdAt: statSync(anim).mtimeMs } : null,
		voices: VOICES,
		renders,
		evals: S.listEvals(video.id),
		runs,
		cost: (db.query('SELECT COALESCE(SUM(cost_usd), 0) AS c FROM runs WHERE video_id = ?').get(video.id) as { c: number }).c,
		active: runs.filter((r) => r.status === 'running' || r.status === 'queued').map((r) => {
			const last = db.query("SELECT payload FROM events WHERE run_id = ? AND type IN ('text','tool') ORDER BY seq DESC LIMIT 1").get(r.id) as { payload: string } | null;
			const p = last ? (JSON.parse(last.payload) as { text?: string; name?: string; summary?: string }) : null;
			return { id: r.id, kind: r.kind, shotKey: (r.input.shotKey as string) ?? null, title: r.title, status: r.status, last: p ? (p.text ?? `${p.name} ${p.summary ?? ''}`).slice(0, 220) : null };
		})
	};
};
