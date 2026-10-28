// src/lib/shared/gayaKomunikasi.ts
// Tip supervisi per tipe DISC untuk Project/Manpower Leader. Tipe diambil dari hasil tes DISC
// (karyawan_assessment_result) — hanya huruf profil + tip yang diekspos ke lapangan, bukan skor
// mentah maupun hasil Big Five. Teks sama dengan DISC_TIPS di erp-epi/src/lib/utils/psikometri.js.

export const DISC_TIPS: Record<string, string> = {
	D: 'Beri target jelas & kewenangan; komunikasi singkat, langsung ke hasil.',
	I: 'Beri ruang diskusi & apresiasi terbuka; hindari instruksi terlalu kaku/panjang.',
	S: 'Beri waktu adaptasi saat ada perubahan; jelaskan alasan & jaga ritme kerja stabil.',
	C: 'Beri instruksi tertulis, spesifik & lengkap dengan data/standar yang dipakai.'
};

export function tipDisc(profil: string | null | undefined): string {
	return DISC_TIPS[String(profil || '').charAt(0)] || '';
}
