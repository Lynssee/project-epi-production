// src/routes/api/sji/[id]/serahkan/+server.ts
// Fase 2: petugas gudang scan QR SJI (atau input token manual) lalu konfirmasi serah-terima
// dengan foto + GPS + TTD. Menulis stok via sjiStockMovement() yang FAIL-CLOSED (R5) —
// kalau potong stok gagal untuk satu item, item itu TIDAK ditandai 'diserahkan'/'dipinjam',
// dan proses berhenti di situ (item berikutnya di batch yang sama tidak diproses).
//
// Fase 3 (alur manual/urgent, 2026-08-05): kondisi aslinya adalah TIDAK ADA petugas gudang di
// tempat — makanya SJI manual dibuat. Karyawan mengambil barang sendiri (mode='mandiri'),
// jadi tidak ada PIC yang bisa scan QR & TTD. Sebagai gantinya, mode ini WAJIB:
//   - saksi (karyawan lain, bukan pemohon sendiri) yang menyaksikan pengambilan
//   - foto PER ITEM (bukan satu foto gabungan) supaya jenis & jumlah barang yang diambil
//     bisa dicocokkan manual terhadap pengajuan oleh admin/gudang
//   - qty yang diserahkan harus PERSIS sama dengan qty pengajuan (tidak ada qtyAktual override)
//
// Body: multipart/form-data
//   token             - token mentah dari QR (dicocokkan sha256 ke sji_header.qr_token)
//   items             - JSON string: [{ collection: 'pengeluaran_barang'|'peminjaman_internal', id: number, qtyAktual?: number }]
//   mode              - 'petugas' (default) | 'mandiri'
//   foto              - File, dipakai di mode 'petugas' (wajib bila inventory.sji.require_photo_serah)
//   ttd               - File, tanda tangan penerima, dipakai di mode 'petugas' (wajib bila inventory.sji.require_ttd)
//   fotoItem_<collection>_<id> - File, wajib per item di mode 'mandiri'
//   saksiKaryawanId   - number, wajib di mode 'mandiri', harus beda dari pemohon
//   saksiKontak       - string, wajib di mode 'mandiri'
//   saksiTtd          - File, tanda tangan saksi, wajib di mode 'mandiri'
//   lat, lng          - string (wajib bila inventory.sji.require_gps)
//   clientTxnId       - string, idempotency key offline sync

import { createHash } from 'node:crypto';
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

function sha256Hex(value: string) {
	return createHash('sha256').update(value).digest('hex');
}

