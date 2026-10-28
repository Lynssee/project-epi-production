/**
 * Paket 10 Site Visit Release — UX Orang Awam & Jaringan Buruk (docs/(eh) site visit/
 * 10_ux-orang-awam.md §2.2): 1 kolom baru site_checkin_settings.
 *
 * - pengingat_checkout_jam (csv, default '17:30,21:00'): jam-jam WIB dimana bar check-in aktif
 *   berubah oranye sebagai pengingat lupa checkout (U5).
 *
 * Idempoten (dry-run default, --apply untuk eksekusi).
 *
 * Cara run:
 *   node scripts/site-visit-ux-pengingat-setup.mjs            (dry-run)
 *   node scripts/site-visit-ux-pengingat-setup.mjs --apply    (eksekusi nyata)
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
	console.log(`\n=== Site Visit Release Paket 10: pengingat_checkout_jam (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

	const existing = await getExistingFields('site_checkin_settings');

	if (existing.has('pengingat_checkout_jam')) {
		console.log('  ⚠️  site_checkin_settings.pengingat_checkout_jam sudah ada, lewati.');
	} else {
		console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} field site_checkin_settings.pengingat_checkout_jam (string/csv, default '17:30,21:00')`);
		if (APPLY) {
			await req('POST', '/fields/site_checkin_settings', {
				field: 'pengingat_checkout_jam',
				type: 'string',
				meta: {
					interface: 'input',
					note: "Jam-jam WIB (pisah koma, format HH:mm) dimana bar check-in aktif berubah oranye sebagai pengingat lupa checkout. Default '17:30,21:00'. Paket 10 §2.2."
				},
				schema: { default_value: '17:30,21:00' }
			});
		}
	}

	console.log(`\n${APPLY ? '✅  Selesai.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk eksekusi nyata (setelah disetujui Lead).'}\n`);
}

main().catch((e) => {
	console.error('❌  Gagal:', e.message);
	process.exit(1);
});
