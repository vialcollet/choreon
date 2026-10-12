<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import RunList from '$lib/components/RunList.svelte';
	import ModelOverride from '$lib/components/ModelOverride.svelte';
	import PipelineBar from '$lib/components/PipelineBar.svelte';
	import { useI18n } from '$lib/i18n';
	import { Activity, PanelRightClose, ChevronRight } from '@lucide/svelte';
	const { t } = useI18n();
	let { data, children } = $props();
	const base = $derived(`/p/${data.project.id}/v/${data.video.slug}`);
	const running = $derived(data.active.length);

	// Activity rail: closed by default so the work gets the room; remembered per browser.
	let rail = $state(false);
	onMount(() => {
		try {
			rail = localStorage.getItem('choreon.rail') === '1';
		} catch {}
	});
	function toggleRail() {
		rail = !rail;
		try {
			localStorage.setItem('choreon.rail', rail ? '1' : '0');
		} catch {}
	}
</script>

<div class="vid">
	<header>
		<div class="row top">
			<div class="col" style="gap: 2px; min-width: 0">
				<span class="crumb"><a href="/p/{data.project.id}">{data.project.name}</a><ChevronRight size={12} /></span>
				<h1>{data.video.title}</h1>
			</div>
			<span class="spacer"></span>
			<span class="chip mono">{data.video.format.width}×{data.video.format.height} · {data.video.format.fps} {t('fps')} · {t('target {d} s', { d: data.video.targetDuration })}</span>
			<ModelOverride />
			<button class="activity" class:on={rail} onclick={toggleRail} title={t('Runs')}>
				{#if running}<span class="dot running"></span>{:else}<Activity size={15} />{/if}
				{running ? (running > 1 ? t('{n} tasks running', { n: running }) : t('{n} task running', { n: running })) : t('Runs')}
			</button>
		</div>
		<div class="tabrow">
			<nav class="tabs">
				<a href={base} class:active={page.url.pathname === base}>Storyboard</a>
				<a href="{base}/production" class:active={page.url.pathname.endsWith('/production')}>Production</a>
			</nav>
			<PipelineBar brief={data.video.briefState} storyboard={data.storyboard} shots={data.shots} renders={data.renders} evals={data.evals} active={data.active} cost={data.cost} {base} />
		</div>
	</header>
	<div class="body" class:railed={rail}>
		<div class="main">{@render children()}</div>
		{#if rail}
			<aside class="runs">
				<div class="row"><h3>{t('Runs')}</h3><span class="spacer"></span><button class="ghost icon small" onclick={toggleRail} title={t('Close')}><PanelRightClose size={15} /></button></div>
				<RunList runs={data.runs} project={data.project.id} compact />
			</aside>
		{/if}
	</div>
</div>

<style>
	.vid { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
	header { padding: 18px 28px 0; display: grid; gap: 14px; border-bottom: 1px solid var(--line); background: var(--bg); }
	.top { flex-wrap: wrap; row-gap: 8px; }
	.tabrow { display: flex; align-items: center; gap: 20px; border-bottom: 1px solid transparent; }
	.tabrow .tabs { border-bottom: 0; flex: none; }
	.tabrow :global(.pipe) { flex: 1; justify-content: flex-end; padding-bottom: 6px; }
	h1 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.activity.on { background: var(--raise); border-color: var(--line-strong); }
	.body { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 0; }
	.body.railed { grid-template-columns: minmax(0, 1fr) 290px; }
	.main { overflow: auto; min-height: 0; }
	.runs { border-left: 1px solid var(--line); padding: 14px 10px; overflow: auto; display: grid; gap: 8px; align-content: start; background: var(--bg-deep); }
	.runs h3 { padding-left: 8px; }
	@media (max-width: 1100px) { .body.railed { grid-template-columns: minmax(0, 1fr); } .runs { position: fixed; right: 0; top: 0; bottom: 0; width: 300px; z-index: 40; box-shadow: var(--shadow-pop); } }
</style>
