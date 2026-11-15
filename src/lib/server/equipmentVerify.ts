// src/lib/server/equipmentVerify.ts
// SERVER-ONLY. Pemuat data + orkestrasi verifikasi unit saat scan EPI:EQUIPMENT:<kode> (rencana verifikasi barcode
// equipment, Fase 1). Logika keputusan ada di equipmentVerifyCore.ts (murni, diuji).
// Aturan #2: SETIAP relasi diambil dengan query terpisah (tanpa field bersarang). Aturan #1: kegagalan baca tidak
// ditelan diam-diam — dicatat dengan prefiks [equipmentVerify]; keputusan gagal-baca selalu fail-open (tidak mengunci lapangan).

import { directusServerFetch, directusServerJson } from '$lib/server/directus';
import { resolveGateMode, type GateMode } from '$lib/server/gateDefinitionsMode';
import {
	DEFAULT_VERIFY_SETTINGS,
	DOC_DRIVER_LOCK,
	DOC_P2H_BORROWER,
	GATE_DRIVER_LOCK,
	GATE_P2H_BORROWER,
	VERIFY_SETTING_KEYS,
	decideBorrowerMatch,
	decideVehicleAccess,
	normalizeVerifySettings,
	pickActiveBooking,
	type BookingLite,
	type BorrowerVerdict,
	type VehicleVerdict,
	type VerifySettings
} from '$lib/server/equipmentVerifyCore';

type Dx = <T = any>(path: string, init?: any) => Promise<T>;
const log = (msg: string, e: unknown) => console.error(`[equipmentVerify] ${msg}:`, e instanceof Error ? e.message : e);

/** category 'loan_status:Aktif' pada internal_loan_log.status (sama dengan loanChecklist.ts / compressor-compliance). */
export const LOAN_STATUS_AKTIF = '8d23640e-5726-4480-a9fb-693e3ea6c8fa';

export interface PersonCard {
	karyawanId: string;
	nama: string;
	divisi: string | null;
	posisi: string | null;
	/** Thumbnail pas foto (data URL, ~160px) dari karyawan_dokumen tipe 'pas_foto'; null => klien menampilkan avatar inisial. */
	fotoDataUrl: string | null;
}

type ThumbFetcher = (fileId: string) => Promise<string | null>;

