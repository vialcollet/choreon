import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

/** Repository root (the server runs from it, in dev and prod). */
export const ROOT = resolve(process.cwd());
export const ENGINE_DIR = join(ROOT, 'engine');
/** Data (database, projects, renders). Not in git. Overridable via STUDIO_DATA. */
export const DATA_DIR = resolve(process.env.STUDIO_DATA || join(ROOT, 'data'));
export const PROJECTS_DIR = join(DATA_DIR, 'projects');

export const projectDir = (slug: string) => join(PROJECTS_DIR, safeSeg(slug));
export const videoDir = (project: string, video: string) => join(projectDir(project), 'videos', safeSeg(video));
export const shotDir = (project: string, video: string, shot: string) => join(videoDir(project, video), 'shots', safeSeg(shot));

/** A path segment from a URL or form can neither go up nor change drive. */
export function safeSeg(s: string): string {
	if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(s)) throw new Error(`invalid segment: ${s}`);
	return s;
}

/** Segments /files never serves: dotfiles (.env…) and the stored browser sessions (ui-auth). */
const hidden = (seg: string) => seg.startsWith('.') || seg.toLowerCase() === 'ui-auth';

/**
 * Existing file served by /files: only `projects/<pid>/…`, nothing hidden, and its real path
 * (symlinks resolved) must stay inside its project folder, itself a real folder (not a symlink). Anything else is null.
 */
export function resolveProjectFile(rel: string): { abs: string; projectId: string } | null {
	const segs = rel.split(/[\\/]/);
	if (segs.length < 3 || segs[0] !== 'projects' || segs.some((s) => !s || s.includes('\0') || hidden(s))) return null;
	try {
		const projectId = safeSeg(segs[1]);
		const abs = resolve(PROJECTS_DIR, ...segs.slice(1));
		const root = realpathSync(join(PROJECTS_DIR, projectId));
		// the project folder itself must not be a symlink (to the data root or to another project)
		if (root !== join(realpathSync(PROJECTS_DIR), projectId)) return null;
		const real = realpathSync(abs);
		if (!real.startsWith(root + sep) || !statSync(real).isFile()) return null;
		// a symlink must not reach a hidden folder of the project either
		if (real.slice(root.length + 1).split(sep).some(hidden)) return null;
		return { abs, projectId };
	} catch {
		return null;
	}
}

/** A project file never runs as a page: no sniffing, and a sandboxed CSP without scripts. On every /files response. */
export const FILE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox" };

/** Path relative to DATA_DIR, with "/" separators (for /files/... URLs). */
export function dataRel(abs: string): string {
	return resolve(abs).slice(DATA_DIR.length + 1).split(sep).join('/');
}

export const fileUrl = (abs: string | null | undefined) => (abs ? `/files/${dataRel(abs)}` : null);

// ---------- paths in the database ----------
// The database only stores paths relative to DATA_DIR ("projects/<project>/…"): the repo and
// data can move to another folder or machine. Paths outside DATA_DIR stay absolute.

/** Path to write to the database. */
export function toStored<T extends string | null | undefined>(p: T): T {
	if (!p) return p;
	const a = resolve(p);
	return (a.startsWith(DATA_DIR + sep) ? dataRel(a) : p) as T;
}

/** Absolute path from the database (a relative path is taken under DATA_DIR). */
export function fromStored<T extends string | null | undefined>(p: T): T {
	if (!p) return p;
	return (isAbsolute(p) ? p : join(DATA_DIR, ...p.split('/'))) as T;
}

/** JSON keys that carry file paths (QA sheets, reference analyses…). */
const PATH_KEYS = new Set(['file', 'contact', 'strip', 'phone', 'stills', 'chart', 'frame', 'out', 'json', 'scene']);

/** Applies fn to the paths of a JSON object (PATH_KEYS keys, strings or lists of strings). */
export function mapPaths<T>(v: T, fn: (p: string) => string, key = ''): T {
	if (typeof v === 'string') return (PATH_KEYS.has(key) ? fn(v) : v) as T;
	if (Array.isArray(v)) return v.map((x) => mapPaths(x, fn, typeof x === 'string' ? key : '')) as T;
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapPaths(x, fn, k)])) as T;
	return v;
}

/** Old absolute path under a "data" folder (wherever it was then) → relative. */
export function legacyToRel(p: string): string {
	const m = /^(?:[A-Za-z]:)?[\\/].*?[\\/]data[\\/]((?:projects|cache)[\\/].*)$/.exec(p);
	return m ? m[1].replace(/\\/g, '/') : p;
}

export function ensureDir(d: string) {
	if (!existsSync(d)) mkdirSync(d, { recursive: true });
	return d;
}

/** Installed Claude Code binary (subscription); otherwise the SDK uses its own. */
export function claudeExecutable(): string | undefined {
	const candidates = [join(homedir(), '.local', 'bin', 'claude.exe'), join(homedir(), '.local', 'bin', 'claude')];
	return candidates.find((c) => existsSync(c));
}

/**
  * PATH without the fake `node` that Bun inserts for its children (temp folder `bun-node-*`):
  * under that shim, Playwright runs under Bun and hangs on Windows. The engine requires the real Node.
 */
export function realNodePath(): string {
	const sepChar = process.platform === 'win32' ? ';' : ':';
	return (process.env.PATH ?? process.env.Path ?? '')
		.split(sepChar)
		.filter((d) => d && !/[\\/]bun-node-[^\\/]*$/i.test(d))
		.join(sepChar);
}

/** Real Node executable (first `node` of the cleaned PATH). */
export function nodeBin(): string {
	const exe = process.platform === 'win32' ? 'node.exe' : 'node';
	for (const d of realNodePath().split(process.platform === 'win32' ? ';' : ':')) {
		const p = join(d, exe);
		if (d && existsSync(p)) return p;
	}
	return 'node';
}

export function slugify(s: string): string {
	return (
		s
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'untitled'
	);
}
