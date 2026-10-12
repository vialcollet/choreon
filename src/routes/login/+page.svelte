<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import { useI18n } from '$lib/i18n';

	const { t } = useI18n();
	let { form } = $props();
</script>

<AuthCard title={t('Sign in')}>
	<form class="col" method="POST" use:enhance>
		<label><span>{t('Email address')}</span><input name="email" type="email" autocomplete="email" required value={form?.email ?? ''} /></label>
		<label><span>{t('Password')}</span><input name="password" type="password" autocomplete="current-password" required /></label>
		{#if form?.error}<p class="small err">{form.error}</p>{/if}
		<button class="primary">{t('Sign in')}</button>
	</form>
	<p class="faint small">{t('No account? Access is by invitation from an administrator of your organization.')}</p>
</AuthCard>
