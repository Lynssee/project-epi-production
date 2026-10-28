<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { resolveOperatorId, getOperatorEquipment, getTodaySessionsMap, getPmDueCountsMap, getMyPmDueTasks, getEquipmentByCode, type MyPmDueTask } from '$lib/services/preventive';
	import { saveScanProof } from '$lib/utils/p2hScanProof';
	import { getMyWorkOrders, getCategoryNamesMap, isWorkOrderPendingQc, getOverdueDispatchForWorkOrders, type WorkOrderRow, type OverdueDispatch } from '$lib/services/maintenance';
	import { getMyTickets, type MaintTicketRow } from '$lib/services/maintenance';
	import { fetchActiveLoansForKaryawan, type LoanRow } from '$lib/services/loanChecklist';
	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	let EquipmentActionSheet = $state<any>(null);
	async function loadEquipmentActionSheet() {
		EquipmentActionSheet ??= (await import('$lib/components/scanner/EquipmentActionSheet.svelte')).default;
	}
	import {
		IconTool, IconClipboardCheck, IconAlertTriangle, IconClipboardList,
		IconLoader2, IconChevronRight, IconQrcode
	} from '@tabler/icons-svelte';

	// B2 Fase 4 restrukturisasi navigasi Lapangan (5 Agustus 2026): quick-view tabs di bawah
	// kartu KPI -- lihat isi WO/Tiket/PM/Pinjaman langsung tanpa pindah halaman.
	let quickViewTab = $state<'wo' | 'tiket' | 'pm' | 'pinjaman'>('wo');
	let myWorkOrders = $state<WorkOrderRow[]>([]);
	let myTickets = $state<MaintTicketRow[]>([]);
	let myPmTasks = $state<MyPmDueTask[]>([]);
	let myLoans = $state<LoanRow[]>([]);
	let woStatusMap = $state<Record<string, string>>({});

	let showScanner = $state(false);
	let scanError = $state('');
	let scannedEquipment = $state<{ id: string; name: string; code?: string | null } | null>(null);

	// B3/B7 — scan sekarang buka menu aksi, bukan langsung lompat ke P2H seperti sebelumnya.
	async function onEquipmentScanDetect(value: string) {
		showScanner = false;
		const code = value.replace(/^EPI:EQUIPMENT:/, '');
		const equipment = await getEquipmentByCode(code);
		if (!equipment) {
			scanError = `Equipment dengan kode "${code}" tidak ditemukan.`;
			return;
		}
		scanError = '';
		saveScanProof(equipment.id);
		await loadEquipmentActionSheet();
		scannedEquipment = { id: equipment.id, name: equipment.name, code: equipment.code };
	}

	let loading = $state(true);
	let errorMsg = $state('');

	let woAktif = $state(0);
	let woPendingQc = $state(0);
	let pmOverdue = $state(0);
	let pmDue = $state(0);
	let p2hBelum = $state(0);
	let ticketMenunggu = $state(0);
	let overdueDispatch = $state<OverdueDispatch[]>([]);

	const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_maintenance', roles)) {
			goto('/');
		}
	});

	onMount(async () => {
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama operator tidak ditemukan di sesi login.');
			const personnelId = await resolveOperatorId(karyawanName, $authStore.karyawanId);

			const [workOrders, tickets, equipmentList] = await Promise.all([
				getMyWorkOrders(personnelId),
				getMyTickets(karyawanName),
				getOperatorEquipment()
			]);

			const categoryMap = await getCategoryNamesMap(workOrders.map((w: WorkOrderRow) => w.order_status));
			woPendingQc = workOrders.filter((w) => isWorkOrderPendingQc(categoryMap[w.order_status || ''])).length;
			woAktif = workOrders.length - woPendingQc - workOrders.filter((w) => (categoryMap[w.order_status || ''] || '').toLowerCase().includes('closed')).length;
			myWorkOrders = workOrders;
			woStatusMap = categoryMap;

			ticketMenunggu = tickets.filter((t) => t.status === 'need_survey').length;
			myTickets = tickets;

			// Fase 5 Pusat Maintenance v2: pengingat retur bengkel lewat deadline.
			overdueDispatch = await getOverdueDispatchForWorkOrders(
				workOrders.filter((w) => w.butuh_servis_luar).map((w) => w.id)
			);

			const equipmentIds = (equipmentList as any[]).map((e) => e.id);
			const [sessionMap, pmMap, pmTasks, loans] = await Promise.all([
				getTodaySessionsMap(equipmentIds, today),
				getPmDueCountsMap(equipmentIds),
				getMyPmDueTasks(equipmentIds),
				$authStore.karyawanId ? fetchActiveLoansForKaryawan($authStore.karyawanId) : Promise.resolve([])
			]);
			p2hBelum = equipmentIds.filter((id) => !sessionMap[id]).length;
			pmOverdue = Object.values(pmMap).reduce((sum, m) => sum + m.overdue, 0);
			pmDue = Object.values(pmMap).reduce((sum, m) => sum + m.total, 0);
			myPmTasks = pmTasks;
			myLoans = loans;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat ringkasan maintenance.';
		} finally {
			loading = false;
		}
	});

	const cards = $derived([
		{ label: 'WO Aktif', value: woAktif, icon: IconTool, bg: 'var(--gl)', color: 'var(--g)', href: '/maintenance/work-order' },
		{ label: 'Menunggu QC', value: woPendingQc, icon: IconClipboardCheck, bg: '#DDD6FE', color: '#5B21B6', href: '/maintenance/work-order' },
		{ label: 'PM Jatuh Tempo', value: pmDue, sub: pmOverdue > 0 ? `${pmOverdue} overdue` : undefined, icon: IconAlertTriangle, bg: pmOverdue > 0 ? 'var(--rel)' : 'var(--aml)', color: pmOverdue > 0 ? 'var(--red)' : 'var(--amd)', href: '/preventive' },
		{ label: 'P2H Belum (hari ini)', value: p2hBelum, icon: IconClipboardList, bg: 'var(--aml)', color: 'var(--amd)', href: '/preventive' },
		{ label: 'Tiket Menunggu Survey', value: ticketMenunggu, icon: IconClipboardList, bg: 'var(--pl)', color: 'var(--pd)', href: '/maintenance/survey' }
	]);
