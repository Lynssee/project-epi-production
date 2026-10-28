// src/lib/services/pickReservation.ts
// Fase 3 — Mobile Picking. Reservasi per baris project_budgets saat picker mulai
// scan sebuah item, supaya dua picker tidak rebutan barang yang sama (kunci per
// baris, sesuai keputusan 4 Agu 2026). Terpisah dari reservasi SPK lama
// (stock_reservations.spk_id) — memakai kolom packing_project_id yang baru.
import directus, { handleDirectusError } from './directus';
import { createItem, updateItem, readItems } from '@directus/sdk';

const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // kunci baris dianggap kedaluwarsa setelah 5 menit tanpa aksi

export interface PickReservation {
	id: number;
	item_id: number;
	packing_project_id: number;
	quantity: number;
	status: string;
}

/**
 * Buat reservasi aktif untuk 1 baris project_budgets yang sedang di-scan.
 * Dipanggil bersamaan dengan mengunci baris (locked_by/locked_at).
 */
export async function createPickReservation(projectId: number, itemId: number, quantity: number): Promise<PickReservation> {
	try {
		return (await directus.request(
			createItem('stock_reservations', {
				packing_project_id: projectId,
				item_id: itemId,
				quantity,
				status: 'active',
				created_at: new Date().toISOString()
			})
		)) as PickReservation;
	} catch (e) {
		handleDirectusError(e);
		throw e;
	}
}

/** Lepas reservasi setelah qty dikonfirmasi (dikonsumsi) atau dibatalkan. */
export async function releasePickReservation(reservationId: number, newStatus: 'consumed' | 'released' = 'consumed'): Promise<void> {
	try {
		await directus.request(
			updateItem('stock_reservations', reservationId, {
				status: newStatus,
				released_at: new Date().toISOString()
			})
		);
	} catch (e) {
		handleDirectusError(e);
		throw e;
	}
}

/** Cek apakah masih ada reservasi aktif untuk item ini di project ini (indikasi baris sedang dipegang). */
export async function getActivePickReservation(projectId: number, itemId: number): Promise<PickReservation | null> {
	try {
		const rows = (await directus.request(
			readItems('stock_reservations', {
				filter: {
					packing_project_id: { _eq: projectId },
					item_id: { _eq: itemId },
					status: { _eq: 'active' }
				},
				limit: 1
			})
		)) as PickReservation[];
		return rows[0] || null;
	} catch (e) {
		handleDirectusError(e);
		throw e;
	}
}

export { LOCK_TIMEOUT_MS };
