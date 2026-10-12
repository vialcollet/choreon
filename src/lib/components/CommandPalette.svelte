<script lang="ts">
	// Ctrl/Cmd+K: jump anywhere (projects, videos, pages) or hand a request to the guide.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { useI18n } from '$lib/i18n';
	import { Search, Clapperboard, FolderOpen, Film, Library, LayoutTemplate, Images, Settings2, Brain, SlidersHorizontal, Sparkles, Plus, MonitorPlay, CornerDownLeft } from '@lucide/svelte';
	import type { Component } from 'svelte';

	type NavProject = { id: string; name: string; videos: { slug: string; title: string }[] };
	let { nav, isAdmin = false }: { nav: NavProject[]; isAdmin?: boolean } = $props();
	const { t } = useI18n();

	type Item = { id: string; label: string; hint?: string; group: string; icon: Component; run: () => void; keywords?: string };
	let open = $state(false);
	let q = $state('');
	let sel = $state(0);
	let input: HTMLInputElement | undefined = $state();

	const guide = (prompt?: string) => window.dispatchEvent(new CustomEvent('choreon:guide', { detail: { prompt, send: !!prompt } }));

	const items = $derived.by(() => {
		const list: Item[] = [];
		const pid = page.params.project;
		const vid = page.params.video;
		if (pid && vid) {
			const base = `/p/${pid}/v/${vid}`;
			list.push(
				{ id: 'here-sb', group: t('This video'), label: 'Storyboard', icon: Clapperboard, run: () => goto(base) },
				{ id: 'here-prod', group: t('This video'), label: 'Production', icon: MonitorPlay, run: () => goto(`${base}/production`) },
				{ id: 'here-full', group: t('This video'), label: t('Full video'), icon: Film, run: () => goto(`${base}/production?shot=__full`) }
			);
		}
		for (const p of nav) {
			list.push({ id: `p-${p.id}`, group: t('Projects'), label: p.name, icon: FolderOpen, run: () => goto(`/p/${p.id}`) });
			for (const v of p.videos) list.push({ id: `v-${p.id}-${v.slug}`, group: t('Videos'), label: v.title, hint: p.name, icon: Clapperboard, run: () => goto(`/p/${p.id}/v/${v.slug}`) });
			const sub: [string, string, Component][] = [['references', t('References'), Film], ['library', t('Library'), Library], ['ui', t('Interface'), LayoutTemplate], ['stills', t('Stills'), Images], ['settings', t('Settings'), Settings2]];
			for (const [path, label, icon] of sub) list.push({ id: `s-${p.id}-${path}`, group: t('Pages'), label, hint: p.name, icon, run: () => goto(`/p/${p.id}/${path}`) });
			list.push({ id: `nv-${p.id}`, group: t('Create'), label: t('New video'), hint: p.name, icon: Plus, run: () => goto(`/p/${p.id}#nouvelle-video`) });
		}
		list.push({ id: 'np', group: t('Create'), label: t('New project'), icon: Plus, run: () => goto('/#new-project') });
		list.push({ id: 'lessons', group: t('Pages'), label: t('Lessons'), icon: Brain, run: () => goto('/lessons') });
		if (isAdmin) list.push({ id: 'studio', group: t('Pages'), label: t('Studio settings'), icon: SlidersHorizontal, run: () => goto('/settings') });
		return list;
	});

	const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
	const filtered = $derived.by(() => {
		const words = norm(q).split(/\s+/).filter(Boolean);
		const hits = words.length ? items.filter((i) => { const hay = norm(`${i.label} ${i.hint ?? ''} ${i.group}`); return words.every((w) => hay.includes(w)); }) : items.filter((i) => i.group !== t('Pages') || !page.params.project || i.hint === nav.find((p) => p.id === page.params.project)?.name);
		const ask: Item = { id: 'guide', group: t('Guide'), label: q.trim() ? t('Ask the guide: “{q}”', { q: q.trim() }) : t('Ask the guide…'), icon: Sparkles, run: () => guide(q.trim() || undefined) };
		return [...hits.slice(0, 40), ask];
	});

	$effect(() => {
		void q;
		sel = 0;
	});

	export function show() {
		open = true;
		q = '';
		setTimeout(() => input?.focus(), 0);
	}
	function pick(i: Item | undefined) {
		if (!i) return;
		open = false;
		i.run();
	}
	function key(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			open ? (open = false) : show();
			return;
		}
		if (!open) return;
		if (e.key === 'Escape') open = false;
		else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1); document.getElementById(`cmd-${sel}`)?.scrollIntoView({ block: 'nearest' }); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); document.getElementById(`cmd-${sel}`)?.scrollIntoView({ block: 'nearest' }); }
		else if (e.key === 'Enter') { e.preventDefault(); pick(filtered[sel]); }
	}
