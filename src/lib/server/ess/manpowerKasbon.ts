// src/lib/server/ess/manpowerKasbon.ts
// Fase 3 Rencana Kasbon v2 (R1, Q2): kasbon pekerja lapangan (manpower) — satu buku hutang
// dengan kasbon karyawan (kasbon.subjek_tipe='manpower'), diajukan oleh Project Leader atas
// nama pekerjanya. Alur: Leader (submit = endorsement, langsung 'Disetujui Atasan') -> Admin
// Proyek -> Finance (reuse pencairan Fase 1). TIDAK mengubah alur kasbon karyawan.

import { error } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';

const STATUS_AKTIF = ['Diajukan', 'Disetujui Atasan', 'Disetujui HRD', 'approved'];

interface ManpowerKasbonKonfig {
	plafonDefault: number;
	tenorMaxBulan: number;
	maxAktif: number;
	jedaHari: number;
}

async function getKonfigurasiKasbonManpower(): Promise<ManpowerKasbonKonfig> {
	try {
		const result = await directusServerJson<{ data: any[] }>(
			`/items/konfigurasi_payroll_rate?filter[key][_eq]=current&limit=1&fields=kasbon_plafon_manpower_default,kasbon_tenor_max_manpower_bulan,kasbon_max_aktif,kasbon_jeda_hari`
		);
		const cfg = result?.data?.[0];
		return {
			plafonDefault: Number(cfg?.kasbon_plafon_manpower_default) || 1000000,
			tenorMaxBulan: Number(cfg?.kasbon_tenor_max_manpower_bulan) || 2,
			maxAktif: Number(cfg?.kasbon_max_aktif) || 1,
			jedaHari: Number(cfg?.kasbon_jeda_hari) || 30
		};
	} catch {
		return { plafonDefault: 1000000, tenorMaxBulan: 2, maxAktif: 1, jedaHari: 30 };
	}
}

/** Pastikan `leaderKaryawanId` benar-benar leader_id proyek yang menugaskan `manpowerId` saat ini
 * (assignment status aktif). Melempar 403/404 bila tidak valid. Mengembalikan projectId. */
export async function assertLeaderOfManpower(leaderKaryawanId: number, manpowerId: number): Promise<number> {
	const query = new URLSearchParams({
		'filter[manpower_id][_eq]': String(manpowerId),
		'filter[status][_eq]': 'aktif',
		fields: 'id,project_id.id,project_id.leader_id',
		limit: '1'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/manpower_assignment?${query.toString()}`);
	const assignment = result?.data?.[0];
	if (!assignment?.project_id?.id) {
		throw error(404, 'Pekerja ini tidak punya penugasan proyek aktif.');
	}
	if (Number(assignment.project_id.leader_id) !== Number(leaderKaryawanId)) {
		throw error(403, 'Anda hanya bisa mengajukan kasbon untuk pekerja di proyek yang Anda pimpin.');
	}
	return Number(assignment.project_id.id);
}

export async function listKasbonManpowerByPekerja(manpowerId: number) {
	const query = new URLSearchParams({
		'filter[subjek_tipe][_eq]': 'manpower',
		'filter[manpower_id][_eq]': String(manpowerId),
		fields: 'id,nominal,tenor,status,payment_status,total_paid,tanggal_pengajuan,last_payment_date,is_arsip_historis',
		sort: '-tanggal_pengajuan',
		limit: '100'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/kasbon?${query.toString()}`);
	return (result?.data || []).filter((k) => !k.is_arsip_historis);
}

/** Fase 3 (Q9 mirror): plafon, tenor, maks-aktif, jeda — sama semangatnya dengan kasbon karyawan,
 * tapi memakai konfigurasi & plafon khusus manpower (T1 tidak relevan di sini karena manpower
 * tidak punya gaji_pokok tersimpan/terenkripsi — plafon selalu dari konfigurasi eksplisit). */
export async function assertKasbonManpowerEligible(
	manpowerId: number,
	nominal: number,
	tenor: number
): Promise<{ ok: true } | { ok: false; message: string }> {
	const [manpowerRes, konfig, existing] = await Promise.all([
		directusServerJson<{ data: { plafon_kasbon: number | null } }>(`/items/manpower/${manpowerId}?fields=plafon_kasbon`),
		getKonfigurasiKasbonManpower(),
		listKasbonManpowerByPekerja(manpowerId)
	]);

	const plafon = Number(manpowerRes?.data?.plafon_kasbon) > 0 ? Number(manpowerRes.data.plafon_kasbon) : konfig.plafonDefault;
	if (plafon > 0 && nominal > plafon) {
		return { ok: false, message: `Nominal melebihi plafon Rp${plafon.toLocaleString('id-ID')}.` };
	}
	if (tenor > konfig.tenorMaxBulan) {
		return { ok: false, message: `Tenor maksimal ${konfig.tenorMaxBulan} bulan.` };
	}

	const aktifCount = existing.filter((k) => STATUS_AKTIF.includes(k.status) && k.payment_status !== 'lunas').length;
	if (aktifCount >= konfig.maxAktif) {
		return { ok: false, message: `Pekerja ini masih punya ${aktifCount} kasbon berjalan (maks ${konfig.maxAktif}). Lunasi dulu sebelum mengajukan baru.` };
	}

	const lunasTerakhir = existing
		.filter((k) => k.payment_status === 'lunas' && k.last_payment_date)
		.sort((a, b) => String(b.last_payment_date).localeCompare(String(a.last_payment_date)))[0];
	if (lunasTerakhir?.last_payment_date) {
		const hariSejakLunas = Math.floor((Date.now() - new Date(lunasTerakhir.last_payment_date).getTime()) / 86400000);
		if (hariSejakLunas < konfig.jedaHari) {
			return { ok: false, message: `Kasbon terakhir pekerja ini baru lunas ${hariSejakLunas} hari lalu. Tunggu ${konfig.jedaHari - hariSejakLunas} hari lagi.` };
		}
	}

	return { ok: true };
}

/**
 * Submit kasbon manpower oleh Project Leader. Berbeda dari kasbon karyawan: Leader-lah yang
 * mengajukan ATAS NAMA pekerjanya (bukan pekerja sendiri mengajukan), jadi tindakan submit ini
 * SEKALIGUS jadi persetujuan tahap-1 (status langsung 'Disetujui Atasan') — tidak ada tahap
 * 'Diajukan' terpisah. Lanjut ke Admin Proyek -> Finance di dashboard admin (T5 pola serupa
 * kasbon karyawan, permission project.manpower.payroll.approve).
 */
export async function submitKasbonManpower(params: {
	leaderKaryawanId: number;
	leaderNama: string;
	manpowerId: number;
	manpowerNama: string;
	nominal: number;
	tenor: number;
	keterangan: string;
}) {
	const projectId = await assertLeaderOfManpower(params.leaderKaryawanId, params.manpowerId);

	const eligible = await assertKasbonManpowerEligible(params.manpowerId, params.nominal, params.tenor);
	if (!eligible.ok) throw error(400, eligible.message);

	const payload = {
		subjek_tipe: 'manpower',
		manpower_id: params.manpowerId,
		project_id: projectId,
		nama: params.manpowerNama,
		nominal: params.nominal,
		tenor: params.tenor,
		keterangan: params.keterangan,
		tanggal_pengajuan: new Date().toISOString(),
		status: 'Disetujui Atasan',
		payment_status: 'pending',
		approver_atasan_id: String(params.leaderKaryawanId),
		approver_atasan_at: new Date().toISOString()
	};

	const result = await directusServerJson<{ data: any }>('/items/kasbon', {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	return result?.data;
}
