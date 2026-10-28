// src/lib/utils/laporanAbsensi.ts
// WSK-13 §4a — logika murni untuk langkah Kehadiran + Alokasi di form Laporan Harian HP.
// Kosakata status SAMA dengan form admin (erp-epi): 'hadir' | 'ijin' | 'sakit' | 'absen' (alpha). Konversi ke
// manpower_absensi pusat dilakukan di sisi API (bukan di sini).

export interface MaterialRow { kategori: string; nama_material: string; qty: number; satuan: string; keterangan: string }

export type StatusHadir = 'hadir' | 'ijin' | 'sakit' | 'absen';

export const STATUS_OPTIONS: Array<{ value: StatusHadir; label: string; short: string }> = [
	{ value: 'hadir', label: 'Hadir', short: 'H' },
	{ value: 'ijin', label: 'Izin', short: 'I' },
	{ value: 'sakit', label: 'Sakit', short: 'S' },
	{ value: 'absen', label: 'Alpha', short: 'A' }
];

/** Alokasi satu orang: tidak dialokasikan | bagi rata ke semua PO yang dilaporkan | satu PO (id). */
export type Alokasi = 'none' | 'split' | number;

export interface RosterPerson {
	tipe: 'leader' | 'manpower';
	/** id baris roster (workshop_project_leader / workshop_manpower) */
	rosterId: number;
	nama: string;
	jabatan: string;
}

export interface AttendanceRow extends RosterPerson {
	status_hadir: StatusHadir;
	keterangan: string;
	alokasi: Alokasi;
}

export interface PoSplit { po_id: number; persentase: number }

export function rosterToRows(roster: RosterPerson[]): AttendanceRow[] {
	return roster.map((p) => ({ ...p, status_hadir: 'hadir' as StatusHadir, keterangan: '', alokasi: 'none' as Alokasi }));
}

export const countHadir = (rows: AttendanceRow[]) => rows.filter((r) => r.status_hadir === 'hadir').length;

export function attendanceStats(rows: AttendanceRow[]) {
	const s = { total: rows.length, hadir: 0, ijin: 0, sakit: 0, absen: 0 };
	for (const r of rows) s[r.status_hadir] += 1;
	return s;
}

/** Pembagian persentase satu orang ke PO. Hanya yang HADIR yang punya alokasi; 'split' = bagi rata (sisa pembulatan di PO terakhir → total tepat 100). */
export function buildPoSplit(row: Pick<AttendanceRow, 'status_hadir' | 'alokasi'>, reportedPoIds: number[]): PoSplit[] {
	if (row.status_hadir !== 'hadir' || row.alokasi === 'none') return [];
	const ids = [...new Set(reportedPoIds)];
	if (row.alokasi === 'split') {
		if (ids.length === 0) return [];
		const each = Math.floor((10000 / ids.length)) / 100; // 2 desimal
		const out = ids.map((po_id) => ({ po_id, persentase: each }));
		const sisa = Math.round((100 - each * ids.length) * 100) / 100;
		out[out.length - 1].persentase = Math.round((out[out.length - 1].persentase + sisa) * 100) / 100;
		return out;
	}
	return ids.includes(row.alokasi) ? [{ po_id: row.alokasi, persentase: 100 }] : [];
}

/** Jumlah orang per PO (untuk kolom jumlah_manpower di rincian PO) = Σ persentase / 100, dibulatkan ke bilangan bulat terdekat. */
export function derivePoManpower(rows: AttendanceRow[], reportedPoIds: number[]): Record<number, number> {
	const sum: Record<number, number> = {};
	for (const id of reportedPoIds) sum[id] = 0;
	for (const r of rows) for (const s of buildPoSplit(r, reportedPoIds)) sum[s.po_id] = (sum[s.po_id] || 0) + s.persentase / 100;
	return Object.fromEntries(Object.entries(sum).map(([k, v]) => [Number(k), Math.round(v)]));
}

/** Orang HADIR yang belum dialokasikan ke PO mana pun (peringatan lunak, tidak memblokir — di lapangan orang sering pindah PO). */
export function unallocatedHadir(rows: AttendanceRow[]): AttendanceRow[] {
	return rows.filter((r) => r.status_hadir === 'hadir' && r.alokasi === 'none');
}

/** Bentuk yang dikirim ke API simpan (tanpa field UI). */
export function toSubmitRows(rows: AttendanceRow[], reportedPoIds: number[]) {
	return rows.map((r) => ({
		tipe: r.tipe,
		nama: r.nama,
		jabatan: r.jabatan,
		status_hadir: r.status_hadir,
		keterangan: r.status_hadir === 'hadir' ? '' : r.keterangan.trim(),
		// pola form admin: absensi.manpower_id = id baris roster workshop_manpower (jembatan ke manpower pusat dibaca dari sana)
		manpower_id: r.tipe === 'manpower' ? r.rosterId : null,
		po_split: buildPoSplit(r, reportedPoIds)
	}));
}
