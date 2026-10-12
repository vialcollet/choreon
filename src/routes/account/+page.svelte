<script lang="ts">
	import { enhance } from '$app/forms';
	import { useI18n } from '$lib/i18n';

	const { t } = useI18n();
	let { data, form } = $props();
</script>

<div class="wrapper">
	<h1>{t('My account')}</h1>
	{#if form?.error}<p class="small" style="color: var(--err)">{form.error}</p>{/if}

	<form class="panel pad col" method="POST" action="?/name" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<div class="row"><h2>{t('Profile')}</h2><span class="spacer"></span>{#if form?.saved === 'name'}<span class="chip ok">{t('saved')}</span>{/if}</div>
		<label><span>{t('Name')}</span><input name="name" value={data.me.name} required /></label>
		<label><span>{t('Email address')}</span><input value={data.me.email} readonly data-dictation="off" /></label>
		<div><button>{t('Save')}</button></div>
	</form>

	<form class="panel pad col" method="POST" action="?/password" use:enhance>
		<div class="row"><h2>{t('Password')}</h2><span class="spacer"></span>{#if form?.saved === 'password'}<span class="chip ok">{t('changed · other sessions signed out')}</span>{/if}</div>
		<label><span>{t('Current password')}</span><input name="current" type="password" autocomplete="current-password" required /></label>
		<label><span>{t('New password (10 characters minimum)')}</span><input name="new" type="password" autocomplete="new-password" minlength="10" required /></label>
		<label><span>{t('Confirmation')}</span><input name="confirm" type="password" autocomplete="new-password" minlength="10" required /></label>
		<div><button class="primary">{t('Change password')}</button></div>
		<p class="faint small" style="margin: 0">{t('Lost your password? An administrator can set a new one in Administration, or, locally,')} <span class="mono">bun scripts/reset-password.ts &lt;email&gt; --ask</span>.</p>
	</form>
</div>

<style>
	.wrapper { padding: 32px 36px 56px; display: grid; gap: 16px; max-width: 560px; align-content: start; }
	h1 { margin: 0; }
</style>
