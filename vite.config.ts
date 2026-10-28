import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			// 'prompt' (bukan 'autoUpdate') — autoUpdate memanggil window.location.reload() otomatis
			// begitu service worker baru aktif, yang sering terpicu saat tab di-background (mis. saat
			// membuka kamera native untuk foto) dan menutup popup/hilangkan data yang sedang diisi.
			registerType: 'prompt',
			// Kunci base, scope, dan buildBase ke root '/' agar service worker selalu
			// diregistrasikan ke '/sw.js' secara absolut. Mencegah SvelteKit (paths.relative: true)
			// meng-generate registrasi relatif './sw.js' yang memicu 404 saat membuka sub-halaman (mis. /ess/reimburse).
			base: '/',
			scope: '/',
			buildBase: '/',
			manifest: {
				name: 'Eltama Prima Indo — Operasional',
				short_name: 'EPI Ops',
				description: 'Dashboard lapangan & Absensi Mandiri (ESS) karyawan PT. Eltama Prima Indo',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				theme_color: '#1F6592',
				background_color: '#ffffff',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
					{ src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
				]
			},
			workbox: {
				cleanupOutdatedCaches: true,
				// Ditegaskan eksplisit (jangan andalkan default): service worker baru TIDAK
				// boleh langsung aktif & mengambil alih halaman yang sedang terbuka. Tanpa ini,
				// SW baru yang ter-install saat user sedang mengisi ceklist lapangan bisa
				// men-reload halaman dan menghapus isian + foto yang belum tersubmit.
				// Pergantian versi hanya lewat tombol di UpdateBanner (registerType 'prompt').
				skipWaiting: false,
				clientsClaim: false,
				// Matikan navigateFallback ke '/' karena adapter-node me-render shell secara dinamis
				// di server Node.js, bukan file statis yang di-precache dalam self.__WB_MANIFEST.
				// Mencegah error: "Uncaught (in promise) non-precached-url: non-precached-url :: [{'url':'/'}]"
				navigateFallback: null,
				// API ESS tidak boleh pernah disajikan dari cache stale (data absensi/personal).
				navigateFallbackDenylist: [/^\/api\//],
				runtimeCaching: [
					// LMS & Directus assets: network-first dengan fallback cache untuk luring lapangan (materi LMS)
					{
						urlPattern: ({ url, request }) =>
							request.method === 'GET' &&
							(/(\/api\/ess\/training\/\d+|\/assets\/[0-9a-f-]+)/i.test(url.pathname)),
						handler: 'NetworkFirst',
						options: {
							cacheName: 'lms-offline-assets',
							networkTimeoutSeconds: 4,
							expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
							cacheableResponse: { statuses: [0, 200] }
						}
					},
					// FITUR-6 (PWA Absensi Offline, Lapangan): endpoint READ-ONLY status/riwayat boleh
					// disajikan dari cache saat offline (NetworkFirst — coba network dulu, fallback cache
					// bila timeout/offline) supaya karyawan tetap bisa LIHAT slip gaji/status kasbon/
					// riwayat lembur tanpa sinyal. Urutan rule PENTING: harus di atas catch-all NetworkOnly
					// di bawah supaya lebih spesifik & dicocokkan lebih dulu. TIDAK termasuk endpoint yang
					// menulis (POST) atau status absensi hari ini (attendance/status wajib selalu fresh
					// untuk mencegah double clock-in dari data basi).
					{
						urlPattern: ({ url, request }) =>
							request.method === 'GET' &&
							/^\/api\/ess\/(payroll\/status|kasbon\/status|lembur\/status|keuangan\/summary)/.test(url.pathname),
						handler: 'NetworkFirst',
						options: {
							cacheName: 'ess-readonly-status',
							networkTimeoutSeconds: 4,
							expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 },
							cacheableResponse: { statuses: [0, 200] }
						}
					},
					{
						urlPattern: /^\/api\/ess\//,
						handler: 'NetworkOnly'
					},
					// QR fisik (label equipment/rak/gudang) dibuka via kamera native HP sebagai
					// navigasi baru sepenuhnya di luar kendali kita -- registerType 'prompt' di atas
					// sengaja TIDAK auto-update supaya sesi lapangan yang sedang isi form tidak
					// ke-reload paksa, tapi efek sampingnya: navigateFallback default menyajikan
					// app-shell dari precache LAMA tanpa pernah coba network, jadi user yang scan QR
					// fisik bisa dapat versi basi (termasuk bug yang sudah diperbaiki) tanpa pernah
					// tahu ada versi baru. /scan/<kode> adalah titik masuk baru (bukan sesi yang
					// sedang diisi) -- aman & wajib coba network dulu supaya selalu dapat shell
					// terbaru selama sinyal ada, baru fallback ke cache kalau offline.
					{
						urlPattern: ({ request, url }: { request: Request; url: URL }) =>
							request.mode === 'navigate' && url.pathname.startsWith('/scan/'),
						handler: 'NetworkFirst',
						options: {
							cacheName: 'scan-entry-shell',
							networkTimeoutSeconds: 4
						}
					},
					// Fase 7 (restrukturisasi navigasi Maintenance, 5 Agustus 2026): mekanik konfirmasi
					// sering kehilangan sinyal & ada beberapa lokasi blank spot total. Referensi P2H/PM
					// (equipment, template, kategori, personnel) jarang berubah -- aman disajikan dari
					// cache saat offline supaya form P2H yang PERNAH dibuka bisa dibuka lagi tanpa sinyal.
					// SENGAJA TIDAK termasuk p2h_session/pm_due_tracker/work_order/maint_tickets --
					// itu data transaksional/status yang wajib selalu fresh (sama alasannya dengan
					// attendance/status di atas: cache basi bisa bikin submit dobel / status keliru).
					{
						urlPattern: ({ url, request }) =>
							request.method === 'GET' &&
							/^\/api\/directus\/items\/(equipment|p2h_template|category|personnel|pm_task_template)(\/|$|\?)/.test(url.pathname + url.search),
						handler: 'NetworkFirst',
						options: {
							cacheName: 'maintenance-reference-data',
							networkTimeoutSeconds: 4,
							expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
							cacheableResponse: { statuses: [0, 200] }
						}
					}
				]
			}
		})
	],
	server: {
		allowedHosts: [
			'project.eltamaprimaindo.com'
		],
		port: 5174,
		host: true,
		// Matikan HMR sepenuhnya — agar saat ada perubahan koding tidak langsung auto-refresh.
		// User perlu me-refresh browser secara manual untuk melihat hasilnya.
		hmr: false,
		// "Auto refresh" saat mengisi ceklist / mengunggah foto di dev (localhost:5174):
		// repo ini berada di dalam folder Synology Drive yang tersinkron terus-menerus.
		// Klien sync menyentuh & menulis ulang file (termasuk file temp/konflik miliknya
		// sendiri) tanpa ada perubahan kode nyata. Watcher Vite membacanya sebagai
		// perubahan modul lalu mengirim `full-reload` ke browser — halaman ter-refresh
		// di tengah pengisian dan isian yang belum tersimpan hilang. Pemicunya ada di
		// level dev server, jadi ini berlaku untuk SEMUA modul lapangan, bukan cuma P2H.
		watch: {
			ignored: [
				'**/.git/**',
				'**/node_modules/**',
				'**/.svelte-kit/**',
				'**/build/**',
				'**/.agents/**',
				'**/.claude/**',
				'**/.gemini/**',
				'**/brain/**',
				'**/scratch/**',
				'**/directus-schema/**',
				'**/docs/**',
				'**/@eaDir/**', // folder metadata Synology
				'**/*.sync-conflict*', // salinan konflik Synology Drive
				'**/.sync/**', // metadata sinkronisasi
				'**/*.drivedownload*', // file unduhan parsial OneDrive/Google Drive
				'**/*.lock*',
				'**/.vscode/**',
				'**/.idea/**',
				'**/~$*', // file sementara Office/OneDrive
				'**/.~*', // file sementara saat klien sync menulis
				'**/*.tmp*',
				'**/*.log',
				'**/*.txt',
				'**/*.pdf',
				'**/*.md',
				'**/*.jsonl'
			],
			// Tunggu file benar-benar selesai ditulis sebelum memicu HMR, supaya
			// penulisan bertahap oleh klien sync tidak memicu reload beruntun.
			awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 }
		}
	},
	preview: {
		port: 5174,
		host: true
	},
	optimizeDeps: {
		holdUntilCrawlEnd: true,
		include: [
			'@tabler/icons-svelte',
			'@sentry/sveltekit',
			'@tanstack/svelte-query',
			'@directus/sdk',
			'firebase/app',
			'firebase/auth',
			'firebase/firestore',
			'isomorphic-dompurify',
			'idb',
			'browser-image-compression',
			'qrcode',
			'jsqr',
			'zod',
			'exceljs',
			'jspdf',
			'pdfmake',
			'html5-qrcode',
			'maplibre-gl',
			'svelte/transition',
			'svelte/animate',
			'svelte/motion',
			'svelte/store'
		]
	}
});
