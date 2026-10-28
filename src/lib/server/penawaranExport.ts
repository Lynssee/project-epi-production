// src/lib/server/penawaranExport.ts
// SERVER-ONLY. Helper bersama untuk endpoint Share WA & Download PDF penawaran
// (SI-TAMA Sales §5). Ambil data kalkulator_penawaran + items via token Directus
// server (tidak pernah ke klien), normalisasi nomor WA, dan susun pesan penawaran.

import { directusServerJson } from './directus';

const COMPANY_NAME = 'PT Eltama Prima Indo';

export interface PenawaranHeaderRow {
	id: string;
	nomor_penawaran: string | null;
	tanggal: string | null;
	valid_until: string | null;
	status: string | null;
	customer_id: number | null;
	kode_customer: string | null;
	customer_name: string | null;
	project_name: string | null;
	lokasi: string | null;
	prepared_by: string | null;
	payment_terms: string | null;
	notes: string | null;
	terms: string | null;
	mobilisasi_amount: number | null;
	scaffolding_amount: number | null;
	safety_amount: number | null;
	overhead_pct: number | null;
	margin_pct: number | null;
	discount_amount: number | null;
	ppn_enabled: boolean | null;
	ppn_pct: number | null;
	total_area: number | null;
	direct_total: number | null;
	grand_total: number | null;
	omni_contact_id: number | null;
}

export interface PenawaranItemRow {
	id: string;
	sort: number | null;
	service_type: string | null;
	object_name: string | null;
	description: string | null;
	area: number | null;
	unit: string | null;
	qty: number | null;
	subtotal: number | null;
}

const HEADER_FIELDS = [
	'id', 'nomor_penawaran', 'tanggal', 'valid_until', 'status', 'customer_id', 'kode_customer',
	'customer_name', 'project_name', 'lokasi', 'prepared_by', 'payment_terms', 'notes', 'terms',
	'mobilisasi_amount', 'scaffolding_amount', 'safety_amount', 'overhead_pct', 'margin_pct',
	'discount_amount', 'ppn_enabled', 'ppn_pct', 'total_area', 'direct_total', 'grand_total',
	'omni_contact_id'
].join(',');

const ITEM_FIELDS = ['id', 'sort', 'service_type', 'object_name', 'description', 'area', 'unit', 'qty', 'subtotal'].join(',');

export async function fetchPenawaran(id: string): Promise<{ header: PenawaranHeaderRow; items: PenawaranItemRow[] } | null> {
	const headerRes = await directusServerJson<{ data: PenawaranHeaderRow }>(
		`/items/kalkulator_penawaran/${encodeURIComponent(id)}?fields=${HEADER_FIELDS}`
	);
	const header = headerRes?.data;
	if (!header) return null;

	const itemsRes = await directusServerJson<{ data: PenawaranItemRow[] }>(
		`/items/kalkulator_penawaran_items?${new URLSearchParams({
			'filter[penawaran_id][_eq]': id,
			fields: ITEM_FIELDS,
			sort: 'sort',
			limit: '-1'
		}).toString()}`
	);
	return { header, items: itemsRes?.data || [] };
}

/**
 * Normalisasi nomor telepon ke format wa.me: hanya digit, prefix 62 (bukan 08 / +62 / 0062).
 * Mengembalikan null jika tidak valid (kosong / terlalu pendek / terlalu panjang).
 */
export function normalizeWaNumber(raw: string | null | undefined): string | null {
	if (!raw) return null;
	let p = String(raw).replace(/\D/g, '');
	if (!p) return null;
	if (p.startsWith('0062')) p = '62' + p.slice(4);
	else if (p.startsWith('620')) p = '62' + p.slice(3);
	else if (p.startsWith('0')) p = '62' + p.slice(1);
	else if (p.startsWith('8')) p = '62' + p;
	else if (!p.startsWith('62')) p = '62' + p;
	if (p.length < 10 || p.length > 15) return null;
	return p;
}

function formatRupiah(n: number | null | undefined): string {
	return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}

function formatTanggalId(iso: string | null | undefined): string {
	if (!iso) return '-';
	const d = new Date(iso);
	if (isNaN(d.getTime())) return String(iso);
	return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Teks pesan WhatsApp penawaran (SI-TAMA Sales §5a). */
export function buildWaMessage(header: PenawaranHeaderRow): string {
	const nama = header.customer_name?.trim() || 'Bapak/Ibu';
	return [
		`Yth. ${nama},`,
		'',
		'Bersama ini kami sampaikan penawaran harga kami:',
		`No. Penawaran : ${header.nomor_penawaran || '-'}`,
		`Project       : ${header.project_name || '-'}`,
		`Total         : ${formatRupiah(header.grand_total)}`,
		`Valid s/d     : ${formatTanggalId(header.valid_until)}`,
		'',
		'Detail penawaran terlampir. Mohon konfirmasinya. Terima kasih.',
		'',
		'Hormat kami,',
		COMPANY_NAME
	].join('\n');
}

export { COMPANY_NAME, formatRupiah, formatTanggalId };
