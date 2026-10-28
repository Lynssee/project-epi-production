/**
 * Paket 05 Site Visit Release — Tampilan HRD, Anomali & Notifikasi (docs/(eh) site visit/
 * 05_hrd-tampilan-notifikasi.md §skema): 2 kolom baru site_checkin_settings.
 *
 * - anomali_cooldown_hari (int, default 7): jarak minimum hari sebelum notifikasi visit_anomali
 *   yang SAMA (karyawan+lokasi) boleh dikirim ulang (SVR-20, anti alarm-fatigue).
 * - min_durasi_menit_finansial (int, default 30): ambang durasi khusus picker klaim finansial
 *   (reimburse/BBM) — sengaja terpisah dari min_durasi_menit yang dipakai sinkron payroll (SVR-21).
 *
 * Idempoten (dry-run default, --apply untuk eksekusi).
 *
 * Cara run:
 *   node scripts/site-visit-hrd-tampilan-setup.mjs            (dry-run)
 *   node scripts/site-visit-hrd-tampilan-setup.mjs --apply    (eksekusi nyata)
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
	console.log(`\n=== Site Visit Release Paket 05: tampilan HRD, anomali & notifikasi (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

	const existing = await getExistingFields('site_checkin_settings');

	if (existing.has('anomali_cooldown_hari')) {
		console.log('  ⚠️  site_checkin_settings.anomali_cooldown_hari sudah ada, lewati.');
	} else {
		await createField(
			'site_checkin_settings',
			'anomali_cooldown_hari',
			'integer',
			{ note: 'Jarak minimum hari sebelum notifikasi anomali kunjungan yang sama (karyawan+lokasi) dikirim ulang. Paket 05 §3.1.' },
			{ default_value: 7 }
		);
	}

	if (existing.has('min_durasi_menit_finansial')) {
		console.log('  ⚠️  site_checkin_settings.min_durasi_menit_finansial sudah ada, lewati.');
	} else {
		await createField(
			'site_checkin_settings',
			'min_durasi_menit_finansial',
			'integer',
			{ note: 'Ambang durasi (menit) untuk tanda "durasi rendah" di picker klaim finansial (reimburse/BBM) — terpisah dari min_durasi_menit (payroll). Paket 05 §3.2.' },
			{ default_value: 30 }
		);
	}

	console.log(`\n${APPLY ? '✅  Selesai.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk eksekusi nyata (setelah disetujui Lead).'}\n`);
}

main().catch((e) => {
	console.error('❌  Gagal:', e.message);
	process.exit(1);
});
