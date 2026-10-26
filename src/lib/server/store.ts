import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BriefState, EvalConfig, Finding, NoteRoute, ProjectSettings, Region, RunStatus, ShotData, VideoFormat } from '$lib/types';
import { db, id, json, now } from './db';
import { DEFAULT_EVAL } from './defaults';
import { ensureDir, fileUrl, fromStored, mapPaths, projectDir, slugify, toStored, videoDir } from './paths';
import { workspaceClaudeMd } from './workspace';

// Data access. Raw rows stay here; pages receive typed objects.

export interface Project {
	id: string;
	name: string;
	/** Owning organization (tenant). */
	orgId: string | null;
	settings: ProjectSettings;
	createdAt: number;
}
export interface Video {
	id: string;
	projectId: string;
	slug: string;
	title: string;
	brief: string;
	format: VideoFormat;
	targetDuration: number;
	briefState: BriefState;
	createdAt: number;
}
export interface Storyboard {
	id: string;
	videoId: string;
	version: number;
	summary: string;
	logline: string;
	status: 'draft' | 'approved';
	runId: string | null;
	createdAt: number;
}
export interface Shot {
	id: string;
	storyboardId: string;
	idx: number;
	key: string;
	title: string;
	duration: number;
	data: ShotData;
	refImage: string | null;
	refUrl: string | null;
}
export interface Note {
	id: string;
	videoId: string;
	target: 'storyboard' | 'shot' | 'render';
	storyboardVersion: number | null;
	shotKey: string | null;
	renderId: string | null;
	t: number | null;
	region: Region | null;
	frame: string | null;
	frameUrl: string | null;
	body: string;
	route: NoteRoute | null;
	status: 'open' | 'applied' | 'dismissed';
	runId: string | null;
	createdAt: number;
}
export interface Render {
	id: string;
	videoId: string;
	shotKey: string | null;
	version: number;
	file: string;
	url: string;
	qa: { contact?: string; strip?: string; phone?: string; stills?: string[]; contactFps?: number; duration?: number; hasAudio?: boolean; sound?: string; voice?: boolean; sfxGain?: number; captions?: boolean };
	runId: string | null;
	createdAt: number;
}
export interface Eval {
	id: string;
	renderId: string;
	shotKey: string | null;
	round: number;
	scores: Record<string, number>;
	pass: boolean;
	findings: Finding[];
	summary: string;
	createdAt: number;
}
export interface Run {
	id: string;
	projectId: string;
	videoId: string | null;
	kind: string;
	title: string;
	status: RunStatus;
	input: Record<string, unknown>;
	output: unknown;
	error: string | null;
	costUsd: number;
	parentId: string | null;
	createdAt: number;
	startedAt: number | null;
	finishedAt: number | null;
}
export interface Asset {
	id: string;
	projectId: string;
	kind: string;
	name: string;
	file: string;
	url: string;
	mime: string;
	size: number;
	tags: string;
	source: string;
	meta: Record<string, unknown>;
	createdAt: number;
}

type Row = Record<string, any>;

// ---------- projets ----------

const toProject = (r: Row): Project => {
	const s = json<Partial<ProjectSettings>>(r.settings, {});
	return { id: r.id, name: r.name, orgId: r.org_id ?? null, createdAt: r.created_at, settings: { ...s, eval: { ...DEFAULT_EVAL, ...(s.eval ?? {}) } as EvalConfig } };
};

/** Projects of an organization (null: the shared ones, without organization; undefined: all, for internal / admin use). */
export const listProjects = (orgId?: string | null) =>
	(orgId === undefined
		? db.query('SELECT * FROM projects ORDER BY created_at').all()
		: orgId === null
			? db.query('SELECT * FROM projects WHERE org_id IS NULL ORDER BY created_at').all()
			: db.query('SELECT * FROM projects WHERE org_id = ? ORDER BY created_at').all(orgId)
	).map((r) => toProject(r as Row));
