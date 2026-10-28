// src/lib/utils/checkpointScanRoute.ts
// Satu sumber kebenaran untuk "setelah scan QR patroli, buka halaman apa?".
// Sebelumnya logika ini DUPLIKAT di src/routes/scan/[code]/+page.svelte dan
// src/routes/(app)/+layout.svelte (tombol Scan universal) — sekarang keduanya
// memanggil helper ini. Murni fungsi, tanpa efek samping — mudah diuji.
//
// Bagian dari "Barang per Ruangan via QR Patroli" (Fase 1, 10 Sep 2026).

export type ScanRouteMode = 'auto' | 'pilih' | 'checklist_dulu';

export interface CheckpointResolveLike {
	kind: 'ga' | 'security';
	schedule_id?: string | number;
	area_id?: string | number;
	template_id?: string | number;
	/** Petugas terjadwal hari ini / staff tetap ruangan. Default false bila server lama. */
	is_assigned?: boolean;
	room?: { area_id: number; area_name?: string; item_count?: number } | null;
}

export interface RouteDecision {
	/** URL tujuan relatif. */
	url: string;
	/** Alasan singkat — untuk log/telemetri, bukan ditampilkan. */
	reason: 'security' | 'checklist_assigned' | 'checklist_forced' | 'room_page' | 'checklist_no_area';
}

/** URL checklist GA klasik (perilaku lama). */
function checklistUrl(r: CheckpointResolveLike): string {
	const qs = new URLSearchParams();
	if (r.area_id != null) qs.set('area_id', String(r.area_id));
	if (r.template_id != null) qs.set('template_id', String(r.template_id));
	const q = qs.toString();
	return `/ga-checklist/${r.schedule_id ?? 'unscheduled'}${q ? `?${q}` : ''}`;
}

/** Halaman Ruangan (lihat barang di ruangan) — dibangun di Fase 2. */
export function roomPageUrl(areaId: string | number): string {
	return `/ruangan/${areaId}`;
}

/**
 * Tentukan tujuan setelah scan.
 *
 * - `security`          -> selalu /satpam/patroli (checklist pos butuh sesi ronda aktif).
 * - `checklist_dulu`    -> perilaku lama: semua scan GA -> checklist (tombol mundur instan).
 * - `auto` (default)    -> petugas terjadwal / staff ruangan -> checklist ; lainnya -> Halaman Ruangan.
 * - `pilih`             -> selalu Halaman Ruangan; di sana ada tombol "Buka Checklist"
 *                          (chooser inline penuh menyusul; untuk sekarang Halaman Ruangan
 *                          sudah memuat kedua aksi sehingga tidak ada jalan buntu).
 *
 * Bila `kind==='ga'` tapi `area_id` hilang (data checkpoint tak lengkap), jatuh ke
 * checklist unscheduled — jangan pernah mengarahkan ke /ruangan/undefined.
 */
export function routeCheckpointScan(
	result: CheckpointResolveLike,
	opts: { scanRouteMode?: ScanRouteMode } = {}
): RouteDecision {
	if (result.kind === 'security') {
		return { url: '/satpam/patroli', reason: 'security' };
	}

	if (result.area_id == null) {
		return { url: checklistUrl(result), reason: 'checklist_no_area' };
	}

	const mode: ScanRouteMode = opts.scanRouteMode ?? 'auto';

	if (mode === 'checklist_dulu') {
		return { url: checklistUrl(result), reason: 'checklist_forced' };
	}

	if (mode === 'auto' && result.is_assigned) {
		return { url: checklistUrl(result), reason: 'checklist_assigned' };
	}

	// mode 'pilih', atau 'auto' untuk non-petugas
	return { url: roomPageUrl(result.area_id), reason: 'room_page' };
}
