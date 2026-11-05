// src/routes/k/[kode]/manifest.webmanifest/+server.ts
// Manifest PWA per proyek (Rencana Kiosk Proyek, Fase 3): ikon "Absen EPI" di layar utama HP membuka
// langsung /k/<kode> — bukan beranda aplikasi lapangan. Statis & publik (tanpa Directus, tanpa nama proyek),
// karena kode kiosk memang tercetak di poster. `id` berbeda per kode supaya HP yang dipakai di dua proyek
// dapat memasang dua ikon terpisah.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { normalizeKode } from '$lib/server/kioskProyekToken';

export const GET: RequestHandler = ({ params }) => {
	const kode = normalizeKode(params.kode);
	if (!kode) throw error(404, 'Kode kiosk tidak valid.');
	return json(
		{
			id: `/k/${kode}`,
			name: 'Absen Kru EPI',
			short_name: 'Absen EPI',
			description: 'Absen masuk/pulang kru proyek PT. Eltama Prima Indo',
			start_url: `/k/${kode}`,
			scope: '/k/',
			display: 'standalone',
			orientation: 'portrait',
			theme_color: '#059669',
			background_color: '#f9fafb',
			icons: [
				{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
				{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
				{ src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
			]
		},
		{ headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } }
	);
};
