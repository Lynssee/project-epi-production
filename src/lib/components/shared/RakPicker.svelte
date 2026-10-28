<!-- src/lib/components/shared/RakPicker.svelte -->
<!-- Fase 5 (opsional, Rencana Sistem Penempatan Area Inventory & Verifikasi Barcode v2,
     21 Agu 2026): dropdown "Rak (opsional)" yang muncul begitu gudang induk dipilih dan
     punya anak (zona/rak). ADITIF -- kalau tidak ada anak, atau user tidak memilih, komponen
     ini render kosong dan perilaku form TIDAK berubah (gudang_id tetap level gudang induk). -->
<script lang="ts">
	import { fetchGudangChildren } from '$lib/services/stockLapangan';

	let {
		gudangId = null,
		value = $bindable(null),
		compact = false
	}: {
		gudangId?: number | null;
		value?: number | null;
		compact?: boolean;
	} = $props();

	let children = $state<{ id: number; nama_gudang: string }[]>([]);
	let lastLoadedFor = $state<number | null | undefined>(undefined);

	$effect(() => {
		if (gudangId !== lastLoadedFor) {
			lastLoadedFor = gudangId;
			value = null;
			loadChildren(gudangId ?? null);
		}
	});

	async function loadChildren(id: number | null) {
		if (!id) {
			children = [];
			return;
		}
		try {
			children = await fetchGudangChildren(id);
		} catch (e) {
			console.error('Gagal memuat rak/zona', e);
			children = [];
		}
	}
</script>

{#if children.length > 0}
	<div>
		<label class="block {compact ? 'text-[10px]' : 'text-xs'} font-medium mb-1" style="color: var(--sys-label3)">
			Rak / Zona <span class="font-normal" style="color: var(--sys-label4)">(opsional)</span>
		</label>
		<select
			bind:value
			class="w-full rounded-lg border {compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'}"
			style="border-color: var(--sys-sep)"
		>
			<option value={null}>-- Tidak spesifik (level gudang) --</option>
			{#each children as c}
				<option value={c.id}>{c.nama_gudang}</option>
			{/each}
		</select>
	</div>
{/if}
