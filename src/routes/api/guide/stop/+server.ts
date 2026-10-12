import { error, json } from '@sveltejs/kit';
import { stopGuide } from '$lib/server/guide';
import type { RequestHandler } from './$types';

/** Stops the guide's current answer. */
export const POST: RequestHandler = ({ locals }) => {
	if (!locals.user) error(401, 'sign in required');
	stopGuide(locals.user.id);
	return json({ ok: true });
};
