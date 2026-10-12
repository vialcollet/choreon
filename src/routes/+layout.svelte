<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Dictation from '$lib/components/Dictation.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import Toaster from '$lib/components/Toaster.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import Guide from '$lib/components/Guide.svelte';
	import ActivityPill from '$lib/components/ActivityPill.svelte';
	import { activity } from '$lib/activity.svelte';
	import { LANGS, provideI18n, useI18n, type Lang } from '$lib/i18n';
	import { Clapperboard, Library, Images, LayoutTemplate, Settings2, Plus, Brain, SlidersHorizontal, Film, Users, ShieldCheck, LogOut, Languages, Search } from '@lucide/svelte';

	let { data, children } = $props();
	provideI18n(() => data.lang);
	const { t, tt } = useI18n();

	/** Language switch: cookie for a year, then reload the data in the new language. */
	function setLang(l: Lang) {
		document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`;
		document.documentElement.lang = l;
		invalidateAll();
	}

	// Live activity: refreshes the page when a run changes state or produces an artifact (400 ms
	// debounce), feeds the notifications, and pings the desktop when the tab is in the background.
	// Keyed on the user id alone: a sign-in by client navigation opens the stream, a sign-out or a
	// change of user closes it, and the refreshes it triggers (new `data` each time) do not reopen it.
	const uid = $derived(data.user?.id);
	$effect(() => {
		if (!uid) return;
		untrack(() => activity.init(data.activity));
		const es = new EventSource('/api/events');
		let timer: ReturnType<typeof setTimeout> | null = null;
		es.onmessage = (m) => {
			try {
				const d = JSON.parse(m.data);
				if (d.run) {
					const before = activity.toasts.length;
					activity.update(d.run);
					const last = activity.toasts.at(-1);
					if (activity.desktop && document.hidden && activity.toasts.length > before && last && last.phase !== 'start') {
						new Notification(`${tt(last.run.title)} — ${last.phase === 'error' ? t('failed') : last.run.pass === false ? t('needs work') : t('done')}`, { body: [last.run.videoTitle, last.run.shotKey].filter(Boolean).join(' · '), icon: '/favicon.svg', tag: last.run.id });
					}
				}
			} catch {}
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => invalidateAll(), 400);
		};
		return () => {
			es.close();
			if (timer) clearTimeout(timer);
		};
	});
	// The server's list is the truth after each refresh.
	$effect(() => {
		if (data.user) activity.runs = data.activity;
	});
	let palette: CommandPalette | undefined = $state();
	const busy = $derived(activity.runs.filter((r) => r.status === 'running').length);

	const current = $derived(page.params.project);
</script>

<svelte:head><title>{busy ? `● (${busy}) ` : ''}Choreon</title></svelte:head>

{#if !data.user}
	{@render children()}
	<div class="langfloat">
		{#each LANGS as l (l.id)}<button class="ghost small" class:on={data.lang === l.id} onclick={() => setLang(l.id)}>{l.id.toUpperCase()}</button>{/each}
	</div>
{:else}
<Dictation />
<Toaster />
<CommandPalette bind:this={palette} nav={data.nav} isAdmin={data.isAdmin} />
<Guide />
<div class="shell">
	<aside>
		<a class="brand" href="/" title={t('Choreon — motion design studio')}><Logo size={24} /></a>
		<div class="act"><ActivityPill /><button class="search" onclick={() => palette?.show()}><Search size={13} /> {t('Search')}<span class="spacer"></span><kbd>Ctrl K</kbd></button></div>
		<nav>
			{#each data.nav as p (p.id)}
				<div class="proj" class:active={current === p.id}>
					<a class="pname" href="/p/{p.id}"><span class="av">{p.name.slice(0, 1).toUpperCase()}</span><span class="nm">{p.name}</span></a>
					{#if current === p.id}
						<div class="sub">
							{#each p.videos as v (v.slug)}
								<a href="/p/{p.id}/v/{v.slug}" class:active={page.params.video === v.slug} title={v.title}><Clapperboard size={13} /> <span class="nm">{v.title}</span></a>
							{/each}
							<a href="/p/{p.id}#nouvelle-video" class="faint"><Plus size={13} /> {t('New video')}</a>
							<span class="sep"></span>
							<a href="/p/{p.id}/references" class:active={page.url.pathname.endsWith('/references')}><Film size={13} /> {t('References')}</a>
							<a href="/p/{p.id}/library" class:active={page.url.pathname.endsWith('/library')}><Library size={13} /> {t('Library')}</a>
							<a href="/p/{p.id}/ui" class:active={page.url.pathname.endsWith('/ui')}><LayoutTemplate size={13} /> {t('Interface')}</a>
							<a href="/p/{p.id}/stills" class:active={page.url.pathname.includes('/stills')}><Images size={13} /> {t('Stills')}</a>
							<a href="/p/{p.id}/settings" class:active={page.url.pathname.endsWith('/settings')}><Settings2 size={13} /> {t('Settings')}</a>
						</div>
					{/if}
				</div>
			{/each}
			<a class="faint newp" href="/#new-project"><Plus size={13} /> {t('New project')}</a>
		</nav>
		<nav class="studio">
			<a class="newp" class:active={page.url.pathname === '/lessons'} href="/lessons"><Brain size={13} /> {t('Lessons')}{#if data.proposed}<span class="chip amber" style="margin-left: auto">{data.proposed}</span>{/if}</a>
			{#if data.isAdmin}
				<a class="newp" class:active={page.url.pathname === '/settings'} href="/settings"><SlidersHorizontal size={13} /> {t('Studio settings')}</a>
				<a class="newp" class:active={page.url.pathname === '/admin'} href="/admin"><ShieldCheck size={13} /> {t('Administration')}</a>
			{/if}
		</nav>
		<nav class="account">
			{#if data.orgs.length > 1}
				<form method="POST" action="/org?/switch" use:enhance>
					<select name="orgId" value={data.activeOrg?.id ?? ''} onchange={(e) => e.currentTarget.form?.requestSubmit()} title={t('Active organization')}>
						{#each data.orgs as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
					</select>
				</form>
			{/if}
			<a class="newp" class:active={page.url.pathname === '/org'} href="/org"><Users size={13} /> {data.activeOrg?.name ?? t('Organization')}</a>
			<div class="langs" title={t('Interface language')}>
				<Languages size={13} />
				{#each LANGS as l (l.id)}<button class="ghost small" class:on={data.lang === l.id} onclick={() => setLang(l.id)}>{l.id.toUpperCase()}</button>{/each}
			</div>
			<form method="POST" action="/logout" class="me">
				<a class="small dim" href="/account" title="{t('My account')} · {data.user.email}">{data.user.name}</a>
				<button class="ghost small" title={t('Sign out')}><LogOut size={13} /></button>
			</form>
		</nav>
	</aside>
	<main>{@render children()}</main>
</div>
{/if}

<style>
	.shell { display: grid; grid-template-columns: 240px 1fr; height: 100vh; }
	aside { background: var(--bg-deep); border-right: 1px solid var(--line); padding: 14px 10px 12px; overflow: auto; display: flex; flex-direction: column; }
	.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; padding: 6px 8px 14px; }
	.act { padding: 0 2px 14px; display: grid; gap: 6px; }
	.search { justify-content: flex-start; gap: 8px; min-height: 30px; padding: 4px 6px 4px 10px; font-size: 12.5px; font-weight: 400; color: var(--faint); background: rgb(0 0 0 / 0.2); border-color: var(--line); }
	.search kbd { font-size: 10px; padding: 2px 4px; }
	nav { display: grid; gap: 1px; }
	.proj .pname { display: flex; align-items: center; gap: 9px; padding: 5px 8px; border-radius: 8px; font-weight: 500; color: var(--dim); }
	.proj .pname:hover { background: rgb(255 255 255 / 0.04); color: var(--text); }
	.proj.active .pname { color: var(--text); }
	.av { width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; font-size: 11px; font-weight: 600; background: var(--panel-2); box-shadow: inset 0 0 0 1px var(--line); color: var(--dim); flex: none; }
	.proj.active .av { background: var(--accent); color: #141100; box-shadow: none; }
	.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
	.sub { display: grid; gap: 1px; padding: 2px 0 10px 18px; margin-left: 9px; border-left: 1px solid var(--line); }
	.sub .sep { height: 1px; background: var(--line-soft); margin: 4px 8px; }
	.sub a, .newp { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 7px; color: var(--dim); font-size: 13px; min-width: 0; }
	.sub a:hover, .newp:hover { background: rgb(255 255 255 / 0.04); color: var(--text); }
	.sub a :global(svg), .newp :global(svg) { flex: none; opacity: 0.8; }
	.sub a.active { color: var(--text); background: rgb(255 255 255 / 0.06); }
	main { overflow: auto; }
	.studio { margin-top: auto; border-top: 1px solid var(--line); padding-top: 10px; }
	.studio a.active, .account a.active { color: var(--text); background: rgb(255 255 255 / 0.06); }
	.account { border-top: 1px solid var(--line); padding-top: 10px; margin-top: 10px; }
	.account select { font-size: 12.5px; margin-bottom: 4px; }
	.me { display: flex; align-items: center; justify-content: space-between; padding: 2px 0 0 8px; }
	.langs { display: flex; align-items: center; gap: 2px; padding: 2px 8px; color: var(--faint); }
	.langs button, .langfloat button { min-height: 22px; padding: 0 7px; font-size: 11px; color: var(--faint); }
	.langs button.on, .langfloat button.on { color: var(--text); background: rgb(255 255 255 / 0.06); }
	.langfloat { position: fixed; top: 14px; right: 16px; display: flex; gap: 2px; }
</style>
