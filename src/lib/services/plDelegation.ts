// src/lib/services/plDelegation.ts
// Sistem Delegasi Project Leader — Fase 2 (Field Dashboard Integration).
// READ-ONLY: dashboard lapangan hanya menampilkan data yang sudah dibuat di erp-epi-1
// (leader_spesialisasi, delegation_log, karyawan.spesialisasi_utama/max_proyek_simultan/dll).
// Tidak ada penulisan apa pun dari sini — eksekusi delegasi tetap di Admin (Pusat Delegasi).

import { secureDirectusJson } from './secureDirectus';

const ACTIVE_STATUSES = ['on progress', 'on_progress', 'repair', 'waiting', 'prepare', 'hold'];

export interface DelegationInfo {
	id: number;
	leader_baru_id?: number | null;
	leader_baru_nama: string;
	leader_lama_id?: number | null;
	leader_lama_nama: string | null;
	delegated_by_nama: string | null;
	tipe: string;
	alasan: string | null;
	tanggal_efektif: string | null;
	surat_tugas_id: number | null;
	surat_tugas_nomor: string | null;
	ack_status?: 'diterima' | 'kendala' | 'pendamping' | 'teratasi' | null;
	ack_catatan?: string | null;
	faktor_keputusan?: {
		gate_key?: string;
		handover_progress_pct?: number;
		handover_volume?: string;
		checklist?: Record<string, boolean>;
		ba_file_id?: string | number | null;
		ba_file_name?: string | null;
	} | null;
}

export interface WorkloadSummary {
	proyekAktif: number;
	maxProyekSimultan: number;
	spesialisasiUtama: string | null;
	skorPerforma: number | null;
	totalProyekSelesai: number | null;
	rataRataKetepatanWaktu: number | null;
}

export interface LeaderSpecialization {
	id: number;
	spesialisasi: string;
	level: string;
	tahun_pengalaman: number | null;
	catatan: string | null;
}

/** Info delegasi terbaru untuk satu proyek — siapa mendelegasikan, kapan, kenapa, link Surat Tugas. */
export async function getMyDelegationInfo(projectId: number | string): Promise<DelegationInfo | null> {
	try {
		const result = await secureDirectusJson<{ data: any[] }>(
			`/items/delegation_log?filter[project_id][_eq]=${projectId}&filter[status][_eq]=aktif&sort=-tanggal_efektif&limit=1`
		);
		const row = result?.data?.[0];
		if (!row) return null;

		let suratNomor: string | null = null;
		if (row.surat_tugas_id) {
			try {
				const suratRes = await secureDirectusJson<{ data: any }>(
					`/items/surat_tugas_project/${row.surat_tugas_id}?fields=id,nomor_surat`
				);
				suratNomor = suratRes?.data?.nomor_surat || null;
			} catch {
				/* surat tugas mungkin sudah dihapus — jangan gagalkan seluruh info delegasi */
			}
		}

		let fk = row.faktor_keputusan;
		if (typeof fk === 'string') {
			try {
				fk = JSON.parse(fk);
			} catch {
				fk = null;
			}
		}

		return {
			id: row.id,
			leader_baru_id: row.leader_baru_id ?? null,
			leader_baru_nama: row.leader_baru_nama,
			leader_lama_id: row.leader_lama_id ?? null,
			leader_lama_nama: row.leader_lama_nama || null,
			delegated_by_nama: row.delegated_by_nama || null,
			tipe: row.tipe,
			alasan: row.alasan || null,
			tanggal_efektif: row.tanggal_efektif || null,
			surat_tugas_id: row.surat_tugas_id || null,
			surat_tugas_nomor: suratNomor,
			ack_status: row.ack_status || null,
			ack_catatan: row.ack_catatan || null,
			faktor_keputusan: fk || null
		};
	} catch (error) {
		console.error('getMyDelegationInfo:', error);
		return null;
	}
}

