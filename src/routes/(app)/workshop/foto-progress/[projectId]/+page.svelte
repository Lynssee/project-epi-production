<!-- src/routes/(app)/workshop/foto-progress/[projectId]/+page.svelte -->
<!-- R8 — Before/After Photo Gallery per Work Ticket/PO (docs analisis v2 §7). Baca
     kembali workshop_report_po_detail.foto_urls yang sebelumnya write-only (ditulis
     Laporan Harian/Quick Report), dikelompokkan per tahap coating supaya progres
     sandblasting → primer → second → topcoat terlihat sebagai before/after. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { WORKSHOP_OPS, parseOpsWorkshop } from '$lib/services/workshopOpsProfile';
	import { fetchFotoTahapForProject, type FotoTahapGalleryEntry } from '$lib/services/workshopOpsApi';
	import { getPreviewUrl } from '$lib/services/dokumenApi';
	import { IconArrowLeft, IconLoader2, IconPhotoOff } from '@tabler/icons-svelte';

	const projectId = Number(page.params.projectId);
	// Fase 7c: workshop dari ?ws= (dibawa dari halaman /workshop); default ciketing.
	const wsKey = parseOpsWorkshop(page.url.searchParams.get('ws'));
	const P = WORKSHOP_OPS[wsKey];

	let entries = $state<FotoTahapGalleryEntry[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');
	let lightbox = $state<FotoTahapGalleryEntry | null>(null);

	const STAGE_ORDER = ['sandblasting', 'primer', 'second', 'topcoat'] as const;
	const STAGE_LABEL: Record<string, string> = {
		sandblasting: 'Sandblasting',
		primer: 'Primer',
		second: 'Second Coat',
		topcoat: 'Top Coat'
	};

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			entries = await fetchFotoTahapForProject(projectId, wsKey);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat foto progres.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let grouped = $derived.by(() => {
		const byStage = new Map<string, FotoTahapGalleryEntry[]>();
		const noStage: FotoTahapGalleryEntry[] = [];
		for (const e of entries) {
			if (!e.stage) { noStage.push(e); continue; }
			if (!byStage.has(e.stage)) byStage.set(e.stage, []);
			byStage.get(e.stage)!.push(e);
		}
		const ordered = STAGE_ORDER.filter((s) => byStage.has(s)).map((s) => ({ stage: s, label: STAGE_LABEL[s], items: byStage.get(s)! }));
		if (noStage.length) ordered.push({ stage: null as any, label: 'Foto Lain (tanpa tahap)', items: noStage });
		return ordered;
	});

	function formatTanggal(iso: string | null) {
		if (!iso) return '-';
		try { return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }
		catch { return '-'; }
	}
</script>

<svelte:head><title>Foto Progres — Workshop {P.label}</title></svelte:head>

<div class="p-4 max-w-lg mx-auto pb-24">
	<button class="flex items-center gap-1.5 text-sm mb-4" style="color: var(--sys-label2)" onclick={() => goto(`/workshop?ws=${wsKey}`)}>
		<IconArrowLeft size={16} /> Kembali
	</button>

	<h1 class="text-lg font-bold mb-1" style="color: var(--sys-label)">Foto Progres (Before/After)</h1>
	<p class="text-[12px] mb-4" style="color: var(--sys-label3)">
		Dikelompokkan per tahap coating (Sandblasting → Primer → Second → Topcoat) dari foto yang sudah diunggah lewat Laporan Harian/Quick Report — halaman ini tidak menambah foto baru.
	</p>

	{#if errorMsg}
		<div class="p-3 rounded-lg mb-3 text-[12px]" style="background: rgba(239,68,68,0.1); color:#ef4444;">{errorMsg}</div>
	{/if}

	{#if loading}
		<div class="flex justify-center py-10">
			<CircularProgressGauge size={64} strokeWidth={5} label="Memuat Foto Progres..." sublabel="Mengambil dokumentasi per tahap coating" />
		</div>
	{:else if entries.length === 0}
		<div class="text-center py-14 rounded-xl border" style="border-color: var(--sys-sep)">
			<IconPhotoOff size={32} style="color: var(--sys-label4); margin: 0 auto;" />
			<p class="text-[13px] font-semibold mt-2" style="color: var(--sys-label)">Belum ada foto progres untuk proyek ini.</p>
			<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Unggah lewat form Laporan Harian Workshop (field "Foto per Tahap").</p>
		</div>
	{:else}
		<div class="space-y-5">
			{#each grouped as g (g.stage ?? 'none')}
				<div>
					<h3 class="text-[12px] font-bold uppercase mb-2" style="color: var(--sys-label2)">{g.label} ({g.items.length})</h3>
					<div class="grid grid-cols-3 gap-2">
						{#each g.items as entry (entry.rowId + '-' + entry.fileId)}
							<button type="button" class="aspect-square rounded-lg overflow-hidden border" style="border-color: var(--sys-sep)" onclick={() => (lightbox = entry)}>
								<img src={getPreviewUrl(entry.fileId) + '?width=200&height=200&fit=cover'} alt={g.label} class="w-full h-full object-cover" loading="lazy" />
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if lightbox}
	<div class="fixed inset-0 z-50 bg-black/80 flex flex-col p-4" role="presentation" onclick={() => (lightbox = null)}>
		<button class="self-end text-white text-2xl mb-2" onclick={() => (lightbox = null)}>✕</button>
		<img src={getPreviewUrl(lightbox.fileId)} alt="" class="flex-1 w-full object-contain" />
		<div class="text-white text-[12px] mt-2 text-center">
			{lightbox.stage ? STAGE_LABEL[lightbox.stage] : 'Tanpa tahap'} · {formatTanggal(lightbox.tanggal)}
			{#if lightbox.subtaskName}· {lightbox.subtaskName}{/if}
			{#if lightbox.caption}<div class="mt-1 opacity-80">{lightbox.caption}</div>{/if}
		</div>
	</div>
{/if}
