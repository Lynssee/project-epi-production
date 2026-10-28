// src/routes/api/inventory-proyek/opname/+server.ts
// Fase 1 (Rencana Implementasi Inventory Proyek v2.0, 24 Juli 2026): submit opname fisik
// pembuka untuk proyek pilot. Belum ada project_stock_ledger (Fase 2, butuh izin buat
// collection produksi) — hasil opname DISIMPAN SEMENTARA sebagai `data_snapshot` pada
// signature_envelope (Universal Signature Service, F0), bukan tabel baru. Leader
// menandatangani via endpoint generik yang sudah ada: POST /api/signature/[envelopeId]/sign
// (lihat komentar di sana: "F1 akan jadi pemanggil nyata pertama" — inilah pemanggil itu).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGRActor, isProjectAllowed } from '$lib/server/goodsReceived/guard';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { directusServerJson } from '$lib/server/directus';
import { resolvePilotProjectIds, isPilotProject } from '$lib/server/inventorySettings';
import { computeVerifyHash, computeEnvelopeRefKey } from '$lib/server/shared/signatureVerify';

interface OpnameItemInput {
	project_budget_id: number;
	identitas_barang_id: number;
	material_name: string;
	unit: string | null;
	rab_qty: number | null;
	physical_qty: number;
	notes?: string;
}

export const POST: RequestHandler = async (event) => {
	const actor = await authenticateGRActor(event);
	const { karyawan } = actor;

	const body = await event.request.json().catch(() => null);
	const projectId = Number(body?.projectId);
	const items: OpnameItemInput[] = Array.isArray(body?.items) ? body.items : [];

	if (!Number.isFinite(projectId)) throw error(400, 'projectId tidak valid.');

	const pilotIds = await resolvePilotProjectIds();
	if (!isPilotProject(pilotIds, projectId)) {
		throw error(400, 'Proyek ini belum masuk pilot Fase 1 Inventory Proyek.');
	}
	if (!isProjectAllowed(actor.projectIds, projectId)) {
		throw error(403, 'Anda tidak memiliki otoritas sebagai leader atau penanggung jawab proyek ini.');
	}
	if (!items.length) throw error(400, 'Tidak ada item untuk diopname.');

	const projRes = await directusServerJson<{ data: any }>(`/items/projects/${projectId}?fields=id,name`);
	const projectName = projRes?.data?.name || `Proyek #${projectId}`;

	const now = new Date().toISOString();
	const refId = `${projectId}-${Date.now()}`;
	const dataSnapshot = {
		projectId,
		projectName,
		submittedBy: karyawan.nama_karyawan,
		submittedAt: now,
		items: items.map((it) => ({
			project_budget_id: it.project_budget_id,
			identitas_barang_id: it.identitas_barang_id,
			material_name: it.material_name,
			unit: it.unit,
			rab_qty: it.rab_qty,
			physical_qty: it.physical_qty,
			selisih: it.physical_qty - (it.rab_qty || 0),
			notes: it.notes || null
		}))
	};

	const verifyHash = computeVerifyHash(computeEnvelopeRefKey('inventory_proyek.opname', refId), dataSnapshot);

	const envelopeRes = await directusServerJson<{ data: any }>('/items/signature_envelope', {
		method: 'POST',
		body: JSON.stringify({
			modul_asal: 'inventory_proyek.opname',
			ref_id: refId,
			judul: `Opname Fisik Pembuka - ${projectName}`,
			status: 'menunggu',
			verify_hash: verifyHash,
			data_snapshot: dataSnapshot,
			dibuat_oleh: karyawan.nama_karyawan,
			urutan_wajib: false
		})
	});
	const envelope = envelopeRes?.data;
	if (!envelope?.id) throw error(500, 'Gagal membuat envelope opname.');

	await directusServerJson('/items/doc_signature', {
		method: 'POST',
		body: JSON.stringify({
			envelope_id: envelope.id,
			urutan: 1,
			peran: 'leader',
			karyawan_id: karyawan.id,
			nama: karyawan.nama_karyawan,
			status: 'pending',
			tipe_penandatangan: 'internal',
			kanal: 'digital'
		})
	});

	await directusServerJson('/items/signature_audit', {
		method: 'POST',
		body: JSON.stringify({
			envelope_id: envelope.id,
			event: 'dibuat',
			aktor: karyawan.nama_karyawan
		})
	});

	return json({ envelopeId: envelope.id });
};

/** Daftar sesi opname yang sudah pernah dibuat untuk proyek pilot leader ini (riwayat + status). */
export const GET: RequestHandler = async (event) => {
	const allPilotIds = await resolvePilotProjectIds();

	// Fetch details of all pilot projects from Directus. allPilotIds === null berarti tanpa
	// pembatasan (gerbang dibuka untuk semua proyek) -- ambil daftar proyek tanpa filter id.
	const pilotProjRes = await directusServerJson<{ data: Array<{ id: number; name: string }> }>(
		allPilotIds === null
			? `/items/projects?fields=id,name&limit=500`
			: `/items/projects?filter[id][_in]=${allPilotIds.join(',')}&fields=id,name`
	).catch(() => null);
	const pilotProjects = pilotProjRes?.data || [];

	let actor;
	try {
		actor = await authenticateGRActor(event);
	} catch (e: any) {
		const user = await requireUser(event).catch(() => null);
		const karyawan = user ? await resolveKaryawanByEmail(user.email).catch(() => null) : null;
		return json({
			sessions: [],
			pilotProjectIds: [],
			pilotProjects,
			userProjects: [],
			userRole: 'staff',
			userKaryawan: karyawan?.nama_karyawan || 'Karyawan'
		});
	}

	// allPilotIds === null berarti gerbang terbuka untuk semua proyek -- basis daftarnya
	// jadi seluruh pilotProjects yang sudah diambil di atas (bukan array kosong).
	const pilotBaseIds = allPilotIds === null ? pilotProjects.map((p) => p.id) : allPilotIds;
	const myPilotIds =
		actor.projectIds === null
			? pilotBaseIds // admin: tak dibatasi kepemilikan proyek
			: pilotBaseIds.filter((id) => isProjectAllowed(actor.projectIds, id));

	let userProjects: Array<{ id: number; name: string }> = [];
	if (Array.isArray(actor.projectIds) && actor.projectIds.length > 0) {
		const userProjRes = await directusServerJson<{ data: Array<{ id: number; name: string }> }>(
			`/items/projects?filter[id][_in]=${actor.projectIds.join(',')}&fields=id,name`
		).catch(() => null);
		userProjects = userProjRes?.data || [];
	}

	let sessions: any[] = [];
	if (myPilotIds.length > 0) {
		const query = new URLSearchParams({
			filter: JSON.stringify({ modul_asal: { _eq: 'inventory_proyek.opname' } }),
			sort: '-date_created',
			limit: '-1'
		});
		const res = await directusServerJson<{ data: any[] }>(`/items/signature_envelope?${query.toString()}`).catch(() => null);
		sessions = (res?.data || []).filter((e) => myPilotIds.includes(e.data_snapshot?.projectId));
	}

	return json({
		sessions,
		pilotProjectIds: myPilotIds,
		pilotProjects,
		userProjects,
		userRole: actor.role,
		userKaryawan: actor.karyawan.nama_karyawan
	});
};
