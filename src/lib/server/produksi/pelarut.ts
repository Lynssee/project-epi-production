// src/lib/server/produksi/pelarut.ts
// Pelacak Pelarut Daur Ulang — Tahap A (13 Okt 2026): HANYA pencatatan kejadian di koleksi
// solvent_recovery_log (tidak menyentuh stok/jurnal; stok terpisah = Tahap B, menunggu keputusan Finance).
// Logika PURE validasi input dari app lapangan.

export const JENIS = ['dikumpulkan', 'dipakai_ulang'] as const;
export const SUMBER = ['pembilas_alat', 'pembersihan_tangki', 'lainnya'] as const;
export type Jenis = (typeof JENIS)[number];

export const MAX_QTY_KG = 5000; // batas kewajaran satu entri; di atas ini hampir pasti salah ketik
export const MAX_BACKDATE_DAYS = 7;

export interface PelarutRow {
	tanggal: string;
	jenis: Jenis;
	item_id: number;
	qty_kg: number;
	spk_id: number | null;
	sumber: (typeof SUMBER)[number] | null;
	catatan: string | null;
}

export type Validation = { ok: true; row: PelarutRow } | { ok: false; code: number; message: string };

const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function validatePelarutEntry(
	raw: Record<string, unknown> | null | undefined,
	allowedItemIds: number[],
	now: Date = new Date()
): Validation {
	const jenis = raw?.jenis as Jenis;
	if (!JENIS.includes(jenis)) return { ok: false, code: 400, message: 'Jenis harus "dikumpulkan" atau "dipakai_ulang".' };

	const itemId = Number(raw?.item_id);
	if (!(itemId > 0) || !allowedItemIds.includes(itemId)) {
		return { ok: false, code: 400, message: 'Pelarut tidak ada di daftar yang diizinkan (diatur admin di Setelan Produksi).' };
	}

	const qty = Math.round(Number(raw?.qty_kg) * 1000) / 1000;
	if (!Number.isFinite(qty) || qty <= 0) return { ok: false, code: 400, message: 'Jumlah (kg) harus lebih dari 0.' };
	if (qty > MAX_QTY_KG) return { ok: false, code: 400, message: `Jumlah ${qty} kg tidak wajar (maksimal ${MAX_QTY_KG} kg per entri). Periksa satuan.` };

	let tanggal = now;
	if (raw?.tanggal) {
		const t = new Date(String(raw.tanggal));
		if (Number.isNaN(t.getTime())) return { ok: false, code: 400, message: 'Tanggal tidak valid.' };
		if (t.getTime() > now.getTime() + 3600_000) return { ok: false, code: 400, message: 'Tanggal tidak boleh di masa depan.' };
		if (t.getTime() < now.getTime() - MAX_BACKDATE_DAYS * 86400_000) {
			return { ok: false, code: 400, message: `Tanggal terlalu lama (maksimal ${MAX_BACKDATE_DAYS} hari ke belakang).` };
		}
		tanggal = t;
	}

	const spkRaw = Number(raw?.spk_id);
	const sumber = raw?.sumber as (typeof SUMBER)[number] | undefined;
	if (jenis === 'dipakai_ulang' && !(spkRaw > 0)) {
		return { ok: false, code: 400, message: 'Pemakaian ulang wajib menyebut SPK tempat pelarut dipakai.' };
	}
	return {
		ok: true,
		row: {
			tanggal: tanggal.toISOString(),
			jenis,
			item_id: itemId,
			qty_kg: qty,
			spk_id: spkRaw > 0 ? spkRaw : null,
			sumber: sumber && SUMBER.includes(sumber) ? sumber : null,
			catatan: clip(raw?.catatan, 1000) || null
		}
	};
}

/** Parse setelan solvent_item_ids (JSON string/array) menjadi daftar id valid & unik. */
export function parseSolventItemIds(raw: unknown): number[] {
	let v: unknown = raw;
	if (typeof v === 'string') {
		try {
			v = JSON.parse(v);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(v)) return [];
	return [...new Set(v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
}
