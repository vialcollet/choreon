<script lang="ts">
	import { activity, runHref } from '$lib/activity.svelte';
	import { fmtCost, fmtDur } from '$lib/api';
	import { useI18n } from '$lib/i18n';
	import { X, Check, TriangleAlert, Loader } from '@lucide/svelte';
	const { t, tt } = useI18n();

	const place = (r: (typeof activity.toasts)[number]['run']) => [r.videoTitle, r.shotKey].filter(Boolean).join(' · ');
</script>

<div class="stack" aria-live="polite">
	{#each activity.toasts as n (n.id)}
		<div class="toast {n.phase}" class:fail={n.run.pass === false}>
			<span class="ic">
				{#if n.phase === 'error'}<TriangleAlert size={16} />{:else if n.phase === 'start'}<Loader size={16} class="spin" />{:else if n.run.pass === false}<TriangleAlert size={16} />{:else}<Check size={16} />{/if}
			</span>
			<div class="body">
				<div class="ttl">
					{tt(n.run.title)}
					<span class="what">
						{#if n.phase === 'start'}{t('started')}
						{:else if n.phase === 'error'}{t('failed')}
						{:else if n.run.pass === true}{t('approved')}
						{:else if n.run.pass === false}{t('needs work')}
						{:else}{t('done')}{/if}
					</span>
				</div>
				{#if place(n.run)}<div class="where">{place(n.run)}</div>{/if}
				{#if n.phase === 'error' && n.run.error}<div class="err">{t(n.run.error)}</div>{/if}
				<div class="foot">
					{#if n.phase !== 'start'}<span class="mono">{fmtDur(n.run.startedAt, n.run.finishedAt)}{n.run.costUsd ? ` · ${fmtCost(n.run.costUsd)}` : ''}</span>{/if}
					<a href={runHref(n.run)} onclick={() => activity.dismiss(n.id)}>{t('Open')}</a>
				</div>
			</div>
			<button class="ghost icon small" onclick={() => activity.dismiss(n.id)} title={t('Close')}><X size={14} /></button>
		</div>
	{/each}
</div>

<style>
	.stack { position: fixed; top: 16px; right: 16px; z-index: 90; display: grid; gap: 8px; width: min(360px, calc(100vw - 32px)); pointer-events: none; }
	.toast { pointer-events: auto; display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: start; padding: 12px 10px 12px 14px; border-radius: 12px; background: var(--raise); box-shadow: var(--shadow-pop); animation: enter 260ms var(--ease); border-left: 3px solid var(--line-strong); }
	.toast.start { border-left-color: var(--agent); }
	.toast.done { border-left-color: var(--ok); }
	.toast.done.fail { border-left-color: var(--amber); }
	.toast.error { border-left-color: var(--err); }
	.ic { padding-top: 1px; color: var(--dim); }
	.start .ic { color: var(--agent); }
	.done .ic { color: var(--ok); }
	.done.fail .ic { color: var(--amber); }
	.error .ic { color: var(--err); }
	.body { display: grid; gap: 2px; min-width: 0; }
	.ttl { font-weight: 600; font-size: 13.5px; }
	.what { font-weight: 400; color: var(--dim); }
	.where { color: var(--dim); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.err { color: var(--err); font-size: 12.5px; }
	.foot { display: flex; gap: 10px; align-items: center; font-size: 12px; color: var(--faint); margin-top: 2px; }
	.foot a { color: var(--text); font-weight: 500; margin-left: auto; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { rotate: 360deg; } }
	@keyframes enter { from { opacity: 0; translate: 12px 0; } }
</style>
