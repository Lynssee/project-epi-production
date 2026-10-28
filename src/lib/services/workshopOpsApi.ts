// src/lib/services/workshopOpsApi.ts
// Rencana v2 (TAJAM) Pusat Order Workshop Ciketing — Fase 4 §9.
// Hub "Workshop Ops" lapangan: Papan Order (read-only) + Laporan Harian Workshop.
// Ini adalah root cause Fase 0: laporan harian workshop SEBELUMNYA hanya bisa diisi
// dari dashboard admin erp-epi — mandor/leader lapangan tidak pernah mengisinya
// (data mati sejak 19 Agu). Form ini port dari saveLaporan() WsCiketing.svelte
// erp-epi-1, disederhanakan untuk mobile (absensi_leader/material_digunakan/
// kondisi_equipment dibuat OPSIONAL, bukan wajib seperti versi admin — lihat
// catatan simplifikasi di reports/ erp-epi).
//
// Semua baca/tulis lewat proxy Directus terautentikasi (pola sama workshopDeliveryApi.ts).

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, createItems, deleteItem, deleteItems, aggregate, uploadFiles } from '@directus/sdk';
import { getProjectScope, getProjectsForCurrentUser, getPeranProjectUser } from './projectScope';
import { getProjects } from './projects';
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';
import { extractActiveSubtasks, type ActiveSubtask } from '../utils/subtaskProgressEngine';
import { opsProfile, requireOpsProfile, type OpsWorkshopKey, type WorkshopOpsProfile } from './workshopOpsProfile';
import type { RosterPerson } from '$lib/utils/laporanAbsensi';
import { deriveWorkshopStage, WORKSHOP_STAGES } from '$lib/utils/workshopStage';
import { getIdToken } from './secureDirectus';

// Fase 7c Unifikasi Workshop: semua fungsi menerima kunci workshop (default 'ciketing' = perilaku lama).
// Profil (koleksi, workshop_id, kolom yang ada/tidak) ada di workshopOpsProfile.ts.

export interface MyOrderRow {
	projectId: number;
	nomorPo: string;
	customerName: string;
	leader: string | null;
	status: string;
	endDate: string | null;
	stage: string;
	stageLabel: string;
	soCustomerId: number | null;
	/** WSK-15 §4c: PO yang ia pimpin / dampingi (leader, co-leader, kursi lapangan). Anggota workshop melihat semua PO, "PO saya" ditandai. */
	mine: boolean;
}

export interface SoItemOption {
	id: number;
	label: string;
}

export interface SjMasukOption {
	id: number;
	label: string; // "no_sj — nama_barang (tanggal)"
	tanggal: string | null;
}

/** WSK-31: kosakata tahap TERPADU (order · inbound · produksi · qc · siap_kirim · dikirim · tagih) — sama dengan Hub/Modal/cockpit admin. */
export const STAGE_LABEL: Record<string, string> = Object.fromEntries(WORKSHOP_STAGES.map((s) => [s.key, s.label]));

function num(v: any): number {
	const n = parseFloat(v);
	return Number.isFinite(n) ? n : 0;
}

/** Info project yang sudah dimuat pemanggil (hemat query): progres & status memengaruhi tahap. */
export interface StageProjectInfo { progressPct?: number; status?: string }

/**
 * WSK-15 §4a + WSK-31 — tahap TERPADU untuk BANYAK project sekaligus: 6 query agregat (groupBy) total — tetap 6 berapa pun jumlah PO, bukan 4 query per project.
 * Memakai `deriveWorkshopStage` (salinan fungsi tunggal erp-epi) → kunci: order · inbound · produksi · qc · siap_kirim · dikirim · tagih.
 * Perbedaan yang disengaja vs dashboard admin (data ringan HP):
 *  - SJ Masuk Ciketing dihitung "barang customer" bila source_type = 'customer' atau kosong (consumable/sinkron pusat tidak dihitung);
 *  - "tagih" = seluruh SJ Keluar berinvoice (status invoice draft/resmi tidak diperiksa di HP — dashboard admin yang menentukan lunas).
 * Galat Directus DILEMPAR (jangan menyamar jadi "semua order").
 */
