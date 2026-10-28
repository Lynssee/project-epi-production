// src/lib/services/penagihanProyek.ts
// Forecast Keuangan Global — Fase 4 (Visibilitas AR untuk Lapangan, Gap G6).
// Project Leader saat ini BUTA terhadap status penagihan customer (AR) — tidak tahu
// apakah progres yang dilaporkan sudah ditagihkan atau belum. Modul ini READ-ONLY:
// status per termin kontrak proyek, TANPA nominal (kebijakan house default project-epi,
// sama pola dgn project.field_bep.show_rupiah — lihat projectSettings.ts).
//
// Fetching TERPISAH per koleksi (Aturan #1/#2 CLAUDE.md, sama seperti admin erp-epi-1):
// project_contract -> project_contract_termin -> invoices -> penagihan_followup.
// Nol query relasi bersarang.

import directus from './directus';
import { readItems } from '@directus/sdk';
import { getProjectSetting } from './projectSettings';

export type PenagihanStatus = 'lunas' | 'menunggu_bayar' | 'sudah_terbit' | 'belum_ditagih';

export interface PenagihanTerminRow {
	project_id: number | string;
	project_name: string;
	contract_id: number | string;
	termin_id: number | string;
	termin_label: string;
	urutan: number;
	status: PenagihanStatus;
	invoice_number: string | null;
	promised_date: string | null;
	due_date: string | null;
	amount: number | null; // null bila show_rupiah=false (disaring di sini, bukan di UI)
	/** true bila progress_trigger_reached_at SUDAH terisi (ambang progres fisik tercapai)
	 * tapi status masih 'belum_ditagih' — sinyal "harusnya sudah ditagih, belum" untuk R6
	 * (kartu Kesehatan Keuangan Proyek), BUKAN sekadar "belum waktunya". */
	billing_overdue: boolean;
}

function resolveId(v: any): number | string | null {
	if (v === null || v === undefined) return null;
	return typeof v === 'object' ? (v.id ?? null) : v;
}

function statusOf(invoice: any, hasPromise: boolean): PenagihanStatus {
	if (!invoice) return 'belum_ditagih';
	const paymentStatus = String(invoice.payment_status || '').toUpperCase();
	if (paymentStatus === 'PAID') return 'lunas';
	const outstanding = invoice.outstanding_amount ?? (Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0));
	if (outstanding <= 0) return 'lunas';
	return hasPromise ? 'menunggu_bayar' : 'sudah_terbit';
}

/**
 * Status penagihan (per termin kontrak) untuk proyek-proyek yang diberikan. Read-only,
 * tanpa tulis apa pun ke Directus. `showRupiah` diambil dari system_settings
 * (project.field_penagihan.show_rupiah) — dipanggil onMount sebelum ini.
 */
