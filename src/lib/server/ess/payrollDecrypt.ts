// src/lib/server/ess/payrollDecrypt.ts
// Replikasi decryptSensitiveRecord() dari erp-epi-1/src/lib/services/hrdPayrollApi.js —
// men-decrypt payload_terenkripsi payroll_bulanan server-side.

import { getServerDEK } from '$lib/server/ess/payrollUnlock';
import { decryptJSON } from '$lib/server/ess/payrollCrypto';

const PAYROLL_SENSITIVE_FIELDS = [
	'gaji_pokok', 'tunjangan_jabatan', 'tunjangan_makan', 'tunjangan_transport',
	'tunjangan_lainnya', 'uang_lembur', 'reimbursement', 'insentif_bonus', 'kpi_bonus', 'potongan_terlambat',
	'potongan_alpa', 'potongan_bpjs_kesehatan', 'potongan_bpjs_ketenagakerjaan',
	'potongan_pph21', 'potongan_kasbon', 'potongan_lainnya', 'tunjangan', 'potongan', 'gaji_bersih'
];

export async function decryptPayrollRecord<T extends Record<string, any>>(record: T): Promise<T> {
	if (!record?.payload_terenkripsi) return record;
	try {
		const dek = await getServerDEK();
		const sensitive = await decryptJSON<Record<string, any>>(record.payload_terenkripsi, dek);
		return { ...record, ...sensitive };
	} catch {
		// DEK tidak tersedia/salah -> jangan crash, tampilkan angka ter-nol apa adanya
		return record;
	}
}

export async function decryptPayrollList<T extends Record<string, any>>(list: T[]): Promise<T[]> {
	return Promise.all((list || []).map(decryptPayrollRecord));
}

export { PAYROLL_SENSITIVE_FIELDS };
