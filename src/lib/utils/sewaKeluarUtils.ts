// src/lib/utils/sewaKeluarUtils.ts
// Real Profit R1 — Log Sewa Keluar (alat milik kita yang DISEWAKAN ke customer): validasi entri timesheet harian dari lapangan dan
// hitung sisa jam paket. MODUL MURNI (tanpa fetch). Dipakai halaman /sewa-keluar; hasil BBM mengalir ke HPP rental di dashboard admin.

export interface TimesheetInput {
	tanggal: string; // YYYY-MM-DD
	jam_mulai?: string; // HH:MM
	jam_selesai?: string; // HH:MM
	hour_meter_reading?: number | null;
	overtime_hours?: number | null;
	bbm_liter?: number | null;
	bbm_rp?: number | null;
	catatan?: string;
}

/** Angka dari input form: kosong/bukan angka → null (bukan 0 — kosong berarti "tidak dicatat"). */
export function parseNum(v: unknown): number | null {
	if (v === '' || v == null) return null;
	const n = Number(String(v).replace(',', '.'));
	return Number.isFinite(n) ? n : null;
}

function menit(hhmm: string | undefined): number | null {
	if (!hhmm) return null;
	const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
	if (!m) return null;
	return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * @param lastHourMeter pembacaan hour meter TERTINGGI yang sudah tercatat untuk kontrak ini (null bila belum ada)
 * @param hariIni YYYY-MM-DD (diinjeksi supaya teruji)
 * @returns daftar pesan galat (kosong = valid)
 */
export function validateTimesheet(input: TimesheetInput, ctx: { lastHourMeter: number | null; hariIni: string }): string[] {
	const err: string[] = [];
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tanggal || '')) err.push('Tanggal wajib diisi.');
	else if (input.tanggal > ctx.hariIni) err.push('Tanggal tidak boleh di masa depan.');

	const mulai = menit(input.jam_mulai);
	const selesai = menit(input.jam_selesai);
	if (input.jam_mulai && mulai == null) err.push('Format jam mulai tidak valid.');
	if (input.jam_selesai && selesai == null) err.push('Format jam selesai tidak valid.');
	if (mulai != null && selesai != null && selesai <= mulai) err.push('Jam selesai harus setelah jam mulai.');

	const hm = input.hour_meter_reading;
	if (hm != null) {
		if (hm < 0) err.push('Hour meter tidak boleh negatif.');
		else if (ctx.lastHourMeter != null && hm < ctx.lastHourMeter) {
			err.push(`Hour meter (${hm}) lebih kecil dari catatan sebelumnya (${ctx.lastHourMeter}) — periksa pembacaan.`);
		}
	}

	const ot = input.overtime_hours;
	if (ot != null && (ot < 0 || ot > 24)) err.push('Jam lembur harus 0–24.');

	const liter = input.bbm_liter;
	const rp = input.bbm_rp;
	if (liter != null && (liter < 0 || liter > 1000)) err.push('Liter BBM tidak wajar (0–1000).');
	if (rp != null && rp < 0) err.push('Nilai BBM tidak boleh negatif.');
	if (rp != null && rp > 0 && !(liter != null && liter > 0)) err.push('Isi juga liter solar bila mengisi nilai BBM (Rp).');
	return err;
}

export interface SisaJamPaket {
	terpakai: number;
	sisa: number;
	pct: number | null;
	status: 'aman' | 'mendekati' | 'habis';
}

/**
 * Sisa jam paket sewa (hour meter): terpakai = pembacaan terakhir − baseline kontrak. Null bila batas paket tidak diisi.
 * Mendekati = sisa ≤ 20% batas.
 */
export function sisaJamPaket(baseline: number | null, limit: number | null, lastReading: number | null): SisaJamPaket | null {
	const lim = Number(limit);
	if (!Number.isFinite(lim) || lim <= 0) return null;
	const base = Number(baseline) || 0;
	const terpakai = lastReading == null ? 0 : Math.max(0, Number(lastReading) - base);
	const sisa = lim - terpakai;
	const pct = Math.round((terpakai / lim) * 1000) / 10;
	return { terpakai, sisa, pct, status: sisa <= 0 ? 'habis' : sisa <= lim * 0.2 ? 'mendekati' : 'aman' };
}
