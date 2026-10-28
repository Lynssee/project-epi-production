// src/lib/shared/laporanHarianRules.ts
//
// Satu sumber kebenaran aturan kelengkapan Laporan Harian — SALINAN TERVERIFIKASI
// dari erp-epi/src/lib/shared/laporanHarianRules.js. Dipanggil dari wizard admin
// (erp-epi), wizard lapangan (project-epi), dan (Fase 2) guard server di kedua
// repo. Modul MURNI: tanpa I/O, tanpa impor Directus/Svelte.
//
// Daftar gate_key WAJIB sama persis dengan erp-epi/src/lib/shared/laporanHarianRules.js
// — lihat laporanHarianRules.contract.test.ts.
//
// Rencana: docs/(analyst) implementation_plan_Penajaman Dokumentasi Proyek —
// Foto BeforeAfter Wajib & Gate Enforcement.md, Fase 1.
//
// `snapshot` = payload `reports` apa adanya (bentuk yang dikirim/tersimpan di
// Directus), BUKAN state form mentah — supaya modul yang sama bisa dievaluasi
// atas objek yang persis sama di klien maupun server.
//
// Tingkat gate (dinaikkan bertahap lewat gate_enforcement, lihat Fase 2):
//   A — aturan lapangan yang sudah berlaku hari ini
//   B — narasi umum (sudah ada di admin, belum di lapangan — menutup C3)
//   C — kualitas isi (baru): subtask_id + catatan wajib SEMUA baris progress
//       (keputusan user, bukan hanya baris yang berubah), tautan leader,
//       alasan Hold, anti-salin narasi

const MIN_HOLD_ALASAN_LEN = 20;
const MIN_PROGRESS_NOTES_LEN = 10;

export type GateTier = 'A' | 'B' | 'C';
export type GateStatus = 'passed' | 'failed' | 'not_applicable';
export type GateSeverity = 'WAJIB' | 'WARN';

export interface LaporanHarianGate {
	gate_key: string;
	label: string;
	tier: GateTier;
	severity: GateSeverity;
	status: GateStatus;
	message: string;
	tab: string | null;
	field_hint: string | null;
}

export interface LaporanHarianSnapshot {
	date?: string;
	activity_status?: string;
	karyawan_id?: number | string | null;
	weather?: string;
	manpower_count?: number | null;
	general_notes?: string;
	issues_general?: string;
	tomorrow_plan_summary?: string;
	hold_reason?: string;
	schedule?: any[];
	tomorrow_plan?: any[];
	progress?: any[];
	material_used?: any[];
	manpower?: any[];
	progress_photos?: any[];
	progress_photos_count?: number;
	attendance_photos?: any[];
	attendance_photos_count?: number;
	weekend_location_recap?: string;
	weekend_photos?: any[];
	weekend_photos_count?: number;
	issue_photos?: any[];
	issue_photos_count?: number;
	toolbox_photos?: any[];
	toolbox_photos_count?: number;
	area_kerja_photos?: any[];
	area_kerja_photos_count?: number;
	[key: string]: any;
}

export interface LaporanHarianPreviousReport {
	general_notes?: string;
	issues_general?: string;
	tomorrow_plan_summary?: string;
	[key: string]: any;
}

function isEmpty(v: any): boolean {
	if (v === null || v === undefined) return true;
	if (typeof v === 'string') return v.trim() === '';
	if (Array.isArray(v)) return v.length === 0;
	return false;
}

function gate(
	key: string,
	label: string,
	tier: GateTier,
	status: GateStatus,
	message: string,
	opts: { tab?: string; field_hint?: string; severity?: GateSeverity } = {}
): LaporanHarianGate {
	return {
		gate_key: key,
		label,
		tier,
		severity: opts.severity || 'WAJIB',
		status,
		message,
		tab: opts.tab || null,
		field_hint: opts.field_hint || null
	};
}

