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


interface ManpowerAntiKaburConfig {
	maxEarnedPct: number;
	blokirAlpha: boolean;
	minHariKerja: number;
}

async function getAntiKaburKasbonConfig(): Promise<ManpowerAntiKaburConfig> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			'/items/app_settings?filter[module][_eq]=manpower&fields=setting_key,setting_value&limit=20'
		);
		const rows = res?.data || [];
		const map: Record<string, string> = {};
		for (const r of rows) map[r.setting_key] = r.setting_value;

		return {
			maxEarnedPct: Number(map['kasbon_max_earned_pct']) || 50,
			blokirAlpha: map['kasbon_blokir_alpha'] !== 'false',
			minHariKerja: Number(map['kasbon_min_hari_kerja']) || 3
		};
	} catch {
		return { maxEarnedPct: 50, blokirAlpha: true, minHariKerja: 3 };
	}
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
	const [manpowerRes, konfig, existing, antiKaburCfg] = await Promise.all([
		directusServerJson<{ data: { plafon_kasbon: number | null; status_komitmen?: string; blacklist_alasan?: string } }>(
			`/items/manpower/${manpowerId}?fields=plafon_kasbon,status_komitmen,blacklist_alasan`
		),
		getKonfigurasiKasbonManpower(),
		listKasbonManpowerByPekerja(manpowerId),
		getAntiKaburKasbonConfig()
	]);

	// 1. Guard Blacklist (Fase 4 Anti-Kabur)
	const mpData = manpowerRes?.data;
	if (mpData && (mpData.status_komitmen === 'blacklisted_kabur' || mpData.status_komitmen === 'blacklisted_indisipliner')) {
		return {
			ok: false,
			message: `Pekerja ini berstatus BLACKLIST (${mpData.status_komitmen.replace('_', ' ')}). Alasan: ${mpData.blacklist_alasan || 'Pelanggaran komitmen'}. Pengajuan kasbon ditolak.`
		};
	}

	// 2. Guard Alpha 7 Hari Terakhir
	if (antiKaburCfg.blokirAlpha) {
		const tujuhHariLalu = new Date();
		tujuhHariLalu.setDate(tujuhHariLalu.getDate() - 7);
		const tglFilter = tujuhHariLalu.toISOString().split('T')[0];

		const alphaRes = await directusServerJson<{ data: any[] }>(
			`/items/manpower_absensi?filter[manpower_id][_eq]=${manpowerId}&filter[status][_eq]=alpha&filter[tanggal][_gte]=${tglFilter}&limit=1&fields=id,tanggal`
		).catch(() => null);

		if (alphaRes?.data && alphaRes.data.length > 0) {
			return {
				ok: false,
				message: `Pekerja memiliki riwayat Alpha (mangkir) pada tanggal ${alphaRes.data[0].tanggal}. Kasbon ditahan untuk mitigasi risiko kabur.`
			};
		}
	}

	// 3. Guard Earned Value Kasbon & Minimal Hari Hadir
	try {
		const assignRes = await directusServerJson<{ data: any[] }>(
			`/items/manpower_assignment?filter[manpower_id][_eq]=${manpowerId}&filter[status][_eq]=aktif&limit=1&fields=id,rate_harian,rate_tipe`
		).catch(() => null);
		const assign = assignRes?.data?.[0];

		if (assign?.id && assign.rate_tipe !== 'borongan') {
			const absRes = await directusServerJson<{ data: any[] }>(
				`/items/manpower_absensi?filter[assignment_id][_eq]=${assign.id}&filter[status][_in]=hadir,setengah_hari&limit=-1&fields=id`
			).catch(() => null);
			const daysPresent = absRes?.data?.length || 0;

			if (daysPresent < antiKaburCfg.minHariKerja) {
				return {
					ok: false,
					message: `Pekerja baru memiliki ${daysPresent} hari hadir di proyek ini (minimal ${antiKaburCfg.minHariKerja} hari kerja untuk memenuhi syarat kasbon).`
				};
			}

			const rateHarian = Number(assign.rate_harian) || 150000;
			const maxEarnedValue = Math.floor(daysPresent * rateHarian * (antiKaburCfg.maxEarnedPct / 100));
			if (maxEarnedValue > 0 && nominal > maxEarnedValue) {
				return {
					ok: false,
					message: `Nominal kasbon (Rp${nominal.toLocaleString('id-ID')}) melebihi batas ${antiKaburCfg.maxEarnedPct}% hak upah berjalan (Maksimal Rp${maxEarnedValue.toLocaleString('id-ID')} dari ${daysPresent} hari hadir).`
				};
			}
		}
	} catch (evErr) {
		console.warn('[assertKasbonManpowerEligible] Error cek earned value:', evErr);
	}

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
