import type { ShotData } from '$lib/types';

/** Beats from an agent's JSON: objects only, `t` finite and clamped to the shot, text fields as strings. */
export function normBeats(raw: unknown, duration: number): ShotData['beats'] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && !Array.isArray(b))
		.map((b) => {
			const t = Number(b.t);
			return { t: Number.isFinite(t) ? Math.min(Math.max(t, 0), duration) : 0, state: String(b.state ?? ''), cursor: b.cursor ? String(b.cursor) : '', sound: b.sound ? String(b.sound) : '' };
		});
}
