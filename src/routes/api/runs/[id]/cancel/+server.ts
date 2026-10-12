import { json } from '@sveltejs/kit';
import { requireRun } from '$lib/server/access';
import { cancel } from '$lib/server/jobs';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ params, locals }) => {
	requireRun(locals, params.id);
	cancel(params.id);
	return json({ ok: true });
};
