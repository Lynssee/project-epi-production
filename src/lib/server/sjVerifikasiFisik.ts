// Validasi + normalisasi Verifikasi Fisik SJ proyek (G_SJ_VERIF_FISIK, SJH-02).
// Salinan setia dari erp-epi/src/lib/shared/sjVerifikasiFisik.js — struktur keluaran HARUS sama
// karena ditulis ke kolom yang sama (`surat_jalan.pengaju_verification`). Ubah keduanya bersamaan.

export const VERIF_STATUS = ['sesuai', 'qty_dikoreksi', 'tidak_dimuat'] as const;

type SjItem = { id: number | string; nama_barang?: string | null; qty_delivered?: number | null; qty_required?: number | null };
type VerifInput = { sj_item_id: number | string; status: string; qty_confirmed?: number | string; note?: string };
export type VerifItem = { sj_item_id: number | string; nama_barang: string | null; qty_sj: number; status: string; qty_confirmed: number; note: string | null };

export function normalizeVerifikasiFisik(
	sjItems: SjItem[],
	input: VerifInput[]
): { ok: true; items: VerifItem[]; mode: 'penuh' | 'parsial'; problems: VerifItem[] } | { ok: false; error: string } {
	const rows = Array.isArray(sjItems) ? sjItems : [];
	if (rows.length === 0) return { ok: false, error: 'SJ ini tidak punya baris item untuk diverifikasi.' };
	const byId = new Map((Array.isArray(input) ? input : []).map((r) => [String(r?.sj_item_id), r]));

	const items: VerifItem[] = [];
	for (const it of rows) {
		const v = byId.get(String(it.id));
		const name = it.nama_barang || `item #${it.id}`;
		if (!v) return { ok: false, error: `Item "${name}" belum diverifikasi — pilih Sesuai / Qty beda / Tidak dimuat.` };
		if (!(VERIF_STATUS as readonly string[]).includes(v.status)) return { ok: false, error: `Status item "${name}" tidak valid.` };
		const qtySj = Number(it.qty_delivered ?? it.qty_required ?? 0) || 0;
		let qtyConfirmed = qtySj;
		if (v.status === 'tidak_dimuat') qtyConfirmed = 0;
		if (v.status === 'qty_dikoreksi') {
			qtyConfirmed = Number(v.qty_confirmed);
			if (!Number.isFinite(qtyConfirmed) || qtyConfirmed < 0 || qtyConfirmed > qtySj) {
				return { ok: false, error: `Qty koreksi "${name}" harus antara 0 dan ${qtySj}.` };
			}
			if (qtyConfirmed === qtySj) return { ok: false, error: `Qty koreksi "${name}" sama dengan qty SJ — pilih "Sesuai".` };
		}
		items.push({
			sj_item_id: it.id,
			nama_barang: it.nama_barang || null,
			qty_sj: qtySj,
			status: v.status,
			qty_confirmed: qtyConfirmed,
			note: String(v.note ?? '').trim() || null
		});
	}
	const problems = items.filter((i) => i.status !== 'sesuai');
	return { ok: true, items, mode: problems.length ? 'parsial' : 'penuh', problems };
}
