// src/routes/api/inventory-proyek/komplain-lock/+server.ts
// Pra-cek gate G_PROYEK_KOMPLAIN_LOCK untuk form Laporan Harian: apakah ada barang yang akan dilaporkan terpakai tetapi sedang
// dikomplain (salah spek / rusak) di proyek ini? Dipanggil SEBELUM laporan disimpan (laporan ditulis langsung klien ke Directus,
// jadi satu-satunya titik yang bisa menahan adalah sebelum simpan). Mode (shadow/warn/hard) diatur Superadmin di /settings/gates.
// Read-only kecuali jejak audit (best-effort) — hemat: satu query barang_bermasalah_log + satu baca definisi gate (di-cache).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGRActor, isProjectAllowed } from '$lib/server/goodsReceived/guard';
import { evaluateKomplainLock, KOMPLAIN_LOCK_GATE_KEY } from '$lib/server/gates/komplainLockGate';
import { writeGateAudit } from '$lib/server/gates/gateAudit';

export const POST: RequestHandler = async (event) => {
	const { karyawan, projectIds } = await authenticateGRActor(event);
	const body = await event.request.json().catch(() => null);
	const projectId = Number(body?.projectId);
	const itemIds: number[] = (Array.isArray(body?.itemIds) ? body.itemIds : []).map(Number).filter((n: number) => Number.isFinite(n) && n > 0);

	if (!Number.isFinite(projectId)) throw error(400, 'projectId tidak valid.');
	if (!isProjectAllowed(projectIds, projectId)) throw error(403, 'Anda bukan leader proyek ini.');

	const verdict = await evaluateKomplainLock(projectId, itemIds);

	if (verdict.locks.length > 0) {
		await writeGateAudit({
			gate: KOMPLAIN_LOCK_GATE_KEY,
			collection: 'laporan_harian',
			recordId: null,
			decision: verdict.mode === 'shadow' ? 'shadow' : verdict.decision === 'block' ? 'block' : 'warn',
			reason: `Pemakaian barang dikomplain di proyek ${projectId}: ${verdict.locks.map((l) => l.namaBarang).slice(0, 5).join(', ')}`,
			snapshot: { projectId, locks: verdict.locks, mode: verdict.mode },
			email: (karyawan as any)?.email_company ?? null
		});
	}

	return json(verdict);
};