</script>

<svelte:window onkeydown={key} />

{#if open}
	<div class="veil" role="presentation" onclick={() => (open = false)}></div>
	<div class="box" role="dialog" aria-label={t('Command palette')}>
		<div class="field">
			<Search size={16} />
			<input bind:this={input} bind:value={q} placeholder={t('Go to a project, a video, a page… or ask the guide')} spellcheck="false" />
			<kbd>Esc</kbd>
		</div>
		<div class="list">
			{#each filtered as it, i (it.id)}
				{#if i === 0 || filtered[i - 1].group !== it.group}<div class="grp">{it.group}</div>{/if}
				<button id="cmd-{i}" class="it" class:on={i === sel} onmouseenter={() => (sel = i)} onclick={() => pick(it)}>
					<it.icon size={15} />
					<span class="lb">{it.label}</span>
					{#if it.hint}<span class="hint">{it.hint}</span>{/if}
					{#if i === sel}<CornerDownLeft size={13} class="ret" />{/if}
				</button>
			{/each}
		</div>
		<div class="foot"><span><kbd>↑</kbd><kbd>↓</kbd> {t('navigate')}</span><span><kbd>↵</kbd> {t('open')}</span><span><kbd>Ctrl</kbd><kbd>K</kbd> {t('toggle')}</span></div>
	</div>
{/if}

<style>
	.veil { position: fixed; inset: 0; z-index: 100; background: rgb(4 5 8 / 0.6); backdrop-filter: blur(3px); animation: fade 120ms var(--ease); }
	.box { position: fixed; z-index: 101; left: 50%; top: 14vh; translate: -50% 0; width: min(640px, calc(100vw - 32px)); background: var(--panel-2); border-radius: 16px; box-shadow: var(--shadow-pop); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; max-height: 64vh; overflow: hidden; animation: pop 160ms var(--ease); }
	.field { display: flex; align-items: center; gap: 10px; padding: 6px 14px; border-bottom: 1px solid var(--line); color: var(--faint); }
	.field input { border: 0; background: transparent; box-shadow: none; font-size: 15.5px; min-height: 48px; padding: 0; }
	.field input:focus { box-shadow: none; background: transparent; }
	.list { overflow: auto; padding: 6px; }
	.grp { font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.08em; padding: 10px 10px 4px; }
	.it { width: 100%; justify-content: flex-start; gap: 10px; border: 0; background: transparent; min-height: 36px; padding: 6px 10px; border-radius: 9px; font-weight: 400; color: var(--dim); }
	.it.on, .it:hover:not(:disabled) { background: rgb(255 255 255 / 0.07); color: var(--text); }
	.lb { overflow: hidden; text-overflow: ellipsis; }
	.hint { color: var(--faint); font-size: 12px; margin-left: auto; padding-left: 12px; white-space: nowrap; }
	.it :global(.ret) { color: var(--faint); margin-left: 6px; }
	.it:not(:has(.hint)) :global(.ret) { margin-left: auto; }
	.foot { display: flex; gap: 16px; padding: 8px 14px; border-top: 1px solid var(--line); color: var(--faint); font-size: 11.5px; }
	.foot kbd { margin-right: 2px; }
	@keyframes fade { from { opacity: 0; } }
	@keyframes pop { from { opacity: 0; scale: 0.98; } }
</style>