/** Author of a run or note (multi-user). */
export const setAuthor = (table: 'runs' | 'notes', rowId: string, userId: string) => db.query(`UPDATE ${table} SET user_id = ? WHERE id = ?`).run(userId, rowId);
export const setProjectOrg =(pid: string, orgId: string) => db.query('UPDATE projects SET org_id = ? WHERE id = ?').run(orgId, pid);
export const getProject = (pid: string) => {
	const r = db.query('SELECT * FROM projects WHERE id = ?').get(pid) as Row | null;
	return r ? toProject(r) : null;
};

export function createProject(name: string, slug?: string, orgId?: string | null, language: 'en' | 'fr' = 'en'): Project {
	const pid = slug ? slugify(slug) : slugify(name);
	if (getProject(pid)) throw new Error(`Project "${pid}" already exists`);
	const dir = projectDir(pid);
	for (const d of ['brand/logo', 'brand/fonts', 'library', 'videos']) ensureDir(join(dir, d));
	if (!existsSync(join(dir, 'brand', 'brand.json'))) writeFileSync(join(dir, 'brand', 'brand.json'), JSON.stringify({ name, colors: {}, fonts: {} }, null, 1));
	if (!existsSync(join(dir, 'brand', 'motion.md'))) writeFileSync(join(dir, 'brand', 'motion.md'), `# ${name} — motion rules\n\n_To write: palette, typography, easing, pacing, bans._\n`);
	db.query('INSERT INTO projects (id, name, settings, org_id, created_at) VALUES (?, ?, ?, ?, ?)').run(pid, name, JSON.stringify({ eval: DEFAULT_EVAL, language }), orgId ?? null, now());
	syncWorkspace(pid);
	return getProject(pid)!;
}

export function saveProjectSettings(pid: string, settings: ProjectSettings) {
	db.query('UPDATE projects SET settings = ? WHERE id = ?').run(JSON.stringify(settings), pid);
	syncWorkspace(pid);
}

/** Rewrites the project workspace's CLAUDE.md (house rules read by each agent). */
export function syncWorkspace(pid: string) {
	const p = getProject(pid);
	if (!p) return;
	writeFileSync(join(projectDir(pid), 'CLAUDE.md'), workspaceClaudeMd(p));
}

export function readBrand(pid: string): { json: Record<string, any>; motion: string; design: string } {
	const dir = join(projectDir(pid), 'brand');
	const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
	return { json: json(read('brand.json'), {}), motion: read('motion.md'), design: read('DESIGN.md') };
}

// ---------- videos ----------

const toVideo = (r: Row): Video => ({
	id: r.id,
	projectId: r.project_id,
	slug: r.slug,
	title: r.title,
	brief: r.brief,
	format: json(r.format, { width: 1920, height: 1080, fps: 30 }),
	targetDuration: r.target_duration,
	briefState: { status: 'draft', decisions: {}, ignored: [], questions: [], ...json<Partial<BriefState>>(r.brief_state, {}) },
	createdAt: r.created_at
});

export const listVideos = (pid: string) => db.query('SELECT * FROM videos WHERE project_id = ? ORDER BY created_at').all(pid).map((r) => toVideo(r as Row));
export const getVideo = (vid: string) => {
	const r = db.query('SELECT * FROM videos WHERE id = ?').get(vid) as Row | null;
	return r ? toVideo(r) : null;
};
export const getVideoBySlug = (pid: string, slug: string) => {
	const r = db.query('SELECT * FROM videos WHERE project_id = ? AND slug = ?').get(pid, slug) as Row | null;
	return r ? toVideo(r) : null;
};

export function createVideo(pid: string, v: { title: string; brief: string; format: VideoFormat; targetDuration: number; slug?: string }): Video {
	let slug = slugify(v.slug || v.title);
	for (let i = 2; getVideoBySlug(pid, slug); i++) slug = `${slugify(v.slug || v.title)}-${i}`;
	const vid = id();
	db.query('INSERT INTO videos (id, project_id, slug, title, brief, format, target_duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
		vid, pid, slug, v.title, v.brief, JSON.stringify(v.format), v.targetDuration, now()
	);
	ensureDir(join(videoDir(pid, slug), 'shots'));
	return getVideo(vid)!;
}

