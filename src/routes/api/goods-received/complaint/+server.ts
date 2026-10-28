// src/routes/api/goods-received/complaint/+server.ts
// Komplain manual (Fase 3, Gap #4) — dipakai lapangan untuk melaporkan masalah
// yang TIDAK terdeteksi otomatis dari selisih qty saat GR (mis. barang salah,
// rusak yang baru terlihat setelah dibongkar, masalah mutu). Berbeda dari klaim
// otomatis di /api/goods-received/confirm (sumber=auto_qty), komplain ini selalu
// sumber=manual dan tidak memicu reklas HPP — hanya masuk ke logistik_klaim untuk
// ditindaklanjuti Admin/Inventory (lihat ProjectLogistikGRPanel di erp-epi-1).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGRActor } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';

const TIPE_TO_JENIS: Record<string, 'kurang' | 'rusak' | 'hilang'> = {
	wrong_item: 'kurang',
	damaged: 'rusak',
	quality_issue: 'rusak',
	other: 'kurang'
};

/** Cari Surat Jalan yang sudah diterima (untuk dipilih sebagai target komplain manual). */
export const GET: RequestHandler = async (event) => {
	await authenticateGRActor(event);
	const q = event.url.searchParams.get('q')?.trim() || '';
	if (q.length < 2) return json({ shipments: [] });

	const query = new URLSearchParams({
		filter: JSON.stringify({
			nomor_sj: { _icontains: q },
			status: { _in: ['received', 'complete', 'closed'] }
		}),
		fields: 'id,nomor_sj,driver,received_at,status',
		sort: '-received_at',
		limit: '10'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/surat_jalan?${query.toString()}`);
	return json({ shipments: result?.data || [] });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateGRActor(event);

	const body = await event.request.json().catch(() => null);
	const suratJalanId = Number(body?.suratJalanId);
	const tipeKomplain: string = body?.tipeKomplain || 'other';
	const keterangan: string = body?.keterangan || '';
	const evidenceFileIds: string[] = Array.isArray(body?.evidenceFileIds) ? body.evidenceFileIds : [];
	const qtyKlaim = Number(body?.qtyKlaim) || 0;
	const nilaiKlaim = Number(body?.nilaiKlaim) || 0;

	if (!Number.isFinite(suratJalanId)) throw error(400, 'suratJalanId tidak valid.');
	if (!keterangan.trim()) throw error(400, 'Keterangan komplain wajib diisi.');
	if (evidenceFileIds.length === 0) throw error(400, 'Minimal satu foto bukti wajib diunggah.');

	const sj = (await directusServerJson<{ data: any }>(
		`/items/surat_jalan/${suratJalanId}?fields=id,nomor_sj,status`
	).catch(() => null))?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');
	// Komplain hanya relevan untuk SJ yang sudah (pernah) diterima — bukan yang masih di gudang.
	if (!['received', 'complete', 'closed'].includes(sj.status)) {
		throw error(400, `Surat Jalan ${sj.nomor_sj} belum dikonfirmasi diterima — komplain hanya untuk SJ yang sudah diterima.`);
	}

	const jenis = TIPE_TO_JENIS[tipeKomplain] || 'kurang';

	const claim = await directusServerJson<{ data: any }>('/items/logistik_klaim', {
		method: 'POST',
		body: JSON.stringify({
			surat_jalan_id: suratJalanId,
			jenis,
			tipe_komplain: tipeKomplain,
			sumber: 'manual',
			qty_klaim: qtyKlaim,
			nilai_klaim: nilaiKlaim,
			pihak: 'internal',
			status: 'diajukan',
			diajukan_oleh: karyawan.nama_karyawan,
			keterangan,
			evidence_files: evidenceFileIds
		})
	});

	// Auto-ingest ke customer_complaints untuk komplain kualitas/kerusakan cat lapangan
	try {
		const nowIso = new Date().toISOString();
		const slaMs = Date.now() + 48 * 3600000;
		await directusServerJson('/items/customer_complaints', {
			method: 'POST',
			body: JSON.stringify({
				tanggal: nowIso.slice(0, 10),
				kategori: tipeKomplain === 'quality_issue' ? 'kualitas' : 'pengiriman',
				deskripsi: `[Komplain Lapangan SJ #${sj.nomor_sj}] ${keterangan}`.trim(),
				status: 'diterima',
				site: 'pusat',
				pic: karyawan.nama_karyawan,
				status_changed_at: nowIso,
				sla_due_at: new Date(slaMs).toISOString(),
				foto: evidenceFileIds?.[0] || null
			})
		});
	} catch (e) {
		console.warn('[goods-received/complaint] gagal auto-ingest ke customer_complaints (diabaikan):', e);
	}

	return json({ success: true, claimId: claim?.data?.id ?? null });
};
