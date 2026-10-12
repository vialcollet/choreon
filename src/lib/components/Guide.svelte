<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Markdown from './Markdown.svelte';
	import { useI18n } from '$lib/i18n';
	import { Compass, X, ArrowUp, Square, RotateCcw, Check, CircleAlert } from '@lucide/svelte';

	// The in-app guide: a producer you talk to, who drives the studio with its tools.
	// Mounted once in the layout. Open it with the launcher, open(), or a window event
	// 'choreon:guide' { detail: { prompt?: string, send?: boolean } } (command palette).

	type Tool = { name: string; label: string; ok: boolean; mutates?: boolean; url?: string };
	type Msg = { id: string; role: 'user' | 'assistant'; content: string; meta: { tools?: Tool[]; costUsd?: number; error?: string }; createdAt: number };

	const { t } = useI18n();

	let isOpen = $state(false);
	let loaded = $state(false);
	let messages = $state<Msg[]>([]);
	let busy = $state(false);
	let draft = $state('');
	let live = $state('');
	let liveTools = $state<Tool[]>([]);
	let err = $state('');
	let input: HTMLTextAreaElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();

	const SUGGESTIONS = ['Start a new film', 'Where is my video at?', 'Make the ending punchier'];

	async function load() {
		const r = await fetch('/api/guide');
		if (!r.ok) return;
		const d = (await r.json()) as { messages: Msg[]; busy: boolean };
		messages = d.messages;
		busy = d.busy;
		loaded = true;
		scrollDown();
	}

	export async function open(prompt?: string, sendNow = false) {
		isOpen = true;
		if (!loaded) await load();
		if (prompt) draft = prompt;
		await tick();
		input?.focus();
		if (prompt && sendNow) send();
	}
	const close = () => (isOpen = false);

	async function scrollDown() {
		await tick();
		scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
	}

	async function send(text = draft) {
		const body = text.trim();
		if (!body || busy) return;
		err = '';
		draft = '';
		live = '';
		liveTools = [];
		const r = await fetch('/api/guide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: body, url: page.url.pathname + page.url.search }) });
		if (!r.ok) {
			err = (await r.text()) || String(r.status);
			draft = body;
		}
	}

	async function stop() {
		await fetch('/api/guide/stop', { method: 'POST' });
	}

	async function reset() {
		if (busy) await stop();
		await fetch('/api/guide', { method: 'DELETE' });
		messages = [];
		live = '';
		liveTools = [];
		input?.focus();
	}

	function onEvent(ev: { type: string; [k: string]: any }) {
		if (ev.type === 'busy') busy = ev.busy;
		else if (ev.type === 'user') {
			if (!messages.some((m) => m.id === ev.message.id)) messages = [...messages, ev.message];
			scrollDown();
		} else if (ev.type === 'delta') {
			live += ev.text;
			scrollDown();
		} else if (ev.type === 'tool') {
			const tl = ev.tool as Tool;
			liveTools = [...liveTools, tl];
			if (tl.mutates) invalidateAll();
			if (tl.url) goto(tl.url);
			scrollDown();
		} else if (ev.type === 'assistant') {
			messages = [...messages, ev.message];
			live = '';
			liveTools = [];
			scrollDown();
		} else if (ev.type === 'cleared') {
			messages = [];
		}
	}

	onMount(() => {
		const es = new EventSource('/api/guide/stream');
		es.onmessage = (e) => {
			try {
				onEvent(JSON.parse(e.data));
			} catch {}
		};
		const handler = (e: Event) => {
			const d = (e as CustomEvent<{ prompt?: string; send?: boolean }>).detail ?? {};
			open(d.prompt, !!d.send);
		};
		window.addEventListener('choreon:guide', handler);
		return () => {
			es.close();
			window.removeEventListener('choreon:guide', handler);
		};
	});

	function key(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			send();
		}
	}
</script>

<svelte:window onkeydown={(e) => isOpen && e.key === 'Escape' && close()} />