export function setBriefState(vid: string, state: BriefState) {
	db.query('UPDATE videos SET brief_state = ? WHERE id = ?').run(JSON.stringify(state), vid);
}

export function updateVideo(vid: string, patch: { title?: string; brief?: string; targetDuration?: number }) {
	const v = getVideo(vid);
	if (!v) return;
	db.query('UPDATE videos SET title = ?, brief = ?, target_duration = ? WHERE id = ?').run(patch.title ?? v.title, patch.brief ?? v.brief, patch.targetDuration ?? v.targetDuration, vid);
}

// ---------- storyboards ----------

const toStoryboard = (r: Row): Storyboard => ({ id: r.id, videoId: r.video_id, version: r.version, summary: r.summary, logline: r.logline, status: r.status, runId: r.run_id, createdAt: r.created_at });
const toShot = (r: Row): Shot => ({ id: r.id, storyboardId: r.storyboard_id, idx: r.idx, key: r.key, title: r.title, duration: r.duration, data: json(r.data, { intent: '', visual: '', beats: [] }), refImage: fromStored(r.ref_image), refUrl: fileUrl(fromStored(r.ref_image)) });

export const listStoryboards = (vid: string) => db.query('SELECT * FROM storyboards WHERE video_id = ? ORDER BY version DESC').all(vid).map((r) => toStoryboard(r as Row));
export const getStoryboard = (vid: string, version?: number) => {
	const r = (version
		? db.query('SELECT * FROM storyboards WHERE video_id = ? AND version = ?').get(vid, version)
		: db.query('SELECT * FROM storyboards WHERE video_id = ? ORDER BY version DESC LIMIT 1').get(vid)) as Row | null;
	return r ? toStoryboard(r) : null;
};
/** When the current take began: the creation of the latest storyboard written from scratch (revisions keep the take). */
export const takeStart = (vid: string): number => {
	const r = db.query(`SELECT s.created_at t FROM storyboards s LEFT JOIN runs r ON r.id = s.run_id
		WHERE s.video_id = ? AND (r.id IS NULL OR r.kind = 'storyboard_generate') ORDER BY s.version DESC LIMIT 1`).get(vid) as { t: number } | null;
	return r?.t ?? 0;
};
export const listShots = (sbid: string) => db.query('SELECT * FROM shots WHERE storyboard_id = ? ORDER BY idx').all(sbid).map((r) => toShot(r as Row));

export interface StoryboardInput {
	logline: string;
	summary: string;
	shots: { key: string; title: string; duration: number; data: ShotData; refImage?: string | null }[];
}

export function createStoryboard(vid: string, input: StoryboardInput, runId: string | null): Storyboard {
	const version = (listStoryboards(vid)[0]?.version ?? 0) + 1;
	const sbid = id();
	db.transaction(() => {
		db.query('INSERT INTO storyboards (id, video_id, version, summary, logline, status, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
			sbid, vid, version, input.summary, input.logline, 'draft', runId, now()
		);
		input.shots.forEach((s, i) => {
			db.query('INSERT INTO shots (id, storyboard_id, idx, key, title, duration, data, ref_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
				id(), sbid, i, s.key, s.title, s.duration, JSON.stringify(s.data), toStored(s.refImage ?? null)
			);
		});
	})();
	return getStoryboard(vid, version)!;
}

/** Removes a storyboard version and its shots in one transaction (a revision whose re-fit failed). */
export const deleteStoryboard = (sbid: string) => db.transaction(() => {
	db.query('DELETE FROM shots WHERE storyboard_id = ?').run(sbid);
	db.query('DELETE FROM storyboards WHERE id = ?').run(sbid);
})();

export function setStoryboardStatus(sbid: string, status: 'draft' | 'approved') {
	db.query('UPDATE storyboards SET status = ? WHERE id = ?').run(status, sbid);
}

