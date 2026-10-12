import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { admin, organization } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db';
import { DATA_DIR } from './paths';

// Authentication and multi-tenancy (better-auth, same SQLite database as the studio).
//  - Organization = tenant: it owns projects; its members have an owner/admin/member role.
//  - Global "admin" role (admin plugin) = studio administrator: users, organizations,
//    harness settings and lessons.
//  - Signup is closed: the very first account (which becomes admin), an invited account, or an
//    account created by an admin. No mail server: invitations are shared by link.

const userCount = () => (db.query('SELECT count(*) AS n FROM user').get() as { n: number }).n;
const pendingInvite = (email: string) =>
	!!db.query("SELECT 1 FROM invitation WHERE lower(email) = lower(?) AND status = 'pending' AND expiresAt > ?").get(email, new Date().toISOString());
/** User's first organization, to activate a tenant at login. */
const firstOrg = (userId: string) =>
	(db.query('SELECT organizationId AS id FROM member WHERE userId = ? ORDER BY createdAt LIMIT 1').get(userId) as { id: string } | null)?.id ?? null;

const baseURL = env.BETTER_AUTH_URL ?? 'http://localhost:5610';

/** Session secret: BETTER_AUTH_SECRET, otherwise a random secret created once in data/. */
function authSecret(): string {
	if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
	const file = join(DATA_DIR, '.auth-secret');
	if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
	return readFileSync(file, 'utf8').trim();
}

export const auth = betterAuth({
	appName: 'Choreon',
	baseURL,
	// The studio opens on either localhost or 127.0.0.1.
	trustedOrigins: [baseURL, baseURL.replace('localhost', '127.0.0.1'), baseURL.replace('127.0.0.1', 'localhost')],
	secret: authSecret(),
	database: db,
	// hooks.server.ts migrates the tables at startup; the check would run first and report a fresh database as broken.
	advanced: { database: { validateSchema: false } },
	emailAndPassword: { enabled: true, minPasswordLength: 10 },
	session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
	databaseHooks: {
		user: {
			create: {
				before: async (user, ctx) => {
					if (userCount() === 0) return { data: { ...user, role: 'admin' } };
					if (ctx?.path === '/admin/create-user' || pendingInvite(user.email)) return { data: user };
					throw new APIError('FORBIDDEN', { message: 'Sign-up by invitation only' });
				}
			}
		},
		session: {
			create: {
				before: async (session) => ({ data: { ...session, activeOrganizationId: firstOrg(session.userId) } })
			}
		}
	},
	plugins: [
		organization({
			// Only studio admins create tenants (from /admin).
			allowUserToCreateOrganization: async (user) => (user as { role?: string }).role === 'admin',
			invitationExpiresIn: 60 * 60 * 24 * 7,
			sendInvitationEmail: async () => {
				// No mail: the /invite/<id> link is shown in /org to be shared.
			}
		}),
		admin(),
		sveltekitCookies(getRequestEvent)
	]
});

export type Session = typeof auth.$Infer.Session;
