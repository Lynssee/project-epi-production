// src/lib/server/sjMuatRule.ts
// SJH-01 opsi A (keputusan Lead 6 Okt 2026) — status SJ SETELAH barang dimuat (kiosk Muat Barang).
// Murni (tanpa I/O) supaya bisa diuji.
//   created + kategori butuh satpam -> needs_security_check (+ draft_status menunggu_security: masuk antrian gerbang)
//   created + kategori tak butuh    -> shipped              (+ draft_status siap_kirim)
//   status lain (sudah shipped/needs_security_check/dst; saklar darurat OFF) -> tidak diubah (null)

export function decideStatusAfterLoad(
	currentStatus: string | null | undefined,
	needsGate: boolean
): { status: 'needs_security_check' | 'shipped'; draft_status: 'menunggu_security' | 'siap_kirim' } | null {
	if (currentStatus !== 'created') return null;
	return needsGate
		? { status: 'needs_security_check', draft_status: 'menunggu_security' }
		: { status: 'shipped', draft_status: 'siap_kirim' };
}