/** Thumbnail asset Directus -> data URL. Diubah di server agar klien tak butuh akses langsung ke /assets & tak ada endpoint foto terbuka. */
const fetchThumbDataUrl: ThumbFetcher = async (fileId) => {
	const res = await directusServerFetch(`/assets/${encodeURIComponent(fileId)}?width=160&height=160&fit=cover&quality=70&format=jpg`);
	if (!res.ok) throw new Error(`asset ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (!buf.length || buf.length > 200_000) return null;
	return `data:image/jpeg;base64,${buf.toString('base64')}`;
};

// Cache foto 10 menit per karyawan (hemat 3 query + 1 asset tiap scan unit yang sama). Gagal/tidak ada foto di-cache juga (null).
const fotoCache = new Map<string, { at: number; value: string | null }>();
export function clearFotoCache() {
	fotoCache.clear();
}

/**
 * pas_foto karyawan: karyawan_dokumen (tipe 'pas_foto', terbaru) -> karyawan_dokumen_files -> directus_files -> thumbnail.
 * (karyawan.foto TIDAK ada di skema; foto ada sebagai dokumen.) Dokumen terenkripsi dilewati. Setiap langkah query terpisah (Aturan #2);
 * gagal di langkah mana pun => dicatat & null (kartu tetap tampil dengan avatar inisial).
 */
export async function loadPasFoto(karyawanId: string, dx: Dx = directusServerJson as Dx, thumb: ThumbFetcher = fetchThumbDataUrl): Promise<string | null> {
	const cached = fotoCache.get(karyawanId);
	if (cached && Date.now() - cached.at < 600_000) return cached.value;
	let value: string | null = null;
	try {
		const q1 = new URLSearchParams({
			'filter[karyawan_id][_eq]': karyawanId,
			'filter[tipe_dokumen][_eq]': 'pas_foto',
			fields: 'id,is_encrypted',
			sort: '-tanggal_upload',
			limit: '3'
		});
		const docs = ((await dx<{ data: { id: number; is_encrypted?: boolean | number | null }[] }>(`/items/karyawan_dokumen?${q1.toString()}`))?.data || []).filter((d) => !d.is_encrypted);
		if (docs.length) {
			const q2 = new URLSearchParams({ 'filter[karyawan_dokumen_id][_eq]': String(docs[0].id), fields: 'directus_files_id', limit: '1' });
			const fid = (await dx<{ data: { directus_files_id: string | { id: string } | null }[] }>(`/items/karyawan_dokumen_files?${q2.toString()}`))?.data?.[0]?.directus_files_id;
			const fileId = typeof fid === 'object' && fid ? fid.id : (fid as string | null);
			if (fileId) value = await thumb(fileId);
		}
	} catch (e) {
		log(`gagal memuat pas_foto karyawan ${karyawanId} (kartu tampil tanpa foto)`, e);
	}
	fotoCache.set(karyawanId, { at: Date.now(), value });
	return value;
}

/**
 * Kartu orang. Kolom karyawan dibaca LANGSUNG di sini (bukan fetchKaryawanMapByIds, yang menelan error): kolom yang tidak ada
 * di skema harus terlihat di log, bukan membuat kartu kosong diam-diam (Aturan #1).
 */
export async function loadPerson(karyawanId: string, dx: Dx = directusServerJson as Dx, thumb: ThumbFetcher = fetchThumbDataUrl): Promise<PersonCard | null> {
	let row: { id: number; nama_karyawan: string | null; divisi: string | null; posisi: string | null } | undefined;
	try {
		const q = new URLSearchParams({ 'filter[id][_eq]': karyawanId, fields: 'id,nama_karyawan,divisi,posisi', limit: '1' });
		row = (await dx<{ data: any[] }>(`/items/karyawan?${q.toString()}`))?.data?.[0];
	} catch (e) {
		log(`gagal membaca karyawan ${karyawanId}`, e);
		return null;
	}
	if (!row) return null;
	return {
		karyawanId: String(row.id),
		nama: row.nama_karyawan || `Karyawan #${row.id}`,
		divisi: row.divisi ?? null,
		posisi: row.posisi ?? null,
		fotoDataUrl: await loadPasFoto(String(row.id), dx, thumb)
	};
}

// ── Setelan (cache 5 menit; bawaan di kode) ───────────────────────────────────────────────────────────────────────
let settingsCache: { at: number; value: VerifySettings } | null = null;
export function clearVerifySettingsCache() {
	settingsCache = null;
}

export async function loadVerifySettings(dx: Dx = directusServerJson as Dx): Promise<VerifySettings> {
	if (settingsCache && Date.now() - settingsCache.at < 300_000) return settingsCache.value;
	let value = DEFAULT_VERIFY_SETTINGS;
	try {
		const q = new URLSearchParams({
			'filter[key][_in]': VERIFY_SETTING_KEYS.join(','),
			fields: 'key,value',
			limit: '-1'
		});
		const res = await dx<{ data: { key: string; value: unknown }[] }>(`/items/fleet_settings?${q.toString()}`);
		value = normalizeVerifySettings(res?.data);
	} catch (e) {
		log('gagal baca fleet_settings, pakai bawaan', e);
	}
	settingsCache = { at: Date.now(), value };
	return value;
}

// ── Loader unit ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface EquipmentLite {
	id: string;
	name: string;
	code: string;
	category_id: string | null;
}

export async function findEquipmentByCode(code: string, dx: Dx = directusServerJson as Dx): Promise<EquipmentLite | null> {
	const q = new URLSearchParams({ 'filter[code][_eq]': code, fields: 'id,name,code,category_id', limit: '1' });
	const res = await dx<{ data: EquipmentLite[] }>(`/items/equipment?${q.toString()}`);
	return res?.data?.[0] ?? null;
}

export interface VehicleLite {
	id: number;
	nomor_polisi: string;
	merk: string;
	model: string;
	jenis: string | null;
	status: string | null;
	pemilik: string | null;
}

