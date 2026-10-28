import { spawn } from 'node:child_process';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import type { BriefQuestion, EvalConfig, Finding, ModelChoice, Role, ShotData, VoiceTrack } from '$lib/types';
import { notesOf, projectNotesOf, refOf, renderOf, videoOf } from './access';
import { extractJson, finalAnswer, runAgent } from './agent';
import { exportToResolve } from './resolve';
import { concatList } from './concat';
import { normBeats, planAfterFix } from './beats';
import { briefAxes, decisionsBlock, openAxes, settle } from './brief';
import { refsBlock, setVideoRef, updateRef, upsertRef } from './refs';
import { wsDetail, wsIndex } from './whatships';
import { activeLessonsFor, countUses, countViolations, createLesson, lessonsBlock, listLessons, modelFor, studioSettings } from './lessons';
import { emit, setStatus } from './hub';
import { ENGINE_DIR, ensureDir, nodeBin, projectDir, realNodePath, shotDir, slugify, videoDir } from './paths';
import * as S from './store';
import { getLot, getTemplate, lotDir, lotFile, pruneRenders, templateDir } from './stills';
import { authFile, hasAuth, kitDir, type UiComponent, type UiKit } from './uikit';
import { ownHouseRules } from './workspace';
import { secret } from './secrets';
import { selfHarvestEnv, studioPort } from './service-auth';
import { applyTranslation, LANG_NAMES, LANGS, repointPaths, translationSource, type Lang } from './translate';
import { fitToVoice, lexiconOf, placeLines, readTake, readVoice, respell, scriptOf, shotsBuilt, voiceDir, voiceJson, voiceMatches, voiceStart, voiceStyle } from './voice';

// Studio jobs. Each job is a run (live log); runs of the same video
// execute one after the other. The production loop of a shot:
//   build/fix (agent) → render (engine) → QA contact sheets → critic (agent, images) →
//   if a required axis is below its threshold and rounds remain: automatic fix → …

export type JobKind = 'storyboard_generate' | 'storyboard_revise' | 'shot_build' | 'shot_fix' | 'render' | 'eval' | 'assemble' | 'asset_generate' | 'sound_design' | 'resolve_export' | 'lesson_distill' | 'reference_analyze' | 'reference_scout' | 'brief_review' | 'stills_render' | 'ui_harvest' | 'ui_login' | 'voice_generate' | 'animatic' | 'video_translate';

const KIND_TITLES: Record<JobKind, string> = {
	voice_generate: 'Voice-over',
	animatic: 'Animatic',
	video_translate: 'Translation',
	storyboard_generate: 'Storyboard — generation',
	storyboard_revise: 'Storyboard — revision',
	shot_build: 'Shot — build',
	shot_fix: 'Shot — retouch',
	render: 'Render',
	eval: 'Evaluation',
	assemble: 'Assembly',
	asset_generate: 'Image — Codex',
	sound_design: 'Sound design',
	resolve_export: 'Export to Resolve',
	lesson_distill: 'Memory — lessons',
	reference_analyze: 'Reference — analysis',
	reference_scout: 'References — shortlist',
	brief_review: 'Framing — interview',
	stills_render: 'Stills — render',
	ui_harvest: 'Interface — harvest',
	ui_login: 'Interface — sign-in'
};

declare global {
	var __studioQueues: Map<string, Promise<unknown>> | undefined;
	var __studioAborts: Map<string, AbortController> | undefined;
}
const queues = (globalThis.__studioQueues ??= new Map());
const aborts = (globalThis.__studioAborts ??= new Map());

/** Maximum number of runs executing at once (agents + renders): studio setting, read at every start. */
const maxParallel = () => Math.max(1, Math.min(8, Number(process.env.STUDIO_PARALLEL) || studioSettings().parallel || 4));

declare global {
	var __studioSlots: { busy: number; waiters: Array<() => void> } | undefined;
}
const slots = (globalThis.__studioSlots ??= { busy: 0, waiters: [] });
async function acquire() {
	if (slots.busy < maxParallel()) {
		slots.busy++;
		return;
	}
	await new Promise<void>((r) => slots.waiters.push(r));
}
function release() {
	slots.busy = Math.max(0, slots.busy - 1);
	// Wakes as many waiting jobs as the limit (possibly raised in the meantime) allows.
	while (slots.waiters.length && slots.busy < maxParallel()) {
		slots.busy++;
		slots.waiters.shift()!();
	}
}

/**
 * Creates the run and queues it. One queue per shot (the steps of a shot stay in
 * order), one queue per video for the rest; at most maxParallel() runs at a time.
 */
export function enqueue(kind: JobKind, input: { projectId: string; videoId?: string | null; parentId?: string | null; title?: string; [k: string]: unknown }): S.Run {
	const run = S.insertRun({ projectId: input.projectId, videoId: input.videoId ?? null, kind, title: input.title ?? KIND_TITLES[kind], input, parentId: input.parentId ?? null });
	const lane = input.lane ? `${input.projectId}:${input.lane}` : input.videoId ? (input.shotKey ? `${input.videoId}:${input.shotKey}` : input.videoId) : `project:${input.projectId}`;
	const ctl = new AbortController();
	aborts.set(run.id, ctl);
	const prev = queues.get(lane) ?? Promise.resolve();
	const next = prev
		.catch(() => {})
		.then(async () => {
			await acquire();
			try {
				await execute(run.id, kind, ctl.signal);
			} finally {
				release();
			}
		})
		.finally(() => aborts.delete(run.id));
	queues.set(lane, next);
	return run;
}

export function cancel(runId: string) {
	const ctl = aborts.get(runId);
	if (ctl) ctl.abort();
	const r = S.getRun(runId);
	if (r && (r.status === 'queued' || r.status === 'running')) setStatus(runId, 'cancelled');
}

async function execute(runId: string, kind: JobKind, signal: AbortSignal) {
	const run = S.getRun(runId);
	if (!run || run.status === 'cancelled') return;
	setStatus(runId, 'running');
	try {
		S.syncWorkspace(run.projectId); // CLAUDE.md follows the current house rules and grid
		const output = await HANDLERS[kind](run, signal);
		if (signal.aborted) return;
		setStatus(runId, 'done', { output });
	} catch (e) {
		if (signal.aborted) return;
		const msg = e instanceof Error ? e.message : String(e);
		emit(runId, 'error', { message: msg });
		setStatus(runId, 'error', { error: msg });
	}
}

// ---------- utilities ----------

function ctxOf(run: S.Run) {
	const project = S.getProject(run.projectId);
	if (!project) throw new Error('project not found');
	const video = run.videoId ? S.getVideo(run.videoId) : null;
	return { project, video, pdir: projectDir(project.id), vdir: video ? videoDir(project.id, video.slug) : null };
}

/** Runs an engine script with Node and returns its final JSON line. */
export function engine(script: string, args: string[], runId: string, signal?: AbortSignal, extraEnv: Record<string, string> = {}): Promise<Record<string, any>> {
	return new Promise((ok, fail) => {
		const child = spawn(nodeBin(), [join(ENGINE_DIR, script), ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...extraEnv, PATH: realNodePath() } });
		signal?.addEventListener('abort', () => child.kill(), { once: true });
		let out = '';
		let err = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => {
			err += d;
			const line = String(d).trim();
			if (line.startsWith('progress')) emit(runId, 'log', { message: line });
		});
		child.on('close', () => {
			const last = out.trim().split('\n').pop() || '';
			try {
				const r = JSON.parse(last);
				if (r.error) return fail(new Error(r.error));
				ok(r);
			} catch {
				fail(new Error(`${script}: unreadable output ${err.slice(-500)}`));
			}
		});
	});
}

const rel = (abs: string, base: string) => abs.slice(base.length + 1).split('\\').join('/');

function storyboardJson(sb: S.Storyboard, shots: S.Shot[], pdir: string) {
	return {
		version: sb.version,
		logline: sb.logline,
		summary: sb.summary,
		shots: shots.map((s) => ({ key: s.key, title: s.title, duration: s.duration, ...s.data, refImage: s.refImage ? rel(s.refImage, pdir) : null }))
	};
}

const STORYBOARD_SCHEMA = `{
  "logline": "the video in one sentence: what the viewer must feel at the end",
  "summary": "3-5 sentences: story arc, visual approach, pacing",
  "shots": [
    {
      "key": "s01",                      // s01, s02… in order
      "title": "short title",
      "duration": 4.0,                   // seconds
      "intent": "what the shot must make the viewer understand/feel",
      "visual": "what we see: composition, elements, camera move",
      "onScreenText": "on-screen text word for word (or empty)",
      "voiceover": "exactly the words spoken over this shot, nothing else: no timings, no quotes, no stage directions (or empty)",
      "beats": [{ "t": 0.0, "state": "state 1", "cursor": "cursor action or empty", "sound": "punctuating sound or empty" }, { "t": 1.2, "state": "state 2", "cursor": "click on “Create task”", "sound": "click" }],
      "transitionIn": "…", "transitionOut": "…",
      "sound": "sound intent",
      "assets": ["brand/logo/…", "library/…"],
      "refMethod": "still" | "codex",
      "refPrompt": "if codex: precise brief of the image",
      "refImage": "videos/<video>/storyboard/refs/s01.png"
    }
  ]
}`;

/** Imports storyboard/draft.json written by the agent; image paths stay relative to the project. A recorded take whose script the draft kept is fitted to the new shots. */
export function importDraft(videoId: string, pdir: string, file: string, runId: string, vdir: string): S.Storyboard {
	if (!existsSync(file)) throw new Error('the agent did not write storyboard/draft.json');
	const raw = extractJson<{ logline?: string; summary?: string; shots?: Array<Record<string, any>> }>(readFileSync(file, 'utf8'));
	if (!raw?.shots?.length) throw new Error('invalid draft.json (no shots)');
	const shots = raw.shots.map((s, i) => {
		const key = typeof s.key === 'string' && /^s\d{2}$/.test(s.key) ? s.key : `s${String(i + 1).padStart(2, '0')}`;
		const img = typeof s.refImage === 'string' && s.refImage ? join(pdir, s.refImage) : null;
		const duration = Math.max(0.5, Number(s.duration) || 3);
		const data: ShotData = {
			intent: String(s.intent ?? ''),
			visual: String(s.visual ?? ''),
			onScreenText: s.onScreenText ? String(s.onScreenText) : '',
			voiceover: s.voiceover ? String(s.voiceover) : '',
			beats: normBeats(s.beats, duration),
			transitionIn: s.transitionIn ? String(s.transitionIn) : '',
			transitionOut: s.transitionOut ? String(s.transitionOut) : '',
			sound: s.sound ? String(s.sound) : '',
			assets: Array.isArray(s.assets) ? s.assets.map(String) : [],
			refMethod: s.refMethod === 'codex' ? 'codex' : 'still',
			refPrompt: s.refPrompt ? String(s.refPrompt) : ''
		};
		return { key, title: String(s.title ?? key), duration, data, refImage: img && existsSync(img) ? img : null };
	});
	const sb = S.createStoryboard(videoId, { logline: String(raw.logline ?? ''), summary: String(raw.summary ?? ''), shots }, runId);
	const video = S.getVideo(videoId), track = readVoice(vdir), kept = S.listShots(sb.id);
	if (video && track && voiceMatches(track, kept)) {
		try {
			fitToVoice(video, kept, track, vdir);
		} catch (e) {
			S.deleteStoryboard(sb.id); // the revision is all or nothing: the previous version stays current
			throw e;
		}
	}
	emit(runId, 'artifact', { kind: 'storyboard', version: sb.version, shots: shots.length });
	return sb;
}

function notesBlock(notes: S.Note[]): string {
	return notes
		.map((n, i) => {
			const where = [n.shotKey ? `shot ${n.shotKey}` : 'whole storyboard', n.t != null ? `at ${n.t.toFixed(2)} s` : null, n.region ? `region x=${(n.region.x * 100).toFixed(0)}% y=${(n.region.y * 100).toFixed(0)}% w=${(n.region.w * 100).toFixed(0)}% h=${(n.region.h * 100).toFixed(0)}%` : null]
				.filter(Boolean)
				.join(', ');
			const route = n.route ? ` [${n.route.scope} · ${n.route.category}${n.route.blocking ? ' · blocking' : ''}]` : '';
			return `${i + 1}. (${where})${route} ${n.body}${n.frame ? `\n   Annotated frame attached: ${basename(n.frame)}` : ''}`;
		})
		.join('\n');
}

/** Language of a film's content: its own (a translated version), otherwise the project's. */
const langOf = (project: S.Project, video: S.Video | null): Lang => video?.language ?? project.settings.language ?? 'fr';

/** Model/effort of the role for this run (one-off override via input.model / input.effort). */
function roleModel(run: S.Run, project: S.Project, role: Role): ModelChoice & { lang: Lang } {
	return { ...modelFor(project, role, { model: run.input.model as string | undefined, effort: run.input.effort as ModelChoice['effort'] | undefined }), lang: langOf(project, run.videoId ? S.getVideo(run.videoId) : null) };
}

export type CaptionHighlight = 'color' | 'box';
export const CAPTION_HIGHLIGHTS: CaptionHighlight[] = ['color', 'box'];

