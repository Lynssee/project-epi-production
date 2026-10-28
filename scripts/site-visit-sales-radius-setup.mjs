/**
 * Paket 08b Site Visit Release — Endpoint Server & Tautan site_checkin (docs/(eh) site visit/
 * 08_sales-marketing.md §4.2): 1 kolom baru site_checkin_settings.
 *
 * - radius_customer_m (int, default 300): radius geofence untuk kunjungan marketing ke
 *   master_customer — menggantikan hardcode `|| 300` di createCheckin (cabang marketing).
 *
 * Idempoten (dry-run default, --apply untuk eksekusi).
 *
 * Cara run:
 *   node scripts/site-visit-sales-radius-setup.mjs            (dry-run)
 *   node scripts/site-visit-sales-radius-setup.mjs --apply    (eksekusi nyata)
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
	console.log(`\n=== Site Visit Release Paket 08b: radius_customer_m (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

	const existing = await getExistingFields('site_checkin_settings');

	if (existing.has('radius_customer_m')) {
		console.log('  ⚠️  site_checkin_settings.radius_customer_m sudah ada, lewati.');
	} else {
		console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} field site_checkin_settings.radius_customer_m (integer, default 300)`);
		if (APPLY) {
			await req('POST', '/fields/site_checkin_settings', {
				field: 'radius_customer_m',
				type: 'integer',
				meta: {
					interface: 'input',
					note: 'Radius geofence (meter) untuk kunjungan marketing ke customer existing. Paket 08b §4.2.'
				},
				schema: { default_value: 300 }
			});
		}
	}

	console.log(`\n${APPLY ? '✅  Selesai.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk eksekusi nyata (setelah disetujui Lead).'}\n`);
}

main().catch((e) => {
	console.error('❌  Gagal:', e.message);
	process.exit(1);
});
