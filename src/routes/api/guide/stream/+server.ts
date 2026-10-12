import { error } from '@sveltejs/kit';
import { isBusy, subscribeGuide } from '$lib/server/guide';
import type { RequestHandler } from './$types';

// SSE: the guide's events for the signed-in user (text deltas, tool chips, messages), heartbeat every 25 s.
export const GET: RequestHandler = ({ request, locals }) => {
	if (!locals.user) error(401, 'sign in required');
	const uid = locals.user.id;
	const enc = new TextEncoder();
	let off: (() => void) | null = null;
	let beat: ReturnType<typeof setInterval> | null = null;
	const stop = () => {
		off?.();
		if (beat) clearInterval(beat);
	};
	const stream = new ReadableStream({
		start(ctl) {
			const send = (data: unknown) => {
				try {
					ctl.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {}
			};
			send({ type: 'busy', busy: isBusy(uid) });
			off = subscribeGuide(uid, send);
			beat = setInterval(() => {
				try {
					ctl.enqueue(enc.encode(': ping\n\n'));
				} catch {}
			}, 25000);
			request.signal.addEventListener('abort', () => {
				stop();
				try {
					ctl.close();
				} catch {}
			});
		},
		cancel: stop
	});
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
};
