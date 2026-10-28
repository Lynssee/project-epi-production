// src/lib/server/fleetNotify.ts
// Notifikasi WA Peminjaman Kendaraan (Fase 6, §11.4). Reuse pola lemburNotify.ts —
// relay lewat notif-dispatch di erp-epi-1 (tercatat di notification_log, tunduk kill-switch
// notification_settings), bukan wa-notify polos.
//
// SENGAJA baru 2 pemicu diaktifkan (booking diajukan, checklist tidak_laik) — instruksi
// rencana eksplisit: "nyalakan bertahap: satu workflow dulu, pastikan benar-benar sampai,
// baru sisanya". Pemicu lain (naik tahap 2, disetujui/ditolak, dispensasi, dst) belum
// dibangun — sebagian butuh trigger dari sisi admin erp-epi-1 (approve/reject terjadi di
// FleetBookingBoard.svelte langsung ke Directus, bukan lewat server route project-epi ini),
// itu pekerjaan terpisah.
//
// Gagal kirim TIDAK BOLEH menggagalkan alur submit/checklist — fail-soft (log warning saja).

import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import { resolveKepalaDivisiApprover } from '$lib/server/ess/divisi';

async function relayNotifyDispatch(params: {
	eventType: string;
	message: string;
	waKaryawanIds?: (number | string)[];
	waRecipients?: { nama: string; no_telpon: string }[];
}): Promise<boolean> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (baseUrl && /directus/i.test(baseUrl)) {
		console.error('[fleetNotify] ERP_EPI1_BASE_URL menunjuk host Directus — notifikasi WA akan gagal. Perbaiki env.');
	}
	if (!baseUrl || !secret) {
		console.warn('[fleetNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi WA dilewati.');
		return false;
	}
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				secret,
				eventType: params.eventType,
				message: params.message,
				waKaryawanIds: params.waKaryawanIds || [],
				waRecipients: params.waRecipients || []
			})
		});
		if (!res.ok) console.warn(`[fleetNotify] relay notif-dispatch dibalas HTTP ${res.status}`);
		return res.ok;
	} catch (e) {
		console.warn('[fleetNotify] Gagal memanggil relay notif-dispatch erp-epi-1:', e);
		return false;
	}
}

/** Peminjaman 12 §3 — booking tersimpan tetapi GAGAL didaftarkan ke antrean persetujuan (approval yatim): GA harus tahu. */
export async function notifyApprovalOrphan(params: { kodeBooking: string; karyawanNama: string; tujuan: string }): Promise<boolean> {
	try {
		const recipients = await fetchNotifyRecipients('ga_hrd');
		if (recipients.length === 0) {
			console.warn('[fleetNotify] fleet_notify_recipients kosong untuk peran ga_hrd — notif approval yatim TIDAK terkirim.');
			return false;
		}
		const message = `Pengajuan ${params.kodeBooking} dari ${params.karyawanNama} (tujuan "${params.tujuan}") tersimpan tetapi BELUM masuk antrean persetujuan siapa pun. Daftarkan di ERP > Fleet > Peminjaman (badge "Tanpa approval"). Sistem juga mencoba mendaftarkan otomatis.`;
		// eventType dipakai ulang (sudah terdaftar di registry ERP) — hanya isi pesan yang berbeda.
		return await relayNotifyDispatch({ eventType: 'fleet_checklist_critical', message, waRecipients: recipients });
	} catch (e) {
		console.warn('[fleetNotify] Gagal kirim notifikasi approval yatim:', e);
		return false;
	}
}

export type CascadeCancelResult = { ok: true } | { ok: false; definitive: boolean; message: string };

/**
 * Peminjaman 10 §2.4 — pembatalan booking yang TUNTAS dilakukan ERP (approval_requests, PCR uang muka, WA approver/GA/sopir).
 * ok:true → ERP sudah membatalkan booking + cascade. ok:false & definitive:true → ERP menolak (aturan bisnis, mis. sudah
 * aktif). ok:false & definitive:false → ERP tidak terjangkau/error sementara: pemanggil tetap membatalkan booking LOKAL
 * dan menandainya `[CASCADE_GAGAL]` supaya bisa disapu rekonsiliasi (booking tidak boleh gagal batal karena ERP mati).
 */
