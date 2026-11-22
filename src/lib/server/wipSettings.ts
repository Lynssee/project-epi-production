// src/lib/server/wipSettings.ts
// SERVER-ONLY. Pembaca kebijakan WIP (FIN-15) dari system_settings. Gagal baca → kebijakan MATI (perilaku lama).
import { directusServerJson } from './directus';
import { KUNCI_SETELAN_WIP, susunKebijakanWip, AKUN_WIP_DEFAULT, AKUN_BIAYA_WIP_DEFAULT, type KebijakanWip } from '$lib/shared/wipPolicy';

export async function muatKebijakanWipServer(tanggal: string): Promise<KebijakanWip> {
	try {
		const res = await directusServerJson<{ data: Array<{ setting_key: string; setting_value: unknown }> }>(
			`/items/system_settings?filter[setting_key][_in]=${KUNCI_SETELAN_WIP.join(',')}&fields=setting_key,setting_value&limit=10`
		);
		return susunKebijakanWip(tanggal, res?.data || []);
	} catch (e: any) {
		console.warn('[wipSettings] setelan WIP gagal dibaca — kebijakan dianggap mati:', e?.message || e);
		return { aktif: false, akun: AKUN_WIP_DEFAULT, akunBiaya: AKUN_BIAYA_WIP_DEFAULT };
	}
}
