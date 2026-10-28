<script lang="ts">
	import { hasPermission } from '$lib/constants/permissions';
	import { rolesStore } from '$lib/stores/roles';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getReports, getBatchedReports, getReportsByDateRange, getReportsNeedingFix } from '$lib/services/reports';
	import { getLeaderReportScore, type LeaderReportScore, type ReportPeriod } from '$lib/services/reportScore';
	import { authStore, isLeaderRole } from '$lib/stores/auth';
	import { FieldHint, EmptyStateGuide } from '$lib/components/hints';
	// Impor modul hint langsung (bukan barrel) — lihat catatan bundling di getHint.ts.
	import { laporanHints } from '$lib/data/hints/laporan';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint modul Laporan; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(laporanHints, key, 'laporan-harian');
	import {
		IconArrowLeft, IconBuilding, IconChevronRight,
		IconLoader2, IconClipboardList, IconSearch, IconUser, IconX,
		IconChartPie, IconChevronDown, IconChevronUp, IconBrandWhatsapp, IconDownload, IconInfoCircle
	} from '@tabler/icons-svelte';
	import PdfBlobViewer from '$lib/components/project/PdfBlobViewer.svelte';

	let projects = $state<any[]>([]);
	let rawBatchedReports = $state<any[]>([]);
	let todayReports = $state<Record<number, boolean>>({});
	// Fase 3 (Loop Perbaikan, 17 Sep 2026) — jumlah laporan revision_requested/rejected
	// milik leader ini, dipakai banner di atas daftar proyek.
	let needFixCount = $state(0);
	let loading = $state(true);

	// Dynamic Progress Loader untuk Laporan Proyek
	let laporanLoadPercent = $state(25);
	let laporanLoadStep = $state(1);
	let laporanLoadLabel = $state('Mengambil data proyek & laporan harian...');
	let laporanTimer: any = null;

	$effect(() => {
		if (loading) {
			if (!laporanTimer) {
				laporanLoadPercent = 20;
				laporanLoadStep = 1;
				laporanLoadLabel = 'Mengambil data proyek aktif leader...';
				laporanTimer = setInterval(() => {
					if (loading) {
						if (laporanLoadPercent < 55) {
							laporanLoadPercent += 8;
							laporanLoadStep = 2;
							laporanLoadLabel = 'Memeriksa histori laporan harian...';
						} else if (laporanLoadPercent < 85) {
							laporanLoadPercent += 5;
							laporanLoadStep = 3;
							laporanLoadLabel = 'Mengkalkulasi skor kepatuhan & KPI pelaporan...';
						} else if (laporanLoadPercent < 95) {
							laporanLoadPercent += 1.5;
							laporanLoadStep = 4;
							laporanLoadLabel = 'Menyiapkan kartu laporan proyek...';
						}
					} else {
						laporanLoadPercent = 100;
						if (laporanTimer) {
							clearInterval(laporanTimer);
							laporanTimer = null;
						}
					}
				}, 200);
			}
		} else {
			if (laporanTimer) {
				clearInterval(laporanTimer);
				laporanTimer = null;
			}
			laporanLoadPercent = 100;
		}
	});

	onDestroy(() => {
		if (laporanTimer) clearInterval(laporanTimer);
	});
	let isDownloadingPdf = $state(false);
	let previewSummaryBlob = $state<Blob | null>(null);
	let previewSummaryTitle = $state<string>('');
	let showSummaryPreview = $state(false);
	let searchQuery = $state('');
	let selectedPeriod = $state<ReportPeriod>('hari_ini');
	let customDateStr = $state<string>(new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
	// Score states
	let reportScore = $state<LeaderReportScore | null>(null);
	let scoreLoading = $state(false);
	let scoreExpanded = $state(false);
	let scoreError = $state(false);

	let filteredProjects = $derived(
		searchQuery.trim()
			? projects.filter(p => {
				const q = searchQuery.trim().toLowerCase();
				return (p.name || '').toLowerCase().includes(q)
					|| (p.lokasi || '').toLowerCase().includes(q)
					|| (p.leader || '').toLowerCase().includes(q)
					|| (p.nomor_po || '').toLowerCase().includes(q)
					|| String(p.id).includes(q);
			})
			: projects
	);

	let requiredProjects = $derived(projects.filter(p => ['on progress', 'waiting', 'hold', 'repair'].includes((p.status || '').toLowerCase())));

	let sudahKumpul = $derived(filteredProjects.filter(p => todayReports[p.id]));
	let belumKumpul = $derived(filteredProjects.filter(p => !todayReports[p.id] && ['on progress', 'waiting', 'hold', 'repair'].includes((p.status || '').toLowerCase())));
	let tidakWajib = $derived(filteredProjects.filter(p => !todayReports[p.id] && !['on progress', 'waiting', 'hold', 'repair'].includes((p.status || '').toLowerCase())));

	let expandSudah = $state(true);
	let expandBelum = $state(true);
	let expandTidakWajib = $state(false);

	let currentRoleId: string | null = null;
	let currentKaryawanId: number | null = null;
	// PRJ-18: tautan Review hanya untuk yang berizin approve_laporan (server tetap memeriksa).
	const canReview = $derived(hasPermission($authStore.roleId, 'approve_laporan', $rolesStore));
	let currentKaryawanName: string | null = null;
	let currentDirectusToken: string | null = null;

	const unsubAuth = authStore.subscribe((s) => {
		currentRoleId = s.roleId;
		currentKaryawanId = s.karyawanId;
		currentKaryawanName = s.karyawanName;
		currentDirectusToken = s.directusToken;
	});

	function getScoreColor(score: number): string {
		if (score >= 80) return '#34C759';
		if (score >= 50) return '#FF9500';
		return '#FF3B30';
	}

	function getStatusBadgeStyle(status: string): string {
		const s = (status || '').toLowerCase();
		if (s === 'on progress') return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30';
		if (s === 'repair') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30';
		if (s === 'waiting' || s === 'hold') return 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30';
		return 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/30';
	}

	async function loadScoreSafely(activeProjects: any[], period: ReportPeriod = selectedPeriod) {
		if (activeProjects.length === 0) {
			const now = new Date();
			let monthName = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
			if (period === 'hari_ini') {
				monthName = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
			} else if (period === 'tanggal') {
				const cDate = new Date(customDateStr);
				monthName = cDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
			} else if (period === 'mingguan') {
				monthName = 'Minggu Ini';
			}
			reportScore = { month: monthName, totalScore: 0, projects: [] };
			return;
		}

		scoreLoading = true;
		scoreError = false;
		try {
			const mappedProjects = activeProjects.map(p => ({ id: p.id, name: p.name }));
			reportScore = await getLeaderReportScore(mappedProjects, period, customDateStr);
		} catch (e) {
			console.error('Gagal memuat skor laporan:', e);
			scoreError = true;
		} finally {
			scoreLoading = false;
		}
	}

	async function applyPeriodFilter() {
		let startDateStr = '';
		let endDateStr = '';

		const now = new Date();
		
		if (selectedPeriod === 'tanggal') {
			startDateStr = customDateStr;
			endDateStr = customDateStr;
		} else if (selectedPeriod === 'hari_ini') {
			const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
			startDateStr = todayStr;
			endDateStr = todayStr;
		} else if (selectedPeriod === 'mingguan') {
			const day = now.getDay();
			const diff = now.getDate() - day + (day === 0 ? -6 : 1);
			const startOfWeek = new Date(now);
			startOfWeek.setDate(diff);
			
			startDateStr = new Date(startOfWeek.getTime() - startOfWeek.getTimezoneOffset() * 60000).toISOString().split('T')[0];
			endDateStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
		} else if (selectedPeriod === 'bulanan') {
			const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
			
			startDateStr = new Date(startOfMonth.getTime() - startOfMonth.getTimezoneOffset() * 60000).toISOString().split('T')[0];
			endDateStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
		}

		if (projects.length > 0) {
			const projectIds = projects.flatMap(p => p._is_ciketing_group ? p._ciketing_ids : [p.id]);
			try {
				rawBatchedReports = await getBatchedReports(projectIds, {
					startDate: startDateStr,
					endDate: endDateStr,
					fields: ['id', 'project_id', 'date', 'date_created', 'manpower']
				});
			} catch (e) {
				console.error('Gagal memuat batched reports:', e);
			}
		}

		const newTodayReports: Record<number, boolean> = {};
		projects.forEach(p => {
			const projectReports = rawBatchedReports.filter((r: any) => {
				if (p._is_ciketing_group) {
					return p._ciketing_ids.includes(r.project_id);
				}
				return r.project_id === p.id;
			});
			const hasReportInPeriod = projectReports.some((r: any) => {
				const rDate = r.date ? r.date.split('T')[0] : '';
				if (!rDate) return false;
				if (selectedPeriod === 'hari_ini' || selectedPeriod === 'tanggal') {
					return rDate === endDateStr;
				}
				return rDate >= startDateStr && rDate <= endDateStr;
			});
			newTodayReports[p.id] = hasReportInPeriod;
		});
		todayReports = newTodayReports;

		if (isLeaderRole(currentRoleId)) {
			const activeProjects = projects.filter((p: any) => ['on progress', 'waiting', 'hold', 'repair'].includes((p.status || '').toLowerCase()));
			loadScoreSafely(activeProjects, selectedPeriod);
		}
	}

	let sharingPdfId = $state<number | null>(null);

	async function shareWAPdf(project: any) {
		if (sharingPdfId) return;
		sharingPdfId = project.id;
		
		try {
			// Fetch the latest report for this project
			const reports = await getReports(project.id, { limit: 1 });
			const report = reports.length > 0 ? reports[0] : null;
			if (!report) {
				alert('Laporan tidak ditemukan.');
				return;
			}

			// Parse progress if it's string
			let progress = [];
			try {
				progress = typeof report.progress === 'string' ? JSON.parse(report.progress) : (report.progress || []);
			} catch (e) { }

			// Build HTML template
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = `
				<div style="padding: 40px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333;">
					<h2 style="text-align:center; color: #128C7E; margin-bottom: 5px;">LAPORAN HARIAN PROYEK</h2>
					<hr style="border: 1px solid #eee; margin-bottom: 20px;" />
					
					<table style="width: 100%; margin-bottom: 20px; font-size: 14px;">
						<tr>
							<td style="padding: 4px 0; width: 30%;"><strong>Nama Proyek</strong></td>
							<td style="padding: 4px 0;">: ${project.name}</td>
						</tr>
						<tr>
							<td style="padding: 4px 0;"><strong>Lokasi</strong></td>
							<td style="padding: 4px 0;">: ${project.lokasi || '-'}</td>
						</tr>
						<tr>
							<td style="padding: 4px 0;"><strong>Leader</strong></td>
							<td style="padding: 4px 0;">: ${project.leader || '-'}</td>
						</tr>
						<tr>
							<td style="padding: 4px 0;"><strong>Tanggal</strong></td>
							<td style="padding: 4px 0;">: ${report.date || '-'}</td>
						</tr>
						<tr>
							<td style="padding: 4px 0;"><strong>Cuaca</strong></td>
							<td style="padding: 4px 0;">: ${report.cuaca || '-'}</td>
						</tr>
					</table>

					<h4 style="background: #f5f5f5; padding: 8px; margin-bottom: 10px;">Progress Pekerjaan</h4>
					${progress.length > 0 
						? `<ul style="font-size: 14px; margin-top: 0; padding-left: 20px;">
							${progress.map((p: any) => `<li>${p.activity || p.category || p.notes || '-'}</li>`).join('')}
						   </ul>`
						: `<p style="font-size: 14px; margin-top: 0;">${report.pekerjaan_dilakukan || '-'}</p>`
					}

					<h4 style="background: #f5f5f5; padding: 8px; margin-bottom: 10px;">Kendala</h4>
					<p style="font-size: 14px; margin-top: 0;">${report.kendala || '-'}</p>
					
					<p style="font-size: 14px; margin-top: 0;"><strong>Catatan Tambahan:</strong><br/>${report.general_notes || '-'}</p>

					<div style="margin-top: 40px; font-size: 12px; color: #777; text-align: right;">
						Dicetak dari sistem pada ${new Date().toLocaleString('id-ID')}
					</div>
				</div>
			`;
			document.body.appendChild(tempDiv);

			// T7 (Delegasi Peran Fase 0.4) — dulu dimuat dari CDN cdnjs saat runtime,
			// tapi CSP produksi mengunci script-src ke 'self' + domain Google saja,
			// jadi gagal senyap. html2pdf.js sudah terdaftar di dependencies — import
			// lokal lewat bundler, tidak menyentuh jaringan/CSP sama sekali.
			const html2pdf = (await import('html2pdf.js')).default;

			const opt = {
				margin:       0,
				filename:     `Laporan-${project.name}.pdf`,
				image:        { type: 'jpeg', quality: 0.98 },
				html2canvas:  { scale: 2 },
				jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
			};

			const pdfBlob = await html2pdf().set(opt).from(tempDiv).output('blob');
			document.body.removeChild(tempDiv);

			const file = new File([pdfBlob], `Laporan_${project.name.replace(/\s+/g, '_')}.pdf`, { type: 'application/pdf' });

			if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
				try {
					await navigator.share({
						files: [file],
						title: `Laporan ${project.name}`,
						text: `Laporan harian proyek ${project.name} sudah dikumpulkan.`
					});
				} catch (err: any) {
					if (err.name !== 'AbortError') {
						fallbackDownloadPdf(file, project);
					}
				}
			} else {
				fallbackDownloadPdf(file, project);
			}

		} catch (err) {
			console.error('Gagal generate PDF WA', err);
			alert('Gagal membuat PDF.');
		} finally {
			sharingPdfId = null;
		}
	}

	async function downloadSummaryPdf() {
		if (isDownloadingPdf) return;
		isDownloadingPdf = true;

		try {
			let startDateStr = '';
			let endDateStr = '';
			const now = new Date();
			
			if (selectedPeriod === 'tanggal') {
				startDateStr = customDateStr;
				endDateStr = customDateStr;
			} else if (selectedPeriod === 'hari_ini') {
				const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
				startDateStr = todayStr;
				endDateStr = todayStr;
			} else if (selectedPeriod === 'mingguan') {
				const day = now.getDay();
				const diff = now.getDate() - day + (day === 0 ? -6 : 1);
				const startOfWeek = new Date(now);
				startOfWeek.setDate(diff);
				startDateStr = new Date(startOfWeek.getTime() - startOfWeek.getTimezoneOffset() * 60000).toISOString().split('T')[0];
				endDateStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
			} else if (selectedPeriod === 'bulanan') {
				const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
				startDateStr = new Date(startOfMonth.getTime() - startOfMonth.getTimezoneOffset() * 60000).toISOString().split('T')[0];
				endDateStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
			}

			const projectIds = sudahKumpul.flatMap(p => p._is_ciketing_group ? p._ciketing_ids : [p.id]);
			let detailedReports: any[] = [];
			if (projectIds.length > 0) {
				detailedReports = await getReportsByDateRange(projectIds, startDateStr, endDateStr);
			}

			let reportsHtml = '';
			sudahKumpul.forEach(p => {
				const pReports = detailedReports.filter(r => p._is_ciketing_group ? p._ciketing_ids.includes(r.project_id) : r.project_id === p.id);
				
				pReports.forEach(report => {
					let progress: any[] = [];
					try {
						progress = typeof report.progress === 'string' ? JSON.parse(report.progress) : (report.progress || []);
					} catch(e) {}
					
					let progressHtml = progress.length > 0
						? `<ul style="font-size: 14px; margin-top: 0; padding-left: 20px;">${progress.map((pr: any) => `<li>${pr.activity || pr.category || pr.notes || '-'}</li>`).join('')}</ul>`
						: `<p style="font-size: 14px; margin-top: 0;">${report.pekerjaan_dilakukan || '-'}</p>`;
						
					reportsHtml += `
						<div style="page-break-before: always; padding: 40px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333;">
							<h2 style="text-align:center; color: #128C7E; margin-bottom: 5px;">LAPORAN PROYEK</h2>
							<hr style="border: 1px solid #eee; margin-bottom: 20px;" />
							<table style="width: 100%; margin-bottom: 20px; font-size: 14px;">
								<tr><td style="padding: 4px 0; width: 30%;"><strong>Nama Proyek</strong></td><td style="padding: 4px 0;">: ${p.name}</td></tr>
								<tr><td style="padding: 4px 0;"><strong>Lokasi</strong></td><td style="padding: 4px 0;">: ${p.lokasi || '-'}</td></tr>
								<tr><td style="padding: 4px 0;"><strong>Leader</strong></td><td style="padding: 4px 0;">: ${p.leader || '-'}</td></tr>
								<tr><td style="padding: 4px 0;"><strong>Tanggal Laporan</strong></td><td style="padding: 4px 0;">: ${report.date || '-'}</td></tr>
								<tr><td style="padding: 4px 0;"><strong>Cuaca</strong></td><td style="padding: 4px 0;">: ${report.cuaca || '-'}</td></tr>
							</table>
							<h4 style="background: #f5f5f5; padding: 8px; margin-bottom: 10px;">Progress Pekerjaan</h4>
							${progressHtml}
							<h4 style="background: #f5f5f5; padding: 8px; margin-bottom: 10px;">Kendala</h4>
							<p style="font-size: 14px; margin-top: 0;">${report.kendala || '-'}</p>
							<p style="font-size: 14px; margin-top: 0;"><strong>Catatan Tambahan:</strong><br/>${report.general_notes || '-'}</p>
						</div>
					`;
				});
			});

			let titlePeriod = selectedPeriod.toUpperCase().replace('_', ' ');
			if (selectedPeriod === 'tanggal') {
				titlePeriod = customDateStr;
			}
			
			let statsHtml = `
				<div style="padding: 40px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333;">
					<h2 style="text-align:center; color: #128C7E; margin-bottom: 5px;">SUMMARY KEPATUHAN LAPORAN</h2>
					<h4 style="text-align:center; color: #777; margin-top: 0; margin-bottom: 20px;">Periode: ${titlePeriod}</h4>
					<hr style="border: 1px solid #eee; margin-bottom: 20px;" />
					
					<div style="display: flex; gap: 20px; margin-bottom: 30px;">
						<div style="flex: 1; background: #f9f9f9; padding: 15px; border-radius: 8px; border-left: 4px solid #007AFF;">
							<div style="font-size: 12px; color: #777; margin-bottom: 5px; text-transform: uppercase;">Total Project Aktif</div>
							<div style="font-size: 24px; font-weight: bold;">${requiredProjects.length}</div>
						</div>
						<div style="flex: 1; background: #E8F5E9; padding: 15px; border-radius: 8px; border-left: 4px solid #34C759;">
							<div style="font-size: 12px; color: #777; margin-bottom: 5px; text-transform: uppercase;">Sudah Laporan</div>
							<div style="font-size: 24px; font-weight: bold; color: #2E7D32;">${sudahKumpul.length}</div>
						</div>
						<div style="flex: 1; background: #FFEBEE; padding: 15px; border-radius: 8px; border-left: 4px solid #FF3B30;">
							<div style="font-size: 12px; color: #777; margin-bottom: 5px; text-transform: uppercase;">Belum Laporan</div>
							<div style="font-size: 24px; font-weight: bold; color: #D32F2F;">${belumKumpul.length}</div>
						</div>
					</div>
					
					<h3 style="color: #333; margin-bottom: 10px;">Daftar Proyek Sudah Kumpul</h3>
					<table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px;">
						<thead>
							<tr style="background: #f5f5f5; text-align: left;">
								<th style="padding: 8px; border: 1px solid #eee;">Nama Proyek</th>
								<th style="padding: 8px; border: 1px solid #eee;">Leader</th>
								<th style="padding: 8px; border: 1px solid #eee;">Status</th>
							</tr>
						</thead>
						<tbody>
							${sudahKumpul.map(p => `
								<tr>
									<td style="padding: 8px; border: 1px solid #eee;">${p.name}</td>
									<td style="padding: 8px; border: 1px solid #eee;">${p.leader || '-'}</td>
									<td style="padding: 8px; border: 1px solid #eee;">${p.status ? p.status.replace('_', ' ') : '-'}</td>
								</tr>
							`).join('')}
							${sudahKumpul.length === 0 ? '<tr><td colspan="3" style="padding: 8px; border: 1px solid #eee; text-align: center;">Tidak ada data</td></tr>' : ''}
						</tbody>
					</table>
					
					<h3 style="color: #333; margin-bottom: 10px;">Daftar Proyek Belum Kumpul</h3>
					<table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px;">
						<thead>
							<tr style="background: #f5f5f5; text-align: left;">
								<th style="padding: 8px; border: 1px solid #eee;">Nama Proyek</th>
								<th style="padding: 8px; border: 1px solid #eee;">Leader</th>
								<th style="padding: 8px; border: 1px solid #eee;">Status</th>
							</tr>
						</thead>
						<tbody>
							${belumKumpul.map(p => `
								<tr>
									<td style="padding: 8px; border: 1px solid #eee;">${p.name}</td>
									<td style="padding: 8px; border: 1px solid #eee;">${p.leader || '-'}</td>
									<td style="padding: 8px; border: 1px solid #eee;">${p.status ? p.status.replace('_', ' ') : '-'}</td>
								</tr>
							`).join('')}
							${belumKumpul.length === 0 ? '<tr><td colspan="3" style="padding: 8px; border: 1px solid #eee; text-align: center;">Tidak ada data</td></tr>' : ''}
						</tbody>
					</table>
				</div>
			`;

			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = statsHtml + reportsHtml;
			document.body.appendChild(tempDiv);

			const html2pdf = (await import('html2pdf.js')).default;

			const opt = {
				margin:       0,
				filename:     `Summary_Laporan_${titlePeriod.replace(/\s+/g, '_')}.pdf`,
				image:        { type: 'jpeg', quality: 0.98 },
				html2canvas:  { scale: 2 },
				jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' },
				pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
			};

			const pdfBlob = await html2pdf().set(opt).from(tempDiv).output('blob');
			document.body.removeChild(tempDiv);
			previewSummaryBlob = pdfBlob;
			previewSummaryTitle = `Summary_Laporan_${titlePeriod.replace(/\s+/g, '_')}.pdf`;
			showSummaryPreview = true;
		} catch (err) {
			console.error('Gagal generate PDF Summary', err);
			alert('Gagal membuat PDF.');
		} finally {
			isDownloadingPdf = false;
		}
	}

	function fallbackDownloadPdf(file: File, project: any) {
		const url = URL.createObjectURL(file);
		const a = document.createElement('a');
		a.href = url;
		a.download = file.name;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		
		alert('Browser tidak mendukung bagikan file langsung ke WhatsApp. File PDF telah diunduh, silakan lampirkan di WhatsApp Anda.');
		const text = encodeURIComponent(`Laporan proyek ${project.name} sudah dikumpulkan. Cek PDF terlampir.`);
		window.open(`https://wa.me/?text=${text}`, '_blank');
	}

	onMount(async () => {
		try {
			const result: any[] = await getProjectsForCurrentUser(false);

			let rawProjects = result || [];
			// F0 (25 Agu 2026): heuristik lama (keyword 'ciketing' di banyak field + 'alwan'
			// sebagai nama leader) terbukti 2x salah — menyapu project customer biasa yang
			// tidak terhubung workshop. Sekarang hanya percaya field `workshop` (diisi
			// eksplisit user di Input PO Customer), sama seperti isCiketingProject() di
			// erp-epi-1/src/lib/utils/projectUtils.js. Filter status aktif JUGA dihapus —
			// sebelumnya project workshop yang SEDANG BERJALAN justru tidak ikut ter-group.
			const isCiketing = (p: any) => p.workshop === 'ciketing';
			let ciketingProjects = rawProjects.filter(p => isCiketing(p));
			rawProjects = rawProjects.filter(p => !isCiketing(p));

			if (ciketingProjects.length > 0) {
				let mergedP = JSON.parse(JSON.stringify(ciketingProjects[0]));
				mergedP.name = "Proyek Ciketing";
				mergedP.nomor_po = "Multiple PO";
				mergedP._is_ciketing_group = true;
				mergedP._ciketing_ids = ciketingProjects.map(p => p.id);
				
				if (ciketingProjects.some(c => (c.status || '').toLowerCase() === 'on progress')) {
					mergedP.status = 'on progress';
				} else if (ciketingProjects.some(c => (c.status || '').toLowerCase() === 'repair')) {
					mergedP.status = 'repair';
				} else if (ciketingProjects.some(c => (c.status || '').toLowerCase() === 'waiting')) {
					mergedP.status = 'waiting';
				} else if (ciketingProjects.some(c => (c.status || '').toLowerCase() === 'hold')) {
					mergedP.status = 'hold';
				}

				rawProjects.push(mergedP);
			}
			projects = rawProjects;
			loading = false; // Langsung tampilkan proyek ke layar

			// Fire-and-forget: banner tunggakan revisi tidak boleh menunda render proyek.
			getReportsNeedingFix(currentKaryawanId as any, rawProjects.map((p: any) => p.id))
				.then((rows) => { needFixCount = (rows || []).length; })
				.catch(() => {});

			if (projects.length > 0) {
				// Load score for leader INDEPENDENTLY
				if (isLeaderRole(currentRoleId)) {
					const activeProjects = projects.filter((p: any) => ['on progress', 'waiting', 'hold', 'repair'].includes((p.status || '').toLowerCase()));
					loadScoreSafely(activeProjects);
				}

				// Fetch batched reports sesuai periode
				applyPeriodFilter().catch((reportError) => {
					console.error('Gagal mengecek status laporan:', reportError);
				});
			}
		} catch (e) {
			console.error('Gagal memuat proyek:', e);
		} finally {
			loading = false;
		}

		return () => unsubAuth();
	});
