// src/routes/api/goods-received/complaint/+server.ts
// Komplain manual (Fase 3, Gap #4) — dipakai lapangan untuk melaporkan masalah
// yang TIDAK terdeteksi otomatis dari selisih qty saat GR (mis. barang salah,
// rusak yang baru terlihat setelah dibongkar, masalah mutu). Berbeda dari klaim
// otomatis di /api/goods-received/confirm (sumber=auto_qty), komplain ini selalu
// sumber=manual dan tidak memicu reklas HPP — hanya masuk ke logistik_klaim untuk
// ditindaklanjuti Admin/Inventory (lihat ProjectLogistikGRPanel di erp-epi-1), plus
// barang_bermasalah_log (F2 Skema Ketidaksesuaian) agar tampil di antrean Barang Bermasalah.
// Belum mengunci saldo stok proyek / membalik HPP — itu menunggu keputusan Fase 2 (kunci otomatis?).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGRActor } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';

import { tipeToKlaimJenis, normalizeSumberMasalah, buildKomplainLogPayload, buildReturSiap, SUMBER_MASALAH_LABEL } from '$lib/server/goodsReceived/mismatchLog';

interface SjBarang {
	identitasBarangId: number;
	namaBarang: string;
	qtySent: number;
	unit: string | null;
}

