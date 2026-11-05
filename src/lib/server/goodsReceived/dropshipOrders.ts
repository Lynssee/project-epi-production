// src/lib/server/goodsReceived/dropshipOrders.ts
// Sinkron pembelian proyek (Fase 4, lapangan): daftar READ-ONLY PO drop-ship yang sedang menuju site — dikirim supplier/toko
// LANGSUNG ke lokasi proyek tanpa Surat Jalan gudang. Penerimaannya dicatat Admin (butuh SJ supplier & pencocokan barang master),
// jadi lapangan hanya melihat apa yang akan datang supaya siap menerima. Logika murni di sini; query di +server.ts.

export interface DropshipPo {
	id: number;
	po_number?: string | null;
	pengajuan_id: number | { id: number } | null;
	status?: string | null;
	supplier_name?: string | null;
	delivery_date?: string | null;
}
export interface DropshipPoItem {
	po_id: number | { id: number };
	item_name?: string | null;
	quantity?: number | string | null;
	received_qty?: number | string | null;
	unit?: string | null;
}
export interface DropshipOrder {
	poId: number;
	poNumber: string;
	supplierName: string;
	projectId: number;
	projectName: string;
	status: string;
	eta: string | null;
	items: Array<{ name: string; qty: number; received: number; unit: string }>;
	sisaQty: number;
}

const num = (v: unknown) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};
const idOf = (v: unknown): number => Number(v && typeof v === 'object' ? (v as { id: number }).id : v) || 0;

/** Hanya PO yang sudah Terkirim / diterima sebagian dan masih punya sisa barang yang menuju site. */
export function buildDropshipOrders(p: {
	prs: Array<{ id: number; project_id: number | { id: number } | null }>;
	pos: DropshipPo[];
	items: DropshipPoItem[];
	projectNameById: Map<number, string>;
}): DropshipOrder[] {
	const projectOfPr = new Map<number, number>();
	for (const pr of p.prs || []) projectOfPr.set(Number(pr.id), idOf(pr.project_id));

	const itemsByPo = new Map<number, DropshipPoItem[]>();
	for (const it of p.items || []) {
		const pid = idOf(it.po_id);
		if (!itemsByPo.has(pid)) itemsByPo.set(pid, []);
		itemsByPo.get(pid)!.push(it);
	}

	const out: DropshipOrder[] = [];
	for (const po of p.pos || []) {
		const st = String(po.status || '').toLowerCase();
		if (st !== 'sent' && st !== 'partial_received') continue;
		const projectId = projectOfPr.get(idOf(po.pengajuan_id)) || 0;
		if (!projectId) continue;
		const items = (itemsByPo.get(Number(po.id)) || []).map((i) => ({
			name: i.item_name || '-',
			qty: num(i.quantity),
			received: num(i.received_qty),
			unit: i.unit || ''
		}));
		const sisaQty = items.reduce((s, i) => s + Math.max(0, i.qty - i.received), 0);
		if (sisaQty <= 0) continue;
		out.push({
			poId: Number(po.id),
			poNumber: po.po_number || `PO #${po.id}`,
			supplierName: po.supplier_name || '-',
			projectId,
			projectName: p.projectNameById.get(projectId) || `Proyek #${projectId}`,
			status: st,
			eta: po.delivery_date ? String(po.delivery_date).slice(0, 10) : null,
			items,
			sisaQty
		});
	}
	// ETA terdekat dulu; tanpa ETA di akhir
	return out.sort((a, b) => (a.eta || '9999').localeCompare(b.eta || '9999') || a.poId - b.poId);
}
