<script lang="ts">
	// One storyboard shot, image first: the reference frame large, then intent, on-screen text,
	// the beat map as a timeline; the long visual description and the rest behind "Details".
	import NoteItem from '$lib/components/NoteItem.svelte';
	import BeatTimeline from './BeatTimeline.svelte';
	import { useI18n } from '$lib/i18n';
	import { MessageSquarePlus, ChevronDown } from '@lucide/svelte';
	import type { ComponentProps } from 'svelte';
	import type { ShotData } from '$lib/types';

	type Note = ComponentProps<typeof NoteItem>['note'] & { status: string };
	let {
		shot,
		start,
		ratio = '16 / 9',
		vertical = false,
		render = null,
		notes,
		onnote
	}: { shot: { key: string; title: string; duration: number; refUrl: string | null; data: ShotData }; start: number; ratio?: string; vertical?: boolean; render?: { url: string; version: number } | null; notes: Note[]; onnote: (body: string) => void } = $props();
	const { t } = useI18n();

	// The image follows the selected key moment: the rendered frame at that instant when the shot has
	// a render, the storyboard reference otherwise (or on demand).
	let beat = $state(0);
	let touched = $state(false);
	let view = $state<'ref' | 'render'>('ref');
	let video: HTMLVideoElement | undefined = $state();
	const at = $derived(shot.data.beats?.[beat]?.t ?? 0);
	$effect(() => {
		void beat;
		if (touched && render) view = 'render';
	});
	$effect(() => {
		if (video && view === 'render') {
			const go = () => { if (video) video.currentTime = Math.min(at, Math.max(0, (video.duration || shot.duration) - 0.02)); };
			if (video.readyState >= 1) go();
			else video.addEventListener('loadedmetadata', go, { once: true });
		}
	});
	let details = $state(false);
	let draft = $state('');
	function send() {
		const body = draft.trim();
		if (!body) return;
		draft = '';
		onnote(body);
	}
	const open = $derived(notes.filter((n) => n.status === 'open').length);
</script>

