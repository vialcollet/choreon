// Small client for the /api routes (browser side).

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
	const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
	if (!res.ok) throw new Error((await res.text()) || `${res.status}`);
	return (await res.json()) as T;
}

import { runOverride } from './override.svelte';

export const api = {
	job: (body: Record<string, unknown>) =>
		call<{ id: string }>('POST', '/api/jobs', {
			...(runOverride.model ? { model: runOverride.model } : {}),
			...(runOverride.effort ? { effort: runOverride.effort } : {}),
			...body
		}),
	lesson: (method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) => call(method, '/api/lessons', body),
	cancel: (runId: string) => call('POST', `/api/runs/${runId}/cancel`),
	note: (body: Record<string, unknown>) => call<Record<string, unknown>>('POST', '/api/notes', body),
	noteStatus: (id: string, status: string) => call('PATCH', '/api/notes', { id, status }),
	deleteNote: (id: string) => call('DELETE', `/api/notes?id=${id}`)
};

export const fmtTime = (ms: number, lang: 'en' | 'fr' = 'en') => new Date(ms).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' });
export const fmtCost = (usd: number) => (usd > 0 ? `${usd.toFixed(2)} $` : '');
export const fmtDur = (a: number | null, b: number | null) => {
	if (!a) return '';
	const s = Math.round(((b ?? Date.now()) - a) / 1000);
	return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
};