</script>

<div class="max-w-4xl mx-auto p-4 md:p-6 pb-24">
	<div class="mb-8">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Dashboard Maintenance</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Ringkasan pekerjaan maintenance lapangan Anda hari ini</p>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat ringkasan maintenance..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<h3 class="text-lg font-bold text-red-600 mb-2">Terjadi Kesalahan</h3>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg" onclick={() => window.location.reload()}>
				Coba Lagi
			</button>
		</div>
	{:else}
		{#if overdueDispatch.length > 0}
			<button
				class="w-full text-left mb-6 px-4 py-3 rounded-xl text-sm font-medium bg-red-50 text-red-700 border border-red-200 flex items-center gap-2"
				onclick={() => goto('/maintenance/work-order')}
			>
				<IconAlertTriangle size={16} class="shrink-0" />
				<span>
					{overdueDispatch.length} unit di bengkel luar lewat batas waktu retur — {overdueDispatch
						.slice(0, 2)
						.map((o) => `SJ ${o.nomorSj}`)
						.join(', ')}{overdueDispatch.length > 2 ? `, +${overdueDispatch.length - 2} lagi` : ''}. Tekan untuk cek.
				</span>
			</button>
		{/if}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
			{#each cards as c}
				<button
					class="glass-panel hover-lift rounded-2xl p-5 text-left focus:outline-none relative overflow-hidden group"
					onclick={() => goto(c.href)}
				>
					<!-- subtle bg decoration -->
					<div class="absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl -mr-8 -mt-8 transition-opacity opacity-50 group-hover:opacity-100" style="background: {c.color}20"></div>
					
					<div class="relative z-10">
						<div class="flex items-start justify-between mb-4">
							<div class="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm" style="background: {c.bg}">
								<c.icon size={24} style="color: {c.color}" />
							</div>
						</div>
						<div class="flex items-baseline gap-2 mb-1">
							<p class="text-3xl font-black tracking-tight" style="color: var(--sys-label)">{c.value}</p>
							{#if c.sub}
								<p class="text-xs font-bold px-2 py-0.5 rounded-full border" style="background: {c.bg}; color: {c.color}; border-color: {c.color}30">{c.sub}</p>
							{/if}
						</div>
						<p class="text-sm font-bold" style="color: var(--sys-label3)">{c.label}</p>
					</div>
				</button>
			{/each}
		</div>

		<!-- B2 Fase 4: quick-view tabs -- lihat isi WO/Tiket/PM/Pinjaman tanpa pindah halaman -->
		<div class="glass-panel rounded-2xl p-4 mb-8">
			<div class="flex gap-1 mb-3 overflow-x-auto">
				{#each [{ id: 'wo', label: `WO Saya (${myWorkOrders.length})` }, { id: 'tiket', label: `Tiket Saya (${myTickets.length})` }, { id: 'pm', label: `PM Hari Ini (${myPmTasks.length})` }, { id: 'pinjaman', label: `Pinjaman Aktif (${myLoans.length})` }] as tab}
					<button
						class="px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-colors"
						style={quickViewTab === tab.id ? 'background: var(--g); color: white' : 'background: transparent; color: var(--sys-label3)'}
						onclick={() => (quickViewTab = tab.id as typeof quickViewTab)}
					>
						{tab.label}
					</button>
				{/each}
			</div>

			{#if quickViewTab === 'wo'}
				{#if myWorkOrders.length === 0}
					<p class="text-[12px] py-4 text-center" style="color: var(--sys-label4)">Tidak ada Work Order aktif.</p>
				{:else}
					<ul class="space-y-2">
						{#each myWorkOrders.slice(0, 5) as w}
							<li class="flex items-center justify-between gap-2 py-1.5 border-b last:border-0" style="border-color: var(--sys-sep)">
								<span class="text-[12px] truncate flex-1" style="color: var(--sys-label)">{w.keluhan}</span>
								<span class="text-[11px] font-medium shrink-0" style="color: var(--sys-label3)">{woStatusMap[w.order_status || ''] || '-'}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if quickViewTab === 'tiket'}
				{#if myTickets.length === 0}
					<p class="text-[12px] py-4 text-center" style="color: var(--sys-label4)">Tidak ada tiket dilaporkan.</p>
				{:else}
					<ul class="space-y-2">
						{#each myTickets.slice(0, 5) as t}
							<li class="flex items-center justify-between gap-2 py-1.5 border-b last:border-0" style="border-color: var(--sys-sep)">
								<span class="text-[12px] truncate flex-1" style="color: var(--sys-label)">{t.masalah}</span>
								<span class="text-[11px] font-medium shrink-0" style="color: var(--sys-label3)">{t.status}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if quickViewTab === 'pm'}
				{#if myPmTasks.length === 0}
					<p class="text-[12px] py-4 text-center" style="color: var(--sys-label4)">Tidak ada PM jatuh tempo hari ini.</p>
				{:else}
					<ul class="space-y-2">
						{#each myPmTasks.slice(0, 5) as p}
							<li class="flex items-center justify-between gap-2 py-1.5 border-b last:border-0" style="border-color: var(--sys-sep)">
								<span class="text-[12px] truncate flex-1" style="color: var(--sys-label)">{p.equipmentName} — {p.taskName}</span>
								<span class="text-[11px] font-medium shrink-0" style="color: {p.overdue ? 'var(--red)' : 'var(--sys-label3)'}">{p.overdue ? 'Overdue' : 'Jatuh tempo'}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if quickViewTab === 'pinjaman'}
				{#if myLoans.length === 0}
					<p class="text-[12px] py-4 text-center" style="color: var(--sys-label4)">Tidak ada alat pinjaman aktif.</p>
				{:else}
					<ul class="space-y-2">
						{#each myLoans.slice(0, 5) as l}
							<li class="flex items-center justify-between gap-2 py-1.5 border-b last:border-0" style="border-color: var(--sys-sep)">
								<span class="text-[12px] truncate flex-1" style="color: var(--sys-label)">{l.equipment?.name || l.equipment?.code || '-'}</span>
								<span class="text-[11px] font-medium shrink-0" style="color: var(--sys-label3)">Sejak {l.start_date}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</div>

		<h2 class="text-lg font-bold mb-4" style="color: var(--sys-label)">Aksi Cepat</h2>
		{#if scanError}
			<div class="mb-4 px-4 py-3 rounded-xl text-sm font-medium bg-red-50 text-red-600 border border-red-200">{scanError}</div>
		{/if}
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<button
				class="glass-panel hover-lift h-16 rounded-2xl flex items-center justify-between px-5 group focus:outline-none border border-emerald-200 bg-emerald-50/50"
				onclick={async () => { scanError = ''; await loadQrScannerModal(); showScanner = true; }}
			>
				<span class="flex items-center gap-2 text-sm font-bold text-emerald-700">
					<IconQrcode size={18} />
					Scan QR Equipment
				</span>
				<div class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center transition-transform group-hover:translate-x-1">
					<IconChevronRight size={18} class="text-emerald-600" />
				</div>
			</button>
			<button
				class="glass-panel hover-lift h-16 rounded-2xl flex items-center justify-between px-5 group focus:outline-none"
				onclick={() => goto('/maintenance/work-order')}
			>
				<span class="text-sm font-bold" style="color: var(--sys-label)">Lihat semua Work Order Saya</span>
				<div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center transition-transform group-hover:translate-x-1">
					<IconChevronRight size={18} style="color: var(--sys-label4)" />
				</div>
			</button>
			<button
				class="glass-panel hover-lift h-16 rounded-2xl flex items-center justify-between px-5 group focus:outline-none"
				onclick={() => goto('/maintenance/riwayat-unit')}
			>
				<span class="text-sm font-bold" style="color: var(--sys-label)">Riwayat Perbaikan Unit</span>
				<div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center transition-transform group-hover:translate-x-1">
					<IconChevronRight size={18} style="color: var(--sys-label4)" />
				</div>
			</button>
			<button
				class="glass-panel hover-lift h-16 rounded-2xl flex items-center justify-between px-5 group focus:outline-none border border-blue-200 bg-blue-50/50"
				onclick={() => goto('/maintenance/survey/baru')}
			>
				<span class="text-sm font-bold text-blue-700">Lapor Kerusakan Baru</span>
				<div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center transition-transform group-hover:translate-x-1">
					<IconChevronRight size={18} class="text-blue-600" />
				</div>
			</button>
			<button
				class="glass-panel hover-lift h-16 rounded-2xl flex items-center justify-between px-5 group focus:outline-none border border-amber-200 bg-amber-50/50"
				onclick={() => goto('/maintenance/pinjaman-saya')}
			>
				<span class="text-sm font-bold text-amber-700">Alat Pinjaman Saya</span>
				<div class="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center transition-transform group-hover:translate-x-1">
					<IconChevronRight size={18} class="text-amber-600" />
				</div>
			</button>
		</div>
	{/if}
</div>

{#if showScanner && QrScannerModal}
	<QrScannerModal expectedPrefix="EPI:EQUIPMENT:" onDetect={onEquipmentScanDetect} onClose={() => (showScanner = false)} />
{/if}

{#if scannedEquipment && EquipmentActionSheet}
	<EquipmentActionSheet equipment={scannedEquipment} onClose={() => (scannedEquipment = null)} />
{/if}
