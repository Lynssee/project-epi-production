// src/lib/shared/paKunciAbsensi.ts
// Kunci lunak absensi selama PA upah berjalan — salinan MURNI dari erp-epi `src/lib/shared/paKunciAbsensi.js`.
// Jaga IDENTIK dengan sisi erp-epi (satu aturan, dua dashboard); bila satu sisi diubah, ubah keduanya.
//
// Absensi baru terkunci (dikunci/payroll_id) saat PENCAIRAN. Di antara submit PA dan pencairan, hari yang sudah ditagih masih bisa
// diedit sehingga nominal PA menyimpang dari absensi. Mode setelan manpower.absensi.kunci_saat_pa_mode (Aturan #3, anti-lockdown):
//   'off'   : tidak dicek.
//   'warn'  : edit tetap jalan, pengguna/log diberi nomor PA-nya (DEFAULT).
//   'block' : edit ditolak; jalan keluar sah = PA ditolak/direvisi dulu (status itu tidak "menagih"), lalu absensi dikoreksi.

/** Status PA yang masih menagih hari kerja pekerja (selaras erp-epi absensiBuktiGate.STATUS_PA_MENAGIH). */
export const STATUS_PA_MENAGIH = ['Pending', 'Approved', 'Diproses', 'Dibukukan', 'Completed'];

export const KUNCI_PA_MODE_KEY = 'manpower.absensi.kunci_saat_pa_mode';
export const KUNCI_PA_MODE_DEFAULT = 'warn';

export type KunciPaMode = 'off' | 'warn' | 'block';
export interface RincianPaAktif {
	assignmentId: any;
	dari: string;
	sampai: string;
	nomor: string;
	status: string;
}
export interface KunciPA {
	mode: KunciPaMode;
	rincian: RincianPaAktif[];
}

const tgl = (d: any) => String(d ?? '').slice(0, 10);

/** Nilai tak dikenal -> default (jangan diam-diam mengunci). */
export function normKunciPaMode(v: any): KunciPaMode {
	const k = String(v ?? '').trim().toLowerCase();
	return k === 'off' || k === 'warn' || k === 'block' ? (k as KunciPaMode) : KUNCI_PA_MODE_DEFAULT;
}

/** Rincian pertama yang meliputi assignment+tanggal (inklusif), atau null. */
export function cariBentrokPA(rincian: RincianPaAktif[] | null | undefined, assignmentId: any, tanggal: any): RincianPaAktif | null {
	const t = tgl(tanggal);
	if (!t || assignmentId == null) return null;
	return (rincian || []).find((r) => String(r.assignmentId) === String(assignmentId) && tgl(r.dari) <= t && t <= tgl(r.sampai)) || null;
}

export function pesanKunciPA(b: RincianPaAktif, tanggal: any, mode: KunciPaMode = 'warn'): string {
	const dasar = `Tanggal ${tgl(tanggal)} sudah ditagih di ${b.nomor} (status ${b.status}).`;
	return mode === 'block'
		? `${dasar} Absensi tidak bisa diubah selama PA berjalan — minta PA ditolak/direvisi dulu, lalu koreksi absensi.`
		: `${dasar} Perubahan absensi membuat nominal PA tidak lagi sesuai absensi — pastikan PA direvisi.`;
}
