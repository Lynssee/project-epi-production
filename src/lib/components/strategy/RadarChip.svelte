<!-- src/lib/components/strategy/RadarChip.svelte
     Chip radar OPSIONAL: catat sinyal pasar/kompetitor/aturan yang Anda lihat di lapangan (1 ketukan kategori + 1 kalimat).
     Berdiri sendiri — tombolnya type="button", terkirim terpisah, TIDAK ikut dan TIDAK memblokir pengiriman form induk.
     Sinyal ditinjau pimpinan di Dashboard Admin → Strategi → PESTLE. -->
<script lang="ts">
	import { RADAR_PILARS, RADAR_MIN_CATATAN, RADAR_MAX_CATATAN, kirimSinyalRadar, type RadarPilar, type RadarSourceForm } from '$lib/services/strategyRadar';

	let {
		sourceForm,
		sourceRef = null,
		projectId = null,
		customerName = null
	}: { sourceForm: RadarSourceForm; sourceRef?: string | number | null; projectId?: number | string | null; customerName?: string | null } = $props();

	let open = $state(false);
	let pilar = $state<RadarPilar | ''>('');
	let kompetitor = $state('');
	let catatan = $state('');
	let sending = $state(false);
	let error = $state('');
	let sentCount = $state(0);

	const hint = $derived(RADAR_PILARS.find((p) => p.pilar === pilar)?.hint ?? 'Pilih kategori yang paling dekat dengan yang Anda lihat.');

	async function kirim() {
		error = '';
		if (!pilar) {
			error = 'Pilih kategori sinyal.';
			return;
		}
		sending = true;
		try {
			await kirimSinyalRadar({ pilar, catatan, kompetitor, sourceForm, sourceRef, projectId, customerName });
			sentCount += 1;
			pilar = '';
			kompetitor = '';
			catatan = '';
			open = false;
		} catch (e: any) {
			error = e?.message || 'Sinyal belum terkirim.';
		} finally {
			sending = false;
		}
	}
</script>

<div class="rounded-xl border border-dashed border-sky-300 bg-sky-50/60 p-3 dark:border-sky-800 dark:bg-sky-900/10">
	<button type="button" class="flex w-full items-center justify-between text-left" onclick={() => (open = !open)} aria-expanded={open}>
		<span class="text-[12px] font-bold text-sky-800 dark:text-sky-200">📡 Lihat sesuatu di pasar? Catat sinyal <span class="font-normal">(opsional)</span></span>
		<span class="text-[11px] text-sky-700 dark:text-sky-300">{open ? 'Tutup' : 'Buka'}</span>
	</button>
	{#if sentCount > 0 && !open}
		<p class="mt-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">✓ {sentCount} sinyal terkirim ke pimpinan. Terima kasih!</p>
	{/if}

	{#if open}
		<div class="mt-2 space-y-2">
			<p class="text-[11px] text-slate-600 dark:text-slate-300">Cukup 1 kategori + 1 kalimat. Tidak mengubah laporan Anda — terkirim terpisah.</p>
			<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kategori sinyal">
				{#each RADAR_PILARS as p (p.pilar)}
					<button
						type="button"
						role="radio"
						aria-checked={pilar === p.pilar}
						class="rounded-full border px-2.5 py-1 text-[11px] font-semibold {pilar === p.pilar ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}"
						onclick={() => (pilar = p.pilar)}>{p.label}</button>
				{/each}
			</div>
			<p class="text-[11px] italic text-slate-500">{hint}</p>
			<input
				type="text"
				class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-600 dark:bg-slate-900"
				placeholder="Nama kompetitor (jika ada)"
				maxlength="120"
				bind:value={kompetitor}
				onkeydown={(e) => e.key === 'Enter' && e.preventDefault()} />
			<textarea
				class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-600 dark:bg-slate-900"
				rows="2"
				placeholder="Apa yang Anda lihat/dengar? mis. 'Kompetitor X tawar epoxy 10% lebih murah di proyek Y'"
				maxlength={RADAR_MAX_CATATAN}
				bind:value={catatan}></textarea>
			<div class="flex items-center justify-between gap-2">
				<span class="text-[10px] text-slate-400">{catatan.trim().length}/{RADAR_MAX_CATATAN} · min. {RADAR_MIN_CATATAN}</span>
				<button
					type="button"
					class="rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
					disabled={sending || !pilar || catatan.trim().length < RADAR_MIN_CATATAN}
					onclick={kirim}>{sending ? 'Mengirim…' : 'Kirim sinyal'}</button>
			</div>
			{#if error}<p class="text-[11px] font-semibold text-red-600">{error}</p>{/if}
		</div>
	{/if}
</div>
