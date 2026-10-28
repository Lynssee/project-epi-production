import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem, deleteItem, uploadFiles } from '@directus/sdk';
import { createPengajuanManpowerRows } from './pengajuanManpower';
import { getManpowerSetting, loadManpowerSettings } from './manpowerSettings';
import { generatePengajuanAnggaranNumber } from './finance';

loadManpowerSettings();

function dataUrlToFile(dataUrl: string, filename: string): File {
	const arr = dataUrl.split(',');
	const mimeMatch = arr[0].match(/:(.*?);/);
	const mime = mimeMatch ? mimeMatch[1] : 'image/png';
	const bstr = atob(arr[1]);
	let n = bstr.length;
	const u8arr = new Uint8Array(n);
	while (n--) {
		u8arr[n] = bstr.charCodeAt(n);
	}
	return new File([u8arr], filename, { type: mime });
}

// ── Proses Gajian (manpower_payroll) ───────────────────────────────────────
// Mengonsolidasikan akrual harian manpower_absensi/project_expenses (source_type
// 'manpower_accrual') menjadi satu baris payroll final per pekerja per periode
// (source_type 'payroll'), supaya biaya proyek tidak dobel hitung antara akrual
// harian dan proses gajian. Alur status: draft -> disetujui -> dibayar.

const asId = (v: any) => (v && typeof v === 'object' ? v.id : v);

/** Fase 3 (R1): kasbon formal aktif (koleksi kasbon, subjek_tipe=manpower) milik pekerja ini,
 * kalau ada — dipakai createPayrollDraftBatch untuk memotong cicilan otomatis, menggantikan sel
 * kasbon manual di rekap absensi (T6, dikunci di ProjectPayrollRecap.svelte). */
async function getKasbonAktifManpower(manpowerId: number): Promise<{ id: number; cicilan: number } | null> {
	try {
		const rows = (await directus.request(
			readItems('kasbon', {
				fields: ['id', 'nominal', 'tenor', 'cicilan_per_bulan', 'total_paid', 'payment_status'],
				filter: {
					subjek_tipe: { _eq: 'manpower' },
					manpower_id: { _eq: manpowerId },
					payment_status: { _neq: 'lunas' },
					is_arsip_historis: { _neq: true }
				},
				sort: ['-id'],
				limit: 1
			})
		)) as any[];
		const k = rows?.[0];
		if (!k) return null;
		const sisa = Number(k.nominal || 0) - Number(k.total_paid || 0);
		if (sisa <= 0) return null;
		const cicilanDitentukan = Number(k.cicilan_per_bulan) || Math.round(Number(k.nominal || 0) / Math.max(1, Number(k.tenor) || 1));
		return { id: k.id, cicilan: Math.min(sisa, cicilanDitentukan) };
	} catch (error) {
		console.error('getKasbonAktifManpower:', error);
		return null;
	}
}

export interface PayrollDraftInput {
	assignmentId: number;
	manpowerId: number;
	rateHarian: number;
	jumlahHariHadir: number;
	totalJam: number;
	upahPokok: number;
	lembur: number;
	bonus?: number;
	kasbonPotongan?: number;
	potonganLain?: number;
	totalDibayar: number;
}

const PAYROLL_RUN_FIELDS = [
	'*',
	'manpower_id.nama',
	'manpower_id.posisi',
	'manpower_id.bank_rekening',
	'manpower_id.bank_nama',
	'manpower_id.bank_atas_nama',
	'project_id.name',
	'project_id.lokasi',
	'project_id.siklus_bayar_manpower',
	// F4.3 (Akuntabilitas Pembayaran Manpower v3): status upah per pekerja — tunjukkan tahap
	// approval sesungguhnya (manager_proyek/HRD/finance/direktur), bukan cuma "Disetujui" datar.
	'pengajuan_anggaran_id.current_stage',
	'pengajuan_anggaran_id.status'
];

export async function getPayrollRuns(projectId: number, filters: { status?: string } = {}) {
	return getPayrollRunsForProjects([projectId], filters);
}

