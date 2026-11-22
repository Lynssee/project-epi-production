<script lang="ts">
	// Kartu "Setelah training ini kamu bisa…" + "Hasil & Catatan Saya" (rencana training_outcome_review, Fase 4).
	// Tersembunyi bila tidak ada outcome / dimatikan di Setting Training. Gagal memuat = kartu tidak tampil (bukan memblokir kursus), dilog.
	import { onMount } from 'svelte';
	import { getMyOutcome, type MyOutcomeView } from '$lib/services/ess/trainingOutcome';

	let { programId }: { programId: number } = $props();
	let view = $state<MyOutcomeView | null>(null);

	const TL: Record<string, string> = { none: '', remedial: 'Ulangi modul yang masih lemah (remedial).', ulang: 'Disarankan mengulang program ini.', coaching: 'Anda akan dibimbing atasan/mentor.' };
	const ST: Record<string, { t: string; c: string }> = {
		tercapai: { t: 'Tercapai', c: '#16a34a' },
		sebagian: { t: 'Sebagian', c: '#d97706' },
		belum: { t: 'Belum', c: '#dc2626' }
	};

	onMount(async () => {
		try { view = await getMyOutcome(programId); } catch (e) { console.warn('[OutcomeCard] gagal memuat:', (e as Error)?.message); }
	});

	const grup = (tipe: string) => (view?.outcomes ?? []).filter((o) => o.tipe === tipe);
</script>

{#if view?.visible && view.outcomes.length}
	<div class="rounded-2xl p-4 mt-4 space-y-3 border" style="border-color: var(--sys-sep, rgba(0,0,0,0.12)); background: var(--sys-bg2, transparent)">
		{#if grup('ekspektasi').length || grup('outcome').length}
			<div>
				<h2 class="text-sm font-bold" style="color: var(--sys-label)">Setelah training ini kamu bisa…</h2>
				<ul class="mt-2 space-y-1.5">
					{#each [...grup('outcome'), ...grup('ekspektasi')] as o (o.id)}
						<li class="text-xs flex items-start gap-2" style="color: var(--sys-label2)">
							<span>{o.status === 'tercapai' ? '✅' : '▫️'}</span>
							<span class="flex-1">{o.deskripsi}
								{#if o.indikator}<span class="block text-[11px]" style="color: var(--sys-label4)">Indikator: {o.indikator}</span>{/if}
							</span>
							{#if o.status && ST[o.status]}<span class="text-[10px] font-bold" style="color: {ST[o.status].c}">{ST[o.status].t}</span>{/if}
						</li>
					{/each}
				</ul>
				{#if view.persen != null}<p class="text-[11px] mt-2 font-semibold" style="color: var(--sys-label3)">Capaian Anda: {view.persen}%</p>{/if}
			</div>
		{/if}

		{#if grup('output').length}
			<div>
				<h3 class="text-xs font-bold" style="color: var(--sys-label)">Yang akan kamu hasilkan</h3>
				<ul class="mt-1 list-disc pl-5 text-xs" style="color: var(--sys-label2)">
					{#each grup('output') as o (o.id)}<li>{o.deskripsi}</li>{/each}
				</ul>
			</div>
		{/if}

		{#if view.review}
			<div class="pt-2 border-t" style="border-color: var(--sys-sep, rgba(0,0,0,0.12))">
				<h3 class="text-xs font-bold" style="color: var(--sys-label)">Hasil &amp; Catatan Saya <span class="font-normal" style="color: var(--sys-label4)">· dari {view.review.peran}</span></h3>
				{#if view.review.kekuatan}<p class="text-xs mt-1" style="color: var(--sys-label2)">👍 {view.review.kekuatan}</p>{/if}
				{#if view.review.kekurangan}<p class="text-xs mt-1" style="color: var(--sys-label2)">⚠️ {view.review.kekurangan}</p>{/if}
				{#each view.review.gaps ?? [] as g}<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">• {g.kategori}: {g.deskripsi}</p>{/each}
				{#if view.review.rekomendasi}<p class="text-xs mt-1" style="color: var(--sys-label2)">💡 {view.review.rekomendasi}</p>{/if}
				{#if TL[view.review.tindakLanjut]}<p class="text-xs mt-1 font-semibold" style="color: var(--sys-label)">{TL[view.review.tindakLanjut]}</p>{/if}
			</div>
		{/if}
	</div>
{/if}
