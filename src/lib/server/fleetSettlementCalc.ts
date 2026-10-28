// src/lib/server/fleetSettlementCalc.ts
// Peminjaman 06 Fase 4 — logika murni settlement uang muka JALUR LAMA (tanpa I/O, supaya bisa diuji).
// Uang muka berbasis PCR (booking.advance_pcr_id terisi) TIDAK memakai settlement ini — LPJ Petty Cash yang memilikinya.
// ⚠️ Filter realisasi sama dengan erp-epi `src/lib/utils/fleetExpenseAggregate.js` — ubah keduanya bersamaan.

export type SettlementStatus =
	| 'menunggu_struk_final'
	| 'menunggu_setor_balik'
	| 'menunggu_reimburse'
	| 'balanced';

/** Baris fleet_trip_expense yang dihitung sebagai realisasi (NULL baris lama ikut — Aturan #7). */
export function filterBiayaRealisasi(tripLogId: string) {
	return {
		_and: [
			{ trip_log_id: { _eq: String(tripLogId) } },
			{ _or: [{ approval_status: { _null: true } }, { approval_status: { _nin: ['ditolak', 'menunggu'] } }] }
		]
	};
}

export interface Realisasi {
	bbm: number;
	tol: number;
	parkir: number;
	lain: number;
	total: number;
}

export function jumlahkanRealisasi(rows: Array<{ jenis?: string | null; nominal?: unknown }> | null | undefined): Realisasi {
	const t: Realisasi = { bbm: 0, tol: 0, parkir: 0, lain: 0, total: 0 };
	for (const r of rows || []) {
		const n = Number(r?.nominal) || 0;
		const j = String(r?.jenis || 'lain');
		if (j === 'bbm') t.bbm += n;
		else if (j === 'tol') t.tol += n;
		else if (j === 'parkir') t.parkir += n;
		else t.lain += n;
		t.total += n;
	}
	return t;
}

/** Settlement boleh dihitung bila belum pernah, atau sedang menunggu struk final (hitung ulang). */
export function perluHitung(booking: { settlement_status?: string | null } | null | undefined): boolean {
	const s = booking?.settlement_status;
	return !s || s === 'none' || s === 'menunggu_struk_final';
}

export interface KeputusanSettlement {
	settlement_status: SettlementStatus;
	selisih: number;
	/** true bila harus membuat draf reimburse kekurangan (belum pernah dibuat — idempoten). */
	buatReimburse: boolean;
	/** true bila advance_status harus menjadi 'settled'. */
	selesai: boolean;
}

/**
 * @param adaStrukMenunggu masih ada struk `menunggu` approval → jangan putuskan setor/reimburse dulu (angka belum final)
 * @param sudahReimburse   booking.settlement_reimburse_id sudah terisi → jangan buat draf ke-2
 */
export function putuskanSettlement(p: {
	disbursed: number;
	realisasiTotal: number;
	adaStrukMenunggu: boolean;
	sudahReimburse: boolean;
}): KeputusanSettlement {
	const selisih = Math.round((Number(p.disbursed) || 0) - (Number(p.realisasiTotal) || 0));
	if (p.adaStrukMenunggu) {
		return { settlement_status: 'menunggu_struk_final', selisih, buatReimburse: false, selesai: false };
	}
	if (selisih > 0) return { settlement_status: 'menunggu_setor_balik', selisih, buatReimburse: false, selesai: false };
	if (selisih < 0) {
		return { settlement_status: 'menunggu_reimburse', selisih, buatReimburse: !p.sudahReimburse, selesai: false };
	}
	return { settlement_status: 'balanced', selisih, buatReimburse: false, selesai: true };
}