/**
 * Caption look from the brand kit: `brand.json` → `captions` ({ font, color, active, highlight, activeText }) when
 * set, else the kit's semibold (or bold) font, its darkest colour for the text and its most saturated one for the
 * spoken word, highlighted in colour ("box": white on a box of that colour).
 */
export function pickCaptionStyle(brand: Record<string, unknown>, fonts: string[]): { font: string | null; color: string; active: string; highlight: CaptionHighlight; activeText: string } {
	const own = (brand.captions ?? {}) as { font?: string; color?: string; active?: string; highlight?: string; activeText?: string };
	const hex = Object.values((brand.colors ?? {}) as Record<string, unknown>).filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));
	const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
	const lum = (c: string) => rgb(c).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
	const sat = (c: string) => Math.max(...rgb(c)) - Math.min(...rgb(c));
	const plain = fonts.filter((f) => !/italic|mono/i.test(f));
	const font = (own.font && fonts.includes(own.font) ? own.font : null) ?? plain.find((f) => /semi-?bold/i.test(f)) ?? plain.find((f) => /bold/i.test(f) && !/extra|black/i.test(f)) ?? plain.find((f) => /medium|regular/i.test(f)) ?? fonts[0] ?? null;
	return {
		font,
		color: own.color ?? [...hex].sort((a, b) => lum(a) - lum(b))[0] ?? '#111111',
		active: own.active ?? [...hex].filter((c) => lum(c) > 0.08 && lum(c) < 0.8).sort((a, b) => sat(b) - sat(a))[0] ?? '#2563eb',
		highlight: CAPTION_HIGHLIGHTS.find((h) => h === own.highlight) ?? 'color',
		activeText: own.activeText ?? '#ffffff'
	};
}

function captionStyle(pdir: string) {
	const dir = join(pdir, 'brand', 'fonts');
	const fonts = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f)) : [];
	let brand: Record<string, unknown> = {};
	try {
		brand = JSON.parse(readFileSync(join(pdir, 'brand', 'brand.json'), 'utf8'));
	} catch {}
	const s = pickCaptionStyle(brand, fonts);
	return { ...s, font: s.font ? join(dir, s.font) : null };
}

/** Sound effects level asked for a mix (1 = as designed); anything that is not a positive number gives 1. The engine bounds it (−6 to +3 dB). */
export function sfxGainOf(v: unknown): number {
	const g = typeof v === 'string' ? Number(v) : v;
	return typeof g === 'number' && Number.isFinite(g) && g > 0 ? g : 1;
}

/**
 * Legibility rule by format: in landscape, only the text that carries the message must read
 * on a phone; in portrait (meant for mobile), the text that carries the action too.
 */
export function legibilityRule(format: { width: number; height: number }): string {
	const vertical = format.height > format.width * 1.05;
	const common = `- **Text that carries the message** (titles, lines of the locked message, the storyboard's on-screen text, end shot): legible at 360 px wide, held at least 0.4 s per word + 0.5 s.`;
	return vertical
		? `## Legibility (vertical format ${format.width}×${format.height}: meant for mobile)\n${common}\n- **Text that carries the action** (what the cursor clicks, the state that changes, the summary or value to notice): also legible at 360 px wide; enlarge or zoom in on the action rather than showing the whole interface.\n- **Filler text** (secondary content of a list, long body of an email nobody reads): may stay small, but sharp and non-overlapping.`
		: `## Legibility (horizontal format ${format.width}×${format.height})\n${common}\n- **Ambient interface text** (content of cards and lists, email bodies, secondary labels): NO requirement to read on a phone; it only has to be sharp, non-overlapping, not cropped and recognizable. Do not penalize its small size.`;
}

/** Brief decisions + the format's legibility rule + reference style guides + active lessons, appended to the prompt. */
function withLessons(project: S.Project, prompt: string, videoId?: string | null): string {
	const video = videoId ? S.getVideo(videoId) : null;
	// decisionsBlock (brief.ts) may title its block in French or English: accept both.
	const decisions = video && !/## (Décisions de cadrage|Brief decisions)/.test(prompt) ? decisionsBlock(video.briefState) : '';
	const legibility = video && !/## (Lisibilité|Legibility)/.test(prompt) ? legibilityRule(video.format) : '';
	const refs = videoId ? refsBlock(videoId) : '';
	const block = lessonsBlock(project.id);
	if (block) countUses(activeLessonsFor(project.id));
	// Taste belongs to the project: its doctrine and rules win over any studio lesson that contradicts them.
	const own = block
		? `## Studio lessons vs. this project\nStudio lessons are craft, not taste. Where one contradicts this project's doctrine (brand/motion.md)${ownHouseRules(project.id) ? ' or its rules (brand/house-rules.md)' : ''}, the project wins.`
		: '';
	return [prompt, decisions, legibility, refs, own, block].filter(Boolean).join('\n\n');
}

/**
 * Briefing interview: the director checks the brief (and the answers already given) against the
 * brief axes and the project's doctrine. It settles what can be inferred and asks precise
 * questions for the rest. Every axis ends decided or ignored; the storyboard waits for "ready".
 */
const briefReview: Handler = async (run, signal) => {
	const { project, video, pdir } = ctxOf(run);
	if (!video) throw new Error('video required');
	const prev = video.briefState;
	S.setBriefState(video.id, { ...prev, status: 'reviewing' });
	const axes = briefAxes();
	const brand = S.readBrand(project.id);
	const refs = refsBlock(video.id);
	const answered = [
		...Object.entries(prev.decisions).map(([k, v]) => `- ${k}: ${v}`),
		...prev.ignored.map((k) => `- ${k}: IGNORED (do not ask again)`)
	].join('\n');
	const prompt = `You are preparing the brief for the video "${video.title}" (${video.format.width}×${video.format.height}, ${video.format.fps} fps, target ${video.targetDuration} s) of the project ${project.name}. No storyboard will be written until every axis below is decided or ignored.

## User's brief
${video.brief || '(empty)'}

## Axes already settled by the user
${answered || '(none)'}

## Project doctrine (motion.md, excerpt) — what it already settles must not be asked again
${brand.motion.slice(0, 3000)}

${refs ? `## Attached references\n${refs.slice(0, 1500)}\n` : ''}
## Brief axes (typical directions in brackets)
${axes.map((a) => `- ${a.key} — ${a.label}: ${a.hint} [${a.suggestions.join(' | ')}]`).join('\n')}

## Instructions
- For each open axis, settle the direction if the brief or the doctrine clearly give it, phrased precisely (numbers, exact lines).
- Put an axis in "ignored" only if the brief explicitly rules it out (e.g. "no sound"). Otherwise, ask ONE precise question: 2 to 4 concrete options, starting from the typical directions adapted to this film, plus your default proposal.
- No vague question, no question whose answer is in the doctrine.
- "message" requires the exact lines; "verite_produit" requires the list of features actually shown.
- At most 7 questions at a time, the most structuring ones first.

Answer only with this JSON:
{"decisions": {"<axis>": "settled direction"}, "ignored": ["<axis>"], "questions": [{"field": "<axis>", "question": "…", "why": "what it changes in the film", "options": ["…", "…"], "default": "your proposal"}], "summary": "the film in 2 sentences, as briefed at this stage"}`;
	const res = await runAgent({ runId: run.id, cwd: pdir, prompt, role: `You are the studio's director: before shooting, you get precise decisions. Answer only in JSON.`, noTools: true, maxTurns: 2, ...roleModel(run, project, 'director'), signal });
	type Out = { decisions?: Record<string, string>; ignored?: string[]; questions?: BriefQuestion[]; summary?: string };
	let parsed = extractJson<Out>(res.text);
	for (const t of [...res.texts].reverse()) {
		if (parsed?.decisions || parsed?.questions) break;
		parsed = extractJson<Out>(t);
	}
	if (!parsed) {
		S.setBriefState(video.id, { ...prev, status: prev.questions.length ? 'interview' : 'draft' });
		throw new Error('unreadable director response');
	}
	const known = new Set(axes.map((a) => a.key));
	const decisions = { ...prev.decisions };
	const ignored = [...prev.ignored];
	// What the director settles itself is marked inferred: a later change of the brief re-derives it (forgetInferred).
	const inferred = new Set(prev.inferred ?? []);
	for (const [k, v] of Object.entries(parsed.decisions ?? {}))
		if (known.has(k) && !ignored.includes(k) && !decisions[k] && String(v).trim()) {
			decisions[k] = String(v).trim();
			inferred.add(k);
		}
	for (const k of parsed.ignored ?? []) if (known.has(k) && !decisions[k] && !ignored.includes(k)) ignored.push(k);
	const questions = (parsed.questions ?? []).filter((q) => q && known.has(q.field)).slice(0, 7);
	const next = settle({ status: 'interview', decisions, inferred: [...inferred].filter((k) => decisions[k]), ignored, questions, summary: parsed.summary ?? prev.summary, reviewedAt: Date.now() }, axes);
	// An axis left open without a question: the director forgot it → minimal question on its typical directions.
	for (const k of openAxes(next, axes)) {
		if (next.questions.some((q) => q.field === k)) continue;
		const a = axes.find((x) => x.key === k)!;
		next.questions.push({ field: k, question: langOf(project, video) === 'fr' ? `${a.label} : quelle direction ?` : `${a.label}: which direction?`, why: a.hint, options: a.suggestions, default: a.suggestions[0] });
	}
	const final = settle(next, axes);
	S.setBriefState(video.id, final);
	emit(run.id, 'artifact', { kind: 'brief', status: final.status, questions: final.questions.length, ignored: final.ignored });
	return { ready: final.status === 'ready', questions: final.questions.length };
};

// ---------- handlers ----------

type Handler = (run: S.Run, signal: AbortSignal) => Promise<unknown>;

const DIRECTOR_ROLE = `You are the studio's director and art director. You write motion design storyboards that are precise, well-paced and distinctive, faithful to the project's brand guidelines.`;
const ANIMATOR_ROLE = `You are the studio's animator: you write motion design shots in code (scene.html) with the /engine/motion.js runtime, strictly following the render contract and the brand guidelines. You always check your work by looking at rendered stills.`;
const CRITIC_ROLE = `You are a demanding motion design director, not the author proud of their work. You score renders from contact sheets, without indulgence, and you answer only with the requested JSON.`;

const storyboardGenerate: Handler = async (run, signal) => {
	const { project, video, pdir, vdir } = ctxOf(run);
	if (!video || !vdir) throw new Error('video required');
	const sbDir = ensureDir(join(vdir, 'storyboard'));
	ensureDir(join(sbDir, 'refs'));
	const draft = join(sbDir, 'draft.json');
	if (existsSync(draft)) copyFileSync(draft, join(sbDir, `draft.prev.json`));
	if (video.briefState.status !== 'ready') throw new Error('brief incomplete: finish the briefing interview before generating the storyboard');
	const vrel = `videos/${video.slug}`;
	const direction = typeof run.input.direction === 'string' ? run.input.direction.trim() : '';
	// Each storyboard gets its own reference folder, so a new take never overwrites the previous one's images.
	const refs = `${vrel}/storyboard/refs/v${(S.getStoryboard(video.id)?.version ?? 0) + 1}`;
	const prompt = `Write the storyboard of the video "${video.title}" for the project ${project.name}.

Format: ${video.format.width}×${video.format.height}, ${video.format.fps} fps. Target duration: ${video.targetDuration} s (±10%).

## Brief
${video.brief || '(no brief)'}

${decisionsBlock(video.briefState)}
${direction ? `
## Creative direction for this take
This storyboard is an alternative take, to be compared with the previous ones: it must be a clearly different film, not a variation. The direction below overrides the brief's act structure, hook and arc wherever they conflict. Keep everything else: objective, audience, locked lines (word for word), format, duration, product truth, the brand doctrine and the house rules.

${direction}
` : ''}
## Method
1. Read brand/motion.md, brand/DESIGN.md and brand/brand.json. Browse library/.
2. Break it down into shots (2 to 6 s each, the cadence the brief and the doctrine call for, a legible hook from the very first second). For each shot, write the BEAT MAP: timestamped states, each with the cursor action and the sound that punctuates it (empty if none). This is the choreography the animator and the sound designer will follow. Follow the studio and project rules (CLAUDE.md), the doctrine and the brief decisions below.
   Voice-over (when the film has one): write the whole script FIRST, as one continuous text that reads well aloud (spoken rhythm, about 2.5 words per second, room left for the image to breathe), then split it across the shots in order: each shot's "voiceover" holds exactly its words, and the lines put end to end give back the script. The studio records it in one take, then cuts the shots to the recorded words: plan each shot around its line, and leave unvoiced the shots that must breathe (a reveal, the end card).
3. Write the storyboard to \`${vrel}/storyboard/draft.json\` in this format:
${STORYBOARD_SCHEMA}
4. Reference image for each shot (the shot's most telling state):
   - "still" (default, for anything UI, type, logo, diagram): write \`${refs}/<key>/scene.html\` (static or near-static scene, with the runtime) then render it: \`node "${ENGINE_DIR.split('\\').join('/')}/render.mjs" --scene ${refs}/<key> --project . --stills 0 --stills-dir ${refs}/<key>\` and set refImage = \`${refs}/<key>/t0_00.png\`.
   - "codex" (illustration, texture, non-UI visual): \`node "${ENGINE_DIR.split('\\').join('/')}/codex-image.mjs" --prompt "<refPrompt>" --out ${refs}/<key>.png\`.
   Look at every image produced; redo it if it does not serve the reading of the shot.
5. End with a 5-line summary of your creative choices.`;
	await runAgent({ runId: run.id, cwd: pdir, prompt: withLessons(project, prompt, video.id), role: DIRECTOR_ROLE, ...roleModel(run, project, 'director'), signal });
	const sb = importDraft(video.id, pdir, draft, run.id, vdir);
	return { storyboardVersion: sb.version };
};

