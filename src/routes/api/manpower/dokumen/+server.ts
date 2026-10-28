// src/routes/api/manpower/dokumen/+server.ts
// GPA-05 — buat baris manpower_dokumen lewat SERVER (token server), bukan token user lapangan.
//
// Sebelumnya createManpowerDokumen() dipanggil dari klien; Access Policy Leader Lapangan diduga
// tidak punya `create` di manpower_dokumen → 403 → ditelan → KTP "berhasil" tapi tidak pernah
// sampai ke antrean verifikasi HRD (4 pekerja punya foto_ktp tapi manpower_dokumen kosong).
// Endpoint ini menulis dengan directusServerJson; status_verifikasi SELALU 'menunggu'
// (tidak bisa meloloskan gate sendiri — harus diverifikasi HRD).
//
// Otorisasi: pemanggil harus Project Leader dan
//   (a) pekerja punya penugasan aktif di proyek yang dipimpinnya, ATAU
//   (b) `projectId` yang dikirim = proyek yang dipimpinnya DAN pekerja tidak sedang aktif
//       ditugaskan di proyek yang bukan dipimpinnya (alur pendaftaran: dokumen dibuat sebelum SPK).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { resolveKaryawanByEmail, resolveLedProjectIds } from '$lib/server/projectLeaderGuard';

const JENIS_DOKUMEN = ['ktp', 'sertifikat_k3', 'surat_kesehatan', 'mcu', 'skck', 'kontak_darurat', 'lainnya'];

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const manpowerId = Number(body.manpowerId);
	const jenisDokumen = String(body.jenisDokumen || '').trim();
	const fileId = String(body.fileId || '').trim();
	const projectId = body.projectId != null ? Number(body.projectId) : null;
	const tanggalKedaluwarsa = body.tanggalKedaluwarsa ? String(body.tanggalKedaluwarsa).slice(0, 10) : null;

	if (!manpowerId) throw error(400, 'manpowerId wajib.');
	if (!JENIS_DOKUMEN.includes(jenisDokumen)) throw error(400, 'Jenis dokumen tidak dikenal.');
	if (!fileId) throw error(400, 'fileId wajib (unggah foto dulu).');
	if (tanggalKedaluwarsa && !/^\d{4}-\d{2}-\d{2}$/.test(tanggalKedaluwarsa)) {
		throw error(400, 'tanggalKedaluwarsa harus YYYY-MM-DD.');
	}

	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) {
		throw error(403, 'Akun ini belum tertaut ke data karyawan. Minta HRD mengisi "Email Perusahaan" pada data Anda.');
	}
	const led = await resolveLedProjectIds(karyawan);
	if (!led.length) throw error(403, 'Anda tidak memimpin proyek manapun.');

	const asgRes = await directusServerJson<{ data: Array<{ project_id: number | null }> }>(
		`/items/manpower_assignment?filter[manpower_id][_eq]=${manpowerId}&filter[status][_eq]=aktif&fields=project_id&limit=-1`
	);
	const asgProjects = (asgRes?.data || []).map((r) => r.project_id).filter((id): id is number => id != null);
	const inLedProject = asgProjects.some((id) => led.includes(id));
	const assignedElsewhere = asgProjects.some((id) => !led.includes(id));
	const registrasiOk = projectId != null && led.includes(projectId) && !assignedElsewhere;
	if (!inLedProject && !registrasiOk) {
		throw error(403, 'Pekerja ini tidak sedang ditugaskan di proyek yang Anda pimpin.');
	}

	const created = await directusServerJson<{ data: { id: number } }>('/items/manpower_dokumen', {
		method: 'POST',
		body: JSON.stringify({
			manpower_id: manpowerId,
			jenis_dokumen: jenisDokumen,
			file: fileId,
			tanggal_kedaluwarsa: tanggalKedaluwarsa,
			status_verifikasi: 'menunggu'
		})
	});
	if (!created?.data?.id) throw error(502, 'Dokumen tidak tersimpan (Directus tidak mengembalikan id).');

	return json({ ok: true, id: created.data.id });
}
