// Monitoring kuota RAP & ceklist pra-mobilisasi K3 (Planning Suite Fase 8). Modul MURNI — tanpa I/O.
// ⚠️ Rumus selaras dengan erp-epi `summarizePlanningAlignment` (baris barang = supplier/consumable/safety/sewa_alat).

export type QuotaStatus = 'belum' | 'sebagian' | 'habis' | 'lebih';

export interface QuotaRow {
	id: number;
	name: string;
	unit: string;
	planned: number;
	sent: number;
	remaining: number;
	pct: number; // 0..100+ (dibulatkan)
	status: QuotaStatus;
	fromPlanning: boolean;
}

const num = (v: unknown) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};

/** Kuota per baris RAP barang: rencana (qty) vs sudah keluar gudang (qty_sudah_dikirim). Null-safe. */
export function computeQuota(rows: Array<Record<string, any>> | null | undefined): { rows: QuotaRow[]; totalPct: number; over: number } {
	const out: QuotaRow[] = [];
	for (const r of rows || []) {
		if (r?.is_category_header) continue;
		const planned = num(r?.qty);
		if (planned <= 0) continue; // tanpa rencana qty tidak bisa dipantau
		const sent = Math.max(num(r?.qty_sudah_dikirim), 0);
		const pct = Math.round((sent / planned) * 100);
		const status: QuotaStatus = sent <= 0 ? 'belum' : sent > planned + 1e-6 ? 'lebih' : sent >= planned - 1e-6 ? 'habis' : 'sebagian';
		out.push({
			id: r.id,
			name: String(r?.material_name || r?.description || 'Item'),
			unit: String(r?.unit || ''),
			planned, sent,
			remaining: Math.max(planned - sent, 0),
			pct, status,
			fromPlanning: String(r?.source_planning_ref ?? '').startsWith('charter:')
		});
	}
	const plannedSum = out.reduce((s, r) => s + r.planned, 0);
	const sentSum = out.reduce((s, r) => s + Math.min(r.sent, r.planned), 0);
	return {
		rows: out.sort((a, b) => Number(b.status === 'lebih') - Number(a.status === 'lebih') || b.pct - a.pct),
		totalPct: plannedSum > 0 ? Math.round((sentSum / plannedSum) * 100) : 0,
		over: out.filter((r) => r.status === 'lebih').length
	};
}

export interface PreMobItem {
	key: string;
	label: string;
	hint: string;
	required: boolean; // dipersyaratkan Charter
	/** 'doc' = status per personil dari manpower_dokumen (Directus); 'manual' = centang Leader (tersimpan lokal). */
	kind: 'doc' | 'manual';
}

const flag = (v: unknown) => v === true || v === 1 || String(v).toLowerCase() === 'true';
const ada = (v: unknown) => String(v ?? '').trim().toUpperCase() === 'ADA';

/** Ceklist pra-mobilisasi dari syarat Charter + kesiapan APD (baris safety di RAP). */
export function buildPreMobChecklist(
	charter: Record<string, any> | null | undefined,
	rapRows: Array<Record<string, any>> | null | undefined
): { items: PreMobItem[]; apd: { total: number; linked: number } } {
	const safety = (rapRows || []).filter((r) => String(r?.budget_category) === 'safety' && !r?.is_category_header);
	const apd = { total: safety.length, linked: safety.filter((r) => r?.identitas_barang_id).length };
	if (!charter) return { items: [], apd };
	const items: PreMobItem[] = [
		{ key: 'mcu', label: 'MCU seluruh personil', hint: 'Pastikan hasil Medical Check-Up tiap personil sudah dibawa/diunggah sebelum berangkat.', required: flag(charter.syarat_mcu), kind: 'doc' },
		{ key: 'skck', label: 'SKCK personil', hint: 'Fotokopi SKCK diminta customer sebagai syarat masuk site.', required: flag(charter.syarat_skck), kind: 'doc' },
		{ key: 'sertifikat', label: 'Sertifikat keahlian/K3', hint: 'Sertifikat (mis. blasting, K3 umum) yang dipersyaratkan customer.', required: flag(charter.syarat_sertifikat), kind: 'doc' },
		{ key: 'sehat', label: 'Surat sehat', hint: 'Surat keterangan sehat dari dokter, masih berlaku.', required: flag(charter.syarat_surat_sehat), kind: 'doc' },
		{ key: 'izin', label: 'Izin barang masuk site', hint: 'Customer mensyaratkan izin barang masuk — urus sebelum mobilisasi.', required: ada(charter.ijin_barang_masuk), kind: 'manual' },
		{ key: 'loading', label: 'Alat loading/unloading di site', hint: 'Charter menyebut alat bongkar muat tersedia/diperlukan — konfirmasi ke customer.', required: ada(charter.alat_loading_unloading), kind: 'manual' }
	];
	return { items: items.filter((i) => i.required), apd };
}

// ── Status dokumen per personil (manpower_dokumen di Directus, diverifikasi HRD) ──────────────────────────
/** Kunci syarat Charter → jenis_dokumen di manpower_dokumen. */
export const DOC_FOR_REQUIREMENT: Record<string, string> = {
	mcu: 'mcu',
	skck: 'skck',
	sertifikat: 'sertifikat_k3',
	sehat: 'surat_kesehatan'
};

export type DocState = 'terverifikasi' | 'menunggu' | 'kedaluwarsa' | 'ditolak' | 'belum';
const DOC_RANK: Record<DocState, number> = { terverifikasi: 4, menunggu: 3, kedaluwarsa: 2, ditolak: 1, belum: 0 };

export interface PersonDocRow {
	id: number;
	nama: string;
	jabatan: string;
	cells: Record<string, DocState>;
	complete: boolean;
}

/** Matriks personil × syarat dokumen. Dokumen terbaik per jenis yang dipakai (terverifikasi > menunggu > kedaluwarsa > ditolak). */
export function buildPersonDocMatrix(
	requiredKeys: string[],
	people: Array<{ manpower_id: number; nama?: string | null; jabatan?: string | null }> | null | undefined,
	docs: Array<{ manpower_id: number; jenis_dokumen: string; status_verifikasi?: string | null; tanggal_kedaluwarsa?: string | null }> | null | undefined,
	today: Date = new Date()
): { rows: PersonDocRow[]; completeCount: number } {
	const keys = requiredKeys.filter((k) => DOC_FOR_REQUIREMENT[k]);
	const seen = new Set<number>();
	const rows: PersonDocRow[] = [];
	for (const p of people || []) {
		const id = Number(p?.manpower_id);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const cells: Record<string, DocState> = {};
		for (const k of keys) {
			let best: DocState = 'belum';
			for (const d of docs || []) {
				if (Number(d?.manpower_id) !== id || d?.jenis_dokumen !== DOC_FOR_REQUIREMENT[k]) continue;
				let st: DocState = 'belum';
				if (d.status_verifikasi === 'terverifikasi') {
					const exp = d.tanggal_kedaluwarsa ? new Date(d.tanggal_kedaluwarsa) : null;
					st = exp && !Number.isNaN(exp.getTime()) && exp < today ? 'kedaluwarsa' : 'terverifikasi';
				} else if (d.status_verifikasi === 'ditolak') st = 'ditolak';
				else st = 'menunggu';
				if (DOC_RANK[st] > DOC_RANK[best]) best = st;
			}
			cells[k] = best;
		}
		rows.push({ id, nama: String(p?.nama || `Personil #${id}`), jabatan: String(p?.jabatan || ''), cells, complete: keys.every((k) => cells[k] === 'terverifikasi') });
	}
	return { rows, completeCount: rows.filter((r) => r.complete).length };
}
