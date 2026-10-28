import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Fase 0 — Rencana Implementasi Asisten Eltama v2.0 §4/§13: adapter-auto tidak
		// menjamin endpoint server (mis. gateway AI Fase 1) berjalan di server sendiri.
		// Belum pernah di-deploy ke produksi (dikonfirmasi user), jadi diganti ke
		// adapter-node — sama seperti dashboard admin (erp-epi-1), yang dijalankan
		// sebagai proses Node biasa (`node build/index.js`).
		// precompress: Fase 3.7 audit performa 29 Sep 2026 -- pre-gzip/brotli asset statis saat
		// build, disajikan otomatis berdasar Accept-Encoding klien (bawaan adapter-node).
		adapter: adapter({ precompress: true }),
		serviceWorker: {
			register: false
		},
		// Fase 1 keamanan pondasi — daftar domain berdasarkan pemakaian nyata yang
		// terverifikasi di source (Directus SDK, Firebase Auth, maplibre+openfreemap).
		// Jika ada domain lain yang kena block, cek console browser lalu tambah di sini —
		// jangan longgarkan ke '*'.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ["'self'"],
				'img-src': [
					"'self'",
					'data:',
					'blob:',
					'https://directus.eltamaprimaindo.com',
					'https://directus-sy.eltamaprimaindo.com',
					'https://*.googleusercontent.com',
					'https://img.youtube.com'
				],
				'font-src': ["'self'", 'data:'],
				'connect-src': [
					"'self'",
					'https://directus.eltamaprimaindo.com',
					'https://directus-sy.eltamaprimaindo.com',
					'https://tiles.openfreemap.org',
					'https://*.googleapis.com',
					'https://identitytoolkit.googleapis.com',
					'https://securetoken.googleapis.com',
					'https://*.firebaseio.com',
					'wss://*.firebaseio.com'
				],
				'script-src': [
					"'self'",
					'https://*.googleapis.com',
					'https://*.gstatic.com',
					'https://www.youtube.com',
					'https://s.ytimg.com',
					"'sha256-Ckn9PDqdWwWzSz0DQoT1MTJZmSZeDWqzoEY2Z+kieAk='",
					"'sha256-HZkyU2UqkgzvpVn92Yd7tYumYyniDuxJpOXIjU4s96s='"
				],
				'style-src': ["'self'", "'unsafe-inline'"],
				'worker-src': ["'self'", 'blob:'],
				'frame-src': [
					"'self'",
					'blob:',
					'data:',
					'https://login-43e72.firebaseapp.com',
					'https://www.youtube.com',
					'https://www.youtube-nocookie.com'
				],
				'object-src': ["'self'", 'blob:'],
				'base-uri': ["'self'"],
				'frame-ancestors': ["'self'"]
			}
		},
		version: {
			pollInterval: 0
		}
	}
};

export default config;
