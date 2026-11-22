// src/lib/server/ess/budayaHarian.ts
// Konten Propaganda Budaya harian untuk aplikasi lapangan: banner /ess, TBM Roll Call, Kiosk Produksi.
// Aturan murni di ./cultureModel.ts (salinan setia erp-epi). Konten & setelan di-cache 60 dtk; kuis dinilai di SERVER;
// identitas karyawan dari login. Gagal baca = fail-soft tapi SELALU dilog (CLAUDE.md #1). Fetch dipisah per koleksi (#2).

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import {
	PROPAGANDA_FIELDS, CULTURE_MODULE, resolveCultureSettings, pickToday, toClientItem, gradeAck, shouldWriteAck,
	ACK_DONE, type ClientItem, type CultureSettingValue
} from './cultureModel';

const TTL_MS = 60_000;
let settingsCache: { at: number; value: Record<string, CultureSettingValue> } | null = null;
let itemsCache: { at: number; value: any[] } | null = null;
let posterCache: { at: number; value: Record<string, string> } | null = null;

export async function loadCultureSettings(): Promise<Record<string, CultureSettingValue>> {
	if (settingsCache && Date.now() - settingsCache.at < TTL_MS) return settingsCache.value;
	let rows: any[] = [];
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/app_settings?filter[module][_eq]=${CULTURE_MODULE}&fields=setting_key,setting_value&limit=-1`
		);
		rows = res?.data || [];
	} catch (e) {
		console.error('[budayaHarian] gagal baca setelan culture, memakai default:', (e as Error)?.message);
	}
	const value = resolveCultureSettings(rows);
	settingsCache = { at: Date.now(), value };
	return value;
}

export async function loadPropagandaAktif(): Promise<any[]> {
	if (itemsCache && Date.now() - itemsCache.at < TTL_MS) return itemsCache.value;
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/culture_propaganda?filter[aktif][_eq]=true&fields=${PROPAGANDA_FIELDS.join(',')}&limit=-1`
		);
		const value = res?.data || [];
		itemsCache = { at: Date.now(), value };
		return value;
	} catch (e) {
		// Tidak di-cache: begitu skema fase 2 diterapkan, banner langsung pulih.
		console.error('[budayaHarian] gagal baca culture_propaganda (skema fase 2 belum diterapkan?):', (e as Error)?.message);
		return [];
	}
}

/** Peta id konten → id berkas poster (Fase 5). TERPISAH dari daftar utama & fail-soft: kolom belum ada → {}. */
export async function loadPosterMap(): Promise<Record<string, string>> {
	if (posterCache && Date.now() - posterCache.at < TTL_MS) return posterCache.value;
	const value: Record<string, string> = {};
	try {
		const res = await directusServerJson<{ data: any[] }>('/items/culture_propaganda?filter[aktif][_eq]=true&fields=id,lampiran_gambar&limit=-1');
		for (const r of res?.data || []) if (r?.lampiran_gambar) value[String(r.id)] = typeof r.lampiran_gambar === 'object' ? r.lampiran_gambar.id : r.lampiran_gambar;
	} catch (e) {
		console.warn('[budayaHarian] poster tidak dibaca (skema fase 5 belum diterapkan?):', (e as Error)?.message);
	}
	posterCache = { at: Date.now(), value };
	return value;
}