/** Gaji tertunda: logika identik dengan getPayrollUrgency() di erp-epi
 * (manpowerPayrollApi.js) — dipertahankan sama persis (offset hari & ambang batas) supaya
 * status "segera"/"terlambat" konsisten antara dashboard admin & dashboard leader lapangan.
 * expectedDate = perkiraan tanggal bayar = periode_selesai + offset siklus bayar proyek. */
const SIKLUS_OFFSET_HARI: Record<string, number> = { mingguan: 7, dua_mingguan: 14 };

export type PayrollUrgencyLevel = 'ontime' | 'warning' | 'overdue' | 'unknown' | 'done';

export function getPayrollUrgency(
	payroll: { periode_selesai?: string; status?: string; dibayar_at?: string | null },
	project?: { siklus_bayar_manpower?: string } | null
): { expectedDate: Date | null; daysOverdue: number | null; level: PayrollUrgencyLevel } {
	if (payroll?.dibayar_at || payroll?.status === 'dibayar') {
		return { expectedDate: null, daysOverdue: null, level: 'done' };
	}
	const siklus = project?.siklus_bayar_manpower || 'mingguan';
	const offsetHari = SIKLUS_OFFSET_HARI[siklus];
	if (!payroll?.periode_selesai || offsetHari == null) {
		return { expectedDate: null, daysOverdue: null, level: 'unknown' };
	}
	const expectedDate = new Date(payroll.periode_selesai);
	expectedDate.setDate(expectedDate.getDate() + offsetHari);
	const daysOverdue = Math.floor((Date.now() - expectedDate.getTime()) / 86400000);
	let level: PayrollUrgencyLevel = 'ontime';
	if (daysOverdue > 3) level = 'overdue';
	else if (daysOverdue > -3) level = 'warning';
	return { expectedDate, daysOverdue, level };
}

/** Fase 1 Payroll Terpusat: rekap gajian lintas SEMUA proyek yang boleh dilihat user (batch _in,
 * pola sama dengan getBatchedProjectSummaries di projectSummary.ts) — bukan per-projectId lagi. */
export async function getPayrollRunsForProjects(projectIds: number[], filters: { status?: string } = {}) {
	try {
		if (!projectIds || projectIds.length === 0) return { data: [], success: true };
		const filter: Record<string, any> = { project_id: { _in: projectIds } };
		if (filters.status) filter.status = { _eq: filters.status };
		const result = await directus.request(
			readItems('manpower_payroll', {
				fields: PAYROLL_RUN_FIELDS,
				filter,
				sort: ['-id'],
				limit: -1
			})
		);
		return { data: (result as any[]) || [], success: true };
	} catch (error: any) {
		handleDirectusError(error);
		return { data: [], success: false, error: error.message };
	}
}

/**
 * Buat batch draft manpower_payroll (satu baris per pekerja) untuk satu periode, lalu kunci
 * baris manpower_absensi terkait (set payroll_id) supaya tidak ikut ter-akrual ulang / diedit
 * dobel dari grid Gajian. Pekerja yang sebagian tanggalnya di periode ini SUDAH terkunci payroll
 * lain dilewati dan dilaporkan sebagai konflik (mencegah biaya proyek dobel hitung).
 */
