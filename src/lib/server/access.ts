import { error } from '@sveltejs/kit';
import { db } from './db';
import { getRef } from './refs';
import * as S from './store';

// Multi-tenant access control. A user sees the projects of their active organization, plus the
// studio's shared projects (no organization: the seeded demos); the studio admin can open any project.

export type OrgRole = 'owner' | 'admin' | 'member';

export const isStudioAdmin = (l: App.Locals) => l.user?.role === 'admin';

/** User's role in an organization (null if not a member). */
export function orgRole(l: App.Locals, orgId = l.session?.activeOrganizationId): OrgRole | null {
	if (!l.user || !orgId) return null;
	const r = db.query('SELECT role FROM member WHERE userId = ? AND organizationId = ?').get(l.user.id, orgId) as { role: string } | null;
	return (r?.role.split(',')[0] as OrgRole) ?? null;
}

export const isOrgAdmin = (l: App.Locals) => isStudioAdmin(l) || ['owner', 'admin'].includes(orgRole(l) ?? '');

export function canAccessProject(l: App.Locals, pid: string): boolean {
	if (!l.user) return false;
	if (isStudioAdmin(l)) return true;
	const p = S.getProject(pid);
	if (!p) return false;
	return !p.orgId || orgRole(l, p.orgId) !== null;
}

/** Route guard: the project exists and the user has access (otherwise 404, revealing nothing). */
export function requireProject(l: App.Locals, pid: string | null | undefined) {
	if (!pid || !canAccessProject(l, pid)) error(404, 'project not found');
	return S.getProject(pid)!;
}

export function requireVideo(l: App.Locals, vid: string | null | undefined) {
	const v = vid ? S.getVideo(vid) : null;
	if (!v || !canAccessProject(l, v.projectId)) error(404, 'video not found');
	return v;
}

export function requireRun(l: App.Locals, runId: string) {
	const r = S.getRun(runId);
	if (!r || !canAccessProject(l, r.projectId)) error(404, 'run not found');
	return r;
}

/** Projects visible in the active tenant: its own, then the shared ones. */
export const visibleProjects = (l: App.Locals) => [...S.listProjects(l.session?.activeOrganizationId ?? ''), ...S.listProjects(null)];

// Scoped selectors: an id from a request or a job input only counts if it belongs to the expected parent.

export const refOf = (projectId: string, id: string) => {
	const r = getRef(id);
	return r?.projectId === projectId ? r : null;
};
export const videoOf = (projectId: string, id: string) => {
	const v = S.getVideo(id);
	return v?.projectId === projectId ? v : null;
};
export const renderOf = (videoId: string, id: string) => {
	const r = S.getRender(id);
	return r?.videoId === videoId ? r : null;
};
/** Only the notes of that video (foreign and unknown ids are dropped). */
export const notesOf = (videoId: string, ids: string[]) => S.getNotes(ids).filter((n) => n.videoId === videoId);
/** Only the notes of the videos of that project (foreign and unknown ids are dropped). */
export const projectNotesOf = (projectId: string, ids: string[]) => S.getNotes(ids).filter((n) => videoOf(projectId, n.videoId));
