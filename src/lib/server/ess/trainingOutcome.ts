// src/lib/server/ess/trainingOutcome.ts
// Outcome/Ekspektasi, capaian & review training di ESS (rencana training_outcome_review, Fase 4).
// Koleksi dibuat di erp-epi Fase 1. Tiap koleksi di-fetch TERPISAH (tanpa relasi bersarang). Otorisasi review tim dihitung di server
// (resolveTeamMembers) — id dari klien tidak dipercaya. Visibilitas ke peserta diatur training_settings (outcome_tampil_ke_peserta,
// kekurangan_tampil_ke_peserta), bukan hardcode.
import { directusServerJson } from '$lib/server/directus';
import { loadMentorConfig, resolveTeamMembers } from '$lib/server/ess/teamTraining';

const enc = encodeURIComponent;
const jf = (o: unknown) => enc(JSON.stringify(o));

export const SEVERITY = ['rendah', 'sedang', 'tinggi'] as const;
export const TINDAK_LANJUT = ['none', 'remedial', 'ulang', 'coaching'] as const;

export class OutcomeError extends Error {
	constructor(message: string, public status: number) { super(message); }
}

export interface OutcomeVisibility { outcome: boolean; kekurangan: boolean }
let visCache: { at: number; value: OutcomeVisibility } | null = null;
export function _resetOutcomeCacheForTest() { visCache = null; }

export async function loadOutcomeVisibility(): Promise<OutcomeVisibility> {
	if (visCache && Date.now() - visCache.at < 60_000) return visCache.value;
	let value: OutcomeVisibility = { outcome: true, kekurangan: false };
	try {
		const r = await directusServerJson<{ data: any }>('/items/training_settings?fields=outcome_tampil_ke_peserta,kekurangan_tampil_ke_peserta');
		const d = r?.data;
		value = { outcome: d?.outcome_tampil_ke_peserta !== false, kekurangan: d?.kekurangan_tampil_ke_peserta === true };
	} catch (e) {
		console.error('[ess/trainingOutcome] gagal baca training_settings, pakai default aman:', (e as Error)?.message);
	}
	visCache = { at: Date.now(), value };
	return value;
}

/** Persen capaian ekspektasi (salinan setia erp-epi/trainingOutcomeApi.hitungCapaian): tercapai=1, sebagian=0.5, belum=0, tertimbang. */
export function hitungCapaian(outcomes: any[], capaian: any[]): { persen: number; wajibBelum: number } {
	const by = new Map((capaian || []).map((c) => [c.outcome_id, c]));
	let total = 0, dapat = 0, wajibBelum = 0;
	for (const o of outcomes || []) {
		if (o.tipe !== 'ekspektasi') continue;
		const bobot = Number(o.bobot) > 0 ? Number(o.bobot) : 1;
		const st = by.get(o.id)?.status ?? 'belum';
		total += bobot;
		dapat += bobot * (st === 'tercapai' ? 1 : st === 'sebagian' ? 0.5 : 0);
		if (o.wajib_tercapai && st !== 'tercapai') wajibBelum++;
	}
	return { persen: total > 0 ? Math.round((dapat / total) * 100) : 0, wajibBelum };
}

export interface MyOutcomeView {
	visible: boolean;
	outcomes: { id: number; tipe: string; deskripsi: string; indikator: string | null; wajib: boolean; status?: string | null }[];
	persen: number | null;
	review: null | { peran: string; kekuatan: string | null; rekomendasi: string | null; tindakLanjut: string; kekurangan?: string | null; gaps?: { kategori: string; severity: string; deskripsi: string }[] };
}

