<!-- src/lib/components/anggaran/BbmSplitAllocator.svelte
     Pengajuan Anggaran v3.1 (G_BBM_SPLIT, dibuka kembali 22 Agu 2026 — sebelumnya
     ditunda D3). Opsional: kategori bbm_transport tetap boleh 1 pengajuan -> 1 tujuan
     tanpa split sama sekali (checkBbmSplitGate lolos otomatis bila splits kosong).
     Komponen ini HANYA muncul kalau user memilih "Bagi ke beberapa proyek". -->
<script lang="ts">
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { onMount } from 'svelte';

	let {
		splits = $bindable([]),
		enabled = $bindable(false)
	}: {
		splits: { project_id: number | null; persentase: number }[];
		enabled: boolean;
	} = $props();

	let projects = $state<any[]>([]);

	onMount(async () => {
		projects = (await getProjectsForCurrentUser(false)) || [];
	});

	function addRow() {
		splits = [...splits, { project_id: null, persentase: 0 }];
	}

	function removeRow(i: number) {
		splits = splits.filter((_, idx) => idx !== i);
	}

	function toggleEnabled() {
		enabled = !enabled;
		if (enabled && splits.length === 0) {
			splits = [
				{ project_id: null, persentase: 50 },
				{ project_id: null, persentase: 50 }
			];
		}
		if (!enabled) splits = [];
	}

	let total = $derived(splits.reduce((s, r) => s + (parseFloat(String(r.persentase)) || 0), 0));
</script>

<div class="card-section">
	<div class="flex items-center justify-between mb-2">
		<h4 class="mb-0 flex items-center gap-1.5">⛽ Alokasi BBM Multi-Proyek</h4>
		<label class="flex items-center gap-1.5 text-[11px] text-gray-500">
			<input type="checkbox" checked={enabled} onchange={toggleEnabled} />
			Bagi ke beberapa proyek
		</label>
	</div>

	{#if !enabled}
		<p class="text-[11px] text-gray-400">Default: 1 pengajuan untuk 1 tujuan/proyek (Proyek Terkait di atas). Aktifkan toggle kalau BBM ini dipakai lintas beberapa proyek sekaligus.</p>
	{:else}
		<div class="space-y-2">
			{#each splits as row, i}
				<div class="flex items-center gap-2">
					<select bind:value={row.project_id} class="f-select flex-1">
						<option value={null}>— Pilih Proyek —</option>
						{#each projects as p}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
					<input type="number" bind:value={row.persentase} min="0" max="100" class="f-input w-20 text-right" placeholder="%" />
					<span class="text-xs text-gray-400">%</span>
					{#if splits.length > 2}
						<button type="button" class="text-gray-300 hover:text-red-400 text-xs" onclick={() => removeRow(i)}>✕</button>
					{/if}
				</div>
			{/each}
		</div>
		<div class="flex items-center justify-between mt-2">
			<button type="button" class="text-[11px] text-[var(--p)] font-medium" onclick={addRow}>+ Tambah Proyek</button>
			<span class="text-[11px] {Math.abs(total - 100) > 0.5 ? 'text-red-500 font-semibold' : 'text-green-600'}">Total: {total}%</span>
		</div>
		<p class="text-[10px] text-gray-400 mt-1">Total harus tepat 100%. Jurnal pengeluaran akan dipecah proporsional ke tiap proyek saat pengajuan disetujui.</p>
	{/if}
</div>