</script>

<div class="flex-1 flex flex-col h-full">

	{#if loading}
		<div class="flex-1 flex items-center justify-center p-6" style="background: var(--sys-bg)">
			<CircularProgressGauge
				percent={laporanLoadPercent}
				step={laporanLoadStep}
				totalSteps={4}
				stepLabel={laporanLoadLabel}
				subLabel="Directus /items/reports & scoring KPI"
				hint="Memuat riwayat laporan harian proyek lapangan & ringkasan kepatuhan"
				timeoutSeconds={25}
				onRetry={() => { loadProjects(); loadReports(); }}
			/>
		</div>
	{:else}
		<div class="scroll-body px-4 py-4" style="background: var(--sys-bg)">
			
			<div class="flex items-center justify-between mb-4 mt-1 bg-[var(--sys-bg2)] p-3 rounded-2xl shadow-sm border border-[var(--sys-sep)]">
				<div class="flex items-center gap-2">
					<IconChartPie size={18} class="text-[var(--g)]" />
					<span class="text-[13px] font-bold text-[var(--sys-label)]">Filter Periode</span>
				</div>
				<div class="flex items-center gap-2">
					{#if selectedPeriod === 'tanggal'}
						<input 
							type="date" 
							bind:value={customDateStr} 
							onchange={applyPeriodFilter}
							class="bg-[var(--sys-fill2)] border border-[var(--sys-sep)] text-[12px] font-semibold text-[var(--sys-label)] rounded-xl px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-[var(--b)]"
						/>
					{/if}
					<select 
						bind:value={selectedPeriod}
						onchange={applyPeriodFilter}
						class="bg-[var(--sys-fill2)] border border-[var(--sys-sep)] text-[12px] font-semibold text-[var(--sys-label)] rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-[var(--b)] cursor-pointer"
					>
						<option value="hari_ini">Hari Ini</option>
						<option value="mingguan">Mingguan</option>
						<option value="bulanan">Bulanan</option>
						<option value="tanggal">Tanggal Tertentu</option>
					</select>
					<button 
						class="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3.5 py-1.5 rounded-xl text-[12px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
						onclick={downloadSummaryPdf}
						disabled={isDownloadingPdf}
						title="Download Summary PDF"
					>
						{#if isDownloadingPdf}
							<IconLoader2 size={16} class="animate-spin" />
						{:else}
							<IconDownload size={16} />
						{/if}
						<span class="hidden sm:inline">PDF</span>
					</button>
				</div>
			</div>
			
			<!-- Score Widget (Leader Only) -->
			{#if isLeaderRole(currentRoleId)}
				<div class="mb-5 bg-[var(--sys-bg2)] border border-[var(--sys-sep)] rounded-2xl p-4 shadow-sm">
					<div class="flex items-start justify-between">
						<div>
							<h3 class="text-[13px] font-bold text-[var(--sys-label)] flex items-center gap-1.5">
								<IconChartPie size={16} class="text-[var(--g)]" />
								Skor Kepatuhan Laporan
							</h3>
							<p class="text-[11px] text-[var(--sys-label3)] mt-0.5">{reportScore?.month || 'Bulan ini'}</p>
						</div>
						
						{#if scoreLoading}
							<div class="w-5 h-5 border-2 border-[var(--gl)] border-t-[var(--g)] rounded-full animate-spin"></div>
						{:else if scoreError}
							<div class="text-[11px] text-[var(--re)] font-medium">Gagal memuat</div>
						{:else if reportScore}
							<div class="text-right">
								<div class="text-[22px] font-bold tracking-tight leading-none" style="color: {getScoreColor(reportScore.totalScore)}">
									{reportScore.totalScore}%
								</div>
							</div>
						{/if}
					</div>

					{#if !scoreLoading && !scoreError && reportScore && reportScore.projects.length > 0}
						<button 
							class="w-full mt-3 py-1.5 flex items-center justify-center gap-1 text-[11px] font-semibold bg-[var(--sys-fill)] text-[var(--sys-label3)] rounded-lg transition-colors hover:bg-[var(--sys-fill2)] active:bg-[var(--sys-fill3)]"
							onclick={() => scoreExpanded = !scoreExpanded}
						>
							{scoreExpanded ? 'Tutup Detail' : 'Lihat Detail Per Proyek'}
							{#if scoreExpanded}
								<IconChevronUp size={14} />
							{:else}
								<IconChevronDown size={14} />
							{/if}
						</button>

						{#if scoreExpanded}
							<div class="mt-3 flex flex-col gap-2.5 pt-3 border-t border-[var(--sys-sep)]">
								{#each reportScore.projects as proj}
									<div>
										<div class="flex justify-between items-center mb-1">
											<span class="text-[12px] font-medium text-[var(--sys-label)] truncate flex-1">{proj.projectName}</span>
											<span class="text-[11px] font-bold ml-2" style="color: {getScoreColor(proj.score)}">{proj.score}%</span>
										</div>
										<div class="flex items-center gap-2">
											<div class="flex-1 h-1.5 bg-[var(--sys-fill)] rounded-full overflow-hidden">
												<div class="h-full rounded-full transition-all duration-500" style="width: {proj.score}%; background: {getScoreColor(proj.score)}"></div>
											</div>
											<span class="text-[10px] text-[var(--sys-label3)] w-14 text-right">
												{proj.reportedDays}/{proj.totalWorkDays} hr
											</span>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					{:else if !scoreLoading && !scoreError && reportScore && reportScore.projects.length === 0}
						<div class="mt-3 pt-3 border-t border-[var(--sys-sep)] text-[11px] text-[var(--sys-label3)] text-center">
							Tidak ada proyek aktif.
						</div>
					{/if}
				</div>
			{/if}

			{#if canReview}
				<!-- PRJ-18: antrean review laporan harian untuk PM (setujui / minta revisi / setujui massal). -->
				<a href="/laporan/review" class="bg-emerald-600 hover:bg-emerald-700 text-white p-4 rounded-2xl mb-3 mt-2 flex items-center justify-between shadow-md transition-all block text-left">
					<div>
						<div class="text-[13px] font-extrabold tracking-tight">Review Laporan Harian</div>
						<div class="text-[11px] text-emerald-50/90">Setujui, minta revisi, atau setujui massal laporan Leader</div>
					</div>
					<IconChevronRight size={20} class="text-white shrink-0" />
				</a>
			{/if}

			{#if needFixCount > 0}
				<!-- Fase 3 (Loop Perbaikan, Gate Keras Disiplin Data & Laporan Harian, 17 Sep
				     2026, menutup C6) — sebelumnya leader tidak punya cara melihat laporan yang
				     diminta diperbaiki sama sekali. -->
				<a href="/laporan/perlu-diperbaiki" class="bg-amber-500 hover:bg-amber-600 text-white p-4 rounded-2xl mb-3 mt-2 flex items-center justify-between shadow-md transition-all group block text-left">
					<div class="flex items-center gap-2.5">
						<IconInfoCircle size={22} class="text-white/90 shrink-0" />
						<div>
							<div class="text-[13px] font-extrabold tracking-tight text-white">
								{needFixCount} Laporan Perlu Diperbaiki
							</div>
							<div class="text-[11px] text-amber-50/90">Ketuk untuk lihat & kirim ulang sebelum batas waktu</div>
						</div>
					</div>
					<IconChevronRight size={20} class="text-white shrink-0" />
				</a>
			{/if}

			<a href="/laporan/general" class="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white p-4.5 rounded-2xl mb-4 mt-2 flex items-center justify-between shadow-md hover:shadow-lg cursor-pointer transition-all group block text-left">
				<div>
					<div class="text-[11px] font-bold uppercase tracking-wider mb-0.5 text-blue-100/90">Daily General Report</div>
					<div class="text-[15px] font-extrabold tracking-tight text-white">Isi Lokasi & Update Harian Leader</div>
				</div>
				<div class="bg-white/20 backdrop-blur-md w-9 h-9 rounded-xl flex items-center justify-center group-hover:scale-105 group-hover:bg-white/30 transition-all">
					<IconChevronRight size={20} class="text-white" />
				</div>
			</a>

			<div class="flex overflow-x-auto gap-3 mb-4 mt-2 pb-2 -mx-4 px-4 snap-x hide-scrollbar">
				<!-- Total -->
				<div class="min-w-[150px] flex-1 shrink-0 bg-[var(--sys-bg2)] rounded-2xl p-4 border-l-4 border-[var(--b)] border-y border-r border-[var(--sys-sep)] shadow-xs snap-start">
					<div class="text-[11px] font-bold text-[var(--sys-label3)] uppercase tracking-wider mb-1">TOTAL PROJECT AKTIF</div>
					<div class="text-2xl font-black tracking-tight text-[var(--sys-label)]">{requiredProjects.length}</div>
				</div>
				<!-- Sudah -->
				<div class="min-w-[150px] flex-1 shrink-0 bg-[var(--sys-bg2)] rounded-2xl p-4 border-l-4 border-emerald-500 border-y border-r border-[var(--sys-sep)] shadow-xs snap-start">
					<div class="text-[11px] font-bold text-[var(--sys-label3)] uppercase tracking-wider mb-1">SUDAH LAPORAN</div>
					<div class="text-2xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
						{requiredProjects.filter(p => todayReports[p.id]).length}
					</div>
					<div class="text-[11px] font-semibold text-[var(--sys-label3)] mt-1.5">
						{requiredProjects.length > 0 ? Math.round(requiredProjects.filter(p => todayReports[p.id]).length / requiredProjects.length * 100) : 0}% compliance
					</div>
				</div>
				<!-- Belum -->
				<div class="min-w-[150px] flex-1 shrink-0 bg-[var(--sys-bg2)] rounded-2xl p-4 border-l-4 border-rose-500 border-y border-r border-[var(--sys-sep)] shadow-xs snap-start">
					<div class="text-[11px] font-bold text-[var(--sys-label3)] uppercase tracking-wider mb-1">BELUM LAPORAN</div>
					<div class="text-2xl font-black tracking-tight text-rose-600 dark:text-rose-400">
						{requiredProjects.filter(p => !todayReports[p.id]).length}
					</div>
					<div class="text-[11px] font-semibold text-[var(--sys-label3)] mt-1.5">
						{requiredProjects.length > 0 ? Math.round(requiredProjects.filter(p => !todayReports[p.id]).length / requiredProjects.length * 100) : 0}% belum submit
					</div>
				</div>
			</div>

			<!-- Keterangan Verifikasi Proyek -->
			<div class="mb-4 p-3.5 rounded-2xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex items-start gap-3 shadow-xs">
				<IconInfoCircle size={20} class="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
				<div class="text-[12px] leading-relaxed">
					<strong class="font-bold">Perhatian:</strong> Pastikan daftar di bawah ini terdapat proyek yang Anda pegang. Jika tidak atau proyek yang bukan milik Anda muncul, harap hubungi <strong>Admin</strong>.
				</div>
			</div>

			{#if projects.length > 0}
				<div class="relative mb-5 bg-[var(--sys-bg2)] border border-[var(--sys-sep)] p-2.5 rounded-2xl shadow-xs flex items-center focus-within:ring-2 focus-within:ring-[var(--b)]/40 transition-all">
					<IconSearch size={16} class="ml-2.5 pointer-events-none shrink-0" style="color: var(--sys-label3)" />
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Cari project, leader, atau customer..."
						class="w-full px-3 py-1 text-[13px] font-medium bg-transparent outline-none text-[var(--sys-label)] placeholder:text-[var(--sys-label3)]"
					/>
					{#if searchQuery}
						<button
							class="w-5 h-5 rounded-full flex items-center justify-center mr-1"
							style="background: var(--sys-fill2); color: var(--sys-label3)"
							onclick={() => searchQuery = ''}
						>
							<IconX size={11} />
						</button>
					{/if}
				</div>
				<div class="-mt-3 mb-5">
					<FieldHint text={h('laporan.form.proyek').fieldHint} />
				</div>
			{/if}

			{#if projects.length === 0}
				<EmptyStateGuide
					message={h('laporan.empty').message}
					hints={h('laporan.empty').hints ?? []}
				/>
			{:else if filteredProjects.length === 0}
				<div class="text-center py-8 text-[13px]" style="color: var(--sys-label3)">Tidak ada proyek yang cocok dengan "{searchQuery}"</div>
			{:else}
				
				<!-- Accordion Sudah Kumpul -->
				<div class="bg-[var(--sys-bg2)] rounded-2xl shadow-xs mb-4 overflow-hidden border border-[var(--sys-sep)]">
					<button class="w-full px-4.5 py-3.5 flex items-center justify-between bg-[var(--sys-bg2)] transition-colors hover:bg-[var(--sys-fill)]" onclick={() => expandSudah = !expandSudah}>
						<div class="flex items-center gap-3 text-left">
							<span class="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">{sudahKumpul.length}</span>
							<span class="text-[14px] font-bold text-[var(--sys-label)]">Sudah Kumpul</span>
							<span class="text-[11px] text-[var(--sys-label3)] font-medium hidden sm:inline">Sudah disubmit pada periode ini</span>
						</div>
						{#if expandSudah}
							<IconChevronUp size={18} style="color: var(--sys-label3)" />
						{:else}
							<IconChevronDown size={18} style="color: var(--sys-label3)" />
						{/if}
					</button>
					
					{#if expandSudah}
						<div class="border-t border-[var(--sys-sep)]">
							{#if sudahKumpul.length === 0}
								<div class="py-8 text-center text-[12px] text-[var(--sys-label3)] bg-[var(--sys-fill)]/30 font-medium">
									Belum ada laporan masuk untuk tanggal ini.
								</div>
							{:else}
								<!-- Desktop View (Table) -->
								<div class="hidden lg:block">
								<div class="overflow-x-auto">
									<table class="w-full text-left min-w-[700px]">
										<thead>
											<tr class="text-[11px] text-[var(--sys-label2)] uppercase tracking-wider font-bold border-b border-[var(--sys-sep)] bg-[var(--sys-fill)]/60">
												<th class="py-3 px-4 w-[30%]">PROJECT</th>
												<th class="py-3 px-4 w-[16%]">LEADER</th>
												<th class="py-3 px-4 w-[20%]">CUSTOMER/LOKASI</th>
												<th class="py-3 px-4 w-[14%]">JENIS</th>
												<th class="py-3 px-4 w-[10%]">STATUS</th>
												<th class="py-3 px-4 w-[10%] text-center">AKSI</th>
											</tr>
										</thead>
										<tbody>
											{#each sudahKumpul as project (project.id)}
												<tr class="border-b border-[var(--sys-sep)] last:border-b-0 hover:bg-[var(--sys-fill)]/50 transition-colors group">
													<td class="py-3.5 px-4">
														<a href="/laporan/{project.id}" class="text-left w-full block focus:outline-none cursor-pointer">
															<div class="text-[13px] font-bold text-[var(--sys-label)] group-hover:text-blue-500 transition-colors truncate">{project.name}</div>
															<div class="text-[11px] font-medium text-[var(--sys-label3)] mt-0.5 truncate">
																{project.nomor_po ? project.nomor_po + ' · ' : ''}ID-{project.id}
															</div>
														</a>
													</td>
													<td class="py-3.5 px-4">
														<div class="flex items-center gap-2">
															<div class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25 shrink-0 uppercase shadow-xs">
																{project.leader ? project.leader.charAt(0) : '?'}
															</div>
															<span class="text-[12px] font-semibold text-[var(--sys-label)] truncate">{project.leader || '-'}</span>
														</div>
													</td>
													<td class="py-3.5 px-4">
														<div class="text-[12px] font-medium text-[var(--sys-label2)] truncate">{project.lokasi || '-'}</div>
													</td>
													<td class="py-3.5 px-4">
														<div class="text-[12px] text-[var(--sys-label3)] truncate">{project.jenis_project || '-'}</div>
													</td>
													<td class="py-3.5 px-4">
														<div class="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap uppercase tracking-wider {getStatusBadgeStyle(project.status)}">
															{project.status ? project.status.replace('_', ' ') : '-'}
														</div>
													</td>
													<td class="py-3.5 px-4 text-center">
														<div class="flex items-center justify-center gap-2">
															<a 
																href="/laporan/{project.id}" 
																class="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
															>
																Lihat Laporan
															</a>
															<button 
																class="bg-teal-500/10 hover:bg-teal-500/20 text-teal-600 dark:text-teal-400 border border-teal-500/25 px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
																onclick={(e) => {
																	e.stopPropagation();
																	shareWAPdf(project);
																}}
																disabled={sharingPdfId === project.id}
															>
																{#if sharingPdfId === project.id}
																	<IconLoader2 size={14} class="animate-spin" />
																	Memproses...
																{:else}
																	<IconBrandWhatsapp size={14} />
																	Share WA
																{/if}
															</button>
														</div>
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>

								</div>
								<div class="lg:hidden">
								<!-- Mobile View (Cards) -->
								<div class="divide-y divide-[var(--sys-sep)]">
									{#each sudahKumpul as project (project.id)}
										<div class="p-4 flex flex-col gap-2 hover:bg-[var(--sys-fill)]/40 transition-colors">
											<div>
												<a href="/laporan/{project.id}" class="text-left w-full block focus:outline-none cursor-pointer">
													<div class="text-[13px] font-bold text-[var(--sys-label)] leading-snug">{project.name}</div>
													<div class="text-[11px] font-medium text-[var(--sys-label3)] mt-0.5">
														{project.nomor_po ? project.nomor_po + ' · ' : ''}ID-{project.id}
													</div>
												</a>
											</div>
											<div class="flex items-center justify-between mt-1">
												<div class="flex items-center gap-2">
													<div class="w-6.5 h-6.5 rounded-full flex items-center justify-center text-[10px] font-black bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25 shrink-0 uppercase">
														{project.leader ? project.leader.charAt(0) : '?'}
													</div>
													<span class="text-[12px] font-semibold text-[var(--sys-label)] truncate max-w-[140px]">{project.leader || '-'}</span>
												</div>
												<div class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider shrink-0 {getStatusBadgeStyle(project.status)}">
													{project.status ? project.status.replace('_', ' ') : '-'}
												</div>
											</div>
											<div class="flex items-center justify-between mt-2 pt-1 border-t border-[var(--sys-sep)]/50">
												<div class="text-[11px] font-medium text-[var(--sys-label2)] truncate pr-2">{project.lokasi || '-'}</div>
												<div class="flex items-center gap-2">
													<button 
														class="shrink-0 bg-teal-500/10 hover:bg-teal-500/20 text-teal-600 dark:text-teal-400 border border-teal-500/25 px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-colors"
														onclick={(e) => {
															e.stopPropagation();
															shareWAPdf(project);
														}}
														disabled={sharingPdfId === project.id}
													>
														{#if sharingPdfId === project.id}
															<IconLoader2 size={14} class="animate-spin" />
															Memproses...
														{:else}
															<IconBrandWhatsapp size={14} />
															Share WA
														{/if}
													</button>
													<a 
														href="/laporan/{project.id}" 
														class="shrink-0 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
													>
														Lihat
													</a>
												</div>
											</div>
										</div>
									{/each}
								</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Accordion Belum Kumpul -->
				<div class="bg-[var(--sys-bg2)] rounded-2xl shadow-xs mb-4 overflow-hidden border border-[var(--sys-sep)]">
					<button class="w-full px-4.5 py-3.5 flex items-center justify-between bg-[var(--sys-bg2)] transition-colors hover:bg-[var(--sys-fill)]" onclick={() => expandBelum = !expandBelum}>
						<div class="flex items-center gap-3 text-left">
							<span class="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/25">{belumKumpul.length}</span>
							<span class="text-[14px] font-bold text-[var(--sys-label)]">Belum Kumpul</span>
							<span class="text-[11px] text-[var(--sys-label3)] font-medium hidden sm:inline">Belum ada laporan pada periode ini</span>
						</div>
						{#if expandBelum}
							<IconChevronUp size={18} style="color: var(--sys-label3)" />
						{:else}
							<IconChevronDown size={18} style="color: var(--sys-label3)" />
						{/if}
					</button>
					
					{#if expandBelum}
						<div class="border-t border-[var(--sys-sep)]">
							{#if belumKumpul.length === 0}
								<div class="py-8 text-center text-[12px] text-[var(--sys-label3)] bg-[var(--sys-fill)]/30 font-medium">
									Semua laporan sudah dikumpulkan.
								</div>
							{:else}
								<!-- Desktop View (Table) -->
								<div class="hidden lg:block">
								<div class="overflow-x-auto">
									<table class="w-full text-left min-w-[700px]">
										<thead>
											<tr class="text-[11px] text-[var(--sys-label2)] uppercase tracking-wider font-bold border-b border-[var(--sys-sep)] bg-[var(--sys-fill)]/60">
												<th class="py-3 px-4 w-[30%]">PROJECT</th>
												<th class="py-3 px-4 w-[16%]">LEADER</th>
												<th class="py-3 px-4 w-[20%]">CUSTOMER/LOKASI</th>
												<th class="py-3 px-4 w-[14%]">JENIS</th>
												<th class="py-3 px-4 w-[10%]">STATUS</th>
												<th class="py-3 px-4 w-[10%] text-center">AKSI</th>
											</tr>
										</thead>
										<tbody>
											{#each belumKumpul as project (project.id)}
												<tr class="border-b border-[var(--sys-sep)] last:border-b-0 hover:bg-[var(--sys-fill)]/50 transition-colors group">
													<td class="py-3.5 px-4">
														<a href="/laporan/{project.id}" class="text-left w-full block focus:outline-none cursor-pointer">
															<div class="text-[13px] font-bold text-[var(--sys-label)] group-hover:text-blue-500 transition-colors truncate">{project.name}</div>
															<div class="text-[11px] font-medium text-[var(--sys-label3)] mt-0.5 truncate">
																{project.nomor_po ? project.nomor_po + ' · ' : ''}ID-{project.id}
															</div>
														</a>
													</td>
													<td class="py-3.5 px-4">
														<div class="flex items-center gap-2">
															<div class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25 shrink-0 uppercase shadow-xs">
																{project.leader ? project.leader.charAt(0) : '?'}
															</div>
															<span class="text-[12px] font-semibold text-[var(--sys-label)] truncate">{project.leader || '-'}</span>
														</div>
													</td>
													<td class="py-3.5 px-4">
														<div class="text-[12px] font-medium text-[var(--sys-label2)] truncate">{project.lokasi || '-'}</div>
													</td>
													<td class="py-3.5 px-4">
														<div class="text-[12px] text-[var(--sys-label3)] truncate">{project.jenis_project || '-'}</div>
													</td>
													<td class="py-3.5 px-4">
														<div class="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap uppercase tracking-wider {getStatusBadgeStyle(project.status)}">
															{project.status ? project.status.replace('_', ' ') : '-'}
														</div>
													</td>
													<td class="py-3.5 px-4 text-center">
														<a 
															href="/laporan/{project.id}" 
															class="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 mx-auto transition-all shadow-xs active:scale-95 whitespace-nowrap cursor-pointer"
														>
															+ Buat Laporan
														</a>
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>

								</div>
								<div class="lg:hidden">
								<!-- Mobile View (Cards) -->
								<div class="divide-y divide-[var(--sys-sep)]">
									{#each belumKumpul as project (project.id)}
										<div class="p-4 flex flex-col gap-2 hover:bg-[var(--sys-fill)]/40 transition-colors">
											<div>
												<a href="/laporan/{project.id}" class="text-left w-full block focus:outline-none cursor-pointer">
													<div class="text-[13px] font-bold text-[var(--sys-label)] leading-snug">{project.name}</div>
													<div class="text-[11px] font-medium text-[var(--sys-label3)] mt-0.5">
														{project.nomor_po ? project.nomor_po + ' · ' : ''}ID-{project.id}
													</div>
												</a>
											</div>
											<div class="flex items-center justify-between mt-1">
												<div class="flex items-center gap-2">
													<div class="w-6.5 h-6.5 rounded-full flex items-center justify-center text-[10px] font-black bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25 shrink-0 uppercase">
														{project.leader ? project.leader.charAt(0) : '?'}
													</div>
													<span class="text-[12px] font-semibold text-[var(--sys-label)] truncate max-w-[140px]">{project.leader || '-'}</span>
												</div>
												<div class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider shrink-0 {getStatusBadgeStyle(project.status)}">
													{project.status ? project.status.replace('_', ' ') : '-'}
												</div>
											</div>
											<div class="flex items-center justify-between mt-2 pt-1 border-t border-[var(--sys-sep)]/50">
												<div class="text-[11px] font-medium text-[var(--sys-label2)] truncate pr-2">{project.lokasi || '-'}</div>
												<a 
													href="/laporan/{project.id}" 
													class="shrink-0 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-all shadow-xs active:scale-95 cursor-pointer"
												>
													+ Buat Laporan
												</a>
											</div>
										</div>
									{/each}
								</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Accordion Tidak Wajib -->
				{#if tidakWajib.length > 0}
					<div class="bg-[var(--sys-bg2)] rounded-2xl shadow-xs mb-4 overflow-hidden border border-[var(--sys-sep)]">
						<button class="w-full px-4.5 py-3.5 flex items-center justify-between bg-[var(--sys-bg2)] transition-colors hover:bg-[var(--sys-fill)]" onclick={() => expandTidakWajib = !expandTidakWajib}>
							<div class="flex items-center gap-3 text-left">
								<span class="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/25">{tidakWajib.length}</span>
								<span class="text-[14px] font-bold text-[var(--sys-label)]">Tidak Wajib Laporan</span>
								<span class="text-[11px] text-[var(--sys-label3)] font-medium hidden sm:inline">Proyek dengan status Closed / Cancel</span>
							</div>
							{#if expandTidakWajib}
								<IconChevronUp size={18} style="color: var(--sys-label3)" />
							{:else}
								<IconChevronDown size={18} style="color: var(--sys-label3)" />
							{/if}
						</button>
						
						{#if expandTidakWajib}
							<div class="border-t border-[var(--sys-sep)]">
								<!-- Desktop View (Table) -->
								<div class="hidden lg:block">
								<div class="overflow-x-auto">
									<table class="w-full text-left min-w-[700px]">
										<thead>
											<tr class="text-[11px] text-[var(--sys-label2)] uppercase tracking-wider font-bold border-b border-[var(--sys-sep)] bg-[var(--sys-fill)]/60">
												<th class="py-3 px-4 w-[30%]">PROJECT</th>
												<th class="py-3 px-4 w-[16%]">LEADER</th>
												<th class="py-3 px-4 w-[20%]">CUSTOMER/LOKASI</th>
												<th class="py-3 px-4 w-[14%]">JENIS</th>
												<th class="py-3 px-4 w-[10%]">STATUS</th>
												<th class="py-3 px-4 w-[10%] text-center">AKSI</th>
											</tr>
										</thead>
										<tbody>
											{#each tidakWajib as project (project.id)}
												<tr class="border-b border-[var(--sys-sep)] last:border-b-0 hover:bg-[var(--sys-fill)]/50 transition-colors opacity-75 hover:opacity-100 group">
													<td class="py-3.5 px-4">
														<a href="/laporan/{project.id}" class="text-left w-full block focus:outline-none cursor-pointer">
															<div class="text-[13px] font-bold text-[var(--sys-label)] group-hover:text-blue-500 transition-colors truncate">{project.name}</div>
															<div class="text-[11px] font-medium text-[var(--sys-label3)] mt-0.5 truncate">
																{project.nomor_po ? project.nomor_po + ' · ' : ''}ID-{project.id}
															</div>
														</a>
													</td>
													<td class="py-3.5 px-4">
														<div class="flex items-center gap-2">
															<div class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/25 shrink-0 uppercase">
																{project.leader ? project.leader.charAt(0) : '?'}
															</div>
															<span class="text-[12px] font-semibold text-[var(--sys-label)] truncate">{project.leader || '-'}</span>
														</div>
													</td>
													<td class="py-3.5 px-4">
														<div class="text-[12px] font-medium text-[var(--sys-label2)] truncate">{project.lokasi || '-'}</div>
													</td>
													<td class="py-3.5 px-4">
														<div class="text-[12px] text-[var(--sys-label3)] truncate">{project.jenis_project || '-'}</div>
													</td>
													<td class="py-3.5 px-4">
														<div class="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap uppercase tracking-wider {getStatusBadgeStyle(project.status)}">
															{project.status ? project.status.replace('_', ' ') : '-'}
														</div>
													</td>
													<td class="py-3.5 px-4 text-center">
														<a 
															href="/laporan/{project.id}" 
															class="bg-[var(--sys-fill)] border border-[var(--sys-sep)] hover:bg-[var(--sys-fill2)] text-[var(--sys-label2)] px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 mx-auto transition-colors whitespace-nowrap shadow-xs cursor-pointer"
														>
															Lihat Proyek
														</a>
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>

								</div>
								<div class="lg:hidden">
								<!-- Mobile View (Cards) -->
								<div class="divide-y divide-[var(--sys-sep)]">
									{#each tidakWajib as project (project.id)}
										<div class="p-4 flex flex-col gap-2 hover:bg-[var(--sys-fill)]/40 transition-colors opacity-80">
											<div>
												<a href="/laporan/{project.id}" class="text-left w-full block focus:outline-none cursor-pointer">
													<div class="text-[13px] font-bold text-[var(--sys-label)] leading-snug">{project.name}</div>
													<div class="text-[11px] font-medium text-[var(--sys-label3)] mt-0.5">
														{project.nomor_po ? project.nomor_po + ' · ' : ''}ID-{project.id}
													</div>
												</a>
											</div>
											<div class="flex items-center justify-between mt-1">
												<div class="flex items-center gap-2">
													<div class="w-6.5 h-6.5 rounded-full flex items-center justify-center text-[10px] font-black bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/25 shrink-0 uppercase">
														{project.leader ? project.leader.charAt(0) : '?'}
													</div>
													<span class="text-[12px] font-semibold text-[var(--sys-label)] truncate max-w-[140px]">{project.leader || '-'}</span>
												</div>
												<div class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider shrink-0 {getStatusBadgeStyle(project.status)}">
													{project.status ? project.status.replace('_', ' ') : '-'}
												</div>
											</div>
											<div class="flex items-center justify-between mt-2 pt-1 border-t border-[var(--sys-sep)]/50">
												<div class="text-[11px] font-medium text-[var(--sys-label2)] truncate pr-2">{project.lokasi || '-'}</div>
												<a 
													href="/laporan/{project.id}" 
													class="shrink-0 bg-[var(--sys-fill)] border border-[var(--sys-sep)] hover:bg-[var(--sys-fill2)] text-[var(--sys-label2)] px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-colors shadow-xs cursor-pointer"
												>
													Lihat Proyek
												</a>
											</div>
										</div>
									{/each}
								</div>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<PdfBlobViewer
		src={previewSummaryBlob}
		title={previewSummaryTitle}
		show={showSummaryPreview}
		onClose={() => {
			showSummaryPreview = false;
			previewSummaryBlob = null;
		}}
	/>
</div>