/** Tampilan peserta untuk satu program: "Setelah training ini kamu bisa…" + "Hasil & Catatan Saya" (hanya review FINAL). */
export async function getMyOutcomeView(karyawanId: number, programId: number, enrollmentId: number | null): Promise<MyOutcomeView> {
	const vis = await loadOutcomeVisibility();
	if (!vis.outcome) return { visible: false, outcomes: [], persen: null, review: null };
	const outcomes = (await directusServerJson<{ data: any[] }>(
		`/items/training_program_outcome?filter=${jf({ program_id: { _eq: programId } })}&fields=id,tipe,deskripsi,indikator,bobot,wajib_tercapai,urutan&sort=tipe,urutan&limit=-1`
	))?.data || [];
	if (!outcomes.length) return { visible: true, outcomes: [], persen: null, review: null };

	let capaian: any[] = [];
	let review: MyOutcomeView['review'] = null;
	if (enrollmentId) {
		capaian = (await directusServerJson<{ data: any[] }>(
			`/items/training_enrollment_outcome?filter=${jf({ enrollment_id: { _eq: enrollmentId } })}&fields=id,outcome_id,status&limit=-1`
		))?.data || [];
		const revs = (await directusServerJson<{ data: any[] }>(
			`/items/training_review?filter=${jf({ _and: [{ enrollment_id: { _eq: enrollmentId } }, { status: { _eq: 'final' } }] })}&fields=id,peran_reviewer,kekuatan,kekurangan,rekomendasi,tindak_lanjut&sort=-tanggal&limit=1`
		))?.data || [];
		const r = revs[0];
		if (r) {
			review = { peran: r.peran_reviewer, kekuatan: r.kekuatan ?? null, rekomendasi: r.rekomendasi ?? null, tindakLanjut: r.tindak_lanjut || 'none' };
			if (vis.kekurangan) {
				review.kekurangan = r.kekurangan ?? null;
				const gaps = (await directusServerJson<{ data: any[] }>(`/items/training_review_gap?filter=${jf({ review_id: { _eq: r.id } })}&fields=kategori_id,severity,deskripsi&limit=-1`))?.data || [];
				const kat = (await directusServerJson<{ data: any[] }>(`/items/training_gap_kategori?fields=id,nama&limit=-1`))?.data || [];
				const nm = new Map(kat.map((k) => [k.id, k.nama]));
				review.gaps = gaps.map((g) => ({ kategori: nm.get(g.kategori_id) || 'Lainnya', severity: g.severity, deskripsi: g.deskripsi }));
			}
		}
	}
	const st = new Map(capaian.map((c) => [c.outcome_id, c.status]));
	const { persen } = hitungCapaian(outcomes, capaian);
	return {
		visible: true,
		persen: enrollmentId && capaian.length ? persen : null,
		review,
		outcomes: outcomes.map((o) => ({ id: o.id, tipe: o.tipe, deskripsi: o.deskripsi, indikator: o.indikator ?? null, wajib: !!o.wajib_tercapai, status: o.tipe === 'ekspektasi' ? st.get(o.id) ?? null : undefined }))
	};
}

// ── Review atasan/mentor ─────────────────────────────────────────────────────
export interface ReviewInput {
	memberId: number;
	enrollmentId: number;
	kekuatan?: string;
	kekurangan?: string;
	rekomendasi?: string;
	tindakLanjut?: string;
	status?: string;
	gaps?: { kategori_id?: number | null; severity?: string; deskripsi?: string }[];
}

/** Murni: normalisasi input review tim (batas panjang, enum, maksimum 5 gap). Melempar OutcomeError bila final tapi kosong. */
export function normalisasiReviewTim(i: ReviewInput) {
	const txt = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max) || null;
	const status = i.status === 'final' ? 'final' : 'draft';
	const kekuatan = txt(i.kekuatan, 1500), kekurangan = txt(i.kekurangan, 1500), rekomendasi = txt(i.rekomendasi, 1500);
	if (status === 'final' && !kekuatan && !kekurangan && !rekomendasi) throw new OutcomeError('Review final wajib berisi kekuatan, kekurangan, atau saran.', 400);
	const gaps = (Array.isArray(i.gaps) ? i.gaps : []).flatMap((g) => {
		const deskripsi = txt(g?.deskripsi, 500);
		if (!deskripsi) return [];
		const kid = Number(g?.kategori_id);
		return [{ kategori_id: kid > 0 ? kid : null, deskripsi, severity: (SEVERITY as readonly string[]).includes(String(g?.severity)) ? String(g.severity) : 'sedang' }];
	}).slice(0, 5);
	const tindak = (TINDAK_LANJUT as readonly string[]).includes(String(i.tindakLanjut)) ? String(i.tindakLanjut) : 'none';
	return { status, kekuatan, kekurangan, rekomendasi, gaps, tindak_lanjut: tindak };
}

