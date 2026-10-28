// src/routes/api/kiosk/muat-sj/+server.ts
// Kiosk Gudang — "Muat Barang": scan QR SJ + foto muatan → tahap `dimuat` + isi
// surat_jalan.foto_kirim. Multipart (foto opsional tapi disarankan). Guard: sesi kiosk.
// Idempoten via client_event_id. Tracking SJ v2 Fase 3c.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { casPatchBody } from '$lib/server/directusCas';
import { recordKioskTrackingEvent } from '$lib/server/sjTracking';
import { sjButuhSatpam } from '$lib/server/driver/berangkatGuard';
import { decideStatusAfterLoad } from '$lib/server/sjMuatRule';

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'muat_sj', 'Muat Barang');
	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Body tidak valid.');

	const sjId = Number(form.get('sjId'));
	const clientEventId = String(form.get('client_event_id') || '').trim();
	const catatan = form.get('catatan') ? String(form.get('catatan')).slice(0, 500) : null;
	const foto = form.get('foto');

	if (!Number.isFinite(sjId) || sjId <= 0) throw error(400, 'sjId tidak valid.');
	if (!clientEventId) throw error(400, 'client_event_id wajib (anti-duplikat).');

	const sj = (await directusServerJson<{ data: any }>(
		`/items/surat_jalan/${sjId}?fields=id,nomor_sj,status,track_stage,print_count,category`
	).catch(() => null))?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');

	// SJH-01 opsi A: SJ baru lahir 'created'; titik "menunggu gerbang" = SETELAH muat. Barang tidak boleh
	// dimuat/keluar tanpa SJ resmi tercetak (QR di kertas), jadi tolak sebelum foto diunggah.
	if (sj.status === 'created' && !(Number(sj.print_count) >= 1)) {
		throw error(409, 'SJ belum dicetak final — minta admin logistik mencetak dulu, lalu scan lagi.');
	}

	// upload foto (opsional)
	let fotoId: string | null = null;
	if (foto instanceof File && foto.size > 0) {
		if (foto.size > 8 * 1024 * 1024) throw error(400, 'Foto terlalu besar (maks 8 MB).');
		const up = new FormData();
		up.append('title', `Muat SJ ${sj.nomor_sj} - ${session.nama}`);
		up.append('file', foto, `muat-sj-${sjId}-${Date.now()}.jpg`);
		const r = await directusServerUpload(up);
		if (!r.ok) throw error(502, 'Gagal mengunggah foto muatan.');
		fotoId = (await r.json().catch(() => null))?.data?.id ?? null;
	}

	if (fotoId) {
		await directusServerJson(`/items/surat_jalan/${sjId}`, {
			method: 'PATCH', body: JSON.stringify({ foto_kirim: fotoId })
		}).catch((e) => console.error('[muat-sj] patch foto_kirim gagal:', e));
	}

	const out = await recordKioskTrackingEvent({
		sjId,
		stageTo: 'dimuat',
		actor: { id: session.karyawanId, nama: session.nama, role: 'gudang' },
		fotoId,
		notes: catatan || 'Muat barang ke kendaraan',
		clientEventId
	});

	// SJH-01 opsi A: pindahkan status SETELAH muat. Kategori butuh satpam -> needs_security_check (masuk antrian
	// gerbang), selain itu -> shipped. CAS (status MASIH 'created') agar dua scan bersamaan tak saling timpa;
	// SJ yang sudah bukan 'created' (saklar darurat OFF = langsung shipped, SJ lama) tidak disentuh.
	let newStatus: string | null = null;
	const needsGate = sj.status === 'created' ? await sjButuhSatpam(sj.category) : false;
	const next = decideStatusAfterLoad(sj.status, needsGate);
	if (next) {
		const patchRes = await directusServerJson<{ data: any[] }>('/items/surat_jalan', {
			method: 'PATCH',
			body: casPatchBody([{ id: { _eq: sjId } }, { status: { _eq: 'created' } }], { status: next.status, draft_status: next.draft_status })
		}).catch((e) => {
			console.error('[muat-sj] gagal memindahkan status setelah muat:', e instanceof Error ? e.message : e);
			throw error(502, 'Muat tercatat, tapi status SJ gagal diperbarui. Scan ulang untuk mencoba lagi.');
		});
		if (Array.isArray(patchRes?.data) && patchRes.data.length > 0) {
			newStatus = next.status;
			if (next.status === 'needs_security_check') {
				await directusServerJson('/items/app_notifications', {
					method: 'POST',
					body: JSON.stringify({
						type: 'surat_jalan',
						title: `SJ ${sj.nomor_sj} menunggu pemeriksaan gerbang`,
						message: 'Barang sudah dimuat. Satpam perlu cek fisik (jumlah/plat/driver) sebelum truk keluar.',
						priority: 'high', department: 'keamanan', read: false,
						created_at: new Date().toISOString()
					})
				}).catch(() => {});
			}
		}
	}

	return json({ success: true, ...out, new_status: newStatus, masuk_antrian_satpam: newStatus === 'needs_security_check' });
};