export async function createPayrollDraftBatch(
	projectId: number,
	periodeMulai: string,
	periodeSelesai: string,
	rows: PayrollDraftInput[]
) {
	const result = {
		success: true,
		created: [] as any[],
		conflicts: [] as { manpowerId: number; reason: string }[],
		error: undefined as string | undefined
	};
	try {
		for (const row of rows) {
			const existingRows = (await directus.request(
				readItems('manpower_absensi', {
					fields: ['id', 'payroll_id'],
					filter: {
						assignment_id: { _eq: row.assignmentId },
						tanggal: { _between: [periodeMulai, periodeSelesai] }
					},
					limit: -1
				})
			)) as any[];

			const alreadyLocked = existingRows.some((r) => r.payroll_id);
			if (alreadyLocked) {
				result.conflicts.push({
					manpowerId: row.manpowerId,
					reason: 'Sebagian tanggal di periode ini sudah masuk proses gajian lain'
				});
				continue;
			}
			if (existingRows.length === 0) {
				result.conflicts.push({ manpowerId: row.manpowerId, reason: 'Tidak ada data absensi tersimpan di periode ini' });
				continue;
			}

			// Fase 3 (R1, T6): kasbon formal (bila ada) MENGGANTIKAN jumlah kasbon manual dari sel
			// grid — satu-satunya jalur potongan kasbon manpower sekarang, konsisten dengan buku
			// hutang terpusat di koleksi kasbon (bukan kasbon_amount lepas per baris absensi).
			const kasbonAktif = await getKasbonAktifManpower(row.manpowerId);
			const kasbonPotongan = kasbonAktif ? kasbonAktif.cicilan : row.kasbonPotongan || 0;
			const totalDibayar = kasbonAktif ? row.totalDibayar - (row.kasbonPotongan || 0) + kasbonAktif.cicilan : row.totalDibayar;

			const created: any = await directus.request(
				createItem('manpower_payroll', {
					manpower_id: row.manpowerId,
					project_id: projectId,
					assignment_id: row.assignmentId,
					periode_mulai: periodeMulai,
					periode_selesai: periodeSelesai,
					jumlah_hari_hadir: row.jumlahHariHadir,
					total_jam: row.totalJam,
					rate_harian: row.rateHarian,
					upah_pokok: row.upahPokok,
					lembur: row.lembur,
					bonus: row.bonus || 0,
					kasbon_potongan: kasbonPotongan,
					kasbon_id: kasbonAktif?.id || null,
					potongan_lain: row.potonganLain || 0,
					total_dibayar: totalDibayar,
					status: 'draft',
					expense_posted: false
				})
			);

			for (const r of existingRows) {
				await directus.request(updateItem('manpower_absensi', r.id, { payroll_id: created.id }));
			}

			result.created.push(created);
		}
		return result;
	} catch (error: any) {
		console.error('createPayrollDraftBatch:', error);
		return { ...result, success: false, error: error.message };
	}
}

/** Batalkan draft: lepas kunci absensi (payroll_id -> null) lalu hapus baris payroll. Hanya untuk status draft. */
export async function cancelPayrollDraft(id: number) {
	try {
		const rows = (await directus.request(
			readItems('manpower_absensi', { fields: ['id'], filter: { payroll_id: { _eq: id } }, limit: -1 })
		)) as any[];
		for (const r of rows) {
			await directus.request(updateItem('manpower_absensi', r.id, { payroll_id: null }));
		}
		await directus.request(deleteItem('manpower_payroll', id));
		return { success: true };
	} catch (error: any) {
		console.error('cancelPayrollDraft:', error);
		return { success: false, error: error.message };
	}
}

/**
 * Simpan tanda tangan pekerja atas rekap upah — gerbang "rekap wajib ditandatangani
 * pekerja" (Akuntabilitas Pembayaran Manpower v3, F0.2) sebelum bisa disetujui, sama
 * seperti jalur ERP (manpowerPayrollApi.js:signPayroll).
 */
export async function signPayrollRun(id: number, dataUrl: string, nama: string = '') {
	try {
		const file = dataUrlToFile(dataUrl, `ttd-payroll-${id}-${Date.now()}.png`);
		const formData = new FormData();
		formData.append('title', `TTD Rekap Upah ${id}`);
		formData.append('file', file);
		const uploadRes: any = await directus.request(uploadFiles(formData as any));
		await directus.request(
			updateItem('manpower_payroll', id, {
				ttd_manpower: uploadRes.id,
				ttd_manpower_at: new Date().toISOString(),
				ttd_nama: nama
			})
		);
		return { success: true };
	} catch (error: any) {
		console.error('signPayrollRun:', error);
		handleDirectusError(error);
		return { success: false, error: error.message };
	}
}

/**
 * Buat pengajuan kas Finance (kategori jasa, satu pekerja = satu baris rincian) dari
 * rekap upah yang disetujui — menutup jalur "gelondongan ke koordinator" (D1). Sama
 * pola dengan ERP manpowerPayrollApi.js:createPengajuanForPayroll, dijalankan di sisi
 * lapangan karena approvePayrollRun() lapangan sebelumnya TIDAK membuat PA sama sekali.
 */
