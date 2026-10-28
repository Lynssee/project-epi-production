// src/routes/api/proyek/kontrak/request-ba/+server.ts
// Modul 4 (Dashboard Lapangan — Kontrak View), Fase 4 Finance Hardening (18 Agu 2026) —
// Project Leader mengajukan pembuatan BA untuk termin yang progres fisiknya sudah lewat
// ambang wajib-BA. Menulis ke koleksi `bast` (status='requested') — BUKAN koleksi baru
// bap_requests, sesuai keputusan arsitektur "bast sebagai tulang punggung tunggal BA".
// Lapangan TETAP tidak generate BA sendiri (keputusan 16 Agustus 2026) — ini hanya
// menandai permintaan; Admin/Finance yang memproses jadi draft BA lewat CreateBASTModal.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeader, isProjectAllowed } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';

export const POST: RequestHandler = async (event) => {
	const { karyawan, projectIds } = await authenticateProjectLeader(event);

	const body = await event.request.json().catch(() => null);
	const projectId = Number(body?.projectId);
	const terminId = body?.terminId ? String(body.terminId) : null;
	const notes = body?.notes ? String(body.notes).trim() : '';
	const standbyNotes = body?.standbyNotes ? String(body.standbyNotes).trim() : '';
	const dispositionType = body?.dispositionType ? String(body.dispositionType).trim() : '';
	const targetDate = body?.targetDate ? String(body.targetDate).trim() : '';

	if (!projectId) throw error(400, 'projectId wajib diisi');
	if (!isProjectAllowed(projectIds, projectId)) {
		throw error(403, 'Anda bukan Project Leader untuk proyek ini');
	}

	// Cegah dobel pengajuan: satu termin cukup satu BAST 'requested' yang masih terbuka.
	if (terminId) {
		const existing = await directusServerJson<{ data: any[] }>(
			`/items/bast?filter[termin_id][_eq]=${encodeURIComponent(terminId)}&filter[status][_in]=requested,submitted,draft,approved&limit=1&fields=id,status`
		);
		if (existing?.data?.length) {
			throw error(409, `Sudah ada BAST (status: ${existing.data[0].status}) untuk termin ini`);
		}
	}

	const project = await directusServerJson<{ data: any }>(
		`/items/projects/${projectId}?fields=id,name,lokasi,nomor_po`
	);
	const proj = project?.data;

	let finalNotes = notes;
	if (dispositionType || standbyNotes) {
		const dispTag = dispositionType
			? `[DISPOSISI: ${dispositionType.toUpperCase()}${targetDate ? ` s/d ${targetDate}` : ''}]`
			: '[STANDBY]';
		finalNotes = [dispTag, standbyNotes, notes].filter(Boolean).join(' - ');
	}

	const created = await directusServerJson<{ data: any }>('/items/bast', {
		method: 'POST',
		body: JSON.stringify({
			project_id: projectId,
			termin_id: terminId,
			status: 'requested',
			requested_by: karyawan.nama_karyawan,
			request_notes: finalNotes,
			bast_date: new Date().toISOString().split('T')[0],
			pekerjaan: proj?.name || '',
			lokasi: proj?.lokasi || '',
			po_number: proj?.nomor_po || ''
		})
	});

	// Catat ke gate_audit_log bila ada catatan standby/disposisi
	if (dispositionType || standbyNotes) {
		try {
			await directusServerJson('/items/gate_audit_log', {
				method: 'POST',
				body: JSON.stringify({
					gate: 'G_BAST_DEMOB_EQUIPMENT',
					collection: 'items/bast',
					method: 'POST',
					record_id: String(created?.data?.id || ''),
					decision: 'standby_disposition',
					reason: finalNotes,
					payload_snapshot: {
						projectId,
						terminId,
						dispositionType,
						standbyNotes,
						targetDate,
						requested_by: karyawan.nama_karyawan
					}
				})
			});
		} catch (e) {
			console.warn('[kontrak/request-ba] gagal catat gate_audit_log (non-fatal):', (e as Error).message);
		}
	}

	// Notifikasi in-app ke Admin/Finance — non-fatal.
	try {
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'bast',
				title: 'Permintaan pembuatan BA dari lapangan',
				message: `${karyawan.nama_karyawan} mengajukan pembuatan BA untuk proyek ${proj?.name || projectId}${finalNotes ? `: ${finalNotes}` : ''}`,
				priority: 'medium',
				department: 'finance',
				read: false,
				action_required: true,
				action_url: '/finance?tab=bast',
				created_at: new Date().toISOString()
			})
		});
	} catch (e) {
		console.warn('[kontrak/request-ba] gagal membuat notifikasi (non-fatal):', (e as Error).message);
	}

	return json({ success: true, data: created?.data });
};
