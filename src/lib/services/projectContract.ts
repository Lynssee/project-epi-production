// src/lib/services/projectContract.ts
// Modul 4 (Dashboard Lapangan — Kontrak View) — baca ringkasan kontrak proyek untuk Project
// Leader. Sengaja TIDAK mengambil nilai_kontrak/dp_amount/amount/persentase — keputusan user:
// tetap konsisten dgn pola app ini yg sudah menyembunyikan angka finansial dari view leader
// (RAP penuh -> "Detail Pekerjaan" tanpa uang). Read-only, sumber kebenaran tetap di Admin ERP.

import { secureDirectusJson, getIdToken } from './secureDirectus';
import { calculateProjectProgressPercentage } from '$lib/utils/projectProgress';

export interface ProjectContractSummary {
	id: string;
	dp_status: string | null;
	retensi_pct: number | null;
	retensi_max_days: number | null;
	bast_final_date: string | null;
	project_id: string;
}

export interface ProjectContractTermin {
	id: number;
	urutan: number;
	label: string;
	status: string;
	bast_date: string | null;
	billed_date: string | null;
	paid_date: string | null;
	progress_trigger_pct: number | null;
	ba_document_output_id: number | null;
}

export interface ProjectBaDocument {
	id: number;
	nama_dokumen: string;
	file_id: string | null;
	generator_output_id: number | null;
	date_created: string | null;
}

export async function getProjectContractSummary(projectId: string | number): Promise<ProjectContractSummary | null> {
	try {
		const res = await secureDirectusJson(
			`/items/project_contract?filter[project_id][_eq]=${encodeURIComponent(String(projectId))}&limit=1&fields=id,dp_status,retensi_pct,retensi_max_days,bast_final_date,project_id`
		);
		return res?.data?.[0] || null;
	} catch {
		return null;
	}
}

export async function getProjectContractTermins(contractId: string): Promise<ProjectContractTermin[]> {
	try {
		const res = await secureDirectusJson(
			`/items/project_contract_termin?filter[project_contract_id][_eq]=${encodeURIComponent(contractId)}&sort=urutan&limit=-1&fields=id,urutan,label,status,bast_date,billed_date,paid_date,progress_trigger_pct,ba_document_output_id`
		);
		return res?.data || [];
	} catch {
		return [];
	}
}

/**
 * Berita Acara sudah digenerate untuk proyek ini (Auto-Generate BA — Fase 0/1/2, admin ERP) —
 * dibaca dari project_documents (kategori 'Berita Acara'), BUKAN dari doc_generator_output
 * langsung, supaya konsisten dgn kartu "WAJIB" di tab Dokumen Admin (satu sumber kebenaran).
 * Read-only, view-only — Lapangan TIDAK generate BA sendiri (keputusan user, 16 Agustus 2026):
 * mesin generate (jsPDF + Document Generator) sengaja tidak di-port ke sini, terlalu besar &
 * berisiko untuk diduplikasi lintas dua aplikasi (lihat catatan di generateBastForTermin, admin
 * erp-epi-1/src/lib/services/projectContractApi.js).
 */
export async function getProjectBaDocuments(projectId: string | number): Promise<ProjectBaDocument[]> {
	try {
		const res = await secureDirectusJson(
			`/items/project_documents?filter[project_id][_eq]=${encodeURIComponent(String(projectId))}&filter[kategori][_eq]=Berita Acara&sort=-date_created&limit=-1&fields=id,nama_dokumen,file_id,generator_output_id,date_created`
		);
		return res?.data || [];
	} catch {
		return [];
	}
}

/**
 * Termin yang progres fisiknya sudah lewat ambang wajib-BA tapi status masih
 * not_started/in_progress — port murni dari getOverdueBastTermins() (admin erp-epi-1
 * projectContractApi.js). Dipakai untuk banner status di ProjectKontrakPanel.svelte.
 */
export function getOverdueBastTermins(project: any, termins: ProjectContractTermin[]): ProjectContractTermin[] {
	if (!project || !Array.isArray(termins)) return [];
	const physicalPct = calculateProjectProgressPercentage(project);
	return termins.filter(
		(t) =>
			t.progress_trigger_pct != null &&
			['not_started', 'in_progress'].includes(t.status) &&
			physicalPct >= t.progress_trigger_pct
	);
}

/** Sisa hari retensi — port murni dari admin ERP projectContractApi.js, tanpa nilai Rp. */
export function retentionDaysRemaining(contract: ProjectContractSummary): number | null {
	if (!contract?.bast_final_date || !contract?.retensi_max_days) return null;
	const elapsed = Math.floor((Date.now() - new Date(contract.bast_final_date).getTime()) / 86400000);
	return Math.max(0, contract.retensi_max_days - elapsed);
}

/** Status pengajuan BA per termin (Fase 4 Finance Hardening, 18 Agu 2026) — dipakai supaya
 * tombol "Ajukan Pembuatan BA" berubah jadi status begitu sudah pernah diajukan, tidak dobel. */
export async function getBastRequestsForTermins(terminIds: string[]): Promise<Record<string, { id: number; status: string }>> {
	if (!terminIds || terminIds.length === 0) return {};
	try {
		const res = await secureDirectusJson(
			`/items/bast?filter[termin_id][_in]=${terminIds.map(encodeURIComponent).join(',')}&fields=id,termin_id,status&limit=-1`
		);
		const map: Record<string, { id: number; status: string }> = {};
		for (const b of res?.data || []) {
			if (b.termin_id) map[String(b.termin_id)] = { id: b.id, status: b.status };
		}
		return map;
	} catch {
		return {};
	}
}