async function createPengajuanForPayrollRun(payroll: any) {
	const manpower = typeof payroll.manpower_id === 'object' ? payroll.manpower_id : null;
	const project = typeof payroll.project_id === 'object' ? payroll.project_id : null;
	const manpowerId = manpower?.id ?? payroll.manpower_id;
	const projectId = project?.id ?? payroll.project_id;
	const assignmentId = typeof payroll.assignment_id === 'object' ? payroll.assignment_id.id : payroll.assignment_id;
	const namaManpower = manpower?.nama || `Manpower #${manpowerId}`;
	const periode = `${payroll.periode_mulai || '-'} – ${payroll.periode_selesai || '-'}`;

	try {
		const nomorPengajuan = await generatePengajuanAnggaranNumber();
		const pa: any = await directus.request(
			createItem('pengajuan_anggaran' as any, {
				nomor_pengajuan: nomorPengajuan,
				nama_pengaju: 'Sistem Rekap Upah Manpower (Lapangan)',
				kategori: 'jasa',
				// Fase 0 (integritas payroll ↔ PA): kategori belanja WAJIB terisi supaya COA
				// item turun dari coa_debit kategori (6131-001 Biaya Gaji), bukan default 'jasa'.
				kategori_belanja: 'gaji_manpower',
				urgency: 'Normal',
				tujuan_pengajuan: `Upah ${namaManpower} periode ${periode} (slip ${payroll.slip_no || payroll.id})`,
				payment_method: manpower?.bank_rekening ? 'Transfer' : 'Cash',
				project_id: projectId || null,
				lokasi_kebutuhan: project?.lokasi || '',
				penerima_dana_type: 'individu',
				penerima_dana_nama: namaManpower,
				bank_name: manpower?.bank_nama || '',
				bank_account_number: manpower?.bank_rekening || '',
				bank_account_name: manpower?.bank_atas_nama || namaManpower,
				status: 'pending',
				source: 'lapangan'
			})
		);
		const pengajuanId = pa?.id;
		if (!pengajuanId) return { success: false, error: 'Gagal membuat pengajuan kas' };

		await directus.request(
			createItem('items_pengajuan_anggaran' as any, {
				pengajuan_anggaran_id: pengajuanId,
				deskripsi: `Upah manpower — ${namaManpower} (${periode})`,
				kategori_item: 'jasa',
				quantity: 1,
				harga: Number(payroll.total_dibayar || 0),
				// Fase 0: COA upah (Biaya Gaji), bukan '5200' generik. Sejalan coa_debit kategori 'gaji_manpower'.
				account_code: '6131-001'
			})
		);

		const grossBasis =
			Number(payroll.upah_pokok || 0) + Number(payroll.lembur || 0) + Number(payroll.bonus || 0);
		await createPengajuanManpowerRows(pengajuanId, [
			{
				assignment_id: assignmentId,
				manpower_id: manpowerId,
				project_id: projectId,
				periode_dari: payroll.periode_mulai,
				periode_sampai: payroll.periode_selesai,
				jumlah: Number(payroll.total_dibayar || 0),
				payroll_id: payroll.id,
				basis_gross: grossBasis,
				potongan_kasbon: Number(payroll.kasbon_potongan || 0),
				potongan_lain: Number(payroll.potongan_lain || 0)
			}
		]);

		return { success: true, pengajuanId };
	} catch (error: any) {
		console.error('createPengajuanForPayrollRun:', error);
		return { success: false, error: error?.message || 'Gagal membuat pengajuan kas' };
	}
}

/**
 * Setujui rekap upah — DIPERKETAT (Akuntabilitas Pembayaran Manpower v3, F0.2): dulu
 * hanya PATCH status='disetujui' tanpa cek TTD dan tanpa membuat PA sama sekali, beda
 * dengan jalur ERP. Sekarang wajib TTD pekerja dulu, lalu otomatis membuat pengajuan
 * kas ke Finance (per pekerja, bukan gelondongan) — jalur "disetujui" telanjang dihapus.
 */