const storyboardRevise: Handler = async (run, signal) => {
	const { project, video, pdir, vdir } = ctxOf(run);
	if (!video || !vdir) throw new Error('video required');
	const sb = S.getStoryboard(video.id);
	if (!sb) throw new Error('no storyboard to revise');
	const notes = notesOf(video.id, (run.input.noteIds as string[]) ?? []);
	const noteIds = notes.map((n) => n.id);
	const sbDir = ensureDir(join(vdir, 'storyboard'));
	writeFileSync(join(sbDir, `v${sb.version}.json`), JSON.stringify(storyboardJson(sb, S.listShots(sb.id), pdir), null, 1));
	const vrel = `videos/${video.slug}`;
	S.setNotesStatus(noteIds, 'open', run.id);
	const prompt = `Revise storyboard v${sb.version} of "${video.title}" (file \`${vrel}/storyboard/v${sb.version}.json\`) by applying the user's annotations below. Keep everything that is not targeted; do not reinvent shots that have no annotation.

## Annotations
${notesBlock(notes)}

## Instructions
- Write the complete revised version to \`${vrel}/storyboard/draft.json\` (same format as v${sb.version}.json; the keys s01… are renumbered in the final order).
- Reuse the reference images of unchanged shots (same refImage). Regenerate the one of a modified shot as described in CLAUDE.md (still rendered from \`${vrel}/storyboard/refs/<key>-v${sb.version + 1}/scene.html\`, or codex to \`${vrel}/storyboard/refs/<key>-v${sb.version + 1}.png\`).
- End with the list of what you changed, annotation by annotation.`;
	await runAgent({ runId: run.id, cwd: pdir, prompt: withLessons(project, prompt, video.id), role: DIRECTOR_ROLE, images: notes.map((n) => n.frame).filter((f): f is string => !!f && existsSync(f)), ...roleModel(run, project, 'director'), signal });
	const next = importDraft(video.id, pdir, join(sbDir, 'draft.json'), run.id, vdir);
	S.setNotesStatus(noteIds, 'applied', run.id);
	const worth = notes.filter((n) => n.route?.lesson && n.route.lesson !== 'none');
	if (worth.length) enqueueDistill(run, { noteIds: worth.map((n) => n.id), reason: 'notes' });
	return { storyboardVersion: next.version };
};

function shotContext(videoId: string, shotKey: string) {
	const sb = S.getStoryboard(videoId);
	if (!sb) throw new Error('no storyboard');
	const shots = S.listShots(sb.id);
	const shot = shots.find((s) => s.key === shotKey);
	if (!shot) throw new Error(`Shot ${shotKey} not found in storyboard v${sb.version}`);
	const i = shots.indexOf(shot);
	return { sb, shots, shot, prev: shots[i - 1] ?? null, next: shots[i + 1] ?? null };
}

function shotBrief(shot: S.Shot, prev: S.Shot | null, next: S.Shot | null): string {
	const d = shot.data;
	return `Shot ${shot.key} — "${shot.title}" — ${shot.duration} s
- Intent: ${d.intent}
- Visual: ${d.visual}
- On-screen text: ${d.onScreenText || '(none)'}
- Voice-over: ${d.voiceover || '(none)'}${d.voiceWords?.length ? `\n- Recorded voice-over, word by word (seconds from the shot start; sync the image to these words): ${d.voiceWords.map((w) => `${w.t.toFixed(2)} ${w.w}`).join(' · ')}` : ''}${d.directorNotes?.length ? `\n- Director's notes, already applied to this shot (decisions: they override the original plan, the beat map below reflects them; never undo them): ${d.directorNotes.map((n, i) => `(${i + 1}) ${n}`).join(' ')}` : ''}
- Beat map: ${d.beats.map((b) => `${b.t.toFixed(2)} s → ${b.state}${b.cursor ? ` [cursor: ${b.cursor}]` : ''}${b.sound ? ` [sound: ${b.sound}]` : ''}`).join('; ')}
- Transition in: ${d.transitionIn || '—'} · out: ${d.transitionOut || '—'}
- Sound: ${d.sound || '—'}
- Assets: ${(d.assets ?? []).join(', ') || '—'}
- Previous shot: ${prev ? `${prev.key} "${prev.title}" (its end: ${prev.data.beats.at(-1)?.state ?? prev.data.visual})` : 'none (opening)'}
- Next shot: ${next ? `${next.key} "${next.title}" (its start: ${next.data.beats[0]?.state ?? next.data.visual})` : 'none (ending)'}`;
}

const shotBuild: Handler = async (run, signal) => {
	const { project, video, pdir } = ctxOf(run);
	if (!video) throw new Error('video required');
	const key = String(run.input.shotKey);
	const { shot, prev, next } = shotContext(video.id, key);
	const dir = ensureDir(shotDir(project.id, video.slug, key));
	const drel = rel(dir, pdir);
	const prompt = `Animate the following shot in \`${drel}/scene.html\`.

${shotBrief(shot, prev, next)}

Format: ${video.format.width}×${video.format.height}, ${video.format.fps} fps, duration exactly ${shot.duration} s.
${shot.refImage ? `The storyboard reference image is attached: it is the key state to reach, not a pixel-by-pixel constraint.` : ''}

Method:
1. Re-read brand/motion.md. Write the scene following the states (beats) to the letter.
2. Render stills at the key instants (at least the start, every beat, the end) and LOOK at them. Fix until every frame serves the intent. Check that no text that matters is cropped by accident and that the framing is the one the doctrine asks for.
3. Ensure continuity: the first frame continues the end of the previous shot, the last one sets up the next.
4. Do not launch the final video render: the studio takes care of it.`;
	await runAgent({ runId: run.id, cwd: pdir, prompt: withLessons(project, prompt, video.id), role: ANIMATOR_ROLE, images: shot.refImage && existsSync(shot.refImage) ? [shot.refImage] : [], ...roleModel(run, project, 'animator'), signal });
	if (!existsSync(join(dir, 'scene.html'))) throw new Error('the agent did not write scene.html');
	enqueueFollowUp(run, 'render', { shotKey: key, round: Number(run.input.round ?? 0), auto: run.input.auto !== false });
	return { scene: join(dir, 'scene.html') };
};

