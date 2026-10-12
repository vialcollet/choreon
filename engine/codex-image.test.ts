import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// engine/codex-image.mjs is plain Node ESM; it only runs its CLI when executed directly.
import * as C from './codex-image.mjs';

describe('codexCommand', () => {
	const none = () => false;

	test('outside Windows: runs the codex found on PATH by its full path', () => {
		const bin = join('/opt/bin', 'codex');
		expect(C.codexCommand('linux', ['/usr/bin', '/opt/bin'], (p: string) => p === bin)).toEqual({ cmd: bin, args: [] });
		expect(C.codexCommand('darwin', ['/opt/bin'], (p: string) => p === bin)).toEqual({ cmd: bin, args: [] });
	});

	test('outside Windows: codex missing from PATH throws', () => {
		expect(() => C.codexCommand('linux', ['/usr/bin'], none)).toThrow('codex CLI not found');
		expect(() => C.codexCommand('darwin', [], none)).toThrow('codex CLI not found');
	});

	test('win32: runs codex.exe found on PATH directly', () => {
		const exe = join('C:\\tools', 'codex.exe');
		const got = C.codexCommand('win32', ['C:\\none', 'C:\\tools'], (p: string) => p === exe);
		expect(got).toEqual({ cmd: exe, args: [] });
	});

	test('win32: resolves the codex.cmd shim to its JS entry run with node', () => {
		const shim = join('C:\\npm', 'codex.cmd');
		const entry = join(dirname(shim), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
		const got = C.codexCommand('win32', ['C:\\npm'], (p: string) => p === shim || p === entry);
		expect(got).toEqual({ cmd: process.execPath, args: [entry] });
	});

	test('win32: a local npm shim in node_modules/.bin resolves to node_modules/@openai/codex', () => {
		const bin = join('/proj', 'node_modules', '.bin');
		const shim = join(bin, 'codex.cmd');
		const entry = join('/proj', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
		const got = C.codexCommand('win32', [bin], (p: string) => p === shim || p === entry);
		expect(got).toEqual({ cmd: process.execPath, args: [entry] });
	});

	test('win32: a local shim does not fall back to .bin/node_modules', () => {
		const bin = join('/proj', 'node_modules', '.bin');
		const shim = join(bin, 'codex.cmd');
		const wrong = join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
		expect(() => C.codexCommand('win32', [bin], (p: string) => p === shim || p === wrong)).toThrow('codex CLI not found');
	});

	test('win32: a codex.exe wins over a codex.cmd earlier on PATH', () => {
		const exe = join('C:\\b', 'codex.exe');
		const got = C.codexCommand('win32', ['C:\\a', 'C:\\b'], (p: string) => p === join('C:\\a', 'codex.cmd') || p === exe);
		expect(got.cmd).toBe(exe);
	});

	test('win32: nothing found throws', () => {
		expect(() => C.codexCommand('win32', ['C:\\a'], none)).toThrow('codex CLI not found');
		expect(() => C.codexCommand('win32', [], none)).toThrow('codex CLI not found');
	});

	test('win32: a shim without its JS entry throws', () => {
		const shim = join('C:\\npm', 'codex.cmd');
		expect(() => C.codexCommand('win32', ['C:\\npm'], (p: string) => p === shim)).toThrow('codex CLI not found');
	});

	test('the command carries no codex arguments: the caller appends them verbatim', () => {
		const hostile = ['-C', 'C:\\Users\\a b\\x & y | z %PATH% ^ "q"', 'it\'s'];
		const exe = join('C:\\t', 'codex.exe');
		const { cmd, args } = C.codexCommand('win32', ['C:\\t'], (p: string) => p === exe);
		const full = [...args, ...hostile];
		expect(cmd).toBe(exe);
		expect(full).toEqual(hostile);
	});
});

describe('producedImage', () => {
	const root = mkdtempSync(join(tmpdir(), 'codex-gen-'));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const png = (session: string, name: string, mtimeSec: number) => {
		mkdirSync(join(root, session), { recursive: true });
		const f = join(root, session, name);
		writeFileSync(f, 'png');
		utimesSync(f, mtimeSec, mtimeSec);
		return f;
	};
	const since = 1_000_000_000_000;
	const sec = since / 1000;

	test('returns the newest image of the session', () => {
		png('own', 'old.png', sec + 1);
		const newest = png('own', 'new.png', sec + 5);
		expect(C.producedImage(root, 'own', 0, since)).toBe(newest);
	});

	test('ignores images older than the start of the call', () => {
		png('stale', 'a.png', sec - 100);
		expect(() => C.producedImage(root, 'stale', 0, since)).toThrow('codex produced no image');
	});

	test('never takes another session image, even a newer one', () => {
		png('mine', 'a.png', sec + 1);
		png('other', 'b.png', sec + 50);
		expect(C.producedImage(root, 'mine', 0, since)).toBe(join(root, 'mine', 'a.png'));
		png('empty-session', 'readme.txt', sec + 1);
		expect(() => C.producedImage(root, 'empty-session', 0, since)).toThrow('codex produced no image');
	});

	test('a non-zero exit code throws even when an image exists', () => {
		png('failed', 'a.png', sec + 1);
		expect(() => C.producedImage(root, 'failed', 1, since)).toThrow('exit code 1');
		expect(() => C.producedImage(root, 'failed', null, since)).toThrow('codex produced no image');
	});

	test('a missing session throws, whatever other sessions hold', () => {
		png('someone', 'a.png', sec + 1);
		expect(() => C.producedImage(root, null, 0, since)).toThrow('codex produced no image');
		expect(() => C.producedImage(root, '', 0, since)).toThrow('codex produced no image');
	});

	test('the error carries the stderr tail', () => {
		expect(() => C.producedImage(root, null, 2, since, 'boom: not signed in')).toThrow('exit code 2): boom: not signed in');
	});
});
