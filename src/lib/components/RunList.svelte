<script lang="ts">
	import { api, fmtCost, fmtDur, fmtTime } from '$lib/api';
	import RunLog from './RunLog.svelte';
	import { useI18n } from '$lib/i18n';
	import { X } from '@lucide/svelte';

	type RunRow = { id: string; title: string; status: string; costUsd: number; createdAt: number; startedAt: number | null; finishedAt: number | null; error: string | null };
	let { runs, project, compact = false }: { runs: RunRow[]; project: string; compact?: boolean } = $props();

	const { t, tt, lang } = useI18n();
	let open = $state<string | null>(null);
	const openRun = $derived(runs.find((r) => r.id === open) ?? null);
</script>

<div class="list">
	{#each runs as r (r.id)}
		<button class="ghost item" class:sel={open === r.id} onclick={() => (open = open === r.id ? null : r.id)}>
			<span class="dot {r.status}"></span>
			<span class="t">{tt(r.title)}</span>
			<span class="spacer"></span>
			{#if !compact}<span class="faint small">{fmtTime(r.createdAt, lang())}</span>{/if}
			<span class="faint small">{fmtDur(r.startedAt, r.finishedAt)}</span>
			<span class="faint small">{fmtCost(r.costUsd)}</span>
		</button>
	{:else}
		<div class="faint small">{t('No runs.')}</div>
	{/each}
</div>

{#if openRun}
	<div class="drawer panel">
		<div class="row head">
			<span class="dot {openRun.status}"></span>
			<b>{tt(openRun.title)}</b>
			<span class="spacer"></span>
			{#if openRun.status === 'running' || openRun.status === 'queued'}<button class="small danger" onclick={() => api.cancel(openRun.id)}>{t('Stop')}</button>{/if}
			{#if openRun.status === 'error' || openRun.status === 'cancelled'}<button class="small" title={t('Start it again with the same input (a fix loop resumes at the same round)')} onclick={async () => (open = (await api.retry(openRun.id)).id)}>{t('Retry')}</button>{/if}
			<button class="ghost small" onclick={() => (open = null)}><X size={14} /></button>
		</div>
		{#if openRun.error}<p class="small" style="color: var(--err); margin: 0 0 8px">{t(openRun.error)}</p>{/if}
		<div class="logbox"><RunLog runId={openRun.id} /></div>
	</div>
{/if}

<style>
	.list { display: grid; gap: 1px; }
	.item { width: 100%; border: 0; border-radius: 6px; padding: 5px 8px; text-align: left; }
	.item:hover, .item.sel { background: var(--panel-2); }
	.t { overflow: hidden; text-overflow: ellipsis; }
	.drawer { position: fixed; right: 16px; bottom: 16px; width: min(560px, calc(100vw - 32px)); height: min(70vh, 640px); display: grid; grid-template-rows: auto auto 1fr; padding: 12px; z-index: 50; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5); }
	.head { margin-bottom: 8px; }
	.logbox { min-height: 0; overflow: hidden; display: grid; }
</style>
