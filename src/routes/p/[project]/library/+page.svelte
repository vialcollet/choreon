<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import RunList from '$lib/components/RunList.svelte';
	import { useI18n } from '$lib/i18n';
	import { Upload, Sparkles, Trash2, FileCode2, Music, Type } from '@lucide/svelte';

	let { data, form } = $props();
	const { t } = useI18n();
	let filter = $state('tout');
	let prompt = $state('');
	let name = $state('');
	let busy = $state(false);

	const kinds = $derived(['tout', ...new Set(data.assets.map((a) => a.kind))]);
	const shown = $derived(filter === 'tout' ? data.assets : data.assets.filter((a) => a.kind === filter));
	const kb = (n: number) => (n > 1e6 ? t('{n} MB', { n: (n / 1e6).toFixed(1) }) : t('{n} KB', { n: Math.round(n / 1e3) }));

	async function generate() {
		if (!prompt.trim()) return;
		busy = true;
		try {
			await api.job({ kind: 'asset_generate', projectId: data.project.id, prompt, name: name || 'image' });
			prompt = '';
			invalidateAll();
		} finally {
			busy = false;
		}
	}
</script>

<div class="wrap">
	<header class="row"><div class="col" style="gap: 2px"><a class="crumb" href="/p/{data.project.id}">{data.project.name}</a><h1>{t('Library')}</h1></div></header>

	<div class="two">
		<form class="panel pad col" method="POST" action="?/upload" enctype="multipart/form-data" use:enhance>
			<h2><Upload size={15} /> {t('Add files')}</h2>
			<p class="dim small" style="margin: 0">{@html t('Images, SVG, HTML, sounds, videos, fonts. Agents find them in <code>library/</code>.')}</p>
			<input type="file" name="files" multiple />
			<label><span>{t('Tags')}</span><input name="tags" placeholder={t('ui, icon, music…')} /></label>
			{#if form?.error}<p class="small" style="color: var(--err)">{form.error}</p>{/if}
			<div><button class="primary">{t('Upload')}</button></div>
		</form>
		<div class="panel pad col">
			<h2><Sparkles size={15} /> {t('Generate an image (Codex)')}</h2>
			<textarea bind:value={prompt} rows="4" placeholder={t('Describe the image: subject, style, palette (hex), framing, what to avoid…')}></textarea>
			<div class="row"><input bind:value={name} placeholder={t('file name')} style="max-width: 220px" /><span class="spacer"></span><button class="primary" disabled={busy || !prompt.trim()} onclick={generate}>{t('Generate (~30 s)')}</button></div>
			<RunList runs={data.runs} project={data.project.id} compact />
		</div>
	</div>

	<div class="row fwrap">
		{#each kinds as k (k)}<button class="small" class:primary={filter === k} onclick={() => (filter = k)}>{k === 'tout' ? t('all') : k}</button>{/each}
	</div>

	<div class="grid-assets">
		{#each shown as a (a.id)}
			<div class="panel asset">
				<a class="preview" href={a.url} target="_blank">
					{#if a.kind === 'image' || a.kind === 'svg'}<img src={a.url} alt={a.name} loading="lazy" />
					{:else if a.kind === 'video'}<video src={a.url} muted preload="metadata"></video>
					{:else if a.kind === 'audio'}<Music size={28} />
					{:else if a.kind === 'font'}<Type size={28} />
					{:else}<FileCode2 size={28} />{/if}
				</a>
				<div class="meta col">
					<div class="row"><span class="nm" title={a.name}>{a.name}</span><span class="spacer"></span>
						<form method="POST" action="?/remove" use:enhance><input type="hidden" name="id" value={a.id} /><button class="ghost small" title={t('Delete')} onclick={(e) => !confirm(t('Delete {name}?', { name: a.name })) && e.preventDefault()}><Trash2 size={13} /></button></form>
					</div>
					<div class="row small faint"><span class="chip">{a.kind}</span>{#if a.source === 'codex'}<span class="chip agent">codex</span>{/if}<span>{kb(a.size)}</span></div>
					<code class="small faint">library/{a.name}</code>
					{#if a.meta?.prompt}<p class="small faint" style="margin: 0">{String(a.meta.prompt).slice(0, 140)}</p>{/if}
				</div>
			</div>
		{:else}
			<div class="empty">{t('Library is empty.')}</div>
		{/each}
	</div>
</div>

<style>
	.wrap { padding: 32px 36px 56px; display: grid; gap: 18px; max-width: 1400px; }
	.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
	h2 { display: flex; gap: 6px; align-items: center; }
	.grid-assets { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
	.asset { overflow: hidden; display: grid; grid-template-rows: 150px auto; }
	.preview { display: grid; place-items: center; background: #f9fafc; color: var(--faint); overflow: hidden; }
	.preview img, .preview video { width: 100%; height: 150px; object-fit: contain; }
	.meta { padding: 8px 10px; gap: 4px; }
	.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
	form { display: contents; }
	.two form { display: grid; }
</style>
