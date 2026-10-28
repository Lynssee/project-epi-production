<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Riwayat Perbaikan Unit (read-only) — Penajaman Pembelian v3 Fase 7.
	// TANPA NOMINAL RUPIAH (keputusan user): status & kuantitas saja.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		searchEquipmentSimple,
		getUnitRepairHistory,
		type UnitRepairHistory
	} from '$lib/services/maintenance';
	import IconArrowLeft from '@tabler/icons-svelte/icons/arrow-left';
	import IconLoader2 from '@tabler/icons-svelte/icons/loader-2';
	import IconTool from '@tabler/icons-svelte/icons/tool';
	import IconSearch from '@tabler/icons-svelte/icons/search';
	import IconAlertTriangle from '@tabler/icons-svelte/icons/alert-triangle';
	import IconShare2 from '@tabler/icons-svelte/icons/share-2';
	import FieldExportSheet from '$lib/components/shared/FieldExportSheet.svelte';

	let showExportSheet = $state(false);

	let canAccess = $derived(
		$authStore.roleId === 'super_admin' ||
		$authStore.roleIds?.includes('super_admin') ||
		hasPermission($authStore.roleId, 'input_maintenance', $rolesStore, $authStore.roleIds)
	);

	$effect(() => {
		if ($authStore.checked && !canAccess) goto('/');
	});

	let term = $state('');
	let list = $state<{ id: string; code: string | null; name: string | null }[]>([]);
	let searching = $state(false);
	let loading = $state(false);
	let data = $state<UnitRepairHistory | null>(null);
	let selectedId = $state('');

	async function doSearch() {
		searching = true;
		try {
			list = await searchEquipmentSimple(term.trim());
		} finally {
			searching = false;
		}
	}
	onMount(doSearch);

	async function pick(id: string) {
		selectedId = id;
		loading = true;
		data = null;
		try {
			data = await getUnitRepairHistory(id);
		} finally {
			loading = false;
		}
	}

	function fmt(iso: string | null) {
		if (!iso) return '-';
		return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	// F3 (Fase 4 "Export Maintenance v2" rencana) — Riwayat perbaikan unit, PDF saja
	// (dokumen per-unit untuk dilampirkan/ditunjukkan, bukan diolah lanjut).
	const exportColumns = [
		{ key: 'wo', label: 'WO' },
		{ key: 'jenis', label: 'Jenis' },
		{ key: 'keluhan', label: 'Keluhan' },
		{ key: 'rusak', label: 'Rusak' },
		{ key: 'selesai', label: 'Selesai' },
		{ key: 'downtime', label: 'Downtime (hari)' },
		{ key: 'status', label: 'Status' }
	];
	let exportRows = $derived(
		(data?.work_orders || []).map((w) => ({
			wo: w.wo_number || '-',
			jenis: w.is_preventive ? 'Preventif' : 'Korektif',
			keluhan: w.keluhan || '-',
			rusak: fmt(w.tanggal_rusak),
			selesai: fmt(w.tanggal_done),
			downtime: w.downtime_days || 0,
			status: w.status_label
		}))
	);
</script>

<div class="max-w-3xl mx-auto p-4 pb-24">
	<button
		class="flex items-center gap-1.5 text-[12px] font-medium mb-3"
		style="color: var(--sys-label3)"
		onclick={() => goto('/maintenance')}
	>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold flex items-center gap-2 mb-1" style="color: var(--sys-label)">
		<IconTool size={18} /> Riwayat Perbaikan Unit
	</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label4)">
		Riwayat Work Order per unit — status, tanggal, downtime. Tanpa nominal biaya (lihat dashboard admin untuk angka).
	</p>

	<!-- Pencari unit -->
	<div class="flex gap-2 mb-3">
		<div class="flex-1 relative">
			<IconSearch size={15} class="absolute left-2.5 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
			<input
				class="w-full pl-8 pr-3 py-2 rounded-lg border text-[13px]"
				style="border-color: var(--sys-sep)"
				placeholder="Cari nama / kode unit…"
				bind:value={term}
				oninput={doSearch}
			/>
		</div>
	</div>

	{#if !data}
		<div class="bg-white rounded-xl border overflow-hidden" style="border-color: var(--sys-sep)">
			{#if searching}
				<div class="flex justify-center py-10"><IconLoader2 size={20} class="animate-spin" style="color: var(--sys-label4)" /></div>
			{:else if list.length === 0}
				<div class="p-6 text-center text-[12px] italic" style="color: var(--sys-label4)">Tidak ada unit cocok.</div>
			{:else}
				<ul class="divide-y divide-gray-50">
					{#each list as eq (eq.id)}
						<li>
							<button class="w-full text-left px-4 py-2.5 hover:bg-gray-50/60 flex items-center justify-between" onclick={() => pick(eq.id)}>
								<span class="text-[13px] font-medium" style="color: var(--sys-label)">{eq.name}</span>
								<span class="text-[11px]" style="color: var(--sys-label4)">{eq.code || '-'}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if loading}
		<div class="flex flex-col items-center justify-center py-12">
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat riwayat servis unit..." />
	</div>
	{:else if data}
		<button class="text-[11px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => { data = null; selectedId = ''; }}>
			← pilih unit lain
		</button>

		{#if !data.equipment}
			<div class="p-4 rounded-xl bg-gray-50 text-[12px] text-center" style="color: var(--sys-label4)">Unit tidak ditemukan.</div>
		{:else}
			<div class="bg-white rounded-xl border p-4 mb-3" style="border-color: var(--sys-sep)">
				<div class="flex items-center justify-between gap-2">
					<div class="min-w-0">
						<p class="text-[14px] font-bold" style="color: var(--sys-label)">{data.equipment.name}</p>
						<p class="text-[11px]" style="color: var(--sys-label4)">
							{data.equipment.code || '-'} · {data.equipment.brand || '-'} · {data.equipment.last_hoursmeter.toLocaleString('id-ID')} jam
						</p>
					</div>
					<div class="flex items-center gap-2 shrink-0">
						{#if data.equipment.is_critical}
							<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1" style="background:var(--rel);color:var(--red)">
								<IconAlertTriangle size={11} /> Unit Kritis
							</span>
						{/if}
						<button
							onclick={() => (showExportSheet = true)}
							title="Bagikan riwayat unit sebagai PDF"
							class="flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg border"
							style="border-color: var(--sys-sep); color: var(--sys-label3)"
						>
							<IconShare2 size={13} /> Ekspor
						</button>
					</div>
				</div>
			</div>

			<!-- Ringkasan -->
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
				<div class="bg-white rounded-xl border p-3" style="border-color: var(--sys-sep)">
					<p class="text-[10px]" style="color: var(--sys-label4)">Total Work Order</p>
					<p class="text-[16px] font-bold" style="color: var(--sys-label)">{data.counts.total}</p>
				</div>
				<div class="bg-white rounded-xl border p-3" style="border-color: var(--sys-sep)">
					<p class="text-[10px]" style="color: var(--sys-label4)">Preventif / Korektif</p>
					<p class="text-[16px] font-bold" style="color: var(--sys-label)">{data.counts.preventive} / {data.counts.corrective}</p>
				</div>
				<div class="bg-white rounded-xl border p-3" style="border-color: var(--sys-sep)">
					<p class="text-[10px]" style="color: var(--sys-label4)">Total Downtime</p>
					<p class="text-[16px] font-bold" style="color: var(--sys-label)">{data.counts.downtime_days} hari</p>
				</div>
				<div class="bg-white rounded-xl border p-3" style="border-color: var(--sys-sep)">
					<p class="text-[10px]" style="color: var(--sys-label4)">Servis Bengkel Luar</p>
					<p class="text-[16px] font-bold" style="color: var(--sys-label)">{data.counts.external_repairs}×</p>
				</div>
			</div>

			<!-- Daftar WO -->
			<div class="bg-white rounded-xl border overflow-hidden" style="border-color: var(--sys-sep)">
				<table class="w-full text-left text-[12px]">
					<thead>
						<tr class="bg-gray-50 border-b text-gray-400 font-semibold uppercase tracking-wider text-[10px]" style="border-color: var(--sys-sep)">
							<th class="p-3">WO</th>
							<th class="p-3">Jenis</th>
							<th class="p-3">Keluhan</th>
							<th class="p-3">Rusak</th>
							<th class="p-3">Selesai</th>
							<th class="p-3 text-center">Downtime</th>
							<th class="p-3">Status</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-50">
						{#if data.work_orders.length === 0}
							<tr><td colspan="7" class="p-6 text-center italic" style="color: var(--sys-label4)">Unit ini belum punya riwayat Work Order.</td></tr>
						{:else}
							{#each data.work_orders as w (w.id)}
								<tr class="hover:bg-gray-50/50">
									<td class="p-3 font-medium" style="color: var(--sys-label)">{w.wo_number || '-'}</td>
									<td class="p-3">
										<span class="text-[10px] px-1.5 py-0.5 rounded-full" style={w.is_preventive ? 'background:var(--gg);color:var(--ggd)' : 'background:#DBEAFE;color:#1E40AF'}>
											{w.is_preventive ? 'Preventif' : 'Korektif'}
										</span>
									</td>
									<td class="p-3" style="color: var(--sys-label3)">{w.keluhan || '-'}</td>
									<td class="p-3 whitespace-nowrap" style="color: var(--sys-label3)">{fmt(w.tanggal_rusak)}</td>
									<td class="p-3 whitespace-nowrap" style="color: var(--sys-label3)">{fmt(w.tanggal_done)}</td>
									<td class="p-3 text-center" style="color: var(--sys-label3)">{w.downtime_days || 0} hr</td>
									<td class="p-3" style="color: var(--sys-label3)">{w.status_label}</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>

{#if data?.equipment}
	<FieldExportSheet
		open={showExportSheet}
		onClose={() => (showExportSheet = false)}
		judul={`Riwayat Perbaikan — ${data.equipment.name}`}
		filename={`riwayat-unit-${selectedId}`}
		columns={exportColumns}
		rows={exportRows}
		formats={['pdf']}
		landscape={true}
	/>
{/if}
