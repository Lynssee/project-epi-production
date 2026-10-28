<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { IconCalendar, IconLoader2, IconRefresh, IconFileExport, IconPhoto, IconHistory, IconCash, IconX, IconCheck } from '@tabler/icons-svelte';
	import { getAssignments, updateAssignment } from '$lib/services/manpowerAssignment';
	import { recapAbsensiFromReports, upsertTimesheetAbsensi, deleteAbsensiEntry } from '$lib/services/manpowerAbsensi';
	import { createPengajuanAnggaran } from '$lib/services/finance';
	import RekeningSelect from '$lib/components/anggaran/RekeningSelect.svelte';
	import { ajukanKasbonManpower } from '$lib/services/ess/manpowerKasbon';
	import { authStore, getUserDisplay } from '$lib/stores/auth';
	import directus from '$lib/services/directus';
	import { readItems, createItem, uploadFiles } from '@directus/sdk';
	import { get } from 'svelte/store';
	import PayrollRunManager from './PayrollRunManager.svelte';
	import PdfBlobViewer from './PdfBlobViewer.svelte';

	let { projectId, projectName = '' } = $props<{ projectId: string | number; projectName?: string }>();

	let loading = $state(false);
	let recapping = $state(false);
	let exporting = $state(false);
	let exportingExcel = $state(false);
	let previewBlob = $state<Blob | null>(null);
	let previewTitle = $state<string>('');
	let showPdfPreview = $state(false);
	
	// Default to 14 days ago up to today, tapi tanggal mulai & selesai bisa diatur bebas
	// (mis. dari akhir bulan ini sampai awal bulan depan) — sementara membantu input manual.
	let startDate = $state((() => {
		const d = new Date();
		d.setDate(d.getDate() - 13);
		return d.toISOString().split('T')[0];
	})());
	let endDate = $state((() => {
		const d = new Date();
		return d.toISOString().split('T')[0];
	})());

	let dates = $derived.by(() => {
		const start = new Date(startDate);
		const end = new Date(endDate);
		const result = [];
		const d = new Date(start);
		while (d <= end) {
			result.push({
				dateStr: d.toISOString().split('T')[0],
				hari: d.toLocaleDateString('id-ID', { weekday: 'long' }),
				tanggal: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
				isSunday: d.getDay() === 0
			});
			d.setDate(d.getDate() + 1);
		}
		return result;
	});

	// Catatan bebas untuk lampiran rekap (mis. "gapok sehari", "stand by 9 bkn 8") — diisi manual
	// oleh leader, tampil di footer PDF & sheet Excel, tidak disimpan ke Directus (khusus dokumen ekspor).
	let recapNotes = $state('');

	let workers = $state<any[]>([]);
	let absensiData = $state<Map<string, any>>(new Map()); // key: workerId_date
	let dirtyKeys = $state<Set<string>>(new Set()); // key: workerId_date, sel yang diedit tapi belum disimpan
	let existingAbsensiKeys = $state<Set<string>>(new Set()); // key yang sudah punya baris di DB saat terakhir dimuat
	let savingAbsensi = $state(false);
	let savingRateFor = $state<Set<any>>(new Set()); // worker.id yang rate lembur-nya sedang disimpan

	// Fase 3 (R1, T6): kasbon pekerja lapangan lewat modul formal, bukan sel manual lagi.
	let showKasbonModal = $state(false);
	let kasbonManpowerId = $state<any>('');
	let kasbonNominal = $state<number | null>(null);
	let kasbonTenor = $state(1);
	let kasbonKeterangan = $state('');
	let kasbonSubmitting = $state(false);
	let kasbonError = $state('');
	let kasbonSuccess = $state(false);

	function openKasbonModal() {
		kasbonManpowerId = workers[0]?.id ?? '';
		kasbonNominal = null;
		kasbonTenor = 1;
		kasbonKeterangan = '';
		kasbonError = '';
		kasbonSuccess = false;
		showKasbonModal = true;
	}

	async function submitKasbonModal() {
		if (!kasbonManpowerId || !kasbonNominal || kasbonNominal <= 0 || !kasbonTenor || !kasbonKeterangan.trim()) {
			kasbonError = 'Lengkapi pekerja, nominal, tenor, dan alasan.';
			return;
		}
		kasbonSubmitting = true;
		kasbonError = '';
		try {
			const worker = workers.find((w: any) => String(w.id) === String(kasbonManpowerId));
			await ajukanKasbonManpower({
				manpowerId: Number(kasbonManpowerId),
				manpowerNama: worker?.nama || '',
				nominal: kasbonNominal,
				tenor: kasbonTenor,
				keterangan: kasbonKeterangan.trim()
			});
			kasbonSuccess = true;
		} catch (err: any) {
			kasbonError = err?.message || 'Gagal mengajukan kasbon.';
		} finally {
			kasbonSubmitting = false;
		}
	}

	const formatRp = (val: number) => {
		if (!val) return '0';
		return new Intl.NumberFormat('id-ID').format(val);
	};

	// Total per pekerja untuk rentang tanggal yang sedang ditampilkan — dipakai bersama oleh
	// ekspor PDF/PNG dan tombol "Ajukan Anggaran Gaji" supaya nominalnya selalu konsisten.
	let workerTotals = $derived.by(() => {
		return workers.map((w) => {
			let tIn = 0, tOt = 0, tSb = 0, tUm = 0, kasbon = 0;
			for (const d of dates) {
				const c = absensiData.get(`${w.id}_${d.dateStr}`);
				tIn += c?.in_val || 0;
				tOt += c?.ot_hours || 0;
				tSb += c?.sb_val || 0;
				tUm += c?.um_val || 0;
				kasbon += c?.kasbon_val || 0;
			}
			const subtotal = tIn * w.rate_upah + tOt * w.rate_lembur + tSb * w.rate_sb + tUm * w.rate_um;
			return { tIn, tOt, tSb, tUm, subtotal, kasbon, final: subtotal - kasbon };
		});
	});

	let grandTotal = $derived(workerTotals.reduce((sum, t) => sum + t.final, 0));

	async function loadData() {
		loading = true;
		dirtyKeys = new Set();
		try {
			// 1. Fetch Assignments for this project
			const assignmentsRes = await getAssignments({ project_id: Number(projectId), status: 'aktif' });
			const rawWorkers = assignmentsRes.success ? assignmentsRes.data : [];
			
			// Map to structured workers
			workers = rawWorkers.map((a: any) => {
				return {
					id: a.manpower_id?.id ?? a.manpower_id,
					assignmentId: a.id,
					nama: a.manpower_id?.nama || `#${a.id}`,
					jabatan: a.jabatan || a.manpower_id?.posisi || 'Pekerja',
					// Rate assignment priority over master
					rate_upah: Number(a.rate_harian || a.rate_upah_harian || a.manpower_id?.rate_upah_harian || 0),
					rate_lembur: Number(a.rate_lembur || a.manpower_id?.rate_lembur || 0),
					rate_sb: Number(a.rate_standby || a.manpower_id?.rate_standby || 0),
					rate_um: Number(a.rate_uang_makan || 0),
				};
			});

			if (workers.length === 0 || dates.length === 0) {
				loading = false;
				return;
			}

			// 2. Fetch Absensi in date range
			const endDateStr = dates[dates.length - 1].dateStr;
			const absensiRes = await directus.request(
				readItems('manpower_absensi', {
					filter: {
						project_id: { _eq: Number(projectId) },
						tanggal: { _between: [dates[0].dateStr, endDateStr] }
					},
					limit: -1
				})
			);

			const newAbsensiMap = new Map();
			const newExistingKeys = new Set<string>();
			for (const row of (absensiRes || [])) {
				const wId = typeof row.manpower_id === 'object' ? row.manpower_id?.id : row.manpower_id;
				const aId = typeof row.assignment_id === 'object' ? row.assignment_id?.id : row.assignment_id;
				const tgl = String(row.tanggal || '').slice(0, 10);
				const cellData = {
					in_val: row.is_standby ? 0 : (row.status === 'hadir' ? (row.is_holiday ? 1.5 : 1) : (Number(row.jam_kerja) > 0 ? (row.is_holiday ? 1.5 : 1) : 0)),
					ot_hours: Number(row.ot_hours) || Number(row.lembur_jam) || 0,
					sb_val: row.is_standby ? 1 : 0,
					um_val: row.uang_makan ? 1 : 0,
					kasbon_val: Number(row.kasbon_amount) || 0
				};
				if (wId) {
					const keyW = `${wId}_${tgl}`;
					newAbsensiMap.set(keyW, cellData);
					newExistingKeys.add(keyW);
				}
				if (aId) {
					const keyA = `asg_${aId}_${tgl}`;
					newAbsensiMap.set(keyA, cellData);
					newExistingKeys.add(keyA);
				}
			}
			absensiData = newAbsensiMap;
			existingAbsensiKeys = newExistingKeys;

		} catch (err) {
			console.error('Failed to load payroll data:', err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadData();
	});

	// Backfill/rekap absensi dari histori Laporan Harian (reports.manpower) untuk rentang
	// tanggal yang sedang ditampilkan — untuk laporan lama sebelum auto-sync aktif, atau
	// pekerja yang saat submit belum punya SPK aktif.
	async function recapFromReports() {
		if (recapping || dates.length === 0) return;
		const endDateStr = dates[dates.length - 1].dateStr;
		if (!confirm(`Rekap absensi dari Laporan Harian tanggal ${dates[0].dateStr} s/d ${endDateStr}? Data yang sudah ada akan diperbarui, bukan diduplikasi.`)) return;

		recapping = true;
		try {
			const userName = getUserDisplay(get(authStore).user);
			const res = await recapAbsensiFromReports(Number(projectId), dates[0].dateStr, endDateStr, userName);
			if (res.success) {
				const skippedNote = res.skipped.length > 0
					? `\n${res.skipped.length} entri dilewati (belum ada SPK/penugasan aktif): ${[...new Set(res.skipped.map(s => s.nama))].join(', ')}`
					: '';
				alert(`Rekap selesai. ${res.created} absensi baru dibuat, ${res.updated} diperbarui.${skippedNote}`);
				await loadData();
			} else {
				alert(res.error || 'Gagal merekap absensi dari laporan harian');
			}
		} finally {
			recapping = false;
		}
	}

	// Ubah satu sel IN/OT/SB langsung dari tabel (sementara — mempercepat input manual dibanding
	// modal satu-per-satu). Perubahan hanya tersimpan di layar sampai "Simpan Perubahan" ditekan.
	function updateCell(workerId: any, dateStr: string, field: 'in_val' | 'ot_hours' | 'sb_val' | 'um_val' | 'kasbon_val', e: Event) {
		const raw = (e.target as HTMLInputElement).value;
		const val = raw === '' ? 0 : Math.max(0, Number(raw) || 0);
		const key = `${workerId}_${dateStr}`;
		const existing = absensiData.get(key) || { in_val: 0, ot_hours: 0, sb_val: 0, um_val: 0, kasbon_val: 0 };
		const newMap = new Map(absensiData);
		newMap.set(key, { ...existing, [field]: val });
		absensiData = newMap;
		dirtyKeys = new Set(dirtyKeys).add(key);
	}

	// Simpan semua sel yang diedit langsung ke manpower_absensi (satu baris per pekerja per
	// tanggal). IN: 0 = tidak hadir, 1 = hadir, 1.5 = hadir & hari libur. SB: >0 = standby.
	async function saveAbsensiChanges() {
		if (savingAbsensi || dirtyKeys.size === 0) return;
		savingAbsensi = true;
		try {
			const userName = getUserDisplay(get(authStore).user);
			let success = 0;
			const failedNames = new Set<string>();

			for (const key of dirtyKeys) {
				const sep = key.indexOf('_');
				const workerId = key.slice(0, sep);
				const dateStr = key.slice(sep + 1);
				const worker = workers.find((w) => String(w.id) === workerId);
				const cell = absensiData.get(key);
				if (!worker || !worker.assignmentId) {
					failedNames.add(worker?.nama || `#${workerId}`);
					continue;
				}

				const isEmpty = !cell || (!cell.in_val && !cell.ot_hours && !cell.sb_val && !cell.um_val && !cell.kasbon_val);
				if (isEmpty) {
					// Sel dikosongkan total (mis. koreksi salah input) — hapus barisnya kalau memang
					// pernah tersimpan, supaya tidak "muncul lagi" setelah reload. Kalau memang belum
					// pernah ada baris, tidak perlu melakukan apa-apa.
					if (existingAbsensiKeys.has(key)) {
						const res = await deleteAbsensiEntry(worker.assignmentId, dateStr);
						if (res.success) success++;
						else failedNames.add(worker.nama);
					} else {
						success++;
					}
					continue;
				}

				const isStandby = !!cell.sb_val;
				const isHoliday = cell.in_val === 1.5;
				const jamKerja = isStandby ? 0 : (cell.in_val > 0 ? 8 : 0);
				// IN dikosongkan (0) tapi OT masih ada -> tetap tersimpan sebagai baris "tidak hadir"
				// (status alpha) supaya kolom IN tidak "kembali" ke hadir setelah reload.
				const status = isStandby ? 'hadir' : (cell.in_val > 0 ? 'hadir' : 'alpha');

				const res = await upsertTimesheetAbsensi({
					assignmentId: worker.assignmentId,
					manpowerId: worker.id,
					projectId: Number(projectId),
					tanggal: dateStr,
					jamKerja,
					dicatatOleh: userName,
					status,
					is_holiday: isHoliday,
					ot_hours: cell.ot_hours || 0,
					is_standby: isStandby,
					uang_makan: !!cell.um_val,
					kasbonAmount: cell.kasbon_val || 0
				});
				if (res.success) success++;
				else failedNames.add(worker.nama);
			}

			dirtyKeys = new Set();
			const failNote = failedNames.size > 0 ? `\nGagal: ${[...failedNames].join(', ')}` : '';
			alert(`${success} sel absensi tersimpan.${failNote}`);
			await loadData();
		} finally {
			savingAbsensi = false;
		}
	}

	// Rate lembur/uang makan (Rp/jam atau Rp/hari) diedit langsung dari baris masing-masing dan
	// tersimpan otomatis ke SPK (manpower_assignment) — dulunya harus diisi lewat menu Manpower & Leader.
	async function updateAssignmentRate(worker: any, field: 'rate_lembur' | 'rate_um', directusField: 'rate_lembur' | 'rate_uang_makan', e: Event) {
		const raw = (e.target as HTMLInputElement).value;
		const val = raw === '' ? 0 : Math.max(0, Number(raw) || 0);
		if (!worker.assignmentId) {
			alert(`${worker.nama} belum punya SPK/penugasan aktif, rate tidak bisa disimpan.`);
			return;
		}
		if (val === worker[field]) return;

		savingRateFor = new Set(savingRateFor).add(worker.id);
		try {
			workers = workers.map((w) => (w.id === worker.id ? { ...w, [field]: val } : w));
			const res = await updateAssignment(worker.assignmentId, { [directusField]: val });
			if (!res.success) {
				alert(`Gagal menyimpan rate untuk ${worker.nama}.`);
			}
		} finally {
			const next = new Set(savingRateFor);
			next.delete(worker.id);
			savingRateFor = next;
		}
	}

	// T7 (Delegasi Peran Fase 0.4) — dulu dimuat dari CDN cdnjs, diblokir CSP
	// produksi (script-src 'self' + Google saja). html2pdf.js sudah jadi
	// dependency (html2canvas ikut terpasang sebagai transitive dependency-nya)
	// — import lokal lewat bundler, bukan network.
	async function ensureHtml2Pdf(): Promise<any> {
		return (await import('html2pdf.js')).default;
	}

	async function ensureHtml2Canvas(): Promise<any> {
		return (await import('html2canvas')).default;
	}

	function esc(v: any): string {
		return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	// Bangun ulang tabel rekap sebagai HTML mandiri dengan warna inline (hex), BUKAN meng-capture
	// elemen Tailwind di halaman langsung — html2canvas (dipakai html2pdf) tidak bisa mem-parse
	// warna modern seperti oklch() yang dihasilkan Tailwind, jadi capture DOM asli selalu gagal.
	function buildRecapHtml(): string {
		const rangeLabel = `${dates[0].tanggal} ${dates[0].dateStr.slice(0, 4)} – ${dates[dates.length - 1].tanggal} ${dates[dates.length - 1].dateStr.slice(0, 4)}`;
		const totals = workerTotals;

		const th = (content: string, extra = '') =>
			`<th style="border:1px solid #d1d5db;padding:5px;font-size:10px;${extra}">${content}</th>`;
		const td = (content: string, extra = '') =>
			`<td style="border:1px solid #e5e7eb;padding:5px;font-size:10px;text-align:center;${extra}">${content}</td>`;

		const headerNames = workers.map((w) => `<th colspan="5" style="border:1px solid #d1d5db;padding:5px;font-size:10px;font-weight:700;">${esc(w.nama)}</th>`).join('');
		const headerJabatan = workers.map((w) => `<th colspan="5" style="border:1px solid #d1d5db;padding:5px;font-size:10px;color:#6b7280;background:#f9fafb;">${esc(w.jabatan)}</th>`).join('');
		const headerSub = workers.map(() => `
			${th('IN', 'background:#fef9c3;color:#854d0e;width:26px;')}
			${th('OT', 'background:#fef9c3;color:#854d0e;width:26px;')}
			${th('UM', 'background:#fef9c3;color:#854d0e;width:26px;')}
			${th('SB', 'background:#fef9c3;color:#854d0e;width:26px;')}
			${th('KASBON', 'background:#fef2f2;color:#b91c1c;width:60px;')}
		`).join('');

		const bodyRows = dates.map((d) => {
			const cells = workers.map((w) => {
				const c = absensiData.get(`${w.id}_${d.dateStr}`);
				return `${td(String(c?.in_val || ''))}${td(String(c?.ot_hours || ''))}${td(String(c?.um_val || ''))}${td(String(c?.sb_val || ''))}${td(c?.kasbon_val ? formatRp(c.kasbon_val) : '', 'color:#b91c1c;')}`;
			}).join('');
			return `<tr>
				${td(esc(d.hari), `text-align:left;font-weight:600;color:${d.isSunday ? '#dc2626' : '#374151'};`)}
				${td(esc(d.tanggal))}
				${cells}
			</tr>`;
		}).join('');

		const footerRow = (label: string, bg: string, cells: string) => `
			<tr>
				<td colspan="2" style="border:1px solid #d1d5db;padding:6px;font-size:10px;font-weight:700;background:${bg};">${label}</td>
				${cells}
			</tr>
		`;

		const totalHariKerjaCells = totals.map((t) =>
			`${td(String(t.tIn || ''), 'color:#1d4ed8;font-weight:700;')}${td(String(t.tOt || ''), 'color:#15803d;font-weight:700;')}${td(String(t.tUm || ''), 'color:#a16207;font-weight:700;')}${td(String(t.tSb || ''), 'color:#b45309;font-weight:700;')}${td(t.kasbon ? formatRp(t.kasbon) : '', 'color:#b91c1c;font-weight:700;')}`
		).join('');
		const colspan5 = (content: string, bg: string) => `<td colspan="5" style="border:1px solid #d1d5db;padding:6px;font-size:10px;text-align:right;background:${bg};">${content}</td>`;

		const grandSubtotal = totals.reduce((sum, t) => sum + t.subtotal, 0);
		const grandKasbon = totals.reduce((sum, t) => sum + t.kasbon, 0);
		const totalCols = workers.length * 5;
		const grandTotalRow = (label: string, value: number, bg: string, extraStyle = '') => `
			<tr>
				<td colspan="2" style="border:1px solid #d1d5db;padding:8px;font-size:11px;font-weight:700;background:${bg};${extraStyle}">${label}</td>
				<td colspan="${totalCols}" style="border:1px solid #d1d5db;padding:8px;font-size:12px;font-weight:700;text-align:right;background:${bg};${extraStyle}">${formatRp(value)}</td>
			</tr>
		`;

		const dibuatOleh = getUserDisplay(get(authStore).user);

		return `
			<div style="font-family: Arial, Helvetica, sans-serif; padding:16px; color:#111827; width:max-content;">
				<h2 style="margin:0 0 4px;font-size:15px;">Rekap Absensi &amp; Gaji</h2>
				<p style="margin:0 0 12px;font-size:11px;color:#6b7280;">Periode: ${esc(rangeLabel)}</p>
				<table style="border-collapse:collapse;">
					<thead>
						<tr>
							<th colspan="2" style="border:1px solid #d1d5db;padding:5px;font-size:10px;background:#f9fafb;">Pekerja</th>
							${headerNames}
						</tr>
						<tr>
							<th colspan="2" style="border:1px solid #d1d5db;padding:5px;font-size:10px;background:#f9fafb;">Jabatan</th>
							${headerJabatan}
						</tr>
						<tr>
							${th('HARI', 'background:#fef9c3;color:#854d0e;width:60px;')}
							${th('TANGGAL', 'background:#fef9c3;color:#854d0e;width:70px;')}
							${headerSub}
						</tr>
					</thead>
					<tbody>
						${bodyRows}
						${footerRow('Total Harian Kerja', '#fef9c3', totalHariKerjaCells)}
						${footerRow('Upah Harian', '#eff6ff', workers.map((w) => colspan5(formatRp(w.rate_upah), '#eff6ff')).join(''))}
						${footerRow('Total Harian', '#dbeafe', totals.map((t, i) => colspan5(formatRp(t.tIn * workers[i].rate_upah), '#dbeafe')).join(''))}
						${footerRow('Lembur', '#f0fdf4', workers.map((w) => colspan5(formatRp(w.rate_lembur), '#f0fdf4')).join(''))}
						${footerRow('Total Lembur', '#dcfce7', workers.map((w, i) => colspan5(formatRp(totals[i].tOt * w.rate_lembur), '#dcfce7')).join(''))}
						${footerRow('Uang Makan', '#fff7ed', workers.map((w) => colspan5(formatRp(w.rate_um), '#fff7ed')).join(''))}
						${footerRow('Total Uang Makan', '#ffedd5', workers.map((w, i) => colspan5(formatRp(totals[i].tUm * w.rate_um), '#ffedd5')).join(''))}
						${footerRow('Stand by', '#f3f4f6', workers.map((w) => colspan5(formatRp(w.rate_sb), '#f3f4f6')).join(''))}
						${footerRow('Total Stand by', '#e5e7eb', workers.map((w, i) => colspan5(formatRp(totals[i].tSb * w.rate_sb), '#e5e7eb')).join(''))}
						${footerRow('Total Gaji', '#ffffff', totals.map((t) => colspan5(formatRp(t.subtotal), '#ffffff')).join(''))}
						${footerRow('Total Kasbon', '#fef2f2', totals.map((t) => colspan5(formatRp(t.kasbon), '#fef2f2')).join(''))}
						${footerRow('GAJI YANG DITERIMA', '#fde047', totals.map((t) => colspan5(`<b>${formatRp(t.final)}</b>`, '#fde047')).join(''))}
					</tbody>
				</table>

				<table style="border-collapse:collapse;margin-top:14px;width:100%;max-width:520px;">
					<tbody>
						${grandTotalRow('Total sebelum kasbon', grandSubtotal, '#f3f4f6')}
						${grandTotalRow('Total Kasbon Keseluruhan', grandKasbon, '#fef2f2', 'color:#b91c1c;')}
						${grandTotalRow('TOTAL KESELURUHAN', grandSubtotal - grandKasbon, '#fde047', 'font-size:13px;')}
					</tbody>
				</table>

				${recapNotes.trim() ? `<p style="margin:14px 0 0;font-size:10.5px;color:#374151;white-space:pre-wrap;"><b>Catatan:</b> ${esc(recapNotes.trim())}</p>` : ''}
				<p style="margin:10px 0 0;font-size:10.5px;color:#374151;">Dibuat oleh: ${esc(dibuatOleh)}</p>
			</div>
		`;
	}

	// Ekspor rekap Gajian sebagai PDF atau PNG. Kolom Kasbon (input manual, belum tersimpan ke
	// database) ikut terekspor sesuai isian terakhir di layar.
	async function exportRecap(mode: 'pdf' | 'png') {
		if (exporting || workers.length === 0 || dates.length === 0) return;
		exporting = true;

		// Catatan: sengaja TIDAK diberi position:fixed/left negatif untuk menyembunyikan elemen ini —
		// html2canvas gagal (menghasilkan kanvas kosong) saat elemen sumbernya berada di luar
		// viewport. Elemen akan tampak sekilas di halaman lalu langsung dihapus setelah capture,
		// mengikuti pola yang sudah terbukti jalan di fitur cetak PDF Laporan Harian.
		const tempDiv = document.createElement('div');
		tempDiv.style.background = '#ffffff';
		tempDiv.innerHTML = buildRecapHtml();
		document.body.appendChild(tempDiv);

		try {
			const rangeLabel = `${dates[0].dateStr}_sd_${dates[dates.length - 1].dateStr}`;

			if (mode === 'pdf') {
				const html2pdf = await ensureHtml2Pdf();
				const opt = {
					margin: 5,
					image: { type: 'jpeg', quality: 0.98 },
					html2canvas: { scale: 2, useCORS: true },
					jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
				};
				const pdfBlob = await html2pdf().set(opt).from(tempDiv).output('blob');
				previewBlob = pdfBlob;
				previewTitle = `Rekap-Gajian-${projectName || projectId}-${rangeLabel}.pdf`;
				showPdfPreview = true;
			} else {
				const html2canvas = await ensureHtml2Canvas();
				const canvas = await html2canvas(tempDiv, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
				const link = document.createElement('a');
				link.download = `Rekap-Gajian-${projectId}-${rangeLabel}.png`;
				link.href = canvas.toDataURL('image/png');
				link.click();
			}
		} catch (err) {
			console.error('exportRecap:', err);
			alert('Gagal mengekspor rekap.');
		} finally {
			document.body.removeChild(tempDiv);
			exporting = false;
		}
	}

	// Unduh rekap sebagai .xlsx (SheetJS) — layout sama dengan tabel PDF di atas, ditambah blok
	// grand total (Total sebelum kasbon / TOTAL KESELURUHAN) dan catatan bebas.
	async function exportRecapExcel() {
		if (exportingExcel || workers.length === 0 || dates.length === 0) return;
		exportingExcel = true;
		try {
			const { buildPayrollWorkbook, workbookToBlob } = await import('$lib/utils/payrollExcelExport');
			const rangeLabel = `${dates[0].tanggal} ${dates[0].dateStr.slice(0, 4)} – ${dates[dates.length - 1].tanggal} ${dates[dates.length - 1].dateStr.slice(0, 4)}`;
			const wb = buildPayrollWorkbook({
				projectLabel: projectName || `Proyek #${projectId}`,
				rangeLabel,
				dates,
				workers,
				getCell: (workerId, dateStr) => absensiData.get(`${workerId}_${dateStr}`),
				totals: workerTotals,
				notes: recapNotes,
				dibuatOleh: getUserDisplay(get(authStore).user)
			});
			const blob = workbookToBlob(wb);
			const fileRangeLabel = `${dates[0].dateStr}_sd_${dates[dates.length - 1].dateStr}`;
			const link = document.createElement('a');
			link.download = `Rekap-Gajian-${projectName || projectId}-${fileRangeLabel}.xlsx`;
			link.href = URL.createObjectURL(blob);
			link.click();
			URL.revokeObjectURL(link.href);
		} catch (err) {
			console.error('exportRecapExcel:', err);
			alert('Gagal mengekspor rekap ke Excel.');
		} finally {
			exportingExcel = false;
		}
	}

	// Sama seperti exportRecap('pdf') tapi mengembalikan Blob (bukan langsung diunduh) — dipakai
	// untuk melampirkan rekap sebagai bukti ke pengajuan anggaran yang digenerate otomatis.
	async function generateRecapPdfBlob(): Promise<Blob | null> {
		if (workers.length === 0 || dates.length === 0) return null;
		const tempDiv = document.createElement('div');
		tempDiv.style.background = '#ffffff';
		tempDiv.innerHTML = buildRecapHtml();
		document.body.appendChild(tempDiv);
		try {
			const html2pdf = await ensureHtml2Pdf();
			const opt = {
				margin: 5,
				image: { type: 'jpeg', quality: 0.98 },
				html2canvas: { scale: 2, useCORS: true },
				jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
			};
			return await html2pdf().set(opt).from(tempDiv).output('blob');
		} finally {
			document.body.removeChild(tempDiv);
		}
	}

	// Ajukan Anggaran Gaji: generate satu pengajuan anggaran (kategori operasional) langsung dari
	// nominal "GAJI YANG DITERIMA" total di rekap ini, supaya tidak perlu isi ulang form pengajuan
	// anggaran manual. Field yang butuh keputusan manusia (penerima dana, metode bayar, urgensi)
	// tetap ditanyakan lewat modal kecil sebelum dikirim.
	let showPengajuanModal = $state(false);
	let submittingPengajuan = $state(false);
	let pengajuanForm = $state({
		tujuan_pengajuan: '',
		tanggal_dibutuhkan: '',
		urgency: 'Normal',
		payment_method: 'Transfer',
		penerima_dana_type: 'individu',
		penerima_dana_nama: '',
		bank_name: '',
		bank_account_number: '',
		bank_account_name: '',
		// Penajaman Penerima Dana & Track Record v2, Fase 4 (11 Sep)
		rekening_penerima_id: null as number | null,
		is_tagihan: false,
		comments: ''
	});

	function openPengajuanModal() {
		if (workers.length === 0 || dates.length === 0 || grandTotal <= 0) return;
		const label = projectName || `Proyek #${projectId}`;
		const periode = `${dates[0].dateStr} s/d ${dates[dates.length - 1].dateStr}`;
		pengajuanForm = {
			tujuan_pengajuan: `Gaji & Kasbon Manpower - ${label} (${periode})`,
			tanggal_dibutuhkan: new Date().toISOString().split('T')[0],
			urgency: 'Normal',
			payment_method: 'Transfer',
			penerima_dana_type: 'individu',
			penerima_dana_nama: getUserDisplay(get(authStore).user),
			bank_name: '',
			bank_account_number: '',
			bank_account_name: '',
			rekening_penerima_id: null as number | null,
			is_tagihan: false,
			comments: `Rekap gaji ${workers.length} pekerja, periode ${periode}. Dibuat otomatis dari modul Gajian.`
		};
		showPengajuanModal = true;
	}

	async function submitPengajuanGaji() {
		if (submittingPengajuan || grandTotal <= 0) return;
		if (!pengajuanForm.tujuan_pengajuan.trim()) {
			alert('Tujuan pengajuan wajib diisi.');
			return;
		}
		if (!pengajuanForm.penerima_dana_nama.trim()) {
			alert('Nama penerima dana wajib diisi.');
			return;
		}
		if (pengajuanForm.payment_method === 'Transfer' && (!pengajuanForm.bank_name.trim() || !pengajuanForm.bank_account_number.trim() || !pengajuanForm.bank_account_name.trim())) {
			alert('Data rekening bank wajib diisi untuk metode pembayaran Transfer.');
			return;
		}

		submittingPengajuan = true;
		try {
			const authUser = get(authStore).user;
			const periode = `${dates[0].dateStr} s/d ${dates[dates.length - 1].dateStr}`;
			const formData = {
				nama_pengaju: getUserDisplay(authUser),
				department: 'Project',
				kategori: 'operasional',
				urgency: pengajuanForm.urgency,
				tujuan_pengajuan: pengajuanForm.tujuan_pengajuan.trim(),
				tanggal_dibutuhkan: pengajuanForm.tanggal_dibutuhkan,
				payment_method: pengajuanForm.payment_method,
				total_amount: grandTotal,
				comments: pengajuanForm.comments,
				project_id: Number(projectId),
				penerima_dana_type: pengajuanForm.penerima_dana_type,
				penerima_dana_nama: pengajuanForm.penerima_dana_nama.trim(),
				bank_name: pengajuanForm.payment_method === 'Transfer' ? pengajuanForm.bank_name.trim() : '',
				bank_account_number: pengajuanForm.payment_method === 'Transfer' ? pengajuanForm.bank_account_number.trim() : '',
				bank_account_name: pengajuanForm.payment_method === 'Transfer' ? pengajuanForm.bank_account_name.trim() : '',
				// Penajaman Penerima Dana & Track Record v2, Fase 4
				rekening_penerima_id: pengajuanForm.payment_method === 'Transfer' && !pengajuanForm.is_tagihan ? pengajuanForm.rekening_penerima_id : null,
				created_by_email: authUser?.email || null
			};
			const items = [{
				deskripsi: pengajuanForm.tujuan_pengajuan.trim(),
				kategori_item: 'operasional',
				quantity: 1,
				units: 'Lainnya',
				harga: grandTotal,
				notes: `Meliputi ${workers.length} pekerja, periode ${periode}`
			}];

			const created = await createPengajuanAnggaran(formData, items);
			if (created && created.id) {
				// Lampirkan PDF rekap absensi & gaji sebagai bukti pendukung. Kegagalan di sini
				// tidak membatalkan pengajuan yang sudah terbuat — hanya diberi tahu terpisah.
				let attached = false;
				try {
					const pdfBlob = await generateRecapPdfBlob();
					if (pdfBlob) {
						const file = new File([pdfBlob], `Rekap-Gajian-${projectId}-${periode.replace(/\s*s\/d\s*/g, '_sd_')}.pdf`, { type: 'application/pdf' });
						const uploadForm = new FormData();
						uploadForm.append('title', `Rekap Gajian - ${pengajuanForm.tujuan_pengajuan.trim()}`);
						uploadForm.append('file', file);
						const uploaded: any = await directus.request(uploadFiles(uploadForm));
						if (uploaded?.id) {
							await directus.request(createItem('pengajuan_anggaran_files_1', {
								pengajuan_anggaran_id: created.id,
								directus_files_id: uploaded.id
							}));
							attached = true;
						}
					}
				} catch (attachErr) {
					console.error('Gagal melampirkan rekap PDF ke pengajuan:', attachErr);
				}

				alert(
					`Pengajuan anggaran berhasil dibuat: ${created.nomor_pengajuan || `#${created.id}`} sebesar ${formatRp(grandTotal)}.` +
					(attached ? ' PDF rekap absensi & gaji terlampir otomatis.' : ' Namun lampiran PDF gagal diunggah — silakan lampirkan manual di halaman pengajuan.')
				);
				showPengajuanModal = false;
			} else {
				alert('Gagal membuat pengajuan anggaran.');
			}
		} catch (err) {
			console.error('submitPengajuanGaji:', err);
			alert('Terjadi kesalahan saat membuat pengajuan anggaran.');
		} finally {
			submittingPengajuan = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex items-end gap-3 px-1">
		<div>
			<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Dari Tanggal</label>
			<input
				type="date"
				value={startDate}
				onchange={(e) => {
					startDate = (e.target as HTMLInputElement).value;
					loadData();
				}}
				class="f-input bg-white h-[38px] text-[13px] border-gray-200"
			/>
		</div>
		<div>
			<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Sampai Tanggal</label>
			<input
				type="date"
				value={endDate}
				min={startDate}
				onchange={(e) => {
					endDate = (e.target as HTMLInputElement).value;
					loadData();
				}}
				class="f-input bg-white h-[38px] text-[13px] border-gray-200"
			/>
		</div>
		<button class="h-[38px] px-4 rounded-xl bg-[var(--gl)] text-[var(--gd)] font-semibold text-[13px] hover:bg-[var(--g)] hover:text-white transition-colors flex items-center gap-2" onclick={loadData}>
			<IconRefresh size={16} /> Refresh
		</button>
		<button
			class="h-[38px] px-4 rounded-xl bg-blue-50 text-blue-700 font-semibold text-[13px] hover:bg-blue-600 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50"
			onclick={recapFromReports}
			disabled={recapping}
			title="Isi otomatis dari Laporan Harian yang sudah dikirim leader (untuk laporan lama / belum tersinkron)"
		>
			{#if recapping}
				<IconLoader2 size={16} class="animate-spin" /> Merekap...
			{:else}
				<IconHistory size={16} /> Rekap dari Laporan Harian
			{/if}
		</button>
		<button
			class="h-[38px] px-4 rounded-xl bg-gray-100 text-gray-700 font-semibold text-[13px] hover:bg-gray-800 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50"
			onclick={() => exportRecap('pdf')}
			disabled={exporting || workers.length === 0 || dates.length === 0}
			title="Unduh tampilan rekap ini sebagai PDF"
		>
			<IconFileExport size={16} /> Unduh PDF
		</button>
		<button
			class="h-[38px] px-4 rounded-xl bg-gray-100 text-gray-700 font-semibold text-[13px] hover:bg-gray-800 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50"
			onclick={() => exportRecap('png')}
			disabled={exporting || workers.length === 0 || dates.length === 0}
			title="Unduh tampilan rekap ini sebagai gambar (PNG)"
		>
			{#if exporting}
				<IconLoader2 size={16} class="animate-spin" /> Mengekspor...
			{:else}
				<IconPhoto size={16} /> Unduh Gambar
			{/if}
		</button>
		<button
			class="h-[38px] px-4 rounded-xl bg-gray-100 text-gray-700 font-semibold text-[13px] hover:bg-gray-800 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50"
			onclick={exportRecapExcel}
			disabled={exportingExcel || workers.length === 0 || dates.length === 0}
			title="Unduh rekap ini sebagai file Excel (.xlsx), format sama dengan template lama"
		>
			{#if exportingExcel}
				<IconLoader2 size={16} class="animate-spin" /> Mengekspor...
			{:else}
				<IconFileExport size={16} /> Unduh Excel
			{/if}
		</button>
		<button
			class="h-[38px] px-4 rounded-xl bg-orange-500 text-white font-semibold text-[13px] hover:bg-orange-600 transition-colors flex items-center gap-2 disabled:opacity-50"
			onclick={openPengajuanModal}
			disabled={workers.length === 0 || dates.length === 0 || grandTotal <= 0}
			title="Buat pengajuan anggaran otomatis dari total GAJI YANG DITERIMA di rekap ini"
		>
			<IconCash size={16} /> Ajukan Anggaran Gaji
		</button>
		<button
			class="h-[38px] px-4 rounded-xl bg-red-500 text-white font-semibold text-[13px] hover:bg-red-600 transition-colors flex items-center gap-2 disabled:opacity-50"
			onclick={openKasbonModal}
			disabled={workers.length === 0}
			title="Ajukan kasbon untuk pekerja lapangan di proyek ini (Fase 3)"
		>
			<IconCash size={16} /> Ajukan Kasbon
		</button>
		<button
			class="h-[38px] px-4 rounded-xl bg-green-600 text-white font-semibold text-[13px] hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
			onclick={saveAbsensiChanges}
			disabled={savingAbsensi || dirtyKeys.size === 0}
			title="Simpan sel IN/OT/SB yang baru diedit langsung di tabel ke absensi"
		>
			{#if savingAbsensi}
				<IconLoader2 size={16} class="animate-spin" /> Menyimpan...
			{:else}
				<IconCheck size={16} /> Simpan Perubahan{dirtyKeys.size > 0 ? ` (${dirtyKeys.size})` : ''}
			{/if}
		</button>
	</div>

	{#if workers.length > 0 && dates.length > 0}
		<p class="text-[11px] text-gray-400 px-1 -mt-2">
			Klik langsung sel IN/OT/UM/SB untuk isi manual (IN: 1 = hadir, 1.5 = hadir & hari libur, 0/kosong = tidak hadir · OT: jam lembur · UM: 1 = dapat uang makan · SB: 1 = standby), lalu klik "Simpan Perubahan". Kolom KASBON kini hanya tampilan (terkunci, Fase 3/T6) — ajukan kasbon pekerja lewat tombol "Ajukan Kasbon" di atas, otomatis terpotong dari gajian lewat modul kasbon formal.
		</p>
		<div class="px-1">
			<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Catatan Lampiran (opsional)</label>
			<input
				type="text"
				bind:value={recapNotes}
				placeholder='mis. "gapok sehari", "stand by 9 bkn 8"'
				class="f-input w-full max-w-md bg-white h-[36px] text-[12px] border-gray-200"
				title="Catatan bebas ini akan tampil di footer PDF & sheet Excel yang diunduh/lampirkan"
			/>
		</div>
	{/if}

	{#if loading}
		<CircularProgressGauge size={52} strokeWidth={4} label="Menghitung rekap absensi & gaji..." />
	{:else if workers.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Belum ada pekerja (assignment) aktif di proyek ini.</p>
		</div>
	{:else if dates.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Rentang tanggal tidak valid. Pastikan "Sampai Tanggal" tidak lebih awal dari "Dari Tanggal".</p>
		</div>
	{:else}
		<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm pb-4">
			<table class="w-full text-[11px] border-collapse min-w-max">
				<thead>
					<!-- Row 1: Numbers -->
					<tr>
						<th class="border-b border-r border-gray-200 p-1.5 bg-gray-50 sticky left-0 z-20" colspan="2"></th>
						{#each workers as worker, i}
							<th class="border-b border-r border-gray-200 p-1.5 bg-[var(--gl)] text-[var(--gd)] text-center" colspan="5">
								{i + 1}
							</th>
						{/each}
					</tr>
					<!-- Row 2: Worker Name -->
					<tr>
						<th class="border-b border-r border-gray-200 p-2 bg-gray-50 text-left sticky left-0 z-20 font-bold text-gray-600 uppercase tracking-wider min-w-[120px]" colspan="2">
							Pekerja
						</th>
						{#each workers as worker}
							<th class="border-b border-r border-gray-200 p-2 text-center font-bold text-gray-800 min-w-[130px]" colspan="5">
								{worker.nama}
							</th>
						{/each}
					</tr>
					<!-- Row 3: Jabatan -->
					<tr>
						<th class="border-b border-r border-gray-200 p-2 bg-gray-50 text-left sticky left-0 z-20 font-bold text-gray-600 uppercase tracking-wider" colspan="2">
							Jabatan
						</th>
						{#each workers as worker}
							<th class="border-b border-r border-gray-200 p-2 text-center text-gray-500 font-medium bg-gray-50" colspan="5">
								{worker.jabatan}
							</th>
						{/each}
					</tr>
					<!-- Row 4: IN OT UM SB KASBON -->
					<tr>
						<th class="border-b border-r border-gray-200 p-1.5 bg-yellow-100 text-yellow-800 text-center sticky left-0 z-20 w-[60px]">HARI</th>
						<th class="border-b border-r border-gray-200 p-1.5 bg-yellow-100 text-yellow-800 text-center sticky left-[60px] z-20 w-[80px]">TANGGAL</th>
						{#each workers as worker}
							<th class="border-b border-r border-gray-200 p-1.5 bg-yellow-50 text-yellow-700 text-center w-[30px]"><Tooltip text="Upah Harian" position="bottom"><span>IN</span></Tooltip></th>
							<th class="border-b border-r border-gray-200 p-1.5 bg-yellow-50 text-yellow-700 text-center w-[30px]"><Tooltip text="Overtime" position="bottom"><span>OT</span></Tooltip></th>
							<th class="border-b border-r border-gray-200 p-1.5 bg-yellow-50 text-yellow-700 text-center w-[30px]"><Tooltip text="Uang Makan" position="bottom"><span>UM</span></Tooltip></th>
							<th class="border-b border-r border-gray-200 p-1.5 bg-yellow-50 text-yellow-700 text-center w-[30px]"><Tooltip text="Stand By" position="bottom"><span>SB</span></Tooltip></th>
							<th class="border-b border-r border-gray-200 p-1.5 bg-red-50 text-red-700 text-center w-[70px]"><Tooltip text="Kasbon hari ini (Rp). Sel dikunci — ajukan kasbon lewat tombol 'Ajukan Kasbon' di atas." position="bottom"><span>KASBON</span></Tooltip></th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each dates as d}
						<tr class="hover:bg-gray-50">
							<td class="border-b border-r border-gray-200 p-1.5 sticky left-0 z-10 bg-white font-medium {d.isSunday ? 'text-red-500' : 'text-gray-700'}">
								{d.hari}
							</td>
							<td class="border-b border-r border-gray-200 p-1.5 sticky left-[60px] z-10 bg-white text-gray-600 text-center">
								{d.tanggal}
							</td>
							{#each workers as worker}
								{@const cell = absensiData.get(`${worker.id}_${d.dateStr}`)}
								{@const isDirty = dirtyKeys.has(`${worker.id}_${d.dateStr}`)}
								<td class="border-b border-r border-gray-200 p-0.5 text-center {cell?.in_val ? 'bg-blue-50/50' : ''} {isDirty ? 'ring-2 ring-inset ring-green-400' : ''}">
									<input type="number" min="0" step="0.5" value={cell?.in_val || ''}
										onchange={(e) => updateCell(worker.id, d.dateStr, 'in_val', e)}
										class="w-full text-center bg-transparent font-semibold text-gray-800 outline-none focus:bg-white rounded" />
								</td>
								<td class="border-b border-r border-gray-200 p-0.5 text-center {cell?.ot_hours ? 'bg-green-50/50' : ''} {isDirty ? 'ring-2 ring-inset ring-green-400' : ''}">
									<input type="number" min="0" step="0.5" value={cell?.ot_hours || ''}
										onchange={(e) => updateCell(worker.id, d.dateStr, 'ot_hours', e)}
										class="w-full text-center bg-transparent font-semibold text-gray-800 outline-none focus:bg-white rounded" />
								</td>
								<td class="border-b border-r border-gray-200 p-0.5 text-center {cell?.um_val ? 'bg-orange-50/50' : ''} {isDirty ? 'ring-2 ring-inset ring-green-400' : ''}">
									<input type="number" min="0" max="1" step="1" value={cell?.um_val || ''}
										onchange={(e) => updateCell(worker.id, d.dateStr, 'um_val', e)}
										class="w-full text-center bg-transparent font-semibold text-gray-800 outline-none focus:bg-white rounded" />
								</td>
								<td class="border-b border-r border-gray-200 p-0.5 text-center {cell?.sb_val ? 'bg-amber-50/50' : ''} {isDirty ? 'ring-2 ring-inset ring-green-400' : ''}">
									<input type="number" min="0" max="1" step="1" value={cell?.sb_val || ''}
										onchange={(e) => updateCell(worker.id, d.dateStr, 'sb_val', e)}
										class="w-full text-center bg-transparent font-semibold text-gray-800 outline-none focus:bg-white rounded" />
								</td>
								<td class="border-b border-r border-gray-200 p-0.5 text-center {cell?.kasbon_val ? 'bg-red-50/50' : ''}" title="Fase 3 (T6): sel manual dikunci — ajukan kasbon lewat tombol 'Ajukan Kasbon' di atas">
									<span class="block w-full text-center font-semibold text-red-600/70">{cell?.kasbon_val ? formatRp(cell.kasbon_val) : ''}</span>
								</td>
							{/each}
						</tr>
					{/each}
					
					<!-- Footer Calculations -->
					
					<!-- Total Harian Kerja -->
					<tr class="bg-yellow-100 font-bold text-gray-800">
						<td class="border-b border-r border-gray-300 p-2 sticky left-0 z-10" colspan="2">Total Harian Kerja</td>
						{#each workers as worker, i}
							{@const t = workerTotals[i]}
							<td class="border-b border-r border-gray-300 p-2 text-center text-blue-700">{t.tIn || ''}</td>
							<td class="border-b border-r border-gray-300 p-2 text-center text-green-700">{t.tOt || ''}</td>
							<td class="border-b border-r border-gray-300 p-2 text-center text-orange-700">{t.tUm || ''}</td>
							<td class="border-b border-r border-gray-300 p-2 text-center text-amber-700">{t.tSb || ''}</td>
							<td class="border-b border-r border-gray-300 p-2 text-center text-red-700">{t.kasbon ? formatRp(t.kasbon) : ''}</td>
						{/each}
					</tr>

					<!-- Upah Harian -->
					<tr class="bg-blue-50 font-bold text-gray-700">
						<td class="border-b border-r border-gray-200 p-2 sticky left-0 z-10" colspan="2">Upah Harian</td>
						{#each workers as worker}
							<td class="border-b border-r border-gray-200 p-2 text-right" colspan="5">{formatRp(worker.rate_upah)}</td>
						{/each}
					</tr>

					<!-- Total Harian -->
					<tr class="bg-blue-100 font-bold text-blue-900">
						<td class="border-b border-r border-gray-300 p-2 sticky left-0 z-10" colspan="2">Total Harian</td>
						{#each workers as worker, i}
							<td class="border-b border-r border-gray-300 p-2 text-right" colspan="5">{formatRp(workerTotals[i].tIn * worker.rate_upah)}</td>
						{/each}
					</tr>

					<!-- Lembur -->
					<tr class="bg-green-50 font-bold text-gray-700">
						<td class="border-b border-r border-gray-200 p-2 sticky left-0 z-10" colspan="2">Lembur (Rp/jam)</td>
						{#each workers as worker}
							<td class="border-b border-r border-gray-200 p-1" colspan="5">
								<div class="flex items-center gap-1">
									<input type="number" min="0" step="1000" value={worker.rate_lembur || ''} placeholder="Belum diisi"
										onchange={(e) => updateAssignmentRate(worker, 'rate_lembur', 'rate_lembur', e)}
										disabled={savingRateFor.has(worker.id)}
										class="w-full text-right p-1 bg-white border border-gray-200 rounded text-gray-700 font-bold outline-none focus:border-green-400 disabled:opacity-50" />
									{#if savingRateFor.has(worker.id)}
										<IconLoader2 size={12} class="animate-spin text-gray-400 shrink-0" />
									{/if}
								</div>
							</td>
						{/each}
					</tr>

					<!-- Total Lembur -->
					<tr class="bg-green-100 font-bold text-green-900">
						<td class="border-b border-r border-gray-300 p-2 sticky left-0 z-10" colspan="2">Total Lembur</td>
						{#each workers as worker, i}
							<td class="border-b border-r border-gray-300 p-2 text-right" colspan="5">{formatRp(workerTotals[i].tOt * worker.rate_lembur)}</td>
						{/each}
					</tr>

					<!-- Uang Makan -->
					<tr class="bg-orange-50 font-bold text-gray-700">
						<td class="border-b border-r border-gray-200 p-2 sticky left-0 z-10" colspan="2">Uang Makan (Rp/hari)</td>
						{#each workers as worker}
							<td class="border-b border-r border-gray-200 p-1" colspan="5">
								<div class="flex items-center gap-1">
									<input type="number" min="0" step="1000" value={worker.rate_um || ''} placeholder="Belum diisi"
										onchange={(e) => updateAssignmentRate(worker, 'rate_um', 'rate_uang_makan', e)}
										disabled={savingRateFor.has(worker.id)}
										class="w-full text-right p-1 bg-white border border-gray-200 rounded text-gray-700 font-bold outline-none focus:border-orange-400 disabled:opacity-50" />
									{#if savingRateFor.has(worker.id)}
										<IconLoader2 size={12} class="animate-spin text-gray-400 shrink-0" />
									{/if}
								</div>
							</td>
						{/each}
					</tr>

					<!-- Total Uang Makan -->
					<tr class="bg-orange-100 font-bold text-orange-900">
						<td class="border-b border-r border-gray-300 p-2 sticky left-0 z-10" colspan="2">Total Uang Makan</td>
						{#each workers as worker, i}
							<td class="border-b border-r border-gray-300 p-2 text-right" colspan="5">{formatRp(workerTotals[i].tUm * worker.rate_um)}</td>
						{/each}
					</tr>

					<!-- Stand By -->
					<tr class="bg-gray-100 font-bold text-gray-700">
						<td class="border-b border-r border-gray-200 p-2 sticky left-0 z-10" colspan="2">Stand by</td>
						{#each workers as worker}
							<td class="border-b border-r border-gray-200 p-2 text-right" colspan="5">{formatRp(worker.rate_sb)}</td>
						{/each}
					</tr>

					<!-- Total Stand By -->
					<tr class="bg-gray-200 font-bold text-gray-800">
						<td class="border-b border-r border-gray-300 p-2 sticky left-0 z-10" colspan="2">Total Stand by</td>
						{#each workers as worker, i}
							<td class="border-b border-r border-gray-300 p-2 text-right" colspan="5">{formatRp(workerTotals[i].tSb * worker.rate_sb)}</td>
						{/each}
					</tr>

					<!-- Total Gaji -->
					<tr class="bg-white font-bold text-gray-900 border-t-2 border-gray-400">
						<td class="border-b border-r border-gray-300 p-3 sticky left-0 z-10 text-[12px]" colspan="2">Total Gaji</td>
						{#each workers as worker, i}
							<td class="border-b border-r border-gray-300 p-3 text-right text-[12px]" colspan="5">{formatRp(workerTotals[i].subtotal)}</td>
						{/each}
					</tr>

					<!-- Total Kasbon (dijumlahkan otomatis dari kolom KASBON per hari di atas) -->
					<tr class="bg-red-50 font-bold text-red-600">
						<td class="border-b border-r border-gray-300 p-2 sticky left-0 z-10" colspan="2">Total Kasbon</td>
						{#each workers as worker, i}
							<td class="border-b border-r border-gray-300 p-2 text-right" colspan="5">{formatRp(workerTotals[i].kasbon)}</td>
						{/each}
					</tr>

					<!-- Gaji Diterima -->
					<tr class="bg-yellow-300 font-bold text-gray-900">
						<td class="border-b border-r border-gray-400 p-3 sticky left-0 z-10 text-[13px]" colspan="2">GAJI YANG DITERIMA</td>
						{#each workers as worker, i}
							<td class="border-b border-r border-gray-400 p-3 text-right text-[14px]" colspan="5">{formatRp(workerTotals[i].final)}</td>
						{/each}
					</tr>
				</tbody>
			</table>
		</div>

		<PayrollRunManager
			{projectId}
			periodeMulai={dates[0].dateStr}
			periodeSelesai={dates[dates.length - 1].dateStr}
			{workers}
			{workerTotals}
			onProcessed={loadData}
		/>
	{/if}
</div>

{#if showPengajuanModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-full">
			<div class="flex items-center justify-between p-4 border-b border-gray-100">
				<h3 class="font-bold text-gray-800 text-[15px]">Ajukan Anggaran Gaji Manpower</h3>
				<button class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors" onclick={() => (showPengajuanModal = false)}>
					<IconX size={18} />
				</button>
			</div>

			<div class="p-5 overflow-y-auto space-y-4">
				<div class="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-center">
					<p class="text-[11px] font-semibold text-yellow-700 uppercase tracking-wider mb-1">Total Diajukan</p>
					<p class="text-[22px] font-bold text-yellow-900">Rp {formatRp(grandTotal)}</p>
					<p class="text-[11px] text-yellow-700 mt-1">{workers.length} pekerja, {dates.length} hari (mengikuti rentang tanggal rekap)</p>
				</div>

				<div>
					<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tujuan Pengajuan</label>
					<input type="text" bind:value={pengajuanForm.tujuan_pengajuan} class="f-input w-full bg-gray-50 border-gray-200" />
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tanggal Dibutuhkan</label>
						<input type="date" bind:value={pengajuanForm.tanggal_dibutuhkan} class="f-input w-full bg-gray-50 border-gray-200" />
					</div>
					<div>
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Urgensi</label>
						<select bind:value={pengajuanForm.urgency} class="f-select w-full bg-gray-50 border-gray-200">
							<option value="Normal">Normal</option>
							<option value="Urgent">Urgent</option>
							<option value="Very Urgent">Sangat Urgent</option>
						</select>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Metode Pembayaran</label>
						<select bind:value={pengajuanForm.payment_method} class="f-select w-full bg-gray-50 border-gray-200">
							<option value="Transfer">Transfer</option>
							<option value="Cash">Cash</option>
						</select>
					</div>
					<div>
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tipe Penerima Dana</label>
						<select bind:value={pengajuanForm.penerima_dana_type} class="f-select w-full bg-gray-50 border-gray-200">
							<option value="individu">Individu</option>
							<option value="pt">PT</option>
							<option value="vendor">Vendor</option>
							<option value="pihak_ketiga">Pihak Ketiga</option>
						</select>
					</div>
				</div>

				<div>
					<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Nama Penerima Dana</label>
					<input type="text" bind:value={pengajuanForm.penerima_dana_nama} class="f-input w-full bg-gray-50 border-gray-200" placeholder="Nama penerima (mis. leader yang menarik & membagikan gaji)" />
				</div>

				{#if pengajuanForm.payment_method === 'Transfer'}
					<RekeningSelect
						bind:bankName={pengajuanForm.bank_name}
						bind:bankAccountNumber={pengajuanForm.bank_account_number}
						bind:bankAccountName={pengajuanForm.bank_account_name}
						bind:rekeningPenerimaId={pengajuanForm.rekening_penerima_id}
						bind:isTagihan={pengajuanForm.is_tagihan}
					/>
				{/if}

				<div>
					<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Catatan</label>
					<textarea bind:value={pengajuanForm.comments} rows="2" class="f-input w-full bg-gray-50 border-gray-200"></textarea>
				</div>
			</div>

			<div class="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
				<button class="px-4 py-2 rounded-xl text-[13px] font-semibold text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 transition-colors" onclick={() => (showPengajuanModal = false)}>
					Batal
				</button>
				<button class="px-5 py-2 rounded-xl text-[13px] font-semibold text-white bg-orange-500 hover:bg-orange-600 transition-colors flex items-center gap-2 disabled:opacity-50"
					onclick={submitPengajuanGaji} disabled={submittingPengajuan}>
					{#if submittingPengajuan}
						<IconLoader2 size={16} class="animate-spin" /> Mengirim...
					{:else}
						<IconCheck size={16} /> Kirim Pengajuan
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showKasbonModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden flex flex-col max-h-full">
			<div class="flex items-center justify-between p-4 border-b border-gray-100">
				<h3 class="font-bold text-gray-800 text-[15px]">Ajukan Kasbon Pekerja Lapangan</h3>
				<button class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors" onclick={() => (showKasbonModal = false)}>
					<IconX size={18} />
				</button>
			</div>

			{#if kasbonSuccess}
				<div class="p-8 text-center">
					<IconCheck size={36} class="mx-auto text-green-600 mb-2" />
					<p class="text-[14px] font-semibold text-gray-800">Kasbon terkirim</p>
					<p class="text-[12px] text-gray-500 mt-1">Menunggu persetujuan Admin Proyek → Finance.</p>
					<button class="mt-4 px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600" onclick={() => (showKasbonModal = false)}>Tutup</button>
				</div>
			{:else}
				<div class="p-5 overflow-y-auto space-y-4">
					<p class="text-[11px] text-gray-500">Pengajuan ini atas nama Anda sebagai Leader proyek — otomatis dianggap disetujui tahap-1, lanjut ke Admin Proyek dan Finance.</p>
					<div>
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Pekerja *</label>
						<select bind:value={kasbonManpowerId} class="f-select w-full bg-gray-50 border-gray-200">
							{#each workers as w}
								<option value={w.id}>{w.nama}</option>
							{/each}
						</select>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Nominal (Rp) *</label>
							<input type="number" min="1" bind:value={kasbonNominal} class="f-input w-full bg-gray-50 border-gray-200" placeholder="0" />
						</div>
						<div>
							<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tenor (bulan) *</label>
							<input type="number" min="1" bind:value={kasbonTenor} class="f-input w-full bg-gray-50 border-gray-200" />
						</div>
					</div>
					<div>
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Alasan *</label>
						<textarea rows="2" bind:value={kasbonKeterangan} class="f-input w-full bg-gray-50 border-gray-200" placeholder="Keperluan kasbon"></textarea>
					</div>
					{#if kasbonError}
						<p class="text-[12px] text-red-600">{kasbonError}</p>
					{/if}
				</div>
				<div class="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
					<button class="px-4 py-2 rounded-xl text-[13px] font-semibold text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 transition-colors" onclick={() => (showKasbonModal = false)}>
						Batal
					</button>
					<button class="px-5 py-2 rounded-xl text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors flex items-center gap-2 disabled:opacity-50"
						onclick={submitKasbonModal} disabled={kasbonSubmitting}>
						{#if kasbonSubmitting}
							<IconLoader2 size={16} class="animate-spin" /> Mengirim...
						{:else}
							<IconCheck size={16} /> Kirim Pengajuan
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<PdfBlobViewer
	src={previewBlob}
	title={previewTitle}
	show={showPdfPreview}
	onClose={() => {
		showPdfPreview = false;
		previewBlob = null;
	}}
/>

<style>
	/* Make the first two columns sticky for horizontal scrolling */
	td.sticky, th.sticky {
		position: sticky;
		box-shadow: 1px 0 0 0 var(--sys-sep);
	}
	th.sticky {
		z-index: 20; /* above scrolling body */
	}
	td.sticky {
		z-index: 10;
	}
	
	input[type="number"]::-webkit-inner-spin-button,
	input[type="number"]::-webkit-outer-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
</style>
