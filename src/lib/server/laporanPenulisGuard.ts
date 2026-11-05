// src/lib/server/laporanPenulisGuard.ts
// Guard untuk endpoint yang melayani PENULIS Laporan Harian sebuah proyek (Kiosk Proyek, Fase 4).
// Laporan harian ditulis Project Leader (karyawan, leader_id) ATAU Manpower Leader/Wakil — jadi guard
// memakai resolver cakupan proyek yang sama dengan proxy Directus (fieldProjectScope): role penuh-lihat
// lolos, selain itu wajib memegang kursi di PROYEK ITU. Role saja tidak cukup (role tidak mengikat ke proyek).

import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveFieldProjectScope } from '$lib/server/fieldProjectScope';

export interface PenulisLaporan {
	uid: string;
	email: string;
}

export async function authenticatePenulisLaporan(event: RequestEvent, projectId: number): Promise<PenulisLaporan> {
	const user = await requireUser(event);
	const token = (event.request.headers.get('authorization') || '').slice(7);
	const scope = await resolveFieldProjectScope(token, user.localId, user.email);
	if (!scope.unrestricted && !scope.projectIds.includes(projectId)) {
		throw error(403, 'Anda bukan leader di proyek ini.');
	}
	return { uid: user.localId, email: user.email };
}
