import { delimiter } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { agentEnv, extractJson } from './agent';
import { saveStudioSettings, studioSettings } from './lessons';

// Names only: each secret gets the value `fake-<name>`.
const SECRETS = ['GEMINI_API_KEY', 'BETTER_AUTH_SECRET', 'STUDIO_TOKEN', 'FOO_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'TYPESAFE_API_KEY', 'DATABASE_URL', 'ANTHROPIC_API_KEY'];
const KEEP = { HOME: '/home/fake', LC_ALL: 'C.UTF-8', XDG_CONFIG_HOME: '/home/fake/.config', HTTPS_PROXY: 'http://proxy.test:3128', http_proxy: 'http://proxy.test:3128', CLAUDE_CONFIG_DIR: '/home/fake/.claude' };
const FAKE: Record<string, string> = { ...Object.fromEntries(SECRETS.map((k) => [k, `fake-${k}`])), ...KEEP, PATH: ['/opt/bun-node-1234', '/usr/local/bin', '/usr/bin'].join(delimiter) };
const saved: Record<string, string | undefined> = {};
const settings = studioSettings();
const auth = (claudeAuth: 'subscription' | 'api_key') => saveStudioSettings({ ...settings, claudeAuth });

beforeAll(() => {
	for (const [k, v] of Object.entries(FAKE)) {
		saved[k] = process.env[k];
		process.env[k] = v;
	}
});
afterAll(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	saveStudioSettings(settings);
});

describe('agentEnv (AC-B3-1, AC-B3-2)', () => {
	test('subscription mode: no secret and no unknown variable reaches the agent', () => {
		auth('subscription');
		const env = agentEnv();
		for (const k of SECRETS) expect(env).not.toHaveProperty(k);
		expect(Object.values(env).join('\n')).not.toContain('fake-');
	});

	test('the variables the agent needs are kept', () => {
		auth('subscription');
		const env = agentEnv();
		expect(env).toMatchObject(KEEP);
		expect(env.STUDIO_DATA).toBe(process.env.STUDIO_DATA as string);
	});

	test('the agent\'s own endpoint and OAuth credential pass; the Claude Code markers do not', () => {
		const own = { ANTHROPIC_BASE_URL: 'http://proxy.test:8080', CLAUDE_CODE_OAUTH_TOKEN: 'fake-CLAUDE_CODE_OAUTH_TOKEN' };
		const marks = { CLAUDE_CODE_ENTRYPOINT: 'fake-CLAUDE_CODE_ENTRYPOINT', CLAUDECODE: 'fake-CLAUDECODE' };
		const all = { ...own, ...marks };
		const prev = Object.fromEntries(Object.keys(all).map((k) => [k, process.env[k]]));
		Object.assign(process.env, all);
		try {
			auth('subscription');
			const env = agentEnv();
			expect(env).toMatchObject(own);
			for (const k of Object.keys(marks)) expect(env).not.toHaveProperty(k);
		} finally {
			for (const [k, v] of Object.entries(prev)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		}
	});

	// Windows environment names are case-insensitive: `home` there IS `HOME`.
	test.skipIf(process.platform === 'win32')('names are matched exactly: lower-case look-alikes of allowed names do not pass', () => {
		const pass = { HOME: '/home/fake', LC_ALL: 'C.UTF-8', Path: 'C:\\Windows' };
		const look = { home: 'fake-home', lc_secret: 'fake-lc_secret', xdg_x: 'fake-xdg_x' };
		const all = { ...pass, ...look };
		const prev = Object.fromEntries(Object.keys(all).map((k) => [k, process.env[k]]));
		Object.assign(process.env, all);
		try {
			auth('subscription');
			const env = agentEnv();
			expect(env).toMatchObject({ HOME: pass.HOME, LC_ALL: pass.LC_ALL });
			expect(env).toHaveProperty('Path');
			for (const k of Object.keys(look)) expect(env).not.toHaveProperty(k);
		} finally {
			for (const [k, v] of Object.entries(prev)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		}
	});

	test('PATH is the real-Node path (Bun shim directory removed)', () => {
		auth('subscription');
		expect(agentEnv().PATH).toBe(['/usr/local/bin', '/usr/bin'].join(delimiter));
	});

	test('API-key mode adds the Anthropic key, and nothing else secret', () => {
		auth('api_key');
		const env = agentEnv();
		expect(env.ANTHROPIC_API_KEY).toBe('fake-ANTHROPIC_API_KEY');
		for (const k of SECRETS.filter((k) => k !== 'ANTHROPIC_API_KEY')) expect(env).not.toHaveProperty(k);
	});
});

describe('extractJson', () => {
	test('reads a ```json block', () => {
		expect(extractJson<unknown>('Here it is:\n```json\n{"a": 1}\n```\nDone.')).toEqual({ a: 1 });
	});

	test('skips a bash block that precedes the JSON', () => {
		expect(extractJson<unknown>('```bash\nls -la\n```\n```json\n{"ok": true}\n```')).toEqual({ ok: true });
	});

	test('reads bare JSON and an object after prose with stray braces', () => {
		expect(extractJson<unknown>('{"a":{"b":[1,2]}}')).toEqual({ a: { b: [1, 2] } });
		expect(extractJson<unknown>('Use {curly} braces, then {oops. Result: {"score": 7}')).toEqual({ score: 7 });
	});

	test('braces and escaped quotes inside strings do not end the object', () => {
		expect(extractJson<unknown>('x {"t": "a } b { c \\" } d", "n": 2} y')).toEqual({ t: 'a } b { c " } d', n: 2 });
	});

	test('returns null when there is no valid JSON', () => {
		expect(extractJson('')).toBeNull();
		expect(extractJson('no json here')).toBeNull();
		expect(extractJson('{"a": ')).toBeNull();
		expect(extractJson('```json\n{broken}\n```')).toBeNull();
	});
});
