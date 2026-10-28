// src/lib/server/fleetKuota.ts
// Peminjaman 05 §3.1 — kuota departemen dihitung per IRISAN JADWAL (jumlah unit yang dipakai dept pada rentang yang
// sama), BUKAN total booking berstatus terbuka. Dulu 3 booking macet/terlupa/minggu-depan mengunci seluruh divisi.
// Logika murni (tanpa I/O) supaya bisa diuji.

export type KuotaMode = 'off' | 'soft' | 'hard';

export interface KuotaBooking {
	id?: string | number;
	kode_booking?: string | null;
	tanggal_mulai?: string | null;
	tanggal_selesai_rencana?: string | null;
}

/** Nilai setting → mode. Tak dikenal / kosong → 'soft' (gate baru mulai lunak, Aturan #3). */
export function normalizeKuotaMode(raw: unknown): KuotaMode {
	const v = String(raw ?? '').replace(/"/g, '').trim().toLowerCase();
	return v === 'off' || v === 'hard' ? v : 'soft';
}

/** Booking yang jadwalnya beririsan dengan [reqStart, reqEnd] (ms). Tanpa selesai → dianggap titik waktu. */
export function bookingBeririsan<T extends KuotaBooking>(bookings: T[], reqStart: number, reqEnd: number): T[] {
	return (bookings || []).filter((b) => {
		const s = new Date(String(b?.tanggal_mulai)).getTime();
		if (!Number.isFinite(s)) return false; // data rusak tidak boleh menghabiskan kuota
		const eRaw = b?.tanggal_selesai_rencana ? new Date(String(b.tanggal_selesai_rencana)).getTime() : s;
		const e = Number.isFinite(eRaw) ? eRaw : s;
		return reqStart <= e && reqEnd >= s;
	});
}

export interface KuotaHasil {
	terlampaui: boolean;
	jumlah: number;
	kode: string[];
	pesan: string;
}

/** Evaluasi kuota. `terlampaui` bila jumlah irisan >= maks (pengajuan ini akan menjadi yang ke-(maks+1)). */
export function evaluasiKuota(bookings: KuotaBooking[], reqStart: number, reqEnd: number, maks: number): KuotaHasil {
	const irisan = bookingBeririsan(bookings, reqStart, reqEnd);
	const kode = irisan.map((b) => String(b.kode_booking || b.id || '?'));
	return {
		terlampaui: maks > 0 && irisan.length >= maks,
		jumlah: irisan.length,
		kode,
		pesan: `Pada jam tersebut divisi Anda sudah memakai ${irisan.length} unit (${kode.join(', ')}). Hubungi GA bila mendesak.`
	};
}

/** Penanda di booking.catatan supaya GA melihat badge "Melebihi kuota dept" di board (tanpa perubahan skema). */
export const TANDA_MELEBIHI_KUOTA = '[MELEBIHI_KUOTA_DEPT]';
