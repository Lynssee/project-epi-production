// src/routes/api/scan/proof-of-delivery/+server.ts
// F3 (rencana v2.0 Bab 6.3, Keputusan D3): driver menyerahkan barang peminjaman external
// dan menandatangani langsung di HP-nya sendiri — nol halaman publik, nol OTP/JWT eksternal.
// Dicatat ke scan_log generik (bukan tabel khusus, Bab 7.2).

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { directusServerJson } from '$lib/server/directus';

async function scanTypeId(name: string): Promise<string | null> {
	const res = await directusServerJson<{ data: Array<{ id: string }> }>(
		`/items/category?filter[group][_eq]=scan_type&filter[name][_eq]=${encodeURIComponent(name)}&limit=1&fields=id`
	).catch(() => null);
	return res?.data?.[0]?.id || null;
}

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan.');

	const body = await event.request.json().catch(() => ({}));
	const suratJalanId = Number(body?.suratJalanId);
	const signatureFileId = body?.signatureFileId || null;
	const fotoFileId = body?.fotoFileId || null;
	const gps = body?.gps || null;
	const notes = body?.notes || null;

	if (!Number.isFinite(suratJalanId)) throw error(400, 'suratJalanId tidak valid.');
	if (!signatureFileId && !fotoFileId) throw error(400, 'Tanda tangan atau foto bukti wajib diisi.');

	const sjRes = await directusServerJson<{ data: { id: number; type: string; status: string; nomor_sj: string; track_stage: string | null } }>(
		`/items/surat_jalan/${suratJalanId}?fields=id,type,status,nomor_sj,track_stage`
	).catch(() => null);
	const sj = sjRes?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');

	// Tracking SJ v2 (Q5): POD dibuka untuk SEMUA tipe SJ, bukan hanya 'peminjaman'.
	//   peminjaman  → alur lama: status created → shipped, sekali jalan.
	//   tipe lain   → POD = bukti driver menyerahkan; status SJ TIDAK dipaksa (alur
	//                 Goods Received tetap yang menutup), hanya tahap `tiba_lokasi` dicatat.
	const isPeminjaman = sj.type === 'peminjaman';
	if (isPeminjaman && sj.status !== 'created') {
		throw error(409, `Surat Jalan ${sj.nomor_sj} sudah berstatus '${sj.status}' — serah terima tidak bisa diulang.`);
	}

	const scanType = await scanTypeId(isPeminjaman ? 'Proof of Delivery' : 'Tiba Lokasi');
	const nowISO = new Date().toISOString();

	await directusServerJson('/items/scan_log', {
		method: 'POST',
		body: JSON.stringify({
			ref_collection: 'surat_jalan',
			ref_id: String(suratJalanId),
			scan_type: scanType,
			actor_id: karyawan.id,
			actor_role: 'driver',
			timestamp: nowISO,
			gps_lat: gps?.lat ?? null,
			gps_lng: gps?.lng ?? null,
			gps_accuracy: gps?.accuracy ?? null,
			signature_id: signatureFileId,
			foto_id: fotoFileId,
			notes,
			stage_from: sj.track_stage,
			stage_to: 'tiba_lokasi',
			source: 'lapangan',
			client_event_id: body?.clientEventId || null
		})
	});

	const cachePatch = { track_stage: 'tiba_lokasi', track_stage_at: nowISO, track_actor: karyawan.nama_karyawan };
	if (isPeminjaman) {
		await directusServerJson(`/items/surat_jalan/${suratJalanId}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'shipped', driver: karyawan.nama_karyawan, ...cachePatch })
		});
		return json({ success: true, nomorSj: sj.nomor_sj, newStatus: 'shipped' });
	}

	await directusServerJson(`/items/surat_jalan/${suratJalanId}`, {
		method: 'PATCH',
		body: JSON.stringify(cachePatch)
	}).catch((e) => console.error('[proof-of-delivery] patch track_stage gagal:', e));

	return json({ success: true, nomorSj: sj.nomor_sj, newStatus: sj.status });
}
