<script lang="ts">
	import { useI18n } from '$lib/i18n';
	import { Plus, ArrowRight } from '@lucide/svelte';

	let { data, form } = $props();
	const { t } = useI18n();
</script>

<div class="page">
	<header class="page-head">
		<div>
			<h1>{t('Projects')}</h1>
			<p class="lead">{t('A project holds an identity (brand guidelines, logo, fonts, motion rules), an asset library and its videos.')}</p>
		</div>
	</header>

	<div class="cards">
		{#each data.projects as p (p.id)}
			<a class="card" href="/p/{p.id}">
				<div class="cover" style="background: {p.plate}">
					{#if p.logoUrl}<img src={p.logoUrl} alt="" />{:else}<span class="initial">{p.name.slice(0, 1)}</span>{/if}
				</div>
				{#if p.colors.length}<div class="palette">{#each p.colors as c, i (i)}<span style="background: {c}"></span>{/each}</div>{/if}
				<div class="meta">
					<div class="row">
						<h2>{p.name}</h2>
						{#if p.shared}<span class="chip">{t('demo')}</span>{/if}
						<span class="spacer"></span>
						<ArrowRight size={15} class="go" />
					</div>
					{#if p.tagline}<span class="dim small tag">{p.tagline}</span>{/if}
					<span class="faint small">{p.videos > 1 ? t('{n} videos', { n: p.videos }) : t('{n} video', { n: p.videos })}</span>
				</div>
			</a>
		{/each}

		<form id="new-project" method="POST" action="?/create" class="card new">
			<div class="col">
				<h2 class="row"><Plus size={16} /> {t('New project')}</h2>
				<label><span>{t('Name')}</span><input name="name" required placeholder={t('e.g. Acme')} /></label>
				{#if form?.error}<p class="small" style="color: var(--err); margin: 0">{form.error}</p>{/if}
				<div><button class="primary">{t('Create')}</button></div>
			</div>
		</form>
	</div>
</div>

<style>
	.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 16px; }
	.card { display: grid; grid-template-rows: auto auto 1fr; background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; transition: border-color var(--fast) var(--ease), transform var(--fast) var(--ease), box-shadow var(--fast) var(--ease); }
	a.card:hover { border-color: var(--line-strong); transform: translateY(-2px); box-shadow: 0 14px 40px rgb(0 0 0 / 0.35); color: inherit; }
	.cover { aspect-ratio: 16 / 7; display: grid; place-items: center; padding: 22px 36px; }
	.cover img { max-height: 70%; max-width: 78%; object-fit: contain; }
	.initial { font-size: 44px; font-weight: 700; color: var(--faint); }
	.palette { display: flex; height: 5px; }
	.palette span { flex: 1; }
	.meta { display: grid; gap: 3px; padding: 14px 16px 16px; align-content: start; }
	.tag { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.card :global(.go) { color: var(--faint); transition: transform var(--fast) var(--ease), color var(--fast) var(--ease); }
	a.card:hover :global(.go) { color: var(--text); transform: translateX(3px); }
	.new { padding: 18px; border-style: dashed; background: transparent; align-content: center; }
	.new h2 { gap: 6px; margin-bottom: 4px; }
</style>
