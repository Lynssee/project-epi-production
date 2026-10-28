// src/lib/services/labelPrintApi.ts
// Fase 4B (Penajaman Modul Produksi v2, 26 Agu 2026) — Label Self-Service Lapangan.
// Jembatan lintas-app ke /api/print/product-label (erp-epi-1), sama pola dengan
// projectClosureLapangan.ts (BAST): generator label bergantung pada CSS/markup
// yang sudah dibangun di admin, jadi tidak diduplikasi di sini — cuma minta HTML
// jadi lalu buka jendela print di browser lapangan.

import { getIdToken } from './secureDirectus';
import directus, { handleDirectusError } from './directus';
import { readItem, readItems } from '@directus/sdk';

const ADMIN_APP_ORIGIN = '';

export interface PrintableSpk {
	id: number;
	nomor: string;
	batch_no: string | null;
	status: string;
	product_id: { id: number; nama_barang_lengkap?: string | null } | number | null;
}

export interface LabelComponentOption {
	componentId: string; // 'A', 'B', ...
	label: string; // "Komponen A – Base"
	ratioNum: number;
	netto: number; // KG, 3 desimal
}

export interface SpkLabelMeta {
	isMulti: boolean;
	unitSizeKg: number | null; // null = unit_size_id kosong, netto manual WAJIB
	options: LabelComponentOption[];
}

const COMPONENT_NAMES = ['Base', 'Hardener', 'Catalyst', 'Additive', 'Komponen E', 'Komponen F'];

/**
 * Fase 4 correction_plan_cetak-label-produk.md -- lapangan bisa pilih netto per
 * komponen (Base/Hardener/dst), samakan dengan modal admin (PrintLabelModal.svelte).
 * Dipanggil saat SPK dipilih di halaman cetak-label, sebelum cetak.
 */
export async function fetchSpkLabelMeta(spkId: number): Promise<SpkLabelMeta> {
	const spk = await directus
		.request(readItem('spk' as any, spkId as any, { fields: ['product_id', 'template_formula_id'] } as any))
		.catch(() => null);
	const productId = (spk as any)?.product_id?.id || (spk as any)?.product_id || null;
	const formulaId = (spk as any)?.template_formula_id?.id || (spk as any)?.template_formula_id || null;

	const [product, formula] = await Promise.all([
		productId
			? directus
					.request(readItem('identitas_barang' as any, productId as any, { fields: ['unit_size_id.*'] } as any))
					.catch(() => null)
			: Promise.resolve(null),
		formulaId
			? directus
					.request(
						readItem('template_formula' as any, formulaId as any, {
							fields: ['mixing_ratio_value', 'mixing_ratio_type']
						} as any)
					)
					.catch(() => null)
			: Promise.resolve(null)
	]);

	const rawSize = (product as any)?.unit_size_id?.qty ?? (product as any)?.unit_size_id?.kemasan ?? null;
	const parsedSize = rawSize != null ? parseFloat(rawSize) : NaN;
	const unitSizeKg = Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : null;

	const ratioValue = (formula as any)?.mixing_ratio_value || '1';
	const parts = String(ratioValue)
		.split(':')
		.map((r) => parseFloat(r.trim()) || 0)
		.filter((r) => r > 0);
	const total = parts.reduce((s, r) => s + r, 0);
	const isMulti = parts.length > 1;

	if (!isMulti || !unitSizeKg) {
		return { isMulti, unitSizeKg, options: [] };
	}

	const options: LabelComponentOption[] = parts.map((ratio, idx) => {
		const compId = String.fromCharCode(65 + idx);
		const compName = COMPONENT_NAMES[idx] || `Komponen ${compId}`;
		return {
			componentId: compId,
			label: `Komponen ${compId} – ${compName}`,
			ratioNum: ratio,
			netto: parseFloat(((ratio / total) * unitSizeKg).toFixed(3))
		};
	});

	return { isMulti, unitSizeKg, options };
}

/** SPK yang labelnya boleh dicetak — sudah lolos QC atau selesai. */
export async function fetchPrintableSpkList(): Promise<PrintableSpk[]> {
	try {
		return (await directus.request(
			readItems('spk' as any, {
				filter: { status: { _in: ['qc_pending', 'completed'] } } as any,
				fields: ['id', 'nomor', 'batch_no', 'status', 'product_id.id', 'product_id.nama_barang_lengkap'],
				sort: ['-date_created'],
				limit: 100
			})
		)) as any[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/**
 * Minta HTML label siap-print dari erp-epi-1, lalu buka jendela print.
 * Aturan #5 (Anti Pop-up Blocker): window.open() WAJIB dipanggil sebelum
 * await apa pun, atau browser mematikan user-activation token dan
 * memblokir jendelanya sebagai popup.
 * @param spkId SPK yang labelnya dicetak
 * @param printQuantity Jumlah salinan (1-10)
 * @param selectedNettoKg Netto manual/komponen terpilih (KG). Wajib diisi kalau unit_size_id produk kosong.
 * @param componentLabel Nama komponen terpilih (mis. "Komponen A – Base") untuk label multi-komponen
 */
export async function printProductLabelField(
	spkId: number,
	printQuantity = 10,
	selectedNettoKg: number | null = null,
	componentLabel: string | null = null
): Promise<void> {
	const printWindow = window.open('', '_blank');
	if (!printWindow) {
		throw new Error('Popup diblokir browser. Izinkan popup untuk situs ini, lalu coba cetak lagi.');
	}
	printWindow.document.write('<p style="font-family:sans-serif;padding:24px">Menyiapkan label…</p>');

	try {
		const token = await getIdToken();
		const params = new URLSearchParams({ spkId: String(spkId), qty: String(printQuantity) });
		if (selectedNettoKg !== null && selectedNettoKg !== undefined) {
			params.set('netto', String(selectedNettoKg));
		}
		if (componentLabel) {
			params.set('component', componentLabel);
		}

		const res = await fetch(`${ADMIN_APP_ORIGIN}/api/print/product-label?${params.toString()}`, {
			headers: { Authorization: `Bearer ${token}` }
		});

		if (!res.ok) {
			const err = await res.json().catch(() => null);
			throw new Error(err?.message || 'Gagal membuat label. Coba lagi.');
		}

		const { html } = await res.json();
		printWindow.document.open();
		printWindow.document.write(html);
		printWindow.document.close();
	} catch (e) {
		printWindow.close();
		throw e;
	}
}
