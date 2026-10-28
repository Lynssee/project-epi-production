// src/routes/api/proyek/kontrak/addendum/+server.ts
// Modul 4 (Dashboard Lapangan — Kontrak View) — Project Leader mengajukan permintaan perubahan
// (addendum) atas kontrak proyeknya. Menulis ke contract_amendments (koleksi yang sama dipakai
// Admin ERP / Legal), BUKAN tabel baru — supaya pengajuan lapangan otomatis muncul di panel
// "Riwayat Amandemen" Legal. Dibatasi jenis_perubahan non-finansial (jadwal/judul_scope/lainnya)
// karena leader tidak melihat nilai_kontrak sama sekali di app ini.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeader, isProjectAllowed } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';

const ALLOWED_JENIS = ['jadwal', 'judul_scope', 'lainnya'];

function yymm(): string {
	const d = new Date();
	return `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const POST: RequestHandler = async (event) => {
	const { karyawan, projectIds } = await authenticateProjectLeader(event);

	const body = await event.request.json().catch(() => null);
	const projectId = Number(body?.projectId);
	const contractId = body?.contractId ? String(body.contractId) : null;
	const jenisPerubahan = body?.jenisPerubahan;
	const alasan = body?.alasan;
	const proposedValue = body?.proposedValue;

	if (!projectId || !contractId) throw error(400, 'projectId dan contractId wajib diisi');
	if (!ALLOWED_JENIS.includes(jenisPerubahan)) throw error(400, 'jenisPerubahan tidak valid');
	if (!alasan || !String(alasan).trim()) throw error(400, 'alasan wajib diisi');
	if (!isProjectAllowed(projectIds, projectId)) {
		throw error(403, 'Anda bukan Project Leader untuk proyek ini');
	}

	// 1. Cari contract_registry yang menunjuk ke project_contract ini — auto-daftarkan bila
	// belum ada (kontrak lama yang dibuat sebelum wiring approval Admin ERP belum punya entry).
	const existingRegistry = await directusServerJson<{ data: any[] }>(
		`/items/contract_registry?filter[source_collection][_eq]=project_contract&filter[source_id][_eq]=${encodeURIComponent(contractId)}&limit=1&fields=*`
	);
	let registryRow = existingRegistry?.data?.[0] || null;

	if (!registryRow) {
		const prefix = `CTR-${yymm()}-`;
		const countRes = await directusServerJson<{ data: Array<{ count: { id: number } }> }>(
			`/items/contract_registry?limit=1&aggregate[count]=id&filter[contract_number][_starts_with]=${encodeURIComponent(prefix)}`
		);
		const seq = parseInt(String(countRes?.data?.[0]?.count?.id || 0), 10) + 1;
		const contractNumber = `${prefix}${String(seq).padStart(4, '0')}`;

		const created = await directusServerJson<{ data: any }>('/items/contract_registry', {
			method: 'POST',
			body: JSON.stringify({
				contract_number: contractNumber,
				judul: `Kontrak Proyek #${projectId}`,
				tipe_kontrak: 'proyek_customer',
				pihak_1: 'PT. Eltama Prima Indo',
				project_id: String(projectId),
				source_collection: 'project_contract',
				source_id: contractId,
				status: 'aktif',
				reminder_hari: [90, 60, 30],
				catatan: 'Auto-registered saat pengajuan addendum dari lapangan',
				created_by: karyawan.nama_karyawan
			})
		});
		registryRow = created?.data;
		if (!registryRow?.id) throw error(500, 'Gagal mendaftarkan kontrak ke registry');

		try {
			await directusServerJson(`/items/project_contract/${contractId}`, {
				method: 'PATCH',
				body: JSON.stringify({ contract_registry_id: registryRow.id })
			});
		} catch (e) {
			console.warn('[kontrak/addendum] gagal tautan balik project_contract:', (e as Error).message);
		}
	}

	// 2. Susun delta_changes utk 1 field yang diajukan.
	const fieldMap: Record<string, string> = {
		jadwal: 'tanggal_berakhir',
		judul_scope: 'judul',
		lainnya: 'catatan'
	};
	const field = fieldMap[jenisPerubahan];
	const before = registryRow[field] ?? null;
	const deltaChanges = { [field]: { before, after: proposedValue ?? null } };

	// 3. Nomor amandemen sekuensial per kontrak.
	const existingAmendments = await directusServerJson<{ data: any[] }>(
		`/items/contract_amendments?filter[contract_registry_id][_eq]=${registryRow.id}&limit=-1&fields=id`
	);
	const nomorAmandemen = `AMD-${registryRow.contract_number}-${String((existingAmendments?.data?.length || 0) + 1).padStart(2, '0')}`;

	const amendment = await directusServerJson<{ data: any }>('/items/contract_amendments', {
		method: 'POST',
		body: JSON.stringify({
			contract_registry_id: registryRow.id,
			nomor_amandemen: nomorAmandemen,
			jenis_perubahan: jenisPerubahan,
			alasan,
			snapshot_before: registryRow,
			delta_changes: deltaChanges,
			status: 'diajukan',
			diajukan_oleh: karyawan.nama_karyawan
		})
	});

	// 4. Notifikasi in-app ke Admin/Legal — non-fatal.
	try {
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'kontrak',
				title: 'Pengajuan amandemen kontrak dari lapangan',
				message: `${karyawan.nama_karyawan} mengajukan amandemen (${jenisPerubahan}) untuk kontrak ${registryRow.contract_number}: ${alasan}`,
				priority: 'medium',
				department: 'legal',
				read: false,
				action_required: true,
				action_url: '/legal-tender?tab=kontrak',
				created_at: new Date().toISOString()
			})
		});
	} catch (e) {
		console.warn('[kontrak/addendum] gagal membuat notifikasi (non-fatal):', (e as Error).message);
	}

	return json({ success: true, data: amendment?.data });
};
