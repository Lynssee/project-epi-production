// src/lib/utils/paStatusLapangan.ts
// MURNI. Fase 5a & 5b (audit hidden cost #1051 & penajaman birokrasi, 21 Okt 2026).
// Status antrean birokrasi & komitmen tertahan untuk Project Leader di lapangan:
// 1. Pengajuan Anggaran (PA) pending approval
// 2. Packing List Draft (belum diajukan ke gudang) & In-Flight (requested/approved belum full SJ)
// 3. Pembelian Lokal Proyek (menunggu approval)
// 4. Klaim Reimbursement Lapangan (BBM/Tol/operasional talangan diajukan)
//
// ⚠️ ATURAN KERAHASIAAN HPP (KEPUTUSAN USER 21 OKT 2026 - "DIBATASI"):
// Nominal rupiah TIDAK PERNAH dimuat atau dikeluarkan untuk Project Leader.
// Hanya menampilkan jumlah item, nama barang/keperluan, nomor dokumen, tahap approval,
// umur antrean, dan lampu SLA.

export const DEFAULT_SLA_HOURS = 48;
const HOUR = 3_600_000;

export type PaLevel = 'green' | 'yellow' | 'red' | 'unknown';

export type BirokrasiChannel =
	| 'pa_pending'
	| 'packing_list_draft'
	| 'packing_list_in_flight'
	| 'pembelian_lokal'
	| 'klaim_reimbursement';

export interface PaStatusItem {
	pa_id: number;
	nomor: string;
	tujuan: string;
	request_id: string | null;
	tahap: number | null;
	posisi: string | null;
	umur_jam: number | null;
	sla_jam: number;
	sla_default: boolean;
	melewati_sla_jam: number | null;
	level: PaLevel;
	tanpa_approval_request: boolean;
	gate_belum_dievaluasi: boolean;
}

export interface BirokrasiItem {
	channel: BirokrasiChannel;
	id: string | number;
	nomor: string;
	judul: string;
	deskripsi?: string;
	status: string;
	status_label: string;
	tahap: string | null;
	posisi: string | null;
	approver_nama: string | null;
	umur_jam: number | null;
	sla_jam: number;
	melewati_sla_jam: number | null;
	level: PaLevel;
	is_overdue: boolean;
	item_count?: number;
	qty?: number;
	unit?: string;
	is_stale_draft?: boolean;
	action_hint?: string;
	action_link?: string;
	request_id?: string | null;
}

export interface BirokrasiSummary {
	total_birokrasi_count: number;
	total_overdue_count: number;
	draft_pl_count: number;
	draft_pl_stale_count: number;
	in_flight_pl_count: number;
	pa_pending_count: number;
	pembelian_lokal_count: number;
	reimbursement_count: number;
}

export interface PaStatusResult {
	items: PaStatusItem[];
	total_count: number;
	overdue_count: number;
	gate_belum_dievaluasi_count: number;
	birokrasi_items: BirokrasiItem[];
	summary: BirokrasiSummary;
}

const num = (v: unknown) => Number(v) || 0;
const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

