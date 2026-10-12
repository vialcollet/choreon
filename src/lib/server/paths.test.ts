import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import '$lib/server/db';
import { DATA_DIR, mapPaths, PROJECTS_DIR, resolveProjectFile, safeSeg } from './paths';

// The temp data dir is shared by every test file: the real studio.db (opened above) must not be overwritten.
const put = (rel: string, body = 'x') => {
	const abs = join(DATA_DIR, rel);
	if (existsSync(abs)) return;
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, body);
};

beforeAll(() => {
	for (const f of ['studio.db', 'studio.db-wal', '.auth-secret', 'cache/x', 'lessons.md']) put(f, 'secret');
	put('projects/p/videos/v/final.mp4');
	put('projects/p/.env', 'secret');
	put('projects/p/ui-auth/x.json', 'secret');
	put('projects/p/.hidden/a.txt');
	put('projects/q/library/other.png');
	symlinkSync(DATA_DIR, join(PROJECTS_DIR, 'p', 'to-data'));
	symlinkSync(join(PROJECTS_DIR, 'q'), join(PROJECTS_DIR, 'p', 'to-q'));
	symlinkSync(join(DATA_DIR, 'studio.db'), join(PROJECTS_DIR, 'p', 'db-link'));
	symlinkSync(join(PROJECTS_DIR, 'p', 'ui-auth'), join(PROJECTS_DIR, 'p', 'auth-alias'));
	symlinkSync(join(PROJECTS_DIR, 'p', 'videos'), join(PROJECTS_DIR, 'p', 'videos-alias'));
	symlinkSync(DATA_DIR, join(PROJECTS_DIR, 'link-data'));
	symlinkSync(join(PROJECTS_DIR, 'q'), join(PROJECTS_DIR, 'link-q'));
});

describe('resolveProjectFile', () => {
	test('serves an ordinary project file with its project id', () => {
		const r = resolveProjectFile('projects/p/videos/v/final.mp4');
		expect(r).toEqual({ abs: join(PROJECTS_DIR, 'p', 'videos', 'v', 'final.mp4'), projectId: 'p' });
	});

	test('follows a symlink that stays inside the project', () => {
		expect(resolveProjectFile('projects/p/videos-alias/v/final.mp4')?.projectId).toBe('p');
	});

	test('rejects the data root files', () => {
		for (const f of ['studio.db', 'studio.db-wal', '.auth-secret', 'cache/x', 'lessons.md']) expect(resolveProjectFile(f)).toBeNull();
	});

	test('rejects a hidden segment', () => {
		expect(resolveProjectFile('projects/p/.env')).toBeNull();
		expect(resolveProjectFile('projects/p/.hidden/a.txt')).toBeNull();
	});

	test('rejects the ui-auth folder (stored sessions)', () => {
		expect(resolveProjectFile('projects/p/ui-auth/x.json')).toBeNull();
		expect(resolveProjectFile('projects/p/UI-Auth/x.json')).toBeNull();
		expect(resolveProjectFile('projects/p/auth-alias/x.json')).toBeNull();
	});

	test('rejects a symlink that leaves the project', () => {
		expect(resolveProjectFile('projects/p/to-data/studio.db')).toBeNull();
		expect(resolveProjectFile('projects/p/to-q/library/other.png')).toBeNull();
		expect(resolveProjectFile('projects/p/db-link')).toBeNull();
	});

	test('rejects a project folder that is itself a symlink', () => {
		expect(resolveProjectFile('projects/link-data/studio.db')).toBeNull();
		expect(resolveProjectFile('projects/link-q/library/other.png')).toBeNull();
		expect(resolveProjectFile('projects/q/library/other.png')?.projectId).toBe('q');
	});

	test('rejects traversal and malformed paths', () => {
		expect(resolveProjectFile('projects/p/../../studio.db')).toBeNull();
		expect(resolveProjectFile('projects/p/../q/library/other.png')).toBeNull();
		expect(resolveProjectFile('projects/../studio.db')).toBeNull();
		expect(resolveProjectFile('projects/p/videos\\..\\..\\..\\studio.db')).toBeNull();
		expect(resolveProjectFile('../studio.db')).toBeNull();
		expect(resolveProjectFile('/etc/passwd')).toBeNull();
		expect(resolveProjectFile('projects/p/videos/v/final.mp4\0.png')).toBeNull();
	});

	test('rejects what is not a project file', () => {
		expect(resolveProjectFile('')).toBeNull();
		expect(resolveProjectFile('projects')).toBeNull();
		expect(resolveProjectFile('projects/p')).toBeNull();
		expect(resolveProjectFile('projects/p/videos')).toBeNull();
		expect(resolveProjectFile('projects/p/missing.png')).toBeNull();
		expect(resolveProjectFile('projects/nope/x.png')).toBeNull();
		expect(resolveProjectFile('other/p/videos/v/final.mp4')).toBeNull();
	});
});

describe('safeSeg', () => {
	test('accepts plain names, dots, dashes and underscores', () => {
		for (const ok of ['sorbet', 'My_Video-2', 'v1.2', 'a', '0abc']) expect(safeSeg(ok)).toBe(ok);
		expect(safeSeg('a'.repeat(81))).toHaveLength(81);
	});

	test('rejects parent, separators, drive letters, empty and over-long names', () => {
		for (const bad of ['..', '.', '.hidden', 'a/b', '../x', 'a\\b', 'C:', 'C:\\x', '', 'a'.repeat(82), '-x', 'a b']) {
			expect(() => safeSeg(bad)).toThrow('invalid segment');
		}
	});
});

describe('mapPaths', () => {
	const up = (p: string) => p.toUpperCase();

	test('maps only the PATH_KEYS keys', () => {
		expect(mapPaths({ file: 'a.png', title: 'keep', out: 'b' }, up)).toEqual({ file: 'A.PNG', title: 'keep', out: 'B' });
	});

	test('maps lists of strings under a path key, not under other keys', () => {
		expect(mapPaths({ stills: ['a', 'b'], tags: ['a', 'b'] }, up)).toEqual({ stills: ['A', 'B'], tags: ['a', 'b'] });
	});

	test('walks nested objects and arrays of objects', () => {
		const v = { qa: { contact: 'c', n: 3, deep: [{ frame: 'f', note: 'n' }] }, ok: true, none: null };
		expect(mapPaths(v, up)).toEqual({ qa: { contact: 'C', n: 3, deep: [{ frame: 'F', note: 'n' }] }, ok: true, none: null });
	});

	test('leaves a top-level string or number alone and does not mutate its input', () => {
		const v = { file: 'a' };
		mapPaths(v, up);
		expect(v.file).toBe('a');
		expect(mapPaths('x', up)).toBe('x');
		expect(mapPaths(4, up)).toBe(4);
	});
});
