import { db, id, json, now } from './db';
import { fileUrl, fromStored, mapPaths, toStored } from './paths';

// Project references: videos whose grammar we want to borrow (rhythm, transitions,
// kinetic typography), never the content. An analyzed reference carries a style guide;
// attached to a video, it feeds its storyboard and shots.

export type RefStatus = 'candidate' | 'analyzing' | 'analyzed' | 'rejected';

export interface Ref {
	id: string;
	projectId: string;
	source: 'whatships' | 'upload';
	slug: string;
	title: string;
	company: string;
	category: string;
	pageUrl: string | null;
	xUrl: string | null;
	videoUrl: string | null;
	poster: string | null;
	duration: number | null;
	status: RefStatus;
	relevance: { score?: number; why?: string; borrow?: string };
	analysis: {
		file?: string;
		fileUrl?: string | null;
		stats?: Record<string, number>;
		palette?: string[];
		sheets?: { file: string; url?: string | null; from: number; to: number }[];
		keys?: { file: string; url?: string | null; t: number }[];
		cuts?: number[];
		motion?: { summary?: Record<string, any>; moves?: any[]; chart?: string | null; chartUrl?: string | null; strips?: { file: string; url?: string | null; move: number; easing: string; overshoot: boolean }[] };
	};
	styleGuide: string;
	createdAt: number;
}

type Row = Record<string, any>;
const toRef = (r: Row): Ref => {
	const analysis = mapPaths(json<Ref['analysis']>(r.analysis, {}), fromStored);
	return {
		id: r.id, projectId: r.project_id, source: r.source, slug: r.slug, title: r.title, company: r.company, category: r.category,
		pageUrl: r.page_url, xUrl: r.x_url, videoUrl: r.video_url, poster: r.poster, duration: r.duration, status: r.status,
		relevance: json(r.relevance, {}),
		analysis: {
			...analysis,
			fileUrl: fileUrl(analysis.file),
			sheets: analysis.sheets?.map((s) => ({ ...s, url: fileUrl(s.file) })),
			keys: analysis.keys?.map((k) => ({ ...k, url: fileUrl(k.file) })),
			motion: analysis.motion ? { ...analysis.motion, chartUrl: fileUrl(analysis.motion.chart), strips: analysis.motion.strips?.map((x) => ({ ...x, url: fileUrl(x.file) })) } : undefined
		},
		styleGuide: r.style_guide, createdAt: r.created_at
	};
};

export const listRefs = (pid: string) => (db.query('SELECT * FROM refs WHERE project_id = ? ORDER BY created_at DESC').all(pid) as Row[]).map(toRef);
export const getRef = (rid: string) => {
	const r = db.query('SELECT * FROM refs WHERE id = ?').get(rid) as Row | null;
	return r ? toRef(r) : null;
};

export function upsertRef(r: Omit<Ref, 'id' | 'createdAt' | 'status' | 'analysis' | 'styleGuide'> & { status?: RefStatus }): Ref {
	const existing = db.query('SELECT id FROM refs WHERE project_id = ? AND source = ? AND slug = ?').get(r.projectId, r.source, r.slug) as { id: string } | null;
	if (existing) {
		db.query('UPDATE refs SET relevance = ? WHERE id = ?').run(JSON.stringify(r.relevance ?? {}), existing.id);
		return getRef(existing.id)!;
	}
	const rid = id();
	db.query(
		'INSERT INTO refs (id, project_id, source, slug, title, company, category, page_url, x_url, video_url, poster, duration, status, relevance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	).run(rid, r.projectId, r.source, r.slug, r.title, r.company, r.category, r.pageUrl, r.xUrl, r.videoUrl, r.poster, r.duration, r.status ?? 'candidate', JSON.stringify(r.relevance ?? {}), now());
	return getRef(rid)!;
}

export function updateRef(rid: string, patch: Partial<Pick<Ref, 'status' | 'styleGuide' | 'videoUrl' | 'duration' | 'xUrl'>> & { analysis?: Ref['analysis'] }) {
	const r = getRef(rid);
	if (!r) return;
	db.query('UPDATE refs SET status = ?, style_guide = ?, video_url = ?, duration = ?, x_url = ?, analysis = ? WHERE id = ?').run(
		patch.status ?? r.status, patch.styleGuide ?? r.styleGuide, patch.videoUrl ?? r.videoUrl, patch.duration ?? r.duration, patch.xUrl ?? r.xUrl,
		JSON.stringify(mapPaths(patch.analysis ?? r.analysis, toStored)), rid
	);
}

export const deleteRef = (rid: string) => {
	db.query('DELETE FROM video_refs WHERE ref_id = ?').run(rid);
	db.query('DELETE FROM refs WHERE id = ?').run(rid);
};

export const videoRefIds = (vid: string) => (db.query('SELECT ref_id FROM video_refs WHERE video_id = ?').all(vid) as { ref_id: string }[]).map((x) => x.ref_id);
export function setVideoRef(vid: string, rid: string, on: boolean) {
	if (on) db.query('INSERT OR IGNORE INTO video_refs (video_id, ref_id) VALUES (?, ?)').run(vid, rid);
	else db.query('DELETE FROM video_refs WHERE video_id = ? AND ref_id = ?').run(vid, rid);
}

/** Style guides of the references attached to a video, for the prompts. */
export function refsBlock(vid: string): string {
	const refs = videoRefIds(vid).map(getRef).filter((r): r is Ref => !!r && !!r.styleGuide);
	if (!refs.length) return '';
	return `## Style references for this video (borrow the grammar, never the content, logos or copy)\n\n${refs
		.map((r) => `### ${r.title} — ${r.company}\n${r.styleGuide.trim()}`)
		.join('\n\n')}`;
}
