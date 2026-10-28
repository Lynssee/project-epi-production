// src/lib/server/sjTunggakanServer.ts
// SERVER-ONLY. Pemuat tunggakan berkas fisik SJ milik satu karyawan (padanan erp-epi sjTunggakanLoader.js) +
// pembaca mode gate G_SJ_TUNGGAKAN_FISIK (baris gate_enforcement jenis 'SJ', dikelola dari ERP). Dipakai endpoint
// "tunggakan saya" dan penegakan saat pembuatan SJ Manual dari lapangan.
import { directusServerJson } from './directus';
import { getInventorySettingServer } from './inventorySettings';
import {
	computeTunggakanFisik, normalizeTunggakanRules, TUNGGAKAN_DEFAULTS, TUNGGAKAN_RECEIVED_STAGES,
	type TunggakanLembar, type TunggakanRules, type TunggakanSj
} from '$lib/shared/sjTunggakanFisik';

export const SJ_TUNGGAKAN_GATE_KEY = 'G_SJ_TUNGGAKAN_FISIK';

/** Aturan dari system_settings inventory.sj.* (widget pribadi selalu per karyawan). */
export async function loadTunggakanRulesServer(semua = false): Promise<TunggakanRules> {
	const d = TUNGGAKAN_DEFAULTS;
	const [maxOutstanding, graceDays, requireFullTtd, requireAdminReceipt, enforceFrom, lookbackDays] = await Promise.all([
		getInventorySettingServer<number>('inventory.sj.max_outstanding_physical', d.maxOutstanding),
		getInventorySettingServer<number>('inventory.sj.physical_grace_days', d.graceDays),
		getInventorySettingServer<boolean>('inventory.sj.require_full_ttd', d.requireFullTtd),
		getInventorySettingServer<boolean>('inventory.sj.require_admin_receipt', d.requireAdminReceipt),
		getInventorySettingServer<string>('inventory.sj.tunggakan_enforce_from', d.enforceFrom),
		getInventorySettingServer<number>('inventory.sj.tunggakan_lookback_hari', d.lookbackDays)
	]);
	// semua=true (Handover QR): semua berkas yang masih tertahan, tanpa masa tenggang & tanpa batas enforce_from.
	return normalizeTunggakanRules({
		maxOutstanding, graceDays: semua ? 0 : graceDays, requireFullTtd, requireAdminReceipt,
		enforceFrom: semua ? '' : enforceFrom, lookbackDays, scope: 'karyawan_pengaju'
	});
}

/** SATU query SJ + SATU query rangkap (tanpa N+1). Pengaju = dibuat_oleh_karyawan_id ATAU requested_by. */
export async function loadTunggakanKaryawan(karyawanId: number | string, rules: TunggakanRules) {
	const since = new Date(Date.now() - rules.lookbackDays * 86400000).toISOString();
	const filter = encodeURIComponent(JSON.stringify({
		_and: [
			{ _or: [{ dibuat_oleh_karyawan_id: { _eq: karyawanId } }, { requested_by: { _eq: karyawanId } }] },
			{ _or: [{ received_at: { _gte: since } }, { track_stage_at: { _gte: since }, track_stage: { _in: [...TUNGGAKAN_RECEIVED_STAGES] } }] }
		]
	}));
	const listRes = await directusServerJson<{ data: TunggakanSj[] }>(
		`/items/surat_jalan?filter=${filter}&fields=id,nomor_sj,track_stage,track_stage_at,received_at,scan_sj_file&limit=500`
	);
	const sjList = listRes?.data || [];
	const rangkapBySj = new Map<string, TunggakanLembar[]>();
	if (rules.requireAdminReceipt && sjList.length) {
		const rRes = await directusServerJson<{ data: Array<TunggakanLembar & { surat_jalan_id: number | { id: number } }> }>(
			`/items/sj_dokumen_rangkap?filter[surat_jalan_id][_in]=${sjList.map((r) => encodeURIComponent(String(r.id))).join(',')}` +
			`&filter[wajib_kembali][_eq]=true&fields=surat_jalan_id,lembar_kode,lembar_nama,status,wajib_kembali&limit=-1`
		);
		for (const l of rRes?.data || []) {
			const key = String(typeof l.surat_jalan_id === 'object' ? l.surat_jalan_id?.id : l.surat_jalan_id);
			if (!rangkapBySj.has(key)) rangkapBySj.set(key, []);
			rangkapBySj.get(key)!.push(l);
		}
	}
	return computeTunggakanFisik(sjList, rangkapBySj, rules);
}

/** Mode gate (gate_enforcement jenis 'SJ'). Default 'shadow'; 'hard' sebelum enforce_from dipaksa 'soft' (anti-lockdown). */
export async function getSjTunggakanMode(): Promise<'shadow' | 'soft' | 'hard'> {
	try {
		const res = await directusServerJson<{ data: Array<{ mode: 'shadow' | 'soft' | 'hard'; enforce_from: string | null; is_active: number | boolean }> }>(
			`/items/gate_enforcement?filter[gate_key][_eq]=${SJ_TUNGGAKAN_GATE_KEY}&filter[jenis_pengajuan][_eq]=SJ&fields=mode,enforce_from,is_active&limit=1`
		);
		const row = res?.data?.[0];
		if (!row || !row.is_active) return 'shadow';
		if (row.mode === 'hard' && row.enforce_from && new Date().toISOString().slice(0, 10) < row.enforce_from.slice(0, 10)) return 'soft';
		return row.mode;
	} catch (e) {
		console.error('[sjTunggakanServer] gagal baca mode gate (anggap shadow):', e instanceof Error ? e.message : e);
		return 'shadow';
	}
}

/**
 * Penegakan saat pembuatan SJ dari lapangan: hanya mode 'hard' yang memblokir (soft/shadow = banner saja).
 * Fail-open bila data gagal dibaca (SJ tetap boleh dibuat; error dicatat).
 * @returns pesan blokir, atau null bila boleh lanjut.
 */
export async function checkCreateBlockedByTunggakan(karyawanId: number | string): Promise<string | null> {
	try {
		if ((await getSjTunggakanMode()) !== 'hard') return null;
		const rules = await loadTunggakanRulesServer();
		const result = await loadTunggakanKaryawan(karyawanId, rules);
		if (result.count <= rules.maxOutstanding) return null;
		return (
			`${result.count} Surat Jalan Anda belum diserahkan berkas fisiknya (batas ${rules.maxOutstanding}). ` +
			`Serahkan berkas lewat menu "Serahkan Berkas ke Admin", atau minta dispensasi ke Kepala Logistik / Super Admin.`
		);
	} catch (e) {
		console.error('[sjTunggakanServer] gagal cek tunggakan saat buat SJ (fail-open):', e instanceof Error ? e.message : e);
		return null;
	}
}
