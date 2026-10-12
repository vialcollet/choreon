import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lesson, LessonScope, LessonStatus, ModelChoice, Role, StudioSettings } from '$lib/types';
import { db, id, json, now } from './db';
import { DEFAULT_STUDIO } from './defaults';
import { DATA_DIR, ensureDir, projectDir } from './paths';
import type { Project } from './store';

// Studio memory. Two levels:
//  - harness: know-how valid for every project (animation technique, engine pitfalls);
//  - project: deviations from a project's identity (brand guidelines, tone, logo).
// Active lessons are written to data/lessons.md and projects/<p>/brand/lessons.md, which the
// CLAUDE.md of every project workspace references; the critic checks them explicitly.

// ---------- studio settings ----------

export function studioSettings(): StudioSettings {
	const r = db.query('SELECT value FROM settings WHERE key = ?').get('studio') as { value: string } | null;
	const s = json<Partial<StudioSettings>>(r?.value, {});
	return { ...DEFAULT_STUDIO, ...s, models: { ...DEFAULT_STUDIO.models, ...(s.models ?? {}) }, dictation: { ...DEFAULT_STUDIO.dictation, ...(s.dictation ?? {}) } };
}

export function saveStudioSettings(s: StudioSettings) {
	db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('studio', JSON.stringify(s));
}

/**
 * Model and effort for a role: one-off run override > project setting > studio.
 * (The old critic/builder settings of the eval grid are still read, for migration.)
 */
export function modelFor(project: Project, role: Role, override?: Partial<ModelChoice> | null): ModelChoice {
	const studio = studioSettings().models[role];
	const legacy =
		role === 'critic' ? project.settings.eval.critic
		: role === 'animator' || role === 'director' ? project.settings.eval.builder
		: undefined;
	const fromProject = project.settings.models?.[role] ?? legacy;
	const base = { ...studio, ...(fromProject ?? {}) } as ModelChoice;
	return { model: override?.model || base.model, effort: (override?.effort as ModelChoice['effort']) || base.effort };
}

// ---------- lessons ----------

type Row = Record<string, any>;
const toLesson = (r: Row): Lesson => ({
	id: r.id, num: r.num, scope: r.scope, projectId: r.project_id, rule: r.rule, rationale: r.rationale, status: r.status,
	source: json(r.source, {}), uses: r.uses, violations: r.violations, createdAt: r.created_at, updatedAt: r.updated_at
});

export function listLessons(opts: { projectId?: string | null; scope?: LessonScope; status?: LessonStatus } = {}): Lesson[] {
	return (db.query('SELECT * FROM lessons ORDER BY num').all() as Row[])
		.map(toLesson)
		.filter((l) => (opts.scope ? l.scope === opts.scope : true))
		.filter((l) => (opts.status ? l.status === opts.status : true))
		.filter((l) => (opts.projectId === undefined ? true : l.scope === 'harness' || l.projectId === opts.projectId));
}

export function getLesson(lid: string): Lesson | null {
	const r = db.query('SELECT * FROM lessons WHERE id = ?').get(lid) as Row | null;
	return r ? toLesson(r) : null;
}

/** Active lessons that apply to a project: the harness ones + the project ones. */
export const activeLessonsFor = (projectId: string) => listLessons({ projectId, status: 'active' });

export function createLesson(l: { scope: LessonScope; projectId: string | null; rule: string; rationale?: string; source?: Lesson['source']; status?: LessonStatus }): Lesson {
	const num = ((db.query('SELECT MAX(num) AS n FROM lessons').get() as { n: number | null }).n ?? 0) + 1;
	const lid = id();
	const status = l.status ?? (studioSettings().autoApproveLessons ? 'active' : 'proposed');
	db.query('INSERT INTO lessons (id, num, scope, project_id, rule, rationale, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
		lid, num, l.scope, l.scope === 'project' ? l.projectId : null, l.rule.trim(), (l.rationale ?? '').trim(), status, JSON.stringify(l.source ?? {}), now(), now()
	);
	syncLessonFiles();
	return toLesson(db.query('SELECT * FROM lessons WHERE id = ?').get(lid) as Row);
}

export function updateLesson(lid: string, patch: { rule?: string; rationale?: string; scope?: LessonScope; projectId?: string | null; status?: LessonStatus }) {
	const r = db.query('SELECT * FROM lessons WHERE id = ?').get(lid) as Row | null;
	if (!r) return;
	const l = toLesson(r);
	const scope = patch.scope ?? l.scope;
	db.query('UPDATE lessons SET rule = ?, rationale = ?, scope = ?, project_id = ?, status = ?, updated_at = ? WHERE id = ?').run(
		patch.rule ?? l.rule, patch.rationale ?? l.rationale, scope, scope === 'project' ? (patch.projectId ?? l.projectId) : null, patch.status ?? l.status, now(), lid
	);
	syncLessonFiles();
}

export function deleteLesson(lid: string) {
	db.query('DELETE FROM lessons WHERE id = ?').run(lid);
	syncLessonFiles();
}

export function countUses(lessons: Lesson[]) {
	for (const l of lessons) db.query('UPDATE lessons SET uses = uses + 1 WHERE id = ?').run(l.id);
}

export function countViolations(nums: number[]) {
	for (const n of nums) db.query('UPDATE lessons SET violations = violations + 1 WHERE num = ?').run(n);
}

const bullet = (l: Lesson) => `- **L${l.num}** — ${l.rule}${l.rationale ? `\n  _Why: ${l.rationale}_` : ''}`;

/** Lessons block for a prompt (empty if none). */
export function lessonsBlock(projectId: string, title = 'Lessons learned (must be followed)'): string {
	const ls = activeLessonsFor(projectId);
	if (!ls.length) return '';
	const h = ls.filter((l) => l.scope === 'harness');
	const p = ls.filter((l) => l.scope === 'project');
	return [
		`## ${title}`,
		h.length ? `### Studio (all projects)\n${h.map(bullet).join('\n')}` : '',
		p.length ? `### This project\n${p.map(bullet).join('\n')}` : ''
	]
		.filter(Boolean)
		.join('\n\n');
}

/** Rewrites data/lessons.md (harness) and each project's brand/lessons.md (active lessons). */
export function syncLessonFiles() {
	const all = listLessons({ status: 'active' });
	ensureDir(DATA_DIR);
	const h = all.filter((l) => l.scope === 'harness');
	writeFileSync(join(DATA_DIR, 'lessons.md'), `# Studio lessons (harness)\n\nLearned from notes and reviews; valid for every project.\n\n${h.map(bullet).join('\n') || '_None yet._'}\n`);
	const projects = db.query('SELECT id FROM projects').all() as { id: string }[];
	for (const { id: pid } of projects) {
		const p = all.filter((l) => l.scope === 'project' && l.projectId === pid);
		try {
			writeFileSync(join(projectDir(pid), 'brand', 'lessons.md'), `# Project lessons\n\nDeviations from the identity spotted in notes and reviews. They add to motion.md.\n\n${p.map(bullet).join('\n') || '_None yet._'}\n`);
		} catch {}
	}
}
