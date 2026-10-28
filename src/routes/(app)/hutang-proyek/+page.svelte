<!-- src/routes/(app)/hutang-proyek/+page.svelte -->
<!-- PA-Rilis Hutang v2 (Fase 4) — daftar READ-ONLY tagihan supplier outstanding untuk
     proyek yang ditugaskan ke PL saat ini (Q5), + tombol "Ajukan Rilis" ke /anggaran/baru.
     Nol logic baru di sini — murni UI di atas fetchOutstandingPayablesForProject
     (finance.ts, Fase 4) + getProjectsForCurrentUser yang sudah ada. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { IconArrowLeft, IconLoader2, IconReceipt2 } from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { fetchOutstandingPayablesForProject, fetchPoItemsContext, fetchActiveRilisForInvoices } from '$lib/services/finance';
	import {
		deriveBarangStatus,
		BARANG_STATUS_LABEL,
		summarizeItemNames,
		paymentStageLabel,
		shouldOfferExpedite
	} from '$lib/utils/payableContext';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let rows = $state<any[]>([]);
	let projectNameById = $state<Record<string, string>>({});
	let poItems = $state<Record<string, any[]>>({});
	let activeRilisByInvoice = $state<Record<string, { pengajuanId: number; nomorPengajuan: string | null; status: string; label: string }>>({});

	// Filter Fase 4 (Lifecycle Hutang): per proyek + status fisik barang. 'all' = tampilkan semua.
	let selectedProjectId = $state<string>('all');
	let selectedBarangFilter = $state<'all' | 'diterima' | 'belum_lengkap'>('all');

	onMount(async () => {
		try {
			projects = (await getProjectsForCurrentUser(true)) || [];
			projectNameById = Object.fromEntries(projects.map((p) => [String(p.id), p.name]));
			rows = await fetchOutstandingPayablesForProject(projects.map((p) => p.id));
			const [poItemsResult, rilisResult] = await Promise.all([
				fetchPoItemsContext(rows.map((r) => (typeof r.supplier_po_id === 'object' ? r.supplier_po_id?.id : r.supplier_po_id))),
				fetchActiveRilisForInvoices(rows.map((r) => r.id))
			]);
			poItems = poItemsResult;
			activeRilisByInvoice = rilisResult;
		} catch (e) {
			console.error('Gagal memuat hutang proyek:', e);
		} finally {
			loading = false;
		}
	});

	function poIdOf(row: any): string {
		return String(typeof row.supplier_po_id === 'object' ? row.supplier_po_id?.id : row.supplier_po_id);
	}
	function itemsOf(row: any): any[] {
		return row.supplier_po_id ? poItems[poIdOf(row)] || [] : [];
	}
	function barangStatusOf(row: any) {
		return deriveBarangStatus(itemsOf(row));
	}
	function activeRilisOf(row: any) {
		return activeRilisByInvoice[String(row.id)] || null;
	}

	let filteredRows = $derived(
		rows.filter((row) => {
			if (selectedProjectId !== 'all' && String(row.project_id) !== selectedProjectId) return false;
			if (selectedBarangFilter === 'diterima' && barangStatusOf(row) !== 'diterima') return false;
			if (selectedBarangFilter === 'belum_lengkap' && !['belum', 'sebagian'].includes(barangStatusOf(row))) return false;
			return true;
		})
	);

	function overdueDays(row: any): number | null {
		if (!row.due_date) return null;
		return Math.floor((Date.now() - new Date(row.due_date).getTime()) / 86400000);
	}
	function overdueClass(days: number | null): string {
		if (days === null) return 'text-gray-400';
		if (days <= 0) return 'text-emerald-600';
		if (days <= 30) return 'text-amber-600';
		return 'text-red-600';
	}
	const fmtRp = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

	function ajukanRilis(row: any) {
		goto(`/anggaran/baru?kategori=rilis_hutang&invoice_id=${row.id}&project_id=${row.project_id}`);
	}
</script>