export function evaluateLaporanHarianRules(
	snapshot: LaporanHarianSnapshot,
	opts: { previousReport?: LaporanHarianPreviousReport } = {}
): { gates: LaporanHarianGate[]; score: number } {
	const s = snapshot || {};
	const isHold = s.activity_status === 'hold';
	const isFriday = s.date ? new Date(s.date).getDay() === 5 : false;
	const gates: LaporanHarianGate[] = [];

	// ---- Tingkat A ----
	// Saat Hold, tab Jadwal/Progress/Material disembunyikan total dari UI lapangan
	// (tidak ada aktivitas untuk dilaporkan) — gate-gate ini jadi not_applicable,
	// BUKAN failed. Tenaga & Foto Absensi TETAP wajib (bukti standby).
	const schedule = s.schedule || [];
	const tomorrowPlan = s.tomorrow_plan || [];
	const progress = s.progress || [];
	const progressPhotoCount = s.progress_photos_count ?? (s.progress_photos || []).length;
	const materialUsed = s.material_used || [];

	if (isHold) {
		gates.push(gate('G_LH_JADWAL', 'Jadwal kegiatan terisi', 'A', 'not_applicable', 'N/A — status Hold', { tab: 'jadwal' }));
		gates.push(gate('G_LH_RENCANA_BESOK', 'Rencana besok (detail) terisi', 'A', 'not_applicable', 'N/A — status Hold', { tab: 'jadwal' }));
		gates.push(gate('G_LH_PROGRESS', 'Progress pekerjaan terisi', 'A', 'not_applicable', 'N/A — status Hold', { tab: 'progress' }));
		gates.push(gate('G_LH_FOTO_PROGRESS', 'Foto bukti progress terlampir', 'A', 'not_applicable', 'N/A — status Hold', { tab: 'progress' }));
		gates.push(gate('G_LH_MATERIAL_TERPAKAI', 'Material terpakai terisi', 'A', 'not_applicable', 'N/A — status Hold', { tab: 'material' }));
	} else {
		gates.push(schedule.length > 0
			? gate('G_LH_JADWAL', 'Jadwal kegiatan terisi', 'A', 'passed', `${schedule.length} aktivitas terisi`, { tab: 'jadwal' })
			: gate('G_LH_JADWAL', 'Jadwal kegiatan terisi', 'A', 'failed', 'Jadwal kegiatan wajib diisi minimal 1 aktivitas.', { tab: 'jadwal' }));

		gates.push(tomorrowPlan.length > 0
			? gate('G_LH_RENCANA_BESOK', 'Rencana besok (detail) terisi', 'A', 'passed', `${tomorrowPlan.length} rencana terisi`, { tab: 'jadwal' })
			: gate('G_LH_RENCANA_BESOK', 'Rencana besok (detail) terisi', 'A', 'failed', 'Rencana besok wajib diisi minimal 1 rencana.', { tab: 'jadwal' }));

		gates.push(progress.length > 0
			? gate('G_LH_PROGRESS', 'Progress pekerjaan terisi', 'A', 'passed', `${progress.length} item progress`, { tab: 'progress' })
			: gate('G_LH_PROGRESS', 'Progress pekerjaan terisi', 'A', 'failed', 'Progress pekerjaan wajib diisi minimal 1 item.', { tab: 'progress' }));

		const subtaskPhotosCount = progress.reduce((sum: number, p: any) => sum + (Array.isArray(p?.foto_bukti) ? p.foto_bukti.length : (p?.foto_bukti ? 1 : 0)), 0);
		const totalProgressPhotos = progressPhotoCount + subtaskPhotosCount;
		gates.push(totalProgressPhotos > 0
			? gate('G_LH_FOTO_PROGRESS', 'Foto bukti progress terlampir', 'A', 'passed', `${totalProgressPhotos} foto`, { tab: 'progress' })
			: gate('G_LH_FOTO_PROGRESS', 'Foto bukti progress terlampir', 'A', 'failed', 'Foto bukti progress wajib dilampirkan.', { tab: 'progress' }));

		gates.push(materialUsed.length > 0
			? gate('G_LH_MATERIAL_TERPAKAI', 'Material terpakai terisi', 'A', 'passed', `${materialUsed.length} item material`, { tab: 'material' })
			: gate('G_LH_MATERIAL_TERPAKAI', 'Material terpakai terisi', 'A', 'failed', 'Material terpakai wajib diisi minimal 1 item.', { tab: 'material' }));
	}

	const manpower = s.manpower || [];
	const hasWorkers = manpower.some((m: any) => (m?.workers || []).length > 0);
	gates.push(hasWorkers
		? gate('G_LH_TENAGA_KERJA', 'Daftar pekerja terisi', 'A', 'passed', 'Minimal 1 pekerja terisi', { tab: 'tenaga' })
		: gate('G_LH_TENAGA_KERJA', 'Daftar pekerja terisi', 'A', 'failed', 'Daftar pekerja wajib diisi minimal 1 orang.', { tab: 'tenaga' }));

	const attendancePhotoCount = s.attendance_photos_count ?? (s.attendance_photos || []).length;
	gates.push(attendancePhotoCount > 0
		? gate('G_LH_FOTO_ABSENSI', 'Foto bukti absensi terlampir', 'A', 'passed', `${attendancePhotoCount} foto`, { tab: 'tenaga' })
		: gate('G_LH_FOTO_ABSENSI', 'Foto bukti absensi terlampir', 'A', 'failed', 'Foto bukti absensi wajib dilampirkan.', { tab: 'tenaga' }));

	if (isFriday) {
		gates.push(!isEmpty(s.weekend_location_recap)
			? gate('G_WEEKEND_RECAP', 'Rekapan mingguan lokasi terisi', 'A', 'passed', 'Rekapan mingguan terisi', { tab: 'weekend' })
			: gate('G_WEEKEND_RECAP', 'Rekapan mingguan lokasi terisi', 'A', 'failed', 'Hari Jumat wajib mengisi rekapan mingguan lokasi absensi.', { tab: 'weekend' }));
		const weekendPhotoCount = s.weekend_photos_count ?? (s.weekend_photos || []).length;
		gates.push(weekendPhotoCount > 0
			? gate('G_WEEKEND_FOTO', 'File rekapan mingguan terlampir', 'A', 'passed', `${weekendPhotoCount} file`, { tab: 'weekend' })
			: gate('G_WEEKEND_FOTO', 'File rekapan mingguan terlampir', 'A', 'failed', 'Hari Jumat wajib melampirkan file rekapan mingguan absensi.', { tab: 'weekend' }));
	} else {
		gates.push(gate('G_WEEKEND_RECAP', 'Rekapan mingguan lokasi terisi', 'A', 'not_applicable', 'N/A — bukan hari Jumat', { tab: 'weekend' }));
		gates.push(gate('G_WEEKEND_FOTO', 'File rekapan mingguan terlampir', 'A', 'not_applicable', 'N/A — bukan hari Jumat', { tab: 'weekend' }));
	}

	// ---- Dokumentasi Foto Wajib (HARD GATES): Toolbox Meeting, Area Kerja, Foto Kendala ----
	const toolboxPhotoCount = s.toolbox_photos_count ?? (s.toolbox_photos || []).length;
	if (isHold) {
		gates.push(gate('G_LH_FOTO_TOOLBOX', 'Foto toolbox meeting/safety briefing terlampir', 'A', 'not_applicable', 'N/A — status Hold', { tab: 'toolbox' }));
	} else {
		gates.push(toolboxPhotoCount > 0
			? gate('G_LH_FOTO_TOOLBOX', 'Foto toolbox meeting/safety briefing terlampir', 'A', 'passed', `${toolboxPhotoCount} foto`, { tab: 'toolbox' })
			: gate('G_LH_FOTO_TOOLBOX', 'Foto toolbox meeting/safety briefing terlampir', 'A', 'failed', 'Foto toolbox meeting/safety briefing pagi wajib dilampirkan.', { tab: 'toolbox' }));
	}

	const areaKerjaPhotoCount = s.area_kerja_photos_count ?? (s.area_kerja_photos || []).length;
	if (isHold) {
		gates.push(gate('G_LH_FOTO_AREA_KERJA', 'Foto kondisi area kerja terlampir', 'A', 'not_applicable', 'N/A — status Hold', { tab: 'area_kerja' }));
	} else {
		gates.push(areaKerjaPhotoCount > 0
			? gate('G_LH_FOTO_AREA_KERJA', 'Foto kondisi area kerja terlampir', 'A', 'passed', `${areaKerjaPhotoCount} foto`, { tab: 'area_kerja' })
			: gate('G_LH_FOTO_AREA_KERJA', 'Foto kondisi area kerja terlampir', 'A', 'failed', 'Foto kondisi area kerja (before/after) wajib dilampirkan.', { tab: 'area_kerja' }));
	}

	const issuePhotoCount = s.issue_photos_count ?? (s.issue_photos || []).length;
	if (isEmpty(s.issues_general)) {
		gates.push(gate('G_LH_FOTO_KENDALA', 'Foto kendala terlampir (bila ada kendala)', 'A', 'not_applicable', 'N/A — tidak ada isian kendala', { tab: 'umum' }));
	} else {
		gates.push(issuePhotoCount > 0
			? gate('G_LH_FOTO_KENDALA', 'Foto kendala terlampir (bila ada kendala)', 'A', 'passed', `${issuePhotoCount} foto`, { tab: 'umum' })
			: gate('G_LH_FOTO_KENDALA', 'Foto kendala terlampir (bila ada kendala)', 'A', 'failed', 'Kendala umum terisi — foto bukti kendala wajib dilampirkan.', { tab: 'umum' }));
	}

	// ---- Paritas HSE & K3 Harian, Jam Henti, QC Ambient, Rasio Material (HARD GATES) ----
	const hseDaily = s.hse_daily || {};
	if (isHold) {
		gates.push(gate('G_LH_HSE_CHECKLIST', 'Checklist HSE & K3 harian terisi', 'A', 'not_applicable', 'N/A — status Hold', { tab: 'hse' }));
	} else {
		gates.push(!isEmpty(hseDaily.apd_compliance)
			? gate('G_LH_HSE_CHECKLIST', 'Checklist HSE & K3 harian terisi', 'A', 'passed', 'Checklist HSE & K3 harian terisi', { tab: 'hse' })
			: gate('G_LH_HSE_CHECKLIST', 'Checklist HSE & K3 harian terisi', 'A', 'failed', 'Checklist kepatuhan APD di tab HSE & K3 belum diisi.', { tab: 'hse' }));
	}

	const downtimeLog = s.downtime_log || [];
	const needsDowntimeReason = !isHold && !isEmpty(s.weather) && s.weather !== 'Cerah';
	if (!needsDowntimeReason) {
		gates.push(gate('G_LH_DOWNTIME_REASON', 'Atribusi jam henti terisi (bila cuaca tidak cerah)', 'A', 'not_applicable', isHold ? 'N/A — status Hold' : 'N/A — cuaca Cerah', { tab: 'hse' }));
	} else {
		gates.push(downtimeLog.length > 0
			? gate('G_LH_DOWNTIME_REASON', 'Atribusi jam henti terisi (bila cuaca tidak cerah)', 'A', 'passed', `${downtimeLog.length} entri jam henti terisi`, { tab: 'hse' })
			: gate('G_LH_DOWNTIME_REASON', 'Atribusi jam henti terisi (bila cuaca tidak cerah)', 'A', 'failed', 'Cuaca tidak cerah — wajib mengisi minimal 1 entri jam henti (durasi & penyebab) di tab HSE & K3.', { tab: 'hse' }));
	}

	const qcAmbient = s.qc_ambient || {};
	if (isHold || !qcAmbient.applicable || progress.length === 0) {
		const reason = isHold ? 'N/A — status Hold' : (!qcAmbient.applicable ? 'N/A — bukan proyek kategori Coating/Blasting' : 'N/A — tidak ada progress hari ini');
		gates.push(gate('G_LH_QC_AMBIENT', 'Kondisi Ambient & QC harian terisi', 'A', 'not_applicable', reason, { tab: 'progress' }));
	} else {
		gates.push(qcAmbient.filled_today
			? gate('G_LH_QC_AMBIENT', 'Kondisi Ambient & QC harian terisi', 'A', 'passed', 'Kondisi Ambient & QC harian terisi', { tab: 'progress' })
			: gate('G_LH_QC_AMBIENT', 'Kondisi Ambient & QC harian terisi', 'A', 'failed', 'Ada progress pengecatan/blasting hari ini tapi pembacaan Suhu & RH% belum diperbarui.', { tab: 'progress' }));
	}

	const materialVariance = s.material_variance || {};
	if (isHold || !materialVariance.flagged) {
		gates.push(gate('G_LH_MATERIAL_VARIANCE', 'Alasan deviasi konsumsi material terisi', 'A', 'not_applicable', isHold ? 'N/A — status Hold' : 'N/A — rasio konsumsi material masih dalam toleransi', { tab: 'material' }));
	} else {
		gates.push(!isEmpty(materialVariance.note)
			? gate('G_LH_MATERIAL_VARIANCE', 'Alasan deviasi konsumsi material terisi', 'A', 'passed', 'Alasan deviasi konsumsi material terisi', { tab: 'material' })
			: gate('G_LH_MATERIAL_VARIANCE', 'Alasan deviasi konsumsi material terisi', 'A', 'failed', 'Rasio konsumsi material melampaui toleransi — wajib mengisi alasan deviasi di tab Material.', { tab: 'material' }));
	}

	// ---- Tingkat B — narasi umum (menutup C3) ----
	// Sama seperti Tingkat A: field-field ini disembunyikan dari UI lapangan saat Hold
	// (lihat blok {#if !isHold} di form), jadi not_applicable, bukan failed.
	if (isHold) {
		gates.push(gate('G_LH_CUACA', 'Cuaca terisi', 'B', 'not_applicable', 'N/A — status Hold', { tab: 'umum' }));
		gates.push(gate('G_LH_JML_TENAGA', 'Jumlah tenaga terisi', 'B', 'not_applicable', 'N/A — status Hold', { tab: 'umum' }));
		gates.push(gate('G_LH_CATATAN_UMUM', 'Catatan umum terisi', 'B', 'not_applicable', 'N/A — status Hold', { tab: 'umum' }));
		gates.push(gate('G_LH_KENDALA_UMUM', 'Kendala umum terisi', 'B', 'not_applicable', 'N/A — status Hold', { tab: 'umum' }));
		gates.push(gate('G_LH_RENCANA_BESOK_RINGKASAN', 'Ringkasan rencana besok terisi', 'B', 'not_applicable', 'N/A — status Hold', { tab: 'umum' }));
	} else {
		gates.push(!isEmpty(s.weather)
			? gate('G_LH_CUACA', 'Cuaca terisi', 'B', 'passed', 'Cuaca terisi', { tab: 'umum' })
			: gate('G_LH_CUACA', 'Cuaca terisi', 'B', 'failed', 'Cuaca harus diisi.', { tab: 'umum' }));

		gates.push(!isEmpty(s.manpower_count) || s.manpower_count === 0
			? gate('G_LH_JML_TENAGA', 'Jumlah tenaga terisi', 'B', 'passed', 'Jumlah tenaga terisi', { tab: 'umum' })
			: gate('G_LH_JML_TENAGA', 'Jumlah tenaga terisi', 'B', 'failed', 'Jumlah Tenaga harus diisi.', { tab: 'umum' }));

		gates.push(!isEmpty(s.general_notes)
			? gate('G_LH_CATATAN_UMUM', 'Catatan umum terisi', 'B', 'passed', 'Catatan umum terisi', { tab: 'umum' })
			: gate('G_LH_CATATAN_UMUM', 'Catatan umum terisi', 'B', 'failed', 'Catatan Umum harus diisi.', { tab: 'umum' }));

		gates.push(!isEmpty(s.issues_general)
			? gate('G_LH_KENDALA_UMUM', 'Kendala umum terisi', 'B', 'passed', 'Kendala umum terisi', { tab: 'umum' })
			: gate('G_LH_KENDALA_UMUM', 'Kendala umum terisi', 'B', 'failed', 'Kendala Umum harus diisi.', { tab: 'umum' }));

		gates.push(!isEmpty(s.tomorrow_plan_summary)
			? gate('G_LH_RENCANA_BESOK_RINGKASAN', 'Ringkasan rencana besok terisi', 'B', 'passed', 'Ringkasan rencana besok terisi', { tab: 'umum' })
			: gate('G_LH_RENCANA_BESOK_RINGKASAN', 'Ringkasan rencana besok terisi', 'B', 'failed', 'Ringkasan Rencana Besok harus diisi.', { tab: 'umum' }));
	}

	// ---- Tingkat C — kualitas isi ----
	if (progress.length === 0) {
		gates.push(gate('G_LH_PROGRESS_SUBTASK', 'Setiap baris progress tertaut subtask', 'C', 'not_applicable', 'Tidak ada baris progress', { tab: 'progress' }));
		gates.push(gate('G_LH_PROGRESS_CATATAN', 'Setiap baris progress punya catatan', 'C', 'not_applicable', 'Tidak ada baris progress', { tab: 'progress' }));
		gates.push(gate('G_LH_PROGRESS_FOTO_PER_ITEM', 'Setiap baris progress punya foto bukti sendiri', 'C', 'not_applicable', 'Tidak ada baris progress', { tab: 'progress', severity: 'WARN' }));
	} else {
		const noSubtask = progress.filter((p: any) => isEmpty(p?.subtask_id)).length;
		gates.push(noSubtask === 0
			? gate('G_LH_PROGRESS_SUBTASK', 'Setiap baris progress tertaut subtask', 'C', 'passed', `${progress.length} baris tertaut subtask`, { tab: 'progress' })
			: gate('G_LH_PROGRESS_SUBTASK', 'Setiap baris progress tertaut subtask', 'C', 'failed', `${noSubtask} baris progress belum tertaut subtask timeline. Pilih pekerjaan (subtask) dari Timeline supaya progres terhitung di grafik proyek.`, { tab: 'progress' }));

		// Keputusan user: wajib untuk SEMUA baris, bukan hanya yang progress_value-nya berubah.
		const noNotes = progress.filter((p: any) => isEmpty(p?.notes) || String(p.notes).trim().length < MIN_PROGRESS_NOTES_LEN).length;
		gates.push(noNotes === 0
			? gate('G_LH_PROGRESS_CATATAN', 'Setiap baris progress punya catatan', 'C', 'passed', `${progress.length} baris punya catatan`, { tab: 'progress' })
			: gate('G_LH_PROGRESS_CATATAN', 'Setiap baris progress punya catatan', 'C', 'failed', `${noNotes} baris progress belum punya catatan (min. ${MIN_PROGRESS_NOTES_LEN} karakter).`, { tab: 'progress' }));

		// Foto bukti per-subtask pekerjaan (HARD GATE): Setiap pekerjaan yang ada progres wajib melampirkan foto bukti fisik
		const activeProgress = progress.filter((p: any) => (Number(p?.progress_value) || 0) > 0 || (p?.activity && p.activity.trim() !== ''));
		const noFotoPerItem = activeProgress.filter((p: any) => isEmpty(p?.foto_bukti)).length;
		gates.push(noFotoPerItem === 0
			? gate('G_LH_PROGRESS_FOTO_PER_ITEM', 'Setiap baris progress punya foto bukti sendiri', 'C', 'passed', `${progress.length} baris punya foto bukti`)
			: gate('G_LH_PROGRESS_FOTO_PER_ITEM', 'Setiap baris progress punya foto bukti sendiri', 'C', 'failed', `${noFotoPerItem} baris progress belum punya foto bukti fisik (lampirkan minimal 1 foto per pekerjaan yang ada progres).`, { tab: 'progress' }));
	}

	gates.push(!isEmpty(s.karyawan_id)
		? gate('G_LH_KARYAWAN_ID', 'Laporan tertaut leader', 'C', 'passed', 'Laporan tertaut ke akun leader', { tab: 'umum' })
		: gate('G_LH_KARYAWAN_ID', 'Laporan tertaut leader', 'C', 'failed', 'Laporan belum tertaut ke akun leader (karyawan_id kosong).', { tab: 'umum' }));

	if (isHold) {
		const alasanOk = !isEmpty(s.hold_reason) && String(s.hold_reason).trim().length >= MIN_HOLD_ALASAN_LEN;
		gates.push(alasanOk
			? gate('G_LH_HOLD_ALASAN', 'Alasan Hold terisi', 'C', 'passed', 'Alasan Hold terisi', { tab: 'umum' })
			: gate('G_LH_HOLD_ALASAN', 'Alasan Hold terisi', 'C', 'failed', `Status Hold wajib diisi alasan minimal ${MIN_HOLD_ALASAN_LEN} karakter.`, { tab: 'umum' }));
		gates.push(attendancePhotoCount > 0
			? gate('G_LH_HOLD_FOTO_STANDBY', 'Foto standby saat Hold terlampir', 'C', 'passed', `${attendancePhotoCount} foto`, { tab: 'tenaga' })
			: gate('G_LH_HOLD_FOTO_STANDBY', 'Foto standby saat Hold terlampir', 'C', 'failed', 'Status Hold tetap wajib melampirkan minimal 1 foto standby.', { tab: 'tenaga' }));
	} else {
		gates.push(gate('G_LH_HOLD_ALASAN', 'Alasan Hold terisi', 'C', 'not_applicable', 'N/A — status bukan Hold', { tab: 'umum' }));
		gates.push(gate('G_LH_HOLD_FOTO_STANDBY', 'Foto standby saat Hold terlampir', 'C', 'not_applicable', 'N/A — status bukan Hold', { tab: 'tenaga' }));
	}

	// G_LH_ANTI_SALIN — selalu 'warn', tidak pernah 'failed' dengan severity WAJIB, karena
	// ini pola kecurigaan, bukan pelanggaran pasti. Butuh previousReport dari pemanggil
	// (fetch terpisah — Aturan #2, jangan query bersarang di modul murni ini).
	if (opts.previousReport) {
		const prev = opts.previousReport;
		const narrativeFields = ['general_notes', 'issues_general', 'tomorrow_plan_summary'] as const;
		const identicalFields = narrativeFields.filter((f) => {
			const cur = String(s[f] || '').trim();
			const prevVal = String(prev[f] || '').trim();
			return cur.length > 0 && cur === prevVal;
		});
		gates.push(identicalFields.length > 0
			? gate('G_LH_ANTI_SALIN', 'Narasi tidak identik dengan laporan kemarin', 'C', 'failed', `Field identik persis dengan laporan sebelumnya: ${identicalFields.join(', ')}.`, { tab: 'umum', severity: 'WARN' })
			: gate('G_LH_ANTI_SALIN', 'Narasi tidak identik dengan laporan kemarin', 'C', 'passed', 'Narasi berbeda dari laporan sebelumnya', { tab: 'umum', severity: 'WARN' }));
	} else {
		gates.push(gate('G_LH_ANTI_SALIN', 'Narasi tidak identik dengan laporan kemarin', 'C', 'not_applicable', 'Laporan sebelumnya tidak diberikan ke evaluator', { tab: 'umum', severity: 'WARN' }));
	}

	// G_LH_DAILY_TARGET_CHECK — evaluasi target harian Kurva S (Tier C)
	const dailyTarget = (opts as any)?.dailyTarget ?? s.daily_target ?? null;
	if (isHold) {
		gates.push(gate('G_LH_DAILY_TARGET_CHECK', 'Target harian Kurva S tercapai', 'C', 'not_applicable', 'N/A — status Hold', { tab: 'progress', severity: 'WARN' }));
	} else if (dailyTarget != null && Number(dailyTarget) > 0) {
		const targetNum = Number(dailyTarget);
		const actualToday = s.actual_progress_today ?? s.progress_today ?? (progress.reduce((acc: number, p: any) => acc + (Number(p.progress_value) || 0), 0) / (progress.length || 1));
		const deviationReason = (s.deviation_reason || s.issues_general || s.general_notes || '').trim();
		if (actualToday >= targetNum) {
			gates.push(gate('G_LH_DAILY_TARGET_CHECK', 'Target harian Kurva S tercapai', 'C', 'passed', `Realisasi ${actualToday.toFixed(2)}% memenuhi target harian (${targetNum.toFixed(2)}%)`, { tab: 'progress', severity: 'WARN' }));
		} else if (deviationReason.length >= 10) {
			gates.push(gate('G_LH_DAILY_TARGET_CHECK', 'Target harian Kurva S tercapai', 'C', 'passed', `Realisasi (${actualToday.toFixed(2)}%) di bawah target (${targetNum.toFixed(2)}%), alasan deviasi terlampir`, { tab: 'progress', severity: 'WARN' }));
		} else {
			gates.push(gate('G_LH_DAILY_TARGET_CHECK', 'Target harian Kurva S tercapai', 'C', 'failed', `Realisasi (${actualToday.toFixed(2)}%) di bawah target Kurva S (${targetNum.toFixed(2)}%) — wajib cantumkan alasan deviasi/kendala`, { tab: 'progress', severity: 'WARN' }));
		}
	} else {
		gates.push(gate('G_LH_DAILY_TARGET_CHECK', 'Target harian Kurva S tercapai', 'C', 'not_applicable', 'N/A — tidak ada target harian terencana', { tab: 'progress', severity: 'WARN' }));
	}

	// G_LH_CUSTOMER_RELEASE — verifikasi kelengkapan sebelum rilis laporan customer (Tier C)
	if (isHold) {
		gates.push(gate('G_LH_CUSTOMER_RELEASE', 'Laporan memenuhi standar rilis customer', 'C', 'not_applicable', 'N/A — status Hold', { tab: 'umum', severity: 'WARN' }));
	} else {
		const hasProgress = progress.length > 0;
		const totalPhotos = progressPhotoCount + (s.attendance_photos_count ?? (s.attendance_photos || []).length);
		const hasPhotos = totalPhotos > 0 || (s.photos && s.photos.length > 0) || (s.foto && s.foto.length > 0);
		const hasGeneral = !isEmpty(s.general_notes) || !isEmpty(s.tomorrow_plan_summary);

		if (hasProgress && hasPhotos && hasGeneral) {
			gates.push(gate('G_LH_CUSTOMER_RELEASE', 'Laporan memenuhi standar rilis customer', 'C', 'passed', 'Dokumen laporan lengkap & memenuhi standar rilis customer', { tab: 'umum', severity: 'WARN' }));
		} else {
			const missing: string[] = [];
			if (!hasProgress) missing.push('progres pekerjaan');
			if (!hasPhotos) missing.push('foto dokumentasi');
			if (!hasGeneral) missing.push('catatan/rencana');
			gates.push(gate('G_LH_CUSTOMER_RELEASE', 'Laporan memenuhi standar rilis customer', 'C', 'failed', `Belum memenuhi syarat rilis customer: ${missing.join(', ')} belum lengkap`, { tab: 'umum', severity: 'WARN' }));
		}
	}

	const wajibGates = gates.filter((g) => g.severity === 'WAJIB' && g.status !== 'not_applicable');
	const passedWajib = wajibGates.filter((g) => g.status === 'passed').length;
	const score = wajibGates.length > 0 ? Math.round((passedWajib / wajibGates.length) * 100) : 100;

	return { gates, score };
}

