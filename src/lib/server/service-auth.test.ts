import { describe, expect, test } from 'bun:test';
import { isStudioOrigin, selfHarvestEnv, studioPort, tokenMatches } from './service-auth';

const TOKEN = 'tok-7f3a9c';
type Opts = Parameters<typeof selfHarvestEnv>[1];
const admin: Opts = { admin: true, token: TOKEN, port: '5610', dev: false };
const self = (url: string, o: Partial<Opts> = {}) => selfHarvestEnv(url, { ...admin, ...o });
const GRANTED = { CHOREON_SELF_TOKEN: TOKEN };

describe('tokenMatches (AC-M5-1)', () => {
	test('accepts exactly "Bearer <token>"', () => {
		expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
	});

	test('refuses a wrong, truncated, extended or differently-cased token', () => {
		for (const h of ['Bearer wrong', `Bearer ${TOKEN.slice(0, -1)}`, `Bearer ${TOKEN}x`, `bearer ${TOKEN}`, `Bearer  ${TOKEN}`, TOKEN, `Basic ${TOKEN}`]) expect(tokenMatches(h, TOKEN)).toBe(false);
	});

	test('refuses a missing header', () => {
		expect(tokenMatches(null, TOKEN)).toBe(false);
		expect(tokenMatches(undefined, TOKEN)).toBe(false);
		expect(tokenMatches('', TOKEN)).toBe(false);
	});

	test('refuses everything when no token is configured', () => {
		for (const token of [undefined, '']) for (const h of ['Bearer ', 'Bearer', 'Bearer undefined', null, '']) expect(tokenMatches(h, token)).toBe(false);
	});
});

describe('studioPort', () => {
	test('dev is vite\'s pinned 5610, whatever PORT says', () => {
		const saved = process.env.PORT;
		try {
			process.env.PORT = '4321';
			expect(studioPort()).toBe('5610');
			delete process.env.PORT;
			expect(studioPort()).toBe('5610');
		} finally {
			if (saved === undefined) delete process.env.PORT;
			else process.env.PORT = saved;
		}
	});

	test('production is PORT, otherwise adapter-node\'s 3000', () => {
		expect(studioPort({ dev: false, port: '4321' })).toBe('4321');
		expect(studioPort({ dev: false, port: undefined })).toBe('3000');
		expect(studioPort({ dev: false, port: '' })).toBe('3000');
		expect(studioPort({ dev: true, port: '4321' })).toBe('5610');
	});
});

describe('isStudioOrigin (AC-B2-4)', () => {
	const o = { port: '5610', origins: ['https://studio.example.test', 'http://10.0.0.5:8080'] };
	test('the loopback hosts at the studio port', () => {
		for (const u of ['http://127.0.0.1:5610/admin', 'http://localhost:5610/', 'http://[::1]:5610/x', 'https://localhost:5610/']) expect(isStudioOrigin(u, o)).toBe(true);
	});
	test('a loopback host on another port is not the studio', () => {
		for (const u of ['http://127.0.0.1:3000/', 'http://localhost/', 'http://[::1]:8080/']) expect(isStudioOrigin(u, o)).toBe(false);
	});
	test('the listed origins, whatever the path', () => {
		expect(isStudioOrigin('https://studio.example.test/p/abc?x=1', o)).toBe(true);
		expect(isStudioOrigin('http://10.0.0.5:8080/', o)).toBe(true);
	});
	test('another host, scheme or port than a listed origin is not the studio', () => {
		for (const u of ['http://studio.example.test/', 'https://studio.example.test:8443/', 'https://other.example.test/', 'https://example.com/']) expect(isStudioOrigin(u, o)).toBe(false);
	});
});

describe('selfHarvestEnv', () => {
	test('AC-B2-2: an admin gets the token for http://127.0.0.1:<port> only', () => {
		expect(self('http://127.0.0.1:5610/admin')).toEqual(GRANTED);
		expect(self('http://127.0.0.1:5610')).toEqual(GRANTED);
	});

	test('AC-B2-2: localhost, [::1], another port, https and another host get nothing', () => {
		for (const u of ['http://localhost:5610/', 'http://[::1]:5610/', 'http://127.0.0.1:3000/', 'http://127.0.0.1/', 'https://127.0.0.1:5610/', 'http://127.0.0.2:5610/', 'http://example.com:5610/', 'http://127.0.0.1.evil.test:5610/', 'http://user@127.0.0.1:5610@evil.test/']) // trufflehog:ignore (userinfo trick, not a credential)
			expect(self(u)).toEqual({});
	});

	test('AC-B2-1: a non-admin never gets the token, whatever the URL', () => {
		for (const u of ['http://127.0.0.1:5610/admin', 'http://localhost:5610/', 'http://[::1]:5610/', 'https://example.com/']) {
			expect(self(u, { admin: false })).toEqual({});
		}
	});

	test('no token configured: nothing, even for an admin', () => {
		expect(self('http://127.0.0.1:5610/', { token: undefined })).toEqual({});
		expect(self('http://127.0.0.1:5610/', { token: '' })).toEqual({});
	});

	test('AC-B2-5: in production the token needs the studio bound to IPv4 loopback', () => {
		for (const host of [undefined, '', '127.0.0.1', '0.0.0.0']) expect(self('http://127.0.0.1:5610/', { host })).toEqual(GRANTED);
		for (const host of ['::1', '::', 'localhost', '192.168.1.20', 'studio.example.test']) expect(self('http://127.0.0.1:5610/', { host })).toEqual({});
	});

	test('AC-B2-5: dev ignores HOST (vite always binds 127.0.0.1)', () => {
		expect(self('http://127.0.0.1:5610/', { dev: true, host: '::1' })).toEqual(GRANTED);
		expect(self('http://127.0.0.1:5610/', { dev: true, host: '192.168.1.20' })).toEqual(GRANTED);
	});

	test('an unparsable URL gets nothing', () => {
		expect(self('not a url')).toEqual({});
	});
});
