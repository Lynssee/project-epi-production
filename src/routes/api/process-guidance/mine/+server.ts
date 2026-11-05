// src/routes/api/process-guidance/mine/+server.ts
// GET: "Tugas Saya di Alur" — langkah alur yang PIC-nya cocok pasti dengan jabatan pengguna yang login. Wajib login (authenticateEss).
//   Sukses  -> { success, source:'directus', posisi:{id,nama,via}|null, reason?, tasks:[MyTask], contacts, flows_total }
//   Gagal   -> { success:true, source:'fallback', posisi:null, tasks:[] , warning } (UI menyembunyikan kartu; tidak ada galat layar)
// `contacts` ("Kontak Approver"): jabatan penerima serah-terima berikutnya (task.handoff_to) → pemegang aktif (nama + WhatsApp, maks. 4/jabatan).
// HANYA jabatan yang menerima serah-terima dari tugas pengguna — bukan direktori karyawan. FAIL-SOFT: bila karyawan gagal dimuat, tugas tetap
// tampil tanpa kontak (`contacts_error`), tidak ada galat layar.
// Semua dihitung di server dari data yang sudah ber-cache (alur 5 menit, master jabatan 5 menit, karyawan 5 menit).
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';
import { loadPicIndex, loadKaryawanForContacts, resolveMyPosisi } from '$lib/server/processPicContext';
import { extractMyTasks } from '$lib/utils/processMyTasks';
import { attachHandoff, buildRoleContacts, type RoleContacts } from '$lib/utils/processHandoffContacts';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	try {
		const [flows, index] = await Promise.all([loadPublishedFlowsForField(), loadPicIndex()]);
		const posisi = resolveMyPosisi(karyawan, index);
		if (!posisi) {
			return json({
				success: true,
				source: 'directus',
				posisi: null,
				reason: 'Jabatan Anda belum terhubung ke master jabatan. Minta HRD mengisi jabatan di data karyawan Anda.',
				tasks: [],
				flows_total: flows.length
			});
		}
		const base = extractMyTasks(flows, index, posisi.id);
		const { tasks, posisiIds } = attachHandoff(base, flows, index, posisi.id);

		let contacts: Record<number, RoleContacts> = {};
		let contacts_error: string | undefined;
		if (posisiIds.length) {
			try {
				const rows = await loadKaryawanForContacts();
				contacts = buildRoleContacts(rows, (k) => resolveMyPosisi(k, index)?.id ?? null, posisiIds, index, Number(karyawan?.id));
			} catch (e) {
				console.warn('[process-guidance/mine] kontak gagal dimuat (non-fatal):', e instanceof Error ? e.message : e);
				contacts_error = 'Kontak approver gagal dimuat.';
			}
		}
		return json({ success: true, source: 'directus', posisi, tasks, contacts, ...(contacts_error ? { contacts_error } : {}), flows_total: flows.length });
	} catch (e) {
		console.warn('[process-guidance/mine] gagal:', e instanceof Error ? e.message : e);
		return json({ success: true, source: 'fallback', posisi: null, tasks: [], warning: 'Tugas Saya gagal dimuat dari server.' });
	}
};