/** equipment.id == fleet_kendaraan.legacy_equipment_id (terverifikasi di data live); kode_aset hanya terisi sebagian. */
export async function findVehicleByEquipment(equipmentId: string, dx: Dx = directusServerJson as Dx): Promise<VehicleLite | null> {
	const q = new URLSearchParams({
		'filter[legacy_equipment_id][_eq]': equipmentId,
		fields: 'id,nomor_polisi,merk,model,jenis,status,pemilik',
		limit: '1'
	});
	const res = await dx<{ data: VehicleLite[] }>(`/items/fleet_kendaraan?${q.toString()}`);
	return res?.data?.[0] ?? null;
}

async function findCandidateBookings(vehicleId: number, dx: Dx): Promise<BookingLite[]> {
	const q = new URLSearchParams({
		'filter[vehicle_id][_eq]': String(vehicleId),
		'filter[status][_in]': 'aktif,disetujui',
		fields: 'id,kode_booking,vehicle_id,driver_id,karyawan_id,butuh_driver,requester_name,keperluan,tujuan,tanggal_mulai,tanggal_selesai_rencana,status',
		sort: '-tanggal_mulai',
		limit: '20'
	});
	const res = await dx<{ data: BookingLite[] }>(`/items/fleet_bookings?${q.toString()}`);
	return res?.data || [];
}

async function findDriverKaryawanId(driverId: string | null | undefined, dx: Dx): Promise<string | null> {
	if (!driverId) return null;
	const res = await dx<{ data: { karyawan_id: string | number | null } }>(`/items/fleet_drivers/${encodeURIComponent(driverId)}?fields=karyawan_id`);
	const k = res?.data?.karyawan_id;
	return k != null && k !== '' ? String(k) : null;
}

async function findDefaultDriverKaryawanId(vehicleId: number, dx: Dx): Promise<string | null> {
	const q = new URLSearchParams({
		'filter[vehicle_id][_eq]': String(vehicleId),
		'filter[aktif][_eq]': 'true',
		fields: 'driver_id',
		limit: '1'
	});
	const res = await dx<{ data: { driver_id: string | null }[] }>(`/items/fleet_driver_assignment?${q.toString()}`);
	return findDriverKaryawanId(res?.data?.[0]?.driver_id, dx);
}

async function safeMode(gateKey: string, documentType: string): Promise<GateMode> {
	return resolveGateMode(gateKey, documentType).catch((e) => {
		log(`gagal resolusi mode ${gateKey}, pakai shadow`, e);
		return 'shadow' as GateMode;
	});
}

// ── Hasil ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface VehicleVerifyResult {
	kind: 'vehicle';
	equipment: EquipmentLite;
	vehicle: VehicleLite;
	booking: (BookingLite & { driverName?: string | null }) | null;
	staleBookingIgnored: number;
	holder: PersonCard | null;
	verification: VehicleVerdict;
}

export interface ToolVerifyResult {
	kind: 'tool';
	equipment: EquipmentLite;
	loan: {
		source: 'internal_loan_log' | 'peminjaman_internal';
		id: string;
		projectId: number | null;
		projectName: string | null;
		startDate: string | null;
		endDatePlanned: string | null;
		purpose: string | null;
	} | null;
	borrower: PersonCard | null;
	verification: BorrowerVerdict;
}

export type VerifyResult = VehicleVerifyResult | ToolVerifyResult | { kind: 'unknown'; code: string };

export async function verifyVehicle(
	equipment: EquipmentLite,
	vehicle: VehicleLite,
	karyawanId: string | null,
	nowMs = Date.now(),
	dx: Dx = directusServerJson as Dx,
	thumb: ThumbFetcher = fetchThumbDataUrl
): Promise<VehicleVerifyResult> {
	const [settings, mode] = await Promise.all([loadVerifySettings(dx), safeMode(GATE_DRIVER_LOCK, DOC_DRIVER_LOCK)]);

	let booking: BookingLite | null = null;
	let staleCount = 0;
	let loadFailed = false;
	try {
		const picked = pickActiveBooking(await findCandidateBookings(vehicle.id, dx), nowMs, settings);
		booking = picked.booking;
		staleCount = picked.staleIgnored.length;
	} catch (e) {
		log('gagal baca fleet_bookings — gate dilewati (fail-open)', e);
		loadFailed = true;
	}

	let driverKaryawanId: string | null = null;
	let defaultDriverKaryawanId: string | null = null;
	if (!loadFailed) {
		try {
			if (booking) driverKaryawanId = await findDriverKaryawanId(booking.driver_id, dx);
			else defaultDriverKaryawanId = await findDefaultDriverKaryawanId(vehicle.id, dx);
		} catch (e) {
			log('gagal baca driver — gate dilewati (fail-open)', e);
			loadFailed = true;
		}
	}

	// Baca gagal => perlakukan sebagai 'free' (tidak ada yang bisa disalahkan) — jangan menolak karena gangguan Directus.
	const verification = decideVehicleAccess({
		mode,
		karyawanId,
		pemilik: vehicle.pemilik,
		booking: loadFailed ? null : booking,
		driverKaryawanId,
		defaultDriverKaryawanId
	});

	// Info pemegang untuk kartu (pemohon bila tanpa driver terpisah). Satu query karyawan untuk semua id.
	let holder: PersonCard | null = null;
	const holderId = driverKaryawanId ?? booking?.karyawan_id ?? defaultDriverKaryawanId;
	if (holderId && !loadFailed) {
		holder = await loadPerson(String(holderId), dx, thumb);
	}

	return { kind: 'vehicle', equipment, vehicle, booking: loadFailed ? null : booking, staleBookingIgnored: staleCount, holder, verification };
}

