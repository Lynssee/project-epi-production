import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem, deleteItem } from '@directus/sdk';
import { getManpowerSetting } from './manpowerSettings';
import { hitungBiayaHarian, pilihRate, rateKosong } from '$lib/shared/manpowerAccrualCalc';

// ── Manpower Absensi (Timesheet origin) ────────────────────────────────────
// Menyatukan Timesheet Laporan Harian ke manpower_absensi (Fase 2) + akrual
// biaya harian ke project_expenses (mirror logika erp-epi-1/manpowerCostApi.js).
// Satu tabel, dua pintu masuk: absen geofence (erp-epi-1) atau timesheet (di sini).

// HADIR_FACTOR pindah ke $lib/shared/manpowerAccrualCalc (dipakai bersama server).

const asId = (v: any) => (v && typeof v === 'object' ? v.id : v);

/** Cari baris absensi assignment untuk tanggal tertentu (dari geofence ATAU timesheet). */
export async function findAbsensiToday(assignmentId: number, tanggal: string) {
	try {
		const rows = await directus.request(
			readItems('manpower_absensi', {
				fields: ['*'],
				filter: { assignment_id: { _eq: assignmentId }, tanggal: { _eq: tanggal } },
				limit: 1
			})
		);
		return (rows && (rows as any[])[0]) || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * Cari absensi manpower pada tanggal tertentu DI PROYEK LAIN (bukan proyek yang sedang
 * diisi). Dipakai untuk memperingatkan Project Leader saat menambahkan pekerja ke Laporan
 * Harian, supaya tidak absen ganda satu pekerja di dua proyek pada hari yang sama.
 */
export async function findAbsensiTodayOtherProject(manpowerId: number, tanggal: string, excludeProjectId: number) {
	try {
		const rows = await directus.request(
			readItems('manpower_absensi', {
				fields: ['id', 'project_id.id', 'project_id.name'],
				filter: {
					manpower_id: { _eq: manpowerId },
					tanggal: { _eq: tanggal },
					project_id: { _neq: excludeProjectId }
				},
				limit: 1
			})
		);
		return (rows && (rows as any[])[0]) || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export interface AbsensiRangeRow {
	id: number;
	project_id: number;
	manpower_id: number;
	tanggal: string;
	status: string;
}

/**
 * Ambil baris manpower_absensi lintas proyek dalam rentang tanggal — dipakai untuk laporan
 * Manpower Rencana vs Realisasi Terpusat (bandingkan headcount SPK aktif vs yang benar-benar
 * tercatat hadir per hari). Hanya field ringan, tanpa join, karena bisa banyak baris.
 */
export async function getAbsensiForProjectsInRange(
	projectIds: (number | string)[],
	startDate: string,
	endDate: string
): Promise<AbsensiRangeRow[]> {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const rows = await directus.request(
			readItems('manpower_absensi', {
				fields: ['id', 'project_id', 'manpower_id', 'tanggal', 'status'],
				filter: {
					project_id: { _in: projectIds },
					tanggal: { _between: [startDate, endDate] }
				},
				limit: -1
			})
		);
		return (rows || []) as any;
	} catch (error) {
		console.error('getAbsensiForProjectsInRange:', error);
		return [];
	}
}

export interface DobelProyekOverrideRow {
	id: number;
	tanggal: string;
	dicatat_oleh: string | null;
	manpower_id: { id: number; nama: string } | number;
	project_id: { id: number; name: string } | number;
	dobel_proyek_proyek_lain_id: { id: number; name: string } | number | null;
	report_id: number | null;
}

/**
 * Audit Log Override Dobel-Proyek — semua baris manpower_absensi di mana Project Leader
 * tetap menambahkan pekerja walau sudah ada warning "sudah absen di proyek lain hari ini"
 * (lihat addWorkerToRole di laporan/[project_id]/+page.svelte). Supaya override ini bisa
 * direview belakangan oleh manajemen, bukan lolos tanpa jejak.
 */
export async function getDobelProyekOverrides(projectIds: (number | string)[], limit = 100): Promise<DobelProyekOverrideRow[]> {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const rows = await directus.request(
			readItems('manpower_absensi', {
				fields: [
					'id', 'tanggal', 'dicatat_oleh', 'report_id',
					'manpower_id.id', 'manpower_id.nama',
					'project_id.id', 'project_id.name',
					'dobel_proyek_proyek_lain_id.id', 'dobel_proyek_proyek_lain_id.name'
				],
				filter: {
					dobel_proyek_flag: { _eq: true },
					project_id: { _in: projectIds }
				},
				sort: ['-tanggal'],
				limit
			})
		);
		return (rows || []) as any;
	} catch (error) {
		console.error('getDobelProyekOverrides:', error);
		return [];
	}
}

export interface SpkBentrokRow {
	manpower_id: number;
	nama: string;
	assignment_a: { id: number; project_id: number; nama_proyek: string; nomor_spk: string; tanggal_mulai: string; tanggal_selesai: string | null };
	assignment_b: { id: number; project_id: number; nama_proyek: string; nomor_spk: string; tanggal_mulai: string; tanggal_selesai: string | null };
}

function rentangTumpangTindih(aMulai: string | null, aSelesai: string | null, bMulai: string | null, bSelesai: string | null) {
	if (!aMulai || !bMulai) return false;
	const s1 = new Date(aMulai).getTime();
	const e1 = aSelesai ? new Date(aSelesai).getTime() : new Date('2099-12-31').getTime();
	const s2 = new Date(bMulai).getTime();
	const e2 = bSelesai ? new Date(bSelesai).getTime() : new Date('2099-12-31').getTime();
	return s1 <= e2 && s2 <= e1;
}

/**
 * Bentrok tingkat-SPK — dua penugasan (manpower_assignment) status='aktif' milik manpower
 * yang sama dengan rentang tanggal tumpang tindih. Lapisan deteksi ini SEBELUMNYA hanya ada
 * di Command Center admin (erp-epi-1, Kapasitas Proyek & Rekomendasi Dashboard v2); dibawa ke
 * halaman audit ini (Fase 4 §9 poin 2) supaya lapangan punya SATU tempat untuk semua bentrok —
 * level absensi harian (di atas) DAN level penugasan/SPK (di bawah), bukan dua sistem terpisah.
 * Dibatasi ke proyek yang diberikan (scope Project Leader), bukan seluruh perusahaan.
 */
export async function getSpkBentrok(projectIds: (number | string)[]): Promise<SpkBentrokRow[]> {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const rows: any[] = await directus.request(
			readItems('manpower_assignment', {
				fields: [
					'id', 'manpower_id.id', 'manpower_id.nama',
					'project_id.id', 'project_id.name',
					'nomor_spk', 'tanggal_mulai', 'tanggal_selesai'
				],
				filter: { status: { _eq: 'aktif' } },
				limit: -1
			})
		);

		const byManpower = new Map<number, any[]>();
		for (const r of rows) {
			const mid = typeof r.manpower_id === 'object' ? r.manpower_id?.id : r.manpower_id;
			if (!mid) continue;
			if (!byManpower.has(mid)) byManpower.set(mid, []);
			byManpower.get(mid)!.push(r);
		}

		const projectIdSet = new Set(projectIds.map((p) => Number(p)));
		const hasil: SpkBentrokRow[] = [];
		for (const [mid, list] of byManpower) {
			if (list.length < 2) continue;
			for (let i = 0; i < list.length; i++) {
				for (let j = i + 1; j < list.length; j++) {
					const a = list[i];
					const b = list[j];
					const pidA = typeof a.project_id === 'object' ? a.project_id?.id : a.project_id;
					const pidB = typeof b.project_id === 'object' ? b.project_id?.id : b.project_id;
					// Hanya tampilkan bila minimal satu sisi ada di scope proyek Project Leader ini.
					if (!projectIdSet.has(Number(pidA)) && !projectIdSet.has(Number(pidB))) continue;
					if (rentangTumpangTindih(a.tanggal_mulai, a.tanggal_selesai, b.tanggal_mulai, b.tanggal_selesai)) {
						hasil.push({
							manpower_id: mid,
							nama: (typeof a.manpower_id === 'object' ? a.manpower_id?.nama : null) || `#${mid}`,
							assignment_a: { id: a.id, project_id: pidA, nama_proyek: (typeof a.project_id === 'object' ? a.project_id?.name : null) || `#${pidA}`, nomor_spk: a.nomor_spk, tanggal_mulai: a.tanggal_mulai, tanggal_selesai: a.tanggal_selesai },
							assignment_b: { id: b.id, project_id: pidB, nama_proyek: (typeof b.project_id === 'object' ? b.project_id?.name : null) || `#${pidB}`, nomor_spk: b.nomor_spk, tanggal_mulai: b.tanggal_mulai, tanggal_selesai: b.tanggal_selesai }
						});
					}
				}
			}
		}
		return hasil;
	} catch (error) {
		console.error('getSpkBentrok:', error);
		return [];
	}
}

/**
 * R2-02 — jejak server (activity_log) untuk akrual yang tidak menghasilkan biaya / gagal.
 * Sebelumnya kegagalan hanya console.error di browser HP sehingga Admin Project tidak pernah tahu
 * kenapa Manpower tampil Rp0. Best-effort: gagal mencatat tidak boleh menggagalkan absensi.
 */
async function catatJejakAkrual(absensiId: number, kind: 'rate_kosong' | 'akrual_gagal', detail: string) {
	try {
		await directus.request(
			createItem('activity_log', {
				module: 'manpower',
				collection: 'manpower_absensi',
				record_id: String(absensiId),
				action: 'update',
				activity_type: 'warning',
				description: `[${kind}] absensi #${absensiId}: ${detail}`.slice(0, 2000),
				actor_name: 'timesheet-akrual',
				created_at: new Date().toISOString()
			})
		);
	} catch (logErr) {
		console.warn('[manpowerAbsensi] gagal mencatat jejak akrual (diabaikan):', logErr);
	}
}

/** Akrual/perbarui biaya harian sebuah baris manpower_absensi ke project_expenses (kategori jasa). */
async function postManpowerAccrual(absensiId: number) {
	try {
		const rows = await directus.request(
			readItems('manpower_absensi', {
				fields: [
					'*',
					'assignment_id.id',
					'assignment_id.rate_upah_harian',
					'assignment_id.rate_harian',
					'assignment_id.rate_lembur',
					'assignment_id.rate_standby',
					'assignment_id.rate_uang_makan'
				],
				filter: { id: { _eq: absensiId } },
				limit: 1
			})
		);
		const row: any = (rows as any[])?.[0];
		if (!row || row.payroll_id) return;

		// Rumus biaya hidup di $lib/shared/manpowerAccrualCalc — dipakai bersama endpoint
		// absensi regu (Manpower Leader). Jangan hitung ulang di sini; jalur uang harus
		// punya satu sumber kebenaran.
		const rate = pilihRate(row.assignment_id, row.manpower_id);
		// Holiday multiplier — configurable via app_settings (module='manpower', /settings/manpower),
		// fallback 1.5 bila settings kosong/gagal diambil.
		const holidayMultiplier = row.is_holiday ? await getManpowerSetting('holiday_multiplier') : 1.5;
		const biaya = hitungBiayaHarian(row, rate, holidayMultiplier);

		const existingExpenseId = asId(row.expense_id);

		if (biaya <= 0) {
			if (rateKosong(row, rate)) {
				const assignmentRef = row.assignment_id?.id || asId(row.assignment_id);
				console.warn(`[manpowerAbsensi] rate kosong: absensi #${row.id}, penugasan #${assignmentRef} — biaya Rp0`);
				await catatJejakAkrual(row.id, 'rate_kosong', `penugasan #${assignmentRef} belum punya rate (harian/standby) — biaya harian Rp0. Isi rate di penugasan lalu simpan ulang.`);
			}
			if (existingExpenseId) await directus.request(deleteItem('project_expenses', existingExpenseId));
			await directus.request(updateItem('manpower_absensi', row.id, { expense_id: null, biaya_harian: 0 }));
			return;
		}

		const manpowerId = asId(row.manpower_id);
		const projectId = asId(row.project_id);
		const assignmentId = row.assignment_id?.id || asId(row.assignment_id);

		let manpowerNama = '';
		if (manpowerId) {
			try {
				const mpRows = (await directus.request(
					readItems('manpower', {
						fields: ['id', 'nama'],
						filter: { id: { _eq: manpowerId } },
						limit: 1
					})
				)) as any[];
				manpowerNama = mpRows?.[0]?.nama || '';
			} catch (e) {
				console.warn('Gagal mengambil nama manpower untuk akrual:', e);
			}
		}

		const desc = manpowerNama
			? `Akrual harian ${manpowerNama} (assignment #${assignmentId}) via timesheet`
			: `Akrual harian manpower #${manpowerId} (assignment #${assignmentId}) via timesheet`;

		if (existingExpenseId) {
			await directus.request(
				updateItem('project_expenses', existingExpenseId, {
					expense_amount: biaya,
					debit_amount: biaya,
					expense_date: row.tanggal,
					description: desc,
					pic: manpowerNama || null
				})
			);
			await directus.request(updateItem('manpower_absensi', row.id, { biaya_harian: biaya }));
			return;
		}

		const created: any = await directus.request(
			createItem('project_expenses', {
				project_id: projectId,
				expense_date: row.tanggal,
				expense_type: 'jasa',
				expense_category: 'Jasa',
				description: desc,
				pic: manpowerNama || null,
				expense_amount: biaya,
				debit_amount: biaya,
				source: 'manpower_accrual',
				source_type: 'manpower_accrual',
				is_accrual: true,
				manpower_id: manpowerId,
				ref_absensi_id: row.id
			})
		);
		await directus.request(updateItem('manpower_absensi', row.id, { expense_id: created.id, biaya_harian: biaya }));
	} catch (error) {
		console.error('postManpowerAccrual (timesheet):', error);
		await catatJejakAkrual(absensiId, 'akrual_gagal', String((error as any)?.message || error).slice(0, 500));
	}
}

/**
 * Timesheet menulis ke manpower_absensi. Bila baris hari ini sudah ada (mis. dari absen
 * geofence), TIDAK membuat baris baru — mengembalikan status agar UI menampilkan
 * "sudah absen" dan mencegah dobel akrual biaya.
 */
export async function upsertTimesheetAbsensi(p: {
	assignmentId: number;
	manpowerId: number;
	projectId: number;
	tanggal: string;
	jamKerja: number;
	notes?: string;
	dicatatOleh?: string;
	reportId?: number;
	is_holiday?: boolean;
	ot_hours?: number;
	is_standby?: boolean;
	uang_makan?: boolean;
	/** Nominal kasbon/cash advance pada tanggal ini (dipotong dari gaji periode berjalan). */
	kasbonAmount?: number;
	/** 'hadir' | 'setengah_hari' | 'izin' | 'sakit' | 'alpha'. Default 'hadir'. */
	status?: string;
	/** Pilihan shift harian ('Non-Shift' | 'Shift 1' | 'Shift 2' | 'Shift 3') */
	shift?: string;
	/** True bila Project Leader tetap menambahkan pekerja ini walau sudah override warning
	 *  "sudah absen di proyek lain hari ini" di Laporan Harian. Untuk audit trail. */
	dobelProyekFlag?: boolean;
	/** Proyek lain yang jadi alasan warning saat dobelProyekFlag true. */
	dobelProyekProyekLainId?: number;
	/** ID file Directus untuk foto dokumentasi / briefing site */
	foto_masuk?: string | null;
	/** Fase 3 — konteks kerja. Default 'project' + id=projectId (timesheet = alat proyek). */
	workContextType?: string;
	workContextId?: number | null;
}) {
	try {
		const existing = await findAbsensiToday(p.assignmentId, p.tanggal);
		const status = p.status || 'hadir';

		const payload = {
			assignment_id: p.assignmentId,
			manpower_id: p.manpowerId,
			project_id: p.projectId,
			work_context_type: p.workContextType || 'project',
			work_context_id: p.workContextId ?? p.projectId,
			tanggal: p.tanggal,
			status,
			jam_kerja: p.jamKerja,
			foto_masuk: p.foto_masuk || null,
			dicatat_oleh: p.dicatatOleh || '',
			report_id: p.reportId || null,
			is_holiday: p.is_holiday || false,
			ot_hours: p.ot_hours || 0,
			is_standby: p.is_standby || false,
			uang_makan: p.uang_makan || false,
			kasbon_amount: p.kasbonAmount || 0,
			shift: p.shift || 'Non-Shift',
			dobel_proyek_flag: p.dobelProyekFlag || false,
			dobel_proyek_proyek_lain_id: p.dobelProyekProyekLainId || null
			// SENGAJA tidak menyentuh verifikasi_leader_* / metode_catat di sini.
			// Jalur ini dipakai timesheet & laporan harian oleh Project Leader/admin —
			// bukan absensi representatif Manpower Leader. Kalau di-set 'menunggu',
			// SETIAP entri timesheet normal akan membanjiri antrean verifikasi leader
			// dengan pekerjaan palsu (masalah yang sama dengan 804 baris historis di §10).
			// Absensi oleh leader punya jalurnya sendiri: /api/manpower-leader/absen-regu.
		};

		if (existing) {
			// Update the existing record with new fields (important for manual updates, termasuk
			// koreksi status saat pengisian IN dikosongkan/diubah kembali).
			await directus.request(updateItem('manpower_absensi', existing.id, {
				status: payload.status,
				jam_kerja: payload.jam_kerja,
				is_holiday: payload.is_holiday,
				uang_makan: payload.uang_makan,
				kasbon_amount: payload.kasbon_amount,
				ot_hours: payload.ot_hours,
				is_standby: payload.is_standby,
				shift: payload.shift,
				notes: p.notes || existing.notes,
				...(p.foto_masuk ? { foto_masuk: p.foto_masuk } : {}),
				// Hanya timpa flag dobel-proyek kalau kali ini memang override (jangan hapus
				// jejak override sebelumnya hanya karena update biasa tanpa override baru).
				...(payload.dobel_proyek_flag ? { dobel_proyek_flag: true, dobel_proyek_proyek_lain_id: payload.dobel_proyek_proyek_lain_id } : {})
			}));
			await postManpowerAccrual(existing.id);
			return { data: existing, success: true, viaGeofence: !!existing.jam_masuk, created: false };
		}

		const created: any = await directus.request(
			createItem('manpower_absensi', payload)
		);
		await postManpowerAccrual(created.id);
		return { data: created, success: true, viaGeofence: false, created: true };
	} catch (error: any) {
		console.error('upsertTimesheetAbsensi:', error);
		return { data: null, success: false, error: error.message };
	}
}

/**
 * Hapus baris manpower_absensi (dipakai saat pengisian di grid Gajian dikosongkan total —
 * IN/OT/SB semuanya 0 — untuk membatalkan entri yang salah). Ikut menghapus akrual biaya di
 * project_expenses yang tertaut, supaya tidak ada biaya hantu tersisa setelah absensi dibatalkan.
 */
export async function deleteAbsensiEntry(assignmentId: number, tanggal: string) {
	try {
		const existing: any = await findAbsensiToday(assignmentId, tanggal);
		if (!existing) return { success: true, deleted: false };

		const expenseId = asId(existing.expense_id);
		if (expenseId) {
			await directus.request(deleteItem('project_expenses', expenseId));
		}
		await directus.request(deleteItem('manpower_absensi', existing.id));
		return { success: true, deleted: true };
	} catch (error: any) {
		console.error('deleteAbsensiEntry:', error);
		return { success: false, deleted: false, error: error.message };
	}
}

/** Helper concurrency executor */
async function runConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<any>) {
	const results: Promise<any>[] = [];
	const executing: Promise<any>[] = [];
	for (const item of items) {
		const p = Promise.resolve().then(() => fn(item));
		results.push(p);
		if (limit <= items.length) {
			const e: Promise<any> = p.then(() => executing.splice(executing.indexOf(e), 1));
			executing.push(e);
			if (executing.length >= limit) {
				await Promise.race(executing);
			}
		}
	}
	return Promise.all(results);
}

