<!-- src/routes/(app)/workshop/po-bayangan/+page.svelte -->
<!-- Pertajam Modul Ciketing — PO Bayangan, sisi lapangan (Fase 2 lanjutan, 22 Sep 2026).
     View-only untuk proyek milik pengguna. Konfirmasi PO masuk tetap admin-only (Finance/PM). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fetchMyPoBayangan, PO_STATUS_LABEL, type PoBayanganCase } from '$lib/services/workshopOverstayApi';
	import { IconArrowLeft, IconCheck, IconLoader2, IconFileAlert } from '@tabler/icons-svelte';

	let cases = $state<PoBayanganCase[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			cases = await fetchMyPoBayangan();
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat data.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const STATUS_STYLE: Record<string, string> = {
		belum_ada_po: 'background: rgba(239,68,68,0.12); color:#ef4444;',
		po_menyusul: 'background: rgba(245,158,11,0.12); color:#f59e0b;',
		po_dikonfirmasi: 'background: rgba(16,185,129,0.12); color:#10b981;'
	};
</script>

<svelte:head><title>Proyek Tanpa PO — Workshop Ciketing</title></svelte:head>

<div class="p-4 max-w-lg mx-auto pb-24">
	<button class="flex items-center gap-1.5 text-sm mb-4" style="color: var(--sys-label2)" onclick={() => goto('/workshop')}>
		<IconArrowLeft size={16} /> Kembali
	</button>

	<h1 class="text-lg font-bold mb-1" style="color: var(--sys-label)">Proyek Tanpa PO</h1>
	<p class="text-[12px] mb-4" style="color: var(--sys-label3)">
		Proyek Anda yang barangnya sudah dikerjakan tapi PO/perjanjian resmi dari customer belum masuk ke admin. Status PO dikelola Finance/Procurement — halaman ini view-only.
	</p>

	{#if errorMsg}
		<div class="p-3 rounded-lg mb-3 text-[12px]" style="background: rgba(239,68,68,0.1); color:#ef4444;">{errorMsg}</div>
	{/if}

	{#if loading}
		<div class="flex justify-center py-10">
			<CircularProgressGauge size={64} strokeWidth={5} label="Memuat Status PO..." sublabel="Mengecek kelengkapan PO proyek workshop" />
		</div>
	{:else if cases.length === 0}
		<div class="text-center py-14 rounded-xl border" style="border-color: var(--sys-sep)">
			<IconCheck size={32} style="color: var(--p, var(--g)); margin: 0 auto;" />
			<p class="text-[13px] font-semibold mt-2" style="color: var(--sys-label)">Semua proyek Anda sudah punya PO.</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each cases as c (c.id)}
				<div class="p-3.5 rounded-xl border flex items-start gap-3" style="border-color: var(--sys-sep); background: var(--sys-fill)">
					<IconFileAlert size={20} style="color: var(--sys-label3); margin-top:2px;" />
					<div class="flex-1">
						<p class="text-[14px] font-bold m-0" style="color: var(--sys-label)">{c.nama_barang}</p>
						<p class="text-[11px] m-0 mt-0.5" style="color: var(--sys-label3)">{c.customer_name || '-'}</p>
						<span class="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full" style={STATUS_STYLE[c.po_status || 'belum_ada_po'] || ''}>
							{PO_STATUS_LABEL[c.po_status || 'belum_ada_po'] || 'Belum Ada PO'}
						</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
