<script lang="ts">
	// A/B comparison of two renders, frame-locked: one transport drives both videos (A is the
	// master clock, B follows within half a frame). Side by side, or a wipe over a single frame.
	import { onDestroy } from 'svelte';
	import { Play, Pause, StepBack, StepForward, Repeat, Columns2, SplitSquareHorizontal, X } from '@lucide/svelte';
	import { useI18n } from '$lib/i18n';

	type Side = { url: string; label: string; score: number | null; pass: boolean | null; sound: string | null };
	type Axis = { key: string; label: string; weight?: number };
	let {
		a,
		b,
		fps = 30,
		axes = [],
		scoresA = null,
		scoresB = null,
		options = [],
		bValue,
		onpickb,
		onexit
	}: {
		a: Side;
		b: Side;
		fps?: number;
		axes?: Axis[];
		scoresA?: Record<string, number> | null;
		scoresB?: Record<string, number> | null;
		options?: { value: number; label: string }[];
		bValue: number;
		onpickb?: (v: number) => void;
		onexit?: () => void;
	} = $props();

	const { t: tr } = useI18n();

	let va: HTMLVideoElement | undefined = $state();
	let vb: HTMLVideoElement | undefined = $state();
	let stage: HTMLDivElement | undefined = $state();
	let mode = $state<'side' | 'wipe'>('side');
	let t = $state(0);
	let dur = $state(0);
	let playing = $state(false);
	let loop = $state(true);
	let split = $state(0.5);
	let dragging = $state(false);
	let raf = 0;

	const frame = $derived(Math.round(t * fps));

	/** Keeps B on A's clock (within half a frame) while playing. */
	function follow() {
		if (va && vb) {
			const target = Math.min(va.currentTime, (vb.duration || Infinity) - 0.001);
			if (Math.abs(vb.currentTime - target) > 0.5 / fps) vb.currentTime = target;
			t = va.currentTime;
		}
		if (playing) raf = requestAnimationFrame(follow);
	}

	export function seek(time: number) {
		if (!va || !vb) return;
		pause();
		const x = Math.max(0, Math.min(time, dur || time));
		va.currentTime = x;
		vb.currentTime = vb.duration ? Math.min(x, vb.duration - 0.001) : x;
		t = x;
	}

	function pause() {
		va?.pause();
		vb?.pause();
		playing = false;
		if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf);
	}

	async function toggle() {
		if (!va || !vb) return;
		if (playing) return pause();
		vb.currentTime = va.currentTime;
		playing = true;
		await Promise.allSettled([va.play(), vb.play()]);
		raf = requestAnimationFrame(follow);
	}

	const step = (n: number) => seek(t + n / fps);

	function ended() {
		if (loop) {
			seek(0);
			toggle();
		} else pause();
	}

	// A new B (or A) source: back to the start, paused.
	$effect(() => {
		void a.url;
		void b.url;
		pause();
		t = 0;
	});

	// onDestroy also runs during SSR, where there is no animation frame to cancel.
	onDestroy(() => typeof cancelAnimationFrame !== 'undefined' && cancelAnimationFrame(raf));

	function key(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement).tagName;
		if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
		if (e.key === ' ') { e.preventDefault(); toggle(); }
		else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -10 : -1); }
		else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 10 : 1); }
		else if (e.key === 'w') mode = mode === 'wipe' ? 'side' : 'wipe';
	}

	function scrub(e: PointerEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		seek(((e.clientX - r.left) / r.width) * dur);
	}

	function wipeTo(e: PointerEvent) {
		if (!stage) return;
		const r = stage.getBoundingClientRect();
		split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
	}

	// Weighted overall + per-axis delta (A − B: positive means A is better).
	const rows = $derived(
		scoresA && scoresB
			? axes.map((x) => ({ key: x.key, label: x.label, a: scoresA[x.key] ?? null, b: scoresB[x.key] ?? null }))
			: []
	);
	const fmt = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
</script>

<svelte:window onkeydown={key} />

