<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import type { RunEvent } from '$lib/types';
	import { useI18n } from '$lib/i18n';
	import { Wrench, CircleAlert, MessageSquare, Brain, FileOutput } from '@lucide/svelte';

	const { t } = useI18n();
	let { runId }: { runId: string } = $props();

	let events = $state<RunEvent[]>([]);
	let box: HTMLDivElement | undefined = $state();
	let es: EventSource | null = null;
	let follow = $state(true);

	$effect(() => {
		const id = runId;
		events = [];
		es?.close();
		es = new EventSource(`/api/runs/${id}/stream?since=0`);
		es.onmessage = async (m) => {
			events.push(JSON.parse(m.data));
			if (follow) {
				await tick();
				box?.scrollTo({ top: box.scrollHeight });
			}
		};
		return () => es?.close();
	});
	onDestroy(() => es?.close());

	const onScroll = () => {
		if (!box) return;
		follow = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
	};
</script>

<div class="log" bind:this={box} onscroll={onScroll}>
	{#each events as ev (ev.seq)}
		{#if ev.type === 'text'}
			<div class="ev text"><MessageSquare size={13} /><div class="body">{ev.payload.text}</div></div>
		{:else if ev.type === 'thinking'}
			<div class="ev faint"><Brain size={13} /><div class="body small">{ev.payload.text}</div></div>
		{:else if ev.type === 'tool'}
			<div class="ev tool"><Wrench size={13} /><div class="body mono"><b>{ev.payload.name}</b> {ev.payload.summary}</div></div>
		{:else if ev.type === 'tool_result'}
			{#if ev.payload.error}<div class="ev err"><CircleAlert size={13} /><div class="body mono small">{ev.payload.text}</div></div>{/if}
		{:else if ev.type === 'error'}
			<div class="ev err"><CircleAlert size={13} /><div class="body">{ev.payload.message}</div></div>
		{:else if ev.type === 'artifact'}
			<div class="ev ok"><FileOutput size={13} /><div class="body small">{ev.payload.kind} {JSON.stringify(ev.payload)}</div></div>
		{:else if ev.type === 'status'}
			<div class="ev status small">— {ev.payload.status}{ev.payload.error ? ` : ${t(String(ev.payload.error))}` : ''}</div>
		{:else if ev.type === 'log'}
			<div class="ev faint small mono">{ev.payload.message}</div>
		{:else if ev.type === 'result'}
			<div class="ev faint small">{t('agent finished · {cost} $ · {turns} turns', { cost: Number(ev.payload.costUsd ?? 0).toFixed(2), turns: ev.payload.turns as number })}</div>
		{/if}
	{:else}
		<div class="faint small">{t('Waiting…')}</div>
	{/each}
</div>

<style>
	.log { display: grid; gap: 6px; align-content: start; overflow: auto; max-height: 100%; padding: 4px 2px; font-size: 13px; }
	.ev { display: grid; grid-template-columns: 16px 1fr; gap: 6px; align-items: start; }
	.ev :global(svg) { margin-top: 3px; color: var(--faint); }
	.body { white-space: pre-wrap; word-break: break-word; }
	.text .body { color: var(--text); }
	.tool .body { color: var(--dim); }
	.tool b { color: var(--agent); font-weight: 600; }
	.err, .err :global(svg) { color: var(--err); }
	.ok :global(svg) { color: var(--ok); }
	.status { grid-template-columns: 1fr; color: var(--dim); }
</style>
