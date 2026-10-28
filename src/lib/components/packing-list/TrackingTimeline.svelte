<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// PL Tracking Pipeline v2, Fase 4c — timeline pelacakan satu baris permintaan
	// barang lapangan (project_budgets.id). Membaca cross-dept 'pl-tracking' di admin app.
	//
	// Aturan tampil (§4c rencana):
	//  - Jalur cepat (stok ada): stage pengadaan TIDAK dirender (server sudah tidak
	//    mengirimnya) — bukan "collapsed".
	//  - Setiap ETA WAJIB mencantumkan sumbernya.
	//  - Stage 'done' tanpa event ditandai "belum tercatat", BUKAN "belum terjadi".
	//  - Tanpa animasi berkedip (perangkat lapangan hemat baterai & sinyal lemah).

	import {
		IconCircleCheck, IconClock, IconPoint, IconAlertTriangle, IconChevronRight,
		IconFileText, IconTruck, IconReceipt, IconBox, IconLoader2, IconInfoCircle,
		IconCamera
	} from '@tabler/icons-svelte';
	import { fetchPlTimeline, etaSourceLabel, type PlTimeline } from '$lib/services/plTracking';
	import { goto } from '$app/navigation';

	let { budgetId, itemName = '' }: { budgetId: number; itemName?: string } = $props();

	let loading = $state(true);
	let errored = $state(false);
	let data = $state<PlTimeline | null>(null);

	async function load() {
		loading = true;
		errored = false;
		data = null;
		try {
			data = await fetchPlTimeline(budgetId);
			if (!data) errored = true;
		} catch {
			errored = true;
		} finally {
			loading = false;
		}
	}

	// Jalan saat mount DAN setiap kali budgetId berganti (panel dibuka utk item lain).
	$effect(() => {
		if (budgetId) load();
	});

	function fmt(ts: string | null): string {
		if (!ts) return '';
		const d = new Date(ts);
		if (isNaN(d.getTime())) return '';
		return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	}

	function docIcon(type: string) {
		if (type === 'PO') return IconTruck;
		if (type === 'INVOICE') return IconReceipt;
		if (type === 'SJ') return IconBox;
		return IconFileText;
	}
	function docLabel(type: string): string {
		return { PR: 'Purchase Request', PO: 'PO Supplier', INVOICE: 'Invoice', SJ: 'Surat Jalan' }[type] || type;
	}

	// Fix B4 (rencana v2 "PL -> Multi Surat Jalan + Pergantian Barang", 23 Sep 2026): SJ
	// sudah berangkat tapi belum ada bukti terima (foto/GPS/TTD) lewat GR — beri jalan
	// langsung ke alur GR yang sudah ada, jangan bangun form baru. SJ yang dipakai = yang
	// PALING BARU di linkedDocs (data.linkedDocs sudah memuat semua SJ sejak fix B5).
	let latestSjId = $derived(
		[...(data?.linkedDocs || [])].reverse().find((d) => d.type === 'SJ' && d.id != null)?.id ?? null
	);
	function goKonfirmasiTerima() {
		if (latestSjId == null) return;
		goto(`/stock-lapangan/masuk?mode=gr&sj=${encodeURIComponent(String(latestSjId))}`);
	}
</script>

