<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getMyTickets, type MaintTicketRow } from '$lib/services/maintenance';
	import { getOperatorEquipment, getEquipmentByCode } from '$lib/services/preventive';
	import {
		IconClipboardList,
		IconPlus,
		IconLoader2,
		IconAlertTriangle,
		IconCheck,
		IconCircleCheck,
		IconClock,
		IconTool,
		IconSearch,
		IconX,
		IconQrcode,
		IconChevronRight,
		IconEye,
		IconCopy,
		IconPhoto,
		IconRefresh,
		IconFilter,
		IconExternalLink,
		IconInfoCircle
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let refreshing = $state(false);
	let errorMsg = $state('');
	let tickets = $state<MaintTicketRow[]>([]);
	let equipmentMap = $state<Record<string, any>>({});

	// Filter & Search states
	let searchQuery = $state('');
	let statusFilter = $state<'all' | 'need_survey' | 'in_progress' | 'closed'>('all');
	let priorityFilter = $state<'all' | 'high' | 'medium' | 'low'>('all');
	let sortBy = $state<'newest' | 'oldest' | 'priority'>('newest');

	// Interaction modals
	let selectedTicket = $state<MaintTicketRow | null>(null);
	let previewImageUrl = $state<string | null>(null);
	let copiedTicket = $state<string | null>(null);

	// QR Scanner
	let showScanner = $state(false);
	let scanError = $state('');
	let QrScannerModal = $state<any>(null);

	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_maintenance', roles)) {
			goto('/');
		}
	});

	async function fetchData(isRefresh = false) {
		if (isRefresh) refreshing = true;
		else loading = true;
		errorMsg = '';
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama operator tidak ditemukan di sesi login.');
			
			const fetchedTickets = await getMyTickets(karyawanName);
			tickets = fetchedTickets;

			const equipmentIds = [...new Set(tickets.map((t) => t.equipment_id).filter(Boolean))];
			const allEquipment = await getOperatorEquipment();
			const eqMap: Record<string, any> = {};
			for (const eq of allEquipment as any[]) {
				if (equipmentIds.includes(eq.id) || !equipmentIds.length) {
					eqMap[eq.id] = eq;
				}
			}
			equipmentMap = eqMap;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat daftar tiket kerusakan.';
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	onMount(() => {
		fetchData();
	});

	async function onEquipmentScanDetect(value: string) {
		showScanner = false;
		const code = value.replace(/^EPI:EQUIPMENT:/, '');
		const eq = await getEquipmentByCode(code);
		if (eq) {
			goto(`/maintenance/survey/baru?equipment_id=${eq.id}`);
		} else {
			scanError = `Unit dengan kode "${code}" tidak ditemukan.`;
		}
	}

	function copyToClipboard(text: string) {
		navigator.clipboard?.writeText(text);
		copiedTicket = text;
		setTimeout(() => {
			if (copiedTicket === text) copiedTicket = null;
		}, 2000);
	}

	function formatDateIndo(dateStr?: string | null): string {
		if (!dateStr) return '-';
		try {
			const d = new Date(dateStr);
			if (isNaN(d.getTime())) return dateStr;
			return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
		} catch {
			return dateStr;
		}
	}

	function formatDateTimeIndo(isoStr?: string | null, dateFallback?: string | null): string {
		const target = isoStr || dateFallback;
		if (!target) return '-';
		try {
			const d = new Date(target);
			if (isNaN(d.getTime())) return target;
			return d.toLocaleString('id-ID', {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return target;
		}
	}

	function getStatusMeta(status: string, woCreated?: boolean | null) {
		if (status === 'closed' || status === 'completed') {
			return {
				label: 'Selesai',
				color: '#16A34A',
				bg: '#DCFCE7',
				border: '#86EFAC',
				step: 4,
				desc: 'Perbaikan selesai dan diverifikasi.'
			};
		}
		if (status === 'in_progress' || woCreated) {
			return {
				label: 'WO Berjalan',
				color: '#2563EB',
				bg: '#DBEAFE',
				border: '#93C5FD',
				step: 3,
				desc: 'Work Order aktif & ditangani tim mekanik.'
			};
		}
		if (status === 'surveyed') {
			return {
				label: 'Survey Selesai',
				color: '#7C3AED',
				bg: '#EDE9FE',
				border: '#C4B5FD',
				step: 2,
				desc: 'Survey awal selesai, menunggu penerbitan WO.'
			};
		}
		return {
			label: 'Menunggu Survey',
			color: '#D97706',
			bg: '#FEF3C7',
			border: '#FCD34D',
			step: 1,
			desc: 'Laporan tercatat, menunggu survey oleh teknisi/SPV.'
		};
	}

	function getPriorityMeta(priority?: string) {
		const p = (priority || 'medium').toLowerCase();
		if (p === 'high' || p === 'berat' || p === 'darurat') {
			return { label: 'Tinggi', color: '#DC2626', bg: '#FEE2E2', border: '#FCA5A5' };
		}
		if (p === 'low' || p === 'ringan') {
			return { label: 'Ringan', color: '#16A34A', bg: '#DCFCE7', border: '#86EFAC' };
		}
		return { label: 'Sedang', color: '#D97706', bg: '#FEF3C7', border: '#FCD34D' };
	}

	// KPI Counts
	let countTotal = $derived(tickets.length);
	let countMenunggu = $derived(tickets.filter((t) => t.status === 'need_survey' && !t.wo_created).length);
	let countWoBerjalan = $derived(tickets.filter((t) => t.status === 'in_progress' || t.wo_created).length);
	let countSelesai = $derived(tickets.filter((t) => t.status === 'closed' || t.status === 'completed').length);
	let countHighPriority = $derived(tickets.filter((t) => (t.prioritas || '').toLowerCase() === 'high').length);

	// Filtered & Sorted Tickets
	let filteredTickets = $derived.by(() => {
		let list = [...tickets];

		// Status filter
		if (statusFilter === 'need_survey') {
			list = list.filter((t) => t.status === 'need_survey' && !t.wo_created);
		} else if (statusFilter === 'in_progress') {
			list = list.filter((t) => t.status === 'in_progress' || t.wo_created);
		} else if (statusFilter === 'closed') {
			list = list.filter((t) => t.status === 'closed' || t.status === 'completed');
		}

		// Priority filter
		if (priorityFilter !== 'all') {
			list = list.filter((t) => (t.prioritas || '').toLowerCase() === priorityFilter);
		}

		// Search query
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			list = list.filter((t) => {
				const eq = equipmentMap[t.equipment_id];
				const matchNo = (t.nomor_tiket || '').toLowerCase().includes(q);
				const matchEqName = (eq?.name || '').toLowerCase().includes(q);
				const matchEqCode = (eq?.code || '').toLowerCase().includes(q);
				const matchMasalah = (t.masalah || '').toLowerCase().includes(q);
				return matchNo || matchEqName || matchEqCode || matchMasalah;
			});
		}

		// Sort
		list.sort((a, b) => {
			if (sortBy === 'priority') {
				const weight = (p?: string) => (p === 'high' ? 3 : p === 'medium' ? 2 : 1);
				return weight(b.prioritas) - weight(a.prioritas);
			}
			const dateA = new Date(a.tanggal_lapor || 0).getTime();
			const dateB = new Date(b.tanggal_lapor || 0).getTime();
			return sortBy === 'oldest' ? dateA - dateB : dateB - dateA;
		});

		return list;
	});

	function resetFilters() {
		searchQuery = '';
		statusFilter = 'all';
		priorityFilter = 'all';
		sortBy = 'newest';
	}
</script>

<div class="max-w-6xl mx-auto p-4 md:p-6 pb-28">
	<!-- Page Header -->
	<div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
		<div>
			<div class="flex items-center gap-2 mb-1">
				<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
					Modul Lapangan
				</span>
				<span class="text-xs text-slate-400">•</span>
				<span class="text-xs font-medium text-slate-500 dark:text-slate-400">Kerusakan & Diagnosa</span>
			</div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight" style="color: var(--sys-label)">
				Survey & Tiket Saya
			</h1>
			<p class="text-xs md:text-sm mt-1 text-slate-500 dark:text-slate-400">
				Pantau progres laporan kerusakan alat, survey awal lapangan, hingga penerbitan Work Order
			</p>
		</div>

		<!-- Action Buttons -->
		<div class="flex items-center gap-2.5 flex-wrap">
			<button
				type="button"
				class="h-10 px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 shadow-sm"
				style="border-color: var(--sys-sep); color: var(--sys-label)"
				onclick={() => fetchData(true)}
				disabled={refreshing || loading}
				title="Muat ulang data"
			>
				<IconRefresh size={16} class={refreshing ? 'animate-spin' : ''} />
				<span class="hidden sm:inline">Segarkan</span>
			</button>

			<button
				type="button"
				class="h-10 px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-95 shadow-sm border-emerald-300 text-emerald-700 dark:text-emerald-300"
				onclick={async () => {
					scanError = '';
					await loadQrScannerModal();
					showScanner = true;
				}}
			>
				<IconQrcode size={16} />
				<span>Scan QR Unit</span>
			</button>

			<button
				type="button"
				class="h-10 px-4 rounded-xl text-xs font-bold text-white flex items-center gap-2 transition-all active:scale-95 shadow-md hover:opacity-95"
				style="background: linear-gradient(135deg, #1F6592 0%, #163F5A 100%)"
				onclick={() => goto('/maintenance/survey/baru')}
			>
				<IconPlus size={17} />
				<span>Lapor Kerusakan Baru</span>
			</button>
		</div>
	</div>

	<!-- Scan error message if any -->
	{#if scanError}
		<div class="mb-5 p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900">
			<div class="flex items-center gap-2">
				<IconAlertTriangle size={16} />
				<span>{scanError}</span>
			</div>
			<button class="text-red-600 hover:text-red-800" onclick={() => (scanError = '')}>
				<IconX size={15} />
			</button>
		</div>
	{/if}

	<!-- KPI Summary Cards Grid -->
	<div class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6">
		<!-- Total Tiket -->
		<button
			type="button"
			class="p-4 rounded-2xl border text-left transition-all hover:shadow-md cursor-pointer relative overflow-hidden"
			style="background: var(--sys-bg-secondary, #ffffff); border-color: {statusFilter === 'all' ? 'var(--g)' : 'var(--sys-sep)'}"
			onclick={() => (statusFilter = 'all')}
		>
			<div class="flex items-center justify-between mb-2">
				<span class="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Total Tiket</span>
				<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
					<IconClipboardList size={17} />
				</div>
			</div>
			<p class="text-2xl md:text-3xl font-black tracking-tight" style="color: var(--sys-label)">
				{countTotal}
			</p>
			<p class="text-[11px] font-medium text-slate-400 mt-0.5">Semua riwayat laporan</p>
		</button>

		<!-- Menunggu Survey -->
		<button
			type="button"
			class="p-4 rounded-2xl border text-left transition-all hover:shadow-md cursor-pointer relative overflow-hidden"
			style="background: var(--sys-bg-secondary, #ffffff); border-color: {statusFilter === 'need_survey' ? '#D97706' : 'var(--sys-sep)'}"
			onclick={() => (statusFilter = 'need_survey')}
		>
			<div class="flex items-center justify-between mb-2">
				<span class="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Menunggu Survey</span>
				<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
					<IconClock size={17} />
				</div>
			</div>
			<p class="text-2xl md:text-3xl font-black tracking-tight text-amber-600 dark:text-amber-400">
				{countMenunggu}
			</p>
			<p class="text-[11px] font-medium text-slate-400 mt-0.5">Antrian review & diagnosa</p>
		</button>

		<!-- WO Berjalan -->
		<button
			type="button"
			class="p-4 rounded-2xl border text-left transition-all hover:shadow-md cursor-pointer relative overflow-hidden"
			style="background: var(--sys-bg-secondary, #ffffff); border-color: {statusFilter === 'in_progress' ? '#2563EB' : 'var(--sys-sep)'}"
			onclick={() => (statusFilter = 'in_progress')}
		>
			<div class="flex items-center justify-between mb-2">
				<span class="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">WO Berjalan</span>
				<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
					<IconTool size={17} />
				</div>
			</div>
			<p class="text-2xl md:text-3xl font-black tracking-tight text-blue-600 dark:text-blue-400">
				{countWoBerjalan}
			</p>
			<p class="text-[11px] font-medium text-slate-400 mt-0.5">Ditangani tim teknisi</p>
		</button>

		<!-- Selesai -->
		<button
			type="button"
			class="p-4 rounded-2xl border text-left transition-all hover:shadow-md cursor-pointer relative overflow-hidden"
			style="background: var(--sys-bg-secondary, #ffffff); border-color: {statusFilter === 'closed' ? '#16A34A' : 'var(--sys-sep)'}"
			onclick={() => (statusFilter = 'closed')}
		>
			<div class="flex items-center justify-between mb-2">
				<span class="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Selesai</span>
				<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">
					<IconCheck size={17} />
				</div>
			</div>
			<p class="text-2xl md:text-3xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
				{countSelesai}
			</p>
			<p class="text-[11px] font-medium text-slate-400 mt-0.5">Perbaikan tuntas</p>
		</button>

		<!-- Prioritas Tinggi Alert -->
		<div
			class="p-4 rounded-2xl border text-left col-span-2 sm:col-span-2 md:col-span-4 lg:col-span-1 relative overflow-hidden"
			style="background: var(--sys-bg-secondary, #ffffff); border-color: {countHighPriority > 0 ? '#FCA5A5' : 'var(--sys-sep)'}"
		>
			<div class="flex items-center justify-between mb-2">
				<span class="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Urgensi Tinggi</span>
				<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300">
					<IconAlertTriangle size={17} />
				</div>
			</div>
			<p class="text-2xl md:text-3xl font-black tracking-tight text-rose-600 dark:text-rose-400">
				{countHighPriority}
			</p>
			<p class="text-[11px] font-medium text-slate-400 mt-0.5">Perlu tindakan cepat</p>
		</div>
	</div>

	<!-- Toolbar & Filters -->
	<div
		class="p-3 md:p-4 rounded-2xl border mb-6 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3"
		style="background: var(--sys-bg-secondary, #ffffff); border-color: var(--sys-sep)"
	>
		<!-- Left: Status Tabs -->
		<div class="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
			{#each [
				{ id: 'all', label: 'Semua', count: countTotal },
				{ id: 'need_survey', label: 'Menunggu Survey', count: countMenunggu },
				{ id: 'in_progress', label: 'WO Berjalan', count: countWoBerjalan },
				{ id: 'closed', label: 'Selesai', count: countSelesai }
			] as tab}
				<button
					type="button"
					class="px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5"
					style={statusFilter === tab.id
						? 'background: var(--g); color: #ffffff; box-shadow: 0 2px 6px rgba(31,101,146,0.3)'
						: 'background: var(--sys-fill, rgba(0,0,0,0.04)); color: var(--sys-label2)'}
					onclick={() => (statusFilter = tab.id as typeof statusFilter)}
				>
					<span>{tab.label}</span>
					<span
						class="px-1.5 py-0.2 text-[10px] rounded-full font-bold"
						style={statusFilter === tab.id
							? 'background: rgba(255,255,255,0.25); color: #ffffff'
							: 'background: rgba(0,0,0,0.08); color: var(--sys-label3)'}
					>
						{tab.count}
					</span>
				</button>
			{/each}
		</div>

		<!-- Right: Search & Priority Filter -->
		<div class="flex items-center gap-2 flex-1 md:max-w-md">
			<!-- Search Bar -->
			<div class="relative flex-1">
				<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
				<input
					type="text"
					placeholder="Cari tiket, kode alat, masalah..."
					bind:value={searchQuery}
					class="w-full h-9 pl-9 pr-8 rounded-xl text-xs border focus:outline-none transition-colors"
					style="border-color: var(--sys-sep); background: var(--sys-bg, #f8fafc); color: var(--sys-label)"
				/>
				{#if searchQuery}
					<button
						type="button"
						class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
						onclick={() => (searchQuery = '')}
					>
						<IconX size={14} />
					</button>
				{/if}
			</div>

			<!-- Priority Filter -->
			<select
				bind:value={priorityFilter}
				class="h-9 px-2.5 rounded-xl text-xs border font-medium focus:outline-none"
				style="border-color: var(--sys-sep); background: var(--sys-bg, #f8fafc); color: var(--sys-label)"
			>
				<option value="all">Semua Prioritas</option>
				<option value="high">Prioritas Tinggi</option>
				<option value="medium">Prioritas Sedang</option>
				<option value="low">Prioritas Ringan</option>
			</select>
		</div>
	</div>

	<!-- Content Area -->
	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat tiket kerusakan alat..." />
		</div>
	{:else if errorMsg}
		<div class="rounded-2xl border p-8 text-center max-w-md mx-auto my-10 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900">
			<div class="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/60 flex items-center justify-center mx-auto mb-3 text-red-600 dark:text-red-300">
				<IconAlertTriangle size={24} />
			</div>
			<h3 class="text-base font-bold text-red-800 dark:text-red-200 mb-1">Gagal Memuat Tiket</h3>
			<p class="text-xs text-red-600 dark:text-red-400 mb-4">{errorMsg}</p>
			<button
				type="button"
				class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-700 transition-colors"
				onclick={() => fetchData(true)}
			>
				Coba Lagi
			</button>
		</div>
	{:else if tickets.length === 0}
		<!-- Empty State: Belum ada tiket sama sekali -->
		<div
			class="rounded-3xl border p-8 md:p-12 text-center max-w-xl mx-auto my-8 shadow-sm"
			style="background: var(--sys-bg-secondary, #ffffff); border-color: var(--sys-sep)"
		>
			<div class="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300 shadow-inner">
				<IconClipboardList size={32} />
			</div>
			<h3 class="text-lg font-bold mb-1" style="color: var(--sys-label)">Belum Ada Tiket Kerusakan</h3>
			<p class="text-xs md:text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-md mx-auto">
				Anda belum melaporkan kerusakan alat atau equipment. Jika terjadi kendala operasional, laporkan agar tim admin & mekanik segera menerbitkan Work Order.
			</p>

			<!-- Quick Step Guidance -->
			<div class="grid grid-cols-3 gap-2 max-w-md mx-auto mb-6 text-left">
				<div class="p-2.5 rounded-xl border bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
					<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-200 text-sky-800 dark:bg-sky-900 dark:text-sky-200 mb-1 inline-block">1</span>
					<p class="text-[11px] font-bold text-slate-700 dark:text-slate-200">Lapor Unit</p>
					<p class="text-[10px] text-slate-400">Pilih unit & foto kerusakan</p>
				</div>
				<div class="p-2.5 rounded-xl border bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
					<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200 mb-1 inline-block">2</span>
					<p class="text-[11px] font-bold text-slate-700 dark:text-slate-200">Survey & WO</p>
					<p class="text-[10px] text-slate-400">Admin analisa & rilis tugas</p>
				</div>
				<div class="p-2.5 rounded-xl border bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
					<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 mb-1 inline-block">3</span>
					<p class="text-[11px] font-bold text-slate-700 dark:text-slate-200">Perbaikan</p>
					<p class="text-[10px] text-slate-400">Mekanik perbaiki alat</p>
				</div>
			</div>

			<button
				type="button"
				class="px-6 py-3 rounded-xl text-xs font-bold text-white shadow-lg transition-all active:scale-95 inline-flex items-center gap-2 hover:opacity-95"
				style="background: linear-gradient(135deg, #1F6592 0%, #163F5A 100%)"
				onclick={() => goto('/maintenance/survey/baru')}
			>
				<IconPlus size={16} />
				<span>Buat Laporan Kerusakan Sekarang</span>
			</button>
		</div>
	{:else if filteredTickets.length === 0}
		<!-- Empty State: Hasil Filter / Search Kosong -->
		<div
			class="rounded-2xl border p-10 text-center max-w-md mx-auto my-8"
			style="background: var(--sys-bg-secondary, #ffffff); border-color: var(--sys-sep)"
		>
			<IconFilter size={32} class="mx-auto mb-3 text-slate-400" />
			<h4 class="text-sm font-bold mb-1" style="color: var(--sys-label)">Tidak Ada Tiket yang Cocok</h4>
			<p class="text-xs text-slate-500 mb-4">Coba sesuaikan kata kunci pencarian atau ganti status filter.</p>
			<button
				type="button"
				class="px-4 py-2 rounded-xl text-xs font-bold text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 transition-colors"
				onclick={resetFilters}
			>
				Reset Semua Filter
			</button>
		</div>
	{:else}
		<!-- Ticket Cards Grid -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each filteredTickets as t (t.id)}
				{@const eq = equipmentMap[t.equipment_id]}
				{@const st = getStatusMeta(t.status, t.wo_created)}
				{@const pr = getPriorityMeta(t.prioritas)}
				<div
					class="rounded-2xl border p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between group relative overflow-hidden"
					style="background: var(--sys-bg-secondary, #ffffff); border-color: var(--sys-sep)"
				>
					<!-- Top Bar: Nomor Tiket, Copy & Status -->
					<div>
						<div class="flex items-start justify-between gap-2 mb-2.5">
							<div class="flex items-center gap-1.5">
								<span class="px-2 py-0.5 rounded-lg text-[11px] font-mono font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
									{t.nomor_tiket}
								</span>
								<button
									type="button"
									class="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
									title="Salin nomor tiket"
									onclick={(e) => {
										e.stopPropagation();
										copyToClipboard(t.nomor_tiket);
									}}
								>
									{#if copiedTicket === t.nomor_tiket}
										<IconCircleCheck size={13} class="text-emerald-600" />
									{:else}
										<IconCopy size={13} />
									{/if}
								</button>
							</div>

							<!-- Badges: Status & Priority -->
							<div class="flex items-center gap-1.5 flex-wrap justify-end">
								<span
									class="text-[10px] font-extrabold px-2 py-0.5 rounded-full border"
									style="background:{pr.bg}; color:{pr.color}; border-color:{pr.border}"
								>
									{pr.label}
								</span>
								<span
									class="text-[10px] font-extrabold px-2 py-0.5 rounded-full border"
									style="background:{st.bg}; color:{st.color}; border-color:{st.border}"
								>
									{st.label}
								</span>
							</div>
						</div>

						<!-- Equipment Info -->
						<div class="flex items-start gap-2.5 mb-2.5">
							<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-100 dark:border-sky-900">
								<IconTool size={20} />
							</div>
							<div class="min-w-0 flex-1">
								<h3 class="text-sm font-bold truncate" style="color: var(--sys-label)">
									{eq?.name || t.equipment_id}
								</h3>
								<p class="text-[11px] font-medium text-slate-400 truncate">
									Kode: {eq?.code || '-'} {#if eq?.category} • {eq.category}{/if}
								</p>
							</div>
						</div>

						<!-- Issue Description -->
						<div class="mb-3">
							<p class="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
								{t.masalah}
							</p>
						</div>

						<!-- Photo Thumbnail Preview if exists -->
						{#if t.foto}
							<div class="mb-3">
								<button
									type="button"
									class="relative group/photo w-full h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 block text-left"
									onclick={(e) => {
										e.stopPropagation();
										previewImageUrl = `/api/directus/assets/${t.foto}`;
									}}
								>
									<img
										src="/api/directus/assets/{t.foto}?width=400&quality=80"
										alt="Bukti Kerusakan"
										class="w-full h-full object-cover transition-transform duration-300 group-hover/photo:scale-105"
										loading="lazy"
									/>
									<div class="absolute inset-0 bg-black/40 opacity-0 group-hover/photo:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-bold">
										<IconEye size={16} />
										<span>Perbesar Foto</span>
									</div>
									<div class="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] flex items-center gap-1">
										<IconPhoto size={11} />
										<span>Foto Bukti</span>
									</div>
								</button>
							</div>
						{/if}
					</div>

					<!-- Bottom Section: Meta info, mini progress, & actions -->
					<div class="pt-3 border-t border-slate-100 dark:border-slate-800/80">
						<!-- Mini Workflow Tracker -->
						<div class="flex items-center justify-between gap-1 mb-3">
							{#each [
								{ step: 1, label: 'Lapor' },
								{ step: 2, label: 'Survey' },
								{ step: 3, label: 'WO' },
								{ step: 4, label: 'Selesai' }
							] as stepItem}
								<div class="flex-1 flex flex-col items-center">
									<div
										class="w-full h-1 rounded-full mb-1 transition-colors"
										style={st.step >= stepItem.step
											? 'background: var(--g)'
											: 'background: var(--sys-fill, #e2e8f0)'}
									></div>
									<span
										class="text-[9px] font-semibold tracking-tight"
										style={st.step >= stepItem.step
											? 'color: var(--sys-label)'
											: 'color: var(--sys-label4, #94a3b8)'}
									>
										{stepItem.label}
									</span>
								</div>
							{/each}
						</div>

						<div class="flex items-center justify-between text-[11px] text-slate-400 mb-3">
							<span class="flex items-center gap-1">
								<IconClock size={12} />
								{formatDateIndo(t.tanggal_lapor)}
							</span>
							{#if t.wo_created}
								<span class="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 text-[10px]">
									<IconCircleCheck size={12} /> WO Diterbitkan
								</span>
							{:else}
								<span class="text-amber-600 dark:text-amber-400 font-semibold text-[10px]">
									Menunggu Survey
								</span>
							{/if}
						</div>

						<!-- Action Buttons -->
						<div class="flex items-center gap-2">
							<button
								type="button"
								class="flex-1 h-9 rounded-xl border text-xs font-bold transition-all hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 shadow-sm"
								style="border-color: var(--sys-sep); color: var(--sys-label)"
								onclick={() => (selectedTicket = t)}
							>
								<IconInfoCircle size={15} />
								<span>Rincian</span>
							</button>

							{#if t.wo_created}
								<button
									type="button"
									class="px-3 h-9 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90 flex items-center gap-1 shadow-sm"
									style="background: var(--g)"
									onclick={() => goto('/maintenance/work-order')}
									title="Buka daftar Work Order"
								>
									<span>Work Order</span>
									<IconChevronRight size={14} />
								</button>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- ============================================================== -->
<!-- MODAL DETAIL TIKET LENGKAP -->
<!-- ============================================================== -->
{#if selectedTicket}
	{@const selEq = equipmentMap[selectedTicket.equipment_id]}
	{@const selSt = getStatusMeta(selectedTicket.status, selectedTicket.wo_created)}
	{@const selPr = getPriorityMeta(selectedTicket.prioritas)}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={() => (selectedTicket = null)}
		onkeydown={(e) => { if (e.key === 'Escape') selectedTicket = null; }}
	>
		<div
			class="w-full max-w-lg rounded-3xl border shadow-2xl p-5 md:p-6 max-h-[90vh] overflow-y-auto"
			style="background: var(--sys-bg-secondary, #ffffff); border-color: var(--sys-sep)"
			onclick={(e) => e.stopPropagation()}
			role="document"
		>
			<!-- Modal Header -->
			<div class="flex items-start justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-4">
				<div>
					<div class="flex items-center gap-2 mb-1">
						<span class="text-xs font-mono font-bold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
							{selectedTicket.nomor_tiket}
						</span>
						<span
							class="text-[10px] font-bold px-2 py-0.5 rounded-full border"
							style="background:{selPr.bg}; color:{selPr.color}; border-color:{selPr.border}"
						>
							Prioritas {selPr.label}
						</span>
					</div>
					<h2 class="text-lg font-bold" style="color: var(--sys-label)">Detail Laporan Kerusakan</h2>
				</div>
				<button
					type="button"
					class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
					onclick={() => (selectedTicket = null)}
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Status Tracker Banner -->
			<div
				class="p-3.5 rounded-2xl border mb-4 flex items-center justify-between gap-3"
				style="background:{selSt.bg}; border-color:{selSt.border}"
			>
				<div>
					<p class="text-xs font-bold" style="color:{selSt.color}">{selSt.label}</p>
					<p class="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">{selSt.desc}</p>
				</div>
				<span class="text-xs font-bold px-2.5 py-1 rounded-xl bg-white/80 dark:bg-black/30 shadow-xs" style="color:{selSt.color}">
					Tahap {selSt.step} dari 4
				</span>
			</div>

			<!-- Unit & Equipment Info -->
			<div class="p-3.5 rounded-2xl border bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800 mb-4">
				<p class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Informasi Unit</p>
				<div class="flex items-start gap-3">
					<div class="w-10 h-10 rounded-xl flex items-center justify-center bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 shrink-0">
						<IconTool size={20} />
					</div>
					<div>
						<p class="text-sm font-bold" style="color: var(--sys-label)">{selEq?.name || selectedTicket.equipment_id}</p>
						<p class="text-xs text-slate-500">Kode: <span class="font-mono font-semibold">{selEq?.code || '-'}</span></p>
						{#if selEq?.category}
							<p class="text-[11px] text-slate-400 mt-0.5">Kategori: {selEq.category}</p>
						{/if}
					</div>
				</div>
			</div>

			<!-- Problem Description -->
			<div class="mb-4">
				<p class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Uraian Gejala / Kerusakan</p>
				<div class="p-3.5 rounded-2xl border bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800">
					<p class="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
						{selectedTicket.masalah}
					</p>
				</div>
			</div>

			<!-- Photo Evidence -->
			{#if selectedTicket.foto}
				<div class="mb-4">
					<p class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Foto Kondisi / Bukti</p>
					<button
						type="button"
						class="relative group/modalphoto w-full h-44 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 block text-left"
						onclick={() => {
							previewImageUrl = `/api/directus/assets/${selectedTicket?.foto}`;
						}}
					>
						<img
							src="/api/directus/assets/{selectedTicket.foto}"
							alt="Foto Bukti Kerusakan"
							class="w-full h-full object-cover transition-transform group-hover/modalphoto:scale-105"
						/>
						<div class="absolute inset-0 bg-black/40 opacity-0 group-hover/modalphoto:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-bold">
							<IconEye size={18} />
							<span>Klik untuk Memperbesar</span>
						</div>
					</button>
				</div>
			{/if}

			<!-- Meta details -->
			<div class="grid grid-cols-2 gap-2 text-xs mb-5">
				<div class="p-3 rounded-xl border bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800">
					<span class="text-[10px] text-slate-400 block mb-0.5">Dilaporkan Oleh</span>
					<span class="font-bold text-slate-700 dark:text-slate-200">{selectedTicket.pelapor || '-'}</span>
				</div>
				<div class="p-3 rounded-xl border bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800">
					<span class="text-[10px] text-slate-400 block mb-0.5">Waktu Lapor</span>
					<span class="font-bold text-slate-700 dark:text-slate-200">
						{formatDateTimeIndo(selectedTicket.waktu_lapor, selectedTicket.tanggal_lapor)}
					</span>
				</div>
			</div>

			<!-- Footer Modal Actions -->
			<div class="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
				<button
					type="button"
					class="flex-1 h-10 rounded-xl border text-xs font-bold transition-all hover:bg-slate-100 dark:hover:bg-slate-800"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => (selectedTicket = null)}
				>
					Tutup
				</button>
				{#if selectedTicket.wo_created}
					<button
						type="button"
						class="flex-1 h-10 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90 flex items-center justify-center gap-1.5 shadow-md"
						style="background: var(--g)"
						onclick={() => goto('/maintenance/work-order')}
					>
						<span>Buka Work Order</span>
						<IconExternalLink size={15} />
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- ============================================================== -->
<!-- IMAGE LIGHTBOX MODAL (PREVIEW FOTO KERUSAKAN) -->
<!-- ============================================================== -->
{#if previewImageUrl}
	<div
		class="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={() => (previewImageUrl = null)}
		onkeydown={(e) => { if (e.key === 'Escape') previewImageUrl = null; }}
	>
		<div class="relative max-w-3xl max-h-[90vh] flex flex-col items-center" onclick={(e) => e.stopPropagation()} role="document">
			<button
				type="button"
				class="absolute -top-10 right-0 text-white/80 hover:text-white flex items-center gap-1 text-xs font-bold"
				onclick={() => (previewImageUrl = null)}
			>
				<IconX size={20} />
				<span>Tutup</span>
			</button>
			<img
				src={previewImageUrl}
				alt="Foto Kerusakan"
				class="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-2xl border border-white/10"
			/>
			<div class="mt-3 flex items-center gap-3">
				<a
					href={previewImageUrl}
					target="_blank"
					rel="noreferrer"
					class="px-4 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-semibold backdrop-blur-xs transition-colors flex items-center gap-1.5"
				>
					<IconExternalLink size={14} />
					<span>Buka Ukuran Penuh</span>
				</a>
			</div>
		</div>
	</div>
{/if}

<!-- QR Scanner Modal -->
{#if showScanner && QrScannerModal}
	<QrScannerModal
		expectedPrefix="EPI:EQUIPMENT:"
		onDetect={onEquipmentScanDetect}
		onClose={() => (showScanner = false)}
	/>
{/if}

