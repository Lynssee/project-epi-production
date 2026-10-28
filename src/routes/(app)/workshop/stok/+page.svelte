<!-- src/routes/(app)/workshop/stok/+page.svelte -->
<!-- R4 — Cek Stok Real-time Ciketing (docs analisis v2 §7). Read-only, mobile-friendly:
     PL/mekanik cek stok ciketing_item dari HP tanpa lewat dashboard admin. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { fetchWorkshopStok, type WorkshopStokRow } from '$lib/services/workshopStokApi';
	import { WORKSHOP_OPS, parseOpsWorkshop } from '$lib/services/workshopOpsProfile';
	import { IconArrowLeft, IconLoader2, IconSearch, IconAlertTriangle } from '@tabler/icons-svelte';

	// Fase 7c: workshop dari ?ws= (dibawa dari halaman /workshop); default ciketing.
	const wsKey = parseOpsWorkshop(page.url.searchParams.get('ws'));
	const P = WORKSHOP_OPS[wsKey];
	let rows = $state<WorkshopStokRow[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');
	let query = $state('');
	let onlyKritis = $state(false);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			rows = await fetchWorkshopStok(wsKey);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat stok.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let filtered = $derived(
		rows.filter((r) => {
			if (onlyKritis && !r.statusKritis) return false;
			if (!query.trim()) return true;
			const q = query.trim().toLowerCase();
			return r.namaBarang.toLowerCase().includes(q) || (r.kode || '').toLowerCase().includes(q);
		})
	);

	let kritisCount = $derived(rows.filter((r) => r.statusKritis).length);
</script>

<svelte:head><title>Cek Stok — Workshop {P.label}</title></svelte:head>

<div class="p-4 max-w-lg mx-auto pb-24">
	<button class="flex items-center gap-1.5 text-sm mb-4" style="color: var(--sys-label2)" onclick={() => goto(`/workshop?ws=${wsKey}`)}>
		<IconArrowLeft size={16} /> Kembali
	</button>

	<h1 class="text-lg font-bold mb-1" style="color: var(--sys-label)">Cek Stok Workshop</h1>
	<p class="text-[12px] mb-4" style="color: var(--sys-label3)">
		Stok material/consumable workshop {P.label} saat ini — data langsung dari sistem, hanya untuk dilihat (bukan transaksi). Untuk pengeluaran/penyesuaian tetap lewat admin/gudang.
	</p>

	{#if errorMsg}
		<div class="p-3 rounded-lg mb-3 text-[12px]" style="background: rgba(239,68,68,0.1); color:#ef4444;">{errorMsg}</div>
	{/if}

	<div class="flex gap-2 mb-3">
		<div class="flex-1 relative">
			<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label3)" />
			<input
				type="text"
				bind:value={query}
				placeholder="Cari nama/kode barang..."
				class="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] border"
				style="border-color: var(--sys-sep); background: var(--sys-bg2, #fff); color: var(--sys-label)"
			/>
		</div>
		<button
			class="px-3 py-2 rounded-lg text-[12px] font-medium border shrink-0"
			style={onlyKritis
				? 'background: rgba(239,68,68,0.12); color:#ef4444; border-color: rgba(239,68,68,0.3);'
				: 'border-color: var(--sys-sep); color: var(--sys-label2)'}
			onclick={() => (onlyKritis = !onlyKritis)}
		>
			Kritis {kritisCount > 0 ? `(${kritisCount})` : ''}
		</button>
	</div>

	{#if loading}
		<div class="flex justify-center py-10">
			<CircularProgressGauge size={64} strokeWidth={5} label="Memuat Stok Workshop..." sublabel="Sinkronisasi persediaan material" />
		</div>
	{:else if filtered.length === 0}
		<div class="text-center py-14 rounded-xl border" style="border-color: var(--sys-sep)">
			<p class="text-[13px]" style="color: var(--sys-label3)">Tidak ada barang yang cocok.</p>
		</div>
	{:else}
		<div class="glass-panel rounded-2xl border border-white/50 shadow-sm divide-y divide-slate-100">
			{#each filtered as r (r.id)}
				<div class="p-3 flex items-center justify-between gap-3">
					<div class="min-w-0">
						<div class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{r.namaBarang}</div>
						<div class="text-[11px]" style="color: var(--sys-label3)">
							{r.kode ? `${r.kode} · ` : ''}{r.kategori || '-'}
						</div>
					</div>
					<div class="text-right shrink-0">
						<div class="text-[14px] font-bold flex items-center gap-1 justify-end" style={r.statusKritis ? 'color:#ef4444' : 'color: var(--sys-label)'}>
							{#if r.statusKritis}<IconAlertTriangle size={13} />{/if}
							{r.stokTersedia.toLocaleString('id-ID')}
							<span class="text-[11px] font-normal" style="color: var(--sys-label3)">{r.satuanDefault || ''}</span>
						</div>
						{#if r.stokMin > 0}
							<div class="text-[10px]" style="color: var(--sys-label3)">min. {r.stokMin.toLocaleString('id-ID')}</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
