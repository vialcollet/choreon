<script lang="ts">
	import { useI18n } from '$lib/i18n';

	const { t } = useI18n();
	type Axis = { key: string; label: string; threshold: number; required: boolean };
	type Finding = { t?: number | null; axis: string; severity: string; problem: string; fix: string };
	type Ev = { round: number; scores: Record<string, number>; pass: boolean; findings: Finding[]; summary: string; createdAt: number };
	let { ev, axes, onseek }: { ev: Ev; axes: (Axis & { weight?: number })[]; onseek?: (t: number) => void } = $props();
	// Overall score weighted by the project's grid weights.
	const overall = $derived.by(() => {
		let sw = 0, s = 0;
		for (const a of axes) {
			const w = a.weight ?? 1;
			sw += w;
			s += w * (ev.scores[a.key] ?? 0);
		}
		return sw ? s / sw : 0;
	});
</script>

<div class="col">
	<div class="row">
		{#if ev.pass}<span class="chip ok">{t('approved')}</span>{:else}<span class="chip amber">{t('below thresholds')}</span>{/if}
		<span class="faint small">{t('round {n}', { n: ev.round + 1 })}</span>
		<span class="spacer"></span>
		<span class="mono" title={t('Weighted overall score')}>{overall.toFixed(1)}<span class="faint">/10</span></span>
	</div>
	<div class="bars">
		{#each axes as a (a.key)}
			{@const s = ev.scores[a.key] ?? 0}
			<div class="bar" title={a.label}>
				<span class="small lbl">{a.label}</span>
				<div class="track">
					<div class="val" class:low={s < a.threshold} style="width: {s * 10}%"></div>
					<div class="thr" style="left: {a.threshold * 10}%"></div>
				</div>
				<span class="mono small">{s}</span>
			</div>
		{/each}
	</div>
	{#if ev.summary}<p class="small dim" style="margin: 0">{ev.summary}</p>{/if}
	{#each ev.findings as f, i (i)}
		<div class="finding">
			<div class="row fwrap" style="gap: 4px">
				<span class="chip" class:err={f.severity === 'blocking'} class:amber={f.severity === 'major'}>{f.severity}</span>
				<span class="chip">{f.axis}</span>
				{#if f.t != null}<button class="chip ghost" onclick={() => onseek?.(f.t!)}>{Number(f.t).toFixed(2)} s</button>{/if}
			</div>
			<div class="small">{f.problem}</div>
			<div class="small faint">→ {f.fix}</div>
		</div>
	{/each}
</div>

<style>
	.bars { display: grid; gap: 4px; }
	.bar { display: grid; grid-template-columns: 130px 1fr 24px; gap: 8px; align-items: center; }
	.lbl { color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.track { position: relative; height: 8px; background: var(--bg-deep); border-radius: 4px; }
	.val { position: absolute; inset: 0 auto 0 0; background: var(--ok); border-radius: 4px; }
	.val.low { background: var(--amber); }
	.thr { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--text); opacity: 0.6; }
	.finding { display: grid; gap: 3px; padding: 8px; border: 1px solid var(--line-soft); border-radius: 6px; background: var(--bg-deep); }
	.chip.ghost { background: transparent; cursor: pointer; }
</style>
