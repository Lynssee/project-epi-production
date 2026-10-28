// src/lib/services/ess/hrdChecklist.ts
// Definisi kisi-kisi kelengkapan dokumen karyawan untuk ESS — disinkronkan manual dengan
// REQUIRED_DOCS di HrdDokumen.svelte (erp-epi-1, admin app). Kalau daftar dokumen berubah
// di sana, update juga di sini.

export interface RequiredDoc {
	value: string;
	label: string;
	short: string;
	category: 'permanen' | 'perpanjangan';
	optional?: boolean;
}

export const REQUIRED_DOCS: RequiredDoc[] = [
	// Kategori 1: Dokumen Permanen (tidak perlu perpanjang)
	{ value: 'ktp', label: 'KTP', short: 'KT', category: 'permanen' },
	{ value: 'ijazah', label: 'Ijazah', short: 'IJ', category: 'permanen' },
	{ value: 'kk', label: 'KK', short: 'K3', category: 'permanen' },
	{ value: 'npwp', label: 'NPWP', short: 'NP', category: 'permanen', optional: true },
	{ value: 'pas_foto', label: 'Pas Foto', short: 'PF', category: 'permanen' },
	{ value: 'ttd_digital', label: 'Tanda Tangan Digital', short: 'TD', category: 'permanen', optional: true },

	// Kategori 2: Dokumen Perpanjangan & Masa Berlaku
	{ value: 'offering_letter', label: 'Offering Letter', short: 'OL', category: 'perpanjangan' },
	{ value: 'lampiran_gaji', label: 'Lampiran Gaji', short: 'LG', category: 'perpanjangan' },
	{ value: 'kontrak_kerja', label: 'Kontrak Kerja', short: 'KK', category: 'perpanjangan' },
	{ value: 'nda', label: 'NDA', short: 'ND', category: 'perpanjangan' },
	{ value: 'pakta_integritas', label: 'Pakta Integritas', short: 'PI', category: 'perpanjangan' },
	{ value: 'surat_keterangan', label: 'Surat Keterangan', short: 'SK', category: 'perpanjangan' },
	{ value: 'bpjs', label: 'BPJS', short: 'BP', category: 'perpanjangan' },
	{ value: 'sertifikat', label: 'Sertifikat', short: 'SF', category: 'perpanjangan', optional: true },
	{ value: 'surat_sanksi', label: 'Surat Sanksi', short: 'SS', category: 'perpanjangan', optional: true },
	{ value: 'bak', label: 'BAK', short: 'BA', category: 'perpanjangan', optional: true }
];

/** Dokumen yang boleh diunggah mandiri oleh karyawan — harus sinkron dengan SELF_UPLOAD_DOKUMEN_TYPES di dokumen.ts. */
export const SELF_UPLOADABLE = new Set(['ktp', 'kk', 'npwp', 'pas_foto', 'ijazah', 'bpjs', 'sertifikat']);

export function isDocRequiredForStatus(docValue: string, statusKerja: string | null | undefined): boolean {
	if (docValue === 'npwp' || docValue === 'sertifikat' || docValue === 'ttd_digital' || docValue === 'surat_sanksi' || docValue === 'bak') return false;
	if (statusKerja === 'Tetap') {
		if (docValue === 'kontrak_kerja') return false;
	} else if (statusKerja === 'Kontrak') {
		if (docValue === 'surat_keterangan') return false;
	} else if (statusKerja === 'Probation' || statusKerja === 'Daily Worker') {
		if (docValue === 'kontrak_kerja' || docValue === 'surat_keterangan') return false;
	}
	return true;
}

export type DocExpiryStatus = 'active' | 'expiring_soon' | 'expired';

export function getDocExpiryStatus(doc?: { tanggal_expired?: string | null } | null): DocExpiryStatus {
	if (!doc?.tanggal_expired) return 'active';
	const expDate = doc.tanggal_expired.split('T')[0];
	const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
	if (expDate < today) return 'expired';
	const d = new Date();
	d.setDate(d.getDate() + 30);
	const thirtyDaysLater = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
	if (expDate <= thirtyDaysLater) return 'expiring_soon';
	return 'active';
}
