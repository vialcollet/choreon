import { readJson } from '$lib/server/body';
import { error, json } from '@sveltejs/kit';
import { askGuide, clearGuide, isBusy, listMessages } from '$lib/server/guide';
import type { RequestHandler } from './$types';

const me = (locals: App.Locals) => {
	if (!locals.user) error(401, 'sign in required');
	return locals.user.id;
};

/** The user's conversation with the guide. */
export const GET: RequestHandler = ({ locals }) => {
	const uid = me(locals);
	return json({ messages: listMessages(uid), busy: isBusy(uid) });
};

/** A message to the guide. Body: { text, url? } (url: the page the user is on). The answer streams on /api/guide/stream. */
export const POST: RequestHandler = async ({ request, locals }) => {
	me(locals);
	const b = (await readJson(request)) as { text?: string; url?: string };
	const text = String(b.text ?? '').trim();
	if (!text) error(400, 'empty message');
	try {
		return json(askGuide(locals, text.slice(0, 8000), typeof b.url === 'string' ? b.url : undefined));
	} catch (e) {
		error(409, e instanceof Error ? e.message : String(e));
	}
};

/** New conversation. */
export const DELETE: RequestHandler = ({ locals }) => {
	clearGuide(me(locals));
	return json({ ok: true });
};