const shotFix: Handler = async (run, signal) => {
	const { project, video, pdir } = ctxOf(run);
	if (!video) throw new Error('video required');
	const key = String(run.input.shotKey);
	const { shot, prev, next } = shotContext(video.id, key);
	const dir = shotDir(project.id, video.slug, key);
	if (!existsSync(join(dir, 'scene.html'))) throw new Error(`Shot ${key} is not built yet`);
	const drel = rel(dir, pdir);
	const notes = notesOf(video.id, (run.input.noteIds as string[]) ?? []);
	const noteIds = notes.map((n) => n.id);
	const findings = (run.input.findings as Finding[]) ?? [];
	// Free-text direction (API, or a director's note not tied to a frame): weighs like a user annotation.
	const direction = typeof run.input.direction === 'string' ? run.input.direction.trim() : '';
	const decisions = [...notes.map((n) => n.body.trim()), ...(direction ? [direction] : [])];
	const lastRender = S.listRenders(video.id, key)[0];
	const images = [...notes.map((n) => n.frame), lastRender?.qa.contact].filter((f): f is string => !!f && existsSync(f));
	const beatsFile = join(dir, 'beats.json');
	if (existsSync(beatsFile)) unlinkSync(beatsFile);
	const prompt = `Surgical touch-up of the shot \`${drel}/scene.html\`. Change the minimum necessary; everything not targeted must stay pixel-identical.

${shotBrief(shot, prev, next)}

${notes.length ? `## User annotations (take priority)\n${notesBlock(notes)}\n` : ''}${direction ? `## Director's direction (takes priority)\n${direction}\n` : ''}${findings.length ? `## Defects found by the critic (round ${run.input.round ?? '?'})\n${findings.map((f, i) => `${i + 1}. [${f.severity} · ${f.axis}${f.t != null ? ` · ${f.t.toFixed(2)} s` : ''}] ${f.problem} → ${f.fix}`).join('\n')}\n` : ''}
${images.length ? `Attached images: ${notes.filter((n) => n.frame).length ? 'the exact frame of each annotation (the targeted region is boxed), then ' : ''}the contact sheet of the last render.` : ''}
${decisions.length ? `
## These notes change the plan
They are the director's decisions: wherever they conflict with the storyboard above (beat map, timings, even the sync to a voice-over word), the notes win. Apply them fully, do not water them down to stay close to the old plan; keep the shot's duration and whatever must stay synced that the notes do not mention. Once the scene is fixed, write \`${drel}/beats.json\` with the plan as the scene now plays it:
{"beats": [{"t": 0.0, "state": "…", "cursor": "", "sound": ""}, …], "visual": "…", "onScreenText": "…"}
The studio replaces the shot's plan with it, so the critic and any later fix judge the shot against what was decided, not against the old plan.
` : ''}
Method: locate the relevant code precisely, fix it, then render stills around the targeted instants and look at them to check. Do not launch the final render. End with the list of fixes, point by point.`;
	if (notes.length) S.setNotesStatus(noteIds, 'open', run.id);
	await runAgent({ runId: run.id, cwd: pdir, prompt: withLessons(project, prompt, video.id), role: ANIMATOR_ROLE, images, ...roleModel(run, project, 'animator'), signal });
	// The decisions become the shot's reference: updated beat map + the notes themselves.
	if (decisions.length) {
		const plan = existsSync(beatsFile) ? extractJson<Record<string, unknown>>(readFileSync(beatsFile, 'utf8')) : null;
		// Laid over the shot as it is now, not as it was when the agent started.
		const current = S.listShots(shot.storyboardId).find((x) => x.id === shot.id) ?? shot;
		const { data, beats } = planAfterFix(current.data, plan, decisions, shot.duration);
		S.updateShot(shot.id, { data });
		emit(run.id, 'log', { message: beats ? `plan of ${key} updated from the notes (${beats.length} beats)` : `notes recorded on ${key} (the animator did not write beats.json: the beat map is unchanged)` });
	}
	if (notes.length) {
		S.setNotesStatus(noteIds, 'applied', run.id);
		const worth = notes.filter((n) => n.route?.lesson && n.route.lesson !== 'none');
		if (worth.length) enqueueDistill(run, { noteIds: worth.map((n) => n.id), reason: 'notes' });
	}
	enqueueFollowUp(run, 'render', { shotKey: key, round: Number(run.input.round ?? 0), auto: run.input.auto !== false });
	return { fixed: notes.length + findings.length + (direction ? 1 : 0) };
};

const renderShot: Handler = async (run, signal) => {
	const { project, video, pdir } = ctxOf(run);
	if (!video) throw new Error('video required');
	const key = String(run.input.shotKey);
	const dir = shotDir(project.id, video.slug, key);
	const version = S.nextRenderVersion(video.id, key);
	const tag = `r${String(version).padStart(3, '0')}`;
	const out = join(dir, 'renders', `${tag}.mp4`);
	emit(run.id, 'log', { message: `rendering ${key} ${tag}…` });
	const r = await engine('render.mjs', ['--scene', dir, '--project', pdir, '--out', out, '--fps', String(video.format.fps), '--sub', '8', '--shutter', '0.5', '--progress'], run.id, signal);
	if (r.errors?.length) emit(run.id, 'log', { message: `scene console errors: ${r.errors.slice(0, 3).join(' | ')}` });
	// Keep the source of every render: the next take rewrites scene.html in place.
	if (existsSync(join(dir, 'scene.html'))) copyFileSync(join(dir, 'scene.html'), join(dir, 'renders', `${tag}.scene.html`));
	const cfg = project.settings.eval;
	const qaDir = join(dir, 'qa', tag);
	const q = await engine('qa.mjs', ['--video', out, '--dir', qaDir, '--fps', String(cfg.contactFps), '--cols', '6'], run.id, signal);
	const render = S.createRender({ videoId: video.id, shotKey: key, version, file: out, qa: { contact: q.contact?.file, phone: q.phone?.file, contactFps: cfg.contactFps, duration: r.duration }, runId: run.id });
	emit(run.id, 'artifact', { kind: 'render', renderId: render.id, shotKey: key, version, renderMs: r.renderMs });
	if (run.input.auto !== false) enqueueFollowUp(run, 'eval', { renderId: render.id, shotKey: key, round: Number(run.input.round ?? 0) });
	return { renderId: render.id, version };
};

const evaluate: Handler = async (run, signal) => {
	const { project, video, pdir } = ctxOf(run);
	if (!video) throw new Error('video required');
	const render = renderOf(video.id, String(run.input.renderId));
	if (!render) throw new Error('render not found');
	const cfg: EvalConfig = project.settings.eval;
	const round = Number(run.input.round ?? 0);
	const key = render.shotKey;
	const shotInfo = key ? shotContext(video.id, key) : null;
	// Strip of 12 frames around the busiest instant (the middle of the shot by default).
	const mid = (render.qa.duration ?? 4) / 2;
	const qaDir = join(render.file, '..', '..', 'qa', `r${String(render.version).padStart(3, '0')}`);
	const q = await engine('qa.mjs', ['--video', render.file, '--dir', qaDir, '--fps', String(cfg.contactFps), '--cols', '6', '--strip', String(mid), '--phone', 'false'], run.id, signal);
	const images = [render.qa.contact, q.strip?.file, render.qa.phone].filter((f): f is string => !!f && existsSync(f));
	const axes = cfg.axes.map((a) => `- ${a.key} — ${a.label} (threshold ${a.threshold}${a.required ? ', required' : ''}): ${a.description}`).join('\n');
	const prompt = `Evaluate this render${key ? ` of shot ${key}` : ''} of the video "${video.title}".

${shotInfo ? shotBrief(shotInfo.shot, shotInfo.prev, shotInfo.next) : `Full video, storyboard: ${S.getStoryboard(video.id)?.logline ?? ''}`}

Attached images, in order:
1. Contact sheet: ${cfg.contactFps} frames/s, read left→right then top→bottom (frame no. i is at t = i/${cfg.contactFps} s).
2. Strip of 12 consecutive frames around ${mid.toFixed(1)} s (jerks, overlaps).
${render.qa.phone ? '3. Phone preview (360 px wide, 1 frame/s).' : ''}

The brand guidelines are in brand/motion.md and brand/DESIGN.md (you may read them).

${legibilityRule(video.format)}
The "lisibilite" axis is scored with this rule (it overrides the axis description): do not take points off for small but sharp ambient text.

Score each axis from 1 to 10:
${axes}

Any violation of a "Blocking" list — the studio rules or the project's rules (CLAUDE.md, brand/house-rules.md) — is a "blocking" finding and caps the axis concerned at 4. Judge taste against THIS project's doctrine (brand/motion.md), not a generic one: what it bans is a defect, what it asks for is required (a loud doctrine penalizes timid motion as much as a calm one penalizes excess). Look in particular for: cropped or overlapping text that matters, a jump or a dead frame nobody chose, a ghost or residue, a gesture the doctrine excludes, an off-brand colour, typeface or logo, a storyboard state missing or in the wrong order.${shotInfo?.shot.data.directorNotes?.length ? `

This shot carries director's notes (listed in the shot above): they are decisions already taken. Judge the render against the beat map as written, which includes them; a timing or a choice that follows a note is not a defect, and no finding may propose to undo a note.` : ''}

Answer only with this JSON:
{"scores": {"<axis>": <1-10>, …}, "summary": "2 sentences", "findings": [{"t": <seconds or null>, "axis": "<axis>", "severity": "blocking|major|minor", "problem": "…", "fix": "concrete, localized fix", "lesson": <number of the violated lesson or null>}], "lessonsViolated": [<numbers of the violated lessons>]}
At most 5 findings, the most important first. Check every lesson listed below: a violated lesson is worth at least one "major" finding.

Budget: the attached sheets are usually enough. You may run at most 5 checks with tools (read the brand guidelines, extract a specific frame from the render); then conclude with the JSON.`;
	const task = { runId: run.id, cwd: pdir, prompt: withLessons(project, prompt), role: CRITIC_ROLE, images, noTools: false, maxTurns: Number(run.input.maxTurns) || 12, ...roleModel(run, project, 'critic'), signal };
	const res = await finalAnswer<{ scores?: unknown }>(task, await runAgent(task), (x) => !!x?.scores, 'Your check budget is spent. Deliver your verdict now with what you have observed: only the requested JSON (scores, summary, findings, lessonsViolated).');
	type Verdict = { scores?: Record<string, number>; summary?: string; findings?: Finding[]; lessonsViolated?: unknown[] };
	let parsed = extractJson<Verdict>(res.text);
	for (const t of [...res.texts].reverse()) {
		if (parsed?.scores) break;
		parsed = extractJson<Verdict>(t);
	}
	if (!parsed?.scores) throw new Error('unreadable critic response');
	const scores: Record<string, number> = {};
	for (const a of cfg.axes) scores[a.key] = Math.max(1, Math.min(10, Number(parsed.scores[a.key]) || 1));
	const pass = cfg.axes.every((a) => !a.required || scores[a.key] >= a.threshold);
	const findings = (parsed.findings ?? []).slice(0, 5);
	const violated = (parsed.lessonsViolated ?? []).map((x) => Number(String(x).replace(/^L/i, ''))).filter((n) => Number.isInteger(n) && n > 0);
	if (violated.length) {
		countViolations(violated);
		emit(run.id, 'log', { message: `lessons violated: ${violated.map((n) => `L${n}`).join(', ')}` });
	}
	const ev = S.createEval({ renderId: render.id, videoId: video.id, shotKey: key, round, scores, pass, findings, summary: parsed.summary ?? '', runId: run.id });
	emit(run.id, 'artifact', { kind: 'eval', evalId: ev.id, pass, scores });
	if (!pass && key && round + 1 < cfg.maxRounds && run.input.auto !== false) {
		enqueueFollowUp(run, 'shot_fix', { shotKey: key, findings, round: round + 1, title: `Shot ${key} — auto fix (round ${round + 1})` });
	} else {
		if (!pass) emit(run.id, 'log', { message: round + 1 >= cfg.maxRounds ? `thresholds not met after ${cfg.maxRounds} rounds: your call` : 'thresholds not met' });
		// End of loop: if it required at least one fix, draw lessons from it.
		if (key && round > 0) enqueueDistill(run, { shotKey: key, reason: 'loop' });
	}
	return { evalId: ev.id, pass, scores };
};

/** Weighted overall score of an evaluation. */
export function weightedScore(scores: Record<string, number>, cfg: EvalConfig): number {
	let sw = 0, s = 0;
	for (const a of cfg.axes) {
		sw += a.weight;
		s += a.weight * (scores[a.key] ?? 0);
	}
	return sw ? s / sw : 0;
}

/**
 * Render kept for a shot: the most recent approved render, otherwise the one with the best
 * overall score (an automatic fix can make things worse), otherwise the most recent if it is not evaluated.
 * Only renders of the current take count: a new storyboard reuses the keys s01… for different shots.
 */
export function bestRender(videoId: string, shotKey: string, cfg: EvalConfig): (S.Render & { score: number | null }) | null {
	const since = S.takeStart(videoId);
	const renders = S.listRenders(videoId, shotKey).filter((r) => r.createdAt >= since);
	if (!renders.length) return null;
	const evals = S.listEvals(videoId);
	const scored = renders.map((r) => {
		const e = evals.find((x) => x.renderId === r.id);
		return { ...r, pass: e?.pass ?? false, score: e ? weightedScore(e.scores, cfg) : null };
	});
	const passed = scored.filter((r) => r.pass);
	if (passed.length) return passed[0];
	if (scored[0].score == null) return scored[0];
	return scored.filter((r) => r.score != null).sort((a, b) => b.score! - a.score!)[0];
}

const assemble: Handler = async (run, signal) => {
	const { project, video, vdir, pdir } = ctxOf(run);
	if (!video || !vdir) throw new Error('video required');
	const sb = S.getStoryboard(video.id);
	if (!sb) throw new Error('no storyboard');
	const shots = S.listShots(sb.id);
	const files: string[] = [];
	for (const s of shots) {
		const r = bestRender(video.id, s.key, project.settings.eval);
		if (!r) throw new Error(`Shot ${s.key} has no render`);
		emit(run.id, 'log', { message: `${s.key}: render ${r.version}${r.score != null ? ` (score ${r.score.toFixed(1)})` : ''}` });
		files.push(r.file);
	}
	const version = S.nextRenderVersion(video.id, null);
	const tag = `v${String(version).padStart(3, '0')}`;
	const outDir = ensureDir(join(vdir, 'renders'));
	const list = join(outDir, `${tag}.txt`);
	writeFileSync(list, concatList(files));
	const out = join(outDir, `${tag}.mp4`);
	const { default: ffmpegPath } = await import('ffmpeg-static');
	await new Promise<void>((ok, fail) => {
		const c = spawn(ffmpegPath as unknown as string, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { windowsHide: true });
		signal.addEventListener('abort', () => c.kill(), { once: true });
		let err = '';
		c.stderr.on('data', (d) => (err += d));
		c.on('close', (code) => (code === 0 ? ok() : fail(new Error(`concat: ${err}`))));
	});
	const q = await engine('qa.mjs', ['--video', out, '--dir', join(outDir, 'qa', tag), '--fps', '2', '--cols', '8'], run.id, signal);
	const render = S.createRender({ videoId: video.id, shotKey: null, version, file: out, qa: { contact: q.contact?.file, phone: q.phone?.file, contactFps: 2, duration: q.duration }, runId: run.id });
	emit(run.id, 'artifact', { kind: 'render', renderId: render.id, shotKey: null, version });
	void pdir;
	return { renderId: render.id, version };
};

const soundDesign: Handler = async (run, signal) => {
	const { project, video, vdir, pdir } = ctxOf(run);
	if (!video || !vdir) throw new Error('video required');
	const base = S.listRenders(video.id, null).find((r) => !r.qa.hasAudio);
	if (!base) throw new Error('assemble the video first');
	const sb = S.getStoryboard(video.id);
	if (!sb) throw new Error('no storyboard');
	let t0 = 0;
	const timeline = S.listShots(sb.id)
		.map((s) => {
			const line = `${s.key} [${t0.toFixed(2)} → ${(t0 + s.duration).toFixed(2)} s] "${s.title}" — intended sound: ${s.data.sound || '—'}\n` + s.data.beats.map((b) => `   ${(t0 + b.t).toFixed(2)} s: ${b.state}`).join('\n');
			t0 += s.duration;
			return line;
		})
		.join('\n');
	const track = readVoice(vdir);
	const voice = track && voiceMatches(track, S.listShots(sb.id)) ? track : null;
	const voiceText = voice ? voice.lines.map((l) => `   ${(voice.start + l.start).toFixed(2)} → ${(voice.start + l.end).toFixed(2)} s (${l.key}): "${l.text}"`).join('\n') : '';
	const music = S.listAssets(project.id).filter((a) => a.kind === 'audio');
	const adir = ensureDir(join(vdir, 'audio'));
	const arel = rel(adir, pdir);
	const cat = await engine('sfx.mjs', ['--catalog'], run.id, signal);
	type Fam = { family: string; variants: number; duration: number; examples?: string[] };
	const fams = cat.bank as Fam[];
	const catalogText = fams.filter((b) => !b.examples).map((b) => `${b.family} (×${b.variants}, ~${b.duration} s)`).join(', ');
	const realText = fams.filter((b) => b.examples).map((b) => `- ${b.family} (×${b.variants}, ~${b.duration} s): ${b.examples!.join(' · ')}`).join('\n');
	type Mus = { id: string; title: string; artist: string; genre: string; duration: number };
	const bankMusic = (cat.music ?? []) as Mus[];
	const style = (['sobre', 'equilibre', 'musique'] as const).find((x) => x === run.input.style) ?? 'equilibre';
	const dose = {
		sobre: `MIX "sobre" (sparse): 2 to 4 sounds per 10 s in total. Only the major gestures and ONE punctuation (the film's high point, e.g. the logo locking in). No interface sound for micro-movements. No music; a very low bed is allowed if the silence feels empty.`,
		equilibre: `MIX "equilibre" (balanced): one sound per GESTURE (not per event), at most one punctuation per shot, a very low bed under everything for continuity. Interface sounds only for the cursor's decisive actions (the click that triggers, not every hover).`,
		musique: `MIX "musique" (with music): a track from the bank carries continuity and rhythm; sound effects become rare (2 to 4 sounds per 10 s) and blend into it (low gains). Pick the section of the track (musicStart) that matches the film's energy and sync the visual high points to its beats.`
	}[style];
	const prompt = `Do the sound design of the edit of "${video.title}" (${(base.qa.duration ?? t0).toFixed(1)} s). Contact sheet of the edit attached (${base.qa.contactFps ?? 2} fps).

## Timeline (absolute times)
${timeline}
${voice ? `
## Voice-over (recorded, absolute times): it leads the mix
${voiceText}
The voice comes first, then the music, then the effects: the final mix sets those levels and ducks the rest under the voice, you do not have to. Your part: no cue that hits on a word that carries the meaning, the punctuations in the gaps between lines, nothing busy under a sentence. The voice already says what happens: fewer sounds than without it.
` : ''}
## Doctrine: sound follows the continuity of the animation
The animation is made of continuous gestures; sound must not chop it into punctuations ("mickey-mousing"). So:
- One sound per GESTURE, not per event: a movement (travel, transformation, opening) = one extended cue \`"span": [start, end]\`; the engine picks the variant whose build-up lasts as long as the gesture and places its peak on the arrival.
- Most micro-movements stay SILENT. The fewer the sounds, the more each one counts.
- Only one real punctuation per shot (at most), on the narrative high point.
- A continuous layer ties everything together (a very low "bed", or music depending on the mix); all sounds share the same reverb (\`"reverb"\` 0.15 to 0.3).
- Prefer low gains (0.2 to 0.5); the main punctuation up to 0.7. Vary the pitch (0.9-1.1) on repetitions.
${dose}

## Available sounds (real recordings, levels matched)
Name a FAMILY (variant chosen automatically) or a precise id.
Interface (Kenney, CC0): ${catalogText}
Movement, punctuation, beds:
${realText || '(local bank missing)'}
Usage: whoosh = wide travel; swish = short slide; thump = muffled impact (locking in, logo arrival); swell = breath, turn; riser = tension build-up (rare); bed = background bed; ui-* = interface. Never "air" nor "synth:".

## Music
${bankMusic.length ? bankMusic.map((m) => `- music:${m.id.split('/').pop()} — "${m.title}" (${m.artist}, ${m.genre}, ${Math.round(m.duration)} s)`).join('\n') : '(music bank missing)'}
${music.length ? music.map((a) => `- library/${a.name}`).join('\n') : ''}

Write \`${arel}/cues-${style}.json\`:
{ "cues": [{ "span": [0.8, 1.6], "sound": "whoosh", "gain": 0.4, "pan": -0.2 }, { "t": 2.5, "sound": "thump", "gain": 0.6 }],
  "beds": [{ "bed": "bed", "from": 0, "to": 4, "gain": 0.12 }],
  "reverb": 0.22, "music": "music:<id>" | "library/…" | null, "musicStart": 0, "musicGain": 0.3 }
"t" = instant when a one-shot sound HITS (the engine aligns its peak). "pan" from -1 to 1: follows the on-screen position.
End with a summary: which gestures get a sound, which stay silent and why.`;
	const cuesFile = join(adir, `cues-${style}.json`);
	// Remix: same cues, new mix (after a new voice take, for instance), without the sound designer.
	if (!(run.input.remix && existsSync(cuesFile)))
		await runAgent({ runId: run.id, cwd: pdir, prompt, role: `You are the studio's sound designer: restrained, musical, you serve the continuity of motion rather than every event.`, images: base.qa.contact && existsSync(base.qa.contact) ? [base.qa.contact] : [], ...roleModel(run, project, 'sound'), maxTurns: 20, signal });
	if (!existsSync(cuesFile)) throw new Error(`the agent did not write cues-${style}.json`);
	const plan = extractJson<{ cues?: unknown[]; music?: string | null; musicGain?: number; musicStart?: number }>(readFileSync(cuesFile, 'utf8')) ?? {};
	const sfx = join(adir, `sfx-${style}.wav`);
	await engine('sfx.mjs', ['--cues', cuesFile, '--out', sfx, '--duration', String(base.qa.duration ?? t0)], run.id, signal);
	const version = S.nextRenderVersion(video.id, null);
	const tag = `v${String(version).padStart(3, '0')}`;
	const out = join(vdir, 'renders', `${tag}.mp4`);
	// Music: from the bank ("music:<id>", resolved by the engine) or from the project library.
	const musicArg = plan.music?.startsWith('music:') ? plan.music : plan.music && existsSync(join(pdir, plan.music)) ? join(pdir, plan.music) : null;
	const sfxGain = sfxGainOf(run.input.sfxGain);
	// Captions are burned on the mixed film: the mix goes to a temporary file first.
	const captions = !!run.input.captions && !!voice;
	const mixOut = captions ? join(vdir, 'renders', `${tag}.mix.mp4`) : out;
	const mixed = await engine('sfx.mjs', ['--mix', '--video', base.file, '--sfx', sfx, '--sfx-gain', String(sfxGain), ...(musicArg ? ['--music', musicArg, '--music-gain', String(plan.musicGain ?? 0.3), '--music-start', String(plan.musicStart ?? 0)] : []), ...(voice ? ['--voice', voice.file, '--voice-start', String(voice.start)] : []), '--out', mixOut], run.id, signal);
	if (mixed.gains) emit(run.id, 'log', { message: `mix (dB): ${Object.entries(mixed.gains).map(([k, v]) => `${k} ${v}`).join(', ')}` });
	if (captions && voice) {
		const cs = captionStyle(pdir);
		// The highlight asked for this mix wins over the brand kit's.
		const highlight = CAPTION_HIGHLIGHTS.find((h) => h === run.input.captionHighlight) ?? cs.highlight;
		const words = join(adir, 'captions-take.json');
		writeFileSync(words, JSON.stringify({ lines: voice.lines, words: voice.words }));
		const c = await engine('captions.mjs', ['--voice', words, '--start', String(voice.start), '--video', mixOut, '--out', out, '--ass', join(adir, 'captions.ass'), '--color', cs.color, '--active', cs.active, '--highlight', highlight, '--active-text', cs.activeText, ...(cs.font ? ['--font', cs.font] : [])], run.id, signal);
		rmSync(mixOut, { force: true });
		emit(run.id, 'log', { message: `captions: ${c.groups} groups (${c.family}, ${highlight})` });
	}
	const render = S.createRender({ videoId: video.id, shotKey: null, version, file: out, qa: { ...base.qa, hasAudio: true, sound: style, voice: !!voice, sfxGain, captions }, runId: run.id });
	emit(run.id, 'artifact', { kind: 'render', renderId: render.id, shotKey: null, version, audio: true, style, voice: !!voice, cues: plan.cues?.length ?? 0, music: plan.music ?? null });
	return { renderId: render.id, version };
};

