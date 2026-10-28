// src/lib/utils/returLifecycle.ts
// Fase 5 — Rencana Unifikasi Lifecycle Pengembalian Barang (sisi lapangan). Murni: ubah baris
// packing_returns (+ header retur_gudang bila terbaca) jadi daftar "dokumen" dengan posisi stepper.
// Pemetaan tahap SAMA dengan antrean admin (erp-epi: inflowQueueBuilders.js buildL1Rows) supaya
// leader dan gudang melihat tahap yang sama.

export const RETUR_STEPS = [
	{ key: 'diajukan', label: 'Diajukan', hint: 'Pengajuan retur sudah masuk. Menunggu Inventory menjadwalkan penjemputan.' },
	{ key: 'dijadwalkan', label: 'Dijadwalkan', hint: 'Inventory sudah menjadwalkan jemput (tanggal & sopir). Saat barang naik ke mobil, konfirmasi berangkat.' },
	{ key: 'dalam_perjalanan', label: 'Dalam Perjalanan', hint: 'Barang sudah dikirim dari proyek menuju gudang.' },
	{ key: 'gerbang_gudang', label: 'Gerbang Gudang', hint: 'Barang sudah dipindai satpam di gerbang gudang.' },
	{ key: 'pemeriksaan_qc', label: 'Pemeriksaan QC', hint: 'Gudang sedang memeriksa jumlah & kondisi barang.' },
	{ key: 'selesai', label: 'Selesai', hint: 'Pemeriksaan selesai, saldo barang proyek sudah dikurangi.' }
] as const;

export type ReturStepKey = (typeof RETUR_STEPS)[number]['key'];

export interface ReturRow {
	id: number;
	project_id?: number | null;
	material_name?: string | null;
	qty_returned?: number | null;
	unit?: string | null;
	return_status?: string | null;
	date_created?: string | null;
	retur_gudang_id?: number | null;
}

export interface ReturHeader {
	id: number;
	nomor_retur?: string | null;
	status?: string | null;
	shipped_at?: string | null;
	security_verified_at?: string | null;
	rejection_reason?: string | null;
	// RSM-02: info jadwal jemput (diisi Admin Inventory) untuk tahap "Dijadwalkan".
	tanggal_pengambilan?: string | null;
	driver_name?: string | null;
	driver_phone?: string | null;
	vehicle_plate?: string | null;
}

export interface ReturTracking {
	key: string;
	docNo: string;
	stepIndex: number;
	stepKey: ReturStepKey;
	rejected: boolean;
	cancelled: boolean;
	rejectionReason: string | null;
	itemCount: number;
	itemsPreview: string[];
	date: string | null;
	ageDays: number | null;
	done: boolean;
	// RSM-01/02: dokumen header (bila terbaca) untuk hint & tombol "Konfirmasi Berangkat".
	docId: number | null;
	docStatus: string | null;
	jadwal: string | null;
	driverName: string | null;
	driverPhone: string | null;
	vehiclePlate: string | null;
	shippedAt: string | null;
}

const MS_DAY = 86_400_000;
const dayKey = (v?: string | null) => String(v ?? '').slice(0, 10);

function stepFor(header: ReturHeader | null | undefined, allChecked: boolean): ReturStepKey {
	if (allChecked) return 'selesai';
	const st = header?.status;
	if (st === 'dikirim') return header?.security_verified_at ? 'gerbang_gudang' : 'dalam_perjalanan';
	if (st === 'diterima' || st === 'diterima_sebagian') return 'pemeriksaan_qc';
	// RSM-02 §4.2: draft + tanggal_pengambilan terisi = sudah dijadwalkan Admin Inventory.
	if (st === 'draft' && header?.tanggal_pengambilan) return 'dijadwalkan';
	return 'diajukan';
}

/**
 * @param rows baris packing_returns proyek
 * @param headers peta id -> retur_gudang (boleh kosong bila tak terbaca; tahap jatuh ke 'diajukan'/'selesai')
 * @param now waktu acuan (injeksi supaya mudah diuji)
 */
export function buildReturTracking(
	rows: ReturRow[],
	headers: Map<number, ReturHeader> | Record<string, ReturHeader> = new Map(),
	now: string | number | Date = new Date()
): ReturTracking[] {
	const hdr = (id: number) => (headers instanceof Map ? headers.get(id) : (headers as Record<string, ReturHeader>)?.[id]);
	const nowT = new Date(now).getTime();
	const groups = new Map<string, ReturRow[]>();
	for (const r of rows || []) {
		if (!r) continue;
		const g = r.retur_gudang_id ? `RG-${r.retur_gudang_id}` : `PR-${r.project_id}-${dayKey(r.date_created)}`;
		if (!groups.has(g)) groups.set(g, []);
		groups.get(g)!.push(r);
	}
	const out: ReturTracking[] = [];
	for (const [key, items] of groups) {
		const first = items[0];
		const h = first.retur_gudang_id ? hdr(first.retur_gudang_id) : null;
		const allChecked = items.every((i) => i.return_status === 'return_checked');
		const cancelled = h?.status === 'batal';
		const stepKey = stepFor(h, allChecked);
		const date = h?.shipped_at || items.map((i) => i.date_created).filter(Boolean).sort()[0] || null;
		const t = date ? new Date(date).getTime() : NaN;
		out.push({
			key,
			docNo: h?.nomor_retur || `Pengajuan #${first.id}`,
			stepIndex: RETUR_STEPS.findIndex((s) => s.key === stepKey),
			stepKey,
			rejected: h?.status === 'ditolak',
			cancelled,
			rejectionReason: h?.rejection_reason ?? null,
			itemCount: items.length,
			itemsPreview: items.slice(0, 3).map((i) => `${i.material_name ?? '-'} (${Number(i.qty_returned ?? 0)} ${i.unit ?? ''})`.trim()),
			date,
			ageDays: Number.isFinite(t) && Number.isFinite(nowT) ? Math.max(0, Math.floor((nowT - t) / MS_DAY)) : null,
			done: allChecked,
			docId: h?.id ?? null,
			docStatus: h?.status ?? null,
			jadwal: h?.tanggal_pengambilan ?? null,
			driverName: h?.driver_name ?? null,
			driverPhone: h?.driver_phone ?? null,
			vehiclePlate: h?.vehicle_plate ?? null,
			shippedAt: h?.shipped_at ?? null
		});
	}
	// Yang butuh perhatian dulu (ditolak), lalu belum selesai (terlama dulu), selesai paling akhir.
	return out.sort((a, b) => {
		const rank = (x: ReturTracking) => (x.rejected ? 0 : x.done || x.cancelled ? 2 : 1);
		return rank(a) - rank(b) || (b.ageDays ?? -1) - (a.ageDays ?? -1);
	});
}
