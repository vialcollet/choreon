<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import { useI18n } from '$lib/i18n';
	import Player from '$lib/components/Player.svelte';
	import Compare from '$lib/components/Compare.svelte';
	import NoteItem from '$lib/components/NoteItem.svelte';
	import EvalPanel from '$lib/components/EvalPanel.svelte';
	import { Hammer, Wand2, Gauge, Film, Clapperboard, RotateCcw, AudioLines, MonitorPlay, GitCompareArrows } from '@lucide/svelte';
	import type { Region } from '$lib/types';

	const { t, tt } = useI18n();
	let { data } = $props();

	const FULL = '__full';
	// The edit opens on the full film once there is one; a shot opens from the timeline (double-click).
	const selected = $derived(page.url.searchParams.get('shot') ?? (data.renders.some((r) => r.shotKey === null) ? FULL : data.shots[0]?.key ?? FULL));
	const shot = $derived(data.shots.find((s) => s.key === selected) ?? null);
	const shotRenders = $derived(data.renders.filter((r) => (selected === FULL ? r.shotKey === null : r.shotKey === selected)).sort((a, b) => b.version - a.version));
	const wantedVersion = $derived(Number(page.url.searchParams.get('r')) || null);
	const render = $derived(shotRenders.find((r) => r.version === wantedVersion) ?? shotRenders[0] ?? null);
	const evalOf = (rid: string | undefined) => data.evals.find((e) => e.renderId === rid) ?? null;
	const ev = $derived(render ? evalOf(render.id) : null);
	const shotNotes = $derived(data.notes.filter((n) => n.target === 'render' && (selected === FULL ? n.shotKey === null : n.shotKey === selected)));
	const openFix = $derived(shotNotes.filter((n) => n.status === 'open' && (!n.route || n.route.scope === 'shot_fix')));
	const openOther = $derived(shotNotes.filter((n) => n.status === 'open' && n.route && n.route.scope !== 'shot_fix'));
	const activeFor = (key: string) => data.active.filter((a) => a.shotKey === key);
	const busy = $derived(selected !== FULL && activeFor(selected).length > 0);

	let tab = $state<'notes' | 'eval' | 'plan'>('notes');
	let player: Player | undefined = $state();
	let err = $state('');
	let soundStyle = $state<'sobre' | 'equilibre' | 'musique'>('equilibre');
	let sfxGain = $state(1);

	const markers = $derived([
		...shotNotes.filter((n) => n.t != null && n.renderId === render?.id).map((n) => ({ t: n.t!, kind: 'note' as const, label: n.body })),
		...(ev?.findings ?? []).filter((f) => f.t != null).map((f) => ({ t: Number(f.t), kind: 'finding' as const, label: f.problem }))
	]);

	// While an agent works on the displayed shot, refresh its latest message.
	$effect(() => {
		if (!busy) return;
		const timer = setInterval(() => invalidateAll(), 8000);
		return () => clearInterval(timer);
	});

	const select = (key: string) => goto(`?shot=${key}`, { noScroll: true, keepFocus: true });
	// Where each shot sits in the edit: chapters of the full film, and the edit's sound under a single shot.
	const starts = $derived(data.shots.map((_, i) => data.shots.slice(0, i).reduce((a, x) => a + x.duration, 0)));
	const chapters = $derived(selected === FULL ? data.shots.map((s, i) => ({ t: starts[i], key: s.key, label: s.title })) : []);
	const soundCut = $derived(data.renders.filter((r) => r.shotKey === null && r.qa.hasAudio).sort((a, b) => b.version - a.version)[0] ?? null);
	const shotAudio = $derived(selected !== FULL && shot && soundCut ? { src: soundCut.url, offset: starts[data.shots.indexOf(shot)] } : null);
	let now = $state(0);
	const playingKey = $derived(selected === FULL ? (chapters.findLast((c) => now + 1e-3 >= c.t)?.key ?? null) : null);
	// In the edit, a click on a shot plays the film from it (sound on); a double-click opens the shot.
	function clip(key: string, i: number) {
		if (selected === FULL && player) player.playFrom(starts[i]);
		else select(key);
	}
	const seek = (t: number) => player?.seek(t);

	async function job(body: Record<string, unknown>) {
		err = '';
		try {
			await api.job({ projectId: data.project.id, videoId: data.video.id, ...body });
			invalidateAll();
		} catch (e) {
			err = String(e);
		}
	}

	async function annotate(a: { t: number; region: Region | null; body: string }) {
		if (!render) return;
		await api.note({ videoId: data.video.id, target: 'render', renderId: render.id, shotKey: render.shotKey, t: a.t, region: a.region, body: a.body });
		tab = 'notes';
		invalidateAll();
	}

	const lastEval = (key: string) => {
		const r = data.renders.filter((x) => x.shotKey === key).sort((a, b) => b.version - a.version)[0];
		return r ? { r, e: evalOf(r.id) } : null;
	};
	// A/B comparison (?compare=1&b=<version>): B defaults to the version just before A.
	const canCompare = $derived(!!render && shotRenders.length > 1);
	const comparing = $derived(canCompare && page.url.searchParams.get('compare') === '1');
	const renderB = $derived.by(() => {
		if (!render) return null;
		const others = shotRenders.filter((r) => r.id !== render.id);
		const wanted = Number(page.url.searchParams.get('b')) || null;
		return others.find((r) => r.version === wanted) ?? others.find((r) => r.version < render.version) ?? others[0] ?? null;
	});
	const SOUND: Record<string, string> = { sobre: 'subtle', equilibre: 'balanced', musique: 'music' };
	const overall = (scores: Record<string, number>) => {
		let sw = 0, sum = 0;
		for (const a of data.project.eval.axes) {
			const w = a.weight ?? 1;
			sw += w;
			sum += w * (scores[a.key] ?? 0);
		}
		return sw ? sum / sw : 0;
	};
	const side = (r: (typeof shotRenders)[number]) => {
		const e = evalOf(r.id);
		return { url: r.url, label: t('render {n}', { n: r.version }), score: e ? overall(e.scores) : null, pass: e ? e.pass : null, sound: r.qa.hasAudio && r.qa.sound ? t(SOUND[r.qa.sound] ?? r.qa.sound) : null };
	};
	function setCompare(on: boolean, b?: number) {
		const q = new URLSearchParams(page.url.searchParams);
		if (on) q.set('compare', '1');
		else q.delete('compare');
		if (b != null) q.set('b', String(b));
		if (!on) q.delete('b');
		if (!q.get('shot')) q.set('shot', selected);
		goto(`?${q}`, { noScroll: true, keepFocus: true, replaceState: true });
	}
	function compareKey(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement).tagName;
		if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === 'c' && canCompare) setCompare(!comparing);
		else if (e.key === 'Escape' && comparing) setCompare(false);
	}

	const allRendered = $derived(data.shots.length > 0 && data.shots.every((s) => data.renders.some((r) => r.shotKey === s.key)));