export type ShotPatch = { title?: string; duration?: number; data?: ShotData; refImage?: string | null };
export function updateShot(shotId: string, patch: ShotPatch) {
	const r = db.query('SELECT * FROM shots WHERE id = ?').get(shotId) as Row | null;
	if (!r) return;
	const s = toShot(r);
	db.query('UPDATE shots SET title = ?, duration = ?, data = ?, ref_image = ? WHERE id = ?').run(
		patch.title ?? s.title, patch.duration ?? s.duration, JSON.stringify(patch.data ?? s.data), toStored(patch.refImage === undefined ? s.refImage : patch.refImage), shotId
	);
}
/** Updates several shots in one transaction: all of them or none. */
export const updateShots = (patches: { id: string; patch: ShotPatch }[]) => db.transaction(() => patches.forEach((p) => updateShot(p.id, p.patch)))();

// ---------- notes ----------

const toNote = (r: Row): Note => ({
	id: r.id, videoId: r.video_id, target: r.target, storyboardVersion: r.storyboard_version, shotKey: r.shot_key, renderId: r.render_id,
	t: r.t, region: json(r.region, null), frame: fromStored(r.frame), frameUrl: fileUrl(fromStored(r.frame)), body: r.body, route: json(r.route, null), status: r.status, runId: r.run_id, createdAt: r.created_at
});

export const listNotes = (vid: string) => db.query('SELECT * FROM notes WHERE video_id = ? ORDER BY created_at').all(vid).map((r) => toNote(r as Row));
export const getNotes = (ids: string[]) => ids.map((n) => db.query('SELECT * FROM notes WHERE id = ?').get(n) as Row | null).filter(Boolean).map((r) => toNote(r as Row));

export function createNote(n: Omit<Note, 'id' | 'createdAt' | 'status' | 'runId' | 'frameUrl'>): Note {
	const nid = id();
	db.query('INSERT INTO notes (id, video_id, target, storyboard_version, shot_key, render_id, t, region, frame, body, route, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
		nid, n.videoId, n.target, n.storyboardVersion, n.shotKey, n.renderId, n.t, n.region ? JSON.stringify(n.region) : null, toStored(n.frame), n.body, n.route ? JSON.stringify(n.route) : null, 'open', now()
	);
	return toNote(db.query('SELECT * FROM notes WHERE id = ?').get(nid) as Row);
}

export function setNotesStatus(ids: string[], status: Note['status'], runId?: string) {
	for (const n of ids) db.query('UPDATE notes SET status = ?, run_id = COALESCE(?, run_id) WHERE id = ?').run(status, runId ?? null, n);
}
export const deleteNote = (nid: string) => db.query('DELETE FROM notes WHERE id = ?').run(nid);

// ---------- renders & evaluations ----------

const toRender = (r: Row): Render => ({ id: r.id, videoId: r.video_id, shotKey: r.shot_key, version: r.version, file: fromStored(r.file), url: fileUrl(fromStored(r.file))!, qa: mapPaths(json<Render['qa']>(r.qa, {}), fromStored), runId: r.run_id, createdAt: r.created_at });

export const listRenders = (vid: string, shotKey?: string | null) =>
	(shotKey === undefined
		? db.query('SELECT * FROM renders WHERE video_id = ? ORDER BY created_at DESC').all(vid)
		: shotKey === null
			? db.query('SELECT * FROM renders WHERE video_id = ? AND shot_key IS NULL ORDER BY version DESC').all(vid)
			: db.query('SELECT * FROM renders WHERE video_id = ? AND shot_key = ? ORDER BY version DESC').all(vid, shotKey)
	).map((r) => toRender(r as Row));
export const getRender = (rid: string) => {
	const r = db.query('SELECT * FROM renders WHERE id = ?').get(rid) as Row | null;
	return r ? toRender(r) : null;
};
export function nextRenderVersion(vid: string, shotKey: string | null): number {
	const r = (shotKey === null
		? db.query('SELECT MAX(version) AS v FROM renders WHERE video_id = ? AND shot_key IS NULL').get(vid)
		: db.query('SELECT MAX(version) AS v FROM renders WHERE video_id = ? AND shot_key = ?').get(vid, shotKey)) as { v: number | null };
	return (r?.v ?? 0) + 1;
}
export function createRender(r: { videoId: string; shotKey: string | null; version: number; file: string; qa: Render['qa']; runId: string | null }): Render {
	const rid = id();
	db.query('INSERT INTO renders (id, video_id, shot_key, version, file, qa, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
		rid, r.videoId, r.shotKey, r.version, toStored(r.file), JSON.stringify(mapPaths(r.qa, toStored)), r.runId, now()
	);
	return getRender(rid)!;
}

