// src/lib/services/equipmentVerify.ts
// Sisi klien resolver scan unit. Server counterpart: /api/equipment/verify & /api/equipment/handover
// (src/lib/server/equipmentVerify*.ts). Aturan bisnis ada di server; klien hanya menampilkan hasilnya.

import { auth } from '$lib/firebase';
import { getCurrentPosition } from '$lib/utils/geoClient';

export interface PersonCard {
	karyawanId: string;
	nama: string;
	divisi: string | null;
	posisi: string | null;
	/** Thumbnail pas foto (data URL) atau null => avatar inisial. */
	fotoDataUrl: string | null;
}

export interface EquipmentLite {
	id: string;
	name: string;
	code: string;
	category_id: string | null;
}

export type GateModeName = 'shadow' | 'soft' | 'warn' | 'hard';

export interface VehicleVerdict {
	gateKey: string;
	mode: GateModeName;
	decision: 'authorized' | 'passenger' | 'denied' | 'free' | 'not_applicable';
	isAuthorized: boolean;
	blocked: boolean;
	warn: boolean;
	attempt: boolean;
	message: string | null;
}

export interface BorrowerVerdict {
	gateKey: string;
	mode: GateModeName;
	decision: 'match' | 'mismatch' | 'no_loan' | 'unknown_borrower' | 'not_applicable';
	matches: boolean;
	warn: boolean;
	message: string | null;
}

export interface VehicleVerifyResult {
	kind: 'vehicle';
	equipment: EquipmentLite;
	vehicle: { id: number; nomor_polisi: string; merk: string; model: string; jenis: string | null; status: string | null; pemilik: string | null };
	booking: {
		id: string;
		kode_booking?: string | null;
		keperluan?: string | null;
		tujuan?: string | null;
		tanggal_mulai?: string | null;
		tanggal_selesai_rencana?: string | null;
		requester_name?: string | null;
	} | null;
	staleBookingIgnored: number;
	holder: PersonCard | null;
	verification: VehicleVerdict;
	override: { allowed: boolean; reasonMin: number } | null;
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

export type EquipmentVerifyResult = VehicleVerifyResult | ToolVerifyResult;

/** Error dengan status HTTP, agar pemanggil bisa membedakan "tidak ditemukan" (404) dari gangguan (fallback). */
export class EquipmentVerifyError extends Error {
	constructor(message: string, public status: number) {
		super(message);
		this.name = 'EquipmentVerifyError';
	}
}

async function post<T>(url: string, payload: Record<string, unknown>): Promise<T> {
	const user = auth.currentUser;
	if (!user) throw new EquipmentVerifyError('Sesi tidak ditemukan. Silakan login ulang.', 401);
	const idToken = await user.getIdToken();
	const res = await fetch(url, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new EquipmentVerifyError(body?.message || `Gagal memproses (${res.status}).`, res.status);
	}
	return res.json();
}

export interface QuickGps {
	lat: number;
	lng: number;
	accuracy?: number;
}

/**
 * Posisi perangkat untuk jejak audit — TIDAK pernah melempar dan TIDAK menahan alur lebih dari `maxWaitMs` (izin lokasi belum
 * diberikan / GPS lambat / ditolak => null). Memakai fix tersimpan (<= 60 dtk) & akurasi standar agar cepat; cukup untuk audit,
 * bukan geofence. Dibatasi Promise.race karena timeout bawaan browser tidak berjalan selama dialog izin masih terbuka.
 */
export async function quickPosition(maxWaitMs = 1500): Promise<QuickGps | null> {
	try {
		const pos = await Promise.race([
			getCurrentPosition({ enableHighAccuracy: false, timeout: maxWaitMs, maximumAge: 60_000 }),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), maxWaitMs))
		]);
		return pos ? { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy } : null;
	} catch {
		return null;
	}
}

export function verifyEquipment(code: string, gps?: QuickGps | null): Promise<EquipmentVerifyResult> {
	return post<EquipmentVerifyResult>('/api/equipment/verify', { code, gps: gps ?? null, clientEventId: crypto.randomUUID() });
}

export async function submitHandover(code: string, reason: string): Promise<{ ok: true; recorded: boolean; message?: string }> {
	// Pengguna sudah sedang berinteraksi (mengisi alasan) — beri waktu GPS sedikit lebih lama daripada saat scan.
	const gps = await quickPosition(4000);
	return post('/api/equipment/handover', { code, reason, gps, clientEventId: crypto.randomUUID() });
}
