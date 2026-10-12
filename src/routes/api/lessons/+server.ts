import { readJson } from '$lib/server/body';
import { error, json } from '@sveltejs/kit';
import { canAccessProject, isStudioAdmin } from '$lib/server/access';
import { createLesson, deleteLesson, getLesson, updateLesson } from '$lib/server/lessons';
import { translate } from '$lib/i18n';
import type { RequestHandler } from './$types';

/** Harness lessons: studio admin; a project's lessons: members of its tenant. */
function mayEdit(locals: App.Locals, scope: string, projectId?: string | null) {
	if (scope === 'project' ? !projectId || !canAccessProject(locals, projectId) : !isStudioAdmin(locals)) error(403, translate(locals.lang, 'not authorized'));
}
function requireLesson(locals: App.Locals, id: string) {
	const l = getLesson(id);
	if (!l) error(404, translate(locals.lang, 'lesson not found'));
	mayEdit(locals, l.scope, l.projectId);
	return l;
}

/** Lesson added by hand: { scope, projectId?, rule, rationale? } — active right away. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const b = (await readJson(request)) as Record<string, any>;
	mayEdit(locals, b.scope === 'project' ? 'project' : 'harness', b.projectId);
	if (!String(b.rule ?? '').trim()) error(400, translate(locals.lang, 'empty rule'));
	return json(createLesson({ scope: b.scope === 'project' ? 'project' : 'harness', projectId: b.projectId ?? null, rule: String(b.rule), rationale: String(b.rationale ?? ''), status: 'active', source: { manual: true } as any }));
};

/** { id, rule?, rationale?, scope?, projectId?, status? } */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const b = (await readJson(request)) as Record<string, any>;
	const lesson = requireLesson(locals, String(b.id));
	// Setting the scope or the project is a move: the target must be editable too.
	if (b.scope || b.projectId) mayEdit(locals, b.scope ?? lesson.scope, b.projectId ?? lesson.projectId);
	updateLesson(String(b.id), { rule: b.rule, rationale: b.rationale, scope: b.scope, projectId: b.projectId, status: b.status });
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const b = (await readJson(request)) as { id: string };
	requireLesson(locals, String(b.id));
	deleteLesson(String(b.id));
	return json({ ok: true });
};
