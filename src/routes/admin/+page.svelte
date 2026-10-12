<script lang="ts">
	import { enhance } from '$app/forms';
	import { useI18n } from '$lib/i18n';
	import { Ban, KeyRound, Trash2, UserPlus, Building2, Undo2 } from '@lucide/svelte';

	const { t } = useI18n();
	let { data, form } = $props();
	let pwFor = $state<string | null>(null);
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	const confirmIt = (msg: string) => (e: MouseEvent) => {
		if (!confirm(msg)) e.preventDefault();
	};
</script>

<div class="wrapper">
	<h1>{t('Administration')}</h1>
	{#if form?.error}<p class="small" style="color: var(--err)">{form.error}</p>{/if}
	{#if form?.created}<p class="small" style="color: var(--ok)">{t('Account created: {email}', { email: String(form.created) })}</p>{/if}
	{#if form?.passwordSet}<p class="small" style="color: var(--ok)">{t('Password changed.')}</p>{/if}

	<section class="panel pad col">
		<h2>{t('Users ({n})', { n: data.users.length })}</h2>
		<table>
			<tbody>
				{#each data.users as u (u.id)}
					<tr class:banned={u.banned}>
						<td><b>{u.name}</b>{#if u.id === data.me}<span class="faint small"> {t('(you)')}</span>{/if}<div class="faint small">{u.email}</div></td>
						<td class="small dim">{u.orgs ?? t('no organization')}</td>
						<td>
							<form method="POST" action="?/setRole" use:enhance={keep}>
								<input type="hidden" name="userId" value={u.id} />
								<select name="role" value={u.role === 'admin' ? 'admin' : 'user'} disabled={u.id === data.me} onchange={(e) => e.currentTarget.form?.requestSubmit()} style="width: auto">
									<option value="user">{t('user')}</option><option value="admin">{t('studio admin')}</option>
								</select>
							</form>
						</td>
						<td class="actions">
							{#if u.banned}<span class="chip err">{t('suspended')}</span>{/if}
							<button class="ghost small" title={t('Set a password')} onclick={() => (pwFor = pwFor === u.id ? null : u.id)}><KeyRound size={14} /></button>
							{#if u.id !== data.me}
								<form method="POST" action="?/ban" use:enhance>
									<input type="hidden" name="userId" value={u.id} />
									{#if u.banned}<input type="hidden" name="unban" value="1" /><button class="ghost small" title={t('Reactivate')}><Undo2 size={14} /></button>
									{:else}<button class="ghost small" title={t('Suspend')} onclick={confirmIt(t('Suspend {name}?', { name: u.name }))}><Ban size={14} /></button>{/if}
								</form>
								<form method="POST" action="?/removeUser" use:enhance><input type="hidden" name="userId" value={u.id} /><button class="ghost small" title={t('Delete')} onclick={confirmIt(t('Permanently delete {name}?', { name: u.name }))}><Trash2 size={14} /></button></form>
							{/if}
						</td>
					</tr>
					{#if pwFor === u.id}
						<tr><td colspan="4">
							<form class="row" method="POST" action="?/password" use:enhance={() => async ({ update }) => { pwFor = null; await update(); }}>
								<input type="hidden" name="userId" value={u.id} />
								<input name="password" type="password" minlength="10" placeholder={t('New password (10 characters minimum)')} required />
								<button>{t('Set')}</button>
							</form>
						</td></tr>
					{/if}
				{/each}
			</tbody>
		</table>
		<h3>{t('Create an account')}</h3>
		<form class="grid" method="POST" action="?/createUser" use:enhance>
			<input name="name" placeholder={t('Name')} required />
			<input name="email" type="email" placeholder={t('name@example.com')} required />
			<input name="password" type="password" minlength="10" placeholder={t('Temporary password')} required />
			<select name="role"><option value="user">{t('user')}</option><option value="admin">{t('studio admin')}</option></select>
			<select name="orgId"><option value="">{t('no organization')}</option>{#each data.orgs as o (o.id)}<option value={o.id}>{o.name}</option>{/each}</select>
			<select name="orgRole"><option value="member">{t('member')}</option><option value="admin">{t('admin')}</option><option value="owner">{t('owner')}</option></select>
			<button class="primary"><UserPlus size={14} /> {t('Create')}</button>
		</form>
	</section>

	<section class="panel pad col">
		<h2>{t('Organizations ({n})', { n: data.orgs.length })}</h2>
		<table>
			<tbody>
				{#each data.orgs as o (o.id)}
					<tr>
						<td><b>{o.name}</b><div class="faint small mono">{o.slug}</div></td>
						<td class="small dim">{o.members > 1 ? t('{n} members', { n: o.members }) : t('{n} member', { n: o.members })} · {o.projects ?? t('no projects')}</td>
						<td>
							<form class="row" method="POST" action="?/addMember" use:enhance>
								<input type="hidden" name="orgId" value={o.id} />
								<select name="userId" style="width: auto">{#each data.users as u (u.id)}<option value={u.id}>{u.name}</option>{/each}</select>
								<select name="role" style="width: auto"><option value="member">{t('member')}</option><option value="admin">{t('admin')}</option><option value="owner">{t('owner')}</option></select>
								<button class="small">{t('Add')}</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<form class="row" method="POST" action="?/createOrg" use:enhance>
			<input name="name" placeholder={t('New organization name')} required />
			<select name="ownerId" style="width: auto" title={t('Owner')}>{#each data.users as u (u.id)}<option value={u.id} selected={u.id === data.me}>{u.name}</option>{/each}</select>
			<button><Building2 size={14} /> {t('Create organization')}</button>
		</form>
	</section>

	<section class="panel pad col">
		<h2>{t('Projects')}</h2>
		<p class="dim small" style="margin: 0">{t('Each project belongs to an organization: only its members can see it.')}</p>
		<table>
			<tbody>
				{#each data.projects as p (p.id)}
					<tr>
						<td><a href="/p/{p.id}"><b>{p.name}</b></a><div class="faint small mono">{p.id}</div></td>
						<td>
							<form method="POST" action="?/moveProject" use:enhance={keep}>
								<input type="hidden" name="projectId" value={p.id} />
								<select name="orgId" value={p.orgId ?? ''} onchange={(e) => e.currentTarget.form?.requestSubmit()} style="width: auto">
									{#if !p.orgId}<option value="">{t('— no organization —')}</option>{/if}
									{#each data.orgs as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
								</select>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>

<style>
	.wrapper { padding: 32px 36px 56px; display: grid; gap: 16px; max-width: 1100px; align-content: start; }
	h1, h3 { margin: 0; }
	table { width: 100%; border-collapse: collapse; }
	td { padding: 8px 6px; border-top: 1px solid var(--line-soft); vertical-align: middle; }
	td.actions { text-align: right; white-space: nowrap; }
	td.actions form { display: inline; }
	tr.banned td { opacity: 0.55; }
	.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
	form.row { gap: 8px; }
</style>
