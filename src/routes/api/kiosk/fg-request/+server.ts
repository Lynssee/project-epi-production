// src/routes/api/kiosk/fg-request/+server.ts
// Fase 5b, docs/(eh) rencana-kiosk-menu-lain-fase5 §5 -- "opsi notifikasi" (repo erp-epi-1).
// Checker gudang kiosk membuat request (rak saran + foto + catatan) langsung di Directus
// fg_receive_request -- TIDAK PERNAH memanggil logika receiveFinishedGoods() yang
// sesungguhnya. Admin tetap wajib menyelesaikan serah-terima lewat dashboard.
//
// Aturan Arsitektur:
// - Directus fetching must be separated for each relation
// - Mandiri & tahan gangguan: tidak bergantung proxy loopback yang rentan 404
// - Fail-safe notification ke admin

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { listRakUnder } from '$lib/server/kioskTransfer';

export const GET: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'fg_receive', 'Terima Barang Jadi');

	// File 09 §A.3 — daftar rak dari master gudang (bukan RAK_CHIPS hardcode), reuse
	// listRakUnder yang sudah ada (dipakai Transfer), bukan query baru.
	const gudangId = Number(event.url.searchParams.get('gudang_id'));
	if (event.url.searchParams.get('rak') === '1') {
		if (!Number.isFinite(gudangId) || gudangId <= 0) return json({ rak: [] });
		const rak = await listRakUnder(gudangId).catch((e) => {
			console.error('[fg-request] gagal memuat daftar rak', e);
			return [];
		});
		return json({ rak });
	}

	const tab = event.url.searchParams.get('tab') || 'ready';

	try {
		// 1. Ambil daftar SPK (Siap Diterima vs Lapor Fisik di Transit)
		const spkEndpoint =
			tab === 'transit'
				? `/items/spk?filter[status][_in]=requested,worksheet_generated,in_progress,qc_pending&filter[finished_goods_status][_neq]=READY_FOR_WAREHOUSE&fields=id,nomor,batch_no,status,product_id,actual_quantity_produced,target_kg,unit,tanggal&sort=-tanggal&limit=50`
				: `/items/spk?filter[finished_goods_status][_eq]=READY_FOR_WAREHOUSE&fields=id,nomor,batch_no,status,product_id,actual_quantity_produced,unit,tanggal&sort=-tanggal&limit=50`;

		const spkRes = await directusServerJson<{ data: any[] }>(spkEndpoint).catch((err) => {
			console.error('[fg-request] Gagal memuat SPK dari Directus:', err);
			return { data: [] };
		});
		const spkRows = spkRes?.data || [];

		if (spkRows.length === 0) {
			return json({ spkList: [] });
		}

		// 2. Query relasi produk terpisah (Aturan #2: Directus fetching must be separated for each relation)
		const productIds = Array.from(
			new Set(
				spkRows
					.map((s) => (typeof s.product_id === 'object' && s.product_id !== null ? s.product_id.id : s.product_id))
					.filter((id): id is number | string => id !== null && id !== undefined && id !== '')
			)
		);

		const productMap = new Map<string | number, { id: string | number; nama_barang_lengkap: string; kode_item?: string }>();
		if (productIds.length > 0) {
			try {
				const prodRes = await directusServerJson<{ data: any[] }>(
					`/items/identitas_barang?filter[id][_in]=${productIds.join(',')}&fields=id,nama_barang_lengkap,kode_item&limit=100`
				);
				for (const p of prodRes?.data || []) {
					if (p?.id != null) {
						productMap.set(p.id, p);
					}
				}
			} catch (e) {
				console.warn('[fg-request] Gagal memuat data relasi identitas_barang:', e);
			}
		}

		// 3. Query daftar request pending agar kiosk menandai SPK yang sudah dikirim ke admin
		const spkIds = spkRows.map((s) => s.id);
		const pendingSet = new Set<number>();
		try {
			const pendingRes = await directusServerJson<{ data: any[] }>(
				`/items/fg_receive_request?filter[spk_id][_in]=${spkIds.join(',')}&filter[status][_eq]=pending&fields=spk_id&limit=-1`
			);
			for (const r of pendingRes?.data || []) {
				if (r?.spk_id != null) {
					pendingSet.add(Number(r.spk_id));
				}
			}
		} catch (e) {
			console.warn('[fg-request] Gagal memuat data fg_receive_request pending:', e);
		}

		// 4. Susun daftar lengkap
		const spkList = spkRows.map((s) => {
			const rawPid = typeof s.product_id === 'object' && s.product_id !== null ? s.product_id.id : s.product_id;
			const prod = rawPid ? productMap.get(rawPid) : null;
			return {
				id: s.id,
				nomor: s.nomor,
				batch_no: s.batch_no,
				status: s.status,
				actual_quantity_produced: s.actual_quantity_produced || s.target_kg,
				unit: s.unit || 'kg',
				product_id: {
					id: rawPid,
					nama_barang_lengkap:
						prod?.nama_barang_lengkap ||
						(typeof s.product_id === 'object' && s.product_id !== null ? s.product_id.nama_barang_lengkap : '') ||
						'-'
				},
				hasPendingRequest: pendingSet.has(Number(s.id))
			};
		});

		return json({ spkList });
	} catch (e: any) {
		console.error('[fg-request] Error di GET fg-request:', e);
		throw error(500, e?.message || 'Gagal memuat daftar SPK.');
	}
};

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'fg_receive', 'Terima Barang Jadi');

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const spkId = form.get('spkId');
	const rakSaran = form.get('rakSaran') ? String(form.get('rakSaran')).trim().slice(0, 255) : null;
	const rakSaranId = Number(form.get('rakSaranId')) || null;
	const catatan = form.get('catatan') ? String(form.get('catatan')).trim().slice(0, 1000) : null;
	const foto = form.get('foto');
	const clientTxnId = form.get('clientTxnId');
	const isPhysicalReport = form.get('isPhysicalReport') === 'true';

	// Hitungan fisik checker
	const qtyDiterimaRaw = form.get('qtyDiterima');
	const qtyDiterima = qtyDiterimaRaw != null && qtyDiterimaRaw !== '' ? Number(qtyDiterimaRaw) : null;
	const qtySelisihAlasan = form.get('qtySelisihAlasan') ? String(form.get('qtySelisihAlasan')).trim().slice(0, 255) : null;

	if (!spkId) throw error(400, 'spkId wajib diisi.');
	if (!clientTxnId) throw error(400, 'clientTxnId wajib diisi.');
	if (!(foto instanceof File) || foto.size === 0) throw error(400, 'Foto bukti barang diterima wajib diisi.');
	if (qtyDiterima !== null && (!Number.isFinite(qtyDiterima) || qtyDiterima < 0)) throw error(400, 'Jumlah diterima tidak valid.');

	const sid = parseInt(String(spkId), 10);
	if (!Number.isFinite(sid)) throw error(400, 'spkId tidak valid.');

	// 1. Cek idempotensi di Directus fg_receive_request
	const existingRes = await directusServerJson<{ data: any[] }>(
		`/items/fg_receive_request?filter[client_txn_id][_eq]=${encodeURIComponent(String(clientTxnId))}&limit=1`
	).catch(() => ({ data: [] }));
	if (existingRes?.data?.[0]) {
		return json({ success: true, request: existingRes.data[0], alreadyDone: true });
	}

	// 2. Tolak request pending ganda untuk SPK yang sama
	const pendingRes = await directusServerJson<{ data: any[] }>(
		`/items/fg_receive_request?filter[spk_id][_eq]=${sid}&filter[status][_eq]=pending&fields=id,checker_nama&limit=1`
	).catch(() => ({ data: [] }));
	if (pendingRes?.data?.[0]) {
		throw error(409, `SPK ini sudah diajukan oleh ${pendingRes.data[0].checker_nama}. Tunggu admin memproses.`);
	}

	// 3. Validasi status SPK
	const spkRes = await directusServerJson<{ data: any }>(
		`/items/spk/${sid}?fields=id,nomor,batch_no,status,finished_goods_status`
	).catch(() => ({ data: null }));
	const spk = spkRes?.data;
	if (!spk) throw error(404, 'SPK tidak ditemukan.');

	if (!isPhysicalReport && spk.finished_goods_status !== 'READY_FOR_WAREHOUSE') {
		throw error(400, `SPK ini belum siap diserahterimakan (status: ${spk.finished_goods_status || 'kosong'}). Gunakan tab "Lapor Fisik di Transit" jika barang fisik sudah ada.`);
	}

	// 4. Upload foto bukti ke Directus
	const uploadForm = new FormData();
	uploadForm.append('file', foto, `fg-${isPhysicalReport ? 'transit' : 'receive'}-${sid}-${Date.now()}.jpg`);
	const uploadRes = await directusServerUpload(uploadForm);
	if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto bukti penerimaan.');
	const uploaded = await uploadRes.json();
	const fotoId = uploaded?.data?.id;
	if (!fotoId) throw error(502, 'Gagal mengunggah foto bukti penerimaan.');

	// 5. Simpan request ke koleksi fg_receive_request
	const now = new Date().toISOString();
	const finalCatatan = isPhysicalReport
		? `[LAPOR_FISIK_TRANSIT] ${catatan || 'Fisik cat dilaporkan sudah tiba di area transit.'}`
		: catatan || null;

	const insertRes = await directusServerJson<{ data: any }>('/items/fg_receive_request', {
		method: 'POST',
		body: JSON.stringify({
			spk_id: sid,
			spk_nomor: spk.nomor,
			karyawan_id: session.karyawanId,
			checker_nama: session.nama,
			rak_saran: rakSaran || null,
			rak_saran_id: rakSaranId,
			qty_diterima: qtyDiterima,
			qty_selisih_alasan: qtySelisihAlasan,
			foto: fotoId,
			catatan: finalCatatan,
			status: 'pending',
			created_at: now,
			client_txn_id: String(clientTxnId)
		})
	});
	const request = insertRes?.data || null;

	// 6. Tulis in-app notification langsung ke Directus app_notifications (Single Source of Truth)
	if (isPhysicalReport) {
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'fg_physical_transit',
				title: `📢 Pallet Fisik Siap di Transit - SPK ${spk.nomor}`,
				message: `Checker ${session.nama} melaporkan fisik cat (${qtyDiterima || 0} kg) sudah berada di transit gudang, tapi SPK berstatus ${spk.status}. Mohon QC & Formulator segera menyelesaikan verifikasi!`,
				priority: 'high',
				department: 'production',
				action_required: true,
				action_url: `/production?search=${encodeURIComponent(spk.nomor || '')}`,
				source_collection: 'fg_receive_request',
				source_id: String(request?.id || ''),
				spk_id: sid,
				spk_number: spk.nomor,
				quantity: qtyDiterima != null ? Number(qtyDiterima) : null,
				unit: 'kg',
				read: false,
				created_at: now
			})
		}).catch((err) => {
			console.warn('[fg-request] Gagal simpan app_notifications (diabaikan):', err?.message || err);
		});
	}

	// 7. Notifikasi fire-and-forget ke admin & n8n
	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	const secret = env.AUTOMATION_SERVER_SECRET || env.PRODUCTION_AUTOMATION_SECRET;
	if (baseUrl && secret && !baseUrl.includes('localhost')) {
		const action = isPhysicalReport ? 'notify_physical_transit' : 'notify_request';
		fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/fg-kiosk`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Automation-Secret': secret,
				'X-Kiosk-Actor': String(session.karyawanId)
			},
			body: JSON.stringify({ action, requestId: request?.id })
		}).catch((err) => {
			console.warn('[fg-request] Notifikasi upstream dilewati:', err?.message || err);
		});
	}

	return json({ success: true, request, isPhysicalReport });
};
