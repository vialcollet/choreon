<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();
</script>

<!-- Re-creates the page when the project or the stills batch changes: pages seed their drafts (settings,
     search box, stills template and batch) from `data` once, and SvelteKit reuses the component for the same route. -->
{#key `${page.params.project}/${page.params.lot ?? ''}`}
	{@render children()}
{/key}
