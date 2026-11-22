// src/lib/server/ess/troubleshootCards.ts
// Kartu Troubleshoot Quick Reference untuk Buku Saku. Sumber: app_settings (module 'training', key 'troubleshoot_cards'),
// diatur di erp-epi → HRD → Pelatihan → Pengaturan. HANYA kartu aktif yang dikirim ke lapangan.
import { directusServerJson } from '$lib/server/directus';

export interface TroubleshootCard {
	id: string;
	judul: string;
	alat: string;
	gejala: string;
	keselamatan: string;
	langkah: string[];
	programId: number | null;
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export function sanitizeCards(raw: unknown): TroubleshootCard[] {
	let v: any = raw;
	if (typeof v === 'string') {
		try { v = JSON.parse(v); } catch { return []; }
	}
	if (!Array.isArray(v)) return [];
	return v
		.filter((c) => c && c.aktif === true && str(c.judul, 120) && Array.isArray(c.langkah) && c.langkah.length)
		.map((c, i) => ({
			id: str(c.id, 40) || `ts${i + 1}`,
			judul: str(c.judul, 120),
			alat: str(c.alat, 60) || 'Umum',
			gejala: str(c.gejala, 400),
			keselamatan: str(c.keselamatan, 400),
			langkah: c.langkah.map((x: unknown) => str(x, 300)).filter(Boolean).slice(0, 20),
			programId: Number.isInteger(Number(c.program_id)) && Number(c.program_id) > 0 ? Number(c.program_id) : null
		}));
}

export async function loadTroubleshootCards(): Promise<TroubleshootCard[]> {
	const res = await directusServerJson<{ data: { setting_value: unknown }[] }>(
		`/items/app_settings?filter[module][_eq]=training&filter[setting_key][_eq]=troubleshoot_cards&fields=setting_value&limit=1`
	);
	return sanitizeCards(res?.data?.[0]?.setting_value);
}
