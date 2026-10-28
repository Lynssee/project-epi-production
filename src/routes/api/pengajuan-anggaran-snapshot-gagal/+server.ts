// src/routes/api/pengajuan-anggaran-snapshot-gagal/+server.ts
// Audit hidden cost #1051 — mencatat ke gate_audit_log bahwa snapshot gate sebuah PA dari lapangan GAGAL tersimpan
// setelah retry, supaya PENYEBABNYA terekam (sebelumnya hanya console.warn di browser pengaju dan hilang).
// Best-effort: tidak pernah 500 ke pengaju; hanya pengaju sendiri yang boleh melaporkan PA miliknya.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { writeGateAudit } from '$lib/server/gates/gateAudit';

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const pengajuanId = Number(body?.pengajuan_id);
	if (!Number.isSafeInteger(pengajuanId) || pengajuanId <= 0) throw error(400, 'pengajuan_id tidak valid.');

	// Pastikan PA ada dan dibuat oleh pemanggil (cegah spam audit atas PA orang lain).
	const res = await directusServerJson(`/items/pengajuan_anggaran/${pengajuanId}?fields=id,nomor_pengajuan,created_by_email,status`).catch(() => null);
	const pa = res?.data;
	if (!pa) throw error(404, 'Pengajuan tidak ditemukan.');
	const email = user?.email ? String(user.email).toLowerCase() : null;
	if (!email || String(pa.created_by_email || '').toLowerCase() !== email) throw error(403, 'Hanya pengaju yang boleh melaporkan kegagalan ini.');

	await writeGateAudit({
		gate: 'PA_SNAPSHOT_GATE',
		collection: 'pengajuan_anggaran',
		recordId: pengajuanId,
		decision: 'warn',
		reason: `Snapshot gate PA ${pa.nomor_pengajuan || pengajuanId} gagal tersimpan setelah ${Number(body?.attempts) || 0} percobaan: ${String(body?.error || 'tidak diketahui').slice(0, 300)}`,
		snapshot: { attempts: Number(body?.attempts) || 0, error: String(body?.error || '').slice(0, 300), source: 'lapangan' },
		email
	});
	return json({ success: true });
}
