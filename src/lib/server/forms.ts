import { fail } from '@sveltejs/kit';

// Small utilities for form actions (auth, organization, admin).

export const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** Internal redirect only (no external URL via ?next=). */
export const safeNext = (n: string | null | undefined) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

/** Readable message from a better-auth or JS error. */
export function errMsg(e: unknown): string {
	const b = (e as { body?: { message?: string }; message?: string }) ?? {};
	return b.body?.message ?? b.message ?? String(e);
}

/** Runs an action; an error becomes fail(400) with its message. */
export async function attempt<T>(fn: () => Promise<T> | T, extra: Record<string, unknown> = {}) {
	try {
		return { ok: true as const, value: await fn() };
	} catch (e) {
		return { ok: false as const, failure: fail(400, { error: errMsg(e), ...extra }) };
	}
}
