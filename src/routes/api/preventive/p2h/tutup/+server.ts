// src/routes/api/preventive/p2h/tutup/+server.ts
// Pertajaman P2H (26 Agu 2026): menutup sesi P2H harian yang sudah ada di akhir
// pemakaian unit — TIDAK membuat sesi baru, hanya PATCH jam_selesai_pakai +
// signature_selesai + catatan_selesai ke p2h_session yang sudah diisi operator
// saat mulai pakai (submit awal, endpoint p2h/submit tidak diubah).
// Sengaja tidak menyentuh idempotensi/antrian offline submit awal yang sudah teruji.
//
// PMT-49 (6 Nov 2026): isian penutupan cukup KONDISI + TANDA TANGAN. Foto wajib hanya bila
// kondisi bukan "baik" (ada temuan). Kondisi "dilarang" -> unit under_repair + notifikasi
// (+ WO bila setelan mle.equipment.p2h_auto_wo aktif, sama dengan submit awal).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticatePreventiveOperator } from '$lib/server/preventive/preventiveGuard';
import { directusServerJson } from '$lib/server/directus';
import { getMleSettingServer } from '$lib/server/mleSettings';
import { notifyProjectP2hTutupDilarang } from '$lib/server/projectNotify';

const KONDISI_VALID = ['baik', 'perlu_periksa', 'dilarang'] as const;
type Kondisi = (typeof KONDISI_VALID)[number];

// Sama dengan P2H_WO_IDS di p2h/submit/+server.ts — jangan diubah sepihak.
const P2H_WO_IDS = {
	DARURAT: 'c8006ed8-b434-402f-9fb0-97c2f5284a42',
	CORRECTIVE: '561ad0b7-c246-4c24-bb66-5cc7e123fbda',
	STATUS_OPEN: '0e119df1-b7e5-44c1-ace4-d14c5a99c10b'
};

function wibDateString(d = new Date()): string {
	return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export const POST: RequestHandler = async (event) => {
	const { personnel } = await authenticatePreventiveOperator(event);

	const body = await event.request.json().catch(() => null);
	const sessionId = body?.session_id ? String(body.session_id) : '';
	const signature = body?.signature ? String(body.signature).trim() : '';
	const catatanSelesai = body?.catatan_selesai ? String(body.catatan_selesai).trim() : null;
	// Kompatibel mundur: klien/antrian offline lama tidak mengirim kondisi -> dianggap "baik".
	const kondisiRaw = body?.kondisi ? String(body.kondisi) : 'baik';
	const foto = body?.foto_selesai ? String(body.foto_selesai) : null;

	if (!sessionId) throw error(400, 'session_id wajib diisi.');
	if (!signature) throw error(400, 'Tanda tangan penutupan wajib diisi.');
	if (!(KONDISI_VALID as readonly string[]).includes(kondisiRaw)) {
		throw error(400, 'Kondisi tidak valid. Pilih: baik, perlu_periksa, atau dilarang.');
	}
	const kondisi = kondisiRaw as Kondisi;
	if (kondisi !== 'baik' && !foto) {
		throw error(400, 'Foto temuan wajib dilampirkan bila kondisi unit bukan "baik".');
	}

	// "Tidak ditemukan" dibedakan dari "gagal membaca" (Aturan #1 — error asli tidak ditelan).
	let session: any = null;
	try {
		const sessionRes = await directusServerJson<{ data: any }>(
			`/items/p2h_session/${encodeURIComponent(sessionId)}?fields=id,equipment_id,operator_id,date,jam_selesai_pakai,work_order_id`
		);
		session = sessionRes?.data ?? null;
	} catch (err: any) {
		// directusServerJson hanya melempar Error(message) tanpa status — kenali pesan "tidak ada" Directus.
		if (/\b404\b|does not exist|not exist|tidak ditemukan/i.test(String(err?.message ?? ''))) {
			throw error(404, 'Sesi P2H tidak ditemukan.');
		}
		console.error('[p2h/tutup] gagal membaca p2h_session', sessionId, err);
		throw error(502, 'Gagal membaca data sesi P2H dari server. Coba lagi sebentar lagi.');
	}
	if (!session) throw error(404, 'Sesi P2H tidak ditemukan.');
	if (session.jam_selesai_pakai) throw error(409, 'Sesi ini sudah ditutup sebelumnya.');

	const patched = await directusServerJson<{ data: any }>(`/items/p2h_session/${encodeURIComponent(sessionId)}`, {
		method: 'PATCH',
		body: JSON.stringify({
			jam_selesai_pakai: new Date().toISOString(),
			signature_selesai: signature,
			catatan_selesai: catatanSelesai,
			status_unit_selesai: kondisi,
			foto_selesai: foto
		})
	});

	let workOrderId: string | null = null;
	if (kondisi === 'dilarang' && session.equipment_id) {
		// Interlock: gagal mengunci unit TIDAK membatalkan penutupan (sudah tersimpan), tapi harus terlihat di log.
		await directusServerJson(`/items/equipment/${session.equipment_id}`, {
			method: 'PATCH',
			body: JSON.stringify({ status_operational: 'under_repair' })
		}).catch((err) => {
			console.error('[p2h/tutup] gagal set under_repair untuk equipment', session.equipment_id, err);
		});

		try {
			const autoWoEnabled = await getMleSettingServer('mle.equipment.p2h_auto_wo', true);
			if (autoWoEnabled && !session.work_order_id) {
				const woRes = await directusServerJson<{ data: any }>('/items/work_order', {
					method: 'POST',
					body: JSON.stringify({
						equipment_id: session.equipment_id,
						keluhan: `[DILARANG DIPAKAI saat tutup pemakaian] ${catatanSelesai || 'Operator menandai unit dilarang dipakai.'}`,
						kategori_perbaikan_id: P2H_WO_IDS.DARURAT,
						jenis_pekerjaan_id: P2H_WO_IDS.CORRECTIVE,
						order_status: P2H_WO_IDS.STATUS_OPEN,
						tanggal_rusak: wibDateString(),
						is_quick_create: true,
						alasan_pengajuan: 'Auto P2H tutup pemakaian — unit ditandai dilarang dipakai'
					})
				});
				workOrderId = woRes?.data?.id ?? null;
				if (workOrderId) {
					await directusServerJson(`/items/p2h_session/${encodeURIComponent(sessionId)}`, {
						method: 'PATCH',
						body: JSON.stringify({ work_order_id: workOrderId })
					});
				}
			}
		} catch (err) {
			console.error('[p2h/tutup] gagal membuat WO untuk sesi', sessionId, err);
		}

		await notifyProjectP2hTutupDilarang(sessionId, `unit ${session.equipment_id}`, personnel.id);
	}

	return json({ session: patched.data, workOrderId });
};
