// Konteks operasional tagihan supplier untuk halaman /hutang-proyek (Prioritas Hutang
// Berbasis Dampak Pengiriman — Fase 4). Murni (tanpa I/O) supaya mudah diuji.

export type PoItemLite = { item_name?: string | null; quantity?: number | null; unit?: string | null; received_qty?: number | null };

export type BarangStatus = 'diterima' | 'sebagian' | 'belum' | 'tidak_diketahui';

const n = (v: unknown): number => {
	const x = Number(v);
	return Number.isFinite(x) ? x : 0;
};

/** Status fisik barang dari baris PO: seluruhnya / sebagian / belum diterima. */
export function deriveBarangStatus(items: PoItemLite[] | null | undefined): BarangStatus {
	const list = (items || []).filter((i) => n(i.quantity) > 0);
	if (list.length === 0) return 'tidak_diketahui';
	const received = list.map((i) => n(i.received_qty));
	if (list.every((i, idx) => received[idx] >= n(i.quantity))) return 'diterima';
	if (received.some((q) => q > 0)) return 'sebagian';
	return 'belum';
}

export const BARANG_STATUS_LABEL: Record<BarangStatus, string> = {
	diterima: 'Barang sudah diterima',
	sebagian: 'Barang sebagian diterima',
	belum: 'Barang belum diterima',
	tidak_diketahui: 'Status barang tidak diketahui'
};

/** Ringkas nama barang: maksimal `max` nama, sisanya "+N lainnya". */
export function summarizeItemNames(items: PoItemLite[] | null | undefined, max = 3): string {
	const names = (items || []).map((i) => String(i.item_name || '').trim()).filter(Boolean);
	if (names.length === 0) return '';
	const shown = names.slice(0, max).join(', ');
	return names.length > max ? `${shown} +${names.length - max} lainnya` : shown;
}

/**
 * Status pembayaran dari sisi Finance, dalam bahasa lapangan.
 * Urutan: dijadwalkan > mendesak > menunggu antrean Finance.
 */
export function paymentStageLabel(row: { scheduled_payment_date?: string | null; payment_urgency?: string | null }): string {
	if (row.scheduled_payment_date) {
		const d = new Date(row.scheduled_payment_date);
		if (!Number.isNaN(d.getTime())) {
			return `Dijadwalkan bayar ${d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}`;
		}
	}
	if (row.payment_urgency === 'urgent') return 'Ditandai mendesak oleh Finance';
	return 'Menunggu alokasi kas Finance';
}

/** Tombol "Minta Percepatan Bayar" hanya relevan bila barang belum lengkap diterima. */
export function shouldOfferExpedite(status: BarangStatus): boolean {
	return status === 'belum' || status === 'sebagian';
}
