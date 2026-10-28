// src/lib/server/visitSalesSubmit.ts
// Paket 08b §4.2 (logika inti) + Paket 08c §5.3 (diekstrak dari [id]/submit/+server.ts) —
// dipakai BERSAMA oleh dua endpoint:
//   - /api/sales/visit/[id]/submit — jalur normal, visitId sudah diketahui (dari URL).
//   - /api/sales/visit/submit-by-txn — jalur offline (checkInVisit itu sendiri belum tentu
//     tersinkron saat submit hasil diantrekan; visitId BELUM ADA, hanya checkin_client_txn_id
//     yang dibuat klien saat check-in offline dimulai).
// Satu-satunya logika bisnis "selesaikan kunjungan sales" — JANGAN duplikasi di endpoint lain.

import { error, json } from '@sveltejs/kit';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { closeCheckin, type SiteCheckinRecord } from '$lib/server/siteCheckin';
import { bridgeToVisitMarketing } from '$lib/server/visitMarketingBridge';
import { todayJakarta } from '$lib/server/ess/time';
import { resolveSalesIdentity } from '$lib/server/salesIdentity';
import { notifySalesServer } from '$lib/server/salesNotifyRelay';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';

interface VisitSalesRow {
	id: number;
	sales_id: number | null;
	sales_name: string | null;
	master_customer_id: number | null;
	tujuan: string | null;
	status: string | null;
	verifikasi_status: string | null;
	hasil_kunjungan: string | null;
	kegiatan: string | null;
	follow_up_date: string | null;
	foto_id: string | null;
	check_out_at: string | null;
}

const WA_REGEX = /^(08|628)\d{8,12}$/;

interface KaryawanLike {
	id: number | string;
	nama_karyawan: string;
}

/**
 * @param form FormData SUDAH di-parse oleh pemanggil (Request.formData() cuma bisa dibaca
 *             sekali — endpoint submit-by-txn perlu baca checkin_client_txn_id dari form yang
 *             SAMA sebelum visitId diketahui, jadi parsing dipindah ke pemanggil).
 * @param authHeader header Authorization mentah (untuk cek izin verify_sales_visit/super_admin
 *                   bila yang submit bukan pemilik kunjungan).
 */
