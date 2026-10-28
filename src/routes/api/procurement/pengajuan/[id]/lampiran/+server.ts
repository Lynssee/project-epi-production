// src/routes/api/procurement/pengajuan/[id]/lampiran/+server.ts
// Rencana Lampiran Otomatis PR v2 (27 Agu 2026, Fase 5 — Dashboard Lapangan).
//
//   GET  -> { checklist }   aturan kategori PR ⋈ baris pengajuan_lampiran tersimpan
//   POST { action:'attach', attachment_type_id, file_id }
//        -> upsert baris pengajuan_lampiran (source_type='manual', status='completed')
//
// Dibatasi ke jalur MANUAL saja untuk lapangan (keputusan Rencana §5):
//   - "Tarik Data" (generator) hanya di dashboard admin — menariknya dari HP cuma
//     menambah beban server tanpa manfaat.
//   - Pengecualian terstruktur hanya diberikan approver/atasan di dashboard internal.
// Gate G_PR_LAMPIRAN TIDAK dievaluasi di sini (mesin gate ada di erp-epi-1); snapshot
// interlocking_gates akan tersegarkan saat aksi berikutnya di dashboard admin.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';

const SATISFIED = ['completed', 'dikecualikan'];

async function loadPengajuan(id: string) {
	const res = await directusServerJson<{ data: any }>(
		`/items/pengajuan/${id}?fields=id,kategori_pembelian,status,pengaju_karyawan_id`
	).catch(() => null);
	return res?.data || null;
}

async function loadRules(kode: string | null) {
	if (!kode) return [];
	const res = await directusServerJson<{ data: any[] }>(
		`/items/purchase_category_attachment?filter[category_id][kode][_eq]=${encodeURIComponent(kode)}` +
			`&filter[status][_eq]=active` +
			`&fields=id,is_required,stage,sort,attachment_type_id.id,attachment_type_id.key,` +
			`attachment_type_id.label,attachment_type_id.deskripsi,attachment_type_id.puller_key,attachment_type_id.aktif` +
			`&sort=sort&limit=-1`
	).catch(() => ({ data: [] }));
	return (res?.data || []).filter((r) => r.attachment_type_id && r.attachment_type_id.aktif !== false);
}

async function loadLampiran(id: string) {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/pengajuan_lampiran?filter[pengajuan_id][_eq]=${id}` +
			`&fields=id,attachment_type_id,source_type,file_id,status,generated_by,generated_at,` +
			`exception_reason,exception_note,exception_by&sort=-date_created&limit=-1`
	).catch(() => ({ data: [] }));
	return res?.data || [];
}

function buildChecklist(rules: any[], lampiran: any[]) {
	const byType = new Map<number, any>();
	for (const l of lampiran) if (!byType.has(l.attachment_type_id)) byType.set(l.attachment_type_id, l);
	const ruleTypeIds = new Set(rules.map((r) => r.attachment_type_id.id));

	const main = rules.map((r) => {
		const l = byType.get(r.attachment_type_id.id) || null;
		return {
			rule_id: r.id,
			attachment_type_id: r.attachment_type_id.id,
			key: r.attachment_type_id.key,
			label: r.attachment_type_id.label,
			deskripsi: r.attachment_type_id.deskripsi,
			puller_key: r.attachment_type_id.puller_key || null,
			is_required: !!r.is_required,
			stage: r.stage || 'approval',
			lampiran: l,
			fulfilled: !!(l && SATISFIED.includes(l.status))
		};
	});
	const extras = lampiran
		.filter((l) => !ruleTypeIds.has(l.attachment_type_id))
		.map((l) => ({
			rule_id: null,
			attachment_type_id: l.attachment_type_id,
			key: null,
			label: null,
			deskripsi: null,
			puller_key: null,
			is_required: false,
			stage: null,
			lampiran: l,
			fulfilled: SATISFIED.includes(l.status)
		}));
	return [...main, ...extras];
}

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const id = event.params.id!;
	const pengajuan = await loadPengajuan(id);
	if (!pengajuan) throw error(404, 'Pengajuan tidak ditemukan');
	const [rules, lampiran] = await Promise.all([loadRules(pengajuan.kategori_pembelian), loadLampiran(id)]);
	return json({ category: pengajuan.kategori_pembelian || null, checklist: buildChecklist(rules, lampiran) });
}

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);
	const id = event.params.id!;
	const body = await event.request.json().catch(() => ({}));

	if (body.action !== 'attach') throw error(400, "Hanya action='attach' yang didukung dari lapangan");
	const attachmentTypeId = Number(body.attachment_type_id);
	const fileId = body.file_id;
	if (!attachmentTypeId) throw error(400, 'attachment_type_id wajib');
	if (!fileId) throw error(400, 'file_id wajib');

	const pengajuan = await loadPengajuan(id);
	if (!pengajuan) throw error(404, 'Pengajuan tidak ditemukan');

	const typeRes = await directusServerJson<{ data: any }>(
		`/items/attachment_type_registry/${attachmentTypeId}?fields=id,label,aktif`
	).catch(() => null);
	if (!typeRes?.data) throw error(400, 'Jenis lampiran tidak dikenal');

	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId).catch(() => null);
	const actorName = karyawan?.nama_karyawan || fbUser.email || 'Lapangan';

	const existingRes = await directusServerJson<{ data: any[] }>(
		`/items/pengajuan_lampiran?filter[pengajuan_id][_eq]=${id}&filter[attachment_type_id][_eq]=${attachmentTypeId}&fields=id&limit=1`
	).catch(() => ({ data: [] }));
	const existingId = existingRes?.data?.[0]?.id || null;

	const payload = {
		pengajuan_id: Number(id),
		attachment_type_id: attachmentTypeId,
		source_type: 'manual',
		file_id: fileId,
		status: 'completed',
		generated_by: actorName,
		exception_reason: null,
		exception_note: null,
		exception_by: null,
		exception_at: null
	};

	let saved;
	if (existingId) {
		saved = (
			await directusServerJson<{ data: any }>(`/items/pengajuan_lampiran/${existingId}`, {
				method: 'PATCH',
				body: JSON.stringify(payload)
			})
		)?.data;
	} else {
		saved = (
			await directusServerJson<{ data: any }>(`/items/pengajuan_lampiran`, {
				method: 'POST',
				body: JSON.stringify(payload)
			})
		)?.data;
	}

	return json({ success: true, data: saved });
}
