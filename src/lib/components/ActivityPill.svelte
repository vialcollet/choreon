<script lang="ts">
	import { activity, runHref } from '$lib/activity.svelte';
	import { api, fmtDur } from '$lib/api';
	import { useI18n } from '$lib/i18n';
	import { onMount } from 'svelte';
	import { Bell, BellOff, Square } from '@lucide/svelte';
	const { t, tt } = useI18n();

	let open = $state(false);
	let now = $state(Date.now());
	// Elapsed times tick while the panel is open.
	onMount(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
	const running = $derived(activity.runs.filter((r) => r.status === 'running'));
	const queued = $derived(activity.runs.filter((r) => r.status === 'queued'));
	const elapsed = (a: number | null) => (a ? fmtDur(a, now) : '');
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="wrap">
	<button class="pill" class:live={activity.runs.length > 0} onclick={() => (open = !open)} title={t('Activity')}>
		{#if activity.runs.length}
			<span class="dot running"></span>
			<span>{running.length > 1 ? t('{n} tasks running', { n: running.length }) : running.length ? t('{n} task running', { n: running.length }) : t('queued')}</span>
			{#if queued.length}<span class="q mono">+{queued.length}</span>{/if}
		{:else}
			<span class="dot done"></span><span class="dim">{t('Studio idle')}</span>
		{/if}
	</button>

	{#if open}
		<button class="scrim" aria-label={t('Close')} onclick={() => (open = false)}></button>
		<div class="pop">
			<div class="row head">
				<h3>{t('Activity')}</h3>
				<span class="spacer"></span>
				{#if activity.desktop}
					<button class="ghost small" onclick={() => activity.disableDesktop()} title={t('Desktop notifications are on')}><Bell size={13} /> {t('Notifications on')}</button>
				{:else}
					<button class="ghost small" onclick={() => activity.enableDesktop()} title={t('Get a desktop notification when a task ends while you are elsewhere')}><BellOff size={13} /> {t('Notify me')}</button>
				{/if}
			</div>
			{#each activity.runs as r (r.id)}
				<div class="item">
					<span class="dot {r.status}"></span>
					<a class="main" href={runHref(r)} onclick={() => (open = false)}>
						<span class="ttl">{tt(r.title)}</span>
						<span class="where">{[r.videoTitle ?? r.projectId, r.shotKey].filter(Boolean).join(' · ')}</span>
					</a>
					<span class="mono faint">{r.status === 'running' ? elapsed(r.startedAt) : t('queued')}</span>
					<button class="ghost icon small" title={t('Stop')} onclick={() => api.cancel(r.id)}><Square size={11} /></button>
				</div>
			{:else}
				<p class="faint small empty-msg">{t('Nothing running. Tasks you start appear here, with a notification when they end.')}</p>
			{/each}
		</div>
	{/if}
</div>

<style>
	.wrap { position: relative; }
	.pill { width: 100%; justify-content: flex-start; gap: 8px; min-height: 30px; padding: 4px 10px; font-size: 12.5px; background: transparent; border-color: var(--line); border-radius: 99px; }
	.pill.live { border-color: color-mix(in srgb, var(--agent) 45%, transparent); background: color-mix(in srgb, var(--agent) 8%, transparent); color: var(--text); }
	.q { margin-left: auto; color: var(--dim); font-size: 11px; }
	.scrim { position: fixed; inset: 0; background: transparent; border: 0; z-index: 60; cursor: default; min-height: 0; }
	.scrim:hover { background: transparent !important; }
	.pop { position: fixed; left: 14px; top: 92px; width: 380px; max-height: 60vh; overflow: auto; z-index: 61; background: var(--panel-2); border-radius: 12px; box-shadow: var(--shadow-pop); padding: 10px; display: grid; gap: 2px; }
	.head { padding: 2px 4px 8px 6px; }
	.item { display: grid; grid-template-columns: auto 1fr auto auto; gap: 10px; align-items: center; padding: 6px 6px; border-radius: 8px; }
	.item:hover { background: rgb(255 255 255 / 0.04); }
	.main { display: grid; min-width: 0; }
	.ttl { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.where { font-size: 11.5px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.empty-msg { margin: 4px 6px 8px; }
</style>