export async function approvePayrollRun(id: number) {
	try {
		const rows = (await directus.request(
			readItems('manpower_payroll', {
				fields: PAYROLL_RUN_FIELDS,
				filter: { id: { _eq: id } },
				limit: 1
			})
		)) as any[];
		const payroll = rows?.[0];
		if (!payroll) return { success: false, error: 'Payroll tidak ditemukan' };
		if (!payroll.ttd_manpower) {
			return { success: false, error: 'Rekap belum ditandatangani pekerja. Minta pekerja TTD di layar dulu.' };
		}

		const pengajuanResult = await createPengajuanForPayrollRun(payroll);
		const patchData: Record<string, any> = { status: 'disetujui' };
		if (pengajuanResult.success) patchData.pengajuan_anggaran_id = pengajuanResult.pengajuanId;

		await directus.request(updateItem('manpower_payroll', id, patchData));

		return {
			success: true,
			warning: !pengajuanResult.success,
			message: pengajuanResult.success
				? 'Gajian disetujui & pengajuan kas ke Finance dibuat otomatis'
				: `Gajian disetujui, TAPI gagal membuat pengajuan kas otomatis: ${pengajuanResult.error}. Buat manual di Finance.`
		};
	} catch (error: any) {
		console.error('approvePayrollRun:', error);
		return { success: false, error: error.message };
	}
}

/**
 * Posting biaya final: hapus akrual harian (project_expenses source_type=manpower_accrual) milik
 * baris absensi yang terkunci ke payroll ini, lalu buat SATU baris biaya final
 * (source_type=payroll) sebagai gantinya — supaya tidak dobel hitung dengan akrual harian yang
 * sudah pernah diposting saat absensi disimpan.
 */
