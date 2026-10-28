// src/lib/utils/waNumber.ts
// Peminjaman 11 §3.4 — nomor HP untuk tautan wa.me. Data karyawan/driver tersimpan sebagai "0812…"; `wa.me/0812…` TIDAK
// berfungsi (wajib kode negara). Dipakai di semua tautan WA halaman peminjaman (driver, Chat GA). Kosong → '' dan
// pemanggil MENYEMBUNYIKAN tombolnya (tidak ada tautan mati).
// (Versi server `normalizeWaNumber` ada di $lib/server/penawaranExport.ts — sengaja tidak diimpor ke klien.)

/** 08xx / +62xx / 62xx / 8xx → 628xx. Kembalikan '' bila tidak valid. */
export function toWaNumber(raw: string | null | undefined): string {
	let d = String(raw ?? '').replace(/\D/g, '');
	if (!d) return '';
	if (d.startsWith('0062')) d = d.slice(2);
	else if (d.startsWith('620')) d = '62' + d.slice(3);
	else if (d.startsWith('0')) d = '62' + d.slice(1);
	else if (d.startsWith('8')) d = '62' + d;
	if (!d.startsWith('62')) return '';
	return d.length >= 10 && d.length <= 15 ? d : '';
}

/** Tautan wa.me siap pakai, atau '' bila nomor tidak valid. */
export function waLink(raw: string | null | undefined, text?: string): string {
	const n = toWaNumber(raw);
	if (!n) return '';
	return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
