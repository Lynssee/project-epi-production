// src/routes/api/procurement/lampiran-rules/+server.ts
// Rencana Lampiran Otomatis PR v2 (27 Agu 2026, Fase 5 — Dashboard Lapangan).
// GET ?kode=KODE  -> daftar aturan lampiran aktif untuk satu kategori pembelian.
// Dipakai Langkah 3 "Tinjau Sebelum Kirim" di /procurement/ajukan sebagai PRATINJAU
// non-blocking (PR belum dibuat, jadi belum ada baris pengajuan_lampiran).
//
// Lewat token server (admin) — koleksi attachment_type_registry / purchase_category_attachment
// dibuat oleh erp-epi-1 dan belum tentu punya izin baca untuk peran lapangan.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const kode = event.url.searchParams.get('kode');
	if (!kode) throw error(400, 'Parameter kode wajib');

	const res = await directusServerJson<{ data: any[] }>(
		`/items/purchase_category_attachment?filter[category_id][kode][_eq]=${encodeURIComponent(kode)}` +
			`&filter[status][_eq]=active` +
			`&fields=id,is_required,stage,sort,attachment_type_id.id,attachment_type_id.key,` +
			`attachment_type_id.label,attachment_type_id.deskripsi,attachment_type_id.puller_key,attachment_type_id.aktif` +
			`&sort=sort&limit=-1`
	).catch(() => ({ data: [] }));

	const rules = (res?.data || [])
		.filter((r) => r.attachment_type_id && r.attachment_type_id.aktif !== false)
		.map((r) => ({
			rule_id: r.id,
			attachment_type_id: r.attachment_type_id.id,
			key: r.attachment_type_id.key,
			label: r.attachment_type_id.label,
			deskripsi: r.attachment_type_id.deskripsi,
			puller_key: r.attachment_type_id.puller_key || null,
			is_required: !!r.is_required,
			stage: r.stage || 'approval'
		}));

	return json({ kode, rules });
}
