import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, mock } from 'bun:test';

// Test preload (bunfig.toml). Runs before any test file, so `data/` is never touched.

// DATA_DIR is computed when paths.ts is first imported: point it to a fresh temp dir first.
const dir = mkdtempSync(join(tmpdir(), 'choreon-test-'));
process.env.STUDIO_DATA = dir;
// A hook registered in the preload runs once, after every test file (process 'exit' does not fire under bun test).
// On Windows the SQLite file is still open at that point (EBUSY): the temp dir is left to the OS.
afterAll(() => {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {}
});

// SvelteKit virtual modules do not exist under `bun test`.
mock.module('$env/dynamic/private', () => ({ env: process.env }));
mock.module('$app/environment', () => ({ dev: true, building: false, browser: false }));

// i18n/index.ts loads its dictionaries with Vite's import.meta.glob, absent under bun: same API, dictionaries read from disk.
const frDir = join(import.meta.dir, 'lib', 'i18n', 'fr');
const FR: Record<string, string> = Object.assign({}, ...(await Promise.all(readdirSync(frDir).filter((f) => f.endsWith('.ts')).map(async (f) => (await import(join(frDir, f))).default))));
mock.module('$lib/i18n', () => ({
	translate: (lang: string, key: string, vars?: Record<string, unknown>) => {
		let s = lang === 'fr' ? (FR[key] ?? key) : key;
		if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
		return s;
	},
	toLang: (x: string | null | undefined) => (x && /^fr\b/i.test(x) ? 'fr' : 'en')
}));
