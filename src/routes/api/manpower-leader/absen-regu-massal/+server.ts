// src/routes/api/manpower-leader/absen-regu-massal/+server.ts
// PDP-24 — Absen regu massal: "Hadir Semua" lalu kecualikan izin/sakit/alpha, SATU foto regu + GPS,
// setiap pekerja tetap tercatat per nama (satu baris manpower_absensi per orang).
//
// Satu jalur uang: setiap entri memanggil INTI yang sama dengan absen-regu (`catatAbsenMasuk`) —
// penugasan aktif, masa sementara, geofence, upsert & akrual TIDAK disalin di sini. Bedanya hanya:
//   - foto diunggah SEKALI (entri pertama yang butuh bukti), lalu id-nya dipakai ulang (`fotoFileId`);
//   - satu entri gagal tidak menggagalkan yang lain (hasil dikembalikan per orang);
//   - idempoten: entri yang statusnya SAMA dengan baris yang sudah ada dilewati (kiriman ulang saat sinyal
//     putus tidak menimpa verifikasi/akrual); status BERBEDA = koreksi sengaja → ditulis ulang seperti absen-regu.
// Penanda batch: baris dalam satu kiriman berbagi `foto_masuk` yang sama (tanpa kolom baru). metode_catat
// tetap 'leader' agar antrean verifikasi ERP & aturan lain yang membacanya tidak berubah.
// Dilarang: leader mengabsenkan dirinya sendiri (tetap lewat ESS).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateManpowerLeader } from '$lib/server/manpowerLeaderGuard';
import { catatAbsenMasuk, idOf } from '$lib/server/manpowerAbsensiCore';
import { directusServerJson } from '$lib/server/directus';
import {
	parseEntriMassal,
	normalisasiSetelanMassal,
	tanggalBolehDicatat,
	ringkasHasil,
	statusButuhBukti,
	type HasilEntri
} from '$lib/shared/absenReguMassal';

const KEYS = ['manpower.absen_regu_massal.aktif', 'manpower.absen_regu_massal.min_anggota', 'manpower.absen_regu_massal.maks_per_kirim'];

/** Setelan massal + batas susulan. Gagal baca = default DAN dilog (bukan ditelan diam-diam). */
async function bacaSetelan() {
	const raw: Record<string, unknown> = {};
	let backfill = 7;
	try {
		const r = await directusServerJson<{ data: any[] }>(
			`/items/app_settings?filter[module][_eq]=manpower&filter[setting_key][_in]=${KEYS.join(',')}&fields=setting_key,setting_value&limit=-1`
		);
		for (const row of r?.data || []) raw[row.setting_key] = row.setting_value;
	} catch (e: any) {
		console.error('[absen-regu-massal] gagal baca app_settings manpower (pakai default):', e?.message || e);
	}
	try {
		const r = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=manpower.backfill_absensi_max_hari&limit=1&fields=setting_value`
		);
		const n = Number(String(r?.data?.[0]?.setting_value ?? '').replace(/["']/g, ''));
		if (Number.isFinite(n) && n >= 0 && n <= 31) backfill = n;
	} catch (e: any) {
		console.error('[absen-regu-massal] gagal baca backfill_absensi_max_hari (pakai 7):', e?.message || e);
	}
	return { ...normalisasiSetelanMassal(raw), backfill };
}

export const POST: RequestHandler = async (event) => {
	const form = await event.request.formData();

	const projectId = Number(form.get('project_id'));
	const tanggal = String(form.get('tanggal') || '');
	const lat = Number(form.get('lat'));
	const lng = Number(form.get('lng'));
	const accuracy = form.get('accuracy') != null ? Number(form.get('accuracy')) : null;
	const foto = form.get('foto');

	if (!Number.isFinite(projectId)) throw error(400, 'project_id wajib diisi.');

	const setelan = await bacaSetelan();
	if (!setelan.aktif) throw error(403, 'Absen regu massal sedang dimatikan (setelan manpower). Gunakan absen per orang.');

	const tgl = tanggalBolehDicatat(tanggal, setelan.backfill);
	if (!tgl.ok) throw error(400, tgl.error);

	const parsed = parseEntriMassal(form.get('entries'), setelan.maksPerKirim);
	if (!parsed.ok) throw error(400, parsed.error);
	const entries = parsed.entries;

	// Foto & GPS dibutuhkan bila ada yang hadir/setengah hari. Validasi awal supaya gagal cepat dan jelas.
	const adaYangHadir = entries.some((e) => statusButuhBukti(e.status));
	if (adaYangHadir) {
		if (!(foto instanceof File) || foto.size === 0) throw error(400, 'Foto regu wajib bila ada anggota yang hadir.');
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw error(400, 'Lokasi GPS tidak valid. Aktifkan izin lokasi dan coba lagi.');
	}

	const { manpower, project } = await authenticateManpowerLeader(event, projectId);

	// Baris yang sudah ada untuk tanggal ini — SATU query untuk seluruh regu (hemat panggilan).
	const ids = entries.map((e) => e.manpower_id).join(',');
	const existingRes = await directusServerJson<{ data: any[] }>(
		`/items/manpower_absensi?filter[project_id][_eq]=${projectId}&filter[tanggal][_eq]=${tanggal}` +
			`&filter[manpower_id][_in]=${ids}&fields=id,manpower_id,status,dikunci&limit=-1`
	);
	const existingByMp = new Map<number, any>();
	for (const r of existingRes?.data || []) existingByMp.set(Number(idOf(r.manpower_id)), r);

	const hasil: HasilEntri[] = [];
	let fotoFileId: string | null = null;

	for (const e of entries) {
		const base = { manpower_id: e.manpower_id, status: e.status };
		if (Number(e.manpower_id) === Number(manpower.id)) {
			hasil.push({ ...base, ok: false, hasil: 'gagal', message: 'Absensi Anda sendiri lewat Absensi Mandiri (ESS), bukan dari layar regu.' });
			continue;
		}
		const ada = existingByMp.get(e.manpower_id);
		if (ada && !ada.dikunci && ada.status === e.status) {
			hasil.push({ ...base, ok: true, hasil: 'sudah', message: 'Sudah tercatat dengan status yang sama.' });
			continue;
		}
		try {
			const r = await catatAbsenMasuk({
				projectId,
				project,
				assignmentId: e.assignment_id,
				targetManpowerId: e.manpower_id,
				status: e.status,
				tanggal,
				lat,
				lng,
				accuracy,
				foto,
				fotoFileId,
				pencatat: { metode: 'leader', nama: manpower.nama || '', manpowerId: manpower.id },
				existingPolicy: 'overwrite'
			});
			if (!fotoFileId && r.fotoId) fotoFileId = r.fotoId; // foto regu diunggah sekali, dipakai ulang
			hasil.push({ ...base, ok: true, hasil: 'tercatat', message: r.message });
		} catch (err: any) {
			// SvelteKit error(): { status, body: { message } }. Satu gagal tidak menggagalkan yang lain.
			const message = err?.body?.message || err?.message || 'Gagal mencatat absensi.';
			console.warn(`[absen-regu-massal] entri manpower #${e.manpower_id} gagal:`, message);
			hasil.push({ ...base, ok: false, hasil: 'gagal', message });
		}
	}

	return json({ success: true, tanggal, foto_file_id: fotoFileId, ringkasan: ringkasHasil(hasil), hasil });
};
