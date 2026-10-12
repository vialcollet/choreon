<script lang="ts">
	// The shot's key moments (its beat map) as a timeline. Each diamond is an instant the animation
	// must hit; selecting one spells it out below and tells the card which instant to show.
	import { useI18n } from '$lib/i18n';
	import { MousePointer2, AudioLines } from '@lucide/svelte';
	type Beat = { t: number; state: string; cursor?: string; sound?: string };
	let { beats, duration, start = 0, sel = $bindable(0), hasRender = false, onpick }: { beats: Beat[]; duration: number; start?: number; sel?: number; hasRender?: boolean; onpick?: () => void } = $props();
	const { t } = useI18n();
	let hover = $state<number | null>(null);
	const cur = $derived(hover ?? sel);
	const pos = (x: number) => `${Math.min(100, Math.max(0, (x / (duration || 1)) * 100))}%`;
	const secs = $derived(Array.from({ length: Math.floor(duration) + 1 }, (_, i) => i));
	const every = $derived(duration > 8 ? 2 : 1);
</script>

<section class="bt">
	<div class="head">
		<span class="lbl">{t('Key moments')}</span>
		<span class="help">{hasRender ? t('Click a moment to see the rendered frame at that instant.') : t('Click a moment to read what must happen then. Once the shot is rendered, the image shows that instant.')}</span>
	</div>
	<div class="track">
		{#each secs as s (s)}<span class="sec" style="left: {pos(s)}"></span>{#if s % every === 0}<span class="lab mono" style="left: {pos(s)}">{s}s</span>{/if}{/each}
		{#each beats as b, i (i)}
			{@const next = beats[i + 1]?.t ?? duration}
			<span class="seg" class:on={i === cur} style="left: {pos(b.t)}; width: calc({pos(next)} - {pos(b.t)})"></span>
		{/each}
		<span class="head-line" style="left: {pos(beats[sel]?.t ?? 0)}"></span>
		{#each beats as b, i (i)}
			<button class="tick" class:on={i === cur} class:sel={i === sel} style="left: {pos(b.t)}" title="{b.t.toFixed(2)} s — {b.state}"
				onclick={() => { sel = i; onpick?.(); }} onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)} onfocus={() => (hover = i)} onblur={() => (hover = null)}
				aria-label="{b.t.toFixed(2)} s"></button>
		{/each}
	</div>
	<!-- Every state is laid out in the same cell, only the current one visible: the height never changes. -->
	<div class="states">
		{#each beats as b, i (i)}
			<div class="state" class:shown={i === cur} aria-hidden={i !== cur}>
				<div class="when mono"><b>{i + 1}/{beats.length}</b> · {b.t.toFixed(2)} s <span class="faint">· {t('{t} s in the film', { t: (start + b.t).toFixed(2) })}</span></div>
				<div class="txt">{b.state}</div>
				{#if b.cursor || b.sound}
					<div class="extra small">
						{#if b.cursor}<span><MousePointer2 size={12} /> {b.cursor}</span>{/if}
						{#if b.sound}<span><AudioLines size={12} /> {b.sound}</span>{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>

<style>
	.bt { display: grid; gap: 10px; }
	.head { display: grid; gap: 2px; }
	.lbl { font-size: 10.5px; font-weight: 500; letter-spacing: 0.09em; text-transform: uppercase; color: var(--faint); }
	.help { font-size: 12px; color: var(--faint); }
	.track { position: relative; height: 34px; border-radius: 8px; background: rgb(255 255 255 / 0.03); box-shadow: inset 0 0 0 1px var(--line); margin-bottom: 14px; }
	.sec { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--line-soft); }
	.lab { position: absolute; top: 100%; margin-top: 3px; font-size: 9.5px; color: var(--faint); translate: -50% 0; }
	.seg { position: absolute; top: 0; bottom: 0; transition: background var(--fast) var(--ease); }
	.seg.on { background: color-mix(in srgb, var(--accent) 12%, transparent); }
	.head-line { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: var(--accent); border-radius: 2px; transition: left 160ms var(--ease); pointer-events: none; }
	.tick { position: absolute; top: 50%; width: 12px; height: 12px; min-height: 0; padding: 0; translate: -50% -50%; rotate: 45deg; border-radius: 3px; background: var(--dim); border: 0; cursor: pointer; z-index: 1; transition: background var(--fast) var(--ease), scale var(--fast) var(--ease); }
	.tick:hover:not(:disabled), .tick.on { background: var(--text); scale: 1.2; }
	.tick.sel { background: var(--accent); scale: 1.3; }
	.states { display: grid; }
	.state { grid-area: 1 / 1; display: grid; gap: 4px; visibility: hidden; }
	.state.shown { visibility: visible; }
	.when { font-size: 11.5px; color: var(--accent); }
	.when b { font-weight: 600; }
	.txt { font-size: 13.5px; line-height: 1.5; color: var(--text); }
	.extra { display: flex; flex-wrap: wrap; gap: 6px 16px; color: var(--dim); }
	.extra span { display: inline-flex; gap: 5px; align-items: center; }
</style>
