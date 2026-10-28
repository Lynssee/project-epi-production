<!-- src/routes/(app)/stock-lapangan/pindah-rak/+page.svelte -->
<!-- Fase 2 (rencana "Penajaman Kiosk Inventory", 8 Sep 2026): rekap audit untuk supervisor —
     barang yang dipindah antar rak oleh tim gudang lewat terminal Kiosk. READ ONLY. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getPindahRakLog, type PindahRakLogRow } from '$lib/services/pindahRakLog';
	import {
		IconArrowLeft, IconLoader2, IconArrowsExchange, IconArrowRight, IconAlertTriangle
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
	let rows = $state<PindahRakLogRow[]>([]);
	let days = $state(14);

	async function load() {
		loading = true;
		rows = await getPindahRakLog({ days });
		loading = false;
	}
	onMount(load);

	let grouped = $derived.by(() => {
		const map = new Map<string, PindahRakLogRow[]>();
		for (const r of rows) {
			const key = new Date(r.tanggal).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(r);
		}
		return [...map.entries()];
	});

	let selisihCount = $derived(rows.filter((r) => r.flag_selisih).length);

	function jam(iso: string) {
		return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
	}
</script>

<div class="max-w-3xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/stock-lapangan')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold flex items-center gap-2 mb-1" style="color: var(--sys-label)">
		<IconArrowsExchange size={18} /> Pindah Rak (dari Kiosk)
	</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
		Barang yang digeser antar rak oleh tim gudang di terminal kiosk. Ini hanya perpindahan lokasi —
		stok total tidak berubah. Baris bertanda kuning = jumlah yang dipindah lebih besar dari yang
		tercatat di rak asal, perlu dicek opname.
	</p>

	<div class="flex items-center gap-2 mb-4">
		{#each [7, 14, 30] as d}
			<button
				class="text-[12px] font-bold px-3 py-1.5 rounded-full border"
				style={days === d
					? 'background:var(--sys-label);color:var(--sys-bg);border-color:var(--sys-label)'
					: 'background:transparent;color:var(--sys-label3);border-color:var(--sys-sep)'}
				onclick={() => { days = d; load(); }}
			>
				{d} hari
			</button>
		{/each}
		{#if selisihCount > 0}
			<span class="ml-auto text-[11px] font-bold flex items-center gap-1" style="color:#b45309">
				<IconAlertTriangle size={13} /> {selisihCount} selisih
			</span>
		{/if}
	</div>

	{#if loading}
		<div class="py-16 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Perpindahan Rak..." sublabel="Mengambil riwayat mutasi rak lapangan" />
		</div>
	{:else if rows.length === 0}
		<div class="rounded-xl border p-8 text-center" style="border-color: var(--sys-sep)">
			<p class="text-[12.5px]" style="color: var(--sys-label)">Belum ada perpindahan rak dalam {days} hari terakhir.</p>
		</div>
	{:else}
		<div class="space-y-5">
			{#each grouped as [tgl, list]}
				<div>
					<p class="text-[11px] font-bold uppercase tracking-wider mb-2" style="color: var(--sys-label3)">{tgl}</p>
					<div class="rounded-xl border divide-y" style="border-color: var(--sys-sep)">
						{#each list as r}
							<div class="p-3" style={r.flag_selisih ? 'background:#fffbeb' : ''}>
								<div class="flex items-center justify-between gap-2">
									<span class="text-[13px] font-bold" style="color: var(--sys-label)">{r.item_nama}</span>
									<span class="text-[13px] font-black" style="color:#0f766e">{r.qty} {r.satuan || ''}</span>
								</div>
								<div class="flex items-center gap-1.5 mt-1 text-[12px]" style="color: var(--sys-label2)">
									<span>{r.rak_asal_nama}</span>
									<IconArrowRight size={13} />
									<span>{r.rak_tujuan_nama ?? '—'}</span>
								</div>
								<div class="flex items-center justify-between mt-1.5 text-[11px]" style="color: var(--sys-label3)">
									<span>{r.operator_nama}{r.operator_id ? ` · #${r.operator_id}` : ''} · {jam(r.tanggal)}</span>
									{#if r.reference_no}<span>{r.reference_no}</span>{/if}
								</div>
								{#if r.flag_selisih}
									<p class="text-[11px] mt-1.5 flex items-center gap-1" style="color:#b45309">
										<IconAlertTriangle size={12} /> Jumlah melebihi catatan rak asal — cek opname.
									</p>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
