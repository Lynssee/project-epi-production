// src/lib/services/pengajuanTemplate.ts
// Template pengajuan rutin (Rekomendasi Section 4 — Penajaman Penjurnalan Pengajuan Anggaran v2).
// Menyimpan konfigurasi form pengajuan yang berulang (kontrakan bulanan, BBM mingguan, OPS SALES)
// supaya pengaju lapangan tinggal muat & kirim. Tidak menyentuh data pengajuan.
import directus, { handleDirectusError } from './directus';
import { readItems, createItem, deleteItem } from '@directus/sdk';
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';

export interface PengajuanTemplateItem {
	name: string;
	kategori_item: string;
	qty: number;
	unit: string;
	price: number;
	vendorName?: string;
	notes?: string;
}

export interface PengajuanTemplate {
	id?: number;
	nama: string;
	owner_email?: string;
	department_id?: number | null;
	kategori_belanja?: string | null;
	tujuan_pengajuan?: string | null;
	payment_method?: string | null;
	penerima?: {
		type?: string;
		nama?: string;
		bankName?: string;
		bankAccountNumber?: string;
		bankAccountName?: string;
		// Penajaman Penerima Dana & Track Record v2, Fase 4 (11 Sep) — opsional, ADITIF.
		// Template lama tanpa field ini tetap terbaca (fallback ke bankName/bankAccountNumber
		// mentah di atas, dipakai apa adanya seperti sebelumnya — picker akan menautkan ulang
		// via ensureRekening() saat template dimuat, lihat baru/+page.svelte).
		rekeningPenerimaId?: number | null;
	} | null;
	items?: PengajuanTemplateItem[];
	date_created?: string;
}

function currentEmail(): string {
	return get(authStore)?.user?.email || '';
}

/** Template milik pengaju ini (fallback: semua, bila email tak tersedia). */
export async function listPengajuanTemplates(): Promise<PengajuanTemplate[]> {
	try {
		const email = currentEmail();
		const rows = (await directus.request(
			readItems('pengajuan_template' as any, {
				filter: email ? { owner_email: { _eq: email } } : {},
				sort: ['-date_created'],
				limit: 100
			})
		)) as any[];
		return (rows || []).map((r) => ({
			...r,
			items: Array.isArray(r.items) ? r.items : [],
			penerima: r.penerima || null
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function savePengajuanTemplate(tpl: PengajuanTemplate): Promise<PengajuanTemplate | null> {
	try {
		const payload = {
			nama: (tpl.nama || '').trim() || 'Template tanpa nama',
			owner_email: currentEmail() || null,
			department_id: tpl.department_id ?? null,
			kategori_belanja: tpl.kategori_belanja ?? null,
			tujuan_pengajuan: tpl.tujuan_pengajuan ?? null,
			payment_method: tpl.payment_method ?? null,
			penerima: tpl.penerima ?? null,
			items: (tpl.items || []).map((i) => ({
				name: i.name || '',
				kategori_item: i.kategori_item || '',
				qty: Number(i.qty) || 1,
				unit: i.unit || 'Pcs',
				price: Number(i.price) || 0,
				vendorName: i.vendorName || '',
				notes: i.notes || ''
			}))
		};
		return (await directus.request(createItem('pengajuan_template' as any, payload))) as any;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function deletePengajuanTemplate(id: number): Promise<boolean> {
	try {
		await directus.request(deleteItem('pengajuan_template' as any, id));
		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}
