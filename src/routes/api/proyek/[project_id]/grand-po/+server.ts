// src/routes/api/proyek/[project_id]/grand-po/+server.ts
// Grand PO Fase 5 — kartu "Paket Grand PO" & "Material dari Customer" di ringkasan proyek lapangan.
// READ-ONLY, tanpa Rupiah. Hanya untuk yang berwenang atas proyek (role penuh, atau leader/wakil proyek tsb);
// selain itu 403 — fail-closed, kartu disembunyikan di klien.

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveFieldProjectScope } from '$lib/server/fieldProjectScope';
import { loadGrandPoLapangan, type GrandPoLapanganResult } from '$lib/server/grandPoLapangan';
import { findMoneyKeys } from '$lib/utils/grandPoLapangan';

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const projectId = Number(event.params.project_id);
	if (!Number.isInteger(projectId) || projectId <= 0) return json({ error: 'ID proyek tidak valid' }, { status: 400 });

	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const scope = await resolveFieldProjectScope(idToken, user.localId, user.email);
	if (!scope.unrestricted && !scope.projectIds.includes(projectId)) {
		return json({ error: 'Anda tidak memegang proyek ini.' }, { status: 403 });
	}

	let data: GrandPoLapanganResult;
	try {
		data = await loadGrandPoLapangan(projectId);
	} catch (e) {
		console.error('[api/proyek/grand-po] gagal:', (e as Error)?.message);
		return json({ error: 'Gagal memuat data Paket Grand PO' }, { status: 502 });
	}

	// Pengaman defensif: jangan pernah kirim kunci yang tampak seperti Rupiah ke lapangan.
	const leaked = findMoneyKeys({ paket: data.paket, material: data.material, rekonsiliasi: data.rekonsiliasi, pilihan_produk: data.pilihan_produk });
	if (leaked.length) {
		console.error('[api/proyek/grand-po] kunci bernuansa Rupiah terdeteksi, respons dibatalkan:', leaked);
		return json({ error: 'Kesalahan internal' }, { status: 500 });
	}

	return json(data, { headers: { 'Cache-Control': 'no-store' } });
};
