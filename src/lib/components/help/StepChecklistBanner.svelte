<!-- src/lib/components/help/StepChecklistBanner.svelte -->
<!-- R-L1 "Syarat sebelum Simpan": banner ringan di bagian ATAS form lapangan (laporan harian, serah-terima material, lapor kerusakan, pinjam alat…).
     Menampilkan checklist langkah SOP yang relevan + penyebab yang sering membuat tertahan + jumlah gate sistem, supaya pengguna tahu syarat
     wajib (foto, dokumen, BA…) SEBELUM menekan Simpan. Sumber: alur terbit di Directus (1 alur, cache 5 menit) → salinan terakhir di perangkat
     (offline-first) → tidak tampil sama sekali bila tak ada (tanpa galat, tanpa mengganggu form). Dilipat secara bawaan; pilihan buka/tutup diingat. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { loadFlowById } from '$lib/services/processGuidanceFlowsApi';
	import type { ProcessNode } from '$lib/data/processGuidance';

	interface Props {
		/** id alur (flow_key) di Peta Alur Bisnis. */
		alur: string;
		/** id langkah yang relevan dengan form ini. */
		fokus: string;
		/** Judul banner (bawaan: "Syarat sebelum Simpan"). */
		judul?: string;
	}
	let { alur, fokus, judul = 'Syarat sebelum Simpan' }: Props = $props();

	const KEY = (f: string) => `epi_stepbanner_${f}`;
	let node = $state<ProcessNode | null>(null);
	let flowTitle = $state('');
	let open = $state(false);
	let done = $state(false);

	let fullHref = $derived(`/panduan/alur?alur=${encodeURIComponent(alur)}&fokus=${encodeURIComponent(fokus)}`);
	let items = $derived(node?.checklist ?? []);
	let gates = $derived(node?.gates?.length ?? 0);
	// Tampil hanya bila ada isi yang berguna.
	let show = $derived(!!node && (items.length > 0 || gates > 0 || (node.blockers?.length ?? 0) > 0));

	onMount(async () => {
		try {
			open = localStorage.getItem(KEY(fokus)) === 'open';
		} catch {
			/* penyimpanan tak tersedia: tetap dilipat */
		}
		const r = await loadFlowById(alur);
		node = r.flow?.nodes.find((n) => n.id === fokus) ?? null;
		flowTitle = r.flow?.title ?? '';
		done = true;
	});

	function toggle() {
		open = !open;
		try {
			localStorage.setItem(KEY(fokus), open ? 'open' : 'closed');
		} catch {
			/* abaikan */
		}
	}
</script>

{#if show && node}
	<section class="rounded-xl border border-indigo-200 bg-indigo-50/60 text-xs text-gray-700" data-testid="step-banner" aria-label={judul}>
		<button type="button" class="w-full flex items-center justify-between gap-2 px-3 py-2 text-left active:scale-[0.99] transition-transform" aria-expanded={open} onclick={toggle}>
			<span class="font-semibold text-indigo-900 flex items-center gap-1.5 min-w-0">
				<span aria-hidden="true">📋</span>
				<span class="truncate">{judul}</span>
				<span class="shrink-0 px-1.5 rounded-full bg-white border border-indigo-200 text-[10px] font-bold text-indigo-700">{items.length} butir</span>
				{#if gates > 0}<span class="shrink-0 px-1.5 rounded-full bg-purple-100 border border-purple-200 text-[10px] font-bold text-purple-700" title="Sistem memeriksa otomatis sebelum dokumen lanjut">🛡️ {gates} gate</span>{/if}
			</span>
			<span aria-hidden="true" class="text-indigo-400 shrink-0">{open ? '▴' : '▾'}</span>
		</button>

		{#if open}
			<div class="px-3 pb-3 space-y-2.5 border-t border-indigo-100 pt-2" data-testid="step-banner-body">
				<p class="text-[11px] text-gray-500">Langkah “{node.label}”{flowTitle ? ` — ${flowTitle}` : ''}{node.sla_hours ? ` · target selesai ${node.sla_hours} jam` : ''}. Pastikan butir berikut terpenuhi sebelum menyimpan agar tidak ditolak sistem.</p>
				{#if items.length}
					<ul class="space-y-1" data-testid="step-banner-checklist">
						{#each items as c}<li class="flex gap-2 leading-snug"><span class="text-indigo-300" aria-hidden="true">☐</span><span>{c}</span></li>{/each}
					</ul>
				{/if}
				{#if node.blockers?.length}
					<div class="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2" data-testid="step-banner-blockers">
						<p class="text-[11px] font-bold text-amber-700 uppercase tracking-wide">⚠️ Sering membuat tertahan</p>
						<ul class="mt-1 list-disc pl-4 space-y-0.5 text-amber-900">
							{#each node.blockers as b}<li class="leading-snug">{b}</li>{/each}
						</ul>
					</div>
				{/if}
				{#if gates > 0}
					<p class="text-[11px] text-purple-900 leading-snug">🛡️ Dijaga {gates} gate sistem. Bila simpan/ajukan ditolak, baca pesan di layar lalu lengkapi yang diminta.</p>
				{/if}
				<a href={fullHref} class="inline-block text-[11px] font-semibold text-indigo-700">Buka alur lengkap →</a>
			</div>
		{/if}
	</section>
{/if}