async function getSjiSettings() {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/system_settings?filter[setting_key][_starts_with]=inventory.sji.&limit=-1`
	);
	const settings: Record<string, any> = {
		'inventory.sji.require_photo_serah': true,
		'inventory.sji.require_gps': false,
		'inventory.sji.require_ttd': true
	};
	for (const row of res?.data || []) {
		if (!(row.setting_key in settings)) continue;
		try {
			settings[row.setting_key] = JSON.parse(row.setting_value);
		} catch {
			settings[row.setting_key] = row.setting_value;
		}
	}
	return settings;
}

interface ItemInput {
	collection: 'pengeluaran_barang' | 'peminjaman_internal';
	id: number;
	qtyAktual?: number;
}

// GET ?token=<rawToken> -> tampilkan item yang masih 'disetujui' (belum diserahkan) untuk
// dikonfirmasi petugas gudang. Otorisasi lewat kecocokan token (dokumen fisik), BUKAN
// kepemilikan (petugas gudang umumnya BUKAN pemohon) — beda dari GET /api/sji/[id] biasa.
export const GET: RequestHandler = async (event) => {
	await requireUser(event);

	const id = Number(event.params.id);
	if (!Number.isFinite(id)) throw error(400, 'ID tidak valid.');
	const token = (event.url.searchParams.get('token') || '').trim();

	const headerRes = await directusServerJson<{ data: any }>(
		`/items/sji_header/${id}?fields=id,reference_no,status,qr_token,keperluan,gudang_id.nama_gudang`
	).catch(() => null);
	const header = headerRes?.data;
	if (!header) throw error(404, 'SJI tidak ditemukan.');
	if (!header.qr_token) throw error(409, 'SJI ini belum dicetak (belum ada token QR).');
	if (!token || sha256Hex(token) !== header.qr_token) throw error(403, 'Token QR tidak valid untuk SJI ini.');
	if (header.status !== 'disetujui' && header.status !== 'sebagian_diserahkan') {
		throw error(409, `SJI berstatus "${header.status}" — tidak ada yang perlu diserahkan.`);
	}

	const idsFilter = encodeURIComponent(JSON.stringify({ sji_header_id: { _eq: id }, status: { _eq: 'disetujui' } }));
	const [pbRes, piRes] = await Promise.all([
		directusServerJson<{ data: any[] }>(
			`/items/pengeluaran_barang?filter=${idsFilter}&fields=id,item_id.nama_barang_lengkap,quantity,ukuran&limit=-1`
		),
		directusServerJson<{ data: any[] }>(
			`/items/peminjaman_internal?filter=${idsFilter}&fields=id,item_id.nama_barang_lengkap,quantity,tanggal_jatuh_tempo&limit=-1`
		)
	]);

	const items = [
		...(pbRes?.data || []).map((r) => ({ ...r, tipe: 'ambil_pakai' as const, collection: 'pengeluaran_barang' as const })),
		...(piRes?.data || []).map((r) => ({ ...r, tipe: 'pinjam' as const, collection: 'peminjaman_internal' as const }))
	];

	return json({ header, items });
};

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const petugas = await resolveKaryawan(user);
	if (!petugas) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const id = Number(event.params.id);
	if (!Number.isFinite(id)) throw error(400, 'ID tidak valid.');

	const form = await event.request.formData();
	const token = (form.get('token')?.toString() || '').trim();
	let items: ItemInput[] = [];
	try {
		items = JSON.parse(form.get('items')?.toString() || '[]');
	} catch {
		throw error(400, 'Format items tidak valid.');
	}
	const mode = form.get('mode')?.toString() === 'mandiri' ? 'mandiri' : 'petugas';
	const fotoFile = form.get('foto');
	const ttdFile = form.get('ttd');
	const lat = form.get('lat') ? Number(form.get('lat')) : null;
	const lng = form.get('lng') ? Number(form.get('lng')) : null;
	const clientTxnId = form.get('clientTxnId')?.toString() || null;

	if (items.length === 0) throw error(400, 'Tidak ada item untuk diserahkan.');

	const settings = await getSjiSettings();

	let saksiKaryawan: any = null;
	let saksiKontak = '';
	let saksiTtdFile: FormDataEntryValue | null = null;
	const itemFotoFiles = new Map<string, File>();

	if (mode === 'mandiri') {
		// Tidak ada petugas gudang di tempat — pemohon mengambil barang sendiri. Sebagai
		// pengganti kontrol PIC gudang, wajib ada saksi + foto per item yang bisa dicocokkan
		// terhadap pengajuan, tanpa memandang setelan inventory.sji.require_* (kontrol ini
		// menggantikan kontrol petugas gudang, bukan mengikutinya).
		const saksiKaryawanId = Number(form.get('saksiKaryawanId'));
		saksiKontak = (form.get('saksiKontak')?.toString() || '').trim();
		saksiTtdFile = form.get('saksiTtd');

		if (!Number.isFinite(saksiKaryawanId)) throw error(400, 'Saksi wajib dipilih untuk pengambilan mandiri.');
		if (saksiKaryawanId === petugas.id) throw error(400, 'Saksi tidak boleh orang yang sama dengan yang mengambil barang.');
		if (!saksiKontak) throw error(400, 'Kontak HP saksi wajib diisi.');
		if (!(saksiTtdFile instanceof File)) throw error(400, 'Tanda tangan saksi wajib diisi.');

		const saksiRes = await directusServerJson<{ data: any }>(`/items/karyawan/${saksiKaryawanId}?fields=id,nama_karyawan`).catch(() => null);
		saksiKaryawan = saksiRes?.data || null;
		if (!saksiKaryawan) throw error(400, 'Saksi tidak ditemukan di data karyawan.');

		for (const it of items) {
			const key = `fotoItem_${it.collection}_${it.id}`;
			const f = form.get(key);
			if (!(f instanceof File)) {
				throw error(400, `Foto barang wajib diunggah untuk setiap item (item ${it.collection}#${it.id} belum ada foto).`);
			}
			itemFotoFiles.set(key, f);
		}
		// Qty yang diambil harus persis sama dengan pengajuan di mode mandiri — tidak ada
		// override tanpa PIC yang memverifikasi.
		if (items.some((it) => it.qtyAktual != null)) {
			throw error(400, 'Jumlah yang diambil harus sama persis dengan pengajuan pada pengambilan mandiri.');
		}
	} else {
		if (settings['inventory.sji.require_photo_serah'] && !(fotoFile instanceof File)) {
			throw error(400, 'Foto bukti serah wajib diunggah.');
		}
		if (settings['inventory.sji.require_ttd'] && !(ttdFile instanceof File)) {
			throw error(400, 'Tanda tangan penerima wajib diisi.');
		}
	}
	if (settings['inventory.sji.require_gps'] && (lat == null || lng == null)) {
		throw error(400, 'Lokasi GPS wajib diaktifkan.');
	}

	const headerRes = await directusServerJson<{ data: any }>(
		`/items/sji_header/${id}?fields=id,reference_no,status,qr_token,gudang_id`
	).catch(() => null);
	const header = headerRes?.data;
	if (!header) throw error(404, 'SJI tidak ditemukan.');
	if (header.status !== 'disetujui') {
		throw error(409, `SJI berstatus "${header.status}" — hanya SJI disetujui yang bisa diserahkan.`);
	}
	if (token) {
		if (!header.qr_token || sha256Hex(token) !== header.qr_token) {
			throw error(403, 'Token QR tidak valid untuk SJI ini.');
		}
	}

	// Idempotency: kalau client_txn_id ini sudah pernah diproses sebelumnya (retry offline sync),
	// jangan potong stok dua kali — kembalikan hasil sebelumnya.
	if (clientTxnId) {
		const dupFilter = encodeURIComponent(JSON.stringify({ client_txn_id: { _eq: clientTxnId } }));
		const [dupPb, dupPi] = await Promise.all([
			directusServerJson<{ data: any[] }>(`/items/pengeluaran_barang?filter=${dupFilter}&fields=id&limit=1`),
			directusServerJson<{ data: any[] }>(`/items/peminjaman_internal?filter=${dupFilter}&fields=id&limit=1`)
		]);
		if ((dupPb?.data?.length || 0) > 0 || (dupPi?.data?.length || 0) > 0) {
			return json({ success: true, duplicate: true, message: 'Sudah diproses sebelumnya (idempotent).' });
		}
	}

	let fotoServahFileId: string | null = null;
	if (fotoFile instanceof File) {
		const uploadForm = new FormData();
		uploadForm.append('file', fotoFile, fotoFile.name);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto bukti serah.');
		fotoServahFileId = (await uploadRes.json())?.data?.id || null;
	}
	let ttdFileId: string | null = null;
	if (ttdFile instanceof File) {
		const uploadForm = new FormData();
		uploadForm.append('file', ttdFile, ttdFile.name);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah tanda tangan.');
		ttdFileId = (await uploadRes.json())?.data?.id || null;
	}

	let saksiTtdFileId: string | null = null;
	if (saksiTtdFile instanceof File) {
		const uploadForm = new FormData();
		uploadForm.append('file', saksiTtdFile, saksiTtdFile.name);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah tanda tangan saksi.');
		saksiTtdFileId = (await uploadRes.json())?.data?.id || null;
	}

	const itemFotoFileIds = new Map<string, string>();
	for (const [key, file] of itemFotoFiles) {
		const uploadForm = new FormData();
		uploadForm.append('file', file, file.name);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto barang.');
		const fileId = (await uploadRes.json())?.data?.id || null;
		if (fileId) itemFotoFileIds.set(key, fileId);
	}

	if (mode === 'mandiri') {
		await directusServerJson(`/items/sji_header/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({
				mode_serah: 'mandiri',
				saksi_karyawan_id: saksiKaryawan.id,
				saksi_kontak_hp: saksiKontak,
				saksi_ttd: saksiTtdFileId
			})
		}).catch(() => {});
	} else {
		await directusServerJson(`/items/sji_header/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ mode_serah: 'petugas' })
		}).catch(() => {});
	}

	const gudangId = typeof header.gudang_id === 'object' ? header.gudang_id?.id : header.gudang_id;

	const results: any[] = [];
	let stoppedEarly: string | null = null;

	for (const it of items) {
		if (stoppedEarly) break;
		try {
			const detailRes = await directusServerJson<{ data: any }>(
				`/items/${it.collection}/${it.id}?fields=*`
			);
			const rec = detailRes.data;
			if (!rec || rec.sji_header_id !== id) {
				throw new Error(`Item ${it.collection}#${it.id} bukan bagian dari SJI ini.`);
			}
			if (rec.status !== 'disetujui') {
				throw new Error(`Item ${it.collection}#${it.id} berstatus "${rec.status}", bukan disetujui.`);
			}

			const qty = it.qtyAktual && it.qtyAktual > 0 ? it.qtyAktual : rec.quantity;
			const isPeminjaman = it.collection === 'peminjaman_internal';
			const karyawanRef = isPeminjaman ? rec.peminjam_id : rec.karyawan_id;

			// FAIL-CLOSED: kalau ini throw, catch block di bawah menghentikan loop TANPA
			// mengubah status item — item tetap 'disetujui', bisa dicoba lagi nanti.
			const move = await sjiStockMovement({
				itemId: rec.item_id,
				type: 'OUT',
				quantity: qty,
				referenceNo: rec.reference_no,
				category: isPeminjaman ? 'BORROW' : 'ISSUANCE',
				destination: { destination_type: 'karyawan', destination_id: karyawanRef },
				referenceId: rec.id,
				referenceType: isPeminjaman ? 'PEMINJAMAN' : 'PENGELUARAN',
				gudangId
			});

			const patchBody: Record<string, any> = {
				foto_serah: fotoServahFileId,
				ttd_penerima: ttdFileId,
				foto_item: itemFotoFileIds.get(`fotoItem_${it.collection}_${it.id}`) || null,
				geo_lat: lat,
				geo_lng: lng,
				scan_method: mode === 'mandiri' ? 'manual' : token ? 'qr' : 'manual',
				client_txn_id: clientTxnId,
				gudang_id: gudangId
			};
			if (isPeminjaman) {
				patchBody.status = 'dipinjam';
				patchBody.tanggal_pinjam = new Date().toISOString().split('T')[0];
				patchBody.stock_out_transaction_id = move.id;
			} else {
				patchBody.status = 'diserahkan';
				patchBody.stock_transaction_id = move.id;
			}

			await directusServerJson(`/items/${it.collection}/${it.id}`, {
				method: 'PATCH',
				body: JSON.stringify(patchBody)
			});

			results.push({ collection: it.collection, id: it.id, success: true });
		} catch (e: any) {
			results.push({ collection: it.collection, id: it.id, success: false, error: e?.message || String(e) });
			stoppedEarly = e?.message || String(e);
		}
	}

	const successCount = results.filter((r) => r.success).length;
	const allItemsFilter = encodeURIComponent(JSON.stringify({ sji_header_id: { _eq: id } }));
	const [pbAll, piAll] = await Promise.all([
		directusServerJson<{ data: any[] }>(`/items/pengeluaran_barang?filter=${allItemsFilter}&fields=status&limit=-1`),
		directusServerJson<{ data: any[] }>(`/items/peminjaman_internal?filter=${allItemsFilter}&fields=status&limit=-1`)
	]);
	const allStatuses = [...(pbAll?.data || []), ...(piAll?.data || [])].map((r) => r.status);
	const allDelivered = allStatuses.every((s) => s === 'diserahkan' || s === 'dipinjam' || s === 'ditolak');
	const anyDelivered = allStatuses.some((s) => s === 'diserahkan' || s === 'dipinjam');

	await directusServerJson(`/items/sji_header/${id}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: allDelivered ? 'selesai' : anyDelivered ? 'sebagian_diserahkan' : header.status })
	});

	if (stoppedEarly && successCount === 0) {
		throw error(502, `Gagal memproses serah-terima: ${stoppedEarly}`);
	}

	return json({ success: true, results, partial: !!stoppedEarly });
};
