// src/routes/api/kiosk/lapor-mesin/+server.ts
// GET: daftar equipment untuk dropdown. POST: buat maint_tickets baru dari kiosk.
// Fase 2, rencana Optimasi Inventory & Produksi + Deposit HP + Kiosk Produksi v2 (24 Agu 2026).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { notifyMaintenanceTicketSubmitted } from '$lib/server/maintenanceNotify';
import { todayWib } from '$lib/utils/wibDate';

const PRIORITAS_LABEL: Record<string, string> = { low: 'Rendah', medium: 'Sedang', high: 'Tinggi', critical: 'KRITIS' };

/** Baca setelan JSON dari system_settings, pola sama modul kiosk lain. */
async function readSetting<T>(key: string, fallback: T): Promise<T> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=${encodeURIComponent(key)}&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw === undefined || raw === null || raw === '') return fallback;
		try {
			return JSON.parse(raw) as T;
		} catch {
			return raw as T;
		}
	} catch {
		return fallback;
	}
}

// File 12 §D — TKT-yymm-<4 digit acak> punya peluang bentrok naik cepat (~50% setelah ±110
// tiket/bulan, birthday problem). nomor_tiket tidak unique di skema, jadi duplikat tersimpan
// diam-diam. Nomor berurutan per bulan: ambil nomor terakhir dengan prefix ini, +1, retry
// kalau ada yang menang duluan (jarang, tapi dua submit nyaris bersamaan tetap mungkin).
async function nextNomorTiket(): Promise<string> {
	const now = new Date();
	const yy = String(now.getFullYear()).slice(-2);
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const prefix = `TKT-${yy}${mm}-`;
	const res = await directusServerJson<{ data: any[] }>(
		`/items/maint_tickets?filter[nomor_tiket][_starts_with]=${encodeURIComponent(prefix)}` +
			`&fields=nomor_tiket&sort=-nomor_tiket&limit=1`
	).catch(() => ({ data: [] }));
	const last = res?.data?.[0]?.nomor_tiket as string | undefined;
	const lastSeq = last ? Number(last.slice(prefix.length)) || 0 : 0;
	return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	// File 12 §D item 2 — dulu mengambil SEMUA equipment (semua kategori); Input Produksi
	// memfilter parent_category=PRODUKSI, Lapor Mesin tidak, operator harus menggulir daftar
	// panjang. Setelan kiosk.lapor_mesin_kategori (default ["PRODUKSI"]) + "Mesin lain..." di
	// klien tetap bisa menampilkan semua lewat query ?semua=1.
	const semua = event.url.searchParams.get('semua') === '1';
	const kategori = semua ? null : await readSetting<string[]>('kiosk.lapor_mesin_kategori', ['PRODUKSI']);
	const filter = kategori && kategori.length ? `&filter[parent_category][_in]=${kategori.join(',')}` : '';
	const res = await directusServerJson<{ data: any[] }>(
		`/items/equipment?fields=id,code,name,parent_category&sort=name&limit=-1${filter}`
	).catch(() => ({ data: [] }));
	return json({ equipment: res?.data || [] });
};

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const body = await event.request.json().catch(() => null);
	const equipmentId = body?.equipmentId;
	const masalah = body?.masalah ? String(body.masalah).trim() : '';
	const prioritas = ['low', 'medium', 'high', 'critical'].includes(body?.prioritas) ? body.prioritas : 'medium';
	const clientTxnId = body?.clientTxnId ? String(body.clientTxnId).trim().slice(0, 100) : '';

	if (!equipmentId) throw error(400, 'Pilih mesin/equipment dulu.');
	if (!masalah) throw error(400, 'Jelaskan masalahnya dulu.');
	if (!clientTxnId) throw error(400, 'clientTxnId wajib diisi.');

	// Idempotensi — client_txn_id UNIQUE. Retry/double-tap dari kiosk mengembalikan tiket yang sama.
	const existing = await directusServerJson<{ data: any[] }>(
		`/items/maint_tickets?filter[client_txn_id][_eq]=${encodeURIComponent(clientTxnId)}&limit=1`
	).catch(() => ({ data: [] }));
	if (existing?.data?.[0]) {
		return json({ success: true, data: { data: existing.data[0] }, already_done: true });
	}

	// ⚠️ nomor_tiket TIDAK unique di skema (diverifikasi) — Directus tidak akan menolak insert
	// walau nomornya sama persis. Nomor berurutan (bukan lagi 4 digit acak) menurunkan peluang
	// tabrakan drastis, tapi TIDAK menghilangkannya sepenuhnya tanpa constraint unique di DB.
	// Menambah constraint itu butuh dicek dulu terhadap generator admin maintenance (format
	// mungkin beda) supaya tidak mendadak menolak insert yang sah — di luar scope perbaikan ini.
	const nomorTiket = await nextNomorTiket();
	let saved: any;
	try {
		saved = await directusServerJson('/items/maint_tickets', {
			method: 'POST',
			body: JSON.stringify({
				nomor_tiket: nomorTiket,
				equipment_id: equipmentId,
				masalah,
				pelapor: session.nama,
				pelapor_id: session.karyawanId,
				departemen_pelapor: 'Produksi (Kiosk)',
				prioritas,
				status: 'open',
				// File 12 §E — UTC bikin input shift malam (00:00-06:59 WIB) tercatat tanggal
				// kemarin. waktu_lapor TETAP ISO UTC (timestamp asli, itu sudah benar).
				tanggal_lapor: todayWib(),
				waktu_lapor: new Date().toISOString(),
				sumber: 'internal',
				client_txn_id: clientTxnId
			})
		});
	} catch (e: any) {
		throw error(500, e?.message || 'Gagal menyimpan laporan mesin.');
	}

	// Fase 4 (rencana Optimasi Inventory & Produksi v2, 24 Agu 2026): eskalasi WA untuk tiket
	// dari kiosk -- prioritas critical dapat penanda tegas, selebihnya notifikasi normal seperti
	// sumber lapangan lain. Fire-and-forget -- kegagalan kirim WA TIDAK BOLEH menggagalkan tiket.
	const label = PRIORITAS_LABEL[prioritas] || prioritas;
	const message = `Tiket ${nomorTiket} (${label}) dari Kiosk Produksi — ${session.nama}: ${masalah}`;
	notifyMaintenanceTicketSubmitted(saved?.data?.id ?? nomorTiket, message).catch(() => {});

	return json({ success: true, data: saved });
};
