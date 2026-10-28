<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { openPlaceholderWindow } from '$lib/utils/openWindowAsync';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { listMyPenawaran, updatePenawaranStatus, type QuotationHeader } from '$lib/services/kalkulatorPenawaran';
	import { getUpcomingFollowUps, getSalesVisitKpis, resolveSalesDisplayName } from '$lib/services/sales';
	import { getMyPoStatusSummary } from '$lib/services/salesPo';
	import { auth } from '$lib/firebase';
	import SalesNavTabs from '$lib/components/sales/SalesNavTabs.svelte';
	import FieldExportButton from '$lib/components/sales/FieldExportButton.svelte';
	import {
		IconArrowLeft,
		IconPlus,
		IconLoader2,
		IconFileDollar,
		IconFileTypePdf,
		IconSearch,
		IconX,
		IconBrandWhatsapp,
		IconArrowRight,
		IconCalendar,
		IconCheck,
		IconTrash,
		IconMapPin,
		IconBuildingStore,
		IconRulerMeasure,
		IconClock,
		IconAlertCircle,
		IconTrendingUp,
		IconUser
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let rows = $state<QuotationHeader[]>([]);
	let updatingId = $state<string | null>(null);
	let searchQuery = $state('');
	let activeFilter = $state<string>('all');
	let activeDateFilter = $state<'all' | 'thisMonth' | 'last7'>('all');
	let sortBy = $state<'newest' | 'value_desc' | 'customer' | 'valid_until'>('newest');

	let remindersCount = $state(0);
	let poNeedsAttention = $state(0);
	let pendingVisits = $state(0);

	const fmtRp = (v: number) => 'Rp ' + Math.round(Number(v) || 0).toLocaleString('id-ID');

	const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
	const monthPrefix = todayStr.slice(0, 7);
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	async function load() {
		loading = true;
		const isSuper = $authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin');
		const salesName = isSuper ? null : ($authStore.karyawanName || resolveSalesDisplayName($authStore.user?.displayName || $authStore.user?.email));
		const salesId = isSuper ? null : $authStore.karyawanId;

		try {
			const [penawaranList, reminderList, kpiData] = await Promise.all([
				listMyPenawaran(salesName),
				getUpcomingFollowUps(salesName),
				getSalesVisitKpis(salesId)
			]);

			rows = penawaranList;
			remindersCount = reminderList.length;
			pendingVisits = kpiData.menungguVerifikasi;

			if ($authStore.karyawanId) {
				try {
					const poSummary = await getMyPoStatusSummary($authStore.karyawanId);
					poNeedsAttention = (poSummary.belum_ada || 0) + (poSummary.revisi || 0);
				} catch {}
			}
		} catch (e) {
			console.error('[sales/penawaran] Load error:', e);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	// KPI Metrics Derived
	let totalCount = $derived(rows.length);
	let pipelineActiveValue = $derived(
		rows
			.filter((r) => r.status === 'draft' || r.status === 'final' || r.status === 'sent')
			.reduce((acc, r) => acc + (Number(r.grand_total) || 0), 0)
	);
	let wonRows = $derived(rows.filter((r) => r.status === 'accepted'));
	let wonCount = $derived(wonRows.length);
	let wonValue = $derived(wonRows.reduce((acc, r) => acc + (Number(r.grand_total) || 0), 0));
	let waitingCount = $derived(rows.filter((r) => r.status === 'sent' || r.status === 'final').length);

	let filteredRows = $derived.by(() => {
		let list = rows;

		// 1. Status Filter
		if (activeFilter !== 'all') {
			list = list.filter((r) => r.status === activeFilter);
		}

		// 2. Date Filter
		if (activeDateFilter === 'thisMonth') {
			list = list.filter((r) => (r.tanggal || '').startsWith(monthPrefix));
		} else if (activeDateFilter === 'last7') {
			list = list.filter((r) => (r.tanggal || '') >= sevenDaysAgo);
		}

		// 3. Search Query
		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			list = list.filter(
				(r) =>
					(r.customer_name && r.customer_name.toLowerCase().includes(q)) ||
					(r.project_name && r.project_name.toLowerCase().includes(q)) ||
					(r.nomor_penawaran && r.nomor_penawaran.toLowerCase().includes(q)) ||
					(r.lokasi && r.lokasi.toLowerCase().includes(q)) ||
					(r.prepared_by && r.prepared_by.toLowerCase().includes(q))
			);
		}

		// 4. Sorting
		if (sortBy === 'value_desc') {
			list = [...list].sort((a, b) => (Number(b.grand_total) || 0) - (Number(a.grand_total) || 0));
		} else if (sortBy === 'customer') {
			list = [...list].sort((a, b) => (a.customer_name || '').localeCompare(b.customer_name || ''));
		} else if (sortBy === 'valid_until') {
			list = [...list].sort((a, b) => (a.valid_until || '9999').localeCompare(b.valid_until || '9999'));
		} else {
			// newest
			list = [...list].sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || '') || (Number(b.id) || 0) - (Number(a.id) || 0));
		}

		return list;
	});

	// Fase 6 §9.2 — export lapangan TANPA kolom nilai/margin.
	let exportRows = $derived(
		filteredRows.map((r) => ({
			no_penawaran: r.nomor_penawaran ?? '',
			tanggal: (r.tanggal ?? '').slice(0, 10),
			status: r.status ?? '',
			customer: r.customer_name ?? '',
			project: r.project_name ?? '',
			lokasi: r.lokasi ?? '',
			total_area_m2: r.total_area ?? 0,
			berlaku_sampai: (r.valid_until ?? '').slice(0, 10)
		}))
	);

	function badgeStyle(status: string) {
		if (status === 'accepted') return 'background:var(--gg); color:var(--ggd)';
		if (status === 'rejected') return 'background:var(--rel); color:var(--red)';
		if (status === 'sent') return 'background:var(--aml); color:var(--amd)';
		if (status === 'final') return 'background:#DBEAFE; color:#1D4ED8';
		return 'background:var(--sys-fill); color:var(--sys-label3)';
	}

	function badgeLabel(status: string) {
		if (status === 'accepted') return 'Diterima (Deal)';
		if (status === 'rejected') return 'Ditolak';
		if (status === 'sent') return 'Terkirim';
		if (status === 'final') return 'Final';
		return 'Draft';
	}

	function getValidityStatus(validUntil?: string | null) {
		if (!validUntil) return null;
		const target = validUntil.slice(0, 10);
		if (target < todayStr) {
			return { expired: true, text: `Kedaluwarsa (${target})` };
		}
		return { expired: false, text: `Berlaku s/d ${target}` };
	}

	async function changeStatus(row: QuotationHeader, status: QuotationHeader['status'], e: Event) {
		e.stopPropagation();
		if (updatingId) return;
		updatingId = row.id!;
		try {
			await updatePenawaranStatus(row.id!, status);
			await load();
		} finally {
			updatingId = null;
		}
	}

	// ── Share WA & Download PDF (SI-TAMA Sales §5) ──
	let busyId = $state<string | null>(null);
	let busyAction = $state<'wa' | 'pdf' | null>(null);
	let actionError = $state('');

	// Modal input nomor WA manual (bila nomor tak ditemukan di data)
	let waModalRow = $state<QuotationHeader | null>(null);
	let waModalMessage = $state('');
	let waManualNumber = $state('');

	async function authHeader(): Promise<Record<string, string>> {
		const user = auth.currentUser;
		if (!user) throw new Error('Sesi login tidak ditemukan. Muat ulang halaman.');
		return { Authorization: `Bearer ${await user.getIdToken()}` };
	}

	function normalizeWa(raw: string): string | null {
		let p = (raw || '').replace(/\D/g, '');
		if (!p) return null;
		if (p.startsWith('0062')) p = '62' + p.slice(4);
		else if (p.startsWith('620')) p = '62' + p.slice(3);
		else if (p.startsWith('0')) p = '62' + p.slice(1);
		else if (p.startsWith('8')) p = '62' + p;
		else if (!p.startsWith('62')) p = '62' + p;
		return p.length >= 10 && p.length <= 15 ? p : null;
	}

	async function shareToWhatsApp(row: QuotationHeader, e: Event) {
		e.stopPropagation();
		if (busyId) return;
		busyId = row.id!;
		busyAction = 'wa';
		actionError = '';
		// PRJ-28 (Aturan #5): jendela WA dibuka SINKRON sebelum fetch; ditutup bila tak ada tautan.
		const waWin = openPlaceholderWindow();
		try {
			const res = await fetch(`/api/sales/penawaran/${row.id}/wa-link`, { headers: await authHeader() });
			if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'Gagal membuat link WA.');
			const data = await res.json();
			if (data.wa_link) {
				waWin.navigate(data.wa_link);
			} else {
				waWin.cancel();
				// Nomor tak ditemukan → minta input manual
				waModalRow = row;
				waModalMessage = data.message || '';
				waManualNumber = '';
			}
		} catch (err: any) {
			waWin.cancel();
			actionError = err?.message || 'Gagal membuat link WA.';
		} finally {
			busyId = null;
			busyAction = null;
		}
	}

	function sendManualWa() {
		if (!waModalRow) return;
		const num = normalizeWa(waManualNumber);
		if (!num) {
			actionError = 'Nomor WhatsApp tidak valid.';
			return;
		}
		window.open(`https://wa.me/${num}?text=${encodeURIComponent(waModalMessage)}`, '_blank');
		waModalRow = null;
	}

	async function downloadPdf(row: QuotationHeader, e: Event) {
		e.stopPropagation();
		if (busyId) return;
		busyId = row.id!;
		busyAction = 'pdf';
		actionError = '';
		try {
			const res = await fetch(`/api/sales/penawaran/${row.id}/pdf`, { headers: await authHeader() });
			if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'Gagal membuat PDF.');
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${(row.nomor_penawaran || 'penawaran').replace(/[^\w.-]+/g, '-')}.pdf`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 4000);
		} catch (err: any) {
			actionError = err?.message || 'Gagal membuat PDF.';
		} finally {
			busyId = null;
			busyAction = null;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-4xl mx-auto p-4 md:p-6 pb-24">
		<!-- Header -->
		<div class="flex items-center justify-between gap-3 mb-4">
			<div>
				<h1 class="text-[20px] font-black tracking-tight" style="color: var(--sys-label)">Kalkulator & Penawaran</h1>
				<p class="text-[12px] font-medium mt-0.5" style="color: var(--sys-label3)">Estimasi harga sandblasting, painting, coating & pipeline penawaran</p>
			</div>
			<button
				type="button"
				class="h-10 px-4 rounded-xl text-[12px] font-bold text-white flex items-center gap-1.5 shrink-0 shadow-sm shadow-[var(--p,var(--g))]/30 active:scale-95 transition-transform"
				style="background: var(--p, var(--g))"
				onclick={() => goto('/sales/penawaran/baru')}
			>
				<IconPlus size={16} stroke={2.5} />
				<span>+ Penawaran Baru</span>
			</button>
		</div>

		<!-- Nav Tabs Sub-Menu -->
		<SalesNavTabs
			active="penawaran"
			{remindersCount}
			poCount={poNeedsAttention}
			pendingCount={pendingVisits}
		/>

		<!-- KPI Header Metrics -->
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
			<!-- Pipeline Value Aktif -->
			<div class="p-3.5 rounded-2xl border shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between mb-1.5">
					<span class="text-[11px] font-bold" style="color: var(--sys-label3)">Pipeline Aktif</span>
					<IconTrendingUp size={16} class="opacity-60" style="color: var(--p, var(--g))" />
				</div>
				<p class="text-[18px] sm:text-[20px] font-black leading-tight truncate" style="color: var(--sys-label)" title={fmtRp(pipelineActiveValue)}>
					{fmtRp(pipelineActiveValue)}
				</p>
				<span class="text-[10px] font-medium" style="color: var(--sys-label4)">Draft, final & terkirim</span>
			</div>

			<!-- Total Penawaran -->
			<div class="p-3.5 rounded-2xl border shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between mb-1.5">
					<span class="text-[11px] font-bold" style="color: var(--sys-label3)">Total Penawaran</span>
					<IconFileDollar size={16} class="opacity-60" style="color: var(--p, var(--g))" />
				</div>
				<p class="text-[22px] font-black leading-tight" style="color: var(--sys-label)">{totalCount}</p>
				<span class="text-[10px] font-medium" style="color: var(--sys-label4)">Dokumen penawaran</span>
			</div>

			<!-- Deal / Won -->
			<div class="p-3.5 rounded-2xl border shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between mb-1.5">
					<span class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">Deal Diterima (Won)</span>
					<IconCheck size={16} class="text-emerald-500" />
				</div>
				<p class="text-[22px] font-black leading-tight text-emerald-600 dark:text-emerald-400">{wonCount}</p>
				<span class="text-[10px] font-bold truncate block text-emerald-700 dark:text-emerald-300" title={fmtRp(wonValue)}>
					{fmtRp(wonValue)}
				</span>
			</div>

			<!-- Menunggu Respon -->
			<div class="p-3.5 rounded-2xl border shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between mb-1.5">
					<span class="text-[11px] font-bold text-blue-600 dark:text-blue-400">Menunggu Respon</span>
					<IconClock size={16} class="text-blue-500" />
				</div>
				<p class="text-[22px] font-black leading-tight text-blue-600 dark:text-blue-400">{waitingCount}</p>
				<span class="text-[10px] font-medium" style="color: var(--sys-label4)">Status Final & Terkirim</span>
			</div>
		</div>

		<!-- Search Bar & Controls -->
		<div class="flex flex-col gap-2.5 mb-4">
			<div class="flex items-center gap-2">
				<div class="relative flex-1">
					<span class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)">
						<IconSearch size={15} />
					</span>
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Cari customer, project, nomor penawaran, lokasi, sales..."
						class="w-full h-10 pl-9 pr-8 rounded-xl border text-[12px]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					/>
					{#if searchQuery}
						<button
							type="button"
							onclick={() => (searchQuery = '')}
							class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1"
							style="color: var(--sys-label4)"
							aria-label="Bersihkan"
						>
							<IconX size={13} />
						</button>
					{/if}
				</div>

				<FieldExportButton
					rows={exportRows}
					filename="penawaran-lapangan"
					title="Penawaran Lapangan"
					label="Export CSV"
					offlineNote="Tanpa nilai/margin. Dari daftar yang sedang tampil."
				/>
			</div>

			<!-- Filter Bar: Status, Periode, Sort -->
			<div class="flex items-center justify-between gap-2 flex-wrap">
				<!-- Status Filter Pills -->
				<div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-colors {activeFilter === 'all'
							? 'bg-[var(--p,var(--g))] text-white shadow-sm'
							: 'border'}"
						style={activeFilter !== 'all' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeFilter = 'all')}
					>
						Semua ({rows.length})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-colors {activeFilter === 'draft'
							? 'bg-[var(--p,var(--g))] text-white shadow-sm'
							: 'border'}"
						style={activeFilter !== 'draft' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeFilter = 'draft')}
					>
						Draft ({rows.filter((r) => r.status === 'draft').length})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-colors {activeFilter === 'final'
							? 'bg-blue-600 text-white shadow-sm'
							: 'border'}"
						style={activeFilter !== 'final' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeFilter = 'final')}
					>
						Final ({rows.filter((r) => r.status === 'final').length})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-colors {activeFilter === 'sent'
							? 'bg-amber-600 text-white shadow-sm'
							: 'border'}"
						style={activeFilter !== 'sent' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeFilter = 'sent')}
					>
						Terkirim ({rows.filter((r) => r.status === 'sent').length})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-colors {activeFilter === 'accepted'
							? 'bg-emerald-600 text-white shadow-sm'
							: 'border'}"
						style={activeFilter !== 'accepted' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeFilter = 'accepted')}
					>
						Diterima ({rows.filter((r) => r.status === 'accepted').length})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-colors {activeFilter === 'rejected'
							? 'bg-rose-600 text-white shadow-sm'
							: 'border'}"
						style={activeFilter !== 'rejected' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeFilter = 'rejected')}
					>
						Ditolak ({rows.filter((r) => r.status === 'rejected').length})
					</button>
				</div>

				<!-- Periode & Sort Selectors -->
				<div class="flex items-center gap-2 ml-auto">
					<select
						bind:value={activeDateFilter}
						class="h-8 px-2.5 rounded-lg border text-[11px] font-medium"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					>
						<option value="all">Semua Waktu</option>
						<option value="thisMonth">Bulan Ini</option>
						<option value="last7">7 Hari Terakhir</option>
					</select>

					<select
						bind:value={sortBy}
						class="h-8 px-2.5 rounded-lg border text-[11px] font-medium"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					>
						<option value="newest">Terkini</option>
						<option value="value_desc">Nilai Tertinggi</option>
						<option value="customer">Customer (A-Z)</option>
						<option value="valid_until">Masa Berlaku</option>
					</select>
				</div>
			</div>
		</div>

		{#if loading}
			<div class="flex items-center justify-center py-16">
				<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Penawaran Harga..." sublabel="Mengambil kalkulasi sales Directus" />
			</div>
		{:else if filteredRows.length === 0}
			<div class="text-center py-16 px-4 rounded-2xl border border-dashed my-2" style="border-color: var(--sys-sep)">
				<IconFileDollar size={38} style="color: var(--sys-label4); margin: 0 auto" />
				<p class="text-[13px] font-bold mt-3" style="color: var(--sys-label)">
					{searchQuery ? 'Tidak ada penawaran yang cocok dengan kriteria filter.' : 'Belum ada penawaran harga.'}
				</p>
				<p class="text-[11px] mt-1 mb-4" style="color: var(--sys-label3)">
					Buat kalkulasi harga baru menggunakan rumus standar coating & blasting EPI.
				</p>
				<button
					type="button"
					class="px-4 py-2 rounded-xl text-[12px] font-bold text-white inline-flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform"
					style="background: var(--p, var(--g))"
					onclick={() => goto('/sales/penawaran/baru')}
				>
					<IconPlus size={15} /> Buat Penawaran Baru
				</button>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each filteredRows as row (row.id)}
					{@const validity = getValidityStatus(row.valid_until)}
					<div
						class="rounded-2xl border p-4 sm:p-5 shadow-sm transition-all hover:border-[var(--p,var(--g))] group"
						style="border-color: var(--sys-sep); background: var(--sys-bg)"
					>
						<!-- Card Header: Title & Badges -->
						<div class="flex items-start justify-between gap-3 mb-2">
							<div class="min-w-0 flex-1">
								<h2 class="text-[15px] font-bold truncate leading-tight group-hover:text-[var(--p,var(--g))] transition-colors" style="color: var(--sys-label)">
									{row.customer_name || row.project_name || row.nomor_penawaran}
								</h2>
								<div class="flex items-center gap-2 mt-1 flex-wrap">
									<span class="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-[var(--p,var(--g))]/10" style="color: var(--p, var(--g))">
										{row.nomor_penawaran}
									</span>

									{#if row.linked_so_id}
										<button
											type="button"
											class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 transition-colors cursor-pointer"
											onclick={(e) => { e.stopPropagation(); goto(`/sales/po/${row.linked_so_id}`); }}
											title="Klik untuk membuka PO Customer terkait SO ini"
										>
											<IconCheck size={11} stroke={3} /> SO #{row.linked_so_id} →
										</button>
									{:else if row.status === 'accepted'}
										<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300">
											Menunggu SO Admin
										</span>
									{/if}

									{#if validity}
										<span class="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full {validity.expired ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400'}">
											<IconClock size={11} /> {validity.text}
										</span>
									{/if}
								</div>
							</div>

							<span class="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm" style={badgeStyle(row.status)}>
								{badgeLabel(row.status)}
							</span>
						</div>

						<!-- Value & Key Details Grid -->
						<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 mt-3 pt-2.5 border-t" style="border-color: var(--sys-sep)">
							<div>
								<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Grand Total:</span>
								<strong class="text-[16px] font-black tracking-tight" style="color: var(--sys-label)">{fmtRp(row.grand_total)}</strong>
							</div>

							<div class="text-[11px] flex flex-col justify-center">
								<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Project:</span>
								<span class="font-medium truncate" style="color: var(--sys-label2)" title={row.project_name || '-'}>
									{row.project_name || '-'}
								</span>
							</div>

							<div class="text-[11px] flex flex-col justify-center">
								<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Estimasi Luas:</span>
								<span class="font-bold" style="color: var(--sys-label)">
									{row.total_area ? `${Number(row.total_area).toLocaleString('id-ID')} m²` : '-'}
								</span>
							</div>

							<div class="text-[11px] flex flex-col justify-center">
								<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Tanggal:</span>
								<span class="font-medium" style="color: var(--sys-label2)">
									{row.tanggal ? new Date(row.tanggal).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
								</span>
							</div>
						</div>

						<!-- Sub-details chip: Lokasi & Prepared by -->
						{#if row.lokasi || row.prepared_by}
							<div class="flex items-center gap-3 text-[11px] mt-2 pt-2 border-t" style="border-color: var(--sys-sep); color: var(--sys-label3)">
								{#if row.lokasi}
									<span class="flex items-center gap-1 truncate max-w-[280px]">
										<IconMapPin size={13} class="text-rose-500 shrink-0" /> {row.lokasi}
									</span>
								{/if}
								{#if row.prepared_by}
									<span class="flex items-center gap-1 shrink-0 ml-auto">
										<IconUser size={13} class="opacity-70" /> {row.prepared_by}
									</span>
								{/if}
							</div>
						{/if}

						<!-- Action Row -->
						<div class="flex items-center justify-between gap-2 mt-3.5 pt-3 border-t flex-wrap" style="border-color: var(--sys-sep)">
							<div class="flex items-center gap-1.5 flex-wrap">
								<button
									type="button"
									class="h-8 px-2.5 rounded-xl text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 flex items-center gap-1 transition-colors disabled:opacity-50 active:scale-95"
									onclick={(e) => shareToWhatsApp(row, e)}
									disabled={busyId === row.id}
								>
									{#if busyId === row.id && busyAction === 'wa'}
										<IconLoader2 size={13} class="animate-spin" />
									{:else}
										<IconBrandWhatsapp size={13} />
									{/if}
									Share WA
								</button>

								<button
									type="button"
									class="h-8 px-2.5 rounded-xl text-[11px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 flex items-center gap-1 transition-colors disabled:opacity-50 active:scale-95"
									onclick={(e) => downloadPdf(row, e)}
									disabled={busyId === row.id}
								>
									{#if busyId === row.id && busyAction === 'pdf'}
										<IconLoader2 size={13} class="animate-spin" />
									{:else}
										<IconFileTypePdf size={13} />
									{/if}
									PDF
								</button>

								{#if row.status === 'final' || row.status === 'draft'}
									<button
										type="button"
										class="h-8 px-2.5 rounded-xl text-[11px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition-colors active:scale-95"
										onclick={(e) => changeStatus(row, 'sent', e)}
										disabled={updatingId === row.id}
									>
										Tandai Kirim
									</button>
								{/if}
								{#if row.status === 'sent'}
									<button
										type="button"
										class="h-8 px-2.5 rounded-xl text-[11px] font-bold bg-emerald-600 text-white shadow-sm transition-transform active:scale-95"
										onclick={(e) => changeStatus(row, 'accepted', e)}
										disabled={updatingId === row.id}
									>
										Deal (Won)
									</button>
									<button
										type="button"
										class="h-8 px-2.5 rounded-xl text-[11px] font-bold bg-rose-600 text-white shadow-sm transition-transform active:scale-95"
										onclick={(e) => changeStatus(row, 'rejected', e)}
										disabled={updatingId === row.id}
									>
										Ditolak
									</button>
								{/if}
							</div>

							<div class="flex items-center gap-1.5 ml-auto">
								{#if row.linked_so_id}
									<button
										type="button"
										class="h-8 px-2.5 rounded-xl text-[11px] font-bold bg-blue-600 text-white shadow-sm transition-transform active:scale-95 flex items-center gap-1"
										onclick={() => goto(`/sales/po/${row.linked_so_id}`)}
									>
										<span>Buka PO</span>
										<IconArrowRight size={13} />
									</button>
								{/if}
								<button
									type="button"
									class="h-8 px-3 rounded-xl text-[11px] font-bold text-white flex items-center gap-1 shadow-sm transition-transform active:scale-95"
									style="background: var(--p, var(--g))"
									onclick={() => goto(`/sales/penawaran/${row.id}`)}
								>
									Edit / Detail <IconArrowRight size={13} />
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

{#if actionError}
	<div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-rose-600 text-white text-[12px] font-bold shadow-lg flex items-center gap-2 max-w-[90vw]">
		<IconX size={15} />
		<span>{actionError}</span>
		<button type="button" class="ml-1 underline" onclick={() => (actionError = '')}>Tutup</button>
	</div>
{/if}

{#if waModalRow}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => { if (e.target === e.currentTarget) waModalRow = null; }}
		onkeydown={(e) => { if (e.key === 'Escape') waModalRow = null; }}
	>
		<div class="w-full max-w-sm rounded-2xl p-4 shadow-xl" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)">
			<div class="flex items-center justify-between mb-2">
				<h3 class="text-[14px] font-bold" style="color: var(--sys-label)">Nomor WhatsApp Customer</h3>
				<button type="button" onclick={() => (waModalRow = null)} style="color: var(--sys-label3)"><IconX size={16} /></button>
			</div>
			<p class="text-[11px] mb-2" style="color: var(--sys-label3)">
				Nomor WA untuk penawaran <strong>{waModalRow.nomor_penawaran}</strong> tidak ditemukan di data customer. Masukkan manual:
			</p>
			<input
				type="tel"
				class="w-full h-10 px-3 rounded-lg border text-[13px] mb-3"
				style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
				placeholder="cth. 0812xxxxxxx atau 62812xxxxxxx"
				bind:value={waManualNumber}
			/>
			<div class="flex gap-2">
				<button
					type="button"
					class="flex-1 h-10 rounded-lg text-[12px] font-bold"
					style="background: var(--sys-fill); color: var(--sys-label)"
					onclick={() => (waModalRow = null)}
				>
					Batal
				</button>
				<button
					type="button"
					class="flex-1 h-10 rounded-lg text-[12px] font-bold text-white flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700"
					onclick={sendManualWa}
				>
					<IconBrandWhatsapp size={15} /> Buka WhatsApp
				</button>
			</div>
		</div>
	</div>
{/if}
