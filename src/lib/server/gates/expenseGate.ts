// src/lib/server/gates/expenseGate.ts
// Fase 2 v2 "Perketat Gate BBM & E-Toll" (9 Sep 2026) — validator gate TUNGGAL untuk
// pencatatan biaya lapangan (BBM/tol/parkir/lain), dipanggil dari 3 endpoint:
// api/biaya-lapangan, api/driver/trip/[id]/expense, api/driver/fuel-log. Satu modul,
// tidak ada logika gate yang ditulis dua kali (prinsip #3 rencana v2).
//
// Semua gate di sini MODE-AWARE lewat gate_enforcement.ts (getFieldGateMode) — default
// 'shadow' kalau belum dikonfigurasi (Aturan #3: gate baru tidak boleh lahir hard).
// Directus fetch dipisah per relasi (Aturan #1/#2) — tidak ada nested expansion.

import { directusServerJson } from '$lib/server/directus';
import { getFieldGateMode, type GateMode } from '$lib/server/gateEnforcement';

export interface GateResult {
	key: string;
	status: 'passed' | 'failed' | 'not_applicable';
	mode: GateMode;
	message: string;
	action?: { label: string; href: string };
	ref?: string | number | null;
}

async function modeOf(key: Parameters<typeof getFieldGateMode>[0]): Promise<GateMode> {
	return getFieldGateMode(key).catch(() => 'shadow' as GateMode);
}

/**
 * G_P2H_UNIT_LAPANGAN: bila kendaraan PERUSAHAAN dipilih (vehicleId ada), kendaraan itu
 * wajib sudah P2H hari ini (fleet_vehicle_check) & bukan 'tidak_laik'. N/A bila tidak ada
 * kendaraan dipilih (motor pribadi/umum, atau jenis biaya bukan bbm/tol).
 */
export async function checkP2hUnitLapanganGate(vehicleId: string | number | null): Promise<GateResult> {
	const mode = await modeOf('G_P2H_UNIT_LAPANGAN');
	if (!vehicleId) {
		return { key: 'G_P2H_UNIT_LAPANGAN', status: 'not_applicable', mode, message: 'N/A — tidak ada kendaraan perusahaan dipilih' };
	}
	const today = new Date().toISOString().slice(0, 10);
	const res = await directusServerJson<{ data: Array<{ id: number; status: string }> }>(
		`/items/fleet_vehicle_check?filter[vehicle_id][_eq]=${vehicleId}&filter[tanggal][_eq]=${today}&sort=-id&limit=1&fields=id,status`
	).catch(() => null);
	const check = res?.data?.[0];
	if (!check) {
		return {
			key: 'G_P2H_UNIT_LAPANGAN',
			status: 'failed',
			mode,
			message: 'Kendaraan ini belum P2H hari ini',
			action: { label: 'Lakukan P2H', href: '/driver/check' }
		};
	}
	if (check.status === 'tidak_laik') {
		return {
			key: 'G_P2H_UNIT_LAPANGAN',
			status: 'failed',
			mode,
			message: 'P2H kendaraan ini hari ini berstatus "tidak laik"',
			action: { label: 'Lihat hasil P2H', href: '/driver/check' }
		};
	}
	return { key: 'G_P2H_UNIT_LAPANGAN', status: 'passed', mode, message: 'Kendaraan sudah P2H hari ini (laik)', ref: check.id };
}

/**
 * G_SJ_KIRIM: DITURUNKAN OTOMATIS (keputusan user 8 Sep 2026) — bukan checkbox manual.
 * Sistem mencari surat_jalan aktif (belum selesai/batal) atas nama user hari ini. Kalau
 * ada, dilekatkan sebagai referensi (audit trail); kalau tidak ada, N/A. Gate ini TIDAK
 * PERNAH gagal — tidak ada aksi user yang bisa "salah", jadi tidak masuk failedRequired
 * di endpoint manapun (sejalan dengan jadwal §4: shadow->soft->soft, tidak pernah hard).
 */
