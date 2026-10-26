import type { ShotData } from '$lib/types';

// Translating a film into another language: pure helpers shared by the video_translate job and its tests.

export type Lang = 'en' | 'fr';
export const LANGS: Lang[] = ['en', 'fr'];
export const LANG_NAMES: Record<Lang, string> = { en: 'English', fr: 'French' };

/** What gets translated in a storyboard: text only, keyed so the translation maps back onto the same shots. */
export interface TranslationSource {
	title: string;
	brief: string;
	/** The brief's settled decisions (axis → direction). */
	decisions: Record<string, string>;
	logline: string;
	summary: string;
	shots: {
		key: string;
		title: string;
		intent: string;
		visual: string;
		onScreenText: string;
		voiceover: string;
		beats: { state: string; cursor: string; sound: string }[];
		transitionIn: string;
		transitionOut: string;
		sound: string;
		directorNotes: string[];
	}[];
}

type SourceShot = { key: string; title: string; duration: number; data: ShotData; refImage: string | null };

export function translationSource(video: { title: string; brief: string; decisions: Record<string, string> }, sb: { logline: string; summary: string }, shots: SourceShot[]): TranslationSource {
	return {
		title: video.title,
		brief: video.brief,
		decisions: video.decisions,
		logline: sb.logline,
		summary: sb.summary,
		shots: shots.map((s) => ({
			key: s.key,
			title: s.title,
			intent: s.data.intent,
			visual: s.data.visual,
			onScreenText: s.data.onScreenText ?? '',
			voiceover: s.data.voiceover ?? '',
			beats: s.data.beats.map((b) => ({ state: b.state, cursor: b.cursor ?? '', sound: b.sound ?? '' })),
			transitionIn: s.data.transitionIn ?? '',
			transitionOut: s.data.transitionOut ?? '',
			sound: s.data.sound ?? '',
			directorNotes: s.data.directorNotes ?? []
		}))
	};
}

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

/**
 * The translated storyboard: the source shots with the agent's text laid over them. Everything that is not text
 * (keys, durations, beat times, assets, reference images) stays the source's, so the copied scenes still match the
 * plan. The recorded words are dropped: they belong to the source's voice-over. Throws when the translation does not
 * cover every shot and every beat, rather than mixing two languages in one plan.
 */
export function applyTranslation(shots: SourceShot[], raw: unknown, refImage: (file: string | null) => string | null = (f) => f) {
	const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
	const out = Array.isArray(t.shots) ? (t.shots as Record<string, any>[]) : [];
	const byKey = new Map(out.filter((s) => s && typeof s === 'object').map((s) => [String(s.key), s]));
	const missing = shots.filter((s) => !byKey.has(s.key)).map((s) => s.key);
	if (missing.length) throw new Error(`the translation lacks shot(s) ${missing.join(', ')}`);
	const merged = shots.map((s) => {
		const x = byKey.get(s.key)!;
		const beats = Array.isArray(x.beats) ? x.beats : [];
		if (beats.length !== s.data.beats.length) throw new Error(`the translation of ${s.key} has ${beats.length} beats, the source ${s.data.beats.length}`);
		const { voiceWords: _, ...data } = s.data;
		const notes = Array.isArray(x.directorNotes) ? x.directorNotes.map(String) : [];
		const translated: ShotData = {
			...data,
			intent: str(x.intent, data.intent),
			visual: str(x.visual, data.visual),
			onScreenText: str(x.onScreenText, data.onScreenText ?? ''),
			voiceover: str(x.voiceover, data.voiceover ?? ''),
			beats: data.beats.map((b, i) => ({ ...b, state: str(beats[i]?.state, b.state), cursor: str(beats[i]?.cursor, b.cursor ?? ''), sound: str(beats[i]?.sound, b.sound ?? '') })),
			transitionIn: str(x.transitionIn, data.transitionIn ?? ''),
			transitionOut: str(x.transitionOut, data.transitionOut ?? ''),
			sound: str(x.sound, data.sound ?? ''),
			...(data.directorNotes?.length ? { directorNotes: notes.length === data.directorNotes.length ? notes : data.directorNotes } : {})
		};
		return { key: s.key, title: str(x.title, s.title), duration: s.duration, data: translated, refImage: refImage(s.refImage) };
	});
	const decisions = t.decisions && typeof t.decisions === 'object' && !Array.isArray(t.decisions) ? (t.decisions as Record<string, unknown>) : {};
	return {
		title: str(t.title, '').trim(),
		brief: str(t.brief, ''),
		decisions: Object.fromEntries(Object.entries(decisions).filter((e): e is [string, string] => typeof e[1] === 'string')),
		logline: str(t.logline, ''),
		summary: str(t.summary, ''),
		shots: merged
	};
}

/** A file copied into the translated film points at the copy: paths into the source video's folder move to the new one. */
export function repointPaths(text: string, fromSlug: string, toSlug: string): string {
	const esc = fromSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return text.replace(new RegExp(`(^|[^\\w-])videos/${esc}(?=/)`, 'g'), `$1videos/${toSlug}`);
}