export async function deriveStagesForProjects(projectIds: number[], ws: OpsWorkshopKey = 'ciketing', info: Record<number, StageProjectInfo> = {}): Promise<Record<number, string>> {
	const P = opsProfile(ws);
	const ids = [...new Set(projectIds.filter((n) => Number.isFinite(n) && n > 0))];
	if (ids.length === 0) return {};
	const agg = (collection: string, groupBy: string[], aggregateSpec: any, filter: any) =>
		directus.request(aggregate(collection as any, { aggregate: aggregateSpec, groupBy, query: { filter } } as any)) as Promise<any[]>;
	const sjMasukFilter: any = { project: { _in: ids } };
	if (P.key === 'ciketing') sjMasukFilter._or = [{ source_type: { _eq: 'customer' } }, { source_type: { _null: true } }];
	const [sjMasuk, poDetail, inspeksi, sjKeluarAll, sjKeluarSelesai, sjKeluarInvoice] = await Promise.all([
		agg(P.sjMasuk, ['project'], { count: '*' }, sjMasukFilter),
		agg('workshop_report_po_detail', ['po_id'], { count: '*', sum: ['total_objek', 'sudah_dikerjakan', 'sandblasting', 'primer', 'second', 'topcoat'] }, { po_id: { _in: ids }, workshop_id: { _eq: P.id } }),
		agg('inspection_report', ['project_id', 'status'], { count: '*' }, { project_id: { _in: ids }, status: { _in: ['draft', 'menunggu_approval', 'approved'] } }),
		agg(P.sjKeluar, ['project'], { count: '*' }, { project: { _in: ids } }),
		agg(P.sjKeluar, ['project'], { count: '*' }, { project: { _in: ids }, _or: [{ status_kirim: { _eq: 'terkirim' } }, { invoice_id: { _nnull: true } }] }),
		agg(P.sjKeluar, ['project'], { count: '*' }, { project: { _in: ids }, invoice_id: { _nnull: true } })
	]);
	const byProject = (rows: any[], key: string) => new Map<number, any>((rows || []).map((r) => [Number(r[key]), r]));
	const mMasuk = byProject(sjMasuk, 'project'), mPo = byProject(poDetail, 'po_id'), mKeluar = byProject(sjKeluarAll, 'project'), mSelesai = byProject(sjKeluarSelesai, 'project'), mInvoiced = byProject(sjKeluarInvoice, 'project');
	const inspCount = (id: number, statuses: string[]) => (inspeksi || []).filter((r) => Number(r.project_id) === id && statuses.includes(r.status)).reduce((s, r) => s + num(r.count), 0);
	const out: Record<number, string> = {};
	for (const id of ids) {
		const po = mPo.get(id);
		const keluar = num(mKeluar.get(id)?.count);
		const terserah = num(mSelesai.get(id)?.count);
		const st = deriveWorkshopStage({
			status: info[id]?.status,
			hasCustomerSjMasuk: num(mMasuk.get(id)?.count) > 0,
			hasProduksiReport: num(po?.count) > 0,
			sandblastingSum: num(po?.sum?.sandblasting), primerSum: num(po?.sum?.primer), secondSum: num(po?.sum?.second), topcoatSum: num(po?.sum?.topcoat),
			totalObjek: num(po?.sum?.total_objek), sudahDikerjakan: num(po?.sum?.sudah_dikerjakan),
			progressPct: num(info[id]?.progressPct),
			hasInspeksiDraft: inspCount(id, ['draft', 'menunggu_approval']) > 0,
			hasInspeksiApproved: inspCount(id, ['approved']) > 0,
			sjKeluarCount: keluar,
			sjKeluarDeliveredCount: terserah,
			hasOfficialInvoice: keluar > 0 && num(mInvoiced.get(id)?.count) >= keluar
		});
		out[id] = st.key;
	}
	return out;
}

const memberCache = new Map<string, boolean>();

/**
 * WSK-15 §4c — apakah pengguna ANGGOTA workshop (Project Leader / Manpower aktif di roster workshop ini)?
 * Anggota melihat SEMUA PO aktif workshop-nya, bukan hanya PO yang ia pimpin. Dua query kecil, di-cache per sesi.
 * Galat baca roster → false (jatuh ke scope lama, TIDAK melebar) tetapi dilog.
 */
export async function isWorkshopMember(ws: OpsWorkshopKey): Promise<boolean> {
	const P = opsProfile(ws);
	const karyawanId = get(authStore).karyawanId;
	if (!karyawanId) return false;
	const key = `${P.key}:${karyawanId}`;
	if (memberCache.has(key)) return memberCache.get(key)!;
	try {
		const [leaders, manpower] = (await Promise.all([
			directus.request(readItems('workshop_project_leader' as any, { filter: { workshop_id: { _eq: P.id }, status: { _eq: 'aktif' }, karyawan_id: { _eq: karyawanId } }, fields: ['id'], limit: 1 } as any)),
			directus.request(readItems('workshop_manpower' as any, { filter: { workshop_id: { _eq: P.id }, status: { _eq: 'aktif' }, karyawan_id: { _eq: String(karyawanId) } }, fields: ['id'], limit: 1 } as any))
		])) as [any[], any[]];
		const member = (leaders?.length || 0) > 0 || (manpower?.length || 0) > 0;
		memberCache.set(key, member);
		return member;
	} catch (e) {
		if (e instanceof TypeError) throw e;
		console.error('[workshopOpsApi.isWorkshopMember] gagal baca roster — pakai scope proyek biasa:', e);
		return false;
	}
}

/** "PO saya": leader / co-leader / pemegang kursi lapangan; untuk peran tak terbatas (admin) cocokkan nama/id leader. */
function isMyProject(p: any): boolean {
	const peran = getPeranProjectUser(p);
	if (peran === 'lead_pic' || peran === 'co_leader' || peran === 'manpower_leader') return true;
	const s = get(authStore);
	const lid = p?.leader_id && typeof p.leader_id === 'object' ? p.leader_id.id : p?.leader_id;
	if (s.karyawanId != null && lid != null && String(lid) === String(s.karyawanId)) return true;
	return !!(s.karyawanName && String(p?.leader || '').trim().toUpperCase().includes(s.karyawanName.trim().toUpperCase()));
}

/** Papan Order — PO workshop milik pengguna saat ini, TANPA Rupiah (konsisten RAP v2 Fase 5). */
export async function getMyOrders(ws: OpsWorkshopKey = 'ciketing'): Promise<MyOrderRow[]> {
	const P = opsProfile(ws);
	try {
		const scope = getProjectScope();
		// Anggota roster workshop = semua PO aktif workshop-nya (WSK-15 §4c), walau scope proyek pribadinya kosong
		const member = await isWorkshopMember(P.key);
		if (!scope.unrestricted && scope.kosong && !member) return [];

		const projects = member
			? await getProjects(null, true, get(authStore).directusToken, { orWorkshops: [P.projectWorkshop] })
			: await getProjectsForCurrentUser(true);
		const ciketing = (projects || []).filter(
			(p: any) => p?.workshop === P.projectWorkshop && !['selesai', 'closed'].includes(String(p.status || '').toLowerCase())
		);
		if (ciketing.length === 0) return [];

		// WSK-15: SATU set query agregat untuk semua PO (dulu 4 query per PO → ±280 request)
		const stages = await deriveStagesForProjects(
			ciketing.map((p: any) => Number(p.id)),
			P.key,
			Object.fromEntries(ciketing.map((p: any) => [Number(p.id), { progressPct: num(p.total_progress), status: p.status }]))
		);

		return ciketing.map((p: any) => ({
			projectId: Number(p.id),
			nomorPo: p.nomor_po || p.name || `#${p.id}`,
			customerName: p.customer?.[0]?.name || p.customer_name || '-',
			leader: p.leader || null,
			status: p.status || '-',
			endDate: p.end_date || null,
			stage: stages[Number(p.id)] || 'order',
			stageLabel: STAGE_LABEL[stages[Number(p.id)] || 'order'],
			soCustomerId: (typeof p.so_customer_id === 'object' ? p.so_customer_id?.id : p.so_customer_id) || null,
			mine: isMyProject(p)
		})).sort((a: MyOrderRow, b: MyOrderRow) => Number(b.mine) - Number(a.mine)); // PO saya di atas (urutan lain tetap)
	} catch (error) {
		// WSK-15 §4d: galat TIDAK lagi menyamar jadi "belum ada order" — dilempar supaya halaman menampilkan pesan + tombol Muat ulang.
		console.error('[workshopOpsApi.getMyOrders] gagal:', error);
		handleDirectusError(error);
		throw new Error('Papan Order gagal dimuat. Periksa sinyal lalu tekan “Muat ulang”.');
	}
}