const toEval = (r: Row): Eval => ({ id: r.id, renderId: r.render_id, shotKey: r.shot_key, round: r.round, scores: json(r.scores, {}), pass: !!r.pass, findings: json(r.findings, []), summary: r.summary, createdAt: r.created_at });
export const listEvals = (vid: string) => db.query('SELECT * FROM evals WHERE video_id = ? ORDER BY created_at DESC').all(vid).map((r) => toEval(r as Row));
export function createEval(e: { renderId: string; videoId: string; shotKey: string | null; round: number; scores: Record<string, number>; pass: boolean; findings: Finding[]; summary: string; runId: string }): Eval {
	const eid = id();
	db.query('INSERT INTO evals (id, render_id, video_id, shot_key, round, scores, pass, findings, summary, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
		eid, e.renderId, e.videoId, e.shotKey, e.round, JSON.stringify(e.scores), e.pass ? 1 : 0, JSON.stringify(e.findings), e.summary, e.runId, now()
	);
	return toEval(db.query('SELECT * FROM evals WHERE id = ?').get(eid) as Row);
}

// ---------- runs ----------

const toRun = (r: Row): Run => ({
	id: r.id, projectId: r.project_id, videoId: r.video_id, kind: r.kind, title: r.title, status: r.status, input: json(r.input, {}), output: json(r.output, null),
	error: r.error, costUsd: r.cost_usd, parentId: r.parent_id, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at
});
export const getRun = (rid: string) => {
	const r = db.query('SELECT * FROM runs WHERE id = ?').get(rid) as Row | null;
	return r ? toRun(r) : null;
};
export const listRuns = (opts: { videoId?: string; projectId?: string; limit?: number }) =>
	(opts.videoId
		? db.query('SELECT * FROM runs WHERE video_id = ? ORDER BY created_at DESC LIMIT ?').all(opts.videoId, opts.limit ?? 50)
		: db.query('SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(opts.projectId ?? '', opts.limit ?? 50)
	).map((r) => toRun(r as Row));
export function insertRun(r: { projectId: string; videoId: string | null; kind: string; title: string; input: Record<string, unknown>; parentId?: string | null }): Run {
	const rid = id();
	db.query('INSERT INTO runs (id, project_id, video_id, kind, title, status, input, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
		rid, r.projectId, r.videoId, r.kind, r.title, 'queued', JSON.stringify(r.input), r.parentId ?? null, now()
	);
	return getRun(rid)!;
}

// ---------- library ----------

const toAsset = (r: Row): Asset => ({ id: r.id, projectId: r.project_id, kind: r.kind, name: r.name, file: fromStored(r.file), url: fileUrl(fromStored(r.file))!, mime: r.mime, size: r.size, tags: r.tags, source: r.source, meta: json(r.meta, {}), createdAt: r.created_at });
export const listAssets = (pid: string) => db.query('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC').all(pid).map((r) => toAsset(r as Row));
export function createAsset(a: { projectId: string; kind: string; name: string; file: string; mime: string; size: number; tags?: string; source?: string; meta?: Record<string, unknown> }): Asset {
	const aid = id();
	db.query('INSERT INTO assets (id, project_id, kind, name, file, mime, size, tags, source, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
		aid, a.projectId, a.kind, a.name, toStored(a.file), a.mime, a.size, a.tags ?? '', a.source ?? 'upload', JSON.stringify(a.meta ?? {}), now()
	);
	return toAsset(db.query('SELECT * FROM assets WHERE id = ?').get(aid) as Row);
}
export const deleteAsset = (aid: string) => db.query('DELETE FROM assets WHERE id = ?').run(aid);
