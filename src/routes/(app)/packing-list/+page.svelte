<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import {
		IconArrowLeft, IconPackage, IconClipboardCheck, IconBox,
		IconChevronDown, IconChevronRight, IconLoader2, IconPlus,
		IconTruck, IconFileText, IconEdit, IconCheck, IconCornerUpLeft,
		IconAlertTriangle, IconAlertCircle, IconClock, IconCircleCheck,
		IconUserCheck, IconNotes, IconEye, IconInfoCircle, IconChecks,
		IconScan, IconBuilding, IconMapPin, IconUser, IconCalendar,
		IconLayersSubtract, IconArrowRight, IconShieldCheck, IconTools,
		IconPaint, IconReceipt, IconRefresh, IconSearch, IconX, IconFilter
	} from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { authStore, shouldFilterProjectsByLeader } from '$lib/stores/auth';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import {
		getPackingRequests,
		getAllProjectsInventory,
		updateMaterialUsage,
		getReturnRequests,
		fetchReturAlertCount,
		fetchItemChangedTrail,
		reasonCodeLabel,
		submitItemChangedObjection,
		type ItemChangedInfo
	} from '$lib/services/packingList';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import PackingRequestModal from '$lib/components/packing-list/PackingRequestModal.svelte';
	import TrackingTimeline from '$lib/components/packing-list/TrackingTimeline.svelte';
	import SaldoBarangSayaPanel from '$lib/components/inventory/SaldoBarangSayaPanel.svelte';
	import ColorChip from '$lib/components/packing-list/ColorChip.svelte';
	import { isPaintItem, cleanColor } from '$lib/shared/paintColorUtils';

	let activeTab = $state<'pengajuan' | 'inventory' | 'pengembalian'>('pengajuan');
	let loading = $state(true);
	let showPackingModal = $state(false);
	let modalProjectId = $state<number | null>(null);

	// Pengajuan tab
	let packingRequests = $state<any[]>([]);
	let reqOffset = 0;
	let reqHasMore = $state(true);
	let reqLoadingMore = $state(false);
	let reqSearch = $state('');
	let reqSort = $state<'-date_created' | 'date_created' | 'progress_desc' | 'progress_asc'>('-date_created');
	let reqStageFilter = $state<'semua' | 'requested' | 'approved' | 'packing' | 'shipped' | 'received'>('semua');
	// PL Tracking v2 Fase 4d — item yang panel timeline pelacakannya sedang dibuka.
	let timelineItem = $state<any | null>(null);

	// Fase 3 (rencana v2 "Packing List -> Multi Surat Jalan + Pergantian Barang", 23 Sep
	// 2026), alternatif #3: jejak "barang diganti gudang" per item + form keberatan (soft).
	let itemChangedTrail = $state<Record<number, ItemChangedInfo>>({});
	let objectionForItem = $state<number | null>(null);
	let objectionNote = $state('');
	let objectionSaving = $state(false);
	let objectionError = $state('');
	let objectionSentFor = $state<Set<number>>(new Set());

	function openObjection(itemId: number) {
		objectionForItem = itemId;
		objectionNote = '';
		objectionError = '';
	}
	function cancelObjection() {
		objectionForItem = null;
		objectionError = '';
	}
	async function sendObjection(item: any) {
		if (objectionNote.trim().length < 5) {
			objectionError = 'Tuliskan alasan keberatan (minimal 5 karakter).';
			return;
		}
		objectionSaving = true;
		objectionError = '';
		try {
			const info = itemChangedTrail[item.id];
			await submitItemChangedObjection(item.id, objectionNote.trim(), info?.before || null, info?.after || null);
			objectionSentFor = new Set([...objectionSentFor, item.id]);
			objectionForItem = null;
		} catch (e: any) {
			objectionError = e?.message || 'Gagal mengirim keberatan';
		} finally {
			objectionSaving = false;
		}
	}

	// Inventory tab
	let projects = $state<any[]>([]);
	let projectsMap = $state<Record<number, any>>({});
	let inventoryByProject = $state<Record<number, any[]>>({});
	let expandedProject = $state<number | null>(null);
	let projectNames = $state<Record<number, string>>({});
	let invOffset = 0;
	let invHasMore = $state(true);
	let invLoadingMore = $state(false);
	let invSearch = $state('');
	let invSort = $state('-expense_date');
	let flatInventory = $state<any[]>([]);

	// Pengembalian (Return) tab
	let returnRequests = $state<any[]>([]);
	let expandedReturnProject = $state<number | null>(null);
	let retOffset = 0;
	let retHasMore = $state(true);
	let retLoadingMore = $state(false);
	let retSearch = $state('');
	let retSort = $state('-date_created');
	let retFilter = $state('');

	// §7 rekomendasi L2 — badge peringatan tab Pengembalian: dokumen retur ditolak
	// atau alat lewat jatuh tempo rencana. Independen dari retTotalCount (packing_returns lama).
	let retAlertCount = $state(0);

	let limit = 50;

	// Pengajuan accordion
	let expandedPengajuanProject = $state<number | null>(null);

	// Material usage edit
	let editingItem = $state<number | null>(null);
	let editQtyUsed = $state(0);
	let savingUsage = $state(false);

	let currentRoleId: string | null = null;
	let currentKaryawanId: number | null = null;
	let currentKaryawanName: string | null = null;
	let currentDirectusToken: string | null = null;

	const unsubAuth = authStore.subscribe((s) => {
		currentRoleId = s.roleId;
		currentKaryawanId = s.karyawanId;
		currentKaryawanName = s.karyawanName;
		currentDirectusToken = s.directusToken;
	});

	// ==========================================
	// HELPER STAGE & STATUS CALCULATION
	// ==========================================

	interface StageInfo {
		step: number; // 1 to 5
		key: 'requested' | 'approved' | 'packing' | 'shipped' | 'received' | 'rejected';
		title: string;
		label: string;
		shortLabel: string;
		colorClass: string;
		badgeClass: string;
		dotClass: string;
		borderClass: string;
		description: string;
	}

	function getItemStage(item: any): StageInfo {
		const status = (item.packing_status || '').toLowerCase().trim();
		const qtySent = Number(item.qty_sudah_dikirim) || 0;
		const qtyTotal = Number(item.qty) || 0;
		const pickStatus = (item.pick_status || '').toLowerCase();

		if (status === 'rejected') {
			return {
				step: 0,
				key: 'rejected',
				title: 'Ditolak',
				label: 'Pengajuan Ditolak',
				shortLabel: 'Ditolak',
				colorClass: 'text-rose-600 dark:text-rose-400',
				badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
				dotClass: 'bg-rose-500',
				borderClass: 'border-rose-200',
				description: 'Pengajuan ditolak oleh manajemen/approver.'
			};
		}

		if (status === 'received' || (qtySent >= qtyTotal && qtyTotal > 0)) {
			return {
				step: 5,
				key: 'received',
				title: '5. Tiba di Lokasi (Selesai)',
				label: 'Tiba di Lokasi & Masuk Inventory',
				shortLabel: 'Tiba di Proyek',
				colorClass: 'text-emerald-600 dark:text-emerald-400',
				badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
				dotClass: 'bg-emerald-500',
				borderClass: 'border-emerald-300',
				description: 'Barang telah diterima di lapangan dan tercatat di inventory proyek.'
			};
		}

		if (status === 'shipped' || qtySent > 0) {
			return {
				step: 4,
				key: 'shipped',
				title: '4. Dalam Pengiriman',
				label: qtySent < qtyTotal && qtySent > 0 ? `Sebagian Dikirim (${qtySent}/${qtyTotal})` : 'Surat Jalan Terbit / Dalam Perjalanan',
				shortLabel: 'Dalam Pengiriman',
				colorClass: 'text-indigo-600 dark:text-indigo-400',
				badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800',
				dotClass: 'bg-indigo-500',
				borderClass: 'border-indigo-300',
				description: 'Surat Jalan telah dibuat dan barang sedang diantar oleh Logistik/Driver.'
			};
		}

		if (status === 'packing' || pickStatus === 'verified') {
			return {
				step: 3,
				key: 'packing',
				title: '3. Penyiapan Gudang',
				label: 'Sedang Disiapkan & Dipacking Gudang',
				shortLabel: 'Disiapkan Gudang',
				colorClass: 'text-sky-600 dark:text-sky-400',
				badgeClass: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
				dotClass: 'bg-sky-500',
				borderClass: 'border-sky-300',
				description: 'Barang sedang dipersiapkan dan discan oleh petugas gudang via Picking Barcode.'
			};
		}

		if (status === 'approved') {
			return {
				step: 2,
				key: 'approved',
				title: '2. Disetujui (ACC)',
				label: 'Disetujui · Siap Diproses Gudang',
				shortLabel: 'Disetujui (Siap Kirim)',
				colorClass: 'text-emerald-600 dark:text-emerald-400',
				badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
				dotClass: 'bg-emerald-500',
				borderClass: 'border-emerald-300',
				description: 'Pengajuan telah disetujui oleh SPV / Manajer / Direktur.'
			};
		}

		// Default: requested / pending_approval
		return {
			step: 1,
			key: 'requested',
			title: '1. Pengajuan (Menunggu ACC)',
			label: 'Menunggu Persetujuan (Approval)',
			shortLabel: 'Menunggu Approval',
			colorClass: 'text-amber-600 dark:text-amber-400',
			badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
			dotClass: 'bg-amber-500',
			borderClass: 'border-amber-300',
			description: 'Pengajuan telah dikirim, menunggu review dari pihak berwenang.'
		};
	}

	function getProjectStageSummary(items: any[]) {
		if (!items || items.length === 0) {
			return {
				step: 1,
				key: 'requested',
				label: 'Belum Ada Pengajuan',
				shortLabel: 'Kosong',
				badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
				dotClass: 'bg-slate-400',
				totalItems: 0,
				totalQtyRequired: 0,
				totalQtyDelivered: 0,
				completionPct: 0,
				approvedCount: 0,
				shippedCount: 0,
				receivedCount: 0,
				pendingCount: 0,
				rejectedCount: 0
			};
		}

		let totalQtyRequired = 0;
		let totalQtyDelivered = 0;
		let approvedCount = 0;
		let shippedCount = 0;
		let receivedCount = 0;
		let pendingCount = 0;
		let packingCount = 0;
		let rejectedCount = 0;

		for (const item of items) {
			const req = Number(item.qty) || 0;
			const del = Number(item.qty_sudah_dikirim) || 0;
			totalQtyRequired += req;
			totalQtyDelivered += del;

			const stage = getItemStage(item);
			if (stage.key === 'rejected') rejectedCount++;
			else if (stage.step === 5) receivedCount++;
			else if (stage.step === 4) shippedCount++;
			else if (stage.step === 3) packingCount++;
			else if (stage.step === 2) approvedCount++;
			else pendingCount++;
		}

		const total = items.length;
		const completionPct = totalQtyRequired > 0 ? Math.min(100, Math.round((totalQtyDelivered / totalQtyRequired) * 100)) : (receivedCount === total && total > 0 ? 100 : 0);

		// Determine aggregate stage
		let step = 1;
		let key: any = 'requested';
		let label = 'Menunggu Persetujuan';
		let shortLabel = 'Menunggu Approval';
		let badgeClass = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';
		let dotClass = 'bg-amber-500';

		if (receivedCount === total && total > 0) {
			step = 5;
			key = 'received';
			label = 'Selesai · Semua Diterima di Lokasi';
			shortLabel = 'Tiba di Lokasi';
			badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
			dotClass = 'bg-emerald-500';
		} else if (shippedCount > 0 || totalQtyDelivered > 0) {
			step = 4;
			key = 'shipped';
			label = `Dalam Pengiriman (${shippedCount + receivedCount}/${total} item OTW/Tiba)`;
			shortLabel = 'Dalam Pengiriman';
			badgeClass = 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800';
			dotClass = 'bg-indigo-500';
		} else if (packingCount > 0) {
			step = 3;
			key = 'packing';
			label = `Penyiapan Gudang (${packingCount}/${total} item diproses)`;
			shortLabel = 'Disiapkan Gudang';
			badgeClass = 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800';
			dotClass = 'bg-sky-500';
		} else if (approvedCount > 0 && pendingCount === 0) {
			step = 2;
			key = 'approved';
			label = `Disetujui Semua (${approvedCount}/${total} Siap Kirim)`;
			shortLabel = 'Disetujui (Siap Kirim)';
			badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
			dotClass = 'bg-emerald-500';
		} else if (approvedCount > 0) {
			step = 2;
			key = 'approved';
			label = `Sebagian Disetujui (${approvedCount}/${total} ACC)`;
			shortLabel = `Sebagian Disetujui (${approvedCount}/${total})`;
			badgeClass = 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800';
			dotClass = 'bg-teal-500';
		}

		return {
			step,
			key,
			label,
			shortLabel,
			badgeClass,
			dotClass,
			totalItems: total,
			totalQtyRequired,
			totalQtyDelivered,
			completionPct,
			approvedCount,
			shippedCount,
			receivedCount,
			pendingCount,
			packingCount,
			rejectedCount
		};
	}

	const PIPELINE_STEPS = [
		{ step: 1, label: 'Diajukan', desc: 'Pengajuan Leader' },
		{ step: 2, label: 'Disetujui', desc: 'Persetujuan SPV/Mgr' },
		{ step: 3, label: 'Disiapkan', desc: 'Picking Gudang' },
		{ step: 4, label: 'Dikirim', desc: 'Surat Jalan OTW' },
		{ step: 5, label: 'Diterima', desc: 'Masuk Inventory' }
	];

	function getCategoryMeta(catKey?: string | null) {
		const raw = (catKey || '').toLowerCase().trim();
		if (raw.includes('supplier') || raw.includes('cat') || raw === 'material') {
			return {
				label: 'Material / Cat',
				bgClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
				icon: 'paint'
			};
		}
		if (raw.includes('sewa_alat') || raw.includes('alat') || raw.includes('equipment')) {
			return {
				label: 'Sewa Alat & Mesin',
				bgClass: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
				icon: 'tools'
			};
		}
		if (raw.includes('consumable')) {
			return {
				label: 'Consumables',
				bgClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
				icon: 'box'
			};
		}
		if (raw.includes('safety') || raw.includes('k3')) {
			return {
				label: 'K3 / Safety',
				bgClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
				icon: 'shield'
			};
		}
		if (raw.includes('operasional')) {
			return {
				label: 'Operasional',
				bgClass: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800',
				icon: 'operasional'
			};
		}
		if (raw.includes('jasa')) {
			return {
				label: 'Jasa / Subkon',
				bgClass: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800',
				icon: 'receipt'
			};
		}
		return {
			label: 'Material',
			bgClass: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
			icon: 'package'
		};
	}

	function formatDate(dateStr?: string | null): string {
		if (!dateStr) return '';
		try {
			const d = new Date(dateStr);
			return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
		} catch {
			return dateStr;
		}
	}

	function formatDateTime(dateStr?: string | null): string {
		if (!dateStr) return '';
		try {
			const d = new Date(dateStr);
			return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
		} catch {
			return dateStr;
		}
	}

	function getUsagePercent(item: any) {
		if (!item.qty || item.qty === 0) return 0;
		return Math.min(100, Math.round(((item.qty_used || 0) / item.qty) * 100));
	}

	// ==========================================
	// DATA FETCHING
	// ==========================================

	onMount(() => {
		async function init() {
			loading = true;
			try {
				const projResult = await getProjectsForCurrentUser(false);
				projects = projResult || [];
				for (const p of projects) {
					projectNames[p.id] = p.name;
					projectsMap[p.id] = p;
				}

				await Promise.all([
					fetchRequests(),
					fetchInventoryFixed(),
					fetchReturns()
				]);

				// §7 rekomendasi L2 — badge tab Pengembalian, best-effort & terpisah dari
				// alur utama (kegagalannya tidak boleh mengganggu tab lain).
				fetchReturAlertCount(projects.map((p) => p.id))
					.then((r) => { retAlertCount = r.total; })
					.catch(() => { retAlertCount = 0; });
			} catch (e) {
				console.error('Gagal memuat data:', e);
			} finally {
				loading = false;
			}
		}

		init();
		return () => unsubAuth();
	});

	async function fetchRequests(isLoadMore = false) {
		if (isLoadMore) reqLoadingMore = true;
		else { reqOffset = 0; reqHasMore = true; }

		try {
			const needsLeaderFilter = shouldFilterProjectsByLeader(currentRoleId);
			const projectIds = new Set(projects.map(p => p.id));
			const pIds = needsLeaderFilter ? Array.from(projectIds) : undefined;
			
			const res = await getPackingRequests(pIds, {
				limit,
				offset: reqOffset,
				search: reqSearch,
				sort: reqSort === 'progress_desc' || reqSort === 'progress_asc' ? '-date_created' : reqSort,
				filterStatus: reqStageFilter === 'semua' ? '' : reqStageFilter
			});
			
			if (res.length < limit) reqHasMore = false;

			const validRes = needsLeaderFilter ? res.filter((r: any) => projectIds.has(r.project_id)) : res;

			if (isLoadMore) {
				packingRequests = [...packingRequests, ...validRes];
			} else {
				packingRequests = validRes;
			}
			reqOffset += limit;

			// Fase 3 (fix B7): jejak ganti barang — best-effort, tidak menghambat render daftar.
			fetchItemChangedTrail(validRes.map((r: any) => r.id))
				.then((trail) => { itemChangedTrail = { ...itemChangedTrail, ...trail }; })
				.catch(() => {});
		} catch (e) {
			console.error(e);
		} finally {
			reqLoadingMore = false;
		}
	}

	async function fetchInventoryFixed(isLoadMore = false) {
		if (isLoadMore) invLoadingMore = true;
		else { invOffset = 0; invHasMore = true; }

		try {
			const needsLeaderFilter = shouldFilterProjectsByLeader(currentRoleId);
			const projectIds = new Set(projects.map(p => p.id));
			const pIds = needsLeaderFilter ? Array.from(projectIds) : undefined;
			
			const res = await getAllProjectsInventory({
				limit,
				offset: invOffset,
				search: invSearch,
				sort: invSort,
				projectIds: pIds
			});
			
			if (res.length < limit) invHasMore = false;

			const validRes = needsLeaderFilter ? res.filter((r: any) => projectIds.has(r.project_id)) : res;

			if (isLoadMore) flatInventory = [...flatInventory, ...validRes];
			else flatInventory = validRes;

			const grouped: Record<number, any[]> = {};
			for (const item of flatInventory) {
				const pid = item.project_id;
				if (!grouped[pid]) grouped[pid] = [];
				grouped[pid].push(item);
			}
			inventoryByProject = grouped;
			invOffset += limit;
		} catch (e) {
			console.error(e);
		} finally {
			invLoadingMore = false;
		}
	}

	async function fetchReturns(isLoadMore = false) {
		if (isLoadMore) retLoadingMore = true;
		else { retOffset = 0; retHasMore = true; }

		try {
			const needsLeaderFilter = shouldFilterProjectsByLeader(currentRoleId);
			const projectIds = new Set(projects.map(p => p.id));
			const pIds = needsLeaderFilter ? Array.from(projectIds) : undefined;
			
			const res = await getReturnRequests(pIds, undefined, {
				limit,
				offset: retOffset,
				search: retSearch,
				sort: retSort,
				filterStatus: retFilter === 'semua' ? '' : retFilter
			});
			
			if (res.length < limit) retHasMore = false;

			const validRes = needsLeaderFilter ? res.filter((r: any) => projectIds.has(r.project_id)) : res;

			if (isLoadMore) {
				returnRequests = [...returnRequests, ...validRes];
			} else {
				returnRequests = validRes;
			}
			retOffset += limit;
		} catch (e) {
			console.error(e);
		} finally {
			retLoadingMore = false;
		}
	}

	// Accordion and Actions
	function togglePengajuanProject(pid: number) {
		expandedPengajuanProject = expandedPengajuanProject === pid ? null : pid;
	}

	function toggleProject(pid: number) {
		expandedProject = expandedProject === pid ? null : pid;
	}

	function toggleReturnProject(pid: number) {
		expandedReturnProject = expandedReturnProject === pid ? null : pid;
	}

	function openPackingModalForProject(pid?: number) {
		modalProjectId = pid || null;
		showPackingModal = true;
	}

	function switchToInventoryForProject(pid: number) {
		activeTab = 'inventory';
		expandedProject = pid;
	}

	function startEditUsage(item: any) {
		editingItem = item.id;
		editQtyUsed = item.qty_used || 0;
	}

	function cancelEditUsage() {
		editingItem = null;
		editQtyUsed = 0;
	}

	async function saveUsage(item: any) {
		savingUsage = true;
		try {
			const success = await updateMaterialUsage(item.id, editQtyUsed, item.qty || 0);
			if (success) {
				const pid = item.project_id;
				if (inventoryByProject[pid]) {
					inventoryByProject[pid] = inventoryByProject[pid].map(i => {
						if (i.id === item.id) {
							return { ...i, qty_used: editQtyUsed, qty_remaining: (i.qty || 0) - editQtyUsed };
						}
						return i;
					});
				}
				editingItem = null;
			} else {
				alert('Gagal menyimpan pemakaian.');
			}
		} catch {
			alert('Terjadi kesalahan.');
		} finally {
			savingUsage = false;
		}
	}

	// ==========================================
	// DERIVED DATA & METRICS
	// ==========================================

	// Group requests by project
	let requestsByProject = $derived(() => {
		const grouped: Record<number, any[]> = {};
		for (const item of packingRequests) {
			const pid = item.project_id;
			if (!grouped[pid]) grouped[pid] = [];
			grouped[pid].push(item);
		}
		return grouped;
	});

	let requestProjectIds = $derived(() => {
		const keys = Object.keys(requestsByProject()).map(Number);
		if (reqSort === 'progress_desc') {
			return keys.sort((a, b) => {
				const sumA = getProjectStageSummary(requestsByProject()[a] || []);
				const sumB = getProjectStageSummary(requestsByProject()[b] || []);
				return sumB.completionPct - sumA.completionPct;
			});
		} else if (reqSort === 'progress_asc') {
			return keys.sort((a, b) => {
				const sumA = getProjectStageSummary(requestsByProject()[a] || []);
				const sumB = getProjectStageSummary(requestsByProject()[b] || []);
				return sumA.completionPct - sumB.completionPct;
			});
		}
		return keys;
	});

	// Global KPIs for Pengajuan Tab
	let kpiTotalItems = $derived(packingRequests.length);
	let kpiWaitingApproval = $derived(packingRequests.filter(r => {
		const st = getItemStage(r);
		return st.step === 1;
	}).length);
	let kpiApprovedReady = $derived(packingRequests.filter(r => {
		const st = getItemStage(r);
		return st.step === 2 || st.step === 3;
	}).length);
	let kpiInTransit = $derived(packingRequests.filter(r => {
		const st = getItemStage(r);
		return st.step === 4;
	}).length);
	let kpiReceived = $derived(packingRequests.filter(r => {
		const st = getItemStage(r);
		return st.step === 5;
	}).length);
	// PL Tracking v2 Fase 4d — item yang stoknya kosong & sedang jalan di pengadaan.
	let kpiWaitingProcurement = $derived(packingRequests.filter(r => {
		const s = String(r.procurement_tracking_status || '').toLowerCase();
		return ['pr_diajukan', 'pr_disetujui', 'po_diterbitkan', 'dibayar', 'menunggu_supplier'].includes(s);
	}).length);

	// Group Returns by Project
	let returnsByProject = $derived(() => {
		const grouped: Record<number, any[]> = {};
		for (const item of returnRequests) {
			const pid = item.project_id;
			if (!grouped[pid]) grouped[pid] = [];
			grouped[pid].push(item);
		}
		return grouped;
	});
	let returnProjectIds = $derived(Object.keys(returnsByProject()).map(Number));
	let inventoryProjectIds = $derived(Object.keys(inventoryByProject).map(Number));

	// Stats for Return Tab
	let retTotalCount = $derived(returnRequests.length);
	let retPendingCount = $derived(returnRequests.filter(r => r.return_status === 'return_requested').length);
	let retCheckedCount = $derived(returnRequests.filter(r => r.return_status === 'return_checked').length);

	// Stats for Inventory Tab
	let invTotalMaterials = $derived(flatInventory.length);
	let invTotalSentQty = $derived(flatInventory.reduce((a, i) => a + (Number(i.qty) || 0), 0));
	let invTotalUsedQty = $derived(flatInventory.reduce((a, i) => a + (Number(i.qty_used) || 0), 0));
	let invTotalRemainingQty = $derived(flatInventory.reduce((a, i) => a + (Number(i.qty_remaining) || ((Number(i.qty) || 0) - (Number(i.qty_used) || 0))), 0));
