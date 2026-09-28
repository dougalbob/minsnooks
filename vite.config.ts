import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// Arena live previews are proxied under {port}-{sandboxId}.e2b.app;
	// allow those hosts (and localhost) in the dev server's host check.
	server: {
		allowedHosts: ['.e2b.app', 'localhost']
	},
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Single Node application (HANDOFF §9): `npm run build && node build`.
			adapter: adapter()
		})
	]
});