/**
 * Voice-over: the storyboard's lines recorded in ONE take (coherent delivery), every word timed,
 * then the shots are cut to the take (as long as no shot of this take is animated yet) and each
 * shot gets its words, which the animator syncs to. Followed by the animatic, to validate it all.
 */
const voiceGenerate: Handler = async (run, signal) => {
	const { project, video, vdir } = ctxOf(run);
	if (!video || !vdir) throw new Error('video required');
	const sb = S.getStoryboard(video.id);
	if (!sb) throw new Error('no storyboard');
	const shots = S.listShots(sb.id);
	const lines = scriptOf(shots);
	if (!lines.length) throw new Error('the storyboard has no voice-over: write the lines in the shots (Voice-over field) first');
	const dir = ensureDir(voiceDir(vdir));
	let track: VoiceTrack, voiceName: string, tag: string, tries = 0;
	if (typeof run.input.take === 'string') {
		// An earlier take of these same lines, chosen again: nothing is recorded, the film is cut to it as if it were new.
		tag = run.input.take;
		const take = readTake(vdir, tag);
		if (!take) throw new Error(`take ${tag} not found`);
		if (!voiceMatches(take, shots)) throw new Error(`take ${tag} does not read the current lines: record a new one`);
		voiceName = take.voice;
		track = { ...take, storyboardVersion: sb.version, start: voiceStart(shots, lines, video.format.fps) };
		emit(run.id, 'log', { message: `using the take ${tag} (${voiceName}, ${take.duration.toFixed(1)} s)` });
	} else {
		const gemini = secret('GEMINI_API_KEY'), groq = secret('GROQ_API_KEY');
		if (!gemini) throw new Error('voice-over needs a Google Gemini key (Settings → API keys)');
		if (!groq) throw new Error('voice-over needs a Groq key to time the words (Settings → API keys)');
		const prev = readVoice(vdir);
		voiceName = String(run.input.voice || prev?.voice || 'Charon').replace(/[^A-Za-z]/g, '') || 'Charon';
		const style = typeof run.input.style === 'string' ? run.input.style.trim() : voiceStyle(langOf(project, video));
		tag = `v${sb.version}-${voiceName.toLowerCase()}-${Date.now().toString(36)}`;
		const scriptFile = join(dir, `${tag}.script.json`);
		// The brand's lexicon respells the words the reader would mispronounce; the script and the subtitles keep the real spelling.
		const lexicon = lexiconOf(S.readBrand(project.id).json, langOf(project, video));
		writeFileSync(scriptFile, JSON.stringify({ lines: lines.map((l) => { const say = respell(l.text, lexicon); return say === l.text ? l : { ...l, say }; }) }, null, 1));
		const wav = join(dir, `${tag}.wav`);
		emit(run.id, 'log', { message: `recording ${lines.length} lines in one take (${voiceName})…` });
		const r = await engine('voice.mjs', ['--script', scriptFile, '--out', wav, '--voice', voiceName, ...(style ? ['--style', style] : [])], run.id, signal, { GEMINI_API_KEY: gemini, GROQ_API_KEY: groq });
		for (const l of r.log ?? []) emit(run.id, 'log', { message: l });
		tries = r.tries;
		track = { storyboardVersion: sb.version, voice: voiceName, file: wav, start: voiceStart(shots, lines, video.format.fps), duration: r.duration, words: r.words, lines: r.lines, createdAt: Date.now() };
		writeFileSync(join(dir, `${tag}.json`), JSON.stringify(track, null, 1));
	}
	// Shots already animated keep their lengths: each line of the take moves into its own shot instead.
	if (shotsBuilt(video, shots) || run.input.retime === false) {
		const p = placeLines(shots.map((s) => s.duration), shots.map((s) => s.key), track);
		const planFile = join(dir, `${tag}.placed.json`), placedWav = join(dir, `${tag}.placed.wav`);
		writeFileSync(planFile, JSON.stringify({ voice: track.file, duration: shots.reduce((a, s) => a + s.duration, 0), splices: p.splices }, null, 1));
		await engine('voice-place.mjs', ['--plan', planFile, '--out', placedWav], run.id, signal);
		track = { ...track, ...p.track, file: placedWav, placed: true };
		emit(run.id, 'log', { message: `lines placed in their shots${p.late.length ? `; too long for their shot: ${p.late.join(', ')} (shorten the line or lengthen the shot)` : ''}` });
	}
	writeFileSync(voiceJson(vdir), JSON.stringify(track, null, 1));
	// Cut the shots to the take, unless this take already has animated shots (their length is baked in).
	const { durations, cut } = fitToVoice(video, shots, track, vdir, { retime: run.input.retime !== false });
	const total = durations.reduce((a, d) => a + d, 0);
	emit(run.id, 'log', { message: cut ? `shots cut to the voice: ${shots.map((s, i) => `${s.key} ${s.duration}→${durations[i]}`).join(', ')} (film ${total.toFixed(2)} s)` : 'shots already animated in this take: lengths kept, words placed in each shot' });
	emit(run.id, 'artifact', { kind: 'voice', voice: voiceName, duration: track.duration, lines: lines.length, retimed: cut });
	enqueueFollowUp(run, 'animatic', {});
	return { voice: voiceName, take: tag, duration: track.duration, retimed: cut, total: +total.toFixed(2), tries };
};

/**
 * Translation: a new film, the same one in another language. Its folder starts as a copy of the source's animated
 * scenes, their shared code and the sound design's cues (repointed to the copy); an agent translates the storyboard
 * and the shared code's on-screen text, then each shot gets its own text translated and goes through the usual
 * render → critic loop. The shots keep the source's lengths: the voice-over recorded next is placed in them.
 */
