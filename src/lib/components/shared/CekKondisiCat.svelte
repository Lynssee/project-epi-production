<!-- src/lib/components/shared/CekKondisiCat.svelte -->
<!-- Checklist visual kondisi cat saat diterima (Fase 4 QC Re-test Cat Keluar). Opsional & tidak memblokir
     konfirmasi: centang yang sudah diperiksa; yang kosong dicatat sebagai "belum/tidak baik" untuk ditindaklanjuti. -->
<script lang="ts">
	import { CEK_CAT_FIELDS, type CekCatState } from '$lib/constants/catItem';
	import { HelpIcon } from '$lib/components/hints';

	let { value = $bindable() }: { value: CekCatState } = $props();

	let semuaBaik = $derived(CEK_CAT_FIELDS.every((f) => value[f.key]));
</script>

<div class="mt-2 rounded-lg p-2.5 border" style="border-color: var(--sys-sep); background: var(--sys-fill, transparent)">
	<p class="text-[11px] font-semibold mb-1.5 inline-flex items-center gap-1.5" style="color: var(--sys-label3)">
		Cek Kondisi Cat (opsional)
		<HelpIcon text="Centang pemeriksaan yang sudah Anda lakukan dan hasilnya baik. Yang tidak dicentang dicatat sebagai masalah dan dilihat tim Inventory. Konfirmasi tetap bisa dilanjutkan." position="bottom" />
	</p>
	{#each CEK_CAT_FIELDS as f (f.key)}
		<label class="flex items-start gap-2 py-1 text-[12px]" style="color: var(--sys-label)">
			<input type="checkbox" class="mt-0.5" bind:checked={value[f.key]} />
			<span>
				{f.label}
				<span class="block text-[10.5px]" style="color: var(--sys-label3)">{f.hint}</span>
			</span>
		</label>
	{/each}
	{#if !semuaBaik && CEK_CAT_FIELDS.some((f) => value[f.key])}
		<p class="text-[10.5px] mt-1" style="color: #DC2626">Ada pemeriksaan yang belum dicentang — akan dicatat. Bila cat bermasalah, laporkan lewat menu Komplain dengan nomor batch.</p>
	{/if}
</div>
