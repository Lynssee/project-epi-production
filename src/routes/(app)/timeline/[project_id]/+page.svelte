<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { getProjectById } from '$lib/services/projects';
	import { getReports } from '$lib/services/reports';
	import { listAdendumByProject } from '$lib/services/timelineAdendum';
	import { fetchUnresolvedFlagsForProject, resolveDelayFlag } from '$lib/services/timelineDelayFlags';
	import { listManualActualByProject } from '$lib/services/timelineManualActual';
	import { authStore, shouldFilterProjectsByLeader, getUserDisplay } from '$lib/stores/auth';
	import AdendumRequestSheet from '$lib/components/project/AdendumRequestSheet.svelte';
	import SubtaskSpecBadges from '$lib/components/project/SubtaskSpecBadges.svelte';
	import ManpowerTodayCard from '$lib/components/project/ManpowerTodayCard.svelte';
	import { fetchMitraById, TIPE_MITRA_LABELS, type MitraDetail } from '$lib/services/kemitraan';
	import KebutuhanFaseSheet from '$lib/components/project/KebutuhanFaseSheet.svelte';
	import DelayFlagModal from '$lib/components/project/DelayFlagModal.svelte';
	import ManualActualModal from '$lib/components/project/ManualActualModal.svelte';
	import { loadProjectSettings, getProjectSetting } from '$lib/services/projectSettings';
	import { isNonWorkday, buildHolidaySet, getEffectiveWorkdaysPerWeek } from '$lib/utils/workingDays';
	import directus from '$lib/services/directus';
	import { readItems } from '@directus/sdk';
	import {
		IconArrowLeft, IconLoader2, IconCalendarTime, IconEye, IconEyeOff,
		IconAlertTriangle, IconHistory, IconPlus, IconMaximize, IconMinimize,
		IconDownload, IconCalendarEvent, IconLayoutGrid
	} from '@tabler/icons-svelte';
	import { exportTimelineToExcel } from '$lib/utils/timelineExcelExport';
	import { fetchWsTimelineStatus, type WsTimelineStatus } from '$lib/services/wsTimelineStatus';
	import { secureAssetSrc } from '$lib/actions/secureAsset';
	import { objekGambarPath } from '$lib/services/masterObjekApi';

	let isFullscreen = $state(false);
	let densityMode = $state<'normal' | 'compact'>('normal');
	let isExportingExcel = $state(false);

	function toggleFullscreen() {
		isFullscreen = !isFullscreen;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && isFullscreen) {
			isFullscreen = false;
		}
	}

	function scrollToToday() {
		if (!scrollContainer) return;
		const tKey = todayKey();
		const todayEl = scrollContainer.querySelector(`.tl-col-date[data-date="${tKey}"]`);
		if (todayEl) {
			todayEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
		} else {
			const fallbackEl = scrollContainer.querySelector('.is-today');
			if (fallbackEl) {
				fallbackEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
			}
		}
	}

	function handleExportExcel() {
		if (!categories || categories.length === 0) return;
		try {
			isExportingExcel = true;
			exportTimelineToExcel({
				project,
				categories,
				dateRange: dateColumns,
				showActual
			});
		} catch (err: any) {
			console.error('Gagal export Excel:', err);
			alert(err.message || 'Gagal mengekspor file Excel');
		} finally {
			isExportingExcel = false;
		}
	}

	// Audit Timeline Ciketing Fase 2/4 — weighted-by-volume (sama seperti getCategoryProgress
	// di bawah), bukan flat average per-subtask, agar Deviasi P/A di ringkasan tidak keliru.
	let summaryMetrics = $derived.by(() => {
		const catCount = categories.length;
		let subCount = 0;
		let sumPlanTotal = 0, sumPlanVol = 0;
		let sumActTotal = 0, sumActVol = 0;

		categories.forEach((cat) => {
			const subs = cat.subtasks || [];
			subCount += subs.length;
			subs.forEach((s: any) => {
				const vol = parseFloat(s.volume) || 0;
				if (vol <= 0) return;
				sumPlanTotal += Math.min(getTotal(s, 'daily_plan'), vol);
				sumPlanVol += vol;
				sumActTotal += Math.min(getTotal(s, 'daily_actual'), vol);
				sumActVol += vol;
			});
		});

		const avgPlan = sumPlanVol > 0 ? Math.min(100, (sumPlanTotal / sumPlanVol) * 100).toFixed(2) : '0.00';
		const avgAct = sumActVol > 0 ? Math.min(100, (sumActTotal / sumActVol) * 100).toFixed(2) : '0.00';
		const dev = (parseFloat(avgAct) - parseFloat(avgPlan)).toFixed(2);
		const totalDuration = dateColumns.length;

		return { catCount, subCount, avgPlan, avgAct, dev, totalDuration };
	});

	// Fase 4 — Banner Peringatan Ketidakcocokan Volume Task vs Subtask (Dashboard Lapangan).
	// Menangkap pola bug Gambar 1: subtask masih di volume default kecil (mis. 1 ls) padahal
	// Vol Task riil jauh lebih besar (mis. 22 m²) — bukan gate/blocker, murni informatif.
	let volumeMismatchWarnings = $derived.by(() => {
		const warnings: { catName: string; subName: string; subVol: number; catVol: number; unit: string }[] = [];
		categories.forEach((cat: any) => {
			const catVol = parseFloat(cat.volume) || 0;
			if (catVol <= 1) return; // Vol Task sendiri masih default/kecil, tak ada basis pembanding
			(cat.subtasks || []).forEach((sub: any) => {
				if (sub.wajib_key) return; // subtask wajib (mobilisasi/demob/BAST) memang 1 lot, bukan mismatch
				const subVol = parseFloat(sub.volume) || 0;
				const sameUnit = !sub.unit || !cat.unit || sub.unit === cat.unit;
				if (sameUnit && subVol > 0 && subVol / catVol < 0.2) {
					warnings.push({ catName: cat.name, subName: sub.name || '(tanpa nama)', subVol, catVol, unit: cat.unit || 'ls' });
				}
			});
		});
		return warnings;
	});

	let showAdendumSheet = $state(false);
	let showKebutuhanSheet = $state(false);
	let adendumPreselected = $state<{ category: any; subtask: any } | null>(null);
	let adendumHistory = $state<any[]>([]);
	let showHistoryPanel = $state(false);
	let categories = $state<any[]>([]);
	// Laporan harian yang sudah ditarik untuk actual — dipakai juga kartu manpower hari ini.
	let projectReports = $state<any[]>([]);
	let showVolTask = $state(true);
	let plannedActivities = $derived({ metadata: {}, categories });
	let hasUnseenAdendumUpdate = $state(false);

	function adendumSeenKey(): string {
		return `epi_adendum_seen_${projectId}`;
	}

	function readSeenMap(): Record<string, string> {
		if (typeof localStorage === 'undefined') return {};
		try {
			const raw = localStorage.getItem(adendumSeenKey());
			return raw ? JSON.parse(raw) : {};
		} catch {
			return {};
		}
	}

	function updateUnseenFlag() {
		const seen = readSeenMap();
		hasUnseenAdendumUpdate = adendumHistory.some(
			(a) => a.status !== 'pending' && seen[a.id] !== a.status
		);
	}

	function markAdendumHistorySeen() {
		if (typeof localStorage === 'undefined') return;
		const seen: Record<string, string> = {};
		adendumHistory.forEach((a) => { seen[a.id] = a.status; });
		localStorage.setItem(adendumSeenKey(), JSON.stringify(seen));
		hasUnseenAdendumUpdate = false;
	}

	async function loadAdendumHistory() {
		if (!projectId) return;
		adendumHistory = await listAdendumByProject(Number(projectId));
		updateUnseenFlag();
	}

	function openAdendumSheet(cat: any = null, sub: any = null) {
		adendumPreselected = cat && sub ? { category: cat, subtask: sub } : null;
		showAdendumSheet = true;
	}

	function toggleHistoryPanel() {
		showHistoryPanel = !showHistoryPanel;
		if (showHistoryPanel) markAdendumHistorySeen();
	}

	function todayKey(): string {
		return formatDateKey(new Date());
	}

	function getLastPlanDate(sub: any): string | null {
		const keys = Object.keys(sub?.daily_plan || {}).filter((k) => sub.daily_plan[k] > 0);
		if (keys.length === 0) return null;
		return keys.sort().at(-1) || null;
	}

	function isSubtaskDelayed(sub: any): boolean {
		const lastPlanDate = getLastPlanDate(sub);
		if (!lastPlanDate) return false;
		if (lastPlanDate >= todayKey()) return false;
		return getProgress(sub, 'daily_actual') < 100;
	}

	function daysSincePlan(sub: any): number {
		const lastPlanDate = getLastPlanDate(sub);
		if (!lastPlanDate) return 0;
		const diffMs = new Date(todayKey()).getTime() - new Date(lastPlanDate).getTime();
		return Math.max(0, Math.round(diffMs / 86400000));
	}

	// Timeline & Scope Management Fase 1 — flag unresolved keyed by subtask_id.
	let unresolvedDelayFlags = $state<Record<string, any>>({});
	let showDelayModal = $state(false);
	let delayModalTarget = $state<{ cat: any; sub: any } | null>(null);

	async function loadDelayFlags() {
		if (!projectId) return;
		const flags = await fetchUnresolvedFlagsForProject(Number(projectId));
		const map: Record<string, any> = {};
		flags.forEach((f: any) => { map[f.subtask_id] = f; });
		unresolvedDelayFlags = map;
	}

	async function autoResolveCaughtUpFlags() {
		const stillDelayed = new Set<string>();
		categories.forEach((cat) => {
			(cat.subtasks || []).forEach((sub: any) => {
				if (isSubtaskDelayed(sub)) stillDelayed.add(sub.id);
			});
		});
		const toResolve = Object.values(unresolvedDelayFlags).filter((f: any) => !stillDelayed.has(f.subtask_id));
		for (const flag of toResolve) {
			await resolveDelayFlag(flag.id);
		}
		if (toResolve.length > 0) await loadDelayFlags();
	}

	function openDelayModal(cat: any, sub: any) {
		delayModalTarget = { cat, sub };
		showDelayModal = true;
	}

	// Timeline & Scope Management — input manual Actual (bantu PM mencatat progres
	// lapangan cepat sebelum laporan harian resmi sempat diinput). Nilainya digabung
	// (additive) ke daily_actual, TAPI di-skip untuk kombinasi subtask+tanggal yang
	// sudah punya laporan resmi (lihat officialActualKeys) — supaya begitu laporan
	// harian resmi masuk untuk tanggal itu, input manual tidak dobel-hitung.
	let showManualActualModal = $state(false);
	let manualActualTarget = $state<{ cat: any; sub: any } | null>(null);

	function openManualActualModal(cat: any, sub: any) {
		manualActualTarget = { cat, sub };
		showManualActualModal = true;
	}

	// Executor Partitioning — Rekomendasi L3 (Section 4.2): Vendor Contact Card. Klik badge
	// vendor di subtask → kartu popup PIC/telp/email, tanpa harus buka ERP.
	let showVendorCard = $state(false);
	let vendorCardLoading = $state(false);
	let vendorCardData = $state<MitraDetail | null>(null);

	async function openVendorCard(vendorId: number) {
		showVendorCard = true;
		vendorCardLoading = true;
		vendorCardData = null;
		vendorCardData = await fetchMitraById(vendorId);
		vendorCardLoading = false;
	}
	function closeVendorCard() {
		showVendorCard = false;
		vendorCardData = null;
	}

	function applyManualActualEntry(sub: any, tanggal: string, value: number) {
		if (officialActualKeys.has(`${sub.id}::${tanggal}`)) return;
		if (!sub.daily_actual) sub.daily_actual = {};
		sub.daily_actual[tanggal] = (sub.daily_actual[tanggal] || 0) + value;
		categories = [...categories];
		autoResolveCaughtUpFlags();
	}

	async function loadManualActual() {
		if (!projectId) return;
		try {
			const entries = await listManualActualByProject(Number(projectId));
			entries.forEach((entry: any) => {
				const tanggal = (entry.tanggal || '').substring(0, 10);
				const val = parseFloat(entry.progress_value) || 0;
				if (!tanggal || val <= 0) return;
				categories.forEach((cat) => {
					(cat.subtasks || []).forEach((sub: any) => {
						if (sub.id === entry.subtask_id) {
							if (officialActualKeys.has(`${sub.id}::${tanggal}`)) return;
							if (!sub.daily_actual) sub.daily_actual = {};
							sub.daily_actual[tanggal] = (sub.daily_actual[tanggal] || 0) + val;
						}
					});
				});
			});
			categories = [...categories];
		} catch (err) {
			console.error('Gagal memuat input actual manual:', err);
		}
	}

	function statusBadgeClass(status: string): string {
		if (status === 'approved') return 'ah-badge-green';
		if (status === 'rejected') return 'ah-badge-red';
		return 'ah-badge-yellow';
	}

	let projectId = $derived($page.params.project_id || '');
	let project = $state<any>(null);
	let loading = $state(true);
	// Fase 5 Sinkronisasi Laporan Harian Workshop v2 — kartu lampu+serapan (tanpa
	// rupiah), hanya untuk PO Ciketing/Balaraja. null = belum dimuat / bukan PO workshop.
	let wsStatus = $state<WsTimelineStatus | null>(null);

	// Timeline & Scope Management Fase 2 — hari libur nasional/perusahaan (koleksi `holidays` HRD, read-only)
	let holidaySet = $state<Set<string>>(new Set());
	let globalWorkdaysPerWeek = $state(6);

	// Standarisasi Timeline v2 (TAJAM), Fase 6 — label tahap mobilisasi utk badge & sheet kebutuhan.
	let mobStagesSetting = $state<Array<{ key: string; label: string }>>([]);
	function mobStageLabel(key: string | null | undefined): string | null {
		if (!key) return null;
		return mobStagesSetting.find((s) => s.key === key)?.label || key;
	}

	async function loadWorkingDaysConfig() {
		try {
			await loadProjectSettings();
			globalWorkdaysPerWeek = getProjectSetting('project.workdays_per_week');
			mobStagesSetting = getProjectSetting('project.forecast.mob_stages') || [];
		} catch (err) {
			console.error('Gagal memuat setelan hari kerja global:', err);
		}
		try {
			const rows = await directus.request(
				readItems('holidays', { filter: { is_active: { _eq: true } }, fields: ['date', 'is_active'], limit: -1 })
			);
			holidaySet = buildHolidaySet(rows as any);
		} catch (err) {
			console.error('Gagal memuat kalender libur HRD:', err);
		}
	}
	let showActual = $state(true);
	let dateColumns = $state<{day: number, dayName: string, month: string, year: number, isWeekend: boolean, dateStr: string}[]>([]);

	// Fase 7 (Standarisasi Timeline v2 TAJAM) — preferensi kolom per browser (Q10, 16 Sep 2026).
	// Lapangan hanya punya 2 toggle (Aktual/Vol Task), jadi cukup dipersist langsung tanpa
	// preset/menu terpisah (beda dari admin yang kolomnya jauh lebih banyak).
	const COL_STORAGE_KEY = 'timeline.cols.v1';
	function loadColPrefs() {
		if (typeof localStorage === 'undefined') return;
		try {
			const raw = localStorage.getItem(COL_STORAGE_KEY);
			if (!raw) return;
			const saved = JSON.parse(raw);
			if (typeof saved.showActual === 'boolean') showActual = saved.showActual;
			if (typeof saved.showVolTask === 'boolean') showVolTask = saved.showVolTask;
		} catch {
			// private window / storage diblokir — pakai default, jangan sampai layar putih
		}
	}
	function saveColPrefs() {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(COL_STORAGE_KEY, JSON.stringify({ showActual, showVolTask }));
		} catch {
			// lihat catatan loadColPrefs
		}
	}

	let scrollContainer = $state<HTMLDivElement | null>(null);
	let additionalDays = $state(0);
	let isLoadingMore = $state(false);

	async function handleScroll(e: Event) {
		const container = e.currentTarget as HTMLDivElement;
		if (isLoadingMore) return;
		if (container.scrollWidth - container.scrollLeft - container.clientWidth < 200) {
			isLoadingMore = true;
			additionalDays += 30;
			generateDateColumns();
			await tick();
			isLoadingMore = false;
		}
	}

	const dayNames = ['MIN', 'SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB'];
	const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

	onMount(async () => {
		additionalDays = 0;
		loadColPrefs();
		const auth = get(authStore);
		try {
			const result = await getProjectById(projectId, auth.directusToken);
			if (shouldFilterProjectsByLeader(auth.roleId) && (!result || result.leader_id !== auth.karyawanId)) {
				goto('/');
				return;
			}
			project = result;
			if (project?.timeline_planning) {
				const parsed = typeof project.timeline_planning === 'string'
					? JSON.parse(project.timeline_planning)
					: project.timeline_planning;
				categories = parsed.categories || [];
			}

			// Fase 5: kartu lampu workshop — fire-and-forget, tidak menghambat render
			// timeline utama. Hanya untuk PO Ciketing/Balaraja (sinyal eksplisit
			// project.workshop, sama seperti isCiketingProject() erp-epi).
			if (project?.workshop === 'ciketing' || project?.workshop === 'balaraja') {
				fetchWsTimelineStatus(Number(projectId), project.workshop).then((s) => {
					wsStatus = s;
				});
			}

			// Load and merge actual report data (semua laporan harian, bukan cuma 50 terbaru)
			try {
				const reports = await getReports(projectId, { limit: -1 });
				projectReports = reports || [];
				mergeActualFromReports(reports);
			} catch (err) {
				console.error('Gagal memproses actual data dari laporan harian:', err);
			}
			await loadManualActual();

			await loadWorkingDaysConfig();
			generateDateColumns();
			await loadAdendumHistory();
			await loadDelayFlags();
			await autoResolveCaughtUpFlags();
		} catch (e) {
			console.error('Gagal memuat timeline:', e);
			goto('/');
		} finally {
			loading = false;
		}
	});

	function normalizeString(str: string): string {
		if (!str) return '';
		return str.toLowerCase().replace(/[^a-z0-9]/g, '');
	}

	function isNameMatch(activityName: string, reportActivity: string): boolean {
		if (!activityName || !reportActivity) return false;
		const norm1 = normalizeString(activityName);
		const norm2 = normalizeString(reportActivity);
		if (!norm1 || norm2 === '') return false;
		return norm1.includes(norm2) || norm2.includes(norm1);
	}

	// Kombinasi subtask+tanggal yang sudah punya laporan harian resmi — dipakai untuk
	// mencegah input actual manual dobel-hitung di tanggal yang sama (lihat loadManualActual).
	let officialActualKeys = new Set<string>();

	function mergeActualFromReports(reports: any[]) {
		if (!reports || reports.length === 0) return;

		reports.forEach((report: any) => {
			const reportDate = report.date ? report.date.substring(0, 10) : '';
			if (!reportDate) return;

			let progressData: any[] = [];
			if (report.progress) {
				if (typeof report.progress === 'string') {
					try {
						progressData = JSON.parse(report.progress);
					} catch (e) {
						console.error('Error parsing report progress:', e);
					}
				} else if (Array.isArray(report.progress)) {
					progressData = report.progress;
				}
			}

			if (!Array.isArray(progressData)) return;

			progressData.forEach((prog: any) => {
				const reportVal = parseFloat(prog.progress_value) || 0;
				if (reportVal <= 0) return;

				let matched = false;

				// 1. Try to match with subtask_id first (100% precise ID matching)
				if (prog.subtask_id) {
					categories.forEach(cat => {
						(cat.subtasks || []).forEach((sub: any) => {
							if (sub.id === prog.subtask_id) {
								if (!sub.daily_actual) sub.daily_actual = {};
								sub.daily_actual[reportDate] = (sub.daily_actual[reportDate] || 0) + reportVal;
								officialActualKeys.add(`${sub.id}::${reportDate}`);
								matched = true;
							}
						});
					});
				}

				// 2. Fallback: Match by subtask name
				if (!matched && prog.activity) {
					categories.forEach(cat => {
						(cat.subtasks || []).forEach((sub: any) => {
							if (sub.name && isNameMatch(sub.name, prog.activity)) {
								if (!sub.daily_actual) sub.daily_actual = {};
								sub.daily_actual[reportDate] = (sub.daily_actual[reportDate] || 0) + reportVal;
								officialActualKeys.add(`${sub.id}::${reportDate}`);
								matched = true;
							}
						});
					});
				}

				// 3. Fallback: Match by category name
				if (!matched && (prog.activity || prog.category)) {
					const targetName = prog.activity || prog.category || '';
					categories.forEach(cat => {
						if (cat.name && isNameMatch(cat.name, targetName)) {
							// If no subtasks, create a default one
							if (!cat.subtasks || cat.subtasks.length === 0) {
								cat.subtasks = [{
									id: `sub_dyn_${Date.now()}_${Math.random()}`,
									name: cat.name,
									volume: cat.volume || 1,
									unit: cat.unit || 'ls',
									daily_plan: {},
									daily_actual: {}
								}];
							}
							const sub = cat.subtasks[0];
							if (!sub.daily_actual) sub.daily_actual = {};
							sub.daily_actual[reportDate] = (sub.daily_actual[reportDate] || 0) + reportVal;
							officialActualKeys.add(`${sub.id}::${reportDate}`);
							matched = true;
						}
					});
				}
			});
		});

		// Trigger Svelte reactivity
		categories = [...categories];
	}

	function formatDateKey(date: Date): string {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, "0");
		const d = String(date.getDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	}

	function generateDateColumns() {
		// Determine date range from project or from plan data
		let startDate: Date;
		let endDate: Date;

		if (project?.start_date && project?.end_date) {
			startDate = new Date(project.start_date);
			endDate = new Date(project.end_date);
		} else {
			// Fallback: find min/max from plan keys across all subtasks
			let allDates: string[] = [];
			categories.forEach(cat => {
				(cat.subtasks || []).forEach((sub: any) => {
					if (sub.daily_plan) Object.keys(sub.daily_plan).forEach(k => allDates.push(k));
					if (sub.daily_actual) Object.keys(sub.daily_actual).forEach(k => allDates.push(k));
				});
			});
			if (allDates.length === 0) {
				// Default: current month
				const now = new Date();
				startDate = new Date(now.getFullYear(), now.getMonth(), 1);
				endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
			} else {
				const sortedDates = allDates.sort();
				startDate = new Date(sortedDates[0]);
				endDate = new Date(sortedDates[sortedDates.length - 1]);
			}
		}

		if (additionalDays > 0) {
			endDate.setDate(endDate.getDate() + additionalDays);
		}

		// Expand to cover full range
		const effectiveWorkdaysPerWeek = getEffectiveWorkdaysPerWeek(project, globalWorkdaysPerWeek);
		const cols: typeof dateColumns = [];
		const current = new Date(startDate);
		while (current <= endDate) {
			const dayOfWeek = current.getDay();
			const dateStr = formatDateKey(current);
			cols.push({
				day: current.getDate(),
				dayName: dayNames[dayOfWeek],
				month: monthNames[current.getMonth()],
				year: current.getFullYear(),
				isWeekend: isNonWorkday(current, effectiveWorkdaysPerWeek) || holidaySet.has(dateStr),
				dateStr
			});
			current.setDate(current.getDate() + 1);
		}
		dateColumns = cols;
	}

	function getTotal(subtask: any, type: 'daily_plan' | 'daily_actual'): number {
		const data = subtask[type] || {};
		return Object.values(data).reduce((sum: number, val: any) => sum + (parseFloat(val) || 0), 0);
	}

	function getProgress(subtask: any, type: 'daily_plan' | 'daily_actual'): number {
		const total = getTotal(subtask, type);
		const vol = parseFloat(subtask.volume) || 0;
		if (vol === 0) return 0;
		return Math.min(100, (total / vol) * 100);
	}

	// Audit Timeline Ciketing Fase 2 — weighted-by-volume, port dari erp-epi-1
	// (subtask besar menyumbang proporsional terhadap volumenya, bukan flat average).
	function getCategoryProgress(cat: any, type: 'daily_plan' | 'daily_actual'): string {
		if (!cat.subtasks || cat.subtasks.length === 0) return '0.00';
		let sumTotal = 0;
		let sumVol = 0;
		cat.subtasks.forEach((sub: any) => {
			const vol = parseFloat(sub.volume) || 0;
			if (vol <= 0) return;
			sumTotal += Math.min(getTotal(sub, type), vol);
			sumVol += vol;
		});
		if (sumVol === 0) return '0.00';
		return Math.min(100, (sumTotal / sumVol) * 100).toFixed(2);
	}

	function getTotalDays(subtask: any): number {
		const planDates = Object.keys(subtask.daily_plan || {}).filter(k => subtask.daily_plan[k] > 0);
		return planDates.length;
	}

	function isPlanDay(sub: any, dateStr: string): boolean {
		return sub.daily_plan && sub.daily_plan[dateStr] > 0;
	}

	function isActualDay(sub: any, dateStr: string): boolean {
		return sub.daily_actual && sub.daily_actual[dateStr] > 0;
	}

	function getPlanValue(sub: any, dateStr: string): string {
		if (!sub.daily_plan) return '';
		const val = sub.daily_plan[dateStr];
		if (typeof val === 'number' && val > 0) return String(val);
		return '';
	}

	function getActualValue(sub: any, dateStr: string): string {
		if (!sub.daily_actual) return '';
		const val = sub.daily_actual[dateStr];
		if (typeof val === 'number' && val > 0) return String(val);
		return '';
	}

	// Group date columns by month for header
	let monthGroups = $derived(() => {
		const groups: {label: string, count: number}[] = [];
		let current = '';
		dateColumns.forEach(col => {
			const label = `${col.month} ${col.year}`;
			if (label !== current) {
				groups.push({ label, count: 1 });
				current = label;
			} else {
				groups[groups.length - 1].count++;
			}
		});
		return groups;
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex-1 flex flex-col h-full bg-white dark:bg-[#121A22] {isFullscreen ? 'fixed inset-0 z-[9999] h-screen w-screen overflow-hidden' : ''}">

	<!-- Top Navigation Header -->
	<div class="px-4 py-3 bg-white dark:bg-[#1B2530] border-b border-gray-200/80 dark:border-[#2B3844] flex items-center justify-between gap-3 sticky top-0 z-20">
		<div class="flex items-center gap-3 min-w-0">
			<button
				type="button"
				class="p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#232F3B] transition-colors shrink-0"
				onclick={() => goto('/timeline')}
				title="Kembali ke Daftar Timeline"
			>
				<IconArrowLeft size={20} />
			</button>
			<div class="min-w-0">
				<h1 class="text-sm sm:text-base font-bold text-gray-900 dark:text-white truncate">
					{project?.name || 'Timeline Proyek'}
				</h1>
				<div class="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 font-medium truncate">
					{#if project?.nomor_po}
						<span>PO: {project.nomor_po}</span>
						<span>•</span>
					{/if}
					{#if project?.lokasi}
						<span>{project.lokasi}</span>
					{/if}
					{#if wsStatus?.found}
						<span>•</span>
						<span
							class="inline-flex items-center gap-1 font-bold"
							title="Progres fisik vs serapan biaya workshop (tanpa nominal) — dari Konsolidasi RAP Workshop admin"
						>
							{#if wsStatus.evFlag === 'red'}🔴{:else if wsStatus.evFlag === 'yellow'}🟡{:else if wsStatus.evFlag === 'green'}🟢{/if}
							Progres {wsStatus.progressPct ?? '—'}%
							{#if wsStatus.serapanPct != null}· Serapan {wsStatus.serapanPct}%{#if wsStatus.manpowerEstimasi}<span class="font-normal" title="estimasi (laporan harian belum lengkap)"> (est.)</span>{/if}{/if}
						</span>
					{/if}
				</div>
			</div>
		</div>

		<div class="flex items-center gap-2 shrink-0">
			{#if project?.id}
				<button
					type="button"
					class="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-[#232F3B] text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shrink-0"
					onclick={() => goto(`/proyek/${project.id}`)}
				>
					Detail Proyek
				</button>
			{/if}
			<button
				type="button"
				class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 {isFullscreen ? 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800' : 'bg-gray-100 dark:bg-[#232F3B] text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 border border-transparent'}"
				onclick={toggleFullscreen}
				title={isFullscreen ? 'Keluar Fullscreen (Esc)' : 'Layar Penuh (Excel Mode)'}
			>
				{#if isFullscreen}
					<IconMinimize size={15} />
					<span>Pulihkan</span>
				{:else}
					<IconMaximize size={15} />
					<span>Layar Penuh</span>
				{/if}
			</button>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex items-center justify-center py-20">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Detail Timeline..." sublabel="Sinkronisasi kategori & task proyek" />
		</div>
	{:else if categories.length === 0}
		<div class="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-12">
			<IconCalendarTime size={48} class="text-gray-300 dark:text-gray-600" />
			<p class="text-[14px] text-gray-500 dark:text-gray-400 text-center max-w-sm">Timeline belum dikonfigurasi oleh admin untuk proyek ini.</p>
			<div class="flex items-center gap-2 mt-2">
				<button class="px-4 py-2 text-[13px] font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors" onclick={() => goto('/timeline')}>
					Kembali ke Daftar Timeline
				</button>
			</div>
		</div>
	{:else}
		<ManpowerTodayCard {categories} reports={projectReports} todayKey={todayKey()} />

		<!-- Excel Ribbon & Controls Bar -->
		<div class="px-4 py-2.5 bg-gray-50 dark:bg-[#16202A] border-b border-gray-200/80 dark:border-[#2B3844] flex flex-col gap-2">
			<div class="flex items-center justify-between flex-wrap gap-2">
				<div class="flex items-center gap-2">
					<IconCalendarTime size={16} class="text-[var(--g)]" />
					<span class="text-[12px] font-semibold text-gray-700 dark:text-gray-200">Gantt & Jadwal Pelaksanaan</span>
					<span class="text-[10px] text-gray-400 font-mono">(Excel Mode)</span>
				</div>

				<!-- Action Buttons Group -->
				<div class="flex items-center gap-1.5 flex-wrap">
					<!-- Hari Ini -->
					<button
						type="button"
						class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
						onclick={scrollToToday}
						title="Gulir otomatis ke kolom hari ini"
					>
						<IconCalendarEvent size={14} />
						<span>Hari Ini</span>
					</button>

					<!-- Toggle Actual -->
					<button
						type="button"
						class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all {showActual ? 'bg-[var(--g)] text-white' : 'bg-gray-200 dark:bg-[#232F3B] text-gray-600 dark:text-gray-300'}"
						onclick={() => { showActual = !showActual; saveColPrefs(); }}
					>
						{#if showActual}<IconEye size={13} />{:else}<IconEyeOff size={13} />{/if}
						<span>Aktual</span>
					</button>

					<!-- Toggle Vol Task -->
					<button
						type="button"
						class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all {showVolTask ? 'bg-[var(--g)] text-white' : 'bg-gray-200 dark:bg-[#232F3B] text-gray-600 dark:text-gray-300'}"
						onclick={() => { showVolTask = !showVolTask; saveColPrefs(); }}
					>
						<span>Vol Task</span>
					</button>

					<!-- Density Switcher -->
					<button
						type="button"
						class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all {densityMode === 'compact' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-[#232F3B] text-gray-700 dark:text-gray-300'}"
						onclick={() => densityMode = densityMode === 'normal' ? 'compact' : 'normal'}
						title="Beralih kerapatan baris (Excel Compact vs Normal)"
					>
						<IconLayoutGrid size={13} />
						<span>{densityMode === 'compact' ? 'Ringkas' : 'Normal'}</span>
					</button>

					<!-- Riwayat Adendum -->
					<button
						type="button"
						class="relative flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all bg-gray-200 dark:bg-[#232F3B] text-gray-700 dark:text-gray-200"
						onclick={toggleHistoryPanel}
					>
						<IconHistory size={13} />
						<span>Adendum {adendumHistory.length > 0 ? `(${adendumHistory.length})` : ''}</span>
						{#if hasUnseenAdendumUpdate}
							<span class="tl-unseen-dot"></span>
						{/if}
					</button>

					<!-- Export Excel -->
					<button
						type="button"
						class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors shadow-xs disabled:opacity-50"
						onclick={handleExportExcel}
						disabled={isExportingExcel}
						title="Download data jadwal ke format spreadsheet Microsoft Excel (.xlsx)"
					>
						<IconDownload size={13} />
						<span>{isExportingExcel ? 'Exporting...' : 'Export Excel'}</span>
					</button>
				</div>
			</div>

			<!-- Formula / Status Bar Summary -->
			<div class="excel-formula-bar flex items-center justify-between gap-2 px-3 py-1.5 bg-white dark:bg-[#1f2937] rounded-md border border-gray-200 dark:border-gray-700 text-[11px] font-mono overflow-x-auto">
				<div class="flex items-center gap-3 shrink-0">
					<span class="text-gray-500 dark:text-gray-400">📊 Ringkasan:</span>
					<span class="text-gray-800 dark:text-gray-200 font-semibold">{summaryMetrics.catCount} Kategori</span>
					<span class="text-gray-400">•</span>
					<span class="text-gray-800 dark:text-gray-200 font-semibold">{summaryMetrics.subCount} Subtask</span>
					<span class="text-gray-400">•</span>
					<span class="text-gray-800 dark:text-gray-200 font-semibold">{summaryMetrics.totalDuration} Hari Kalender</span>
				</div>
				<div class="flex items-center gap-3 shrink-0">
					<span class="text-emerald-600 dark:text-emerald-400 font-semibold">Plan: {summaryMetrics.avgPlan}%</span>
					<span class="text-blue-600 dark:text-blue-400 font-semibold">Act: {summaryMetrics.avgAct}%</span>
					<span class="px-1.5 py-0.5 rounded text-[10px] font-bold {parseFloat(summaryMetrics.dev) >= 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}">
						Deviasi: {summaryMetrics.dev}%
					</span>
				</div>
			</div>

			<!-- Fase 4 — Banner Ketidakcocokan Volume Task vs Subtask (non-blocking, murni informatif) -->
			{#if volumeMismatchWarnings.length > 0}
				<div
					class="mx-3 mb-1.5 flex items-start gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300"
					title="Volume subtask ini jauh lebih kecil dari Vol Task induknya. Untuk pekerjaan bertahap (blasting→primer→topcoat pada objek yang sama), Vol Sub seharusnya sama dengan Vol Task. Sesuaikan manual bila memang perlu."
				>
					<IconAlertTriangle size={14} class="mt-0.5 shrink-0" />
					<div class="min-w-0">
						<span class="font-semibold">Ketidakcocokan Volume terdeteksi ({volumeMismatchWarnings.length}):</span>
						{#each volumeMismatchWarnings.slice(0, 3) as w}
							<span class="ml-1">"{w.subName}" ({w.subVol} {w.unit}) vs Task "{w.catName}" ({w.catVol} {w.unit});</span>
						{/each}
						{#if volumeMismatchWarnings.length > 3}
							<span class="ml-1 italic">+{volumeMismatchWarnings.length - 3} lainnya.</span>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		{#if showHistoryPanel}
			<div class="px-4 py-3 bg-white border-b border-gray-100">
				{#if adendumHistory.length === 0}
					<p class="text-[11px] text-gray-400">Belum ada pengajuan adendum untuk proyek ini.</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each adendumHistory as adendum}
							<div class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
								<div class="min-w-0">
									<p class="text-[11px] font-semibold text-gray-700 truncate">{adendum.nomor_adendum} — {adendum.diff_summary?.subtask || '-'}</p>
									<p class="text-[10px] text-gray-400 truncate">{adendum.alasan}</p>
									{#if adendum.status === 'rejected' && adendum.catatan_approval}
										<p class="text-[10px] text-red-500 truncate">Catatan: {adendum.catatan_approval}</p>
									{/if}
								</div>
								<span class="ah-badge {statusBadgeClass(adendum.status)}">{adendum.status}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Legend -->
		<div class="flex items-center gap-4 px-4 py-2 bg-white border-b border-gray-100">
			<div class="flex items-center gap-1.5">
				<div class="w-4 h-3 rounded-sm bg-[#4CAF50]"></div>
				<span class="text-[10px] text-gray-500">Plan</span>
			</div>
			{#if showActual}
			<div class="flex items-center gap-1.5">
				<div class="w-4 h-3 rounded-sm bg-[#2196F3]"></div>
				<span class="text-[10px] text-gray-500">Actual</span>
			</div>
			{/if}
			<div class="flex items-center gap-1.5">
				<div class="w-4 h-3 rounded-sm bg-red-100 border border-red-200"></div>
				<span class="text-[10px] text-gray-500">Weekend</span>
			</div>
		</div>

		<!-- Timeline Table -->
		<div class="flex-1 overflow-auto {densityMode === 'compact' ? 'density-compact' : ''}" bind:this={scrollContainer} onscroll={handleScroll}>
			<table class="tl-table">
				<thead>
					<!-- Month row -->
					<tr class="tl-month-row">
						<th colspan={showVolTask ? 9 : 8} class="tl-fixed-header">
							<div class="text-[10px] text-gray-400 text-center">Info Pekerjaan</div>
						</th>
						{#each monthGroups() as mg}
							<th colspan={mg.count} class="tl-month-cell">{mg.label}</th>
						{/each}
					</tr>
					<!-- Day row -->
					<tr class="tl-day-row">
						<th class="tl-th tl-col-no">No</th>
						<th class="tl-th tl-col-task">Task</th>
						{#if showVolTask}
							<th class="tl-th tl-col-vol">Vol Task</th>
						{/if}
						<th class="tl-th tl-col-prog">Prog % Task</th>
						<th class="tl-th tl-col-subtask">Subtask</th>
						<th class="tl-th tl-col-volsub">Vol Sub</th>
						<th class="tl-th tl-col-days">Total Days</th>
						<th class="tl-th tl-col-type">Plan/Act</th>
						<th class="tl-th tl-col-progsub">Prog % Sub</th>
						{#each dateColumns as col}
							<th
								class="tl-th tl-col-date {col.isWeekend ? 'tl-weekend' : ''} {col.dateStr === todayKey() ? 'is-today' : ''}"
								data-date={col.dateStr}
								title="{col.dateStr} {col.dateStr === todayKey() ? '(Hari Ini)' : ''}"
							>
								{#if col.dateStr === todayKey()}
									<span class="tl-today-badge">HARI INI</span>
								{/if}
								<div class="tl-date-num">{col.day}</div>
								<div class="tl-date-day">{col.dayName}</div>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each categories as cat, catIdx}
						{#each (cat.subtasks || []) as sub, subIdx}
							<!-- PLAN row -->
							<tr class="tl-plan-row">
								{#if subIdx === 0}
									<td class="tl-td tl-col-no tl-cat-cell" rowspan={(cat.subtasks?.length || 1) * (showActual ? 2 : 1)}>
										<div class="tl-cat-label">{String.fromCharCode(65 + catIdx)}</div>
									</td>
									<td class="tl-td tl-col-task tl-cat-cell" rowspan={(cat.subtasks?.length || 1) * (showActual ? 2 : 1)}>
										<div class="tl-cat-name">{cat.name}</div>
									</td>
									{#if showVolTask}
										<td class="tl-td tl-col-vol tl-cat-cell" rowspan={(cat.subtasks?.length || 1) * (showActual ? 2 : 1)}>
											<div class="text-[11px] font-semibold text-gray-700">{cat.volume || 0}</div>
											<div class="text-[9px] text-gray-400">{cat.unit || 'ls'}</div>
										</td>
									{/if}
									<td class="tl-td tl-col-prog tl-cat-cell" rowspan={(cat.subtasks?.length || 1) * (showActual ? 2 : 1)}>
										<div class="text-[10px] text-gray-500">P: {getCategoryProgress(cat, 'daily_plan')}%</div>
										{#if showActual}
											<div class="text-[10px] text-blue-500">A: {getCategoryProgress(cat, 'daily_actual')}%</div>
										{/if}
									</td>
								{/if}
								<td class="tl-td tl-col-subtask" rowspan={showActual ? 2 : 1}>
									<div class="flex items-start gap-1.5">
										{#if sub.object}
											{@const objekImg = objekGambarPath(sub.object, 60)}
											<div class="tl-objek-thumb" title={sub.object.nama_objek}>
												{#if objekImg}
													<img use:secureAssetSrc={objekImg} alt={sub.object.nama_objek} />
												{:else}
													<span class="tl-objek-thumb-fallback">🔧</span>
												{/if}
											</div>
										{/if}
										<div class="min-w-0 flex-1">
											<div class="text-[11px] text-gray-700 font-medium whitespace-normal break-words">{sub.name}</div>
											{#if sub.object}
												<div class="text-[9px] text-gray-400 truncate" title={sub.object.nama_objek}>{sub.object.nama_objek}</div>
											{/if}
										</div>
									</div>
									<SubtaskSpecBadges {sub} mobStageLabel={mobStageLabel(sub.mob_stage)} onVendorClick={openVendorCard} />
									{#if isSubtaskDelayed(sub)}
										<div class="flex items-center flex-wrap gap-1 mt-1">
											<span class="tl-delay-badge"><IconAlertTriangle size={10} /> Delay</span>
											{#if unresolvedDelayFlags[sub.id]}
												<span class="tl-delay-reason-ok">✓ Tercatat ({unresolvedDelayFlags[sub.id].days_delayed}h)</span>
											{:else}
												<button class="tl-delay-reason-btn" onclick={() => openDelayModal(cat, sub)}>Alasan</button>
											{/if}
											<button class="tl-adendum-btn" onclick={() => openAdendumSheet(cat, sub)}>Adendum</button>
										</div>
									{/if}
								</td>
								<td class="tl-td tl-col-volsub" rowspan={showActual ? 2 : 1}>
									<div class="text-[11px] text-gray-600">{sub.volume || 0} {sub.unit || 'ls'}</div>
								</td>
								<td class="tl-td tl-col-days" rowspan={showActual ? 2 : 1}>
									<div class="text-[11px] text-gray-600">{getTotalDays(sub)}</div>
								</td>
								<td class="tl-td tl-col-type">
									<span class="tl-type-badge plan">PLAN</span>
								</td>
								<td class="tl-td tl-col-progsub" rowspan={showActual ? 2 : 1}>
									<div class="text-[10px] text-gray-500">P: {getProgress(sub, 'daily_plan').toFixed(2)}%</div>
									{#if showActual}
										<div class="text-[10px] text-blue-500">A: {getProgress(sub, 'daily_actual').toFixed(2)}%</div>
									{/if}
								</td>
								{#each dateColumns as col}
									<td class="tl-td tl-col-date {col.isWeekend ? 'tl-weekend' : ''} {col.dateStr === todayKey() ? 'is-today' : ''} {isPlanDay(sub, col.dateStr) ? 'tl-plan-active' : ''}">
										{#if isPlanDay(sub, col.dateStr)}
											<span class="tl-cell-val">{getPlanValue(sub, col.dateStr)}</span>
										{/if}
									</td>
								{/each}
							</tr>
							<!-- ACTUAL row -->
							{#if showActual}
								<tr class="tl-actual-row">
									<td class="tl-td tl-col-type tl-actual-cell">
										<span class="tl-type-badge actual">ACT</span>
										<button
											type="button"
											class="tl-manual-actual-btn"
											title="Isi Actual manual"
											onclick={() => openManualActualModal(cat, sub)}
										>
											<IconPlus size={11} stroke={2.5} />
										</button>
									</td>
									{#each dateColumns as col}
										<td class="tl-td tl-col-date tl-actual-cell {col.isWeekend ? 'tl-weekend' : ''} {col.dateStr === todayKey() ? 'is-today' : ''} {isActualDay(sub, col.dateStr) ? 'tl-actual-active' : ''}">
											{#if isActualDay(sub, col.dateStr)}
												<span class="tl-cell-val">{getActualValue(sub, col.dateStr)}</span>
											{/if}
										</td>
									{/each}
								</tr>
							{/if}
						{/each}
					{/each}
				</tbody>
			</table>
		</div>

		<button class="tl-fab tl-fab-secondary" onclick={() => (showKebutuhanSheet = true)}>📦 Kebutuhan Fase</button>
		<button class="tl-fab" onclick={() => openAdendumSheet()}>📝 Ajukan Adendum</button>
	{/if}
</div>

{#if project}
	<AdendumRequestSheet
		bind:open={showAdendumSheet}
		projectId={Number(projectId)}
		requestedByName={getUserDisplay($authStore.user) || $authStore.karyawanName || 'Leader'}
		directusToken={$authStore.directusToken}
		{plannedActivities}
		preselected={adendumPreselected}
		onSubmitted={() => { adendumPreselected = null; loadAdendumHistory(); }}
	/>
	<KebutuhanFaseSheet
		bind:open={showKebutuhanSheet}
		projectId={Number(projectId)}
		projectName={project?.name || ''}
		{mobStagesSetting}
		requestedByName={getUserDisplay($authStore.user) || $authStore.karyawanName || 'Leader'}
	/>
	<DelayFlagModal
		bind:open={showDelayModal}
		projectId={Number(projectId)}
		categoryId={delayModalTarget?.cat?.id || ''}
		subtaskId={delayModalTarget?.sub?.id || ''}
		subtaskName={delayModalTarget?.sub?.name || ''}
		daysDelayed={delayModalTarget?.sub ? daysSincePlan(delayModalTarget.sub) : 0}
		onSubmitted={() => { delayModalTarget = null; loadDelayFlags(); }}
	/>
	<ManualActualModal
		bind:open={showManualActualModal}
		projectId={Number(projectId)}
		categoryId={manualActualTarget?.cat?.id || ''}
		categoryName={manualActualTarget?.cat?.name || ''}
		subtaskId={manualActualTarget?.sub?.id || ''}
		subtaskName={manualActualTarget?.sub?.name || ''}
		volume={manualActualTarget?.sub?.volume || 0}
		unit={manualActualTarget?.sub?.unit || 'ls'}
		inputByName={getUserDisplay($authStore.user) || $authStore.karyawanName || 'Leader'}
		inputByKaryawanId={$authStore.karyawanId || null}
		onSubmitted={(tanggal, value) => {
			if (manualActualTarget?.sub) applyManualActualEntry(manualActualTarget.sub, tanggal, value);
			manualActualTarget = null;
		}}
	/>
{/if}

{#if showVendorCard}
	<!-- Executor Partitioning — Rekomendasi L3: Vendor Contact Card -->
	<div class="vc-overlay" onclick={closeVendorCard} role="presentation">
		<div class="vc-card" onclick={(e) => e.stopPropagation()} role="dialog">
			<div class="vc-header">
				<span class="vc-title">🤝 Kontak Vendor</span>
				<button class="vc-close" onclick={closeVendorCard} aria-label="Tutup">✕</button>
			</div>
			{#if vendorCardLoading}
				<p class="vc-loading">Memuat…</p>
			{:else if !vendorCardData}
				<p class="vc-loading">Data vendor tidak ditemukan.</p>
			{:else}
				<div class="vc-body">
					<div class="vc-name">{vendorCardData.nama}</div>
					{#if vendorCardData.tipe_mitra}
						<span class="vc-badge {TIPE_MITRA_LABELS[vendorCardData.tipe_mitra]?.badge || ''}">{TIPE_MITRA_LABELS[vendorCardData.tipe_mitra]?.label || vendorCardData.tipe_mitra}</span>
					{/if}
					<div class="vc-row"><span class="vc-label">PIC</span><span>{vendorCardData.kontak_person || '-'}</span></div>
					<div class="vc-row"><span class="vc-label">Telepon</span><span>{vendorCardData.telepon || '-'}</span></div>
					<div class="vc-row"><span class="vc-label">Email</span><span>{vendorCardData.email || '-'}</span></div>
					<div class="vc-row"><span class="vc-label">Alamat</span><span>{vendorCardData.alamat || '-'}</span></div>
					{#if vendorCardData.skor_total != null}
						<div class="vc-row"><span class="vc-label">Skor Kinerja</span><span>{vendorCardData.skor_total}</span></div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Executor Partitioning — Rekomendasi L3: Vendor Contact Card */
	.vc-overlay {
		position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
		z-index: 10000; display: flex; align-items: center; justify-content: center;
	}
	.vc-card {
		width: min(340px, 90vw); background: #fff; border-radius: 14px;
		box-shadow: 0 14px 38px rgba(0,0,0,0.25); padding: 16px;
	}
	.vc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
	.vc-title { font-size: 13px; font-weight: 800; color: #1e293b; }
	.vc-close { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 13px; }
	.vc-loading { font-size: 12px; color: #64748b; padding: 12px 0; }
	.vc-name { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
	.vc-badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid; margin-bottom: 8px; }
	.vc-row { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: #334155; padding: 4px 0; border-top: 1px solid #f1f5f9; }
	.vc-label { color: #94a3b8; font-weight: 600; }

	/* Timeline Table Styles */
	.tl-table {
		border-collapse: collapse;
		font-size: 11px;
		min-width: 100%;
		white-space: nowrap;
	}

	/* Header */
	.tl-month-row th {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		padding: 4px 6px;
		font-size: 11px;
		font-weight: 600;
		color: #475569;
		text-align: center;
		position: sticky;
		top: 0;
		z-index: 10;
	}
	.tl-month-cell {
		background: linear-gradient(135deg, #f0fdf4, #ecfdf5) !important;
		color: var(--gd) !important;
	}
	.tl-fixed-header {
		background: #f1f5f9 !important;
	}

	.tl-day-row th {
		position: sticky;
		top: 28px;
		z-index: 10;
	}

	.tl-th {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		padding: 4px 6px;
		font-size: 10px;
		font-weight: 600;
		color: #64748b;
		text-align: center;
		vertical-align: middle;
	}

	/* Column widths */
	.tl-col-no { min-width: 32px; width: 32px; }
	.tl-col-task { min-width: 120px; max-width: 160px; text-align: left !important; }
	.tl-col-vol { min-width: 50px; }
	.tl-col-prog { min-width: 70px; }
	.tl-col-subtask { min-width: 120px; max-width: 180px; text-align: left !important; white-space: normal; word-break: break-word; }
	.tl-objek-thumb {
		width: 20px; height: 20px; border-radius: 5px; overflow: hidden; flex-shrink: 0;
		background: #f1f5f9; display: flex; align-items: center; justify-content: center;
	}
	.tl-objek-thumb img { width: 100%; height: 100%; object-fit: cover; }
	.tl-objek-thumb-fallback { font-size: 9px; }
	.tl-col-volsub { min-width: 60px; }
	.tl-col-days { min-width: 36px; }
	.tl-col-type { min-width: 44px; }
	.tl-col-progsub { min-width: 70px; }
	.tl-col-date { min-width: 30px; width: 30px; }

	/* Date header */
	.tl-date-num { font-size: 11px; font-weight: 700; color: #334155; line-height: 1.2; }
	.tl-date-day { font-size: 8px; font-weight: 500; color: #94a3b8; text-transform: uppercase; }

	/* Body cells */
	.tl-td {
		border: 1px solid #e2e8f0;
		padding: 4px 6px;
		text-align: center;
		vertical-align: middle;
		background: white;
	}

	/* Category merged cells */
	.tl-cat-cell {
		background: #fafbfc;
		border-right: 2px solid #cbd5e1;
	}
	.tl-cat-label {
		font-size: 12px;
		font-weight: 700;
		color: var(--g);
	}
	.tl-cat-name {
		font-size: 11px;
		font-weight: 600;
		color: #1e293b;
		white-space: normal;
		word-break: break-word;
		max-width: 150px;
		text-align: left;
	}

	/* Plan/Actual type badges */
	.tl-type-badge {
		display: inline-block;
		padding: 1px 5px;
		border-radius: 4px;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.5px;
	}
	.tl-type-badge.plan {
		background: #dcfce7;
		color: var(--ggd);
	}
	.tl-type-badge.actual {
		background: #dbeafe;
		color: #1e40af;
	}

	.tl-manual-actual-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 15px;
		height: 15px;
		margin-left: 3px;
		padding: 0;
		border-radius: 999px;
		border: 1px solid #93c5fd;
		background: #eff6ff;
		color: #2563eb;
		cursor: pointer;
		vertical-align: middle;
	}
	.tl-manual-actual-btn:hover {
		background: #2563eb;
		color: white;
	}

	/* Weekend */
	.tl-weekend {
		background: #fff1f2 !important;
	}

	/* Active plan/actual cells */
	.tl-plan-active {
		background: #4CAF50 !important;
	}
	.tl-actual-active {
		background: #2196F3 !important;
	}

	.tl-cell-val {
		font-size: 10px;
		font-weight: 700;
		color: white;
	}

	/* Actual row subtle bg */
	.tl-actual-cell {
		background: #f8fafc;
	}
	.tl-actual-cell.tl-weekend {
		background: #fef2f2 !important;
	}

	/* Row hover */
	.tl-plan-row:hover td,
	.tl-actual-row:hover td {
		background-color: #f0fdf4;
	}
	.tl-plan-row:hover .tl-plan-active {
		background: #388E3C !important;
	}
	.tl-actual-row:hover .tl-actual-active {
		background: #1976D2 !important;
	}

	/* Timeline Adendum */
	.tl-delay-badge {
		display: inline-flex; align-items: center; gap: 3px;
		font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 6px;
		background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; white-space: nowrap;
	}
	.tl-adendum-btn {
		font-size: 9px; font-weight: 600; padding: 3px 6px; border-radius: 6px;
		background: white; color: #b45309; border: 1px solid #f59e0b; cursor: pointer; white-space: nowrap;
	}
	.tl-adendum-btn:active { background: #fffbeb; }
	.tl-delay-reason-btn {
		font-size: 9px; font-weight: 600; padding: 3px 6px; border-radius: 6px;
		background: #dc2626; color: white; border: none; cursor: pointer; white-space: nowrap;
	}
	.tl-delay-reason-btn:active { background: #b91c1c; }
	.tl-delay-reason-ok {
		font-size: 9px; font-weight: 600; color: #15803d; white-space: nowrap;
	}

	.tl-fab {
		position: fixed; bottom: 18px; right: 16px; z-index: 50;
		padding: 12px 18px; border-radius: 999px; border: none;
		background: var(--g, #16a34a); color: white; font-size: 13px; font-weight: 700;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
	}
	.tl-fab:active { transform: scale(0.97); }
	.tl-fab-secondary {
		bottom: 72px;
		background: #2563eb;
	}

	.tl-unseen-dot {
		position: absolute; top: -3px; right: -3px;
		width: 9px; height: 9px; border-radius: 50%;
		background: #dc2626; border: 2px solid white;
	}

	.ah-badge {
		display: inline-block; padding: 2px 8px; border-radius: 999px;
		font-size: 10px; font-weight: 700; text-transform: capitalize; white-space: nowrap;
	}
	.ah-badge-yellow { background: #fef3c7; color: #92400e; }
	.ah-badge-green { background: #d1fae5; color: #065f46; }
	.ah-badge-red { background: #fee2e2; color: #991b1b; }

	/* Dark mode overrides for Timeline */
	:global(:root[data-theme='dark']) .tl-month-cell {
		background: rgba(31, 101, 146, 0.25) !important;
		color: var(--gd) !important;
	}
	:global(:root[data-theme='dark']) .tl-fixed-header,
	:global(:root[data-theme='dark']) .tl-th {
		background: var(--sys-fill) !important;
		border-color: var(--sys-sep) !important;
		color: var(--sys-label2) !important;
	}
	:global(:root[data-theme='dark']) .tl-date-num {
		color: var(--sys-label) !important;
	}
	:global(:root[data-theme='dark']) .tl-date-day {
		color: var(--sys-label4) !important;
	}
	:global(:root[data-theme='dark']) .tl-td {
		background: var(--sys-bg) !important;
		border-color: var(--sys-sep) !important;
		color: var(--sys-label) !important;
	}
	:global(:root[data-theme='dark']) .tl-cat-cell {
		background: var(--sys-fill2) !important;
		border-right-color: var(--sys-sep) !important;
	}
	:global(:root[data-theme='dark']) .tl-cat-name {
		color: var(--sys-label) !important;
	}
	:global(:root[data-theme='dark']) .tl-weekend {
		background: rgba(240, 99, 108, 0.12) !important;
	}
	:global(:root[data-theme='dark']) .tl-actual-cell {
		background: var(--sys-fill) !important;
	}
	:global(:root[data-theme='dark']) .tl-actual-cell.tl-weekend {
		background: rgba(240, 99, 108, 0.15) !important;
	}
	:global(:root[data-theme='dark']) .tl-plan-row:hover td,
	:global(:root[data-theme='dark']) .tl-actual-row:hover td {
		background-color: var(--sys-fill2) !important;
	}
	:global(:root[data-theme='dark']) .tl-delay-badge {
		background: rgba(232, 178, 61, 0.2);
		color: var(--color-warning-text);
		border-color: rgba(232, 178, 61, 0.4);
	}
	:global(:root[data-theme='dark']) .tl-adendum-btn {
		background: var(--sys-bg2);
		color: var(--color-warning-text);
		border-color: rgba(232, 178, 61, 0.4);
	}
	:global(:root[data-theme='dark']) .ah-badge-yellow {
		background: rgba(232, 178, 61, 0.2);
		color: var(--color-warning-text);
	}
	:global(:root[data-theme='dark']) .ah-badge-green {
		background: rgba(52, 201, 140, 0.2);
		color: var(--color-success-text);
	}
	:global(:root[data-theme='dark']) .ah-badge-red {
		background: rgba(240, 99, 108, 0.2);
		color: var(--color-error-text);
	}
	:global(:root[data-theme='dark']) .tl-manual-actual-btn {
		background: rgba(37, 99, 235, 0.15);
		border-color: rgba(37, 99, 235, 0.4);
		color: #93c5fd;
	}

	/* Excel Ribbon & Status Bar */
	.excel-formula-bar {
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
	}

	/* Today column highlight */
	.tl-col-date.is-today {
		border-left: 2px solid #2563eb !important;
		border-right: 2px solid #2563eb !important;
	}
	th.tl-col-date.is-today {
		background: #eff6ff !important;
		color: #1e40af !important;
	}
	td.tl-col-date.is-today {
		background-color: rgba(37, 99, 235, 0.05) !important;
	}
	.tl-today-badge {
		display: block;
		font-size: 7px;
		font-weight: 800;
		background: #2563eb;
		color: white;
		border-radius: 2px;
		padding: 1px 2px;
		margin-bottom: 2px;
		line-height: 1;
		letter-spacing: 0.3px;
	}

	/* Density Compact Mode */
	.density-compact .tl-td {
		padding: 2px 4px !important;
		height: 25px !important;
	}
	.density-compact .tl-th {
		padding: 2px 4px !important;
	}
	.density-compact .tl-month-row th {
		padding: 2px 4px !important;
		font-size: 10px !important;
	}
	.density-compact .tl-day-row th {
		top: 24px !important;
	}
	.density-compact .tl-cat-cell {
		padding: 2px 4px !important;
	}
	.density-compact .tl-cell-val {
		font-size: 9px !important;
	}

	/* Dark mode overrides for Today and Excel */
	:global(:root[data-theme='dark']) .tl-col-date.is-today {
		border-left-color: #3b82f6 !important;
		border-right-color: #3b82f6 !important;
	}
	:global(:root[data-theme='dark']) th.tl-col-date.is-today {
		background: rgba(30, 58, 138, 0.4) !important;
		color: #93c5fd !important;
	}
	:global(:root[data-theme='dark']) td.tl-col-date.is-today {
		background-color: rgba(37, 99, 235, 0.12) !important;
	}
</style>