/**
 * Ajukan pembuatan BA dari lapangan (Fase 4 Finance Hardening, 18 Agu 2026) — untuk termin
 * yang progres fisiknya sudah lewat ambang wajib-BA tapi BA belum digenerate. Menulis ke
 * `bast` (status='requested') lewat server, BUKAN generate BA sendiri — tetap sesuai keputusan
 * 16 Agustus 2026 (mesin generate hanya di Admin ERP).
 */
export async function requestBAST(
	projectId: number,
	terminId: string,
	notes: string,
	extra?: { standbyNotes?: string; dispositionType?: string; targetDate?: string }
): Promise<{ success: boolean; data?: any }> {
	const token = await getIdToken();
	const res = await fetch('/api/proyek/kontrak/request-ba', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({
			projectId,
			terminId,
			notes,
			standbyNotes: extra?.standbyNotes || '',
			dispositionType: extra?.dispositionType || '',
			targetDate: extra?.targetDate || ''
		})
	});
	const text = await res.text();
	let parsed: any = null;
	try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
	if (!res.ok) throw new Error(parsed?.message || `Gagal mengajukan (${res.status})`);
	return parsed;
}

export async function submitAddendumRequest(params: {
	projectId: number;
	contractId: string;
	jenisPerubahan: 'jadwal' | 'judul_scope' | 'lainnya';
	alasan: string;
	proposedValue: string;
}): Promise<{ success: boolean; data?: any }> {
	const token = await getIdToken();
	const res = await fetch('/api/proyek/kontrak/addendum', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify(params)
	});
	const text = await res.text();
	let parsed: any = null;
	try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
	if (!res.ok) throw new Error(parsed?.message || `Gagal mengajukan (${res.status})`);
	return parsed;
}

// Fase 4 Kontrak Jatuh Tempo Terpusat — kontrak proyek-customer (tipe_kontrak='proyek_customer')
// dari contract_registry, batch _in lintas proyek yang di-scope user. Tanpa nilai_kontrak/
// mata_uang — sama keputusan finansial dgn fungsi lain di file ini.
export interface ContractExpiryRow {
	id: number;
	judul: string;
	pihak_2: string | null;
	status: string;
	tanggal_berakhir: string | null;
	project_id: number;
}

export async function getContractExpiryForProjects(projectIds: (number | string)[]): Promise<ContractExpiryRow[]> {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const filter = encodeURIComponent(
			JSON.stringify({ project_id: { _in: projectIds }, tipe_kontrak: { _eq: 'proyek_customer' } })
		);
		const res = await secureDirectusJson(
			`/items/contract_registry?filter=${filter}&fields=id,judul,pihak_2,status,tanggal_berakhir,project_id&sort=tanggal_berakhir&limit=-1`
		);
		return res?.data || [];
	} catch (err) {
		console.error('getContractExpiryForProjects:', err);
		return [];
	}
}

// R10 — Subcontractor Performance at Glance. Read-only join contract_registry (tipe_kontrak
// subkontraktor, project_id ini) + master_supplier (status/skor_total). Tanpa nilai Rp — sama
// keputusan finansial dgn fungsi lain di file ini.
export interface SubcontractorPerformance {
	contractJudul: string;
	namaMitra: string | null;
	contractStatus: string;
	tanggalBerakhir: string | null;
	supplierStatus: string | null;
	skorTotal: number | null;
}

export async function getSubcontractorPerformance(projectId: string | number): Promise<SubcontractorPerformance[]> {
	try {
		const contractsRes = await secureDirectusJson(
			`/items/contract_registry?filter[project_id][_eq]=${encodeURIComponent(String(projectId))}&filter[tipe_kontrak][_eq]=subkontraktor&fields=id,judul,pihak_2,pihak_2_ref_id,status,tanggal_berakhir`
		);
		const contracts = contractsRes?.data || [];
		if (contracts.length === 0) return [];

		const supplierIds = [...new Set(contracts.map((c: any) => c.pihak_2_ref_id).filter(Boolean))];
		let supplierMap = new Map<string, any>();
		if (supplierIds.length > 0) {
			const suppliersRes = await secureDirectusJson(
				`/items/master_supplier?filter[id][_in]=${supplierIds.join(',')}&fields=id,status,skor_total`
			);
			for (const s of suppliersRes?.data || []) supplierMap.set(String(s.id), s);
		}

		return contracts.map((c: any) => {
			const supplier = c.pihak_2_ref_id ? supplierMap.get(String(c.pihak_2_ref_id)) : null;
			return {
				contractJudul: c.judul,
				namaMitra: c.pihak_2,
				contractStatus: c.status,
				tanggalBerakhir: c.tanggal_berakhir,
				supplierStatus: supplier?.status ?? null,
				skorTotal: supplier?.skor_total != null ? parseFloat(supplier.skor_total) : null
			};
		});
	} catch {
		return [];
	}
}

export const TERMIN_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
	not_started: { label: 'Belum Dimulai', cls: 'bg-gray-100 text-gray-500' },
	in_progress: { label: 'Dikerjakan', cls: 'bg-blue-100 text-blue-700' },
	bast_pending: { label: 'BAST Pending TTD', cls: 'bg-amber-100 text-amber-700' },
	bast_signed: { label: 'BAST Ditandatangani', cls: 'bg-purple-100 text-purple-700' },
	billed: { label: 'Sudah Ditagih', cls: 'bg-orange-100 text-orange-700' },
	paid: { label: 'Lunas', cls: 'bg-emerald-100 text-emerald-700' },
	retention_held: { label: 'Retensi Ditahan', cls: 'bg-indigo-100 text-indigo-700' },
	retention_released: { label: 'Retensi Cair', cls: 'bg-teal-100 text-teal-700' }
};