export async function postPayrollPayment(id: number, opts: { metodeBayar: string; dibayarOleh: string }) {
	try {
		const payrollRows = (await directus.request(
			readItems('manpower_payroll', { fields: ['*'], filter: { id: { _eq: id } }, limit: 1 })
		)) as any[];
		const payroll = payrollRows?.[0];
		if (!payroll) return { success: false, error: 'Payroll tidak ditemukan' };
		if (payroll.status === 'dibayar') return { success: false, error: 'Payroll ini sudah dibayar sebelumnya' };
		// Fase 0 (0.6, T5): slip yang sudah diajukan ke Finance sebagai pengajuan kas TIDAK
		// boleh ditandai dibayar manual dari lapangan — pembayaran & posting biaya menunggu
		// Finance mengonfirmasi transfer (confirmTransfer → finalizePayrollFromPengajuan).
		// Tanpa guard ini: dobel biaya + slip dianggap lunas padahal kas belum keluar.
		if (payroll.pengajuan_anggaran_id) {
			return {
				success: false,
				error: 'Slip ini sudah diajukan ke Finance sebagai pengajuan kas — pembayaran & posting biaya menunggu Finance mengonfirmasi transfer, bukan ditandai manual di sini.'
			};
		}

		// F0.3 (Akuntabilitas Pembayaran Manpower v3): pagu bayar tunai di lokasi — di atas
		// ambang wajib lewat transfer (rekening pekerja), bukan tunai tanpa jejak bank.
		const biayaFinalCek = Number(payroll.upah_pokok || 0) + Number(payroll.lembur || 0) + Number(payroll.bonus || 0);
		const metodeTunai = ['cash', 'tunai'].includes(String(opts.metodeBayar || '').toLowerCase());
		const paguTunai = Number(getManpowerSetting('manpower.tunai_pagu_harian')) || 0;
		if (metodeTunai && paguTunai > 0 && biayaFinalCek > paguTunai) {
			return {
				success: false,
				error: `Nominal Rp${biayaFinalCek.toLocaleString('id-ID')} melebihi pagu bayar tunai (Rp${paguTunai.toLocaleString('id-ID')}). Gunakan transfer ke rekening pekerja.`
			};
		}

		const absensiRows = (await directus.request(
			readItems('manpower_absensi', { fields: ['id', 'expense_id'], filter: { payroll_id: { _eq: id } }, limit: -1 })
		)) as any[];

		for (const row of absensiRows) {
			const expenseId = asId(row.expense_id);
			if (expenseId) {
				await directus.request(deleteItem('project_expenses', expenseId));
				await directus.request(updateItem('manpower_absensi', row.id, { expense_id: null }));
			}
		}

		const biayaFinal = Number(payroll.upah_pokok || 0) + Number(payroll.lembur || 0) + Number(payroll.bonus || 0);
		let expenseId: number | null = null;
		if (biayaFinal > 0) {
			const manpowerId = asId(payroll.manpower_id);
			let manpowerNama = '';
			if (manpowerId) {
				try {
					const mpRows = (await directus.request(
						readItems('manpower', {
							fields: ['id', 'nama'],
							filter: { id: { _eq: manpowerId } },
							limit: 1
						})
					)) as any[];
					manpowerNama = mpRows?.[0]?.nama || '';
				} catch (e) {
					console.warn('Gagal mengambil nama manpower untuk gajian:', e);
				}
			}

			const slipLabel = payroll.slip_no || `#${id}`;
			const desc = manpowerNama
				? `Gajian ${manpowerNama} (${slipLabel}) periode ${payroll.periode_mulai} s/d ${payroll.periode_selesai}`
				: `Gajian manpower #${manpowerId} periode ${payroll.periode_mulai} s/d ${payroll.periode_selesai} (payroll #${id})`;

			const created: any = await directus.request(
				createItem('project_expenses', {
					project_id: payroll.project_id,
					expense_date: payroll.periode_selesai,
					expense_type: 'jasa',
					expense_category: 'Jasa',
					description: desc,
					pic: manpowerNama || null,
					expense_amount: biayaFinal,
					debit_amount: biayaFinal,
					source: 'payroll',
					source_type: 'payroll',
					is_accrual: false,
					manpower_id: manpowerId,
					ref_payroll_id: id
				})
			);
			expenseId = created.id;
		}

		await directus.request(
			updateItem('manpower_payroll', id, {
				status: 'dibayar',
				metode_bayar: opts.metodeBayar,
				dibayar_oleh: opts.dibayarOleh,
				dibayar_at: new Date().toISOString(),
				expense_posted: true,
				expense_id: expenseId
			})
		);

		// Fase 3 (R1): kasbon formal berkurang begitu gajian benar-benar dibayar (bukan saat draft
		// dibuat) — konsisten dengan pola processPayoutForEmployee di payroll karyawan.
		const kasbonId = asId(payroll.kasbon_id);
		const potonganKasbon = Number(payroll.kasbon_potongan) || 0;
		if (kasbonId && potonganKasbon > 0) {
			try {
				const kasbonRows = (await directus.request(
					readItems('kasbon', { fields: ['id', 'nominal', 'total_paid'], filter: { id: { _eq: kasbonId } }, limit: 1 })
				)) as any[];
				const kasbon = kasbonRows?.[0];
				if (kasbon) {
					const totalPaidBaru = Number(kasbon.total_paid || 0) + potonganKasbon;
					const lunas = totalPaidBaru >= Number(kasbon.nominal || 0);
					await directus.request(
						updateItem('kasbon', kasbonId, {
							total_paid: totalPaidBaru,
							payment_status: lunas ? 'lunas' : 'berjalan',
							last_payment_date: payroll.periode_selesai
						})
					);
					await directus.request(
						createItem('kasbon_payment_log', {
							kasbon_id: kasbonId,
							manpower_id: payroll.manpower_id,
							periode: String(payroll.periode_selesai).slice(0, 7),
							nominal_potongan: potonganKasbon,
							tanggal: payroll.periode_selesai
						})
					);
				}
			} catch (kasbonErr) {
				console.error('postPayrollPayment: gagal update kasbon manpower', kasbonErr);
			}
		}

		return { success: true, expenseId };
	} catch (error: any) {
		console.error('postPayrollPayment:', error);
		return { success: false, error: error.message };
	}
}
