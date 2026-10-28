/**
 * Kontrak tunggal lifecycle pembelian — Fase 2 dari rencana v2
 * `docs/(eh) implementation_plan_Lifecycle Pembelian Lengkap — SI-TAMA ERP & Dashboard Lapangan.md` (erp-epi).
 *
 * PORT TypeScript dari `src/lib/services/procurementLifecycle.js` (erp-epi) — logika HARUS
 * tetap identik di kedua repo supaya admin dan lapangan tidak pernah menampilkan fase
 * berbeda untuk PO yang sama. Kalau resolver di erp-epi berubah, port ini wajib disamakan.
 *
 * TIDAK ada network call di file ini (murni, testable tanpa Directus).
 */

export type PhaseState = 'selesai' | 'proses' | 'belum' | 'gagal';
export type EvidenceSource = 'fakta' | 'klaim' | 'kosong';

export interface LifecyclePhaseMeta {
	id: string;
	label: string;
	hint: string;
	conditional: boolean;
}

export interface LifecyclePhaseResult extends LifecyclePhaseMeta {
	state: PhaseState;
	source: EvidenceSource;
	evidence: string;
	conflict: boolean;
	actor: string | null;
	date: string | null;
}

export const LIFECYCLE_PHASES: LifecyclePhaseMeta[] = [
	{ id: 'F1', label: 'Pengajuan & Approval', hint: 'PR sudah melewati seluruh jalur approval yang berlaku.', conditional: false },
	{ id: 'F2', label: 'Procurement & PO', hint: 'PO sudah dibuat untuk pengajuan ini.', conditional: false },
	{ id: 'F3', label: 'Pengiriman & Transit', hint: 'Supplier sudah konfirmasi kirim, ada nomor resi/ekspedisi.', conditional: false },
	{ id: 'F4', label: 'Penerimaan & Inspeksi', hint: 'Barang sudah diterima dan tercatat sebagai bukti fisik (received_qty atau GRN).', conditional: false },
	{ id: 'F5', label: 'Retur & Klaim', hint: 'Ada barang yang dikembalikan ke supplier karena reject/kurang/rusak.', conditional: true },
	{ id: 'F6', label: 'Settlement', hint: 'Invoice yang tertaut ke PO ini sudah dibayar.', conditional: false },
	{ id: 'F7', label: 'Pembukuan & Closing', hint: 'PO ditutup — semua barang diterima, invoice lunas, tidak ada retur terbuka.', conditional: false },
];

const PR_STATUS_TERMINAL_STOP = new Set(['Rejected', 'Cancelled']);
const PR_STATUS_IN_APPROVAL = new Set(['Pending', 'Menunggu Review Inventory', 'Perlu Revisi', 'Partially Approved', 'On Hold']);
const PR_STATUS_APPROVED_OR_BEYOND = new Set([
	'Approved', 'Fully Approved', 'Menunggu Pembelian', 'PO Dibuat', 'PO Dikirim',
	'Menunggu Penerimaan Barang', 'Barang Datang', 'Pembelian Barang', 'Barang Sudah Datang',
	'Barang Sudah Datang Sebagian', 'Barang Diterima', 'Barang Diterima Sebagian',
	'Menunggu Pembayaran', 'Barang Diterima & Lunas', 'Lunas', 'Selesai',
]);
const PR_STATUS_PO_DIBUAT_ATAU_DIKIRIM = new Set(['PO Dibuat', 'PO Dikirim']);
const PAID_STATUSES = new Set(['PAID', 'Lunas', 'LUNAS']);
const PARTIAL_STATUSES = new Set(['PARTIAL', 'Sebagian']);

// Tanpa index signature dengan sengaja — interface caller (mis. POTrackingItem) tidak akan
// bisa lolos type-check untuk dipassing ke resolveLifecycle() kalau ada `[key: string]: unknown`
// di sini (TS mewajibkan source type ikut mendeklarasikan index signature yang sama).
export interface PengajuanFacts {
	id?: number | string;
	status?: string | null;
	date_updated?: string | null;
}
export interface PoFacts {
	id?: number | string;
	po_number?: string | null;
	po_date?: string | null;
	status?: string | null;
	supplier_confirmed_at?: string | null;
	shipping_tracking_no?: string | null;
}
export interface PoItemFacts {
	quantity?: number | string | null;
	received_qty?: number | string | null;
}
export interface GrnFacts {
	status?: string | null;
}
export interface ReturnFacts {
	status?: string | null;
}
export interface InvoiceFacts {
	payment_status?: string | null;
}

