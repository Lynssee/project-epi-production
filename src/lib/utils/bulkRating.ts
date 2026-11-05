// Penilaian Pekerja massal (KPI & Kinerja Terpusat, Fase 3) — logika murni, tanpa I/O.
// Dipakai /manpower/rating: PL/Koordinator Workshop menilai SEMUA pekerja di proyek/workshopnya sekaligus.

export interface RatingDraft {
	manpowerId: number;
	nama: string;
	jabatan: string;
	kualitas: number;
	safety: number;
	ketepatan: number;
}

export interface RatingPayload {
	manpower_id: number;
	project_id: number | null;
	/** Terisi untuk penilaian pekerja workshop (project_id null). */
	workshop_id: number | null;
	tanggal: string;
	kualitas: number;
	safety: number;
	ketepatan: number;
	catatan: string;
	dinilai_oleh: string;
}

const valid = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5;

/** Lengkap = ketiga bintang terisi 1..5. Baris setengah terisi TIDAK dikirim (bukan dianggap 0). */
export function isDraftComplete(d: Pick<RatingDraft, 'kualitas' | 'safety' | 'ketepatan'>): boolean {
	return valid(d.kualitas) && valid(d.safety) && valid(d.ketepatan);
}

/** Baris yang sudah disentuh tapi belum lengkap — untuk peringatan sebelum kirim. */
export function isDraftPartial(d: Pick<RatingDraft, 'kualitas' | 'safety' | 'ketepatan'>): boolean {
	const any = [d.kualitas, d.safety, d.ketepatan].some((v) => v > 0);
	return any && !isDraftComplete(d);
}

export function todayISO(now = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Susun payload `worker_performance_rating`. Penilaian workshop tidak punya proyek (project_id null) dan memakai kolom
 * `workshop_id` (FK workshops, ditambahkan 2 Nov 2026 — dulu hanya awalan teks di catatan).
 */
export function buildRatingPayloads(opts: {
	drafts: RatingDraft[];
	projectId: number | null;
	workshopId?: number | null;
	catatan?: string;
	dinilaiOleh: string;
	skipManpowerIds?: Set<number>;
	tanggal?: string;
}): RatingPayload[] {
	const tanggal = opts.tanggal ?? todayISO();
	const catatan = (opts.catatan || '').trim();
	const workshopId = opts.projectId == null && opts.workshopId != null ? Number(opts.workshopId) : null;
	return (opts.drafts || [])
		.filter((d) => isDraftComplete(d) && !opts.skipManpowerIds?.has(d.manpowerId))
		.map((d) => ({
			manpower_id: d.manpowerId,
			project_id: opts.projectId,
			workshop_id: workshopId,
			tanggal,
			kualitas: d.kualitas,
			safety: d.safety,
			ketepatan: d.ketepatan,
			catatan,
			dinilai_oleh: opts.dinilaiOleh || ''
		}));
}

export interface PastRating { manpower_id: number | { id: number } | null; tanggal: string | null; project_id: number | { id: number } | null; workshop_id?: number | { id: number } | null }

const idOf = (v: any): number | null => (v && typeof v === 'object' ? (v.id ?? null) : (v ?? null));

/**
 * Pekerja yang SUDAH dinilai hari ini di konteks yang sama: proyek yang sama, atau workshop yang sama (project_id kosong).
 * Dikunci supaya sentuhan ganda/submit ulang tidak melipatgandakan rating satu hari.
 */
export function ratedTodaySet(past: PastRating[], projectId: number | null, today = todayISO(), workshopId: number | null = null): Set<number> {
	const out = new Set<number>();
	for (const r of past || []) {
		const mid = idOf(r.manpower_id);
		if (mid == null || String(r.tanggal || '').slice(0, 10) !== today) continue;
		if ((idOf(r.project_id) ?? null) !== (projectId ?? null)) continue;
		if (projectId == null && (idOf(r.workshop_id) ?? null) !== (workshopId ?? null)) continue;
		out.add(Number(mid));
	}
	return out;
}

/** Tanggal penilaian terakhir per pekerja (apa pun konteksnya) — info "terakhir dinilai". */
export function lastRatedMap(past: PastRating[]): Map<number, string> {
	const m = new Map<number, string>();
	for (const r of past || []) {
		const mid = idOf(r.manpower_id);
		const t = String(r.tanggal || '').slice(0, 10);
		if (mid == null || !t) continue;
		if (!m.has(Number(mid)) || t > (m.get(Number(mid)) as string)) m.set(Number(mid), t);
	}
	return m;
}

/** Cocokkan nama workshop di setelan cakupan ('ciketing') ke baris `workshops` ('Workshop Ciketing', 'WS-CKT'). */
export function matchWorkshop<T extends { name?: string | null; code?: string | null }>(scopeName: string, workshops: T[]): T | null {
	const key = String(scopeName || '').trim().toLowerCase();
	if (!key) return null;
	return (workshops || []).find((w) => String(w.name || '').toLowerCase().includes(key) || String(w.code || '').toLowerCase() === key) ?? null;
}
