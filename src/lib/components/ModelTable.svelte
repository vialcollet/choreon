<script lang="ts">
	import { useI18n } from '$lib/i18n';
	import { ROLES, MODELS, EFFORTS, type ModelChoice, type Role } from '$lib/types';

	// Model/effort table per role. `fallback` shown when a role is not overridden
	// (project settings); without fallback, each row is required (studio settings).
	let { value = $bindable(), fallback = null }: { value: Partial<Record<Role, ModelChoice>>; fallback?: Record<Role, ModelChoice> | null } = $props();

	const { t } = useI18n();
	const label = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;
	// "studio default" on the model removes the role override; on effort, takes the studio's effort.
	function set(role: Role, k: 'model' | 'effort', v: string) {
		if (!v && fallback) {
			if (k === 'model') delete value[role];
			else if (value[role]) value[role] = { ...value[role]!, effort: fallback[role].effort };
			return;
		}
		const base = value[role] ?? { ...(fallback?.[role] ?? { model: 'opus', effort: 'high' }) };
		value[role] = { ...base, [k]: v } as ModelChoice;
	}
</script>

<table>
	<thead><tr><th>{t('Role')}</th><th>{t('Model')}</th><th>{t('Effort')}</th></tr></thead>
	<tbody>
		{#each ROLES.filter((r) => !(fallback && r.studio)) as r (r.key)}
			<tr>
				<td><b>{t(r.label)}</b><div class="faint small">{t(r.hint)}</div></td>
				<td>
					<select value={value[r.key]?.model ?? ''} onchange={(e) => set(r.key, 'model', (e.target as HTMLSelectElement).value)}>
						{#if fallback}<option value="">{t('studio default ({value})', { value: label(fallback[r.key].model) })}</option>{/if}
						{#each MODELS as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
					</select>
				</td>
				<td>
					<select value={value[r.key]?.effort ?? ''} onchange={(e) => set(r.key, 'effort', (e.target as HTMLSelectElement).value)}>
						{#if fallback}<option value="">{t('studio default ({value})', { value: fallback[r.key].effort })}</option>{/if}
						{#each EFFORTS as e (e)}<option value={e}>{e}</option>{/each}
					</select>
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	table { width: 100%; border-collapse: collapse; }
	th { text-align: left; font-weight: 500; color: var(--dim); font-size: 12px; padding: 4px; }
	td { padding: 6px 4px; vertical-align: top; border-top: 1px solid var(--line-soft); }
	td:nth-child(2), td:nth-child(3) { width: 230px; }
</style>
