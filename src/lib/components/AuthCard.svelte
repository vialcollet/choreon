<script lang="ts">
	import type { Snippet } from 'svelte';
	import Logo from './Logo.svelte';
	import { useI18n } from '$lib/i18n';

	let { title, subtitle = '', children }: { title: string; subtitle?: string; children: Snippet } = $props();
	const { t } = useI18n();
</script>

<div class="split">
	<section class="stage" aria-hidden="true">
		<div class="grid"></div>
		<div class="trail">
			<span class="k k1"></span><span class="k k2"></span><span class="k k3"></span>
		</div>
		<div class="tc mono">00:00:04:12</div>
		<div class="pitch">
			<p class="line">{t('You direct.')}<br /><em>{t('Choreon animates.')}</em></p>
			<p class="dim">{t('An open-source motion design studio: brief, storyboard, shots in code, critique, edit and sound.')}</p>
		</div>
	</section>
	<section class="side">
		<div class="card">
			<div class="brand"><Logo size={26} /></div>
			<h1>{title}</h1>
			{#if subtitle}<p class="dim small sub">{subtitle}</p>{/if}
			{@render children()}
		</div>
	</section>
</div>

<style>
	.split { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(380px, 1fr); }
	.stage { position: relative; overflow: hidden; background: var(--bg-deep); border-right: 1px solid var(--line); display: grid; align-content: end; padding: 56px; }
	.grid { position: absolute; inset: 0; background-image: linear-gradient(var(--line-soft) 1px, transparent 1px), linear-gradient(90deg, var(--line-soft) 1px, transparent 1px); background-size: 48px 48px; mask-image: radial-gradient(ellipse at 40% 40%, #000 30%, transparent 75%); }
	.trail { position: absolute; left: 50%; top: 38%; translate: -50% -50%; width: 360px; height: 220px; }
	.k { position: absolute; border-radius: 18%; rotate: 45deg; }
	.k1 { width: 46px; height: 46px; left: 0; top: 150px; background: #3a3933; animation: hit 2.4s steps(1) infinite; }
	.k2 { width: 86px; height: 86px; left: 70px; top: 96px; background: #6d6b63; animation: hit 2.4s steps(1) 0.3s infinite; }
	.k3 { width: 150px; height: 150px; left: 190px; top: 20px; background: var(--accent); animation: land 2.4s cubic-bezier(0.2, 1.6, 0.4, 1) 0.6s infinite; }
	@keyframes hit { 0% { opacity: 0; } 4% { opacity: 1; } 92% { opacity: 1; } 100% { opacity: 0; } }
	@keyframes land { 0% { scale: 0.2; opacity: 0; } 10% { scale: 1; opacity: 1; } 88% { scale: 1; opacity: 1; } 100% { scale: 1; opacity: 0; } }
	@media (prefers-reduced-motion: reduce) { .k { animation: none !important; } }
	.tc { position: absolute; top: 28px; right: 32px; color: var(--faint); letter-spacing: 0.04em; }
	.pitch { position: relative; display: grid; gap: 12px; max-width: 520px; }
	.line { margin: 0; font-size: clamp(34px, 4.2vw, 56px); line-height: 1.02; font-weight: 700; letter-spacing: -0.045em; }
	.line em { font-style: normal; color: var(--accent); }
	.pitch .dim { margin: 0; font-size: 15px; }
	.side { display: grid; place-items: center; padding: 32px; }
	.card { width: min(380px, 100%); display: grid; gap: 14px; }
	.brand { margin-bottom: 18px; }
	h1 { margin: 0; font-size: 24px; }
	.sub { margin: -8px 0 0; }
	.card :global(.err) { color: var(--err); margin: 0; }
	.card :global(p) { margin: 0; }
	.card :global(button.primary) { width: 100%; min-height: 38px; margin-top: 4px; }
	.card :global(input) { min-height: 38px; }
	@media (max-width: 860px) { .split { grid-template-columns: 1fr; } .stage { display: none; } }
</style>
