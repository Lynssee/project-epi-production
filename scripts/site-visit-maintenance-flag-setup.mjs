/**
 * Paket 09 Site Visit Release — Kunjungan Tipe Maintenance (docs/(eh) site visit/
 * 09_maintenance.md §0): 1 kolom baru site_checkin_settings.
 *
 * - tipe_maintenance_aktif (boolean, default false, cast-boolean): tab Maintenance di Site
 *   Check-in disembunyikan sampai kolom ini diaktifkan admin — alur maintenance belum pernah
 *   dipakai di produksi (0 kunjungan) dan beberapa bug ditemukan (§1 dokumen), jadi TETAP OFF
 *   sampai Lead Maintenance menyetujui setelah uji manual (§4 dokumen).
 *
 * Idempoten (dry-run default, --apply untuk eksekusi).
 *
 * Cara run:
 *   node scripts/site-visit-maintenance-flag-setup.mjs            (dry-run)
 *   node scripts/site-visit-maintenance-flag-setup.mjs --apply    (eksekusi nyata)
 */

import 'dotenv/config';

const API_URL = (process.env.VITE_DIRECTUS_API_URL || process.env.DIRECTUS_URL || '').replace(/\/$/, '');
const TOKEN = process.env.DIRECTUS_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
const APPLY = process.argv.includes('--apply');

if (!API_URL || !TOKEN) {
	console.error('❌  DIRECTUS_URL/VITE_DIRECTUS_API_URL atau DIRECTUS_TOKEN/VITE_DIRECTUS_TOKEN belum di-set di .env');
	process.exit(1);
}

const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function req(method, path, body) {
	const res = await fetch(`${API_URL}${path}`, {
		method,
		headers: HEADERS,
		body: body ? JSON.stringify(body) : undefined
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(json.errors?.[0]?.message || `HTTP ${res.status}`);
	return json;
}

async function getExistingFields(collection) {
	const res = await req('GET', `/fields/${collection}`);
	return new Set((res.data || []).map((f) => f.field));
}

async function main() {
	console.log(`\n=== Site Visit Release Paket 09: flag tipe_maintenance_aktif (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

	const existing = await getExistingFields('site_checkin_settings');

	if (existing.has('tipe_maintenance_aktif')) {
		console.log('  ⚠️  site_checkin_settings.tipe_maintenance_aktif sudah ada, lewati.');
	} else {
		console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} field site_checkin_settings.tipe_maintenance_aktif (boolean, default false)`);
		if (APPLY) {
			await req('POST', '/fields/site_checkin_settings', {
				field: 'tipe_maintenance_aktif',
				type: 'boolean',
				meta: {
					interface: 'boolean',
					special: ['cast-boolean'],
					note: "Aktifkan tab Maintenance di Site Check-in HANYA setelah Paket 09 lolos uji manual (§4 dokumen) dan disetujui Lead Maintenance. Default OFF — alur ini belum pernah dipakai di produksi."
				},
				schema: { default_value: false }
			});
		}
	}

	console.log(`\n${APPLY ? '✅  Selesai.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk eksekusi nyata (setelah disetujui Lead).'}\n`);
}

main().catch((e) => {
	console.error('❌  Gagal:', e.message);
	process.exit(1);
});
