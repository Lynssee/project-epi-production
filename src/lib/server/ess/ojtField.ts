// src/lib/server/ess/ojtField.ts
// Penilaian OJT oleh ATASAN/MENTOR dari lapangan. Menulis ke koleksi training_review yang SAMA dengan form admin (erp-epi,
// HrdTrainingOjtChecklist): skor_dimensi = { tipe:'ojt', items }. Otorisasi: peserta HARUS bawahan penilai (resolveTeamMembers),
// bukan id dari klien semata. Skor dihitung ulang di server. Tiap koleksi di-fetch terpisah (tanpa relasi bersarang).

import { directusServerJson } from '$lib/server/directus';
import { loadMentorConfig, resolveTeamMembers } from '$lib/server/ess/teamTraining';
import { buildChecklistFromModules, mergeSavedItems, scoreChecklist, suggestTindakLanjut, toSkorDimensi, parseSkorDimensi, OJT_TINDAK_LANJUT } from '$lib/utils/ojtAssessment.js';

export class OjtError extends Error {
	constructor(message: string, public status: number) { super(message); }
}

const enc = encodeURIComponent;
const f = (filter: unknown) => enc(JSON.stringify(filter));
type Manager = { id: number };

async function teamIds(manager: Manager) {
	const members = await resolveTeamMembers(manager.id, await loadMentorConfig());
	return { members, byId: new Map<number, any>(members.map((m: any) => [Number(m.id), m])) };
}

/** Daftar enrollment bawahan yang masih berjalan, plus status penilaian OJT-nya. */
export async function listOjtTargets(manager: Manager) {
	const { members, byId } = await teamIds(manager);
	if (!members.length) return [];
	const ids = members.map((m: any) => Number(m.id));
	const enr = (await directusServerJson<{ data: any[] }>(
		`/items/training_enrollment?filter=${f({ _and: [{ karyawan_id: { _in: ids } }, { status: { _in: ['Enrolled', 'Ongoing', 'Remedial'] } }] })}&fields=id,program_id,karyawan_id,status,progress_persen&limit=-1`
	))?.data || [];
	if (!enr.length) return [];
	const progIds = [...new Set(enr.map((e) => Number(e.program_id)).filter(Number.isFinite))];
	const progs = (await directusServerJson<{ data: any[] }>(`/items/training_program?filter=${f({ id: { _in: progIds } })}&fields=id,judul,kategori&limit=-1`))?.data || [];
	const pById = new Map(progs.map((p) => [Number(p.id), p]));
	const reviews = (await directusServerJson<{ data: any[] }>(
		`/items/training_review?filter=${f({ enrollment_id: { _in: enr.map((e) => e.id) } })}&fields=id,enrollment_id,status,skor_dimensi&limit=-1`
	))?.data || [];
	const rByEnr = new Map<number, any>();
	for (const r of reviews) if (parseSkorDimensi(r.skor_dimensi)) rByEnr.set(Number(r.enrollment_id), r);
	return enr.map((e) => {
		const r = rByEnr.get(Number(e.id));
		const sc = r ? scoreChecklist(parseSkorDimensi(r.skor_dimensi) || []) : null;
		return {
			enrollmentId: e.id,
			karyawanId: Number(e.karyawan_id),
			nama: byId.get(Number(e.karyawan_id))?.nama_karyawan || `#${e.karyawan_id}`,
			programJudul: pById.get(Number(e.program_id))?.judul || `Program #${e.program_id}`,
			kategori: pById.get(Number(e.program_id))?.kategori || null,
			progressPersen: e.progress_persen ?? 0,
			statusOjt: r ? (r.status === 'final' ? 'final' : 'draft') : 'belum',
			skorPersen: sc?.persen ?? null
		};
	});
}

async function loadAuthorized(manager: Manager, enrollmentId: number) {
	const e = (await directusServerJson<{ data: any }>(`/items/training_enrollment/${enrollmentId}?fields=id,program_id,karyawan_id`).catch(() => null))?.data;
	if (!e) throw new OjtError('Pendaftaran pelatihan tidak ditemukan.', 404);
	const { byId } = await teamIds(manager);
	const member = byId.get(Number(e.karyawan_id));
	if (!member) throw new OjtError('Peserta ini bukan bawahan Anda.', 403);
	return { e, member };
}

