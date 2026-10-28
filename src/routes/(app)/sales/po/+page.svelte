<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ProcessGuideLink from '$lib/components/help/ProcessGuideLink.svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getMySOsAwaitingPO, getAllMySOs, getMyPoStatusSummary, type SOAwaitingPO } from '$lib/services/salesPo';
	import { getUpcomingFollowUps, getSalesVisitKpis } from '$lib/services/sales';
	import { registerPoUploadAutoFlush, flushPoUploadQueue } from '$lib/utils/offlineSalesPoQueue';
	import { uploadPoDocument } from '$lib/services/salesPo';
	import SalesNavTabs from '$lib/components/sales/SalesNavTabs.svelte';
	import FieldExportButton from '$lib/components/sales/FieldExportButton.svelte';
	import { IconFileUpload, IconLoader2, IconWifiOff, IconQrcode, IconSearch, IconX, IconChevronRight, IconAlertTriangle } from '@tabler/icons-svelte';
	import QrScannerModal from '$lib/components/scanner/QrScannerModal.svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';

	let loading = $state(true);
	let errorMsg = $state('');
	let rows = $state<SOAwaitingPO[]>([]);
	let allRows = $state<SOAwaitingPO[]>([]);
	let poTab = $state<'awaiting' | 'all'>('awaiting');
	let isOnline = $state(true);
	let showScanner = $state(false);
	let scanNotFound = $state('');
	let searchQuery = $state('');

	let remindersCount = $state(0);
	let poNeedsAttention = $state(0);
	let pendingVisits = $state(0);

	function onSoQrDetect(value: string) {
		showScanner = false;
		const parsed = parseEpiQr(value);
		if (!parsed || parsed.type !== 'SO') {
			scanNotFound = 'Kode QR ini bukan kode SO yang dikenali.';
			return;
		}
		const match = rows.find((r) => r.id === Number(parsed.id));
		if (match) {
			scanNotFound = '';
			goto(`/sales/po/${match.id}`);
		} else {
			scanNotFound = `SO #${parsed.id} tidak ada di daftar PO Anda yang menunggu — mungkin sudah lengkap, atau bukan milik Anda.`;
		}
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	function formatRupiah(n: number): string {
		return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	}

	function fmtDate(ts: string | null): string {
		if (!ts) return '—';
		return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	async function loadRows() {
		const karyawanId = $authStore.karyawanId;
		const salesName = $authStore.karyawanName;
		if (!karyawanId) {
			errorMsg = 'Data karyawan tidak ditemukan untuk akun ini. Hubungi admin.';
			loading = false;
			return;
		}
		loading = true;
		errorMsg = '';
		try {
			const [soList, allList, reminderList, kpiData, poSummary] = await Promise.all([
				getMySOsAwaitingPO(karyawanId),
				getAllMySOs(karyawanId),
				getUpcomingFollowUps(salesName),
				getSalesVisitKpis(karyawanId),
				getMyPoStatusSummary(karyawanId)
			]);
			rows = soList;
			allRows = allList;
			remindersCount = reminderList.length;
			pendingVisits = kpiData.menungguVerifikasi;
			poNeedsAttention = (poSummary.belum_ada || 0) + (poSummary.revisi || 0);
		} catch (e: any) {
			errorMsg = e.message;
		} finally {
			loading = false;
		}
	}

	async function sendQueuedEntry(entry: any) {
		await uploadPoDocument(entry.soId, entry.photoBlob, entry.photoName, entry.uploadedBy);
	}

	onMount(() => {
		isOnline = navigator.onLine;
		window.addEventListener('online', () => (isOnline = true));
		window.addEventListener('offline', () => (isOnline = false));
		registerPoUploadAutoFlush(sendQueuedEntry);
		flushPoUploadQueue(sendQueuedEntry).then(loadRows);
		loadRows();
	});

	let activeRows = $derived(poTab === 'awaiting' ? rows : allRows);
	let filteredRows = $derived.by(() => {
		if (!searchQuery.trim()) return activeRows;
		const q = searchQuery.trim().toLowerCase();
		return activeRows.filter(
			(r) =>
				(r.nomor_so && r.nomor_so.toLowerCase().includes(q)) ||
				(r.customer_name && r.customer_name.toLowerCase().includes(q)) ||
				(r.kode_customer && r.kode_customer.toLowerCase().includes(q))
		);
	});

	// Fase 6 §9.2 — export lapangan: TANPA kolom nilai/harga (grand_total dibuang).
	let exportRows = $derived(
		filteredRows.map((r) => ({
			no_so: r.nomor_so ?? '',
			customer: r.customer_name ?? '',
			kode: r.kode_customer ?? '',
			status_po: r.po_status ?? '',
			catatan: r.po_verify_note ?? '',
			tgl_so: (r.tanggal_so ?? '').slice(0, 10)
		}))
	);
</script>

<svelte:head>
	<title>PO Customer Saya — EPI</title>
</svelte:head>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<!-- Header -->
		<div class="mb-4 flex items-start justify-between gap-3">
			<div>
				<h1 class="text-[18px] font-extrabold tracking-tight" style="color: var(--sys-label)">PO Customer Saya</h1>
				<p class="text-[11px] font-medium" style="color: var(--sys-label3)">
					Foto PO dari customer, unggah langsung dari lokasi customer
				</p>
				<div class="mt-1.5"><ProcessGuideLink fokus="so" /></div>
			</div>
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold text-white shrink-0 shadow-sm active:scale-95 transition-transform"
				style="background: #2563eb"
				onclick={() => { scanNotFound = ''; showScanner = true; }}
			>
				<IconQrcode size={16} /> Scan SO
			</button>
		</div>

		<!-- Nav Tabs Sub-Menu -->
		<SalesNavTabs
			active="po"
			{remindersCount}
			poCount={poNeedsAttention}
			pendingCount={pendingVisits}
		/>

		<div class="flex justify-end mb-3">
			<FieldExportButton
				rows={exportRows}
				filename="po-customer-saya"
				title="PO Customer Saya"
				label="Export CSV"
				offlineNote="Tanpa nilai rupiah. Berkas dibuat dari data yang sedang tampil."
			/>
		</div>

		<!-- Tab Switcher: Menunggu Dokumen PO vs Semua SO Saya -->
		<div class="flex items-center gap-1.5 p-1 rounded-2xl bg-black/5 dark:bg-white/5 mb-3.5">
			<button
				type="button"
				class="flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 {poTab === 'awaiting' ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}"
				onclick={() => (poTab = 'awaiting')}
			>
				<span>Perlu Dokumen PO</span>
				{#if rows.length > 0}
					<span class="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-mono">{rows.length}</span>
				{/if}
			</button>
			<button
				type="button"
				class="flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 {poTab === 'all' ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}"
				onclick={() => (poTab = 'all')}
			>
				<span>Semua SO &amp; Status Hilir</span>
				{#if allRows.length > 0}
					<span class="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-mono">{allRows.length}</span>
				{/if}
			</button>
		</div>

		<!-- Search Bar -->
		<div class="relative w-full mb-4">
			<span class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)">
				<IconSearch size={15} />
			</span>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Cari nomor SO, nama customer, kode..."
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

		{#if scanNotFound}
			<div class="flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-medium px-3 py-2.5 mb-3">
				{scanNotFound}
			</div>
		{/if}

		{#if showScanner}
			<QrScannerModal expectedPrefix="EPI:SO:" onDetect={onSoQrDetect} onClose={() => (showScanner = false)} />
		{/if}

		{#if !isOnline}
			<div class="flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-medium px-3 py-2.5 mb-3">
				<IconWifiOff size={16} />
				Tidak ada sinyal. Foto tersimpan di HP dan otomatis terkirim saat online.
			</div>
		{/if}

		{#if errorMsg}
			<div class="rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-semibold px-3 py-2.5 mb-3">
				{errorMsg}
			</div>
		{/if}

		{#if loading}
			<div class="py-16 flex justify-center">
				<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Sales Order..." sublabel="Sinkronisasi status SO & PO Directus" />
			</div>
		{:else if filteredRows.length === 0}
			<div class="text-center py-16 px-4 rounded-2xl border border-dashed my-2" style="border-color: var(--sys-sep); color: var(--sys-label3)">
				<IconFileUpload size={36} style="color: var(--sys-label4); margin: 0 auto" />
				<p class="text-[13px] font-bold mt-3" style="color: var(--sys-label)">
					{searchQuery ? 'Tidak ada SO yang cocok.' : poTab === 'awaiting' ? 'Semua dokumen PO sudah lengkap & terverifikasi!' : 'Belum ada data SO untuk akun sales Anda.'}
				</p>
				<p class="text-[11px] mt-1">
					{poTab === 'awaiting' ? 'Buka tab "Semua SO & Status Hilir" untuk memantau progres produksi & pengiriman.' : 'Hubungi admin sales untuk membuat SO terlebih dahulu.'}
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-2.5">
				{#each filteredRows as so (so.id)}
					<button
						type="button"
						class="w-full text-left rounded-2xl border p-4 flex items-center justify-between gap-3 active:scale-[0.99] transition-all hover:border-[var(--p,var(--g))] shadow-sm"
						style="border-color: var(--sys-sep); background: var(--sys-bg)"
						onclick={() => goto(`/sales/po/${so.id}`)}
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5 flex-wrap">
								<span class="font-mono text-[13px] font-bold" style="color: var(--sys-label)">{so.nomor_so}</span>
								{#if so.credit_status === 'hold'}
									<span class="text-[9px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold flex items-center gap-0.5">
										<IconAlertTriangle size={10} />
										<span>Credit Hold</span>
									</span>
								{/if}
								{#if so.po_status === 'revisi'}
									<span class="text-[9px] px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold">Revisi PO</span>
								{:else if so.po_status === 'terupload'}
									<span class="text-[9px] px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold">PO Menunggu Verifikasi</span>
								{:else if so.po_status === 'terverifikasi'}
									<span class="text-[9px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold">PO Valid</span>
								{:else}
									<span class="text-[9px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 font-bold">Belum Ada PO</span>
								{/if}
								{#if so.status === 'in_production'}
									<span class="text-[9px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold">Produksi</span>
								{:else if so.status === 'in_delivery' || so.status === 'delivered'}
									<span class="text-[9px] px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 font-bold">Pengiriman</span>
								{:else if so.status === 'completed' || so.status === 'paid'}
									<span class="text-[9px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold">Selesai</span>
								{/if}
							</div>
							<div class="text-[12px] font-semibold truncate mt-1" style="color: var(--sys-label2)">{so.customer_name || so.kode_customer}</div>
							{#if so.nomor_po_customer || so.penawaran_number}
								<div class="flex items-center gap-1.5 mt-1 text-[10.5px] text-slate-500 flex-wrap">
									{#if so.nomor_po_customer}
										<span class="font-mono bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded">PO: {so.nomor_po_customer}</span>
									{/if}
									{#if so.penawaran_number}
										<span class="font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded">SPH: {so.penawaran_number}</span>
									{/if}
								</div>
							{/if}
							{#if so.po_status === 'revisi' && so.po_verify_note}
								<div class="text-[11px] text-rose-600 dark:text-rose-400 mt-1">Perbaikan: {so.po_verify_note}</div>
							{/if}
						</div>
						<div class="text-right shrink-0">
							<div class="text-[13px] font-extrabold" style="color: var(--sys-label)">{formatRupiah(so.grand_total)}</div>
							<div class="text-[10px] mt-0.5" style="color: var(--sys-label3)">{fmtDate(so.tanggal_so || so.date_created)}</div>
							<div class="flex items-center justify-end gap-1 mt-1.5 text-blue-600 dark:text-blue-400 font-bold text-[11px]">
								{#if so.po_status === 'belum_ada' || so.po_status === 'revisi'}
									<IconFileUpload size={14} />
									<span>Unggah PO</span>
								{:else}
									<span>Detail Status</span>
									<IconChevronRight size={13} />
								{/if}
							</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
