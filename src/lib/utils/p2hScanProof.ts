// src/lib/utils/p2hScanProof.ts
// Bukti scan barcode P2H sementara (sessionStorage) — dipakai supaya operator yang
// sudah scan lewat dashboard Maintenance tidak diminta scan ulang saat dibawa ke
// halaman checklist, tapi jalur lain (klik "Isi P2H" di daftar, atau buka URL
// langsung) tetap wajib scan dulu.

const PROOF_TTL_MS = 10 * 60 * 1000; // 10 menit

function key(equipmentId: string) {
	return `p2h_scan_proof_${equipmentId}`;
}

export function saveScanProof(equipmentId: string) {
	try {
		sessionStorage.setItem(key(equipmentId), String(Date.now()));
	} catch {
		// sessionStorage tidak tersedia (mis. private mode) — abaikan, scan gate akan tetap muncul
	}
}

export function hasValidScanProof(equipmentId: string): boolean {
	try {
		const raw = sessionStorage.getItem(key(equipmentId));
		if (!raw) return false;
		const ts = Number(raw);
		if (!ts || Date.now() - ts > PROOF_TTL_MS) {
			sessionStorage.removeItem(key(equipmentId));
			return false;
		}
		return true;
	} catch {
		return false;
	}
}
