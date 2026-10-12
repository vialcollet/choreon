import { db } from './db';
import { visibleProjects } from './access';
import * as S from './store';

/** What the UI needs to announce a run: title, place (project, video, shot), timing, cost, outcome. */
export function runBrief(r: S.Run) {
	const v = r.videoId ? S.getVideo(r.videoId) : null;
	const out = (r.output ?? {}) as { pass?: boolean };
	return {
		id: r.id,
		kind: r.kind,
		title: r.title,
		status: r.status,
		projectId: r.projectId,
		videoSlug: v?.slug ?? null,
		videoTitle: v?.title ?? null,
		shotKey: typeof r.input.shotKey === 'string' ? r.input.shotKey : null,
		parentId: r.parentId,
		lane: typeof r.input.lane === 'string' ? r.input.lane : null,
		costUsd: r.costUsd,
		startedAt: r.startedAt,
		finishedAt: r.finishedAt,
		error: r.error,
		pass: typeof out.pass === 'boolean' ? out.pass : null
	};
}
export type RunBrief = ReturnType<typeof runBrief>;

/** Queued and running runs of the projects visible to this user, oldest first. */
export function activeRuns(locals: App.Locals): RunBrief[] {
	const ids = visibleProjects(locals).map((p) => p.id);
	if (!ids.length) return [];
	const rows = db.query(`SELECT id FROM runs WHERE status IN ('queued', 'running') AND project_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`).all(...ids) as { id: string }[];
	return rows.map((x) => S.getRun(x.id)).filter((r): r is S.Run => !!r).map(runBrief);
}