/** Peminjaman aktif sebuah alat dari DUA sumber: internal_loan_log (PIC = karyawan) lalu peminjaman_internal (peminjam = karyawan). */
export async function findActiveLoan(equipment: EquipmentLite, dx: Dx = directusServerJson as Dx) {
	// 1) internal_loan_log — status = category uuid (bukan string), PIC = pic_id (karyawan). borrower_id menunjuk 'personnel' (bukan karyawan).
	const q1 = new URLSearchParams({
		'filter[equipment_id][_eq]': equipment.id,
		'filter[status][_eq]': LOAN_STATUS_AKTIF,
		'filter[end_date_actual][_null]': 'true',
		fields: 'id,pic_id,borrower_id,project_id,start_date,end_date_planned,purpose',
		sort: '-start_date',
		limit: '1'
	});
	const r1 = await dx<{ data: any[] }>(`/items/internal_loan_log?${q1.toString()}`);
	const l1 = r1?.data?.[0];
	if (l1) {
		// PIC (karyawan) diutamakan; bila kosong, peminjam = borrower_id (personnel) -> personnel.karyawan_id (tautan resmi).
		let borrowerKaryawanId: string | null = l1.pic_id != null ? String(l1.pic_id) : null;
		if (!borrowerKaryawanId && l1.borrower_id) {
			try {
				const p = await dx<{ data: { karyawan_id: number | null } }>(`/items/personnel/${encodeURIComponent(String(l1.borrower_id))}?fields=karyawan_id`);
				if (p?.data?.karyawan_id != null) borrowerKaryawanId = String(p.data.karyawan_id);
			} catch (e) {
				log('gagal menurunkan peminjam dari personnel', e);
			}
		}
		return {
			source: 'internal_loan_log' as const,
			id: String(l1.id),
			borrowerKaryawanId,
			projectId: l1.project_id != null ? Number(l1.project_id) : null,
			startDate: l1.start_date ?? null,
			endDatePlanned: l1.end_date_planned ?? null,
			purpose: l1.purpose ?? null
		};
	}

	// 2) peminjaman_internal — item (identitas_barang) tertaut ke equipment lewat id_equipment = equipment.code (lihat loanGuard.ts).
	const q2 = new URLSearchParams({ 'filter[id_equipment][_eq]': equipment.code, fields: 'id', limit: '5' });
	const items = (await dx<{ data: { id: number }[] }>(`/items/identitas_barang?${q2.toString()}`))?.data || [];
	if (!items.length) return null;
	const q3 = new URLSearchParams({
		'filter[item_id][_in]': items.map((i) => i.id).join(','),
		'filter[status][_in]': 'dipinjam,overdue',
		fields: 'id,peminjam_id,tanggal_pinjam,tanggal_jatuh_tempo,keperluan',
		sort: '-tanggal_pinjam',
		limit: '1'
	});
	const l2 = (await dx<{ data: any[] }>(`/items/peminjaman_internal?${q3.toString()}`))?.data?.[0];
	if (!l2) return null;
	return {
		source: 'peminjaman_internal' as const,
		id: String(l2.id),
		borrowerKaryawanId: l2.peminjam_id != null ? String(l2.peminjam_id) : null,
		projectId: null,
		startDate: l2.tanggal_pinjam ?? null,
		endDatePlanned: l2.tanggal_jatuh_tempo ?? null,
		purpose: l2.keperluan ?? null
	};
}

