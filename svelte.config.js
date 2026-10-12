// Kit options live in vite.config.ts; this file is for tooling (svelte-check).
import adapter from '@sveltejs/adapter-node';
export default { kit: { adapter: adapter() } };
