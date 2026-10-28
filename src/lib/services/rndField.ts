// src/lib/services/rndField.ts
// Pertajam Modul R&D v2.0, Fase 7 — R&D di Dashboard Lapangan. Read-heavy, ringan.
// Pola sama dengan hse.ts: direct readItems/createItem/uploadFiles via @directus/sdk
// lewat proxy /api/directus/* (token Firebase, bukan token Directus).
// Formula/komposisi SENGAJA tidak diekspos di sini sama sekali (rahasia dagang, §Fase 7 dokumen).

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, uploadFiles } from '@directus/sdk';

export interface TdsMsdsDoc {
	id: string;
	product_code: string;
	product_name: string;
	category: string;
	tds_url: string | null;
	tds_version: string | null;
	msds_url: string | null;
	msds_version: string | null;
}

export async function searchTds(query: string): Promise<TdsMsdsDoc[]> {
	if (!query || query.trim().length < 2) return [];
	try {
		return (await directus.request(
			readItems('tds_msds_documents', {
				filter: {
					product_name: { _icontains: query.trim() },
					tds_url: { _nnull: true }
				},
				fields: ['id', 'product_code', 'product_name', 'category', 'tds_url', 'tds_version'],
				sort: ['product_name'],
				limit: 15
			})
		)) as unknown as TdsMsdsDoc[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function searchMsds(query: string): Promise<TdsMsdsDoc[]> {
	if (!query || query.trim().length < 2) return [];
	try {
		return (await directus.request(
			readItems('tds_msds_documents', {
				filter: {
					product_name: { _icontains: query.trim() },
					msds_url: { _nnull: true }
				},
				fields: ['id', 'product_code', 'product_name', 'category', 'msds_url', 'msds_version'],
				sort: ['product_name'],
				limit: 15
			})
		)) as unknown as TdsMsdsDoc[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/** Cari dokumen (TDS/MSDS) langsung dari kode produk — dipakai hasil scan QR EPI:ITEM:<id>. */
export async function findDocByProductCode(productCode: string): Promise<TdsMsdsDoc | null> {
	try {
		const rows = (await directus.request(
			readItems('tds_msds_documents', {
				filter: { product_code: { _eq: productCode } },
				fields: ['id', 'product_code', 'product_name', 'category', 'tds_url', 'tds_version', 'msds_url', 'msds_version'],
				limit: 1
			})
		)) as unknown as TdsMsdsDoc[];
		return rows[0] || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

/** Ambil kode_item dari identitas_barang lewat id — dipakai setelah scan QR EPI:ITEM:<id>. */
export async function resolveProductCodeById(itemId: number): Promise<string | null> {
	try {
		const rows = (await directus.request(
			readItems('identitas_barang', {
				filter: { id: { _eq: itemId } },
				fields: ['id', 'kode_item', 'nama_barang_lengkap'],
				limit: 1
			})
		)) as unknown as Array<{ id: number; kode_item: string; nama_barang_lengkap: string }>;
		return rows[0]?.kode_item || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface PanduanAplikasi {
	parameter: string;
	value: number;
	satuan: string | null;
}

const PANDUAN_PARAMETERS = ['Drying Time (Recoat)', 'DFT (Dry Film Thickness)', 'Spreading Rate / Daya Sebar', 'Adhesion (Cross-Cut)'];

/** Kartu Panduan Aplikasi — hasil uji LULUS terbaru (Fase 1) untuk parameter aplikasi (rasio, DFT, recoat). */
export async function fetchPanduanAplikasi(productCode: string): Promise<PanduanAplikasi[]> {
	try {
		const barang = (await directus.request(
			readItems('identitas_barang', { filter: { kode_item: { _eq: productCode } }, fields: ['id'], limit: 1 })
		)) as unknown as Array<{ id: number }>;
		const productId = barang[0]?.id;
		if (!productId) return [];

		const results = (await directus.request(
			readItems('qc_results', {
				filter: { product_id: { _eq: productId }, verdict: { _eq: 'lulus' }, parameter: { _in: PANDUAN_PARAMETERS } },
				fields: ['parameter', 'value', 'satuan', 'tested_at'],
				sort: ['-tested_at'],
				limit: -1
			})
		)) as unknown as Array<{ parameter: string; value: number; satuan: string | null }>;

		const latestByParam = new Map<string, PanduanAplikasi>();
		for (const r of results) {
			if (!latestByParam.has(r.parameter)) latestByParam.set(r.parameter, r);
		}
		return [...latestByParam.values()];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

// Fase 6.4 (rencana lifecycle produksi v2, 15 Sep 2026): kategori masalah aplikasi lapangan
// terstruktur — sebelumnya laporan cuma teks bebas, sulit ditriase R&D. `customer_complaints`
// SUDAH punya jalur eskalasi ke rnd_projects (kolom escalated_project_id, tombol admin), jadi
// di sini kita HANYA memastikan data lapangan cukup terstruktur untuk dipakai keputusan itu —
// TIDAK auto-membuat rnd_projects dari sini (pelajaran "42 proyek yatim" di rndSampleApi.js).
export const JENIS_MASALAH_APLIKASI = [
	{ value: 'daya_sebar', label: 'Daya Sebar Tidak Sesuai' },
	{ value: 'adhesi', label: 'Adhesi / Daya Rekat' },
	{ value: 'kering', label: 'Waktu Kering' },
	{ value: 'warna', label: 'Warna / Gloss Tidak Sesuai' },
	{ value: 'kontaminasi', label: 'Kontaminasi' },
	{ value: 'lainnya', label: 'Lainnya' }
];

/** Lapor Masalah Produk — masuk ke customer_complaints (koleksi kanonik Fase 2), ditandai asal lapangan. */
export async function reportProductIssue(payload: {
	batchNumber: string;
	deskripsi: string;
	site: string;
	fotoFile?: File | null;
	reportedBy: string;
	jenisMasalah?: string | null;
	dayaSebarAktual?: number | null;
}) {
	let fotoId: string | null = null;
	if (payload.fotoFile) {
		try {
			const formData = new FormData();
			formData.append('file', payload.fotoFile);
			const uploaded: any = await directus.request(uploadFiles(formData));
			fotoId = uploaded?.id || null;
		} catch (err) {
			console.warn('Gagal unggah foto laporan:', err);
		}
	}

	const jenisLabel = JENIS_MASALAH_APLIKASI.find((j) => j.value === payload.jenisMasalah)?.label;
	const structuredTags = [
		jenisLabel ? `[Jenis: ${jenisLabel}]` : '',
		payload.dayaSebarAktual != null ? `[Daya Sebar Aktual: ${payload.dayaSebarAktual} m2/L]` : ''
	].filter(Boolean).join(' ');

	return directus.request(
		createItem('customer_complaints', {
			status: 'diterima',
			kategori: 'kualitas',
			tanggal: new Date().toISOString().slice(0, 10),
			deskripsi: `[LAPANGAN - Internal]${structuredTags ? ` ${structuredTags}` : ''} ${payload.deskripsi}`,
			batch_number: payload.batchNumber || null,
			site: payload.site || 'pusat',
			pic: payload.reportedBy || '(lapangan)',
			foto: fotoId,
			status_changed_at: new Date().toISOString()
		})
	);
}

/** Minta Dokumen — antre ke admin R&D lewat rnd_permintaan_dokumen (nol koleksi duplikat, queue ringan). */
export async function requestDocument(payload: { tipe: 'tds' | 'msds'; kodeProduk: string; catatan: string; site: string; requestedBy: string }) {
	return directus.request(
		createItem('rnd_permintaan_dokumen', {
			tipe: payload.tipe,
			kode_produk: payload.kodeProduk,
			catatan: payload.catatan,
			site: payload.site,
			requested_by: payload.requestedBy,
			status: 'baru'
		})
	);
}

// ==========================================
// R&D v3 Fase 6 — Katalog Bahan (read-only) + Cek Kompatibilitas cepat.
// Formula/komposisi TETAP tidak diekspos. Data profil dari rnd_material_profile,
// aturan dari rnd_compatibility_rules (dikelola di dashboard admin).
// ==========================================

export interface MaterialProfileView {
	id: number;
	kode_item: string;
	kode_rm: string | null;
	nama: string;
	kelas: string | null;
	cas_number: string | null;
	kondisi_simpan: string | null;
	umur_simpan_hari: number | null;
	sifat_fisik: Record<string, unknown> | null;
	karakteristik_film: Record<string, unknown> | null;
	deskripsi_tds: string | null;
	catatan_aplikasi: string | null;
	inkompatibilitas_tags: string[];
	tds_url: string | null;
	msds_url: string | null;
	deskripsi_edukasi?: string | null;
	fungsi_utama?: string | null;
	cocok_untuk_produk?: string[] | null;
	tingkat_bahaya?: string | null;
	panduan_apd?: string[] | null;
	tips_penggunaan?: string | null;
	sub_kategori?: string | null;
}

export async function searchMaterialProfiles(query: string): Promise<MaterialProfileView[]> {
	if (!query || query.trim().length < 2) return [];
	try {
		const mats = (await directus.request(
			readItems('identitas_barang', {
				filter: {
					kode_item: { _starts_with: 'RM-' },
					nama_barang_lengkap: { _icontains: query.trim() }
				},
				fields: [
					'id', 'kode_item', 'kode_rm', 'nama_barang_lengkap',
					'cas_number', 'kondisi_simpan', 'umur_simpan_hari', 'sub_category.nama_sub'
				],
				sort: ['nama_barang_lengkap'],
				limit: 15
			})
		)) as any[];
		if (mats.length === 0) return [];
		const ids = mats.map((m) => m.id);
		const codes = [
			...mats.map((m) => m.kode_rm).filter(Boolean),
			...mats.map((m) => m.kode_item)
		];
		const [profs, docs] = await Promise.all([
			directus.request(
				readItems('rnd_material_profile', {
					filter: { material_id: { _in: ids } },
					fields: [
						'material_id', 'sub_kategori', 'sifat_fisik', 'karakteristik_film',
						'deskripsi_tds', 'catatan_aplikasi', 'inkompatibilitas_tags',
						'deskripsi_edukasi', 'fungsi_utama', 'cocok_untuk_produk',
						'tingkat_bahaya', 'panduan_apd', 'tips_penggunaan'
					],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('tds_msds_documents', {
					filter: { category: { _eq: 'bahan_baku' }, product_code: { _in: codes } },
					fields: ['product_code', 'tds_url', 'msds_url'],
					limit: -1
				})
			) as Promise<any[]>
		]);
		const pById = new Map(profs.map((p) => [Number(p.material_id), p]));
		const dByCode = new Map<string, any>();
		for (const d of docs) if (d.product_code) dByCode.set(String(d.product_code), d);
		return mats.map((m) => {
			const p = pById.get(Number(m.id));
			const doc = dByCode.get(String(m.kode_rm || '')) || dByCode.get(String(m.kode_item || ''));
			return {
				id: m.id,
				kode_item: m.kode_item,
				kode_rm: m.kode_rm || null,
				nama: m.nama_barang_lengkap,
				kelas: m.sub_category?.nama_sub || null,
				cas_number: m.cas_number || null,
				kondisi_simpan: m.kondisi_simpan || null,
				umur_simpan_hari: m.umur_simpan_hari ?? null,
				sifat_fisik: p?.sifat_fisik || null,
				karakteristik_film: p?.karakteristik_film || null,
				deskripsi_tds: p?.deskripsi_tds || null,
				catatan_aplikasi: p?.catatan_aplikasi || null,
				inkompatibilitas_tags: p?.inkompatibilitas_tags || [],
				tds_url: doc?.tds_url || null,
				msds_url: doc?.msds_url || null,
				deskripsi_edukasi: p?.deskripsi_edukasi || null,
				fungsi_utama: p?.fungsi_utama || null,
				cocok_untuk_produk: p?.cocok_untuk_produk || [],
				tingkat_bahaya: p?.tingkat_bahaya || null,
				panduan_apd: p?.panduan_apd || [],
				tips_penggunaan: p?.tips_penggunaan || null,
				sub_kategori: p?.sub_kategori || null
			};
		});
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export interface FieldCompatFinding {
	hasil: 'partially' | 'incompatible';
	alasan: string;
	tagsA: string[];
	tagsB: string[];
}

const CLASS_BY_CODE_FIELD: Record<string, string> = {
	RSN: 'resin', HRD: 'hardener', PGM: 'pigment', PGK: 'pigment', PST: 'pasta',
	SLV: 'solvent', SOL: 'solution', SLN: 'solution', THN: 'thinner',
	ADD: 'additive', EXT: 'extender', FLP: 'extender'
};

// Subset regex tebak-kimia — cukup untuk kasus keselamatan kritis di lapangan
// (epoksi, amina, isosianat, air, kelas pelarut, seng/aluminium).
const NAME_HINTS_FIELD: [RegExp, string][] = [
	[/\bepox|epoks/i, 'resin/epoxy'],
	[/\bwater[\s-]?based|(\bwb\b)|berbasis air/i, 'additive/water'],
	[/alkyd|alkid/i, 'resin/alkyd'],
	[/acrylic|akrilik/i, 'resin/acrylic_sb'],
	[/silicone|silikon/i, 'resin/silicone'],
	[/polyurethane|poliuretan|urethane|uretan|polyaspartic|polyurea/i, 'resin/polyurethane'],
	[/nitrocellulose|nitroselulosa/i, 'resin/nitrocellulose'],
	[/chlorinated rubber|karet klorinasi/i, 'resin/chlorinated_rubber'],
	[/vinyl ester|vinilester/i, 'resin/vinyl_ester'],
	[/isocyanate|isosianat|\bhdi\b|\bipdi\b/i, 'hardener/isocyanate'],
	[/amine|amina|polyamide|poliamida|amidoamine|hardener|pengeras/i, 'hardener/amine'],
	[/\bmekp\b|peroxide|peroksida/i, 'additive/mekp_initiator'],
	[/xylene|xylol|xilen|toluene|toluol|aromatic/i, 'solvent/aromatic'],
	[/\bm\.?e\.?k\.?\b|\bm\.?i\.?b\.?k\.?\b|methyl ethyl ketone|acetone|aseton|keton/i, 'solvent/ketone'],
	[/butyl acetate|ethyl acetate|butil asetat|etil asetat|\bester\b/i, 'solvent/ester'],
	[/mineral spirit|white spirit|hexane|heptane|hydrocarbon|hidrokarbon|aliphatic/i, 'solvent/aliphatic'],
	[/butyl glycol|glycol ether|methoxy propanol/i, 'solvent/glycol_ether'],
	[/isopropanol|\bipa\b|ethanol|etanol|methanol|butanol|alcohol|alkohol/i, 'solvent/alcohol'],
	[/\bwater\b|aquades|\baqua\b/i, 'additive/water'],
	[/cobalt.*(accel|dry|drier)|kobalt|drier|sikatif/i, 'additive/drier_cobalt'],
	[/zinc phosphate|seng fosfat/i, 'pigment/zinc_phosphate'],
	[/zinc dust|serbuk seng/i, 'pigment/zinc_dust'],
	[/alumini?um.*(leaf|paste|pigment)|pasta alumunium/i, 'pigment/aluminium_leafing'],
	[/calcium carbonate|caco3|kalsium karbonat|calcite/i, 'extender/caco3']
];

function deriveTagsField(nama: string, kodeSingkat?: string | null): string[] {
	const tags = new Set<string>();
	const klass = kodeSingkat ? CLASS_BY_CODE_FIELD[kodeSingkat.toUpperCase()] : null;
	if (klass) tags.add(klass);
	for (const [re, tag] of NAME_HINTS_FIELD) {
		if (re.test(nama)) {
			tags.add(tag);
			const b = tag.split('/')[0];
			if (b) tags.add(b);
		}
	}
	return [...tags];
}

function tagMatchesField(ruleTag: string, matTags: string[]): boolean {
	if (matTags.includes(ruleTag)) return true;
	if (ruleTag.endsWith('/any')) {
		const base = ruleTag.slice(0, -4);
		return matTags.some((t) => t === base || t.startsWith(base + '/'));
	}
	if (!ruleTag.includes('/')) return matTags.some((t) => t === ruleTag || t.startsWith(ruleTag + '/'));
	return false;
}

/** Cek cepat 2 bahan sebelum mixing di gudang — hijau/kuning/merah + alasan. */
export async function checkFieldCompatibility(
	idA: number,
	idB: number
): Promise<{ finding: FieldCompatFinding | null; a: string; b: string }> {
	try {
		const [mats, rules] = await Promise.all([
			directus.request(
				readItems('identitas_barang', {
					filter: { id: { _in: [idA, idB] } },
					fields: ['id', 'nama_barang_lengkap', 'sub_category.kode_singkat'],
					limit: 2
				})
			) as Promise<any[]>,
			directus.request(
				readItems('rnd_compatibility_rules', {
					filter: { status: { _eq: 'active' } },
					fields: ['tag_a', 'tag_b', 'hasil', 'alasan'],
					limit: -1
				})
			) as Promise<any[]>
		]);
		const mA = mats.find((m) => m.id === idA);
		const mB = mats.find((m) => m.id === idB);
		if (!mA || !mB) return { finding: null, a: '', b: '' };
		const tagsA = deriveTagsField(mA.nama_barang_lengkap, mA.sub_category?.kode_singkat);
		const tagsB = deriveTagsField(mB.nama_barang_lengkap, mB.sub_category?.kode_singkat);
		const sev: Record<string, number> = { incompatible: 3, partially: 2, compatible: 1 };
		let best: any = null;
		for (const r of rules) {
			const hit =
				(tagMatchesField(r.tag_a, tagsA) && tagMatchesField(r.tag_b, tagsB)) ||
				(tagMatchesField(r.tag_a, tagsB) && tagMatchesField(r.tag_b, tagsA));
			if (hit && (!best || sev[r.hasil] > sev[best.hasil])) best = r;
		}
		const finding: FieldCompatFinding | null =
			best && best.hasil !== 'compatible'
				? { hasil: best.hasil, alasan: best.alasan || '', tagsA, tagsB }
				: null;
		return { finding, a: mA.nama_barang_lengkap, b: mB.nama_barang_lengkap };
	} catch (err) {
		handleDirectusError(err);
		return { finding: null, a: '', b: '' };
	}
}

/** Autocomplete bahan baku ringan untuk pemilih Cek Kompatibilitas. */
export async function searchMaterialsLite(
	query: string
): Promise<Array<{ id: number; nama: string; kode_item: string }>> {
	if (!query || query.trim().length < 2) return [];
	try {
		const rows = (await directus.request(
			readItems('identitas_barang', {
				filter: { kode_item: { _starts_with: 'RM-' }, nama_barang_lengkap: { _icontains: query.trim() } },
				fields: ['id', 'kode_item', 'nama_barang_lengkap'],
				sort: ['nama_barang_lengkap'],
				limit: 12
			})
		)) as any[];
		return rows.map((r) => ({ id: r.id, nama: r.nama_barang_lengkap, kode_item: r.kode_item }));
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}
