import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Client for the DaVinci Resolve Lua bridge (free version 21.1): the script engine/resolve/choreon_bridge.lua,
// launched in Resolve (Workspace ▸ Scripts), runs cmd_<n>.lua and answers in res_<n>.prefs
// (Fusion preferences dump whose Global.ChoreonResult holds the JSON in hexadecimal).

const DIR = process.env.RESOLVE_BRIDGE_DIR || join(homedir(), 'choreon_bridge');
const RESULT_RE = /ChoreonResult = "([0-9a-f]*)"/;

function readPrefs(file: string): any | null {
	try {
		const m = RESULT_RE.exec(readFileSync(file, 'utf8'));
		return m ? JSON.parse(Buffer.from(m[1], 'hex').toString('utf8')) : null;
	} catch {
		return null;
	}
}

export function bridgeStatus(): { state: string; started?: number; next?: number } {
	const s = existsSync(join(DIR, 'status.prefs')) ? readPrefs(join(DIR, 'status.prefs')) : null;
	return s ?? { state: 'absent' };
}

function nextId(st: { started?: number; next?: number }): number {
	const counter = join(DIR, 'client_counter.json');
	try {
		const c = JSON.parse(readFileSync(counter, 'utf8'));
		if (c.started === st.started) return Math.max(c.next, st.next ?? 1);
	} catch {}
	return st.next ?? 1;
}

/** Runs Lua in Resolve and returns the result. Throws if the bridge is not running. */
export async function resolveCall<T = unknown>(code: string, timeoutMs = 120000): Promise<T> {
	const st = bridgeStatus();
	if (st.state !== 'running') throw new Error('the Resolve bridge is not running: launch Workspace ▸ Scripts ▸ choreon_bridge in DaVinci Resolve');
	const n = nextId(st);
	const cmd = join(DIR, `cmd_${n}.lua`);
	const res = join(DIR, `res_${n}.prefs`);
	if (existsSync(res)) rmSync(res);
	writeFileSync(cmd + '.tmp', code);
	renameSync(cmd + '.tmp', cmd);
	const t0 = Date.now();
	try {
		while (!existsSync(res)) {
			if (Date.now() - t0 > timeoutMs) throw new Error('Resolve is not responding (bridge stopped?)');
			await new Promise((r) => setTimeout(r, 100));
		}
		let data = null;
		for (let i = 0; i < 40 && !data; i++) {
			data = readPrefs(res);
			if (!data) await new Promise((r) => setTimeout(r, 50));
		}
		writeFileSync(join(DIR, 'client_counter.json'), JSON.stringify({ started: st.started, next: n + 1 }));
		if (!data) throw new Error('unreadable Resolve response');
		if (!data.ok) throw new Error(`Resolve : ${data.error}`);
		return data.result as T;
	} finally {
		for (const f of [cmd, res]) if (existsSync(f)) rmSync(f);
	}
}

const luaStr = (s: string) => JSON.stringify(s.split('\\').join('/'));

/** Checks within a few seconds that Resolve and the bridge really respond. */
export async function pingResolve(): Promise<string> {
	try {
		return await resolveCall<string>('return resolve:GetProductName() .. " " .. resolve:GetVersionString()', 8000);
	} catch {
		throw new Error('Resolve is not responding: open DaVinci Resolve on the right project, then launch Workspace ▸ Scripts ▸ choreon_bridge');
	}
}

/** Imports files into a bin and creates a timeline chaining them. */
export async function exportToResolve(opts: { bin: string; timeline: string; files: string[] }) {
	await pingResolve();
	const paths = opts.files.map(luaStr).join(', ');
	return resolveCall<{ timeline: string; clips: number; project: string }>(`
local pm = resolve:GetProjectManager()
local p = pm:GetCurrentProject()
local mp = p:GetMediaPool()
local root = mp:GetRootFolder()
local folder = nil
for _, f in ipairs(root:GetSubFolderList()) do if f:GetName() == ${luaStr(opts.bin)} then folder = f end end
folder = folder or mp:AddSubFolder(root, ${luaStr(opts.bin)})
mp:SetCurrentFolder(folder)
local items = mp:ImportMedia({ ${paths} })
if not items or #items == 0 then error("media import failed") end
local tl = mp:CreateTimelineFromClips(${luaStr(opts.timeline)}, items)
if not tl then error("timeline creation failed") end
p:SetCurrentTimeline(tl)
return { timeline = tl:GetName(), clips = #items, project = p:GetName() }
`);
}
