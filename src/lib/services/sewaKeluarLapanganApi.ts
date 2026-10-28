// src/lib/services/sewaKeluarLapanganApi.ts
// Real Profit R1 — "Log Sewa Keluar" (lapangan): kontrak sewa alat milik kita yang DISEWAKAN ke customer di proyek milik leader,
// dan pencatatan timesheet harian (jam, hour meter, lembur, BBM yang ditanggung Eltama). Hasil BBM mengalir ke HPP rental di
// dashboard admin. Relasi (SO → kontrak → timesheet) di-fetch TERPISAH (bukan nested fields), difilter proyek milik pengguna —
// TIDAK PERNAH query tanpa filter proyek (akan bocor data customer lain).
import directus from './directus';
import { readItems, createItem } from '@directus/sdk';
import { getProjectsForCurrentUser } from './projectScope';
import { parseNum, sisaJamPaket, type SisaJamPaket, type TimesheetInput } from '$lib/utils/sewaKeluarUtils';

export interface KontrakSewaKeluarRow {
	contract_id: string;
	so_customer_id: number;
	nomor_so: string;
	customer_name: string;
	project_name: string;
	jenis_alat: string | null;
	tipe_tagihan: string | null;
	hour_meter_baseline: number | null;
	hour_meter_limit: number | null;
	/** Pembacaan hour meter TERTINGGI yang sudah tercatat (null bila belum ada). */
	last_hour_meter: number | null;
	jumlah_entri: number;
	tanggal_terakhir: string | null;
	paket: SisaJamPaket | null;
}

const STATUS_SO_DIABAIKAN = ['cancelled'];

/** Kontrak sewa keluar AKTIF di proyek milik leader yang login. */
export async function fetchKontrakSewaKeluarSaya(): Promise<KontrakSewaKeluarRow[]> {
	const projects = (await getProjectsForCurrentUser(true)) || [];
	const projectIds = projects.map((p: any) => p.id);
	if (!projectIds.length) return [];
	const projectName = new Map<number, string>(projects.map((p: any) => [p.id, p.name || p.calculated_name || `Proyek #${p.id}`]));

	const sos = (await directus.request(
		readItems('so_customer' as any, {
			filter: { project_id: { _in: projectIds }, status: { _nin: STATUS_SO_DIABAIKAN } },
			fields: ['id', 'nomor_so', 'customer_name', 'project_id'],
			limit: -1
		})
	)) as any[];
	if (!sos.length) return [];
	const soById = new Map<number, any>(sos.map((s) => [s.id, s]));

	// so_customer_id di rental_contract bertipe string → cocokkan sebagai string.
	const contracts = (await directus.request(
		readItems('rental_contract' as any, {
			filter: { so_customer_id: { _in: sos.map((s) => String(s.id)) }, operational_status: { _eq: 'active' } },
			fields: ['id', 'so_customer_id', 'jenis_alat', 'tipe_tagihan', 'hour_meter_baseline', 'hour_meter_limit'],
			limit: -1
		})
	)) as any[];
	if (!contracts.length) return [];

	const sheets = (await directus.request(
		readItems('rental_timesheet' as any, {
			filter: { rental_contract_id: { _in: contracts.map((c) => String(c.id)) } },
			fields: ['id', 'rental_contract_id', 'tanggal', 'hour_meter_reading'],
			sort: ['-tanggal'],
			limit: 500
		})
	)) as any[];

	return contracts.map((c) => {
		const so = soById.get(Number(c.so_customer_id)) || {};
		const mine = sheets.filter((t) => String(t.rental_contract_id) === String(c.id));
		const readings = mine.map((t) => parseNum(t.hour_meter_reading)).filter((n): n is number => n != null);
		const last = readings.length ? Math.max(...readings) : null;
		return {
			contract_id: String(c.id),
			so_customer_id: Number(c.so_customer_id),
			nomor_so: so.nomor_so || `SO #${c.so_customer_id}`,
			customer_name: so.customer_name || '—',
			project_name: projectName.get(so.project_id) || '—',
			jenis_alat: c.jenis_alat ?? null,
			tipe_tagihan: c.tipe_tagihan ?? null,
			hour_meter_baseline: parseNum(c.hour_meter_baseline),
			hour_meter_limit: parseNum(c.hour_meter_limit),
			last_hour_meter: last,
			jumlah_entri: mine.length,
			tanggal_terakhir: mine[0]?.tanggal ?? null,
			paket: sisaJamPaket(parseNum(c.hour_meter_baseline), parseNum(c.hour_meter_limit), last)
		};
	});
}

/** Simpan timesheet harian dari lapangan: status 'draft' (TTD customer & konfirmasi dilakukan admin), asal 'lapangan'. */
export async function simpanTimesheetLapangan(contractId: string, input: TimesheetInput, pencatat: string): Promise<void> {
	await directus.request(
		createItem('rental_timesheet' as any, {
			rental_contract_id: contractId,
			tanggal: input.tanggal,
			jam_mulai: input.jam_mulai || null,
			jam_selesai: input.jam_selesai || null,
			hour_meter_reading: input.hour_meter_reading ?? null,
			overtime_hours: input.overtime_hours ?? 0,
			bbm_liter: input.bbm_liter ?? null,
			bbm_rp: input.bbm_rp ?? null,
			catatan: input.catatan?.trim() || null,
			status: 'draft',
			signed_by_customer: false,
			dicatat_dari: 'lapangan',
			dicatat_oleh: pencatat || null
		})
	);
}
