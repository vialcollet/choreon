import type { JobKind } from './jobs';
import type { Run } from './store';

/**
 * What it takes to start a failed or cancelled run again: same kind and input (same shot, findings and round, so an
 * automatic fix loop stopped by a usage limit resumes where it was), null when the run cannot be retried. Admin rights
 * come from whoever retries, never from the stored input.
 */
export function retryOf(r: Run, byAdmin: boolean): { kind: JobKind; input: Record<string, unknown> & { projectId: string } } | null {
	if (r.status !== 'error' && r.status !== 'cancelled') return null;
	return { kind: r.kind as JobKind, input: { ...r.input, projectId: r.projectId, videoId: r.videoId, parentId: r.parentId, title: r.title, byAdmin } };
}
