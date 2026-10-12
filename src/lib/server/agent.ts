import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { addCost, emit } from './hub';
import { studioSettings } from './lessons';
import { claudeExecutable, realNodePath } from './paths';
import { secret } from './secrets';

// One-off run of a Claude agent (Agent SDK, CLI subscription) for a studio task.
// Every message is turned into a run event, visible live in the UI.

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentTask {
	runId: string;
	cwd: string;
	prompt: string;
	/** Role instructions appended to the Claude Code system prompt. */
	role: string;
	model?: string;
	effort?: Effort;
	/** Images attached to the first message (absolute paths). */
	images?: string[];
	/** Pure critic: no tools. */
	noTools?: boolean;
	maxTurns?: number;
	/** Resumes an existing session (same context, images included). */
	resume?: string;
	/** Language of the produced content (the instructions stay in English). */
	lang?: 'en' | 'fr';
	signal?: AbortSignal;
}

export interface AgentResult {
	text: string;
	/** All of the agent's text messages, in order (fallback for extracting a JSON). */
	texts: string[];
	costUsd: number;
	turns: number;
	/** The agent's session, to resume it (see finalAnswer). */
	sessionId: string | null;
	/** The agent was stopped by the turn limit before it concluded. */
	maxTurnsHit: boolean;
}

const MEDIA: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** Output-language instruction: the studio's instructions are in English, the output follows the project. */
function withLanguage(role: string, lang: 'en' | 'fr' = 'en'): string {
	if (lang === 'en') return role;
	return `${role}\n\nOUTPUT LANGUAGE: write everything you produce (JSON values, storyboards, on-screen text, labels, summaries, reports, file contents meant for people) in FRENCH (natural, typographically correct French: « », non-breaking spaces before : ; ? !). Keys and identifiers stay as specified.`;
}

/**
 * Claude authentication for agents: an Anthropic API key (Studio settings or .env) or the local
 * Claude Code login (subscription). 'auto' uses the key when there is one.
 */
export function claudeAuth(): 'api_key' | 'subscription' {
	const mode = studioSettings().claudeAuth ?? 'auto';
	const key = secret('ANTHROPIC_API_KEY');
	return mode === 'subscription' || (mode === 'auto' && !key) ? 'subscription' : 'api_key';
}

// The SDK replaces the subprocess environment, so an allowlist decides what the agent (and its shell) sees:
// nothing secret by default (server keys, auth secret, service token), only what Claude Code, Node and Playwright need,
// plus the agent's own endpoint (ANTHROPIC_BASE_URL) and subscription credential (CLAUDE_CODE_OAUTH_TOKEN).
// Names are exact (case-sensitive on Linux); the casings Windows uses are listed explicitly.
const AGENT_ENV = new Set(
	('PATH Path HOME USER LOGNAME SHELL TERM LANG TZ TMPDIR TMP TEMP USERPROFILE APPDATA LOCALAPPDATA SystemRoot SYSTEMROOT windir ComSpec PATHEXT HOMEDRIVE HOMEPATH ProgramData ProgramFiles ProgramFiles(x86) CommonProgramFiles NUMBER_OF_PROCESSORS PROCESSOR_ARCHITECTURE OS ' +
		'HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy NODE_EXTRA_CA_CERTS SSL_CERT_FILE CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL CLAUDE_CODE_OAUTH_TOKEN PLAYWRIGHT_BROWSERS_PATH STUDIO_DATA')
		.split(' ')
);

/** Agent process environment: the allowlist above; the Anthropic key only in API-key mode. */
export function agentEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined && (AGENT_ENV.has(k) || k.startsWith('LC_') || k.startsWith('XDG_'))) env[k] = v;
	}
	if (claudeAuth() === 'api_key') {
		const key = secret('ANTHROPIC_API_KEY');
		if (key) env.ANTHROPIC_API_KEY = key;
	}
	// The `node` in the agent's commands must be the real Node (not Bun's shim).
	const path = realNodePath();
	for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') env[k] = path;
	return env;
}

/**
 * One short text-only question to Claude (no tools, no project context), e.g. to route a note.
 * Returns the final text, or throws on timeout.
 */
export async function askClaude(prompt: string, { model = 'haiku', system = '', timeoutMs = 20000 }: { model?: string; system?: string; timeoutMs?: number } = {}): Promise<string> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), timeoutMs);
	try {
		const q = query({
			prompt,
			options: {
				model,
				...(system ? { systemPrompt: system } : {}),
				tools: [] as string[],
				maxTurns: 1,
				settingSources: [],
				permissionMode: 'bypassPermissions',
				allowDangerouslySkipPermissions: true,
				env: agentEnv(),
				abortController: abort,
				...(claudeExecutable() ? { pathToClaudeCodeExecutable: claudeExecutable() } : {})
			}
		});
		let text = '';
		for await (const m of q) {
			if (m.type === 'assistant') for (const b of m.message.content as unknown as Array<Record<string, unknown>>) if (b.type === 'text' && typeof b.text === 'string') text = b.text;
			if (m.type === 'result' && m.subtype === 'success') text = m.result || text;
		}
		return text;
	} finally {
		clearTimeout(timer);
	}
}

const cut = (s: string, n = 1200) => (s.length > n ? s.slice(0, n) + ` … (+${s.length - n})` : s);

function toolSummary(name: string, input: Record<string, unknown>): string {
	if (name === 'Bash') return String(input.command ?? '');
	if (name === 'Write' || name === 'Edit' || name === 'Read') return String(input.file_path ?? '');
	if (name === 'Glob' || name === 'Grep') return String(input.pattern ?? '');
	return cut(JSON.stringify(input), 300);
}

