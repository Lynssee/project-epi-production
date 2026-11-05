// src/lib/server/inventoryInspectionRecorder.ts
// SERVER-ONLY (lapangan). Tulis rekaman checklist inspeksi terima (Inventory 360° Fase C) untuk SATU surat jalan yang baru
// dikonfirmasi diterima, SEBELUM gate G_INV_SPEC_RECEIVE di erp-epi dievaluasi (via relay) supaya gate melihat rekaman dokumen ini.
//
// Padanan src/lib/server/inventoryInspectionRecorder.js di erp-epi. Best-effort & fail-soft: TIDAK PERNAH melempar dan tidak
// pernah memengaruhi penerimaan fisik/jurnal/klaim. Rujukan dokumen (token) disusun SERVER dari id surat jalan, bukan dari klien.
// Mati bawaan sampai koleksi inventory_knowledge_inspection ada dan setelan checklist_terima_simpan = true.

import { directusServerJson } from '$lib/server/directus';
import { buildInspectionRecord, inspectionReference, INSPECTION_COLLECTION } from '$lib/services/inventory360/inventoryKnowledgeInspection.js';

export const MAX_INSPECTION_ROWS = 200;
const SETTING = 'inventory.knowledge.checklist_terima_simpan';

type Json = <T = any>(path: string, opts?: RequestInit) => Promise<T>;
type Deps = { fetchJson: Json; readSetting: (key: string) => Promise<boolean> };

const defaultDeps: Deps = {
	fetchJson: (path, opts) => directusServerJson(path, opts as any),
	readSetting: async (key) => {
		const r = await directusServerJson<{ data: Array<{ setting_value: unknown }> }>(
			`/items/system_settings?limit=1&fields=setting_value&filter[setting_key][_eq]=${encodeURIComponent(key)}`
		);
		const raw = r?.data?.[0]?.setting_value;
		if (typeof raw === 'boolean') return raw;
		try {
			return JSON.parse(String(raw ?? 'false')) === true;
		} catch {
			return false;
		}
	}
};

/**
 * @param p.inspeksi [{ itemId, profileId?, items:[{id,text}], checked:[id] }] dari klien (tidak dipercaya mentah-mentah: divalidasi)
 * @returns jumlah rekaman tersimpan, atau alasan dilewati
 */
export async function recordInspectionsForDocument(
	p: { inspeksi: unknown; collection: string; recordId: string | number; label?: string; userEmail?: string | null },
	deps: Partial<Deps> = {}
): Promise<{ saved: number; skipped?: string }> {
	const { fetchJson, readSetting } = { ...defaultDeps, ...deps };
	try {
		if (!Array.isArray(p.inspeksi) || !p.inspeksi.length) return { saved: 0, skipped: 'tidak ada checklist dikirim' };
		if (!(await readSetting(SETTING))) return { saved: 0, skipped: 'rekaman checklist terima belum dinyalakan' };

		const referensi = inspectionReference(p.label ?? '', p.collection, p.recordId);
		const seen = new Set<number>();
		const rows: object[] = [];
		for (const raw of (p.inspeksi as any[]).slice(0, MAX_INSPECTION_ROWS)) {
			const itemId = Number(raw?.itemId);
			if (!Number.isFinite(itemId) || itemId <= 0 || seen.has(itemId)) continue;
			const items = (Array.isArray(raw?.items) ? raw.items : [])
				.filter((i: any) => i && typeof i.id === 'string' && i.id)
				.map((i: any) => ({ id: i.id as string, text: String(i.text ?? '') }));
			const row = buildInspectionRecord({
				itemId,
				profileId: raw?.profileId ?? null,
				items,
				checked: Array.isArray(raw?.checked) ? raw.checked.filter((c: unknown) => typeof c === 'string') : [],
				referensi,
				pemeriksaEmail: p.userEmail ?? null
			});
			if (row) {
				seen.add(itemId);
				rows.push(row);
			}
		}
		if (!rows.length) return { saved: 0, skipped: 'tidak ada butir yang dicentang' };
		await fetchJson(`/items/${INSPECTION_COLLECTION}`, { method: 'POST', body: JSON.stringify(rows) });
		return { saved: rows.length };
	} catch (e) {
		console.error('[inspectionRecorder] rekaman checklist terima tidak tersimpan (penerimaan tetap sukses):', e);
		return { saved: 0, skipped: 'gagal menyimpan' };
	}
}
