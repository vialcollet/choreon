<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import { useI18n } from '$lib/i18n';
	import { Check, X, Archive, Trash2, Plus, Undo2 } from '@lucide/svelte';
	import type { Lesson } from '$lib/types';

	const { t } = useI18n();
	let { data } = $props();

	let status = $state<'proposed' | 'active' | 'retired' | 'all'>('proposed');
	let scope = $state<'all' | 'harness' | string>('all');
	let editing = $state<string | null>(null);
	let draft = $state('');
	let newRule = $state('');
	// svelte-ignore state_referenced_locally -- default of an add form, no route parameter: seeded once on purpose
	let newScope = $state(data.canEditHarness ? 'harness' : (data.projects[0]?.id ?? ''));
	/** The harness is shared by all tenants: only the studio admin edits it. */
	const editable = (l: Lesson) => l.scope !== 'harness' || data.canEditHarness;

	const pname = (id: string | null) => data.projects.find((p) => p.id === id)?.name ?? id;
	const shown = $derived(
		data.lessons
			.filter((l) => status === 'all' || l.status === status)
			.filter((l) => scope === 'all' || (scope === 'harness' ? l.scope === 'harness' : l.scope === 'project' && l.projectId === scope))
			.sort((a, b) => b.createdAt - a.createdAt)
	);
	const count = (s: string) => data.lessons.filter((l) => l.status === s).length;

	async function patch(l: Lesson, p: Record<string, unknown>) {
		await api.lesson('PATCH', { id: l.id, ...p });
		editing = null;
		invalidateAll();
	}
	async function remove(l: Lesson) {
		if (!confirm(t('Permanently delete L{num}?', { num: l.num }))) return;
		await api.lesson('DELETE', { id: l.id });
		invalidateAll();
	}
	async function add() {
		if (!newRule.trim()) return;
		await api.lesson('POST', { rule: newRule, scope: newScope === 'harness' ? 'harness' : 'project', projectId: newScope === 'harness' ? null : newScope });
		newRule = '';
		invalidateAll();
	}
</script>

<div class="wrapper">
	<header class="col" style="gap: 4px">
		<h1>{t('Lessons')}</h1>
		<p class="dim small" style="margin: 0">
			{t('The studio’s memory. A lesson comes from a note (Jev flags it as “project identity” or “harness know-how”) or from recurring flaws spotted by the critic; the Memory agent generalizes it into a rule.')} {t('Once')} <b>{t('active')}</b>{t(', it is recalled to every agent and checked by the critic.')}
		</p>
	</header>

	<div class="row fwrap">
		{#each [['proposed', 'To review'], ['active', 'Active'], ['retired', 'Retired'], ['all', 'All']] as [k, label] (k)}
			<button class="small" class:primary={status === k} onclick={() => (status = k as typeof status)}>{t(label)}{k !== 'all' ? ` (${count(k)})` : ''}</button>
		{/each}
		<span class="spacer"></span>
		<select bind:value={scope} style="width: auto">
			<option value="all">{t('All levels')}</option>
			<option value="harness">{t('Studio (harness)')}</option>
			{#each data.projects as p (p.id)}<option value={p.id}>{t('Project: {name}', { name: p.name })}</option>{/each}
		</select>
	</div>

	<div class="list">
		{#each shown as l (l.id)}
			<article class="panel lesson" class:proposed={l.status === 'proposed'} class:retired={l.status === 'retired'}>
				<div class="row fwrap" style="gap: 6px">
					<span class="mono num">L{l.num}</span>
					<span class="chip" class:agent={l.scope === 'harness'}>{l.scope === 'harness' ? t('studio') : t('project · {name}', { name: pname(l.projectId) })}</span>
					{#if l.status === 'proposed'}<span class="chip amber">{t('to review')}</span>{:else if l.status === 'retired'}<span class="chip">{t('retired')}</span>{/if}
					<span class="faint small">{t('recalled {uses}× · violated {violations}×', { uses: l.uses, violations: l.violations })}</span>
					<span class="spacer"></span>
					{#if !editable(l)}
						<span class="faint small">{t('shared across the studio')}</span>
					{:else}
					{#if l.status === 'proposed'}
						<button class="small primary" onclick={() => patch(l, { status: 'active' })}><Check size={13} /> {t('Approve')}</button>
						<button class="small" onclick={() => patch(l, { status: 'retired' })}><X size={13} /> {t('Dismiss')}</button>
					{:else if l.status === 'active'}
						<button class="small ghost" onclick={() => patch(l, { status: 'retired' })} title={t('Retire')}><Archive size={13} /></button>
					{:else}
						<button class="small ghost" onclick={() => patch(l, { status: 'active' })} title={t('Reactivate')}><Undo2 size={13} /></button>
					{/if}
					<select class="small" style="width: auto" value={l.scope === 'harness' ? 'harness' : l.projectId} onchange={(e) => { const v = (e.target as HTMLSelectElement).value; patch(l, v === 'harness' ? { scope: 'harness' } : { scope: 'project', projectId: v }); }} title={t('Change level')}>
						{#if data.canEditHarness}<option value="harness">{t('studio')}</option>{/if}
						{#each data.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</select>
					<button class="small ghost" onclick={() => remove(l)} title={t('Delete')}><Trash2 size={13} /></button>
					{/if}
				</div>
				{#if editing === l.id}
					<textarea bind:value={draft} rows="2"></textarea>
					<div class="row"><button class="small primary" onclick={() => patch(l, { rule: draft })}>{t('Save')}</button><button class="small ghost" onclick={() => (editing = null)}>{t('Cancel')}</button></div>
				{:else if editable(l)}
					<button class="ghost rule" title={t('Click to rephrase')} onclick={() => { editing = l.id; draft = l.rule; }}>{l.rule}</button>
				{:else}
					<div class="rule">{l.rule}</div>
				{/if}
				{#if l.rationale}<p class="small dim" style="margin: 0">{t('Why: {reason}', { reason: l.rationale })}</p>{/if}
			</article>
		{:else}
			<div class="empty">{t('Nothing here yet.')}</div>
		{/each}
	</div>

	<div class="panel pad col">
		<h2>{t('Add a lesson manually')}</h2>
		<div class="row">
			<select bind:value={newScope} style="width: auto">
				{#if data.canEditHarness}<option value="harness">{t('studio')}</option>{/if}
				{#each data.projects as p (p.id)}<option value={p.id}>{t('project: {name}', { name: p.name })}</option>{/each}
			</select>
			<input bind:value={newRule} placeholder={t('A general, actionable rule, in one sentence…')} onkeydown={(e) => e.key === 'Enter' && add()} />
			<button class="primary" onclick={add}><Plus size={14} /> {t('Add')}</button>
		</div>
	</div>
</div>

<style>
	.wrapper { padding: 32px 36px 56px; display: grid; gap: 16px; max-width: 1100px; }
	.list { display: grid; gap: 10px; }
	.lesson { padding: 12px 14px; display: grid; gap: 6px; }
	.lesson.proposed { border-color: color-mix(in srgb, var(--amber) 45%, var(--line)); }
	.lesson.retired { opacity: 0.55; }
	.num { color: var(--dim); font-weight: 600; }
	.rule { text-align: left; border: 0; padding: 0; font-size: 15px; white-space: normal; background: transparent; }
</style>
