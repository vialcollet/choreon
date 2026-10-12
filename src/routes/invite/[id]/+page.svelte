<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '$lib/components/AuthCard.svelte';
	import { useI18n } from '$lib/i18n';

	const { t } = useI18n();
	let { data, form } = $props();
	const inv = $derived(data.invitation);
</script>

{#if !inv}
	<AuthCard title={t('Invalid invitation')}>
		<p class="dim small">{t('This link has expired or has already been used. Ask for a new invitation.')}</p>
		<a class="small" href="/login" style="text-decoration: underline">{t('Sign in')}</a>
	</AuthCard>
{:else}
	<AuthCard title={t('Join {org}', { org: inv.orgName })} subtitle={inv.inviterName ? t('{name} invites you as {role}, for {email}.', { name: inv.inviterName, role: inv.role, email: inv.email }) : t('Invitation as {role}, for {email}.', { role: inv.role, email: inv.email })}>
		{#if data.me && data.me.toLowerCase() === inv.email.toLowerCase()}
			<form method="POST" use:enhance><button class="primary">{t('Accept the invitation')}</button></form>
		{:else if data.me}
			<p class="small err">{t('You are signed in as {me}: this invitation is for {email}.', { me: data.me, email: inv.email })}</p>
		{:else if data.hasAccount}
			<a class="primary btn" href="/login?next=/invite/{inv.id}">{t('Sign in to accept')}</a>
		{:else}
			<a class="primary btn" href="/signup?invitation={inv.id}">{t('Create my account')}</a>
		{/if}
		{#if form?.error}<p class="small err">{form.error}</p>{/if}
	</AuthCard>
{/if}

<style>
	.btn { display: inline-flex; justify-content: center; padding: 8px 14px; border-radius: 8px; background: var(--text); color: var(--bg); font-weight: 500; }
</style>
