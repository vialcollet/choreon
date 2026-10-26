import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DATA_DIR, ensureDir, legacyToRel } from './paths';

// Local SQLite database (WAL). The schema is created on open; changes go
// through the MIGRATIONS list, applied in order and remembered in user_version.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	settings TEXT NOT NULL DEFAULT '{}',
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS videos (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id),
	slug TEXT NOT NULL,
	title TEXT NOT NULL,
	brief TEXT NOT NULL DEFAULT '',
	format TEXT NOT NULL DEFAULT '{"width":1920,"height":1080,"fps":30}',
	target_duration REAL NOT NULL DEFAULT 30,
	created_at INTEGER NOT NULL,
	UNIQUE(project_id, slug)
);
CREATE TABLE IF NOT EXISTS storyboards (
	id TEXT PRIMARY KEY,
	video_id TEXT NOT NULL REFERENCES videos(id),
	version INTEGER NOT NULL,
	summary TEXT NOT NULL DEFAULT '',
	logline TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'draft',
	run_id TEXT,
	created_at INTEGER NOT NULL,
	UNIQUE(video_id, version)
);
CREATE TABLE IF NOT EXISTS shots (
	id TEXT PRIMARY KEY,
	storyboard_id TEXT NOT NULL REFERENCES storyboards(id),
	idx INTEGER NOT NULL,
	key TEXT NOT NULL,
	title TEXT NOT NULL,
	duration REAL NOT NULL,
	data TEXT NOT NULL DEFAULT '{}',
	ref_image TEXT
);
CREATE TABLE IF NOT EXISTS notes (
	id TEXT PRIMARY KEY,
	video_id TEXT NOT NULL REFERENCES videos(id),
	target TEXT NOT NULL,
	storyboard_version INTEGER,
	shot_key TEXT,
	render_id TEXT,
	t REAL,
	region TEXT,
	frame TEXT,
	body TEXT NOT NULL,
	route TEXT,
	status TEXT NOT NULL DEFAULT 'open',
	run_id TEXT,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS renders (
	id TEXT PRIMARY KEY,
	video_id TEXT NOT NULL REFERENCES videos(id),
	shot_key TEXT,
	version INTEGER NOT NULL,
	file TEXT NOT NULL,
	qa TEXT NOT NULL DEFAULT '{}',
	run_id TEXT,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS evals (
	id TEXT PRIMARY KEY,
	render_id TEXT NOT NULL REFERENCES renders(id),
	video_id TEXT NOT NULL,
	shot_key TEXT,
	round INTEGER NOT NULL,
	scores TEXT NOT NULL,
	pass INTEGER NOT NULL,
	findings TEXT NOT NULL DEFAULT '[]',
	summary TEXT NOT NULL DEFAULT '',
	run_id TEXT,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	video_id TEXT,
	kind TEXT NOT NULL,
	title TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'queued',
	input TEXT NOT NULL DEFAULT '{}',
	output TEXT,
	error TEXT,
	cost_usd REAL NOT NULL DEFAULT 0,
	parent_id TEXT,
	created_at INTEGER NOT NULL,
	started_at INTEGER,
	finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS events (
	run_id TEXT NOT NULL,
	seq INTEGER NOT NULL,
	type TEXT NOT NULL,
	payload TEXT NOT NULL,
	ts INTEGER NOT NULL,
	PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS assets (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	name TEXT NOT NULL,
	file TEXT NOT NULL,
	mime TEXT NOT NULL,
	size INTEGER NOT NULL,
	tags TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL DEFAULT 'upload',
	meta TEXT NOT NULL DEFAULT '{}',
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lessons (
	id TEXT PRIMARY KEY,
	num INTEGER NOT NULL UNIQUE,
	scope TEXT NOT NULL,
	project_id TEXT,
	rule TEXT NOT NULL,
	rationale TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'proposed',
	source TEXT NOT NULL DEFAULT '{}',
	uses INTEGER NOT NULL DEFAULT 0,
	violations INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS refs (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	source TEXT NOT NULL,
	slug TEXT NOT NULL,
	title TEXT NOT NULL,
	company TEXT NOT NULL DEFAULT '',
	category TEXT NOT NULL DEFAULT '',
	page_url TEXT,
	x_url TEXT,
	video_url TEXT,
	poster TEXT,
	duration REAL,
	status TEXT NOT NULL DEFAULT 'candidate',
	relevance TEXT NOT NULL DEFAULT '{}',
	analysis TEXT NOT NULL DEFAULT '{}',
	style_guide TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	UNIQUE(project_id, source, slug)
);
CREATE TABLE IF NOT EXISTS video_refs (
	video_id TEXT NOT NULL,
	ref_id TEXT NOT NULL,
	PRIMARY KEY (video_id, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_lessons_scope ON lessons(scope, project_id, status);
CREATE INDEX IF NOT EXISTS idx_runs_video ON runs(video_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notes_video ON notes(video_id, status);
CREATE INDEX IF NOT EXISTS idx_renders_shot ON renders(video_id, shot_key, version);
`;

/** All strings of a JSON passed through fn (legacyToRel only touches old data paths). */
const deepStrings = (v: unknown, fn: (s: string) => string): unknown =>
	typeof v === 'string' ? fn(v) : Array.isArray(v) ? v.map((x) => deepStrings(x, fn)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepStrings(x, fn)])) : v;

/** 4 — file paths relative to DATA_DIR (the repo can change folder). */
function relativePaths(db: Database) {
	for (const [table, col] of [['shots', 'ref_image'], ['notes', 'frame'], ['renders', 'file'], ['assets', 'file']]) {
		const rows = db.query(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`).all() as { id: string; v: string }[];
		for (const r of rows) db.query(`UPDATE ${table} SET ${col} = ? WHERE id = ?`).run(legacyToRel(r.v), r.id);
	}
	for (const [table, col] of [['renders', 'qa'], ['refs', 'analysis'], ['runs', 'output']]) {
		const rows = db.query(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`).all() as { id: string; v: string }[];
		for (const r of rows) {
			try {
				db.query(`UPDATE ${table} SET ${col} = ? WHERE id = ?`).run(JSON.stringify(deepStrings(JSON.parse(r.v), legacyToRel)), r.id);
			} catch {}
		}
	}
}

const MIGRATIONS: (string | ((db: Database) => void))[] = [
	// 1 — framing state (interview) of a video.
	"ALTER TABLE videos ADD COLUMN brief_state TEXT NOT NULL DEFAULT '{}'",
	// 2 — multi-tenant: each project belongs to an organization (better-auth).
	'ALTER TABLE projects ADD COLUMN org_id TEXT',
	// 3 — author of runs and notes.
	'ALTER TABLE runs ADD COLUMN user_id TEXT; ALTER TABLE notes ADD COLUMN user_id TEXT',
	relativePaths,
	// 5 — the in-app guide: one conversation per user (messages + the agent session to resume).
	`CREATE TABLE IF NOT EXISTS guide_messages (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		role TEXT NOT NULL,
		content TEXT NOT NULL,
		meta TEXT NOT NULL DEFAULT '{}',
		created_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_guide_user ON guide_messages(user_id, created_at);
	CREATE TABLE IF NOT EXISTS guide_threads (
		user_id TEXT PRIMARY KEY,
		session_id TEXT,
		cost_usd REAL NOT NULL DEFAULT 0,
		updated_at INTEGER NOT NULL
	);`,
	// 6 — a film's own content language (a translated version of a film of the project).
	'ALTER TABLE videos ADD COLUMN language TEXT'
];

declare global {
	// Survives Vite HMR: a single connection per process.
	var __studioDb: Database | undefined;
}

function open(): Database {
	ensureDir(DATA_DIR);
	const db = new Database(join(DATA_DIR, 'studio.db'), { create: true });
	db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
	db.exec(SCHEMA);
	const v = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
	for (let i = v; i < MIGRATIONS.length; i++) {
		const m = MIGRATIONS[i];
		db.transaction(() => (typeof m === 'string' ? db.exec(m) : m(db)))();
		db.exec(`PRAGMA user_version = ${i + 1}`);
	}
	return db;
}

export const db: Database = (globalThis.__studioDb ??= open());

export const id = () => randomUUID().replace(/-/g, '').slice(0, 16);
export const now = () => Date.now();

/** JSON columns: tolerant parse (an unreadable value becomes the default value). */
export function json<T>(s: string | null | undefined, fallback: T): T {
	if (!s) return fallback;
	try {
		return JSON.parse(s) as T;
	} catch {
		return fallback;
	}
}