/** Enrollment bawahan yang bisa direview + review milik atasan ini (bila ada) + master kategori. */
export async function listReviewable(manager: { id: number }, memberId: number) {
	const c = await loadMentorConfig();
	if (c.mode === 'off') throw new OutcomeError('Fitur tim sedang dinonaktifkan.', 403);
	const member = (await resolveTeamMembers(manager.id, c)).find((m) => Number(m.id) === Number(memberId));
	if (!member) throw new OutcomeError('Karyawan ini bukan bawahan Anda.', 403);

	const enr = (await directusServerJson<{ data: any[] }>(
		`/items/training_enrollment?filter=${jf({ karyawan_id: { _eq: memberId } })}&fields=id,program_id,status,nilai_akhir&sort=-id&limit=30`
	))?.data || [];
	const pids = [...new Set(enr.map((e) => (e.program_id && typeof e.program_id === 'object' ? e.program_id.id : e.program_id)).filter(Boolean))];
	const progs = pids.length ? (await directusServerJson<{ data: any[] }>(`/items/training_program?filter=${jf({ id: { _in: pids } })}&fields=id,judul&limit=-1`))?.data || [] : [];
	const judul = new Map(progs.map((p) => [p.id, p.judul]));
	const eids = enr.map((e) => e.id);
	const revs = eids.length ? (await directusServerJson<{ data: any[] }>(
		`/items/training_review?filter=${jf({ _and: [{ enrollment_id: { _in: eids } }, { reviewer_id: { _eq: manager.id } }] })}&fields=id,enrollment_id,kekuatan,kekurangan,rekomendasi,tindak_lanjut,status&limit=-1`
	))?.data || [] : [];
	const rids = revs.map((r) => r.id);
	const gaps = rids.length ? (await directusServerJson<{ data: any[] }>(`/items/training_review_gap?filter=${jf({ review_id: { _in: rids } })}&fields=review_id,kategori_id,severity,deskripsi&limit=-1`))?.data || [] : [];
	const kategori = (await directusServerJson<{ data: any[] }>(`/items/training_gap_kategori?filter=${jf({ aktif: { _eq: true } })}&fields=id,nama&sort=urutan&limit=-1`))?.data || [];

	return {
		member: { id: member.id, nama: member.nama_karyawan },
		kategori,
		enrollments: enr.map((e) => {
			const pid = e.program_id && typeof e.program_id === 'object' ? e.program_id.id : e.program_id;
			const r = revs.find((x) => x.enrollment_id === e.id);
			return {
				enrollmentId: e.id, programJudul: judul.get(pid) || `Program #${pid}`, status: e.status, nilaiAkhir: e.nilai_akhir ?? null,
				review: r ? { id: r.id, kekuatan: r.kekuatan, kekurangan: r.kekurangan, rekomendasi: r.rekomendasi, tindakLanjut: r.tindak_lanjut, status: r.status, gaps: gaps.filter((g) => g.review_id === r.id) } : null
			};
		})
	};
}

/** Simpan review atasan/mentor (upsert 1 review per enrollment per reviewer). Peran: 'mentor' bila manager = mentor_id member, selain itu 'atasan'. */
export async function submitTeamReview(manager: { id: number }, input: ReviewInput): Promise<{ reviewId: number; status: string }> {
	const c = await loadMentorConfig();
	if (c.mode === 'off') throw new OutcomeError('Fitur tim sedang dinonaktifkan.', 403);
	const member = (await resolveTeamMembers(manager.id, c)).find((m) => Number(m.id) === Number(input.memberId));
	if (!member) throw new OutcomeError('Karyawan ini bukan bawahan Anda.', 403);
	const enr = (await directusServerJson<{ data: any }>(`/items/training_enrollment/${Number(input.enrollmentId)}?fields=id,karyawan_id`).catch(() => null))?.data;
	const ownerId = enr && (typeof enr.karyawan_id === 'object' ? enr.karyawan_id?.id : enr.karyawan_id);
	if (!enr || Number(ownerId) !== Number(input.memberId)) throw new OutcomeError('Enrollment bukan milik bawahan ini.', 403);

	const n = normalisasiReviewTim(input);
	const peran = Number(member.mentor_id) === Number(manager.id) ? 'mentor' : 'atasan';
	const body = { peran_reviewer: peran, kekuatan: n.kekuatan, kekurangan: n.kekurangan, rekomendasi: n.rekomendasi, tindak_lanjut: n.tindak_lanjut, status: n.status, tanggal: new Date().toISOString() };

	const existing = (await directusServerJson<{ data: any[] }>(
		`/items/training_review?filter=${jf({ _and: [{ enrollment_id: { _eq: enr.id } }, { reviewer_id: { _eq: manager.id } }] })}&fields=id,status&limit=1`
	))?.data?.[0];
	if (existing?.status === 'final') throw new OutcomeError('Review ini sudah final dan tidak bisa diubah. Hubungi HRD bila perlu koreksi.', 409);

	let id = existing?.id;
	if (id) await directusServerJson(`/items/training_review/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
	else id = (await directusServerJson<{ data: { id: number } }>('/items/training_review', { method: 'POST', body: JSON.stringify({ enrollment_id: enr.id, reviewer_id: manager.id, ...body }) }))?.data?.id;
	if (!id) throw new OutcomeError('Gagal menyimpan review.', 500);

	const lama = (await directusServerJson<{ data: { id: number }[] }>(`/items/training_review_gap?filter=${jf({ review_id: { _eq: id } })}&fields=id&limit=-1`))?.data || [];
	if (lama.length) await directusServerJson('/items/training_review_gap', { method: 'DELETE', body: JSON.stringify(lama.map((g) => g.id)) });
	if (n.gaps.length) await directusServerJson('/items/training_review_gap', { method: 'POST', body: JSON.stringify(n.gaps.map((g) => ({ review_id: id, ...g }))) });
	return { reviewId: id, status: n.status };
}