async function loadMyAck(propagandaId: number, karyawanId: number): Promise<{ id: number; status_aksi: string } | null> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/culture_propaganda_ack?filter[propaganda_id][_eq]=${propagandaId}&filter[karyawan_id][_eq]=${karyawanId}&fields=id,status_aksi&limit=1`
		);
		return res?.data?.[0] || null;
	} catch (e) {
		console.error('[budayaHarian] gagal baca ack karyawan:', (e as Error)?.message);
		return null;
	}
}

export interface BudayaHarianState {
	enabled: boolean;
	/** Pesan siap pakai untuk dibacakan di TBM (setelan culture.tbm_injection_enabled). */
	tbm_enabled: boolean;
	item: ClientItem | null;
	ack: { status: string; selesai: boolean } | null;
}

export async function getBudayaHarian(karyawan: { id: number; divisi?: string | null }): Promise<BudayaHarianState> {
	const settings = await loadCultureSettings();
	const base = { enabled: !!settings['culture.banner_enabled'], tbm_enabled: !!settings['culture.tbm_injection_enabled'] };
	if (!base.enabled && !base.tbm_enabled) return { ...base, item: null, ack: null };
	const items = await loadPropagandaAktif();
	const item = pickToday(items, todayJakarta(), { audience: 'lapangan', divisi: karyawan?.divisi || '' });
	if (!item) return { ...base, item: null, ack: null };
	const ack = karyawan?.id != null ? await loadMyAck(item.id, karyawan.id) : null;
	const posters = await loadPosterMap();
	return { ...base, item: toClientItem({ ...item, poster_id: posters[String(item.id)] ?? null }), ack: ack ? { status: ack.status_aksi, selesai: ACK_DONE.has(ack.status_aksi) } : null };
}

export class BudayaAckError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export async function submitBudayaAck(
	karyawan: { id: number; divisi?: string | null },
	input: { propagandaId: unknown; aksi: string; jawabanIdx?: unknown }
): Promise<{ status: string; benar: boolean; selesai: boolean }> {
	if (karyawan?.id == null) throw new BudayaAckError('Karyawan tidak dikenali.', 400);
	const items = await loadPropagandaAktif();
	const today = todayJakarta();
	const item = pickToday(items, today, { audience: 'lapangan', divisi: karyawan.divisi || '' });
	if (!item || String(item.id) !== String(input.propagandaId)) {
		throw new BudayaAckError('Konten hari ini sudah berganti. Muat ulang halaman.', 409);
	}
	const status = gradeAck(item, input.aksi, input.jawabanIdx);
	if (!status) throw new BudayaAckError('Aksi tidak valid untuk konten ini.', 400);
	const existing = await loadMyAck(item.id, karyawan.id);
	const tulis = shouldWriteAck(existing?.status_aksi, status);
	if (tulis) {
		if (existing?.id != null) {
			await directusServerJson(`/items/culture_propaganda_ack/${existing.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ status_aksi: status, tanggal: today })
			});
		} else {
			await directusServerJson('/items/culture_propaganda_ack', {
				method: 'POST',
				body: JSON.stringify({ propaganda_id: item.id, karyawan_id: karyawan.id, tanggal: today, status_aksi: status })
			});
		}
	}
	const finalStatus = existing && !tulis ? existing.status_aksi : status;
	return { status: finalStatus, benar: finalStatus === 'kuis_benar', selesai: ACK_DONE.has(finalStatus) };
}

/** Konten untuk layar Kiosk (tanpa data karyawan). null bila setelan mati / tak ada konten. */
export async function getKioskBanner(): Promise<{ judul: string; isi_pesan: string } | null> {
	const settings = await loadCultureSettings();
	if (!settings['culture.kiosk_banner_enabled']) return null;
	const item = pickToday(await loadPropagandaAktif(), todayJakarta(), { audience: 'kiosk' });
	return item ? { judul: String(item.judul ?? ''), isi_pesan: String(item.isi_pesan ?? '') } : null;
}

/** Konteks untuk gate G_TBM_CULTURE_BRIEF: apakah ada pesan budaya hari ini untuk lapangan & injeksi TBM aktif? Gagal baca → tanpa item (gate tidak berlaku). */
export async function getTbmCultureContext(): Promise<{ hasItem: boolean; judul: string | null }> {
	try {
		const settings = await loadCultureSettings();
		if (!settings['culture.tbm_injection_enabled']) return { hasItem: false, judul: null };
		const item = pickToday(await loadPropagandaAktif(), todayJakarta(), { audience: 'lapangan' });
		return { hasItem: !!item, judul: item ? String(item.judul ?? '') : null };
	} catch (e) {
		console.error('[budayaHarian] gagal menyusun konteks gate TBM (gate dilewati):', (e as Error)?.message);
		return { hasItem: false, judul: null };
	}
}
