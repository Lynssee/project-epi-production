// src/routes/api/picking/verify/+server.ts
// Fase 3 — Mobile Picking. Verifikasi orang kedua (keputusan 4 Agu 2026): picking
// baru dianggap selesai setelah diverifikasi user LAIN, bukan picker yang sama.
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

interface ProjectBudgetRow {
	id: number;
	pick_status: string | null;
	picked_by: string | null;
}

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const projectBudgetId = Number(body?.projectBudgetId);
	if (!projectBudgetId) throw error(400, 'projectBudgetId wajib diisi.');

	const rowRes = await directusServerJson<{ data: ProjectBudgetRow }>(
		`/items/project_budgets/${projectBudgetId}?fields=id,pick_status,picked_by`
	).catch(() => null);
	const row = rowRes?.data;
	if (!row) throw error(404, 'Baris packing tidak ditemukan.');
	if (row.pick_status !== 'picked') throw error(400, 'Baris ini belum di-picking, tidak bisa diverifikasi.');
	if (row.picked_by === user.email) {
		throw error(403, 'Verifikasi harus dilakukan orang lain, bukan picker yang sama.');
	}

	await directusServerJson(`/items/project_budgets/${projectBudgetId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			verified_by: user.email,
			verified_at: new Date().toISOString(),
			pick_status: 'verified'
		})
	});

	return json({ ok: true });
}
