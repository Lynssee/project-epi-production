/**
 * Paket 06 Site Visit Release — Gate Kunjungan Finance (docs/(eh) site visit/
 * 06_finance-gate-kunjungan.md §2.1): 2 kolom baru site_checkin_settings.
 *
 * - maks_selisih_hari_klaim (int, default 7): klaim boleh diajukan paling lambat
 *   sekian hari setelah kunjungan.
 * - visit_picker_hari (int, default 30): rentang hari kunjungan ditampilkan di
 *   picker klaim (server my-visits/+server.ts tetap membatasi MAX_DAYS=90).
 *
 * Idempoten (dry-run default, --apply untuk eksekusi).
 *
 * Cara run:
 *   node scripts/site-visit-finance-gate-setup.mjs            (dry-run)
 *   node scripts/site-visit-finance-gate-setup.mjs --apply    (eksekusi nyata)
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

async function createField(collection, field, type, meta, schema) {
	console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} field ${collection}.${field} (${type}, default ${schema?.default_value ?? '-'})`);
	if (!APPLY) return;
	await req('POST', `/fields/${collection}`, { field, type, meta: { interface: 'input', ...meta }, schema: schema || {} });
}

async function main() {
	console.log(`\n=== Site Visit Release Paket 06: gate kunjungan finance (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

	const existing = await getExistingFields('site_checkin_settings');

	if (existing.has('maks_selisih_hari_klaim')) {
		console.log('  ⚠️  site_checkin_settings.maks_selisih_hari_klaim sudah ada, lewati.');
	} else {
		await createField(
			'site_checkin_settings',
			'maks_selisih_hari_klaim',
			'integer',
			{ note: 'Klaim (reimburse/BBM) boleh diajukan paling lambat sekian hari setelah tanggal kunjungan. Paket 06 §2.1.' },
			{ default_value: 7 }
		);
	}

	if (existing.has('visit_picker_hari')) {
		console.log('  ⚠️  site_checkin_settings.visit_picker_hari sudah ada, lewati.');
	} else {
		await createField(
			'site_checkin_settings',
			'visit_picker_hari',
			'integer',
			{ note: 'Rentang hari ke belakang kunjungan ditampilkan saat memilih kunjungan untuk klaim. Paket 06 §2.1.' },
			{ default_value: 30 }
		);
	}

	console.log(`\n${APPLY ? '✅  Selesai.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk eksekusi nyata (setelah disetujui Lead).'}\n`);
}

main().catch((e) => {
	console.error('❌  Gagal:', e.message);
	process.exit(1);
});
