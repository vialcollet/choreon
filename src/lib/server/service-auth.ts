import { createHash, timingSafeEqual } from 'node:crypto';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

// The studio's service token (STUDIO_TOKEN): checking it, and deciding who may hand it to a harvest.

const digest = (s: string) => createHash('sha256').update(s).digest();
const parse = (url: string) => {
	try {
		return new URL(url);
	} catch {
		return null;
	}
};
const portOf = (u: URL) => u.port || (u.protocol === 'https:' ? '443' : '80');

/** `Authorization` header is exactly `Bearer <token>`; constant-time (digests have equal length), false without a token. */
export function tokenMatches(header: string | null | undefined, token: string | undefined): boolean {
	if (!token || header == null) return false;
	return timingSafeEqual(digest(header), digest(`Bearer ${token}`));
}

/** Port the studio listens on: always 5610 in dev (vite pins it and ignores `PORT`), `PORT` or 3000 in production (adapter-node). */
export const studioPort = (o: { dev: boolean; port?: string } = { dev, port: env.PORT }): string => (o.dev ? '5610' : o.port || '3000');

/** The address is one of the studio's own: loopback hosts at the studio port, or one of `origins`. */
export function isStudioOrigin(url: string, o: { port: string; origins: string[] }): boolean {
	const u = parse(url);
	if (!u) return false;
	if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && portOf(u) === o.port) return true;
	return o.origins.some((x) => parse(x)?.origin === u.origin);
}

/**
 * Environment that signs a harvest in as the studio: only for a studio admin, at exactly
 * http://127.0.0.1:<port> (the IPv4 loopback the studio is bound to; `localhost` may resolve to
 * another service on ::1), and only when the studio really is bound there: always in dev, in
 * production when HOST is unset (`start` defaults it to 127.0.0.1), 127.0.0.1 or 0.0.0.0.
 */
export function selfHarvestEnv(url: string, o: { admin: boolean; token?: string; port: string; host?: string; dev: boolean }): Record<string, string> {
	const u = parse(url);
	const bound = o.dev || !o.host || o.host === '127.0.0.1' || o.host === '0.0.0.0';
	return o.admin && o.token && bound && u && u.protocol === 'http:' && u.hostname === '127.0.0.1' && portOf(u) === o.port ? { CHOREON_SELF_TOKEN: o.token } : {};
}
