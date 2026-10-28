import type { BriefAxis, BriefState } from '$lib/types';
import { DEFAULT_BRIEF_AXES } from './defaults';
import { studioSettings } from './lessons';

// Framing: each axis ends in a decided direction or "ignored". As long as an axis stays
// open, the storyboard is blocked (the studio doesn't run without precise instructions).

export function briefAxes(): BriefAxis[] {
	const a = studioSettings().briefAxes;
	return a?.length ? a : DEFAULT_BRIEF_AXES;
}

/** Axes neither decided nor ignored. */
export function openAxes(state: BriefState, axes = briefAxes()): string[] {
	return axes.filter((a) => !state.decisions[a.key] && !state.ignored.includes(a.key)).map((a) => a.key);
}

/** Normalizes a state after modification: removes settled questions and recomputes the status. */
export function settle(state: BriefState, axes = briefAxes()): BriefState {
	const closed = (k: string) => !!state.decisions[k] || state.ignored.includes(k);
	const questions = state.questions.filter((q) => !closed(q.field));
	const ready = !questions.length && !openAxes(state, axes).length;
	const status = ready ? 'ready' : state.status === 'reviewing' ? 'reviewing' : questions.length ? 'interview' : 'draft';
	return { ...state, questions, status };
}

/**
 * The brief text changed: the decisions the director only inferred from the old text are dropped, so that the next
 * review derives them from the new one (otherwise an edited end line or a new call to action never reaches the
 * decisions). What the user answered or edited stays.
 */
export function forgetInferred(state: BriefState): BriefState {
	const decisions = { ...state.decisions };
	for (const k of state.inferred ?? []) delete decisions[k];
	return { ...state, decisions, inferred: [] };
}

/** Decisions made, for the director's and animator's instructions. */
export function decisionsBlock(state: BriefState): string {
	const axes = briefAxes();
	const lines = axes.filter((a) => state.decisions[a.key]).map((a) => `- **${a.label}**: ${state.decisions[a.key]}`);
	const ignored = axes.filter((a) => state.ignored.includes(a.key)).map((a) => a.label);
	if (!lines.length && !ignored.length) return '';
	return [`## Brief decisions (approved — follow them to the letter)`, ...lines, ignored.length ? `- Ignored axes (impose nothing, do not put them forward): ${ignored.join(', ')}` : ''].filter(Boolean).join('\n');
}
