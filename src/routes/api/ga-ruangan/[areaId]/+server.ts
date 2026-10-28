import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { getRoomMeta } from '$lib/server/gaRuanganMeta';
import { getGaAsetSettings } from '$lib/server/gaAsetSettings';

/**
 * Halaman Ruangan (Barang per Ruangan via QR Patroli, Fase 2) — agregat 1 panggilan.
 * Relasi DIPISAH per query (Aturan #2): meta ruangan (cache 5 mnt) + daftar barang +
 * scan patroli terakhir + cek kelengkapan terakhir. Nilai rupiah hanya disertakan
 * sesuai setelan `visibilitas_nilai_lapangan` (default: sembunyi di HP).
 *
 * READ-ONLY. Tidak menulis apa pun.
 */

/** Heuristik konservatif: HR / manajerial / superadmin boleh lihat nilai bila setelan = hr_superadmin. */
function canSeeNilai(karyawan: { divisi: string | null; posisi: string | null }): boolean {
	const d = (karyawan.divisi || '').toLowerCase();
	const p = (karyawan.posisi || '').toLowerCase();
	if (/\bhr\b|hrd|sdm|human resource/.test(d)) return true;
	if (/direktur|general manager|\bgm\b|superadmin|super admin/.test(p)) return true;
	if (/manager|manajer|kepala/.test(p) && /\bga\b|umum|general affair|hr|sdm/.test(p + ' ' + d)) return true;
	return false;
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const areaId = Number(event.params.areaId);
	if (!Number.isInteger(areaId) || areaId <= 0) throw error(400, 'ID ruangan tidak valid.');

	const meta = await getRoomMeta(areaId);
	if (!meta) throw error(404, 'Ruangan tidak ditemukan.');

	const settings = await getGaAsetSettings();
	const showNilai =
		settings.visibilitasNilaiLapangan === 'semua' ||
		(settings.visibilitasNilaiLapangan === 'hr_superadmin' && canSeeNilai(karyawan));

	// --- daftar barang (relasi dipisah: ambil id identitas mentah, tidak nested) ---
	const assetFields = [
		'id',
		'kode',
		'nama',
		'kategori',
		'qty',
		'qty_rusak',
		'kondisi',
		'mode_lacak',
		'status',
		'identitas_barang_id',
		'penanggung_jawab_id',
		'last_checked_at',
		...(showNilai ? ['nilai'] : [])
	].join(',');
	const assetRes = await directusServerJson<{ data: any[] }>(
		`/items/ga_asset?filter[area_id][_eq]=${areaId}&filter[status][_neq]=disposal&sort=kategori,nama&limit=-1&fields=${assetFields}`
	);
	const assets = (assetRes?.data || []).map((a) => ({
		id: a.id,
		kode: a.kode ?? null,
		nama: a.nama ?? '(tanpa nama)',
		kategori: a.kategori ?? 'lainnya',
		qty: Number.isFinite(a.qty) ? a.qty : a.qty ?? 1,
		qty_rusak: Number.isFinite(a.qty_rusak) ? a.qty_rusak : a.qty_rusak ?? 0,
		kondisi: a.kondisi ?? 'baik',
		mode_lacak: a.mode_lacak ?? 'unit',
		identitas_barang_id: a.identitas_barang_id ?? null,
		last_checked_at: a.last_checked_at ?? null,
		nilai: showNilai ? (a.nilai ?? null) : null
	}));

	// --- checkpoint + patroli terakhir untuk ruangan ini ---
	let lastPatrol: { waktu: string | null; oleh: string | null } | null = null;
	let checkpointCode: string | null = null;
	try {
		const cpRes = await directusServerJson<{ data: any[] }>(
			`/items/security_checkpoint?filter[area_id][_eq]=${areaId}&filter[status][_eq]=active&fields=id,code&limit=1`
		);
		const cp = cpRes?.data?.[0];
		if (cp) {
			checkpointCode = cp.code ?? null;
			const scanRes = await directusServerJson<{ data: any[] }>(
				`/items/security_patrol_scan?filter[checkpoint_id][_eq]=${cp.id}&sort=-waktu&limit=1&fields=waktu`
			);
			const s = scanRes?.data?.[0];
			if (s) lastPatrol = { waktu: s.waktu ?? null, oleh: null };
		}
	} catch (err) {
		console.error(`[ga-ruangan] gagal baca checkpoint/patroli area ${areaId}:`, err);
	}

	// --- cek kelengkapan terakhir ---
	let lastCheck: { waktu: string | null; jml_selisih: number | null } | null = null;
	try {
		const rcRes = await directusServerJson<{ data: any[] }>(
			`/items/ga_room_check?filter[area_id][_eq]=${areaId}&sort=-waktu&limit=1&fields=waktu,jml_selisih,total_item`
		);
		const rc = rcRes?.data?.[0];
		if (rc) lastCheck = { waktu: rc.waktu ?? null, jml_selisih: rc.jml_selisih ?? null };
	} catch (err) {
		console.error(`[ga-ruangan] gagal baca ga_room_check area ${areaId}:`, err);
	}

	// --- ringkasan ---
	const totalUnit = assets.reduce((n, a) => n + (Number(a.qty) || 0), 0);
	const totalRusak = assets.reduce((n, a) => n + (Number(a.qty_rusak) || 0), 0) +
		assets.filter((a) => a.kondisi === 'rusak').length;

	return json({
		room: {
			area_id: meta.area_id,
			area_name: meta.area_name,
			zone_name: meta.zone_name,
			location_name: meta.location_name,
			checkpoint_code: checkpointCode
		},
		assets,
		summary: {
			jenis: assets.length,
			total_unit: totalUnit,
			total_rusak: totalRusak
		},
		last_patrol: lastPatrol,
		last_check: lastCheck,
		show_nilai: showNilai,
		interval_cek_hari: settings.intervalCekHari,
		mode_pengingat_cek: settings.modePengingatCek
	});
};