export async function requestFleetCancelCascade(params: { bookingId: string | number; alasan: string; actorNama: string }): Promise<CascadeCancelResult> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.error('[fleetNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — cascade pembatalan dilewati (fallback lokal).');
		return { ok: false, definitive: false, message: 'ERP belum dikonfigurasi' };
	}
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/fleet-booking/cancel`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret, bookingId: params.bookingId, alasan: params.alasan, actorNama: params.actorNama }),
			signal: AbortSignal.timeout(20_000)
		});
		if (res.ok) return { ok: true };
		const body = await res.json().catch(() => ({}));
		const message = body?.message || `ERP membalas HTTP ${res.status}`;
		console.error(`[fleetNotify] cascade pembatalan ditolak/gagal (HTTP ${res.status}): ${message}`);
		return { ok: false, definitive: res.status === 400 || res.status === 404, message };
	} catch (e) {
		console.error('[fleetNotify] ERP tidak terjangkau untuk cascade pembatalan:', e);
		return { ok: false, definitive: false, message: 'ERP tidak terjangkau' };
	}
}

/** Penyetuju tahap 1: atasan_id langsung, fallback kepala divisi (sama pola lemburNotify —
 * konsisten dengan §10.0 rencana: rantai atasan_id > kepala divisi > fallback GM). */
async function resolveTahap1ApproverKaryawanId(pemohonKaryawanId: number | string): Promise<number | null> {
	const query = new URLSearchParams({ fields: 'id,divisi,atasan_id' });
	const pemohon = await directusServerJson<{ data: { atasan_id: number | null; divisi: string | null } }>(
		`/items/karyawan/${pemohonKaryawanId}?${query.toString()}`
	);
	if (pemohon?.data?.atasan_id) return Number(pemohon.data.atasan_id);
	if (pemohon?.data?.divisi) return await resolveKepalaDivisiApprover(pemohon.data.divisi);
	return null;
}

/** Booking baru diajukan — notify approver tahap 1 (Manajer dept pemohon, K1). */
export async function notifyBookingSubmitted(params: {
	karyawanId: number | string;
	karyawanNama: string;
	kodeBooking: string;
	tujuan: string;
}): Promise<void> {
	try {
		const approverId = await resolveTahap1ApproverKaryawanId(params.karyawanId);
		if (!approverId) return;
		const message = `Pengajuan peminjaman kendaraan baru dari ${params.karyawanNama} (${params.kodeBooking}) tujuan "${params.tujuan}" perlu persetujuan Anda di ERP.`;
		await relayNotifyDispatch({ eventType: 'fleet_booking_submitted', message, waKaryawanIds: [approverId] });
	} catch (e) {
		console.warn('[fleetNotify] Gagal resolve/kirim notifikasi booking diajukan:', e);
	}
}

/** Fetch penerima WA aktif dari fleet_notify_recipients berdasarkan peran. */
async function fetchNotifyRecipients(peran: string): Promise<{ nama: string; no_telpon: string }[]> {
	const filter = encodeURIComponent(JSON.stringify({ peran: { _eq: peran }, active: { _eq: true } }));
	const res = await directusServerJson<{ data: { nama: string; no_telpon: string }[] }>(
		`/items/fleet_notify_recipients?filter=${filter}&fields=nama,no_telpon&limit=-1`
	).catch(() => ({ data: [] }));
	return res?.data || [];
}

/** Fase 3 G7 — peminjam minta dispensasi GA karena tidak bisa/lupa check-in. Notify GA/HRD. */
export async function notifyCheckinDispensationRequested(params: {
	kodeBooking: string;
	karyawanNama: string;
	tujuan: string;
	alasan: string;
}): Promise<boolean> {
	try {
		const [gaHrd, kepalaFleet] = await Promise.all([
			fetchNotifyRecipients('ga_hrd'),
			fetchNotifyRecipients('kepala_fleet')
		]);
		const recipients = [...gaHrd, ...kepalaFleet];
		if (recipients.length === 0) {
			console.warn('[fleetNotify] fleet_notify_recipients kosong untuk peran ga_hrd/kepala_fleet — permintaan dispensasi check-in TIDAK terkirim.');
			return false;
		}
		const message = `${params.karyawanNama} minta DISPENSASI check-in untuk kunjungan ${params.kodeBooking} (tujuan: ${params.tujuan}). Alasan: ${params.alasan}. Beri dispensasi di ERP bila valid agar kendaraan bisa dikembalikan.`;
		return await relayNotifyDispatch({ eventType: 'fleet_checkin_dispensation_requested', message, waRecipients: recipients });
	} catch (e) {
		console.warn('[fleetNotify] Gagal kirim notifikasi permintaan dispensasi check-in:', e);
		return false;
	}
}

/** ESS Redesign Fase 4 — pengajuan uang muka operasional baru → notify Finance. */
export async function notifyCashAdvanceSubmitted(params: {
	kodeBooking: string;
	karyawanNama: string;
	amount: number;
	tujuan: string;
}): Promise<void> {
	try {
		const recipients = await fetchNotifyRecipients('finance');
		if (recipients.length === 0) {
			console.warn('[fleetNotify] fleet_notify_recipients kosong untuk peran finance — notif pengajuan uang muka TIDAK terkirim.');
			return;
		}
		const rp = 'Rp ' + Number(params.amount || 0).toLocaleString('id-ID');
		const message = `Pengajuan uang muka operasional ${rp} dari ${params.karyawanNama} (${params.kodeBooking}, tujuan "${params.tujuan}") menunggu pencairan di ERP > Finance > Petty Cash > Pengajuan Masuk.`;
		await relayNotifyDispatch({ eventType: 'fleet_cash_advance_submitted', message, waRecipients: recipients });
	} catch (e) {
		console.warn('[fleetNotify] Gagal kirim notifikasi pengajuan uang muka:', e);
	}
}

/** ESS Redesign Fase 4 — peminjam unggah bukti setor balik sisa uang muka → notify Finance. */
export async function notifyCashAdvanceSetorUploaded(params: {
	kodeBooking: string;
	karyawanNama: string;
	selisih: number;
}): Promise<void> {
	try {
		const recipients = await fetchNotifyRecipients('finance');
		if (recipients.length === 0) {
			console.warn('[fleetNotify] fleet_notify_recipients kosong untuk peran finance — notif bukti setor balik TIDAK terkirim.');
			return;
		}
		const rp = 'Rp ' + Number(params.selisih || 0).toLocaleString('id-ID');
		const message = `${params.karyawanNama} sudah mengunggah bukti setor balik sisa uang muka ${rp} untuk ${params.kodeBooking}. Verifikasi di ERP > Finance > Petty Cash (LPJ uang muka) — jalur lama Fleet > Uang Muka > Settlement sudah dibekukan.`;
		await relayNotifyDispatch({ eventType: 'fleet_cash_advance_setor_uploaded', message, waRecipients: recipients });
	} catch (e) {
		console.warn('[fleetNotify] Gagal kirim notifikasi bukti setor balik:', e);
	}
}

/** Checklist tidak_laik — notify GA/HRD + kepala dept FLEET (§11.4.2). */
export async function notifyChecklistCritical(params: {
	kodeBooking: string;
	vehicleLabel: string;
	rusakItems: string[];
}): Promise<void> {
	try {
		const [gaHrd, kepalaFleet] = await Promise.all([
			fetchNotifyRecipients('ga_hrd'),
			fetchNotifyRecipients('kepala_fleet')
		]);
		const recipients = [...gaHrd, ...kepalaFleet];
		if (recipients.length === 0) {
			console.warn('[fleetNotify] fleet_notify_recipients kosong untuk peran ga_hrd/kepala_fleet — notifikasi checklist kritis TIDAK terkirim.');
			return;
		}
		const message = `Checklist kendaraan ${params.vehicleLabel} (${params.kodeBooking}) TIDAK LAIK — item bermasalah: ${params.rusakItems.join(', ')}. Tiket perbaikan sudah dibuat otomatis.`;
		await relayNotifyDispatch({ eventType: 'fleet_checklist_critical', message, waRecipients: recipients });
	} catch (e) {
		console.warn('[fleetNotify] Gagal kirim notifikasi checklist kritis:', e);
	}
}

/** Peminjaman 08 §3.8 — unit bermasalah di P2H tetapi Work Order TIDAK terbuat (mis. legacy_equipment_id kosong). GA/kepala fleet harus tahu. */
export async function notifyWorkOrderNotCreated(params: {
	kodeBooking: string;
	vehicleLabel: string;
	plat: string;
	alasan: string;
}): Promise<void> {
	try {
		const [gaHrd, kepalaFleet] = await Promise.all([
			fetchNotifyRecipients('ga_hrd'),
			fetchNotifyRecipients('kepala_fleet')
		]);
		const recipients = [...gaHrd, ...kepalaFleet];
		if (recipients.length === 0) {
			console.warn('[fleetNotify] fleet_notify_recipients kosong untuk peran ga_hrd/kepala_fleet — notif WO-tidak-terbuat TIDAK terkirim.');
			return;
		}
		const message = `Unit ${params.vehicleLabel}${params.plat ? ' (' + params.plat + ')' : ''} tidak laik di P2H ${params.kodeBooking} tapi Work Order TIDAK terbuat: ${params.alasan}. Buat WO manual & lengkapi legacy_equipment_id unit.`;
		// eventType dipakai ulang (sudah terdaftar di registry ERP) — hanya isi pesan yang berbeda.
		await relayNotifyDispatch({ eventType: 'fleet_checklist_critical', message, waRecipients: recipients });
	} catch (e) {
		console.warn('[fleetNotify] Gagal kirim notifikasi WO-tidak-terbuat:', e);
	}
}