function phase(id: string, state: PhaseState, source: EvidenceSource, evidence: string, extra: Partial<LifecyclePhaseResult> = {}): LifecyclePhaseResult {
	const meta = LIFECYCLE_PHASES.find((p) => p.id === id)!;
	return {
		id,
		label: meta.label,
		hint: meta.hint,
		conditional: meta.conditional,
		state,
		source,
		evidence,
		conflict: false,
		actor: null,
		date: null,
		...extra,
	};
}

function sumQty(items: PoItemFacts[] | null | undefined, key: 'quantity' | 'received_qty'): number {
	return (items || []).reduce((acc, it) => acc + (Number(it?.[key]) || 0), 0);
}

function resolveF1(pr: PengajuanFacts | null | undefined): LifecyclePhaseResult {
	if (!pr) return phase('F1', 'belum', 'kosong', 'Data pengajuan tidak ditemukan.');
	const status = pr.status ?? '';
	if (PR_STATUS_TERMINAL_STOP.has(status)) {
		return phase('F1', 'gagal', 'klaim', `Pengajuan berstatus "${status}".`, { date: pr.date_updated ?? null });
	}
	if (PR_STATUS_APPROVED_OR_BEYOND.has(status)) {
		return phase('F1', 'selesai', 'klaim', `Pengajuan berstatus "${status}" (lolos approval).`, { date: pr.date_updated ?? null });
	}
	if (PR_STATUS_IN_APPROVAL.has(status)) {
		return phase('F1', 'proses', 'klaim', `Pengajuan masih dalam proses approval ("${status}").`);
	}
	return phase('F1', 'belum', 'kosong', `Status pengajuan tidak dikenali: "${status}".`);
}

function resolveF2(pr: PengajuanFacts | null | undefined, po: PoFacts | null | undefined): LifecyclePhaseResult {
	if (po && po.id) {
		return phase('F2', 'selesai', 'fakta', `PO ${po.po_number ?? po.id} sudah dibuat.`, { date: po.po_date ?? null });
	}
	const status = pr?.status ?? '';
	if (PR_STATUS_PO_DIBUAT_ATAU_DIKIRIM.has(status)) {
		return phase('F2', 'proses', 'klaim', `Pengajuan berstatus "${status}" tapi belum ada baris PO ditemukan.`, { conflict: true });
	}
	if (resolveF1(pr).state !== 'selesai') {
		return phase('F2', 'belum', 'kosong', 'Menunggu pengajuan selesai approval.');
	}
	return phase('F2', 'belum', 'kosong', 'PR sudah approved, PO belum dibuat.');
}

function resolveF3(po: PoFacts | null | undefined): LifecyclePhaseResult {
	if (!po) return phase('F3', 'belum', 'kosong', 'Belum ada PO.');
	if (po.supplier_confirmed_at && po.shipping_tracking_no) {
		return phase('F3', 'selesai', 'fakta', `Supplier konfirmasi ${po.supplier_confirmed_at}, resi ${po.shipping_tracking_no}.`, { date: po.supplier_confirmed_at });
	}
	if (po.supplier_confirmed_at && !po.shipping_tracking_no) {
		return phase('F3', 'proses', 'fakta', 'Supplier sudah konfirmasi, resi belum diisi.');
	}
	if (po.status === 'sent' || po.status === 'partial_received' || po.status === 'received' || po.status === 'closed') {
		return phase('F3', 'proses', 'klaim', `PO berstatus "${po.status}" (belum ada detail pengiriman tercatat).`);
	}
	return phase('F3', 'belum', 'kosong', 'PO belum dikirim.');
}

function resolveF4(po: PoFacts | null | undefined, poItems: PoItemFacts[] | null | undefined, grns: GrnFacts[] | null | undefined): LifecyclePhaseResult {
	if (!po) return phase('F4', 'belum', 'kosong', 'Belum ada PO.');
	const totalQty = sumQty(poItems, 'quantity');
	const totalReceived = sumQty(poItems, 'received_qty');
	const hasPostedGrn = (grns || []).some((g) => g?.status === 'posted');

	if (totalQty > 0 && totalReceived >= totalQty) {
		return phase('F4', 'selesai', 'fakta', `Diterima penuh: ${totalReceived}/${totalQty}.`);
	}
	if (hasPostedGrn) {
		return phase('F4', 'selesai', 'fakta', 'GRN sudah posted.');
	}
	if (totalReceived > 0) {
		return phase('F4', 'proses', 'fakta', `Diterima sebagian: ${totalReceived}/${totalQty}.`);
	}
	if (po.status === 'received' || po.status === 'partial_received' || po.status === 'closed') {
		return phase('F4', 'belum', 'klaim', `PO berstatus "${po.status}" tapi tidak ada bukti fisik (received_qty=0, tanpa GRN).`, { conflict: true });
	}
	return phase('F4', 'belum', 'kosong', 'Belum ada penerimaan barang.');
}

