// src/lib/server/visitLeaderBridge.ts
// Fase 3 (Q7-a): check-out site_checkin menulis 1 baris project_visit_leader otomatis,
// supaya admin berhenti mengetik ulang kunjungan yang sudah tercatat GPS + foto (S-4).
// Kill-switch TERPISAH dari jembatan payroll (tulis_visit_leader_aktif). Kegagalan di sini
// TIDAK PERNAH boleh menggagalkan check-out — selalu dipanggil di dalam try/catch oleh caller.

import { directusServerJson } from '$lib/server/directus';

// Fetch settings langsung (bukan import dari siteCheckin.ts) supaya tidak terjadi circular
// import — siteCheckin.ts memanggil bridgeToVisitLeader() dari closeCheckin().
async function getTulisVisitLeaderAktif(): Promise<boolean> {
	const result = await directusServerJson<{ data: { tulis_visit_leader_aktif: boolean } }>('/items/site_checkin_settings');
	return !!result?.data?.tulis_visit_leader_aktif;
}

export interface VisitLeaderBridgeInput {
	siteCheckinId: string;
	karyawanId: string;
	karyawanNama: string;
	projectId: number;
	lokasi: string | null;
	tanggal: string; // YYYY-MM-DD (WIB)
	kegiatan?: string | null;
	temuan?: string | null;
	tindakLanjut?: string | null;
	rencanaBesok?: string | null;
	sumber?: 'site_checkin' | 'auto_report' | 'manual'; // SV-14: default 'site_checkin' bila tak diisi
}

export async function bridgeToVisitLeader(
	input: VisitLeaderBridgeInput
): Promise<{ created: boolean; visitLeaderId: number | null }> {
	const aktif = await getTulisVisitLeaderAktif();
	if (!aktif) {
		return { created: false, visitLeaderId: null };
	}

	const payload = {
		tanggal_kunjungan: input.tanggal,
		project_id: input.projectId,
		leader: input.karyawanNama,
		lokasi: input.lokasi || '',
		kegiatan: input.kegiatan || '',
		temuan: input.temuan || '',
		tindak_lanjut: input.tindakLanjut || '',
		rencana_besok: input.rencanaBesok || '',
		status: 'open',
		site_checkin_id: input.siteCheckinId,
		karyawan_id: input.karyawanId,
		sumber: input.sumber || 'site_checkin'
	};

	const result = await directusServerJson<{ data: { id: number } }>('/items/project_visit_leader', {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	return { created: true, visitLeaderId: result?.data?.id ?? null };
}
