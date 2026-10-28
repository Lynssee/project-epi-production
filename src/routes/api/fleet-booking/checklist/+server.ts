// src/routes/api/fleet-booking/checklist/+server.ts
// Checklist Peminjam 3 Tahap (Fase 2, §9.2) — sebelum/selama/setelah.
// Checklist "sebelum" yang laik = self-checkout (booking -> aktif, trip log dibuat).
// Checklist "setelah" = self-return (booking -> selesai, trip log ditutup).
// Reuse pola auto-Work-Order dari /api/driver/vehicle-check (equipment_id via legacy_equipment_id).
//
// Peminjaman 08 (P2H): idempoten (client_txn_id + status target = sukses), urutan aman tanpa trip ganda,
// validasi KM, foto dashboard terpisah (mode off/soft/hard), unit tidak laik → Perawatan + WO pasti tercatat,
// jalur "lupa P2H sebelum berangkat". Semua kegagalan langkah sekunder DILOG (Aturan #1), tidak ditelan diam.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { notifyChecklistCritical, notifyWorkOrderNotCreated } from '$lib/server/fleetNotify';
import { applyCashAdvanceSettlement } from '$lib/server/fleetSettlement';
import { checkinGateApplies, bookingHasCheckin } from '$lib/server/fleetCheckinGate';
import { isBookingOwner, pesanTolakTulis } from '$lib/server/fleetBookingOwner';
import { evaluasiJendelaP2h, normalizeJendelaJam, normalizeJendelaMode } from '$lib/server/fleetP2hJendela';

// Sama persis dengan WO_IDS di api/driver/vehicle-check/+server.ts — id kategori work_order
// dari Directus bersama, jangan diubah tanpa menyamakan di kedua tempat.
const WO_IDS = {
	DARURAT: 'c8006ed8-b434-402f-9fb0-97c2f5284a42',
	MINOR: '5e393139-0ff7-426a-8673-3af319161663',
	CORRECTIVE: '561ad0b7-c246-4c24-bb66-5cc7e123fbda',
	STATUS_OPEN: '0e119df1-b7e5-44c1-ace4-d14c5a99c10b'
};

interface CheckItem {
	key: string;
	label: string;
	status: 'ok' | 'rusak' | 'tidak_ada';
	kritis?: boolean;
}

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

async function getFleetSettingsMap() {
	// Setting gagal dibaca → pakai default kode (fail-safe), tapi DILOG (bukan ditelan diam).
	const res = await directusServerJson<{ data: any[] }>(`/items/fleet_settings?limit=-1`).catch((e) => {
		console.error('[checklist] gagal membaca fleet_settings — pakai default kode:', e);
		return { data: [] };
	});
	const out: Record<string, any> = {};
	for (const row of res?.data || []) out[row.key] = row.value;
	return out;
}

