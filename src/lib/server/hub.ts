import { EventEmitter } from 'node:events';
import type { RunEvent, RunStatus } from '$lib/types';
import { db, now } from './db';
import { mapPaths, toStored } from './paths';

// Run log: each event is first written to the database (source of truth, replayable
// from a seq), then broadcast to SSE subscribers.

declare global {
	var __studioHub: EventEmitter | undefined;
}
const bus: EventEmitter = (globalThis.__studioHub ??= new EventEmitter().setMaxListeners(200));

const nextSeq = db.query<{ s: number | null }, [string]>('SELECT MAX(seq) AS s FROM events WHERE run_id = ?');
const insert = db.query('INSERT INTO events (run_id, seq, type, payload, ts) VALUES (?, ?, ?, ?, ?)');

export function emit(runId: string, type: RunEvent['type'], payload: Record<string, unknown>): RunEvent {
	const seq = (nextSeq.get(runId)?.s ?? 0) + 1;
	const ev: RunEvent = { seq, type, payload, ts: now() };
	insert.run(runId, seq, type, JSON.stringify(payload), ev.ts);
	bus.emit(`run:${runId}`, ev);
	bus.emit('runs', { runId, ev });
	return ev;
}

export function eventsSince(runId: string, since = 0): RunEvent[] {
	return db
		.query<{ seq: number; type: RunEvent['type']; payload: string; ts: number }, [string, number]>(
			'SELECT seq, type, payload, ts FROM events WHERE run_id = ? AND seq > ? ORDER BY seq'
		)
		.all(runId, since)
		.map((r) => ({ seq: r.seq, type: r.type, payload: JSON.parse(r.payload), ts: r.ts }));
}

export function subscribe(runId: string, fn: (ev: RunEvent) => void): () => void {
	bus.on(`run:${runId}`, fn);
	return () => bus.off(`run:${runId}`, fn);
}

/** All status changes (to refresh pages). */
export function subscribeAll(fn: (x: { runId: string; ev: RunEvent }) => void): () => void {
	bus.on('runs', fn);
	return () => bus.off('runs', fn);
}

export function setStatus(runId: string, status: RunStatus, extra: { error?: string; output?: unknown } = {}) {
	const t = now();
	if (status === 'running') db.query('UPDATE runs SET status = ?, started_at = ? WHERE id = ?').run(status, t, runId);
	else if (status === 'queued') db.query('UPDATE runs SET status = ? WHERE id = ?').run(status, runId);
	else
		db.query('UPDATE runs SET status = ?, finished_at = ?, error = ?, output = COALESCE(?, output) WHERE id = ?').run(
			status,
			t,
			extra.error ?? null,
			extra.output === undefined ? null : JSON.stringify(mapPaths(extra.output, toStored)),
			runId
		);
	emit(runId, 'status', { status, ...(extra.error ? { error: extra.error } : {}) });
}

export function addCost(runId: string, usd: number) {
	if (usd > 0) db.query('UPDATE runs SET cost_usd = cost_usd + ? WHERE id = ?').run(usd, runId);
}