export async function checkSjKirimGate(karyawanId: string | number | null, driverId: string | number | null): Promise<GateResult> {
	const mode = await modeOf('G_SJ_KIRIM');
	if (!karyawanId && !driverId) {
		return { key: 'G_SJ_KIRIM', status: 'not_applicable', mode, message: 'N/A — identitas pengaju tidak diketahui' };
	}
	const AKTIF_STATUS_EXCLUDE = ['delivered', 'cancelled', 'received', 'complete', 'closed'];
	const filters: string[] = [];
	if (karyawanId) filters.push(`{"requested_by":{"_eq":${JSON.stringify(String(karyawanId))}}}`);
	if (driverId) filters.push(`{"delegated_driver_id":{"_eq":${JSON.stringify(String(driverId))}}}`);
	const filter = {
		_and: [
			{ _or: filters.map((f) => JSON.parse(f)) },
			{ status: { _nin: AKTIF_STATUS_EXCLUDE } }
		]
	};
	const res = await directusServerJson<{ data: Array<{ id: number; nomor_sj: string }> }>(
		`/items/surat_jalan?filter=${encodeURIComponent(JSON.stringify(filter))}&fields=id,nomor_sj&sort=-id&limit=1`
	).catch(() => null);
	const sj = res?.data?.[0];
	if (!sj) {
		return { key: 'G_SJ_KIRIM', status: 'not_applicable', mode, message: 'N/A — tidak ada Surat Jalan aktif atas nama Anda hari ini' };
	}
	return { key: 'G_SJ_KIRIM', status: 'passed', mode, message: `Terkait Surat Jalan "${sj.nomor_sj || sj.id}" (auto-terdeteksi)`, ref: sj.id };
}

/**
 * G_BUKTI_BBM: khusus jenis='bbm' — wajib struk + odometer + foto odometer. N/A untuk
 * jenis lain (tol/parkir/lain tidak punya konsep odometer).
 */
export function checkBuktiBbmGate(
	jenis: string,
	fotoStrukId: string | null,
	odometer: number | null,
	fotoOdometerId: string | null
): GateResult {
	// mode dibaca di caller (sync di sini supaya dipakai bersama checkBuktiStrukGate tanpa
	// double-await pada satu request) — lihat evaluateExpenseGates.
	if (jenis !== 'bbm') {
		return { key: 'G_BUKTI_BBM', status: 'not_applicable', mode: 'shadow', message: 'N/A — bukan pengisian BBM' };
	}
	const missing: string[] = [];
	if (!fotoStrukId) missing.push('foto struk');
	if (odometer == null || !Number.isFinite(odometer)) missing.push('angka odometer');
	if (!fotoOdometerId) missing.push('foto odometer');
	if (missing.length > 0) {
		return {
			key: 'G_BUKTI_BBM',
			status: 'failed',
			mode: 'shadow',
			message: `Belum lengkap: ${missing.join(', ')}`,
			action: { label: 'Lengkapi bukti BBM', href: '#foto-odometer' }
		};
	}
	return { key: 'G_BUKTI_BBM', status: 'passed', mode: 'shadow', message: 'Struk, odometer, dan foto odometer lengkap' };
}

/** G_BUKTI_STRUK: BBM/Tol/Parkir wajib foto struk. N/A untuk jenis 'lain'. */
export function checkBuktiStrukGate(jenis: string, fotoStrukId: string | null): GateResult {
	if (jenis === 'lain') {
		return { key: 'G_BUKTI_STRUK', status: 'not_applicable', mode: 'shadow', message: 'N/A — kategori "lain-lain" tidak wajib struk' };
	}
	if (!fotoStrukId) {
		return {
			key: 'G_BUKTI_STRUK',
			status: 'failed',
			mode: 'shadow',
			message: 'Foto struk belum dilampirkan',
			action: { label: 'Lampirkan foto struk', href: '#foto-struk' }
		};
	}
	return { key: 'G_BUKTI_STRUK', status: 'passed', mode: 'shadow', message: 'Foto struk terlampir' };
}

/**
 * G_EXPENSE_BUDGET_PLAFON: Memvalidasi ketersediaan plafon anggaran RAP operasional
 * bila mode = 'proyek' (Dana Proyek) dan projectId terisi.
 * Mode-aware lewat getFieldGateMode('G_EXPENSE_BUDGET_PLAFON') (default 'shadow').
 */
