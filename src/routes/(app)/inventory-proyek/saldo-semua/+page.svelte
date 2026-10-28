<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Saldo Stok Semua Proyek (Fase 3 — Rencana "Integrasi Status Stok Site Proyek (PIC) & Log
	// Penggunaan Material pada Pengeluaran Barang"). Beda dari kritis-terpusat (hanya status
	// low/critical): halaman ini menampilkan SEMUA barang yang masih ada (qty_on_hand > 0) di
	// proyek yang dipegang user, termasuk yang statusnya normal — supaya leader bisa mengecek
	// "masih ada di sudut kontainer" sebelum mengajukan pengiriman/pembelian baru.
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconSearch, IconDownload } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getAllStockBalancesForProjects, type LowStockBalanceRow } from '$lib/services/projectStockBalanceApi';
	import FieldExportSheet from '$lib/components/shared/FieldExportSheet.svelte';
	import type { CsvColumn } from '$lib/utils/exportCsv';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let rows = $state<LowStockBalanceRow[]>([]);
	let search = $state('');
	let projectFilter = $state<number | 'all'>('all');
	let ownershipFilter = $state<'all' | 'eltama' | 'subcon' | 'customer' | 'sewa_vendor'>('all');

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(false, { limit: -1 })) || [];
			const projectIds = projects.map((p) => p.id);
			rows = await getAllStockBalancesForProjects(projectIds);
		} finally {
			loading = false;
		}
	}

	function projectName(projectId: number) {
		return projects.find((p) => p.id === projectId)?.name || `Proyek #${projectId}`;
	}

	let filteredRows = $derived(
		rows.filter((r) => {
			if (projectFilter !== 'all' && r.project_id !== projectFilter) return false;
			if (ownershipFilter !== 'all' && (r.ownership_type || 'eltama') !== ownershipFilter) return false;
			if (search.trim() && !r.item_name.toLowerCase().includes(search.trim().toLowerCase())) return false;
			return true;
		})
	);

	let exportOpen = $state(false);
	const EXPORT_COLUMNS: CsvColumn[] = [
		{ key: 'proyek', label: 'Proyek' },
		{ key: 'item', label: 'Item' },
		{ key: 'satuan', label: 'Satuan' },
		{ key: 'qty_di_tangan', label: 'Qty di Tangan' },
		{ key: 'rab_qty', label: 'RAB Qty' },
		{ key: 'status', label: 'Status' },
		{ key: 'update_terakhir', label: 'Update Terakhir' }
	];
	let exportRows = $derived(
		filteredRows.map((r) => ({
			proyek: projectName(r.project_id),
			item: r.item_name,
			satuan: r.item_satuan,
			qty_di_tangan: r.qty_on_hand,
			rab_qty: r.rab_qty,
			status: STATUS_LABEL[r.status] || r.status,
			update_terakhir: fmtDate(r.last_movement_date)
		}))
	);

	function fmtDate(d: string | null) {
		return d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' }) : '-';
	}

	const STATUS_BADGE: Record<string, string> = {
		critical: 'bg-rose-100 text-rose-700',
		low: 'bg-amber-100 text-amber-700',
		normal: 'bg-emerald-100 text-emerald-700',
		over_rab: 'bg-sky-100 text-sky-700'
	};
	const STATUS_LABEL: Record<string, string> = {
		critical: 'Stok Kritis',
		low: 'Stok Rendah',
		normal: 'Cukup',
		over_rab: 'Lebih dari RAB'
	};
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
	<div>
		<a href="/inventory-proyek/opname" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
			<IconArrowLeft size={14} /> Inventaris Proyek
		</a>
		<h1 class="text-xl font-bold text-gray-900">Saldo Stok Semua Proyek</h1>
		<p class="text-sm text-gray-500">
			Cek dulu barang yang masih ada di site sebelum mengajukan pengiriman/pembelian baru — mencegah pengajuan mendesak padahal masih tersimpan di kontainer.
		</p>
	</div>

	{#if !loading && rows.length > 0}
		<div class="space-y-2.5">
			<div class="flex flex-col sm:flex-row gap-2">
				<div class="relative flex-1">
					<IconSearch size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
					<input
						type="text"
						bind:value={search}
						placeholder="Cari nama barang..."
						class="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--g)]"
					/>
				</div>
				{#if projects.length > 1}
					<select bind:value={projectFilter} class="px-3 py-2 rounded-xl border border-gray-200 text-[13px]">
						<option value="all">Semua Proyek</option>
						{#each projects as p}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
				{/if}
			</div>

			<!-- Filter Pills Kepemilikan -->
			<div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
				<button
					class="whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-all {ownershipFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
					onclick={() => (ownershipFilter = 'all')}
				>
					Semua ({rows.length})
				</button>
				<button
					class="whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-all {ownershipFilter === 'eltama' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}"
					onclick={() => (ownershipFilter = 'eltama')}
				>
					🏢 Milik Eltama
				</button>
				<button
					class="whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-all {ownershipFilter === 'subcon' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}"
					onclick={() => (ownershipFilter = 'subcon')}
				>
					👷 Milik Subcon (Primantara)
				</button>
				<button
					class="whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-all {ownershipFilter === 'customer' ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'}"
					onclick={() => (ownershipFilter = 'customer')}
				>
					🤝 Milik Customer
				</button>
				<button
					class="whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-all {ownershipFilter === 'sewa_vendor' ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'}"
					onclick={() => (ownershipFilter = 'sewa_vendor')}
				>
					🔶 Sewa Vendor
				</button>
			</div>
			<button
				type="button"
				onclick={() => (exportOpen = true)}
				disabled={!filteredRows.length}
				class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-700 disabled:opacity-40"
				title="Ekspor saldo stok yang sedang tampil"
			>
				<IconDownload size={15} /> Ekspor
			</button>
		</div>
	{/if}

	<FieldExportSheet
		open={exportOpen}
		onClose={() => (exportOpen = false)}
		judul="Saldo Stok Semua Proyek"
		filename="saldo-stok-proyek"
		columns={EXPORT_COLUMNS}
		rows={exportRows}
		formats={['xlsx', 'csv', 'pdf']}
	/>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat saldo stok proyek..." />
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum ditugaskan ke proyek manapun.</p>
		</div>
	{:else if rows.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Belum ada saldo stok tercatat di proyek Anda.</p>
		</div>
	{:else if filteredRows.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Tidak ada barang yang cocok dengan filter atau pencarian.</p>
		</div>
	{:else}
		<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
			<table class="w-full text-[13px]">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Item</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Kepemilikan</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">Qty di Tangan</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">RAB Qty</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Status</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Update Terakhir</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each filteredRows as r (r.id)}
						<tr class="hover:bg-gray-50">
							<td class="px-4 py-3 font-medium text-gray-800">{projectName(r.project_id)}</td>
							<td class="px-4 py-3 text-gray-700">
								<div class="font-medium text-gray-900">{r.item_name}</div>
								<div class="text-[11px] text-gray-400">Satuan: {r.item_satuan || '-'}</div>
							</td>
							<td class="px-4 py-3">
								{#if r.ownership_type === 'subcon'}
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200" title="Milik Subcon - Tidak dihitung di HPP Eltama">
										👷 Subcon: {r.owner_name || 'Subcon'}
									</span>
								{:else if r.ownership_type === 'customer'}
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200" title="Milik Customer - Free issue">
										🤝 Customer: {r.owner_name || 'Customer'}
									</span>
								{:else if r.ownership_type === 'sewa_vendor'}
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-50 text-orange-700 border border-orange-200">
										🔶 Sewa Vendor
									</span>
								{:else}
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
										🏢 Milik Eltama
									</span>
								{/if}
							</td>
							<td class="px-4 py-3 text-right font-semibold text-gray-800">{r.qty_on_hand}</td>
							<td class="px-4 py-3 text-right text-gray-500">{r.rab_qty}</td>
							<td class="px-4 py-3 text-center">
								<span class="px-2.5 py-1 rounded-full text-xs font-semibold {STATUS_BADGE[r.status]}">{STATUS_LABEL[r.status]}</span>
							</td>
							<td class="px-4 py-3 text-center text-gray-500 text-[12px]">{fmtDate(r.last_movement_date)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
