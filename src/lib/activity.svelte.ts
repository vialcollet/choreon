// Studio activity, client side: runs in progress (all visible projects) and notifications.
// Fed by the layout's initial data, then by the /api/events stream.
import type { RunBrief } from '$lib/server/activity';

export type Toast = { id: number; run: RunBrief; phase: 'start' | 'done' | 'error'; at: number };

/** Runs whose end is worth announcing on its own (chains of render / fix stay quiet). */
const MILESTONES = new Set(['brief_review', 'storyboard_generate', 'storyboard_revise', 'assemble', 'sound_design', 'resolve_export', 'reference_scout', 'reference_analyze', 'ui_harvest', 'ui_login', 'stills_render', 'asset_generate', 'eval', 'voice_generate', 'animatic']);

class Activity {
	runs = $state<RunBrief[]>([]);
	toasts = $state<Toast[]>([]);
	desktop = $state(false);
	#seq = 0;

	init(initial: RunBrief[]) {
		this.runs = initial;
		try {
			this.desktop = localStorage.getItem('choreon.notify') === '1' && Notification.permission === 'granted';
		} catch {}
	}

	/** A status event from the stream. */
	update(run: RunBrief) {
		const live = run.status === 'queued' || run.status === 'running';
		const known = this.runs.find((r) => r.id === run.id);
		if (live) {
			if (known) Object.assign(known, run);
			else {
				this.runs = [...this.runs, run];
				if (!run.parentId && run.lane !== 'memory') this.#push(run, 'start');
			}
			return;
		}
		this.runs = this.runs.filter((r) => r.id !== run.id);
		if (run.status === 'error') this.#push(run, 'error');
		else if (run.status === 'done' && (MILESTONES.has(run.kind) || (!run.parentId && run.lane !== 'memory'))) this.#push(run, 'done');
	}

	dismiss(id: number) {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	async enableDesktop() {
		try {
			const p = await Notification.requestPermission();
			this.desktop = p === 'granted';
			localStorage.setItem('choreon.notify', this.desktop ? '1' : '0');
		} catch {}
	}

	disableDesktop() {
		this.desktop = false;
		try {
			localStorage.setItem('choreon.notify', '0');
		} catch {}
	}

	#push(run: RunBrief, phase: Toast['phase']) {
		const t: Toast = { id: ++this.#seq, run, phase, at: Date.now() };
		this.toasts = [...this.toasts.slice(-3), t];
		// Errors stay until closed; the rest fades out on its own.
		if (phase !== 'error') setTimeout(() => this.dismiss(t.id), phase === 'start' ? 5000 : 9000);
	}
}

export const activity = new Activity();

/** Link to the place a run belongs to. */
export function runHref(r: RunBrief): string {
	if (!r.videoSlug) return `/p/${r.projectId}`;
	const base = `/p/${r.projectId}/v/${r.videoSlug}`;
	if (r.shotKey) return `${base}/production?shot=${r.shotKey}`;
	return ['assemble', 'sound_design', 'resolve_export'].includes(r.kind) ? `${base}/production?shot=__full` : base;
}
