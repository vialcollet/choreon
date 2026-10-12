<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';

	// Markdown produced by our agents: raw HTML and unsafe URLs are never injected.
	let { text }: { text: string } = $props();
	const html = $derived(renderMarkdown(text));
</script>

<div class="md">{@html html}</div>

<style>
	.md { font-size: 13px; line-height: 1.55; }
	.md :global(h1), .md :global(h2), .md :global(h3) { font-size: 14px; margin: 14px 0 4px; text-transform: none; letter-spacing: 0; color: var(--text); }
	.md :global(p) { margin: 4px 0; }
	.md :global(ul), .md :global(ol) { margin: 4px 0; padding-left: 20px; }
	.md :global(li) { margin: 2px 0; }
	.md :global(strong) { color: #fff; }
	.md :global(code) { background: var(--bg-deep); padding: 1px 4px; border-radius: 3px; }
</style>
