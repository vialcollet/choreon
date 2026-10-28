import { error, json } from '@sveltejs/kit';
import { isStudioAdmin, requireRun } from '$lib/server/access';
import { enqueue } from '$lib/server/jobs';
import { retryOf } from '$lib/server/retry';
import * as S from '$lib/server/store';
import { translate } from '$lib/i18n';
import type { RequestHandler } from './$types';

/** Starts a failed or cancelled run again with the same input (a fix loop resumes at its round; /api/jobs starts at 0). */
export const POST: RequestHandler = ({ params, locals }) => {
	const again = retryOf(requireRun(locals, params.id), isStudioAdmin(locals));
	if (!again) error(409, translate(locals.lang, 'Only a failed or stopped run can be retried'));
	const run = enqueue(again.kind, again.input);
	S.setAuthor('runs', run.id, locals.user!.id);
	return json(run);
};
