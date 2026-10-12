import { isOrgAdmin, isStudioAdmin, visibleProjects } from '$lib/server/access';
import { activeRuns } from '$lib/server/activity';
import { listLessons } from '$lib/server/lessons';
import { listVideos } from '$lib/server/store';
import { userOrgs } from '$lib/server/tenancy';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const u = locals.user;
	const lang = locals.lang;
	if (!u) return { lang, user: null, orgs: [], activeOrg: null, isAdmin: false, isOrgAdmin: false, proposed: 0, nav: [], activity: [] };
	const projects = visibleProjects(locals);
	const ids = new Set(projects.map((p) => p.id));
	const admin = isStudioAdmin(locals);
	const orgs = userOrgs(u.id);
	return {
		lang,
		user: { id: u.id, name: u.name, email: u.email },
		orgs,
		activeOrg: orgs.find((o) => o.id === locals.session?.activeOrganizationId) ?? null,
		isAdmin: admin,
		isOrgAdmin: isOrgAdmin(locals),
		// Lessons to validate: the harness's for the admin, the tenant's projects' for everyone.
		proposed: listLessons({ status: 'proposed' }).filter((l) => (l.scope === 'harness' ? admin : ids.has(l.projectId ?? ''))).length,
		activity: activeRuns(locals),
		nav: projects.map((p) => ({ id: p.id, name: p.name, videos: listVideos(p.id).map((v) => ({ slug: v.slug, title: v.title })) }))
	};
};
