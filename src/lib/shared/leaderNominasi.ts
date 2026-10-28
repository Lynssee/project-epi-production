// src/lib/shared/leaderNominasi.ts
// Konstanta & validasi nominasi calon leader regu. Dipakai klien (form) dan server (endpoint)
// agar daftar tag tidak menyimpang. Nominasi = masukan awal untuk penilaian Potensi di
// Kaderisasi 9-Box (admin) — baru dihitung setelah disetujui HRD/Manager.

export const TAG_NOMINASI = [
	{ key: 'tangguh_lapangan', label: 'Tangguh di lapangan' },
	{ key: 'disiplin_k3', label: 'Disiplin K3 tinggi' },
	{ key: 'problem_solving_alat', label: 'Problem solving alat/teknis' },
	{ key: 'komunikatif', label: 'Komunikatif dengan tim' },
	{ key: 'tanggung_jawab', label: 'Bertanggung jawab & tuntas' },
	{ key: 'tenang_tekanan', label: 'Tenang di bawah tekanan' },
	{ key: 'mengajari_rekan', label: 'Suka mengajari rekan' }
] as const;

export const TAG_KEYS: string[] = TAG_NOMINASI.map((t) => t.key);

export interface NominasiInput {
	rating: number;
	tags: string[];
	catatan: string;
}

/** Kembalikan pesan error, atau null bila valid. */
export function validasiNominasi(i: Partial<NominasiInput>): string | null {
	const r = Number(i.rating);
	if (!Number.isInteger(r) || r < 1 || r > 5) return 'Penilaian harus 1–5.';
	const tags = Array.isArray(i.tags) ? i.tags : [];
	if (tags.length === 0) return 'Pilih minimal 1 alasan/kompetensi.';
	if (tags.some((t) => !TAG_KEYS.includes(t))) return 'Ada tag yang tidak dikenal.';
	if (String(i.catatan ?? '').length > 500) return 'Catatan maksimal 500 karakter.';
	return null;
}
