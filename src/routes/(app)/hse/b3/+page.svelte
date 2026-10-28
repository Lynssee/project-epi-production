<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { searchB3, type HseB3 } from '$lib/services/hse';
	import { IconArrowLeft, IconSearch, IconAlertTriangle } from '@tabler/icons-svelte';

	let query = $state('');
	let results = $state<HseB3[]>([]);
	let loading = $state(true);

	const GHS_LABELS: Record<string, string> = {
		mudah_terbakar: 'Mudah Terbakar',
		korosif: 'Korosif',
		beracun: 'Beracun',
		iritan: 'Iritan',
		oksidator: 'Oksidator',
		berbahaya_lingkungan: 'Berbahaya Lingkungan'
	};

	async function search() {
		loading = true;
		results = await searchB3(query);
		loading = false;
	}

	onMount(search);

	function laporTumpahan(item: HseB3) {
		goto(`/hse?prefill_kategori=tumpahan&prefill_lokasi=${encodeURIComponent(item.lokasi_simpan || '')}&prefill_kronologi=${encodeURIComponent('Tumpahan bahan: ' + item.nama_bahan)}`);
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/hse')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Cek MSDS Bahan</h1>
		</div>

		<div class="flex items-center gap-2 mb-4 rounded-lg px-3 py-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
			<IconSearch size={16} />
			<input
				bind:value={query}
				oninput={search}
				placeholder="Cari nama bahan (mis. Thinner A)"
				class="flex-1 bg-transparent text-[13px] outline-none"
				style="color: var(--sys-label)"
			/>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat data bahan B3..." />
		{:else if results.length === 0}
			<p class="text-[12px] text-center py-8" style="color: var(--sys-label-2)">Bahan tidak ditemukan.</p>
		{:else}
			<div class="space-y-3">
				{#each results as item (item.id)}
					<div class="rounded-xl p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<p class="text-[13px] font-bold" style="color: var(--sys-label)">{item.nama_bahan}</p>
						<p class="text-[11px]" style="color: var(--sys-label-2)">
							CAS: {item.no_cas || '-'} · Lokasi: {item.lokasi_simpan || '-'}
						</p>
						{#if item.kelas_ghs?.length}
							<div class="flex flex-wrap gap-1 mt-1.5">
								{#each item.kelas_ghs as g}
									<span class="text-[10px] px-1.5 py-0.5 rounded-full" style="background: var(--rel); color: #B45309">
										{GHS_LABELS[g] || g}
									</span>
								{/each}
							</div>
						{/if}
						{#if item.apd_wajib}
							<p class="text-[11px] mt-2" style="color: var(--sys-label)">
								<span class="font-semibold">APD Wajib:</span> {item.apd_wajib}
							</p>
						{/if}
						<div class="flex items-center gap-2 mt-3">
							{#if item.msds_document_id?.msds_url}
								<a
									href={item.msds_document_id.msds_url}
									target="_blank"
									rel="noopener"
									class="flex-1 text-center rounded-lg py-2 text-[12px] font-semibold text-white"
									style="background: var(--g)"
								>
									Lihat MSDS
								</a>
							{/if}
							<button
								class="flex-1 rounded-lg py-2 text-[12px] font-semibold text-white flex items-center justify-center gap-1"
								style="background: #DC2626"
								onclick={() => laporTumpahan(item)}
							>
								<IconAlertTriangle size={14} />
								Lapor Tumpahan
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
