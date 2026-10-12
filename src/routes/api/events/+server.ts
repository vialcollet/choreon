import { canAccessProject } from '$lib/server/access';
import { runBrief } from '$lib/server/activity';
import { subscribeAll } from '$lib/server/hub';
import { getRun } from '$lib/server/store';
import type { RequestHandler } from './$types';

// Lightweight global stream: run statuses and artifacts, to refresh open pages.
export const GET: RequestHandler = ({ request, locals }) => {
	const enc = new TextEncoder();
	// A tenant only receives events from its own projects.
	const allowed = new Map<string, boolean>();
	const visible = (runId: string) => {
		if (!allowed.has(runId)) {
			const r = getRun(runId);
			allowed.set(runId, !!r && canAccessProject(locals, r.projectId));
		}
		return allowed.get(runId)!;
	};
	let off: (() => void) | null = null;
	let beat: ReturnType<typeof setInterval> | null = null;
	const stream = new ReadableStream({
		start(ctl) {
			off = subscribeAll(({ runId, ev }) => {
				if ((ev.type !== 'status' && ev.type !== 'artifact') || !visible(runId)) return;
				try {
					// Status changes carry the run's summary, for notifications.
					const r = ev.type === 'status' ? getRun(runId) : null;
					ctl.enqueue(enc.encode(`data: ${JSON.stringify({ runId, type: ev.type, payload: ev.payload, ...(r ? { run: runBrief(r) } : {}) })}\n\n`));
				} catch {}
			});
			beat = setInterval(() => {
				try {
					ctl.enqueue(enc.encode(': ping\n\n'));
				} catch {}
			}, 25000);
			request.signal.addEventListener('abort', () => {
				off?.();
				if (beat) clearInterval(beat);
				try {
					ctl.close();
				} catch {}
			});
		},
		cancel() {
			off?.();
			if (beat) clearInterval(beat);
		}
	});
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
};
