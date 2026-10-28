// src/lib/services/kasbonManpowerTerpusat.ts
// Fase 5 Kasbon & Piutang Manpower Terpusat — read-only, lintas proyek. Sengaja file TERPISAH
// dari ess/manpowerKasbon.ts: file itu punya konvensi eksplisit "tidak pernah akses Directus
// langsung" (submit selalu lewat /api/ess/kasbon-manpower) — baca-saja untuk monitoring tidak
// perlu lewat endpoint itu, jadi dipisah supaya konvensi file lama tidak dilanggar.

import { secureDirectusJson } from './secureDirectus';

export interface KasbonManpowerRow {
	id: number;
	manpower_id: number;
	manpower_nama: string;
	project_id: number;
	nominal: number;
	total_paid: number;
	sisa: number;
	status: string;
	payment_status: string;
	tanggal_pengajuan: string | null;
}

/** Kasbon manpower (subjek_tipe='manpower') untuk proyek-proyek tertentu (batch _in). project_id
 *  adalah field langsung di record kasbon (ditulis saat submit) — tidak perlu join manpower_assignment. */
export async function getKasbonManpowerForProjects(projectIds: (number | string)[]): Promise<KasbonManpowerRow[]> {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const filter = encodeURIComponent(
			JSON.stringify({ subjek_tipe: { _eq: 'manpower' }, project_id: { _in: projectIds } })
		);
		const res = await secureDirectusJson(
			`/items/kasbon?filter=${filter}&fields=id,manpower_id,project_id,nominal,total_paid,status,payment_status,tanggal_pengajuan&sort=-id&limit=-1`
		);
		const rows = res?.data || [];
		if (rows.length === 0) return [];

		const manpowerIds = [...new Set(rows.map((r: any) => r.manpower_id).filter(Boolean))];
		let manpowerMap: Record<number, { nama?: string }> = {};
		if (manpowerIds.length > 0) {
			const mRes = await secureDirectusJson(
				`/items/manpower?filter[id][_in]=${manpowerIds.join(',')}&fields=id,nama&limit=-1`
			);
			for (const m of mRes?.data || []) manpowerMap[m.id] = m;
		}

		return rows.map((r: any) => ({
			id: r.id,
			manpower_id: r.manpower_id,
			manpower_nama: manpowerMap[r.manpower_id]?.nama || `Pekerja Lapangan #${r.manpower_id}`,
			project_id: r.project_id,
			nominal: Number(r.nominal || 0),
			total_paid: Number(r.total_paid || 0),
			sisa: Number(r.nominal || 0) - Number(r.total_paid || 0),
			status: r.status,
			payment_status: r.payment_status,
			tanggal_pengajuan: r.tanggal_pengajuan || null
		}));
	} catch (err) {
		console.error('getKasbonManpowerForProjects:', err);
		return [];
	}
}
