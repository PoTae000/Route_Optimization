import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	optimizeDeps: {
		exclude: ['leaflet-rotate']
	},
	ssr: {
		noExternal: ['leaflet-rotate']
	},
	server: {
		host: true,
		allowedHosts: ['suepskun.online']
  }
});