{#snippet tag(side: Side, letter: string)}
	<span class="tag" class:b={letter === 'B'}>
		<b>{letter}</b>
		<span>{side.label}</span>
		{#if side.sound}<span class="faint">♪ {side.sound}</span>{/if}
		{#if side.score != null}<span class="mono" class:ok={side.pass} class:amber={side.pass === false}>{side.score.toFixed(1)}{side.pass ? ' ✓' : ''}</span>{/if}
	</span>
{/snippet}

<div class="compare">
	<div class="bar row">
		<div class="seg">
			<button class="small" class:on={mode === 'side'} onclick={() => (mode = 'side')} title={tr('Side by side')}><Columns2 size={14} /> {tr('Side by side')}</button>
			<button class="small" class:on={mode === 'wipe'} onclick={() => (mode = 'wipe')} title={tr('Wipe (w)')}><SplitSquareHorizontal size={14} /> {tr('Wipe')}</button>
		</div>
		<span class="spacer"></span>
		<label class="pick"><span>B</span>
			<select value={bValue} onchange={(e) => onpickb?.(Number((e.target as HTMLSelectElement).value))}>
				{#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
			</select>
		</label>
		<button class="small ghost" onclick={() => onexit?.()} title={tr('Exit comparison (Esc)')}><X size={14} /> {tr('Exit')}</button>
	</div>

	{#if mode === 'side'}
		<div class="pair">
			<figure>
				<!-- svelte-ignore a11y_media_has_caption -->
				<video bind:this={va} src={a.url} preload="auto" bind:duration={dur} onended={ended} onclick={toggle}></video>
				{@render tag(a, 'A')}
			</figure>
			<figure>
				<!-- svelte-ignore a11y_media_has_caption -->
				<video bind:this={vb} src={b.url} preload="auto" muted onclick={toggle}></video>
				{@render tag(b, 'B')}
			</figure>
		</div>
	{:else}
		<div class="wipe" bind:this={stage} role="presentation"
			onpointerdown={(e) => { dragging = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); wipeTo(e); }}
			onpointermove={(e) => dragging && wipeTo(e)}
			onpointerup={() => (dragging = false)}>
			<!-- svelte-ignore a11y_media_has_caption -->
			<video bind:this={va} src={a.url} preload="auto" bind:duration={dur} onended={ended}></video>
			<!-- svelte-ignore a11y_media_has_caption -->
			<video bind:this={vb} class="top" src={b.url} preload="auto" muted style="clip-path: inset(0 0 0 {split * 100}%)"></video>
			<div class="handle" style="left: {split * 100}%"><span></span></div>
			<div class="corner l">{@render tag(a, 'A')}</div>
			<div class="corner r">{@render tag(b, 'B')}</div>
		</div>
	{/if}

	<div class="timeline" role="slider" aria-valuenow={t} tabindex="-1" onpointerdown={scrub}>
		<div class="fill" style="width: {dur ? (t / dur) * 100 : 0}%"></div>
		<div class="head" style="left: {dur ? (t / dur) * 100 : 0}%"></div>
	</div>

	<div class="controls row">
		<button class="ghost icon" onclick={() => step(-1)} title={tr('Previous frame (←)')}><StepBack size={16} /></button>
		<button class="icon play" onclick={toggle} title={tr('Play / pause (space)')}>{#if playing}<Pause size={16} />{:else}<Play size={16} />{/if}</button>
		<button class="ghost icon" onclick={() => step(1)} title={tr('Next frame (→)')}><StepForward size={16} /></button>
		<span class="tc mono">{tr('{t} s · frame {f}', { t: t.toFixed(2), f: frame })}</span>
		<span class="faint small mono">/ {dur.toFixed(2)} s</span>
		<button class="ghost icon small" class:on={loop} onclick={() => (loop = !loop)} title={tr('Loop')}><Repeat size={14} /></button>
		<span class="spacer"></span>
		<span class="faint small">{tr('Frame-locked · c: compare · w: wipe · Esc: exit')}</span>
	</div>

	{#if rows.length}
		<table class="delta">
			<thead><tr><th>{tr('Axis')}</th><th class="n">A</th><th class="n">B</th><th class="n">Δ A−B</th></tr></thead>
			<tbody>
				{#each rows as r (r.key)}
					{@const d = r.a != null && r.b != null ? r.a - r.b : null}
					<tr>
						<td>{r.label}</td>
						<td class="n mono">{r.a ?? '—'}</td>
						<td class="n mono">{r.b ?? '—'}</td>
						<td class="n mono" class:up={d != null && d > 0} class:down={d != null && d < 0}>{d == null ? '—' : d === 0 ? '0' : fmt(d)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="faint small" style="margin: 0">{tr('Evaluate both renders to compare their scores.')}</p>
	{/if}
</div>

<style>
	.compare { display: grid; gap: 10px; min-width: 0; }
	.bar { flex-wrap: wrap; row-gap: 6px; }
	.seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 9px; background: var(--bg-deep); border: 1px solid var(--line); }
	.seg button { border-color: transparent; background: transparent; }
	.seg button.on { background: var(--raise); border-color: var(--line-strong); color: #fff; }
	.pick { display: flex; align-items: center; gap: 6px; }
	.pick span { font-weight: 600; color: var(--text); font-size: 12px; }
	.pick select { width: auto; min-height: 28px; font-size: 12.5px; padding-top: 2px; padding-bottom: 2px; }

	.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
	figure { position: relative; margin: 0; background: #000; border-radius: 12px; overflow: hidden; box-shadow: 0 0 0 1px var(--line); display: grid; place-items: center; }
	figure video { width: 100%; max-height: calc(100vh - 520px); min-height: 140px; object-fit: contain; cursor: pointer; }
	figure .tag { position: absolute; left: 10px; top: 10px; }

	.wipe { position: relative; display: grid; background: #000; border-radius: 12px; overflow: hidden; box-shadow: 0 0 0 1px var(--line); cursor: ew-resize; user-select: none; touch-action: none; }
	.wipe video { grid-area: 1 / 1; width: 100%; max-height: calc(100vh - 500px); min-height: 200px; object-fit: contain; pointer-events: none; }
	.handle { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4); pointer-events: none; }
	.handle span { position: absolute; top: 50%; left: 50%; width: 22px; height: 22px; translate: -50% -50%; border-radius: 99px; background: #fff; box-shadow: 0 2px 10px rgb(0 0 0 / 0.5); }
	.corner { position: absolute; top: 10px; pointer-events: none; }
	.corner.l { left: 10px; }
	.corner.r { right: 10px; }

	.tag { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 99px; font-size: 11.5px; background: rgb(0 0 0 / 0.72); backdrop-filter: blur(6px); color: var(--text); white-space: nowrap; }
	.tag b { font-weight: 700; color: var(--accent); }
	.tag.b b { color: #fff; }
	.tag .ok { color: var(--ok); }
	.tag .amber { color: var(--amber); }

	.timeline { position: relative; height: 26px; background: var(--bg-deep); border: 1px solid var(--line); border-radius: 8px; cursor: pointer; overflow: hidden; }
	.fill { position: absolute; inset: 0 auto 0 0; background: rgb(255 255 255 / 0.06); pointer-events: none; }
	.head { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--accent); pointer-events: none; }
	.controls { flex-wrap: wrap; row-gap: 6px; gap: 4px; }
	.play { width: 36px; min-height: 36px; border-radius: 99px; background: var(--text); color: var(--bg); border: 0; }
	.play:hover:not(:disabled) { background: #fff; color: var(--bg); }
	.tc { font-size: 12.5px; padding: 0 6px 0 8px; white-space: nowrap; }
	.on { color: var(--ok); }
	.seg .on { color: #fff; }

	.delta { width: 100%; max-width: 520px; border-collapse: collapse; font-size: 12.5px; }
	.delta th { text-align: left; font-weight: 500; color: var(--faint); font-size: 11px; padding: 4px 8px; border-bottom: 1px solid var(--line); }
	.delta td { padding: 4px 8px; border-bottom: 1px solid var(--line-soft); }
	.delta .n { text-align: right; width: 64px; }
	.delta .up { color: var(--ok); }
	.delta .down { color: var(--err); }
</style>
