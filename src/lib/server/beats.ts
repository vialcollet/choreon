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

/**
 * The shot's plan after a fix that carried director's decisions: the animator's `beats.json` (beats, visual,
 * on-screen text) laid over the shot as it is NOW, so whatever changed while the agent worked (a voice take's
 * words, an edited line) stays, and the decisions added to its notes. `beats` is null when the plan had none.
 */
export function planAfterFix(current: ShotData, plan: { beats?: unknown; visual?: unknown; onScreenText?: unknown } | null, decisions: string[], duration: number): { data: ShotData; beats: ShotData['beats'] | null } {
	const planned = normBeats(plan?.beats, duration);
	const beats = planned.length ? planned : null;
	const data: ShotData = {
		...current,
		...(beats ? { beats } : {}),
		...(typeof plan?.visual === 'string' && plan.visual.trim() ? { visual: plan.visual.trim() } : {}),
		...(typeof plan?.onScreenText === 'string' ? { onScreenText: plan.onScreenText.trim() } : {}),
		directorNotes: [...(current.directorNotes ?? []), ...decisions]
	};
	return { data, beats };
}
