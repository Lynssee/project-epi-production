<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { resolveOperatorId } from '$lib/services/preventive';
	import { getMyWorkOrders, getCategoryNamesMap, type WorkOrderRow } from '$lib/services/maintenance';
	import { getOperatorEquipment } from '$lib/services/preventive';
	import { IconTool, IconAlertTriangle, IconChevronRight, IconLoader2, IconClock, IconShare2 } from '@tabler/icons-svelte';
	import FieldExportSheet from '$lib/components/shared/FieldExportSheet.svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let workOrders = $state<WorkOrderRow[]>([]);
	let equipmentMap = $state<Record<string, any>>({});
	let categoryMap = $state<Record<string, string>>({});
	let statusFilter = $state('Aktif');
	let showExportSheet = $state(false);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_maintenance', roles)) {
			goto('/');
		}
	});

	function umurHari(tanggalRusak: string | null): number | null {
		if (!tanggalRusak) return null;
		const diff = Date.now() - new Date(tanggalRusak).getTime();
		return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
	}

	let filteredWorkOrders = $derived.by(() => {
		if (statusFilter === 'Semua') return workOrders;
		return workOrders.filter((wo) => {
			const statusName = (categoryMap[wo.order_status || ''] || '').toLowerCase();
			const isClosed = statusName.includes('closed') || statusName.includes('qc');
			return statusFilter === 'Aktif' ? !isClosed : isClosed;
		});
	});

	// F1 (Fase 4 "Export Maintenance v2" rencana) — Rekap WO Saya, csv + pdf.
	const exportColumns = [
		{ key: 'unit', label: 'Unit' },
		{ key: 'keluhan', label: 'Keluhan' },
		{ key: 'status', label: 'Status' },
		{ key: 'prioritas', label: 'Prioritas' },
		{ key: 'umur', label: 'Umur (hari)' },
		{ key: 'progress', label: 'Progress (%)' }
	];
	let exportRows = $derived(
		filteredWorkOrders.map((wo) => ({
			unit: equipmentMap[wo.equipment_id]?.name || wo.equipment_id,
			keluhan: wo.keluhan || '',
			status: categoryMap[wo.order_status || ''] || 'Open',
			prioritas: categoryMap[wo.kategori_perbaikan_id || ''] || '-',
			umur: umurHari(wo.tanggal_rusak) ?? '',
			progress: wo.progress ?? 0
		}))
	);

	onMount(async () => {
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama operator tidak ditemukan di sesi login.');
			const personnelId = await resolveOperatorId(karyawanName);

			workOrders = await getMyWorkOrders(personnelId);

			const equipmentIds = [...new Set(workOrders.map((w) => w.equipment_id).filter(Boolean))];
			const allEquipment = await getOperatorEquipment();
			const eqMap: Record<string, any> = {};
			for (const eq of allEquipment as any[]) if (equipmentIds.includes(eq.id)) eqMap[eq.id] = eq;
			equipmentMap = eqMap;

			const categoryIds = workOrders.flatMap((w) => [w.order_status, w.kategori_perbaikan_id, w.approval_status]);
			categoryMap = await getCategoryNamesMap(categoryIds);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat Work Order.';
		} finally {
			loading = false;
		}
	});
</script>

<div class="max-w-7xl mx-auto p-4 md:p-6 pb-20">
	<div class="flex items-start justify-between gap-3 mb-1">
		<h1 class="text-[18px] md:text-xl font-bold" style="color: var(--sys-label)">Work Order Saya</h1>
		<button
			onclick={() => (showExportSheet = true)}
			title="Bagikan rekap WO sebagai PDF/CSV"
			class="shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border"
			style="border-color: var(--sys-sep); color: var(--sys-label3)"
		>
			<IconShare2 size={13} /> Ekspor
		</button>
	</div>
	<p class="text-[12px] md:text-[14px] mb-4" style="color: var(--sys-label3)">Daftar perbaikan yang ditugaskan ke Anda</p>

	<div class="flex gap-2 mb-4">
		{#each ['Aktif', 'Selesai', 'Semua'] as f}
			<button
				class="px-3 py-1.5 rounded-full text-[12px] font-semibold border"
				style={statusFilter === f ? 'background: var(--g); color: #fff; border-color: var(--g)' : 'border-color: var(--sys-sep); color: var(--sys-label3)'}
				onclick={() => statusFilter = f}
			>
				{f}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat daftar work order..." />
		</div>
	{:else if errorMsg}
		<div class="text-center py-16 text-[13px]" style="color: #DC2626">{errorMsg}</div>
	{:else if filteredWorkOrders.length === 0}
		<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">Belum ada Work Order untuk kategori ini.</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
			{#each filteredWorkOrders as wo (wo.id)}
				{@const equipment = equipmentMap[wo.equipment_id]}
				{@const prioritas = categoryMap[wo.kategori_perbaikan_id || ''] || '-'}
				{@const statusName = categoryMap[wo.order_status || ''] || 'Open'}
				{@const hari = umurHari(wo.tanggal_rusak)}
				<div
					class="w-full text-left rounded-xl border p-3.5 cursor-pointer transition-all hover:shadow-sm hover:-translate-y-0.5 active:opacity-70"
					style="border-color: var(--sys-sep); background: var(--sys-bg-secondary, #fff)"
					role="button"
					tabindex="0"
					onclick={() => goto(`/maintenance/work-order/${wo.id}`)}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') goto(`/maintenance/work-order/${wo.id}`); }}
				>
					<div class="flex items-start gap-3">
						<div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background: var(--gl)">
							<IconTool size={18} style="color: var(--g)" />
						</div>
						<div class="flex-1 min-w-0">
							<p class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{equipment?.name || wo.equipment_id}</p>
							<p class="text-[12px] mt-0.5 line-clamp-2" style="color: var(--sys-label3)">{wo.keluhan}</p>
							<div class="flex items-center gap-2 mt-2 flex-wrap">
								<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:var(--pl); color:var(--pd)">{statusName}</span>
								{#if prioritas.toLowerCase() === 'darurat'}
									<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:var(--rel); color:var(--red)">
										<IconAlertTriangle size={11} /> {prioritas}
									</span>
								{:else}
									<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:var(--aml); color:var(--amd)">{prioritas}</span>
								{/if}
								{#if hari !== null}
									<span class="inline-flex items-center gap-1 text-[10px]" style="color: var(--sys-label4)">
										<IconClock size={11} /> {hari} hari
									</span>
								{/if}
							</div>
							<div class="mt-2 w-full h-1.5 rounded-full" style="background: var(--sys-fill)">
								<div class="h-1.5 rounded-full" style="width: {wo.progress || 0}%; background: var(--g)"></div>
							</div>
						</div>
						<IconChevronRight size={16} style="color: var(--sys-label4)" />
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<FieldExportSheet
	open={showExportSheet}
	onClose={() => (showExportSheet = false)}
	judul="Rekap Work Order Saya"
	filename="rekap-wo-saya"
	columns={exportColumns}
	rows={exportRows}
	landscape={true}
/>
