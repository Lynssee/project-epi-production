// src/routes/api/ess/referral/+server.ts
// SERVER-ONLY. Endpoint ESS Rekomendasi Relasi (Internal Referral Rekrutmen).
// Karyawan lapangan dan kantor dapat melihat lowongan referral aktif dan mengajukan rekomendasi.
// Sesuai aturan arsitektur: Directus fetching dipisah per relasi (separated relations).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = [
	'application/pdf',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'image/jpeg',
	'image/png'
];

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	// 1. Ambil lowongan kerja yang aktif dan membuka program referral
	const jobsFilter = encodeURIComponent(
		JSON.stringify({
			_and: [
				{ is_published: { _eq: true } },
				{ status: { _eq: 'Active' } },
				{ is_referral_active: { _eq: true } }
			]
		})
	);

	const jobsRes = await directusServerJson(
		`/items/lowongan_kerja?filter=${jobsFilter}&fields=id,judul_posisi,departemen,lokasi,tipe_pekerjaan,rentang_gaji,referral_reward_nominal,referral_terms,deskripsi,persyaratan,batas_lamaran,tanggal_posting&sort=-tanggal_posting&limit=50`
	).catch((e) => {
		console.error('[ess/referral] Gagal mengambil data lowongan:', e?.message);
		return { data: [] };
	});

	const jobs = jobsRes?.data || [];

	// 2. Ambil riwayat rekomendasi yang diajukan oleh karyawan yang login
	const myRefFilter = encodeURIComponent(
		JSON.stringify({
			referrer_karyawan_id: { _eq: karyawan.id }
		})
	);

	const refRes = await directusServerJson(
		`/items/recruitment_referral?filter=${myRefFilter}&sort=-tanggal_rekomendasi&limit=100`
	).catch((e) => {
		console.error('[ess/referral] Gagal mengambil riwayat referral:', e?.message);
		return { data: [] };
	});

	const rawRefs = refRes?.data || [];

	// 3. Ambil data kandidat dan lowongan secara terpisah (separated relations)
	const lowonganIds = [...new Set(rawRefs.map((r: any) => r.lowongan_id).filter(Boolean))];
	const kandidatIds = [...new Set(rawRefs.map((r: any) => r.kandidat_id).filter(Boolean))];

	const [lowonganMap, kandidatMap] = await Promise.all([
		lowonganIds.length > 0
			? directusServerJson(
					`/items/lowongan_kerja?filter[id][_in]=${lowonganIds.join(',')}&fields=id,judul_posisi,departemen,lokasi,referral_reward_nominal`
				)
					.then((res) => new Map((res?.data || []).map((j: any) => [j.id, j])))
					.catch(() => new Map())
			: Promise.resolve(new Map()),
		kandidatIds.length > 0
			? directusServerJson(
					`/items/kandidat?filter[id][_in]=${kandidatIds.join(',')}&fields=id,nama,email,no_hp,status,current_stage,tanggal_melamar`
				)
					.then((res) => new Map((res?.data || []).map((k: any) => [k.id, k])))
					.catch(() => new Map())
			: Promise.resolve(new Map())
	]);

	const myReferrals = rawRefs.map((ref: any) => ({
		...ref,
		lowongan: lowonganMap.get(ref.lowongan_id) || null,
		kandidat: kandidatMap.get(ref.kandidat_id) || null
	}));

	return json({
		jobs,
		myReferrals,
		karyawan: {
			id: karyawan.id,
			nama: karyawan.nama_karyawan,
			departemen: karyawan.divisi || 'Lapangan'
		}
	});
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData();

	const lowonganId = Number(form.get('lowongan_id'));
	const nama = String(form.get('nama') || '').trim();
	const noHp = String(form.get('no_hp') || '').trim();
	const email = String(form.get('email') || '').trim();
	const hubunganRelasi = String(form.get('hubungan_relasi') || '').trim();
	const alasanRekomendasi = String(form.get('alasan_rekomendasi') || '').trim();
	const cvFile = form.get('cv');

	if (!lowonganId || !nama || !noHp || !hubunganRelasi) {
		throw error(400, 'Mohon lengkapi data wajib: lowongan, nama kandidat, nomor WhatsApp, dan hubungan relasi.');
	}

	// 1. Validasi Anti-Self Referral
	// ServerKaryawan hanya memuat kolom identitas (tanpa no_hp/email) → kontak karyawan dibaca terpisah (Aturan #2).
	// Gagal membaca kontak = guard dilewati (fail-open, sama seperti perilaku sebelumnya) tetapi dicatat.
	const kontakRes = await directusServerJson<{ data: { no_hp?: string | null; email?: string | null; email_company?: string | null } }>(
		`/items/karyawan/${karyawan.id}?fields=no_hp,email,email_company`
	).catch((e) => {
		console.warn('[referral] gagal membaca kontak karyawan untuk validasi self-referral:', e?.message || e);
		return null;
	});
	const kontak = kontakRes?.data;
	const cleanKaryawanPhone = String(kontak?.no_hp || '').replace(/[^0-9]/g, '');
	const cleanCandPhone = noHp.replace(/[^0-9]/g, '');
	if (cleanKaryawanPhone && cleanCandPhone && cleanKaryawanPhone === cleanCandPhone) {
		throw error(400, 'Anda tidak dapat merekomendasikan nomor telepon Anda sendiri.');
	}
	const emailSendiri = [kontak?.email, kontak?.email_company, karyawan.email_company]
		.filter((v): v is string => !!v)
		.map((v) => v.toLowerCase());
	if (email && emailSendiri.includes(email.toLowerCase())) {
		throw error(400, 'Anda tidak dapat merekomendasikan alamat email Anda sendiri.');
	}

	// 2. Ambil data lowongan (terpisah)
	const jobRes = await directusServerJson(`/items/lowongan_kerja/${lowonganId}?fields=id,judul_posisi,departemen,referral_reward_nominal,total_pelamar,is_referral_active,status,is_published`);
	const job = jobRes?.data;
	if (!job || !job.is_referral_active || job.status !== 'Active') {
		throw error(400, 'Lowongan ini tidak aktif atau tidak membuka program internal referral.');
	}

	// 3. Validasi Duplikasi: kandidat belum pernah melamar / direkomendasikan dalam 6 bulan terakhir
	const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
	const dupFilter = encodeURIComponent(
		JSON.stringify({
			_and: [
				{ no_hp: { _eq: noHp } },
				{ tanggal_melamar: { _gte: sixMonthsAgo } }
			]
		})
	);
	const dupRes = await directusServerJson(`/items/kandidat?filter=${dupFilter}&fields=id&limit=1`).catch(() => ({ data: [] }));
	if (dupRes?.data?.length > 0) {
		throw error(400, 'Kandidat dengan nomor telepon ini sudah pernah melamar atau direkomendasikan dalam 6 bulan terakhir.');
	}

	// 4. Validasi Kuota Bulanan Karyawan (maksimal 5 rekomendasi per bulan kalender)
	const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
	const quotaFilter = encodeURIComponent(
		JSON.stringify({
			_and: [
				{ referrer_karyawan_id: { _eq: karyawan.id } },
				{ tanggal_rekomendasi: { _gte: firstDayOfMonth } }
			]
		})
	);
	const quotaRes = await directusServerJson(`/items/recruitment_referral?filter=${quotaFilter}&fields=id&limit=20`).catch(() => ({ data: [] }));
	if ((quotaRes?.data?.length || 0) >= 5) {
		throw error(400, 'Batas kuota rekomendasi Anda bulan ini (maksimal 5 pelamar) telah tercapai.');
	}

	// 5. Upload File CV jika terlampir
	let fileId: string | null = null;
	if (cvFile instanceof File && cvFile.size > 0) {
		if (cvFile.size > MAX_FILE_SIZE) {
			throw error(400, 'Ukuran file dokumen CV maksimal 5 MB.');
		}
		if (!ALLOWED_MIME.includes(cvFile.type)) {
			throw error(400, 'Format dokumen harus PDF, Word, atau Gambar JPG/PNG.');
		}

		const uploadForm = new FormData();
		uploadForm.append('file', cvFile, cvFile.name);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) {
			const errBody = await uploadRes.json().catch(() => ({}));
			throw error(502, errBody?.errors?.[0]?.message || 'Gagal mengunggah berkas CV.');
		}
		const uploadData = await uploadRes.json();
		fileId = uploadData?.data?.id || null;
	}

	const today = new Date().toISOString();

	// 6. Buat record kandidat di Directus
	const newKandidatRes = await directusServerJson('/items/kandidat', {
		method: 'POST',
		body: JSON.stringify({
			nama,
			email: email || null,
			no_hp: noHp,
			lowongan_id: job.id,
			judul_posisi: job.judul_posisi,
			sumber: 'Internal Referral',
			source_detail: `Direkomendasikan oleh ${karyawan.nama_karyawan} (${karyawan.divisi || 'Karyawan'})`,
			status: 'Applied',
			current_stage: 'Applied',
			tanggal_melamar: today.split('T')[0],
			stage_moved_at: today,
			cv_file: fileId,
			is_referral: true,
			karyawan_id: karyawan.id
		})
	});

	const kandidatId = newKandidatRes?.data?.id;

	// 7. Buat record recruitment_referral di Directus
	const newReferralRes = await directusServerJson('/items/recruitment_referral', {
		method: 'POST',
		body: JSON.stringify({
			lowongan_id: job.id,
			kandidat_id: kandidatId,
			referrer_karyawan_id: karyawan.id,
			hubungan_relasi: hubunganRelasi,
			alasan_rekomendasi: alasanRekomendasi || null,
			status: 'Diajukan',
			reward_amount: job.referral_reward_nominal || 0,
			tanggal_rekomendasi: today
		})
	});

	const referralId = newReferralRes?.data?.id;

	// 8. Tautkan referral_id ke kandidat
	if (kandidatId && referralId) {
		await directusServerJson(`/items/kandidat/${kandidatId}`, {
			method: 'PATCH',
			body: JSON.stringify({ referral_id: referralId })
		}).catch((e) => console.error('[ess/referral] Gagal update referral_id kandidat:', e?.message));
	}

	// 9. Increment total pelamar pada lowongan
	await directusServerJson(`/items/lowongan_kerja/${job.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ total_pelamar: (job.total_pelamar || 0) + 1 })
	}).catch(() => null);

	return json({
		success: true,
		referralId,
		kandidatId,
		message: 'Rekomendasi Anda berhasil dikirim ke tim HRD!'
	});
};
