<script lang="ts">
	import { enhance } from '$app/forms';
	import { Plus, Trash2 } from '@lucide/svelte';
	import type { EvalConfig, ModelChoice, Role } from '$lib/types';
	import ModelTable from '$lib/components/ModelTable.svelte';
	import { useI18n } from '$lib/i18n';

	let { data, form } = $props();
	const { t } = useI18n();
	// svelte-ignore state_referenced_locally -- draft seeded once; p/[project]/+layout.svelte re-creates the page per project and batch
	let language = $state<'en' | 'fr'>(data.language);
	// svelte-ignore state_referenced_locally -- draft seeded once
	let cfg = $state<EvalConfig>(structuredClone(data.evalConfig));
	// svelte-ignore state_referenced_locally -- draft seeded once
	let models = $state<Partial<Record<Role, ModelChoice>>>(structuredClone(data.models));
	const add = () => cfg.axes.push({ key: `axe${cfg.axes.length + 1}`, label: t('New axis'), description: '', weight: 1, threshold: 7, required: false });
</script>

<div class="wrap">
	<div class="col" style="gap: 2px"><a class="crumb" href="/p/{data.project.id}">{data.project.name}</a><h1>{t('Settings')}</h1></div>

	<form class="panel pad col" method="POST" action="?/eval" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<div class="row"><h2>{t('Evaluation loop')}</h2><span class="spacer"></span>{#if form?.saved === 'eval'}<span class="chip ok">{t('saved')}</span>{/if}</div>
		<p class="dim small" style="margin: 0">{@html t('After each shot render, the critic looks at the contact sheet, a filmstrip and the phone preview, then scores each axis from 1 to 10. If a <b>required</b> axis is below its threshold, an automatic fix is run, up to the maximum number of rounds; after that it is up to you.')}</p>
		<table>
			<thead><tr><th>{t('Key')}</th><th>{t('Label')}</th><th>{t('What the critic checks')}</th><th>{t('Weight')}</th><th>{t('Threshold')}</th><th>{t('Required')}</th><th></th></tr></thead>
			<tbody>
				{#each cfg.axes as a, i (i)}
					<tr>
						<td><input bind:value={a.key} class="mono" /></td>
						<td><input bind:value={a.label} /></td>
						<td><textarea bind:value={a.description} rows="3"></textarea></td>
						<td><input type="number" min="0" max="5" step="0.5" bind:value={a.weight} /></td>
						<td><input type="number" min="1" max="10" bind:value={a.threshold} /></td>
						<td style="text-align: center"><input type="checkbox" bind:checked={a.required} style="width: auto" /></td>
						<td><button type="button" class="ghost small" onclick={() => cfg.axes.splice(i, 1)}><Trash2 size={13} /></button></td>
					</tr>
				{/each}
			</tbody>
		</table>
		<div><button type="button" onclick={add}><Plus size={14} /> {t('Add an axis')}</button></div>
		<div class="row fwrap" style="gap: 16px">
			<label style="width: 180px"><span>{t('Max automatic rounds')}</span><input type="number" min="1" max="8" bind:value={cfg.maxRounds} /></label>
			<label style="width: 180px"><span>{t('Contact sheet frames/s')}</span><input type="number" min="1" max="12" bind:value={cfg.contactFps} /></label>
		</div>
		<input type="hidden" name="config" value={JSON.stringify(cfg)} />
		{#if form?.error}<p class="small" style="color: var(--err)">{form.error}</p>{/if}
		<div><button class="primary">{t('Save grid')}</button></div>
	</form>

	<form class="panel pad col" method="POST" action="?/models" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<div class="row"><h2>{t('Models for this project')}</h2><span class="spacer"></span>{#if form?.saved === 'models'}<span class="chip ok">{t('saved')}</span>{/if}</div>
		<p class="dim small" style="margin: 0">{@html t('“Studio default” follows the <a href="/settings" style="text-decoration: underline">studio settings</a>. The “main” one is the animator; reviews are done by the critic.')}</p>
		<ModelTable bind:value={models} fallback={data.studioModels} />
		<input type="hidden" name="models" value={JSON.stringify(models)} />
		<div><button class="primary">{t('Save models')}</button></div>
	</form>

	<form class="panel pad col" method="POST" action="?/language" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<div class="row"><h2>{t('Content language')}</h2><span class="spacer"></span>{#if form?.saved === 'language'}<span class="chip ok">{t('saved')}</span>{/if}</div>
		<p class="dim small" style="margin: 0">{t('Language of the storyboards, critiques and briefs the agents write.')}</p>
		<label style="width: 220px"><span>{t('Content language')}</span>
			<select name="language" bind:value={language}><option value="en">English</option><option value="fr">Français</option></select>
		</label>
		<div><button class="primary">{t('Save')}</button></div>
	</form>

	<form class="panel pad col" method="POST" action="?/motion" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<div class="row"><h2>{t('Motion rules (brand/motion.md)')}</h2><span class="spacer"></span>{#if form?.saved === 'motion'}<span class="chip ok">{t('saved')}</span>{/if}</div>
		<p class="dim small" style="margin: 0">{t('Read by every agent before working. This is where the brand guidelines become motion.')}</p>
		<textarea name="motion" rows="24" class="mono">{data.motion}</textarea>
		<div><button class="primary">{t('Save')}</button></div>
	</form>

	<details class="panel pad">
		<summary class="dim">{t('brand.json (identity read by the engine)')}</summary>
		<pre class="mono small">{data.brandJson}</pre>
	</details>
</div>

<style>
	.wrap { padding: 32px 36px 56px; display: grid; gap: 18px; max-width: 1200px; }
	table { width: 100%; border-collapse: collapse; }
	th { text-align: left; font-weight: 500; color: var(--dim); font-size: 12px; padding: 4px; }
	td { padding: 4px; vertical-align: top; }
	td:nth-child(1) { width: 140px; }
	td:nth-child(1) input { font-size: 12px; }
	td:nth-child(6) { width: 70px; vertical-align: middle; }
	td:nth-child(7) { width: 40px; }
	tr + tr td { border-top: 1px solid var(--line-soft); padding-top: 8px; }
	td:nth-child(2) { width: 170px; }
	td:nth-child(4), td:nth-child(5) { width: 70px; }
	pre { white-space: pre-wrap; max-height: 400px; overflow: auto; }
</style>
