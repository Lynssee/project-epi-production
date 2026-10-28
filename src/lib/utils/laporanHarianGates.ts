// src/lib/utils/laporanHarianGates.ts
// Wizard Kelengkapan Gate — Laporan Harian lapangan, laporan/[project_id]/+page.svelte::sendReport().
//
// Fase 1 (Gate Keras Disiplin Data & Laporan Harian, 17 Sep 2026) — pembungkus tipis di
// atas src/lib/shared/laporanHarianRules.ts (satu sumber kebenaran, dipakai juga admin
// erp-epi-1 dan Fase 2 guard server). SEBELUMNYA file ini punya aturan sendiri yang LEBIH
// LONGGAR dari admin (C3: tidak cek cuaca/jml tenaga/catatan umum/kendala umum/ringkasan
// rencana besok) — sekarang disamakan lewat modul bersama, plus gate Hold (menutup C2).
//
// gate_key TETAP G_LH_* / G_WEEKEND_* (konvensi lama dipertahankan) supaya
// gateHintClient.ts::applyGateHints() tetap nyambung ke gate_definitions admin.

import { evaluateLaporanHarianRules, type LaporanHarianSnapshot, type LaporanHarianGate } from '$lib/shared/laporanHarianRules';

export interface LaporanHarianGateContext {
	cleanSchedule: any[];
	cleanTomorrowPlan: any[];
	cleanProgress: any[];
	progressPhotosCount: number;
	cleanMaterialUsed: any[];
	cleanManpower: any[];
	attendancePhotosCount: number;
	isFriday: boolean;
	weekendLocationRecap: string;
	weekendPhotosCount: number;
	// Fase 1 Dokumentasi Foto (26 Sep 2026) — WARN, opsional (default 0) supaya
	// pemanggil lama yang belum diupdate tetap jalan tanpa error tipe.
	issuePhotosCount?: number;
	toolboxPhotosCount?: number;
	areaKerjaPhotosCount?: number;
	// Fase 1 — field baru untuk menutup C2/C3. Opsional (default kosong) supaya
	// pemanggil lama yang belum diupdate tetap jalan tanpa error tipe.
	date?: string;
	activityStatus?: string;
	holdReason?: string;
	weather?: string;
	manpowerCount?: number | null;
	generalNotes?: string;
	issuesGeneral?: string;
	tomorrowPlanSummary?: string;
	karyawanId?: number | string | null;
	// Fase 1 Laporan Lapangan & Paritas ERP (16 Okt 2026) — HSE Harian & Jam Henti.
	// Opsional (default kosong) supaya pemanggil lama tetap jalan tanpa error tipe.
	hseDaily?: { apd_compliance?: string; catatan_k3?: string; [key: string]: any };
	downtimeLog?: any[];
	// Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — QC Ambient & Rasio Material.
	qcAmbient?: { applicable?: boolean; filled_today?: boolean; [key: string]: any };
	materialVariance?: { flagged?: boolean; note?: string; [key: string]: any };
}

const TAB_LABEL: Record<string, string> = {
	jadwal: 'Jadwal',
	progress: 'Progress',
	material: 'Material',
	tenaga: 'Tenaga',
	peralatan: 'Peralatan',
	keuangan: 'Keuangan',
	weekend: 'Weekend Report',
	umum: 'Field Umum',
	toolbox: 'Toolbox Meeting',
	area_kerja: 'Area Kerja',
	hse: 'HSE & K3',
	lainnya: 'Lainnya'
};

function toGateShape(g: LaporanHarianGate) {
	return {
		gate_key: g.gate_key,
		label: g.label,
		severity: g.severity === 'WARN' ? ('WARN' as const) : ('WAJIB' as const),
		status: g.status,
		message: g.message,
		tab: g.tab || 'umum',
		tab_label: TAB_LABEL[g.tab || 'umum'] || g.tab || 'Umum'
	};
}

export function evaluateLaporanHarianGates(ctx: LaporanHarianGateContext) {
	const snapshot: LaporanHarianSnapshot = {
		date: ctx.date,
		activity_status: ctx.activityStatus,
		hold_reason: ctx.holdReason,
		karyawan_id: ctx.karyawanId,
		weather: ctx.weather,
		manpower_count: ctx.manpowerCount,
		general_notes: ctx.generalNotes,
		issues_general: ctx.issuesGeneral,
		tomorrow_plan_summary: ctx.tomorrowPlanSummary,
		schedule: ctx.cleanSchedule,
		tomorrow_plan: ctx.cleanTomorrowPlan,
		progress: ctx.cleanProgress,
		progress_photos_count: ctx.progressPhotosCount,
		material_used: ctx.cleanMaterialUsed,
		manpower: ctx.cleanManpower,
		attendance_photos_count: ctx.attendancePhotosCount,
		weekend_location_recap: ctx.weekendLocationRecap,
		weekend_photos_count: ctx.weekendPhotosCount,
		issue_photos_count: ctx.issuePhotosCount ?? 0,
		toolbox_photos_count: ctx.toolboxPhotosCount ?? 0,
		area_kerja_photos_count: ctx.areaKerjaPhotosCount ?? 0,
		hse_daily: ctx.hseDaily ?? {},
		downtime_log: ctx.downtimeLog ?? [],
		qc_ambient: ctx.qcAmbient ?? {},
		material_variance: ctx.materialVariance ?? {}
	};

	const { gates } = evaluateLaporanHarianRules(snapshot);
	// G_LH_ANTI_SALIN butuh previousReport terpisah (fetch di pemanggil, Aturan #2) —
	// belum dipakai di wizard klien. Disembunyikan di sini (bukan gate yang bisa
	// "diperbaiki" lewat tombol Benahi) supaya tidak membingungkan lapangan.
	return gates.filter((g) => g.gate_key !== 'G_LH_ANTI_SALIN').map(toGateShape);
}
