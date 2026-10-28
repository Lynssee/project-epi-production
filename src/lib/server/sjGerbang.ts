// src/lib/server/sjGerbang.ts
// SJH-14 — SATU fungsi meloloskan SJ di gerbang, dipakai kiosk (gerbang-sj/loloskan) dan jalur
// aplikasi (sj-security-check). Beda keduanya hanya autentikasi & pembentukan actor.
// Isi: checklist 3 item wajib OK, guard minimum (SJH-12), CAS anti-balapan, draft_status siap_kirim,
// foto + GPS, dan event tracking `lolos_gerbang` (idempoten via clientEventId).

import { error } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { casPatchBody } from '$lib/server/directusCas';
import { recordKioskTrackingEvent } from '$lib/server/sjTracking';
import { getGerbangBlockersDetailed, GERBANG_GUARD_FIELDS } from '$lib/server/sjGerbangGuard';

export type PassSjInput = {
	sjId: number;
	actor: { id?: number; nama: string };
	/** nilai security_verified_by, mis. "KIOSK/<nama>" atau "APP/<nama>" */
	verifiedBy: string;
	checklist: { jumlah_ok?: boolean; plat_ok?: boolean; driver_ok?: boolean; catatan?: string | null; [k: string]: unknown };
	fotoId?: string | null;
	gps?: { lat?: number; lng?: number; accuracy?: number } | null;
	clientEventId: string;
	source: 'kiosk' | 'app';
	/** tambahan ke security_checklist (mis. hasil cek ronda/P2H dari jalur aplikasi) */
	extraChecklist?: Record<string, unknown>;
};

export async function passSjAtGate(input: PassSjInput): Promise<{ already_passed: boolean; newStatus?: 'shipped' }> {
	const { sjId, actor, checklist, fotoId = null, clientEventId, source } = input;

	if (!checklist.jumlah_ok || !checklist.plat_ok || !checklist.driver_ok) {
		throw error(400, 'Ketiga item checklist (jumlah / plat / driver) wajib OK sebelum diloloskan. Kalau ada yang tidak sesuai, gunakan "Tahan".');
	}
	const trackActor = { id: actor.id, nama: actor.nama, role: 'satpam' };
	const noteSrc = source === 'kiosk' ? '' : ' (aplikasi)';
	const idem = (notes: string) =>
		recordKioskTrackingEvent({ sjId, stageTo: 'lolos_gerbang', actor: trackActor, fotoId, notes, clientEventId })
			.catch((e) => console.error('[sjGerbang] event idempoten gagal:', e));

	const sj = (await directusServerJson<{ data: any }>(
		`/items/surat_jalan/${sjId}?fields=${GERBANG_GUARD_FIELDS},security_verified_at`
	).catch(() => null))?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');

	if (sj.security_verified_at || sj.status === 'shipped') {
		await idem('Loloskan (sudah pernah lolos)');
		return { already_passed: true };
	}
	if (sj.status !== 'needs_security_check') {
		throw error(409, `SJ ${sj.nomor_sj} berstatus "${sj.status}", bukan "needs_security_check".`);
	}

	// SJH-12: barang tidak boleh keluar tanpa SJ resmi tercetak / disetujui / bebas barang bermasalah.
	// + gate titik gerbang dari erp-epi (fail-safe: tidak terhubung = tidak dikunci, dicatat di gate_check).
	const { blockers, gate_check } = await getGerbangBlockersDetailed(sj);
	if (blockers.length) throw error(409, blockers.map((b) => b.message).join(' '));

	const gps = input.gps && Number.isFinite(Number(input.gps.lat))
		? { lat: Number(input.gps.lat), lng: Number(input.gps.lng), accuracy: Number(input.gps.accuracy) }
		: null;

	// CAS: PATCH hanya berlaku bila status MASIH needs_security_check saat tulis (filter = WHERE update).
	const patchRes = await directusServerJson<{ data: any[] }>(
		'/items/surat_jalan',
		{
			method: 'PATCH',
			body: casPatchBody([{ id: { _eq: sjId } }, { status: { _eq: 'needs_security_check' } }], {
				status: 'shipped',
				// Tanpa ini badge admin nyangkut "Menunggu satpam" walau SJ sudah lolos.
				draft_status: 'siap_kirim',
				security_verified_at: new Date().toISOString(),
				security_verified_by: input.verifiedBy,
				security_checklist: {
					jumlah_ok: true,
					plat_ok: true,
					driver_ok: true,
					foto: fotoId,
					catatan: checklist.catatan ?? null,
					gate_check,
					...(input.extraChecklist || {})
				},
				...(fotoId ? { foto_kirim: fotoId } : {}),
				...(gps ? { gr_gps_lat: gps.lat, gr_gps_lng: gps.lng, gr_gps_accuracy: Number.isFinite(gps.accuracy) ? gps.accuracy : null } : {})
			})
		}
	);
	if (!Array.isArray(patchRes?.data) || patchRes.data.length === 0) {
		await idem('Loloskan (race — sudah dilolos request lain)');
		return { already_passed: true };
	}

	await recordKioskTrackingEvent({
		sjId, stageTo: 'lolos_gerbang', actor: trackActor, gps, fotoId,
		notes: (checklist.catatan as string | null) || `Checklist gerbang lolos${noteSrc}`, clientEventId
	}).catch((e) => console.error('[sjGerbang] recordKioskTrackingEvent gagal (status sudah ter-update):', e));

	return { already_passed: false, newStatus: 'shipped' };
}
