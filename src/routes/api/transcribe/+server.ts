import { error, json } from '@sveltejs/kit';
import { secret } from '$lib/server/secrets';
import { studioSettings } from '$lib/server/lessons';
import type { DictationProvider } from '$lib/types';
import { translate } from '$lib/i18n';
import type { RequestHandler } from './$types';

// Dictation: transcribes a browser recording with Whisper (Groq or OpenAI, chosen in
// the studio settings). Keys in .env: GROQ_API_KEY, OPENAI_API_KEY.

const ENDPOINTS: Record<DictationProvider, { url: string; key: () => string | undefined }> = {
	groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: () => secret('GROQ_API_KEY') },
	openai: { url: 'https://api.openai.com/v1/audio/transcriptions', key: () => secret('OPENAI_API_KEY') }
};

/** Providers whose key is configured (for the UI, never exposing the key). */
export const GET: RequestHandler = () => {
	const d = studioSettings().dictation;
	return json({ provider: d.provider, available: { groq: !!secret('GROQ_API_KEY'), openai: !!secret('OPENAI_API_KEY') } });
};

/** multipart : file (audio webm/ogg/mp4), prompt? (contexte : noms propres, vocabulaire). */
export const POST: RequestHandler = async ({ request, locals }) => {
	const tr = (k: string, v?: Record<string, string | number>) => translate(locals.lang, k, v);
	const d = studioSettings().dictation;
	const ep = ENDPOINTS[d.provider];
	const key = ep?.key();
	if (!key) error(400, tr('Dictation: add the {provider} key in Studio settings → API keys (or .env)', { provider: d.provider === 'groq' ? 'Groq' : 'OpenAI' }));
	const f = await request.formData();
	const file = f.get('file');
	if (!(file instanceof File) || !file.size) error(400, tr('empty recording'));
	if (file.size > 24 * 1024 * 1024) error(413, tr('recording too long (25 MB max)'));

	const body = new FormData();
	body.append('file', file, file.name || 'dictee.webm');
	body.append('model', d.model);
	body.append('response_format', 'json');
	if (d.language) body.append('language', d.language);
	const prompt = String(f.get('prompt') ?? '').slice(0, 800);
	if (prompt) body.append('prompt', prompt);

	const res = await fetch(ep.url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body });
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		error(502, tr('Transcription {provider}: {status} {detail}', { provider: d.provider, status: res.status, detail: detail.slice(0, 300) }));
	}
	const out = (await res.json()) as { text?: string };
	return json({ text: (out.text ?? '').trim(), provider: d.provider, model: d.model });
};
