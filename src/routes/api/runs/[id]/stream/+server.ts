import { requireRun } from '$lib/server/access';
import { eventsSince, subscribe } from '$lib/server/hub';
import type { RequestHandler } from './$types';

// SSE: replays from ?since=seq then streams live (heartbeat every 25 s).
export const GET: RequestHandler = ({ params, url, request, locals }) => {
	requireRun(locals, params.id);
	const since = Number(url.searchParams.get('since') ?? 0);
	const enc = new TextEncoder();
	let off: (() => void) | null = null;
	let beat: ReturnType<typeof setInterval> | null = null;
	const stream = new ReadableStream({
		start(ctl) {
			const send = (data: unknown) => {
				try {
					ctl.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {}
			};
			let last = since;
			for (const ev of eventsSince(params.id, since)) {
				send(ev);
				last = ev.seq;
			}
			off = subscribe(params.id, (ev) => {
				if (ev.seq > last) {
					last = ev.seq;
					send(ev);
				}
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
