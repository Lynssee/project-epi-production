<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Stok Kritis Terpusat (Fase 3 Modul Operasional Terpusat) — item dengan status stok
	// rendah/kritis lintas SEMUA proyek yang dipegang user. Baca collection project_stock_balance
	// yang SAMA PERSIS dipakai admin (erp-epi-1 MaterialLowStockInbox) — status dihitung
	// server-side saat rebuild (halaman ini hanya tampilan, tidak menghitung ulang ambang).
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconDownload } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getLowStockBalancesForProjects, type LowStockBalanceRow } from '$lib/services/projectStockBalanceApi';
	import FieldExportSheet from '$lib/components/shared/FieldExportSheet.svelte';
	import type { CsvColumn } from '$lib/utils/exportCsv';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let rows = $state<LowStockBalanceRow[]>([]);

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(false, { limit: -1 })) || [];
			const projectIds = projects.map((p) => p.id);
			rows = await getLowStockBalancesForProjects(projectIds);
		} finally {
			loading = false;
		}
	}

	function projectName(projectId: number) {
		return projects.find((p) => p.id === projectId)?.name || `Proyek #${projectId}`;
	}

	let critical = $derived(rows.filter((r) => r.status === 'critical').length);
	let low = $derived(rows.filter((r) => r.status === 'low').length);

	function fmtDate(d: string | null) {
		return d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' }) : '-';
	}

	const STATUS_BADGE: Record<string, string> = {
		critical: 'bg-rose-100 text-rose-700',
		low: 'bg-amber-100 text-amber-700'
	};
	const STATUS_LABEL: Record<string, string> = { critical: 'Stok Kritis', low: 'Stok Rendah' };

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
		rows.map((r) => ({
			proyek: projectName(r.project_id),
			item: r.item_name,
			satuan: r.item_satuan,
			qty_di_tangan: r.qty_on_hand,
			rab_qty: r.rab_qty,
			status: STATUS_LABEL[r.status] || r.status,
			update_terakhir: fmtDate(r.last_movement_date)
		}))
	);
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
	<div>
		<a href="/inventory-proyek/opname" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
			<IconArrowLeft size={14} /> Inventaris Proyek
		</a>
		<h1 class="text-xl font-bold text-gray-900">Stok Kritis Terpusat</h1>
		<p class="text-sm text-gray-500">Item stok rendah/kritis dari semua proyek yang Anda pegang.</p>
	</div>

	{#if !loading && rows.length > 0}
		<div class="flex flex-wrap items-center gap-2">
			<span class="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Kritis: {critical}</span>
			<span class="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Rendah: {low}</span>
			<button
				type="button"
				onclick={() => (exportOpen = true)}
				class="ml-auto flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 text-[12px] font-semibold text-gray-700"
				title="Ekspor daftar stok kritis"
			>
				<IconDownload size={14} /> Ekspor
			</button>
		</div>
	{/if}

	<FieldExportSheet
		open={exportOpen}
		onClose={() => (exportOpen = false)}
		judul="Stok Kritis Terpusat"
		filename="stok-kritis-proyek"
		columns={EXPORT_COLUMNS}
		rows={exportRows}
		formats={['xlsx', 'csv', 'pdf']}
	/>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat stok kritis proyek..." />
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum ditugaskan ke proyek manapun.</p>
		</div>
	{:else if rows.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Tidak ada item stok rendah/kritis di proyek Anda saat ini.</p>
		</div>
	{:else}
		<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
			<table class="w-full text-[13px]">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Item</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">Qty di Tangan</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">RAB Qty</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Status</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Update Terakhir</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each rows as r (r.id)}
						<tr class="hover:bg-gray-50">
							<td class="px-4 py-3 font-medium text-gray-800">{projectName(r.project_id)}</td>
							<td class="px-4 py-3 text-gray-700">{r.item_name} <span class="text-gray-400">({r.item_satuan})</span></td>
							<td class="px-4 py-3 text-right font-semibold {r.qty_on_hand < 0 ? 'text-red-600' : 'text-gray-800'}">{r.qty_on_hand}</td>
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
