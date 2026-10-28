// src/lib/services/phoneDeposit.ts
// Deposit HP di gerbang satpam — Fase 1, rencana Optimasi Inventory & Produksi + Deposit HP +
// Kiosk Produksi v2 (24 Agu 2026). Pola sama dengan security.ts: direct @directus/sdk client-side,
// koleksi phone_deposit_log dibuat di erp-epi-1 (repo Directus sama, dua frontend).

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem } from '@directus/sdk';

export interface KaryawanWajib {
	id: number;
	nama_karyawan: string;
	divisi: string;
	no_badge?: string | null;
}

export interface DepositLog {
	id: number;
	karyawan_id: number | { id: number; nama_karyawan: string; divisi: string };
	tanggal: string;
	locker_code: string | null;
	deposit_time: string | null;
	pickup_time: string | null;
	status: 'deposited' | 'picked_up' | 'exempt';
}

function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
}

async function readSetting<T>(key: string, fallback: T): Promise<T> {
	try {
		const rows: any[] = await directus.request(
			readItems('system_settings', { filter: { setting_key: { _eq: key } }, fields: ['setting_value'], limit: 1 })
		);
		if (!rows?.[0]?.setting_value) return fallback;
		try {
			return JSON.parse(rows[0].setting_value) as T;
		} catch {
			return rows[0].setting_value as T;
		}
	} catch (err) {
		handleDirectusError(err);
		return fallback;
	}
}

export async function fetchDivisiWajib(): Promise<string[]> {
	return readSetting<string[]>('phone_deposit.divisi_wajib', ['MANUFACTURE']);
}

export async function fetchDaftarLoker(): Promise<string[]> {
	return readSetting<string[]>('phone_deposit.daftar_loker', []);
}

/** Cari karyawan divisi wajib berdasarkan no_badge (scan) ATAU nama (ketik manual). */
export async function findKaryawanWajib(query: string): Promise<KaryawanWajib[]> {
	if (!query.trim()) return [];
	const divisiWajib = await fetchDivisiWajib();
	try {
		return (await directus.request(
			readItems('karyawan', {
				filter: {
					_and: [
						{ divisi: { _in: divisiWajib } },
						{ status_kerja: { _neq: 'Tidak Aktif' } },
						{ _or: [{ no_badge: { _eq: query.trim() } }, { nama_karyawan: { _icontains: query } }] }
					]
				},
				fields: ['id', 'nama_karyawan', 'divisi', 'no_badge'],
				limit: 15
			})
		)) as KaryawanWajib[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/** Status deposit HP karyawan ini HARI INI, kalau ada. */
export async function fetchTodayDepositForKaryawan(karyawanId: number): Promise<DepositLog | null> {
	try {
		const rows: DepositLog[] = (await directus.request(
			readItems('phone_deposit_log', {
				filter: { karyawan_id: { _eq: karyawanId }, tanggal: { _eq: todayStr() } },
				fields: ['id', 'karyawan_id', 'tanggal', 'locker_code', 'deposit_time', 'pickup_time', 'status'],
				limit: 1
			})
		)) as any[];
		return rows?.[0] || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

/** Daftar "belum diambil" (dititipkan hari ini, belum pickup_time) untuk ringkasan layar. */
export async function fetchBelumDiambilHariIni(): Promise<DepositLog[]> {
	try {
		return (await directus.request(
			readItems('phone_deposit_log', {
				filter: { tanggal: { _eq: todayStr() }, status: { _eq: 'deposited' } },
				fields: ['id', 'karyawan_id.id', 'karyawan_id.nama_karyawan', 'karyawan_id.divisi', 'locker_code', 'deposit_time'],
				sort: ['deposit_time'],
				limit: -1
			})
		)) as any[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/** Karyawan wajib yang BELUM punya baris phone_deposit_log hari ini sama sekali. */
export async function fetchBelumSetorHariIni(): Promise<KaryawanWajib[]> {
	const divisiWajib = await fetchDivisiWajib();
	try {
		const [wajib, sudahAda] = await Promise.all([
			directus.request(
				readItems('karyawan', {
					filter: { divisi: { _in: divisiWajib }, status_kerja: { _neq: 'Tidak Aktif' } },
					fields: ['id', 'nama_karyawan', 'divisi'],
					limit: -1
				})
			) as Promise<KaryawanWajib[]>,
			directus.request(
				readItems('phone_deposit_log', {
					filter: { tanggal: { _eq: todayStr() } },
					fields: ['karyawan_id'],
					limit: -1
				})
			) as Promise<{ karyawan_id: number }[]>
		]);
		const sudahIds = new Set(sudahAda.map((d) => Number(d.karyawan_id)));
		return wajib.filter((k) => !sudahIds.has(Number(k.id)));
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function submitDeposit(params: { karyawanId: number; lockerCode: string | null; petugasId: number | null }) {
	return directus.request(
		createItem('phone_deposit_log', {
			karyawan_id: params.karyawanId,
			tanggal: todayStr(),
			locker_code: params.lockerCode || null,
			deposit_time: new Date().toISOString(),
			petugas_deposit_id: params.petugasId,
			status: 'deposited',
			sumber: 'gate'
		})
	);
}

export async function submitPickup(logId: number, petugasId: number | null) {
	return directus.request(
		updateItem('phone_deposit_log', logId, {
			pickup_time: new Date().toISOString(),
			petugas_pickup_id: petugasId,
			status: 'picked_up'
		})
	);
}
