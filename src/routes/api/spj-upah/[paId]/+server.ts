// src/routes/api/spj-upah/[paId]/+server.ts
// GPM-C09 —
//   POST   multipart: manpower_id, jumlah_diterima, metode (tunai|transfer), lat?, lng?, foto (gambar)  → catat satu bukti pembagian upah
//   DELETE ?baris=<id>                                                                                  → batalkan bukti milik sendiri (belum disetujui Finance)
// Hanya koordinator upah PA ini (dari token). Foto diunggah ke Directus lalu baris dibuat dengan diterima_at = waktu SERVER; verifikasi oleh Finance di ERP.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveManpowerByEmail } from '$lib/server/manpowerLeaderGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { KOLEKSI_DISTRIBUSI, bacaSetelan, muatDetailPA, validasiBukti, koordinatorIdDari } from '$lib/server/spjUpah';

const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);
const angkaOpsional = (v: FormDataEntryValue | null): number | null => {
	if (v == null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

async function aktor(event: Parameters<RequestHandler>[0]) {
	const user = await requireUser(event);
	const manpower = await resolveManpowerByEmail(user.email);
	if (!manpower) throw error(403, 'Akun ini belum tertaut ke data manpower. Minta HRD mengisi "Email akun" pada data Anda.');
	const paId = Number(event.params.paId);
	if (!paId) throw error(400, 'ID pengajuan tidak valid.');
	const pa = (await directusServerJson<{ data: any }>(
		`/items/pengajuan_anggaran/${paId}?fields=id,nomor_pengajuan,status,total_amount,tanggal_dicairkan,penerima_dana_type,dynamic_fields`
	).catch((e) => {
		console.error('[spj-upah] gagal membaca PA', paId, e?.message || e);
		throw error(502, 'Gagal membaca data pengajuan.');
	}))?.data;
	if (!pa) throw error(404, 'Pengajuan tidak ditemukan.');
	if (koordinatorIdDari(pa.dynamic_fields) !== Number(manpower.id)) throw error(403, 'Anda bukan koordinator upah pada pengajuan ini.');
	return { manpower, pa, paId };
}

export const POST: RequestHandler = async (event) => {
	const { manpower, pa, paId } = await aktor(event);
	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Data tidak terbaca.');
	const foto = form.get('foto');
	const masukan = {
		manpowerId: Number(form.get('manpower_id')),
		jumlah: Number(form.get('jumlah_diterima')),
		metode: String(form.get('metode') || ''),
		fotoByte: foto instanceof File ? foto.size : 0,
		fotoTipe: foto instanceof File ? foto.type : ''
	};
	const { rincian, distribusi } = await muatDetailPA([paId]);
	const setelan = await bacaSetelan();
	const kesalahan = validasiBukti({ pa, manpowerKoordinator: Number(manpower.id), rincian, distribusi, masukan, toleransi: setelan.toleransi, hariIni: todayJakarta() });
	if (kesalahan.length) throw error(400, kesalahan.join(' '));

	const upload = new FormData();
	upload.append('file', foto as File, `spj-upah-${paId}-${masukan.manpowerId}-${Date.now()}.jpg`);
	const upRes = await directusServerUpload(upload);
	if (!upRes.ok) {
		console.error('[spj-upah] unggah foto gagal', upRes.status);
		throw error(502, 'Gagal mengunggah foto ke server. Coba lagi.');
	}
	const fileId = (await upRes.json())?.data?.id;
	if (!fileId) throw error(502, 'Gagal mengunggah foto ke server. Coba lagi.');

	try {
		const dibuat = await directusServerJson<{ data: any }>(`/items/${KOLEKSI_DISTRIBUSI}`, {
			method: 'POST',
			body: JSON.stringify({
				pengajuan_anggaran_id: paId, manpower_id: masukan.manpowerId, jumlah_diterima: masukan.jumlah, metode: masukan.metode,
				bukti_file_id: fileId, diterima_at: new Date().toISOString(), lat: angkaOpsional(form.get('lat')), lng: angkaOpsional(form.get('lng')),
				dicatat_oleh_manpower_id: manpower.id, status_verifikasi: 'menunggu'
			})
		});
		return json({ success: true, id: dibuat?.data?.id ?? null }, { status: 201 });
	} catch (e) {
		console.error('[spj-upah] gagal menyimpan bukti (file sudah terunggah:', fileId, ')', (e as any)?.message || e);
		throw error(502, 'Gagal menyimpan bukti. Coba lagi.');
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { manpower, paId } = await aktor(event);
	const barisId = Number(event.url.searchParams.get('baris'));
	if (!barisId) throw error(400, 'ID bukti tidak valid.');
	const baris = (await directusServerJson<{ data: any }>(`/items/${KOLEKSI_DISTRIBUSI}/${barisId}?fields=id,pengajuan_anggaran_id,dicatat_oleh_manpower_id,status_verifikasi`).catch(() => null))?.data;
	if (!baris || Number(idOf(baris.pengajuan_anggaran_id)) !== paId) throw error(404, 'Bukti tidak ditemukan pada pengajuan ini.');
	if (Number(idOf(baris.dicatat_oleh_manpower_id)) !== Number(manpower.id)) throw error(403, 'Hanya pencatat bukti yang boleh membatalkannya.');
	if (String(baris.status_verifikasi || '').toLowerCase() === 'disetujui') throw error(409, 'Bukti yang sudah disetujui Finance tidak bisa dibatalkan.');
	try {
		await directusServerJson(`/items/${KOLEKSI_DISTRIBUSI}/${barisId}`, { method: 'DELETE' });
	} catch (e) {
		console.error('[spj-upah] gagal menghapus bukti', barisId, (e as any)?.message || e);
		throw error(502, 'Gagal membatalkan bukti. Coba lagi.');
	}
	return json({ success: true });
};
