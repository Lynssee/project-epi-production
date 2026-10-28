/**
 * Paket 02 Site Visit Release — Fase 2 (docs/(analyst) site visit/02_offline-idempotensi.md
 * §3.9.5): kolom site_checkin.checkout_client_txn_id supaya checkout offline idempoten
 * penuh (replay dengan client_txn_id yang sama mengembalikan baris yang sama, bukan
 * menutup ulang/menabrak baris lain) — pola sama dengan client_txn_id check-in (SV-12).
 *
 * Idempoten: aman dijalankan berkali-kali, melewati kolom yang sudah ada (pola sama
 * dengan erp-epi/src/lib/scripts/fleet-fase4-sitecheckin-setup.mjs).
 *
 * Cara run:
 *   node scripts/site-visit-checkout-idempotensi-setup.mjs            (dry-run)
 *   node scripts/site-visit-checkout-idempotensi-setup.mjs --apply    (eksekusi nyata, wajib disetujui Lead — Aturan #12)
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
	console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} field ${collection}.${field} (${type})`);
	if (!APPLY) return;
	await req('POST', `/fields/${collection}`, { field, type, meta: { interface: 'input', ...meta }, schema: schema || {} });
}

async function main() {
	console.log(`\n=== Site Visit Release Paket 02: checkout_client_txn_id (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

	const sc = await getExistingFields('site_checkin');
	if (sc.has('checkout_client_txn_id')) {
		console.log('  ⚠️  site_checkin.checkout_client_txn_id sudah ada, lewati.');
	} else {
		await createField(
			'site_checkin',
			'checkout_client_txn_id',
			'string',
			{
				note:
					'UUID dibuat KLIEN saat checkout masuk antrean offline (Paket 02 §3.9), dikirim ulang saat replay. Server dedup: bila kolom ini sudah terisi dengan nilai yang sama pada baris yang SUDAH tertutup, checkout dianggap sukses (already_closed: true), bukan error "Check-in sudah ditutup". NULL untuk checkout online biasa / baris lama.',
				interface: 'input',
				readonly: true
			},
			{ is_nullable: true, is_unique: true, max_length: 36 }
		);
	}

	console.log(`\n${APPLY ? '✅  Selesai.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk eksekusi nyata (setelah disetujui Lead).'}\n`);
}

main().catch((e) => {
	console.error('❌  Gagal:', e.message);
	process.exit(1);
});