export async function checkExpenseBudgetPlafonGate(
	projectId: number | null | undefined,
	nominal: number | null | undefined,
	modeBiaya: string | null | undefined
): Promise<GateResult> {
	const mode = await modeOf('G_EXPENSE_BUDGET_PLAFON');
	if (modeBiaya !== 'proyek' || !projectId) {
		return {
			key: 'G_EXPENSE_BUDGET_PLAFON',
			status: 'not_applicable',
			mode,
			message: 'N/A — bukan pengeluaran Dana Proyek'
		};
	}

	const nom = Number(nominal) || 0;
	try {
		// 1. Ambil alokasi anggaran RAP kategori operasional untuk proyek ini
		const budgetRes = await directusServerJson<{ data: Array<{ id: number; planned_amount: number; material_name?: string }> }>(
			`/items/project_budgets?filter[project_id][_eq]=${projectId}&filter[budget_category][_in]=operasional,packing_operasional&filter[is_category_header][_neq]=true&fields=id,planned_amount,material_name`
		).catch(() => null);

		const budgets = budgetRes?.data || [];
		const totalPlanned = budgets.reduce((sum, b) => sum + (Number(b.planned_amount) || 0), 0);

		if (totalPlanned <= 0) {
			return {
				key: 'G_EXPENSE_BUDGET_PLAFON',
				status: 'failed',
				mode,
				message: `Proyek #${projectId} belum memiliki alokasi anggaran RAP operasional disahkan`,
				action: { label: 'Tinjau RAP di ERP', href: `/rap-aktual?project=${projectId}` }
			};
		}

		// 2. Ambil realisasi pengeluaran dana proyek yang sudah tercatat
		const actualRes = await directusServerJson<{ data: Array<{ id: number; nominal: number }> }>(
			`/items/fleet_trip_expense?filter[project_id][_eq]=${projectId}&filter[mode][_eq]=proyek&fields=id,nominal`
		).catch(() => null);

		const actualList = actualRes?.data || [];
		const totalActual = actualList.reduce((sum, a) => sum + (Number(a.nominal) || 0), 0);
		const sisa = Math.max(0, totalPlanned - totalActual);

		const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

		if (nom > sisa) {
			return {
				key: 'G_EXPENSE_BUDGET_PLAFON',
				status: 'failed',
				mode,
				message: `Pengeluaran ${rp(nom)} melampaui sisa plafon RAP operasional (alokasi ${rp(totalPlanned)}, terpakai ${rp(totalActual)}, sisa ${rp(sisa)})`,
				action: { label: 'Lihat RAP vs Aktual', href: `/rap-aktual?project=${projectId}` }
			};
		}

		return {
			key: 'G_EXPENSE_BUDGET_PLAFON',
			status: 'passed',
			mode,
			message: `Sisa plafon RAP operasional mencukupi: ${rp(sisa)} (dari total anggaran ${rp(totalPlanned)})`,
			ref: budgets[0]?.id
		};
	} catch (e: any) {
		console.warn('[G_EXPENSE_BUDGET_PLAFON] error cek budget:', e?.message || e);
		return {
			key: 'G_EXPENSE_BUDGET_PLAFON',
			status: 'passed',
			mode,
			message: 'Pengecekan plafon anggaran dilewati (layanan budget tidak menjawab)'
		};
	}
}

export interface ExpenseGateContext {
	jenis: string;
	vehicleId: string | number | null;
	karyawanId: string | number | null;
	driverId: string | number | null;
	fotoStrukId: string | null;
	odometer: number | null;
	fotoOdometerId: string | null;
	projectId?: number | null;
	nominal?: number | null;
	mode?: string | null;
}

/**
 * Evaluasi semua gate biaya lapangan sekaligus. Severity efektif per gate ada di field
 * `mode` masing-masing hasil — caller memutuskan blokir hanya bila mode='hard' &&
 * status='failed' (pola sama validate/+server.js erp-epi).
 */
export async function evaluateExpenseGates(ctx: ExpenseGateContext): Promise<GateResult[]> {
	const [p2h, sjKirim, buktiBbmMode, buktiStrukMode, budgetPlafon] = await Promise.all([
		checkP2hUnitLapanganGate(ctx.vehicleId),
		checkSjKirimGate(ctx.karyawanId, ctx.driverId),
		modeOf('G_BUKTI_BBM'),
		modeOf('G_BUKTI_STRUK'),
		checkExpenseBudgetPlafonGate(ctx.projectId, ctx.nominal, ctx.mode)
	]);
	const buktiBbm = { ...checkBuktiBbmGate(ctx.jenis, ctx.fotoStrukId, ctx.odometer, ctx.fotoOdometerId), mode: buktiBbmMode };
	const buktiStruk = { ...checkBuktiStrukGate(ctx.jenis, ctx.fotoStrukId), mode: buktiStrukMode };
	return [p2h, sjKirim, buktiBbm, buktiStruk, budgetPlafon];
}

/** Gate WAJIB (mode hard) yang gagal — dipakai caller untuk memutuskan blokir submit. */
export function failedHardGates(gates: GateResult[]): GateResult[] {
	return gates.filter((g) => g.mode === 'hard' && g.status === 'failed');
}