</script>

<div class="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-950">
	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data packing list..." />
		</div>
	{:else}
		<!-- Header Top Bar with Tabs -->
		<div class="sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-xs">
			<div class="max-w-6xl mx-auto px-3 sm:px-4 flex items-center justify-between">
				<!-- Tabs -->
				<div class="flex items-center gap-1 sm:gap-2">
					<button
						class="py-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold flex items-center gap-2 border-b-2 transition-all cursor-pointer outline-none
							{activeTab === 'pengajuan' ? 'border-[var(--g)] text-[var(--gd)] dark:text-emerald-400 font-bold' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}"
						onclick={() => { activeTab = 'pengajuan'; }}
					>
						<IconClipboardCheck size={18} class={activeTab === 'pengajuan' ? 'text-[var(--g)]' : 'text-slate-400'} />
						<span>Pengajuan</span>
						{#if kpiTotalItems > 0}
							<span class="text-[10px] px-1.5 py-0.5 rounded-full font-bold {activeTab === 'pengajuan' ? 'bg-[var(--gl)] text-[var(--gd)]' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}">
								{kpiTotalItems}
							</span>
						{/if}
					</button>

					<button
						class="py-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold flex items-center gap-2 border-b-2 transition-all cursor-pointer outline-none
							{activeTab === 'inventory' ? 'border-[var(--g)] text-[var(--gd)] dark:text-emerald-400 font-bold' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}"
						onclick={() => { activeTab = 'inventory'; }}
					>
						<IconBox size={18} class={activeTab === 'inventory' ? 'text-[var(--g)]' : 'text-slate-400'} />
						<span>Inventory Proyek</span>
						{#if invTotalMaterials > 0}
							<span class="text-[10px] px-1.5 py-0.5 rounded-full font-bold {activeTab === 'inventory' ? 'bg-[var(--gl)] text-[var(--gd)]' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}">
								{invTotalMaterials}
							</span>
						{/if}
					</button>

					<button
						class="py-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold flex items-center gap-2 border-b-2 transition-all cursor-pointer outline-none
							{activeTab === 'pengembalian' ? 'border-[var(--g)] text-[var(--gd)] dark:text-emerald-400 font-bold' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}"
						onclick={() => { activeTab = 'pengembalian'; }}
					>
						<IconCornerUpLeft size={18} class={activeTab === 'pengembalian' ? 'text-[var(--g)]' : 'text-slate-400'} />
						<span>Pengembalian</span>
						{#if retTotalCount > 0}
							<span class="text-[10px] px-1.5 py-0.5 rounded-full font-bold {activeTab === 'pengembalian' ? 'bg-[var(--gl)] text-[var(--gd)]' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}">
								{retTotalCount}
							</span>
						{/if}
						{#if retAlertCount > 0}
							<span
								class="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
								title="{retAlertCount} peringatan: dokumen retur ditolak atau alat lewat jatuh tempo"
							>
								⚠ {retAlertCount}
							</span>
						{/if}
					</button>
				</div>

				<!-- Quick Primary Action Button -->
				<div class="py-2">
					{#if activeTab === 'pengembalian'}
						<button
							type="button"
							class="px-3.5 py-1.5 text-xs font-bold text-white rounded-xl flex items-center gap-1.5 shadow-sm hover:opacity-95 active:scale-95 transition-all cursor-pointer border-none"
							style="background: var(--g)"
							onclick={() => goto('/packing-list/return')}
						>
							<IconPlus size={16} />
							<span>Ajukan Return</span>
						</button>
					{:else}
						<button
							type="button"
							class="px-3.5 py-1.5 text-xs font-bold text-white rounded-xl flex items-center gap-1.5 shadow-sm hover:opacity-95 active:scale-95 transition-all cursor-pointer border-none"
							style="background: var(--g)"
							onclick={() => openPackingModalForProject()}
						>
							<IconPlus size={16} />
							<span>+ Ajukan Packing</span>
						</button>
					{/if}
				</div>
			</div>
		</div>

		<!-- Main Content Body -->
		<div class="scroll-body flex-1 overflow-y-auto px-3 sm:px-4 py-3.5 max-w-6xl mx-auto w-full">

			<!-- ========================================================= -->
			<!-- TAB 1: PENGAJUAN (PACKING LIST TRACKER & STAGES)          -->
			<!-- ========================================================= -->
			{#if activeTab === 'pengajuan'}

				<!-- Hint bantuan (PL Tracking v2 Fase 4d) -->
				<div class="flex items-start gap-1.5 mb-2 text-[11px] text-slate-500 dark:text-slate-400">
					<IconInfoCircle size={13} class="mt-0.5 shrink-0 text-slate-400" />
					<span>Barang yang stoknya kosong di gudang otomatis masuk antrean pembelian. Ketuk item untuk melihat posisinya sekarang.</span>
				</div>

				<!-- 6 KPI Cards: Stage Metrics -->
				<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
					<!-- 1. Total Diajukan -->
					<button
						type="button"
						class="text-left rounded-xl p-2.5 bg-white dark:bg-slate-900 border transition-all cursor-pointer
							{reqStageFilter === 'semua' ? 'border-[var(--g)] shadow-sm ring-1 ring-[var(--g)]/30' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'}"
						onclick={() => { reqStageFilter = 'semua'; fetchRequests(); }}
					>
						<p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Total Diajukan</p>
						<div class="flex items-baseline justify-between">
							<strong class="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100">{kpiTotalItems}</strong>
							<span class="text-[10px] text-slate-400">item</span>
						</div>
					</button>

					<!-- 2. Menunggu Approval -->
					<button
						type="button"
						class="text-left rounded-xl p-2.5 bg-white dark:bg-slate-900 border transition-all cursor-pointer
							{reqStageFilter === 'requested' ? 'border-amber-500 shadow-sm ring-1 ring-amber-500/30' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'}"
						onclick={() => { reqStageFilter = 'requested'; fetchRequests(); }}
					>
						<div class="flex items-center gap-1 mb-0.5">
							<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
							<p class="text-[10px] text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider">1. Menunggu ACC</p>
						</div>
						<div class="flex items-baseline justify-between">
							<strong class="text-base sm:text-lg font-bold text-amber-600 dark:text-amber-400">{kpiWaitingApproval}</strong>
							<span class="text-[10px] text-amber-500/80">item</span>
						</div>
					</button>

					<!-- 3. Disetujui / Siap Kirim -->
					<button
						type="button"
						class="text-left rounded-xl p-2.5 bg-white dark:bg-slate-900 border transition-all cursor-pointer
							{reqStageFilter === 'approved' ? 'border-emerald-500 shadow-sm ring-1 ring-emerald-500/30' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'}"
						onclick={() => { reqStageFilter = 'approved'; fetchRequests(); }}
					>
						<div class="flex items-center gap-1 mb-0.5">
							<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
							<p class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">2. Disetujui (ACC)</p>
						</div>
						<div class="flex items-baseline justify-between">
							<strong class="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400">{kpiApprovedReady}</strong>
							<span class="text-[10px] text-emerald-500/80">item</span>
						</div>
					</button>

					<!-- 3b. Menunggu Pengadaan (PL Tracking v2 Fase 4d) -->
					<div
						class="text-left rounded-xl p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
						title="Item yang stok gudangnya kosong dan sedang diproses pembelian (PR → PO → kirim supplier). Ketuk item di daftar untuk melihat detailnya."
					>
						<div class="flex items-center gap-1 mb-0.5">
							<span class="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
							<p class="text-[10px] text-orange-600 dark:text-orange-400 font-bold uppercase tracking-wider">3. Menunggu Pengadaan</p>
						</div>
						<div class="flex items-baseline justify-between">
							<strong class="text-base sm:text-lg font-bold text-orange-600 dark:text-orange-400">{kpiWaitingProcurement}</strong>
							<span class="text-[10px] text-orange-500/80">item</span>
						</div>
					</div>

					<!-- 4. Dalam Pengiriman -->
					<button
						type="button"
						class="text-left rounded-xl p-2.5 bg-white dark:bg-slate-900 border transition-all cursor-pointer
							{reqStageFilter === 'shipped' ? 'border-indigo-500 shadow-sm ring-1 ring-indigo-500/30' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'}"
						onclick={() => { reqStageFilter = 'shipped'; fetchRequests(); }}
					>
						<div class="flex items-center gap-1 mb-0.5">
							<span class="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
							<p class="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider">4. Pengiriman</p>
						</div>
						<div class="flex items-baseline justify-between">
							<strong class="text-base sm:text-lg font-bold text-indigo-600 dark:text-indigo-400">{kpiInTransit}</strong>
							<span class="text-[10px] text-indigo-500/80">item OTW</span>
						</div>
					</button>

					<!-- 5. Tiba di Proyek / Selesai -->
					<button
						type="button"
						class="text-left rounded-xl p-2.5 bg-white dark:bg-slate-900 border transition-all cursor-pointer
							{reqStageFilter === 'received' ? 'border-teal-500 shadow-sm ring-1 ring-teal-500/30' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'}"
						onclick={() => { reqStageFilter = 'received'; fetchRequests(); }}
					>
						<div class="flex items-center gap-1 mb-0.5">
							<span class="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
							<p class="text-[10px] text-teal-600 dark:text-teal-400 font-bold uppercase tracking-wider">5. Tiba / Selesai</p>
						</div>
						<div class="flex items-baseline justify-between">
							<strong class="text-base sm:text-lg font-bold text-teal-600 dark:text-teal-400">{kpiReceived}</strong>
							<span class="text-[10px] text-teal-500/80">item</span>
						</div>
					</button>
				</div>

				<!-- Search & Filter Controls -->
				<div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 mb-3 shadow-xs">
					<div class="flex flex-col sm:flex-row gap-2">
						<!-- Search Box -->
						<div class="flex-1 relative">
							<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
							<input
								type="text"
								bind:value={reqSearch}
								placeholder="Cari material, nomor PO, atau nama proyek..."
								class="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:border-[var(--g)] focus:bg-white transition-all text-slate-800 dark:text-slate-100"
								oninput={() => fetchRequests()}
							/>
							{#if reqSearch}
								<button
									type="button"
									class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
									onclick={() => { reqSearch = ''; fetchRequests(); }}
								>
									<IconX size={14} />
								</button>
							{/if}
						</div>

						<!-- Sort Options -->
						<div class="flex items-center gap-2 shrink-0">
							<select
								bind:value={reqSort}
								class="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:border-[var(--g)] text-slate-700 dark:text-slate-200 font-medium cursor-pointer"
								onchange={() => fetchRequests()}
							>
								<option value="-date_created">Pengajuan Terbaru</option>
								<option value="date_created">Pengajuan Terlama</option>
								<option value="progress_desc">Progres Tertinggi</option>
								<option value="progress_asc">Belum Selesai</option>
							</select>
						</div>
					</div>

					<!-- Quick Stage Chips / Filter Tabs -->
					<div class="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-slate-100 dark:border-slate-800/60 mt-2">
						<span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
							<IconFilter size={12} /> Tahap:
						</span>

						<button
							type="button"
							class="px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all cursor-pointer
								{reqStageFilter === 'semua' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'}"
							onclick={() => { reqStageFilter = 'semua'; fetchRequests(); }}
						>
							Semua Tahap
						</button>

						<button
							type="button"
							class="px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all cursor-pointer flex items-center gap-1
								{reqStageFilter === 'requested' ? 'bg-amber-500 text-white shadow-xs font-bold' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'}"
							onclick={() => { reqStageFilter = 'requested'; fetchRequests(); }}
						>
							🟡 Menunggu ACC ({kpiWaitingApproval})
						</button>

						<button
							type="button"
							class="px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all cursor-pointer flex items-center gap-1
								{reqStageFilter === 'approved' ? 'bg-emerald-600 text-white shadow-xs font-bold' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'}"
							onclick={() => { reqStageFilter = 'approved'; fetchRequests(); }}
						>
							🟢 Disetujui ({kpiApprovedReady})
						</button>

						<button
							type="button"
							class="px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all cursor-pointer flex items-center gap-1
								{reqStageFilter === 'shipped' ? 'bg-indigo-600 text-white shadow-xs font-bold' : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'}"
							onclick={() => { reqStageFilter = 'shipped'; fetchRequests(); }}
						>
							🚚 Dalam Pengiriman ({kpiInTransit})
						</button>

						<button
							type="button"
							class="px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all cursor-pointer flex items-center gap-1
								{reqStageFilter === 'received' ? 'bg-teal-600 text-white shadow-xs font-bold' : 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800'}"
							onclick={() => { reqStageFilter = 'received'; fetchRequests(); }}
						>
							✅ Selesai Diterima ({kpiReceived})
						</button>
					</div>
				</div>

				<!-- Request List by Project -->
				{#if requestProjectIds().length === 0}
					<div class="text-center py-16 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-8">
						<div class="w-14 h-14 rounded-2xl bg-[var(--gl)] flex items-center justify-center mx-auto mb-3 text-[var(--g)]">
							<IconPackage size={28} />
						</div>
						<p class="text-sm font-bold text-slate-800 dark:text-slate-100">Belum ada pengajuan packing list</p>
						<p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
							Ajukan material atau peralatan yang dibutuhkan ke proyek lewat tombol di bawah.
						</p>
						<button
							type="button"
							class="mt-4 px-5 py-2 rounded-xl text-xs font-bold text-white shadow-md inline-flex items-center gap-1.5 cursor-pointer border-none"
							style="background: var(--g)"
							onclick={() => openPackingModalForProject()}
						>
							<IconPlus size={16} /> Ajukan Packing List Baru
						</button>
					</div>
				{:else}
					<div class="space-y-2.5">
						{#each requestProjectIds() as pid}
							{@const items = requestsByProject()[pid] || []}
							{@const projectData = projectsMap[pid] || {}}
							{@const summary = getProjectStageSummary(items)}
							{@const isExpanded = expandedPengajuanProject === pid}

							<div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs transition-all {isExpanded ? 'ring-1 ring-[var(--g)]/30 border-[var(--g)]/40 shadow-sm' : 'hover:border-slate-300'}">
								
								<!-- Project Header Bar (Accordion Toggle) -->
								<button
									type="button"
									class="w-full p-3 sm:p-3.5 flex flex-col gap-2.5 text-left cursor-pointer transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
									onclick={() => togglePengajuanProject(pid)}
								>
									<!-- Row 1: Title, Tags & Stage Badge -->
									<div class="flex items-start justify-between gap-2.5">
										<div class="flex items-start gap-2.5 min-w-0">
											<div class="w-9 h-9 rounded-xl bg-[var(--gl)] flex items-center justify-center shrink-0 text-[var(--g)] mt-0.5">
												<IconBuilding size={18} />
											</div>
											<div class="min-w-0">
												<div class="flex items-center gap-2 flex-wrap">
													<h3 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
														{projectNames[pid] || `Proyek ID-${pid}`}
													</h3>
													{#if projectData.nomor_po}
														<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
															PO: {projectData.nomor_po}
														</span>
													{/if}
												</div>
												<div class="flex items-center gap-2 text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5 flex-wrap">
													{#if projectData.lokasi}
														<span class="flex items-center gap-0.5 truncate">
															<IconMapPin size={11} class="text-slate-400 shrink-0" />
															{projectData.lokasi}
														</span>
														<span>·</span>
													{/if}
													{#if projectData.leader}
														<span class="flex items-center gap-0.5 truncate">
															<IconUser size={11} class="text-slate-400 shrink-0" />
															{projectData.leader}
														</span>
														<span>·</span>
													{/if}
													<span class="font-semibold text-slate-700 dark:text-slate-300">
														{summary.totalItems} item ({summary.totalQtyRequired} unit)
													</span>
												</div>
											</div>
										</div>

										<div class="flex items-center gap-2 shrink-0">
											<!-- Active Stage Pill Badge -->
											<span class="px-2.5 py-1 rounded-full text-[10.5px] font-bold border flex items-center gap-1.5 {summary.badgeClass}">
												<span class="w-1.5 h-1.5 rounded-full {summary.dotClass}"></span>
												<span>{summary.shortLabel}</span>
											</span>

											<div class="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 transition-transform duration-200 {isExpanded ? 'rotate-180 text-[var(--g)]' : ''}">
												<IconChevronDown size={15} />
											</div>
										</div>
									</div>

									<!-- Row 2: 5-STAGE PIPELINE PROGRESS STEPPER -->
									<div class="pt-1.5 pb-0.5 border-t border-slate-100 dark:border-slate-800/80">
										<div class="flex items-center justify-between relative px-2 sm:px-4">
											<!-- Connecting background bar -->
											<div class="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-1 bg-slate-100 dark:bg-slate-800 rounded-full z-0"></div>
											<!-- Active filled bar -->
											<div
												class="absolute left-4 top-1/2 -translate-y-1/2 h-1 bg-gradient-to-r from-amber-400 via-emerald-400 to-[var(--g)] rounded-full z-0 transition-all duration-500"
												style="width: {summary.step === 1 ? '10%' : summary.step === 2 ? '30%' : summary.step === 3 ? '55%' : summary.step === 4 ? '80%' : 'calc(100% - 2rem)'}"
											></div>

											{#each PIPELINE_STEPS as pStep}
												{@const isPassed = summary.step > pStep.step}
												{@const isCurrent = summary.step === pStep.step}
												<div class="relative z-10 flex flex-col items-center group">
													<div class="w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all
														{isPassed ? 'bg-emerald-500 text-white shadow-xs ring-2 ring-emerald-100 dark:ring-emerald-950' : 
														 isCurrent ? 'bg-[var(--g)] text-white shadow-sm ring-3 ring-[var(--g)]/30 scale-110' : 
														 'bg-white dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'}">
														{#if isPassed}
															<IconCheck size={11} stroke={3} />
														{:else}
															{pStep.step}
														{/if}
													</div>
													<span class="text-[9px] sm:text-[10px] mt-1 font-semibold whitespace-nowrap
														{isCurrent ? 'text-[var(--gd)] dark:text-emerald-400 font-bold' : isPassed ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400'}">
														{pStep.label}
													</span>
												</div>
											{/each}
										</div>

										<!-- Mini Progres fulfillment text -->
										<div class="flex items-center justify-between text-[10px] text-slate-500 mt-2 px-1">
											<span class="font-medium">
												Progres Pemenuhan: <strong class="text-slate-700 dark:text-slate-200">{summary.totalQtyDelivered}</strong> / {summary.totalQtyRequired} unit
											</span>
											<span class="font-bold {summary.completionPct === 100 ? 'text-emerald-600' : 'text-slate-600 dark:text-slate-300'}">
												{summary.completionPct}% Terkirim
											</span>
										</div>
									</div>
								</button>

								<!-- Accordion Expanded Material Items -->
								{#if isExpanded}
									<div class="bg-slate-50/70 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 p-3 sm:p-4 animate-in slide-in-from-top-2 duration-200">
										
										<!-- Quick Actions Bar for this project -->
										<div class="flex items-center justify-between flex-wrap gap-2 mb-3 bg-white dark:bg-slate-800 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
											<div class="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
												<IconPackage size={15} class="text-[var(--g)]" />
												<span>Daftar Material ({items.length} item)</span>
											</div>

											<div class="flex items-center gap-1.5 flex-wrap">
												<button
													type="button"
													class="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-[var(--gl)] text-[var(--gd)] hover:bg-[var(--g)] hover:text-white transition-all flex items-center gap-1 cursor-pointer border-none"
													onclick={() => openPackingModalForProject(pid)}
												>
													<IconPlus size={13} />
													<span>+ Tambah Item</span>
												</button>

												<button
													type="button"
													class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 transition-all flex items-center gap-1 cursor-pointer"
													onclick={() => goto(`/packing-list/${pid}/pick`)}
												>
													<IconScan size={13} />
													<span>Picking Barcode</span>
												</button>

												<button
													type="button"
													class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition-all flex items-center gap-1 cursor-pointer border-none"
													onclick={() => switchToInventoryForProject(pid)}
												>
													<IconBox size={13} />
													<span>Inventory</span>
												</button>
											</div>
										</div>

										<!-- Items Table / Cards -->
										<div class="space-y-2">
											{#each items as item, idx}
												{@const itemStage = getItemStage(item)}
												{@const catMeta = getCategoryMeta(item.budget_category)}
												{@const colorVal = cleanColor(item.material_color)}
												{@const qtyReq = Number(item.qty) || 0}
												{@const qtyDel = Number(item.qty_sudah_dikirim) || 0}
												{@const qtyRem = Math.max(0, qtyReq - qtyDel)}
												{@const itemFulfillmentPct = qtyReq > 0 ? Math.min(100, Math.round((qtyDel / qtyReq) * 100)) : 0}

												<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 transition-all hover:shadow-xs">
													<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
														<!-- Left: Material Info -->
														<div class="flex items-start gap-2.5 min-w-0 flex-1">
															<div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 {catMeta.bgClass}">
																{#if catMeta.icon === 'paint'}<IconPaint size={16} />
																{:else if catMeta.icon === 'tools'}<IconTools size={16} />
																{:else if catMeta.icon === 'shield'}<IconShieldCheck size={16} />
																{:else}<IconBox size={16} />{/if}
															</div>

															<div class="min-w-0 flex-1">
																<div class="flex items-center gap-1.5 flex-wrap">
																	<p class="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
																		{item.material_name || item.description || 'Material'}
																	</p>
																	<span class="text-[9.5px] font-semibold px-1.5 py-0.5 rounded border {catMeta.bgClass}">
																		{catMeta.label}
																	</span>
																	{#if colorVal}
																		<span class="text-[9.5px] font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
																			<ColorChip color={colorVal} size="xs" />
																		</span>
																	{:else if isPaintItem(item.material_name || item.description)}
																		<span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300">
																			⚠️ Butuh Warna
																		</span>
																	{/if}
																</div>

																<!-- Description or notes -->
																{#if item.description && item.description !== item.material_name}
																	<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1 italic">
																		"{item.description}"
																	</p>
																{/if}

																<!-- Fase 3 (fix B7): badge "diganti gudang" + keberatan (soft, tidak menahan kiriman) -->
																{#if itemChangedTrail[item.id]}
																	{@const info = itemChangedTrail[item.id]}
																	<div class="mt-1 flex items-center gap-1.5 flex-wrap text-[10px]">
																		<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 font-semibold">
																			🔄 Diganti gudang: {info.before?.material_name} → {info.after?.material_name} ({reasonCodeLabel(info.reason_code)})
																		</span>
																		{#if objectionSentFor.has(item.id)}
																			<span class="text-emerald-600 dark:text-emerald-400 font-medium">Keberatan terkirim ✓</span>
																		{:else if objectionForItem !== item.id}
																			<button
																				type="button"
																				onclick={() => openObjection(item.id)}
																				class="text-slate-500 dark:text-slate-400 hover:underline font-medium"
																			>
																				Ajukan Keberatan
																			</button>
																		{/if}
																	</div>
																	{#if objectionForItem === item.id}
																		<div class="mt-1 p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 space-y-1.5">
																			<textarea
																				bind:value={objectionNote}
																				rows="2"
																				placeholder="Kenapa keberatan? cth: barang pengganti tidak cocok untuk pekerjaan ini"
																				class="w-full text-[11px] border border-gray-300 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-800"
																			></textarea>
																			{#if objectionError}<p class="text-[10px] text-rose-600">{objectionError}</p>{/if}
																			<div class="flex gap-1.5">
																				<button
																					type="button"
																					disabled={objectionSaving}
																					onclick={() => sendObjection(item)}
																					class="px-2 py-1 text-[10px] font-bold rounded bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-60"
																				>
																					{objectionSaving ? 'Mengirim…' : 'Kirim Keberatan'}
																				</button>
																				<button type="button" disabled={objectionSaving} onclick={cancelObjection} class="px-2 py-1 text-[10px] rounded bg-gray-100 hover:bg-gray-200 text-gray-600">
																					Batal
																				</button>
																			</div>
																			<p class="text-[9.5px] text-slate-400">Keberatan ini TIDAK menghentikan pengiriman — hanya catatan untuk admin.</p>
																		</div>
																	{/if}
																{/if}

																<!-- PIC & Timestamp -->
																<div class="flex items-center gap-2 text-[10px] text-slate-400 mt-1 flex-wrap">
																	{#if item.pic}
																		<span class="flex items-center gap-0.5">
																			<IconUser size={10} /> {item.pic}
																		</span>
																		<span>·</span>
																	{/if}
																	{#if item.requested_at || item.date_created}
																		<span class="flex items-center gap-0.5">
																			<IconCalendar size={10} /> {formatDateTime(item.requested_at || item.date_created)}
																		</span>
																	{/if}
																</div>
															</div>
														</div>

														<!-- Right: Qty Fulfillment & Stage Pill -->
														<div class="flex flex-row sm:flex-col sm:items-end justify-between items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-700/60">
															<!-- Qty Breakdown -->
															<div class="text-left sm:text-right">
																<div class="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
																	<span>{qtyReq} {item.unit || ''}</span>
																</div>
																<div class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
																	<span>Terkirim: <strong class="text-indigo-600 dark:text-indigo-400">{qtyDel}</strong></span>
																	{#if qtyRem > 0}
																		<span class="text-amber-600 dark:text-amber-400 font-medium"> · Sisa {qtyRem}</span>
																	{/if}
																</div>
															</div>

															<!-- Item Stage Badge -->
															<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 {itemStage.badgeClass}">
																<span class="w-1.5 h-1.5 rounded-full {itemStage.dotClass}"></span>
																<span>{itemStage.label}</span>
															</span>
														</div>
													</div>

													<!-- Progress bar if partial / shipped -->
													{#if qtyDel > 0}
														<div class="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/50">
															<div class="flex justify-between text-[9.5px] text-slate-500 mb-1">
																<span>Pengiriman fisik barang</span>
																<span class="font-bold text-indigo-600 dark:text-indigo-400">{itemFulfillmentPct}%</span>
															</div>
															<div class="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
																<div
																	class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-300"
																	style="width: {itemFulfillmentPct}%"
																></div>
															</div>
														</div>
													{/if}

													<!-- PL Tracking v2 Fase 4d — buka timeline pelacakan -->
													<button
														type="button"
														class="mt-2 w-full flex items-center justify-center gap-1 text-[10.5px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg py-1.5 hover:bg-indigo-100 dark:hover:bg-indigo-950/60 transition-colors"
														onclick={() => (timelineItem = item)}
													>
														<IconEye size={12} /> Lihat pelacakan
													</button>
												</div>
											{/each}
										</div>

									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<InfiniteScroll hasMore={reqHasMore} loading={reqLoadingMore} onloadmore={() => fetchRequests(true)} />

				<!-- PL Tracking v2 Fase 4d — panel geser timeline pelacakan -->
				{#if timelineItem}
					<div class="fixed inset-0 z-50 flex justify-end">
						<button
							type="button"
							aria-label="Tutup panel pelacakan"
							class="absolute inset-0 bg-slate-900/40"
							onclick={() => (timelineItem = null)}
						></button>
						<div class="relative w-full max-w-sm h-full bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto p-4 border-l border-slate-200 dark:border-slate-800">
							<div class="flex items-center justify-between mb-3">
								<h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">Status Pelacakan</h3>
								<button
									type="button"
									class="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
									onclick={() => (timelineItem = null)}
								>
									<IconX size={16} />
								</button>
							</div>
							<TrackingTimeline
								budgetId={timelineItem.id}
								itemName={timelineItem.material_name || timelineItem.description || ''}
							/>
						</div>
					</div>
				{/if}

				<!-- Bottom Action -->
				<div class="mt-4 text-center">
					<button
						type="button"
						class="w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-xs text-white shadow-md inline-flex items-center justify-center gap-2 cursor-pointer transition-all hover:opacity-95 border-none"
						style="background: var(--g)"
						onclick={() => openPackingModalForProject()}
					>
						<IconPlus size={16} /> Ajukan Packing List Baru
					</button>
				</div>
				<div class="h-6"></div>

			<!-- ========================================================= -->
			<!-- TAB 2: INVENTORY PROYEK (MATERIAL TERKIRIM DI LOKASI)     -->
			<!-- ========================================================= -->
			{:else if activeTab === 'inventory'}
				<!-- Inventory Summary Stats -->
				<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
					<div class="bg-white dark:bg-slate-900 rounded-xl p-2.5 border border-slate-200 dark:border-slate-800">
						<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Total Material</p>
						<strong class="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100">{invTotalMaterials} item</strong>
					</div>
					<div class="bg-white dark:bg-slate-900 rounded-xl p-2.5 border border-slate-200 dark:border-slate-800">
						<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Total Terkirim</p>
						<strong class="text-base sm:text-lg font-bold text-blue-600 dark:text-blue-400">{invTotalSentQty} unit</strong>
					</div>
					<div class="bg-white dark:bg-slate-900 rounded-xl p-2.5 border border-slate-200 dark:border-slate-800">
						<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Terpakai</p>
						<strong class="text-base sm:text-lg font-bold text-amber-600 dark:text-amber-400">{invTotalUsedQty} unit</strong>
					</div>
					<div class="bg-white dark:bg-slate-900 rounded-xl p-2.5 border border-slate-200 dark:border-slate-800">
						<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Sisa di Proyek</p>
						<strong class="text-base sm:text-lg font-bold text-[var(--gd)] dark:text-emerald-400">{invTotalRemainingQty} unit</strong>
					</div>
				</div>

				<!-- Search Inventory -->
				<div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-2 mb-3">
					<div class="relative">
						<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
						<input
							type="text"
							bind:value={invSearch}
							placeholder="Cari material atau nomor Surat Jalan (SJ)..."
							class="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:border-[var(--g)] text-slate-800 dark:text-slate-100"
							oninput={() => fetchInventoryFixed()}
						/>
					</div>
				</div>

				<!-- Inventory List by Project -->
				{#if inventoryProjectIds.length === 0}
					<div class="text-center py-16 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-8">
						<div class="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center mx-auto mb-3 text-blue-600">
							<IconBox size={28} />
						</div>
						<p class="text-sm font-bold text-slate-800 dark:text-slate-100">Belum ada material tercatat di inventory proyek</p>
						<p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
							Material akan otomatis masuk ke sini setelah Surat Jalan (SJ) diterbitkan dan dikonfirmasi diterima di lokasi.
						</p>
					</div>
				{:else}
					<div class="space-y-2.5">
						{#each inventoryProjectIds as pid}
							{@const items = inventoryByProject[pid] || []}
							{@const totalItems = items.length}
							{@const totalQtyProject = items.reduce((a, i) => a + (Number(i.qty) || 0), 0)}
							{@const totalUsedProject = items.reduce((a, i) => a + (Number(i.qty_used) || 0), 0)}
							{@const isExpanded = expandedProject === pid}

							<div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs {isExpanded ? 'border-[var(--g)]/40 ring-1 ring-[var(--g)]/30' : 'hover:border-slate-300'}">
								<!-- Accordion Header -->
								<button
									type="button"
									class="w-full p-3 flex items-center justify-between text-left cursor-pointer transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
									onclick={() => toggleProject(pid)}
								>
									<div class="flex items-center gap-2.5 min-w-0">
										<div class="w-8 h-8 rounded-lg bg-[var(--gl)] flex items-center justify-center shrink-0 text-[var(--g)]">
											<IconBox size={18} />
										</div>
										<div class="min-w-0">
											<p class="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
												{projectNames[pid] || `Proyek ID-${pid}`}
											</p>
											<p class="text-[10px] text-slate-400 mt-0.5">
												{totalItems} material tercatat · {totalUsedProject}/{totalQtyProject} unit terpakai
											</p>
										</div>
									</div>

									<div class="flex items-center gap-2 shrink-0">
										<span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200">
											{totalItems} Material
										</span>
										<div class="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 {isExpanded ? 'rotate-180 text-[var(--g)]' : ''}">
											<IconChevronDown size={15} />
										</div>
									</div>
								</button>

								<!-- Content -->
								{#if isExpanded}
									<div class="bg-slate-50/70 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 p-3 space-y-2">
										{#each items as inv}
											{@const usagePct = getUsagePercent(inv)}
											{@const rem = inv.qty_remaining ?? ((inv.qty || 0) - (inv.qty_used || 0))}

											<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
												<div class="flex items-start justify-between gap-2 mb-2">
													<div class="flex items-start gap-2 min-w-0">
														<div class="w-7 h-7 rounded-lg bg-[var(--gl)] flex items-center justify-center shrink-0 text-[var(--g)] mt-0.5">
															<IconPackage size={15} />
														</div>
														<div class="min-w-0">
															<p class="text-xs font-bold text-slate-800 dark:text-slate-100 leading-snug">
																{inv.material_name || '-'}
															</p>
															{#if cleanColor(inv.material_color)}
																<p class="text-[10px] text-slate-400"><ColorChip color={cleanColor(inv.material_color)} size="xs" /></p>
															{:else if isPaintItem(inv.material_name)}
																<p class="text-[10px] text-amber-600 font-semibold">⚠️ Butuh Warna</p>
															{/if}
															{#if inv.reference_number}
																<div class="flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">
																	<IconFileText size={12} /> SJ: {inv.reference_number}
																</div>
															{/if}
														</div>
													</div>

													<!-- Stock Health Tag -->
													<span class="px-2 py-0.5 rounded text-[9.5px] font-bold border shrink-0
														{rem <= 0 ? 'bg-rose-50 text-rose-700 border-rose-200' :
														 rem / (inv.qty || 1) <= 0.2 ? 'bg-amber-50 text-amber-700 border-amber-200' :
														 'bg-emerald-50 text-emerald-700 border-emerald-200'}">
														{rem <= 0 ? 'Habis' : rem / (inv.qty || 1) <= 0.2 ? 'Menipis' : 'Stok Cukup'}
													</span>
												</div>

												<!-- Qty Grid -->
												<div class="grid grid-cols-3 gap-1.5 text-center mb-2">
													<div class="bg-slate-50 dark:bg-slate-750 rounded-lg p-1.5 border border-slate-100 dark:border-slate-700">
														<p class="text-[9px] text-slate-400 mb-0.5">Dikirim</p>
														<p class="text-xs font-bold text-slate-800 dark:text-slate-100">{inv.qty || 0} {inv.unit || ''}</p>
													</div>
													<div class="bg-slate-50 dark:bg-slate-750 rounded-lg p-1.5 border border-slate-100 dark:border-slate-700">
														<p class="text-[9px] text-slate-400 mb-0.5">Terpakai</p>
														<p class="text-xs font-bold text-amber-600 dark:text-amber-400">{inv.qty_used || 0} {inv.unit || ''}</p>
													</div>
													<div class="bg-slate-50 dark:bg-slate-750 rounded-lg p-1.5 border border-slate-100 dark:border-slate-700">
														<p class="text-[9px] text-slate-400 mb-0.5">Sisa Stok</p>
														<p class="text-xs font-bold text-[var(--gd)] dark:text-emerald-400">{rem} {inv.unit || ''}</p>
													</div>
												</div>

												<!-- Progress Bar -->
												<div class="mb-2">
													<div class="flex justify-between text-[9.5px] mb-1">
														<span class="text-slate-400">Tingkat Pemakaian</span>
														<span class="font-bold text-slate-700 dark:text-slate-300">{usagePct}%</span>
													</div>
													<div class="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
														<div
															class="h-full rounded-full transition-all duration-300 {usagePct >= 90 ? 'bg-rose-500' : usagePct >= 50 ? 'bg-amber-500' : 'bg-[var(--g)]'}"
															style="width: {usagePct}%"
														></div>
													</div>
												</div>

												<!-- Edit Usage -->
												{#if editingItem === inv.id}
													<div class="flex items-center gap-2 mt-2 bg-slate-50 dark:bg-slate-750 rounded-xl p-2.5 border border-[var(--g)]/30">
														<div class="flex-1">
															<label class="text-[10px] text-slate-500 font-semibold block mb-0.5">Input Qty Terpakai ({inv.unit || 'unit'})</label>
															<input
																type="number"
																class="w-full px-2.5 py-1 text-xs font-bold border border-slate-300 dark:border-slate-600 rounded-lg outline-none focus:border-[var(--g)] bg-white dark:bg-slate-800"
																bind:value={editQtyUsed}
																min="0"
																max={inv.qty || 999}
															/>
														</div>
														<div class="flex gap-1 pt-3.5">
															<button
																type="button"
																class="w-8 h-8 rounded-lg bg-[var(--g)] text-white flex items-center justify-center cursor-pointer border-none disabled:opacity-50"
																onclick={() => saveUsage(inv)}
																disabled={savingUsage}
															>
																{#if savingUsage}<IconLoader2 size={15} class="animate-spin" />{:else}<IconCheck size={15} />{/if}
															</button>
															<button
																type="button"
																class="w-8 h-8 rounded-lg bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer border-none"
																onclick={cancelEditUsage}
															>✕</button>
														</div>
													</div>
												{:else}
													<button
														type="button"
														class="w-full mt-1 py-1.5 border border-dashed border-[var(--g)] rounded-lg bg-[var(--gl)] text-[var(--gd)] text-[11px] cursor-pointer flex items-center justify-center gap-1 font-bold hover:shadow-xs"
														onclick={() => startEditUsage(inv)}
													>
														<IconEdit size={13} /> Update Pemakaian Material
													</button>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<InfiniteScroll hasMore={invHasMore} loading={invLoadingMore} onloadmore={() => fetchInventoryFixed(true)} />
				<div class="h-6"></div>

			<!-- ========================================================= -->
			<!-- TAB 3: PENGEMBALIAN (RETURN PACKING LIST)                 -->
			<!-- ========================================================= -->
			{:else}
				<!-- Fase 3, Rencana v2 "Lifecycle Pengembalian Barang" (§5.2) — Saldo Barang Saya,
				     di atas KPI/riwayat dokumen retur yang sudah ada. -->
				<SaldoBarangSayaPanel />

				<!-- Return KPI Stats -->
				<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
					<div class="bg-white dark:bg-slate-900 rounded-xl p-2.5 border border-slate-200 dark:border-slate-800">
						<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Total Pengembalian</p>
						<strong class="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100">{retTotalCount} item</strong>
					</div>
					<div class="bg-white dark:bg-slate-900 rounded-xl p-2.5 border border-slate-200 dark:border-slate-800">
						<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Menunggu Cek Gudang</p>
						<strong class="text-base sm:text-lg font-bold text-amber-600 dark:text-amber-400">{retPendingCount} item</strong>
					</div>
					<div class="col-span-2 sm:col-span-1 bg-white dark:bg-slate-900 rounded-xl p-2.5 border border-slate-200 dark:border-slate-800">
						<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Sudah Diverifikasi</p>
						<strong class="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400">{retCheckedCount} item</strong>
					</div>
				</div>

				<!-- Search Return -->
				<div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-2 mb-3">
					<div class="relative">
						<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
						<input
							type="text"
							bind:value={retSearch}
							placeholder="Cari barang yang dikembalikan atau catatan..."
							class="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:border-[var(--g)] text-slate-800 dark:text-slate-100"
							oninput={() => fetchReturns()}
						/>
					</div>
				</div>

				<!-- Return List by Project -->
				{#if returnProjectIds.length === 0}
					<div class="text-center py-16 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-8">
						<div class="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center mx-auto mb-3 text-amber-600">
							<IconCornerUpLeft size={28} />
						</div>
						<p class="text-sm font-bold text-slate-800 dark:text-slate-100">Belum ada pengajuan pengembalian barang</p>
						<p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
							Barang sisa proyek atau peralatan sewa yang telah selesai digunakan dapat didaftarkan kembali ke gudang pusat.
						</p>
						<button
							type="button"
							class="mt-4 px-5 py-2 rounded-xl text-xs font-bold text-white shadow-md inline-flex items-center gap-1.5 cursor-pointer border-none"
							style="background: var(--g)"
							onclick={() => goto('/packing-list/return')}
						>
							<IconPlus size={16} /> Ajukan Return Packing List
						</button>
					</div>
				{:else}
					<div class="space-y-2.5">
						{#each returnProjectIds as pid}
							{@const items = returnsByProject()[pid] || []}
							{@const checkedCount = items.filter((i: any) => i.return_status === 'return_checked').length}
							{@const isExpanded = expandedReturnProject === pid}

							<div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs {isExpanded ? 'border-[var(--g)]/40 ring-1 ring-[var(--g)]/30' : 'hover:border-slate-300'}">
								<!-- Accordion Header -->
								<button
									type="button"
									class="w-full p-3 flex items-center justify-between text-left cursor-pointer transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
									onclick={() => toggleReturnProject(pid)}
								>
									<div class="flex items-center gap-2.5 min-w-0">
										<div class="w-8 h-8 rounded-lg bg-[var(--gl)] flex items-center justify-center shrink-0 text-[var(--g)]">
											<IconCornerUpLeft size={18} />
										</div>
										<div class="min-w-0">
											<p class="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
												{projectNames[pid] || `Proyek ID-${pid}`}
											</p>
											<p class="text-[10px] text-slate-400 mt-0.5">
												{items.length} item dikembalikan · {checkedCount} sudah diverifikasi gudang
											</p>
										</div>
									</div>

									<div class="flex items-center gap-2 shrink-0">
										<span class="text-[10px] px-2 py-0.5 rounded-full font-bold {checkedCount === items.length ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
											{checkedCount === items.length ? 'Selesai Dicek' : 'Dalam Proses Cek'}
										</span>
										<div class="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 {isExpanded ? 'rotate-180 text-[var(--g)]' : ''}">
											<IconChevronDown size={15} />
										</div>
									</div>
								</button>

								<!-- Accordion Content -->
								{#if isExpanded}
									<div class="bg-slate-50/70 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 p-3 space-y-2">
										{#each items as item}
											{@const cond = (item.condition || 'ok').toLowerCase()}
											<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
												<div class="flex items-start justify-between gap-2">
													<div class="min-w-0 flex-1">
														<p class="text-xs font-bold text-slate-800 dark:text-slate-100">
															{item.material_name || '-'}
														</p>
														{#if cleanColor(item.material_color)}
															<p class="text-[10px] text-slate-400"><ColorChip color={cleanColor(item.material_color)} size="xs" /></p>
														{/if}
														{#if item.leader_notes}
															<p class="text-[11px] text-slate-500 italic mt-1">"{item.leader_notes}"</p>
														{/if}
													</div>

													<div class="text-right shrink-0">
														<p class="text-xs font-bold text-slate-800 dark:text-slate-100">{item.qty_returned} {item.unit}</p>
														<span class="mt-1 inline-block px-2 py-0.5 rounded text-[9.5px] font-bold border
															{item.return_status === 'return_checked' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}">
															{item.return_status === 'return_checked' ? 'Sudah Dicek' : 'Menunggu Cek'}
														</span>
													</div>
												</div>

												<!-- Condition tag -->
												<div class="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between text-[10px] text-slate-500">
													<span class="flex items-center gap-1">
														Kondisi: 
														<strong class="{cond === 'ok' ? 'text-emerald-600' : cond.includes('rusak') ? 'text-rose-600' : 'text-amber-600'}">
															{cond === 'ok' ? 'Baik / Layak' : cond === 'minor_damage' ? 'Bekas Layak' : cond === 'major_damage' || cond === 'rusak' ? 'Rusak' : 'Hilang'}
														</strong>
													</span>
													{#if item.checked_by}
														<span>Dicek oleh: <strong>{item.checked_by}</strong></span>
													{/if}
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<InfiniteScroll hasMore={retHasMore} loading={retLoadingMore} onloadmore={() => fetchReturns(true)} />

				<div class="mt-4 text-center">
					<button
						type="button"
						class="w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-xs text-white shadow-md inline-flex items-center justify-center gap-2 cursor-pointer transition-all hover:opacity-95 border-none"
						style="background: var(--g)"
						onclick={() => goto('/packing-list/return')}
					>
						<IconPlus size={16} /> Ajukan Return Packing List
					</button>
				</div>
				<div class="h-6"></div>
			{/if}
		</div>
	{/if}
</div>

<!-- Modal Pembuatan Packing Request -->
<PackingRequestModal
	bind:open={showPackingModal}
	initialProjectId={modalProjectId}
	onsuccess={async () => {
		fetchRequests();
	}}
/>
