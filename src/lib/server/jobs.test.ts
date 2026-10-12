import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as jobs from './jobs';

const captureInto: typeof import('./jobs').captureInto = (...a) => jobs.captureInto(...a);

const root = mkdtempSync(join(tmpdir(), 'choreon-capture-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A kit folder holding a previous capture of one page: `_raw/<page>/{candidates.json,old.png}`. */
const previous = (name: string) => {
	const raw = join(root, name, '_raw', 'home');
	mkdirSync(raw, { recursive: true });
	writeFileSync(join(raw, 'candidates.json'), '{"candidates":[{"id":1}]}');
	writeFileSync(join(raw, 'old.png'), 'previous-bytes');
	return raw;
};
const siblings = (raw: string) => readdirSync(join(raw, '..'));

describe('captureInto (bd60280c)', () => {
	test('a failing capture leaves the previous capture byte-identical, with no staging or backup folder', async () => {
		const raw = previous('fail');
		const boom = new Error('unreadable capture (no candidates)');
		await expect(captureInto(raw, 'r1', async (stage) => {
			writeFileSync(join(stage, 'candidates.json'), '{"partial":');
			writeFileSync(join(stage, 'new.png'), 'partial-bytes');
			throw boom;
		})).rejects.toBe(boom);
		expect(readFileSync(join(raw, 'candidates.json'), 'utf8')).toBe('{"candidates":[{"id":1}]}');
		expect(readFileSync(join(raw, 'old.png'), 'utf8')).toBe('previous-bytes');
		expect(readdirSync(raw).sort()).toEqual(['candidates.json', 'old.png']);
		expect(siblings(raw)).toEqual(['home']);
	});

	test('a failing first capture leaves no folder at all', async () => {
		const raw = join(root, 'first', '_raw', 'home');
		await expect(captureInto(raw, 'r1', async (stage) => {
			writeFileSync(join(stage, 'x'), 'x');
			throw new Error('engine error');
		})).rejects.toThrow('engine error');
		expect(existsSync(raw)).toBe(false);
		expect(siblings(raw)).toEqual([]);
	});

	test('a successful capture replaces the previous one, with no staging or backup folder', async () => {
		const raw = previous('ok');
		const stageSeen: string[] = [];
		const out = await captureInto(raw, 'r2', async (stage) => {
			stageSeen.push(stage);
			expect(stage).not.toBe(raw);
			expect(readdirSync(stage)).toEqual([]);
			writeFileSync(join(stage, 'candidates.json'), '{"candidates":[]}');
			return 'done';
		});
		expect(out).toBe('done');
		expect(readFileSync(join(raw, 'candidates.json'), 'utf8')).toBe('{"candidates":[]}');
		expect(readdirSync(raw)).toEqual(['candidates.json']);
		expect(siblings(raw)).toEqual(['home']);
		expect(existsSync(stageSeen[0])).toBe(false);
	});

	test('the staging folder is dot-prefixed, a sibling of the final one (never served by /files)', async () => {
		const raw = join(root, 'name', '_raw', 'home');
		await captureInto(raw, 'r4', async (stage) => {
			expect(stage.startsWith(join(root, 'name', '_raw', '.'))).toBe(true);
		});
		expect(readdirSync(raw)).toEqual([]);
	});

	test('if the promotion fails, the previous capture is restored', async () => {
		const raw = previous('promote');
		// The capture succeeds but removes its staging folder: promoting it (rename stage -> raw) throws.
		await expect(captureInto(raw, 'r3', async (stage) => {
			rmSync(stage, { recursive: true, force: true });
		})).rejects.toThrow();
		expect(readFileSync(join(raw, 'candidates.json'), 'utf8')).toBe('{"candidates":[{"id":1}]}');
		expect(readFileSync(join(raw, 'old.png'), 'utf8')).toBe('previous-bytes');
		expect(siblings(raw)).toEqual(['home']);
	});

	/** The state left by a process that stopped between the two renames: no `raw`, the previous capture in a backup folder. */
	const crashed = (name: string) => {
		const raw = previous(name);
		renameSync(raw, join(raw, '..', '.old.home.deadrun'));
		return raw;
	};

	test('after a crash between the two renames, a failing capture leaves the previous capture restored (3e3e929e)', async () => {
		const raw = crashed('crash-fail');
		expect(existsSync(raw)).toBe(false);
		await expect(captureInto(raw, 'r5', async (stage) => {
			writeFileSync(join(stage, 'new.png'), 'partial-bytes');
			throw new Error('engine error');
		})).rejects.toThrow('engine error');
		expect(readFileSync(join(raw, 'candidates.json'), 'utf8')).toBe('{"candidates":[{"id":1}]}');
		expect(readFileSync(join(raw, 'old.png'), 'utf8')).toBe('previous-bytes');
		expect(siblings(raw)).toEqual(['home']);
	});

	test('after a crash between the two renames, a successful capture replaces the backup and leaves no leftover (3e3e929e)', async () => {
		const raw = crashed('crash-ok');
		await captureInto(raw, 'r6', async (stage) => {
			writeFileSync(join(stage, 'candidates.json'), '{"candidates":[]}');
		});
		expect(readdirSync(raw)).toEqual(['candidates.json']);
		expect(readFileSync(join(raw, 'candidates.json'), 'utf8')).toBe('{"candidates":[]}');
		expect(siblings(raw)).toEqual(['home']);
	});

	test('a staging folder left by a dead run is removed by the next capture (3e3e929e)', async () => {
		const raw = previous('stale-stage');
		mkdirSync(join(raw, '..', '.stage.home.deadrun'));
		writeFileSync(join(raw, '..', '.stage.home.deadrun', 'x'), 'x');
		await captureInto(raw, 'r7', async (stage) => {
			writeFileSync(join(stage, 'candidates.json'), '{}');
		});
		expect(siblings(raw)).toEqual(['home']);
		expect(readFileSync(join(raw, 'candidates.json'), 'utf8')).toBe('{}');
	});

	test('with several backups the one with the greater stamp is restored, whatever the folder mtimes, and the others are removed (6bb40155)', async () => {
		const raw = previous('crash-many');
		const parent = join(raw, '..');
		renameSync(raw, join(parent, '.old.home.000000002-newer'));
		const older = join(parent, '.old.home.000000001-older');
		mkdirSync(older);
		writeFileSync(join(older, 'candidates.json'), 'older');
		// A rename does not touch the mtime: invert it, the older promotion looks the most recent.
		const past = new Date(Date.now() - 60_000), future = new Date(Date.now() + 60_000);
		utimesSync(join(parent, '.old.home.000000002-newer'), past, past);
		utimesSync(older, future, future);
		await expect(captureInto(raw, 'r8', async () => { throw new Error('engine error'); })).rejects.toThrow('engine error');
		expect(readFileSync(join(raw, 'candidates.json'), 'utf8')).toBe('{"candidates":[{"id":1}]}');
		expect(siblings(raw)).toEqual(['home']);
	});

	test('the stamp is a fixed-width base 36 time then the run id, so the name order is the promotion order (6bb40155)', async () => {
		const raw = previous('stamps');
		const stages: string[] = [];
		for (const run of ['b', 'a']) {
			await captureInto(raw, run, async (stage) => { stages.push(basename(stage)); });
			await new Promise((r) => setTimeout(r, 5));
		}
		const stamps = stages.map((n) => n.split('.')[3]);
		expect(stamps[0]).toMatch(/^[0-9a-z]{9}-b$/);
		expect(stamps[1]).toMatch(/^[0-9a-z]{9}-a$/);
		expect(stamps[0] < stamps[1]).toBe(true);
		expect(siblings(raw)).toEqual(['home']);
	});

	test('leftovers are matched by exact page: a capture of home neither deletes nor restores home-extra or home-2 (edb051f9)', async () => {
		const raw = previous('siblings');
		const parent = join(raw, '..');
		const others = ['.old.home-extra.deadrun', '.stage.home-extra.deadrun', '.old.home-2.deadrun', '.stage.home-2.deadrun', '.old-home-extra-deadrun', '.stage-home-2-deadrun'];
		for (const o of others) {
			mkdirSync(join(parent, o));
			writeFileSync(join(parent, o, 'candidates.json'), o);
		}
		await captureInto(raw, 'r9', async (stage) => {
			writeFileSync(join(stage, 'candidates.json'), '{}');
		});
		expect(siblings(raw).sort()).toEqual(['home', ...others].sort());
		for (const o of others) expect(readFileSync(join(parent, o, 'candidates.json'), 'utf8')).toBe(o);
	});

	test('a capture of home with no folder of its own does not restore the backup of home-extra (edb051f9)', async () => {
		const raw = join(root, 'orphan', '_raw', 'home');
		const foreign = join(raw, '..', '.old.home-extra.deadrun');
		mkdirSync(foreign, { recursive: true });
		await expect(captureInto(raw, 'r10', async () => { throw new Error('engine error'); })).rejects.toThrow('engine error');
		expect(existsSync(raw)).toBe(false);
		expect(siblings(raw)).toEqual(['.old.home-extra.deadrun']);
	});
});
