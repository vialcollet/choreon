<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { api, fmtTime } from '$lib/api';
	import { useI18n } from '$lib/i18n';
	import { Globe, LogIn, ScanSearch, Trash2 } from '@lucide/svelte';

	let { data } = $props();
	const { t, tt, lang } = useI18n();
	const projectId = $derived(page.params.project!);

	let url = $state('');
	let kit = $state('');
	let width = $state('1440');
	let err = $state('');
	let view = $state<Record<string, 'auto' | 'fidele' | 'simplifie' | 'original'>>({});
	let bg = $state<'clair' | 'sombre'>('clair');

	async function job(kind: 'ui_harvest' | 'ui_login') {
		err = '';
		const urls = url.split(/\s+/).map((u) => u.trim()).filter(Boolean);
		if (!urls.length || urls.some((u) => !/^https?:\/\//.test(u))) return (err = t('Full addresses required (https://…), one per line'));
		try {
			const [w, h] = width === '390' ? [390, 844] : [Number(width), 900];
			// Login: one window on the first address; harvest: all pages in a single kit.
			await api.job({ kind, projectId, url: kind === 'ui_login' ? urls[0] : urls.join(' '), kit: kit.trim() || undefined, width: w, height: h, lane: 'ui' });
			invalidateAll();
		} catch (e) {
			err = String(e);
		}
	}
	const running = $derived(data.runs.some((r) => r.status === 'running' || r.status === 'queued'));
	const src = (k: (typeof data.kits)[number], c: (typeof data.kits)[number]['components'][number]) => {
		const v = view[k.slug] ?? 'auto';
		const u = k.urls[c.name];
		return v === 'original' ? u.original : v === 'auto' ? (c.variant === 'simplifie' ? u.simplifie : u.fidele) : u[v];
	};
</script>

<div class="wrapper">
	<header class="col" style="gap: 4px">
		<h1>{t('Interface')}</h1>
		<p class="dim small" style="margin: 0">
			{@html t('Enter the address of a site or app: the studio spots its interface elements (navigation, fields, buttons, cards, badges…), rebuilds them as <b>layered vector SVG</b>, simplified where needed, and the agent keeps the ones that make the interface recognizable. Kits can be used in scenes (<span class="mono">loadUiKit</span>).')}
		</p>
	</header>

	<section class="panel pad col">
		<div class="row fwrap">
			<label style="flex: 1; min-width: 280px"><span>{t('Address(es) — one page per line for a multi-page kit')}</span><textarea bind:value={url} rows="3" placeholder={t('https://app.example.com/home\nhttps://app.example.com/tasks')}></textarea></label>
			<label style="width: 180px"><span>{t('Kit name (optional)')}</span><input bind:value={kit} placeholder="my-app" /></label>
			<label style="width: 150px"><span>{t('Window')}</span>
				<select bind:value={width}><option value="1440">{t('Desktop 1440')}</option><option value="1280">{t('Desktop 1280')}</option><option value="390">{t('Mobile 390')}</option></select>
			</label>
		</div>
		<div class="row fwrap">
			<button class="primary" disabled={running} onclick={() => job('ui_harvest')}><ScanSearch size={15} /> {t('Harvest the interface')}</button>
			<button disabled={running || !data.isAdmin} onclick={() => job('ui_login')} title={data.isAdmin ? t('Opens a browser window on this computer: sign in, then close it; the session is kept for this site') : t('Only studio administrators can save a browser session')}><LogIn size={15} /> {t('Sign in first')}</button>
			<span class="faint small">{t('Site behind a login: “Sign in first”, then “Harvest”.')}</span>
		</div>
		{#if err}<p class="small" style="color: var(--err); margin: 0">{err}</p>{/if}
		{#each data.runs as r (r.id)}
			<div class="row small run"><span class="dot {r.status}"></span><span>{tt(r.title)}</span><span class="faint">{r.input.url}</span><span class="spacer"></span><span class="faint">{fmtTime(r.createdAt, lang())}</span>{#if r.error}<span style="color: var(--err)">{t(r.error)}</span>{/if}</div>
		{/each}
	</section>

	{#if data.kits.length}
		<div class="row"><span class="dim small">{t('Background')}</span><button class="small" class:primary={bg === 'clair'} onclick={() => (bg = 'clair')}>{t('light')}</button><button class="small" class:primary={bg === 'sombre'} onclick={() => (bg = 'sombre')}>{t('dark')}</button></div>
	{/if}

	{#each data.kits as k (k.slug)}
		<section class="panel pad col">
			<div class="row fwrap">
				<h2>{k.label}</h2>
				<span class="chip mono">{k.slug}</span>
				<a class="faint small" href={k.url} target="_blank" rel="noreferrer"><Globe size={12} /> {k.url}</a>
				{#if data.auth[k.slug]}<span class="chip ok">{t('session saved')}</span>{/if}
				<span class="spacer"></span>
				<select bind:value={view[k.slug]} style="width: auto">
					<option value="auto">{t('recommended variant')}</option><option value="fidele">{t('faithful')}</option><option value="simplifie">{t('simplified')}</option><option value="original">{t('original capture')}</option>
				</select>
				<form method="POST" action="?/remove" use:enhance><input type="hidden" name="kit" value={k.slug} /><button class="ghost small" title={t('Delete kit')} onclick={(e) => !confirm(t('Delete kit {name}?', { name: k.label })) && e.preventDefault()}><Trash2 size={14} /></button></form>
			</div>
			{#if k.summary}<p class="dim small" style="margin: 0">{k.summary}</p>{/if}
			{#if k.pages && k.pages.length > 1}<div class="row fwrap small">{#each k.pages as pg (pg.url)}<span class="chip">{new URL(pg.url).pathname} · {pg.kept}</span>{/each}</div>{/if}
			<div class="row fwrap tokens">
				{#each k.tokens.colors.slice(0, 10) as c (c)}<span class="sw" style="background: {c}" title={c}></span>{/each}
				<span class="faint small">{k.tokens.fonts.join(', ')} · {t('radii')} {k.tokens.radii.map((r) => (r >= 999 ? t('pill') : `${r}px`)).join(', ')}</span>
			</div>
			<div class="grid-c">
				{#each k.components as c (c.name)}
					<figure class="comp">
						<div class="stage" class:dark={bg === 'sombre'}>{#if src(k, c)}<img src={src(k, c)} alt={c.label} style="max-width: min(100%, {c.w}px)" />{/if}</div>
						<figcaption>
							<div class="row"><b>{c.label}</b><span class="spacer"></span><span class="chip">{c.role}</span></div>
							<div class="faint small mono">{c.name} · {c.w}×{c.h}{c.repeats > 1 ? ` · ×${c.repeats}` : ''}{c.variant === 'simplifie' ? ` · ${t('simplified')}` : ''}</div>
							{#if c.description}<div class="dim small">{c.description}</div>{/if}
						</figcaption>
					</figure>
				{/each}
			</div>
		</section>
	{:else}
		<div class="empty">{t('No kits yet.')}</div>
	{/each}
</div>

<style>
	.wrapper { padding: 32px 36px 56px; display: grid; gap: 16px; align-content: start; }
	h1 { margin: 0; }
	.run { border-top: 1px solid var(--line-soft); padding-top: 6px; }
	.tokens { gap: 6px; }
	.sw { width: 22px; height: 22px; border-radius: 5px; border: 1px solid var(--line); }
	.grid-c { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
	.comp { margin: 0; border: 1px solid var(--line-soft); border-radius: 8px; overflow: hidden; display: grid; grid-template-rows: 200px auto; }
	.stage { display: grid; place-items: center; padding: 14px; background: #f4f1e8; overflow: hidden; }
	.stage.dark { background: #0e1116; }
	.stage img { max-height: 172px; object-fit: contain; }
	figcaption { padding: 10px 12px; display: grid; gap: 3px; }
	figcaption b { font-weight: 600; font-size: 13px; }
</style>
