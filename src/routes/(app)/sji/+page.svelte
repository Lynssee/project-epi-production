<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fetchMySji, type SjiListItem } from '$lib/services/sjiApi';
	import { IconPlus, IconLoader2, IconAlertTriangle, IconPackage, IconChevronRight } from '@tabler/icons-svelte';

	let list = $state<SjiListItem[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');

	const STATUS_LABEL: Record<string, string> = {
		diajukan: 'Menunggu Persetujuan',
		disetujui: 'Siap Diambil',
		ditolak: 'Ditolak',
		sebagian_diserahkan: 'Sebagian Diserahkan',
		selesai: 'Selesai',
		dibatalkan: 'Dibatalkan'
	};
	const STATUS_COLOR: Record<string, string> = {
		diajukan: 'bg-amber-100 text-amber-800',
		disetujui: 'bg-blue-100 text-blue-800',
		ditolak: 'bg-red-100 text-red-800',
		sebagian_diserahkan: 'bg-blue-100 text-blue-800',
		selesai: 'bg-emerald-100 text-emerald-800',
		dibatalkan: 'bg-slate-100 text-slate-600'
	};

	onMount(load);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			list = await fetchMySji();
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat daftar SJI.';
		} finally {
			loading = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<div class="flex items-center justify-between mb-4">
		<div>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Surat Jalan Internal</h1>
			<p class="text-[11px]" style="color: var(--sys-label3)">Pengajuan ambil/pinjam barang Anda</p>
		</div>
		<button
			class="h-10 px-3.5 rounded-xl text-[12px] font-bold text-white flex items-center gap-1.5"
			style="background: var(--p, var(--g))"
			onclick={() => goto('/sji/ajukan')}
		>
			<IconPlus size={16} /> Ajukan
		</button>
	</div>

	{#if loading}
		<div class="py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Surat Jalan Intern..." sublabel="Sinkronisasi pengajuan Directus" />
		</div>
	{:else if errorMsg}
		<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
			<div>{errorMsg}</div>
		</div>
	{:else if list.length === 0}
		<div class="text-center py-16">
			<IconPackage size={32} style="color: var(--sys-label4); margin: 0 auto" />
			<p class="text-[12px] mt-2" style="color: var(--sys-label3)">Belum ada pengajuan SJI.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			{#each list as item (item.id)}
				<button
					class="w-full p-3.5 rounded-xl border flex items-center justify-between gap-2 text-left"
					style="border-color: var(--sys-sep)"
					onclick={() => goto(`/sji/${item.id}`)}
				>
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<span class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{item.reference_no}</span>
							{#if item.urgency === 'urgent'}
								<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">URGENT</span>
							{/if}
						</div>
						<div class="text-[11px] truncate" style="color: var(--sys-label3)">
							{item.item_count} item{item.item_count > 1 ? '' : ''} · {item.gudang_id?.nama_gudang || '-'}
						</div>
					</div>
					<div class="flex items-center gap-2 shrink-0">
						<span class="text-[10px] font-bold px-2 py-1 rounded-full {STATUS_COLOR[item.status] || 'bg-slate-100 text-slate-600'}">
							{STATUS_LABEL[item.status] || item.status}
						</span>
						<IconChevronRight size={16} style="color: var(--sys-label4)" />
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>