export async function verifyTool(
	equipment: EquipmentLite,
	karyawanId: string | null,
	dx: Dx = directusServerJson as Dx,
	thumb: ThumbFetcher = fetchThumbDataUrl
): Promise<ToolVerifyResult> {
	const mode = await safeMode(GATE_P2H_BORROWER, DOC_P2H_BORROWER);

	let loan: Awaited<ReturnType<typeof findActiveLoan>> = null;
	try {
		loan = await findActiveLoan(equipment, dx);
	} catch (e) {
		log('gagal baca peminjaman — kartu peminjam dilewati (fail-open)', e);
	}

	let borrower: PersonCard | null = null;
	if (loan?.borrowerKaryawanId) {
		borrower = await loadPerson(String(loan.borrowerKaryawanId), dx, thumb);
	}

	let projectName: string | null = null;
	if (loan?.projectId) {
		try {
			const res = await dx<{ data: { name: string | null } }>(`/items/projects/${loan.projectId}?fields=name`);
			projectName = res?.data?.name ?? null;
		} catch (e) {
			log('gagal baca nama proyek', e);
		}
	}

	const verification = decideBorrowerMatch({
		mode,
		karyawanId,
		hasLoan: !!loan,
		borrowerKaryawanId: loan?.borrowerKaryawanId ?? null
	});

	return {
		kind: 'tool',
		equipment,
		loan: loan
			? {
					source: loan.source,
					id: loan.id,
					projectId: loan.projectId,
					projectName,
					startDate: loan.startDate,
					endDatePlanned: loan.endDatePlanned,
					purpose: loan.purpose
				}
			: null,
		borrower,
		verification
	};
}

export interface ScanLogArgs {
	equipmentId: string;
	karyawanId: string;
	gateKey: string;
	mode: GateMode;
	bookingCode?: string | null;
	gps?: { lat?: number; lng?: number; accuracy?: number } | null;
	clientEventId?: string | null;
}

function writeScanLog(kind: 'denied' | 'handover', args: ScanLogArgs, reason: string | null, dx: Dx): Promise<void> {
	const body: Record<string, unknown> = {
		ref_collection: 'equipment',
		ref_id: args.equipmentId,
		actor_id: Number(args.karyawanId),
		timestamp: new Date().toISOString(),
		gps_lat: args.gps?.lat ?? null,
		gps_lng: args.gps?.lng ?? null,
		gps_accuracy: args.gps?.accuracy ?? null,
		notes: `EQUIPMENT_VERIFY|${kind}|${args.gateKey}|mode=${args.mode}${args.bookingCode ? `|booking=${args.bookingCode}` : ''}${reason ? `|reason=${reason}` : ''}`,
		source: 'field'
	};
	if (args.clientEventId) body.client_event_id = args.clientEventId;
	return dx('/items/scan_log', { method: 'POST', body: JSON.stringify(body) }).then(() => undefined);
}

/**
 * Catat UPAYA tertolak ke scan_log (generik: ref_collection/ref_id/actor_id/gps/notes). Hanya 'denied' (termasuk mode shadow,
 * supaya Superadmin punya data sebelum menaikkan mode) — scan sukses tidak dicatat (hemat tulis). Fire-and-forget: gagal
 * menulis tidak boleh mengganggu respons.
 */
export function logDeniedAttempt(args: ScanLogArgs, dx: Dx = directusServerJson as Dx): Promise<void> {
	return writeScanLog('denied', args, null, dx).catch((e) => log('gagal menulis scan_log (upaya tertolak)', e));
}

/**
 * Catat alih pakai darurat beserta alasannya. BERBEDA dari denied: ini jejak audit keputusan manusia, jadi kegagalan menulis
 * DILEMPAR (pemanggil harus memberi tahu pengguna) — pengecualian tanpa jejak tidak boleh lolos diam-diam.
 */
export function logHandover(args: ScanLogArgs, reason: string, dx: Dx = directusServerJson as Dx): Promise<void> {
	return writeScanLog('handover', args, reason, dx);
}
