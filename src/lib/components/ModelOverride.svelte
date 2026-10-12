<script lang="ts">
	import { runOverride } from '$lib/override.svelte';
	import { MODELS, EFFORTS } from '$lib/types';
	import { useI18n } from '$lib/i18n';
	import { Cpu } from '@lucide/svelte';
	const { t } = useI18n();
</script>

<div class="ov row" title={t('Model and effort for the next tasks started from this page (otherwise: project settings)')}>
	<Cpu size={14} />
	<select bind:value={runOverride.model}>
		<option value="">{t('project model')}</option>
		{#each MODELS as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
	</select>
	<select bind:value={runOverride.effort}>
		<option value="">{t('project effort')}</option>
		{#each EFFORTS as e (e)}<option value={e}>{e}</option>{/each}
	</select>
</div>

<style>
	.ov { gap: 4px; color: var(--dim); }
	select { width: auto; padding: 3px 6px; font-size: 12px; }
	.ov:has(select option:checked:not([value=''])) { color: var(--agent); }
</style>
