// src/routes/api/proyek-klaim/+server.ts
// Endpoint API untuk klaim lapangan, backcharge pemborong, dan pekerjaan tambah (project-epi).
// Mematuhi aturan: Directus Single Source of Truth & pemanggilan terpisah per relasi.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { getFieldGateMode } from '$lib/server/gateEnforcement';
import { notifyN8n } from '$lib/server/n8nNotify';

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const projectId = event.url.searchParams.get('project_id');
	if (!projectId) {
		throw error(400, 'Parameter project_id wajib diisi.');
	}

	try {
		// 1. Ambil daftar klaim lapangan untuk proyek ini
		const claimsRes = await directusServerJson<{ data: any[] }>(
			`/items/proyek_klaim_lapangan?filter[project_id][_eq]=${projectId}&sort=-id&fields=id,nomor_klaim,tanggal,tipe_klaim,pemborong_id,nama_pemborong,kategori_jasa,satuan_hitung,volume,tarif_satuan,total_nominal,catatan,foto_bukti,foto_ba_mandor,nama_mandor_penyetuju,status,date_created`
		).catch(() => ({ data: [] }));

		// 2. Ambil master tarif dari app_settings
		const tarifRes = await directusServerJson<{ data: any[] }>(
			`/items/app_settings?filter[module][_eq]=project&filter[setting_key][_eq]=backcharge_tarifs&fields=setting_value&limit=1`
		).catch(() => ({ data: [] }));

		let tarifs = null;
		const rawTarif = tarifRes?.data?.[0]?.setting_value;
		if (rawTarif) {
			tarifs = typeof rawTarif === 'string' ? JSON.parse(rawTarif) : rawTarif;
		}

		return json({
			claims: claimsRes?.data || [],
			tarifs: tarifs || {}
		});
	} catch (err: any) {
		console.error('[api/proyek-klaim] GET error:', err);
		throw error(500, err?.message || 'Gagal mengambil data klaim proyek.');
	}
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const projectIdRaw = form.get('project_id');
	const projectId = projectIdRaw ? Number(projectIdRaw) : null;
	if (!projectId || !Number.isFinite(projectId)) {
		throw error(400, 'Project ID wajib dipilih.');
	}

	const tipeKlaim = String(form.get('tipe_klaim') || 'backcharge_pemborong');
	const pemborongIdRaw = form.get('pemborong_id');
	const pemborongId = pemborongIdRaw ? Number(pemborongIdRaw) : null;
	const namaPemborong = String(form.get('nama_pemborong') || '').trim();

	const kategoriJasa = String(form.get('kategori_jasa') || 'buang_puing');
	const satuanHitung = String(form.get('satuan_hitung') || 'ritase');
	const volume = Number(form.get('volume')) || 0;
	const tarifSatuan = Number(form.get('tarif_satuan')) || 0;
	const totalNominal = Number(form.get('total_nominal')) || volume * tarifSatuan;

	const catatan = String(form.get('catatan') || '').trim();
	const namaMandor = String(form.get('nama_mandor_penyetuju') || '').trim();

	const fotoBukti = form.get('foto_bukti');
	const fotoBa = form.get('foto_ba');
	const signatureData = form.get('signature_data')?.toString()?.trim() || null;

	if (totalNominal <= 0) {
		throw error(400, 'Total nominal biaya/jasa harus lebih dari Rp 0.');
	}

	if (tipeKlaim === 'backcharge_pemborong' && !namaPemborong && !pemborongId) {
		throw error(400, 'Nama pemborong wajib dipilih atau diisi untuk klaim backcharge.');
	}

	// Evaluasi Gate G_PRJ_BACKCHARGE_EVIDENCE
	const hasFotoBukti = fotoBukti instanceof File && fotoBukti.size > 0;
	const hasTtdOrBa = (fotoBa instanceof File && fotoBa.size > 0) || !!signatureData;

	const gateEvidenceMode = await getFieldGateMode('G_PRJ_BACKCHARGE_EVIDENCE').catch(() => 'shadow');
	if (tipeKlaim === 'backcharge_pemborong') {
		if (!hasFotoBukti || !hasTtdOrBa) {
			const alasan = !hasFotoBukti
				? 'Foto bukti fisik di lokasi wajib diunggah.'
				: 'Tanda tangan digital mandor atau foto lembar Berita Acara (BA) wajib disertakan.';
			if (gateEvidenceMode === 'hard') {
				throw error(400, `Gate G_PRJ_BACKCHARGE_EVIDENCE: ${alasan}`);
			}
			console.warn(`[G_PRJ_BACKCHARGE_EVIDENCE] mode=${gateEvidenceMode} — klaim tetap diproses: ${alasan}`);
		}
	}

	// 1. Upload foto bukti ke Directus
	let fotoBuktiId: string | null = null;
	if (fotoBukti instanceof File && fotoBukti.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', fotoBukti, `bukti-${projectId}-${Date.now()}.jpg`);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, 'Gagal mengunggah foto bukti lapangan.');
		const d = await res.json();
		fotoBuktiId = d?.data?.id || null;
	}

	// 2. Upload foto BA atau TTD digital ke Directus
	let fotoBaId: string | null = null;
	if (fotoBa instanceof File && fotoBa.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', fotoBa, `ba-${projectId}-${Date.now()}.jpg`);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, 'Gagal mengunggah lembar Berita Acara mandor.');
		const d = await res.json();
		fotoBaId = d?.data?.id || null;
	} else if (signatureData && signatureData.startsWith('data:image/')) {
		// Convert Base64 dataURL to Blob/File
		try {
			const base64Content = signatureData.split(',')[1];
			const buffer = Buffer.from(base64Content, 'base64');
			const blob = new Blob([buffer], { type: 'image/png' });
			const uploadForm = new FormData();
			uploadForm.append('file', blob, `ttd-mandor-${projectId}-${Date.now()}.png`);
			const res = await directusServerUpload(uploadForm);
			if (res.ok) {
				const d = await res.json();
				fotoBaId = d?.data?.id || null;
			}
		} catch (sigErr) {
			console.warn('[api/proyek-klaim] Gagal convert/upload ttd digital:', sigErr);
		}
	}

	// Generate Nomor Klaim unik: KLM-YYYYMM-XXXX
	const now = new Date();
	const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
	const randSuffix = Math.floor(1000 + Math.random() * 9000);
	const nomorKlaim = `KLM-${yyyymm}-${randSuffix}`;

	// 3. Simpan record klaim ke Directus
	const payload = {
		nomor_klaim: nomorKlaim,
		project_id: projectId,
		tanggal: todayJakarta(),
		tipe_klaim: tipeKlaim,
		pemborong_id: pemborongId,
		nama_pemborong: namaPemborong || null,
		kategori_jasa: kategoriJasa,
		satuan_hitung: satuanHitung,
		volume,
		tarif_satuan: tarifSatuan,
		total_nominal: totalNominal,
		catatan: catatan || null,
		foto_bukti: fotoBuktiId,
		foto_ba_mandor: fotoBaId,
		ttd_digital: signatureData ? 'signed_on_touchscreen' : null,
		nama_mandor_penyetuju: namaMandor || null,
		status: 'submitted',
		karyawan_id: karyawan.id
	};

	try {
		const insertRes = await directusServerJson<{ data: any }>(
			'/items/proyek_klaim_lapangan',
			{
				method: 'POST',
				body: JSON.stringify(payload)
			}
		);

		// Trigger notifikasi n8n (Fase 4: Otomatisasi Webhook)
		notifyN8n('klaim_lapangan_created', {
			id: insertRes?.data?.id,
			nomor_klaim: nomorKlaim,
			project_id: projectId,
			tipe_klaim: tipeKlaim,
			pemborong_id: pemborongId,
			nama_pemborong: namaPemborong,
			kategori_jasa: kategoriJasa,
			volume,
			satuan_hitung: satuanHitung,
			tarif_satuan: tarifSatuan,
			total_nominal: totalNominal,
			catatan,
			nama_mandor_penyetuju: namaMandor,
			created_by: karyawan.nama || karyawan.id
		}).catch((err) => console.warn('[api/proyek-klaim] n8n trigger warning:', err));

		return json({
			success: true,
			data: insertRes?.data
		});
	} catch (insertErr: any) {
		console.error('[api/proyek-klaim] Insert klaim gagal:', insertErr);
		throw error(500, insertErr?.message || 'Gagal menyimpan data klaim lapangan.');
	}
};
