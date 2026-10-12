import { error, fail } from '@sveltejs/kit';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { translate } from '$lib/i18n';
import { projectDir, slugify } from '$lib/server/paths';
import * as S from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

const KIND = (mime: string, ext: string) =>
	ext === '.svg' ? 'svg'
	: mime.startsWith('image/') ? 'image'
	: mime.startsWith('video/') ? 'video'
	: mime.startsWith('audio/') ? 'audio'
	: ext === '.html' || ext === '.htm' ? 'html'
	: /\.(ttf|otf|woff2?)$/.test(ext) ? 'font'
	: 'other';

export const load: PageServerLoad = ({ params, locals }) => {
	const project = S.getProject(params.project);
	if (!project) error(404, translate(locals.lang, 'Project not found'));
	return { project: { id: project.id, name: project.name }, assets: S.listAssets(project.id), runs: S.listRuns({ projectId: project.id, limit: 20 }).filter((r) => r.kind === 'asset_generate') };
};

export const actions: Actions = {
	upload: async ({ request, params, locals }) => {
		const f = await request.formData();
		const files = f.getAll('files').filter((x): x is File => x instanceof File && x.size > 0);
		if (!files.length) return fail(400, { error: translate(locals.lang, 'No file') });
		const tags = String(f.get('tags') ?? '');
		for (const file of files) {
			const ext = extname(file.name).toLowerCase();
			const base = slugify(file.name.slice(0, -ext.length || undefined));
			let name = `${base}${ext}`;
			for (let i = 2; existsSync(join(projectDir(params.project), 'library', name)); i++) name = `${base}-${i}${ext}`;
			const dest = join(projectDir(params.project), 'library', name);
			writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
			S.createAsset({ projectId: params.project, kind: KIND(file.type, ext), name, file: dest, mime: file.type || 'application/octet-stream', size: file.size, tags, source: 'upload' });
		}
		return { ok: files.length };
	},
	remove: async ({ request, params }) => {
		const f = await request.formData();
		const a = S.listAssets(params.project).find((x) => x.id === f.get('id'));
		if (a) {
			if (existsSync(a.file)) unlinkSync(a.file);
			S.deleteAsset(a.id);
		}
	}
};
