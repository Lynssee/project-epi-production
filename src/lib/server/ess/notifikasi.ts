// src/lib/server/ess/notifikasi.ts
// Notifikasi Terpusat v2, Fase 5 (dashboard lapangan project-epi): baca in-app
// notifikasi milik karyawan yang login dari app_notifications (SATU koleksi yang sama
// dipakai admin erp-epi-1 — lihat notificationHub.js). Baris lama (department-scoped,
// karyawan_id null) TIDAK ikut terambil di sini — sama seperti listKpiNotifications di
// kpi.ts, filter karyawan_id itu opsional/additif.

import { directusServerJson } from '$lib/server/directus';

export interface AppNotification {
	id: number;
	type: string;
	title: string;
	message: string;
	priority: 'low' | 'medium' | 'high' | null;
	module: string | null;
	action_required: boolean;
	action_url: string | null;
	attachment_file_id: string | null;
	read: boolean;
	read_at: string | null;
	created_at: string;
}

const LIST_FIELDS = 'id,type,title,message,priority,module,action_required,action_url,attachment_file_id,read,read_at,created_at';

export async function listNotifications(
	karyawanId: number,
	opts: { read?: boolean; module?: string; page?: number; limit?: number } = {}
): Promise<{ data: AppNotification[]; total: number }> {
	const { read, module, page = 1, limit = 20 } = opts;
	const filter: Record<string, any> = { _and: [{ karyawan_id: { _eq: karyawanId } }] };
	if (read === true) filter._and.push({ read: { _eq: true } });
	if (read === false) filter._and.push({ read: { _eq: false } });
	if (module) filter._and.push({ module: { _eq: module } });

	const query = new URLSearchParams({
		fields: LIST_FIELDS,
		sort: '-created_at',
		limit: String(limit),
		offset: String((page - 1) * limit),
		meta: 'filter_count',
		filter: JSON.stringify(filter)
	});
	const result = await directusServerJson<{ data: AppNotification[]; meta?: { filter_count?: number } }>(
		`/items/app_notifications?${query.toString()}`
	);
	return { data: result?.data || [], total: result?.meta?.filter_count ?? 0 };
}

export async function countUnread(karyawanId: number): Promise<number> {
	const query = new URLSearchParams({
		filter: JSON.stringify({ karyawan_id: { _eq: karyawanId }, read: { _eq: false } }),
		'aggregate[count]': 'id'
	});
	const result = await directusServerJson<{ data: { count: string | number }[] }>(`/items/app_notifications?${query.toString()}`);
	return Number(result?.data?.[0]?.count || 0);
}

/** Ownership check dulu (karyawan_id harus milik pemanggil) sebelum menandai dibaca. */
export async function markNotificationRead(id: number | string, karyawanId: number): Promise<void> {
	const query = new URLSearchParams({ fields: 'id,karyawan_id' });
	const row = await directusServerJson<{ data: { id: number; karyawan_id: number | null } }>(
		`/items/app_notifications/${id}?${query.toString()}`
	);
	if (!row?.data) throw new Error('Notifikasi tidak ditemukan.');
	if (String(row.data.karyawan_id) !== String(karyawanId)) {
		throw new Error('Anda tidak memiliki akses ke notifikasi ini.');
	}
	await directusServerJson(`/items/app_notifications/${id}`, {
		method: 'PATCH',
		body: JSON.stringify({ read: true, read_at: new Date().toISOString() })
	});
}

/** Ownership check + ambil attachment_file_id, dipakai endpoint download. */
export async function getNotificationAttachment(id: number | string, karyawanId: number): Promise<string> {
	const query = new URLSearchParams({ fields: 'id,karyawan_id,attachment_file_id' });
	const row = await directusServerJson<{ data: { karyawan_id: number | null; attachment_file_id: string | null } }>(
		`/items/app_notifications/${id}?${query.toString()}`
	);
	if (!row?.data) throw new Error('Notifikasi tidak ditemukan.');
	if (String(row.data.karyawan_id) !== String(karyawanId)) {
		throw new Error('Anda tidak memiliki akses ke notifikasi ini.');
	}
	if (!row.data.attachment_file_id) throw new Error('Notifikasi ini tidak punya lampiran.');
	return row.data.attachment_file_id;
}
