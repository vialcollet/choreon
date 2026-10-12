<script lang="ts">
	import { api } from '$lib/api';
	import { invalidateAll, goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { useI18n } from '$lib/i18n';
	import NoteItem from '$lib/components/NoteItem.svelte';
	import BriefInterview from '$lib/components/BriefInterview.svelte';
	import StoryboardStrip from '$lib/components/storyboard/StoryboardStrip.svelte';
	import ShotCard from '$lib/components/storyboard/ShotCard.svelte';
	import Player from '$lib/components/Player.svelte';
	import { Sparkles, RefreshCw, Hammer, BadgeCheck, MessageSquarePlus, ChevronDown, FileText, ListChecks, Undo2, Mic, Clapperboard } from '@lucide/svelte';

	const { t } = useI18n();
	let { data } = $props();

	const sb = $derived(data.storyboard);
	const sbNotes = $derived(data.notes.filter((n) => n.target !== 'render' && n.storyboardVersion === sb?.version));
	const openNotes = $derived(sbNotes.filter((n) => n.status === 'open'));
	const busy = $derived(data.active.some((r) => r.kind.startsWith('storyboard')));
	const totalDuration = $derived(data.shots.reduce((s, x) => s + x.duration, 0));
	const brief = $derived(data.video.briefState);
	const reviewing = $derived(data.active.some((r) => r.kind === 'brief_review'));
	const ready = $derived(brief.status === 'ready' && !reviewing);
	const notReady = $derived(t('Framing incomplete: answer the framing interview first'));
	const approved = $derived(sb?.status === 'approved');
	const ratio = $derived(`${data.video.format.width} / ${data.video.format.height}`);
	const vertical = $derived(data.video.format.height > data.video.format.width);
	// Latest render of each shot, so the key moments can show what was really animated.
	const renderOf = (key: string) => { const r = data.renders.filter((x) => x.shotKey === key).sort((a, b) => b.version - a.version)[0]; return r ? { url: r.url, version: r.version } : null; };
	const starts = $derived(data.shots.map((_, i) => data.shots.slice(0, i).reduce((a, x) => a + x.duration, 0)));
	// The one action the page pushes: revise when there are open notes, otherwise approve, then build.
	const next = $derived(openNotes.length ? 'revise' : approved ? 'build' : 'approve');

	let showBrief = $state(false);
	let showCadrage = $state(false);
	let readMore = $state(false);
	let drafts = $state<Record<string, string>>({});
	let err = $state('');

	async function job(body: Record<string, unknown>) {
		err = '';
		try {
			await api.job({ projectId: data.project.id, videoId: data.video.id, ...body });
			invalidateAll();
		} catch (e) {
			err = String(e);
		}
	}

	async function addNote(shotKey: string | null, text?: string) {
		const k = shotKey ?? '_global';
		const body = (text ?? drafts[k] ?? '').trim();
		if (!body || !sb) return;
		drafts[k] = '';
		await api.note({ videoId: data.video.id, target: shotKey ? 'shot' : 'storyboard', storyboardVersion: sb.version, shotKey, body });
		invalidateAll();
	}

	const buildAll = () => {
		for (const s of data.shots) job({ kind: 'shot_build', shotKey: s.key });
		goto(`/p/${data.project.id}/v/${data.video.slug}/production`);
	};
	const notesFor = (key: string) => sbNotes.filter((n) => n.shotKey === key);

	// Voice-over and animatic: validate the story, the voice and the timing before animating anything.
	const voiced = $derived(data.shots.some((s) => (s.data.voiceover ?? '').trim()));
	const recording = $derived(data.active.some((r) => r.kind === 'voice_generate'));
	const cutting = $derived(data.active.some((r) => r.kind === 'animatic'));
	// svelte-ignore state_referenced_locally
	let voiceName = $state(data.voice?.voice ?? data.voices[0]);
	const animChapters = $derived(data.shots.map((s, i) => ({ t: starts[i], key: s.key, label: s.title })));
</script>

<div class="sbp">
	<section class="bar">
		<div class="row group">
			{#if data.versions.length}
				<select value={sb?.version} onchange={(e) => goto(`?sb=${(e.target as HTMLSelectElement).value}`)} style="width: auto">
					{#each data.versions as v (v.version)}<option value={v.version}>{t('Storyboard')} v{v.version}{v.status === 'approved' ? ' ✓' : ''}</option>{/each}
				</select>
				{#if approved}<span class="chip ok">{t('approved')}</span>{:else}<span class="chip">{t('draft')}</span>{/if}
				<span class="faint small mono">{t('{n} shots · {d} s', { n: data.shots.length, d: totalDuration.toFixed(1) })}</span>
			{/if}
		</div>
		<span class="spacer"></span>
		<div class="row group seg">
			<button class="ghost small" class:on={showBrief} onclick={() => (showBrief = !showBrief)}><FileText size={14} /> {t('Brief')}</button>
			{#if sb}<button class="ghost small" class:on={showCadrage} onclick={() => (showCadrage = !showCadrage)}><ListChecks size={14} /> {t('Framing')} <span class="dotlet" class:okd={ready} class:amd={!ready} title={ready ? t('ready') : t('incomplete')}></span></button>{/if}
		</div>
		<div class="row group">
			{#if !sb}
				<button class="primary" disabled={busy || !ready} title={ready ? '' : notReady} onclick={() => job({ kind: 'storyboard_generate' })}><Sparkles size={15} /> {t('Generate storyboard')}</button>
			{:else}
				<button class="ghost" disabled={busy || !ready} title={ready ? '' : notReady} onclick={() => confirm(t('Regenerate an entirely new storyboard from the brief?')) && job({ kind: 'storyboard_generate' })}><Sparkles size={15} /> {t('Regenerate')}</button>
				<button class:primary={next === 'revise'} disabled={busy || !openNotes.length} onclick={() => job({ kind: 'storyboard_revise', noteIds: openNotes.map((n) => n.id) })}><RefreshCw size={15} /> {openNotes.length > 1 ? t('Revise with {n} notes', { n: openNotes.length }) : t('Revise with {n} note', { n: openNotes.length })}</button>
				<form method="POST" action="?/approve" use:enhance><input type="hidden" name="version" value={sb.version} /><button class:primary={next === 'approve'} class:ghost={approved}>{#if approved}<Undo2 size={15} /> {t('Back to draft')}{:else}<BadgeCheck size={15} /> {t('Approve')}{/if}</button></form>
				<button class:accent={next === 'build'} disabled={!approved} title={!approved ? t('Approve the storyboard first') : ''} onclick={buildAll}><Hammer size={15} /> {t('Build shots')}</button>
			{/if}
		</div>
	</section>
	{#if err}<p class="small" style="color: var(--err); margin: 0">{err}</p>{/if}

	{#if showBrief || !sb}
		<form class="panel pad col" method="POST" action="?/brief" use:enhance>
			<label><span>{t('Brief')}</span><textarea name="brief" rows="12">{data.video.brief}</textarea></label>
			<div class="row"><label style="width: 160px"><span>{t('Target duration (s)')}</span><input name="duration" type="number" value={data.video.targetDuration} /></label><span class="spacer"></span><button>{t('Save brief')}</button></div>
		</form>
	{/if}

	{#if !sb || showCadrage || (!ready && !reviewing && brief.questions.length)}
		<BriefInterview {brief} axes={data.briefAxes} {reviewing} refs={data.videoRefs} scouting={data.scouting} refsHref="/p/{data.project.id}/references" />
	{/if}

	{#if busy}
		<div class="working row"><span class="dot running"></span> {t('The director is working on the storyboard… (log in the Runs column)')}</div>
	{/if}

	{#if sb}
		<section class="hero">
			<p class="logline">{sb.logline}</p>
			{#if sb.summary}
				<p class="summary" class:clamp={!readMore}>{sb.summary}</p>
				<button class="ghost small more" onclick={() => (readMore = !readMore)}><ChevronDown size={14} style="rotate: {readMore ? 180 : 0}deg; transition: rotate 140ms" /> {readMore ? t('Show less') : t('Read more')}</button>
			{/if}
		</section>

		{#if data.shots.length}
			<section class="draft panel pad col">
				<div class="row fwrap">
					<h3>{t('Draft: voice and timing')}</h3>
					<span class="faint small">{t('Before animating: the storyboard images cut to the recorded voice. Seconds to make, no AI cost.')}</span>
					<span class="spacer"></span>
					{#if voiced}
						<select bind:value={voiceName} title={t('Voice')} style="width: auto">{#each data.voices as v (v)}<option value={v}>{v}</option>{/each}</select>
						<button disabled={recording} onclick={() => job({ kind: 'voice_generate', voice: voiceName })} title={t('The whole script read in one take, every word timed, the shots cut to it (Gemini + Groq keys)')}><Mic size={15} /> {data.voice?.current ? t('Re-record voice-over') : t('Record voice-over')}</button>
					{/if}
					<button class:primary={!data.animatic} disabled={cutting || recording} onclick={() => job({ kind: 'animatic' })}><Clapperboard size={15} /> {data.animatic ? t('Rebuild animatic') : t('Build animatic')}</button>
				</div>
				{#if recording || cutting}<div class="row small"><span class="dot running"></span> {recording ? t('Recording the voice-over in one take, then timing every word…') : t('Cutting the animatic…')}</div>{/if}
				{#if data.voice}
					<p class="small faint" style="margin: 0">{t('Voice-over: {v}, {d} s', { v: data.voice.voice, d: data.voice.duration.toFixed(1) })}{#if !data.voice.current} · <span style="color: var(--amber)">{t('the lines changed since the recording: record it again')}</span>{/if}</p>
				{:else if voiced}
					<p class="small faint" style="margin: 0">{t('No voice-over recorded yet: the animatic will be silent.')}</p>
				{/if}
				{#if data.animatic}
					{#key data.animatic.url}<Player src={data.animatic.url} fps={data.video.format.fps} chapters={animChapters} loop={false} />{/key}
				{/if}
			</section>
			<StoryboardStrip {ratio} {vertical} shots={data.shots.map((s) => ({ key: s.key, title: s.title, duration: s.duration, refUrl: s.refUrl, beats: s.data.beats?.length ?? 0 }))} />
		{/if}

		<section class="global">
			<h3>{t('Global notes')}</h3>
			{#each sbNotes.filter((n) => !n.shotKey) as n (n.id)}<NoteItem note={n} />{/each}
			<div class="add"><input placeholder={t('A comment on the whole (pacing, tone, shot order…)')} bind:value={drafts['_global']} onkeydown={(e) => e.key === 'Enter' && addNote(null)} /><button class="icon" onclick={() => addNote(null)} title={t('Add note')}><MessageSquarePlus size={15} /></button></div>
		</section>

		<section class="shots">
			{#each data.shots as s, i (s.id)}
				<ShotCard shot={s} start={starts[i]} {ratio} {vertical} render={renderOf(s.key)} notes={notesFor(s.key)} onnote={(body) => addNote(s.key, body)} />
			{/each}
		</section>
	{:else if !busy}
		<div class="empty">{t('No storyboard yet. The studio doesn’t run without precise instructions: the director analyses the brief, settles what it can infer and asks you about the rest. Once all {n} axes are settled (decided or ignored), start the generation: shot breakdown, beat map (state, cursor, sound) and a reference image per shot.', { n: data.briefAxes.length })}</div>
	{/if}
</div>

<style>
	.sbp { padding: 0 40px 96px; display: grid; gap: 28px; align-content: start; max-width: 1480px; margin: 0 auto; }
	.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; position: sticky; top: 0; z-index: 5; margin: 0 -40px; padding: 14px 40px; background: color-mix(in srgb, var(--bg) 86%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line-soft); }
	.bar form { display: contents; }
	.group { gap: 6px; flex-wrap: wrap; }
	.seg { padding: 2px; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--line); gap: 2px; }
	.seg button.on { background: rgb(255 255 255 / 0.07); color: var(--text); }
	.dotlet { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
	.okd { background: var(--ok); }
	.amd { background: var(--amber); }
	.working { padding: 12px 16px; border-radius: 12px; background: color-mix(in srgb, var(--agent) 7%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--agent) 25%, transparent); font-size: 13px; }

	.hero { display: grid; gap: 12px; max-width: 920px; padding: 20px 0 4px; }
	.logline { margin: 0; font-size: 22px; line-height: 1.4; font-weight: 450; letter-spacing: -0.025em; color: var(--text); text-wrap: pretty; }
	.summary { margin: 0; color: var(--dim); font-size: 14.5px; line-height: 1.7; text-wrap: pretty; }
	.summary.clamp { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
	.more { justify-self: start; margin-left: -8px; color: var(--dim); }

	.draft { gap: 12px; }
	.draft h3 { margin: 0; }
	.fwrap { flex-wrap: wrap; row-gap: 8px; }
	.global { display: grid; gap: 10px; max-width: 920px; }
	.add { display: flex; gap: 6px; }

	.shots { display: grid; gap: 0; }
	.shots > :global(.shot) { padding: 56px 0; border-top: 1px solid var(--line-soft); }
	@media (max-width: 1100px) { .sbp { padding: 0 24px 64px; } .bar { margin: 0 -24px; padding: 12px 24px; } .logline { font-size: 19px; } }
</style>