export async function submitVisitSalesCore(
	form: FormData,
	authHeader: string,
	visitId: number,
	karyawan: KaryawanLike,
	userLocalId: string
): Promise<Response> {
	if (!Number.isFinite(visitId) || visitId <= 0) throw error(400, 'ID kunjungan tidak valid.');

	const existingRes = await directusServerJson<{ data: VisitSalesRow | null }>(`/items/visit_sales/${visitId}`).catch(() => null);
	const visit = existingRes?.data;
	if (!visit) throw error(404, 'Kunjungan tidak ditemukan.');

	// Kepemilikan: sales pemilik kunjungan, atau SPV/super admin (verifikasi/lengkapi susulan).
	if (Number(visit.sales_id) !== Number(karyawan.id)) {
		const idToken = authHeader.replace(/^Bearer\s+/i, '');
		const { permissions } = await getUserPermissions(idToken, userLocalId);
		if (!hasAnyPermission(permissions, ['verify_sales_visit', 'super_admin'])) {
			throw error(403, 'Kunjungan ini bukan milik Anda.');
		}
	}

	// Idempoten — replay/klik ganda tidak menulis dua kali.
	if (visit.status === 'completed') {
		return json({ visit });
	}

	const hasilKunjungan = form.get('hasil_kunjungan')?.toString()?.trim() || '';
	const kegiatan = form.get('kegiatan')?.toString() || '';
	const followUpDate = form.get('follow_up_date')?.toString() || null;
	const nextAction = form.get('next_action')?.toString()?.trim() || null;
	const picDitemui = form.get('pic_ditemui')?.toString() || null;
	const jabatanPic = form.get('jabatan_pic')?.toString() || null;
	const noWaPicRaw = form.get('no_wa_pic')?.toString()?.replace(/[\s-]/g, '') || null;
	const statusBantRaw = form.get('status_bant')?.toString() || null;
	const foto = form.get('foto');
	const lat = form.get('lat') != null ? Number(form.get('lat')) : null;
	const lng = form.get('lng') != null ? Number(form.get('lng')) : null;
	const accuracy = form.get('accuracy') != null ? Number(form.get('accuracy')) : null;
	const clientCreatedAt = form.get('client_created_at')?.toString() || null;
	const clientTxnId = form.get('client_txn_id')?.toString() || null;
	if (!clientTxnId) throw error(400, 'client_txn_id wajib diisi.');

	if (!hasilKunjungan) throw error(400, 'Hasil kunjungan wajib diisi.');
	if (followUpDate) {
		if (!nextAction) throw error(400, 'Rencana berikutnya wajib diisi bila mengatur tanggal follow-up.');
		if (followUpDate < todayJakarta()) throw error(400, 'Tanggal follow-up tidak boleh sebelum hari ini.');
	}
	if (noWaPicRaw && !WA_REGEX.test(noWaPicRaw)) {
		throw error(400, 'Nomor WA tidak valid. Contoh: 0812xxxxxxx.');
	}
	let statusBant: Record<string, string | null> | null = null;
	if (statusBantRaw) {
		try {
			statusBant = JSON.parse(statusBantRaw);
		} catch {
			throw error(400, 'status_bant harus JSON valid.');
		}
	}

	// SVR-38 — upload foto gagal = submit GAGAL (bukan diam-diam lanjut tanpa foto).
	let fotoId: string | null = null;
	if (foto instanceof File && foto.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', foto, `visit-sales-${visitId}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto. Coba lagi.');
		const uploaded = await uploadRes.json().catch(() => null);
		fotoId = uploaded?.data?.id || null;
		if (!fotoId) throw error(502, 'Gagal mengunggah foto. Coba lagi.');
	}

	const checkOutAtIso =
		clientCreatedAt && Number.isFinite(new Date(clientCreatedAt).getTime()) ? new Date(clientCreatedAt).toISOString() : new Date().toISOString();

	const patch: Record<string, any> = {
		hasil_kunjungan: hasilKunjungan,
		kegiatan,
		follow_up_date: followUpDate,
		check_out_at: checkOutAtIso,
		status: 'completed',
		verifikasi_status: 'submitted'
	};
	if (fotoId) patch.foto_id = fotoId;

	const updatedRes = await directusServerJson<{ data: VisitSalesRow }>(`/items/visit_sales/${visitId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	});
	const updatedVisit = updatedRes.data;

	// Tutup site_checkin tertaut (bila masih aktif) — men-trigger bridge follow_ups
	// (bridgeToVisitMarketing). Paket 08d §6.2 — bridge kini juga menulis follow-up terjadwal
	// (bukan hanya riwayat) dan mendukung kunjungan tanpa prospek tertaut (prospect_id null).
	const { salesName } = resolveSalesIdentity(karyawan as any);
	try {
		const linkedRes = await directusServerJson<{ data: SiteCheckinRecord[] }>(
			`/items/site_checkin?filter[visit_sales_id][_eq]=${visitId}&filter[status][_eq]=active&limit=1`
		).catch(() => null);
		const linkedCheckin = linkedRes?.data?.[0];
		if (linkedCheckin) {
			// sales_name di follow_ups HARUS sama dengan visit_sales.sales_name (resolveSalesIdentity
			// di endpoint checkin) — bukan nama mentah karyawan — supaya filter per-sales konsisten.
			await closeCheckin({
				checkinId: linkedCheckin.id,
				karyawanId: String(karyawan.id),
				karyawanNama: salesName,
				method: 'manual',
				lat,
				lng,
				akurasi: accuracy,
				foto: null, // foto sudah diunggah terpisah ke visit_sales.foto_id di atas
				picDitemui,
				jabatanPic,
				noWaPic: noWaPicRaw,
				hasilMeeting: hasilKunjungan,
				statusBant: statusBant as any,
				nextAction,
				followUpDate: followUpDate ? `${followUpDate}T02:00:00.000Z` : null,
				clientTxnId,
				clientCreatedAt
			});
		} else {
			// Paket 08e §7.3 — visit_sales berstatus 'belum_dilaporkan': site_checkin tertaut SUDAH
			// ditutup otomatis (auto_midnight), closeCheckin() (dan bridge di dalamnya) tidak
			// terpicu di atas. Panggil bridge langsung di sini supaya follow-up yang diisi saat
			// submit SUSULAN tetap tercatat/dijadwalkan, bukan hilang diam-diam.
			const closedRes = await directusServerJson<{ data: { id: string; referensi_id: number | null }[] }>(
				`/items/site_checkin?filter[visit_sales_id][_eq]=${visitId}&limit=1&fields=id,referensi_id`
			).catch(() => null);
			const closedCheckin = closedRes?.data?.[0];
			await bridgeToVisitMarketing({
				prospectId: closedCheckin?.referensi_id ?? null,
				masterCustomerId: visit.master_customer_id,
				salesName,
				siteCheckinId: closedCheckin?.id ?? null,
				visitSalesId: visitId,
				picDitemui,
				jabatanPic,
				noWaPic: noWaPicRaw,
				hasilMeeting: hasilKunjungan,
				statusBant: statusBant as any,
				nextAction,
				followUpDate: followUpDate ? `${followUpDate}T02:00:00.000Z` : null
			});
		}
	} catch (e) {
		console.error('[visitSalesSubmit] Gagal menutup site_checkin tertaut / tulis follow_ups:', e);
	}

	notifySalesServer(
		'VISIT_SUBMITTED',
		`${updatedVisit.sales_name || karyawan.nama_karyawan} submit kunjungan ke ${updatedVisit.tujuan || 'customer'} — menunggu verifikasi.`,
		{ karyawanId: karyawan.id, sourceCollection: 'visit_sales', sourceId: updatedVisit.id }
	).catch(() => {});

	return json({ visit: updatedVisit });
}