async function findOjtReview(enrollmentId: number) {
	const reviews = (await directusServerJson<{ data: any[] }>(`/items/training_review?filter=${f({ enrollment_id: { _eq: enrollmentId } })}&sort=-id&limit=20`))?.data || [];
	return reviews.find((r) => parseSkorDimensi(r.skor_dimensi)) || null;
}

export async function getOjtForm(manager: Manager, enrollmentId: number) {
	const { e, member } = await loadAuthorized(manager, enrollmentId);
	const [prog, mods, saved] = await Promise.all([
		directusServerJson<{ data: any }>(`/items/training_program/${e.program_id}?fields=id,judul,passing_score`).then((r) => r?.data),
		directusServerJson<{ data: any[] }>(`/items/training_module?filter=${f({ program_id: { _eq: e.program_id } })}&fields=id,judul,urutan&sort=urutan&limit=-1`).then((r) => r?.data || []),
		findOjtReview(enrollmentId)
	]);
	const items = mergeSavedItems(buildChecklistFromModules(mods), saved ? parseSkorDimensi(saved.skor_dimensi) || [] : []);
	return {
		enrollmentId,
		nama: member.nama_karyawan,
		programJudul: prog?.judul || '',
		passingScore: prog?.passing_score ?? 70,
		items,
		kekuatan: saved?.kekuatan || '',
		kekurangan: saved?.kekurangan || '',
		tindakLanjut: saved?.tindak_lanjut || null,
		status: saved?.status === 'final' ? 'final' : saved ? 'draft' : 'belum'
	};
}

export async function saveOjtForm(
	manager: Manager,
	enrollmentId: number,
	input: { items: any[]; kekuatan?: string; kekurangan?: string; tindakLanjut?: string; finalize?: boolean }
) {
	const { e } = await loadAuthorized(manager, enrollmentId);
	const existing = await findOjtReview(enrollmentId);
	if (existing?.status === 'final') throw new OjtError('Penilaian OJT ini sudah final dan tidak dapat diubah.', 409);

	const items = (Array.isArray(input.items) ? input.items : [])
		.slice(0, 80)
		.map((i: any) => {
			const r = i?.rating;
			return {
				key: String(i?.key || '').slice(0, 40),
				label: String(i?.label || '').trim().slice(0, 255),
				rating: r === 0 || r === 1 || r === 2 ? r : null,
				catatan: String(i?.catatan || '').slice(0, 500)
			};
		})
		.filter((i) => i.key && i.label);
	if (!items.length) throw new OjtError('Tidak ada butir penilaian.', 400);
	const score = scoreChecklist(items);
	if (input.finalize && !score.lengkap) throw new OjtError(`Lengkapi semua butir sebelum difinalkan (${score.terisi}/${score.total}).`, 400);

	const prog = (await directusServerJson<{ data: any }>(`/items/training_program/${e.program_id}?fields=passing_score`).catch(() => null))?.data;
	const tl = OJT_TINDAK_LANJUT.some((t: any) => t.value === input.tindakLanjut) ? input.tindakLanjut : suggestTindakLanjut(score, prog?.passing_score ?? 70);
	const body = JSON.stringify({
		enrollment_id: enrollmentId,
		reviewer_id: manager.id,
		peran_reviewer: 'atasan',
		kekuatan: String(input.kekuatan || '').slice(0, 1500) || null,
		kekurangan: String(input.kekurangan || '').slice(0, 1500) || null,
		tindak_lanjut: tl,
		skor_dimensi: toSkorDimensi(items),
		status: input.finalize ? 'final' : 'draft',
		tanggal: new Date().toISOString()
	});
	if (existing) await directusServerJson(`/items/training_review/${existing.id}`, { method: 'PATCH', body });
	else await directusServerJson('/items/training_review', { method: 'POST', body });
	return { ok: true, status: input.finalize ? 'final' : 'draft', skorPersen: score.persen, tindakLanjut: tl };
}
