// src/lib/services/ess/ojt.ts — client penilaian OJT atasan. SELALU lewat /api/ess/training/ojt (tidak akses Directus langsung).
import { auth } from '$lib/firebase';

export interface OjtTarget {
	enrollmentId: number;
	karyawanId: number;
	nama: string;
	programJudul: string;
	kategori: string | null;
	progressPersen: number;
	statusOjt: 'belum' | 'draft' | 'final';
	skorPersen: number | null;
}
export interface OjtItem { key: string; label: string; rating: number | null; catatan: string }
export interface OjtForm {
	enrollmentId: number;
	nama: string;
	programJudul: string;
	passingScore: number;
	items: OjtItem[];
	kekuatan: string;
	kekurangan: string;
	tindakLanjut: string | null;
	status: 'belum' | 'draft' | 'final';
}

async function call(url: string, options: RequestInit = {}) {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	const res = await fetch(url, {
		...options,
		headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${await user.getIdToken()}` }
	});
	if (!res.ok) {
		let msg = `HTTP ${res.status}`;
		try {
			const j = await res.json();
			msg = j?.message || msg;
		} catch {
			/* non-JSON */
		}
		throw new Error(msg);
	}
	return res.json();
}

export const getOjtTargets = (): Promise<{ targets: OjtTarget[] }> => call('/api/ess/training/ojt');
export const getOjtForm = (enrollmentId: number): Promise<OjtForm> => call(`/api/ess/training/ojt?enrollmentId=${enrollmentId}`);
export const saveOjt = (p: {
	enrollmentId: number;
	items: OjtItem[];
	kekuatan?: string;
	kekurangan?: string;
	tindakLanjut?: string;
	finalize?: boolean;
}): Promise<{ ok: true; status: string; skorPersen: number | null }> => call('/api/ess/training/ojt', { method: 'POST', body: JSON.stringify(p) });
