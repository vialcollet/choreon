<script lang="ts">
	// Overview of the storyboard: the shots at the video's real format, then the film's timeline
	// below, one segment per shot proportional to its duration. Both jump to the shot.
	import { useI18n } from '$lib/i18n';
	type S = { key: string; title: string; duration: number; refUrl: string | null; beats: number };
	let { shots, ratio = '16 / 9', vertical = false }: { shots: S[]; ratio?: string; vertical?: boolean } = $props();
	const { t } = useI18n();
	const total = $derived(shots.reduce((a, s) => a + s.duration, 0));
	const starts = $derived(shots.map((_, i) => shots.slice(0, i).reduce((a, x) => a + x.duration, 0)));
	let hover = $state<string | null>(null);
	const jump = (key: string) => document.getElementById(`shot-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
</script>

<nav class="ov" aria-label={t('Overview')}>
	<div class="thumbs" class:vertical>
		{#each shots as s, i (s.key)}
			<button class="cell" class:on={hover === s.key} onclick={() => jump(s.key)} onmouseenter={() => (hover = s.key)} onmouseleave={() => (hover = null)} title={t('Jump to shot {key}', { key: s.key })}>
				<span class="img" style="aspect-ratio: {ratio}">{#if s.refUrl}<img src={s.refUrl} alt="" loading="lazy" />{/if}</span>
				<span class="meta"><span class="mono key">{s.key}</span><span class="name">{s.title}</span></span>
				<span class="mono tc">{starts[i].toFixed(1)}–{(starts[i] + s.duration).toFixed(1)} s</span>
			</button>
		{/each}
	</div>
	<div class="film">
		<span class="lbl">{t('Film')}</span>
		<div class="bar">
			{#each shots as s (s.key)}
				<button class="seg" class:on={hover === s.key} style="flex: {s.duration} 1 0" onclick={() => jump(s.key)} onmouseenter={() => (hover = s.key)} onmouseleave={() => (hover = null)} title="{s.key} · {s.duration} s"><span class="mono">{s.key}</span></button>
			{/each}
		</div>
		<span class="mono tot">{total.toFixed(1)} s</span>
	</div>
</nav>

<style>
	.ov { display: grid; gap: 14px; }
	.thumbs { display: flex; gap: 12px; overflow-x: auto; padding: 4px 4px 6px; margin: -4px -4px 0; }
	.cell { display: grid; gap: 6px; flex: 0 0 auto; width: 188px; padding: 0; min-height: 0; background: none; border: 0; border-radius: 0; text-align: left; justify-content: stretch; align-items: start; white-space: normal; }
	.thumbs.vertical .cell { width: 96px; }
	.cell:hover:not(:disabled) { background: none; }
	.img { display: block; border-radius: 8px; overflow: hidden; background: var(--bg-deep); box-shadow: 0 0 0 1px var(--line); transition: box-shadow var(--fast) var(--ease), translate var(--fast) var(--ease); }
	.img img { width: 100%; height: 100%; object-fit: contain; display: block; }
	.cell.on .img { box-shadow: 0 0 0 2px var(--accent); }
	.meta { display: flex; gap: 6px; min-width: 0; font-size: 12px; }
	.key { color: var(--faint); font-size: 11px; flex: none; }
	.name { color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
	.cell.on .name { color: var(--text); }
	.tc { font-size: 10.5px; color: var(--faint); margin-top: -3px; }
	.film { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; }
	.lbl { font-size: 10.5px; font-weight: 500; letter-spacing: 0.09em; text-transform: uppercase; color: var(--faint); }
	.bar { display: flex; gap: 2px; height: 22px; }
	.seg { min-width: 0; min-height: 0; padding: 0 6px; border: 0; border-radius: 4px; background: rgb(255 255 255 / 0.06); justify-content: flex-start; font-size: 10.5px; color: var(--faint); overflow: hidden; }
	.seg.on, .seg:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 30%, transparent); color: var(--text); }
	.tot { font-size: 11px; color: var(--faint); }
</style>
