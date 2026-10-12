import { error, json } from '@sveltejs/kit';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireProject } from '$lib/server/access';
import { readJson } from '$lib/server/body';
import { engine } from '$lib/server/jobs';
import { ensureDir, fileUrl, projectDir } from '$lib/server/paths';
import { getTemplate, previewDir, previewKey, prunePreviews, templateDir } from '$lib/server/stills';
import type { RequestHandler } from './$types';

// Preview of a creative: rendered by the real engine (still.mjs), so identical to the final render.
// Outside the task queue: it is a short request (~2-3 s), cached by content.

declare global {
	var __stillsPreviewBusy: Map<string, number> | undefined;
}
const busy = (globalThis.__stillsPreviewBusy ??= new Map());

/** Body: { projectId, template, vars, format } → { url } */
export const POST: RequestHandler = async ({ request, locals }) => {
	const b = (await readJson(request)) as { projectId?: string; template?: string; vars?: Record<string, unknown>; format?: string };
	const project = requireProject(locals, String(b.projectId));
	const template = String(b.template ?? '');
	if (!getTemplate(project.id, template)) error(404, 'template not found');
	const format = String(b.format ?? '');
	if (!/^\d{3,4}x\d{3,4}$/.test(format)) error(400, 'invalid format');
	const vars = b.vars && typeof b.vars === 'object' ? b.vars : {};

	const key = previewKey(project.id, template, vars, format);
	const dir = ensureDir(previewDir(project.id));
	const out = join(dir, `${key}-${format}.png`);
	if (existsSync(out)) return json({ url: fileUrl(out) });

	// At most two previews in progress per project: the editor only sends the latest version.
	if ((busy.get(project.id) ?? 0) >= 2) error(429, 'preview already in progress');
	busy.set(project.id, (busy.get(project.id) ?? 0) + 1);
	try {
		const batch = join(dir, `${key}.json`);
		writeFileSync(batch, JSON.stringify([{ id: key, vars }]));
		const r = await engine('still.mjs', ['--project', projectDir(project.id), '--template', templateDir(project.id, template), '--batch', batch, '--out', dir, '--formats', format], '');
		prunePreviews(project.id);
		if (!existsSync(out)) error(500, 'preview not produced');
		return json({ url: fileUrl(out), errors: r.errors ?? [] });
	} finally {
		busy.set(project.id, (busy.get(project.id) ?? 1) - 1);
	}
};
