// src/lib/services/laporanMasukanKru.ts
// Klien tipis untuk /api/laporan/masukan-kru (Catatan Kerja kru → Laporan Harian, Fase 4). Pakai Firebase Bearer.
import { auth } from '$lib/firebase';
import type { CatatanKru } from '$lib/utils/kioskCatatan';
import type { DrafPemakaian } from '$lib/utils/kioskPemakaian';

export interface MasukanKru extends CatatanKru {
	tanggal: string;
	date_created: string | null;
}

async function panggil<T>(url: string, init: RequestInit = {}): Promise<T> {
	const idToken = await auth.currentUser?.getIdToken();
	const res = await fetch(url, {
		...init,
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
	});
	if (!res.ok) {
		let msg = `Gagal (${res.status})`;
		try {
			msg = (await res.json())?.message || msg;
		} catch {
			/* bukan JSON */
		}
		const err = new Error(msg) as Error & { status?: number };
		err.status = res.status;
		throw err;
	}
	return res.json();
}

export interface MasukanPemakaian extends DrafPemakaian {
	tanggal: string;
	foto: string | null;
	date_created: string | null;
}

export type JenisMasukan = 'catatan' | 'pemakaian';

export const getMasukanKru = (projectId: number, tanggal: string) =>
	panggil<{ tanggal: string; catatan: MasukanKru[]; pemakaian: MasukanPemakaian[] }>(`/api/laporan/masukan-kru?project_id=${projectId}&tanggal=${encodeURIComponent(tanggal)}`);

export const tandaiMasukanKruDipakai = (projectId: number, ids: number[], reportId: number, jenis: JenisMasukan = 'catatan') =>
	panggil<{ ok: true; diubah: number }>('/api/laporan/masukan-kru', {
		method: 'POST',
		body: JSON.stringify({ project_id: projectId, jenis, action: 'pakai', ids, report_id: reportId })
	});

export const abaikanMasukanKru = (projectId: number, ids: number[], jenis: JenisMasukan = 'catatan') =>
	panggil<{ ok: true; diubah: number }>('/api/laporan/masukan-kru', {
		method: 'POST',
		body: JSON.stringify({ project_id: projectId, jenis, action: 'abaikan', ids })
	});
