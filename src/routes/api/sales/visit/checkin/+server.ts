// src/routes/api/sales/visit/checkin/+server.ts
// Paket 08b Site Visit Release §4.2 — mulai kunjungan sales (jalur A, /sales/baru), SATU-
// SATUNYA cara menulis visit_sales sekarang (menggantikan services/sales.ts:checkInVisit yang
// menulis langsung dari browser dengan identitas dari klien — worst case #8 dokumen).
//
// Setiap kunjungan sales sekarang PASTI punya 1 site_checkin tertaut (tipe_checkin='marketing'),
// supaya muncul di picker klaim BBM/transport (Finance) dan Kehadiran Site (HRD) — worst case #1.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { directusServerJson } from '$lib/server/directus';
import { createCheckin, AkurasiGpsError, type SiteCheckinRecord } from '$lib/server/siteCheckin';
import { resolveSalesIdentity } from '$lib/server/salesIdentity';
import { todayJakarta } from '$lib/server/ess/time';

async function hashString(s: string): Promise<string> {
	const buf = new TextEncoder().encode(s);
	const digest = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

interface VisitSalesRow {
	id: number;
	[key: string]: any;
}

export const POST: RequestHandler = async (event) => {
	const { karyawan, user } = await authenticateEss(event);

	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const { permissions } = await getUserPermissions(idToken, user.localId);
	if (!hasAnyPermission(permissions, ['input_sales', 'super_admin'])) {
		throw error(403, 'Anda tidak berhak mencatat kunjungan sales.');
	}

	const form = await event.request.formData();
	const masterCustomerIdRaw = form.get('master_customer_id')?.toString() || '';
	const prospectIdRaw = form.get('prospect_id')?.toString() || '';
	const tujuan = form.get('tujuan')?.toString()?.trim() || '';
	const lat = Number(form.get('lat'));
	const lng = Number(form.get('lng'));
	const akurasi = form.get('accuracy') != null ? Number(form.get('accuracy')) : null;
	const foto = form.get('foto');
	const bookingId = form.get('booking_id')?.toString() || null;
	const clientCreatedAt = form.get('client_created_at')?.toString() || null;
	const clientTxnId = form.get('client_txn_id')?.toString() || null;

	const masterCustomerId = masterCustomerIdRaw ? Number(masterCustomerIdRaw) : null;
	const prospectId = prospectIdRaw ? Number(prospectIdRaw) : null;

	if (!masterCustomerId && !prospectId) {
		throw error(400, 'Pilih customer atau prospek tujuan kunjungan.');
	}
	if (!tujuan) {
		throw error(400, 'Tujuan kunjungan wajib diisi.');
	}
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		throw error(400, 'Lokasi GPS tidak valid. Aktifkan izin lokasi dan coba lagi.');
	}
	if (!clientTxnId) {
		throw error(400, 'client_txn_id wajib diisi.');
	}
	// Paket 08b — foto OPSIONAL saat mulai kunjungan: halaman /sales/baru saat ini (sebelum 08c
	// menambah kamera+watermark di sana) TIDAK mengambil foto saat mulai, hanya saat submit
	// (visit_sales.foto_id). Jangan menolak check-in hanya karena UI belum mengirim foto.
	const fotoFile = foto instanceof File && foto.size > 0 ? foto : null;

	const uaFingerprintSrc = `${event.request.headers.get('user-agent') || ''}|${event.request.headers.get('accept-language') || ''}`;
	const deviceFingerprint = await hashString(uaFingerprintSrc);

	let checkin: SiteCheckinRecord & { peringatan?: string };
	try {
		checkin = await createCheckin({
			karyawanId: String(karyawan.id),
			referensiId: prospectId,
			masterCustomerId,
			lat,
			lng,
			akurasi,
			foto: fotoFile,
			catatan: tujuan,
			bookingId,
			deviceFingerprint,
			networkType: null,
			tipeKeperluan: 'marketing',
			clientCreatedAt,
			clientTxnId
		});
	} catch (e) {
		if (e instanceof AkurasiGpsError) throw error(422, e.message);
		throw error(400, e instanceof Error ? e.message : 'Gagal memulai kunjungan.');
	}

	// Dedup: createCheckin() SUDAH menangani exact-match client_txn_id secara internal dan
	// mengembalikan baris LAMA bila replay — bila baris itu sudah punya visit_sales_id, kunjungan
	// ini sudah pernah dibuat sepenuhnya (idempoten), tinggal kembalikan datanya.
	if (checkin.visit_sales_id) {
		const existingVisit = await directusServerJson<{ data: VisitSalesRow | null }>(`/items/visit_sales/${checkin.visit_sales_id}`).catch(() => null);
		if (existingVisit?.data) {
			return json({ visit: existingVisit.data, checkin });
		}
	}

	const { salesId, salesName } = resolveSalesIdentity(karyawan);
	const tanggalKunjungan = todayJakarta(new Date(checkin.check_in_at));

	let peringatan: string | undefined = checkin.peringatan;
	try {
		const visitRes = await directusServerJson<{ data: VisitSalesRow }>('/items/visit_sales', {
			method: 'POST',
			body: JSON.stringify({
				tanggal_kunjungan: tanggalKunjungan,
				sales_id: salesId,
				sales_name: salesName,
				master_customer_id: masterCustomerId,
				tujuan,
				kegiatan: '',
				status: 'in_progress',
				check_in_at: checkin.check_in_at,
				latitude: lat,
				longitude: lng,
				verifikasi_status: 'draft'
			})
		});
		const visit = visitRes.data;

		await directusServerJson(`/items/site_checkin/${checkin.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ visit_sales_id: visit.id })
		});

		return json({ visit, checkin, ...(peringatan ? { peringatan } : {}) });
	} catch (e) {
		// §4.2 poin 6 — JANGAN hapus site_checkin (bukti kehadiran tetap sah) bila visit_sales
		// gagal ditulis. Catat & beri tahu, jangan gagalkan seluruh check-in.
		console.error('[sales/visit/checkin] Gagal menulis visit_sales, site_checkin tetap tersimpan:', e);
		await directusServerJson(`/items/site_checkin/${checkin.id}`, {
			method: 'PATCH',
			body: JSON.stringify({
				catatan_sistem: `visit_sales gagal dibuat: ${e instanceof Error ? e.message : String(e)}`
			})
		}).catch(() => {});
		directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'sales_visit_gagal_tertaut',
				title: 'Kunjungan Sales Gagal Tertaut',
				message: `Kunjungan ${karyawan.nama_karyawan} ke "${tujuan}" tercatat sebagai bukti kehadiran, tetapi data sales (visit_sales) gagal dibuat. Perlu ditautkan manual.`,
				priority: 'high',
				department: 'Sales',
				source_collection: 'site_checkin',
				source_id: checkin.id
			})
		}).catch((notifErr) => console.error('[sales/visit/checkin] gagal kirim notifikasi Sales:', notifErr));

		return json({
			visit: null,
			checkin,
			peringatan: 'Kunjungan tercatat, tetapi data sales belum lengkap. Admin sudah diberi tahu.'
		});
	}
};
