// Rekap bulanan tim outsource untuk PL / Koordinator Workshop (Laporan Periodik Outsource, Fase 4) — logika murni, tanpa I/O.
// Kehadiran: status hadir | setengah_hari | Stand-by dihitung hadir (sama dengan Worker Scorecard ERP). Rating skala 1-5.

const HADIR = new Set(['hadir', 'setengah_hari', 'Stand-by']);

export interface RekapAbsensiRow { manpower_id: number; status: string }
export interface RekapRatingRow { manpower_id: number; kualitas: number; safety: number; ketepatan: number }
export interface RekapPekerja { manpowerId: number; nama: string; jabatan: string }

export interface RekapBaris extends RekapPekerja {
	hadir: number;
	totalAbsensi: number;
	hadirPct: number | null;
	jumlahNilai: number;
	/** Rata-rata bintang 1-5 (1 desimal); null bila belum dinilai bulan ini (BUKAN 0). */
	rataNilai: number | null;
	belumDinilai: boolean;
	/** Alasan singkat perlu perhatian (kosong bila aman). */
	perhatian: string[];
}

export interface RekapRingkas {
	totalPekerja: number;
	belumDinilai: number;
	hadirPctRata: number | null;
	rataNilai: number | null;
	perluPerhatian: number;
}

export interface RekapOpsi {
	/** Hadir% di bawah ini = perhatian (bawaan 70). */
	hadirMinPct?: number;
	/** Rata-rata bintang di bawah ini = perhatian (bawaan 3). */
	nilaiMin?: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildRekapTim(
	roster: RekapPekerja[],
	absensi: RekapAbsensiRow[],
	ratings: RekapRatingRow[],
	opsi: RekapOpsi = {}
): { baris: RekapBaris[]; ringkas: RekapRingkas } {
	const hadirMin = opsi.hadirMinPct ?? 70;
	const nilaiMin = opsi.nilaiMin ?? 3;
	const abs = new Map<number, { hadir: number; total: number }>();
	for (const a of absensi) {
		const id = Number(a.manpower_id);
		if (!Number.isFinite(id)) continue;
		const b = abs.get(id) || { hadir: 0, total: 0 };
		b.total += 1;
		if (HADIR.has(a.status)) b.hadir += 1;
		abs.set(id, b);
	}
	const rat = new Map<number, { sum: number; n: number }>();
	for (const r of ratings) {
		const id = Number(r.manpower_id);
		const vals = [r.kualitas, r.safety, r.ketepatan].map(Number).filter((v) => Number.isFinite(v) && v >= 1 && v <= 5);
		if (!Number.isFinite(id) || !vals.length) continue;
		const b = rat.get(id) || { sum: 0, n: 0 };
		b.sum += vals.reduce((s, v) => s + v, 0) / vals.length;
		b.n += 1;
		rat.set(id, b);
	}
	const baris: RekapBaris[] = roster.map((p) => {
		const a = abs.get(p.manpowerId);
		const t = rat.get(p.manpowerId);
		const hadirPct = a && a.total > 0 ? Math.round((a.hadir / a.total) * 100) : null;
		const rataNilai = t && t.n > 0 ? r1(t.sum / t.n) : null;
		const perhatian: string[] = [];
		if (!t) perhatian.push('Belum dinilai bulan ini');
		else if (rataNilai != null && rataNilai < nilaiMin) perhatian.push(`Nilai rendah (${rataNilai}★)`);
		if (hadirPct != null && hadirPct < hadirMin) perhatian.push(`Kehadiran ${hadirPct}%`);
		return {
			...p,
			hadir: a?.hadir ?? 0,
			totalAbsensi: a?.total ?? 0,
			hadirPct,
			jumlahNilai: t?.n ?? 0,
			rataNilai,
			belumDinilai: !t,
			perhatian
		};
	});
	const dinilai = baris.filter((b) => b.rataNilai != null);
	const denganHadir = baris.filter((b) => b.hadirPct != null);
	return {
		// Yang perlu perhatian di atas, lalu urut nama.
		baris: [...baris].sort((x, y) => y.perhatian.length - x.perhatian.length || x.nama.localeCompare(y.nama)),
		ringkas: {
			totalPekerja: baris.length,
			belumDinilai: baris.filter((b) => b.belumDinilai).length,
			hadirPctRata: denganHadir.length ? Math.round(denganHadir.reduce((s, b) => s + (b.hadirPct as number), 0) / denganHadir.length) : null,
			rataNilai: dinilai.length ? r1(dinilai.reduce((s, b) => s + (b.rataNilai as number), 0) / dinilai.length) : null,
			perluPerhatian: baris.filter((b) => b.perhatian.length > 0).length
		}
	};
}

/** Rentang bulan kalender 'YYYY-MM' -> {from,to} (YYYY-MM-DD); null bila format salah. */
export function monthRange(ym: string): { from: string; to: string } | null {
	const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym || '');
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
	return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}
