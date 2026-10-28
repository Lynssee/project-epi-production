// src/lib/services/budgetCategory.ts
// Pengajuan Anggaran v3, Fase 3 (22 Agu 2026): baca budget_category_config + field dinamis
// lewat proxy Directus yang sudah ada (sama pola dgn finance.ts::createPengajuanAnggaran).
// Cache sessionStorage TTL 1 jam — kategori jarang berubah, hemat API sesuai instruksi umum.

import { readItems } from '@directus/sdk';
import directus from './directus';
import { getIdToken } from './secureDirectus';

export interface BudgetCategory {
	id: number;
	kode: string;
	nama: string;
	description: string | null;
	axis_allowed: string[];
	gate_keys: string[];
	requires_periode: boolean;
	requires_project: boolean;
	icon: string | null;
	sort: number;
	status: string;
	parent_id: number | null;
	coa_debit: string | null;
	requires_attachment: boolean;
	max_amount: number | null;
	legacy_kategori: string;
	dept_scope: string[] | null;
	clue_icon: string | null;
	clue_description: string | null;
	clue_examples: string[] | null;
	clue_requirements: string[] | null;
	clue_keywords: string[] | null;
	/** R6: keyword khas kategori (dicari di CategoryPicker; sama dgn gate G_KATEGORI_COCOK). */
	strong_keywords?: string[] | null;
	default_item_kategori: string | null;
}

export interface BudgetCategoryField {
	id: number;
	category_id: number;
	field_key: string;
	field_label: string;
	field_type: string;
	field_options: any;
	is_required: boolean;
	default_value: string | null;
	hint_text: string | null;
	sort: number;
}

const CACHE_KEY = 'budgetCategories.v1';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam

function readCache(): BudgetCategory[] | null {
	if (typeof sessionStorage === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const { at, data } = JSON.parse(raw);
		if (Date.now() - at > CACHE_TTL_MS) return null;
		return data;
	} catch {
		return null;
	}
}

function writeCache(data: BudgetCategory[]) {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
	} catch {
		/* storage penuh/nonaktif — abaikan, tetap jalan tanpa cache */
	}
}

/** Semua kategori aktif (level 1 + level 2), diurutkan sort. Gagal-lunak: array kosong bila proxy error — form tetap bisa dipakai lewat fallback kategori lama. */
export async function getBudgetCategories(forceRefresh = false): Promise<BudgetCategory[]> {
	if (!forceRefresh) {
		const cached = readCache();
		if (cached) return cached;
	}
	try {
		const result = (await directus.request(
			readItems('budget_category_config' as any, {
				filter: { status: { _eq: 'active' } },
				sort: ['sort', 'id'],
				fields: [
					'id', 'kode', 'nama', 'description', 'axis_allowed', 'gate_keys',
					'requires_periode', 'requires_project', 'icon', 'sort', 'status',
					'parent_id', 'coa_debit', 'requires_attachment', 'max_amount',
					'legacy_kategori', 'dept_scope',
					'clue_icon', 'clue_description', 'clue_examples', 'clue_requirements',
					'clue_keywords', 'default_item_kategori'
				],
				limit: -1
			})
		)) as BudgetCategory[];
		const data = result || [];
		writeCache(data);
		return data;
	} catch (e) {
		console.warn('[budgetCategory] gagal memuat kategori, form jatuh ke fallback kategori lama:', e);
		return [];
	}
}

/** Field dinamis untuk satu kategori (kosong = form standar tanpa field tambahan). */
export async function getCategoryFields(categoryId: number): Promise<BudgetCategoryField[]> {
	try {
		const result = (await directus.request(
			readItems('budget_category_field' as any, {
				filter: { category_id: { _eq: categoryId }, status: { _eq: 'active' } },
				sort: ['sort', 'id'],
				limit: -1
			})
		)) as BudgetCategoryField[];
		return result || [];
	} catch (e) {
		console.warn('[budgetCategory] gagal memuat field dinamis kategori', categoryId, e);
		return [];
	}
}

export function categoryLabel(cat: BudgetCategory): string {
	return `${cat.icon || ''} ${cat.nama}`.trim();
}

// Lampiran Otomatis v2 Fase 1 — matriks lampiran wajib per kategori
// (budget_category_attachment, dikelola admin erp-epi-1). Dibaca read-only oleh
// ceklist di form pengajuan. Gagal-lunak: array kosong bila error atau kategori
// belum punya aturan — form tidak berubah perilakunya.
export interface BudgetCategoryAttachment {
	id: number;
	category_id: number;
	attachment_type_id: {
		id: number;
		key: string;
		label: string;
		deskripsi: string | null;
		puller_key: string | null;
	} | null;
	is_required: boolean;
	stage: string;
	sort: number;
	pic?: string | null;
}

export async function getCategoryAttachments(categoryId: number): Promise<BudgetCategoryAttachment[]> {
	if (!categoryId) return [];
	try {
		const result = (await directus.request(
			readItems('budget_category_attachment' as any, {
				filter: { category_id: { _eq: categoryId }, status: { _eq: 'active' } },
				fields: [
					'id', 'category_id', 'is_required', 'stage', 'sort', 'pic',
					'attachment_type_id.id', 'attachment_type_id.key', 'attachment_type_id.label',
					'attachment_type_id.deskripsi', 'attachment_type_id.puller_key'
				],
				sort: ['sort', 'id'],
				limit: -1
			})
		)) as BudgetCategoryAttachment[];
		return result || [];
	} catch (e) {
		console.warn('[budgetCategory] gagal memuat matriks lampiran kategori', categoryId, e);
		return [];
	}
}

// Lampiran Otomatis v2 (L2) — PRATINJAU isi lampiran otomatis SEBELUM submit, dari
// data form yang belum tersimpan. Diteruskan ke generator admin lewat proxy
// /api/pengajuan-anggaran-preview. Tidak membuat berkas apa pun.
export interface AttachmentPreviewResult {
	available: boolean;
	empty?: boolean;
	warning?: string | null;
	html?: string;
	reason?: string;
}

export async function previewAttachment(
	pullerKey: string,
	draft: Record<string, unknown>
): Promise<AttachmentPreviewResult> {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/pengajuan-anggaran-preview', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ puller_key: pullerKey, draft })
		});
		const j = (await res.json().catch(() => ({}))) as AttachmentPreviewResult;
		if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
		return j;
	} catch (e: unknown) {
		return { available: false, reason: (e as Error)?.message || 'gagal' };
	}
}