/**
 * Rekap manpower_absensi dari histori Laporan Harian (reports.manpower) dalam rentang
 * tanggal tertentu. Dipakai sebagai jalur cadangan/backfill untuk laporan yang dikirim
 * sebelum auto-sync aktif, atau untuk pekerja yang saat itu belum punya assignment aktif.
 * Mempertahankan seluruh atribut lembur, standby, libur, uang makan, dan kasbon.
 */
export async function recapAbsensiFromReports(
	projectId: number,
	startDate: string,
	endDate: string,
	recordedBy = ''
) {
	const result = { success: true, created: 0, updated: 0, skipped: [] as { tanggal: string; nama: string }[], error: undefined as string | undefined };
	try {
		let reports: any[] = [];
		try {
			reports = (await directus.request(
				readItems('reports', {
					fields: ['id', 'date', 'manpower'],
					filter: {
						project_id: { _eq: projectId },
						date: { _gte: startDate, _lte: `${endDate}T23:59:59` }
					},
					sort: ['date'],
					limit: -1
				})
			)) as any[];
		} catch {
			reports = (await directus.request(
				readItems('reports', {
					fields: ['id', 'date', 'manpower'],
					filter: { project_id: { _eq: projectId }, date: { _between: [startDate, endDate] } },
					sort: ['date'],
					limit: -1
				})
			)) as any[];
		}

		const assignmentRows: any[] = (await directus.request(
			readItems('manpower_assignment', {
				fields: ['id', 'manpower_id'],
				filter: { project_id: { _eq: projectId }, status: { _eq: 'aktif' } },
				limit: -1
			})
		)) as any[];
		const byManpowerId = new Map(assignmentRows.map((a) => [String(asId(a.manpower_id)), a]));

		// Bulk fetch existing absensi dalam rentang tanggal untuk mencegah N+1 requests
		const existingRows: any[] = (await directus.request(
			readItems('manpower_absensi', {
				fields: ['id', 'assignment_id', 'manpower_id', 'tanggal', 'status', 'jam_kerja', 'ot_hours', 'is_standby', 'is_holiday', 'uang_makan', 'kasbon_amount', 'dikunci', 'payroll_id'],
				filter: {
					project_id: { _eq: projectId },
					tanggal: { _between: [startDate, endDate] }
				},
				limit: -1
			})
		)) as any[];
		const existingMap = new Map<string, any>();
		for (const r of existingRows || []) {
			const aId = asId(r.assignment_id);
			const mId = asId(r.manpower_id);
			const tgl = String(r.tanggal || '').slice(0, 10);
			if (aId) existingMap.set(`${aId}_${tgl}`, r);
			if (mId) existingMap.set(`m_${mId}_${tgl}`, r);
		}

		const queue: any[] = [];
		for (const report of reports || []) {
			const tanggal = String(report.date || '').slice(0, 10);
			if (!tanggal || tanggal < startDate || tanggal > endDate) continue;

			let groups = report.manpower;
			if (typeof groups === 'string') {
				try { groups = JSON.parse(groups); } catch { groups = []; }
			}
			if (!Array.isArray(groups)) groups = [];

			for (const group of groups) {
				const groupIsStandby = group.role === 'STANDBY';
				for (const w of (group.workers || [])) {
					const wId = typeof w === 'object' ? (w.id ?? w.manpower_id) : w;
					const assignment = byManpowerId.get(String(wId));
					if (!assignment) {
						result.skipped.push({ tanggal, nama: w.nama || `#${wId}` });
						continue;
					}

					const isStandby = groupIsStandby || !!w.is_standby;
					const isHoliday = !!w.is_holiday;
					const otHours = Number(w.ot_hours || w.lembur_jam || w.jam_lembur || 0);
					const jamKerja = isStandby ? 0 : (w.jam != null ? Number(w.jam) : 8);
					const uangMakan = !!w.uang_makan;
					const kasbonAmount = Number(w.kasbon_amount || w.kasbon_val || w.kasbon || 0);

					queue.push({
						assignmentId: assignment.id,
						manpowerId: wId,
						projectId,
						tanggal,
						jamKerja,
						notes: group.notes || '',
						dicatatOleh: recordedBy,
						reportId: report.id,
						is_holiday: isHoliday,
						ot_hours: otHours,
						is_standby: isStandby,
						uang_makan: uangMakan,
						kasbonAmount,
						dobelProyekFlag: !!w.dobel_proyek_flag,
						dobelProyekProyekLainId: w.dobel_proyek_proyek_lain_id
					});
				}
			}
		}

		await runConcurrent(queue, 6, async (item) => {
			const existingKey = `${item.assignmentId}_${item.tanggal}`;
			const existing = existingMap.get(existingKey) || existingMap.get(`m_${item.manpowerId}_${item.tanggal}`);
			if (existing && (existing.dikunci || existing.payroll_id)) {
				return;
			}
			const res = await upsertTimesheetAbsensi(item);
			if (res.success) {
				if (existing) result.updated++;
				else result.created++;
			}
		});

		return result;
	} catch (error: any) {
		console.error('recapAbsensiFromReports:', error);
		return { ...result, success: false, error: error.message };
	}
}
