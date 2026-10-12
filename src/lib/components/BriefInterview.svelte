<script lang="ts">
	import { enhance } from '$app/forms';
	import type { BriefAxis, BriefState } from '$lib/types';
	import { useI18n } from '$lib/i18n';
	import { RefreshCw, Send, Pencil, Check, X, EyeOff, Sparkles } from '@lucide/svelte';

	const { t } = useI18n();
	type VRef = { id: string; title: string; company: string; poster: string | null; analyzed: boolean; borrow: string };
	let {
		brief: bs,
		axes,
		reviewing,
		refs = [],
		scouting = false,
		refsHref = ''
	}: { brief: BriefState; axes: BriefAxis[]; reviewing: boolean; refs?: VRef[]; scouting?: boolean; refsHref?: string } = $props();

	const closed = $derived(axes.filter((a) => bs.decisions[a.key] || bs.ignored.includes(a.key)).length);
	const labelOf = (k: string) => axes.find((a) => a.key === k)?.label ?? k;
	const stuck = $derived(bs.status === 'reviewing' && !reviewing);
	let editing = $state<string | null>(null);
	let draft = $state('');
	/** Choice per question: 'discretion' | 'ignore' | '' */
	let mode = $state<Record<string, string>>({});

	function edit(a: BriefAxis) {
		editing = a.key;
		draft = bs.decisions[a.key] ?? '';
	}
	const done = () => async ({ update }: { update: () => Promise<void> }) => {
		editing = null;
		await update();
	};
</script>

