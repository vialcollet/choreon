<script lang="ts">
	import { enhance } from '$app/forms';
	import ModelTable from '$lib/components/ModelTable.svelte';
	import { useI18n } from '$lib/i18n';
	import { DICTATION_MODELS, type StudioSettings } from '$lib/types';

	const { t } = useI18n();
	let { data, form } = $props();
	// svelte-ignore state_referenced_locally -- draft seeded once, no route parameter; invalidations must not reset edits
	let s = $state<StudioSettings>(structuredClone(data.studio));
	const slug = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
	const addAxis = () => s.briefAxes.push({ key: '', label: '', hint: '', suggestions: [] });
</script>

<div class="wrapper">
	<h1>{t('Studio settings')}</h1>

	<section class="panel pad col">
		<div class="row"><h2>{t('API keys')}</h2><span class="spacer"></span>{#if form?.savedKey}<span class="chip ok">{t('key saved')}</span>{/if}</div>
		<p class="dim small" style="margin: 0">{t('All optional. A key from the file')} <span class="mono">.env</span> {t('takes precedence over the one entered here; keys entered here are stored on this computer (studio database) and are never sent back to the browser.')}</p>
		{#each data.secrets as k (k.key)}
			<form class="key row fwrap" method="POST" action="?/secret" use:enhance={() => async ({ update }) => update({ reset: true })}>
				<input type="hidden" name="key" value={k.key} />
				<div class="kl"><b>{t(k.label)}</b><div class="faint small">{t(k.hint)} · <a href={k.url} target="_blank" rel="noreferrer" style="text-decoration: underline">{t('get a key')}</a></div></div>
				{#if k.source === 'env'}
					<span class="chip ok">{t('in .env')} {k.masked}</span>
				{:else}
					{#if k.source === 'ui'}<span class="chip ok">{t('stored')} {k.masked}</span>{:else}<span class="chip">{t('none')}</span>{/if}
					<input name="value" type="password" autocomplete="off" placeholder={k.source === 'ui' ? t('Replace…') : t('Paste the key…')} data-dictation="off" style="width: 260px" />
					<button>{t('Save')}</button>
					{#if k.source === 'ui'}<button name="value" value="" class="ghost small" title={t('Clear the key')}>{t('Clear')}</button>{/if}
				{/if}
			</form>
		{/each}
	</section>

	<form class="panel pad col" method="POST" action="?/save" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<div class="row"><h2>Claude</h2><span class="spacer"></span>{#if form?.saved}<span class="chip ok">{t('saved')}</span>{/if}</div>
		<label class="row" style="gap: 8px; color: var(--text)">{t('Agent authentication')}
			<select bind:value={s.claudeAuth} style="width: auto">
				<option value="auto">{t('Automatic (API key if present, otherwise Claude Code)')}</option>
				<option value="api_key">{t('Anthropic API key')}</option>
				<option value="subscription">{t('Subscription via Claude Code (local sign-in)')}</option>
			</select>
		</label>
		<p class="dim small" style="margin: 0">{t('Currently:')} <b>{data.claudeAuthEffective === 'api_key' ? t('Anthropic API key') : t('Claude Code signed in on this computer')}</b>. {t('Subscription mode requires')} <span class="mono">claude</span> {t('to be installed and signed in; API key mode bills usage to your Anthropic account.')}</p>
		<div class="row"><h2>{t('Default models')}</h2></div>
		<p class="dim small" style="margin: 0">{t('Apply to all projects. Each project can override a role in its settings, and each task can be run with another model from the selector at the top of the video page.')}</p>
		<ModelTable bind:value={s.models} />
		<h2 style="margin-top: 10px">{t('Production')}</h2>
		<label class="row" style="gap: 8px; color: var(--text)">{t('Parallel tasks')} <input type="number" min="1" max="8" bind:value={s.parallel} style="width: 80px" /></label>
		<p class="dim small" style="margin: 0">{t('Agents and renders running at the same time, across all projects (steps of the same shot stay in order). Higher = shorter cycles, but more machine load and more subscription usage at once.')}</p>
		<h2 style="margin-top: 10px">{t('Memory')}</h2>
		<label class="row" style="gap: 8px; color: var(--text)"><input type="checkbox" bind:checked={s.autoApproveLessons} style="width: auto" /> {t('Activate proposed lessons without review')}</label>
		<p class="dim small" style="margin: 0">{t('Off: lessons drawn from notes and reviews wait for your approval in')} <a href="/lessons" style="text-decoration: underline">{t('Lessons')}</a>.</p>
		<h2 style="margin-top: 10px">{t('Dictation')}</h2>
		<p class="dim small" style="margin: 0">{t('A microphone appears in each active text field (or')} <span class="mono">Alt+M</span>{t('; ')}<span class="mono">{t('Esc')}</span> {t('cancels). The recording is transcribed by Whisper and then inserted at the cursor. Keys in')} <span class="mono">.env</span>{t(': ')}<span class="mono">GROQ_API_KEY</span>, <span class="mono">OPENAI_API_KEY</span>.</p>
		<div class="row fwrap">
			<label style="width: 230px"><span>{t('Provider')}</span>
				<select bind:value={s.dictation.provider} onchange={() => (s.dictation.model = DICTATION_MODELS[s.dictation.provider][0])}>
					<option value="groq">Groq · Whisper{data.keys.groq ? '' : ' ' + t('(key missing)')}</option>
					<option value="openai">OpenAI{data.keys.openai ? '' : ' ' + t('(key missing)')}</option>
				</select>
			</label>
			<label style="width: 230px"><span>{t('Model')}</span>
				<select bind:value={s.dictation.model}>{#each DICTATION_MODELS[s.dictation.provider] as m (m)}<option value={m}>{m}</option>{/each}</select>
			</label>
			<label style="width: 120px"><span>{t('Language')}</span><input bind:value={s.dictation.language} placeholder="auto" data-dictation="off" /></label>
			{#if data.keys[s.dictation.provider]}<span class="chip ok">{t('key configured')}</span>{:else}<span class="chip amber">{t('key missing in .env')}</span>{/if}
		</div>
		<h2 style="margin-top: 10px">{t('Briefing axes')}</h2>
		<p class="dim small" style="margin: 0">{t('Before any storyboard, the director goes through each axis: it settles what the brief and doctrine decide and asks you about the rest, starting from these typical directions. Each axis must end up decided or ignored.')}</p>
		<div class="axes">
			{#each s.briefAxes as a, i (i)}
				<div class="axis">
					<div class="col">
						<input placeholder={t('Axis (e.g. Pacing)')} bind:value={a.label} />
						<input class="small" placeholder={t('What needs deciding')} bind:value={a.hint} />
						<span class="faint small mono">{a.key || slug(a.label)}</span>
					</div>
					<textarea rows="4" placeholder={t('Typical directions, one per line')} value={a.suggestions.join('\n')} oninput={(e) => (a.suggestions = e.currentTarget.value.split('\n').map((x) => x.trim()).filter(Boolean))}></textarea>
					<button type="button" class="ghost" title={t('Remove')} onclick={() => s.briefAxes.splice(i, 1)}>✕</button>
				</div>
			{/each}
		</div>
		<div class="row"><button type="button" onclick={addAxis}>{t('Add an axis')}</button><button type="button" class="ghost" onclick={() => (s.briefAxes = structuredClone(data.defaultAxes))}>{t('Reset to default axes')}</button></div>
		<input type="hidden" name="settings" value={JSON.stringify(s)} />
		{#if form?.error}<p class="small" style="color: var(--err)">{form.error}</p>{/if}
		<div><button class="primary">{t('Save')}</button></div>
	</form>
</div>

<style>
	.wrapper { padding: 32px 36px 56px; display: grid; gap: 16px; max-width: 900px; }
	.axes { display: grid; gap: 8px; }
	.key { gap: 8px; padding-top: 8px; border-top: 1px solid var(--line-soft); }
	.kl { flex: 1; min-width: 240px; }
	.axis { display: grid; grid-template-columns: 240px 1fr auto; gap: 8px; align-items: start; padding-top: 8px; border-top: 1px solid var(--line-soft); }
	.axis textarea { font-size: 12.5px; }
</style>
