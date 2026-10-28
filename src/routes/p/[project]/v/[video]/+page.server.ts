import { translate } from '$lib/i18n';
import { briefAxes, forgetInferred, settle } from '$lib/server/brief';
import { enqueue } from '$lib/server/jobs';
import { fileUrl } from '$lib/server/paths';
import { getRef, videoRefIds, type Ref } from '$lib/server/refs';
import * as S from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const v = S.getVideoBySlug(params.project, params.video);
	// References attached to the video, shown on the "References" axis of the framing.
	const refs = v
		? videoRefIds(v.id)
				.map(getRef)
				.filter((r): r is Ref => !!r)
				.map((r) => ({ id: r.id, title: r.title, company: r.company, poster: (r.analysis.keys?.length ? fileUrl(r.analysis.keys[Math.floor(r.analysis.keys.length / 3)].file) : null) ?? r.poster, analyzed: !!r.styleGuide, borrow: r.relevance.borrow ?? '' }))
		: [];
	const scouting = v ? S.listRuns({ projectId: v.projectId, limit: 20 }).some((r) => r.kind === 'reference_scout' && r.input.forVideo === v.id && (r.status === 'queued' || r.status === 'running')) : false;
	return { briefAxes: briefAxes(), videoRefs: refs, scouting };
};

/** Restarts the framing interview (the director checks brief + answers against the axes). */
function review(v: S.Video) {
	S.setBriefState(v.id, { ...v.briefState, status: 'reviewing' });
	enqueue('brief_review', { projectId: v.projectId, videoId: v.id });
}

export const actions: Actions = {
	brief: async ({ request, params }) => {
		const f = await request.formData();
		const v = S.getVideoBySlug(params.project, params.video);
		if (!v) return;
		const brief = String(f.get('brief') ?? '');
		S.updateVideo(v.id, { brief, targetDuration: Number(f.get('duration')) || v.targetDuration });
		if (brief !== v.brief) {
			S.setBriefState(v.id, forgetInferred(v.briefState));
			review(S.getVideo(v.id)!);
		}
	},
	/**
	  * Interview answers, per axis: t_<axis> (free text, takes priority), o_<axis> (option),
	  * d_<axis> = "your call" (director's proposal), i_<axis> = axis ignored.
	 */
	answers: async ({ request, params }) => {
		const f = await request.formData();
		const v = S.getVideoBySlug(params.project, params.video);
		if (!v) return;
		const decisions = { ...v.briefState.decisions };
		const ignored = [...v.briefState.ignored];
		for (const q of v.briefState.questions) {
			const text = String(f.get(`t_${q.field}`) || f.get(`o_${q.field}`) || '').trim();
			if (f.get(`i_${q.field}`)) ignored.includes(q.field) || ignored.push(q.field);
			else if (f.get(`d_${q.field}`) && q.default) decisions[q.field] = q.default;
			else if (text) decisions[q.field] = text;
		}
		const next = settle({ ...v.briefState, decisions, ignored, status: 'interview' });
		S.setBriefState(v.id, next);
		// Everything is settled: no need to question the director again.
		if (next.status !== 'ready') review(S.getVideo(v.id)!);
	},
	/** Direct edit of an axis: value (empty = reopen), ignore=1 (drop). */
	decision: async ({ request, params }) => {
		const f = await request.formData();
		const v = S.getVideoBySlug(params.project, params.video);
		const field = String(f.get('field') ?? '');
		if (!v || !briefAxes().some((a) => a.key === field)) return;
		const value = String(f.get('value') ?? '').trim();
		const decisions = { ...v.briefState.decisions };
		let ignored = v.briefState.ignored.filter((k) => k !== field);
		delete decisions[field];
		if (f.get('ignore')) ignored = [...ignored, field];
		else if (value) decisions[field] = value;
		const status = v.briefState.status === 'ready' ? 'interview' : v.briefState.status;
		// An axis the user edits or reopens is theirs from now on, no longer the director's inference.
		const inferred = (v.briefState.inferred ?? []).filter((k) => k !== field);
		S.setBriefState(v.id, settle({ ...v.briefState, decisions, inferred, ignored, status }));
	},
	/** Reference preselection for this video (brief + decisions), attached automatically. */
	scout: async ({ params, locals }) => {
		const v = S.getVideoBySlug(params.project, params.video);
		if (v) enqueue('reference_scout', { projectId: v.projectId, lane: 'refs', forVideo: v.id, count: 4, title: `References — shortlist · ${v.title}` });
	},
	review: async ({ params }) => {
		const v = S.getVideoBySlug(params.project, params.video);
		if (v) review(v);
	},
	approve: async ({ request, params }) => {
		const f = await request.formData();
		const v = S.getVideoBySlug(params.project, params.video);
		const sb = v ? S.getStoryboard(v.id, Number(f.get('version'))) : null;
		if (sb) S.setStoryboardStatus(sb.id, sb.status === 'approved' ? 'draft' : 'approved');
	}
};