export const LAPORAN_HARIAN_GATE_KEYS = [
	'G_LH_JADWAL', 'G_LH_RENCANA_BESOK', 'G_LH_PROGRESS', 'G_LH_FOTO_PROGRESS',
	'G_LH_MATERIAL_TERPAKAI', 'G_LH_TENAGA_KERJA', 'G_LH_FOTO_ABSENSI',
	'G_WEEKEND_RECAP', 'G_WEEKEND_FOTO',
	'G_LH_FOTO_TOOLBOX', 'G_LH_FOTO_AREA_KERJA', 'G_LH_FOTO_KENDALA',
	'G_LH_HSE_CHECKLIST', 'G_LH_DOWNTIME_REASON', 'G_LH_QC_AMBIENT', 'G_LH_MATERIAL_VARIANCE',
	'G_LH_CUACA', 'G_LH_JML_TENAGA', 'G_LH_CATATAN_UMUM', 'G_LH_KENDALA_UMUM', 'G_LH_RENCANA_BESOK_RINGKASAN',
	'G_LH_PROGRESS_SUBTASK', 'G_LH_PROGRESS_CATATAN', 'G_LH_PROGRESS_FOTO_PER_ITEM', 'G_LH_KARYAWAN_ID',
	'G_LH_HOLD_ALASAN', 'G_LH_HOLD_FOTO_STANDBY', 'G_LH_ANTI_SALIN',
	'G_LH_DAILY_TARGET_CHECK', 'G_LH_CUSTOMER_RELEASE'
];
