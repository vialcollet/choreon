<script lang="ts">
	import { Play, Pause, StepBack, StepForward, SquareDashedMousePointer, Repeat } from '@lucide/svelte';
	import type { Region } from '$lib/types';
	import { useI18n } from '$lib/i18n';

	const { t: tr } = useI18n();

	type Marker = { t: number; kind: 'note' | 'finding'; label: string };
	/** A chapter of the timeline (a shot of the edit): ticks on the bar, its name while it plays. */
	type Chapter = { t: number; key: string; label: string };
	let {
		src,
		fps = 30,
		markers = [],
		chapters = [],
		audio = null,
		loop: loopDefault = true,
		ontime,
		onannotate
	}: {
		src: string;
		fps?: number;
		markers?: Marker[];
		chapters?: Chapter[];
		/** A soundtrack played in sync with a silent video (a shot heard with the edit's sound): source + where the shot starts in it. */
		audio?: { src: string; offset: number } | null;
		loop?: boolean;
		ontime?: (t: number) => void;
		onannotate?: (a: { t: number; region: Region | null; body: string }) => Promise<void> | void;
	} = $props();

	let video: HTMLVideoElement | undefined = $state();
	let stage: HTMLDivElement | undefined = $state();
	let t = $state(0);
	let dur = $state(0);
	let playing = $state(false);
	// svelte-ignore state_referenced_locally
	let loop = $state(loopDefault);
	let sound: HTMLAudioElement | undefined = $state();
	let annotate = $state(false);
	let drag = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
	let region = $state<Region | null>(null);
	let body = $state('');
	let saving = $state(false);
	let input: HTMLTextAreaElement | undefined = $state();

	export function seek(time: number) {
		if (!video) return;
		video.pause();
		video.currentTime = Math.max(0, Math.min(time, dur || time));
	}
	/** Jumps to a moment and keeps playing (the edit's shots, clicked from the timeline below the player). */
	export function playFrom(time: number) {
		if (!video) return;
		video.currentTime = Math.max(0, Math.min(time, dur || time));
		annotate = false;
		region = null;
		video.play().catch(() => {});
	}

	// The external soundtrack follows the picture: same play/pause, re-synced on every seek, loop and drift.
	const resync = () => {
		if (!sound || !video || !audio) return;
		const want = audio.offset + video.currentTime;
		if (Math.abs(sound.currentTime - want) > 0.08) sound.currentTime = want;
	};
	function onPlay() {
		playing = true;
		if (sound && audio) { resync(); sound.play().catch(() => {}); }
	}
	function onPause() {
		playing = false;
		sound?.pause();
	}
	$effect(() => {
		ontime?.(t);
		if (playing) resync();
	});
	const chapter = $derived(chapters.length ? [...chapters].reverse().find((c) => t + 1e-3 >= c.t) ?? null : null);

	$effect(() => {
		void src;
		t = 0;
		region = null;
		annotate = false;
	});

	function toggle() {
		if (!video) return;
		if (video.paused) {
			annotate = false;
			region = null;
			video.play().catch(() => {});
		} else video.pause();
	}
	const step = (n: number) => seek(t + n / fps);

	function startAnnotate() {
		video?.pause();
		annotate = true;
		region = null;
		body = '';
	}

	function rel(e: PointerEvent) {
		const r = stage!.getBoundingClientRect();
		return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
	}
	function down(e: PointerEvent) {
		if (!annotate) return;
		const p = rel(e);
		drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!drag) return;
		const p = rel(e);
		drag.x1 = p.x;
		drag.y1 = p.y;
	}
	function up() {
		if (!drag) return;
		const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
		const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
		region = w > 0.01 && h > 0.01 ? { x, y, w, h } : null;
		drag = null;
		setTimeout(() => input?.focus(), 0);
	}

	async function save() {
		if (!body.trim() || !onannotate) return;
		saving = true;
		try {
			await onannotate({ t, region, body: body.trim() });
			annotate = false;
			region = null;
			body = '';
		} finally {
			saving = false;
		}
	}

	function key(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement).tagName;
		if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
		if (e.key === ' ') { e.preventDefault(); toggle(); }
		else if (e.key === 'ArrowLeft') step(e.shiftKey ? -10 : -1);
		else if (e.key === 'ArrowRight') step(e.shiftKey ? 10 : 1);
		else if (e.key === 'a') startAnnotate();
		else if (e.key === 'Escape') { annotate = false; region = null; }
	}

	const shown = $derived(drag ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : region);
	const frame = $derived(Math.round(t * fps));
</script>

<svelte:window onkeydown={key} />