/** Ringkasan kapasitas leader yang sedang login — dipakai widget "Kapasitas Saya". */
export async function getMyWorkloadSummary(karyawanId: number, karyawanNama?: string): Promise<WorkloadSummary | null> {
	try {
		const karyawanRes = await secureDirectusJson<{ data: any }>(
			`/items/karyawan/${karyawanId}?fields=id,spesialisasi_utama,max_proyek_simultan,skor_performa_terakhir,total_proyek_selesai,rata_rata_ketepatan_waktu`
		);
		const k = karyawanRes?.data;
		if (!k) return null;

		const filter = karyawanNama
			? { _or: [{ leader_id: { _eq: karyawanId } }, { leader: { _eq: karyawanNama } }] }
			: { leader_id: { _eq: karyawanId } };
		const projRes = await secureDirectusJson<{ data: any[] }>(
			`/items/projects?filter=${encodeURIComponent(JSON.stringify(filter))}&fields=id,status&limit=-1`
		);
		const seen = new Set<number>();
		const proyekAktif = (projRes?.data || []).filter((p) => {
			if (seen.has(p.id)) return false;
			seen.add(p.id);
			return ACTIVE_STATUSES.includes((p.status || '').toLowerCase().trim());
		}).length;

		return {
			proyekAktif,
			maxProyekSimultan: k.max_proyek_simultan || 3,
			spesialisasiUtama: k.spesialisasi_utama || null,
			skorPerforma: k.skor_performa_terakhir ?? null,
			totalProyekSelesai: k.total_proyek_selesai ?? null,
			rataRataKetepatanWaktu: k.rata_rata_ketepatan_waktu ?? null
		};
	} catch (error) {
		console.error('getMyWorkloadSummary:', error);
		return null;
	}
}

/** Riwayat spesialisasi leader yang sedang login. */
export async function getMySpecializations(karyawanId: number): Promise<LeaderSpecialization[]> {
	try {
		const result = await secureDirectusJson<{ data: any[] }>(
			`/items/leader_spesialisasi?filter[karyawan_id][_eq]=${karyawanId}&limit=-1`
		);
		return result?.data || [];
	} catch (error) {
		console.error('getMySpecializations:', error);
		return [];
	}
}

export interface NewAssignment {
	id: number;
	projectId: number;
	projectName: string;
	lokasi: string | null;
	customer: string | null;
	tipe: string;
	alasan: string | null;
	leaderLamaNama?: string | null;
	faktorKeputusan?: any;
	delegatedBy: string | null;
	tanggalEfektif: string | null;
	suratTugasNomor: string | null;
	ackStatus: 'diterima' | 'kendala' | 'pendamping' | 'teratasi' | null;
	ackCatatan: string | null;
	adminTanggapan: string | null;
	adminTanggapanOleh: string | null;
}

/**
 * Penugasan baru untuk leader yang login (delegation_log aktif dalam N hari terakhir).
 * READ-ONLY. Relasi diambil terpisah: log -> proyek (1 batch) -> surat tugas (1 batch), tanpa nested field.
 */
