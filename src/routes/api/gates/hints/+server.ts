// src/routes/api/gates/hints/+server.ts
// Gate Transparan & Popup Benahi Data, Fase 1 — proxy tipis ke GET /api/gates/modes
// milik admin erp-epi-1 (lewat fieldGateHints.ts). Pola sama persis dengan
// pengajuan-preflight/+server.ts: requireUser() lokal dulu, teruskan header
// Authorization apa adanya (Firebase project sama), fail-soft mutlak.
//
//   GET /api/gates/hints?modul=<>&document_type=<>[&jenis_pengajuan=<>]
//     -> { available, modes?: {[gate_key]: {...}}, reason? }

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { fetchFieldGateHints } from '$lib/server/gates/fieldGateHints';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const modul = event.url.searchParams.get('modul');
	const documentType = event.url.searchParams.get('document_type');
	const jenisPengajuan = event.url.searchParams.get('jenis_pengajuan') || null;
	if (!modul || !documentType) throw error(400, 'modul & document_type wajib');

	const authHeader = event.request.headers.get('authorization') || '';
	const result = await fetchFieldGateHints(modul, documentType, authHeader, jenisPengajuan);
	return json(result);
}
