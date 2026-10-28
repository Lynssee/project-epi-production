// src/routes/api/kiosk/produksi/+server.ts
// Input Produksi kiosk -> spk_daily_log. Fase 2, rencana Optimasi Inventory & Produksi +
// Deposit HP + Kiosk Produksi v2 (24 Agu 2026).
// Fase 5 (24 Agu 2026): setelah submit, sambungkan ke fulfillAllPendingConsumption() di erp-epi-1
// (JANGAN bangun ulang MRP-nya) + hitung laporan variance (output kumulatif vs target SPK).
//
// Fase 1 rencana "Pertajam Modul Kiosk Produksi v2" (12 Sep 2026) — 4 bug diperbaiki di file ini:
//   Bug 1: collection produk salah (`master_barang` TIDAK ADA di Directus, yang benar `identitas_barang`)
//   Bug 2: kumulatif dihitung dari `limit=20` log -> salah untuk SPK dgn >20 entri; kini pakai agregat DB
//   Bug 3: `tanggal` memakai kalender UTC -> input 00:00-06:59 WIB tercatat mundur 1 hari (shift malam)
//   Bug 4: `client_txn_id` di-generate server -> field unique itu tidak pernah menahan submit ganda
//
// Fase 2 (12 Sep 2026):
//   2A: klasifikasi alasan reject/waste (spk_daily_log.reject_reasons/waste_reasons, nullable —
//       field baru additive, TIDAK diwajibkan retroaktif, lihat Aturan #3).
//   2B: peringatan over-production. Validasi klien bisa dilewati, jadi server juga menghitung
//       ulang & TETAP menyimpan baris (Aturan #6 — jangan mematikan jalur input), hanya menandai
//       + notifikasi supervisor kalau ambang terlampaui.
//
// Fase 3 (12 Sep 2026):
//   3C: toggle "Batch Tuntas" -> spk.status = qc_pending, WAJIB lewat spkStateMachine di
//       erp-epi-1 (relay otomasi, bukan PATCH langsung dari sini — state machine live di sana).
//   3D: jadwal_kerja_id diresolusi server-side dari shift_roster (fallback karyawan.jadwal_kerja_id)
//       — TIDAK hardcode jam shift, roster/jadwal_kerja adalah sumber kebenaran (CLAUDE.md).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { todayWib } from '$lib/utils/wibDate';
import { notifyKioskAndon } from '$lib/server/kioskAndonNotify';
import { resolveSupervisorPenerima } from '$lib/server/kioskSupervisor';

/** Setelan `kiosk.*` yang boleh diubah admin tanpa deploy (system_settings, bukan app_settings —
 *  lihat pemisahan dua sistem settings di CLAUDE.md). Pola sama readSetting() di kiosk/home. */
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

/** 2A — sanitasi array alasan dari klien: hanya string non-kosong, maks 10 item, maks 60 karakter
 *  per item. null bila kosong (bukan array kosong) supaya tidak beda makna dgn "belum diisi". */
function sanitizeReasons(input: unknown): string[] | null {
	if (!Array.isArray(input)) return null;
	const cleaned = input
		.filter((v) => typeof v === 'string' && v.trim())
		.map((v) => String(v).trim().slice(0, 60))
		.slice(0, 10);
	return cleaned.length > 0 ? cleaned : null;
}

/** Bulatkan ke maks 2 desimal — timbangan pabrik tidak pernah lebih presisi dari ini, dan
 *  `spk.quantity` di Directus menyimpan float mentah (mis. 45.7142857142857 / 0.625078125). */
function round2(n: unknown): number {
	const v = Number(n);
	if (!Number.isFinite(v)) return 0;
	return Math.round(v * 100) / 100;
}

// File 12 §B — setiap simpan Input Produksi memicu sweep SELURUH utang konsumsi di erp-epi-1.
// Dengan 10 operator menyimpan 10x per shift, itu 100 sweep padahal cukup sesekali. Debounce
// di memori modul: picu maksimal 1x per kiosk.sweep_interval_menit (default 5 menit). Ini state
// per-proses server (bukan per-request), cukup untuk tujuannya karena sweep bersifat global
// (tidak spesifik SPK), bukan per operator.
let lastSweepAt = 0;
async function readSweepIntervalMs(): Promise<number> {
	const fallback = 5 * 60_000;
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=kiosk.sweep_interval_menit&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		const minutes = raw ? Number(JSON.parse(raw)) : NaN;
		return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : fallback;
	} catch {
		return fallback;
	}
}

