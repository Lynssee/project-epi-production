// src/routes/api/lacak-sj/tunggakan/+server.ts
// Penajaman Gate SJ Fase 3: "Tunggakan Fisik Saya" untuk widget dashboard, banner form SJ lapangan, dan QR Handover.
// Informatif saja (tidak menegakkan). Aturan dari system_settings inventory.sj.* (sama dengan gate G_SJ_TUNGGAKAN_FISIK
// di erp-epi); logika hitung di $lib/shared/sjTunggakanFisik.ts, pemuat di $lib/server/sjTunggakanServer.ts.
// ?semua=1 -> semua berkas tertahan tanpa masa tenggang (dipakai Handover QR).
// Gagal baca = respons aman enabled:false + log (jangan memutus dashboard).

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { loadTunggakanKaryawan, loadTunggakanRulesServer } from '$lib/server/sjTunggakanServer';

const OFF = { enabled: false, count: 0, quota: 0, graceDays: 0, over: false, rows: [] as unknown[] };

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	try {
		const karyawan = (await getKaryawanByFirebaseUid(user.localId).catch(() => null)) || (await resolveKaryawanByEmail(user.email).catch(() => null));
		if (!karyawan?.id) return json(OFF);

		const semua = event.url.searchParams.get('semua') === '1';
		const rules = await loadTunggakanRulesServer(semua);
		const result = await loadTunggakanKaryawan(karyawan.id, rules);
		return json({
			enabled: true,
			count: result.count,
			quota: rules.maxOutstanding,
			graceDays: rules.graceDays,
			over: result.count > rules.maxOutstanding,
			karyawanId: karyawan.id,
			rows: result.rows.slice(0, semua ? 40 : 10)
		});
	} catch (e) {
		console.error('[api/lacak-sj/tunggakan] gagal:', e instanceof Error ? e.message : e);
		return json(OFF);
	}
};
