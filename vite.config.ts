import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			adapter: adapter()
		})
	],
	server: {
		host: '127.0.0.1',
		port: 5610,
		strictPort: true,
		// data/ is the studio's working state (renders, kits, the database), not source code. Watching it is useless, and on
		// Windows a watched folder cannot be renamed: the harvest's staging swap (captureInto) failed with EPERM.
		watch: { ignored: ['**/data/**'] }
	}
});
