<script lang="ts">
	import { enhance } from '$app/forms';
	import { useI18n, locale } from '$lib/i18n';
	import { Copy, UserPlus, X } from '@lucide/svelte';

	const { t, lang } = useI18n();
	let { data, form } = $props();
	const ROLE_LABEL: Record<string, string> = { owner: 'owner', admin: 'admin', member: 'member' };
	const link = (id: string) => `${data.origin}/invite/${id}`;
	let copied = $state<string | null>(null);
	async function copy(id: string) {
		await navigator.clipboard.writeText(link(id));
		copied = id;
		setTimeout(() => (copied = null), 1500);
	}
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<div class="wrapper">
	{#if !data.org}
		<h1>{t('Organization')}</h1>
		<div class="empty">{t('You do not belong to any organization. Ask an administrator for an invitation.')}</div>
	{:else}
		<header class="row fwrap">
			<h1>{data.org.name}</h1>
			<span class="chip">{ROLE_LABEL[data.myRole ?? ''] ? t(ROLE_LABEL[data.myRole ?? '']) : t('studio admin')}</span>
			<span class="spacer"></span>
			{#if data.myRole && data.myRole !== 'owner'}
				<form method="POST" action="?/leave" use:enhance><button class="ghost small" onclick={(e) => !confirm(t('Leave {name}?', { name: data.org?.name })) && e.preventDefault()}>{t('Leave organization')}</button></form>
			{/if}
		</header>
		{#if form?.error}<p class="small" style="color: var(--err)">{form.error}</p>{/if}

		<section class="panel pad col">
			<h2>{t('Members ({n})', { n: data.people?.members.length })}</h2>
			<table>
				<tbody>
					{#each data.people?.members ?? [] as m (m.id)}
						<tr>
							<td><b>{m.name}</b><div class="faint small">{m.email}</div></td>
							<td>
								{#if data.canManage}
									<form method="POST" action="?/role" use:enhance={keep}>
										<input type="hidden" name="memberId" value={m.id} />
										<select name="role" value={m.role} onchange={(e) => e.currentTarget.form?.requestSubmit()} style="width: auto">
											{#each ['member', 'admin', 'owner'] as r (r)}<option value={r}>{t(ROLE_LABEL[r])}</option>{/each}
										</select>
									</form>
								{:else}<span class="chip">{ROLE_LABEL[m.role] ? t(ROLE_LABEL[m.role]) : m.role}</span>{/if}
							</td>
							<td class="actions">
								{#if data.canManage && m.role !== 'owner'}
									<form method="POST" action="?/remove" use:enhance><input type="hidden" name="memberId" value={m.id} /><button class="ghost small" title={t('Remove')} onclick={(e) => !confirm(t('Remove {name}?', { name: m.name })) && e.preventDefault()}><X size={14} /></button></form>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		{#if data.canManage}
			<section class="panel pad col">
				<h2>{t('Invite')}</h2>
				<p class="dim small" style="margin: 0">{t('No email is sent: copy the link and share it. It is valid for 7 days and restricted to the address given.')}</p>
				<form class="row" method="POST" action="?/invite" use:enhance>
					<input name="email" type="email" placeholder={t('name@example.com')} required />
					<select name="role" style="width: auto"><option value="member">{t('member')}</option><option value="admin">{t('admin')}</option></select>
					<button class="primary"><UserPlus size={14} /> {t('Invite')}</button>
				</form>
				{#if form?.invited}<p class="small" style="color: var(--ok); margin: 0">{t('Invitation created for {email}: copy the link below.', { email: form.invited })}</p>{/if}
				{#each data.people?.invitations ?? [] as i (i.id)}
					<div class="row inv">
						<span>{i.email}</span><span class="chip">{ROLE_LABEL[i.role] ? t(ROLE_LABEL[i.role]) : i.role}</span>
						<span class="faint small">{t('expires on {date}', { date: new Date(i.expiresAt).toLocaleDateString(locale(lang())) })}</span>
						<span class="spacer"></span>
						<button class="small" onclick={() => copy(i.id)}><Copy size={13} /> {copied === i.id ? t('copied') : t('Copy link')}</button>
						<form method="POST" action="?/cancel" use:enhance><input type="hidden" name="id" value={i.id} /><button class="ghost small" title={t('Cancel')}><X size={13} /></button></form>
					</div>
				{/each}
			</section>

			<section class="panel pad col">
				<h2>{t('Settings')}</h2>
				<form class="row" method="POST" action="?/rename" use:enhance={keep}>
					<input name="name" value={data.org.name} />
					<button>{t('Rename')}</button>
				</form>
				<p class="dim small" style="margin: 0">{t('Organization projects: {list}.', { list: data.projects.map((p) => p.name).join(', ') || t('none yet') })}</p>
			</section>
		{/if}
	{/if}
</div>

<style>
	.wrapper { padding: 32px 36px 56px; display: grid; gap: 16px; max-width: 900px; align-content: start; }
	h1 { margin: 0; }
	table { width: 100%; border-collapse: collapse; }
	td { padding: 8px 6px; border-top: 1px solid var(--line-soft); vertical-align: middle; }
	td.actions { text-align: right; width: 40px; }
	.inv { border-top: 1px solid var(--line-soft); padding-top: 8px; }
	form.row { gap: 8px; }
</style>
