// src/routes/api/site-checkin/my-prospects/+server.ts
// "4-Gate Site Visit System" Fase 3 (8 Sep 2026) — GET: daftar prospect kandidat untuk
// dropdown check-in tipe 'marketing'. Union dari:
//   1) prospects.assigned_name cocok PERSIS dengan nama karyawan (miliknya, prioritas)
//   2) Seluruh prospect aktif lain (stage belum won/lost) untuk kunjungan siapa saja.
// Pola sama my-projects/+server.ts — identitas SELALU dari token Firebase.
//
// Paket 04 §3.7 catatan: doc menyarankan prioritaskan prospects.assigned_to (FK ke
// directus_users.id) bila terisi — TIDAK diimplementasikan di sini karena authenticateEss/ESS
// hanya membawa identitas Firebase (karyawan.id, email), tidak ada pemetaan ke directus_users.id
// yang bisa dipercaya di jalur ini. Endpoint ini juga TIDAK LAGI dipakai Site Check-in (tab
// Marketing diarahkan keluar, paket 08a) — pemakainya kini tab Prospek di /sales/baru (paket
// 08c), yang punya konteks auth Directus asli dan tempat yang tepat untuk fix assigned_to.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export interface ProspectOption {
	id: number;
	name: string;
	company: string | null;
	stage: string | null;
	peran: 'assigned' | 'lainnya';
}

const ACTIVE_STAGES_EXCLUDE = ['won', 'lost'];

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const results = new Map<number, ProspectOption>();

	try {
		if (karyawan.nama_karyawan) {
			// Paket 04 §3.7: ambil kandidat _icontains, lalu saring nama PERSIS (case-insensitive,
			// trim) di server — sama pola seperti fix leader di my-projects/+server.ts (nama pendek
			// sebelumnya bisa mencocokkan prospek salesman lain).
			const query = new URLSearchParams({
				filter: JSON.stringify({
					_and: [
						{ stage: { _nin: ACTIVE_STAGES_EXCLUDE } },
						{ assigned_name: { _icontains: karyawan.nama_karyawan } }
					]
				}),
				fields: 'id,name,company,stage,assigned_name',
				sort: '-lead_date',
				limit: '-1'
			});
			const res = await directusServerJson<{ data: any[] }>(`/items/prospects?${query.toString()}`);
			const namaKaryawan = karyawan.nama_karyawan.trim().toLowerCase();
			for (const p of res?.data || []) {
				if ((p.assigned_name || '').trim().toLowerCase() === namaKaryawan) {
					results.set(p.id, { id: p.id, name: p.name, company: p.company || null, stage: p.stage || null, peran: 'assigned' });
				}
			}
		}
	} catch (e) {
		console.warn('[SiteCheckin] Error fetching assigned prospects:', e);
	}

	const assignedCount = results.size;

	try {
		const allQuery = new URLSearchParams({
			filter: JSON.stringify({ stage: { _nin: ACTIVE_STAGES_EXCLUDE } }),
			fields: 'id,name,company,stage',
			sort: '-lead_date',
			limit: '200'
		});
		const allRes = await directusServerJson<{ data: any[] }>(`/items/prospects?${allQuery.toString()}`);
		for (const p of allRes?.data || []) {
			if (!results.has(p.id)) {
				results.set(p.id, { id: p.id, name: p.name, company: p.company || null, stage: p.stage || null, peran: 'lainnya' });
			}
		}
	} catch (e) {
		console.warn('[SiteCheckin] Error fetching active prospects:', e);
	}

	const allProspects = [...results.values()].sort((a, b) => {
		if (a.peran !== b.peran) return a.peran === 'assigned' ? -1 : 1;
		return (a.name || '').localeCompare(b.name || '');
	});

	return json({ prospects: allProspects, assignedCount });
};