/** Fire-and-forget sweep utang konsumsi tertunda di erp-epi-1 -- reuse productionMrp.js,
 *  bukan menulis ulang logika MRP di sini. Kegagalan TIDAK BOLEH menggagalkan submit kiosk. */
async function triggerPendingConsumptionSweep() {
	const intervalMs = await readSweepIntervalMs();
	if (Date.now() - lastSweepAt < intervalMs) return;
	lastSweepAt = Date.now();

	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.PRODUCTION_AUTOMATION_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[kiosk/produksi] ERP_EPI1_BASE_URL/PRODUCTION_AUTOMATION_SECRET belum dikonfigurasi — sweep dilewati.');
		return;
	}
	try {
		await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/production?s=${encodeURIComponent(secret)}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'fulfill_pending_sweep' })
		});
	} catch (e) {
		console.warn('[kiosk/produksi] Gagal memanggil fulfill_pending_sweep erp-epi-1:', e);
	}
}

/** Bug 2 — SATU-SATUNYA sumber kebenaran kumulatif SPK, dijumlahkan di database (bukan dari
 *  halaman pertama daftar log). Dipakai GET maupun computeVariance() supaya layar input dan
 *  kartu sukses tidak lagi menampilkan dua angka berbeda untuk SPK yang sama. */
async function fetchKumulatif(spkId: number | string) {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/spk_daily_log?aggregate[sum]=output_kg,reject_kg,waste_kg&filter[spk_id][_eq]=${encodeURIComponent(String(spkId))}`
	);
	const sum = res?.data?.[0]?.sum || {};
	return {
		output: round2(sum.output_kg),
		reject: round2(sum.reject_kg),
		waste: round2(sum.waste_kg)
	};
}

/** Cari baris yang sudah tersimpan untuk UUID transaksi ini (Bug 4). Query terpisah — bukan
 *  relasi bersarang — sesuai aturan fetching Directus di CLAUDE.md. */
async function findByTxnId(clientTxnId: string) {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/spk_daily_log?filter[client_txn_id][_eq]=${encodeURIComponent(clientTxnId)}` +
				`&fields=id,tanggal,output_kg,reject_kg,waste_kg,catatan,input_by&limit=1`
		);
		return res?.data?.[0] || null;
	} catch (e) {
		console.warn('[kiosk/produksi] Gagal memeriksa duplikat client_txn_id', clientTxnId, e);
		return null;
	}
}

/** 3C — relay ke state machine SPK terpusat di erp-epi-1 (spkStateMachine.js, B2). TIDAK PATCH
 *  status mentah dari sini — transisi tidak sah (mis. SPK sudah completed) wajib ditolak di sana. */
async function triggerMarkQcPending(spkId: number | string): Promise<{ success: boolean; message: string }> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.PRODUCTION_AUTOMATION_SECRET;
	if (!baseUrl || !secret) {
		return { success: false, message: 'ERP_EPI1_BASE_URL/PRODUCTION_AUTOMATION_SECRET belum dikonfigurasi.' };
	}
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/production?s=${encodeURIComponent(secret)}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'mark_qc_pending', spkId })
		});
		const data = await res.json().catch(() => null);
		if (!res.ok) {
			return { success: false, message: data?.message || `Gagal mengubah status SPK (${res.status}).` };
		}
		return {
			success: true,
			message: data?.alreadyDone
				? 'SPK ini sudah ada di antrean QC sebelumnya.'
				: 'SPK masuk antrean Kiosk QC.'
		};
	} catch (e: any) {
		console.warn('[kiosk/produksi] Gagal memanggil mark_qc_pending erp-epi-1:', e);
		return { success: false, message: 'Gagal terhubung ke server state machine SPK.' };
	}
}

/** 3D — resolusi shift operator saat input ini dibuat. DUA query terpisah (Aturan #2, bukan
 *  relasi bersarang): (1) shift_roster hari ini, (2) fallback jadwal_kerja_id statis karyawan.
 *  Boleh gagal/kosong tanpa menggagalkan submit — "jangan menebak, jangan menggagalkan submit". */