const videoTranslate: Handler = async (run, signal) => {
	const { project, video, pdir, vdir } = ctxOf(run);
	if (!video || !vdir) throw new Error('video required');
	const lang = LANGS.find((l) => l === run.input.lang);
	if (!lang) throw new Error(`unknown language: ${String(run.input.lang)} (${LANGS.join(', ')})`);
	const from = langOf(project, video);
	if (lang === from) throw new Error(`the film is already in ${LANG_NAMES[lang]}`);
	const sb = S.getStoryboard(video.id);
	if (!sb) throw new Error('no storyboard to translate');
	const shots = S.listShots(sb.id);
	const missing = shots.filter((s) => !existsSync(join(shotDir(project.id, video.slug, s.key), 'scene.html'))).map((s) => s.key);
	if (missing.length) throw new Error(`animate every shot before translating the film (missing: ${missing.join(', ')})`);
	// The new film's folder is prepared before its row exists: a failed run leaves no half film in the studio, only
	// a folder the next try replaces (one with a source.json of its own); any other folder of that name is kept.
	let slug = S.freeSlug(project.id, `${video.slug}-${lang}`);
	for (let i = 2; existsSync(videoDir(project.id, slug)) && !existsSync(join(videoDir(project.id, slug), 'storyboard', 'source.json')); i++) slug = S.freeSlug(project.id, `${video.slug}-${lang}-${i}`);
	const ndir = videoDir(project.id, slug);
	rmSync(ndir, { recursive: true, force: true });
	const textFile = (f: string) => /\.(html?|m?js|css|json|svg)$/i.test(f);
	const copy = (src: string, dst: string, skip: (name: string) => boolean = () => false) => {
		if (existsSync(src)) cpSync(src, dst, { recursive: true, filter: (f) => f === src || !skip(basename(f)) });
	};
	copy(join(vdir, 'storyboard', 'refs'), join(ndir, 'storyboard', 'refs'));
	for (const s of shots) copy(shotDir(project.id, video.slug, s.key), shotDir(project.id, slug, s.key), (n) => n.startsWith('_') || n === 'renders' || n === 'qa' || n === 'beats.json');
	ensureDir(join(ndir, 'audio'));
	if (existsSync(join(vdir, 'audio'))) for (const f of readdirSync(join(vdir, 'audio'))) if (/^cues-.*\.json$/.test(f)) copyFileSync(join(vdir, 'audio', f), join(ndir, 'audio', f));
	for (const dir of [join(ndir, 'storyboard'), join(ndir, 'shots')]) {
		if (!existsSync(dir)) continue;
		for (const f of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
			const file = join(dir, f);
			if (!textFile(f) || !statSync(file).isFile()) continue;
			const text = readFileSync(file, 'utf8'), next = repointPaths(text, video.slug, slug);
			if (next !== text) writeFileSync(file, next);
		}
	}
	// Code the scenes share (outside the shots' own folders) carries on-screen text too: the agent translates it once.
	const nrel = `videos/${slug}`;
	const shared = new Set<string>();
	for (const s of shots) {
		const scene = readFileSync(join(shotDir(project.id, slug, s.key), 'scene.html'), 'utf8');
		for (const m of scene.matchAll(/\/project\/((?:videos|library)\/[^'"`\s)]+\.m?js)/g)) if (!m[1].startsWith(`${nrel}/shots/`)) shared.add(m[1]);
	}
	const sbDir = ensureDir(join(ndir, 'storyboard'));
	writeFileSync(join(sbDir, 'source.json'), JSON.stringify(translationSource({ title: video.title, brief: video.brief, decisions: video.briefState.decisions }, sb, shots), null, 1));
	const draft = join(sbDir, 'draft.json');
	const target = LANG_NAMES[lang];
	const prompt = `Translate the film "${video.title}" from ${LANG_NAMES[from]} into ${target}: the same film, made for native ${target} viewers. Same images, same timing; only the language changes.

## 1. The storyboard
\`${nrel}/storyboard/source.json\` holds every text of the film's plan: its title, brief, brief decisions, logline, summary and, per shot, title, intent, visual, on-screen text, voice-over, beats (state, cursor, sound), transitions, sound and the director's notes. Write \`${nrel}/storyboard/draft.json\` with exactly the same structure (same keys, the same shots in the same order, as many beats and director's notes per shot as the source), every value translated.
- voiceover: natural spoken ${target}, with the meaning and tone of the original, said in about the same time or less: the shots keep their length and the recorded words must fit in their shot. The lines read end to end still make one script.
- onScreenText, and on-screen text quoted in visual or beats: the wording a native ${target} product would use, about as long as the original or shorter, since it must fit the same layout.
- Adapt the conventions to ${target} readers: times, dates, numbers, currency, names of days and months. Keep the names of brands and products and, unless the brief says otherwise, of people and companies.
- Follow ${target} typography (quotes, spacing around punctuation).

## 2. The code the scenes share
${shared.size ? `The scenes import ${[...shared].map((f) => `\`${f}\``).join(', ')}. Translate every text these files put on screen (labels, menus, buttons, sample content), with the rules above; keep the code, the layout and the identifiers. A module outside \`${nrel}/\` with on-screen text in it: copy it under \`${nrel}/storyboard/refs/\`, translate the copy and point the scenes' import line at it (the only change allowed in a scene).` : 'The scenes import no shared module: nothing to do here.'}
Do not translate the shots' own scenes (\`${nrel}/shots/*/scene.html\`): each shot is translated afterwards, on its own, from the translated storyboard. Do not render anything.

End with the choices you made (terms, conventions), in a few lines.`;
	await runAgent({ runId: run.id, cwd: pdir, prompt, role: `You are the studio's localizer: you adapt films for native viewers of another language, faithful to the meaning, the tone and the timing, never word for word.`, ...roleModel(run, project, 'director'), lang, signal });
	if (!existsSync(draft)) throw new Error('the agent did not write storyboard/draft.json');
	const t = applyTranslation(shots, extractJson(readFileSync(draft, 'utf8')), (f) => {
		const moved = f && f.startsWith(vdir) ? join(ndir, relative(vdir, f)) : f;
		return moved && existsSync(moved) ? moved : f;
	});
	const nv = S.createVideo(project.id, { title: String(run.input.videoTitle || t.title || `${video.title} (${lang})`), brief: t.brief || video.brief, format: video.format, targetDuration: video.targetDuration, slug, language: lang });
	const decisions = Object.fromEntries(Object.entries(video.briefState.decisions).map(([k, v]) => [k, t.decisions[k] || v]));
	S.setBriefState(nv.id, { ...video.briefState, decisions, questions: [] });
	const nsb = S.createStoryboard(nv.id, { logline: t.logline || sb.logline, summary: t.summary || sb.summary, shots: t.shots }, run.id);
	if (sb.status === 'approved') S.setStoryboardStatus(nsb.id, 'approved');
	emit(run.id, 'artifact', { kind: 'storyboard', videoId: nv.id, version: nsb.version, shots: t.shots.length, lang });
	for (const s of t.shots)
		setTimeout(() => enqueue('shot_fix', {
			projectId: project.id, videoId: nv.id, parentId: run.id, shotKey: s.key, round: 0, title: `Shot ${s.key} — translation`,
			direction: `Translate this shot into ${target}: every text it shows (labels, messages, buttons, sample content, times and dates) becomes the ${target} the shot brief above gives, word for word where the brief quotes it. The code it imports from outside the shot is already translated. Keep everything else as it is: layout, motion, timings, colours. Where a text grows longer, make it fit the way the original layout would (wrap, or a slightly smaller size of that text only), never cropped and never overlapping. Check a still of every state that shows text.`
		}), 0);
	return { videoId: nv.id, slug: nv.slug, lang, shots: t.shots.length, shared: shared.size };
};

/** Animatic: the storyboard images held for each shot's length, over the voice. Seconds to make, no agent. */
const animatic: Handler = async (run, signal) => {
	const { project, video, vdir, pdir } = ctxOf(run);
	if (!video || !vdir) throw new Error('video required');
	const sb = S.getStoryboard(video.id);
	if (!sb) throw new Error('no storyboard');
	const shots = S.listShots(sb.id);
	const track = readVoice(vdir);
	const voice = track && voiceMatches(track, shots) ? { file: track.file, start: track.start } : null;
	const fonts = existsSync(join(pdir, 'brand', 'fonts')) ? readdirSync(join(pdir, 'brand', 'fonts')).filter((f) => /\.(ttf|otf)$/i.test(f)) : [];
	const font = fonts.find((f) => /medium|regular/i.test(f) && !/mono/i.test(f)) ?? fonts[0];
	const sbDir = ensureDir(join(vdir, 'storyboard'));
	const planFile = join(sbDir, `animatic-v${sb.version}.json`);
	writeFileSync(planFile, JSON.stringify({ ...video.format, font: font ? join(pdir, 'brand', 'fonts', font) : null, shots: shots.map((s) => ({ key: s.key, title: s.title, image: s.refImage, duration: s.duration })), voice }, null, 1));
	const out = join(sbDir, `animatic-v${sb.version}.mp4`);
	const r = await engine('animatic.mjs', ['--plan', planFile, '--out', out], run.id, signal);
	emit(run.id, 'artifact', { kind: 'animatic', storyboardVersion: sb.version, duration: r.duration, voice: !!voice });
	void project;
	return { file: rel(out, pdir), duration: r.duration, voice: !!voice };
};

const resolveExport: Handler = async (run) => {
	const { video, project } = ctxOf(run);
	if (!video) throw new Error('video required');
	const sb = S.getStoryboard(video.id);
	if (!sb) throw new Error('no storyboard');
	const files = S.listShots(sb.id).map((s) => {
		const r = bestRender(video.id, s.key, project.settings.eval);
		if (!r) throw new Error(`Shot ${s.key} has no render`);
		return r.file;
	});
	const full = S.listRenders(video.id, null)[0];
	if (full?.qa.hasAudio) files.push(full.file);
	emit(run.id, 'log', { message: `importing ${files.length} file(s) into Resolve…` });
	const r = await exportToResolve({ bin: `Choreon — ${video.title}`, timeline: `${video.title} — sb v${sb.version}`, files: files.slice(0, full?.qa.hasAudio ? -1 : undefined) });
	emit(run.id, 'artifact', { kind: 'resolve', ...r });
	return r;
};

/**
 * Memory: turns notes (or the defects of a fix loop and the recent ones of the other
 * shots) into 0 to 3 general lessons, filed at the right level (harness / project).
 */
const lessonDistill: Handler = async (run, signal) => {
	const { project, video, pdir } = ctxOf(run);
	const ids = (run.input.noteIds as string[]) ?? [];
	const notes = video ? notesOf(video.id, ids) : projectNotesOf(project.id, ids);
	const noteIds = notes.map((n) => n.id);
	const shotKey = run.input.shotKey as string | undefined;
	let material = '';
	if (notes.length) {
		material += `## User notes (already fixed in the shot)\n${notes
			.map((n) => `- [${n.shotKey ?? 'global'}${n.t != null ? ` · ${n.t.toFixed(2)} s` : ''} · ${n.route?.category ?? '?'} · predicted: ${n.route?.lesson ?? '?'}] ${n.body}`)
			.join('\n')}\n\n`;
	}
	if (video && shotKey) {
		const evs = S.listEvals(video.id);
		const loop = evs.filter((e) => e.shotKey === shotKey).reverse();
		material += `## Fix loop of shot ${shotKey} (${loop.length} evaluation(s))\n${loop
			.map((e) => `Round ${e.round + 1} — ${e.pass ? 'approved' : 'rejected'} — ${JSON.stringify(e.scores)}\n${e.findings.map((f) => `  - [${f.axis} · ${f.severity}] ${f.problem}`).join('\n')}`)
			.join('\n')}\n\n`;
		const others = evs.filter((e) => e.shotKey && e.shotKey !== shotKey).slice(0, 12);
		if (others.length)
			material += `## Recent defects on the other shots (to spot recurrences)\n${others.map((e) => e.findings.map((f) => `- ${e.shotKey} [${f.axis}] ${f.problem}`).join('\n')).join('\n')}\n\n`;
	}
	if (!material) return { lessons: 0 };
	const existing = listLessons({ projectId: project.id });
	const prompt = `You keep the studio's memory. From the material below, propose 0 to 3 LESSONS that will prevent these mistakes from happening again.

${material}## Lessons already known (do not duplicate; status in brackets)
${existing.map((l) => `- L${l.num} [${l.scope} · ${l.status}] ${l.rule}`).join('\n') || '(none)'}

## Two levels
- "harness": craft valid for ANY project and ANY style (timing precision, legibility, continuity, engine or rendering pitfalls, working method).
- "project": anything that depends on THIS project's taste or identity (${project.name}): physics (overshoot or not), transitions, fades, particles, texture, density, pace, palette, typography, logo, tone.
- Test: if the rule would be wrong for a loud, playful brand OR for a calm, minimal one, it is a "project" lesson.

## Rules
- One lesson = one general rule, actionable, checkable on a frame, in one sentence (≤ 30 words), in the imperative. Never a particular case ("in shot s03…").
- Nothing for a one-off defect, nor for what motion.md or an existing lesson already covers.
- Prefer a recurrence (same defect on several shots or several rounds) to an isolated case.

Answer only with this JSON:
{"lessons": [{"scope": "harness|project", "rule": "…", "rationale": "what happened, in one sentence"}]}`;
	const res = await runAgent({ runId: run.id, cwd: pdir, prompt, role: `You are the studio's memory: you generalize mistakes into short, useful rules, never duplicating.`, noTools: true, maxTurns: 2, ...roleModel(run, project, 'distiller'), signal });
	type Out = { lessons?: Array<{ scope?: string; rule?: string; rationale?: string }> };
	let parsed = extractJson<Out>(res.text);
	for (const t of [...res.texts].reverse()) {
		if (parsed?.lessons) break;
		parsed = extractJson<Out>(t);
	}
	const created: number[] = [];
	for (const l of (parsed?.lessons ?? []).slice(0, 3)) {
		if (!l.rule || l.rule.length < 8) continue;
		const scope = l.scope === 'project' ? 'project' : 'harness';
		const lesson = createLesson({ scope, projectId: project.id, rule: l.rule, rationale: l.rationale ?? '', source: { noteIds, runId: run.id, videoId: video?.id, findings: shotKey ? [shotKey] : [] } });
		created.push(lesson.num);
		emit(run.id, 'artifact', { kind: 'lesson', num: lesson.num, scope, status: lesson.status, rule: lesson.rule });
	}
	return { lessons: created.length, nums: created };
};

/** Downloads an HTTP file to disk. */
async function download(url: string, file: string, signal: AbortSignal) {
	const res = await fetch(url, { signal });
	if (!res.ok || !res.body) throw new Error(`download failed ${res.status}: ${url}`);
	writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/**
 * Analyzes a reference: downloads the video, detects cuts/pacing/palette, builds contact
 * sheets, then the director draws a style guide from it (what to borrow, what to drop for this project).
 */
const referenceAnalyze: Handler = async (run, signal) => {
	const { project, pdir } = ctxOf(run);
	const ref = refOf(project.id, String(run.input.refId));
	if (!ref) throw new Error('reference not found');
	updateRef(ref.id, { status: 'analyzing' });
	try {
		let videoUrl = ref.videoUrl;
		if (!videoUrl && ref.source === 'whatships') {
			const d = await wsDetail(ref.slug);
			videoUrl = d.videoUrl;
			updateRef(ref.id, { videoUrl: d.videoUrl, duration: d.duration, xUrl: d.xUrl });
		}
		const dir = ensureDir(join(pdir, 'references', ref.slug));
		const src = join(dir, 'source.mp4');
		if (!existsSync(src)) {
			if (!videoUrl) throw new Error('no video for this reference');
			emit(run.id, 'log', { message: 'downloading the video…' });
			await download(videoUrl, src, signal);
		}
		const a = await engine('analyze.mjs', ['--video', src, '--dir', join(dir, 'analysis'), '--step', '0.5'], run.id, signal);
		updateRef(ref.id, { analysis: { file: src, stats: a.stats, palette: a.palette, sheets: a.sheets, keys: a.keys, cuts: a.cuts, motion: a.motion } });
		const brand = S.readBrand(project.id);
		const m = a.motion ?? { summary: {}, moves: [], strips: [] };
		const images = [...(m.chart ? [m.chart] : []), ...m.strips.map((x: { file: string }) => x.file), ...a.sheets.slice(0, 3).map((x: { file: string }) => x.file), ...a.keys.slice(0, 6).map((x: { file: string }) => x.file)];
		const prompt = `Analyze this reference video — "${ref.title}" (${ref.company}, ${ref.category}) — and write its STYLE GUIDE for the project ${project.name}.

Automatic measurements: duration ${a.duration} s, ${a.width}×${a.height}, ${a.stats.count} shots, average shot ${a.stats.mean} s (median ${a.stats.median}, min ${a.stats.min}, max ${a.stats.max}), ${a.stats.cutsPerMinute} cuts/min. Cuts at: ${a.cuts.join(', ')} s. Dominant palette: ${a.palette.join(' ')}.
Motion (frame-by-frame energy, adaptive thresholds): ${m.summary.moves} moves, median duration ${m.summary.medianMove} s, median holds ${m.summary.medianHold} s, ${Math.round((m.summary.motionShare ?? 0) * 100)}% of the time in motion, estimated easings ${JSON.stringify(m.summary.easing)}, ${m.summary.overshoots} overshoot(s).
Moves: ${m.moves.slice(0, 14).map((x: { start: number; end: number; easing: string; overshoot: boolean; peakPos: number }, i: number) => `#${i + 1} ${x.start}–${x.end} s ${x.easing}${x.overshoot ? ' +overshoot' : ''} (peak at ${Math.round(x.peakPos * 100)}%)`).join('; ')}.
Attached images, in order: the energy chart (numbered moves in green, overshoots in amber, cuts as dotted red lines); ${m.strips.length} strip(s) of CONSECUTIVE frames over the most pronounced moves (${m.strips.map((x: { move: number; fpsShown: number }) => `#${x.move} at ${x.fpsShown} fps`).join(', ')}) — read the trajectory, the acceleration, the offsets between elements, any overshoot; then ${Math.min(3, a.sheets.length)} contact sheet(s) (one frame every 0.5 s, read left→right then top→bottom, sheet n covers ${a.sheets.map((x: { from: number; to: number }) => `${x.from}–${x.to} s`).join(', ')}), then one sharp frame per shot.

Project brand guidelines (excerpt from motion.md):
${brand.motion.slice(0, 3500)}

Write in Markdown, concise and concrete (numeric values whenever possible), these sections:
1. **In one sentence** — the creative stance.
2. **Pacing** — shot durations, accelerations, breathing room, where the cuts fall.
3. **Transitions** — types (hard cut, morph, mask, zoom…) and their frequency.
4. **Motion** — dominant easings (confirm or correct the automatic estimate from the strips), typical durations, offsets (stagger) between elements, overshoots, trajectories (straight, arcs), motion blur. Translate into our engine's parameters: \`tween\` with outExpo/outQuint/inOutCubic and duration, or \`springs.snappy/default/heavy\` (critically damped, no bounce), stagger in seconds.
5. **Camera & space** — moves, depth, scale.
6. **Kinetic typography** — apparent families, weights, relative sizes, how text enters and exits.
7. **Interface** — how the product is shown (raw capture, simplified UI, cards, cursor…).
8. **Color & materials** — palette, backgrounds, textures.
9. **To borrow for ${project.name}** — 4 to 6 techniques compatible with its brand guidelines, phrased as instructions.
10. **Not to borrow** — what contradicts the project's brand guidelines or tone.
Never describe the content (product, brand, copy): only the grammar.`;
		const res = await runAgent({ runId: run.id, cwd: pdir, prompt, role: `You are an art director who dissects motion design films to extract a reusable grammar from them.`, images, noTools: true, maxTurns: 2, ...roleModel(run, project, 'director'), signal });
		const guide = res.text.replace(/^```(?:markdown|md)?\s*|```\s*$/g, '').trim();
		writeFileSync(join(dir, 'style_guide.md'), `# ${ref.title} — ${ref.company}\n\nSource: ${ref.pageUrl ?? ''} ${ref.xUrl ?? ''}\n\n${guide}\n`);
		updateRef(ref.id, { status: 'analyzed', styleGuide: guide });
		emit(run.id, 'artifact', { kind: 'reference', refId: ref.id });
		return { refId: ref.id };
	} catch (e) {
		updateRef(ref.id, { status: 'candidate' });
		throw e;
	}
};

/**
 * Shortlist of whatships references for a project: text sort on the useful categories,
 * then visual pick on a sheet of posters, then analysis of the references kept.
 */
const referenceScout: Handler = async (run, signal) => {
	const { project, pdir } = ctxOf(run);
	const count = Math.max(3, Math.min(10, Number(run.input.count ?? 6)));
	const cats = (run.input.categories as string[] | undefined) ?? ['Motion', 'Design', 'Productivity', 'AI', 'Developer tools'];
	const brand = S.readBrand(project.id);
	// For a specific video (from its brief): its brief and decisions guide the choice, and
	// the references kept are attached to it.
	const forVideo = run.input.forVideo ? videoOf(project.id, String(run.input.forVideo)) : null;
	if (run.input.forVideo && !forVideo) throw new Error('video not found');
	const intent = forVideo
		? [forVideo.brief, decisionsBlock(forVideo.briefState)].filter(Boolean).join('\n\n').slice(0, 4000)
		: String(run.input.brief ?? '') || S.listVideos(project.id).map((v) => v.brief).join('\n').slice(0, 2500);
	const pool = (await wsIndex()).filter((x) => cats.includes(x.category));
	emit(run.id, 'log', { message: `${pool.length} candidate videos (${cats.join(', ')})` });
	const lines = pool.map((x) => `${x.slug} | ${x.name} | ${x.company} | ${x.category} | ${x.text.slice(0, 140)}`).join('\n');
	const ctxText = `Project: ${project.name}.\nBrand guidelines (motion.md, excerpt):\n${brand.motion.slice(0, 2500)}\n\nIntent of the project's videos:\n${intent}`;
	type Pick = { slug: string; score?: number; why?: string; borrow?: string };
	const first = await runAgent({
		runId: run.id, cwd: pdir, noTools: true, maxTurns: 2, ...roleModel(run, project, 'director'), signal,
		role: 'You are an art director. You pick launch-film references whose grammar will serve the project. Answer only in JSON.',
		prompt: `${ctxText}\n\n## Catalog (slug | title | company | category | description)\n${lines}\n\nShortlist the 24 videos whose GRAMMAR (pacing, animated simplified UI, kinetic typography, transitions, energy) would best serve this project's doctrine. Drop live-action videos, hardware, raw screen demos.\nAnswer: {"picks": [{"slug": "…", "why": "…"}]}`
	});
	let shortlist = extractJson<{ picks?: Pick[] }>(first.text)?.picks ?? [];
	for (const t of [...first.texts].reverse()) {
		if (shortlist.length) break;
		shortlist = extractJson<{ picks?: Pick[] }>(t)?.picks ?? [];
	}
	const bySlug = new Map(pool.map((x) => [x.slug, x]));
	const short = shortlist.map((p) => bySlug.get(p.slug)).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 24);
	if (!short.length) throw new Error('empty shortlist');
	const dir = ensureDir(join(pdir, 'references', '_scout'));
	const list = join(dir, 'grid.json');
	writeFileSync(list, JSON.stringify(short.map((x, i) => ({ src: x.poster, label: `${i + 1} · ${x.name.slice(0, 40)}` }))));
	const g = await engine('grid.mjs', ['--list', list, '--out', join(dir, 'grid.png'), '--cols', '4'], run.id, signal);
	const second = await runAgent({
		runId: run.id, cwd: pdir, noTools: true, maxTurns: 2, ...roleModel(run, project, 'director'), signal, images: [g.out],
		role: 'You are an art director. You choose from images. Answer only in JSON.',
		prompt: `${ctxText}\n\nThe attached sheet shows the posters of ${short.length} shortlisted videos, numbered:\n${short.map((x, i) => `${i + 1}. ${x.name} (${x.company}, ${x.category}) — ${shortlist.find((p) => p.slug === x.slug)?.why ?? ''}`).join('\n')}\n\nKeep the ${count} best references for ${project.name}: close to its visual world (light, calm, precise, simplified UI) or carrying a precise technique worth borrowing. Vary the contributions (pacing, type, transitions, UI).\nAnswer: {"picks": [{"n": <number>, "score": <1-10>, "why": "why it serves the project", "borrow": "the precise technique to borrow"}]}`
	});
	type Pick2 = { n?: number; score?: number; why?: string; borrow?: string };
	let finals = extractJson<{ picks?: Pick2[] }>(second.text)?.picks ?? [];
	for (const t of [...second.texts].reverse()) {
		if (finals.length) break;
		finals = extractJson<{ picks?: Pick2[] }>(t)?.picks ?? [];
	}
	const kept = [];
	for (const f of finals.slice(0, count)) {
		const x = short[(f.n ?? 0) - 1];
		if (!x) continue;
		const ref = upsertRef({ projectId: project.id, source: 'whatships', slug: x.slug, title: x.name, company: x.company, category: x.category, pageUrl: x.href, xUrl: null, videoUrl: null, poster: x.poster, duration: null, relevance: { score: f.score, why: f.why, borrow: f.borrow } });
		kept.push(ref.id);
		if (forVideo) setVideoRef(forVideo.id, ref.id, true);
		if (run.input.analyze !== false) setTimeout(() => enqueue('reference_analyze', { projectId: project.id, parentId: run.id, lane: 'refs', refId: ref.id, title: `Reference — ${x.name.slice(0, 40)}` }), 0);
	}
	emit(run.id, 'artifact', { kind: 'references', count: kept.length });
	return { refs: kept };
};

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Where a generated image lands: always in the project's library, under a slug of the requested name. */
export const assetFile = (pdir: string, name: unknown) => join(pdir, 'library', `${slugify(String(name || 'image'))}-${Date.now().toString(36)}.png`);

const assetGenerate: Handler = async (run, signal) => {
	const { project, pdir } = ctxOf(run);
	const prompt = String(run.input.prompt ?? '');
	const file = assetFile(pdir, run.input.name);
	emit(run.id, 'log', { message: 'Codex is generating the image (≈ 30 s)…' });
	const r = await engine('codex-image.mjs', ['--prompt', prompt, '--out', file], run.id, signal);
	const a = S.createAsset({ projectId: project.id, kind: 'image', name: basename(file), file, mime: MIME[extname(file)] ?? 'image/png', size: statSync(file).size, source: 'codex', meta: { prompt, ms: r.ms } });
	emit(run.id, 'artifact', { kind: 'asset', assetId: a.id });
	return { assetId: a.id };
};

/** Renders every item of a stills batch, in each of its formats. */
const stillsRender: Handler = async (run, signal) => {
	const { project, pdir } = ctxOf(run);
	const slug = String(run.input.lot ?? '');
	const lot = getLot(project.id, slug);
	if (!lot) throw new Error(`batch not found: ${slug}`);
	if (!getTemplate(project.id, lot.template)) throw new Error(`template not found: ${lot.template}`);
	if (!lot.items.length) throw new Error('empty batch');
	pruneRenders(project.id, lot);
	emit(run.id, 'log', { message: `${lot.items.length} creative(s) × ${lot.formats.length} format(s)…` });
	const r = await engine('still.mjs', ['--project', pdir, '--template', templateDir(project.id, lot.template), '--batch', lotFile(project.id, slug), '--out', lotDir(project.id, slug), '--formats', lot.formats.join(',')], run.id, signal);
	for (const e of r.errors ?? []) emit(run.id, 'log', { message: `⚠ ${e}` });
	emit(run.id, 'artifact', { kind: 'stills', lot: slug, count: r.count });
	return { lot: slug, count: r.count, errors: r.errors ?? [] };
};

/** Addresses of a ui_harvest input: `urls`, or `url` split on spaces and commas. */
export const harvestUrls = (input: Record<string, unknown>): string[] =>
	(Array.isArray(input.urls) ? input.urls : typeof input.url === 'string' ? input.url.split(/[\s,]+/) : []).filter((u): u is string => typeof u === 'string').map((u) => u.trim()).filter(Boolean);

/**
 * Runs a page capture in a hidden staging folder next to `raw`, then swaps it in (two renames: `raw` to a backup, staging to `raw`).
 * Invariant: `raw` always ends as the old or the new capture; a swap interrupted between the renames is repaired by the next capture
 * (restores the latest backup, removes other leftovers: harvests of a project run one at a time, so they belong to dead runs).
 * Folders are `.stage.<page>.<stamp>` / `.old.<page>.<stamp>`: a page slug never holds a dot, so another page's leftovers (`home-extra`) never match.
 * The stamp (fixed-width base 36 time, then the run id) makes the name order the promotion order: a rename keeps the folder mtime, so mtime cannot pick the latest.
 * Every capture first restores a pending backup, so at most one exists normally; the order only matters for an unexpected pile-up.
 */
export const captureInto = async <T>(raw: string, runId: string, capture: (stage: string) => Promise<T>): Promise<T> => {
	const parent = dirname(raw), page = basename(raw), stamp = `${Date.now().toString(36).padStart(9, '0')}-${runId.replace(/[^\w-]/g, '-')}`;
	const stage = join(parent, `.stage.${page}.${stamp}`), backup = join(parent, `.old.${page}.${stamp}`);
	const drop = (d: string) => rmSync(d, { recursive: true, force: true });
	const mine = new RegExp(`^\\.(old|stage)\\.${page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[^.]+$`);
	const left = existsSync(parent) ? readdirSync(parent).filter((f) => mine.test(f)) : [];
	const backups = left.filter((f) => f.startsWith('.old.')).sort().reverse().map((f) => join(parent, f));
	if (!existsSync(raw) && backups.length) renameSync(backups.shift()!, raw);
	for (const f of left) drop(join(parent, f));
	drop(stage);
	mkdirSync(stage, { recursive: true });
	let out: T;
	try {
		out = await capture(stage);
		const had = existsSync(raw);
		if (had) renameSync(raw, backup);
		try { renameSync(stage, raw); } catch (e) { if (had) renameSync(backup, raw); throw e; }
	} catch (e) {
		drop(stage);
		throw e;
	}
	drop(backup);
	return out;
};

/**
 * UI kit: harvests the UI elements of a site or an app, over one or several pages
 * (engine/ui-harvest.mjs). For each page, the agent judges the rebuilds on side-by-side
 * comparison sheets, keeps the elements that are recognizable and useful for motion design, names them
 * and picks their variant; it knows what the previous pages already contributed (no duplicates: an app's
 * sidebar goes in only once). The kit is stored in library/ui/<kit>/.
 * Runs are serialized per project (the ui lane, forced by POST /api/jobs): two harvests of a kit never interleave.
 */
const uiHarvest: Handler = async (run, signal) => {
	const { project, pdir } = ctxOf(run);
	const urls = harvestUrls(run.input);
	if (!urls.length || urls.some((u) => !/^https?:\/\//.test(u))) throw new Error('invalid address (https://…)');
	const slug = slugify(String(run.input.kit || new URL(urls[0]).hostname.replace(/^www\./, '')));
	const dir = ensureDir(kitDir(project.id, slug));
	const width = Number(run.input.width) || 1440, height = Number(run.input.height) || 900;
	type Cand = { id: number; role: string; text: string; box: { w: number; h: number }; repeats: number; style: { bg: string; radius: number } };
	type Pick = { id: number; name: string; label: string; role: string; variant: string; description?: string };
	// New selection: remove the one from a previous harvest of the same kit (raw harvests stay in _raw).
	for (const f of readdirSync(dir, { withFileTypes: true })) if (f.isFile()) unlinkSync(join(dir, f.name));
	const components: UiComponent[] = [];
	const used = new Set<string>();
	const seenSig = new Set<string>(); // elements already seen on a previous page (same role, size, background)
	const sig = (c: Cand) => `${c.role}|${Math.round(c.box.w / 16)}|${Math.round(c.box.h / 8)}|${c.style.bg}|${c.style.radius}`;
	let label = '', summary = '', title = '', tokens: UiKit['tokens'] = { colors: [], fonts: [], radii: [] };
	const pages: { url: string; title: string; kept: number }[] = [];

	for (const [pi, url] of urls.entries()) {
		const page = slugify(new URL(url).pathname.replace(/^\/|\/$/g, '') || 'home');
		// A stored browser session is an admin feature (/api/jobs refuses ui_login to a member): a member's harvest never reuses one.
		const auth = hasAuth(project.id, url) && run.input.byAdmin === true ? authFile(project.id, url) : null;
		emit(run.id, 'log', { message: `page ${pi + 1}/${urls.length} — ${url} (${width}×${height}${auth ? ', signed-in session' : ''})…` });
		// The studio harvesting its own interface: signed in with the service token, for a studio admin only (/api/jobs sets byAdmin).
		const self = selfHarvestEnv(url, { admin: run.input.byAdmin === true, token: env.STUDIO_TOKEN, port: studioPort(), host: process.env.HOST, dev });
		const raw = join(dir, '_raw', page);
		// Captured in a staging folder, promoted only once valid: a failed capture keeps the page's previous one.
		const { data, overlays } = await captureInto(raw, run.id, async (stage) => {
			const h = await engine('ui-harvest.mjs', ['--url', url, '--out', stage, '--width', String(width), '--height', String(height), '--max', '70', ...(auth ? ['--storage', auth] : [])], run.id, signal, self);
			const data = JSON.parse(readFileSync(join(stage, 'candidates.json'), 'utf8')) as { title: string; url: string; candidates: Cand[] };
			if (!Array.isArray(data.candidates)) throw new Error('unreadable capture (no candidates)');
			if (/\/(auth|login|signin|connexion)\b/.test(String(h.finalUrl ?? data.url ?? ''))) throw new Error(`${url} redirects to the sign-in page: "Sign in first"`);
			return { data, overlays: (h.overlays as string[]).map((f) => relative(stage, f)) };
		});
		const fresh = data.candidates.filter((c) => !seenSig.has(sig(c)));
		emit(run.id, 'log', { message: `${data.candidates.length} candidates, ${fresh.length} new compared to the previous pages` });
		if (pi === 0) {
			tokens = JSON.parse(readFileSync(join(raw, 'tokens.json'), 'utf8'));
			title = data.title;
		}
		if (!fresh.length) continue;
		// Comparison sheets (original | faithful | simplified), 10 candidates per sheet.
		const sheets: string[] = [];
		for (let i = 0; i < fresh.length && sheets.length < 5; i += 10) {
			const out = join(raw, `sheet-${sheets.length + 1}.png`);
			await engine('ui-sheet.mjs', ['--dir', raw, '--out', out, '--ids', fresh.slice(i, i + 10).map((c) => c.id).join(','), '--max', '10'], run.id, signal);
			sheets.push(out);
		}
		const overview = overlays.map((f) => join(raw, f)).filter((f) => existsSync(f)).slice(0, 2);
		const already = components.length ? components.map((c) => `- ${c.name} (${c.role}, ${c.w}×${c.h}): ${c.label}`).join('\n') : '(nothing yet)';
		const list = fresh.slice(0, 50).map((c) => `${c.id} | ${c.role} | ${c.box.w}×${c.box.h}${c.repeats > 1 ? ` | ×${c.repeats}` : ''} | ${c.text.slice(0, 70)}`).join('\n');
		const prompt = `You are building a kit of interface elements for motion design, from ${urls.length > 1 ? `${urls.length} pages of` : ''} ${new URL(url).origin} ("${data.title}"). Page ${pi + 1}/${urls.length}: ${url}

Attached images, in order:
- ${overview.length} view(s) of the page with the candidates boxed and numbered (context);
- ${sheets.length} check sheet(s): for each candidate (#number, role, size), the ORIGINAL capture, then the "fidele" SVG rebuild (all the text), then "simplifie" (labels and titles kept, long text as rounded bars).

Already in the kit (previous pages) — do not take them again, keep only what this page brings that is NEW:
${already}

Candidates on this page (number | detected role | size in px | repeats | text):
${list}

Judge the REBUILDS: drop any element whose SVG is empty, broken, cropped or misleading compared to the original (animated content, image or video not rebuilt).
Keep ${pi === 0 ? '8 to 25' : '0 to 15'} elements, the ones that make the interface RECOGNIZABLE and that a film will want to animate: navigation (bar, sidebar, tabs), search and input fields, primary and secondary buttons, typical cards and list rows (one per kind), badges, avatars, toggles, icon tiles, windows, editor, message thread. Drop visual duplicates, purely decorative blocks and badly detected elements.
Choose "simplifie" when long text would distract or would not be legible on screen; "fidele" when the words carry the recognition (menu, labels, small cards).

Answer only with this JSON:
{"label": "readable kit name", "summary": "1-2 sentences: the style of this interface (density, radii, palette, type)", "components": [{"id": <number>, "name": "short-name-in-kebab-case", "label": "Readable name", "role": "button|input|search|nav|sidebar|header|tabs|card|list|badge|avatar|toggle|icon|modal|table|select|editor", "variant": "fidele|simplifie", "description": "what it is for, in one sentence"}]}`;
		const res = await runAgent({ runId: run.id, cwd: pdir, prompt, role: 'You are a motion design art director: you pick the interface elements that make a product recognizable. Answer only in JSON.', images: [...overview, ...sheets], noTools: true, maxTurns: 2, ...roleModel(run, project, 'director'), signal });
		let picked = extractJson<{ label?: string; summary?: string; components?: Pick[] }>(res.text);
		for (const t of [...res.texts].reverse()) {
			if (picked?.components) break;
			picked = extractJson(t);
		}
		if (!picked?.components) throw new Error(`unreadable selection (page ${url})`);
		if (pi === 0) {
			label = picked.label ?? '';
			summary = picked.summary ?? '';
		}
		const byId = new Map(data.candidates.map((c) => [c.id, c]));
		let kept = 0;
		for (const p of picked.components) {
			const c = byId.get(Number(p.id));
			if (!c || !existsSync(join(raw, 'c', `${c.id}.svg`))) continue;
			let name = slugify(p.name || `${c.role}-${c.id}`);
			const base = name;
			for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
			used.add(name);
			copyFileSync(join(raw, 'c', `${c.id}.svg`), join(dir, `${name}.svg`));
			copyFileSync(join(raw, 'c', `${c.id}-bars.svg`), join(dir, `${name}.simple.svg`));
			if (existsSync(join(raw, 'c', `${c.id}.png`))) copyFileSync(join(raw, 'c', `${c.id}.png`), join(dir, `${name}.png`));
			components.push({ name, label: p.label || name, role: p.role || c.role, description: p.description ?? '', variant: p.variant === 'simplifie' ? 'simplifie' : 'fidele', w: c.box.w, h: c.box.h, repeats: c.repeats, text: c.text.slice(0, 140), page: url, files: { fidele: `${name}.svg`, simplifie: `${name}.simple.svg`, original: `${name}.png` } });
			kept++;
		}
		for (const c of data.candidates) seenSig.add(sig(c));
		pages.push({ url, title: data.title, kept });
		emit(run.id, 'log', { message: `${kept} element(s) kept from ${url}` });
	}
	if (!components.length) throw new Error('no component selected');
	const kit: UiKit = { slug, label: label || title || slug, url: urls[0], pages, title, summary, createdAt: Date.now(), viewport: { width, height }, tokens, components };
	writeFileSync(join(dir, 'kit.json'), JSON.stringify(kit, null, 1));
	emit(run.id, 'artifact', { kind: 'ui_kit', kit: slug, components: components.length, pages: pages.length });
	return { kit: slug, components: components.length, pages: pages.length };
};

/** Opens a visible browser window so the user can sign in; the session is kept per site. */
const uiLogin: Handler = async (run, signal) => {
	const { project } = ctxOf(run);
	const url = String(run.input.url ?? '');
	if (!/^https?:\/\//.test(url)) throw new Error('invalid address (https://…)');
	emit(run.id, 'log', { message: 'A browser window is opening: sign in, then close it (15 min max).' });
	const r = await engine('ui-login.mjs', ['--url', url, '--storage', authFile(project.id, url)], run.id, signal);
	if (!r.ok) throw new Error('no saved session');
	return { host: new URL(url).hostname };
};

const HANDLERS: Record<JobKind, Handler> = {
	storyboard_generate: storyboardGenerate,
	storyboard_revise: storyboardRevise,
	shot_build: shotBuild,
	shot_fix: shotFix,
	render: renderShot,
	eval: evaluate,
	assemble,
	asset_generate: assetGenerate,
	sound_design: soundDesign,
	resolve_export: resolveExport,
	lesson_distill: lessonDistill,
	reference_analyze: referenceAnalyze,
	reference_scout: referenceScout,
	brief_review: briefReview,
	stills_render: stillsRender,
	ui_harvest: uiHarvest,
	ui_login: uiLogin,
	voice_generate: voiceGenerate,
	animatic,
	video_translate: videoTranslate
};

/** Starts lesson distillation in the project's memory queue (does not wait for the video). */
function enqueueDistill(parent: S.Run, input: Record<string, unknown>) {
	setTimeout(() => enqueue('lesson_distill', { projectId: parent.projectId, videoId: parent.videoId, parentId: parent.id, lane: 'memory', ...input }), 0);
}

/** Chains a run in the same queue (after the current run ends). */
function enqueueFollowUp(parent: S.Run, kind: JobKind, input: Record<string, unknown>) {
	const title = (input.title as string | undefined) ?? `${KIND_TITLES[kind]}${input.shotKey ? ` · ${input.shotKey}` : ''}`;
	emit(parent.id, 'log', { message: `→ next: ${title}` });
	// Deferred: the video's queue waits for this run to end before executing the next one.
	setTimeout(() => enqueue(kind, { projectId: parent.projectId, videoId: parent.videoId, parentId: parent.id, ...input, title }), 0);
}