/** Alias lama (pemanggil Ciketing). */
export const getMyCiketingOrders = () => getMyOrders('ciketing');

/**
 * Fase 5 §paritas lapangan — item PO (so_customer_details) per so_customer_id, dipakai
 * memilih so_detail_id di form Laporan Harian saat PO punya >1 item (supaya progres
 * lapangan bisa dipetakan presisi ke Timeline, bukan cuma fallback kategori tunggal
 * server-side). 1 query batch untuk semua so_customer_id sekaligus (Aturan #2).
 */
export async function getSoItemsForSoIds(soCustomerIds: number[]): Promise<Record<number, SoItemOption[]>> {
	const ids = [...new Set(soCustomerIds.filter(Boolean))];
	if (ids.length === 0) return {};
	try {
		const rows = (await directus.request(
			readItems('so_customer_details' as any, {
				filter: { so_customer_id: { _in: ids } },
				fields: ['id', 'so_customer_id', 'nama_barang', 'jenis_jasa'] as any,
				limit: -1
			})
		)) as any[];
		const out: Record<number, SoItemOption[]> = {};
		for (const r of rows || []) {
			const soId = typeof r.so_customer_id === 'object' ? r.so_customer_id?.id : r.so_customer_id;
			if (!soId) continue;
			if (!out[soId]) out[soId] = [];
			out[soId].push({ id: r.id, label: r.nama_barang || r.jenis_jasa || `Item #${r.id}` });
		}
		return out;
	} catch (error) {
		handleDirectusError(error);
		return {};
	}
}

/**
 * Mengambil subtask aktif dari timeline planning dan total akumulasi volume
 * yang telah terealisasi untuk daftar proyek Ciketing yang diberikan.
 */
export async function getProjectSubtasksAndAccum(projectIds: number[], ws: OpsWorkshopKey = 'ciketing'): Promise<{
	subtasksByPoId: Record<number, ActiveSubtask[]>;
	accumMap: Record<string, number>;
}> {
	const ids = [...new Set(projectIds.filter(Boolean))];
	if (ids.length === 0) return { subtasksByPoId: {}, accumMap: {} };
	const P = opsProfile(ws);

	try {
		const [projects, details] = await Promise.all([
			directus.request(
				readItems('projects' as any, {
					filter: { id: { _in: ids } },
					fields: ['id', 'timeline_planning'] as any,
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('workshop_report_po_detail' as any, {
					filter: { po_id: { _in: ids }, workshop_id: { _eq: P.id } },
					fields: ['po_id', 'subtask_id', 'volume_aktual', 'progress_hari_ini', 'sandblasting', 'primer', 'second', 'topcoat', 'so_detail_id'] as any,
					limit: -1
				})
			) as Promise<any[]>
		]);

		const subtasksByPoId: Record<number, ActiveSubtask[]> = {};
		for (const p of projects || []) {
			let tl = p.timeline_planning;
			if (typeof tl === 'string') {
				try { tl = JSON.parse(tl); } catch { tl = null; }
			}
			subtasksByPoId[Number(p.id)] = extractActiveSubtasks(tl);
		}

		const accumMap: Record<string, number> = {};
		for (const d of details || []) {
			if (d.subtask_id) {
				const sId = String(d.subtask_id);
				accumMap[sId] = (accumMap[sId] || 0) + (num(d.volume_aktual) || num(d.progress_hari_ini) || 0);
			}
			if (d.so_detail_id) {
				const soId = String(d.so_detail_id);
				accumMap[soId] = (accumMap[soId] || 0) + (num(d.sandblasting) + num(d.primer) + num(d.second) + num(d.topcoat));
			}
		}

		return { subtasksByPoId, accumMap };
	} catch (error) {
		handleDirectusError(error);
		return { subtasksByPoId: {}, accumMap: {} };
	}
}

/**
 * Fase 4 Link SJ (Audit Timeline Ciketing) — daftar SJ Masuk terbaru per proyek, untuk
 * dropdown "SJ Terkait (opsional)" di form Laporan Harian. Dibatasi 90 hari terakhir per
 * proyek supaya daftar tetap ringkas (SJ lama jarang relevan untuk laporan hari ini).
 */
export async function getSjMasukOptionsForProjects(projectIds: number[], ws: OpsWorkshopKey = 'ciketing'): Promise<Record<number, SjMasukOption[]>> {
	const ids = [...new Set(projectIds.filter(Boolean))];
	if (ids.length === 0) return {};
	const P = opsProfile(ws);
	try {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - 90);
		const cutoffStr = cutoff.toISOString().slice(0, 10);
		const rows = (await directus.request(
			readItems(P.sjMasuk as any, {
				filter: { project: { _in: ids }, tanggal: { _gte: cutoffStr } },
				fields: ['id', 'project', 'no_sj', 'nama_barang', 'tanggal'] as any,
				sort: ['-tanggal'] as any,
				limit: -1
			})
		)) as any[];
		const out: Record<number, SjMasukOption[]> = {};
		for (const r of rows || []) {
			const pid = typeof r.project === 'object' ? r.project?.id : r.project;
			if (!pid) continue;
			if (!out[pid]) out[pid] = [];
			const tgl = r.tanggal ? String(r.tanggal).substring(0, 10) : null;
			out[pid].push({
				id: r.id,
				label: `${r.no_sj || `SJ #${r.id}`}${r.nama_barang ? ' — ' + r.nama_barang : ''}${tgl ? ` (${tgl})` : ''}`,
				tanggal: tgl
			});
		}
		return out;
	} catch (error) {
		handleDirectusError(error);
		return {};
	}
}

/** Upload satu foto, kembalikan UUID file Directus (null bila gagal — non-fatal di pemanggil). */
export async function uploadWorkshopPhoto(file: File | Blob, name: string): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file, name);
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (err) {
		// Rekomendasi Tambahan Lapangan #3 (Offline Mode Enhancement) — lempar ulang
		// TypeError (tidak ada sinyal) supaya pemanggil bisa menyimpan foto sbg Blob
		// mentah ke antrian offline, alih-alih diam-diam kehilangan foto (return null).
		if (err instanceof TypeError) throw err;
		handleDirectusError(err);
		return null;
	}
}