<article class="shot" class:vertical id="shot-{shot.key}">
	<div class="frame" style="aspect-ratio: {ratio}">
		{#if view === 'render' && render}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video bind:this={video} src={render.url} muted preload="auto" playsinline></video>
		{:else if shot.refUrl}<img src={shot.refUrl} alt={t('reference {key}', { key: shot.key })} />{:else}<div class="noref faint small">{t('no reference image')}</div>{/if}
		<span class="badge mono">{shot.key}</span>
		<span class="what mono">{view === 'render' && render ? t('render {n} · {t} s', { n: render.version, t: at.toFixed(2) }) : t('storyboard reference')}</span>
		{#if render}
			<div class="switch">
				<button class:on={view === 'ref'} onclick={() => (view = 'ref')}>{t('Reference')}</button>
				<button class:on={view === 'render'} onclick={() => (view = 'render')}>{t('Render')}</button>
			</div>
		{/if}
	</div>

	<div class="body">
		<header>
			<div class="kicker mono">{shot.key} · {start.toFixed(1)}–{(start + shot.duration).toFixed(1)} s</div>
			<div class="row title"><h2>{shot.title}</h2><span class="spacer"></span><span class="dur mono">{shot.duration} s</span></div>
		</header>

		<p class="intent">{shot.data.intent}</p>

		{#if shot.data.onScreenText}<blockquote class="quote">{shot.data.onScreenText}</blockquote>{/if}

		{#if shot.data.beats?.length}<BeatTimeline beats={shot.data.beats} duration={shot.duration} {start} hasRender={!!render} bind:sel={beat} onpick={() => (touched = true)} />{/if}

		<button class="ghost small more" onclick={() => (details = !details)} aria-expanded={details}>
			<ChevronDown size={14} style="rotate: {details ? 180 : 0}deg; transition: rotate 140ms" /> {details ? t('Hide details') : t('Details')}
		</button>
		{#if details}
			<div class="details">
				<div class="field"><span class="lbl">{t('Visual')}</span><p>{shot.data.visual}</p></div>
				{#if shot.data.voiceover}<div class="field"><span class="lbl">{t('Voice')}</span><p>{shot.data.voiceover}</p></div>{/if}
				{#if shot.data.sound}<div class="field"><span class="lbl">{t('Sound')}</span><p>{shot.data.sound}</p></div>{/if}
				{#if shot.data.beats?.length}
					<div class="field">
						<span class="lbl">{t('Beat map')}</span>
						<table class="beatmap"><thead><tr><th>t</th><th>{t('State')}</th><th>{t('Cursor')}</th><th>{t('Sound')}</th></tr></thead><tbody>{#each shot.data.beats as b, i (i)}<tr><td class="mono faint">{b.t.toFixed(2)} s</td><td>{b.state}</td><td class="dim">{b.cursor ?? ''}</td><td class="dim">{b.sound ?? ''}</td></tr>{/each}</tbody></table>
					</div>
				{/if}
			</div>
		{/if}

		<div class="notes">
			{#each notes as n (n.id)}<NoteItem note={n} />{/each}
			<div class="add">
				<input placeholder={t('Annotate this shot…')} bind:value={draft} onkeydown={(e) => e.key === 'Enter' && send()} />
				<button class="icon" onclick={send} title={t('Add note')} disabled={!draft.trim()}><MessageSquarePlus size={15} /></button>
			</div>
			{#if open}<span class="faint small">{open > 1 ? t('{n} open notes', { n: open }) : t('{n} open note', { n: open })}</span>{/if}
		</div>
	</div>
</article>

<style>
	.shot { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 1fr); gap: 40px; align-items: start; scroll-margin-top: 24px; }
	.frame { position: relative; border-radius: 14px; overflow: hidden; background: #000; box-shadow: 0 0 0 1px var(--line), 0 24px 60px rgb(0 0 0 / 0.35); max-height: 72vh; justify-self: stretch; }
	.frame img, .frame video { width: 100%; height: 100%; object-fit: contain; display: block; }
	.shot.vertical { grid-template-columns: minmax(0, 0.8fr) minmax(320px, 1fr); }
	.shot.vertical .frame { max-height: 78vh; justify-self: center; width: auto; height: min(78vh, 760px); }
	.what { position: absolute; left: 12px; bottom: 12px; font-size: 11px; padding: 2px 8px; border-radius: 99px; background: rgb(0 0 0 / 0.6); backdrop-filter: blur(6px); color: #fff; }
	.switch { position: absolute; right: 12px; top: 12px; display: flex; padding: 2px; border-radius: 99px; background: rgb(0 0 0 / 0.6); backdrop-filter: blur(6px); }
	.switch button { min-height: 24px; padding: 0 10px; font-size: 11.5px; border: 0; border-radius: 99px; background: transparent; color: rgb(255 255 255 / 0.7); }
	.switch button.on { background: rgb(255 255 255 / 0.16); color: #fff; }
	.noref { width: 100%; height: 100%; display: grid; place-items: center; background: var(--bg-deep); }
	.badge { position: absolute; left: 12px; top: 12px; font-size: 11px; padding: 2px 8px; border-radius: 99px; background: rgb(0 0 0 / 0.6); backdrop-filter: blur(6px); color: #fff; }
	.body { display: grid; gap: 18px; min-width: 0; padding-top: 4px; }
	header { display: grid; gap: 4px; }
	.kicker { font-size: 11px; color: var(--faint); letter-spacing: 0.02em; }
	.title h2 { font-size: 22px; letter-spacing: -0.025em; line-height: 1.2; }
	.dur { color: var(--dim); font-size: 12px; padding: 2px 8px; border-radius: 99px; box-shadow: inset 0 0 0 1px var(--line); }
	.intent { margin: 0; color: var(--dim); font-size: 14px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
	.quote { margin: 0; padding: 2px 0 2px 16px; border-left: 2px solid var(--accent); font-size: 17px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.35; color: var(--text); }
	.more { justify-self: start; margin-left: -8px; color: var(--dim); }
	.details { display: grid; gap: 14px; padding: 16px; border-radius: 12px; background: rgb(255 255 255 / 0.02); box-shadow: inset 0 0 0 1px var(--line-soft); }
	.field { display: grid; gap: 4px; }
	.lbl { font-size: 10.5px; font-weight: 500; letter-spacing: 0.09em; text-transform: uppercase; color: var(--faint); }
	.field p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dim); white-space: pre-wrap; }
	.beatmap { width: 100%; border-collapse: collapse; font-size: 12.5px; }
	.beatmap th { text-align: left; font-weight: 500; color: var(--faint); font-size: 11px; padding: 2px 6px 2px 0; }
	.beatmap td { padding: 4px 6px 4px 0; vertical-align: top; border-top: 1px solid var(--line-soft); }
	.beatmap td:first-child { white-space: nowrap; width: 56px; }
	.notes { display: grid; gap: 8px; padding-top: 14px; border-top: 1px solid var(--line-soft); }
	.add { display: flex; gap: 6px; }
	@media (max-width: 1100px) { .shot { grid-template-columns: 1fr; gap: 20px; } }
</style>
