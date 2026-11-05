<!-- src/routes/(app)/panduan/alur/+page.svelte -->
<!-- Panduan Alur Bisnis (lapangan). Deep-link: /panduan/alur?alur=<id alur>&fokus=<id langkah>, mis. ?fokus=survey (alur bawaan: sales_to_inventory).
     Hemat kuota: hanya DAFTAR ringkas alur + SATU alur yang dibuka yang diunduh (bukan seluruh alur ±2 MB).
     Sumber: Directus (dikelola dari erp-epi /settings/process-guidance) → salinan terakhir di perangkat → salinan bawaan app.
     "Tugas Saya": langkah yang PIC-nya cocok dengan jabatan Anda (dipetakan di erp-epi, tab Peta PIC). -->
<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { PROCESS_FLOWS, type ProcessFlow } from '$lib/data/processGuidance';
	import { loadFlowIndex, loadFlowById, loadFlowChain, type FlowSource } from '$lib/services/processGuidanceFlowsApi';
	import type { FlowChain } from '$lib/utils/processHandoffChain';
	import { enqueueRead, flushReadQueue, readQueue, type PendingRead } from '$lib/utils/readConfirmQueue';
	import { loadMyTasks, type MineResult } from '$lib/services/processGuidanceMineApi';
	import { summarizeFlow, type FlowSummary, type MyTask } from '$lib/utils/processMyTasks';
	import { waLink } from '$lib/utils/waNumber';
	import { loadTrainingStatus, type TrainingStatus } from '$lib/services/processGuidanceTrainingApi';
	import ProcessGuidanceMobile from '$lib/components/help/ProcessGuidanceMobile.svelte';
	import FieldProjectStepper from '$lib/components/help/FieldProjectStepper.svelte';
	import { getMatchingFlowsForStage, type ProjectStage } from '$lib/utils/fieldProjectStepper.js';
	import FieldStateAndGateCard from './FieldStateAndGateCard.svelte';
	import KendalaSearch from './KendalaSearch.svelte';
	import PdfFetchSheet from '$lib/components/shared/PdfFetchSheet.svelte';

	const DEFAULT_FLOW = 'sales_to_inventory';
	const alurParam = page.url.searchParams.get('alur') ?? '';
	const kategoriParam = page.url.searchParams.get('kategori');
	const sifatParam = page.url.searchParams.get('sifat') ?? page.url.searchParams.get('procedure_type');

	let index = $state<FlowSummary[]>(PROCESS_FLOWS.map((f) => summarizeFlow(f)));
	let filterProcedureType = $state<string>(sifatParam !== null ? sifatParam : '');
	let sumber = $state<FlowSource>('local');
	let flowId = $state(alurParam || DEFAULT_FLOW);
	// Tampil seketika dari salinan bawaan bila ada; diganti hasil server setelah dimuat.
	let flow = $state<ProcessFlow | null>(PROCESS_FLOWS.find((f) => f.id === (alurParam || DEFAULT_FLOW)) ?? null);
	let fokus = $state(page.url.searchParams.get('fokus') ?? '');
	let loadingFlow = $state(false);
	let flowError = $state('');
	let swap = $state(0);
	let chain = $state<FlowChain | null>(null);
	let mine = $state<MineResult | null>(null);
	let q = $state('');
	/** Buku Saku & Checklist (PDF server-side) alur yang sedang dibuka. */
	let bukuSakuOpen = $state(false);
	let bukuSakuOffline = $state(false);
	function bukaBukuSaku() {
		bukuSakuOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
		if (!bukuSakuOffline) bukuSakuOpen = true;
	}
	let onlyMine = $state(false);
	/** Filter "Belum Saya Baca": flow_key yang sudah saya tandai paham (server + catatan lokal perangkat). */
	let readKeys = $state<Set<string>>(new Set());
	let readLoaded = $state(false);
	let onlyUnread = $state(false);
	let openMine = $state(false);
	let trainingMap = $state<Map<number, TrainingStatus>>(new Map());

	/** Ringkasan training satu tugas: hanya program TERBIT yang dihitung; belum = belum lulus. null = tak ada training / status belum termuat. */
	function trainingChip(t: MyTask): { total: number; belum: number } | null {
		const progs = (t.training ?? []).map((x) => trainingMap.get(x.program_id)).filter((p): p is TrainingStatus => !!p && p.terbit);
		if (progs.length === 0) return null;
		return { total: progs.length, belum: progs.filter((p) => p.status_saya !== 'lulus').length };
	}
	// Lapangan prioritas Instruksi Kerja (Turunan)
	// Default 'Semua Level': setelah rapikan hirarki (Nov 2026) sebagian besar alur lapangan berstatus SOP Induk, bukan IK — default 'turunan' menyembunyikan ±90% alur.
	let filterKategori = $state<string>(kategoriParam !== null ? kategoriParam : '');
	let readTime = $state<string>('');
	let hasRead = $derived(Boolean(readTime));
	/** Jumlah konfirmasi baca yang menunggu terkirim (offline). */
	let pendingSync = $state(0);

	async function kirimBaca(item: PendingRead, queued: boolean): Promise<{ ok: boolean; status: number }> {
		try {
			const res = await fetch('/api/process-guidance/read-confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ flow_key: item.flow_key, version_seq: item.version_seq, ...(queued ? { queued: true, read_at: item.read_at } : {}) })
			});
			return { ok: res.ok, status: res.status };
		} catch {
			return { ok: false, status: 0 };
		}
	}

	/** Kirim antrean baca yang tertunda (dipanggil saat halaman dibuka & saat kembali online). */
	async function sinkronBaca() {
		if (typeof localStorage === 'undefined' || readQueue(localStorage).length === 0) return;
		await flushReadQueue(localStorage, (it) => kirimBaca(it, true));
		pendingSync = readQueue(localStorage).length;
	}

	const KATEGORI_BADGE: Record<string, { label: string; cls: string }> = {
		master: { label: '🌟 Master (Makro)', cls: 'bg-purple-100 text-purple-800 border-purple-300' },
		induk: { label: '📘 SOP Induk', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
		turunan: { label: '📄 Instruksi Kerja (IK)', cls: 'bg-teal-100 text-teal-800 border-teal-300' }
	};

	const PROCEDURE_TYPE_MAP: Record<string, { label: string; icon: string; cls: string }> = {
		field_ops: { label: 'Operasional Lapangan', icon: '🏗️', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
		emergency_qhse: { label: 'Darurat & K3', icon: '🚨', cls: 'bg-rose-100 text-rose-800 border-rose-300' },
		administrative: { label: 'Administratif', icon: '📋', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
		management_gate: { label: 'Manajerial & Gate', icon: '⚖️', cls: 'bg-purple-100 text-purple-800 border-purple-300' }
	};

	let countMaster = $derived(index.filter((f) => f.kategori_sop === 'master').length);
	let countInduk = $derived(index.filter((f) => f.kategori_sop === 'induk').length);
	let countTurunan = $derived(index.filter((f) => f.kategori_sop === 'turunan').length);

	let countFieldOps = $derived(index.filter((f) => f.procedure_type === 'field_ops').length);
	let countEmergency = $derived(index.filter((f) => f.procedure_type === 'emergency_qhse').length);
	let countAdmin = $derived(index.filter((f) => f.procedure_type === 'administrative').length);
	let countManagement = $derived(index.filter((f) => f.procedure_type === 'management_gate').length);

	/** Catatan lokal perangkat (kunci `sop_read_<flow_key>`) — dipakai saat offline / server belum membalas. */
	function localReadKeys(): string[] {
		if (typeof localStorage === 'undefined') return [];
		const out: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k?.startsWith('sop_read_') && k !== 'sop_read_pending_sync') out.push(k.slice('sop_read_'.length));
		}
		return out;
	}

	async function muatKonfirmasiSaya() {
		readKeys = new Set(localReadKeys());
		try {
			const r = await fetch('/api/process-guidance/read-confirm?mine=1');
			if (r.ok) {
				const j = await r.json();
				if (Array.isArray(j?.confirmed_keys)) readKeys = new Set([...readKeys, ...j.confirmed_keys]);
			}
		} catch {
			/* offline: cukup catatan lokal */
		}
		readLoaded = true;
	}

	async function periksaKonfirmasiBaca(id: string) {
		if (typeof localStorage !== 'undefined') {
			readTime = localStorage.getItem('sop_read_' + id) || '';
		}
		if (!readTime) {
			fetch(`/api/process-guidance/read-confirm?flow_key=${encodeURIComponent(id)}`)
				.then((r) => r.json())
				.then((res) => {
					if (res.confirmed && res.confirmed_at) {
						const dateStr = new Date(res.confirmed_at).toLocaleDateString('id-ID', {
							day: 'numeric',
							month: 'short',
							year: 'numeric',
							hour: '2-digit',
							minute: '2-digit'
						});
						readTime = dateStr;
						if (typeof localStorage !== 'undefined') {
							localStorage.setItem('sop_read_' + id, dateStr);
						}
					}
				})
				.catch(() => {});
		}
	}

	async function konfirmasiBaca() {
		if (flowId) {
			const nowStr = new Date().toLocaleDateString('id-ID', {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem('sop_read_' + flowId, nowStr);
			}
			readTime = nowStr;
			readKeys = new Set([...readKeys, flowId]);

			// Sinkron ke server (audit trail). Gagal (offline/5xx) → masuk antrean di perangkat & dikirim otomatis saat online; tanda baca tetap berlaku.
			const item: PendingRead = { flow_key: flowId, version_seq: flow?.version ?? 1, read_at: new Date().toISOString() };
			const r = await kirimBaca(item, false);
			if (!r.ok && typeof localStorage !== 'undefined') {
				enqueueRead(localStorage, item);
				pendingSync = readQueue(localStorage).length;
			}
		}
	}

	let myFlowIds = $derived(new Set((mine?.tasks ?? []).map((t) => t.flow_id)));
	let myNodeIds = $derived((mine?.tasks ?? []).filter((t) => t.flow_id === flowId).map((t) => t.node_id));
	let tasksByFlow = $derived.by(() => {
		const m = new Map<string, MyTask[]>();
		for (const t of mine?.tasks ?? []) m.set(t.flow_id, [...(m.get(t.flow_id) ?? []), t]);
		return [...m.entries()];
	});
	let unreadCount = $derived(index.filter((f) => !readKeys.has(f.id)).length);
	/** Breadcrumb Master › Induk › IK dari id induk di daftar ringkas; kosong bila alur tak punya induk yang terbit untuk lapangan. */
	let crumbs = $derived.by(() => {
		const byRow = new Map<number, FlowSummary>();
		for (const f of index) if (f.row_id) byRow.set(f.row_id, f);
		const out: FlowSummary[] = [];
		let node: FlowSummary | undefined = index.find((f) => f.id === flowId);
		for (let guard = 0; node && guard < 4; guard++) {
			out.unshift(node);
			node = node.parent_row_id ? byRow.get(node.parent_row_id) : undefined;
		}
		return out.length > 1 ? out : [];
	});
	// Daftar pilihan: dicari + (opsional) hanya alur saya + filter kategori; alur yang sedang dibuka selalu tersedia agar <select> tidak kosong.
	let options = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		const list = index.filter((f) => {
			const matchMine = !onlyMine || myFlowIds.has(f.id);
			const matchUnread = !onlyUnread || !readKeys.has(f.id);
			const matchKategori = !filterKategori || f.kategori_sop === filterKategori;
			const matchProcedure = !filterProcedureType || f.procedure_type === filterProcedureType;
			const matchNeedle =
				!needle ||
				f.title.toLowerCase().includes(needle) ||
				(f.sop_code && f.sop_code.toLowerCase().includes(needle)) ||
				(f.sub_kategori && f.sub_kategori.toLowerCase().includes(needle));
			return matchMine && matchUnread && matchKategori && matchProcedure && matchNeedle;
		});
		const cur = index.find((f) => f.id === flowId);
		return cur && !list.some((f) => f.id === cur.id) ? [cur, ...list] : list;
	});

	/** Kartu Rantai Serah-Terima: dimuat TERPISAH & tidak menahan tampilan alur; gagal → kartu tidak tampil. */
	function muatRantai(id: string) {
		chain = null;
		loadFlowChain(id).then((r) => {
			if (flowId === id) chain = r.chain;
		});
	}

	/** Lompat 1-ketuk dari kartu serah-terima ke alur seberang (dan langkahnya bila diketahui). */
	async function lompatKe(id: string, nodeId = '') {
		await bukaAlur(id, nodeId);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	async function bukaAlur(id: string, fokusKe = '') {
		flowId = id;
		fokus = fokusKe;
		periksaKonfirmasiBaca(id);
		muatRantai(id);
		loadingFlow = true;
		flowError = '';
		const r = await loadFlowById(id);
		loadingFlow = false;
		if (!r.flow) {
			flowError = 'Alur ini tidak ditemukan atau belum diterbitkan.';
			flow = null;
		} else {
			flow = r.flow;
			if (r.source === 'cached') sumber = 'cached';
		}
		swap += 1;
	}

	function handleStageSelect(st: ProjectStage) {
		const matches = getMatchingFlowsForStage(st, index);
		if (matches.length > 0 && !matches.some((m) => m.id === flowId)) {
			void bukaAlur(matches[0].id);
		}
	}

	function handleFilterSop(keyword: string, procedureType?: string) {
		q = keyword;
		if (procedureType) filterProcedureType = procedureType;
		const matches = index.filter(
			(f) =>
				f.title.toLowerCase().includes(keyword.toLowerCase()) ||
				(f.sop_code && f.sop_code.toLowerCase().includes(keyword.toLowerCase())) ||
				(procedureType && f.procedure_type === procedureType)
		);
		if (matches.length > 0 && !matches.some((m) => m.id === flowId)) {
			void bukaAlur(matches[0].id);
		}
	}

	onMount(() => {
		pendingSync = typeof localStorage !== 'undefined' ? readQueue(localStorage).length : 0;
		sinkronBaca();
		window.addEventListener('online', sinkronBaca);
		void muatAwal();
		void muatKonfirmasiSaya();
		return () => window.removeEventListener('online', sinkronBaca);
	});

	async function muatAwal() {
		// Daftar & tugas saya dimuat paralel; tugas saya tidak menahan tampilan alur.
		const minePromise = loadMyTasks().then((m) => (mine = m));
		const idx = await loadFlowIndex();
		sumber = idx.source;
		index = idx.flows;
		if (!index.some((f) => f.id === flowId)) flowId = index[0]?.id ?? flowId;
		await bukaAlur(flowId, fokus);
		await minePromise;
		// Status training untuk tugas saya: SATU panggilan untuk gabungan program (maks. 20); gagal → chip tidak tampil, tidak ada galat.
		const trainingIds = [...new Set((mine?.tasks ?? []).flatMap((t) => (t.training ?? []).map((x) => x.program_id)))];
		if (trainingIds.length > 0) {
			const r = await loadTrainingStatus(trainingIds);
			if (r.ok) trainingMap = new Map(r.items.map((i) => [i.id, i]));
		}
	}
</script>

<svelte:head>
	<title>Alur Kerja — Project EPI</title>
</svelte:head>

<div class="flex flex-col min-h-screen bg-gray-50 pb-6">
	<div class="bg-white border-b border-gray-200 px-4 py-4">
		<a href="/bantuan" class="text-xs text-gray-500">← Bantuan</a>
		<h1 class="text-lg font-bold text-gray-900 mt-1">🗺️ Alur Kerja</h1>
		<p class="text-xs text-gray-500 mt-0.5">{flow?.description ?? ''}</p>

		{#if flow && flow.id === flowId && flow.nodes?.length}
			<div class="mt-2">
				<button
					type="button"
					onclick={bukaBukuSaku}
					class="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white active:scale-95 transition"
					title="PDF berisi langkah kerja, kotak checklist, hambatan, dan gate alur ini — untuk dibawa/ditunjukkan di lapangan"
					data-testid="btn-buku-saku"
				>
					🖨️ Buku Saku &amp; Checklist (PDF)
				</button>
				<span class="ml-2 text-[10px] text-gray-400">Butuh internet · dibuat dari versi terbit</span>
				{#if bukuSakuOffline}
					<p class="mt-1 text-[11px] text-amber-700" role="alert">Anda sedang offline. PDF dibuat di server — sambungkan internet lalu coba lagi. Isi alur tetap bisa dibaca di layar ini.</p>
				{/if}
			</div>
		{/if}

		{#if index.length > 1}
			<div class="mt-2 space-y-2">
				{#if index.length > 8}
					<input
						type="search"
						bind:value={q}
						placeholder="Cari alur (mis. gudang, payroll, retur, kode SOP)…"
						class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
						aria-label="Cari alur"
					/>
				{/if}

				<!-- Pill Filter Sifat Prosedur (Operasional Lapangan vs Kantor / Manajemen) -->
				<div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
					<button
						type="button"
						class="px-2.5 py-1 rounded-full font-bold whitespace-nowrap transition-colors {filterProcedureType === '' ? 'bg-gray-800 text-white shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}"
						onclick={() => (filterProcedureType = '')}
					>
						Semua Sifat ({index.length})
					</button>
					{#if countFieldOps > 0}
						<button
							type="button"
							class="px-2.5 py-1 rounded-full font-bold whitespace-nowrap transition-colors {filterProcedureType === 'field_ops' ? 'bg-emerald-700 text-white shadow-xs' : 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100'}"
							onclick={() => (filterProcedureType = 'field_ops')}
						>
							🏗️ Prosedur Lapangan ({countFieldOps})
						</button>
					{/if}
					{#if countEmergency > 0}
						<button
							type="button"
							class="px-2.5 py-1 rounded-full font-bold whitespace-nowrap transition-colors {filterProcedureType === 'emergency_qhse' ? 'bg-rose-700 text-white shadow-xs' : 'bg-rose-50 text-rose-800 border border-rose-300 hover:bg-rose-100'}"
							onclick={() => (filterProcedureType = 'emergency_qhse')}
						>
							🚨 K3 & Darurat ({countEmergency})
						</button>
					{/if}
					{#if countAdmin > 0}
						<button
							type="button"
							class="px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors {filterProcedureType === 'administrative' ? 'bg-sky-700 text-white shadow-xs' : 'bg-sky-50 text-sky-800 border border-sky-300 hover:bg-sky-100'}"
							onclick={() => (filterProcedureType = 'administrative')}
						>
							📋 Administratif ({countAdmin})
						</button>
					{/if}
					{#if countManagement > 0}
						<button
							type="button"
							class="px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors {filterProcedureType === 'management_gate' ? 'bg-purple-700 text-white shadow-xs' : 'bg-purple-50 text-purple-800 border border-purple-300 hover:bg-purple-100'}"
							onclick={() => (filterProcedureType = 'management_gate')}
						>
							⚖️ Manajerial & Gate ({countManagement})
						</button>
					{/if}
				</div>

				<!-- Pill Filter Tingkat SOP Lapangan (Prioritas IK Lapangan) -->
				<div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
					{#if countTurunan > 0}
						<button
							type="button"
							class="px-2.5 py-1 rounded-full font-bold whitespace-nowrap transition-colors {filterKategori === 'turunan' ? 'bg-teal-700 text-white shadow-xs' : 'bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100'}"
							onclick={() => (filterKategori = 'turunan')}
						>
							📄 IK Turunan Lapangan ({countTurunan})
						</button>
					{/if}
					{#if countInduk > 0}
						<button
							type="button"
							class="px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors {filterKategori === 'induk' ? 'bg-indigo-700 text-white shadow-xs' : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'}"
							onclick={() => (filterKategori = 'induk')}
						>
							📘 SOP Induk ({countInduk})
						</button>
					{/if}
					{#if countMaster > 0}
						<button
							type="button"
							class="px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors {filterKategori === 'master' ? 'bg-purple-700 text-white shadow-xs' : 'bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100'}"
							onclick={() => (filterKategori = 'master')}
						>
							🌟 Master ({countMaster})
						</button>
					{/if}
					<button
						type="button"
						class="px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors {filterKategori === '' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
						onclick={() => (filterKategori = '')}
					>
						Semua Level ({index.length})
					</button>
				</div>

				{#if mine?.tasks?.length}
					<label class="flex items-center gap-2 text-xs text-gray-600">
						<input type="checkbox" bind:checked={onlyMine} /> Hanya alur yang memuat tugas saya ({myFlowIds.size})
					</label>
				{/if}
				{#if readLoaded && unreadCount > 0}
					<label class="flex items-center gap-2 text-xs text-gray-600" title="Tampilkan hanya alur yang belum Anda tandai paham. Buka alurnya lalu ketuk Tandai Paham.">
						<input type="checkbox" bind:checked={onlyUnread} /> Hanya yang belum saya baca ({unreadCount})
					</label>
				{/if}
				<select
					value={flowId}
					onchange={(e) => bukaAlur(e.currentTarget.value)}
					class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
					aria-label="Pilih alur"
				>
					{#each options as f (f.id)}
						<option value={f.id}>
							{f.procedure_type === 'field_ops' ? '🏗️ ' : f.procedure_type === 'emergency_qhse' ? '🚨 ' : f.procedure_type === 'management_gate' ? '⚖️ ' : '📋 '}
							{f.kategori_sop === 'turunan' ? '📄 ' : f.kategori_sop === 'master' ? '🌟 ' : '📘 '}
							{readKeys.has(f.id) ? '✓ ' : ''}{myFlowIds.has(f.id) ? '⭐ ' : ''}{f.sop_code ? `[${f.sop_code}] ` : ''}{f.title}
						</option>
					{/each}
				</select>
				{#if options.length === 0}<p class="text-xs text-gray-400">Tidak ada alur yang cocok dengan pencarian.</p>{/if}
			</div>
		{/if}
		{#if sumber === 'cached'}
			<p class="mt-2 text-[11px] text-amber-600">📡 Tidak bisa terhubung — menampilkan salinan terakhir yang tersimpan di perangkat ini.</p>
		{/if}
	</div>

	<div class="p-4 space-y-3">
		<!-- Cari kendala / pesan gate → loncat ke langkah SOP -->
		<KendalaSearch onjump={lompatKe} />

		<!-- Stepper 5 Tahap Proyek Lapangan (Mobile-First) -->
		<FieldProjectStepper
			onselectstage={handleStageSelect}
			onfiltersop={handleFilterSop}
		/>

		<!-- Tugas Saya -->
		{#if mine?.tasks?.length && mine.posisi}
			<section class="bg-amber-50/70 border border-amber-200 rounded-2xl p-3.5" data-testid="tugas-saya">
				<button type="button" class="w-full flex items-start justify-between gap-2 text-left" aria-expanded={openMine} onclick={() => (openMine = !openMine)}>
					<span>
						<span class="block text-sm font-bold text-amber-900">⭐ Tugas Saya di Alur</span>
						<span class="block text-[11px] text-amber-800 mt-0.5">
							{mine.posisi.nama} · {mine.tasks.length} langkah di {tasksByFlow.length} alur
						</span>
					</span>
					<span class="text-amber-700 text-xs mt-1 transition-transform {openMine ? 'rotate-180' : ''}">▾</span>
				</button>
				{#if openMine}
					<div class="mt-3 space-y-3">
						{#each tasksByFlow as [fid, tasks] (fid)}
							<div>
								<p class="text-[11px] font-bold text-amber-900">{tasks[0].flow_title}</p>
								<ul class="mt-1 space-y-1">
									{#each tasks as t (t.node_id)}
										<li>
											<button
												type="button"
												class="w-full text-left px-2.5 py-2 rounded-lg bg-white border border-amber-200 text-xs active:scale-[0.99]"
												onclick={() => bukaAlur(t.flow_id, t.node_id)}
											>
												<span class="font-semibold text-gray-800">{t.label}</span>
												<span class="block text-[10px] text-gray-500">
													{t.lane_label}{t.sla_hours ? ` · target ${t.sla_hours} jam` : ''}{t.has_actions ? ' · ada formulir' : ''}
												</span>
												{#if t.gate_keys?.length}
													<span class="block text-[10px] mt-0.5 text-amber-700" data-testid="task-gates" title="Gate = pemeriksaan sistem sebelum dokumen bisa lanjut. Ketuk langkah untuk melihat syarat lolosnya.">
														🛡 {t.gate_keys.length} gate menjaga langkah ini · ketuk untuk lihat syarat lolos
													</span>
												{/if}
												{#if trainingChip(t)}
													{@const c = trainingChip(t)!}
													<span class="block text-[10px] mt-0.5 {c.belum > 0 ? 'text-amber-700' : 'text-emerald-700'}" data-testid="task-training">
														🎓 {c.total} training{c.belum > 0 ? ` · ${c.belum} belum selesai` : ' · semua lulus'}
													</span>
												{/if}
											</button>
											{#if t.handoff_to?.length && mine.contacts}
												<div class="mt-1 ml-1 space-y-0.5" data-testid="task-handoff">
													{#each t.handoff_to as pid (pid)}
														{@const r = mine.contacts[pid]}
														{#if r}
															<p class="text-[10px] text-gray-600">
																<span class="font-semibold">➡ Serah-terima ke {r.nama}:</span>
																{#if r.people.length === 0}
																	<span class="text-gray-400">belum ada karyawan aktif di jabatan ini</span>
																{:else}
																	{#each r.people as p (p.id)}
																		{#if p.wa}
																			<a
																				class="inline-block mr-1.5 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium"
																				href={waLink(p.wa, `Halo ${p.nama}, terkait "${t.label}" di ${t.flow_title}: `)}
																				target="_blank"
																				rel="noopener noreferrer"
																				title="Buka WhatsApp ke {p.nama}"
																			>💬 {p.nama}</a>
																		{:else}
																			<span class="inline-block mr-1.5 text-gray-500" title="Nomor HP belum diisi di data karyawan">{p.nama} <span class="text-gray-400">(no. HP kosong)</span></span>
																		{/if}
																	{/each}
																	{#if r.total > r.people.length}<span class="text-gray-400">+{r.total - r.people.length} lainnya</span>{/if}
																{/if}
															</p>
														{/if}
													{/each}
												</div>
											{/if}
										</li>
									{/each}
								</ul>
							</div>
						{/each}
						<p class="text-[10px] text-amber-700">Ketuk satu langkah untuk membuka alurnya. Daftar ini mengikuti jabatan di data karyawan Anda.</p>
						<p class="text-[10px] text-amber-700">💬 Ketuk nama hijau di bawah langkah untuk menghubungi penerima serah-terima lewat WhatsApp (nomor dari data karyawan; hanya untuk keperluan kerja).</p>
					</div>
				{/if}
			</section>
		{:else if mine && !mine.posisi && mine.source === 'directus' && mine.reason}
			<p class="text-[11px] text-gray-400" data-testid="tugas-saya-kosong">ℹ️ {mine.reason}</p>
		{:else if mine?.posisi && mine.source === 'directus' && mine.tasks.length === 0}
			<p class="text-[11px] text-gray-400" data-testid="tugas-saya-kosong">
				ℹ️ Belum ada langkah alur yang ditautkan ke jabatan {mine.posisi.nama}. Tautan diatur admin di dashboard (Peta Alur → tab Peta PIC).
			</p>
		{/if}

		{#if flow}
			<div class="bg-white border border-gray-200 rounded-2xl p-3.5 space-y-2.5 shadow-xs">
				{#if crumbs.length > 1}
					<nav aria-label="Posisi alur" class="flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
						{#each crumbs as c, i (c.id)}
							{#if i > 0}<span aria-hidden="true">›</span>{/if}
							{#if i < crumbs.length - 1}
								<button type="button" class="text-indigo-700 hover:underline text-left" title="Ketuk untuk membuka SOP di tingkat atas ini" onclick={() => bukaAlur(c.id)}>
									{c.title.length > 40 ? c.title.slice(0, 39) + '…' : c.title}
								</button>
							{:else}
								<span class="font-semibold text-gray-700">{c.title.length > 40 ? c.title.slice(0, 39) + '…' : c.title}</span>
							{/if}
						{/each}
					</nav>
				{/if}
				<div class="flex flex-wrap items-center gap-1.5">
					{#if flow.procedure_type && PROCEDURE_TYPE_MAP[flow.procedure_type]}
						{@const pt = PROCEDURE_TYPE_MAP[flow.procedure_type]}
						<span class="px-2 py-0.5 rounded text-[11px] font-bold border {pt.cls}">
							{pt.icon} {pt.label}
						</span>
					{/if}
					{#if flow.sop_code}
						<span class="px-2 py-0.5 rounded font-mono font-bold text-xs bg-amber-50 text-amber-800 border border-amber-200">
							{flow.sop_code}
						</span>
					{/if}
					{#if flow.kategori_sop && KATEGORI_BADGE[flow.kategori_sop]}
						<span class="px-2 py-0.5 rounded text-[11px] font-semibold border {KATEGORI_BADGE[flow.kategori_sop].cls}">
							{KATEGORI_BADGE[flow.kategori_sop].label}
						</span>
					{/if}
					{#if flow.sub_kategori}
						<span class="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-700">
							📂 {flow.sub_kategori}
						</span>
					{/if}
				</div>

				{#if flow.approval_status === 'sosialisasi'}
					<div class="rounded-xl border border-purple-200 bg-purple-50/80 p-3 text-xs text-purple-900 space-y-1">
						<div class="flex items-center gap-1.5 font-bold">
							<span>📢</span>
							<span>Masa Sosialisasi SOP Lapangan</span>
							{#if flow.sosialisasi_end_date}
								<span class="ml-auto text-[11px] font-normal text-purple-700">s/d {flow.sosialisasi_end_date}</span>
							{/if}
						</div>
						<p class="text-[11px] text-purple-800 leading-relaxed">
							Alur ini sedang dalam masa pengenalan sebelum diberlakukan penuh (Gate Hard). Pelajari langkah kerja dan target waktu (SLA) di bawah.
						</p>
					</div>
				{/if}

				{#if flow.external_flowchart_url || flow.external_doc_url}
					<div class="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100 text-xs">
						{#if flow.external_flowchart_url}
							<a href={flow.external_flowchart_url} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-blue-600 font-medium hover:underline">
								<span>🎨 Diagram Alur Lengkap</span>
							</a>
						{/if}
						{#if flow.external_doc_url}
							<a href={flow.external_doc_url} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-emerald-600 font-medium hover:underline">
								<span>📝 Naskah SOP Lengkap</span>
							</a>
						{/if}
					</div>
				{/if}

				<!-- Konfirmasi Pemahaman SOP -->
				<div class="flex items-center justify-between gap-2 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs">
					<div class="space-y-0.5 min-w-0">
						<p class="font-bold text-gray-800">Konfirmasi Pemahaman SOP</p>
						<p class="text-[11px] text-gray-500 truncate">
							{hasRead ? `✓ Anda telah memahami alur ini (${readTime})` : 'Tandai jika Anda telah memahami alur ini'}
						</p>
					</div>
					<button
						type="button"
						onclick={konfirmasiBaca}
						class="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all {hasRead ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'}"
					>
						{hasRead ? '✓ Terkonfirmasi' : 'Tandai Paham'}
					</button>
				</div>
				{#if pendingSync > 0}
					<p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5" role="status" data-testid="read-pending">
						📶 {pendingSync} konfirmasi baca tersimpan di perangkat — akan terkirim otomatis saat sinyal kembali.
					</p>
				{/if}
			</div>
		{/if}

		<!-- Siklus dokumen & syarat lolos gate (detail gate baru diunduh saat kartu dibuka) -->
		<FieldStateAndGateCard {flow} {flowId} {fokus} />

		{#if loadingFlow}
			<p class="text-xs text-gray-400 text-center py-6" role="status">Memuat alur…</p>
		{:else if flowError}
			<p class="text-sm text-gray-500 text-center py-8" role="alert">{flowError}</p>
		{:else}
			{#key `${flowId}:${swap}`}
				<ProcessGuidanceMobile {flow} {fokus} mine={myNodeIds} {chain} onjump={lompatKe} />
			{/key}
		{/if}
	</div>
</div>

{#if flow}
	<PdfFetchSheet
		open={bukuSakuOpen}
		url={`/api/panduan/buku-saku-pdf?alur=${encodeURIComponent(flowId)}`}
		title={`Buku Saku — ${flow.title}`}
		filename={`Buku Saku - ${flow.title}`}
		onClose={() => (bukuSakuOpen = false)}
	/>
{/if}