export interface FotoTahapEntry {
	stage: 'sandblasting' | 'primer' | 'second' | 'topcoat';
	file_id: string;
	caption?: string;
}

export interface LaporanPoDetailInput {
	po_id: number;
	subtask_id?: string | null;
	subtask_name?: string | null;
	volume_aktual?: number;
	satuan?: string;
	so_detail_id?: number | null;
	sandblasting?: number;
	primer?: number;
	second?: number;
	topcoat?: number;
	jumlah_manpower: number;
	aktivitas?: string;
	/** Kendala khusus PO ini (kolom workshop_report_po_detail.kendala_po). */
	kendala_po?: string;
	surat_jalan_masuk_id?: number | null; // Fase 4 Link SJ — opsional, sama untuk semua baris subtask 1 PO
	// §5 Rekomendasi lapangan "Foto per Tahap" — bukti visual per tahap PO hari ini,
	// disimpan ke workshop_report_po_detail.foto_urls (field baru, json array).
	foto_urls?: FotoTahapEntry[];
}

// R8 (24 Sep 2026) — Before/After Photo Gallery per Work Ticket/PO. Baca kembali
// `workshop_report_po_detail.foto_urls` (write-only sebelumnya, ditulis Laporan
// Harian/Quick Report — lihat submitLaporanHarianWorkshop/submitQuickFieldReport).
export interface FotoTahapGalleryEntry {
	rowId: number;
	tanggal: string | null;
	stage: FotoTahapEntry['stage'] | null;
	fileId: string;
	caption: string | null;
	subtaskName: string | null;
}

