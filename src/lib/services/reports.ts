import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem } from '@directus/sdk';

export async function getReports(
	projectId?: string | number,
	options: { limit?: number; offset?: number; search?: string; sort?: string; filterStatus?: string; fields?: string[]; date?: string } = {}
) {
	try {
		const filter: Record<string, any> = {};
		if (projectId) {
			filter.project_id = { _eq: projectId };
		}
		// Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — dipakai "Salin Komposisi Kemarin".
		if (options.date) {
			filter.date = { _eq: options.date };
		}

		if (options.search) {
			const q = options.search.trim();
			filter._or = [
				{ pekerjaan_dilakukan: { _icontains: q } },
				{ kendala: { _icontains: q } },
				{ cuaca: { _icontains: q } }
			];
		}
		
		if (options.filterStatus) {
			filter.status = { _eq: options.filterStatus };
		}

		const queryOptions: any = {
			filter,
			sort: options.sort ? [options.sort] : ['-date_created'],
			limit: options.limit || 50
		};
		
		if (options.offset !== undefined) {
			queryOptions.offset = options.offset;
		}
		// PRJ-18: tanpa `fields` Directus mengirim SEMUA kolom (foto, JSON manpower/material/budget). Pemanggil yang hanya
		// butuh sebagian (mis. perhitungan progres kumulatif) wajib menyebutkannya.
		if (options.fields && options.fields.length) {
			queryOptions.fields = options.fields;
		}

		const result = await directus.request(
			readItems('reports', queryOptions)
		);
		return result || []; // array directly
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getBatchedReports(
	projectIds: (string | number)[],
	options: { startDate?: string; endDate?: string; limit?: number; fields?: string[] } = {}
) {
	try {
		if (!projectIds || projectIds.length === 0) return [];
		
		const chunkSize = 50;
		const results: any[] = [];
		for (let i = 0; i < projectIds.length; i += chunkSize) {
			const chunk = projectIds.slice(i, i + chunkSize);
			const chunkFilter: Record<string, any> = {
				project_id: { _in: chunk as string[] }
			};

			if (options.startDate && options.endDate) {
				if (options.startDate === options.endDate) {
					chunkFilter.date = { _eq: options.startDate };
				} else {
					chunkFilter.date = { _between: [options.startDate, options.endDate] };
				}
			} else if (options.startDate) {
				chunkFilter.date = { _gte: options.startDate };
			} else if (options.endDate) {
				chunkFilter.date = { _lte: options.endDate };
			}

			const result = await directus.request(
				readItems('reports', {
					filter: chunkFilter,
					fields: options.fields || ['id', 'project_id', 'date', 'date_created', 'manpower'],
					sort: ['-date_created'],
					limit: options.limit !== undefined ? options.limit : -1
				})
			);
			results.push(...(result || []));
		}
		return results;
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Optimasi khusus cek status laporan hari ini.
 * Hanya mengambil field minimal ('id', 'project_id', 'date') dengan filter tanggal hari ini.
 */
export async function getBatchedTodayReports(projectIds: (string | number)[], todayDateStr?: string) {
	if (!projectIds || projectIds.length === 0) return [];
	const tzOffset = (new Date()).getTimezoneOffset() * 60000;
	const today = todayDateStr || new Date(Date.now() - tzOffset).toISOString().split('T')[0];
	return getBatchedReports(projectIds, {
		startDate: today,
		endDate: today,
		fields: ['id', 'project_id', 'date'],
		limit: -1
	});
}

export async function getReportByProjectAndDate(projectId: string | number, date: string) {
	try {
		const result = await directus.request(
			readItems('reports', {
				filter: {
					project_id: { _eq: projectId },
					date: { _eq: date }
				},
				limit: 1
			})
		);
		return result.length > 0 ? result[0] : null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function getReportById(id: string | number) {
	try {
		const result = await directus.request(readItem('reports', id));
		return result || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

// Fase 3 (Loop Perbaikan, Gate Keras Disiplin Data & Laporan Harian, 17 Sep 2026) —
// laporan milik leader ini yang butuh perbaikan: revision_requested (loop aktif) atau
// rejected (final, tapi tetap perlu ditampilkan supaya leader tahu kenapa).
export async function getReportsNeedingFix(karyawanId: string | number, projectIds: (string | number)[]) {
	if (!karyawanId && (!projectIds || projectIds.length === 0)) return [];
	try {
		const result = await directus.request(
			readItems('reports', {
				filter: {
					status: { _in: ['revision_requested', 'rejected'] },
					_or: [
						...(karyawanId ? [{ karyawan_id: { _eq: karyawanId } }] : []),
						...(projectIds && projectIds.length ? [{ project_id: { _in: projectIds } }] : [])
					]
				},
				fields: ['id', 'project_id', 'date', 'status', 'rejection_note', 'revisi_diminta_at', 'revisi_batas', 'revisi_count', 'quality_flags'],
				sort: ['-date'],
				limit: 100
			})
		);
		return result || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function submitReport(reportData: any) {
	try {
		const result = await directus.request(createItem('reports', reportData));
		// UX-05 (correction plan site-visit-payroll, 27 Sep 2026): SEBELUMNYA laporan
		// tersimpan langsung menutup check-in aktif diam-diam (triggerAutoCheckout otomatis
		// di sini), walau leader masih di lokasi — auto_checkout_on_report tidak pernah benar-
		// benar dibaca/di-gate. Sekarang caller (halaman laporan) yang memutuskan lewat
		// prompt "Masih di lokasi?" setelah submit sukses, bukan modul ini diam-diam.
		return result;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function updateReport(id: number, data: Partial<any>) {
	try {
		return await directus.request(updateItem('reports', id, data));
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function uploadFile(file: File) {
	try {
		const formData = new FormData();
		formData.append('file', file);
		const { uploadFiles } = await import('@directus/sdk');
		const result = await directus.request(uploadFiles(formData));
		return result;
	} catch (error: any) {
		console.error('Gagal mengunggah file:', error);
		const detail = error?.errors?.[0]?.message || error?.message || 'Unknown error';
		throw new Error(`Upload gagal untuk file "${file.name}": ${detail}`);
	}
}

export async function getReportsByDateRange(projectIds: (string | number)[], startDate: string, endDate: string) {
	try {
		if (!projectIds || projectIds.length === 0) return [];
		
		const chunkSize = 50;
		const results: any[] = [];
		for (let i = 0; i < projectIds.length; i += chunkSize) {
			const chunk = projectIds.slice(i, i + chunkSize);
			const result = await directus.request(
				readItems('reports', {
					filter: {
						project_id: { _in: chunk as string[] },
						date: { _between: [startDate, endDate] }
					},
					sort: ['-date'],
					limit: -1
				})
			);
			results.push(...(result || []));
		}
		return results;
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}
