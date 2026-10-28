// src/routes/api/packing-list/gate-precheck/+server.ts
// Path A — Audit & Hardening Gate v2 (30 Agu 2026), F0.4 / W6.
// Pra-cek gate Packing List sisi lapangan SEBELUM submit, untuk memberi makan
// GateCompletionWizard dan untuk dipanggil jalur pembuatan item baru / dari template
// (createPackingListItems / submitPackingFromTemplate) yang menulis project_budgets
// langsung dari klien. Jalur item RAB (submitPackingRequest) tetap ditegakkan
// authoritative di $lib/server/packingListSubmit.ts.
//
// budgetItemIds & items BOLEH dikirim BERSAMAAN (mis. PackingRequestModal mencampur item
// RAB terpilih + item dari template + item manual baru dalam satu pengajuan) — keduanya
// digabung jadi satu daftar baris sebelum dievaluasi (Gate Transparan & Popup Benahi Data
// v2, Fase 5, 16 Sep 2026) supaya G_PKL_INVENTORY_LINK bisa melihat baris project_budgets
// asli yang membawa no_item_needed/is_manpower — draf items (template/manual) tidak punya
// flag itu jadi otomatis dikecualikan dari gate tsb (lihat plFieldGates.ts).
//
//   POST { budgetItemIds?: number[], projectId?: number, items?: [{ qty, identitas_barang_id }] }
//     -> { success, status, gates[], blocking[], warnings[], overridden[], override_allowed }

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import type { FieldPLRow } from '$lib/server/gates/plFieldGates';
import { evaluateFieldPLGatesWithDisiplin } from '$lib/server/gates/plDisiplinFieldGates';
import { resolveFieldOverrideAllowed } from '$lib/server/gates/plFieldOverride';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { evaluateLaporanHilirGates } from '$lib/server/gates/laporanHarianHilirGate';

const num = (v: any) => parseFloat(v ?? 0) || 0;

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const overrideAllowed = await resolveFieldOverrideAllowed(event);
	const body = await event.request.json().catch(() => ({}) as any);

	try {
		// Jalur 1: id project_budgets yang sudah ada -> resolusi penuh (proyek + stok +
		// flag no_item_needed/is_manpower untuk G_PKL_INVENTORY_LINK).
		const budgetItemIds: number[] = Array.isArray(body?.budgetItemIds)
			? body.budgetItemIds.filter((n: any) => Number.isFinite(Number(n))).map(Number)
			: [];
		const rows: FieldPLRow[] = [];
		let resolvedProjectId: number | null = null;
		if (budgetItemIds.length) {
			const res: any = await directusServerJson(
				`/items/project_budgets?filter[id][_in]=${budgetItemIds.join(',')}` +
					`&fields=id,project_id,qty,identitas_barang_id,material_name,material_color,no_item_needed,is_manpower&limit=-1`
			);
			for (const r of res?.data || []) {
				const pid = r.project_id ? (typeof r.project_id === 'object' ? r.project_id.id : r.project_id) : null;
				if (pid && !resolvedProjectId) resolvedProjectId = pid;
				rows.push({
					id: r.id,
					project_id: pid,
					qty: num(r.qty),
					identitas_barang_id: r.identitas_barang_id
						? typeof r.identitas_barang_id === 'object'
							? r.identitas_barang_id.id
							: r.identitas_barang_id
						: null,
					material_name: r.material_name || r.description || null,
					material_color: r.material_color || null,
					no_item_needed: r.no_item_needed === true,
					is_manpower: r.is_manpower === true
				});
			}
		}

		// Jalur 2: item baru / dari template -> tidak punya id project_budgets asli
		// (id negatif sintetis supaya tak pernah tabrakan dengan id asli), TANPA flag
		// no_item_needed/is_manpower -> otomatis dikecualikan dari G_PKL_INVENTORY_LINK.
		const projectId = Number(body?.projectId) || resolvedProjectId || null;
		if (Array.isArray(body?.items)) {
			body.items.forEach((it: any, i: number) => {
				rows.push({
					id: -1000 - i,
					project_id: projectId,
					qty: num(it?.qty),
					identitas_barang_id: it?.identitas_barang_id
						? typeof it.identitas_barang_id === 'object'
							? it.identitas_barang_id.id
							: it.identitas_barang_id
						: null,
					material_name: it?.material_name || it?.description || null,
					material_color: it?.material_color || null
				});
			});
		}

		if (rows.length === 0) rows.push({ id: 0, project_id: projectId, qty: 0 });
		if (!projectId && !budgetItemIds.length) throw new Error('projectId atau budgetItemIds wajib diisi');

		// Gate lama + disiplin proyek (P2H alat & laporan harian) — berlaku untuk SEMUA pengaju (per proyek).
		const out = await evaluateFieldPLGatesWithDisiplin(rows, directusServerJson, { overrideAllowed });

		// Fase 4 (Gate Keras Disiplin Data & Laporan Harian, erp-epi-1, 17 Sep 2026) —
		// gerbang hilir G_LAPOR_MUTU/G_LAPOR_REVISI. Mode SENDIRI (laporan_compliance_rule),
		// default shadow/warn -- SEMI (tidak masuk `blocking`) kecuali admin naikkan ke 'block'.
		try {
			const karyawan = await getKaryawanByFirebaseUid(user.localId);
			if (karyawan?.id) {
				const { gMutu, gRevisi } = await evaluateLaporanHilirGates(karyawan.id);
				for (const g of [gMutu, gRevisi]) {
					out.gates.push({ gate_key: g.gate, label: g.gate === 'G_LAPOR_MUTU' ? 'Mutu laporan harian' : 'Tunggakan revisi laporan harian', mode: g.mode, status: g.allowed ? 'passed' : 'failed', message: g.reason, blocking: false, overridden: false });
					if (!g.allowed && g.mode === 'block') out.blocking.push(g.gate);
					else if (!g.allowed) out.warnings.push(g.gate);
				}
				out.status = out.blocking.length > 0 ? 'blocked' : out.warnings.length > 0 ? 'soft_warning' : out.status;
			}
		} catch (e) {
			console.warn('[packing-list/gate-precheck] gagal evaluasi gate laporan hilir (fail-open):', e);
		}

		return json({ success: true, ...out });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal pra-cek gate packing list');
	}
}

export async function GET() {
	throw error(405, 'Gunakan POST');
}
