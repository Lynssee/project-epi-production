// src/lib/services/ess/silabus.ts
// Client-side service ESS Silabus Jabatan — SELALU lewat /api/ess/training/silabus, TIDAK PERNAH
// akses Directus langsung (sama prinsipnya dengan services/ess/training.ts).

import { auth } from '$lib/firebase';

export interface SilabusMateriProgress {
	id: number;
	urutan: number | null;
	isWajib: boolean;
	programId: number;
	programJudul: string;
	programKategori: string | null;
	status: 'Lulus' | 'Ongoing' | 'Enrolled' | 'Remedial' | 'Gagal' | 'Belum Terdaftar';
	progressPersen: number;
	tenggat: string | null;
	locked: boolean;
	prerequisiteProgramJudul: string | null;
}

export interface SilabusProgress {
	id: number;
	namaSilabus: string;
	deskripsi: string | null;
	kategori: string | null;
	level?: string | null;
	prerequisiteId?: number | null;
	isWajib: boolean;
	target: { targetHari: number | null; passingGrade: number | null } | null;
	materi: SilabusMateriProgress[];
	totalWajib: number;
	wajibSelesai: number;
	progressPersen: number;
	selesai: boolean;
}

export interface SilabusSayaResponse {
	position: { id: number; nama_posisi: string } | null;
	silabusList: SilabusProgress[];
}

export interface TeamMemberSilabusProgress {
	karyawanId: number;
	namaKaryawan: string;
	position: { id: number; nama_posisi: string } | null;
	silabusList: SilabusProgress[];
	totalWajibKeseluruhan: number;
	selesaiKeseluruhan: number;
}

async function parseErrorMessage(res: Response): Promise<string> {
	try {
		const data = await res.json();
		return data?.message || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
	const idToken = await getIdToken();
	return fetch(url, {
		...options,
		headers: {
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
			Authorization: `Bearer ${idToken}`,
			...(options.headers || {})
		}
	});
}

export async function getSilabusSaya(): Promise<SilabusSayaResponse> {
	const res = await authedFetch('/api/ess/training/silabus');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function getTimSilabus(): Promise<{ anggota: TeamMemberSilabusProgress[] }> {
	const res = await authedFetch('/api/ess/training/tim');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

// ── Kesehatan training tim & catatan pembinaan (Fase 4 mentor_kpi_training) ──
export interface TeamTrainingMember {
	karyawanId: number;
	nama: string;
	total: number;
	lulus: number;
	avgNilai: number | null;
	passRate: number | null;
	kritis: boolean;
	status: 'perlu_dibina' | 'pantau' | 'tuntas' | 'belum_terhitung';
	training: { judul: string; status: string; nilai: number | null; tenggat: string | null; terlambat: boolean }[];
	/** Kuis yang sudah di batas percobaan & menunggu persetujuan percobaan ulang dari atasan (gate G_TRN_MENTOR_SIGNOFF). */
	perluPersetujuan?: { enrollmentId: number; quizId: number; quizJudul: string; percobaan: number }[];
}
export interface TeamTrainingHealth {
	aktif: boolean;
	mode: 'off' | 'shadow' | 'on';
	jumlahAnggota: number;
	estimasiKpi: number | null;
	catatan: string | null;
	rataKelulusan: number | null;
	rataNilai: number | null;
	perluDibina: number;
	anggota: TeamTrainingMember[];
}

export async function getTimKesehatan(): Promise<TeamTrainingHealth> {
	const res = await authedFetch('/api/ess/training/tim/kesehatan');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function setujuiPercobaanUlang(enrollmentId: number, quizId: number, catatan: string): Promise<{ ok: true; sisaPercobaan: number; planId: number | null }> {
	const res = await authedFetch('/api/ess/training/tim/persetujuan', { method: 'POST', body: JSON.stringify({ enrollmentId, quizId, catatan }) });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function catatPembinaanTim(memberId: number, catatan: string): Promise<{ ok: true; planId: number; created: boolean }> {
	const res = await authedFetch('/api/ess/training/tim/pembinaan', { method: 'POST', body: JSON.stringify({ memberId, catatan }) });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

// ── Jalur Karier R&D ──
export interface JalurProgramClient { kode: string; programId: number | null; judul: string; status: 'lulus' | 'proses' | 'kedaluwarsa' | 'belum'; progress: number; terbuka: boolean }
export interface JalurLevelClient { key: string; nama: string; achieved: boolean; masaBerlakuBulan: number; manual: string; blockedBy: string[]; programs: JalurProgramClient[] }
export interface JalurKarierClient { levels: JalurLevelClient[]; current: string | null; next: string | null; adaProgram: boolean }

export async function getJalurKarier(): Promise<JalurKarierClient> {
	const res = await authedFetch('/api/ess/training/jalur-karier');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
