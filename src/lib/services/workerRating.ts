import directus from './directus';
import { createItem, createItems, readItems } from '@directus/sdk';
import type { RatingPayload, PastRating } from '$lib/utils/bulkRating';

// ── Penilaian PL/Foreman (Fase 4, Manpower v2) ──────────────────────────
// Kualitas/Safety/Ketepatan dinilai manual di sini (bintang 1-5). Kehadiran &
// Skill DIHITUNG OTOMATIS di HRD (workerScorecardApi.js, erp-epi-1) dari data
// yang sudah ada — tidak diinput ulang di sini.

export async function submitWorkerRating(p: {
	manpowerId: number;
	projectId: number;
	kualitas: number;
	safety: number;
	ketepatan: number;
	catatan: string;
	dinilaiOleh: string;
}) {
	try {
		const created = await directus.request(
			createItem('worker_performance_rating', {
				manpower_id: p.manpowerId,
				project_id: p.projectId,
				tanggal: new Date().toISOString().split('T')[0],
				kualitas: p.kualitas,
				safety: p.safety,
				ketepatan: p.ketepatan,
				catatan: p.catatan,
				dinilai_oleh: p.dinilaiOleh
			})
		);
		return { success: true, data: created };
	} catch (error) {
		console.error('submitWorkerRating gagal:', (error as any)?.message);
		return { success: false, error: (error as any)?.message || 'Gagal menyimpan penilaian' };
	}
}

// ── Penilaian massal (KPI & Kinerja Terpusat, Fase 3) ──────────────────────
// Satu request createItems untuk seluruh tim (hemat API) + 1 query riwayat 31 hari untuk
// menandai "sudah dinilai hari ini". Tiap koleksi diambil terpisah (tanpa relasi bersarang).
export async function submitWorkerRatingsBulk(payloads: RatingPayload[]) {
	if (!payloads.length) return { success: true, count: 0 };
	try {
		await directus.request(createItems('worker_performance_rating', payloads));
		return { success: true, count: payloads.length };
	} catch (error) {
		console.error('submitWorkerRatingsBulk gagal:', (error as any)?.message);
		return { success: false, count: 0, error: (error as any)?.message || 'Gagal menyimpan penilaian' };
	}
}

export async function fetchRecentRatings(manpowerIds: number[], days = 31): Promise<PastRating[]> {
	if (!manpowerIds.length) return [];
	const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
	try {
		return (await directus.request(
			readItems('worker_performance_rating', {
				fields: ['manpower_id', 'tanggal', 'project_id', 'workshop_id'],
				filter: { _and: [{ manpower_id: { _in: manpowerIds } }, { tanggal: { _gte: since } }] },
				limit: -1
			})
		)) as PastRating[];
	} catch (e) {
		// Tidak fatal (hanya info "sudah dinilai"), tapi JANGAN senyap: tampil di console untuk debugging.
		console.error('fetchRecentRatings gagal:', (e as any)?.message);
		return [];
	}
}

export async function fetchWorkshops(): Promise<{ id: number; code: string | null; name: string | null }[]> {
	try {
		return (await directus.request(readItems('workshops', { fields: ['id', 'code', 'name'], limit: -1 }))) as any[];
	} catch (e) {
		console.error('fetchWorkshops gagal:', (e as any)?.message);
		return [];
	}
}

/** Anggota workshop aktif/cuti yang sudah terhubung ke `manpower` (manpower_id terisi). */
export async function fetchWorkshopRoster(workshopId: number) {
	try {
		return (await directus.request(
			readItems('workshop_manpower', {
				fields: ['id', 'manpower_id', 'karyawan_nama', 'jabatan', 'status'],
				filter: { _and: [{ workshop_id: { _eq: workshopId } }, { status: { _in: ['aktif', 'cuti'] } }, { manpower_id: { _nnull: true } }] },
				limit: -1
			})
		)) as { id: number; manpower_id: number; karyawan_nama: string; jabatan: string | null; status: string }[];
	} catch (e) {
		console.error('fetchWorkshopRoster gagal:', (e as any)?.message);
		return [];
	}
}

/** Pekerja aktif di satu proyek: assignment → nama manpower, diambil terpisah (bukan nested), unik per pekerja. */
export async function fetchProjectRoster(projectId: number): Promise<{ manpowerId: number; nama: string; jabatan: string }[]> {
	try {
		const assignments = (await directus.request(
			readItems('manpower_assignment', {
				fields: ['id', 'manpower_id', 'jabatan'],
				filter: { project_id: { _eq: projectId }, status: { _eq: 'aktif' } },
				limit: -1
			})
		)) as any[];
		const ids = [...new Set(assignments.map((a) => (a.manpower_id && typeof a.manpower_id === 'object' ? a.manpower_id.id : a.manpower_id)).filter((v) => v != null).map(Number))];
		if (!ids.length) return [];
		const people = (await directus.request(readItems('manpower', { fields: ['id', 'nama'], filter: { id: { _in: ids } }, limit: -1 }))) as any[];
		const nama = new Map(people.map((p) => [Number(p.id), p.nama as string]));
		const seen = new Set<number>();
		const out: { manpowerId: number; nama: string; jabatan: string }[] = [];
		for (const a of assignments) {
			const mid = Number(a.manpower_id && typeof a.manpower_id === 'object' ? a.manpower_id.id : a.manpower_id);
			if (!Number.isFinite(mid) || seen.has(mid)) continue;
			seen.add(mid);
			out.push({ manpowerId: mid, nama: nama.get(mid) || `#${mid}`, jabatan: a.jabatan || '' });
		}
		return out.sort((x, y) => x.nama.localeCompare(y.nama));
	} catch (e) {
		console.error('fetchProjectRoster gagal:', (e as any)?.message);
		throw e;
	}
}