<div class="flex-1 flex flex-col h-full">
	<div class="scroll-body px-4 py-4 max-w-3xl mx-auto w-full space-y-3">
		<div class="mb-2">
			<button
				type="button"
				onclick={() => goto('/anggaran')}
				class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
			>
				<IconArrowLeft size={16} />
				<span>Kembali ke Anggaran</span>
			</button>
			<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
				<IconReceipt2 size={20} class="text-[var(--p)]" /> Hutang Proyek
			</h2>
		</div>
		<p class="text-[12px] text-gray-500">
			Tagihan supplier yang belum lunas untuk proyek yang Anda pegang. Halaman ini
			bukan daftar yang harus dibayar hari ini — hanya daftar tagihan tercatat.
			Ajukan rilis kalau Anda perlu Finance segera membayar salah satunya.
		</p>

		{#if !loading && rows.length > 0}
			<div class="flex flex-wrap items-center gap-2" title="Filter daftar di bawah — tidak mengubah data, hanya tampilan">
				{#if projects.length > 1}
					<select
						bind:value={selectedProjectId}
						class="text-[11px] px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
					>
						<option value="all">Semua Proyek</option>
						{#each projects as p}
							<option value={String(p.id)}>{p.name}</option>
						{/each}
					</select>
				{/if}
				<select
					bind:value={selectedBarangFilter}
					class="text-[11px] px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
					title="Belum Lengkap = barang belum/sebagian diterima — biasanya ini yang perlu diprioritaskan diajukan rilis/percepatan"
				>
					<option value="all">Semua Status Barang</option>
					<option value="diterima">Barang Sudah Diterima</option>
					<option value="belum_lengkap">Barang Belum Lengkap</option>
				</select>
			</div>
		{/if}

		{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat hutang proyek..." />
		</div>
		{:else if rows.length === 0}
			<div class="card-section text-[12px] text-gray-500 leading-relaxed">
				Belum ada tagihan supplier yang tertaut ke proyek ini. Banyak tagihan pembelian
				lama belum tertaut proyek — hubungi Finance kalau kamu tahu ada tagihan proyek ini.
			</div>
		{:else if filteredRows.length === 0}
			<div class="card-section text-[12px] text-gray-500 leading-relaxed">
				Tidak ada tagihan yang cocok dengan filter ini.
			</div>
		{:else}
			<div class="space-y-2">
				{#each filteredRows as row}
					{@const days = overdueDays(row)}
					<div class="card-section flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="text-sm font-semibold text-gray-900">{row.invoice_number}</span>
								<span class="text-xs text-gray-500 truncate">{row.supplier_name || 'Supplier'}</span>
							</div>
							<div class="text-[11px] text-gray-500 mt-0.5">
								{projectNameById[String(row.project_id)] || 'Proyek'}
							</div>
							<div class="text-[11px] text-gray-600 flex flex-wrap gap-x-3 mt-1">
								<span>Sisa: <strong>{fmtRp(row.outstanding_amount)}</strong></span>
								{#if row.due_date}
									<span class={overdueClass(days)}>
										Jatuh tempo {row.due_date}{days !== null && days > 0 ? ` (terlambat ${days} hari)` : ''}
									</span>
								{/if}
							</div>
							{#if itemsOf(row).length > 0}
								<div class="text-[11px] text-gray-600 mt-1">
									Barang: {summarizeItemNames(itemsOf(row))}
								</div>
							{/if}
							<div class="flex flex-wrap gap-1.5 mt-1.5">
								<span
									class="text-[10px] px-1.5 py-0.5 rounded font-semibold {barangStatusOf(row) === 'diterima'
										? 'bg-emerald-100 text-emerald-700'
										: barangStatusOf(row) === 'tidak_diketahui'
											? 'bg-gray-100 text-gray-500'
											: 'bg-amber-100 text-amber-700'}"
									title="Dihitung dari qty diterima di PO supplier"
								>
									{BARANG_STATUS_LABEL[barangStatusOf(row)]}
								</span>
								<span class="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-blue-100 text-blue-700">
									{paymentStageLabel(row)}
								</span>
								{#if activeRilisOf(row)}
									{@const rilis = activeRilisOf(row)}
									<span
										class="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-purple-100 text-purple-700"
										title="Pengajuan rilis yang sudah Anda/tim ajukan untuk tagihan ini — {rilis.nomorPengajuan || `PA #${rilis.pengajuanId}`}"
									>
										↳ PA-Rilis: {rilis.label}
									</span>
								{/if}
							</div>
						</div>
						{#if activeRilisOf(row)}
							{@const rilis = activeRilisOf(row)}
							<button
								type="button"
								class="shrink-0 px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
								title="Sudah ada pengajuan rilis aktif untuk tagihan ini — tidak bisa ajukan lagi sampai pengajuan ini selesai/ditolak. Klik untuk lihat detailnya."
								onclick={() => goto(`/anggaran/${rilis.pengajuanId}`)}
							>
								Lihat PA-Rilis
							</button>
						{:else}
							<button
								type="button"
								class="shrink-0 px-3 py-1.5 text-xs font-semibold bg-purple-600 text-white rounded-lg hover:bg-purple-700"
								title={shouldOfferExpedite(barangStatusOf(row))
									? 'Barang belum lengkap diterima — minta Finance mempercepat pembayaran ke supplier'
									: 'Ajukan Finance untuk membayar tagihan ini'}
								onclick={() => ajukanRilis(row)}
							>
								{shouldOfferExpedite(barangStatusOf(row)) ? 'Minta Percepatan Bayar' : 'Ajukan Rilis'}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