function resolveF5(returns: ReturnFacts[] | null | undefined): LifecyclePhaseResult {
	const list = returns || [];
	if (list.length === 0) return phase('F5', 'belum', 'kosong', 'Tidak ada retur.');
	const openReturn = list.some((r) => r?.status && !['closed', 'selesai', 'resolved'].includes(r.status));
	if (openReturn) return phase('F5', 'proses', 'fakta', `${list.length} retur, ada yang masih terbuka.`);
	return phase('F5', 'selesai', 'fakta', `${list.length} retur, semua sudah selesai.`);
}

function resolveF6(po: PoFacts | null | undefined, invoices: InvoiceFacts[] | null | undefined): LifecyclePhaseResult {
	if (!po) return phase('F6', 'belum', 'kosong', 'Belum ada PO.');
	const list = invoices || [];
	if (list.length === 0) return phase('F6', 'belum', 'kosong', 'Invoice belum tertaut ke PO ini.');
	const allPaid = list.every((inv) => PAID_STATUSES.has(inv?.payment_status ?? ''));
	if (allPaid) return phase('F6', 'selesai', 'fakta', `${list.length} invoice tertaut, semua lunas.`);
	const anyPartial = list.some((inv) => PARTIAL_STATUSES.has(inv?.payment_status ?? '') || PAID_STATUSES.has(inv?.payment_status ?? ''));
	if (anyPartial) return phase('F6', 'proses', 'fakta', `${list.length} invoice tertaut, sebagian sudah dibayar.`);
	return phase('F6', 'proses', 'fakta', `${list.length} invoice tertaut, belum dibayar (UNPAID).`);
}

function resolveF7(po: PoFacts | null | undefined): LifecyclePhaseResult {
	if (!po) return phase('F7', 'belum', 'kosong', 'Belum ada PO.');
	if (po.status === 'closed') return phase('F7', 'selesai', 'klaim', 'PO berstatus "closed".');
	return phase('F7', 'belum', 'kosong', 'PO belum ditutup.');
}

export interface ResolveLifecycleArgs {
	pr?: PengajuanFacts | null;
	po?: PoFacts | null;
	poItems?: PoItemFacts[];
	grns?: GrnFacts[];
	returns?: ReturnFacts[];
	invoices?: InvoiceFacts[];
}

export interface ResolveLifecycleResult {
	phases: LifecyclePhaseResult[];
	allPhases: LifecyclePhaseResult[];
	currentPhaseId: string;
	conflicts: LifecyclePhaseResult[];
	blockers: LifecyclePhaseResult[];
}

export function resolveLifecycle({ pr = null, po = null, poItems = [], grns = [], returns = [], invoices = [] }: ResolveLifecycleArgs = {}): ResolveLifecycleResult {
	const f1 = resolveF1(pr);
	const f2 = resolveF2(pr, po);
	const f3 = resolveF3(po);
	const f4 = resolveF4(po, poItems, grns);
	const f5 = resolveF5(returns);
	const f6 = resolveF6(po, invoices);
	const f7 = resolveF7(po);

	const allPhases = [f1, f2, f3, f4, f5, f6, f7];
	const visiblePhases = allPhases.filter((p) => !p.conditional || p.state !== 'belum' || (returns || []).length > 0);

	const conflicts = allPhases.filter((p) => p.conflict);
	const blockers = allPhases.filter((p) => p.state === 'gagal');

	const sequence = [f1, f2, f3, f4, f5, f6, f7];
	const current = sequence.find((p) => {
		if (p.id === 'F5' && p.conditional && (returns || []).length === 0) return false;
		return p.state !== 'selesai';
	});
	const currentPhaseId = current ? current.id : 'F7';

	return { phases: visiblePhases, allPhases, currentPhaseId, conflicts, blockers };
}
