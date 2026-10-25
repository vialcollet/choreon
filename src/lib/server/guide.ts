import { createSdkMcpServer, query, tool, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { z } from 'zod';
import type { BriefState, VideoFormat } from '$lib/types';
import { canAccessProject, visibleProjects } from './access';
import { agentEnv } from './agent';
import { briefAxes, settle } from './brief';
import { brandCard } from './brandcard';
import { db, id, json, now } from './db';
import { FORMATS } from './defaults';
import { engine, enqueue, cancel, type JobKind } from './jobs';
import { routeNote } from './jev';
import { studioSettings } from './lessons';
import { DATA_DIR, claudeExecutable, ensureDir, videoDir } from './paths';
import * as S from './store';

// The in-app guide: a producer agent the user talks to, which drives the studio through tools
// (create a video, answer the framing, start a storyboard, read where a film is at…). One
// conversation per user; the agent session is resumed from one message to the next.

export type GuideRole = 'user' | 'assistant';
export interface GuideMessage {
	id: string;
	role: GuideRole;
	content: string;
	meta: { tools?: GuideTool[]; costUsd?: number; error?: string; url?: string };
	createdAt: number;
}
/** A tool call as the UI shows it: a compact chip. */
export interface GuideTool {
	name: string;
	label: string;
	ok: boolean;
	/** The tool changed something: the open pages should reload. */
	mutates?: boolean;
	/** navigate: the page to open. */
	url?: string;
}
export type GuideEvent =
	| { type: 'user'; message: GuideMessage }
	| { type: 'delta'; text: string }
	| { type: 'tool'; tool: GuideTool }
	| { type: 'assistant'; message: GuideMessage }
	| { type: 'busy'; busy: boolean }
	| { type: 'cleared' };

declare global {
	var __guideBus: EventEmitter | undefined;
	var __guideBusy: Map<string, AbortController> | undefined;
}
const bus: EventEmitter = (globalThis.__guideBus ??= new EventEmitter().setMaxListeners(100));
const busy: Map<string, AbortController> = (globalThis.__guideBusy ??= new Map());

const send = (userId: string, ev: GuideEvent) => bus.emit(`guide:${userId}`, ev);
export function subscribeGuide(userId: string, fn: (ev: GuideEvent) => void): () => void {
	bus.on(`guide:${userId}`, fn);
	return () => bus.off(`guide:${userId}`, fn);
}
export const isBusy = (userId: string) => busy.has(userId);

// ---------- persistence ----------

type Row = Record<string, any>;
const toMessage = (r: Row): GuideMessage => ({ id: r.id, role: r.role, content: r.content, meta: json(r.meta, {}), createdAt: r.created_at });

export const listMessages = (userId: string, limit = 200): GuideMessage[] =>
	(db.query('SELECT * FROM guide_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit) as Row[]).map(toMessage).reverse();

function addMessage(userId: string, role: GuideRole, content: string, meta: GuideMessage['meta'] = {}): GuideMessage {
	const mid = id();
	const t = now();
	db.query('INSERT INTO guide_messages (id, user_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(mid, userId, role, content, JSON.stringify(meta), t);
	return { id: mid, role, content, meta, createdAt: t };
}

const thread = (userId: string) => db.query('SELECT session_id, cost_usd FROM guide_threads WHERE user_id = ?').get(userId) as { session_id: string | null; cost_usd: number } | null;
function saveThread(userId: string, sessionId: string | null, cost: number) {
	db.query('INSERT INTO guide_threads (user_id, session_id, cost_usd, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET session_id = excluded.session_id, cost_usd = guide_threads.cost_usd + excluded.cost_usd, updated_at = excluded.updated_at').run(
		userId, sessionId, cost, now()
	);
}

/** Starts a fresh conversation (the old messages are deleted). */
export function clearGuide(userId: string) {
	busy.get(userId)?.abort();
	db.query('DELETE FROM guide_messages WHERE user_id = ?').run(userId);
	db.query('DELETE FROM guide_threads WHERE user_id = ?').run(userId);
	send(userId, { type: 'cleared' });
}

export const stopGuide = (userId: string) => busy.get(userId)?.abort();

// ---------- page context ----------

/** What the user is looking at (project, video, shot), from the page URL. */
export function pageContext(locals: App.Locals, url: string | undefined): string {
	if (!url) return '';
	let u: URL;
	try {
		u = new URL(url, 'http://local');
	} catch {
		return '';
	}
	const m = u.pathname.match(/^\/p\/([^/]+)(?:\/v\/([^/]+)(\/production)?)?(?:\/([^/]+))?/);
	if (!m) return `The user is on the page ${u.pathname}.`;
	const [, pid, vslug, production, section] = m;
	const projectId = decodeURIComponent(pid);
	const p = canAccessProject(locals, projectId) ? S.getProject(projectId) : null;
	if (!p) return `The user is on the page ${u.pathname}.`;
	const v = vslug ? S.getVideoBySlug(p.id, decodeURIComponent(vslug)) : null;
	const shot = u.searchParams.get('shot');
	return [
		`The user is on the page ${u.pathname}${u.search}:`,
		`project "${p.name}" (projectId ${p.id})`,
		v ? `, video "${v.title}" (videoId ${v.id}, slug ${v.slug}), ${production ? 'Production tab' : 'Storyboard tab'}` : section ? `, section ${section}` : '',
		v && shot ? `, shot ${shot === '__full' ? 'full video' : shot} selected` : '',
		'. "This video", "this shot" refer to it.'
	].join('');
}

// ---------- tools ----------

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true });

/** Jobs the guide may start (the ones a user starts from the UI; never the internal follow-ups). */
const JOBS = ['brief_review', 'storyboard_generate', 'storyboard_revise', 'shot_build', 'shot_fix', 'assemble', 'sound_design', 'reference_scout'] as const;
const JOB_LABEL: Record<(typeof JOBS)[number], string> = {
	brief_review: 'Framing interview',
	storyboard_generate: 'Storyboard',
	storyboard_revise: 'Storyboard revision',
	shot_build: 'Shot build',
	shot_fix: 'Shot fix',
	assemble: 'Assembly',
	sound_design: 'Sound design',
	reference_scout: 'Reference shortlist'
};

/** Same titles as /api/jobs (stored in English, translated at display time). */
function jobTitle(kind: string, b: Record<string, any>): string | undefined {
	return kind === 'shot_build' ? `Shot ${b.shotKey} — build`
		: kind === 'shot_fix' ? `Shot ${b.shotKey} — fix (${(b.noteIds ?? []).length} note(s))`
		: kind === 'storyboard_revise' ? `Storyboard — revision (${(b.noteIds ?? []).length} note(s))`
		: undefined;
}

/** The studio's tools, bound to the user who talks to the guide (access checked on each call). */
function studioTools(locals: App.Locals, report: (t: GuideTool) => void) {
	const userId = locals.user!.id;
	const project = (pid: string) => {
		if (!canAccessProject(locals, pid)) throw new Error(`project "${pid}" not found`);
		return S.getProject(pid)!;
	};
	const video = (pid: string, v: string) => {
		const p = project(pid);
		const found = S.getVideo(v) ?? S.getVideoBySlug(p.id, v);
		if (!found || found.projectId !== p.id) throw new Error(`video "${v}" not found in project ${p.id}`);
		return found;
	};
	const pageOf = (v: S.Video, tab = '') => `/p/${v.projectId}/v/${v.slug}${tab}`;
	/** Wraps a handler: errors become tool errors, every call becomes a chip in the UI. */
	const wrap = <A,>(name: string, label: (a: A, r: any) => string, fn: (a: A) => unknown, extra: Partial<GuideTool> = {}) =>
		async (a: A) => {
			try {
				const r = await fn(a);
				report({ name, label: label(a, r), ok: true, ...extra, ...(name === 'navigate' ? { url: (r as { url: string }).url } : {}) });
				return ok(r);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				report({ name, label: `${label(a, null)} — ${msg}`, ok: false });
				return fail(msg);
			}
		};

	const videoStatus = (v: S.Video) => {
		const sb = S.getStoryboard(v.id);
		const shots = sb ? S.listShots(sb.id) : [];
		const renders = S.listRenders(v.id);
		const evals = S.listEvals(v.id);
		const runs = S.listRuns({ videoId: v.id, limit: 200 });
		const last = (key: string | null) => renders.filter((r) => r.shotKey === key).sort((a, b) => b.version - a.version)[0];
		const bs: BriefState = v.briefState;
		const full = last(null);
		return {
			video: { id: v.id, slug: v.slug, title: v.title, format: v.format, targetDuration: v.targetDuration, page: pageOf(v), production: pageOf(v, '/production') },
			brief: v.brief,
			framing: {
				status: bs.status,
				decided: bs.decisions,
				ignored: bs.ignored,
				openQuestions: bs.questions.filter((q) => !(q.field in bs.decisions) && !bs.ignored.includes(q.field)).map((q) => ({ field: q.field, question: q.question, options: q.options ?? [], directorDefault: q.default ?? null })),
				openAxes: briefAxes().filter((a) => !(a.key in bs.decisions) && !bs.ignored.includes(a.key)).map((a) => a.key)
			},
			storyboard: sb ? { version: sb.version, status: sb.status, logline: sb.logline, shots: shots.map((s) => {
				const r = last(s.key);
				const e = r ? evals.find((x) => x.renderId === r.id) : null;
				return { key: s.key, title: s.title, duration: s.duration, render: r ? r.version : null, critique: e ? { pass: e.pass, scores: e.scores, summary: e.summary } : null };
			}) } : null,
			fullCut: full ? { version: full.version, sound: !!full.qa.hasAudio } : null,
			running: runs.filter((r) => r.status === 'running' || r.status === 'queued').map((r) => ({ id: r.id, title: r.title, status: r.status })),
			recentErrors: runs.filter((r) => r.status === 'error').slice(0, 3).map((r) => ({ title: r.title, error: r.error })),
			costUsd: Math.round(runs.reduce((a, r) => a + r.costUsd, 0) * 100) / 100
		};
	};

	return createSdkMcpServer({
		name: 'choreon',
		version: '1.0.0',
		tools: [
			tool('list_projects', 'Projects the user can open, with their videos (id, slug, title).', {}, wrap('list_projects', () => 'Projects', () =>
				visibleProjects(locals).map((p) => ({ id: p.id, name: p.name, demo: !p.orgId, page: `/p/${p.id}`, videos: S.listVideos(p.id).map((v) => ({ id: v.id, slug: v.slug, title: v.title })) }))
			)),
			tool('get_project', 'A project: brand (tagline, colours, fonts, motion doctrine excerpt) and videos with their stage.', { projectId: z.string() }, wrap('get_project', (a) => `Project ${a.projectId}`, (a: { projectId: string }) => {
				const p = project(a.projectId);
				const b = brandCard(p.id);
				const brand = S.readBrand(p.id);
				return {
					id: p.id, name: p.name, page: `/p/${p.id}`, language: p.settings.language ?? 'en', tagline: b.tagline, colors: b.colors, fonts: [...new Set(Object.values(b.fonts).map((f) => f.family))],
					doctrine: brand.motion.slice(0, 1800),
					videos: S.listVideos(p.id).map((v) => { const sb = S.getStoryboard(v.id); return { id: v.id, slug: v.slug, title: v.title, framing: v.briefState.status, storyboard: sb ? `v${sb.version} ${sb.status}` : null, renders: S.listRenders(v.id).length }; })
				};
			})),
			tool('create_project', 'Creates a project in the active organization (name only; the brand is filled in afterwards in its settings). Ask before creating.', { name: z.string().min(1) }, wrap('create_project', (a) => `Created project ${a.name}`, (a: { name: string }) => {
				const orgId = locals.session?.activeOrganizationId;
				if (!orgId) throw new Error('no active organization: the user must join or select one first');
				const p = S.createProject(a.name, undefined, orgId, locals.lang);
				return { id: p.id, page: `/p/${p.id}` };
			}, { mutates: true })),
			tool('create_video', 'Creates a video in a project with its brief. Does not start anything (start the framing interview with start_job brief_review).', {
				projectId: z.string(), title: z.string().min(1), brief: z.string().default(''), format: z.enum(['16:9', '9:16', '1:1', '4:5']).default('16:9'), fps: z.number().int().min(12).max(60).default(30), durationSeconds: z.number().min(3).max(600).default(20)
			}, wrap('create_video', (a) => `Created video ${a.title}`, (a: { projectId: string; title: string; brief: string; format: keyof typeof FORMATS; fps: number; durationSeconds: number }) => {
				const p = project(a.projectId);
				const format: VideoFormat = { ...FORMATS[a.format], fps: a.fps };
				const v = S.createVideo(p.id, { title: a.title, brief: a.brief, format, targetDuration: a.durationSeconds });
				return { id: v.id, slug: v.slug, page: pageOf(v) };
			}, { mutates: true })),
			tool('update_brief', 'Replaces a video\'s brief (and optionally its target duration). If the text changed, the director re-reviews the framing automatically (a short paid agent run).', {
				projectId: z.string(), video: z.string().describe('video id or slug'), brief: z.string(), durationSeconds: z.number().min(3).max(600).optional()
			}, wrap('update_brief', () => 'Updated the brief', (a: { projectId: string; video: string; brief: string; durationSeconds?: number }) => {
				const v = video(a.projectId, a.video);
				S.updateVideo(v.id, { brief: a.brief, targetDuration: a.durationSeconds ?? v.targetDuration });
				if (a.brief !== v.brief) {
					S.setBriefState(v.id, { ...v.briefState, status: 'reviewing' });
					enqueue('brief_review', { projectId: v.projectId, videoId: v.id });
					return { ok: true, framingReview: 'started' };
				}
				return { ok: true };
			}, { mutates: true })),
			tool('get_video_status', 'Where a video is at: brief, framing (decided axes, open questions with options and the director\'s default), storyboard and shots (latest render, critique), full cut, running tasks, errors, cost so far.', {
				projectId: z.string(), video: z.string().describe('video id or slug')
			}, wrap('get_video_status', () => 'Read the video status', (a: { projectId: string; video: string }) => videoStatus(video(a.projectId, a.video)))),
			tool('answer_framing', 'Answers framing questions of a video, like the interview form: per axis a free text, OR useDefault (the director\'s proposal), OR ignore. When axes remain open the director reviews again (short paid run).', {
				projectId: z.string(), video: z.string(), answers: z.array(z.object({ field: z.string(), text: z.string().optional(), useDefault: z.boolean().optional(), ignore: z.boolean().optional() })).min(1)
			}, wrap('answer_framing', (a) => `Answered ${a.answers.length} framing question(s)`, (a: { projectId: string; video: string; answers: { field: string; text?: string; useDefault?: boolean; ignore?: boolean }[] }) => {
				const v = video(a.projectId, a.video);
				const decisions = { ...v.briefState.decisions };
				const ignored = [...v.briefState.ignored];
				const axes = new Set(briefAxes().map((x) => x.key));
				for (const ans of a.answers) {
					if (!axes.has(ans.field)) throw new Error(`unknown framing axis "${ans.field}"`);
					const q = v.briefState.questions.find((x) => x.field === ans.field);
					if (ans.ignore) ignored.includes(ans.field) || ignored.push(ans.field);
					else if (ans.useDefault && q?.default) decisions[ans.field] = q.default;
					else if (ans.text?.trim()) decisions[ans.field] = ans.text.trim();
				}
				const next = settle({ ...v.briefState, decisions, ignored, status: 'interview' });
				S.setBriefState(v.id, next);
				if (next.status !== 'ready') {
					S.setBriefState(v.id, { ...next, status: 'reviewing' });
					enqueue('brief_review', { projectId: v.projectId, videoId: v.id });
				}
				return { framing: next.status === 'ready' ? 'ready: the storyboard can be generated' : 'the director is reviewing the remaining axes' };
			}, { mutates: true })),
			tool('start_job', `Starts a studio task. These run agents and COST money: only call with confirmed=true once the user has clearly agreed to this specific task (or asked for it in so many words). Kinds: ${JOBS.map((k) => `${k} (${JOB_LABEL[k]})`).join(', ')}. shot_build/shot_fix need shotKey; shot_fix uses open notes of the shot (noteIds) or an instruction; sound_design takes style sobre|equilibre|musique and an optional sfxGain (1 = as designed, 0.5 = effects 6 dB lower); storyboard_revise uses open storyboard notes (noteIds); reference_scout takes count.`, {
				projectId: z.string(), video: z.string().optional().describe('video id or slug (all kinds except reference_scout)'), kind: z.enum(JOBS), confirmed: z.boolean().describe('true only if the user agreed to spend on this task'),
				shotKey: z.string().optional(), noteIds: z.array(z.string()).optional(), style: z.enum(['sobre', 'equilibre', 'musique']).optional(), sfxGain: z.number().min(0.5).max(1.4).optional(), count: z.number().int().min(1).max(12).optional()
			}, wrap('start_job', (a) => `Started ${JOB_LABEL[a.kind as (typeof JOBS)[number]]}${a.shotKey ? ` · ${a.shotKey}` : ''}`, (a: { projectId: string; video?: string; kind: (typeof JOBS)[number]; confirmed: boolean; shotKey?: string; noteIds?: string[]; style?: string; sfxGain?: number; count?: number }) => {
				if (!a.confirmed) throw new Error('not confirmed: ask the user first, then call again with confirmed=true');
				const p = project(a.projectId);
				const v = a.video ? video(p.id, a.video) : null;
				if (!v && a.kind !== 'reference_scout') throw new Error('this task needs a video');
				if ((a.kind === 'shot_build' || a.kind === 'shot_fix') && !a.shotKey) throw new Error('shotKey required');
				if (a.kind === 'storyboard_generate' && v && v.briefState.status !== 'ready') throw new Error('the framing is not ready yet: answer the open questions first');
				const body: Record<string, unknown> = { projectId: p.id, videoId: v?.id ?? null, round: 0, shotKey: a.shotKey, noteIds: a.noteIds, ...(a.style ? { style: a.style } : {}), ...(a.sfxGain ? { sfxGain: a.sfxGain } : {}) };
				if (a.kind === 'reference_scout') Object.assign(body, { lane: 'refs', count: a.count ?? 4, ...(v ? { forVideo: v.id, title: `References — shortlist · ${v.title}` } : {}) });
				if (a.kind === 'brief_review' && v) S.setBriefState(v.id, { ...v.briefState, status: 'reviewing' });
				const title = jobTitle(a.kind, body);
				const run = enqueue(a.kind as JobKind, { ...body, ...(title ? { title } : {}) } as Parameters<typeof enqueue>[1]);
				S.setAuthor('runs', run.id, userId);
				return { runId: run.id, title: run.title, status: run.status, page: v ? pageOf(v, a.kind.startsWith('shot') || a.kind === 'assemble' || a.kind === 'sound_design' ? '/production' : '') : `/p/${p.id}/references` };
			}, { mutates: true })),
			tool('list_runs', 'Recent tasks of a project or a video (title, status, cost, error).', { projectId: z.string(), video: z.string().optional(), limit: z.number().int().min(1).max(40).default(12) }, wrap('list_runs', () => 'Listed tasks', (a: { projectId: string; video?: string; limit: number }) => {
				const p = project(a.projectId);
				const v = a.video ? video(p.id, a.video) : null;
				return S.listRuns(v ? { videoId: v.id, limit: a.limit } : { projectId: p.id, limit: a.limit }).map((r) => ({ id: r.id, title: r.title, status: r.status, costUsd: r.costUsd, error: r.error }));
			})),
			tool('cancel_run', 'Stops a queued or running task.', { runId: z.string() }, wrap('cancel_run', () => 'Stopped a task', (a: { runId: string }) => {
				const r = S.getRun(a.runId);
				if (!r || !canAccessProject(locals, r.projectId)) throw new Error('task not found');
				cancel(r.id);
				return { ok: true };
			}, { mutates: true })),
			tool('add_note', 'Adds a director\'s note, routed like a note typed in the UI. target "render" = on the latest render of a shot (t in seconds within the shot), "storyboard" = on the storyboard (a shot, or global without shotKey). Notes are applied later with start_job shot_fix / storyboard_revise.', {
				projectId: z.string(), video: z.string(), target: z.enum(['render', 'storyboard']), body: z.string().min(1), shotKey: z.string().optional(), t: z.number().min(0).optional()
			}, wrap('add_note', (a) => `Added a note${a.shotKey ? ` on ${a.shotKey}` : ''}`, async (a: { projectId: string; video: string; target: 'render' | 'storyboard'; body: string; shotKey?: string; t?: number }) => {
				const v = video(a.projectId, a.video);
				const sb = S.getStoryboard(v.id);
				const render = a.target === 'render' && a.shotKey ? S.listRenders(v.id, a.shotKey).sort((x, y) => y.version - x.version)[0] : null;
				if (a.target === 'render' && !render) throw new Error(`shot ${a.shotKey ?? '?'} has no render yet`);
				const t = render ? a.t ?? null : null;
				let frame: string | null = null;
				if (render && t !== null) {
					const dir = ensureDir(join(videoDir(v.projectId, v.slug), 'notes'));
					frame = join(dir, `${render.shotKey ?? 'video'}-r${render.version}-${Math.round(t * 1000)}-${Date.now().toString(36)}.png`);
					try {
						await engine('qa.mjs', ['--video', render.file, '--frame', String(t), '--out', frame], 'notes');
					} catch {
						frame = null;
					}
				}
				const shot = sb && a.shotKey ? S.listShots(sb.id).find((s) => s.key === a.shotKey) : null;
				const context = `Motion design video "${v.title}". ${render ? `Annotation placed on the animated render of shot ${a.shotKey}${t !== null ? ` at ${t.toFixed(2)} s` : ''}.` : `Annotation placed on the storyboard${a.shotKey ? `, shot ${a.shotKey}` : ' (global)'}.`} ${shot ? `Shot intent: ${shot.data.intent}` : ''}`;
				const route = await routeNote({ body: a.body, context, hasTimestamp: !!render });
				const note = S.createNote({ videoId: v.id, target: render ? 'render' : 'storyboard', storyboardVersion: sb?.version ?? null, shotKey: a.shotKey ?? null, renderId: render?.id ?? null, t, region: null, frame, body: a.body, route });
				S.setAuthor('notes', note.id, userId);
				return { noteId: note.id, route: note.route };
			}, { mutates: true })),
			tool('navigate', 'Opens a page of the studio for the user (a path starting with "/", e.g. a video page or its /production tab, a project, /lessons, /settings).', { url: z.string().regex(/^\/[^/]/) }, wrap('navigate', (a) => `Opened ${a.url}`, (a: { url: string }) => ({ url: a.url })))
		]
	});
}

// ---------- the agent ----------

const SYSTEM = (lang: 'en' | 'fr') => `You are the producer inside Choreon, an open-source motion design studio run by agents. You talk with the user (the director) and you drive the studio for them with your tools — exactly as a human producer would: you clarify what they want, set things up, start the right task at the right time, report where things are, and propose the next step.

How a film is made in Choreon:
1. Project = a brand (brand/: DESIGN.md, motion.md doctrine, house rules, palette, fonts, layered logo), a library, UI kits, videos.
2. Video = title, format, target duration and a brief.
3. Framing interview (brief_review): the director agent challenges the brief on axes (goal, audience, locked message, hook, arc, pacing, product truth, narration, sound, end shot, format, references, bans) and asks questions with options and a default. Every axis must be decided or ignored before a storyboard ("framing ready"). You can answer for the user with answer_framing once they told you what they want (or "use your defaults").
4. Storyboard (storyboard_generate): shots with intent, visuals, timed beats, reference images. The user may annotate and revise (storyboard_revise) or approve it.
5. Shots (shot_build): each shot is coded, rendered, scored by the critic and auto-fixed for a few rounds. Notes on a frame are applied with shot_fix.
6. Assembly (assemble) then sound design (sound_design: sobre = subtle, equilibre = balanced, musique = with music).

Rules:
- Framing decisions belong to the user: never answer a framing axis on your own initiative. Relay the open questions with their options and the director's default, and use answer_framing only with what the user said ("use your defaults" counts).
- A task blocked by a previous step (e.g. a storyboard while framing axes are open): say what is missing and ask, do not work around it.
- Use the tools to know the truth: never guess a status, an id or a slug; read get_video_status / get_project first.
- Money: tasks that run agents cost real money (a framing review or a revision: cents; a storyboard: about 1–3 $; building every shot of a 20 s film: about 10–40 $). Before start_job, say what it will do and roughly what it costs, and wait for a yes — unless the user already asked for exactly that task. Then call it with confirmed=true. Creating or editing things (create_video, update_brief, add_note) is free, but still confirm before creating a project.
- Be concise and concrete: short paragraphs or bullets, the decisions that matter, then the next step as a question. Link pages as markdown links with the paths the tools return (e.g. [Production](/p/x/v/y/production)). Use navigate when the user asks to see something.
- When the user is on a page, "this video" / "this shot" means what the page context says.
- Taste belongs to the project: respect the brand's doctrine, never impose a generic style.
- You cannot read or write files or run commands: everything goes through the tools. If something is out of reach (e.g. editing the brand files), say where in the UI the user can do it.
- ${lang === 'fr' ? 'Answer in FRENCH (natural, typographically correct), whatever the language of the tool results.' : 'Answer in English.'}`;

async function* oneMessage(text: string): AsyncIterable<SDKUserMessage> {
	yield { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } as SDKUserMessage['message'], parent_tool_use_id: null };
}

/**
 * One turn of the conversation: stores the user's message, runs the agent (resuming its session),
 * streams its text and tool chips to the user's subscribers, stores the answer. Runs in the
 * background; returns once the turn is registered.
 */
export function askGuide(locals: App.Locals, text: string, url?: string): GuideMessage {
	const userId = locals.user!.id;
	if (busy.has(userId)) throw new Error('the guide is already answering');
	const user = addMessage(userId, 'user', text, url ? { url } : {});
	send(userId, { type: 'user', message: user });
	const abort = new AbortController();
	busy.set(userId, abort);
	send(userId, { type: 'busy', busy: true });
	void turn(locals, text, url, abort).finally(() => {
		busy.delete(userId);
		send(userId, { type: 'busy', busy: false });
	});
	return user;
}

async function turn(locals: App.Locals, text: string, url: string | undefined, abort: AbortController) {
	const userId = locals.user!.id;
	const lang = locals.lang ?? 'en';
	const tools: GuideTool[] = [];
	const report = (t: GuideTool) => {
		tools.push(t);
		send(userId, { type: 'tool', tool: t });
	};
	const ctx = pageContext(locals, url);
	const prompt = `${ctx ? `[Page context] ${ctx}\n\n` : ''}${text}`;
	const choice = studioSettings().models.guide ?? { model: 'sonnet', effort: 'medium' };
	const prev = thread(userId)?.session_id ?? null;

	const run = async (resume: string | null) => {
		let answer = '';
		let partial = '';
		let cost = 0;
		let sessionId: string | null = resume;
		const q = query({
			prompt: oneMessage(prompt),
			options: {
				cwd: DATA_DIR,
				model: choice.model,
				effort: choice.effort,
				systemPrompt: SYSTEM(lang),
				tools: [] as string[],
				mcpServers: { choreon: studioTools(locals, report) },
				allowedTools: ['mcp__choreon__*'],
				settingSources: [],
				permissionMode: 'bypassPermissions',
				allowDangerouslySkipPermissions: true,
				includePartialMessages: true,
				maxTurns: 24,
				...(resume ? { resume } : {}),
				env: agentEnv(),
				abortController: abort,
				...(claudeExecutable() ? { pathToClaudeCodeExecutable: claudeExecutable() } : {})
			}
		});
		for await (const m of q) {
			if ((m as { session_id?: string }).session_id) sessionId = (m as { session_id: string }).session_id;
			if (m.type === 'stream_event') {
				const ev = m.event as { type?: string; delta?: { type?: string; text?: string }; content_block?: { type?: string } };
				if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
					partial += ev.delta.text;
					send(userId, { type: 'delta', text: ev.delta.text });
				} else if (ev.type === 'content_block_start' && ev.content_block?.type === 'text' && partial) {
					// A new text block after tool calls: separate it from the previous one.
					partial += '\n\n';
					send(userId, { type: 'delta', text: '\n\n' });
				}
			} else if (m.type === 'assistant' && !m.parent_tool_use_id) {
				for (const b of m.message.content as unknown as Array<Record<string, unknown>>) if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) answer = answer ? `${answer}\n\n${b.text}` : b.text;
			} else if (m.type === 'result') {
				cost = m.total_cost_usd ?? 0;
				if (m.subtype !== 'success' && m.subtype !== 'error_max_turns') throw new Error(`agent ended: ${m.subtype}`);
			}
		}
		return { answer: answer || partial, cost, sessionId };
	};

	try {
		let res: Awaited<ReturnType<typeof run>>;
		try {
			res = await run(prev);
		} catch (e) {
			// A lost session (cleared CLI history, other machine): start a new one.
			if (!prev || abort.signal.aborted) throw e;
			res = await run(null);
		}
		saveThread(userId, res.sessionId, res.cost);
		const msg = addMessage(userId, 'assistant', res.answer.trim() || (lang === 'fr' ? '(pas de réponse)' : '(no answer)'), { tools, costUsd: res.cost });
		send(userId, { type: 'assistant', message: msg });
	} catch (e) {
		const stopped = abort.signal.aborted;
		const err = stopped ? (lang === 'fr' ? 'Arrêté.' : 'Stopped.') : e instanceof Error ? e.message : String(e);
		const msg = addMessage(userId, 'assistant', '', { tools, error: err });
		send(userId, { type: 'assistant', message: msg });
	}
}
