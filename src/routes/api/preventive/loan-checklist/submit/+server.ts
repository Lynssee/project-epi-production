// src/routes/api/preventive/loan-checklist/submit/+server.ts
// Fase 1 (audit B1/B6, 2026-07-17) — perbaikan atomicity submitLoanChecklist yang sama
// dengan P2H (lihat api/preventive/p2h/submit): checklist + BAST + update status loan +
// auto-tiket sekarang satu request server-side, dengan verifikasi PIC ownership (loan
// diambil ulang server-side, bukan percaya objek loan dari klien).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateLoanOwner } from '$lib/server/preventive/loanGuard';
import { directusServerJson } from '$lib/server/directus';
import { notifyProjectLoanChecklistSubmitted } from '$lib/server/projectNotify';

const LOAN_STATUS = {
	AKTIF: '8d23640e-5726-4480-a9fb-693e3ea6c8fa',
	DIKEMBALIKAN: 'ab75b88f-1191-47bd-9725-903da4a1c3f3'
};
const BAST_TYPE = {
	PEMINJAMAN_ALAT: '36e3d37b-1873-448d-81c7-e950c41aad9f',
	PENGEMBALIAN_ALAT: 'fc151cfa-2d34-4450-86ec-12ff8c056b2d'
};

function todayWib(): string {
	return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function generateBastNumber(prefix: string): string {
	const d = new Date();
	const yy = String(d.getFullYear()).slice(-2);
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	const rnd = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
	return `${prefix}-${yy}${mm}${dd}-${rnd}`;
}

interface ChecklistItemInput {
	label: string;
	is_critical?: boolean;
	status: 'ok' | 'tidak' | 'na' | null;
	catatan?: string;
}

async function resolveTemplateRef(equipmentId: string): Promise<string> {
	try {
		const eq = await directusServerJson<{ data: { category_id: string | null } }>(
			`/items/equipment/${equipmentId}?fields=category_id`
		);
		return eq?.data?.category_id ? `p2h:${eq.data.category_id}` : 'generik';
	} catch {
		return 'generik';
	}
}

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => null);
	const loanId = body?.loan_id ? String(body.loan_id) : '';
	if (!loanId) throw error(400, 'loan_id wajib diisi.');
	// Fase 3 (port BR-01 -> peminjaman_internal, 15 Sep 2026).
	const source: 'internal_loan_log' | 'peminjaman_internal' =
		body?.source === 'peminjaman_internal' ? 'peminjaman_internal' : 'internal_loan_log';

	const { karyawan, loan } = await authenticateLoanOwner(event, loanId, source);

	const jenis = body?.jenis;
	if (!['serah_terima', 'harian', 'kembali'].includes(jenis)) throw error(400, 'jenis tidak valid.');
	if (source === 'peminjaman_internal' && jenis !== 'harian') {
		// serah_terima & kembali untuk peminjaman_internal dibuat OTOMATIS oleh erp-epi-1
		// (deliverPeminjaman/returnPeminjaman) — lapangan hanya mengisi checklist harian di sini.
		throw error(400, 'Untuk jalur Peminjaman Internal, hanya checklist harian yang diisi dari sini.');
	}
	const items: ChecklistItemInput[] = Array.isArray(body?.items) ? body.items : [];
	if (!items.length) throw error(400, 'items tidak boleh kosong.');
	const foto: string[] = Array.isArray(body?.foto) ? body.foto : [];
	const gpsLat = typeof body?.gps_lat === 'number' ? body.gps_lat : null;
	const gpsLng = typeof body?.gps_lng === 'number' ? body.gps_lng : null;
	const signature = body?.signature ? String(body.signature).trim() : '';
	const pelaporName = body?.pelaporName ? String(body.pelaporName) : karyawan.nama_karyawan;
	if (!signature) throw error(400, 'signature wajib diisi.');

	const loanFkField = source === 'peminjaman_internal' ? 'peminjaman_internal_id' : 'loan_id';
	if (jenis === 'harian') {
		const dupQuery = new URLSearchParams({
			[`filter[${loanFkField}][_eq]`]: loanId,
			'filter[jenis][_eq]': 'harian',
			'filter[tanggal][_eq]': todayWib(),
			limit: '1'
		});
		const dup = await directusServerJson<{ data: any[] }>(`/items/equipment_loan_checklist?${dupQuery.toString()}`);
		if (dup?.data?.length) throw error(409, 'Checklist harian untuk hari ini sudah tercatat.');
	}

	const hasFinding = items.some((i) => i.status === 'tidak');
	const skor = items.length ? Math.round((items.filter((i) => i.status === 'ok').length / items.length) * 100) : null;
	const status = hasFinding ? 'temuan' : 'lulus';
	const templateRef = jenis === 'harian' || !loan.kondisi_awal_id ? await resolveTemplateRef(loan.equipment_id) : 'manual';

	const checklistRes = await directusServerJson<{ data: any }>('/items/equipment_loan_checklist', {
		method: 'POST',
		body: JSON.stringify({
			loan_id: source === 'peminjaman_internal' ? null : loan.id,
			peminjaman_internal_id: source === 'peminjaman_internal' ? loan.id : null,
			source_collection: source,
			equipment_id: loan.equipment_id,
			project_id: loan.project_id,
			pic_id: loan.pic_id,
			jenis,
			tanggal: todayWib(),
			template_ref: templateRef,
			items,
			foto,
			skor,
			status,
			gps_lat: gpsLat,
			gps_lng: gpsLng,
			signature
		})
	});
	const checklist = checklistRes.data;

	try {
		if (jenis === 'serah_terima') {
			const bastRes = await directusServerJson<{ data: any }>('/items/handover_document', {
				method: 'POST',
				body: JSON.stringify({
					bast_number: generateBastNumber('BAST-OUT'),
					bast_type: BAST_TYPE.PEMINJAMAN_ALAT,
					equipment_id: loan.equipment_id,
					party_1_id: loan.approved_by_id,
					party_2_id: loan.borrower_id,
					related_internal_loan_id: loan.id,
					date: todayWib()
				})
			});
			await directusServerJson(`/items/internal_loan_log/${loan.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ status: LOAN_STATUS.AKTIF, bast_out_id: bastRes.data.id, kondisi_awal_id: checklist.id })
			});
		} else if (jenis === 'kembali') {
			const bastRes = await directusServerJson<{ data: any }>('/items/handover_document', {
				method: 'POST',
				body: JSON.stringify({
					bast_number: generateBastNumber('BAST-IN'),
					bast_type: BAST_TYPE.PENGEMBALIAN_ALAT,
					equipment_id: loan.equipment_id,
					party_1_id: loan.borrower_id,
					party_2_id: loan.approved_by_id,
					related_internal_loan_id: loan.id,
					date: todayWib()
				})
			});
			await directusServerJson(`/items/internal_loan_log/${loan.id}`, {
				method: 'PATCH',
				body: JSON.stringify({
					status: LOAN_STATUS.DIKEMBALIKAN,
					bast_in_id: bastRes.data.id,
					kondisi_akhir_id: checklist.id,
					end_date_actual: todayWib()
				})
			});
		}

		let ticketCreated = false;
		if (hasFinding) {
			const findings = items
				.filter((i) => i.status === 'tidak')
				.map((i) => `- ${i.label}${i.catatan ? `: ${i.catatan}` : ''}`)
				.join('\n');
			await directusServerJson('/items/maint_tickets', {
				method: 'POST',
				body: JSON.stringify({
					nomor_tiket: `TKT-LOAN-${Date.now()}`,
					equipment_id: loan.equipment_id,
					asset_type: 'equipment',
					masalah: `Temuan checklist peminjaman (${jenis}${source === 'peminjaman_internal' ? `, peminjaman_internal #${loan.id}` : ''}):\n${findings}`,
					pelapor: pelaporName,
					departemen_pelapor: 'Peminjam Equipment',
					prioritas: 'medium',
					status: 'need_survey',
					tanggal_lapor: todayWib(),
					// loan_id (maint_tickets) FK terkunci ke internal_loan_log — jangan diisi untuk
					// sumber peminjaman_internal (checklist_id sudah cukup untuk traceability).
					loan_id: source === 'peminjaman_internal' ? null : loan.id,
					checklist_id: checklist.id,
					sumber: 'peminjam'
				})
			});
			ticketCreated = true;
		}

		await notifyProjectLoanChecklistSubmitted(checklist.id, karyawan.id);

		return json({ checklist, ticketCreated });
	} catch (err) {
		await directusServerJson(`/items/equipment_loan_checklist/${checklist.id}`, { method: 'DELETE' }).catch(() => {});
		throw error(500, err instanceof Error ? err.message : 'Gagal menyimpan checklist peminjaman.');
	}
};
