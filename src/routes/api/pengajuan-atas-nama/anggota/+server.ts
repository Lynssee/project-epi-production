// src/routes/api/pengajuan-atas-nama/anggota/+server.ts
// Daftar calon pemohon untuk "Ajukan Atas Nama" di proyek tertentu. Hak ditentukan SERVER
// (Leader/Wakil proyek ini, atau Supervisor berizin `ajukan_atas_nama`) — UI hanya menampilkan
// panel bila `allowed`. Nomor HP tidak pernah dikirim ke klien (hanya penanda punyaHp).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { authorizeAtasNama } from '$lib/server/pengajuanAtasNama';

export const GET: RequestHandler = async (event) => {
	const user: any = await requireUser(event);
	const projectId = Number(event.url.searchParams.get('projectId'));
	if (!Number.isFinite(projectId) || projectId <= 0) return json({ allowed: false, anggota: [], message: 'Pilih proyek dulu.' });

	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const r = await authorizeAtasNama({ idToken, uid: user.uid || user.localId, email: user.email, projectId });
	return json({
		allowed: r.ok,
		anggota: r.ok ? r.anggota : [],
		pengisiKaryawanId: r.pengisi?.id ?? null,
		message: r.ok ? null : (r as any).message || null
	});
};