<section class="panel pad col brief">
	<div class="row fwrap">
		<h3>{t('Framing')}</h3>
		{#if reviewing}<span class="chip"><span class="dot running"></span> {t('the director is analysing the brief…')}</span>
		{:else if bs.status === 'ready'}<span class="chip ok">{t('ready: the storyboard can start')}</span>
		{:else if stuck}<span class="chip amber">{t('analysis interrupted')}</span>
		{:else if bs.questions.length}<span class="chip amber">{bs.questions.length > 1 ? t('interview: {n} questions', { n: bs.questions.length }) : t('interview: {n} question', { n: bs.questions.length })}</span>
		{:else}<span class="chip">{t('to frame')}</span>{/if}
		<span class="dim small">{t('{n}/{total} axes settled', { n: closed, total: axes.length })}</span>
		<span class="spacer"></span>
		<form method="POST" action="?/review" use:enhance><button class="ghost" disabled={reviewing}><RefreshCw size={14} /> {bs.reviewedAt ? t('Re-run analysis') : t('Analyse brief')}</button></form>
	</div>
	<div class="progress"><div style="width: {(closed / axes.length) * 100}%"></div></div>
	{#if bs.summary}<p class="summary">{bs.summary}</p>{/if}

	{#if bs.questions.length && !reviewing}
		<form class="col" method="POST" action="?/answers" use:enhance>
			{#each bs.questions as q (q.field)}
				<div class="q">
					<div class="row"><span class="chip">{labelOf(q.field)}</span><b>{q.question}</b></div>
					{#if q.why}<div class="dim small">{q.why}</div>{/if}
					<fieldset disabled={!!mode[q.field]}>
						{#each q.options ?? [] as o, i (i)}
							<label class="opt"><input type="radio" name="o_{q.field}" value={o} /> <span>{o}</span></label>
						{/each}
						<input name="t_{q.field}" placeholder={t('Another direction, or a detail…')} />
					</fieldset>
					<div class="row fwrap small">
						{#if q.default}<label class="opt dim"><input type="checkbox" name="d_{q.field}" checked={mode[q.field] === 'discretion'} onchange={(e) => (mode[q.field] = e.currentTarget.checked ? 'discretion' : '')} /> <span>{t('Up to you:')} <i>{q.default}</i></span></label>{/if}
						<span class="spacer"></span>
						<label class="opt dim"><input type="checkbox" name="i_{q.field}" checked={mode[q.field] === 'ignore'} onchange={(e) => (mode[q.field] = e.currentTarget.checked ? 'ignore' : '')} /> <span>{t('Ignore this axis')}</span></label>
					</div>
				</div>
			{/each}
			<div class="row"><span class="dim small">{t('Unanswered questions stay open; the director re-analyses after you submit.')}</span><span class="spacer"></span><button class="primary"><Send size={14} /> {t('Submit answers')}</button></div>
		</form>
	{/if}

	<details open={bs.status !== 'ready'}>
		<summary class="dim small">{t('Axes ({n}/{total})', { n: closed, total: axes.length })}</summary>
		<div class="axes">
			{#each axes as a (a.key)}
				{@const ign = bs.ignored.includes(a.key)}
				<div class="axis" class:open={!bs.decisions[a.key] && !ign}>
					<div class="k" title={a.hint}>{a.label}</div>
					{#if editing === a.key}
						<form class="col" method="POST" action="?/decision" use:enhance={done}>
							<input type="hidden" name="field" value={a.key} />
							<div class="sugg">{#each a.suggestions as s, i (i)}<button type="button" class="ghost chipbtn" class:on={draft === s} onclick={() => (draft = s)}>{s}</button>{/each}</div>
							<textarea name="value" rows="2" placeholder={a.hint} bind:value={draft}></textarea>
							<div class="row">
								<button><Check size={14} /> {t('Settle')}</button>
								<button name="ignore" value="1" class="ghost"><EyeOff size={14} /> {t('Ignore')}</button>
								<span class="spacer"></span>
								<button type="button" class="ghost" onclick={() => (editing = null)}><X size={14} /></button>
							</div>
						</form>
					{:else}
						<div class="v">
							{#if bs.decisions[a.key]}{bs.decisions[a.key]}
							{:else if ign}<span class="chip">{t('ignored')}</span>
							{:else}<span class="faint">{t('to settle')} — {a.hint}</span>{/if}
						</div>
						<button class="ghost icon" title={t('Edit')} onclick={() => edit(a)}><Pencil size={13} /></button>
					{/if}
					{#if a.key === 'references'}
						<!-- Influences: references attached to this video (joined to the storyboard and shots). -->
						<div class="refs">
							{#each refs as r (r.id)}
								<a class="ref" href={refsHref} title={r.borrow || r.title}>
									{#if r.poster}<img src={r.poster} alt="" />{:else}<div class="noposter"></div>{/if}
									<span class="small">{r.title}</span>
									<span class="faint small">{r.company}{r.analyzed ? '' : ` · ${t('analysis pending')}`}</span>
								</a>
							{/each}
							<div class="refacts">
								<form method="POST" action="?/scout" use:enhance><button class="small" disabled={scouting}><Sparkles size={13} /> {scouting ? t('Shortlisting…') : t('Shortlist for this video')}</button></form>
								<a class="small dim" href={refsHref} style="text-decoration: underline">{t('Choose from the References page')}</a>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</details>
</section>

<style>
	.brief h3 { margin: 0; }
	.brief > .row form { display: contents; }
	.progress { height: 3px; background: var(--line-soft); border-radius: 2px; overflow: hidden; }
	.progress div { height: 100%; background: var(--agent); }
	.summary { margin: 0; font-size: 14px; }
	.q { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid var(--line-soft); border-radius: 8px; }
	.q b { font-weight: 600; font-size: 13.5px; }
	fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 4px; }
	fieldset:disabled { opacity: 0.4; }
	.opt { display: flex; gap: 8px; align-items: baseline; font-size: 13px; cursor: pointer; }
	.opt input { width: auto; }
	.axes { display: grid; margin-top: 6px; }
	.axis { display: grid; grid-template-columns: 170px 1fr auto; gap: 10px; align-items: start; padding: 6px 0; border-top: 1px solid var(--line-soft); font-size: 13px; }
	.axis form { grid-column: 2 / 4; }
	.axis .k { color: var(--dim); }
	.axis.open .k { color: var(--amber); }
	.sugg { display: flex; flex-wrap: wrap; gap: 4px; }
	.chipbtn { font-size: 12px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 99px; }
	.chipbtn.on { border-color: var(--agent); color: var(--agent); }
	.icon { padding: 2px 6px; }
	.refs { grid-column: 2 / 4; display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
	.ref { display: grid; gap: 2px; width: 150px; }
	.ref img, .noposter { width: 150px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); background: var(--bg-deep); }
	.ref span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.refacts { display: grid; gap: 6px; align-content: start; }
	.refacts form { display: contents; }
</style>