<div class="text-[13px]">
	{#if loading}
		<CircularProgressGauge size={44} strokeWidth={3} label="Memuat status tracking packing list..." />
	{:else if errored || !data}
		<div class="flex items-start gap-2 py-4 px-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
			<IconAlertTriangle size={16} class="mt-0.5 shrink-0" />
			<div class="text-[11px] leading-relaxed">
				Status pelacakan belum tersedia untuk item ini.
				<span class="text-amber-600/80 dark:text-amber-400/80">
					Biasanya karena permintaan ini dibuat sebelum pelacakan aktif, atau belum diproses pengadaan.
				</span>
			</div>
		</div>
	{:else}
		<!-- Header ringkas -->
		<div class="mb-2 flex items-center justify-between gap-2">
			<div class="min-w-0">
				<p class="font-bold text-slate-800 dark:text-slate-100 truncate">{data.itemName || itemName || 'Item'}</p>
				<p class="text-[10px] text-slate-400">
					{data.path === 'pengadaan' ? 'Lewat jalur pengadaan (stok gudang kurang)' : 'Jalur cepat (stok gudang tersedia)'}
				</p>
			</div>
			{#if data.path === 'pengadaan'}
				<span class="shrink-0 text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
					PENGADAAN
				</span>
			{/if}
		</div>

		<!-- Fase 2 (rencana v2 "PL -> Multi Surat Jalan + Pergantian Barang"): label sisa
			 kirim untuk kiriman parsial (bertahap), pakai ETA yang sudah ada. -->
		{#if data.qty != null && data.qtySudahDikirim != null && data.qtySudahDikirim > 0 && data.qtySudahDikirim < data.qty}
			{@const sisa = data.qty - data.qtySudahDikirim}
			<div class="mb-2 text-[10.5px] text-slate-500 dark:text-slate-400">
				Terkirim {data.qtySudahDikirim}/{data.qty}{data.satuan ? ` ${data.satuan}` : ''} · sisa {sisa}{data.satuan ? ` ${data.satuan}` : ''} menyusul
				{#if data.eta?.date}
					<span> (ETA {fmt(data.eta.date)})</span>
				{/if}
			</div>
		{/if}

		{#if data.currentStageKey === 'sj_terbit' && latestSjId != null}
			<button
				type="button"
				onclick={goKonfirmasiTerima}
				class="mb-2 w-full flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-3"
			>
				<IconCamera size={15} />
				<span>Konfirmasi Terima Barang</span>
			</button>
			<p class="mb-2 text-[10px] text-slate-400 leading-relaxed">
				Foto barang + tanda tangan penerima. Tanpa ini, gudang menganggap barang belum terbukti sampai.
			</p>
		{/if}

		{#if !data.itemLinked}
			<div class="mb-2 flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded-lg px-2 py-1.5">
				<IconAlertTriangle size={13} class="mt-0.5 shrink-0" />
				<span>Item ini belum tertaut Master Barang, jadi jalur pengadaannya tidak bisa dilacak otomatis.</span>
			</div>
		{/if}

		<!-- Timeline vertikal -->
		<ol class="relative">
			{#each data.stages as st, i (st.key)}
				{@const isLast = i === data.stages.length - 1}
				<li class="relative flex gap-3 pb-3 {isLast ? '' : ''}">
					<!-- garis vertikal -->
					{#if !isLast}
						<span
							class="absolute left-[9px] top-5 bottom-0 w-px {st.state === 'done' ? 'bg-emerald-300 dark:bg-emerald-800' : 'bg-slate-200 dark:bg-slate-700'}"
						></span>
					{/if}
					<!-- ikon status -->
					<span class="relative z-10 shrink-0 mt-0.5">
						{#if st.state === 'done'}
							<IconCircleCheck size={19} class="text-emerald-500" />
						{:else if st.state === 'current'}
							<IconClock size={19} class="text-indigo-500" />
						{:else}
							<IconPoint size={19} class="text-slate-300 dark:text-slate-600" />
						{/if}
					</span>
					<!-- isi -->
					<div class="min-w-0 flex-1 -mt-0.5">
						<p class="font-semibold {st.state === 'pending' ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'}">
							{st.label}
						</p>
						{#if st.state === 'pending'}
							<p class="text-[10px] text-slate-400">Belum dimulai</p>
						{:else if st.ts}
							<p class="text-[10px] text-slate-500 dark:text-slate-400">
								{fmt(st.ts)}{st.actor ? ` · ${st.actor}` : ''}
							</p>
						{:else}
							<p class="text-[10px] text-slate-400 italic">Belum tercatat</p>
						{/if}

						<!-- ETA di stage berjalan -->
						{#if st.state === 'current' && data.eta?.date}
							<div class="mt-1 inline-flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 rounded px-1.5 py-0.5">
								<IconInfoCircle size={11} />
								<span>Perkiraan tiba: {fmt(data.eta.date) || data.eta.date} · dari {etaSourceLabel(data.eta.source)}</span>
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ol>

		<!-- Dokumen terkait -->
		{#if data.linkedDocs && data.linkedDocs.length > 0}
			<div class="mt-1 pt-2 border-t border-slate-100 dark:border-slate-700/60">
				<p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Dokumen terkait</p>
				<div class="flex flex-col gap-1">
					{#each data.linkedDocs as d}
						{@const Ico = docIcon(d.type)}
						<div class="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
							<Ico size={13} class="text-slate-400 shrink-0" />
							<span class="font-medium">{docLabel(d.type)}</span>
							{#if d.number}<span class="text-slate-500">{d.number}</span>{/if}
							{#if d.status}<span class="text-[9.5px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500">{d.status}</span>{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>
