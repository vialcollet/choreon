import { error, fail } from '@sveltejs/kit';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { translate } from '$lib/i18n';
import { refOf, videoOf } from '$lib/server/access';
import { enqueue } from '$lib/server/jobs';
import { ensureDir, projectDir, slugify } from '$lib/server/paths';
import { deleteRef, listRefs, setVideoRef, updateRef, upsertRef } from '$lib/server/refs';
import * as S from '$lib/server/store';
import { WS_CATEGORIES, wsIndex, wsSearch } from '$lib/server/whatships';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const project = S.getProject(params.project);
	if (!project) error(404, translate(locals.lang, 'Project not found'));
	const q = url.searchParams.get('q') ?? '';
	const cat = url.searchParams.get('cat') ?? '';
	let results: Awaited<ReturnType<typeof wsSearch>> = [];
	let wsError = '';
	if (q || cat) {
		try {
			results = await wsSearch(q, cat || undefined, 48);
		} catch (e) {
			wsError = String(e);
		}
	}
	const videos = S.listVideos(project.id).map((v) => ({ id: v.id, title: v.title }));
	const links = db.query('SELECT video_id, ref_id FROM video_refs').all() as { video_id: string; ref_id: string }[];
	const refs = listRefs(project.id).map((r) => ({ ...r, videos: links.filter((l) => l.ref_id === r.id).map((l) => l.video_id) }));
	const runs = S.listRuns({ projectId: project.id, limit: 30 }).filter((r) => r.kind.startsWith('reference'));
	let total = 0;
	try {
		total = (await wsIndex()).length;
	} catch {}
	return { project: { id: project.id, name: project.name }, q, cat, results, wsError, categories: WS_CATEGORIES, total, refs, videos, runs, added: new Set(refs.map((r) => r.slug)).size ? refs.map((r) => r.slug) : [] };
};

export const actions: Actions = {
	add: async ({ request, params, locals }) => {
		const f = await request.formData();
		const slug = String(f.get('slug'));
		const item = (await wsIndex()).find((x) => x.slug === slug);
		if (!item) return fail(404, { error: translate(locals.lang, 'Video not found') });
		const ref = upsertRef({ projectId: params.project, source: 'whatships', slug, title: item.name, company: item.company, category: item.category, pageUrl: item.href, xUrl: null, videoUrl: null, poster: item.poster, duration: null, relevance: { why: 'Added manually' } });
		if (f.get('analyze')) enqueue('reference_analyze', { projectId: params.project, lane: 'refs', refId: ref.id, title: `Reference — ${item.name.slice(0, 40)}` });
	},
	analyze: async ({ request, params }) => {
		const rid = String((await request.formData()).get('id'));
		const ref = refOf(params.project, rid);
		if (ref) enqueue('reference_analyze', { projectId: params.project, lane: 'refs', refId: rid, title: `Reference — ${ref.title.slice(0, 40)}` });
	},
	scout: async ({ request, params }) => {
		const f = await request.formData();
		enqueue('reference_scout', { projectId: params.project, lane: 'refs', count: Number(f.get('count') ?? 6), brief: String(f.get('brief') ?? '') });
	},
	reject: async ({ request, params }) => {
		const rid = String((await request.formData()).get('id'));
		const r = refOf(params.project, rid);
		if (r) updateRef(rid, { status: r.status === 'rejected' ? (r.styleGuide ? 'analyzed' : 'candidate') : 'rejected' });
	},
	remove: async ({ request, params }) => {
		const ref = refOf(params.project, String((await request.formData()).get('id')));
		if (ref) deleteRef(ref.id);
	},
	attach: async ({ request, params }) => {
		const f = await request.formData();
		const ref = refOf(params.project, String(f.get('id')));
		const video = videoOf(params.project, String(f.get('video')));
		if (ref && video) setVideoRef(video.id, ref.id, f.get('on') === '1');
	},
	upload: async ({ request, params, locals }) => {
		const f = await request.formData();
		const file = f.get('file');
		if (!(file instanceof File) || !file.size) return fail(400, { error: translate(locals.lang, 'No file') });
		const title = String(f.get('title') || file.name.replace(/\.[^.]+$/, ''));
		const slug = `up-${slugify(title)}-${Date.now().toString(36)}`;
		const dir = ensureDir(join(projectDir(params.project), 'references', slug));
		// ffmpeg detects the container, whatever the upload's extension.
		writeFileSync(join(dir, 'source.mp4'), Buffer.from(await file.arrayBuffer()));
		const ref = upsertRef({ projectId: params.project, source: 'upload', slug, title, company: String(f.get('company') ?? ''), category: 'Import', pageUrl: null, xUrl: null, videoUrl: null, poster: null, duration: null, relevance: { why: 'Imported' } });
		enqueue('reference_analyze', { projectId: params.project, lane: 'refs', refId: ref.id, title: `Reference — ${title.slice(0, 40)}` });
	}
};
