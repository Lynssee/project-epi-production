// Referensi cepat untuk Buku Saku lapangan (Inventory 360° ↔ Training, Fase 4+): ringkasan profil 360° TERVERIFIKASI + bahaya material R&D.
// Murah: 4 query kecil berbatas, relasi (nama barang) diambil terpisah (Aturan #2). Tidak ada harga/rahasia formula. Klien menyimpan salinan lokal.
import { directusServerJson } from '$lib/server/directus';

export interface ReferensiBarang { itemId: number; nama: string; kritis: boolean; ringkasan: string; interval: string; tandaGanti: string; tandaPalsu: string; apd: string[]; bahaya: string; spesifikasi: ReferensiSpek[] }
export interface ReferensiSpek { label: string; nilai: string }
export interface SpekDef { key: string; label: string; unit?: string; kritis?: boolean }
export interface ReferensiMaterial { materialId: number; nama: string; fungsi: string; bahaya: string }

const MAX_BARANG = 60;
const MAX_MATERIAL = 40;
const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

const MAX_SPEK = 12;

/**
 * Murni: spesifikasi KRITIS dari spec_values profil (hanya kolom template berpenanda kritis; tanpa angka karangan — profil sudah berstatus verified).
 * Nilai kosong dilewati; ya_tidak → Ya/Tidak; satuan template ditempel bila nilai belum memuatnya.
 */
export function pickSpesifikasi(specValues: unknown, defs: SpekDef[]): ReferensiSpek[] {
	if (!specValues || typeof specValues !== 'object' || Array.isArray(specValues) || !Array.isArray(defs)) return [];
	const sv = specValues as Record<string, unknown>;
	const out: ReferensiSpek[] = [];
	for (const d of defs) {
		if (!d?.kritis) continue;
		const raw = sv[d.key];
		if (raw === null || raw === undefined || raw === '') continue;
		let nilai = typeof raw === 'boolean' ? (raw ? 'Ya' : 'Tidak') : str(raw, 120);
		if (!nilai) continue;
		const unit = str(d.unit, 20);
		if (unit && typeof raw !== 'boolean' && !nilai.toLowerCase().includes(unit.toLowerCase())) nilai = `${nilai} ${unit}`;
		out.push({ label: str(d.label || d.key, 60), nilai });
		if (out.length >= MAX_SPEK) break;
	}
	return out;
}

/** Murni: ubah baris profil → entri ringkas. Tanpa nama barang = dilewati (kartu tanpa nama tak berguna di HP). */
export function mapProfilToReferensi(p: any, nama: string, defs: SpekDef[] = []): ReferensiBarang | null {
	if (!p || !nama) return null;
	const pp = p.panduan_pakai && typeof p.panduan_pakai === 'object' ? p.panduan_pakai : {};
	const pb = p.panduan_beli && typeof p.panduan_beli === 'object' ? p.panduan_beli : {};
	const iv = Number(pp.interval_ganti?.nilai);
	return {
		itemId: Number(p.item_id),
		nama,
		kritis: !!p.is_kritis,
		ringkasan: str(p.ringkasan || p.fungsi_utama),
		interval: iv > 0 ? `${iv} ${str(pp.interval_ganti?.satuan) || 'jam'}` : '',
		tandaGanti: arr(pp.tanda_harus_ganti)[0] || '',
		tandaPalsu: arr(pb.tanda_palsu)[0] || '',
		apd: arr(p.apd).slice(0, 4),
		bahaya: str(p.bahaya),
		spesifikasi: pickSpesifikasi(p.spec_values, defs)
	};
}

export async function loadReferensiSaku(): Promise<{ barang: ReferensiBarang[]; material: ReferensiMaterial[]; dibuat: string }> {
	const barang: ReferensiBarang[] = [];
	try {
		const profs = (await directusServerJson<{ data: any[] }>(`/items/inventory_knowledge_profile?filter[status][_eq]=verified&filter[item_id][_nnull]=true&fields=id,item_id,template_id,spec_values,is_kritis,ringkasan,fungsi_utama,panduan_pakai,panduan_beli,apd,bahaya&sort=-is_kritis,-id&limit=${MAX_BARANG}`))?.data || [];
		const ids = [...new Set(profs.map((p) => Number(p.item_id)).filter((n) => n > 0))];
		const names = ids.length ? (await directusServerJson<{ data: any[] }>(`/items/identitas_barang?filter[id][_in]=${ids.join(',')}&fields=id,nama_barang_lengkap&limit=${ids.length}`))?.data || [] : [];
		const nameById = new Map(names.map((n) => [Number(n.id), str(n.nama_barang_lengkap, 120)]));
		// Template (definisi kolom spesifikasi) diambil terpisah & hanya bila ada profil yang memuat spec_values — hemat 1 query.
		const defsByTemplate = new Map<number, SpekDef[]>();
		if (profs.some((p) => p.spec_values && typeof p.spec_values === 'object')) {
			try {
				const tpls = (await directusServerJson<{ data: any[] }>('/items/inventory_knowledge_template?fields=id,spec_fields&limit=100'))?.data || [];
				for (const t of tpls) if (Array.isArray(t.spec_fields)) defsByTemplate.set(Number(t.id), t.spec_fields);
			} catch (e) {
				console.error('[referensiSaku] template spesifikasi tak terbaca (kartu tampil tanpa spesifikasi):', e);
			}
		}
		for (const p of profs) {
			const r = mapProfilToReferensi(p, nameById.get(Number(p.item_id)) || '', defsByTemplate.get(Number(p.template_id)) || []);
			if (r) barang.push(r);
		}
	} catch (e) {
		console.error('[referensiSaku] profil 360° tak terbaca:', e);
	}
	const material: ReferensiMaterial[] = [];
	try {
		const profs = (await directusServerJson<{ data: any[] }>(`/items/rnd_material_profile?filter[tingkat_bahaya][_nnull]=true&filter[tingkat_bahaya][_nempty]=true&fields=material_id,fungsi_utama,tingkat_bahaya&limit=${MAX_MATERIAL}`))?.data || [];
		const ids = [...new Set(profs.map((p) => Number(p.material_id)).filter((n) => n > 0))];
		const names = ids.length ? (await directusServerJson<{ data: any[] }>(`/items/identitas_barang?filter[id][_in]=${ids.join(',')}&fields=id,nama_barang_lengkap&limit=${ids.length}`))?.data || [] : [];
		const nameById = new Map(names.map((n) => [Number(n.id), str(n.nama_barang_lengkap, 120)]));
		for (const p of profs) {
			const nama = nameById.get(Number(p.material_id));
			if (nama) material.push({ materialId: Number(p.material_id), nama, fungsi: str(p.fungsi_utama), bahaya: str(p.tingkat_bahaya) });
		}
	} catch (e) {
		console.error('[referensiSaku] profil material R&D tak terbaca:', e);
	}
	return { barang, material, dibuat: new Date().toISOString() };
}
