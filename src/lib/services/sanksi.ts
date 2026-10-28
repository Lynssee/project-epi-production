import directus, { handleDirectusError } from './directus';
import { readItems, createItem } from '@directus/sdk';

export interface SanksiKaryawan {
	id?: number;
	karyawan_id?: number | string;
	karyawan_name: string;
	nik?: string;
	posisi?: string;
	departemen?: string;
	jenis_sanksi: string;
	kategori_pelanggaran: string;
	deskripsi_pelanggaran: string;
	kronologi?: string;
	bukti?: string;
	saksi?: string;
	status: string;
	tanggal_kejadian?: string;
	tanggal_sanksi?: string;
	tanggal_berlaku?: string;
	tanggal_berakhir?: string;
	diterbitkan_oleh?: string;
	jabatan_penerbit?: string;
	diketahui_oleh?: string;
}

/**
 * Fetch all active sanctions (status = 'Aktif')
 */
export async function getActiveSanctions(): Promise<SanksiKaryawan[]> {
	try {
		const result = await directus.request(
			readItems('sanksi_karyawan', {
				filter: {
					status: { _eq: 'Aktif' }
				},
				fields: ['id', 'karyawan_id', 'karyawan_name', 'jenis_sanksi', 'tanggal_berakhir', 'status'],
				limit: -1
			})
		);
		return (result || []) as SanksiKaryawan[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Submit a violation report (creates a sanksi record in 'Draft' status)
 */
export async function createViolationReport(data: Partial<SanksiKaryawan>): Promise<{ data: any; success: boolean; error?: string }> {
	try {
		const payload = {
			...data,
			status: 'Draft', // Field reports are always submitted as Draft for HRD review
			tanggal_sanksi: new Date().toISOString().split('T')[0],
			tanggal_berlaku: new Date().toISOString().split('T')[0]
		};
		const result = await directus.request(createItem('sanksi_karyawan', payload));
		return { data: result, success: true };
	} catch (error: any) {
		console.error('createViolationReport:', error);
		return { data: null, success: false, error: error.message };
	}
}