export async function fetchPenagihanStatusForProjects(
	projects: Array<{ id: number | string; name: string }>
): Promise<PenagihanTerminRow[]> {
	if (!projects || projects.length === 0) return [];
	const showRupiah = getProjectSetting('project.field_penagihan.show_rupiah') === true;
	const projectIds = projects.map((p) => p.id);
	const projectNameById = new Map(projects.map((p) => [String(p.id), p.name]));

	try {
		// 1) Kontrak proyek — koleksi TERPISAH.
		const contracts = (await directus.request(
			readItems('project_contract' as any, {
				filter: { project_id: { _in: projectIds } },
				fields: ['id', 'project_id'],
				limit: -1
			})
		)) as any[];
		if (!contracts.length) return [];
		const contractIds = contracts.map((c) => c.id);
		const projectIdByContractId = new Map(contracts.map((c) => [String(c.id), resolveId(c.project_id)]));

		// 2) Termin per kontrak — koleksi TERPISAH.
		const termins = (await directus.request(
			readItems('project_contract_termin' as any, {
				filter: { project_contract_id: { _in: contractIds } },
				fields: ['id', 'project_contract_id', 'urutan', 'label', 'amount', 'invoice_id', 'progress_trigger_reached_at'],
				sort: ['urutan'],
				limit: -1
			})
		)) as any[];
		if (!termins.length) return [];

		// 3) Invoice SALES yang relevan (project_id di daftar proyek) — koleksi TERPISAH.
		const invoices = (await directus.request(
			readItems('invoices' as any, {
				filter: {
					invoice_type: { _eq: 'SALES' },
					project_id: { _in: projectIds }
				},
				fields: [
					'id', 'invoice_number', 'project_id', 'contract_termin_id', 'payment_status',
					'outstanding_amount', 'total_amount', 'paid_amount', 'due_date', 'invoice_date'
				],
				limit: -1
			})
		)) as any[];
		const invoiceByTerminId = new Map<string, any>();
		const invoiceById = new Map<string, any>();
		for (const inv of invoices) {
			invoiceById.set(String(inv.id), inv);
			const terminId = resolveId(inv.contract_termin_id);
			if (terminId != null) invoiceByTerminId.set(String(terminId), inv);
		}

		// 4) Janji bayar terbaru (arah='AR') — koleksi TERPISAH, dipakai bedakan
		//    "sudah terbit invoice" (belum di-follow-up) vs "menunggu bayar" (ada janji).
		const invoiceIds = invoices.map((i) => i.id);
		const promiseByInvoiceId = new Map<string, string>();
		if (invoiceIds.length > 0) {
			const promises = (await directus.request(
				readItems('penagihan_followup' as any, {
					filter: { arah: { _eq: 'AR' }, ref_id: { _in: invoiceIds } },
					fields: ['ref_id', 'promised_date'],
					sort: ['-follow_up_date', '-id'],
					limit: -1
				})
			)) as any[];
			for (const p of promises) {
				const key = String(p.ref_id);
				if (!promiseByInvoiceId.has(key) && p.promised_date) promiseByInvoiceId.set(key, p.promised_date);
			}
		}

		const rows: PenagihanTerminRow[] = [];
		for (const termin of termins) {
			const contractId = resolveId(termin.project_contract_id);
			const projectId = contractId != null ? projectIdByContractId.get(String(contractId)) : null;
			if (projectId == null) continue;

			const directInvoiceId = resolveId(termin.invoice_id);
			const invoice = (directInvoiceId != null ? invoiceById.get(String(directInvoiceId)) : null)
				|| invoiceByTerminId.get(String(termin.id))
				|| null;
			const promisedDate = invoice ? promiseByInvoiceId.get(String(invoice.id)) || null : null;
			const status = statusOf(invoice, !!promisedDate);

			rows.push({
				project_id: projectId,
				project_name: projectNameById.get(String(projectId)) || `Proyek #${projectId}`,
				contract_id: contractId as number | string,
				termin_id: termin.id,
				termin_label: termin.label || `Termin ke-${termin.urutan}`,
				urutan: termin.urutan || 0,
				status,
				invoice_number: invoice?.invoice_number || null,
				promised_date: promisedDate,
				due_date: invoice?.due_date || null,
				amount: showRupiah ? Number(termin.amount || 0) : null,
				billing_overdue: status === 'belum_ditagih' && !!termin.progress_trigger_reached_at
			});
		}

		rows.sort((a, b) => {
			const pn = String(a.project_name).localeCompare(String(b.project_name));
			if (pn !== 0) return pn;
			return (a.urutan || 0) - (b.urutan || 0);
		});
		return rows;
	} catch (error) {
		console.warn('[penagihanProyek] Gagal memuat status penagihan:', error);
		return [];
	}
}

export const PENAGIHAN_STATUS_META: Record<PenagihanStatus, { label: string; icon: string; cls: string }> = {
	lunas: { label: 'Lunas', icon: '✅', cls: 'text-emerald-600' },
	menunggu_bayar: { label: 'Menunggu Bayar', icon: '⏳', cls: 'text-amber-600' },
	sudah_terbit: { label: 'Sudah Terbit Invoice', icon: '📤', cls: 'text-sky-600' },
	belum_ditagih: { label: 'Belum Ditagih', icon: '⚠️', cls: 'text-gray-500' }
};