export function buildPaStatusLapangan(
	p: {
		pas?: any[] | null;
		requests?: any[] | null;
		lastActionByReq?: Record<string, string>;
		stepsByWorkflow?: Record<string, Array<{ step_order: number; sla_hours: number | null }>>;
		packingListItems?: any[] | null;
		localPurchases?: any[] | null;
		reimbursements?: any[] | null;
		now?: Date;
	} = {}
): PaStatusResult {
	const {
		lastActionByReq = {},
		stepsByWorkflow = {},
		packingListItems = [],
		localPurchases = [],
		reimbursements = [],
		now = new Date()
	} = p;
	const reqById = new Map((p.requests || []).map((r) => [String(r.id), r]));
	const birokrasi_items: BirokrasiItem[] = [];

	// 1. Pengajuan Anggaran (PA)
	const items: PaStatusItem[] = (p.pas || [])
		.map((pa): PaStatusItem | null => {
			const req = reqById.get(String(pa.approval_request_id)) || null;
			if (req && req.status && req.status !== 'pending') return null;
			const enteredIso = (req && lastActionByReq[String(req.id)]) || (req && req.date_created) || pa.date_created;
			const entered = enteredIso ? new Date(enteredIso).getTime() : NaN;
			const ageHours = Number.isFinite(entered) ? Math.max(0, (now.getTime() - entered) / HOUR) : null;

			const step = req ? num(req.current_step) || 1 : null;
			const wfId = req ? idOf(req.workflow_id) : null;
			const stepRow = wfId && step ? (stepsByWorkflow[String(wfId)] || []).find((s) => num(s.step_order) === step) : null;
			const slaFromData = stepRow && num(stepRow.sla_hours) > 0 ? num(stepRow.sla_hours) : null;
			const slaHours = slaFromData ?? DEFAULT_SLA_HOURS;

			let level: PaLevel = 'unknown';
			if (ageHours != null) {
				const ratio = ageHours / slaHours;
				level = ratio >= 1 ? 'red' : ratio >= 0.5 ? 'yellow' : 'green';
			}

			const isOverdue = level === 'red';
			const melewatiJam = ageHours != null && ageHours > slaHours ? Math.floor(ageHours - slaHours) : null;

			// Daftarkan juga ke birokrasi_items
			birokrasi_items.push({
				channel: 'pa_pending',
				id: `pa_${pa.id}`,
				nomor: pa.nomor_pengajuan || `#${pa.id}`,
				judul: pa.tujuan_pengajuan || 'Pengajuan Anggaran',
				status: 'Pending',
				status_label: 'Menunggu Persetujuan Anggaran',
				tahap: step ? `Tahap ${step}` : 'Antrean Review',
				posisi: pa.current_stage || null,
				approver_nama: pa.current_stage || 'Approver Finance/Manager',
				umur_jam: ageHours != null ? Math.floor(ageHours) : null,
				sla_jam: slaHours,
				melewati_sla_jam: melewatiJam,
				level,
				is_overdue: isOverdue,
				request_id: req ? String(req.id) : null,
				action_hint: isOverdue ? 'Ingatkan Approver' : 'Menunggu review'
			});

			return {
				pa_id: pa.id,
				nomor: pa.nomor_pengajuan || `#${pa.id}`,
				tujuan: pa.tujuan_pengajuan || '',
				request_id: req ? String(req.id) : null,
				tahap: step,
				posisi: pa.current_stage || null,
				umur_jam: ageHours != null ? Math.floor(ageHours) : null,
				sla_jam: slaHours,
				sla_default: slaFromData == null,
				melewati_sla_jam: melewatiJam,
				level,
				tanpa_approval_request: !req,
				gate_belum_dievaluasi: !pa.interlocking_status
			};
		})
		.filter((x): x is PaStatusItem => x !== null)
		.sort((a, b) => (b.umur_jam ?? -1) - (a.umur_jam ?? -1));

	// 2. Packing List Items (Draft vs In-Flight)
	let draftPlCount = 0;
	let draftPlStaleCount = 0;
	let inFlightPlCount = 0;

	for (const pl of packingListItems || []) {
		const pStatus = String(pl.packing_status || 'draft').toLowerCase();
		const qtyTotal = num(pl.qty);
		const qtySent = num(pl.qty_sudah_dikirim);
		if (pStatus === 'complete' || (qtyTotal > 0 && qtySent >= qtyTotal)) {
			continue;
		}

		const enteredIso = pl.requested_at || pl.date_created;
		const entered = enteredIso ? new Date(enteredIso).getTime() : NaN;
		const ageHours = Number.isFinite(entered) ? Math.max(0, (now.getTime() - entered) / HOUR) : null;

		const isDraft = pStatus === 'draft' || !pl.packing_status;
		const isRequested = pStatus === 'requested' || pStatus === 'pending_project';
		const isApprovedOrPartial = pStatus === 'approved' || pStatus === 'partial';

		const slaHours = isDraft ? 24 : 48;
		let level: PaLevel = 'unknown';
		if (ageHours != null) {
			const ratio = ageHours / slaHours;
			level = ratio >= 1 ? 'red' : ratio >= 0.5 ? 'yellow' : 'green';
		}
		const isOverdue = level === 'red';
		const melewatiJam = ageHours != null && ageHours > slaHours ? Math.floor(ageHours - slaHours) : null;
		const isStaleDraft = isDraft && ageHours != null && ageHours >= 24;

		if (isDraft) {
			draftPlCount++;
			if (isStaleDraft) draftPlStaleCount++;
		} else {
			inFlightPlCount++;
		}

		let statusLabel = 'Draft (Belum Diajukan)';
		let actionHint = 'Ajukan Packing List';
		let approverNama = null;

		if (isRequested) {
			statusLabel = 'Menunggu Approval Gudang/Logistik';
			actionHint = 'Menunggu verifikasi stok gudang';
			approverNama = 'Logistik / Gudang';
		} else if (isApprovedOrPartial) {
			statusLabel = pStatus === 'partial' ? 'Terkirim Sebagian (Sisa Belum SJ)' : 'Disetujui (Menunggu Surat Jalan)';
			actionHint = 'Siap dikirim gudang';
			approverNama = 'Logistik / Driver';
		}

		birokrasi_items.push({
			channel: isDraft ? 'packing_list_draft' : 'packing_list_in_flight',
			id: `pl_${pl.id}`,
			nomor: pl.reference_number || `PL-${pl.id}`,
			judul: pl.material_name || pl.description || 'Item Packing List',
			deskripsi: pl.description || '',
			status: pStatus,
			status_label: statusLabel,
			tahap: isDraft ? 'Draft' : isRequested ? 'Review Gudang' : 'Siap Kirim',
			posisi: isDraft ? 'Lapang' : 'Gudang Pusat',
			approver_nama: approverNama,
			umur_jam: ageHours != null ? Math.floor(ageHours) : null,
			sla_jam: slaHours,
			melewati_sla_jam: melewatiJam,
			level,
			is_overdue: isOverdue,
			qty: Math.max(0, qtyTotal - qtySent),
			unit: pl.unit || 'pcs',
			is_stale_draft: isStaleDraft,
			action_hint: actionHint,
			action_link: `/packing-list/${pl.project_id || ''}`
		});
	}

	// 3. Pembelian Lokal Proyek
	let localCount = 0;
	for (const lp of localPurchases || []) {
		localCount++;
		const enteredIso = lp.date_created;
		const entered = enteredIso ? new Date(enteredIso).getTime() : NaN;
		const ageHours = Number.isFinite(entered) ? Math.max(0, (now.getTime() - entered) / HOUR) : null;
		const slaHours = 24;
		let level: PaLevel = 'unknown';
		if (ageHours != null) {
			const ratio = ageHours / slaHours;
			level = ratio >= 1 ? 'red' : ratio >= 0.5 ? 'yellow' : 'green';
		}
		const isOverdue = level === 'red';
		const melewatiJam = ageHours != null && ageHours > slaHours ? Math.floor(ageHours - slaHours) : null;

		birokrasi_items.push({
			channel: 'pembelian_lokal',
			id: `lp_${lp.id}`,
			nomor: lp.nomor_pembelian || `#BL-${lp.id}`,
			judul: lp.nama_barang || lp.keperluan || 'Pembelian Lokal',
			status: lp.status || 'Menunggu Approval',
			status_label: 'Menunggu Approval Pembelian Lokal',
			tahap: 'Approval PM/Procurement',
			posisi: 'Procurement',
			approver_nama: 'Manager Proyek / Pengadaan',
			umur_jam: ageHours != null ? Math.floor(ageHours) : null,
			sla_jam: slaHours,
			melewati_sla_jam: melewatiJam,
			level,
			is_overdue: isOverdue,
			action_hint: 'Menunggu persetujuan pembelian'
		});
	}

	// 4. Klaim Reimbursement Lapangan
	let reimburseCount = 0;
	for (const r of reimbursements || []) {
		reimburseCount++;
		const enteredIso = r.date_created;
		const entered = enteredIso ? new Date(enteredIso).getTime() : NaN;
		const ageHours = Number.isFinite(entered) ? Math.max(0, (now.getTime() - entered) / HOUR) : null;
		const slaHours = 48;
		let level: PaLevel = 'unknown';
		if (ageHours != null) {
			const ratio = ageHours / slaHours;
			level = ratio >= 1 ? 'red' : ratio >= 0.5 ? 'yellow' : 'green';
		}
		const isOverdue = level === 'red';
		const melewatiJam = ageHours != null && ageHours > slaHours ? Math.floor(ageHours - slaHours) : null;

		birokrasi_items.push({
			channel: 'klaim_reimbursement',
			id: `reimb_${r.id}`,
			nomor: r.nomor_klaim || `#KB-${r.id}`,
			judul: r.keterangan || r.kategori || 'Klaim Reimbursement BBM/Tol',
			status: r.status || 'Diajukan',
			status_label: `Klaim Reimbursement (${r.status || 'Diajukan'})`,
			tahap: 'Verifikasi Finance',
			posisi: 'Finance',
			approver_nama: 'Finance Proyek',
			umur_jam: ageHours != null ? Math.floor(ageHours) : null,
			sla_jam: slaHours,
			melewati_sla_jam: melewatiJam,
			level,
			is_overdue: isOverdue,
			action_hint: 'Menunggu verifikasi bukti nota'
		});
	}

	// Urutkan birokrasi_items: overdue duluan, lalu umur terlama
	birokrasi_items.sort((a, b) => {
		if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
		return (b.umur_jam ?? -1) - (a.umur_jam ?? -1);
	});

	const summary: BirokrasiSummary = {
		total_birokrasi_count: birokrasi_items.length,
		total_overdue_count: birokrasi_items.filter((i) => i.is_overdue).length,
		draft_pl_count: draftPlCount,
		draft_pl_stale_count: draftPlStaleCount,
		in_flight_pl_count: inFlightPlCount,
		pa_pending_count: items.length,
		pembelian_lokal_count: localCount,
		reimbursement_count: reimburseCount
	};

	return {
		items,
		total_count: items.length,
		overdue_count: items.filter((i) => i.level === 'red').length,
		gate_belum_dievaluasi_count: items.filter((i) => i.gate_belum_dievaluasi).length,
		birokrasi_items,
		summary
	};
}

/** Teks umur ringkas: < 48 jam → "N jam", selebihnya "N hari M jam". */
export function umurText(jam: number | null | undefined): string {
	if (jam == null) return '—';
	return jam < 48 ? `${jam} jam` : `${Math.floor(jam / 24)} hari ${jam % 24} jam`;
}
