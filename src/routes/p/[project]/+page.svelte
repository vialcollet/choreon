<script lang="ts">
	import RunList from '$lib/components/RunList.svelte';
	import { useI18n } from '$lib/i18n';
	import { Library, Settings2, Film, LayoutTemplate, Images, Plus, Play } from '@lucide/svelte';
	let { data, form } = $props();
	const { t } = useI18n();
	const fonts = $derived([...new Set(Object.values(data.brand.fonts).map((f) => f.family))]);
</script>

<div class="page">
	<section class="hero panel">
		<div class="plate" style="background: {data.brand.plate}">
			{#if data.brand.logoUrl}<img src={data.brand.logoUrl} alt={t('logo')} />{:else}<span class="initial">{data.project.name.slice(0, 1)}</span>{/if}
		</div>
		<div class="col info">
			<div class="row">
				<h1>{data.project.name}</h1>
				<span class="spacer"></span>
				<a class="btn small ghost" href="/p/{data.project.id}/references"><Film size={14} /> {t('References')}</a>
				<a class="btn small ghost" href="/p/{data.project.id}/library"><Library size={14} /> {t('Library')}</a>
				<a class="btn small ghost" href="/p/{data.project.id}/ui"><LayoutTemplate size={14} /> {t('Interface')}</a>
				<a class="btn small ghost" href="/p/{data.project.id}/stills"><Images size={14} /> {t('Stills')}</a>
				<a class="btn small" href="/p/{data.project.id}/settings"><Settings2 size={14} /> {t('Settings')}</a>
			</div>
			{#if data.brand.tagline}<p class="tagline">{data.brand.tagline}</p>{/if}
			<div class="swatches">
				{#each Object.entries(data.brand.colors) as [name, hex] (name)}
					<div class="sw" title="{name} {hex}"><div class="swatch" style="background: {hex}"></div><span>{name}</span></div>
				{/each}
			</div>
			<div class="small dim">
				{t('Fonts:')} {fonts.join(', ') || '—'} ·
				{t('Motion rules:')} <a href="/p/{data.project.id}/settings" class="link">{data.brand.hasMotion ? t('written') : t('to write')}</a>
			</div>
		</div>
	</section>

	<section class="grid">
		<div class="row"><h3>{t('Videos')}</h3><span class="spacer"></span><a class="btn small" href="#nouvelle-video"><Plus size={14} /> {t('New video')}</a></div>
		{#if data.videos.length}
			<div class="cards">
				{#each data.videos as v (v.id)}
					<a class="vcard" href="/p/{data.project.id}/v/{v.slug}">
						<div class="poster" style="aspect-ratio: {v.format.width} / {v.format.height}">
							{#if v.fullUrl}
								<video src="{v.fullUrl}#t={(v.targetDuration * (v.targetDuration <= 8 ? 0.85 : 0.45)).toFixed(2)}" muted preload="metadata" playsinline
									onmouseenter={(e) => { const el = e.currentTarget; el.currentTime = 0; el.play().catch(() => {}); }}
									onmouseleave={(e) => { const el = e.currentTarget; el.pause(); el.currentTime = v.targetDuration * (v.targetDuration <= 8 ? 0.85 : 0.45); }}></video>
								<span class="play"><Play size={14} /></span>
							{:else}<div class="ph">{v.storyboardVersion ? t('storyboard v{v}, {n} shots', { v: v.storyboardVersion, n: v.shots }) : t('no storyboard')}</div>{/if}
						</div>
						<div class="meta">
							<h2>{v.title}</h2>
							<span class="small faint mono">{v.format.width}×{v.format.height} · {v.targetDuration} s · {t('{n} render(s)', { n: v.renders })}</span>
						</div>
					</a>
				{/each}
			</div>
		{:else}
			<div class="empty">{t('No videos yet.')}</div>
		{/if}
	</section>

	<div class="two">
		<form id="nouvelle-video" method="POST" action="?/video" class="panel pad col">
			<h2>{t('New video')}</h2>
			<label><span>{t('Title')}</span><input name="title" required placeholder={t('Product demo — 30 s')} /></label>
			<label><span>{t('Brief')}</span><textarea name="brief" rows="7" placeholder={t('Audience, message, tone, desired flow, constraints…')}></textarea></label>
			<div class="row">
				<label><span>{t('Format')}</span><select name="format">{#each data.formats as f (f)}<option>{f}</option>{/each}</select></label>
				<label><span>{t('fps')}</span><select name="fps"><option>30</option><option>60</option><option>24</option><option>25</option></select></label>
				<label><span>{t('Target duration (s)')}</span><input name="duration" type="number" value="30" min="3" max="600" /></label>
			</div>
			{#if form?.error}<p class="small" style="color: var(--err)">{form.error}</p>{/if}
			<div><button class="primary">{t('Create video')}</button></div>
		</form>
		<div class="panel pad col">
			<h2>{t('Latest runs')}</h2>
			<RunList runs={data.runs} project={data.project.id} />
		</div>
	</div>
</div>

<style>
	.hero { display: grid; grid-template-columns: 300px minmax(0, 1fr); overflow: hidden; }
	.plate { display: grid; place-items: center; padding: 28px; min-height: 170px; }
	.plate img { max-width: 100%; max-height: 90px; object-fit: contain; }
	.initial { font-size: 54px; font-weight: 700; color: var(--faint); }
	.info { padding: 20px 22px; gap: 12px; align-content: center; }
	.info .row { flex-wrap: wrap; row-gap: 6px; }
	.tagline { margin: -4px 0 0; color: var(--dim); font-size: 14px; }
	.swatches { display: flex; flex-wrap: wrap; gap: 10px; }
	.sw { display: grid; justify-items: center; gap: 4px; width: 56px; }
	.sw span { font-size: 10px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; max-width: 56px; white-space: nowrap; }
	.link { text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
	.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; align-items: start; }
	.vcard { display: grid; background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; transition: border-color var(--fast) var(--ease), transform var(--fast) var(--ease), box-shadow var(--fast) var(--ease); }
	.vcard:hover { border-color: var(--line-strong); transform: translateY(-2px); box-shadow: 0 14px 40px rgb(0 0 0 / 0.35); color: inherit; }
	.poster { position: relative; background: var(--bg-deep); max-height: 320px; display: grid; place-items: center; overflow: hidden; }
	.poster video { width: 100%; height: 100%; object-fit: cover; }
	.ph { color: var(--faint); font-size: 12px; }
	.play { position: absolute; right: 10px; bottom: 10px; width: 28px; height: 28px; border-radius: 99px; display: grid; place-items: center; background: rgb(0 0 0 / 0.55); backdrop-filter: blur(6px); color: #fff; opacity: 0; transition: opacity var(--fast) var(--ease); }
	.vcard:hover .play { opacity: 1; }
	.meta { display: grid; gap: 3px; padding: 12px 14px 14px; }
	.two { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; align-items: start; }
	@media (max-width: 1000px) { .hero { grid-template-columns: 1fr; } .two { grid-template-columns: 1fr; } }
</style>
