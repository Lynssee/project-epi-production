import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { decryptPayrollList } from '$lib/server/ess/payrollDecrypt';
import { listRincianAbsensi, type KonfigurasiDisiplin, type JadwalKerja, type AbsensiRecord } from '$lib/server/ess/disiplinCalc';

const PAYROLL_FIELDS = [
	'id', 'periode', 'status', 'catatan',
	'gaji_pokok', 'tunjangan', 'tunjangan_jabatan', 'tunjangan_makan', 'tunjangan_transport', 'tunjangan_lainnya',
	'uang_lembur', 'reimbursement',
	'potongan', 'potongan_terlambat', 'potongan_alpa', 'potongan_bpjs_kesehatan', 'potongan_bpjs_ketenagakerjaan',
	'potongan_pph21', 'potongan_kasbon', 'potongan_lainnya', 'potongan_lain_lain',
	'gaji_bersih', 'tanggal_dibayar', 'metode_pembayaran', 'payload_terenkripsi',
	// KPI x Payroll TAJAM v2, Fase 3 — kpi_skor/kpi_breakdown/kpi_management_id BUKAN field
	// sensitif (tidak masuk payload_terenkripsi), ambil langsung. kpi_bonus SENSITIF —
	// datang lewat decryptPayrollList() (spread dari payload_terenkripsi), bukan dari sini.
	'kpi_skor', 'kpi_breakdown', 'kpi_management_id'
].join(',');

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan.id),
		'filter[status][_in]': 'Disetujui,Dibayar',
		fields: PAYROLL_FIELDS,
		sort: '-periode',
		limit: '24'
	});

	const result = await directusServerJson<{ data: any[] }>(`/items/payroll_bulanan?${query.toString()}`);
	const decrypted = await decryptPayrollList(result?.data || []);

	// Jangan kirim ciphertext mentah ke klien setelah didekripsi.
	const sanitized = decrypted.map(({ payload_terenkripsi, ...rest }) => rest);

	// Ambil history identitas gaji, kasbon, & KPI karyawan (relasi terpisah)
	let historyGaji: any[] = [];
	let kasbonList: any[] = [];
	let allKpis: any[] = [];
	let potonganLainList: any[] = [];
	try {
		const historyRes = await directusServerJson<{ data: any[] }>(
			`/items/identitas_gaji?filter[karyawan_id][_eq]=${karyawan.id}&sort=-berlaku_mulai&limit=10`
		);
		historyGaji = historyRes?.data || [];

		const kasbonRes = await directusServerJson<{ data: any[] }>(
			`/items/kasbon?filter[karyawan_id][_eq]=${karyawan.id}&sort=-tanggal_pengajuan&limit=20`
		);
		kasbonList = kasbonRes?.data || [];

		// Denda Prosedural Fase 3 — rincian "Potongan Lain-Lain" (potongan_karyawan approved:
		// sanksi/denda prosedural/kerusakan/kehilangan). Keterangan terbaca manusia untuk slip ESS.
		const potLainRes = await directusServerJson<{ data: any[] }>(
			`/items/potongan_karyawan?filter[karyawan_id][_eq]=${karyawan.id}&filter[status][_eq]=approved` +
			`&fields=id,kategori,nominal,cicilan_per_bulan,total_paid,payment_status,keterangan,tanggal_mulai_potong,denda_periode` +
			`&sort=-tanggal_pengajuan&limit=50`
		);
		potonganLainList = potLainRes?.data || [];

		const kpiRes = await directusServerJson<{ data: any[] }>(
			`/items/kpi_management?filter[karyawan_id][_eq]=${karyawan.id}&sort=-periode,-tanggal_dibuat&limit=10`
		);
		allKpis = kpiRes?.data || [];
	} catch (e) {
		console.warn('[ess/payroll/status] Gagal melampirkan historyGaji/kasbon/kpiList:', e);
	}

	// Ambil rincian absensi untuk SELURUH periode slip dalam satu batch (bukan 1 query per slip).
	// Rentang gabungan dari periode terlama s/d terbaru, lalu dikelompokkan per periode di memori.
	const absensiByPeriode = new Map<string, any[]>();
	if (sanitized.length > 0) {
		const periodeBounds = sanitized.map((s) => {
			const [y, m] = String(s.periode).split('-');
			const lastDay = new Date(Number(y), Number(m), 0).getDate();
			return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
		});
		const rangeStart = periodeBounds.map((b) => b.start).sort()[0];
		const rangeEnd = periodeBounds.map((b) => b.end).sort().slice(-1)[0];

		try {
			const absensiQuery = new URLSearchParams({
				'filter[karyawan_id][_eq]': String(karyawan.id),
				'filter[tanggal][_gte]': rangeStart,
				'filter[tanggal][_lte]': rangeEnd,
				fields: 'tanggal,status,jam_masuk,jam_keluar,lokasi,keterangan',
				sort: 'tanggal',
				limit: '-1'
			});
			const absensiRes = await directusServerJson<{ data: any[] }>(`/items/absensi_harian?${absensiQuery.toString()}`);
			for (const row of absensiRes?.data || []) {
				const periode = String(row.tanggal).slice(0, 7);
				if (!absensiByPeriode.has(periode)) absensiByPeriode.set(periode, []);
				absensiByPeriode.get(periode)!.push(row);
			}
		} catch (e) {
			console.warn('[ess/payroll/status] Gagal melampirkan absensiList:', e);
		}
	}

	for (const slip of sanitized) {
		slip.historyGaji = historyGaji;
		slip.kasbonList = kasbonList;
		// Rincian potongan lain-lain aktif pada periode slip ini (denda_periode cocok, atau cicilan
		// masih berjalan & sudah mulai dipotong sebelum akhir periode).
		{
			const [py, pm] = String(slip.periode).split('-');
			const periodeEnd = `${py}-${pm}-${String(new Date(Number(py), Number(pm), 0).getDate()).padStart(2, '0')}`;
			slip.rincianPotonganLain = potonganLainList.filter((p) => {
				if (p.denda_periode && p.denda_periode === slip.periode) return true;
				const mulai = p.tanggal_mulai_potong ? String(p.tanggal_mulai_potong).slice(0, 10) : '';
				const sisa = (Number(p.nominal) || 0) - (Number(p.total_paid) || 0);
				return (!mulai || mulai <= periodeEnd) && p.payment_status !== 'lunas' && sisa > 0;
			});
		}
		slip.kpiList = allKpis.filter((k: any) => k.periode === slip.periode);
		if (!slip.kpiList.length && allKpis.length > 0) {
			slip.kpiList = [allKpis[0]]; // fallback to latest KPI
		}
		slip.absensiList = absensiByPeriode.get(String(slip.periode)) || [];
	}

	// Transparansi slip (potongan telat/alpa)
	const needDetail = sanitized.filter((s) => (Number(s.potongan_terlambat) || 0) > 0 || (Number(s.potongan_alpa) || 0) > 0);
	if (needDetail.length > 0) {
		try {
			const karyawanQuery = new URLSearchParams({ fields: 'jadwal_kerja_id' });
			const karyawanRes = await directusServerJson<{ data: { jadwal_kerja_id: string | null } }>(
				`/items/karyawan/${karyawan.id}?${karyawanQuery.toString()}`
			);
			const jadwalId = karyawanRes?.data?.jadwal_kerja_id || null;
			let jadwal: JadwalKerja | null = null;
			if (jadwalId) {
				const jadwalRes = await directusServerJson<{ data: JadwalKerja }>(
					`/items/jadwal_kerja/${jadwalId}?fields=jam_masuk_normal,toleransi_telat_menit`
				);
				jadwal = jadwalRes?.data || null;
			}

			const konfigRes = await directusServerJson<{ data: KonfigurasiDisiplin[] }>(
				`/items/konfigurasi_kebijakan_disiplin?sort=-tahun_berlaku&limit=-1`
			);
			const semuaKonfig = konfigRes?.data || [];

			for (const slip of needDetail) {
				const [year] = String(slip.periode).split('-');
				const konfig =
					semuaKonfig.find((c: any) => Number(c.tahun_berlaku) === Number(year)) ||
					semuaKonfig.filter((c: any) => Number(c.tahun_berlaku) < Number(year))[0] ||
					semuaKonfig[semuaKonfig.length - 1];
				if (!konfig) continue;

				// Reuse batch absensi yang sudah diambil di atas — sudah mencakup seluruh rentang periode slip.
				const absensiRows = (absensiByPeriode.get(String(slip.periode)) || []) as AbsensiRecord[];
				slip.rincianAbsensi = listRincianAbsensi(absensiRows, jadwal, konfig);
			}
		} catch (e) {
			console.warn('[ess/payroll/status] Gagal melampirkan rincian absensi:', e);
		}
	}

	return json({ slips: sanitized });
};
