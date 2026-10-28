// Config vitest khusus test komponen Svelte ber-environment jsdom (*.dom.test.ts).
// Dipisah dari vite.config.ts (PWA plugin tak diperlukan). Pool `vmThreads` dipakai seperti di erp-epi
// karena pool default `forks` gagal start di mesin dev ini begitu jsdom dipakai.
// Jalankan: npx vitest run --config vitest.dom.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Tanpa ini `svelte` ter-resolve ke build server dan mount() melempar lifecycle_function_unavailable.
	resolve: { conditions: ['browser'] },
	test: {
		include: ['src/**/*.dom.test.{js,ts}'],
		environment: 'jsdom',
		pool: 'vmThreads'
	}
});