</script>

<svelte:window onkeydown={compareKey} />

<div class="prod">
	<section class="center col">
		{#if err}<p class="small" style="color: var(--err)">{err}</p>{/if}
		{#if render}
			<div class="row">
				<h2>{selected === FULL ? t('Full video') : `${shot?.key} — ${shot?.title}`}</h2>
				<span class="spacer"></span>
				<button class="small" class:on={comparing} disabled={!canCompare} onclick={() => setCompare(!comparing)} title={canCompare ? t('Compare two renders (c)') : t('Only one render so far')}><GitCompareArrows size={14} /> {t('Compare')}</button>
				{#if comparing}<span class="ab mono">A</span>{/if}
				<select style="width: auto" value={render.version} onchange={(e) => goto(`?shot=${selected}&r=${(e.target as HTMLSelectElement).value}${comparing ? `&compare=1&b=${renderB?.version ?? ''}` : ''}`, { noScroll: true })}>
					{#each shotRenders as r (r.id)}{@const e = evalOf(r.id)}<option value={r.version}>{t('render {n}', { n: r.version })}{r.qa.hasAudio ? ` ♪${r.qa.sound ? ' ' + t(({ sobre: 'subtle', equilibre: 'balanced', musique: 'music' } as Record<string, string>)[r.qa.sound]) : ''}` : ''}{e ? (e.pass ? ' ✓' : ' ·') : ''}</option>{/each}
				</select>
			</div>
			{#if comparing && renderB}
				<Compare
					a={side(render)}
					b={side(renderB)}
					fps={data.video.format.fps}
					axes={data.project.eval.axes}
					scoresA={evalOf(render.id)?.scores ?? null}
					scoresB={evalOf(renderB.id)?.scores ?? null}
					options={shotRenders.filter((r) => r.id !== render.id).map((r) => ({ value: r.version, label: side(r).label + (side(r).score != null ? ` · ${side(r).score!.toFixed(1)}` : '') }))}
					bValue={renderB.version}
					onpickb={(v) => setCompare(true, v)}
					onexit={() => setCompare(false)}
				/>
			{:else}
			{#key render.url}<Player bind:this={player} src={render.url} fps={data.video.format.fps} {markers} {chapters} audio={shotAudio} loop={false} ontime={(x) => (now = x)} onannotate={annotate} />{/key}
			<p class="hint faint small">{t('Space: play · ← →: frame by frame (Shift: ×10) · a: annotate the current moment, then draw a box on the target area.')} {selected === FULL ? t('Timeline: click a shot to play the film from it, double-click to open it.') : shotAudio ? t('You hear the edit’s sound at this shot’s place (render {n}).', { n: soundCut?.version ?? '' }) : ''}</p>
			{/if}
		{:else if shot}
			<div class="empty col">
				<span>{t('Shot {key} hasn’t been animated yet.', { key: shot.key })}</span>
				<div><button class="primary" disabled={busy} onclick={() => job({ kind: 'shot_build', shotKey: shot.key })}><Hammer size={15} /> {t('Build shot')}</button></div>
			</div>
		{:else}
			<div class="empty">{t('No cut yet. Build the shots, then “Assemble video”.')}</div>
		{/if}
		{#if busy}
			<div class="panel pad col small">
				<div class="row"><span class="dot running"></span> {activeFor(selected).map((a) => `${a.title}${a.status === 'queued' ? ` (${t('queued')})` : ''}`).join(' → ')}</div>
				{#each activeFor(selected).filter((a) => a.last) as a (a.id)}<div class="faint" style="white-space: pre-wrap">{a.last}</div>{/each}
			</div>
		{/if}
		<section class="strip">
			<div class="row">
				<h3>{t('Timeline')}</h3>
				<span class="faint small mono">{data.shots.reduce((a, s) => a + s.duration, 0).toFixed(1)} s</span>
				<span class="spacer"></span>
				<button class="small" disabled={!allRendered} onclick={() => job({ kind: 'assemble' })} title={allRendered ? '' : t('Every shot needs at least one render')}><Clapperboard size={14} /> {t('Assemble video')}</button>
				<div class="sound">
					<button class="small" disabled={!data.renders.some((r) => r.shotKey === null && !r.qa.hasAudio)} onclick={() => job({ kind: 'sound_design', style: soundStyle, sfxGain })} title={t('One sound per gesture, a continuous layer, shared reverb; real recordings and music from the library')}><AudioLines size={14} /> {t('Sound design')}</button>
					<select bind:value={soundStyle} title={t('Sound mix')}>
						<option value="sobre">{t('subtle')}</option>
						<option value="equilibre">{t('balanced')}</option>
						<option value="musique">{t('with music')}</option>
					</select>
					<select bind:value={sfxGain} title={t('Sound effects level')}>
						<option value={1}>{t('effects')} 100 %</option>
						<option value={0.7}>{t('effects')} 70 %</option>
						<option value={0.5}>{t('effects')} 50 %</option>
					</select>
					<button class="small ghost" disabled={!soundCut} onclick={() => job({ kind: 'sound_design', style: soundStyle, sfxGain, remix: true })} title={t('Same sound design, new mix (after a new voice-over take)')}>{t('Remix')}</button>
				</div>
				<button class="small ghost" disabled={!allRendered} onclick={() => job({ kind: 'resolve_export' })} title={t('Imports the latest shot renders into DaVinci Resolve and creates a timeline (the choreon_bridge must be running)')}><MonitorPlay size={14} /> {t('Send to Resolve')}</button>
			</div>
			<div class="clips">
				{#each data.shots as s, i (s.key)}
					{@const le = lastEval(s.key)}
					{@const act = activeFor(s.key)}
					<button class="clip" class:sel={selected === s.key} class:running={act.length > 0} class:ok={!act.length && le?.e?.pass} class:todo={!act.length && le?.e && !le.e.pass} class:now={playingKey === s.key} style="flex: {s.duration} 1 0" onclick={() => clip(s.key, i)} ondblclick={() => select(s.key)} title="{s.key} — {s.title}{selected === FULL ? ` · ${t('click: play from here · double-click: open')}` : ''}">
						<span class="thumb">{#if le}<video src="{le.r.url}#t={(s.duration / 2).toFixed(2)}" muted preload="metadata"></video>{/if}</span>
						<span class="meta">
							<span class="row"><span class="key mono">{s.key}</span><span class="name">{s.title}</span></span>
							<span class="row small">
								{#if act.length}<span class="dot running"></span><span class="st">{tt(act[0].title.replace(/^(Plan|Shot) \w+ — /, ''))}</span>
								{:else if !le}<span class="st faint">{t('to build')}</span>
								{:else}
									<span class="faint mono" title={le.e ? (le.e.pass ? t('approved') : t('needs work')) : t('not evaluated')}>r{le.r.version}{#if le.e} · <span class:okc={le.e.pass} class:amc={!le.e.pass}>{le.e.pass ? '✓' : '!'}</span>{/if}</span>
								{/if}
								<span class="spacer"></span><span class="faint mono">{+s.duration.toFixed(2)}s</span>
							</span>
						</span>
					</button>
				{:else}
					<div class="faint small pad">{t('The storyboard has no shots yet.')}</div>
				{/each}
				<button class="clip full" class:sel={selected === FULL} onclick={() => select(FULL)}>
					<span class="meta">
						<span class="row"><Film size={14} /><span class="name">{t('Full video')}</span></span>
						<span class="row small faint">{t('{n} cut(s)', { n: data.renders.filter((r) => r.shotKey === null).length })}</span>
					</span>
				</button>
			</div>
		</section>
	</section>

	<aside class="side col">
		<nav class="tabs">
			<a href="#notes" class:active={tab === 'notes'} onclick={(e) => { e.preventDefault(); tab = 'notes'; }}>{t('Notes')} {shotNotes.filter((n) => n.status === 'open').length || ''}</a>
			<a href="#eval" class:active={tab === 'eval'} onclick={(e) => { e.preventDefault(); tab = 'eval'; }}>{t('Evaluation')}</a>
			{#if shot}<a href="#plan" class:active={tab === 'plan'} onclick={(e) => { e.preventDefault(); tab = 'plan'; }}>{t('Shot')}</a>{/if}
		</nav>

		{#if tab === 'notes'}
			{#if shot}
				<button class="primary" disabled={busy || !openFix.length} onclick={() => job({ kind: 'shot_fix', shotKey: shot.key, noteIds: openFix.map((n) => n.id) })}><Wand2 size={15} /> {openFix.length > 1 ? t('Apply {n} notes', { n: openFix.length }) : t('Apply {n} note', { n: openFix.length })}</button>
			{/if}
			{#if openOther.length}
				<p class="small" style="margin: 0; color: var(--amber)">{t('{n} note(s) concern the storyboard or the global style: Jev routed them away from the fix. You can still apply them or move them to the Storyboard tab.', { n: openOther.length })}</p>
				{#if shot}<button class="small" disabled={busy} onclick={() => job({ kind: 'shot_fix', shotKey: shot.key, noteIds: [...openFix, ...openOther].map((n) => n.id) })}>{t('Apply all to shot')}</button>{/if}
			{/if}
			{#each shotNotes as n (n.id)}<NoteItem note={n} onseek={seek} />{:else}<p class="faint small">{t('No notes. Pause and use “Annotate”.')}</p>{/each}
		{:else if tab === 'eval'}
			{#if ev}
				<EvalPanel {ev} axes={data.project.eval.axes} onseek={seek} />
				{#if shot && !ev.pass}<button disabled={busy} onclick={() => job({ kind: 'shot_fix', shotKey: shot.key, findings: ev.findings, title: `Shot ${shot.key} — fix from evaluation` })}><Wand2 size={15} /> {t('Fix from evaluation')}</button>{/if}
			{:else}
				<p class="faint small">{t('This render hasn’t been evaluated yet.')}</p>
			{/if}
			{#if render}<button disabled={busy} onclick={() => job({ kind: 'eval', renderId: render.id, shotKey: render.shotKey, auto: false })}><Gauge size={15} /> {ev ? t('Re-evaluate') : t('Evaluate')}</button>{/if}
			{#if render?.qa.contactUrl}<a href={render.qa.contactUrl} target="_blank"><img class="contact" src={render.qa.contactUrl} alt={t('contact sheet')} /></a><span class="faint small">{t('Contact sheet ({n} fps)', { n: render.qa.contactFps })}</span>{/if}
		{:else if tab === 'plan' && shot}
			<div class="small col">
				<div><b class="dim">{t('Intent')}</b> {shot.data.intent}</div>
				<div><b class="dim">{t('Visual')}</b> {shot.data.visual}</div>
				{#if shot.data.onScreenText}<div><b class="dim">{t('Text')}</b> « {shot.data.onScreenText} »</div>{/if}
				<ol style="margin: 0; padding-left: 18px">{#each shot.data.beats as b, i (i)}<li><button class="ghost small" style="border: 0; padding: 0" onclick={() => seek(b.t)}><span class="mono faint">{b.t.toFixed(1)} s</span></button> {b.state}</li>{/each}</ol>
				{#if shot.data.directorNotes?.length}<div><b class="dim">{t('Director’s notes applied')}</b><ol style="margin: 4px 0 0; padding-left: 18px">{#each shot.data.directorNotes as n, i (i)}<li>{n}</li>{/each}</ol></div>{/if}
				{#if shot.refUrl}<img src={shot.refUrl} alt={t('reference')} style="border-radius: 4px" />{/if}
			</div>
			<div class="row fwrap">
				<button disabled={busy} onclick={() => confirm(t('Rebuild this shot from scratch?')) && job({ kind: 'shot_build', shotKey: shot.key })}><Hammer size={15} /> {t('Rebuild')}</button>
				<button disabled={busy} onclick={() => job({ kind: 'render', shotKey: shot.key, auto: false })}><RotateCcw size={15} /> {t('Re-render')}</button>
			</div>
		{/if}
	</aside>
</div>

<style>
	.prod { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; padding: 20px 28px 40px; align-items: start; }
	.center { min-width: 0; gap: 12px; }
	.center > * { min-width: 0; }
	.hint { margin: -2px 0 0; }
	button.on { background: var(--raise); border-color: color-mix(in srgb, var(--accent) 60%, transparent); color: #fff; }
	.ab { font-weight: 700; color: var(--accent); font-size: 12px; }
	.side { min-width: 0; gap: 12px; position: sticky; top: 0; max-height: calc(100vh - 140px); overflow: auto; padding-right: 2px; }
	.contact { border-radius: 8px; border: 1px solid var(--line); }

	.strip { display: grid; gap: 10px; margin-top: 6px; padding-top: 14px; border-top: 1px solid var(--line); }
	.strip > .row { flex-wrap: wrap; row-gap: 6px; }
	.sound { display: flex; gap: 4px; }
	.sound select { width: auto; min-height: 26px; font-size: 12px; padding-top: 2px; padding-bottom: 2px; }
	.clips { display: flex; gap: 6px; align-items: stretch; overflow-x: auto; padding-bottom: 4px; }
	.clip { position: relative; display: grid; grid-template-rows: auto auto; align-items: stretch; justify-content: stretch; gap: 0; padding: 0; min-width: 132px; min-height: 0; text-align: left; white-space: normal; overflow: hidden; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); }
	.clip::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 3px; background: var(--line-strong); z-index: 1; }
	.clip.ok::before { background: var(--ok); }
	.clip.todo::before { background: var(--amber); }
	.clip.running::before { background: var(--agent); }
	.clip.now { background: var(--panel-2); box-shadow: inset 0 -2px 0 var(--accent); }
	.clip.sel { border-color: color-mix(in srgb, var(--accent) 70%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 70%, transparent); }
	.clip:hover:not(:disabled) { background: var(--panel-2); }
	.thumb { display: block; height: 58px; background: var(--bg-deep); overflow: hidden; }
	.thumb video { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
	.meta { display: grid; gap: 3px; padding: 8px 10px 9px; min-width: 0; }
	.meta .row { min-width: 0; gap: 6px; }
	.key { font-size: 11px; color: var(--faint); }
	.name { font-weight: 500; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
	.st { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
	.okc { color: var(--ok); }
	.amc { color: var(--amber); }
	.clip.full { flex: 0 0 150px; align-content: end; background: var(--bg-deep); border-style: dashed; }
	.clip.full::before { display: none; }
	@media (max-width: 1200px) { .prod { grid-template-columns: minmax(0, 1fr); } .side { position: static; max-height: none; } }
</style>
