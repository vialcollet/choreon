<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import RunList from '$lib/components/RunList.svelte';
	import { useI18n } from '$lib/i18n';
	import { ChevronLeft, Copy, Play, Plus, Save, Trash2, X } from '@lucide/svelte';

	type Item = { id: string; vars: Record<string, any> };
	type LotState = { name: string; formats: string[]; items: Item[] };

	let { data } = $props();
	const { t } = useI18n();

	const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
	const snapshot = (l: LotState) => JSON.stringify({ name: l.name, formats: l.formats, items: l.items });

	// Editable local copy of the batch; renders and runs stay the server's (refreshed live).
	// svelte-ignore state_referenced_locally -- draft seeded once; p/[project]/+layout.svelte re-creates the page per project and batch
	let lot = $state<LotState>(clone({ name: data.lot.name, formats: data.lot.formats, items: data.lot.items }));
	let saved = $state(snapshot(lot));
	let sel = $state(0);
	let error = $state('');
	let busy = $state(false);
	let advanced = $state('');

	const dirty = $derived(snapshot(lot) !== saved);
	const item = $derived(lot.items[sel] ?? null);
	const fields = $derived(data.template?.fields ?? []);
	const formats = $derived(data.template?.formats ?? lot.formats);
	// svelte-ignore state_referenced_locally -- draft seeded once
	let pfmt = $state(data.lot.formats[0] ?? '1080x1350');

	// ---------- preview (rendered by the engine, ~2-3 s, cached server-side) ----------
	let preview = $state<{ url: string | null; status: 'idle' | 'busy' | 'error'; msg: string }>({ url: null, status: 'idle', msg: '' });
	let seq = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function renderPreview(n: number, vars: unknown, format: string) {
		preview.status = 'busy';
		try {
			const res = await fetch('/api/stills/preview', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ projectId: data.project.id, template: data.lot.template, vars, format })
			});
			if (n !== seq) return;
			if (res.status === 429) {
				timer = setTimeout(() => renderPreview(n, vars, format), 1200);
				return;
			}
			if (!res.ok) throw new Error((await res.text()) || `${res.status}`);
			const r = await res.json();
			preview = { url: r.url, status: 'idle', msg: r.errors?.length ? r.errors.join(' · ') : '' };
		} catch (e) {
			if (n === seq) preview = { ...preview, status: 'error', msg: e instanceof Error ? e.message : String(e) };
		}
	}

	$effect(() => {
		if (!item || !data.template) return;
		const vars = clone(item.vars);
		const format = pfmt;
		const n = ++seq;
		clearTimeout(timer);
		timer = setTimeout(() => renderPreview(n, vars, format), 600);
	});

	$effect(() => {
		advanced = item ? JSON.stringify(item.vars, null, 2) : '';
	});

	// ---------- editing ----------
	function nextId(): string {
		let max = 0;
		let prefix = 'K-';
		let width = 4;
		for (const i of lot.items) {
			const m = /^(.*?)(\d+)$/.exec(i.id);
			if (m && Number(m[2]) >= max) {
				max = Number(m[2]);
				prefix = m[1];
				width = m[2].length;
			}
		}
		let n = max + 1;
		while (lot.items.some((i) => i.id === `${prefix}${String(n).padStart(width, '0')}`)) n++;
		return `${prefix}${String(n).padStart(width, '0')}`;
	}
	function addItem(from?: Item) {
		const vars = clone(from?.vars ?? data.template?.defaults ?? {});
		lot.items.push(normalize({ id: nextId(), vars }));
		sel = lot.items.length - 1;
	}
	function removeItem(i: number) {
		if (!confirm(t('Remove {id} from the batch? Its renders will be deleted on the next render.', { id: lot.items[i].id }))) return;
		lot.items.splice(i, 1);
		sel = Math.max(0, Math.min(sel, lot.items.length - 1));
	}
	/** "items" fields are always lists (never modified while the template renders). */
	function normalize(it: Item): Item {
		for (const f of data.template?.fields ?? []) if (f.type === 'items' && !Array.isArray(it.vars[f.key])) it.vars[f.key] = [];
		return it;
	}
	lot.items.forEach(normalize);
	const rows = (key: string): Record<string, string>[] => (item && Array.isArray(item.vars[key]) ? item.vars[key] : []);
	function applyAdvanced() {
		if (!item) return;
		try {
			item.vars = JSON.parse(advanced);
			normalize(item);
			error = '';
		} catch {
			error = t('Invalid JSON: fix it before applying.');
		}
	}
	function toggleFormat(f: string) {
		lot.formats = lot.formats.includes(f) ? lot.formats.filter((x) => x !== f) : formats.filter((x) => x === f || lot.formats.includes(x));
		if (!lot.formats.includes(pfmt) && lot.formats.length) pfmt = lot.formats[0];
	}

	// ---------- saving and rendering ----------
	async function save(): Promise<boolean> {
		error = '';
		const fd = new FormData();
		fd.set('lot', snapshot(lot));
		const res = await fetch('?/save', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
		const r = deserialize(await res.text());
		if (r.type === 'failure') {
			error = String((r.data as { error?: string })?.error ?? t('Save rejected.'));
			return false;
		}
		if (r.type !== 'success') {
			error = t('Could not save.');
			return false;
		}
		saved = snapshot(lot);
		await invalidateAll();
		return true;
	}
	async function renderLot() {
		busy = true;
		try {
			if (dirty && !(await save())) return;
			await api.job({ kind: 'stills_render', projectId: data.project.id, lot: data.lot.slug, lane: 'stills' });
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
	function onKey(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 's') {
			e.preventDefault();
			if (dirty) save();
		}
	}
</script>

<svelte:window onkeydown={onKey} onbeforeunload={(e) => dirty && e.preventDefault()} />

<div class="wrap">
	<header class="row fwrap">
		<a class="ghost back" href="/p/{data.project.id}/stills" title={t('All batches')}><ChevronLeft size={16} /></a>
		<input class="title" bind:value={lot.name} aria-label={t('Batch name')} />
		<span class="chip">{data.template?.name ?? data.lot.template}</span>
		<span class="spacer"></span>
		{#if dirty}<span class="chip amber">{t('Unsaved')}</span>{/if}
		<button onclick={save} disabled={!dirty}><Save size={14} /> {t('Save')}</button>
		<button class="primary" onclick={renderLot} disabled={busy || !lot.items.length || !lot.formats.length}><Play size={14} /> {t('Render batch ({n})', { n: lot.items.length * lot.formats.length })}</button>
	</header>

	{#if !data.template}<p class="small" style="color: var(--err); margin: 0">{@html t('Template “{name}” not found in <code>templates/</code>.', { name: data.lot.template.replace(/[&<>"]/g, '') })}</p>{/if}
	{#if error}<p class="small" style="color: var(--err); margin: 0">{error}</p>{/if}

	<div class="row fwrap small">
		<span class="dim">{t('Rendered formats:')}</span>
		{#each formats as f (f)}
			<button class="small" class:primary={lot.formats.includes(f)} onclick={() => toggleFormat(f)}>{f}</button>
		{/each}
	</div>

	<div class="grid">
		<aside class="panel items">
			{#each lot.items as it, i (i)}
				<button class="ghost it" class:sel={sel === i} onclick={() => (sel = i)}>
					<span class="th">
						{#if data.renders[it.id]?.[lot.formats[0]]}<img src={data.renders[it.id][lot.formats[0]]} alt="" loading="lazy" />{/if}
					</span>
					<span class="col txt">
						<code class="small">{it.id}</code>
						<span class="small dim hl">{it.vars.headline ?? ''}</span>
					</span>
				</button>
			{/each}
			<button class="ghost add" onclick={() => addItem()}><Plus size={14} /> {t('New creative')}</button>
		</aside>

		{#if item}
			<section class="panel pad col editor">
				<div class="row">
					<label class="idf"><span>{t('ID (ad name, utm_content)')}</span><input bind:value={item.id} /></label>
					<span class="spacer"></span>
					<button class="small" onclick={() => addItem(item)} title={t('Duplicate')}><Copy size={13} /> {t('Duplicate')}</button>
					<button class="small danger" onclick={() => removeItem(sel)} title={t('Remove')}><Trash2 size={13} /></button>
				</div>

				{#each fields as f (f.key)}
					{#if f.type === 'select'}
						<label><span>{f.label}</span>
							<select bind:value={item.vars[f.key]}>{#each f.options ?? [] as o (o)}<option value={o}>{o}</option>{/each}</select>
						</label>
					{:else if f.type === 'textarea'}
						<label><span>{f.label}</span><textarea rows="2" bind:value={item.vars[f.key]} placeholder={f.placeholder ?? ''}></textarea></label>
					{:else if f.type === 'items'}
						<div class="col">
							<span class="small dim">{f.label}</span>
							<div class="rows">
								{#each rows(f.key) as row, r (r)}
									<div class="rowedit">
										{#each f.columns ?? [] as c (c.key)}<input bind:value={row[c.key]} placeholder={c.label} class={c.key} />{/each}
										<button class="ghost small" title={t('Remove card')} onclick={() => rows(f.key).splice(r, 1)}><X size={13} /></button>
									</div>
								{/each}
							</div>
							<div><button class="small" onclick={() => rows(f.key).push({})}><Plus size={13} /> {t('Card')}</button></div>
						</div>
					{:else}
						<label><span>{f.label}</span><input bind:value={item.vars[f.key]} placeholder={f.placeholder ?? ''} /></label>
					{/if}
				{/each}

				<details>
					<summary class="small dim">{t('Variables (JSON)')}</summary>
					<textarea class="json" rows="10" bind:value={advanced}></textarea>
					<div><button class="small" onclick={applyAdvanced}>{t('Apply')}</button></div>
				</details>
			</section>

			<section class="panel pad col view">
				<div class="row fwrap">
					<b class="small">{t('Preview')}</b>
					{#each lot.formats as f (f)}<button class="small" class:primary={pfmt === f} onclick={() => (pfmt = f)}>{f}</button>{/each}
					<span class="spacer"></span>
					<span class="small faint">{preview.status === 'busy' ? t('Rendering…') : preview.status === 'error' ? t('Error') : t('Up to date')}</span>
				</div>
				<div class="stage" class:busy={preview.status === 'busy'} style="aspect-ratio: {pfmt.replace('x', ' / ')}">
					{#if preview.url}<img src={preview.url} alt={t('Preview of {id}', { id: item.id })} />{:else}<span class="faint small">{t('Rendering preview…')}</span>{/if}
				</div>
				{#if preview.msg}<p class="small" style="color: var(--err); margin: 0">{preview.msg}</p>{/if}

				<b class="small">{t('Latest renders')}</b>
				<div class="renders">
					{#each lot.formats as f (f)}
						{#if data.renders[item.id]?.[f]}
							<a href={data.renders[item.id][f]} target="_blank" title="{item.id} · {f}"><img src={data.renders[item.id][f]} alt="{item.id} {f}" loading="lazy" /><span class="small faint">{f}</span></a>
						{:else}
							<span class="none small faint">{f} · {t('not rendered yet')}</span>
						{/if}
					{/each}
				</div>
				<RunList runs={data.runs} project={data.project.id} compact />
			</section>
		{:else}
			<div class="empty">{t('Empty batch. Add a creative.')}</div>
		{/if}
	</div>
</div>

<style>
	.wrap { padding: 32px 36px 56px; display: grid; gap: 14px; max-width: 1600px; }
	.back { display: inline-flex; padding: 4px; }
	.title { font-size: 18px; font-weight: 600; background: transparent; border-color: transparent; max-width: 420px; }
	.title:hover, .title:focus { border-color: var(--line); }
	.grid { display: grid; grid-template-columns: 240px minmax(320px, 1fr) minmax(320px, 440px); gap: 14px; align-items: start; }
	@media (max-width: 1200px) { .grid { grid-template-columns: 220px 1fr; } .view { grid-column: 1 / -1; } }
	.items { display: grid; gap: 2px; padding: 6px; max-height: calc(100vh - 170px); overflow: auto; }
	.it { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; align-items: center; text-align: left; padding: 6px; border-radius: 6px; }
	.it.sel { background: var(--panel-2); border-color: var(--line); }
	.th { width: 44px; height: 55px; border-radius: 4px; overflow: hidden; background: var(--bg-deep); display: block; }
	.th img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
	.txt { gap: 2px; min-width: 0; }
	.hl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.add { justify-content: center; margin-top: 4px; }
	.editor { gap: 12px; min-width: 0; }
	.idf { flex: 1; max-width: 260px; }
	.rows { display: grid; gap: 6px; }
	.rowedit { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1.3fr) 92px auto; gap: 6px; align-items: center; }
	textarea.json { width: 100%; font-family: var(--mono); font-size: 12px; margin: 8px 0; }
	.view { gap: 10px; position: sticky; top: 16px; }
	.stage { width: 100%; max-height: calc(100vh - 340px); background: var(--bg-deep); border-radius: 6px; display: grid; place-items: center; overflow: hidden; margin-inline: auto; }
	.stage img { width: 100%; height: 100%; object-fit: contain; display: block; }
	.stage.busy img { opacity: 0.55; }
	.renders { display: flex; gap: 8px; flex-wrap: wrap; }
	.renders a { display: grid; gap: 2px; text-decoration: none; }
	.renders img { height: 120px; border-radius: 4px; display: block; }
	.none { padding: 6px 0; }
	@media (prefers-reduced-motion: no-preference) { .stage img { transition: opacity 0.15s; } }
</style>
