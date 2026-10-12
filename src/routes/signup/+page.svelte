<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import { useI18n } from '$lib/i18n';

	const { t } = useI18n();
	let { data, form } = $props();
</script>

{#if data.closed}
	<AuthCard title={t('Sign-up closed')}>
		<p class="dim small">{t('Choreon is invitation-only: ask an administrator of your organization for a link.')}</p>
		<a class="small" href="/login" style="text-decoration: underline">{t('Sign in')}</a>
	</AuthCard>
{:else}
	<AuthCard
		title={data.first ? t('Create the administrator account') : t('Join {org}', { org: data.invitation?.orgName })}
		subtitle={data.first ? t('First studio account: it manages users and receives the existing projects in its first organization.') : t('Invitation for {email} (role {role}).', { email: data.invitation?.email, role: data.invitation?.role })}
	>
		<form class="col" method="POST" use:enhance>
			<label><span>{t('Name')}</span><input name="name" autocomplete="name" required value={form?.name ?? ''} /></label>
			<label><span>{t('Email address')}</span><input name="email" type="email" autocomplete="email" required value={form?.email ?? data.invitation?.email ?? ''} readonly={!!data.invitation} /></label>
			<label><span>{t('Password (10 characters minimum)')}</span><input name="password" type="password" autocomplete="new-password" minlength="10" required /></label>
			{#if data.first}<label><span>{t('Organization name')}</span><input name="org" placeholder={t('e.g. Acme')} required /></label>{/if}
			{#if form?.error}<p class="small err">{form.error}</p>{/if}
			<button class="primary">{data.first ? t('Create the studio') : t('Create my account')}</button>
		</form>
		{#if !data.first}<p class="faint small">{t('Already have an account?')} <a href="/login?next=/invite/{data.invitation?.id}" style="text-decoration: underline">{t('Sign in to accept')}</a></p>{/if}
	</AuthCard>
{/if}
