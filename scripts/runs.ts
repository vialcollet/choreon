// Command-line run tracking: bun scripts/runs.ts [runId] [--since N]
import { db } from '../src/lib/server/db';

const [id, flag, n] = process.argv.slice(2);
if (!id) {
	for (const r of db.query('SELECT id, kind, title, status, cost_usd, error, created_at FROM runs ORDER BY created_at DESC LIMIT 20').all() as any[])
		console.log(r.id, r.status.padEnd(9), `${r.cost_usd.toFixed(2)}$`.padStart(7), r.title, r.error ? `— ${r.error.slice(0, 120)}` : '');
} else {
	const r = db.query('SELECT status, cost_usd, error FROM runs WHERE id = ?').get(id) as any;
	console.log(r);
	const since = flag === '--since' ? Number(n) : 0;
	for (const e of db.query('SELECT seq, type, payload FROM events WHERE run_id = ? AND seq > ? ORDER BY seq').all(id, since) as any[])
		console.log(e.seq, e.type, e.payload.slice(0, 240));
}
