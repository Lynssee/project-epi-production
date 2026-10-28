/**
 * Paket 04 Site Visit Release — Akurasi GPS & Koordinat Proyek (docs/(eh) site visit/
 * 04_gps-akurasi-koordinat-proyek.md §3.1): 3 kolom baru site_checkin_settings.
 *
 * - akurasi_maks_m (int, default 500): batas akurasi GPS (meter). Di atas ini,
 *   kunjungan dianggap lokasinya kurang pasti.
 * - akurasi_mode (string, default 'soft'): 'shadow' hanya dicatat · 'soft' tetap
 *   boleh check-in tapi tidak otomatis masuk tunjangan (butuh ACC HRD) · 'hard'
 *   check-in ditolak.
 * - akurasi_enforce_from (date, nullable): mode berlaku mulai tanggal ini
 *   (sebelumnya diperlakukan 'shadow') — Aturan #3, anti-lockdown retroaktif.
 * - status_proyek_kunjungan (string/csv, default 'on progress,repair,prepare'): whitelist status
 *   proyek yang boleh muncul di daftar "Kunjungan" (§3.7, SVR-24) — dulu hardcode di kode.
 *
 * Idempoten (dry-run default, --apply untuk eksekusi).
 *
 * Cara run:
 *   node scripts/site-visit-gps-akurasi-setup.mjs            (dry-run)
 *   node scripts/site-visit-gps-akurasi-setup.mjs --apply    (eksekusi nyata)
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
	console.log(`\n=== Site Visit Release Paket 04: akurasi GPS & koordinat proyek (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

	const existing = await getExistingFields('site_checkin_settings');

	if (existing.has('akurasi_maks_m')) {
		console.log('  ⚠️  site_checkin_settings.akurasi_maks_m sudah ada, lewati.');
	} else {
		await createField(
			'site_checkin_settings',
			'akurasi_maks_m',
			'integer',
			{ note: 'Batas ketepatan GPS. 500 m disarankan. Di atas ini kunjungan perlu dicek HRD sebelum masuk tunjangan. Paket 04 §3.1.' },
			{ default_value: 500 }
		);
	}

	if (existing.has('akurasi_mode')) {
		console.log('  ⚠️  site_checkin_settings.akurasi_mode sudah ada, lewati.');
	} else {
		await createField(
			'site_checkin_settings',
			'akurasi_mode',
			'string',
			{
				interface: 'select-dropdown',
				options: {
					choices: [
						{ text: 'shadow — hanya dicatat', value: 'shadow' },
						{ text: 'soft — tetap boleh, tapi butuh ACC HRD', value: 'soft' },
						{ text: 'hard — check-in ditolak', value: 'hard' }
					]
				},
				note: "Mulai dari 'soft'. 'hard' menolak check-in — gunakan hanya setelah semua karyawan sudah mengatur Lokasi akurat. Paket 04 §3.1."
			},
			{ default_value: 'soft' }
		);
	}

	if (existing.has('akurasi_enforce_from')) {
		console.log('  ⚠️  site_checkin_settings.akurasi_enforce_from sudah ada, lewati.');
	} else {
		await createField(
			'site_checkin_settings',
			'akurasi_enforce_from',
			'date',
			{
				interface: 'datetime',
				note: "Mode 'hard'/'soft' baru berlaku mulai tanggal ini. Sebelumnya diperlakukan 'shadow' (Aturan #3 — anti-lockdown retroaktif). Paket 04 §3.1."
			},
			{ is_nullable: true }
		);
	}

	if (existing.has('status_proyek_kunjungan')) {
		console.log('  ⚠️  site_checkin_settings.status_proyek_kunjungan sudah ada, lewati.');
	} else {
		await createField(
			'site_checkin_settings',
			'status_proyek_kunjungan',
			'string',
			{ note: 'Daftar status proyek (pisah koma) yang muncul di tab "Kunjungan" saat memilih proyek check-in. Default: on progress,repair,prepare. Paket 04 §3.7.' },
			{ default_value: 'on progress,repair,prepare' }
		);
	}

	console.log(`\n${APPLY ? '✅  Selesai.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk eksekusi nyata (setelah disetujui Lead).'}\n`);
}

main().catch((e) => {
	console.error('❌  Gagal:', e.message);
	process.exit(1);
});
