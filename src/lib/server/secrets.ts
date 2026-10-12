import { env } from '$env/dynamic/private';
import { db, json } from './db';

// API keys, from .env first, otherwise entered in Studio settings (stored locally in studio.db,
// never sent back to the browser). Everything is optional: without keys the studio falls back to
// the Claude Code subscription (agents), Claude Haiku (note routing) and no dictation.

export const SECRET_KEYS = {
	ANTHROPIC_API_KEY: { label: 'Anthropic (Claude)', hint: 'Agents via the API instead of a Claude Code subscription', url: 'https://console.anthropic.com/settings/keys' },
	TYPESAFE_API_KEY: { label: 'TypeSafe (Jev)', hint: 'Fast note routing; falls back to Claude Haiku without it', url: 'https://typesafe.ai' },
	GROQ_API_KEY: { label: 'Groq (Whisper)', hint: 'Voice dictation in text fields', url: 'https://console.groq.com/keys' },
	OPENAI_API_KEY: { label: 'OpenAI (Whisper)', hint: 'Voice dictation, alternative to Groq', url: 'https://platform.openai.com/api-keys' },
	GEMINI_API_KEY: { label: 'Google Gemini (TTS)', hint: 'Voice-over: the whole script read in one take (word timings need Groq)', url: 'https://aistudio.google.com/apikey' }
} as const;
export type SecretKey = keyof typeof SECRET_KEYS;

const stored = (): Partial<Record<SecretKey, string>> => {
	const r = db.query('SELECT value FROM settings WHERE key = ?').get('secrets') as { value: string } | null;
	return json(r?.value, {});
};

/** A key's value: .env wins, then the one entered in the UI. */
export function secret(name: SecretKey): string | undefined {
	return (env[name] || process.env[name] || stored()[name] || '').trim() || undefined;
}

/** Where each key comes from, masked, for the settings page. */
export function secretsStatus() {
	const s = stored();
	return (Object.keys(SECRET_KEYS) as SecretKey[]).map((k) => {
		const fromEnv = (env[k] || process.env[k] || '').trim();
		const v = fromEnv || (s[k] ?? '').trim();
		return { key: k, ...SECRET_KEYS[k], source: fromEnv ? ('env' as const) : v ? ('ui' as const) : null, masked: v ? `••••${v.slice(-4)}` : '' };
	});
}

/** Sets (or clears, with an empty value) a key entered in the UI. Keys from .env cannot be overridden here. */
export function setSecret(name: SecretKey, value: string) {
	const s = stored();
	if (value.trim()) s[name] = value.trim();
	else delete s[name];
	db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('secrets', JSON.stringify(s));
}
