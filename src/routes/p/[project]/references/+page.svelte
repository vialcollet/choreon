<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import RunList from '$lib/components/RunList.svelte';
	import { useI18n } from '$lib/i18n';
	import { Search, Sparkles, Upload, ScanEye, Trash2, Ban, ExternalLink, Plus } from '@lucide/svelte';

	let { data } = $props();
	const { t } = useI18n();
	// The search box and the category follow the URL (back/forward, palette). Primitive deriveds, so a refresh that
	// brings the same values (live runs) does not reset what is being typed.
	const urlQ = $derived(data.q);
	const urlCat = $derived(data.cat);
	let q = $state(untrack(() => urlQ));
	let cat = $state(untrack(() => urlCat));
	$effect.pre(() => {
		q = urlQ;
	});
	$effect.pre(() => {
		cat = urlCat;
	});
	let open = $state<string | null>(null);
	let filter = $state<'active' | 'all'>('active');

	const search = () => goto(`?q=${encodeURIComponent(q)}&cat=${encodeURIComponent(cat)}`, { keepFocus: true, noScroll: true });
	const shown = $derived(data.refs.filter((r) => filter === 'all' || r.status !== 'rejected'));
	const busy = (id: string) => data.runs.some((r) => (r.status === 'running' || r.status === 'queued') && (r.input as { refId?: string }).refId === id);
	const STATUS: Record<string, string> = { candidate: 'to analyze', analyzing: 'analyzing…', analyzed: 'analyzed', rejected: 'set aside' };
	// Fixed "why" values stored for manual additions and uploads (the French ones are legacy rows), shown through t().
	const WHY: Record<string, string> = { 'Added manually': 'Added manually', Imported: 'Imported', 'ajoutée à la main': 'Added manually', importée: 'Imported' };
</script>