export async function getMyNewAssignments(karyawanId: number, days = 14): Promise<NewAssignment[]> {
	try {
		const since = new Date(Date.now() - days * 86400000).toISOString();
		const logs = await secureDirectusJson<{ data: any[] }>(
			`/items/delegation_log?filter[leader_baru_id][_eq]=${karyawanId}&filter[status][_eq]=aktif&filter[tanggal_efektif][_gte]=${encodeURIComponent(since)}&fields=id,project_id,tipe,alasan,leader_lama_nama,faktor_keputusan,delegated_by_nama,tanggal_efektif,surat_tugas_id,ack_status,ack_catatan,admin_tanggapan,admin_tanggapan_oleh&sort=-tanggal_efektif&limit=20`
		);
		const rows = logs?.data || [];
		if (!rows.length) return [];

		const projectIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean))];
		const suratIds = [...new Set(rows.map((r) => r.surat_tugas_id).filter(Boolean))];
		const [projRes, suratRes] = await Promise.all([
			projectIds.length
				? secureDirectusJson<{ data: any[] }>(`/items/projects?filter[id][_in]=${projectIds.join(',')}&fields=id,name,lokasi,customer&limit=-1`)
				: Promise.resolve({ data: [] }),
			suratIds.length
				? secureDirectusJson<{ data: any[] }>(`/items/surat_tugas_project?filter[id][_in]=${suratIds.join(',')}&fields=id,nomor_surat&limit=-1`)
				: Promise.resolve({ data: [] })
		]);
		const projMap = new Map((projRes?.data || []).map((p) => [p.id, p]));
		const suratMap = new Map((suratRes?.data || []).map((s) => [s.id, s.nomor_surat]));

		return rows.map((r) => {
			const p = projMap.get(r.project_id);
			let fk = r.faktor_keputusan;
			if (typeof fk === 'string') {
				try { fk = JSON.parse(fk); } catch { fk = null; }
			}
			return {
				id: r.id,
				projectId: r.project_id,
				projectName: p?.name || `Proyek #${r.project_id}`,
				lokasi: p?.lokasi || null,
				customer: p?.customer || null,
				tipe: r.tipe,
				alasan: r.alasan || null,
				leaderLamaNama: r.leader_lama_nama || null,
				faktorKeputusan: fk || null,
				delegatedBy: r.delegated_by_nama || null,
				tanggalEfektif: r.tanggal_efektif || null,
				suratTugasNomor: suratMap.get(r.surat_tugas_id) || null,
				ackStatus: r.ack_status || null,
				ackCatatan: r.ack_catatan || null,
				adminTanggapan: r.admin_tanggapan || null,
				adminTanggapanOleh: r.admin_tanggapan_oleh || null
			};
		});
	} catch (error) {
		console.error('getMyNewAssignments:', error);
		return [];
	}
}

export interface TimelineProject {
	id: number;
	name: string;
	status: string | null;
	start_date: string | null;
	end_date: string | null;
	lokasi_kota: string | null;
	manpowerAktif: number;
}

/** Proyek aktif milik leader yang login untuk kalender pribadi ("Jadwal Saya"). READ-ONLY, 1 query. */
export async function getMyTimeline(karyawanId: number | null, karyawanNama: string | null): Promise<TimelineProject[]> {
	if (!karyawanId && !karyawanNama) return [];
	try {
		const or: any[] = [];
		if (karyawanId) or.push({ leader_id: { _eq: karyawanId } });
		if (karyawanNama) or.push({ leader: { _eq: karyawanNama } });
		const res = await secureDirectusJson<{ data: any[] }>(
			`/items/projects?filter=${encodeURIComponent(JSON.stringify({ _or: or }))}&fields=id,name,status,start_date,end_date,lokasi_kota&sort=start_date&limit=-1`
		);
		const active = (res?.data || []).filter((p) => ACTIVE_STATUSES.includes(String(p.status || '').toLowerCase().trim()));
		// Jumlah pekerja (SPK manpower berstatus aktif) per proyek: satu query terpisah, fail-soft.
		const counts = new Map<number, number>();
		if (active.length) {
			try {
				const mp = await secureDirectusJson<{ data: any[] }>(
					`/items/manpower_assignment?filter[project_id][_in]=${active.map((p) => p.id).join(',')}&filter[status][_eq]=aktif&fields=id,project_id&limit=-1`
				);
				for (const m of mp?.data || []) {
					const pid = typeof m.project_id === 'object' ? m.project_id?.id : m.project_id;
					if (pid != null) counts.set(Number(pid), (counts.get(Number(pid)) || 0) + 1);
				}
			} catch (e) {
				console.warn('getMyTimeline: jumlah manpower gagal dimuat —', e);
			}
		}
		return active.map((p) => ({ ...p, manpowerAktif: counts.get(Number(p.id)) || 0 }));
	} catch (error) {
		console.error('getMyTimeline:', error);
		return [];
	}
}
