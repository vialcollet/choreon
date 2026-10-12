import { fail } from '@sveltejs/kit';
import { DICTATION_MODELS } from '$lib/types';
import { saveStudioSettings, studioSettings } from '$lib/server/lessons';
import { DEFAULT_BRIEF_AXES } from '$lib/server/defaults';
import { claudeAuth } from '$lib/server/agent';
import { SECRET_KEYS, secret, secretsStatus, setSecret, type SecretKey } from '$lib/server/secrets';
import type { StudioSettings } from '$lib/types';
import { translate } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	studio: studioSettings(),
	defaultAxes: DEFAULT_BRIEF_AXES,
	// Presence and origin of keys (never their value).
	keys: { groq: !!secret('GROQ_API_KEY'), openai: !!secret('OPENAI_API_KEY') },
	secrets: secretsStatus(),
	claudeAuthEffective: claudeAuth()
});

const slug = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export const actions: Actions = {
	save: async ({ request, locals }) => {
		try {
			const s = JSON.parse(String((await request.formData()).get('settings') ?? '')) as StudioSettings;
			const seen = new Set<string>();
			const briefAxes = (s.briefAxes ?? [])
				.map((a) => ({ key: slug(a.key || a.label), label: a.label.trim(), hint: a.hint.trim(), suggestions: a.suggestions.map((x) => x.trim()).filter(Boolean) }))
				.filter((a) => a.key && a.label && !seen.has(a.key) && seen.add(a.key));
			const provider = s.dictation?.provider === 'openai' ? 'openai' : 'groq';
			const model = DICTATION_MODELS[provider].includes(s.dictation?.model ?? '') ? s.dictation!.model : DICTATION_MODELS[provider][0];
			const dictation = { provider, model, language: String(s.dictation?.language ?? '').trim().toLowerCase().slice(0, 5) } as const;
			const parallel = Math.max(1, Math.min(8, Math.round(Number(s.parallel)) || 4));
			const auth = (['auto', 'subscription', 'api_key'] as const).find((x) => x === s.claudeAuth) ?? 'auto';
			saveStudioSettings({ ...studioSettings(), ...s, autoApproveLessons: !!s.autoApproveLessons, briefAxes: briefAxes.length ? briefAxes : DEFAULT_BRIEF_AXES, dictation, parallel, claudeAuth: auth });
		} catch {
			return fail(400, { error: translate(locals.lang, 'Unreadable settings') });
		}
		return { saved: true };
	},
	/** Entering or clearing an API key (empty = clear). Keys from .env can't be changed here. */
	secret: async ({ request, locals }) => {
		const f = await request.formData();
		const key = String(f.get('key') ?? '') as SecretKey;
		if (!(key in SECRET_KEYS)) return fail(400, { error: translate(locals.lang, 'Unknown key') });
		setSecret(key, String(f.get('value') ?? ''));
		return { savedKey: key };
	}
};
