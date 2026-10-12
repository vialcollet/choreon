import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileUrl, projectDir, slugify } from './paths';

// UI kits: UI elements harvested from a site (engine/ui-harvest.mjs), picked and named
// by the agent, stored in library/ui/<kit>/:
//   kit.json            design tokens + component list
//   <name>.svg          faithful rebuild (all the text), named layers
//   <name>.simple.svg   simplified rebuild (labels kept, paragraphs as bars)
//   <name>.png          original capture (reference)
//   _raw/               full harvest (candidates, numbered contact sheets)

export interface UiComponent {
	name: string;
	label: string;
	role: string;
	description?: string;
	/** Recommended variant for animation. */
	variant: 'fidele' | 'simplifie';
	w: number;
	h: number;
	repeats: number;
	text?: string;
	/** Page the component comes from (kits harvested across several pages). */
	page?: string;
	files: { fidele: string; simplifie: string; original: string };
}

export interface UiKit {
	slug: string;
	label: string;
	url: string;
	/** Harvested pages, in order, with the number of elements each one contributed. */
	pages?: { url: string; title: string; kept: number }[];
	title: string;
	summary: string;
	createdAt: number;
	viewport: { width: number; height: number };
	tokens: { colors: string[]; fonts: string[]; radii: number[] };
	components: UiComponent[];
}

export const uiRoot = (pid: string) => join(projectDir(pid), 'library', 'ui');
export const kitDir = (pid: string, slug: string) => join(uiRoot(pid), slugify(slug));

export function getKit(pid: string, slug: string): (UiKit & { urls: Record<string, { fidele: string | null; simplifie: string | null; original: string | null }> }) | null {
	const f = join(kitDir(pid, slug), 'kit.json');
	if (!existsSync(f)) return null;
	const kit = JSON.parse(readFileSync(f, 'utf8')) as UiKit;
	const dir = kitDir(pid, slug);
	const urls = Object.fromEntries(
		kit.components.map((c) => [c.name, { fidele: fileUrl(join(dir, c.files.fidele)), simplifie: fileUrl(join(dir, c.files.simplifie)), original: fileUrl(join(dir, c.files.original)) }])
	);
	return { ...kit, urls };
}

export function listKits(pid: string) {
	const root = uiRoot(pid);
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'kit.json')))
		.map((d) => getKit(pid, d.name)!)
		.sort((a, b) => b.createdAt - a.createdAt);
}

/** Saved login session for a site (cookies + local storage), per domain. */
export const authFile = (pid: string, url: string) => join(projectDir(pid), 'ui-auth', `${slugify(new URL(url).hostname)}.json`);
export const hasAuth = (pid: string, url: string) => {
	try {
		return existsSync(authFile(pid, url));
	} catch {
		return false;
	}
};
