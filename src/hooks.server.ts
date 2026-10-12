import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { error, redirect, type Handle } from '@sveltejs/kit';
import { getMigrations } from 'better-auth/db/migration';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { canAccessProject, isStudioAdmin } from '$lib/server/access';
import { auth } from '$lib/server/auth';
import { tokenMatches } from '$lib/server/service-auth';
import { db } from '$lib/server/db';
import { FILE_HEADERS } from '$lib/server/paths';
import { toLang, translate } from '$lib/i18n';

if (!building) {
	// better-auth tables (user, session, organization, member, invitation…) in studio.db.
	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
	// At startup: a run left "in progress" was interrupted (the process is new). Only once
	// per process: in dev, a hot reload of this module must not kill live runs.
	const g = globalThis as { __studioBooted?: boolean };
	if (!g.__studioBooted && (g.__studioBooted = true)) db.query("UPDATE runs SET status = 'error', error = 'interrupted by a server restart', finished_at = ? WHERE status IN ('queued','running')").run(Date.now());
}

const PUBLIC = /^\/(login|signup|invite\/|api\/auth\/)/;
const FILES = /^\/files(\/|$)/;

/**
  * Service token (STUDIO_TOKEN) for local scripts (captures, CLI): acts as the studio's first
  * admin, in their first organization.
 */
function serviceLocals(req: Request): App.Locals | null {
	if (!tokenMatches(req.headers.get('authorization'), env.STUDIO_TOKEN)) return null;
	const u = db.query("SELECT id, name, email, role FROM user WHERE role = 'admin' ORDER BY createdAt LIMIT 1").get() as { id: string; name: string; email: string; role: string } | null;
	if (!u) return null;
	const org = db.query('SELECT organizationId AS id FROM member WHERE userId = ? ORDER BY createdAt LIMIT 1').get(u.id) as { id: string } | null;
	return { user: { ...u } as App.Locals['user'], session: { activeOrganizationId: org?.id ?? null } as App.Locals['session'], lang: 'en' };
}

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const svc = serviceLocals(event.request);
	event.locals.user = null;
	event.locals.session = null;
	if (svc) Object.assign(event.locals, svc);
	else if (!path.startsWith('/api/auth/')) {
		const s = await auth.api.getSession({ headers: event.request.headers });
		event.locals.user = (s?.user as App.Locals['user']) ?? null;
		event.locals.session = (s?.session as App.Locals['session']) ?? null;
	}
	const l = event.locals;
	l.lang = toLang(event.cookies.get('lang') ?? event.request.headers.get('accept-language'));
	const tr = (s: string) => translate(l.lang, s);

	if (!l.user && !PUBLIC.test(path)) {
		// /files answers itself: a thrown error() would lose the hardening headers.
		if (FILES.test(path)) return new Response(tr('Not signed in'), { status: 401, headers: { ...FILE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
		if (path.startsWith('/api/')) error(401, tr('Not signed in'));
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}
	if (l.user) {
		// Tenant: a project is only visible to members of its organization (/files/… checks it itself).
		const pid = /^\/p\/([^/]+)/.exec(path)?.[1];
		if (pid && !canAccessProject(l, decodeURIComponent(pid))) error(404, tr('Project not found'));
		if (/^\/(settings|admin)(\/|$)/.test(path) && !isStudioAdmin(l)) error(403, tr('Studio administrators only'));
	}
	const withLang: typeof resolve = (e, opts) => resolve(e, { ...opts, transformPageChunk: ({ html }) => html.replace('%lang%', l.lang) });
	const res = await svelteKitHandler({ event, resolve: withLang, auth, building });
	// Every /files response (any method, errors included) is hardened; rebuilt because a response's headers may be immutable.
	if (!FILES.test(path)) return res;
	const out = new Response(res.body, res);
	for (const [k, v] of Object.entries(FILE_HEADERS)) out.headers.set(k, v);
	return out;
};
