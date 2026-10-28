// src/routes/api/ess/izin-jam/active/+server.ts
// ESS HRD v3 Fase 2 — daftar izin jam-jaman aktif hari ini, untuk panel di satpam/gate
// (mirror pola panel "Sedang di Luar" existing). Digerbangi permission 'gate_log'.

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';

export async function GET(event: RequestEvent) {
	const user = await requireUser(event);
	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const { permissions } = await getUserPermissions(idToken, user.localId, { email: user.email });
	if (!hasAnyPermission(permissions, 'gate_log')) {
		throw error(403, 'Tidak punya izin melihat daftar izin jam-jaman.');
	}

	const tanggal = todayJakarta();
	const query = new URLSearchParams({
		'filter[tanggal][_eq]': tanggal,
		'filter[status][_in]': 'disetujui,out_scanned',
		fields: 'id,status,estimasi_durasi_jam,jam_keluar_aktual,karyawan_id.nama_karyawan,kategori_id.nama',
		limit: '-1'
	});
	const result = await directusServerJson(`/items/izin_jam_request?${query.toString()}`);
	return json({ data: result?.data || [] });
}