{#if !isOpen}
	<button class="launcher" onclick={() => open()} title={t('Guide — ask Choreon to do it for you')}>
		{#if busy}<span class="dot running"></span>{:else}<Compass size={17} />{/if}
		<span>{t('Guide')}</span>
	</button>
{/if}

{#if isOpen}
	<aside class="panel-guide" aria-label={t('Guide')}>
		<header>
			<div class="title"><Compass size={16} /><b>{t('Guide')}</b>{#if busy}<span class="chip agent"><span class="dot running"></span> {t('working')}</span>{/if}</div>
			<span class="spacer"></span>
			<button class="ghost icon small" onclick={reset} title={t('New conversation')} disabled={!messages.length && !busy}><RotateCcw size={14} /></button>
			<button class="ghost icon small" onclick={close} title={t('Close')}><X size={15} /></button>
		</header>

		<div class="log" bind:this={scroller}>
			{#if !messages.length && !busy}
				<div class="intro">
					<p class="lead">{t('Tell me what you want to make. I set up the video, run the framing, start the storyboard and the shots, and tell you where things are.')}</p>
					<p class="faint small">{t('I ask before starting anything that costs.')}</p>
					<div class="sugg">
						{#each SUGGESTIONS as s (s)}<button class="small" onclick={() => send(t(s))}>{t(s)}</button>{/each}
					</div>
				</div>
			{/if}
			{#each messages as m (m.id)}
				{#if m.role === 'user'}
					<div class="msg user">{m.content}</div>
				{:else}
					<div class="msg bot">
						{#if m.meta.tools?.length}<div class="tools">{#each m.meta.tools as tl, i (i)}<span class="tool" class:bad={!tl.ok}>{#if tl.ok}<Check size={11} />{:else}<CircleAlert size={11} />{/if}{tl.label}</span>{/each}</div>{/if}
						{#if m.content}<Markdown text={m.content} />{/if}
						{#if m.meta.error}<p class="small errtxt">{m.meta.error}</p>{/if}
					</div>
				{/if}
			{/each}
			{#if busy}
				<div class="msg bot">
					{#if liveTools.length}<div class="tools">{#each liveTools as tl, i (i)}<span class="tool" class:bad={!tl.ok}>{#if tl.ok}<Check size={11} />{:else}<CircleAlert size={11} />{/if}{tl.label}</span>{/each}</div>{/if}
					{#if live}<Markdown text={live} />{:else}<span class="typing"><i></i><i></i><i></i></span>{/if}
				</div>
			{/if}
		</div>

		<form class="compose" onsubmit={(e) => { e.preventDefault(); send(); }}>
			{#if err}<p class="small errtxt">{err}</p>{/if}
			<textarea bind:this={input} bind:value={draft} rows="2" placeholder={t('Ask the guide… (Enter to send, Shift+Enter for a new line)')} onkeydown={key}></textarea>
			<div class="row">
				<span class="faint small ctx">{page.params.video ? t('About this video') : page.params.project ? t('About this project') : ''}</span>
				<span class="spacer"></span>
				{#if busy}
					<button type="button" class="small" onclick={stop}><Square size={12} /> {t('Stop')}</button>
				{:else}
					<button class="accent small" disabled={!draft.trim()}><ArrowUp size={14} /> {t('Send')}</button>
				{/if}
			</div>
		</form>
	</aside>
{/if}

<style>
	.launcher { position: fixed; right: 20px; bottom: 20px; z-index: 60; min-height: 40px; padding: 0 16px 0 14px; border-radius: 99px; background: var(--panel-2); border: 1px solid var(--line-strong); box-shadow: var(--shadow-pop); font-weight: 600; }
	.launcher:hover:not(:disabled) { background: var(--raise); }
	.panel-guide { position: fixed; top: 0; right: 0; bottom: 0; z-index: 60; width: min(440px, 100vw); display: grid; grid-template-rows: auto 1fr auto; background: var(--panel); border-left: 1px solid var(--line-strong); box-shadow: -24px 0 60px rgb(0 0 0 / 0.45); animation: slide 180ms var(--ease); }
	@keyframes slide { from { translate: 24px 0; opacity: 0; } }
	@media (prefers-reduced-motion: reduce) { .panel-guide { animation: none; } }
	header { display: flex; align-items: center; gap: 4px; padding: 12px 12px 12px 16px; border-bottom: 1px solid var(--line); }
	.title { display: flex; align-items: center; gap: 8px; }
	.log { overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
	.intro { display: grid; gap: 8px; margin-top: 8px; }
	.intro p { margin: 0; }
	.lead { color: var(--dim); font-size: 13.5px; line-height: 1.55; }
	.sugg { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
	.msg { max-width: 92%; font-size: 13px; line-height: 1.55; }
	.msg.user { align-self: flex-end; background: var(--raise); border: 1px solid var(--line); padding: 8px 12px; border-radius: 14px 14px 4px 14px; white-space: pre-wrap; }
	.msg.bot { align-self: flex-start; display: grid; gap: 6px; }
	.tools { display: flex; flex-wrap: wrap; gap: 4px; }
	.tool { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; line-height: 18px; padding: 0 8px; border-radius: 99px; color: var(--dim); background: rgb(255 255 255 / 0.04); border: 1px solid var(--line); }
	.tool :global(svg) { color: var(--ok); }
	.tool.bad { color: var(--amber); }
	.tool.bad :global(svg) { color: var(--amber); }
	.errtxt { color: var(--err); margin: 0; }
	.typing { display: inline-flex; gap: 4px; padding: 6px 0; }
	.typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--faint); animation: blink 1.2s infinite ease-in-out; }
	.typing i:nth-child(2) { animation-delay: 0.15s; }
	.typing i:nth-child(3) { animation-delay: 0.3s; }
	@keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
	.compose { border-top: 1px solid var(--line); padding: 12px; display: grid; gap: 8px; }
	.compose textarea { min-height: 64px; max-height: 220px; }
	.ctx { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
