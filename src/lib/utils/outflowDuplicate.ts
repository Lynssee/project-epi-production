// PRJ-29 — cek duplikat sebelum Aktualisasi MANUAL: biaya dengan nominal sama dan tanggal berdekatan yang sudah tercatat
// lewat kanal lain (Pengajuan Anggaran / Beli Lokal / posting biaya proyek) kemungkinan sama => risiko tercatat dua kali.
// Fungsi MURNI; pengambilan kandidat ada di projectAktualisasiApi.findPossibleDuplicateOutflows.
export interface OutflowCandidate {
	id: number | string;
	source: 'pengajuan_anggaran' | 'project_expenses';
	date: string | null; // ISO / yyyy-mm-dd
	amount: number;
	label: string;
}

const DAY = 864e5;

export function matchDuplicateOutflows(candidates: OutflowCandidate[], amount: number, dateStr: string, windowDays = 7): OutflowCandidate[] {
	const target = new Date(dateStr).getTime();
	if (!(amount > 0) || Number.isNaN(target)) return [];
	return (candidates || []).filter((c) => {
		if (Math.abs((Number(c.amount) || 0) - amount) >= 1) return false;
		const t = c.date ? new Date(c.date).getTime() : NaN;
		return !Number.isNaN(t) && Math.abs(t - target) <= windowDays * DAY;
	});
}
