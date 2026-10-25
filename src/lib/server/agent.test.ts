import { delimiter } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { agentEnv, extractJson, finalAnswer, REPAIR_JSON, type AgentResult, type AgentTask } from './agent';
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

describe('finalAnswer', () => {
	const task = { runId: 'test-final-answer', cwd: '.', prompt: 'p', role: 'r', images: [], signal: new AbortController().signal } as unknown as AgentTask;
	const result = (text: string, more: Partial<AgentResult> = {}): AgentResult => ({ text, texts: [text], costUsd: 0.1, turns: 3, sessionId: 's1', maxTurnsHit: false, ...more });
	const ok = (x: { scores?: unknown } | null) => !!x?.scores;
	/** A stand-in for the agent: records what it was asked and answers `reply`. */
	const fake = (reply: string) => {
		const asked: AgentTask[] = [];
		return { asked, run: async (t: AgentTask) => (asked.push(t), result(reply, { costUsd: 0.01, turns: 1 })) };
	};

	test('a valid answer is kept as is: the agent is not asked again', async () => {
		const f = fake('{}');
		const res = await finalAnswer(task, result('```json\n{"scores": {"a": 8}}\n```'), ok, 'conclude', f.run);
		expect(f.asked).toHaveLength(0);
		expect(extractJson<{ scores: unknown }>(res.text)?.scores).toEqual({ a: 8 });
	});

	test('an answer whose JSON does not parse is asked for again, once, without tools, in the same session', async () => {
		const f = fake('{"scores": {"a": 7}}');
		const res = await finalAnswer(task, result('```json\n{"scores": {"a": 7}, "summary": "x");\n"findings": []}\n```'), ok, 'conclude', f.run);
		expect(f.asked).toHaveLength(1);
		expect(f.asked[0]).toMatchObject({ prompt: REPAIR_JSON, resume: 's1', noTools: true });
		expect(extractJson<{ scores: unknown }>(res.text)?.scores).toEqual({ a: 7 });
		expect(res.costUsd).toBeCloseTo(0.11);
		expect(res.turns).toBe(4);
	});

	test('out of turns, the agent is asked to conclude with the caller\'s request', async () => {
		const f = fake('{"scores": {"a": 6}}');
		await finalAnswer(task, result('still checking…', { maxTurnsHit: true }), ok, 'conclude', f.run);
		expect(f.asked[0].prompt).toBe('conclude');
	});

	test('without a session to resume, the answer is returned unchanged', async () => {
		const f = fake('{}');
		const res = await finalAnswer(task, result('no json', { sessionId: undefined }), ok, 'conclude', f.run);
		expect(f.asked).toHaveLength(0);
		expect(res.text).toBe('no json');
	});
});
