<script lang="ts">
	import { enhance } from '$app/forms';
	import { Images, Plus } from '@lucide/svelte';
	import { locale, useI18n } from '$lib/i18n';

	let { data, form } = $props();
	const { t, lang } = useI18n();
	// svelte-ignore state_referenced_locally -- draft seeded once; p/[project]/+layout.svelte re-creates the page per project and batch
	let template = $state(data.templates[0]?.slug ?? '');
	const tpl = $derived(data.templates.find((t) => t.slug === template));
	const date = (ms: number) => new Date(ms).toLocaleDateString(locale(lang()), { day: 'numeric', month: 'short' });
</script>

<div class="wrap">
	<header class="row"><div class="col" style="gap: 2px"><a class="crumb" href="/p/{data.project.id}">{data.project.name}</a><h1>Stills</h1></div></header>
	<p class="dim small" style="margin: 0">{@html t('Static ad visuals: a brand template, variables per creative, one render per format. Each creative’s ID is used as the ad name and as <code>utm_content</code>.')}</p>

	<div class="two">
		<form class="panel pad col" method="POST" action="?/create" use:enhance>
			<h2><Plus size={15} /> {t('New batch')}</h2>
			<label><span>{t('Name')}</span><input name="name" placeholder={t('S2 — by profession')} required /></label>
			<label>
				<span>Template</span>
				<select name="template" bind:value={template}>
					{#each data.templates as t (t.slug)}<option value={t.slug}>{t.name}</option>{/each}
				</select>
			</label>
			{#if tpl?.description}<p class="small faint" style="margin: 0">{tpl.description}</p>{/if}
			<fieldset class="row fwrap">
				<legend class="small dim">{t('Formats')}</legend>
				{#each tpl?.formats ?? data.formats as f, i (f)}
					<label class="check"><input type="checkbox" name="formats" value={f} checked={i < 2} /> {f}</label>
				{/each}
			</fieldset>
			{#if form?.error}<p class="small" style="color: var(--err); margin: 0">{form.error}</p>{/if}
			<div><button class="primary" disabled={!data.templates.length}>{t('Create batch')}</button></div>
			{#if !data.templates.length}<p class="small faint" style="margin: 0">{@html t('No template in <code>templates/</code> for this project.')}</p>{/if}
		</form>
		<div class="panel pad col">
			<h2><Images size={15} /> {t('Templates')}</h2>
			{#each data.templates as t (t.slug)}
				<div class="col tpl">
					<div class="row"><b>{t.name}</b><code class="small faint">templates/{t.slug}</code></div>
					{#if t.description}<p class="small dim" style="margin: 0">{t.description}</p>{/if}
					<div class="row fwrap">{#each t.formats as f (f)}<span class="chip">{f}</span>{/each}</div>
				</div>
			{:else}
				<p class="small faint" style="margin: 0">{t('No templates.')}</p>
			{/each}
		</div>
	</div>

	<div class="lots">
		{#each data.lots as l (l.slug)}
			<a class="panel lot" href="/p/{data.project.id}/stills/{l.slug}">
				<div class="thumbs" class:empty={!l.thumbs.length}>
					{#each l.thumbs as src (src)}<img {src} alt="" loading="lazy" />{:else}<span class="faint small">{t('Not rendered yet')}</span>{/each}
				</div>
				<div class="meta col">
					<div class="row"><b class="nm">{l.name}</b><span class="spacer"></span><span class="faint small">{date(l.updated)}</span></div>
					<div class="row fwrap small faint">
						<span class="chip">{l.template}</span>
						<span>{l.count > 1 ? t('{n} creatives', { n: l.count }) : t('{n} creative', { n: l.count })}</span>
						<span>{l.rendered > 1 ? t('rendered: {r}/{n}', { r: l.rendered, n: l.count }) : t('{r}/{n} rendered', { r: l.rendered, n: l.count })}</span>
						<span>{l.formats.join(', ')}</span>
					</div>
				</div>
			</a>
		{:else}
			<div class="empty">{t('No batches. Create one with the form above.')}</div>
		{/each}
	</div>
</div>

<style>
	.wrap { padding: 32px 36px 56px; display: grid; gap: 18px; max-width: 1400px; }
	.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
	@media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
	h2 { display: flex; gap: 6px; align-items: center; }
	fieldset { border: 0; padding: 0; margin: 0; gap: 12px; }
	legend { margin-bottom: 4px; }
	.check { display: flex; flex-direction: row; align-items: center; gap: 6px; color: var(--text); font-size: 13px; }
	.tpl + .tpl { border-top: 1px solid var(--line-soft); padding-top: 10px; }
	.lots { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
	.lot { display: grid; grid-template-rows: auto auto; overflow: hidden; color: inherit; text-decoration: none; }
	.lot:hover { border-color: var(--faint); }
	.thumbs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; background: var(--bg-deep); }
	.thumbs.empty { display: grid; place-items: center; grid-template-columns: 1fr; min-height: 120px; }
	.thumbs img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; object-position: top; display: block; }
	.meta { padding: 10px 12px; gap: 6px; }
	.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
