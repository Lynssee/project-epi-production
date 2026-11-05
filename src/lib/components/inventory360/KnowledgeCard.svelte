<!--
  Kartu Pengetahuan Inventory 360° untuk LAPANGAN (mobile-first).
    <KnowledgeCard itemId={…} context="purchase" />          → tombol ⓘ + lembar bawah (bottom sheet) di HP
    <KnowledgeCard itemId={…} context="usage" inline />      → isi kartu langsung di halaman (mis. hasil scan QR)
  context: purchase | receive | usage | maintenance | sales — menentukan bagian yang tampil (diatur superadmin per kategori).
  Titik warna: hijau = profil terverifikasi · kuning = belum terverifikasi · abu = belum ada profil · merah = barang KRITIS tanpa profil terverifikasi.
  Lapangan hanya MEMBACA. Mengisi/memverifikasi profil dilakukan admin di Inventory 360° (dashboard internal).
  Tidak ada rupiah di kartu lapangan.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { IconInfoCircle, IconX } from '@tabler/icons-svelte';
	import { getKnowledgeCard, isCardContextEnabled, isFeedbackEnabled, submitCardFeedback, isInspectionEnabled, getInspectionChecked, saveInspection, trackCardOpen, type KnowledgeCardData } from '$lib/services/inventoryCardApi';
	import { buildInspectionItems, summarizeInspection } from '$lib/services/inventory360/inventoryKnowledgeInspection.js';
	import { FEEDBACK_KINDS, FEEDBACK_NOTE_MAX } from '$lib/services/inventory360/inventoryKnowledgeFeedback.js';
	import {
		buildCardBlocks,
		buildCardWarnings,
		cardIndicator,
		cardStatus,
		isCardKritis
	} from '$lib/services/inventory360/inventoryKnowledgeView.js';

	let {
		itemId,
		context = 'purchase',
		inline = false,
		label = ''
	}: { itemId: number | string | null | undefined; context?: string; inline?: boolean; label?: string } = $props();

	const STATUS_LABEL: Record<string, string> = {
		belum: 'Belum ada profil',
		draft: 'Draft',
		review: 'Menunggu verifikasi',
		verified: 'Terverifikasi',
		stale: 'Perlu ditinjau ulang'
	};
	const DOT: Record<string, string> = { verified: 'bg-emerald-500', unverified: 'bg-amber-400', none: 'bg-slate-300', danger: 'bg-red-500' };
	const WARN: Record<string, string> = {
		danger: 'border-red-300 bg-red-50 text-red-800',
		warn: 'border-amber-300 bg-amber-50 text-amber-900',
		info: 'border-slate-200 bg-slate-50 text-slate-700'
	};

	let enabled = $state(true);
	let card = $state<KnowledgeCardData | null>(null);
	let loaded = $state(false);
	let error = $state('');
	let open = $state(false);

	// Checklist inspeksi terima (Fase C)
	let inspectionOn = $state(false);
	let checkedIds = $state<string[]>([]);
	const inspectionItems = $derived(context === 'receive' && card?.profile ? buildInspectionItems(card.profile) : []);
	const inspection = $derived(summarizeInspection(inspectionItems, checkedIds));

	function toggleInspection(id: string) {
		checkedIds = checkedIds.includes(id) ? checkedIds.filter((x) => x !== id) : [...checkedIds, id];
		saveInspection(itemId as number, '', card?.profile, checkedIds);
	}

	// Laporan "spek berbeda dengan barang di tangan" (Fase B)
	let feedbackOn = $state(false);
	let reportOpen = $state(false);
	let reportKind = $state('');
	let reportNote = $state('');
	let reportBusy = $state(false);
	let reportDone = $state(false);
	let reportError = $state('');

	const indicator = $derived(card ? cardIndicator(card) : 'none');
	const status = $derived(card ? cardStatus(card) : 'belum');
	const kritis = $derived(card ? isCardKritis(card) : false);
	const blocks = $derived(card ? buildCardBlocks(card, context) : []);
	const warnings = $derived(card ? buildCardWarnings(card, context) : []);

	async function load(id: number | string | null | undefined) {
		error = '';
		loaded = false;
		card = null;
		reportOpen = false;
		reportKind = '';
		reportNote = '';
		reportDone = false;
		reportError = '';
		try {
			enabled = await isCardContextEnabled(context);
			if (!enabled) return;
			card = await getKnowledgeCard(id);
			feedbackOn = await isFeedbackEnabled().catch(() => false);
			inspectionOn = context === 'receive' ? await isInspectionEnabled().catch(() => false) : false;
			checkedIds = inspectionOn ? getInspectionChecked(id as number) : [];
		} catch (e: any) {
			console.error('[KnowledgeCard] gagal memuat kartu barang', id, e);
			error = e?.message || 'Gagal memuat.';
		} finally {
			loaded = true;
		}
	}

	// Muat saat dipasang & saat barang berganti pada komponen yang sama (baris dipilih ulang).
	let lastId: unknown = Symbol('belum');
	$effect(() => {
		const id = itemId;
		if (id === lastId) return;
		lastId = id;
		open = false;
		load(id);
	});

	// Mode inline (mis. hasil scan QR): kartu langsung terbaca → catat sekali per barang.
	let trackedInline: unknown = null;
	$effect(() => {
		if (inline && loaded && card && trackedInline !== itemId) {
			trackedInline = itemId;
			trackCardOpen(itemId, context);
		}
	});

	async function sendReport() {
		if (reportBusy || !card?.profile) return;
		reportBusy = true;
		reportError = '';
		try {
			await submitCardFeedback({ itemId: itemId as number, profileId: card.profile.id ?? null, jenis: reportKind, catatan: reportNote, context });
			reportDone = true;
			reportOpen = false;
		} catch (e: any) {
			reportError = e?.message || 'Gagal mengirim laporan.';
		} finally {
			reportBusy = false;
		}
	}

	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