async function resolveJadwalKerjaId(karyawanId: number): Promise<string | null> {
	try {
		const rosterRes = await directusServerJson<{ data: any[] }>(
			`/items/shift_roster?filter[karyawan_id][_eq]=${karyawanId}&filter[tanggal][_eq]=${todayWib()}` +
				`&filter[status][_eq]=aktif&fields=jadwal_kerja_id&limit=1`
		);
		const fromRoster = rosterRes?.data?.[0]?.jadwal_kerja_id;
		if (fromRoster) return typeof fromRoster === 'object' ? fromRoster.id : fromRoster;
	} catch (e) {
		console.warn('[kiosk/produksi] Gagal baca shift_roster, coba fallback karyawan.jadwal_kerja_id', e);
	}
	try {
		const karyawanRes = await directusServerJson<{ data: any }>(
			`/items/karyawan/${karyawanId}?fields=jadwal_kerja_id`
		);
		const fromKaryawan = karyawanRes?.data?.jadwal_kerja_id;
		if (fromKaryawan) return typeof fromKaryawan === 'object' ? fromKaryawan.id : fromKaryawan;
	} catch (e) {
		console.warn('[kiosk/produksi] Gagal baca karyawan.jadwal_kerja_id (fallback shift)', e);
	}
	return null;
}