<div class="wrapper">
	<header class="col" style="gap: 4px">
		<div class="col" style="gap: 2px"><a class="crumb" href="/p/{data.project.id}">{data.project.name}</a><h1>{t('References')}</h1></div>
		<p class="dim small" style="margin: 0">{@html t('Films whose <b>grammar</b> we borrow (rhythm, transitions, kinetic typography, how the UI is shown), never their content. An analyzed reference carries a style guide; attached to a video, it is passed to the director and the animator.')}</p>
	</header>

	<div class="two">
		<form class="panel pad col" method="POST" action="?/scout" use:enhance>
			<h2><Sparkles size={15} /> {t('Automatic shortlist')}</h2>
			<p class="dim small" style="margin: 0">{@html t('The director browses the <a href="https://whatships.com" target="_blank" style="text-decoration: underline">What Ships</a> catalog ({n} launch videos), shortlists from the text, picks from the posters, then analyzes the selected ones.', { n: data.total })}</p>
			<textarea name="brief" rows="2" placeholder={t('Specific intent (optional): e.g. very smooth UI transitions, understated kinetic typography…')}></textarea>
			<div class="row"><label style="width: 120px"><span>{t('Count')}</span><input name="count" type="number" value="6" min="3" max="10" /></label><span class="spacer"></span><button class="primary">{t('Start shortlist')}</button></div>
		</form>
		<form class="panel pad col" method="POST" action="?/upload" enctype="multipart/form-data" use:enhance>
			<h2><Upload size={15} /> {t('Import a video')}</h2>
			<p class="dim small" style="margin: 0">{t('A competitor film, a showreel, an ad: local MP4, analyzed right away.')}</p>
			<input type="file" name="file" accept="video/mp4,video/*" />
			<div class="row"><input name="title" placeholder={t('Title')} /><input name="company" placeholder={t('Author / brand')} /></div>
			<div><button>{t('Import and analyze')}</button></div>
		</form>
	</div>

	{#if data.runs.length}<div class="panel pad"><RunList runs={data.runs.slice(0, 8)} project={data.project.id} compact /></div>{/if}

	<section class="col">
		<div class="row"><h3>{t('Project references ({n})', { n: shown.length })}</h3><span class="spacer"></span>
			<button class="small" class:primary={filter === 'active'} onclick={() => (filter = 'active')}>{t('kept')}</button>
			<button class="small" class:primary={filter === 'all'} onclick={() => (filter = 'all')}>{t('all')}</button>
		</div>
		{#each shown as r (r.id)}
			<article class="panel ref" class:rejected={r.status === 'rejected'}>
				<div class="head">
					<button class="ghost poster" onclick={() => (open = open === r.id ? null : r.id)}>
						{#if r.poster}<img src={r.poster} alt="" loading="lazy" />{:else if r.analysis.keys?.[0]?.url}<img src={r.analysis.keys[0].url} alt="" />{:else}<div class="noposter"></div>{/if}
					</button>
					<div class="col" style="gap: 4px; min-width: 0">
						<div class="row fwrap" style="gap: 6px">
							<b>{r.title}</b><span class="dim small">{r.company} · {r.category}</span>
							<span class="chip" class:ok={r.status === 'analyzed'} class:agent={r.status === 'analyzing' || busy(r.id)}>{busy(r.id) ? t('analyzing…') : t(STATUS[r.status])}</span>
							{#if r.relevance.score}<span class="chip">{t('relevance {n}/10', { n: r.relevance.score })}</span>{/if}
						</div>
						{#if r.relevance.why}<div class="small">{WHY[r.relevance.why] ? t(WHY[r.relevance.why]) : r.relevance.why}</div>{/if}
						{#if r.relevance.borrow}<div class="small" style="color: var(--ok)">{t('To borrow:')} {r.relevance.borrow}</div>{/if}
						{#if r.analysis.stats}<div class="small faint">{t('{n} shots · average shot {s} s · {c} cuts/min', { n: r.analysis.stats.count, s: r.analysis.stats.mean, c: r.analysis.stats.cutsPerMinute })}</div>{/if}
						{#if r.analysis.motion?.summary}<div class="small faint">{t('{n} moves · median {s} s · {p}% of time in motion', { n: r.analysis.motion.summary.moves, s: r.analysis.motion.summary.medianMove, p: Math.round((r.analysis.motion.summary.motionShare ?? 0) * 100) })} · {Object.entries(r.analysis.motion.summary.easing ?? {}).map(([k, v]) => `${k} ×${v}`).join(', ')}{r.analysis.motion.summary.overshoots ? ` · ${t('{n} overshoot(s)', { n: r.analysis.motion.summary.overshoots })}` : ''}</div>{/if}
						{#if r.analysis.palette}<div class="row" style="gap: 2px">{#each r.analysis.palette as c (c)}<span class="sw" style="background: {c}" title={c}></span>{/each}</div>{/if}
						<div class="row fwrap" style="gap: 4px">
							{#each data.videos as v (v.id)}
								{@const on = r.videos.includes(v.id)}
								<form method="POST" action="?/attach" use:enhance><input type="hidden" name="id" value={r.id} /><input type="hidden" name="video" value={v.id} /><input type="hidden" name="on" value={on ? '0' : '1'} /><button class="small" class:primary={on} title={on ? t('Detach from this video') : t('Attach to this video')}>{on ? '✓ ' : '+ '}{v.title}</button></form>
							{/each}
						</div>
					</div>
					<div class="acts">
						<form method="POST" action="?/analyze" use:enhance><input type="hidden" name="id" value={r.id} /><button class="small" disabled={busy(r.id)} title={t('Analyze (or re-analyze)')}><ScanEye size={13} /></button></form>
						<form method="POST" action="?/reject" use:enhance><input type="hidden" name="id" value={r.id} /><button class="small ghost" title={r.status === 'rejected' ? t('Restore') : t('Set aside')}><Ban size={13} /></button></form>
						{#if r.pageUrl}<a class="btn small ghost" href={r.xUrl ?? r.pageUrl} target="_blank" title={t('View original')}><ExternalLink size={13} /></a>{/if}
						<form method="POST" action="?/remove" use:enhance><input type="hidden" name="id" value={r.id} /><button class="small ghost" title={t('Delete')} onclick={(e) => !confirm(t('Delete this reference?')) && e.preventDefault()}><Trash2 size={13} /></button></form>
					</div>
				</div>
				{#if open === r.id}
					<div class="detail">
						{#if r.analysis.fileUrl}<video src={r.analysis.fileUrl} controls muted preload="metadata"></video>{/if}
						{#if r.styleGuide}<Markdown text={r.styleGuide} />{:else}<p class="faint small">{t('No style guide yet: run the analysis.')}</p>{/if}
						{#if r.analysis.motion?.chartUrl}<img class="sheet" src={r.analysis.motion.chartUrl} alt={t('motion curve')} title={t('Motion energy: moves in green, overshoots in amber, cuts in red')} />{/if}
						{#each r.analysis.motion?.strips ?? [] as st (st.file)}<img class="sheet" src={st.url} alt={t('move {n}', { n: st.move })} title="{t('Move {n}', { n: st.move })} · {st.easing}{st.overshoot ? ` · ${t('overshoot')}` : ''} {t('(consecutive frames)')}" />{/each}
						{#each r.analysis.sheets ?? [] as s (s.file)}<img class="sheet" src={s.url} alt={t('sheet {from}–{to} s', { from: s.from, to: s.to })} title="{s.from}–{s.to} s" />{/each}
					</div>
				{/if}
			</article>
		{:else}
			<div class="empty">{t('No references. Start the shortlist or search What Ships below.')}</div>
		{/each}
	</section>

	<section class="panel pad col">
		<h2><Search size={15} /> {t('Search What Ships')}</h2>
		<div class="row">
			<input bind:value={q} placeholder={t('keywords: onboarding, dashboard, ai agent, kinetic…')} onkeydown={(e) => e.key === 'Enter' && search()} />
			<select bind:value={cat} style="width: auto"><option value="">{t('all categories')}</option>{#each data.categories as c (c)}<option>{c}</option>{/each}</select>
			<button class="primary" onclick={search}>{t('Search')}</button>
		</div>
		{#if data.wsError}<p class="small" style="color: var(--err)">{data.wsError}</p>{/if}
		<div class="results">
			{#each data.results as x (x.slug)}
				<div class="res">
					<a href={x.href} target="_blank"><img src={x.poster} alt="" loading="lazy" /></a>
					<div class="small"><b>{x.name}</b></div>
					<div class="row small faint"><span>{x.company} · {x.category}</span><span class="spacer"></span>
						{#if data.added.includes(x.slug)}<span class="chip ok">{t('added')}</span>{:else}
							<form method="POST" action="?/add" use:enhance><input type="hidden" name="slug" value={x.slug} /><input type="hidden" name="analyze" value="1" /><button class="small"><Plus size={12} /> {t('Add')}</button></form>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>
</div>

<style>
	.wrapper { padding: 32px 36px 56px; display: grid; gap: 16px; max-width: 1300px; }
	.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
	h2 { display: flex; gap: 6px; align-items: center; }
	form { display: contents; }
	.two form { display: grid; }
	.ref { padding: 10px; display: grid; gap: 10px; }
	.ref.rejected { opacity: 0.5; }
	.head { display: grid; grid-template-columns: 240px 1fr auto; gap: 12px; align-items: start; }
	.poster { padding: 0; border: 0; width: 240px; }
	.poster img, .noposter { width: 240px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 4px; background: var(--bg-deep); }
	.acts { display: grid; gap: 4px; }
	.sw { width: 16px; height: 16px; border-radius: 3px; border: 1px solid var(--line); }
	.detail { display: grid; gap: 10px; border-top: 1px solid var(--line-soft); padding-top: 10px; }
	.detail video { max-width: 640px; border-radius: 4px; }
	.sheet { border-radius: 4px; border: 1px solid var(--line); }
	.results { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
	.res { display: grid; gap: 4px; }
	.res img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 4px; background: var(--bg-deep); }
</style>
