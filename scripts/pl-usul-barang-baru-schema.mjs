/**
 * Skema PLG-11 — jalur "Usul Barang Baru" Packing List.
 * Rencana & alur: docs/rencana-usul-barang-baru-pl.md. WAJIB izin Lead sebelum --apply.
 *
 * Membuat koleksi BARU `identitas_barang_usulan_baru` (+ 3 relasi M2O). Tidak mengubah kolom/koleksi
 * yang sudah ada (menghindari insiden alter field -> FK anak NULL, 17 Okt 2026).
 *
 *   identitas_barang_usulan_baru
 *     id, project_budget_id -> project_budgets, usulan_nama, usulan_satuan, usulan_kategori, catatan,
 *     status (menunggu|diterima|ditolak), identitas_barang_id -> identitas_barang (diisi saat diterima),
 *     diusulkan_oleh_karyawan_id -> karyawan, diusulkan_pada, ditinjau_oleh, ditinjau_pada, alasan_tolak
 *
 * Idempoten: dry-run default; koleksi/field yang sudah ada TIDAK ditimpa, hanya diperiksa.
 *   node scripts/pl-usul-barang-baru-schema.mjs            (dry-run, hanya membaca)
 *   node scripts/pl-usul-barang-baru-schema.mjs --apply    (buat yang belum ada, lalu verifikasi)
 *
 * Izin baca/tulis per peran (leader, logistik) diatur Lead di Directus setelah ini.
 */
import 'dotenv/config';

const API_URL = (process.env.DIRECTUS_API_URL || process.env.VITE_DIRECTUS_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.DIRECTUS_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
const APPLY = process.argv.includes('--apply');
const COLLECTION = 'identitas_barang_usulan_baru';

if (!API_URL || !TOKEN) {
	console.error('❌  DIRECTUS_API_URL / DIRECTUS_TOKEN belum di-set di .env');
	process.exit(1);
}
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function req(method, path, body) {
	const res = await fetch(`${API_URL}${path}`, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
	const json = await res.json().catch(() => ({}));
	return { ok: res.ok, status: res.status, json };
}
const must = (r, what) => {
	if (!r.ok) throw new Error(`${what}: HTTP ${r.status} ${r.json.errors?.[0]?.message || ''}`);
	return r.json;
};
const log = (msg) => console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} ${msg}`);

const str = (field, max, note, extra = {}) => ({
	field, type: 'string',
	schema: { max_length: max, is_nullable: true },
	meta: { interface: 'input', width: 'half', note, ...extra }
});
const m2o = (field, note) => ({
	field, type: 'integer',
	schema: { is_nullable: true },
	meta: { interface: 'select-dropdown-m2o', special: ['m2o'], width: 'half', note }
});

const FIELDS = [
	{ field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true }, meta: { hidden: true, readonly: true } },
	m2o('project_budget_id', 'Baris project_budgets (PL) yang menunggu barang ini.'),
	str('usulan_nama', 255, 'Nama barang yang dibutuhkan (belum ada di Master Katalog).'),
	str('usulan_satuan', 50, 'Satuan yang diusulkan leader.'),
	str('usulan_kategori', 50, 'Kategori PL (packing_consumable, packing_safety, ...).'),
	{ field: 'catatan', type: 'text', schema: { is_nullable: true }, meta: { interface: 'input-multiline', width: 'full', note: 'Spesifikasi / alasan dari leader.' } },
	{
		field: 'status', type: 'string',
		schema: { max_length: 20, is_nullable: false, default_value: 'menunggu' },
		meta: { interface: 'select-dropdown', width: 'half', options: { choices: [
			{ text: 'Menunggu', value: 'menunggu' }, { text: 'Diterima', value: 'diterima' }, { text: 'Ditolak', value: 'ditolak' }
		] } }
	},
	m2o('identitas_barang_id', 'Barang master hasil keputusan Admin Logistik (dibuat baru atau dipilih). Diisi saat diterima.'),
	m2o('diusulkan_oleh_karyawan_id', 'Karyawan (leader) yang mengusulkan.'),
	{ field: 'diusulkan_pada', type: 'timestamp', schema: { is_nullable: true }, meta: { special: ['date-created', 'cast-timestamp'], interface: 'datetime', readonly: true, width: 'half' } },
	str('ditinjau_oleh', 255, 'Nama/email Admin Logistik yang meninjau.', { readonly: true }),
	{ field: 'ditinjau_pada', type: 'timestamp', schema: { is_nullable: true }, meta: { special: ['cast-timestamp'], interface: 'datetime', readonly: true, width: 'half' } },
	{ field: 'alasan_tolak', type: 'text', schema: { is_nullable: true }, meta: { interface: 'input-multiline', width: 'full', note: 'Wajib diisi bila status=ditolak.' } }
];

const RELATIONS = [
	{ field: 'project_budget_id', related: 'project_budgets' },
	{ field: 'identitas_barang_id', related: 'identitas_barang' },
	{ field: 'diusulkan_oleh_karyawan_id', related: 'karyawan' }
];

async function main() {
	console.log(`Target: ${API_URL}  mode: ${APPLY ? 'APPLY' : 'dry-run'}`);
	const col = await req('GET', `/collections/${COLLECTION}`);

	if (col.ok) {
		const have = new Set((must(await req('GET', `/fields/${COLLECTION}`), 'baca field')).data.map((f) => f.field));
		const missing = FIELDS.filter((f) => !have.has(f.field)).map((f) => f.field);
		console.log(missing.length ? `⚠ Koleksi sudah ada tapi field kurang: ${missing.join(', ')} (tidak ditimpa, tambahkan manual)` : `✔ ${COLLECTION} sudah ada & lengkap.`);
		return;
	}
	if (col.status !== 404 && col.status !== 403) throw new Error(`cek koleksi: HTTP ${col.status}`);
	// Directus membalas koleksi yang tidak ada sebagai 403 (Aturan #1), jadi 403/404 = belum ada.

	log(`buat koleksi ${COLLECTION} dengan ${FIELDS.length} field`);
	RELATIONS.forEach((r) => log(`relasi M2O ${COLLECTION}.${r.field} -> ${r.related} (on delete: SET NULL)`));
	if (!APPLY) {
		console.log('\nDry-run selesai. Tidak ada yang diubah. Jalankan dengan --apply setelah izin Lead.');
		return;
	}

	must(await req('POST', '/collections', {
		collection: COLLECTION,
		meta: { icon: 'inventory_2', note: 'PLG-11: usulan barang BARU dari leader (belum ada di Master Katalog). Ditinjau Admin Logistik.', singleton: false },
		schema: {},
		fields: FIELDS
	}), 'buat koleksi');
	for (const r of RELATIONS) {
		must(await req('POST', '/relations', {
			collection: COLLECTION, field: r.field, related_collection: r.related, schema: { on_delete: 'SET NULL' }
		}), `relasi ${r.field}`);
	}

	const verify = must(await req('GET', `/fields/${COLLECTION}`), 'verifikasi').data.map((f) => f.field);
	const missing = FIELDS.filter((f) => !verify.includes(f.field)).map((f) => f.field);
	if (missing.length) throw new Error(`verifikasi gagal, field kurang: ${missing.join(', ')}`);
	console.log(`✔ ${COLLECTION} dibuat & terverifikasi (${verify.length} field).`);
}

main().catch((e) => {
	console.error('❌', e.message);
	process.exit(1);
});
