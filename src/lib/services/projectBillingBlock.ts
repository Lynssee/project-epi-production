// src/lib/services/projectBillingBlock.ts
// §7 Dashboard Lapangan — Papan Keputusan Proyek Tersandera, Penajaman Sistem AR v2, Fase 7
// (26 Agu 2026). Sengaja TIDAK mengambil nilai_tertahan/biaya_sejak_tersandera/eksposur_kas/
// skor_bukti/pihak_bersalah — sama kebijakan dgn projectContract.ts: Leader tahu ADA masalah,
// tidak perlu tahu angka labanya (§7 "Yang sengaja TIDAK direkomendasikan"). Read-only, sumber
// kebenaran & keputusan lanjut/hold tetap di Admin ERP.

import { secureDirectusJson, getIdToken } from './secureDirectus';

export interface ProjectBillingBlock {
	id: number;
	penyebab: string | null;
	keputusan: string | null;
	keputusan_alasan: string | null;
	tinjau_ulang_tanggal: string | null;
	status: string;
	tanggal_hak_lahir: string | null;
}

const PENYEBAB_LABEL: Record<string, string> = {
	customer_belum_ttd: 'Menunggu tanda tangan pelanggan',
	customer_belum_terima_pekerjaan: 'Menunggu konfirmasi terima pekerjaan',
	sengketa_volume: 'Sengketa volume pekerjaan',
	temuan_qc_terbuka: 'Masih ada temuan QC terbuka',
	dokumen_internal_kurang: 'Dokumen internal belum lengkap',
	po_belum_terbit: 'PO pelanggan belum terbit',
	lain: 'Lainnya'
};

export function penyebabLabel(penyebab: string | null): string {
	return (penyebab && PENYEBAB_LABEL[penyebab]) || 'Belum ditentukan';
}

export async function getActiveBillingBlocks(projectId: string | number): Promise<ProjectBillingBlock[]> {
	try {
		const res = await secureDirectusJson(
			`/items/project_billing_block?filter[project_id][_eq]=${encodeURIComponent(String(projectId))}&filter[status][_eq]=aktif` +
				`&fields=id,penyebab,keputusan,keputusan_alasan,tinjau_ulang_tanggal,status,tanggal_hak_lahir&limit=-1`
		);
		return res?.data || [];
	} catch {
		return [];
	}
}

/** FL3 — unggah bukti pengiriman BAST (foto tanda terima/screenshot email). */
export async function uploadBastFollowupProof(params: {
	projectId: number;
	terminId: string | null;
	channel: 'wa' | 'email' | 'visit' | 'other';
	contactPerson: string;
	file: File;
}): Promise<{ success: boolean; data?: any }> {
	const token = await getIdToken();
	const form = new FormData();
	form.append('projectId', String(params.projectId));
	if (params.terminId) form.append('terminId', params.terminId);
	form.append('channel', params.channel);
	form.append('contactPerson', params.contactPerson);
	form.append('bukti', params.file);

	const res = await fetch('/api/proyek/kontrak/bast-followup', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: form
	});
	const text = await res.text();
	let parsed: any = null;
	try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
	if (!res.ok) throw new Error(parsed?.message || `Gagal mengunggah (${res.status})`);
	return parsed;
}
