<!-- src/lib/components/inspection/SaGuide.svelte
     Panduan cepat standar kebersihan permukaan (Sa) untuk form inspeksi. Tombol bantuan yang membuka ringkasan kriteria;
     bila spesifikasi proyek menetapkan Sa tertentu, baris itu disorot. Isi: $lib/data/saGuide (ringkasan, bukan foto standar). -->
<script lang="ts">
	import { SA_GRADES, KARAT_AWAL, CEK_SEBELUM_CAT, findSaGrade } from '$lib/data/saGuide';

	let { target = null as string | null } = $props();
	let open = $state(false);
	const targetGrade = $derived(findSaGrade(target));
</script>

<div class="mb-2.5">
	<button
		type="button"
		class="rounded-lg px-2.5 py-1 text-[11px] font-semibold"
		style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
		aria-expanded={open}
		aria-controls="sa-guide-panel"
		onclick={() => (open = !open)}
	>
		{open ? '✕ Tutup panduan Sa' : '❓ Panduan Sa 1 / 2 / 2.5 / 3'}{targetGrade ? ` · spek proyek: ${targetGrade.grade}` : ''}
	</button>

	{#if open}
		<div id="sa-guide-panel" class="mt-2 rounded-lg p-2.5 text-[11px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" data-testid="sa-guide">
			<div class="space-y-1.5">
				{#each SA_GRADES as g (g.grade)}
					{@const sorot = targetGrade?.grade === g.grade}
					<div class="rounded-md p-2" style="background: var(--sys-bg); border: {sorot ? '2px solid var(--blue, #2563eb)' : '1px solid var(--sys-sep)'}">
						<p class="font-bold">{g.grade} · {g.nama}{sorot ? ' — TARGET PROYEK' : ''} <span class="font-normal" style="color: var(--sys-label3)">({g.sspc})</span></p>
						<p>{g.kriteria}</p>
						<p style="color: var(--sys-label3)">{g.sisa}</p>
						<p style="color: var(--sys-label3)">Umum untuk: {g.umumUntuk}</p>
					</div>
				{/each}
			</div>

			<p class="mb-1 mt-2.5 font-bold">Kondisi baja awal (ISO 8501-1)</p>
			<ul class="list-inside list-disc">
				{#each KARAT_AWAL as k (k.kode)}<li><b>{k.kode}</b> — {k.arti}</li>{/each}
			</ul>

			<p class="mb-1 mt-2.5 font-bold">Cek sebelum mengecat</p>
			<ul class="list-inside list-disc">
				{#each CEK_SEBELUM_CAT as c}<li>{c}</li>{/each}
			</ul>

			<p class="mt-2 text-[10px]" style="color: var(--sys-label3)">Ini ringkasan pengingat, bukan pengganti standar. Foto acuan resmi ISO 8501-1 / SSPC-VIS 1 berlisensi — gunakan kartu/buku acuan fisik di lokasi.</p>
		</div>
	{/if}
</div>
