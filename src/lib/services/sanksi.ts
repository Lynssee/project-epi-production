import directus, { handleDirectusError } from './directus';
import { readItems, createItem } from '@directus/sdk';

export interface SanksiKaryawan {
	id?: number;
	target_tipe?: string;
	departemen?: string;
	karyawan_id?: number | string;
	karyawan_name: string;
	nik?: string;
	posisi?: string;
	jenis_sanksi: string;
	kategori_pelanggaran: string;
	deskripsi_pelanggaran: string;
	kronologi?: string;
	bukti?: string;
	saksi?: string;
	status: string;
	tindakan_perbaikan?: string;
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
				fields: ['id', 'karyawan_id', 'karyawan_name', 'target_tipe', 'departemen', 'jenis_sanksi', 'tanggal_berakhir', 'status'],
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
 * Fetch active department sanctions (target_tipe = 'departemen' & status = 'Aktif')
 */
export async function getActiveDepartmentSanctions(departemen?: string): Promise<SanksiKaryawan[]> {
	try {
		const filter: Record<string, any> = {
			target_tipe: { _eq: 'departemen' },
			status: { _eq: 'Aktif' }
		};
		if (departemen) {
			filter.departemen = { _eq: departemen };
		}
		const result = await directus.request(
			readItems('sanksi_karyawan', {
				filter,
				fields: [
					'id', 'target_tipe', 'departemen', 'karyawan_name', 'jenis_sanksi',
					'kategori_pelanggaran', 'deskripsi_pelanggaran', 'tindakan_perbaikan',
					'tanggal_berlaku', 'tanggal_berakhir', 'status', 'diterbitkan_oleh'
				],
				limit: 10
			})
		);
		return (result || []) as SanksiKaryawan[];
	} catch (error) {
		console.warn('[sanksi.ts] Gagal memuat sanksi departemen:', error);
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
