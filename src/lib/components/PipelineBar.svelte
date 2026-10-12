<script lang="ts">
	// Where a video is in the pipeline: brief → storyboard → shots → critique → assembly → sound.
	// Each step is done, running (an agent is on it), waiting for you, or still to come.
	import { useI18n } from '$lib/i18n';
	import { fmtCost } from '$lib/api';
	import type { BriefState } from '$lib/types';
	import { Check } from '@lucide/svelte';

	type R = { id: string; shotKey: string | null; version: number; qa: { hasAudio?: boolean } };
	type E = { renderId: string; pass: boolean };
	type A = { kind: string; shotKey: string | null };
	let { brief, storyboard, shots, renders, evals, active, cost, base }: {
		brief: BriefState;
		storyboard: { status: string } | null;
		shots: { key: string }[];
		renders: R[];
		evals: E[];
		active: A[];
		cost: number;
		base: string;
	} = $props();
	const { t } = useI18n();

	type State = 'done' | 'running' | 'you' | 'todo';
	const busy = (...kinds: string[]) => active.some((a) => kinds.includes(a.kind));
	const latest = (key: string) => renders.filter((r) => r.shotKey === key).sort((a, b) => b.version - a.version)[0];
	const steps = $derived.by(() => {
		const total = shots.length;
		const built = shots.filter((s) => latest(s.key)).length;
		const passed = shots.filter((s) => { const r = latest(s.key); return r && evals.find((e) => e.renderId === r.id)?.pass; }).length;
		const judged = shots.filter((s) => { const r = latest(s.key); return r && evals.some((e) => e.renderId === r.id); }).length;
		const cuts = renders.filter((r) => r.shotKey === null);
		const open = brief.questions?.length ?? 0;
		const list: { key: string; label: string; state: State; detail: string; href: string }[] = [
			{ key: 'brief', label: t('Brief'), href: base,
				state: busy('brief_review') || brief.status === 'reviewing' ? 'running' : brief.status === 'ready' ? 'done' : brief.status === 'interview' ? 'you' : 'todo',
				detail: brief.status === 'interview' ? t('{n} question(s)', { n: open }) : brief.status === 'ready' ? t('ready') : '' },
			{ key: 'storyboard', label: 'Storyboard', href: base,
				state: busy('storyboard_generate', 'storyboard_revise') ? 'running' : !storyboard ? 'todo' : storyboard.status === 'approved' ? 'done' : 'you',
				detail: storyboard ? (storyboard.status === 'approved' ? t('approved') : t('to approve')) : '' },
			{ key: 'shots', label: t('Shots'), href: `${base}/production`,
				state: busy('shot_build', 'shot_fix', 'render') ? 'running' : total && built === total ? 'done' : 'todo',
				detail: total ? `${built}/${total}` : '' },
			{ key: 'critique', label: t('Critique'), href: `${base}/production`,
				state: busy('eval') ? 'running' : total && passed === total ? 'done' : judged > passed && !busy('shot_fix', 'render') ? 'you' : 'todo',
				detail: total && judged ? `${passed}/${total} ✓` : '' },
			{ key: 'edit', label: t('Assembly'), href: `${base}/production?shot=__full`,
				state: busy('assemble') ? 'running' : cuts.length ? 'done' : 'todo', detail: cuts.length ? t('{n} cut(s)', { n: cuts.length }) : '' },
			{ key: 'sound', label: t('Sound'), href: `${base}/production?shot=__full`,
				state: busy('sound_design') ? 'running' : cuts.some((r) => r.qa.hasAudio) ? 'done' : 'todo', detail: '' }
		];
		return list;
	});
	const current = $derived(steps.findIndex((s) => s.state !== 'done'));
</script>

<nav class="pipe" aria-label={t('Progress')}>
	{#each steps as s, i (s.key)}
		<a href={s.href} class="step {s.state}" class:current={i === current} title={s.detail}>
			<span class="mk">{#if s.state === 'done'}<Check size={11} strokeWidth={3} />{:else if s.state === 'running'}<span class="dot running"></span>{:else}{i + 1}{/if}</span>
			<span class="lbl">{s.label}</span>
			{#if s.state === 'you'}<span class="you">{t('your call')}</span>{:else if s.detail}<span class="det">{s.detail}</span>{/if}
		</a>
		{#if i < steps.length - 1}<span class="bar" class:filled={s.state === 'done'}></span>{/if}
	{/each}
	{#if cost > 0}<span class="cost mono" title={t('Total spent on this video')}>{fmtCost(cost)}</span>{/if}
</nav>

<style>
	.pipe { display: flex; align-items: center; gap: 6px; min-width: 0; overflow-x: auto; padding: 2px 0; }
	.step { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px 4px 5px; border-radius: 99px; color: var(--faint); font-size: 12.5px; white-space: nowrap; border: 1px solid transparent; }
	.step:hover { color: var(--text); background: rgb(255 255 255 / 0.04); }
	.mk { width: 20px; height: 20px; border-radius: 99px; display: grid; place-items: center; font-size: 10.5px; font-weight: 600; box-shadow: inset 0 0 0 1.5px var(--line-strong); color: var(--faint); flex: none; }
	.done { color: var(--dim); }
	.done .mk { background: color-mix(in srgb, var(--ok) 18%, transparent); box-shadow: none; color: var(--ok); }
	.running { color: var(--text); }
	.running .mk { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--agent) 60%, transparent); }
	.you { color: var(--amber); font-size: 11px; font-weight: 500; }
	.step.you { color: var(--text); }
	.step.you .mk { box-shadow: inset 0 0 0 1.5px var(--amber); color: var(--amber); }
	.current { border-color: var(--line); background: rgb(255 255 255 / 0.03); color: var(--text); }
	.lbl { font-weight: 500; }
	.det { color: var(--faint); font-size: 11.5px; font-variant-numeric: tabular-nums; }
	.bar { width: 18px; height: 1.5px; background: var(--line-strong); flex: none; border-radius: 2px; }
	.bar.filled { background: color-mix(in srgb, var(--ok) 55%, transparent); }
	.cost { margin-left: auto; padding-left: 12px; color: var(--dim); font-size: 12px; white-space: nowrap; }
</style>
