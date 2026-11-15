// src/lib/utils/mobSyncLapangan.ts
// Tampilan Dashboard Lapangan untuk Sinkronisasi Mobilisasi (gate G_MOB_SYNC, dihitung server erp-epi). MURNI.
// Lapangan hanya menampilkan: label, hitung mundur, SJ yang masih di jalan, daftar SJ untuk Laporan Harian, dan SARAN pekerjaan
// non-material (keputusan tetap di Leader — tidak mengubah timeline).
import type { FulfillmentMobSync, FulfillmentSj, ProjectFulfillment } from '$lib/services/projectFulfillment';

export const MOB_SYNC_LABEL: Record<string, { label: string; short: string; icon: string; cls: string; help: string }> = {
	waiting_material: {
		label: 'Tim Menunggu Material',
		short: 'Tunggu Material',
		icon: '🔴',
		cls: 'bg-rose-50 text-rose-700 border-rose-200',
		help: 'Tim dijadwalkan mulai sebelum material tiba — berpotensi standby di site.'
	},
	synchronized: { label: 'Sinkron', short: 'Sinkron', icon: '🟢', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', help: 'Material tiba tepat sebelum tim mulai.' },
	early_material: {
		label: 'Material Terlalu Awal',
		short: 'Material Awal',
		icon: '🟡',
		cls: 'bg-amber-50 text-amber-700 border-amber-200',
		help: 'Material tiba beberapa hari sebelum tim mulai. Siapkan tempat simpan yang aman.'
	},
	waiting_manpower: {
		label: 'Tim Belum Siap',
		short: 'Tim Belum Siap',
		icon: '🟠',
		cls: 'bg-orange-50 text-orange-700 border-orange-200',
		help: 'Material akan menganggur di site cukup lama. Koordinasikan jadwal tim dengan admin.'
	},
	unknown: { label: 'Belum Dinilai', short: 'Belum dinilai', icon: '⚪', cls: 'bg-slate-50 text-slate-600 border-slate-200', help: 'Data belum cukup untuk menilai sinkronisasi.' }
};

const REASON: Record<string, string> = {
	no_upcoming_spk: 'Belum ada SPK manpower yang akan mulai.',
	no_material_forecast: 'Kebutuhan material proyek belum dicatat admin di Timeline.',
	eta_unconfirmed: 'Ada material yang belum punya ETA (Surat Jalan belum terbit / belum ber-ETA).',
	disabled: 'Penilaian sinkronisasi dimatikan admin.',
	error: 'Gagal menghitung sinkronisasi, coba segarkan.'
};

export function mobSyncView(status: string | undefined | null) {
	return MOB_SYNC_LABEL[status || ''] || MOB_SYNC_LABEL.unknown;
}

export function mobSyncReason(reason: string | undefined | null): string {
	return REASON[reason || ''] || REASON.eta_unconfirmed;
}

const okDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

function inDays(n: number, subject: string): string {
	if (n === 0) return `${subject} hari ini`;
	if (n === 1) return `${subject} besok`;
	if (n > 1) return `${subject} dalam ${n} hari`;
	return `${subject} ${Math.abs(n)} hari lalu`;
}

/** "Material tiba dalam 2 hari · Tim mulai besok" (proyeksi → "diperkirakan tiba"). */
export function mobSyncCountdown(ms: FulfillmentMobSync | null | undefined, today: string): string {
	if (!ms || !okDay(today)) return '';
	const parts: string[] = [];
	if (okDay(ms.material_eta)) parts.push(inDays(dayDiff(ms.material_eta, today), ms.projected ? 'Material diperkirakan tiba' : 'Material tiba'));
	if (okDay(ms.manpower_start)) parts.push(inDays(dayDiff(ms.manpower_start, today), 'Tim mulai'));
	return parts.join(' · ');
}

/** Teks tahap tracking SJ yang ramah. */
export function trackStageLabel(stage: string | null | undefined): string {
	const map: Record<string, string> = {
		dimuat: 'Dimuat di gudang',
		diserahkan_ekspedisi: 'Diserahkan ke ekspedisi',
		dalam_perjalanan: 'Dalam perjalanan',
		tiba_lokasi: 'Tiba di lokasi'
	};
	return stage ? map[stage] || stage.replace(/_/g, ' ') : '';
}

/** Semua SJ unik proyek (dari baris material), terurut ETA lalu nomor. Murni. */
export function listProjectSj(f: Pick<ProjectFulfillment, 'bySubtask'> | null | undefined): FulfillmentSj[] {
	const seen = new Map<string, FulfillmentSj>();
	for (const slot of Object.values(f?.bySubtask || {})) {
		for (const m of slot?.materials || []) {
			for (const sj of m?.sj || []) if (sj && !seen.has(String(sj.id))) seen.set(String(sj.id), sj);
		}
	}
	return [...seen.values()].sort((a, b) => String(a.eta_tiba || '9999').localeCompare(String(b.eta_tiba || '9999')) || String(a.nomor_sj || '').localeCompare(String(b.nomor_sj || '')));
}

/** SJ yang masih di jalan (belum diterima di site). */
export function listInTransitSj(f: Pick<ProjectFulfillment, 'bySubtask'> | null | undefined): FulfillmentSj[] {
	return listProjectSj(f).filter((s) => !s.received_at);
}

export interface ContingencySuggestion {
	id: string;
	name: string;
	category: string;
	first: string | null;
	last: string | null;
}

/**
 * SARAN pekerjaan yang tidak butuh material (mis. scaffold, marking, persiapan area) selagi menunggu material — hanya bila
 * status waiting_material. Subtask tanpa baris material, belum lewat, dan jadwalnya mulai sebelum material tiba. Murni; tidak
 * mengubah timeline (keputusan di Leader).
 */
export function contingencySuggestions(f: ProjectFulfillment | null | undefined, max = 5): ContingencySuggestion[] {
	const ms = f?.mobSync;
	if (!f || ms?.status !== 'waiting_material' || !okDay(f.today)) return [];
	const eta = okDay(ms.material_eta) ? ms.material_eta : null;
	return (f.subtasks || [])
		.filter((s) => {
			if (!s?.id || !okDay(s.last) || s.last < f.today) return false;
			if ((f.bySubtask?.[s.id]?.materials || []).length > 0) return false;
			return !eta || !okDay(s.first) || s.first <= eta;
		})
		.sort((a, b) => String(a.first || '9999').localeCompare(String(b.first || '9999')))
		.slice(0, max)
		.map((s) => ({ id: s.id, name: s.name || '(tanpa nama)', category: s.category || '', first: s.first, last: s.last }));
}
