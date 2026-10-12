<script lang="ts">
	// Choreon: a keyframe and its trail. Two ghost frames, spaced like an ease-out, then the key
	// landing in cue colour (same drawing as static/favicon.svg and seeds/choreon/brand/logo).
	let { size = 22, wordmark = true }: { size?: number; wordmark?: boolean } = $props();
</script>

<span class="logo" style="--s: {size}px">
	<svg viewBox="4 8 58 42" width={size * 1.38} height={size} aria-hidden="true">
		<path d="M9.66 36.84Q10.5 36 11.34 36.84L15.66 41.16Q16.5 42 15.66 42.84L11.34 47.16Q10.5 48 9.66 47.16L5.34 42.84Q4.5 42 5.34 41.16Z" fill="#3a3933" />
		<path d="M22.6 26.9Q24 25.5 25.4 26.9L32.6 34.1Q34 35.5 32.6 36.9L25.4 44.1Q24 45.5 22.6 44.1L15.4 36.9Q14 35.5 15.4 34.1Z" fill="#6d6b63" />
		<path d="M40.55 11.95Q43 9.5 45.45 11.95L58.05 24.55Q60.5 27 58.05 29.45L45.45 42.05Q43 44.5 40.55 42.05L27.95 29.45Q25.5 27 27.95 24.55Z" fill="#ffd400" />
	</svg>
	{#if wordmark}<span class="word">choreon</span>{/if}
</span>

<style>
	.logo { display: inline-flex; align-items: center; gap: calc(var(--s) * 0.34); }
	.logo svg { flex: none; }
	.word { font-weight: 600; font-size: calc(var(--s) * 0.82); letter-spacing: -0.035em; line-height: 1; color: var(--text); }
</style>