const cleanStr = (v: unknown) => String(v ?? '').replace(/"/g, '').trim().toLowerCase();

/** Waktu kejadian dari HP (antrean offline) dipakai bila masuk akal: tidak di masa depan, selisih ≤ 24 jam. */
function resolveEventTime(raw: FormDataEntryValue | null): string {
	const now = Date.now();
	const t = raw ? new Date(String(raw)).getTime() : NaN;
	if (Number.isFinite(t) && t <= now + 5 * 60 * 1000 && now - t <= 24 * 3600 * 1000) return new Date(t).toISOString();
	return new Date(now).toISOString();
}

// ⚠ sort eksplisit WAJIB: koleksi fleet_vehicle_check punya sort_field='sort' yang TIDAK ada di skema, sehingga query tanpa
// sort dibalas 403 (dicek live 30 Sep) — lookup idempotensi akan diam-diam gagal tanpa ini.
async function findCheckByTxnId(txn: string): Promise<any | null> {
	const f = encodeURIComponent(JSON.stringify({ client_txn_id: { _eq: txn } }));
	const ex = await directusServerJson<{ data: any[] }>(`/items/fleet_vehicle_check?filter=${f}&sort=-id&limit=1`);
	return ex?.data?.[0] ?? null;
}

async function findActiveTrip(bookingId: string): Promise<any | null> {
	const f = encodeURIComponent(JSON.stringify({ booking_id: { _eq: String(bookingId) }, status: { _eq: 'active' } }));
	const r = await directusServerJson<{ data: any[] }>(`/items/fleet_trip_log?filter=${f}&sort=-date_created&limit=1`);
	return r?.data?.[0] ?? null;
}

async function uploadFoto(file: FormDataEntryValue | null, label: string): Promise<string | null> {
	if (!(file instanceof File) || file.size <= 0) return null;
	const uploadForm = new FormData();
	uploadForm.append('file', file);
	const res = await directusServerUpload(uploadForm);
	if (!res.ok) throw error(502, `Gagal mengunggah ${label}. Coba lagi.`);
	const uploaded = await res.json();
	return uploaded?.data?.id ?? null;
}

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const bookingId = String(form.get('booking_id') || '');
	const tahap = String(form.get('tahap') || '');
	let kmSaatCek = parseInt(String(form.get('km_saat_cek') || ''), 10);
	const temuanUser = String(form.get('temuan') || '').trim();
	const kmKoreksiAlasan = String(form.get('km_koreksi_alasan') || '').trim();
	const lupaSebelum = String(form.get('lupa_sebelum') || '') === '1';
	const foto = form.get('foto'); // foto kerusakan / kendaraan
	const fotoDashboard = form.get('foto_dashboard'); // foto odometer/dashboard
	const eventTimeIso = resolveEventTime(form.get('client_created_at'));
	let clientTxnId: string | null = String(form.get('client_txn_id') || '').slice(0, 64) || null;

	if (!bookingId) throw error(400, 'Booking ID wajib diisi.');
	if (!['sebelum', 'selama', 'setelah'].includes(tahap)) throw error(400, 'Tahap checklist tidak valid.');

	let items: CheckItem[] = [];
	try {
		items = JSON.parse(String(form.get('items') || '[]'));
	} catch {
		throw error(400, 'Data checklist tidak valid.');
	}
	if (!Array.isArray(items)) throw error(400, 'Data checklist tidak valid.');
	// Item "dashboard" lama = foto, bukan status. Buang agar tidak dianggap item rusak (klien lama masih mengirimnya).
	items = items.filter((i) => i && i.key !== 'dashboard');
	if (items.length === 0) throw error(400, 'Checklist tidak boleh kosong.');

	const bookingRes = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${bookingId}`).catch((e) => {
		console.error('[checklist] gagal membaca booking', bookingId, e);
		return null;
	});
	const booking = bookingRes?.data ?? bookingRes;
	if (!booking) throw error(404, 'Data peminjaman tidak ditemukan.');
	// P2H mengaktifkan/menutup booking → aksi TULIS: wajib karyawan_id (Peminjaman 12 §1).
	if (!isBookingOwner(booking, karyawan)) throw error(403, pesanTolakTulis(booking));
	if (!booking.vehicle_id) throw error(400, 'Peminjaman ini belum punya unit kendaraan yang ditetapkan.');

	// ── Idempotensi (Peminjaman 08 §3.1): kirim ulang dengan txn sama tidak membuat P2H/trip/WO baru.
	let existing: any = null;
	if (clientTxnId) {
		try {
			existing = await findCheckByTxnId(clientTxnId);
			if (existing && String(existing.booking_id) !== String(bookingId)) {
				throw error(409, 'ID transaksi bentrok. Muat ulang halaman.');
			}
		} catch (e: any) {
			if (e?.status === 409) throw e;
			// Kolom client_txn_id belum ada di Directus (403) — jangan blokir P2H lapangan; jalan tanpa idempotensi + log jelas.
			console.error('[checklist] lookup client_txn_id gagal — lanjut tanpa idempotensi. Pastikan skema fleet_vehicle_check sudah dibuat (scripts/fleet-p2h-schema.mjs):', e);
			clientTxnId = null;
			existing = null;
		}
	}

	// ── Status sudah sesuai target = SUKSES (bukan error 400): respons hilang lalu user mengulang.
	if (tahap === 'sebelum' && booking.status === 'aktif') {
		return json({ record: existing, booking, blocked: false, already: true });
	}
	if (tahap === 'setelah' && booking.status === 'selesai') {
		return json({ record: existing, booking, blocked: false, already: true });
	}
	if (['ditolak', 'dibatalkan'].includes(booking.status)) {
		throw error(400, 'Peminjaman ini sudah dibatalkan/ditolak — tidak bisa dipakai.');
	}
	if (tahap === 'sebelum' && booking.status !== 'disetujui') {
		throw error(
			400,
			booking.status === 'diajukan'
				? 'Peminjaman ini belum disetujui. Tunggu persetujuan dulu sebelum mulai pakai.'
				: `Peminjaman berstatus "${booking.status}" tidak bisa mulai checklist sebelum pakai.`
		);
	}
	const lupaJalur = tahap === 'setelah' && booking.status === 'disetujui' && lupaSebelum;
	if (tahap === 'setelah' && booking.status !== 'aktif' && !lupaJalur) {
		throw error(
			400,
			booking.status === 'disetujui'
				? 'Peminjaman ini belum dimulai. Lakukan checklist "Sebelum Pakai" dulu, atau pilih "Saya sudah terlanjur berangkat".'
				: `Peminjaman berstatus "${booking.status}" tidak bisa checklist pengembalian.`
		);
	}

	const settings = await getFleetSettingsMap();

	// ── Data unit (dibutuhkan untuk validasi KM, lupa-P2H, WO, dan status Perawatan)
	const kendaraanRes = await directusServerJson<{ data: any[] }>(
		`/items/fleet_kendaraan?filter[id][_eq]=${encodeURIComponent(booking.vehicle_id)}&fields=id,legacy_equipment_id,nomor_polisi,merk,model,km_terakhir&limit=1`
	).catch((e) => {
		console.error('[checklist] gagal membaca fleet_kendaraan', booking.vehicle_id, e);
		return { data: [] };
	});
	const kendaraan = kendaraanRes?.data?.[0] ?? null;
	const kmTerakhirUnit = Number(kendaraan?.km_terakhir) || 0;
	const vehicleLabel = kendaraan
		? [kendaraan.merk, kendaraan.model].filter(Boolean).join(' ') || kendaraan.nomor_polisi
		: String(booking.vehicle_id);

	// Gate check-in G7 (Peminjaman 09, opsi A): hanya untuk booking berproyek / kategori wajib_project. Kunjungan tanpa
	// proyek tidak punya jalur check-in → dikembalikan tanpa check-in, ditandai anomali (bukan jalan buntu, Aturan #6).
	const g7Aktif = !!Number(settings.wajib_absen_site_visit) && !!Number(settings.absen_memblokir_return);
	let g7Berlaku = true;
	let tanpaCheckinNonproyek = false;
	if (tahap === 'setelah' && g7Aktif && booking.tipe_keperluan === 'site_visit') {
		g7Berlaku = await checkinGateApplies(booking);
		if (!g7Berlaku) tanpaCheckinNonproyek = !(await bookingHasCheckin(bookingId));
	}

	let check: any = existing;
	let status: 'laik' | 'tidak_laik';
	let workOrder: any = null;

	if (existing) {
		// Replay: pakai hasil P2H yang sudah tersimpan; lanjutkan HANYA langkah yang belum selesai (semua idempoten).
		kmSaatCek = Number(existing.km_saat_cek) || 0;
		items = Array.isArray(existing.items) ? existing.items : items;
		status = existing.status === 'tidak_laik' ? 'tidak_laik' : 'laik';
	} else {
		// ── Validasi KM (Peminjaman 08 §3.3) — KM wajib diketik, tidak ada nilai otomatis.
		if (!Number.isFinite(kmSaatCek) || kmSaatCek <= 0) {
			throw error(400, 'Isi angka odometer (KM) yang terlihat di dashboard.');
		}
		const flags: string[] = [];
		if (tahap === 'sebelum') {
			const tol = Number(settings.p2h_toleransi_km);
			const toleransi = Number.isFinite(tol) && tol >= 0 ? tol : 50;
			if (kmTerakhirUnit > 0 && kmSaatCek < kmTerakhirUnit - toleransi) {
				flags.push(`[KM_ANOMALI] KM diketik ${kmSaatCek} < KM terakhir unit ${kmTerakhirUnit} (toleransi ${toleransi}).`);
			}
		} else if (tahap === 'setelah') {
			const kmAwalRef = lupaJalur ? kmTerakhirUnit : Number(booking.km_awal) || 0;
			if (kmAwalRef > 0 && kmSaatCek < kmAwalRef) {
				if (!kmKoreksiAlasan) {
					throw error(422, {
						message: `KM akhir (${kmSaatCek}) lebih kecil dari KM awal (${kmAwalRef}). Periksa lagi angkanya, atau jelaskan bila odometer diganti/rusak.`,
						code: 'KM_MUNDUR'
					} as any);
				}
				flags.push(`[KM_MUNDUR] KM akhir ${kmSaatCek} < KM awal ${kmAwalRef}. Alasan: ${kmKoreksiAlasan}`);
			}
		}
		if (lupaJalur) flags.push('[LUPA_P2H_SEBELUM] Peminjam tidak mengisi P2H sebelum berangkat.');
		if (tanpaCheckinNonproyek) flags.push('[TANPA_CHECKIN_NONPROYEK] Kunjungan tanpa proyek dikembalikan tanpa check-in.');
		// Jendela waktu P2H sebelum pakai (Peminjaman 12 §5): mode soft (default) = diterima + tanda; hard = ditolak.
		if (tahap === 'sebelum') {
			const jendela = evaluasiJendelaP2h({
				mulaiIso: booking.tanggal_mulai,
				kejadianIso: eventTimeIso,
				jendelaJam: normalizeJendelaJam(settings.p2h_jendela_jam_sebelum),
				mode: normalizeJendelaMode(settings.p2h_jendela_mode)
			});
			if (jendela.status === 'tolak') throw error(400, jendela.pesan);
			if (jendela.status === 'terlalu_awal') flags.push(jendela.flag);
		}

		// ── Foto (Peminjaman 08 §3.4): mode off | soft (default) | hard. Gate baru mulai soft (Aturan #3).
		const rawMode = cleanStr(settings.p2h_foto_dashboard_mode);
		const modeFoto: 'off' | 'soft' | 'hard' = rawMode === 'off' || rawMode === 'hard' ? rawMode : 'soft';
		const adaFotoDashboard = fotoDashboard instanceof File && fotoDashboard.size > 0;
		const adaFoto = foto instanceof File && foto.size > 0;
		if (modeFoto !== 'off' && !adaFotoDashboard) {
			if (modeFoto === 'hard') throw error(400, 'Foto dashboard wajib — arahkan kamera ke angka KM.');
			flags.push('[TANPA_FOTO_DASHBOARD]');
		}
		const tmplRaw = Array.isArray(settings.checklist_template_peminjam) ? settings.checklist_template_peminjam : [];
		const fotoItemWajib = tmplRaw.some((t: any) => t?.wajib_foto && t?.key !== 'dashboard');
		if (modeFoto !== 'off' && fotoItemWajib && !adaFoto) {
			if (modeFoto === 'hard') throw error(400, 'Foto item checklist wajib disertakan (sesuai template).');
			flags.push('[TANPA_FOTO_ITEM]');
		}
		if (!adaFoto && settings.foto_checklist_wajib && items.some((i) => i.status === 'rusak')) {
			throw error(400, 'Foto wajib disertakan untuk item yang ditandai rusak.');
		}

		const fotoId = await uploadFoto(foto, 'foto checklist');
		const fotoDashboardId = await uploadFoto(fotoDashboard, 'foto dashboard');

		const rusakItems = items.filter((i) => i.status !== 'ok');
		const kritisRusak = rusakItems.filter((i) => i.kritis);
		status = kritisRusak.length > 0 ? 'tidak_laik' : 'laik';
		const temuanFinal = [...flags, temuanUser].filter(Boolean).join('\n') || null;

		const basePayload: Record<string, unknown> = {
			vehicle_id: String(booking.vehicle_id),
			booking_id: bookingId,
			tahap,
			karyawan_id: String(karyawan.id),
			sumber: 'peminjaman',
			driver_id: booking.driver_id || null,
			tanggal: new Date().toISOString().slice(0, 10),
			km_saat_cek: kmSaatCek,
			items,
			temuan: temuanFinal,
			foto: fotoId,
			status
		};
		const fullPayload = {
			...basePayload,
			...(clientTxnId ? { client_txn_id: clientTxnId } : {}),
			...(fotoDashboardId ? { foto_dashboard: fotoDashboardId } : {})
		};
		try {
			check = await directusServerJson<{ data: any }>('/items/fleet_vehicle_check', { method: 'POST', body: JSON.stringify(fullPayload) });
		} catch (e) {
			// Race: request kembar dengan txn sama — yang kalah kena unique. Ambil baris pemenang (replay).
			let winner: any = null;
			if (clientTxnId) {
				try {
					winner = await findCheckByTxnId(clientTxnId);
				} catch (e2) {
					console.error('[checklist] gagal mengambil ulang P2H pemenang txn:', e2);
				}
			}
			if (winner && String(winner.booking_id) === String(bookingId)) {
				check = { data: winner };
				kmSaatCek = Number(winner.km_saat_cek) || kmSaatCek;
				status = winner.status === 'tidak_laik' ? 'tidak_laik' : 'laik';
			} else if (clientTxnId || fotoDashboardId) {
				// Skema baru (client_txn_id/foto_dashboard) belum ada di Directus → kirim tanpa kolom itu; foto dashboard
				// diselamatkan ke foto_tambahan (kolom lama). Dilog keras supaya skema segera dibuat.
				console.error('[checklist] POST fleet_vehicle_check gagal dengan kolom baru — retry tanpa client_txn_id/foto_dashboard. Jalankan scripts/fleet-p2h-schema.mjs:', e);
				check = await directusServerJson<{ data: any }>('/items/fleet_vehicle_check', {
					method: 'POST',
					body: JSON.stringify({ ...basePayload, ...(fotoDashboardId ? { foto_tambahan: [fotoDashboardId] } : {}) })
				});
			} else {
				throw e;
			}
		}
		const checkId = check?.data?.id;

		// ── Work Order otomatis bila ada item bermasalah (hanya saat P2H baru dibuat)
		if (rusakItems.length > 0) {
			const equipmentId = kendaraan?.legacy_equipment_id || null;
			const keluhan = rusakItems.map((i) => `${i.kritis ? '[KRITIS] ' : ''}${i.label}`).join('\n');
			let woGagalAlasan: string | null = null;

			if (equipmentId) {
				workOrder = await directusServerJson<{ data: any }>('/items/work_order', {
					method: 'POST',
					body: JSON.stringify({
						equipment_id: equipmentId,
						keluhan: temuanUser ? `${keluhan}\n\nCatatan peminjam: ${temuanUser}` : keluhan,
						kategori_perbaikan_id: kritisRusak.length > 0 ? WO_IDS.DARURAT : WO_IDS.MINOR,
						jenis_pekerjaan_id: WO_IDS.CORRECTIVE,
						order_status: WO_IDS.STATUS_OPEN,
						tanggal_rusak: new Date().toISOString().slice(0, 10),
						is_quick_create: true,
						foto_awal: fotoId,
						alasan_pengajuan: `Auto Checklist Peminjaman (${booking.kode_booking}, ${vehicleLabel}) — item rusak: ${rusakItems.map((i) => i.label).join(', ')}`
					})
				}).catch((e) => {
					console.error('Gagal membuat Work Order otomatis dari checklist peminjaman:', e);
					woGagalAlasan = 'sistem gagal membuat WO (lihat log server)';
					return null;
				});
				if (workOrder?.data?.id) {
					await directusServerJson(`/items/fleet_vehicle_check/${checkId}`, {
						method: 'PATCH',
						body: JSON.stringify({ maint_ticket_id: workOrder.data.id })
					}).catch((e) => console.error('[checklist] gagal menautkan maint_ticket_id ke P2H', checkId, e));
				}
			} else {
				console.error(`Checklist tidak_laik pada kendaraan id=${booking.vehicle_id} tanpa legacy_equipment_id — Work Order TIDAK dibuat.`);
				woGagalAlasan = 'unit belum ditautkan ke equipment (legacy_equipment_id kosong)';
			}

			// WO gagal/tidak bisa dibuat → GA HARUS tahu (Peminjaman 08 §3.8), bukan hanya console.error.
			if (woGagalAlasan) {
				await notifyWorkOrderNotCreated({
					kodeBooking: booking.kode_booking,
					vehicleLabel,
					plat: kendaraan?.nomor_polisi || '',
					alasan: woGagalAlasan
				});
				await directusServerJson('/items/app_notifications', {
					method: 'POST',
					body: JSON.stringify({
						type: 'fleet_wo_not_created',
						title: `Work Order TIDAK terbuat — ${vehicleLabel}`,
						message: `Unit ${vehicleLabel} ${kendaraan?.nomor_polisi || ''} bermasalah di P2H ${booking.kode_booking} tetapi Work Order tidak terbuat: ${woGagalAlasan}. Buat WO manual & lengkapi legacy_equipment_id unit.`,
						priority: 'high',
						department: 'ga',
						action_url: '/fleet',
						source_collection: 'fleet_vehicle_check',
						source_id: String(checkId ?? ''),
						read: false,
						created_at: new Date().toISOString()
					})
				}).catch((e) => console.error('[checklist] gagal mencatat app_notifications WO-tidak-terbuat:', e));
			}

			if (status === 'tidak_laik') {
				await notifyChecklistCritical({
					kodeBooking: booking.kode_booking,
					vehicleLabel,
					rusakItems: rusakItems.map((i) => i.label)
				});
			}
		}
	}

	const record = check?.data ?? check;
	const fotoDashboardRef: string | null = record?.foto_dashboard || (Array.isArray(record?.foto_tambahan) ? record.foto_tambahan[0] : null) || null;

	// ── Unit tidak laik → Perawatan (Peminjaman 08 §3.8) supaya tidak ditugaskan lagi. Idempoten.
	const blocked = tahap === 'sebelum' && status === 'tidak_laik' && settings.blokir_checkout_bila_tidak_laik !== false;
	const setPerawatan = async () =>
		directusServerJson(`/items/fleet_kendaraan/${booking.vehicle_id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Perawatan' }) }).catch((e) =>
			console.error('[checklist] gagal set unit Perawatan', booking.vehicle_id, e)
		);

	let bookingUpdate: any = null;
	let settlement: any = null;

	if (tahap === 'sebelum') {
		if (blocked) {
			await setPerawatan();
		} else {
			// Urutan aman (§3.2): pakai trip aktif yang sudah ada → buat bila belum → booking aktif (WAJIB) → unit Dipinjam (sekunder).
			let trip = await findActiveTrip(bookingId).catch((e) => {
				console.error('[checklist] gagal mencari trip aktif booking', bookingId, e);
				return null;
			});
			if (!trip) {
				const created = await directusServerJson<{ data: any }>('/items/fleet_trip_log', {
					method: 'POST',
					body: JSON.stringify({
						vehicle_id: String(booking.vehicle_id),
						driver_id: booking.driver_id || null,
						driver_name: booking.driver_name || karyawan.nama_karyawan,
						jenis: 'peminjaman',
						department: booking.requester_dept || null,
						booking_id: bookingId,
						tujuan: booking.tujuan || '-',
						keperluan: booking.keperluan || '',
						tanggal_berangkat: eventTimeIso,
						waktu_mulai: eventTimeIso,
						km_awal: kmSaatCek,
						foto_odometer_awal: fotoDashboardRef,
						status: 'active'
					})
				});
				trip = created?.data ?? null;
			}
			try {
				bookingUpdate = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${bookingId}`, {
					method: 'PATCH',
					body: JSON.stringify({ status: 'aktif', trip_log_id: trip?.id || null, km_awal: kmSaatCek })
				});
			} catch (e) {
				console.error('[checklist] PATCH booking → aktif GAGAL (retry aman: trip aktif dipakai ulang):', e);
				throw error(502, 'Koneksi ke server data terputus. Tekan kirim lagi — data Anda tidak akan dobel.');
			}
			await directusServerJson(`/items/fleet_kendaraan/${booking.vehicle_id}`, {
				method: 'PATCH',
				body: JSON.stringify({ status: 'Dipinjam' })
			}).catch((e) => console.error('[checklist] gagal set unit Dipinjam', booking.vehicle_id, e));
		}
	} else if (tahap === 'setelah') {
		// Fase 3 G7 — check-in wajib untuk site_visit. Blokir keras (D2): pengembalian ditolak
		// bila belum ada catatan check-in DAN belum ada dispensasi GA. Gate hanya memeriksa
		// KEBERADAAN baris site_checkin (bukan in_geofence) — koordinat proyek yang belum lengkap
		// tidak boleh ikut memblokir (§3.1 poin 3).
		if (g7Aktif && g7Berlaku && booking.tipe_keperluan === 'site_visit') {
			const sudahDispensasi = !!booking.dispensasi_oleh || !!booking.dispensasi_alasan;
			if (!sudahDispensasi) {
				const ciFilter = encodeURIComponent(JSON.stringify({ booking_id: { _eq: String(bookingId) } }));
				const ciRes = await directusServerJson<{ data: { id: string }[] }>(
					`/items/site_checkin?filter=${ciFilter}&fields=id&limit=1`
				).catch((e) => {
					console.error('[checklist] gagal cek site_checkin untuk gate G7:', e);
					return { data: [] };
				});
				if (!ciRes?.data?.length) {
					throw error(422, {
						message:
							'Belum ada catatan check-in untuk peminjaman ini. Lakukan check-in di lokasi sebelum mengembalikan kendaraan, atau minta dispensasi ke GA bila check-in gagal.',
						// dibaca frontend untuk memunculkan tombol "Minta Dispensasi GA"
						code: 'CHECKIN_REQUIRED',
						booking_id: String(bookingId)
					} as any);
				}
			}
		}

		// Jalur "lupa P2H sebelum berangkat" (§3.7): trip retroaktif dari jadwal booking, tidak memblokir tapi tercatat.
		let tripId: string | null = booking.trip_log_id || null;
		if (lupaJalur) {
			let trip = await findActiveTrip(bookingId).catch((e) => {
				console.error('[checklist] gagal mencari trip aktif (lupa-P2H)', bookingId, e);
				return null;
			});
			if (!trip) {
				const created = await directusServerJson<{ data: any }>('/items/fleet_trip_log', {
					method: 'POST',
					body: JSON.stringify({
						vehicle_id: String(booking.vehicle_id),
						driver_id: booking.driver_id || null,
						driver_name: booking.driver_name || karyawan.nama_karyawan,
						jenis: 'peminjaman',
						department: booking.requester_dept || null,
						booking_id: bookingId,
						tujuan: booking.tujuan || '-',
						keperluan: booking.keperluan || '',
						tanggal_berangkat: booking.tanggal_mulai || eventTimeIso,
						waktu_mulai: booking.tanggal_mulai || eventTimeIso,
						km_awal: kmTerakhirUnit,
						catatan: '[LUPA_P2H_SEBELUM]',
						status: 'active'
					})
				});
				trip = created?.data ?? null;
			}
			tripId = trip?.id || null;
		}
		if (!tripId) {
			tripId = (await findActiveTrip(bookingId).catch((e) => {
				console.error('[checklist] gagal mencari trip aktif untuk ditutup', bookingId, e);
				return null;
			}))?.id || null;
		}

		// Urutan aman: booking → selesai LEBIH DULU (langkah wajib), lalu tutup trip, lalu unit.
		try {
			bookingUpdate = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${bookingId}`, {
				method: 'PATCH',
				body: JSON.stringify({
					status: 'selesai',
					km_akhir: kmSaatCek,
					tanggal_selesai_aktual: eventTimeIso,
					...(lupaJalur ? { trip_log_id: tripId, km_awal: kmTerakhirUnit } : {})
				})
			});
		} catch (e) {
			console.error('[checklist] PATCH booking → selesai GAGAL (retry aman):', e);
			throw error(502, 'Koneksi ke server data terputus. Tekan kirim lagi — data Anda tidak akan dobel.');
		}

		if (tripId) {
			await directusServerJson(`/items/fleet_trip_log/${tripId}`, {
				method: 'PATCH',
				body: JSON.stringify({
					km_akhir: kmSaatCek,
					waktu_selesai: eventTimeIso,
					tanggal_kembali: eventTimeIso,
					foto_odometer_akhir: fotoDashboardRef,
					status: 'completed'
				})
			}).catch((e) => console.error('[checklist] gagal menutup trip', tripId, e));
		} else {
			console.error(`[checklist] booking ${bookingId} selesai tetapi TIDAK ada trip aktif untuk ditutup.`);
		}

		// km_terakhir HANYA ditimpa bila kmSaatCek lebih besar dari rekor terakhir (data hygiene). Unit tidak laik
		// → 'Perawatan' (bukan 'Tersedia'); pengembalian tetap TIDAK diblokir (Aturan #6).
		const kendaraanUpdate: Record<string, unknown> = { status: status === 'tidak_laik' ? 'Perawatan' : 'Tersedia' };
		if (kmSaatCek > kmTerakhirUnit) kendaraanUpdate.km_terakhir = kmSaatCek;
		await directusServerJson(`/items/fleet_kendaraan/${booking.vehicle_id}`, {
			method: 'PATCH',
			body: JSON.stringify(kendaraanUpdate)
		}).catch((e) => console.error('[checklist] gagal update status/km unit', booking.vehicle_id, e));

		// ESS Redesign Fase 3 — hitung settlement uang muka otomatis (fail-soft, idempoten).
		try {
			settlement = await applyCashAdvanceSettlement({ ...booking, status: 'selesai', km_akhir: kmSaatCek });
		} catch (e) {
			console.warn('[checklist] settlement uang muka gagal (diabaikan):', (e as any)?.message || e);
		}
	}

	return json({
		record,
		work_order: workOrder?.data ?? null,
		blocked,
		booking: bookingUpdate?.data ?? null,
		settlement,
		replay: !!existing
	});
};