<div class="player">
	<div class="stage" bind:this={stage} class:annotating={annotate} onpointerdown={down} onpointermove={move} onpointerup={up} role="presentation">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={video} {src} {loop} preload="auto" bind:currentTime={t} bind:duration={dur} onplay={onPlay} onpause={onPause} onseeked={resync} onclick={() => !annotate && toggle()}></video>
		{#if audio}<audio bind:this={sound} src={audio.src} preload="auto"></audio>{/if}
		{#if shown}<div class="box" style="left: {shown.x * 100}%; top: {shown.y * 100}%; width: {shown.w * 100}%; height: {shown.h * 100}%"></div>{/if}
		{#if annotate && !drag}
			<div class="hint small">{region ? tr('Area selected') : tr('Draw a box on the area (optional), then write your note')}</div>
		{/if}
	</div>

	<div class="timeline" role="slider" aria-valuenow={t} tabindex="-1" onpointerdown={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur); }}>
		<div class="fill" style="width: {dur ? (t / dur) * 100 : 0}%"></div>
		<div class="head" style="left: {dur ? (t / dur) * 100 : 0}%"></div>
		{#each chapters as c, i (c.key)}
			{#if i > 0}<span class="ch" style="left: {dur ? (c.t / dur) * 100 : 0}%"></span>{/if}
			<span class="chl mono" class:cur={chapter?.key === c.key} style="left: {dur ? (c.t / dur) * 100 : 0}%; width: {dur ? (((chapters[i + 1]?.t ?? dur) - c.t) / dur) * 100 : 0}%">{c.key}</span>
		{/each}
		{#each markers as m, i (i)}
			<button class="mk {m.kind}" style="left: {dur ? (m.t / dur) * 100 : 0}%" title="{m.t.toFixed(2)} s — {m.label}" onpointerdown={(e) => { e.stopPropagation(); seek(m.t); }}></button>
		{/each}
	</div>

	<div class="controls row">
		<button class="ghost icon" onclick={() => step(-1)} title={tr('Previous frame (←)')}><StepBack size={16} /></button>
		<button class="icon play" onclick={toggle} title={tr('Play / pause (space)')}>{#if playing}<Pause size={16} />{:else}<Play size={16} />{/if}</button>
		<button class="ghost icon" onclick={() => step(1)} title={tr('Next frame (→)')}><StepForward size={16} /></button>
		<span class="tc mono">{tr('{t} s · frame {f}', { t: t.toFixed(2), f: frame })}</span>
		<span class="faint small mono">/ {dur.toFixed(2)} s</span>
		{#if chapter}<span class="small chname" title={chapter.label}><b class="mono">{chapter.key}</b> {chapter.label}</span>{/if}
		<button class="ghost icon small" class:on={loop} onclick={() => (loop = !loop)} title={tr('Loop')}><Repeat size={14} /></button>
		<span class="spacer"></span>
		{#if onannotate}
			<button class:accent={!annotate} onclick={startAnnotate} title={tr('Annotate this moment (a)')}><SquareDashedMousePointer size={15} /> {tr('Annotate at {t} s', { t: t.toFixed(2) })}</button>
		{/if}
	</div>

	{#if annotate}
		<div class="compose col">
			<textarea bind:this={input} bind:value={body} rows="3" placeholder={tr('What’s wrong at this moment, and what you want instead…')} onkeydown={(e) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey) ? save() : null)}></textarea>
			<div class="row">
				<span class="faint small">{region ? tr('area {w}×{h} %', { w: Math.round(region.w * 100), h: Math.round(region.h * 100) }) : tr('whole frame')} · {tr('Ctrl+Enter to save')}</span>
				<span class="spacer"></span>
				<button class="ghost" onclick={() => { annotate = false; region = null; }}>{tr('Cancel')}</button>
				<button class="primary" disabled={!body.trim() || saving} onclick={save}>{saving ? tr('Saving…') : tr('Save note')}</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.player { display: grid; gap: 10px; min-width: 0; }
	.controls { flex-wrap: wrap; row-gap: 6px; gap: 4px; }
	.stage { position: relative; background: #000; border-radius: 12px; overflow: hidden; user-select: none; display: grid; place-items: center; box-shadow: 0 0 0 1px var(--line); }
	.stage video { width: 100%; max-height: calc(100vh - 500px); min-height: 200px; object-fit: contain; }
	.stage.annotating { cursor: crosshair; box-shadow: 0 0 0 2px var(--mark); }
	.stage.annotating video { pointer-events: none; }
	.box { position: absolute; border: 2px solid var(--mark); background: color-mix(in srgb, var(--mark) 12%, transparent); pointer-events: none; border-radius: 3px; }
	.hint { position: absolute; left: 12px; top: 12px; background: rgb(0 0 0 / 0.72); backdrop-filter: blur(6px); padding: 4px 10px; border-radius: 99px; }
	.ch { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--line-strong); pointer-events: none; }
	.chl { position: absolute; top: 0; height: 100%; padding: 0 4px; display: flex; align-items: center; color: var(--faint); font-size: 10px; overflow: hidden; white-space: nowrap; pointer-events: none; }
	.chl.cur { color: var(--text); background: rgb(255 255 255 / 0.05); }
	.chname { color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
	.timeline { position: relative; height: 26px; background: var(--bg-deep); border: 1px solid var(--line); border-radius: 8px; cursor: pointer; overflow: hidden; }
	.fill { position: absolute; inset: 0 auto 0 0; background: rgb(255 255 255 / 0.06); pointer-events: none; }
	.head { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--accent); pointer-events: none; z-index: 2; }
	.mk { position: absolute; top: 5px; width: 8px; height: 14px; min-height: 0; margin-left: -4px; padding: 0; border-radius: 2px; border: 0; z-index: 1; }
	.mk.note { background: var(--mark); }
	.mk.finding { background: var(--amber); top: 8px; height: 8px; }
	.on { color: var(--ok); }
	.play { width: 36px; min-height: 36px; border-radius: 99px; background: var(--text); color: var(--bg); border: 0; }
	.play:hover:not(:disabled) { background: #fff; color: var(--bg); }
	.tc { font-size: 12.5px; padding: 0 6px 0 8px; white-space: nowrap; }
	.controls .mono { white-space: nowrap; }
	.compose { background: var(--panel); border: 1px solid color-mix(in srgb, var(--mark) 60%, transparent); border-radius: 12px; padding: 12px; }
</style>