{#snippet body()}
	{#if !loaded}
		<p class="text-xs text-slate-500">Memuat…</p>
	{:else if error}
		<p class="text-xs text-red-600">Gagal memuat pengetahuan barang: {error}</p>
	{:else if !card}
		<p class="text-xs text-slate-500">Barang tidak ditemukan.</p>
	{:else}
		<div class="mb-2 flex flex-wrap items-center gap-1.5">
			<span class="h-2.5 w-2.5 rounded-full {DOT[indicator]}"></span>
			<span class="text-xs font-bold text-slate-800">{STATUS_LABEL[status]}</span>
			{#if kritis}<span class="rounded bg-red-100 px-1 text-[10px] font-bold text-red-700">KRITIS</span>{/if}
		</div>

		{#if card.offline}
			<div class="mb-2 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-xs text-slate-700">
				📴 Mode offline — panduan tersimpan di HP sejak {new Date(card.offline.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}. Bisa jadi bukan versi terbaru; sambungkan internet untuk memperbarui.
			</div>
		{/if}

		{#each warnings as w}
			<div class="mb-2 rounded-lg border px-2.5 py-1.5 text-xs {WARN[w.level]}">{w.text}</div>
		{/each}

		{#each blocks as b (b.key)}
			<div class="mb-3">
				<div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{b.title}</div>
				<div class="space-y-1">
					{#each b.rows as r}
						<div class="text-sm {r.warn ? 'text-amber-800' : 'text-slate-700'}">
							{#if r.label}<span class="font-semibold">{r.label}{r.kritis ? ' ★' : ''}:</span>{/if}
							{#if r.list}
								<ul class="ml-5 list-disc">{#each r.list as li}<li>{li}</li>{/each}</ul>
							{:else if r.text}
								<span class={r.missing ? 'italic text-rose-600' : ''}>{r.text}</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{:else}
			{#if card.profile}<p class="text-xs text-slate-500">Profil belum berisi informasi untuk keperluan ini.</p>{/if}
		{/each}

		{#if inspectionOn && inspectionItems.length}
			<div class="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
				<div class="mb-1 flex items-center justify-between">
					<span class="text-xs font-bold text-emerald-900">Checklist terima barang</span>
					<span class="rounded-full px-2 py-0.5 text-[10px] font-bold {inspection.complete ? 'bg-emerald-600 text-white' : 'bg-white text-emerald-800'}">{inspection.done}/{inspection.total}</span>
				</div>
				<p class="mb-1.5 text-[11px] text-emerald-800">Centang setelah dicek langsung pada barang. Hasilnya ikut tercatat di catatan penerimaan. Tidak menghalangi penyimpanan.</p>
				<div class="space-y-1">
					{#each inspectionItems as it (it.id)}
						<label class="flex min-h-[40px] items-start gap-2 rounded-md bg-white px-2 py-1.5 text-sm text-slate-700 active:bg-slate-50">
							<input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0" checked={checkedIds.includes(it.id)} onchange={() => toggleInspection(it.id)} />
							<span class={checkedIds.includes(it.id) ? 'text-slate-400 line-through' : ''}>{it.text}</span>
						</label>
					{/each}
				</div>
			</div>
		{/if}

		{#if card.profile?.training_program_id && card.profile.status === 'verified'}
			<a class="mb-2 block rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800" href="/ess/pelatihan/{card.profile.training_program_id}">
				📘 Pelajari (5 menit){card.profile.wajib_training ? ' — WAJIB sebelum meminta barang ini' : ''}
			</a>
		{/if}

		{#if !card.profile}
			<p class="text-xs text-slate-500">Minta admin Inventory melengkapi profil barang ini agar panduannya muncul di sini.</p>
		{:else if feedbackOn}
			<div class="mt-2 border-t border-slate-100 pt-2">
				{#if reportDone}
					<p class="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">Laporan terkirim ke admin Inventory. Terima kasih — data akan ditinjau ulang.</p>
				{:else if !reportOpen}
					<button type="button" class="text-xs font-semibold text-amber-700 underline" onclick={() => (reportOpen = true)}>
						Spek di sini beda dengan barang di tangan? Laporkan
					</button>
				{:else}
					<div class="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
						<p class="text-xs font-semibold text-amber-900">Apa yang berbeda?</p>
						{#each FEEDBACK_KINDS as k (k.key)}
							<label class="flex items-start gap-2 text-xs text-slate-700">
								<input type="radio" name="fb-kind-{itemId}" value={k.key} checked={reportKind === k.key} onchange={() => (reportKind = k.key)} class="mt-0.5" />
								<span>{k.label}</span>
							</label>
						{/each}
						<textarea
							class="w-full rounded border border-slate-300 bg-white p-1.5 text-xs"
							rows="2"
							maxlength={FEEDBACK_NOTE_MAX}
							placeholder="Contoh: kartu tertulis 20 L, di kaleng tertera 18 L (opsional, wajib bila memilih 'Lainnya')"
							bind:value={reportNote}
						></textarea>
						{#if reportError}<p class="text-xs text-red-600">{reportError}</p>{/if}
						<div class="flex gap-2">
							<button type="button" class="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40" disabled={reportBusy || !reportKind} onclick={sendReport}>
								{reportBusy ? 'Mengirim…' : 'Kirim laporan'}
							</button>
							<button type="button" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600" onclick={() => (reportOpen = false)}>Batal</button>
						</div>
						<p class="text-[10px] text-slate-500">Laporan hanya memberi tahu admin Inventory; isi kartu tidak berubah sampai admin meninjau.</p>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
{/snippet}

{#if enabled}
	{#if inline}
		<div class="space-y-1">{@render body()}</div>
	{:else}
		<button
			type="button"
			class="relative inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 active:bg-slate-100"
			title={loaded ? `Pengetahuan barang: ${STATUS_LABEL[status]}${kritis ? ' · KRITIS' : ''}. Ketuk untuk panduan beli & pakai.` : 'Memuat…'}
			aria-label="Pengetahuan barang"
			aria-expanded={open}
			onclick={(e) => {
				e.stopPropagation();
				open = !open;
				if (open) trackCardOpen(itemId, context);
			}}
		>
			<IconInfoCircle size={14} />
			{#if label}<span>{label}</span>{/if}
			{#if inspectionOn && inspection.total}<span class="rounded-full px-1 text-[10px] font-bold {inspection.complete ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}">{inspection.done}/{inspection.total}</span>{/if}
			<span class="h-2 w-2 rounded-full {loaded ? DOT[indicator] : 'animate-pulse bg-slate-200'}"></span>
		</button>

		{#if open}
			<!-- Lembar bawah (bottom sheet): nyaman di HP, tidak terpotong container overflow-hidden -->
			<div class="fixed inset-0 z-[9999] flex items-end justify-center bg-black/40" role="presentation" onclick={() => (open = false)}>
				<div
					class="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-4 pb-8 shadow-2xl"
					role="dialog"
					aria-modal="true"
					aria-label="Pengetahuan barang"
					tabindex="-1"
					onclick={(e) => e.stopPropagation()}
					onkeydown={(e) => e.stopPropagation()}
				>
					<div class="mb-2 flex items-center justify-between">
						<h3 class="text-sm font-bold text-slate-800">Pengetahuan Barang</h3>
						<button type="button" class="rounded-full p-1 text-slate-400 hover:bg-slate-100" aria-label="Tutup" onclick={() => (open = false)}><IconX size={18} /></button>
					</div>
					{@render body()}
				</div>
			</div>
		{/if}
	{/if}
{/if}
