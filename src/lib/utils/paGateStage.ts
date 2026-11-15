// src/lib/utils/paGateStage.ts
// Phased Gate Enforcement Fase 4 (lapangan). Gate PA yang di Kalibrasi Gate admin diberi tahap blokir
// HRD / Finance / Manajemen / Pencairan / SPJ BUKAN kewajiban pemohon lapangan saat submit: dashboard
// lapangan menampilkannya sebagai "ditangani X" (abu-abu), tidak memblokir, tidak masuk hitungan syarat.
// Tahap SUBMIT & APPROVAL_ATASAN tetap kewajiban pemohon/PL (bukti lapangan: BAP, BAST, P2H).
// Katalog ini cermin src/lib/data/paGateStages.js di erp-epi-1 (repo terpisah) — tahap tak dikenal
// = BUKAN deferred (perilaku lama, fail-safe).

const DEFERRED_HANDLER: Record<string, string> = {
	APPROVAL_HRD: 'HRD',
	APPROVAL_FINANCE: 'Finance',
	APPROVAL_MANAJEMEN: 'Manajemen (GM/Direksi)',
	DISBURSEMENT: 'AP / Kasir saat pencairan',
	SPJ_SETTLEMENT: 'Finance saat pertanggungjawaban'
};

/** Gate ini dibebankan ke pihak lain di tahap sesudah submit (bukan tugas pemohon sekarang)? */
export function isDeferredGate(g: { target_stage?: string | null } | null | undefined): boolean {
	return !!g?.target_stage && g.target_stage in DEFERRED_HANDLER;
}

/**
 * Petunjuk "hubungi siapa" untuk gate GAGAL yang masih jadi urusan pemohon (bukan deferred).
 * Sumber: `owner_role` dari /api/pengajuan/validate (erp-epi, katalog tahap penegakan). null bila gate tak
 * punya tahap khusus atau penanggung jawabnya pemohon sendiri -- jangan mengarang kontak.
 */
export function contactHint(
	g: { status?: string; target_stage?: string | null; owner_role?: string | null } | null | undefined
): string | null {
	if (!g || g.status !== 'failed' || isDeferredGate(g)) return null;
	const role = (g.owner_role || '').trim();
	if (!role || /^pemohon$/i.test(role)) return null;
	return `Butuh bantuan? Hubungi ${role}.`;
}

/** Gate yang boleh dimintakan dispensasi dari lapangan (cermin DISPENSASI_GATES di erp-epi gateDispensasi.js). */
export const DISPENSASI_REQUEST_GATES = ['G10_HARIAN', 'G_MOM_BRIEFING'] as const;

/** Tombol "Minta dispensasi" hanya untuk gate cakupan yang GAGAL dan masih jadi urusan pemohon. */
export function canRequestDispensasi(
	g: { gate_key?: string; status?: string; target_stage?: string | null } | null | undefined
): boolean {
	return (
		!!g &&
		g.status === 'failed' &&
		(DISPENSASI_REQUEST_GATES as readonly string[]).includes(g.gate_key || '') &&
		!isDeferredGate(g)
	);
}

/** Teks "ditangani …" untuk gate deferred; null bila bukan deferred. */
export function deferredHandlerLabel(g: { target_stage?: string | null } | null | undefined): string | null {
	return g?.target_stage ? DEFERRED_HANDLER[g.target_stage] || null : null;
}

// ── PDP-36 — pemilik gate (peran tim proyek). Server (/api/pengajuan/validate) mengirim `pemilik` per gate
//    (leader / admin_project / tim_sentral / hrd / finance; kosong = leader) dan `pic` {nama} untuk gate Admin Project.
//    Kembar erp-epi src/lib/data/paGateOwner.js::pecahGatePerPemilik — jaga keduanya tetap sama.

type GatePemilik = { status?: string; pemilik?: string | null; severity?: string };

/** Gate milik Admin Project yang GAGAL → ditampilkan sebagai kartu "Menunggu Admin Project", bukan syarat leader. */
export function menungguAdminProject(g: GatePemilik | null | undefined): boolean {
	return !!g && g.pemilik === 'admin_project' && g.status === 'failed';
}

/** Gate milik Admin Project yang lulus / tidak berlaku: tidak perlu dilihat leader sama sekali. */
export function sembunyikDariLeader(g: GatePemilik | null | undefined): boolean {
	return !!g && g.pemilik === 'admin_project';
}

/** Gate GAGAL milik pihak lain (HRD / Finance / tim sentral) → kelompok "Akan diperiksa pihak lain". */
export function milikPihakLainGagal(g: GatePemilik | null | undefined): boolean {
	return !!g && g.status === 'failed' && (g.pemilik === 'hrd' || g.pemilik === 'finance' || g.pemilik === 'tim_sentral');
}

/** Teks kartu "menunggu Admin Project" (PIC dari server; tanpa PIC → arahkan ke PM). */
export function teksMenungguAdmin(pic: { nama?: string | null } | null | undefined): string {
	return pic?.nama ? `Menunggu Admin Project — ${pic.nama}` : 'Proyek ini belum punya Admin Project. Hubungi PM.';
}
