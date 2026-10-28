// POST: leader merespons penugasan baru (delegation_log):
//   'diterima'   — siap memegang proyek (proyek draft/waiting dipindah ke Persiapan)
//   'kendala'    — jadwal bentrok / kendala lain (catatan wajib)
//   'pendamping' — minta pendamping (catatan wajib)
// Hanya leader_baru_id pada log itu yang boleh merespons (dicek server-side lewat email_company -> karyawan).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { resolveKaryawanByEmail } from '$lib/server/projectLeaderGuard';
import { notifyProjectDelegasiKendala } from '$lib/server/projectNotify';

const STATUS_VALID = ['diterima', 'kendala', 'pendamping'] as const;
type AckStatus = (typeof STATUS_VALID)[number];

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const body = await event.request.json().catch(() => null);
	const delegationLogId = Number(body?.delegationLogId);
	const status = body?.status as AckStatus;
	const catatan = typeof body?.catatan === 'string' ? body.catatan.trim().slice(0, 1000) : '';

	if (!delegationLogId) throw error(400, 'delegationLogId wajib diisi.');
	if (!STATUS_VALID.includes(status)) throw error(400, "status harus 'diterima', 'kendala', atau 'pendamping'.");
	if (status !== 'diterima' && !catatan) throw error(400, 'Catatan wajib diisi.');

	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan.');

	const log = await directusServerJson<{ data: any }>(
		`/items/delegation_log/${delegationLogId}?fields=id,leader_baru_id,leader_baru_nama,project_id,status,ack_status`
	).then((r) => r?.data);
	if (!log) throw error(404, 'Penugasan tidak ditemukan.');
	if (String(log.leader_baru_id) !== String(karyawan.id)) throw error(403, 'Penugasan ini bukan untuk Anda.');
	if (log.status !== 'aktif') throw error(409, 'Penugasan ini sudah tidak aktif.');
	// Boleh berpindah dari kendala/pendamping/teratasi ke diterima, tapi "diterima" tidak ditimpa lagi.
	if (log.ack_status === 'diterima') throw error(409, 'Penugasan ini sudah Anda terima.');

	await directusServerJson(`/items/delegation_log/${delegationLogId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			ack_status: status,
			ack_catatan: status === 'diterima' ? null : catatan,
			acknowledged_at: new Date().toISOString()
		})
	});

	let projectStatus: string | null = null;
	if (status === 'diterima' && log.project_id) {
		// Terima -> proyek masuk tahap Persiapan. Hanya dari draft/waiting; tidak pernah menurunkan status yang sudah berjalan.
		try {
			const proj = await directusServerJson<{ data: any }>(`/items/projects/${log.project_id}?fields=id,status`).then((r) => r?.data);
			const cur = String(proj?.status || '').toLowerCase().trim();
			if (proj && (cur === 'draft' || cur === 'waiting')) {
				await directusServerJson(`/items/projects/${log.project_id}`, { method: 'PATCH', body: JSON.stringify({ status: 'prepare' }) });
				projectStatus = 'prepare';
			}
		} catch (e) {
			console.warn('[delegasi-ack] gagal memindahkan proyek ke Persiapan (penerimaan tetap tersimpan):', e);
		}
	}

	if (status !== 'diterima') {
		// Fire-and-forget + fail-soft: laporan leader sudah tersimpan, notifikasi admin tidak boleh menggagalkannya.
		void (async () => {
			const project = log.project_id
				? await directusServerJson<{ data: any }>(`/items/projects/${log.project_id}?fields=id,name,admin_project_id`)
						.then((r) => r?.data)
						.catch(() => null)
				: null;
			await notifyProjectDelegasiKendala(
				delegationLogId,
				project?.name || `#${log.project_id}`,
				log.leader_baru_nama || karyawan.nama_karyawan,
				catatan,
				status === 'pendamping' ? 'pendamping' : 'kendala',
				project?.admin_project_id ?? null
			);
		})().catch((e) => console.warn('[delegasi-ack] notifikasi gagal:', e));
	}

	return json({ ok: true, status, projectStatus });
};
