// src/routes/api/kiosk/supervisor-call/+server.ts
// Fase 2D rencana "Pertajam Modul Kiosk Produksi v2" (12 Sep 2026) — tombol "Panggil
// Supervisor" di kiosk/+layout.svelte. Resolusi penerima DINAMIS (Keputusan K2, 12 Sep 2026):
//
//   1. shift_roster hari ini (WIB) -> karyawan_id yang sedang bertugas (status 'aktif').
//   2. Saring ke karyawan berperan supervisor produksi: divisi mengandung "produksi" DAN
//      jabatan_id.grade = 'Supervisor'. Dua query TERPISAH (Aturan #2 CLAUDE.md — jangan
//      relasi bersarang), lalu diirisankan di sini, bukan lewat `fields=` nested expansion.
//   3. Bila irisan kosong (roster belum digenerate, hari libur, atau tidak ada yang cocok) ->
//      fallback ke system_settings kiosk.supervisor_fallback_karyawan_ids (Aturan #4 —
//      validasi/penentuan penerima wajib fallback, panggilan darurat tidak boleh hilang).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { notifyKioskAndon } from '$lib/server/kioskAndonNotify';
import { resolveSupervisorPenerima } from '$lib/server/kioskSupervisor';

async function readJsonSetting<T>(key: string, fallback: T): Promise<T> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=${encodeURIComponent(key)}&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw === undefined || raw === null || raw === '') return fallback;
		try {
			return JSON.parse(raw) as T;
		} catch {
			return fallback;
		}
	} catch {
		return fallback;
	}
}

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const body = await event.request.json().catch(() => ({}));
	const alasan = body?.alasan ? String(body.alasan).trim().slice(0, 200) : null;

	// Fallback (K2 / Aturan #4) — roster kosong, belum digenerate, atau tidak ada supervisor
	// produksi yang cocok bertugas hari ini. Panggilan darurat tidak boleh senyap.
	const { waKaryawanIds, usedFallback } = await resolveSupervisorPenerima();

	if (waKaryawanIds.length === 0) {
		// File 10 §2.4 item 3 — penolakan terakhir tetap ada (Aturan #6: jangan mematikan
		// jalur tanpa alternatif), tapi sekarang menyertakan kontak darurat kalau admin sudah
		// mengisinya, supaya operator selalu punya cara menghubungi orang sungguhan.
		const kontakDarurat = await readJsonSetting<string>('kiosk.supervisor_kontak_darurat', '');
		const saran = kontakDarurat?.trim()
			? ` Hubungi ${kontakDarurat.trim()}.`
			: ' Hubungi supervisor secara langsung.';
		throw error(
			422,
			`Tidak ada penerima yang bisa dihubungi. Supervisor bertugas hari ini belum terdaftar dan fallback belum diisi admin.${saran}`
		);
	}

	const message = alasan
		? `${session.nama} memanggil supervisor dari Kiosk Produksi — ${alasan}`
		: `${session.nama} memanggil supervisor dari Kiosk Produksi.`;

	const sent = await notifyKioskAndon({
		eventType: 'kiosk_supervisor_call',
		message,
		waKaryawanIds,
		karyawanId: session.karyawanId,
		sourceId: session.karyawanId
	});

	if (!sent) {
		throw error(502, 'Gagal mengirim panggilan ke server notifikasi. Coba lagi atau hubungi supervisor langsung.');
	}

	return json({ success: true, usedFallback, penerimaCount: waKaryawanIds.length });
};