async function* singleMessage(text: string, images: string[]): AsyncIterable<SDKUserMessage> {
	const content: unknown[] = [];
	for (const file of images) {
		const media = MEDIA[extname(file).toLowerCase()];
		if (!media) continue;
		content.push({ type: 'image', source: { type: 'base64', media_type: media, data: readFileSync(file).toString('base64') } });
	}
	content.push({ type: 'text', text });
	yield { type: 'user', message: { role: 'user', content } as SDKUserMessage['message'], parent_tool_use_id: null };
}

export async function runAgent(task: AgentTask): Promise<AgentResult> {
	const abort = new AbortController();
	task.signal?.addEventListener('abort', () => abort.abort(), { once: true });
	const images = task.images ?? [];
	emit(task.runId, 'log', { message: `agent ${task.model ?? 'opus'} · effort ${task.effort ?? 'high'}${images.length ? ` · ${images.length} image(s)` : ''}` });

	const q = query({
		prompt: images.length ? singleMessage(task.prompt, images) : task.prompt,
		options: {
			cwd: task.cwd,
			model: task.model ?? 'opus',
			effort: task.effort ?? 'high',
			systemPrompt: { type: 'preset', preset: 'claude_code', append: withLanguage(task.role, task.lang) },
			settingSources: ['project'],
			permissionMode: 'bypassPermissions',
			allowDangerouslySkipPermissions: true,
			...(task.noTools ? { tools: [] as string[] } : {}),
			maxTurns: task.maxTurns ?? 80,
			...(task.resume ? { resume: task.resume } : {}),
			env: agentEnv(),
			abortController: abort,
			...(claudeExecutable() ? { pathToClaudeCodeExecutable: claudeExecutable() } : {})
		}
	});

	let text = '';
	const texts: string[] = [];
	let cost = 0;
	let turns = 0;
	let sessionId: string | null = null;
	let maxTurnsHit = false;
	try {
	for await (const msg of q) {
		if ((msg as { session_id?: string }).session_id) sessionId = (msg as { session_id: string }).session_id;
		if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
			turns++;
			for (const block of msg.message.content as unknown as Array<Record<string, unknown>>) {
				if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
					text = block.text;
					texts.push(block.text);
					emit(task.runId, 'text', { text: block.text });
				} else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
					emit(task.runId, 'thinking', { text: cut(block.thinking, 600) });
				} else if (block.type === 'tool_use') {
					const input = (block.input ?? {}) as Record<string, unknown>;
					emit(task.runId, 'tool', { name: block.name, summary: toolSummary(String(block.name), input), id: block.id });
				}
			}
		} else if (msg.type === 'user' && !msg.parent_tool_use_id) {
			const content = (msg.message as { content?: unknown }).content;
			if (Array.isArray(content)) {
				for (const b of content as Array<Record<string, unknown>>) {
					if (b.type !== 'tool_result') continue;
					const raw = Array.isArray(b.content)
						? (b.content as Array<Record<string, unknown>>).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n')
						: String(b.content ?? '');
					emit(task.runId, 'tool_result', { id: b.tool_use_id, error: !!b.is_error, text: cut(raw, 800) });
				}
			}
		} else if (msg.type === 'result') {
			cost = msg.total_cost_usd ?? 0;
			if (msg.subtype === 'success') text = msg.result || text;
			else if (msg.subtype === 'error_max_turns') maxTurnsHit = true;
			else emit(task.runId, 'error', { message: `agent ended: ${msg.subtype}` });
		}
	}
	} catch (e) {
		// The turn limit is not a failure: the caller can resume the session to conclude.
		if (!/maximum number of turns/i.test(String(e))) throw e;
		maxTurnsHit = true;
	}
	if (maxTurnsHit) emit(task.runId, 'log', { message: `${task.maxTurns}-turn limit reached` });
	addCost(task.runId, cost);
	emit(task.runId, 'result', { costUsd: cost, turns });
	return { text, texts, costUsd: cost, turns, sessionId, maxTurnsHit };
}

/**
 * If the agent ran out of turns without delivering the expected JSON, resumes its session (it keeps
 * everything it has seen) and asks it to conclude immediately, without tools.
 */
export async function finalAnswer<T>(task: AgentTask, res: AgentResult, ok: (x: T | null) => boolean, ask: string): Promise<AgentResult> {
	const found = [res.text, ...[...res.texts].reverse()].some((t) => ok(extractJson<T>(t)));
	if (found || !res.maxTurnsHit || !res.sessionId) return res;
	emit(task.runId, 'log', { message: 'resuming the session to get the conclusion' });
	const last = await runAgent({ ...task, images: [], resume: res.sessionId, prompt: ask, noTools: true, maxTurns: 2 });
	return { ...last, texts: [...res.texts, ...last.texts], costUsd: res.costUsd + last.costUsd, turns: res.turns + last.turns };
}

/** Extracts the first JSON object from an answer (```json``` block or balanced braces). */
export function extractJson<T>(text: string): T | null {
	// Every ```…``` block (a bash block may precede the JSON), then every balanced object
	// starting at each "{" (prose may contain braces).
	const candidates: string[] = [];
	for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(m[1]);
	for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
		let depth = 0, inStr = false, esc = false;
		for (let i = start; i < text.length; i++) {
			const c = text[i];
			if (inStr) {
				if (esc) esc = false;
				else if (c === '\\') esc = true;
				else if (c === '"') inStr = false;
			} else if (c === '"') inStr = true;
			else if (c === '{') depth++;
			else if (c === '}' && --depth === 0) {
				candidates.push(text.slice(start, i + 1));
				break;
			}
		}
		if (candidates.length > 40) break;
	}
	for (const c of candidates) {
		try {
			return JSON.parse(c) as T;
		} catch {}
	}
	return null;
}
