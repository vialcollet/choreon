import { getContext, setContext } from 'svelte';

// Interface strings are written in English in the code; French translations live in
// src/lib/i18n/fr/*.ts (one file per area, merged here). Missing translation = English text.
//   const { t } = useI18n();   t('Studio settings')   t('{n} shots', { n: 5 })

export type Lang = 'en' | 'fr';
export const LANGS: { id: Lang; label: string }[] = [
	{ id: 'en', label: 'English' },
	{ id: 'fr', label: 'Français' }
];

const modules = import.meta.glob('./fr/*.ts', { eager: true }) as Record<string, { default: Record<string, string> }>;
const FR: Record<string, string> = Object.assign({}, ...Object.values(modules).map((m) => m.default));

export type Vars = Record<string, string | number | null | undefined>;

/** Translation of an English source string, with {name} placeholders. */
export function translate(lang: Lang, key: string, vars?: Vars): string {
	let s = lang === 'fr' ? (FR[key] ?? key) : key;
	if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
	return s;
}

/**
 * Run titles are stored in English ("Shot s02 — auto fix (round 2)") and translated for display:
 * whole title first, then each segment between " — " / " · ", with shot keys and numbers as {key}/{n}.
 */
export function translateTitle(lang: Lang, title: string): string {
	if (lang === 'en' || !title) return title;
	if (FR[title]) return FR[title];
	return title
		.split(/( — | · )/)
		.map((seg) => {
			if (FR[seg]) return FR[seg];
			const vals: Record<string, string> = {};
			const tpl = seg.replace(/\bs\d{2}\b/, (m) => ((vals.key = m), '{key}')).replace(/\d+/, (m) => ((vals.n = m), '{n}'));
			return FR[tpl] ? translate(lang, tpl, vals) : seg;
		})
		.join('');
}

/** Normalises a language code ('fr-FR', 'en', …) to a supported language. */
export const toLang = (x: string | null | undefined): Lang => (x && /^fr\b/i.test(x) ? 'fr' : 'en');

const KEY = Symbol('i18n');

/** Root layout: provides the current language (a getter, so a change re-renders). */
export function provideI18n(get: () => Lang) {
	setContext(KEY, get);
}

/** In a component: `const { t, lang } = useI18n();` */
export function useI18n() {
	const get = (getContext(KEY) as (() => Lang) | undefined) ?? (() => 'en' as Lang);
	return { t: (key: string, vars?: Vars) => translate(get(), key, vars), tt: (title: string) => translateTitle(get(), title), lang: get };
}

/** Number and date formatting in the current language. */
export const locale = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-US');
