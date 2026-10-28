// src/lib/utils/timelineExcelExport.ts
import * as XLSX from 'xlsx';
import { formatDateKey } from './workingDays';

export interface ExportTimelineParams {
	project: any;
	categories?: any[];
	dateRange?: any[];
	showActual?: boolean;
}

export function exportTimelineToExcel({
	project,
	categories = [],
	dateRange = [],
	showActual = true
}: ExportTimelineParams): boolean {
	if (!categories || categories.length === 0) {
		throw new Error('Tidak ada data aktivitas timeline untuk diekspor.');
	}

	const wb = XLSX.utils.book_new();

	// 1. Format metadata header
	const projectName = project?.name || 'Proyek';
	const poNumber = project?.nomor_po || '-';
	const customer = project?.customer?.name || (typeof project?.customer === 'string' ? project.customer : '-');
	const leader = project?.leader_id?.nama || project?.leader || '-';
	const startDateStr = project?.start_date ? String(project.start_date).split('T')[0] : '-';
	const endDateStr = project?.end_date ? String(project.end_date).split('T')[0] : '-';
	const totalDays = dateRange.length;

	const wsData: any[][] = [];

	// Judul & Info Proyek
	wsData.push(['TIMELINE PLANNING & AKTUAL PROYEK']);
	wsData.push(['Nama Proyek', projectName, '', 'Customer', customer]);
	wsData.push(['Nomor PO', poNumber, '', 'Project Leader', leader]);
	wsData.push(['Tanggal Mulai', startDateStr, '', 'Tanggal Selesai', endDateStr]);
	wsData.push(['Total Durasi', `${totalDays} Hari`, '', 'Tanggal Cetak', new Date().toLocaleDateString('id-ID')]);
	wsData.push([]); // Baris kosong

	// 2. Kolom Header Tabel
	const fixedHeadersRow1 = [
		'No',
		'Kategori Task',
		'Vol Task',
		'Satuan Task',
		'Prog Plan Task (%)',
		'Prog Act Task (%)',
		'Subtask',
		'Vol Sub',
		'Satuan Sub',
		'Total Hari',
		'Tipe',
		'Prog Sub (%)',
		'Keterangan'
	];

	const fixedHeadersRow2 = [
		'',
		'',
		'',
		'',
		'',
		'',
		'',
		'',
		'',
		'',
		'',
		'',
		''
	];

	// Buat header tanggal
	const dateHeadersRow1: string[] = [];
	const dateHeadersRow2: string[] = [];

	dateRange.forEach((d: any) => {
		const date = d instanceof Date ? d : (d?.dateStr ? new Date(d.dateStr) : new Date(d));
		const dayStr = String(date.getDate()).padStart(2, '0');
		const monthStr = String(date.getMonth() + 1).padStart(2, '0');
		const yearStr = String(date.getFullYear());
		const weekday = date.toLocaleDateString('id-ID', { weekday: 'short' });

		dateHeadersRow1.push(`${monthStr}/${yearStr}`);
		dateHeadersRow2.push(`${dayStr} (${weekday})`);
	});

	wsData.push([...fixedHeadersRow1, ...dateHeadersRow1]);
	wsData.push([...fixedHeadersRow2, ...dateHeadersRow2]);

	// 3. Baris Data (Loop Kategori & Subtask)
	categories.forEach((cat: any, catIdx: number) => {
		const catNo = String.fromCharCode(65 + (catIdx % 26)) + (catIdx >= 26 ? Math.floor(catIdx / 26) : '');
		const catName = cat.name || '';
		const catVol = cat.volume != null ? Number(cat.volume) : '';
		const catUnit = cat.unit || '';

		// Hitung progress kategori
		let catPlanProg = 0;
		let catActProg = 0;
		if (cat.subtasks && cat.subtasks.length > 0) {
			let totalSubPlan = 0;
			let totalSubAct = 0;
			cat.subtasks.forEach((s: any) => {
				const sVol = parseFloat(s.volume) || 0;
				let sumP = 0;
				let sumA = 0;
				if (s.daily_plan) Object.values(s.daily_plan).forEach((v: any) => { sumP += (parseFloat(v) || 0); });
				if (s.daily_actual) Object.values(s.daily_actual).forEach((v: any) => { sumA += (parseFloat(v) || 0); });
				const progP = sVol > 0 ? Math.min(100, (sumP / sVol) * 100) : 0;
				const progA = sVol > 0 ? Math.min(100, (sumA / sVol) * 100) : 0;
				totalSubPlan += progP;
				totalSubAct += progA;
			});
			catPlanProg = totalSubPlan / cat.subtasks.length;
			catActProg = totalSubAct / cat.subtasks.length;
		}

		if (cat.subtasks && cat.subtasks.length > 0) {
			cat.subtasks.forEach((sub: any, subIdx: number) => {
				const isFirstSub = subIdx === 0;
				const subName = sub.name || '';
				const subVol = sub.volume != null ? Number(sub.volume) : '';
				const subUnit = sub.unit || '';
				const ket = sub.keterangan || '';

				// Hitung total hari & progress subtask
				let planDays = 0;
				let sumPlan = 0;
				let sumAct = 0;
				if (sub.daily_plan) {
					Object.values(sub.daily_plan).forEach((v: any) => {
						const num = parseFloat(v) || 0;
						if (num > 0) planDays++;
						sumPlan += num;
					});
				}
				if (sub.daily_actual) {
					Object.values(sub.daily_actual).forEach((v: any) => {
						sumAct += (parseFloat(v) || 0);
					});
				}

				const subPlanProg = subVol > 0 ? Math.min(100, (sumPlan / subVol) * 100) : 0;
				const subActProg = subVol > 0 ? Math.min(100, (sumAct / subVol) * 100) : 0;

				// Baris PLAN
				const planRow = [
					isFirstSub ? catNo : '',
					isFirstSub ? catName : '',
					isFirstSub ? catVol : '',
					isFirstSub ? catUnit : '',
					isFirstSub ? Number(catPlanProg.toFixed(2)) : '',
					isFirstSub ? Number(catActProg.toFixed(2)) : '',
					subName,
					subVol,
					subUnit,
					planDays,
					'PLAN',
					Number(subPlanProg.toFixed(2)),
					ket
				];

				// Tanggal Plan
				dateRange.forEach((d: any) => {
					const dateObj = d instanceof Date ? d : (d?.dateStr ? new Date(d.dateStr) : new Date(d));
					const dKey = formatDateKey(dateObj);
					const val = sub.daily_plan ? sub.daily_plan[dKey] : null;
					planRow.push(val != null && val !== '' && !isNaN(Number(val)) ? Number(val) : '');
				});
				wsData.push(planRow);

				// Baris AKTUAL (jika showActual)
				if (showActual) {
					const actRow = [
						'',
						'',
						'',
						'',
						'',
						'',
						'',
						'',
						'',
						'',
						'ACT',
						Number(subActProg.toFixed(2)),
						''
					];
					dateRange.forEach((d: any) => {
						const dateObj = d instanceof Date ? d : (d?.dateStr ? new Date(d.dateStr) : new Date(d));
						const dKey = formatDateKey(dateObj);
						const val = sub.daily_actual ? sub.daily_actual[dKey] : null;
						actRow.push(val != null && val !== '' && !isNaN(Number(val)) ? Number(val) : '');
					});
					wsData.push(actRow);
				}
			});
		} else {
			// Kategori tanpa subtask
			const emptyRow = [
				catNo,
				catName,
				catVol,
				catUnit,
				'',
				'',
				'(Belum ada subtask)',
				'',
				'',
				'',
				'PLAN',
				'',
				''
			];
			dateRange.forEach(() => emptyRow.push(''));
			wsData.push(emptyRow);
		}
	});

	// Buat Worksheet
	const ws = XLSX.utils.aoa_to_sheet(wsData);

	// Setup lebar kolom
	const colWidths = [
		{ wch: 5 },   // No
		{ wch: 22 },  // Kategori Task
		{ wch: 10 },  // Vol Task
		{ wch: 10 },  // Satuan Task
		{ wch: 16 },  // Prog Plan Task
		{ wch: 16 },  // Prog Act Task
		{ wch: 26 },  // Subtask
		{ wch: 10 },  // Vol Sub
		{ wch: 10 },  // Satuan Sub
		{ wch: 10 },  // Total Hari
		{ wch: 8 },   // Tipe
		{ wch: 12 },  // Prog Sub
		{ wch: 20 }   // Keterangan
	];

	dateRange.forEach(() => {
		colWidths.push({ wch: 8 });
	});

	ws['!cols'] = colWidths;

	// Append sheet ke workbook
	XLSX.utils.book_append_sheet(wb, ws, 'Timeline Jadwal');

	// Tulis dan download file
	const safeProjectName = (project?.name || 'Timeline').replace(/[/\\?%*:|"<>]/g, '-');
	const filename = `Timeline_${safeProjectName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
	XLSX.writeFile(wb, filename);

	return true;
}
