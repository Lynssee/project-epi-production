<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getAntrianList, type AntrianRow } from '$lib/services/gudangAntrian';
	import { loadInventorySettings, getInventorySetting } from '$lib/services/inventorySettings';
	import {
		IconArrowLeft, IconLoader2, IconClipboardList, IconChevronRight,
		IconAlertTriangle, IconLock
	} from '@tabler/icons-svelte';

	let canAccess = $derived(
		hasPermission($authStore.roleId, 'input_stock_lapangan', $rolesStore) ||
		hasPermission($authStore.roleId, 'view_stock_lapangan', $rolesStore)
	);

	$effect(() => {
		const checked = $authStore.checked;
		if (checked && !canAccess) goto('/');
	});

	let loading = $state(true);
	let moduleEnabled = $state(true);
	let rows = $state<AntrianRow[]>([]);
	let statusFilter = $state<'semua' | 'punya_saya'>('semua');
	let priorityFilter = $state<'semua' | 'rendah' | 'normal' | 'tinggi' | 'urgent'>('semua');
	let typeFilter = $state<'semua' | 'project' | 'maintenance' | 'internal'>('semua');

	onMount(async () => {
		await loadInventorySettings();
		moduleEnabled = getInventorySetting('inventory.gudang_hq.enabled');
		if (moduleEnabled) {
			rows = await getAntrianList();
		}
		loading = false;
	});

	const myKaryawanId = $derived($authStore.karyawanId);

	let filtered = $derived.by(() => {
		let list = rows;
		if (statusFilter === 'punya_saya') {
			list = list.filter((r) => r.assignedTo != null && myKaryawanId != null && r.assignedTo === Number(myKaryawanId));
		}
		if (priorityFilter !== 'semua') {
			list = list.filter((r) => r.priority === priorityFilter);
		}
		if (typeFilter !== 'semua') {
			list = list.filter((r) => r.requestType === typeFilter);
		}
		return list;
	});

	function typeLabel(t: string) {
		switch (t) {
			case 'project': return 'Proyek';
			case 'maintenance': return 'Maintenance';
			case 'internal': return 'Internal';
			default: return 'Semua';
		}
	}

	function priorityColor(p: string) {
		switch (p) {
			case 'urgent': return '#DC2626';
			case 'tinggi': return '#EA580C';
			case 'rendah': return '#64748B';
			default: return '#2563EB';
		}
	}

	function priorityLabel(p: string) {
		switch (p) {
			case 'urgent': return 'Urgent';
			case 'tinggi': return 'Tinggi';
			case 'rendah': return 'Rendah';
			default: return 'Normal';
		}
	}

	function formatDate(d: string | null) {
		if (!d) return '-';
		try {
			return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
		} catch {
			return d;
		}
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/stock-lapangan')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold flex items-center gap-2" style="color: var(--sys-label)">
		<IconClipboardList size={18} /> Antrian Gudang Pusat
	</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
		Daftar packing list yang perlu disiapkan. Lihat detail untuk indikator stok per item.
	</p>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat antrian gudang..." />
		</div>
	{:else if !moduleEnabled}
		<div class="rounded-xl border p-6 text-center" style="border-color: var(--sys-sep)">
			<IconLock size={24} class="mx-auto mb-2" style="color: var(--sys-label4)" />
			<p class="text-[12.5px] font-medium" style="color: var(--sys-label)">Modul Gudang Pusat belum diaktifkan</p>
			<p class="text-[11px] mt-1" style="color: var(--sys-label3)">
				Hubungi admin untuk mengaktifkan setelan <code>inventory.gudang_hq.enabled</code>.
			</p>
		</div>
	{:else}
		<div class="flex items-center gap-2 mb-2 overflow-x-auto">
			{#each ['semua', 'project', 'maintenance', 'internal'] as t}
				<button
					class="px-3 py-1.5 rounded-full text-[11px] font-medium shrink-0"
					style="background: {typeFilter === t ? 'var(--sys-fill-strong, #2563EB)' : 'var(--sys-fill)'}; color: {typeFilter === t ? 'white' : 'var(--sys-label3)'}"
					onclick={() => (typeFilter = t as typeof typeFilter)}
				>{typeLabel(t)}</button>
			{/each}
		</div>

		<div class="flex items-center gap-2 mb-3 overflow-x-auto">
			<button
				class="px-3 py-1.5 rounded-full text-[11px] font-medium shrink-0"
				style="background: {statusFilter === 'semua' ? 'var(--sys-fill-strong, #2563EB)' : 'var(--sys-fill)'}; color: {statusFilter === 'semua' ? 'white' : 'var(--sys-label3)'}"
				onclick={() => (statusFilter = 'semua')}
			>Semua</button>
			<button
				class="px-3 py-1.5 rounded-full text-[11px] font-medium shrink-0"
				style="background: {statusFilter === 'punya_saya' ? 'var(--sys-fill-strong, #2563EB)' : 'var(--sys-fill)'}; color: {statusFilter === 'punya_saya' ? 'white' : 'var(--sys-label3)'}"
				onclick={() => (statusFilter = 'punya_saya')}
			>Punya Saya</button>
			<select
				bind:value={priorityFilter}
				class="ml-auto px-2.5 py-1.5 rounded-full text-[11px] font-medium border shrink-0"
				style="border-color: var(--sys-sep); color: var(--sys-label3); background: var(--sys-bg)"
			>
				<option value="semua">Semua Prioritas</option>
				<option value="urgent">Urgent</option>
				<option value="tinggi">Tinggi</option>
				<option value="normal">Normal</option>
				<option value="rendah">Rendah</option>
			</select>
		</div>

		{#if filtered.length === 0}
			<div class="rounded-xl border p-8 text-center" style="border-color: var(--sys-sep)">
				<p class="text-[12px]" style="color: var(--sys-label3)">Tidak ada antrian yang perlu disiapkan.</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each filtered as r (r.id)}
					<button
						class="w-full text-left p-3.5 rounded-xl border flex items-start gap-3"
						style="border-color: var(--sys-sep)"
						onclick={() => goto(`/stock-lapangan/antrian/${r.id}`)}
					>
						<div class="shrink-0 w-1.5 self-stretch rounded-full" style="background: {priorityColor(r.priority)}"></div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2 mb-1">
								<p class="text-[12.5px] font-bold truncate" style="color: var(--sys-label)">{r.nomorPl}</p>
								<span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded shrink-0" style="background: {priorityColor(r.priority)}1A; color: {priorityColor(r.priority)}">
									{priorityLabel(r.priority)}
								</span>
								{#if r.requestType}
									<span class="text-[9.5px] font-medium px-1.5 py-0.5 rounded shrink-0" style="background: var(--sys-fill); color: var(--sys-label3)">
										{typeLabel(r.requestType)}
									</span>
								{/if}
							</div>
							<p class="text-[11px] truncate" style="color: var(--sys-label3)">
								{r.requestedByDepartment || 'Tanpa departemen'} · {r.destinationPicName || 'Tanpa PIC'}
							</p>
							<div class="flex items-center gap-3 mt-1.5">
								<span class="text-[10px]" style="color: var(--sys-label4)">Butuh: {formatDate(r.neededDate)}</span>
								<span class="text-[10px]" style="color: var(--sys-label4)">{r.itemCount} item</span>
								{#if r.assignedToName}
									<span class="text-[10px] font-medium" style="color: var(--sys-label3)">{r.assignedToName}</span>
								{/if}
							</div>
						</div>
						<IconChevronRight size={16} class="shrink-0 mt-1" style="color: var(--sys-label4)" />
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>