/** Barang pada SJ yang punya barang master (identitas_barang_id) — hanya ini yang bisa dikunci per barang. Satu query. */
async function loadSjBarang(suratJalanId: number): Promise<SjBarang[]> {
	const query = new URLSearchParams({
		filter: JSON.stringify({ surat_jalan_id: { _eq: suratJalanId } }),
		fields: 'id,material_name,unit,identitas_barang_id,qty_sent',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/project_expenses?${query.toString()}`);
	const seen = new Set<number>();
	const out: SjBarang[] = [];
	for (const r of res?.data || []) {
		const id = Number(r.identitas_barang_id?.id ?? r.identitas_barang_id);
		if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
		seen.add(id);
		out.push({ identitasBarangId: id, namaBarang: r.material_name || `Barang #${id}`, qtySent: parseFloat(r.qty_sent) || 0, unit: r.unit || null });
	}
	return out;
}

/** Cari Surat Jalan yang sudah diterima (untuk dipilih sebagai target komplain manual); `?sjId=` = daftar barang SJ itu. */
export const GET: RequestHandler = async (event) => {
	await authenticateGRActor(event);
	const sjIdParam = event.url.searchParams.get('sjId');
	if (sjIdParam) {
		const sjId = Number(sjIdParam);
		if (!Number.isFinite(sjId)) throw error(400, 'sjId tidak valid.');
		return json({ items: await loadSjBarang(sjId) });
	}
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
		`/items/surat_jalan/${suratJalanId}?fields=id,nomor_sj,status,project_id`
	).catch(() => null))?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');
	// Komplain hanya relevan untuk SJ yang sudah (pernah) diterima — bukan yang masih di gudang.
	if (!['received', 'complete', 'closed'].includes(sj.status)) {
		throw error(400, `Surat Jalan ${sj.nomor_sj} belum dikonfirmasi diterima — komplain hanya untuk SJ yang sudah diterima.`);
	}

	// Skema Ketidaksesuaian F2: 'wrong_item' kini tercatat sebagai jenis 'salah_spek' (dulu 'kurang'), dan sumber masalahnya
	// (salah kirim gudang/vendor vs salah pesan proyek) ikut dicatat agar Admin memilih disposisi yang tepat.
	// Barang yang dikomplain (pilihan Project Leader) — dasar KUNCI per barang di Laporan Harian (G_PROYEK_KOMPLAIN_LOCK).
	// Dicek terhadap barang SJ ini (tidak percaya id dari klien). Wajib untuk tipe fisik bila SJ punya barang master.
	const sjBarang = await loadSjBarang(suratJalanId).catch((e) => {
		console.error(`[goods-received/complaint] gagal baca barang SJ ${sj.nomor_sj} (komplain tanpa pilihan barang):`, e instanceof Error ? e.message : e);
		return [] as SjBarang[];
	});
	const allowedById = new Map(sjBarang.map((b) => [b.identitasBarangId, b]));
	const itemsInput: Array<{ identitasBarangId?: number; qty?: number }> = Array.isArray(body?.items) ? body.items : [];
	const selectedBarang: Array<SjBarang & { qty: number }> = [];
	for (const it of itemsInput) {
		const b = allowedById.get(Number(it?.identitasBarangId));
		if (!b) throw error(400, 'Ada barang yang dipilih bukan bagian dari Surat Jalan ini.');
		if (selectedBarang.some((s) => s.identitasBarangId === b.identitasBarangId)) continue;
		selectedBarang.push({ ...b, qty: Math.max(Number(it?.qty) || 0, 0) });
	}
	if (tipeKomplain !== 'other' && sjBarang.length > 0 && selectedBarang.length === 0) {
		throw error(400, 'Pilih minimal satu barang yang bermasalah (agar barang itu dikunci dari Laporan Harian sampai Admin memutuskan).');
	}

	const jenis = tipeToKlaimJenis(tipeKomplain);
	const sumberMasalah = normalizeSumberMasalah(body?.sumberMasalah);
	const keteranganFinal = tipeKomplain === 'wrong_item' ? `[Sumber: ${SUMBER_MASALAH_LABEL[sumberMasalah]}] ${keterangan}` : keterangan;
	const projectId = Number(sj.project_id?.id ?? sj.project_id) || null;

	const claim = await directusServerJson<{ data: any }>('/items/logistik_klaim', {
		method: 'POST',
		body: JSON.stringify({
			surat_jalan_id: suratJalanId,
			...(projectId ? { project_id: projectId } : {}),
			jenis,
			tipe_komplain: tipeKomplain,
			sumber: 'manual',
			qty_klaim: qtyKlaim,
			nilai_klaim: nilaiKlaim,
			pihak: 'internal',
			status: 'diajukan',
			diajukan_oleh: karyawan.nama_karyawan,
			keterangan: keteranganFinal,
			evidence_files: evidenceFileIds
		})
	});

	// Sinkron ke antrean Barang Bermasalah (erp-epi /inventory/barang-bermasalah) supaya Admin Gudang melihatnya di satu tempat.
	// Klaim sudah tersimpan, jadi kegagalan di sini TIDAK menggagalkan komplain — tetapi dilaporkan di respons & di log (tidak ditelan).
	let bermasalahLogged = true;
	// Satu baris per barang terpilih (item_id terisi => terkunci); tanpa pilihan barang = satu baris tingkat-SJ (tidak mengunci).
	const logTargets = selectedBarang.length > 0 ? selectedBarang : [null];
	for (const target of logTargets) {
		try {
			await directusServerJson('/items/barang_bermasalah_log', {
				method: 'POST',
				body: JSON.stringify(
					buildKomplainLogPayload({
						nomorSj: sj.nomor_sj,
						suratJalanId,
						projectId,
						reporter: karyawan.nama_karyawan,
						tipe: tipeKomplain,
						sumber: sumberMasalah,
						qty: target ? target.qty || qtyKlaim : qtyKlaim,
						itemId: target?.identitasBarangId ?? null,
						namaBarang: target ? `${target.namaBarang} (komplain SJ ${sj.nomor_sj})` : null,
						keterangan,
						evidenceFileIds
					})
				)
			});
		} catch (e) {
			bermasalahLogged = false;
			console.error(`[goods-received/complaint] gagal sinkron ke barang_bermasalah_log (SJ ${sj.nomor_sj}, klaim ${claim?.data?.id}, barang ${target?.identitasBarangId ?? '-'}):`, e instanceof Error ? e.message : e);
		}
	}

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

	// Item retur yang bisa diajukan satu klik oleh Project Leader (lewat alur retur lapangan yang ada; null bila tak memenuhi syarat).
	const returSiap = buildReturSiap({ tipe: tipeKomplain, nomorSj: sj.nomor_sj, projectId, keterangan, items: selectedBarang.map((b) => ({ ...b })) });

	return json({ success: true, claimId: claim?.data?.id ?? null, bermasalahLogged, lockedItems: selectedBarang.length, returSiap });
};
