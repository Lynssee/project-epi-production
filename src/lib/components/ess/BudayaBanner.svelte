<script lang="ts">
	// Kartu "Fokus Budaya Hari Ini" di beranda ESS lapangan (Budaya & Propaganda Fase 2).
	// Fail-soft: setelan mati / tak ada konten / skema belum ada / error → tidak menampilkan apa pun.
	// Setelah "Siap Laksanakan" / kuis benar → mengecil jadi pill. 1 GET per muat beranda; kuis dinilai di server.
	import { onMount } from 'svelte';
	import { secureAssetSrc } from '$lib/actions/secureAsset';
	import { getBudayaHarian, ackBudayaHarian, type BudayaHarianState } from '$lib/services/ess/budaya';

	let loading = $state(true);
	let harianState = $state<BudayaHarianState | null>(null);
	let busy = $state(false);
	let pesan = $state('');
	let kecil = $state(false);
	let buka = $state(false); // pill diklik → kartu penuh lagi

	const item = $derived(harianState?.item ?? null);
	const selesai = $derived(!!harianState?.ack?.selesai);
	const tampilPill = $derived((selesai || kecil) && !buka);

	onMount(async () => {
		try {
			harianState = await getBudayaHarian();
		} catch (e: any) {
			console.warn('[BudayaBanner] gagal memuat:', e?.message);
		} finally {
			loading = false;
		}
	});

	async function kirim(aksi: 'komitmen' | 'kuis', idx?: number) {
		if (!item || busy || !harianState) return;
		busy = true;
		pesan = '';
		try {
			const res = await ackBudayaHarian(item.id, aksi, idx);
			harianState = { ...harianState, ack: { status: res.status, selesai: res.selesai } };
			buka = aksi === 'kuis'; // kuis: kartu tetap terbuka agar umpan balik terbaca
			if (aksi === 'kuis') pesan = res.benar ? '✅ Tepat! Jawaban Anda tercatat.' : '❌ Belum tepat — coba pilih jawaban lain.';
		} catch (e: any) {
			pesan = 'Gagal mencatat: ' + (e?.message || 'coba lagi');
		} finally {
			busy = false;
		}
	}
</script>

{#if !loading && harianState?.enabled && item}
	{#if tampilPill}
		<button
			class="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border max-w-full"
			style="background: rgba(16,185,129,0.10); border-color: rgba(16,185,129,0.4); color: #047857"
			onclick={() => (buka = true)}
			title="Ketuk untuk membuka kembali pesan budaya hari ini"
		>
			<span>{selesai ? '✋ Siap laksanakan' : '📢'}</span>
			<span class="truncate">{item.isi_pesan}</span>
		</button>
	{:else}
		<section class="rounded-3xl p-4 sm:p-5 border" style="background: linear-gradient(135deg, rgba(79,70,229,0.10), rgba(2,132,199,0.10)); border-color: rgba(79,70,229,0.30)" aria-label="Fokus budaya hari ini">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="text-[11px] font-bold uppercase tracking-wider" style="color: #4f46e5">📢 Fokus Budaya Hari Ini</p>
					<p class="text-base font-extrabold mt-0.5" style="color: var(--sys-label)">{item.judul}</p>
				</div>
				<button class="px-2 text-sm" style="color: var(--sys-label3)" title="Sembunyikan sementara" aria-label="Sembunyikan" onclick={() => { kecil = true; buka = false; }}>✕</button>
			</div>
			{#if item.poster_id}
				<img class="mt-2 max-h-48 w-full rounded-2xl object-contain" style="background: var(--sys-bg2)" alt={item.judul} use:secureAssetSrc={`/assets/${item.poster_id}?width=640`} />
			{/if}
			<p class="text-sm mt-1 whitespace-pre-wrap" style="color: var(--sys-label2)">{item.isi_pesan}</p>

			{#if selesai}
				<p class="mt-3 text-xs font-bold text-emerald-600">✋ Komitmen hari ini sudah tercatat. Terima kasih!</p>
			{:else if item.pertanyaan_kuis}
				<div class="mt-3">
					<p class="text-sm font-bold" style="color: var(--sys-label)">{item.pertanyaan_kuis}</p>
					<div class="mt-2 grid gap-2 sm:grid-cols-2">
						{#each item.opsi_kuis as opsi, i}
							<button class="text-left text-sm px-3 py-2.5 rounded-xl border disabled:opacity-50" style="background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label)" disabled={busy} onclick={() => kirim('kuis', i)}>{opsi}</button>
						{/each}
					</div>
				</div>
			{:else}
				<button class="mt-3 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50" style="background: #4f46e5" disabled={busy} onclick={() => kirim('komitmen')}>✋ Siap Laksanakan</button>
			{/if}
			{#if pesan}<p class="text-xs mt-2" style="color: var(--sys-label2)">{pesan}</p>{/if}
		</section>
	{/if}
{/if}
