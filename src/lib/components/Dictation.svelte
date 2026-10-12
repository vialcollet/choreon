<script lang="ts">
	import { onMount } from 'svelte';
	import { useI18n } from '$lib/i18n';
	import { Mic, Square, LoaderCircle } from '@lucide/svelte';

	// Dictation in all input fields: a mic appears in the active text field.
	// Click (or Alt+M): records; second click: transcribes (Whisper via /api/transcribe) and inserts
	// the text at the cursor. Mounted once in the layout, nothing to add in the pages.

	const { t: tr } = useI18n();

	type Field = HTMLInputElement | HTMLTextAreaElement;
	const TEXT_TYPES = new Set(['text', 'search', '']);

	let field = $state<Field | null>(null);
	let pos = $state({ top: 0, left: 0, visible: false });
	let mode = $state<'idle' | 'recording' | 'busy'>('idle');
	let err = $state('');
	let seconds = $state(0);

	let recorder: MediaRecorder | null = null;
	let chunks: Blob[] = [];
	let target = $state<Field | null>(null);
	let sel: [number, number] = [0, 0];
	let timer: ReturnType<typeof setInterval> | null = null;
	let raf = 0;

	const dictable = (el: EventTarget | null): el is Field =>
		(el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type))) && !el.readOnly && !el.disabled && el.dataset.dictation !== 'off';

	function place() {
		const el = mode === 'idle' ? field : target;
		if (!el || !el.isConnected) {
			pos.visible = false;
			return;
		}
		const r = el.getBoundingClientRect();
		const multi = el instanceof HTMLTextAreaElement;
		pos = { top: multi ? r.bottom - 30 : r.top + (r.height - 26) / 2, left: r.right - 30, visible: r.width > 60 && r.bottom > 0 && r.top < innerHeight };
		raf = requestAnimationFrame(place);
	}

	function focusIn(e: FocusEvent) {
		if (!dictable(e.target)) return;
		field = e.target;
		cancelAnimationFrame(raf);
		place();
	}
	function focusOut() {
		// Leave time for the click on the mic (which doesn't take focus).
		setTimeout(() => {
			if (mode === 'idle' && !dictable(document.activeElement)) {
				field = null;
				pos.visible = false;
				cancelAnimationFrame(raf);
			}
		}, 0);
	}

	async function start() {
		if (!field) return;
		err = '';
		target = field;
		sel = [field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length];
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
			const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
			recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
			chunks = [];
			recorder.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
			recorder.onstop = () => {
				stream.getTracks().forEach((t) => t.stop());
				transcribe(new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }));
			};
			recorder.start();
			mode = 'recording';
			seconds = 0;
			timer = setInterval(() => seconds++, 1000);
		} catch (e) {
			err = e instanceof DOMException && e.name === 'NotAllowedError' ? tr('Microphone blocked by the browser') : tr('Microphone unavailable: {e}', { e: String(e) });
		}
	}

	function stop() {
		if (timer) clearInterval(timer);
		timer = null;
		mode = 'busy';
		recorder?.stop();
	}

	async function transcribe(blob: Blob) {
		const el = target;
		try {
			if (blob.size < 1200) throw new Error(tr('recording too short'));
			const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm';
			const fd = new FormData();
			fd.append('file', blob, `dictee.${ext}`);
			// Context: helps Whisper with proper nouns and vocabulary already present.
			fd.append('prompt', [document.title, el?.placeholder, el?.value.slice(-300)].filter(Boolean).join(' · '));
			const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
			if (!res.ok) throw new Error((await res.text()).replace(/^\{"message":"|"\}$/g, ''));
			const { text } = (await res.json()) as { text: string };
			if (el && text) insert(el, text);
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			mode = 'idle';
			target = null;
			if (el?.isConnected) el.focus();
		}
	}

	/** Inserts at the cursor, with the right spaces, and notifies Svelte (bind:value). */
	function insert(el: Field, text: string) {
		const [a, b] = sel;
		const before = el.value.slice(0, a);
		const after = el.value.slice(b);
		const lead = before && !/\s$/.test(before) ? ' ' : '';
		const trail = after && !/^\s/.test(after) ? ' ' : '';
		const piece = lead + text + trail;
		el.value = before + piece + after;
		const caret = before.length + piece.length;
		el.setSelectionRange(caret, caret);
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function toggle() {
		if (mode === 'recording') stop();
		else if (mode === 'idle') start();
	}

	function onKey(e: KeyboardEvent) {
		if (e.altKey && !e.ctrlKey && (e.key === 'm' || e.key === 'M') && (mode !== 'idle' || dictable(document.activeElement))) {
			e.preventDefault();
			if (mode === 'idle') field = document.activeElement as Field;
			toggle();
		} else if (e.key === 'Escape' && mode === 'recording') {
			chunks = [];
			if (timer) clearInterval(timer);
			recorder!.onstop = () => recorder?.stream.getTracks().forEach((t) => t.stop());
			recorder?.stop();
			mode = 'idle';
		}
	}

	onMount(() => {
		if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return;
		document.addEventListener('focusin', focusIn);
		document.addEventListener('focusout', focusOut);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('focusin', focusIn);
			document.removeEventListener('focusout', focusOut);
			document.removeEventListener('keydown', onKey);
			cancelAnimationFrame(raf);
		};
	});

	$effect(() => {
		if (!err) return;
		const t = setTimeout(() => (err = ''), 6000);
		return () => clearTimeout(t);
	});
</script>

{#if pos.visible && (field || target)}
	<button
		class="mic {mode}"
		style="top: {pos.top}px; left: {pos.left}px"
		title={mode === 'recording' ? tr('Stop and transcribe (Alt+M) · Esc to cancel') : mode === 'busy' ? tr('Transcribing…') : tr('Dictate (Alt+M)')}
		onmousedown={(e) => e.preventDefault()}
		onclick={toggle}
		disabled={mode === 'busy'}
	>
		{#if mode === 'recording'}<Square size={11} fill="currentColor" />{:else if mode === 'busy'}<LoaderCircle size={14} class="spin" />{:else}<Mic size={14} />{/if}
	</button>
	{#if mode === 'recording'}<span class="rec" style="top: {pos.top + 4}px; left: {pos.left - 44}px">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>{/if}
{/if}
{#if err}<div class="toast" role="alert">{err}</div>{/if}

<style>
	.mic {
		position: fixed; z-index: 1000; width: 26px; height: 26px; padding: 0; border-radius: 99px;
		display: grid; place-items: center; border: 1px solid var(--line); background: var(--panel-2); color: var(--dim);
		opacity: 0.75; transition: opacity 0.15s, color 0.15s, background 0.15s;
	}
	.mic:hover { opacity: 1; color: var(--text); }
	.mic.recording { opacity: 1; color: #fff; background: var(--err); border-color: var(--err); animation: pulse 1.2s ease-in-out infinite; }
	.mic.busy { opacity: 1; color: var(--agent); }
	.rec { position: fixed; z-index: 1000; font: 500 11px/18px ui-monospace, monospace; color: var(--err); padding: 0 6px; background: var(--panel); border-radius: 4px; }
	.toast { position: fixed; z-index: 1001; bottom: 18px; left: 50%; transform: translateX(-50%); max-width: 560px; padding: 8px 14px; border-radius: 8px; background: var(--panel-2); border: 1px solid var(--err); color: var(--text); font-size: 13px; }
	.mic :global(.spin) { animation: spin 0.9s linear infinite; }
	@keyframes pulse { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--err) 25%, transparent); } }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