/** Laporan variance ringan: kumulatif output SPK ini (termasuk entri baru) vs target quantity. */
async function computeVariance(spkId: number) {
	try {
		const [spkRes, kumulatif] = await Promise.all([
			directusServerJson<{ data: any }>(`/items/spk/${spkId}?fields=quantity,unit`),
			fetchKumulatif(spkId)
		]);
		const target = round2(spkRes?.data?.quantity);
		if (target <= 0) return null;
		return {
			targetKg: target,
			kumulatifOutputKg: kumulatif.output,
			varianceKg: round2(kumulatif.output - target),
			variancePct: Math.round(((kumulatif.output - target) / target) * 1000) / 10
		};
	} catch (e) {
		// Aturan #1: jangan menelan error tanpa jejak. Variance hanya info tambahan di kartu
		// sukses sehingga kegagalannya tidak boleh menggagalkan submit — tapi harus terlihat di log.
		console.warn('[kiosk/produksi] Gagal menghitung variance SPK', spkId, e);
		return null;
	}
}

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const spkId = event.url.searchParams.get('spkId');
	if (!spkId) throw error(400, 'spkId parameter wajib diisi.');

	try {
		const spkRes = await directusServerJson<{ data: any }>(
			`/items/spk/${spkId}?fields=id,nomor,batch_no,status,quantity,unit,product_id`
		);
		const spk = spkRes?.data;
		if (!spk) throw error(404, 'SPK tidak ditemukan.');

		// Bug 1 — collection produk. `master_barang` tidak ada di Directus; Directus membalas
		// koleksi tak dikenal sebagai 403 (bukan 404), dan dulu error itu ditelan diam-diam
		// sehingga nama produk SELALU jatuh ke 'Produk'.
		let namaBarang = 'Produk';
		if (spk.product_id) {
			const productId = typeof spk.product_id === 'object' ? spk.product_id.id : spk.product_id;
			if (productId) {
				try {
					const prodRes = await directusServerJson<{ data: any }>(
						`/items/identitas_barang/${productId}?fields=id,nama_barang_lengkap,kode_item`
					);
					if (prodRes?.data?.nama_barang_lengkap) {
						namaBarang = prodRes.data.nama_barang_lengkap;
					}
				} catch (e) {
					console.warn('[kiosk/produksi] Gagal resolve nama produk dari identitas_barang', productId, e);
					if (typeof spk.product_id === 'object' && spk.product_id.nama_barang_lengkap) {
						namaBarang = spk.product_id.nama_barang_lengkap;
					}
				}
			}
		}

		// Bug 2 — dipisah menjadi dua query dengan peran jelas:
		//   (a) agregat -> angka kumulatif, dijumlahkan di DB, tidak terpengaruh paginasi;
		//   (b) 5 baris -> hanya untuk daftar "Riwayat Input Terakhir" di UI.
		// Sebelumnya satu query `limit=20` dipakai untuk dua-duanya: kumulatif jadi salah untuk
		// SPK panjang, dan 20 baris ditarik padahal yang ditampilkan cuma 5.
		// 2A — dua daftar opsi digabung ke Promise.all yang sudah ada (bukan round-trip baru).
		const [kumulatif, logsRes, rejectReasonOptions, wasteReasonOptions, overproductionTolerancePct] =
			await Promise.all([
				fetchKumulatif(spkId),
				directusServerJson<{ data: any[] }>(
					`/items/spk_daily_log?filter[spk_id][_eq]=${spkId}` +
						`&fields=id,tanggal,output_kg,reject_kg,waste_kg,catatan,reject_reasons,waste_reasons,input_by&sort=-id&limit=5`
				),
				readSetting<string[]>('kiosk.reject_reason_options', []),
				readSetting<string[]>('kiosk.waste_reason_options', []),
				readSetting<number>('kiosk.overproduction_tolerance_pct', 15)
			]);

		const targetKg = round2(spk.quantity);
		const sisaKg = round2(Math.max(0, targetKg - kumulatif.output));
		const progressPct = targetKg > 0 ? Math.min(100, Math.round((kumulatif.output / targetKg) * 1000) / 10) : 0;

		return json({
			spk: {
				...spk,
				// Bug 6 — target dibulatkan di sumbernya, jangan biarkan UI menampilkan
				// "45.7142857142857 KG" apa adanya dari Directus.
				quantity: targetKg,
				nama_barang: namaBarang
			},
			targetKg,
			kumulatifOutput: kumulatif.output,
			kumulatifReject: kumulatif.reject,
			kumulatifWaste: kumulatif.waste,
			sisaKg,
			progressPct,
			recentLogs: logsRes?.data || [],
			rejectReasonOptions: Array.isArray(rejectReasonOptions) ? rejectReasonOptions : [],
			wasteReasonOptions: Array.isArray(wasteReasonOptions) ? wasteReasonOptions : [],
			overproductionTolerancePct: Number(overproductionTolerancePct) || 15
		});
	} catch (e: any) {
		throw error(e?.status || 500, e?.message || 'Gagal memuat detail SPK.');
	}
};

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const body = await event.request.json().catch(() => null);
	const spkId = body?.spkId;
	const rawOutput = Number(body?.outputKg);
	const outputKg = round2(body?.outputKg);
	const rejectKg = round2(body?.rejectKg);
	const wasteKg = round2(body?.wasteKg);
	const catatan = body?.catatan ? String(body.catatan).trim() : null;
	// 2A — hanya masuk akal bila kolomnya terisi; kirim string kosong dari klien tidak dianggap.
	const rejectReasons = rejectKg > 0 ? sanitizeReasons(body?.rejectReasons) : null;
	const wasteReasons = wasteKg > 0 ? sanitizeReasons(body?.wasteReasons) : null;
	// 3C — kunci pertama (klien sudah minta konfirmasi kedua sebelum kirim di sini).
	const markComplete = Boolean(body?.markComplete);
	// 3D — override manual "Bukan shift saya?" dari klien, kalau operator mengoreksi hasil
	// resolusi otomatis. Dipercaya apa adanya (field deskriptif, tidak menggerbangi apa pun).
	const jadwalKerjaIdOverride =
		typeof body?.jadwalKerjaIdOverride === 'string' && body.jadwalKerjaIdOverride.trim()
			? body.jadwalKerjaIdOverride.trim()
			: null;
	// 4B — mesin yang dipakai, dari pilihan tersimpan di perangkat kiosk (localStorage).
	// Deskriptif saja, tidak menggerbangi apa pun -- dipercaya apa adanya dari klien.
	const equipmentId =
		typeof body?.equipmentId === 'string' && body.equipmentId.trim() ? body.equipmentId.trim() : null;

	const sid = Number(spkId);
	if (!Number.isInteger(sid) || sid <= 0) throw error(400, 'SPK tidak valid.');
	if (!Number.isFinite(rawOutput) || rawOutput < 0) throw error(400, 'Output (kg) wajib diisi angka >= 0.');
	if ([rejectKg, wasteKg].some((v) => v < 0)) throw error(400, 'Reject dan waste tidak boleh minus.');

	// Bug 4 — idempotensi. `client_txn_id` bertipe unique; UUID satu per pengisian form dikirim
	// klien, UUID server hanya fallback untuk klien lama. Dicek DI SINI (sebelum validasi status
	// SPK di bawah) supaya retry setelah SPK ditutup tidak dibalas 409 palsu — Aturan #3.
	const clientTxnId =
		typeof body?.clientTxnId === 'string' && body.clientTxnId.trim()
			? body.clientTxnId.trim()
			: crypto.randomUUID();
	const existingByTxn = await findByTxnId(clientTxnId);
	if (existingByTxn) {
		console.warn('[kiosk/produksi] Submit ganda terdeteksi (dicek di awal), mengembalikan baris yang sudah ada:', clientTxnId);
		const variance = await computeVariance(sid);
		return json({ success: true, duplicate: true, data: { data: existingByTxn }, variance });
	}

	// 2B — hitung ulang di server (validasi klien bisa dilewati). Kumulatif SEBELUM baris ini +
	// output baru, dibandingkan target × (1 + toleransi). Query terpisah, paralel, tidak
	// menunda insert di bawah lebih dari satu round-trip tambahan.
	// C9(fix, Fase 6): dulu kedua .catch di bawah ini ketelan tanpa log — kalau Directus
	// gagal, gate anti-overproduksi diam-diam nonaktif (targetKgForCheck jadi 0) tanpa jejak.
	const [kumulatifSebelum, spkTargetRes, overproductionTolerancePct, resolvedJadwalKerjaId, validasiStatusMode] = await Promise.all([
		fetchKumulatif(spkId).catch((e) => {
			console.error('[kiosk/produksi] Gagal fetch kumulatif output SPK — gate anti-overproduksi tidak akurat:', e);
			return { output: 0, reject: 0, waste: 0 };
		}),
		// Ditambahkan `status` ke query yang sudah ada (bukan round-trip baru) untuk validasi §3.5.
		directusServerJson<{ data: any }>(`/items/spk/${spkId}?fields=nomor,quantity,status`).catch((e) => {
			console.error('[kiosk/produksi] Gagal fetch target quantity SPK — gate anti-overproduksi tidak akurat:', e);
			return null;
		}),
		readSetting<number>('kiosk.overproduction_tolerance_pct', 15),
		jadwalKerjaIdOverride ? Promise.resolve(null) : resolveJadwalKerjaId(session.karyawanId).catch(() => null),
		readSetting<'shadow' | 'enforce'>('kiosk.validasi_status_spk_mode', 'shadow')
	]);
	const jadwalKerjaId = jadwalKerjaIdOverride || resolvedJadwalKerjaId;
	const targetKgForCheck = round2(spkTargetRes?.data?.quantity);
	const toleransiPct = Number(overproductionTolerancePct) || 15;
	const kumulatifBaru = round2(kumulatifSebelum.output + outputKg);
	const isOverProduction =
		targetKgForCheck > 0 && kumulatifBaru > targetKgForCheck * (1 + toleransiPct / 100);
	const overProductionPct = isOverProduction
		? Math.round(((kumulatifBaru - targetKgForCheck) / targetKgForCheck) * 1000) / 10
		: 0;

	// §3.5 — SPK yang belum dimulai (bahan belum dipotong) atau sudah ditutup tidak boleh
	// menerima input baru. Mode shadow (default, Aturan #3 anti-lockdown retroaktif): TIDAK
	// menolak, hanya log + notifikasi supervisor, supaya admin bisa membersihkan kasus lama
	// dulu sebelum mode diubah ke enforce lewat system_settings (tanpa deploy).
	const statusSpk = spkTargetRes?.data?.status;
	const BOLEH_INPUT = ['in_progress'];
	if (statusSpk && !BOLEH_INPUT.includes(statusSpk)) {
		const pesan =
			statusSpk === 'worksheet_generated' || statusSpk === 'waiting_for_stock'
				? `SPK ${spkTargetRes?.data?.nomor || sid} belum dimulai. Minta supervisor tekan "Mulai Produksi" dulu.`
				: `SPK ${spkTargetRes?.data?.nomor || sid} sudah ditutup (${statusSpk}). Input tidak disimpan — lapor supervisor.`;
		if (validasiStatusMode === 'enforce') {
			throw error(409, pesan);
		}
		console.warn('[kiosk/produksi] (shadow) input diterima untuk SPK berstatus tak sesuai:', { spkId: sid, statusSpk, karyawan: session.nama });
		resolveSupervisorPenerima()
			.then(({ waKaryawanIds }) =>
				notifyKioskAndon({
					eventType: 'kiosk_spk_status_shadow_warning',
					message: `[Mode shadow] ${session.nama} input produksi ke SPK ${spkTargetRes?.data?.nomor || sid} berstatus ${statusSpk}. ${pesan}`,
					waKaryawanIds,
					karyawanId: session.karyawanId,
					sourceId: sid
				})
			)
			.catch(() => {});
	}

	let saved: any;
	try {
		saved = await directusServerJson('/items/spk_daily_log', {
			method: 'POST',
			body: JSON.stringify({
				spk_id: spkId,
				// Bug 3 — kalender WIB, bukan UTC. `new Date().toISOString()` membuat input jam
				// 00:00-06:59 WIB tercatat di tanggal kemarin (mayoritas jendela shift malam).
				// Helper `todayWib()` sudah ada dan dipakai modul lain — jangan bikin versi baru.
				tanggal: todayWib(),
				output_kg: outputKg,
				reject_kg: rejectKg,
				waste_kg: wasteKg,
				catatan,
				// 2A — nullable, additive (Aturan #3). Baris lama tetap null, tidak diwajibkan.
				reject_reasons: rejectReasons,
				waste_reasons: wasteReasons,
				// 3D — nullable. null bila roster kosong & karyawan tak punya jadwal statis
				// (Aturan: jangan menebak, jangan menggagalkan submit).
				jadwal_kerja_id: jadwalKerjaId,
				// 4B — nullable. null bila operator belum pernah memilih mesin di perangkat ini.
				equipment_id: equipmentId,
				input_by: session.nama,
				sumber: 'kiosk',
				client_txn_id: clientTxnId
			})
		});
	} catch (e: any) {
		// Bug 4 (lanjutan) — submit ganda / retry jaringan. Bila baris untuk UUID ini sudah ada,
		// bagi operator ini BUKAN kegagalan: balas baris yang sudah tersimpan, jangan 500 yang
		// justru memancing operator menekan SIMPAN sekali lagi.
		const existing = await findByTxnId(clientTxnId);
		if (existing) {
			console.warn('[kiosk/produksi] Submit ganda terdeteksi, mengembalikan baris yang sudah ada:', clientTxnId);
			const variance = await computeVariance(Number(spkId));
			return json({ success: true, duplicate: true, data: { data: existing }, variance });
		}
		console.error('[kiosk/produksi] Gagal menyimpan input produksi:', e);
		throw error(500, e?.message || 'Gagal menyimpan input produksi.');
	}

	triggerPendingConsumptionSweep().catch(() => {});
	const variance = await computeVariance(Number(spkId));

	// 2B — baris SUDAH tersimpan di atas (Aturan #6: jangan mematikan jalur input). Ini
	// hanya notifikasi tambahan, fire-and-forget, tidak boleh menggagalkan respons ke operator.
	if (isOverProduction) {
		const spkNomor = spkTargetRes?.data?.nomor || `SPK #${spkId}`;
		notifyKioskAndon({
			eventType: 'kiosk_overproduction_detected',
			message: `${spkNomor} melebihi target ${overProductionPct}% (kumulatif ${kumulatifBaru} / target ${targetKgForCheck}) — input oleh ${session.nama}.`,
			karyawanId: session.karyawanId,
			sourceId: spkId,
			actionUrl: '/production/control-tower'
		}).catch(() => {});
	}

	// 3C — kunci kedua (server-side): hanya boleh menyelesaikan SPK bila kumulatif SETELAH baris
	// ini > 0. Log produksi TETAP tersimpan di atas terlepas dari hasil transisi ini.
	let markCompleteResult: { success: boolean; message: string } | null = null;
	if (markComplete) {
		if (kumulatifBaru <= 0) {
			markCompleteResult = { success: false, message: 'Belum ada output tercatat — SPK belum bisa diselesaikan.' };
		} else {
			markCompleteResult = await triggerMarkQcPending(spkId);
		}
	}

	return json({
		success: true,
		data: saved,
		variance,
		overProduction: isOverProduction ? { pct: overProductionPct, kumulatifKg: kumulatifBaru, targetKg: targetKgForCheck } : null,
		markComplete: markCompleteResult
	});
};
