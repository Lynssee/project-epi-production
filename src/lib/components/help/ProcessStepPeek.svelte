<!-- src/lib/components/help/ProcessStepPeek.svelte -->
<!-- Bantuan kontekstual di form lapangan: ketuk "Lihat alur" → kartu kecil berisi apa yang harus dipenuhi di langkah ini
     (checklist), penyebab yang sering membuat tertahan, gate sistem yang menjaga, dan target waktu. Tanpa pindah halaman.
     Alur diunduh SATU kali saat kartu dibuka pertama kali (bukan saat halaman dimuat) → tidak membebani form. Gagal = hanya tautan ke alur lengkap. -->
<script lang="ts">
	import { loadFlowById } from '$lib/services/processGuidanceFlowsApi';
	import type { ProcessNode } from '$lib/data/processGuidance';
	import ProcessTrainingStatus from '$lib/components/help/ProcessTrainingStatus.svelte';
	import { trainingForNode, type NodeTraining } from '$lib/utils/processTraining';

	interface Props {
		/** id langkah yang disorot. */
		fokus: string;
		/** id alur (bawaan: alur Sales → Inventory, sama seperti tautan lama). */
		alur?: string;
		label?: string;
	}
	let { fokus, alur = 'sales_to_inventory', label = 'Lihat alur' }: Props = $props();

	let open = $state(false);
	let loading = $state(false);
	let loaded = $state(false);
	let node = $state<ProcessNode | null>(null);
	let links = $state<NodeTraining[]>([]);
	let flowTitle = $state('');

	let fullHref = $derived(`/panduan/alur?alur=${encodeURIComponent(alur)}&fokus=${encodeURIComponent(fokus)}`);

	async function toggle() {
		open = !open;
		if (!open || loaded || loading) return;
		loading = true;
		const r = await loadFlowById(alur);
		loading = false;
		loaded = true;
		node = r.flow?.nodes.find((n) => n.id === fokus) ?? null;
		links = r.flow ? trainingForNode(r.flow, fokus) : [];
		flowTitle = r.flow?.title ?? '';
	}
</script>

<div class="inline-block max-w-full align-top" data-testid="step-peek">
	<button
		type="button"
		class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-gray-200 text-gray-600 bg-white active:scale-95 transition-transform"
		aria-expanded={open}
		title="Lihat apa yang harus dipenuhi di langkah ini dan ke mana lanjutnya"
		onclick={toggle}
	>
		<span aria-hidden="true">🗺️</span>{label}<span aria-hidden="true" class="text-gray-400">{open ? '▴' : '▾'}</span>
	</button>

	{#if open}
		<div class="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700 space-y-2.5 shadow-sm" data-testid="step-peek-body">
			{#if loading}
				<p class="text-gray-400" role="status">Memuat panduan…</p>
			{:else if node}
				<p class="font-bold text-gray-900 text-[12px]">{node.label}</p>
				{#if node.desc}<p class="text-gray-600 leading-snug">{node.desc}</p>{/if}
				{#if node.sla_hours}<p class="text-[11px] text-gray-500">⏱ Target selesai {node.sla_hours} jam</p>{/if}

				{#if node.checklist?.length}
					<div data-testid="peek-checklist">
						<p class="text-[11px] font-bold text-gray-500 uppercase tracking-wide">✅ Yang perlu dipenuhi</p>
						<ul class="mt-1 space-y-1">
							{#each node.checklist as c}<li class="flex gap-2 leading-snug"><span class="text-gray-300">☐</span><span>{c}</span></li>{/each}
						</ul>
					</div>
				{/if}

				{#if node.blockers?.length}
					<div class="rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-2" data-testid="peek-blockers">
						<p class="text-[11px] font-bold text-amber-700 uppercase tracking-wide">⚠️ Sering membuat tertahan</p>
						<ul class="mt-1 list-disc pl-4 space-y-0.5 text-amber-900">
							{#each node.blockers as b}<li class="leading-snug">{b}</li>{/each}
						</ul>
					</div>
				{/if}

				<ProcessTrainingStatus links={links} />

				{#if node.gates?.length}
					<div class="rounded-lg border border-purple-200 bg-purple-50/70 px-2.5 py-2" data-testid="peek-gates">
						<p class="text-[11px] font-bold text-purple-700 uppercase tracking-wide">🛡️ Dijaga {node.gates.length} gate sistem</p>
						<p class="mt-0.5 text-[11px] text-purple-900 leading-snug">
							Sistem memeriksa otomatis sebelum dokumen lanjut. Bila tombol simpan/ajukan ditolak, baca pesan di layar dan lengkapi yang diminta.
						</p>
					</div>
				{/if}
			{:else}
				<p class="text-gray-500">Panduan langkah ini belum tersedia di perangkat.</p>
			{/if}
			<a href={fullHref} class="inline-block text-[11px] font-semibold text-[var(--p,#1d6fa5)]">Buka alur lengkap{flowTitle ? ` “${flowTitle}”` : ''} →</a>
		</div>
	{/if}
</div>