export async function fetchFotoTahapForProject(projectId: number, ws: OpsWorkshopKey = 'ciketing'): Promise<FotoTahapGalleryEntry[]> {
	if (!projectId) return [];
	try {
		const rows = (await directus.request(
			readItems('workshop_report_po_detail' as any, {
				filter: { po_id: { _eq: projectId }, workshop_id: { _eq: opsProfile(ws).id } },
				fields: ['id', 'subtask_name', 'foto_urls', 'laporan_id.tanggal'] as any,
				sort: ['-laporan_id.tanggal'] as any,
				limit: -1
			})
		)) as any[];

		const out: FotoTahapGalleryEntry[] = [];
		for (const r of rows || []) {
			let fotoUrls = r.foto_urls;
			if (typeof fotoUrls === 'string') {
				try { fotoUrls = JSON.parse(fotoUrls); } catch { fotoUrls = []; }
			}
			if (!Array.isArray(fotoUrls)) continue;
			for (const f of fotoUrls) {
				if (!f?.file_id) continue;
				out.push({
					rowId: r.id,
					tanggal: r.laporan_id?.tanggal || null,
					stage: f.stage || null,
					fileId: f.file_id,
					caption: f.caption || null,
					subtaskName: r.subtask_name || null
				});
			}
		}
		return out;
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

// R11 (24 Sep 2026) — SPK/Tiket Kerja Internal Status Tracking. ciketing_work_ticket
// SUDAH punya field status (draft/in_progress/partial_complete/completed/closed) +
// qty_completed/qty_shipped — gap-nya murni UI (belum ada list/dashboard untuk lihatnya).
export interface WorkTicketStatusRow {
	id: number;
	ticketNumber: string;
	status: string;
	poNumber: string | null;
	totalQty: number;
	qtyCompleted: number;
	qtyShipped: number;
	satuan: string | null;
	dateCreated: string | null;
}

export const WORK_TICKET_STATUS_LABEL: Record<string, string> = {
	draft: 'Draft',
	in_progress: 'Dikerjakan',
	partial_complete: 'Selesai Sebagian',
	completed: 'Selesai',
	closed: 'Ditutup'
};

export async function fetchWorkTicketsForProject(projectId: number, ws: OpsWorkshopKey = 'ciketing'): Promise<WorkTicketStatusRow[]> {
	if (!projectId) return [];
	try {
		const rows = (await directus.request(
			readItems(opsProfile(ws).workTicket as any, {
				filter: { project_id: { _eq: projectId } },
				fields: ['id', 'ticket_number', 'status', 'po_number', 'total_qty', 'qty_completed', 'qty_shipped', 'satuan', 'date_created'] as any,
				sort: ['-date_created'] as any,
				limit: -1
			})
		)) as any[];
		return (rows || []).map((r) => ({
			id: r.id,
			ticketNumber: r.ticket_number || `#${r.id}`,
			status: r.status || 'draft',
			poNumber: r.po_number || null,
			totalQty: num(r.total_qty),
			qtyCompleted: num(r.qty_completed),
			qtyShipped: num(r.qty_shipped),
			satuan: r.satuan || null,
			dateCreated: r.date_created || null
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * WSK-12 §4b — kompatibilitas antrian offline LAMA (tanpa `ws`): tentukan workshop dari `projects.workshop` milik PO yang dilaporkan.
 * Semua PO harus satu workshop; bila campur / tak diketahui → MELEMPAR (entri tetap di antrian dengan pesan jelas, tidak ditebak ke Ciketing).
 */
export async function resolveWorkshopForProjects(projectIds: Array<number | string>): Promise<OpsWorkshopKey> {
	const ids = [...new Set(projectIds.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))];
	if (ids.length === 0) throw new Error('Pilih workshop untuk laporan tertunda ini (tidak ada PO untuk ditentukan).');
	const rows: any[] = await directus.request(readItems('projects' as any, { filter: { id: { _in: ids } }, fields: ['id', 'workshop'], limit: ids.length } as any));
	const keys = new Set((rows || []).map((r) => String(r?.workshop || '').toLowerCase().trim()));
	if (keys.size === 1) {
		const only = [...keys][0];
		if (only === 'ciketing' || only === 'balaraja') return only;
	}
	throw new Error('Pilih workshop untuk laporan tertunda ini (PO bercampur atau workshop-nya belum ditentukan).');
}

const STATUS_TO_ABSENSI_PUSAT: Record<string, string> = { hadir: 'hadir', ijin: 'izin', sakit: 'sakit', absen: 'alpha' };

/**
 * Salin absensi MANPOWER (bukan leader) ke manpower_absensi pusat — idempoten (lewati yang sudah ada di tanggal itu) & gagal-aman.
 * Pola sama dengan jembatan di form admin erp-epi (workshopApi.syncManpowerAbsensiFromLaporan), tetapi 2 query batch, bukan per orang.
 */
async function syncManpowerAbsensiPusat(rows: LaporanAbsensiInput[], tanggal: string): Promise<void> {
	try {
		const mp = rows.filter((r) => r.tipe === 'manpower' && r.manpower_id);
		if (mp.length === 0) return;
		const wm: any[] = await directus.request(
			readItems('workshop_manpower' as any, { filter: { id: { _in: mp.map((r) => r.manpower_id) } }, fields: ['id', 'manpower_id'], limit: mp.length } as any)
		);
		const pusatByRoster = new Map<number, number>(wm.filter((w) => w.manpower_id).map((w) => [w.id, w.manpower_id]));
		const target = mp.map((r) => ({ pusatId: pusatByRoster.get(r.manpower_id as number), status: r.status_hadir })).filter((t) => t.pusatId);
		if (target.length === 0) return;
		const ada: any[] = await directus.request(
			readItems('manpower_absensi' as any, { filter: { manpower_id: { _in: target.map((t) => t.pusatId) }, tanggal: { _eq: tanggal } }, fields: ['manpower_id'], limit: target.length } as any)
		);
		const sudah = new Set(ada.map((a) => a.manpower_id));
		const baru = target.filter((t) => !sudah.has(t.pusatId)).map((t) => ({
			manpower_id: t.pusatId, tanggal, status: STATUS_TO_ABSENSI_PUSAT[t.status as string] || 'hadir',
			biaya_harian: 0, work_context_type: 'internal', metode_catat: 'leader'
		}));
		if (baru.length > 0) await directus.request(createItems('manpower_absensi' as any, baru as any));
	} catch (e) {
		if (e instanceof TypeError) throw e;
		console.error('[syncManpowerAbsensiPusat] gagal (laporan tetap tersimpan):', e);
	}
}

/** Roster aktif workshop untuk langkah Kehadiran: Project Leader dulu, lalu Manpower. Dua query terpisah (Aturan #2). */
export async function getWorkshopRoster(ws: OpsWorkshopKey): Promise<RosterPerson[]> {
	const P = requireOpsProfile(ws);
	try {
		const [leaders, manpower] = (await Promise.all([
			directus.request(readItems('workshop_project_leader' as any, { filter: { workshop_id: { _eq: P.id }, status: { _eq: 'aktif' } }, fields: ['id', 'karyawan_nama', 'jabatan'], sort: ['karyawan_nama'], limit: 100 } as any)),
			directus.request(readItems('workshop_manpower' as any, { filter: { workshop_id: { _eq: P.id }, status: { _eq: 'aktif' } }, fields: ['id', 'karyawan_nama', 'jabatan'], sort: ['karyawan_nama'], limit: 200 } as any))
		])) as [any[], any[]];
		return [
			...leaders.map((l) => ({ tipe: 'leader' as const, rosterId: l.id, nama: l.karyawan_nama || '', jabatan: l.jabatan || 'Project Leader' })),
			...manpower.map((m) => ({ tipe: 'manpower' as const, rosterId: m.id, nama: m.karyawan_nama || '', jabatan: m.jabatan || '' }))
		];
	} catch (error) {
		if (error instanceof TypeError) throw error;
		handleDirectusError(error);
		return [];
	}
}

export interface MaterialSuggestion { id: number; nama: string; satuan: string; kategori: string }

/** Master item aktif workshop untuk autocomplete material (datalist). Dibatasi 500 baris — bukan limit=-1. */
export async function getMaterialSuggestions(ws: OpsWorkshopKey): Promise<MaterialSuggestion[]> {
	const P = requireOpsProfile(ws);
	try {
		const rows: any[] = await directus.request(
			readItems(P.itemCollection as any, { filter: { aktif: { _neq: false } }, fields: ['id', 'nama_barang', 'satuan_default', 'kategori'], sort: ['nama_barang'], limit: 500 } as any)
		);
		return rows.filter((r) => r.nama_barang).map((r) => ({ id: r.id, nama: r.nama_barang, satuan: r.satuan_default || '', kategori: r.kategori || '' }));
	} catch (error) {
		if (error instanceof TypeError) throw error;
		handleDirectusError(error);
		return [];
	}
}

export interface LaporanAbsensiInput {
	tipe: 'leader' | 'manpower';
	nama: string;
	jabatan?: string;
	status_hadir: 'hadir' | 'ijin' | 'sakit' | 'absen';
	keterangan?: string;
	/** id baris roster workshop_manpower (hanya manpower) */
	manpower_id?: number | null;
	po_split?: Array<{ po_id: number; persentase: number }>;
}

export interface LaporanMaterialInput {
	kategori?: string;
	nama_material: string;
	qty: number;
	satuan?: string;
}

export interface LaporanHarianInput {
	/** WAJIB (WSK-12) — tanpa default. Entri antrian offline lama tanpa `ws` ditentukan lewat resolveWorkshopForProjects() sebelum dikirim. */
	ws?: OpsWorkshopKey;
	tanggal: string; // YYYY-MM-DD
	cuaca?: string;
	jumlah_tenaga: number;
	kendala?: string;
	catatan?: string;
	dibuat_oleh?: string;
	/** WSK-13 §4d — id transaksi dari klien (form/antrian offline). Dikirim ulang dengan id yang sama → laporan TIDAK dobel. */
	client_txn_id?: string;
	fotoIds?: string[]; // foto umum: dicatat sbg referensi di `catatan` (foto progres per PO → po_details[].foto_urls)
	/** WSK-13 §4a — kehadiran roster (leader + manpower). Bila diisi: jumlah_tenaga = jumlah HADIR dan Σ-orang-per-PO tidak lagi diwajibkan sama (selaras form admin Fase 2C). */
	absensi?: LaporanAbsensiInput[];
	/** Foto grup absensi → workshop_daily_report.foto_absensi_masuk / foto_absensi_pulang (uuid file). */
	fotoAbsensiMasukId?: string | null;
	fotoAbsensiPulangId?: string | null;
	po_details: LaporanPoDetailInput[];
	// Form 3 langkah lapangan (§5 rekomendasi) — material terpakai hari ini, dicatat
	// ke workshop_report_material supaya Rekonsiliasi Material Harian admin (erp-epi
	// /api/ws/material-reconciliation) punya sisi "laporan" yang benar-benar terisi
	// dari lapangan (sebelumnya kosong — akar masalah "data kosong" implementation plan).
	materials?: LaporanMaterialInput[];
}

/**
 * Simpan Laporan Harian Workshop dari lapangan. Validasi Σ jumlah_manpower per PO HARUS
 * sama dengan jumlah_tenaga (Aturan RAP v2 #1 — sama seperti versi admin erp-epi).
 * Return { success, error? } — non-throw supaya form bisa tampilkan pesan langsung.
 */
export async function submitLaporanHarianWorkshop(
	input: LaporanHarianInput
): Promise<{ success: boolean; error?: string; laporanId?: number; alreadyProcessed?: boolean; code?: string; existingId?: number }> {
	let P: WorkshopOpsProfile;
	try { P = requireOpsProfile(input.ws); } catch (e: any) { return { success: false, error: e.message }; }
	if (!input.tanggal) return { success: false, error: 'Tanggal wajib diisi' };
	const filled = (input.po_details || []).filter(
		(d) => num(d.volume_aktual) > 0 || num(d.sandblasting) > 0 || num(d.primer) > 0 || num(d.second) > 0 || num(d.topcoat) > 0 || (d.aktivitas || '').trim() || (d.kendala_po || '').trim()
	);
	if (filled.length === 0) return { success: false, error: 'Isi progres minimal 1 PO/subtask (volume aktual/aktivitas).' };
	const absensiRows = input.absensi || [];
	const pakaiAbsensi = absensiRows.length > 0;
	const tanpaOrang = pakaiAbsensi ? [] : filled.filter((d) => !(num(d.jumlah_manpower) > 0));
	if (input.absensi && !pakaiAbsensi) return { success: false, error: 'Daftar kehadiran kosong — muat ulang halaman lalu isi kehadiran.' };
	if (pakaiAbsensi && !absensiRows.some((a) => a.tipe === 'leader')) return { success: false, error: 'Kehadiran Project Leader wajib ada minimal 1.' };
	if (tanpaOrang.length > 0) {
		return { success: false, error: `Kolom "Orang" wajib diisi (min 1) untuk ${tanpaOrang.length} PO yang dilaporkan.` };
	}
	// Dengan absensi: jumlah tenaga = jumlah yang HADIR (sumber tunggal, bukan ketikan terpisah)
	const totalTenaga = pakaiAbsensi ? absensiRows.filter((a) => a.status_hadir === 'hadir').length : num(input.jumlah_tenaga);
	const sumPerPo = filled.reduce((s, d) => s + num(d.jumlah_manpower), 0);
	if (totalTenaga <= 0) return { success: false, error: pakaiAbsensi ? 'Tidak ada yang hadir — tandai minimal 1 orang Hadir.' : 'Isi "Jumlah Tenaga" hari ini — harus sama dengan total orang di semua PO.' };
	if (!pakaiAbsensi && sumPerPo !== totalTenaga) {
		return { success: false, error: `Total orang per PO (${sumPerPo}) tidak sama dengan Jumlah Tenaga hari ini (${totalTenaga}). Samakan dulu.` };
	}

	try {
		// WSK-10/13: SATU request ke server — atomik (gagal di tengah = tidak ada yang tersimpan), idempoten (client_txn_id sama = laporan yang sama,
		// aman dikirim ulang dari antrian offline), tanggal ganda dijaga, dibuat_oleh & jumlah_tenaga ditentukan server.
		const token = await getIdToken();
		const catatanBase = input.fotoIds?.length
			? `${input.catatan || ''}\n[Foto: ${input.fotoIds.length} lampiran diunggah — id: ${input.fotoIds.join(', ')}]`.trim()
			: input.catatan || '';
		const asRow = (a: LaporanAbsensiInput) => ({ nama: a.nama, jabatan: a.jabatan || null, status_hadir: a.status_hadir, keterangan: a.keterangan || null, manpower_id: a.manpower_id ?? null, po_split: a.po_split });
		const res = await fetch(`/api/workshop/${P.key}/daily-report`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				clientTxnId: input.client_txn_id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `txn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
				header: {
					tanggal: input.tanggal,
					cuaca: input.cuaca || null,
					kendala: input.kendala || null,
					catatan: catatanBase || null,
					...(input.fotoAbsensiMasukId ? { foto_absensi_masuk: input.fotoAbsensiMasukId } : {}),
					...(input.fotoAbsensiPulangId ? { foto_absensi_pulang: input.fotoAbsensiPulangId } : {})
				},
				absensi: absensiRows.filter((a) => a.tipe !== 'leader').map(asRow),
				absensi_leader: absensiRows.filter((a) => a.tipe === 'leader').map(asRow),
				material: (input.materials || [])
					.filter((m) => (m.nama_material || '').trim() && num(m.qty) > 0)
					.map((m) => ({ kategori: m.kategori || null, nama_material: m.nama_material.trim(), qty: num(m.qty), satuan: m.satuan || null })),
				po_details: filled.map((d) => ({
					po_id: Number(d.po_id),
					...(d.subtask_id ? { subtask_id: String(d.subtask_id) } : {}),
					...(d.subtask_name ? { subtask_name: d.subtask_name } : {}),
					...(d.volume_aktual != null ? { volume_aktual: num(d.volume_aktual) } : {}),
					...(d.satuan ? { satuan: d.satuan } : {}),
					...(d.so_detail_id != null ? { so_detail_id: d.so_detail_id } : {}),
					...(d.surat_jalan_masuk_id != null ? { surat_jalan_masuk_id: d.surat_jalan_masuk_id } : {}),
					sandblasting: num(d.sandblasting),
					primer: num(d.primer),
					second: num(d.second),
					topcoat: num(d.topcoat),
					jumlah_manpower: num(d.jumlah_manpower),
					aktivitas: d.aktivitas || null,
					kendala_po: d.kendala_po || null,
					...(d.foto_urls?.length ? { foto_urls: d.foto_urls } : {})
				}))
			})
		});
		const out: any = await res.json().catch(() => ({}));
		if (res.status === 409 && out?.code === 'LAPORAN_TANGGAL_ADA') {
			return { success: false, code: 'LAPORAN_TANGGAL_ADA', error: out.message || 'Laporan di tanggal ini sudah ada.', existingId: out.existing?.id };
		}
		if (!res.ok || !out?.success) return { success: false, error: out?.message || `Gagal menyimpan laporan harian (${res.status}). Coba lagi.` };

		// Jembatan HRD (selaras form admin): absensi MANPOWER baru disalin ke manpower_absensi pusat. Best-effort — gagal tidak membatalkan laporan.
		if (Array.isArray(out.manpowerForSync) && out.manpowerForSync.length) {
			await syncManpowerAbsensiPusat(
				out.manpowerForSync.map((m: any) => ({ tipe: 'manpower' as const, nama: '', status_hadir: m.status_hadir, manpower_id: Number(m.manpower_id) })),
				input.tanggal
			);
		}
		return { success: true, laporanId: out.laporanId, alreadyProcessed: !!out.idempotent };
	} catch (error: any) {
		// Rekomendasi Tambahan Lapangan #3 (Offline Mode Enhancement) — TypeError berarti fetch gagal total (tidak ada sinyal), BUKAN error dari server.
		// Lempar ulang supaya pemanggil (halaman /workshop) menyimpannya ke antrian offline, bukan menganggapnya gagal permanen.
		if (error instanceof TypeError) throw error;
		handleDirectusError(error);
		return { success: false, error: error?.message || 'Gagal menyimpan laporan harian' };
	}
}

export type KondisiBarang = 'utuh' | 'cacat' | 'berkarat' | 'lainnya';

export interface TerimaBarangInput {
	ws?: OpsWorkshopKey; // default 'ciketing'
	projectId: number;
	no_sj: string;
	tanggal: string;
	nama_barang: string;
	qty: number;
	satuan: string;
	luasan_m2?: number;
	fotoSjId: string;
	fotoBarangId?: string | null;
	pic?: string;
	kondisi_barang: KondisiBarang;
}

const M2_SATUAN_HINTS = ['m2', 'm²'];

/**
 * Rekomendasi Tambahan Lapangan #1 (Checklist Penerimaan Barang) — validasi bersama
 * dipakai jalur online & offline (submitTerimaBarangLapangan dan sendQueuedTerimaBarang
 * di halaman) supaya aturannya tidak diketik dua kali dan bisa diam-diam menyimpang.
 */
export function validateTerimaBarangInput(input: {
	projectId: number;
	no_sj: string;
	satuan: string;
	luasan_m2?: number;
	kondisi_barang: KondisiBarang;
	hasFotoSj: boolean;
	hasFotoBarang: boolean;
}): string | null {
	if (!input.projectId) return 'Pilih PO terlebih dahulu';
	if (!input.no_sj?.trim()) return 'No. SJ wajib diisi';
	if (!input.hasFotoSj) return 'Foto SJ wajib diunggah';
	if (!input.kondisi_barang) return 'Kondisi barang wajib dipilih';
	const satuanIsM2 = M2_SATUAN_HINTS.some((h) => (input.satuan || '').toLowerCase().replace('²', '2').includes(h));
	if (satuanIsM2 && !(num(input.luasan_m2) > 0)) {
		return 'Luasan (m²) wajib diisi karena satuan barang ini m²';
	}
	if (input.kondisi_barang !== 'utuh' && !input.hasFotoBarang) {
		return 'Foto Barang wajib diunggah karena kondisi bukan "Utuh / Baik" (bukti untuk klaim)';
	}
	return null;
}

/**
 * Kartu ② "Terima Barang Customer" — buat SJ Masuk dari lapangan. Foto SJ WAJIB
 * (selaras gate shadow G_WSC_SJM_LENGKAP erp-epi), luasan wajib bila satuan m².
 * Kondisi barang WAJIB (Rekomendasi #1) — foto barang jadi wajib juga bila kondisi
 * bukan "utuh", supaya klaim kerusakan/karat punya bukti visual sejak awal.
 */
export async function submitTerimaBarangLapangan(
	input: TerimaBarangInput
): Promise<{ success: boolean; error?: string; alreadyProcessed?: boolean }> {
	let P: WorkshopOpsProfile;
	try { P = requireOpsProfile(input.ws); } catch (e: any) { return { success: false, error: e.message }; }
	const validationError = validateTerimaBarangInput({
		projectId: input.projectId,
		no_sj: input.no_sj,
		satuan: input.satuan,
		luasan_m2: input.luasan_m2,
		kondisi_barang: input.kondisi_barang,
		hasFotoSj: !!input.fotoSjId,
		hasFotoBarang: !!input.fotoBarangId
	});
	if (validationError) return { success: false, error: validationError };

	try {
		// WSK-13 §4d: SJ Masuk dengan project + no. SJ + tanggal yang sama = pengiriman ulang (antrian offline) → jangan dobel.
		const dupSj: any[] = await directus.request(
			readItems(P.sjMasuk as any, { filter: { project: { _eq: input.projectId }, no_sj: { _eq: input.no_sj.trim() }, tanggal: { _eq: input.tanggal } }, fields: ['id'], limit: 1 } as any)
		);
		if (dupSj?.[0]?.id) return { success: true, alreadyProcessed: true };
		await directus.request(
			createItem(P.sjMasuk as any, {
				project: input.projectId,
				no_sj: input.no_sj.trim(),
				tanggal: input.tanggal,
				nama_barang: input.nama_barang || null,
				qty: num(input.qty),
				satuan: input.satuan || null,
				luasan_m2: num(input.luasan_m2) || null,
				foto_sj: input.fotoSjId,
				foto_barang: input.fotoBarangId || null,
				pic: input.pic || null,
				// kolom kondisi_barang hanya ada di ciketing_surat_jalan_masuk (Balaraja → 403 bila dikirim)
				...(P.sjmHasKondisi ? { kondisi_barang: input.kondisi_barang } : {}),
				status_input: 'belum_input'
			} as any)
		);
		return { success: true };
	} catch (error: any) {
		// Rekomendasi Tambahan Lapangan #3 (Offline Mode Enhancement) — lihat catatan sama
		// di submitLaporanHarianWorkshop.
		if (error instanceof TypeError) throw error;
		handleDirectusError(error);
		return { success: false, error: error?.message || 'Gagal menyimpan SJ Masuk' };
	}
}

export interface QuickFieldReportInput {
	ws?: OpsWorkshopKey; // WAJIB (WSK-12) — tanpa default
	projectId: number;
	aktivitas: string;
	fotoIds: string[];
	/** @deprecated diabaikan — pembuat ditentukan server dari token. */
	dibuat_oleh?: string;
	/** Id transaksi dari klien: dikirim ulang dengan id yang sama (timeout/ketuk ulang) → quick report TIDAK dobel. Dibuat otomatis bila kosong. */
	client_txn_id?: string;
}

/**
 * Rekomendasi Tambahan Lapangan #2 (Quick Report via Kamera) — laporan super-ringkas
 * 1 PO + foto + catatan singkat, TANPA validasi jumlah orang/tenaga (Aturan #6 —
 * dilarang mempersulit alur darurat/cepat lapangan). Ini PELENGKAP laporan harian
 * lengkap, bukan pengganti — tidak masuk hitungan jumlah_tenaga/manpower reconciliation
 * karena memang tidak mengisinya. Selalu buat baris `workshop_daily_report` baru
 * (boleh lebih dari 1 per hari) supaya jejak waktu foto akurat, bukan digabung ke
 * laporan lengkap hari itu yang mungkin belum/sudah dikirim terpisah.
 * WSK-13: disimpan lewat endpoint server (atomik + idempoten); header Quick Report TIDAK menghalangi laporan lengkap di tanggal yang sama.
 */
export async function submitQuickFieldReport(
	input: QuickFieldReportInput
): Promise<{ success: boolean; error?: string; laporanId?: number; alreadyProcessed?: boolean }> {
	let P: WorkshopOpsProfile;
	try { P = requireOpsProfile(input.ws); } catch (e: any) { return { success: false, error: e.message }; }
	if (!input.projectId) return { success: false, error: 'Pilih PO terlebih dahulu' };
	if (input.fotoIds.length === 0) return { success: false, error: 'Foto wajib diambil' };

	try {
		const token = await getIdToken();
		const res = await fetch(`/api/workshop/${P.key}/quick-report`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				clientTxnId: input.client_txn_id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `txn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
				projectId: input.projectId,
				aktivitas: input.aktivitas || '',
				fotoIds: input.fotoIds
			})
		});
		const out: any = await res.json().catch(() => ({}));
		if (!res.ok || !out?.success) return { success: false, error: out?.message || `Gagal menyimpan quick report (${res.status}). Coba lagi.` };
		return { success: true, laporanId: out.laporanId, alreadyProcessed: !!out.idempotent };
	} catch (error: any) {
		// TypeError = tidak ada sinyal → dilempar ulang (halaman menampilkan "coba lagi saat online").
		if (error instanceof TypeError) throw error;
		handleDirectusError(error);
		return { success: false, error: error?.message || 'Gagal menyimpan quick report' };
	}
}
