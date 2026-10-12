import { isStudioAdmin, visibleProjects } from '$lib/server/access';
import { listLessons, syncLessonFiles } from '$lib/server/lessons';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	syncLessonFiles();
	const projects = visibleProjects(locals).map((p) => ({ id: p.id, name: p.name }));
	const ids = new Set(projects.map((p) => p.id));
	// Harness lessons (shared) + lessons of the tenant's projects; only the admin edits the harness.
	return { lessons: listLessons().filter((l) => l.scope === 'harness' || ids.has(l.projectId ?? '')), projects, canEditHarness: isStudioAdmin(locals) };
};
