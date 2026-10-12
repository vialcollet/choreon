<script lang="ts">
	import { api } from '$lib/api';
	import { invalidateAll } from '$app/navigation';
	import { useI18n } from '$lib/i18n';
	import { Trash2, Check, Undo2 } from '@lucide/svelte';

	type N = { id: string; body: string; status: string; t: number | null; frameUrl: string | null; route: { provider: string; scope: string; category: string; blocking: boolean; confidence?: number; lesson?: string } | null };
	let { note, onseek }: { note: N; onseek?: (t: number) => void } = $props();

	const { t } = useI18n();
	const SCOPE: Record<string, string> = { shot_fix: 'shot fix', storyboard_change: 'storyboard', global_style: 'global style' };

	async function set(status: string) {
		await api.noteStatus(note.id, status);
		invalidateAll();
	}
	async function del() {
		await api.deleteNote(note.id);
		invalidateAll();
	}
</script>

<div class="note" class:done={note.status !== 'open'}>
	{#if note.frameUrl}
		<button class="ghost thumb" onclick={() => note.t != null && onseek?.(note.t)} title={t('Go to the annotated moment')}><img src={note.frameUrl} alt="" /></button>
	{/if}
	<div class="col" style="gap: 4px; min-width: 0">
		<div class="row fwrap" style="gap: 4px">
			{#if note.t != null}<button class="chip ghost" onclick={() => onseek?.(note.t!)}>{note.t.toFixed(2)} s</button>{/if}
			{#if note.route}
				<span class="chip" class:amber={note.route.scope !== 'shot_fix'} title="{t('routing {provider}', { provider: note.route.provider })}{note.route.confidence ? ` · ${t('confidence {n} %', { n: Math.round(note.route.confidence * 100) })}` : ''}">{SCOPE[note.route.scope] ? t(SCOPE[note.route.scope]) : note.route.scope}</span>
				<span class="chip">{note.route.category}</span>
				{#if note.route.blocking}<span class="chip err">{t('blocking')}</span>{/if}
				{#if note.route.lesson && note.route.lesson !== 'none'}<span class="chip agent" title={t('A lesson will be suggested after the fix')}>{note.route.lesson === 'harness' ? t('studio lesson') : t('project lesson')}</span>{/if}
			{/if}
			{#if note.status === 'applied'}<span class="chip ok">{t('applied')}</span>{:else if note.status === 'dismissed'}<span class="chip">{t('dismissed')}</span>{/if}
		</div>
		<div class="body">{note.body}</div>
	</div>
	<div class="acts">
		{#if note.status === 'open'}
			<button class="ghost small" title={t('Dismiss')} onclick={() => set('dismissed')}><Check size={13} /></button>
		{:else}
			<button class="ghost small" title={t('Reopen')} onclick={() => set('open')}><Undo2 size={13} /></button>
		{/if}
		<button class="ghost small" title={t('Delete')} onclick={del}><Trash2 size={13} /></button>
	</div>
</div>

<style>
	.note { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; padding: 8px; border: 1px solid var(--line-soft); border-radius: 6px; background: var(--bg-deep); }
	.note.done { opacity: 0.55; }
	.thumb { padding: 0; border: 0; width: 88px; }
	.thumb img { border-radius: 4px; }
	.body { white-space: pre-wrap; word-break: break-word; font-size: 13px; }
	.acts { display: grid; align-content: start; gap: 2px; }
	.acts button { border: 0; padding: 3px; }
	.chip.ghost { background: transparent; cursor: pointer; }
</style>
