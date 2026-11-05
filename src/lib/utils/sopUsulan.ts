// src/lib/utils/sopUsulan.ts
// Logika MURNI "Usulan Perbaikan SOP dari lapangan" (Fase 4c Lifecycle Kebijakan→SOP) — tanpa I/O.
// Usulan masuk antrean proposed_sop (source = 'lapangan') yang sama dengan usulan AI, ditinjau di ERP (HRD › Usulan).

export const JENIS_USULAN = [
	{ value: 'tidak_sesuai', label: 'Langkah tidak sesuai kenyataan di lapangan' },
	{ value: 'kurang_jelas', label: 'Kurang jelas / membingungkan' },
	{ value: 'kurang_langkah', label: 'Ada langkah atau perlengkapan yang belum dimuat' },
	{ value: 'lainnya', label: 'Lainnya' }
] as const;

export type JenisUsulan = (typeof JENIS_USULAN)[number]['value'];

export const CATATAN_MIN = 20;
export const CATATAN_MAX = 2000;
/** Batas usulan per karyawan per 24 jam (anti-spam; usulan serius tetap tersalurkan). */
export const MAX_PER_DAY = 3;

export interface UsulanInput {
	jenis?: unknown;
	catatan?: unknown;
}

export function validateUsulan(input: UsulanInput | null | undefined): {
	ok: boolean;
	errors: { jenis?: string; catatan?: string };
	jenis: JenisUsulan;
	catatan: string;
} {
	const errors: { jenis?: string; catatan?: string } = {};
	const jenis = String(input?.jenis ?? '');
	const found = JENIS_USULAN.find((j) => j.value === jenis);
	if (!found) errors.jenis = 'Pilih jenis masalah.';
	const catatan = String(input?.catatan ?? '').trim();
	if (catatan.length < CATATAN_MIN) errors.catatan = `Jelaskan minimal ${CATATAN_MIN} karakter agar bisa ditindaklanjuti.`;
	else if (catatan.length > CATATAN_MAX) errors.catatan = `Maksimal ${CATATAN_MAX} karakter.`;
	return { ok: Object.keys(errors).length === 0, errors, jenis: (found?.value ?? 'lainnya') as JenisUsulan, catatan };
}

interface SopLike {
	id: number;
	title: string;
	sop_code?: string | null;
	department?: string | null;
	version?: string | null;
	version_seq?: number | null;
}

interface KaryawanLike {
	id: number;
	nama_karyawan?: string | null;
	divisi?: string | null;
}

/** Rekaman proposed_sop (kolom skema live). Tidak ada `content`: tinjauan manusia yang menentukan revisi. */
export function buildProposalRecord(p: { sop: SopLike; karyawan: KaryawanLike; jenis: JenisUsulan; catatan: string }) {
	const { sop, karyawan, jenis, catatan } = p;
	const label = JENIS_USULAN.find((j) => j.value === jenis)?.label ?? jenis;
	const code = sop.sop_code ? `[${sop.sop_code}] ` : '';
	const nama = karyawan.nama_karyawan || `karyawan #${karyawan.id}`;
	return {
		title: `Usulan perbaikan: ${code}${sop.title}`.slice(0, 250),
		justifikasi_masalah: [
			`Jenis masalah: ${label}`,
			'',
			catatan,
			'',
			`Diusulkan oleh ${nama}${karyawan.divisi ? ` (${karyawan.divisi})` : ''} dari aplikasi lapangan — atas SOP #${sop.id} versi ${sop.version || '-'}.`
		].join('\n'),
		data_snapshot: {
			sop_id: sop.id,
			sop_version: sop.version ?? null,
			sop_version_seq: sop.version_seq ?? null,
			karyawan_id: karyawan.id,
			jenis
		},
		target_departments: sop.department ? [sop.department] : [],
		severity: 'medium',
		incident_count: 1,
		status: 'draft',
		source: 'lapangan'
	};
}

export interface RecentProposalRow {
	id?: number;
	status?: string | null;
	date_created?: string | null;
	data_snapshot?: unknown;
}

function snapshotOf(row: RecentProposalRow): { karyawan_id?: number; sop_id?: number } {
	let s = row?.data_snapshot as unknown;
	if (typeof s === 'string') {
		try {
			s = JSON.parse(s);
		} catch {
			return {};
		}
	}
	return s && typeof s === 'object' && !Array.isArray(s) ? (s as any) : {};
}

/** Batas pengiriman: satu usulan terbuka per SOP per orang, dan maks MAX_PER_DAY per 24 jam. */
export function checkLimits(
	recent: RecentProposalRow[],
	karyawanId: number,
	sopId: number,
	nowMs: number
): { ok: boolean; reason: string | null } {
	const mine = (Array.isArray(recent) ? recent : []).filter((r) => snapshotOf(r).karyawan_id === karyawanId);
	if (mine.some((r) => r.status === 'draft' && snapshotOf(r).sop_id === sopId)) {
		return { ok: false, reason: 'Usulan Anda sebelumnya untuk SOP ini masih ditinjau. Tunggu hasilnya dulu.' };
	}
	const since = nowMs - 24 * 3600_000;
	const today = mine.filter((r) => {
		const t = Date.parse(String(r.date_created ?? ''));
		return Number.isFinite(t) && t >= since;
	});
	if (today.length >= MAX_PER_DAY) {
		return { ok: false, reason: `Batas ${MAX_PER_DAY} usulan per hari tercapai. Coba lagi besok.` };
	}
	return { ok: true, reason: null };
}
