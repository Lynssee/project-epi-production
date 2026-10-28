<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Barang Menganggur Lintas Proyek — Uji Kebutuhan Beli Fase 4.3 (5 Sep 2026).
	// "Sisi pasok" kanal K4 mesin UKB: tanpa halaman ini, K4 hanya menemukan barang
	// yang KEBETULAN tercatat; dengan ini, PM aktif melihat & bisa menawarkan
	// barangnya sendiri ke proyek lain. Sibling dari kritis-terpusat, pola sama,
	// baca project_stock_balance yang SAMA PERSIS dipakai kanal K4 di admin
	// (purchaseNecessity.js). Murni tampilan -- tidak ada tombol "transfer" di sini
	// (alur permintaan+approval belum ada infrastrukturnya, lihat commit Fase 4.1).
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconCornerUpLeft, IconDownload } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getIdleBalancesForProjects, type IdleStockBalanceRow } from '$lib/services/projectStockBalanceApi';
	import directus from '$lib/services/directus';
	import { readItems } from '@directus/sdk';
	import FieldExportSheet from '$lib/components/shared/FieldExportSheet.svelte';
	import type { CsvColumn } from '$lib/utils/exportCsv';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let rows = $state<IdleStockBalanceRow[]>([]);
	// Fase 5 (§3.2 Rekomendasi #2, "1-Klik Auto-Draft Retur Barang Menganggur"): progres fisik
	// per proyek — dipakai murni untuk menawarkan tombol retur, TIDAK dihitung ulang di sini
	// (sumbernya field yang sama dengan yang dipakai laporan harian/timeline).
	let progressByProject = $state<Record<number, { total: number; target: number }>>({});

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(false, { limit: -1 })) || [];
			const projectIds = projects.map((p) => p.id);
			rows = await getIdleBalancesForProjects(projectIds, 30);

			// Query terpisah (Aturan Directus #2): progres fisik hanya untuk proyek yang
			// benar-benar punya barang menganggur, bukan seluruh proyek yang dipegang user.
			const idleProjectIds = [...new Set(rows.map((r) => r.project_id))];
			if (idleProjectIds.length > 0) {
				const progressRows = (await directus.request(
					readItems('projects', {
						fields: ['id', 'total_progress', 'target_progress'],
						filter: { id: { _in: idleProjectIds } },
						limit: -1
					})
				)) as any[];
				const map: Record<number, { total: number; target: number }> = {};
				for (const p of progressRows || []) {
					map[p.id] = { total: Number(p.total_progress) || 0, target: Number(p.target_progress) || 0 };
				}
				progressByProject = map;
			}
		} finally {
			loading = false;
		}
	}

	function projectName(projectId: number) {
		return projects.find((p) => p.id === projectId)?.name || `Proyek #${projectId}`;
	}

	/** true bila progres fisik proyek >= 90% (dan target_progress > 0, hindari 0/0 = false positive). */
	function isProjectNearDone(projectId: number): boolean {
		const p = progressByProject[projectId];
		if (!p || p.target <= 0) return false;
		return p.total / p.target >= 0.9;
	}

	let projectsNearDoneWithIdle = $derived(
		[...new Set(rows.map((r) => r.project_id))].filter((pid) => isProjectNearDone(pid))
	);

	function returDraftHref(projectId: number): string {
		const itemIds = rows.filter((r) => r.project_id === projectId).map((r) => r.item_id);
		return `/packing-list/return?projectId=${projectId}&preselect=${itemIds.join(',')}`;
	}

	function fmtDate(d: string | null) {
		return d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' }) : '-';
	}

	let exportOpen = $state(false);
	const EXPORT_COLUMNS: CsvColumn[] = [
		{ key: 'proyek', label: 'Proyek' },
		{ key: 'item', label: 'Item' },
		{ key: 'satuan', label: 'Satuan' },
		{ key: 'qty_di_tangan', label: 'Qty di Tangan' },
		{ key: 'sejak_bergerak', label: 'Sejak Bergerak' }
	];
	let exportRows = $derived(
		rows.map((r) => ({
			proyek: projectName(r.project_id),
			item: r.item_name,
			satuan: r.item_satuan,
			qty_di_tangan: r.qty_on_hand,
			sejak_bergerak: r.hari_menganggur != null ? `${r.hari_menganggur} hari (${fmtDate(r.last_movement_date)})` : 'Belum pernah bergerak'
		}))
	);
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
	<div>
		<a href="/inventory-proyek/opname" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
			<IconArrowLeft size={14} /> Inventaris Proyek
		</a>
		<h1 class="text-xl font-bold text-gray-900">Barang Menganggur Lintas Proyek</h1>
		<p class="text-sm text-gray-500">
			Barang di proyek Anda yang masih tercatat ada (qty &gt; 0) tapi tidak bergerak &gt;30 hari — pertimbangkan tawarkan ke proyek lain sebelum mereka membeli baru.
		</p>
	</div>

	{#if !loading && rows.length > 0}
		<div class="rounded-xl p-3 bg-blue-50 border border-blue-200 text-[12px] text-blue-800">
			ⓘ Barang di sini otomatis ikut dipertimbangkan sistem Uji Kebutuhan Beli saat proyek lain mengajukan pembelian barang yang sama — koordinasikan langsung dengan PM proyek yang membutuhkan.
		</div>
		<button
			type="button"
			onclick={() => (exportOpen = true)}
			class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 text-[12px] font-semibold text-gray-700"
			title="Ekspor daftar barang menganggur"
		>
			<IconDownload size={14} /> Ekspor
		</button>
	{/if}

	<FieldExportSheet
		open={exportOpen}
		onClose={() => (exportOpen = false)}
		judul="Barang Menganggur Lintas Proyek"
		filename="barang-menganggur-proyek"
		columns={EXPORT_COLUMNS}
		rows={exportRows}
		formats={['xlsx', 'csv', 'pdf']}
	/>

	{#if !loading && projectsNearDoneWithIdle.length > 0}
		<div class="space-y-2">
			{#each projectsNearDoneWithIdle as pid}
				<div class="rounded-xl p-3 bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-2">
					<p class="text-[12px] text-emerald-800 m-0">
						🏁 <strong>{projectName(pid)}</strong> sudah &gt;90% progres dan masih ada barang menganggur di site — pertimbangkan buat draf pengembalian sekarang sebelum proyek ditutup.
					</p>
					<a
						href={returDraftHref(pid)}
						class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold shrink-0"
						title="Buka form Retur Barang dengan proyek & item ini sudah tercentang otomatis — tinggal ditinjau sebelum kirim."
					>
						<IconCornerUpLeft size={14} /> Buat Draft Retur
					</a>
				</div>
			{/each}
		</div>
	{/if}

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat barang menganggur proyek..." />
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum ditugaskan ke proyek manapun.</p>
		</div>
	{:else if rows.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Tidak ada barang menganggur di proyek Anda saat ini.</p>
		</div>
	{:else}
		<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
			<table class="w-full text-[13px]">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Item</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">Qty di Tangan</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Sejak Bergerak</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each rows as r (r.id)}
						<tr class="hover:bg-gray-50">
							<td class="px-4 py-3 font-medium text-gray-800">{projectName(r.project_id)}</td>
							<td class="px-4 py-3 text-gray-700">{r.item_name} <span class="text-gray-400">({r.item_satuan})</span></td>
							<td class="px-4 py-3 text-right font-semibold text-gray-800">{r.qty_on_hand}</td>
							<td class="px-4 py-3 text-center text-gray-500 text-[12px]">
								{r.hari_menganggur != null ? `${r.hari_menganggur} hari (${fmtDate(r.last_movement_date)})` : 'Belum pernah bergerak'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
