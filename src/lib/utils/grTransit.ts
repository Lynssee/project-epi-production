// src/lib/utils/grTransit.ts
// Visibilitas Leader Fase 6 — info perjalanan barang menuju site (truk, sopir, ETA). MURNI, tanpa I/O, TANPA nominal.
// Sumber: surat_jalan.vehicle_id -> fleet_kendaraan.nomor_polisi, surat_jalan.driver, surat_jalan.eta_tiba (hanya terisi untuk
// ekspedisi), surat_jalan.mode_kirim. TIDAK ada lokasi GPS real-time di sistem, jadi ini BUKAN pelacakan posisi — hanya "siapa & kapan".

export interface TransitSource {
	driver?: string | null;
	plat?: string | null;
	modeKirim?: string | null;
	etaTiba?: string | null;
	noResi?: string | null;
}

export interface TransitInfo {
	/** Potongan teks siap tampil, urut: armada/ekspedisi, plat, sopir, ETA. Kosong bila tak ada informasi sama sekali. */
	parts: string[];
	text: string;
	/** ETA sudah lewat dan barang belum dikonfirmasi diterima. */
	etaOverdue: boolean;
}

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function fmtYmd(ymd: string): string | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
	if (!m) return null;
	const mon = Number(m[2]);
	if (mon < 1 || mon > 12) return null;
	return `${Number(m[3])} ${BULAN[mon - 1]}`;
}

/** @param todayYmd tanggal hari ini (YYYY-MM-DD, WIB) — dipakai menentukan ETA lewat. */
export function describeTransit(s: TransitSource | null | undefined, todayYmd?: string): TransitInfo {
	const parts: string[] = [];
	const mode = String(s?.modeKirim ?? '').toLowerCase();
	const ekspedisi = mode.includes('ekspedisi');
	if (ekspedisi) parts.push(s?.noResi ? `Ekspedisi (resi ${s.noResi})` : 'Ekspedisi');
	else if (mode === 'driver_internal') parts.push('Armada EPI');

	const plat = String(s?.plat ?? '').trim();
	if (plat) parts.push(plat);
	const driver = String(s?.driver ?? '').trim();
	if (driver) parts.push(`Sopir ${driver}`);

	let etaOverdue = false;
	const eta = s?.etaTiba ? fmtYmd(s.etaTiba) : null;
	if (eta) {
		etaOverdue = !!todayYmd && /^\d{4}-\d{2}-\d{2}$/.test(todayYmd) && String(s?.etaTiba).slice(0, 10) < todayYmd;
		parts.push(etaOverdue ? `ETA ${eta} (sudah lewat)` : `ETA ${eta}`);
	}
	return { parts, text: parts.join(' · '), etaOverdue };
}
