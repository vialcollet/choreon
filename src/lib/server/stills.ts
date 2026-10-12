import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, fileUrl, projectDir, safeSeg, slugify } from './paths';

// Ad stills: templates (scene.html + template.json) in the project's `templates/`,
// and batches (lot.json + PNG renders) in `stills/<lot>/`. Everything lives on disk, in the project
// workspace, like the library: agents and the engine reach it without going through the database.

export type FieldDef = {
	key: string;
	label: string;
	type: 'text' | 'textarea' | 'select' | 'items';
	options?: string[];
	placeholder?: string;
	columns?: { key: string; label: string }[];
};
export type Template = { slug: string; name: string; description: string; formats: string[]; fields: FieldDef[]; defaults: Record<string, unknown> };
export type LotItem = { id: string; vars: Record<string, unknown> };
export type Lot = { slug: string; name: string; template: string; formats: string[]; items: LotItem[] };
/** A batch's renders: creative id → format → URL (with a version suffix for caching). */
export type Renders = Record<string, Record<string, string>>;

export const FORMATS = ['1080x1350', '1080x1920', '1080x1080'];
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const FORMAT = /^\d{3,4}x\d{3,4}$/;

export const templatesDir = (pid: string) => join(projectDir(pid), 'templates');
export const templateDir = (pid: string, slug: string) => join(templatesDir(pid), safeSeg(slug));
export const lotsDir = (pid: string) => join(projectDir(pid), 'stills');
export const lotDir = (pid: string, slug: string) => join(lotsDir(pid), safeSeg(slug));
export const lotFile = (pid: string, slug: string) => join(lotDir(pid, slug), 'lot.json');
export const previewDir = (pid: string) => join(lotsDir(pid), '_preview');

const readJson = <T>(file: string, fallback: T): T => {
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as T;
	} catch {
		return fallback;
	}
};

export function getTemplate(pid: string, slug: string): Template | null {
	const dir = templateDir(pid, slug);
	if (!existsSync(join(dir, 'scene.html'))) return null;
	const meta = readJson<Partial<Template>>(join(dir, 'template.json'), {});
	return {
		slug,
		name: meta.name ?? slug,
		description: meta.description ?? '',
		formats: (meta.formats ?? FORMATS).filter((f) => FORMAT.test(f)),
		fields: meta.fields ?? [],
		defaults: meta.defaults ?? {}
	};
}

export function listTemplates(pid: string): Template[] {
	const dir = templatesDir(pid);
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory() && /^[a-z0-9][a-z0-9._-]*$/i.test(d.name))
		.map((d) => getTemplate(pid, d.name))
		.filter((t): t is Template => !!t);
}

/** Reads a batch; also accepts a plain "list of items" format (as produced by external ad tools). */
export function getLot(pid: string, slug: string): Lot | null {
	const file = lotFile(pid, slug);
	if (!existsSync(file)) return null;
	const raw = readJson<Partial<Lot> | LotItem[]>(file, []);
	const o = Array.isArray(raw) ? { items: raw } : raw;
	return {
		slug,
		name: o.name ?? slug,
		template: o.template ?? '',
		formats: (o.formats ?? ['1080x1350']).filter((f) => FORMAT.test(f)),
		items: (o.items ?? []).filter((i) => i && ITEM_ID.test(String(i.id))).map((i) => ({ id: String(i.id), vars: i.vars ?? {} }))
	};
}

/** Renders present on disk for a batch (files `<id>-<format>.png`). */
export function lotRenders(pid: string, lot: Lot): Renders {
	const dir = lotDir(pid, lot.slug);
	const out: Renders = {};
	for (const item of lot.items) {
		for (const f of FORMATS.concat(lot.formats)) {
			const file = join(dir, `${item.id}-${f}.png`);
			if (!existsSync(file)) continue;
			(out[item.id] ??= {})[f] = `${fileUrl(file)}?v=${Math.round(statSync(file).mtimeMs)}`;
		}
	}
	return out;
}

export function listLots(pid: string) {
	const dir = lotsDir(pid);
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => getLot(pid, d.name))
		.filter((l): l is Lot => !!l)
		.map((lot) => {
			const renders = lotRenders(pid, lot);
			const thumbs = lot.items.map((i) => renders[i.id]?.[lot.formats[0]]).filter(Boolean).slice(0, 4) as string[];
			const updated = statSync(lotFile(pid, lot.slug)).mtimeMs;
			return { slug: lot.slug, name: lot.name, template: lot.template, formats: lot.formats, count: lot.items.length, rendered: Object.keys(renders).length, thumbs, updated };
		})
		.sort((a, b) => b.updated - a.updated);
}

/** Validates and writes a batch. Returns an error message, or null. */
export function saveLot(pid: string, lot: Lot): string | null {
	if (!getTemplate(pid, lot.template)) return `unknown template: ${lot.template}`;
	if (!lot.formats.length || lot.formats.some((f) => !FORMAT.test(f))) return 'invalid formats';
	const ids = new Set<string>();
	for (const i of lot.items) {
		if (!ITEM_ID.test(i.id)) return `invalid id: "${i.id}" (letters, digits, . _ -)`;
		if (ids.has(i.id)) return `duplicate id: ${i.id}`;
		ids.add(i.id);
	}
	ensureDir(lotDir(pid, lot.slug));
	const { slug: _slug, ...body } = lot;
	writeFileSync(lotFile(pid, lot.slug), JSON.stringify(body, null, '\t'));
	return null;
}

export function createLot(pid: string, name: string, template: string, formats: string[]): string {
	const base = slugify(name);
	let slug = base;
	for (let i = 2; existsSync(lotDir(pid, slug)); i++) slug = `${base}-${i}`;
	const t = getTemplate(pid, template);
	const err = saveLot(pid, { slug, name, template, formats, items: t ? [{ id: 'K-0001', vars: structuredClone(t.defaults) }] : [] });
	if (err) throw new Error(err);
	return slug;
}

/** Deletes renders of items that are no longer in the batch, and of formats the batch no longer has. */
export function pruneRenders(pid: string, lot: Lot) {
	const dir = lotDir(pid, lot.slug);
	if (!existsSync(dir)) return;
	const keep = new Set(lot.items.map((i) => i.id));
	const formats = new Set(lot.formats);
	for (const f of readdirSync(dir)) {
		const m = /^(.+)-(\d{3,4}x\d{3,4})\.png$/.exec(f);
		if (m && (!keep.has(m[1]) || !formats.has(m[2]))) unlinkSync(join(dir, f));
	}
}

/** Preview key: changes as soon as the template, the variables or the format change. */
export function previewKey(pid: string, template: string, vars: unknown, format: string): string {
	const scene = join(templateDir(pid, template), 'scene.html');
	const h = createHash('sha1').update(JSON.stringify([template, statSync(scene).mtimeMs, vars, format])).digest('hex');
	return h.slice(0, 16);
}

/** Keeps the 40 most recent previews. */
export function prunePreviews(pid: string) {
	const dir = previewDir(pid);
	if (!existsSync(dir)) return;
	const files = readdirSync(dir)
		.map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
		.sort((a, b) => b.t - a.t);
	for (const { f } of files.slice(40)) unlinkSync(join(dir, f));
}
