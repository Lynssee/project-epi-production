// src/routes/api/sji/peminjaman/[itemId]/kembali/+server.ts
// Fase 2: pengembalian barang pinjam. Direkam oleh peminjam sendiri (self-service, sama
// prinsipnya dengan pola offline/self-report lain di project-epi) — beda dari serah-terima
// awal yang mensyaratkan petugas gudang scan token fisik.
//
// R5: barang hilang TIDAK menambah stok kembali (fail-closed juga berlaku untuk arah IN —
// kalau movement gagal, status TIDAK berubah jadi 'dikembalikan').

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { sjiStockMovement } from '$lib/server/sjiStockMovement';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const itemId = Number(event.params.itemId);
	if (!Number.isFinite(itemId)) throw error(400, 'ID tidak valid.');

	const form = await event.request.formData();
	const kondisi = form.get('kondisi_kembali')?.toString();
	const catatan = form.get('catatan_pengecekan')?.toString() || '';
	const fotoFile = form.get('foto');
	const lat = form.get('lat') ? Number(form.get('lat')) : null;
	const lng = form.get('lng') ? Number(form.get('lng')) : null;

	if (!['baik', 'rusak', 'hilang'].includes(kondisi || '')) {
		throw error(400, 'Kondisi kembali harus baik/rusak/hilang.');
	}

	const recRes = await directusServerJson<{ data: any }>(
		`/items/peminjaman_internal/${itemId}?fields=*`
	).catch(() => null);
	const rec = recRes?.data;
	if (!rec) throw error(404, 'Peminjaman tidak ditemukan.');

	const peminjamId = typeof rec.peminjam_id === 'object' ? rec.peminjam_id?.id : rec.peminjam_id;
	if (peminjamId !== karyawan.id) throw error(403, 'Anda hanya bisa mengembalikan pinjaman milik sendiri.');
	if (rec.status !== 'dipinjam' && rec.status !== 'overdue') {
		throw error(409, `Peminjaman berstatus "${rec.status}" tidak bisa dikembalikan.`);
	}

	let fotoFileId: string | null = null;
	if (fotoFile instanceof File) {
		const uploadForm = new FormData();
		uploadForm.append('file', fotoFile, fotoFile.name);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto kondisi barang.');
		fotoFileId = (await uploadRes.json())?.data?.id || null;
	}

	let stockInId: number | null = null;
	// Barang hilang tidak menambah stok kembali (pola deliverPeminjaman/returnPeminjaman admin).
	if (kondisi === 'baik' || kondisi === 'rusak') {
		const gudangId = typeof rec.gudang_id === 'object' ? rec.gudang_id?.id : rec.gudang_id;
		if (!gudangId) throw error(409, 'gudang_id tidak tercatat di peminjaman ini — tidak bisa memproses stok masuk.');
		// FAIL-CLOSED: kalau ini throw, status TIDAK di-PATCH jadi 'dikembalikan' di bawah.
		const move = await sjiStockMovement({
			itemId: rec.item_id,
			type: 'IN',
			quantity: rec.quantity,
			referenceNo: `${rec.reference_no}-RTN`,
			notes: `Pengembalian SJI ${rec.reference_no}. Kondisi: ${kondisi}`,
			category: 'BORROW_RETURN',
			referenceId: rec.id,
			referenceType: 'PEMINJAMAN_RETURN',
			gudangId
		});
		stockInId = move.id;
	}

	// Denda telat (Q17 masih "catatan saja", tapi angka hari-telat x tarif per hari objektif
	// untuk dihitung otomatis — beda dari denda kerusakan/kehilangan yang butuh taksiran manual
	// admin, jadi TIDAK dihitung di sini; admin tetap bisa menambah/menimpa nilai denda dari panel).
	const tanggalKembaliAktual = new Date().toISOString().split('T')[0];
	let dendaTelat = 0;
	if (rec.tanggal_jatuh_tempo) {
		const jatuhTempo = new Date(`${rec.tanggal_jatuh_tempo}T00:00:00`);
		const kembali = new Date(`${tanggalKembaliAktual}T00:00:00`);
		const hariTelat = Math.floor((kembali.getTime() - jatuhTempo.getTime()) / 86400000);
		if (hariTelat > 0) {
			const settingRes = await directusServerJson<{ data: any[] }>(
				`/items/system_settings?filter[setting_key][_eq]=inventory.sji.denda_per_hari&limit=1`
			);
			const dendaPerHari = Number(JSON.parse(settingRes?.data?.[0]?.setting_value || '0')) || 0;
			dendaTelat = hariTelat * dendaPerHari;
		}
	}

	const updated = await directusServerJson<{ data: any }>(`/items/peminjaman_internal/${itemId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			status: 'dikembalikan',
			tanggal_kembali_aktual: tanggalKembaliAktual,
			kondisi_kembali: kondisi,
			catatan_pengecekan: catatan || null,
			foto_kembali: fotoFileId,
			geo_lat: lat,
			geo_lng: lng,
			stock_in_transaction_id: stockInId,
			denda: dendaTelat,
			denda_status: dendaTelat > 0 ? 'belum_bayar' : 'tidak_ada'
		})
	});

	return json({ success: true, data: updated.data });
};
