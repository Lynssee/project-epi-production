<!-- src/routes/(app)/produk/+page.svelte -->
<!-- Fase 4 — Modul Foxapaint Terpusat v2: referensi produk lapangan. -->
<!-- Sumber data langsung Directus proxy (bukan lewat erp-epi-1) — lapangan tetap jalan
     walau server admin mati. Formula/komposisi tetap tidak ditampilkan (rahasia dagang). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import {
		searchFoxapaintProducts,
		fetchFoxapaintCard,
		resolveKodeFgFromItemId,
		calculatePaintNeed,
		type FoxapaintCard
	} from '$lib/services/foxapaintApi';
	import { searchFormulaRatios, type FormulaRatio } from '$lib/services/rndMixing';
	import { calculateComponentsWithConversion, type MixComponent } from '$lib/utils/mixingRatio';
	import {
		IconArrowLeft,
		IconSearch,
		IconQrcode,
		IconFileText,
		IconBook,
		IconChevronRight,
		IconAlertTriangle
	} from '@tabler/icons-svelte';

	type Tab = 'cari' | 'campur';
	let tab = $state<Tab>('cari');

	const SUMBER_DATA_LABELS: Record<string, string> = {
		lab_verified: 'Lab Terverifikasi',
		template_keluarga: 'Standar Keluarga Formula',
		estimasi_rnd: 'Estimasi R&D',
		tds_supplier: 'TDS Supplier',
		rekomendasi_standar: 'Standar Rekomendasi Foxapaint'
	};

	// --- Cari / Scan QR ---
	let query = $state('');
	let results = $state<FoxapaintCard[]>([]);
	let loading = $state(false);
	let selected = $state<FoxapaintCard | null>(null);
	let scanMsg = $state('');
	let searchTimer: ReturnType<typeof setTimeout>;

	let QrScannerModal = $state<any>(null);
	let showScanner = $state(false);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	async function onScanDetect(value: string) {
		showScanner = false;
		const parsed = parseEpiQr(value);
		if (!parsed || parsed.type !== 'ITEM') {
			scanMsg = 'QR tidak dikenali sebagai barang (format EPI:ITEM:<id>). Gunakan pencarian manual.';
			return;
		}
		loading = true;
		const card = await resolveKodeFgFromItemId(Number(parsed.id));
		loading = false;
		if (!card) {
			scanMsg = 'Produk tidak ditemukan (varian ini belum tertaut ke kode_fg).';
			return;
		}
		scanMsg = '';
		selected = card;
		results = [];
		query = card.namaKode;
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		selected = null;
		searchTimer = setTimeout(async () => {
			loading = true;
			results = query.trim().length >= 2 ? await searchFoxapaintProducts(query) : [];
			loading = false;
		}, 300);
	}

	async function pickResult(card: FoxapaintCard) {
		selected = card;
		results = [];
		query = card.namaKode;
	}

	// --- Kalkulator Kebutuhan Cat ---
	let areaSqm = $state('');
	let lossPct = $state('10');
	const paintNeed = $derived.by(() => {
		if (!selected?.spec?.coverage_sqm_per_liter || !areaSqm || parseFloat(areaSqm) <= 0) return null;
		return calculatePaintNeed(parseFloat(areaSqm), selected.spec.coverage_sqm_per_liter, parseFloat(lossPct) || 0);
	});

	// --- Kalkulator Campuran (reuse pola /rnd) ---
	let mixQuery = $state('');
	let mixResults = $state<FormulaRatio[]>([]);
	let mixLoading = $state(false);
	let mixPicked = $state<FormulaRatio | null>(null);
	let mixTargetQty = $state('');
	let mixTimer: ReturnType<typeof setTimeout>;

	function onMixSearch() {
		clearTimeout(mixTimer);
		mixTimer = setTimeout(async () => {
			mixLoading = true;
			mixResults = mixQuery.trim().length >= 2 ? await searchFormulaRatios(mixQuery) : [];
			mixLoading = false;
		}, 300);
	}
	function pickMixFormula(f: FormulaRatio) {
		mixPicked = f;
		mixQuery = f.kode_fg_nama;
		mixResults = [];
	}
	const mixComponents = $derived.by((): MixComponent[] => {
		if (!mixPicked || !mixTargetQty || parseFloat(mixTargetQty) <= 0) return [];
		return calculateComponentsWithConversion(parseFloat(mixTargetQty), mixPicked.mixing_ratio_value, mixPicked.mixing_ratio_type, mixPicked.sg);
	});
</script>

{#if showScanner && QrScannerModal}
	<QrScannerModal expectedPrefix="EPI:" onDetect={onScanDetect} onClose={() => (showScanner = false)} />
{/if}

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Katalog Produk</h1>
		</div>

		<div class="flex gap-1 mb-4 overflow-x-auto">
			{#each [{ id: 'cari', label: 'Cari / Scan' }, { id: 'campur', label: 'Kalkulator Campur' }] as t}
				<button
					class="px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap"
					style={tab === t.id ? 'background: var(--g); color: white' : 'background: var(--sys-fill); color: var(--sys-label-2)'}
					onclick={() => (tab = t.id as Tab)}
				>
					{t.label}
				</button>
			{/each}
		</div>

		{#if tab === 'cari'}
			<!-- Banner Akses Cepat SOP Aplikasi Cat Foxapaint -->
			<button
				class="w-full mb-3 rounded-xl p-3 flex items-center justify-between text-left transition-all active:scale-[0.99]"
				style="background: linear-gradient(135deg, rgba(37,99,235,0.08), rgba(59,130,246,0.15)); border: 1px solid rgba(59,130,246,0.3)"
				onclick={() => goto('/panduan')}
			>
				<div class="flex items-center gap-2.5">
					<div class="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style="background: #2563EB">
						<IconBook size={17} />
					</div>
					<div>
						<p class="text-[12px] font-bold" style="color: var(--sys-label)">SOP Aplikasi Cat Foxapaint</p>
						<p class="text-[10px]" style="color: var(--sys-label-2)">Standar persiapan Sa 2.5, titik embun (dew point), pot life, & solusi cacat</p>
					</div>
				</div>
				<IconChevronRight size={16} class="shrink-0" style="color: var(--sys-label-2)" />
			</button>

			<button
				class="w-full h-11 mb-3 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2"
				style="background: var(--g)"
				onclick={async () => { await loadQrScannerModal(); showScanner = true; }}
			>
				<IconQrcode size={17} /> Scan QR Drum/Kemasan
			</button>
			<div class="flex items-center gap-2 mb-3 rounded-lg px-3 py-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconSearch size={16} />
				<input bind:value={query} oninput={onSearchInput} placeholder="Cari nama produk…" class="flex-1 bg-transparent text-[13px] outline-none" style="color: var(--sys-label)" />
			</div>
			{#if scanMsg}
				<p class="text-[11px] mb-3 px-2" style="color: #DC2626">{scanMsg}</p>
			{/if}

			{#if loading}
				<CircularProgressGauge size={46} strokeWidth={3} label="Memuat master produk..." />
			{:else if results.length > 0}
				<div class="space-y-2 mb-4">
					{#each results as r (r.kodeFgId)}
						<button class="w-full text-left rounded-xl p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" onclick={() => pickResult(r)}>
							<p class="text-[13px] font-bold" style="color: var(--sys-label)">{r.namaKode}</p>
							<p class="text-[11px]" style="color: var(--sys-label-2)">{r.kategoriQc || 'Tanpa kategori'}</p>
						</button>
					{/each}
				</div>
			{/if}

			{#if selected}
				<div class="rounded-xl p-3 mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<p class="text-[15px] font-bold" style="color: var(--sys-label)">{selected.namaKode}</p>
					<p class="text-[11px] mb-2" style="color: var(--sys-label-2)">{selected.kategoriQc || 'Tanpa kategori'} {selected.kodeSingkat ? `· ${selected.kodeSingkat}` : ''}</p>

					{#if selected.spec}
						<div class="mt-2 pt-2" style="border-top: 1px solid var(--sys-sep)">
							<div class="flex items-center justify-between mb-1.5">
								<span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background: var(--sys-fill2); color: var(--sys-label-2)">
									{SUMBER_DATA_LABELS[selected.spec.sumber_data || ''] || selected.spec.sumber_data || '-'}
								</span>
								{#if selected.spec.sumber_data === 'rekomendasi_standar'}
									<span class="text-[10px] px-1.5 py-0.5 rounded font-semibold text-amber-700 bg-amber-50 border border-amber-200">
										Acuan Rekomendasi
									</span>
								{/if}
							</div>
							{#if selected.spec.product_category}
								<p class="text-[11px] font-semibold mb-1" style="color: var(--g)">{selected.spec.product_category}</p>
							{/if}
							{#if selected.spec.recommended_use}
								<p class="text-[12px] mt-1 leading-relaxed" style="color: var(--sys-label)">{selected.spec.recommended_use}</p>
							{/if}
							{#if selected.spec.application_method?.length}
								<p class="text-[11px] mt-2" style="color: var(--sys-label-2)">Metode: <b style="color: var(--sys-label)">{selected.spec.application_method.join(', ')}</b></p>
							{/if}
							{#if selected.spec.thinner_type || selected.spec.thinning_ratio}
								<p class="text-[11px] mt-1" style="color: var(--sys-label-2)">
									Thinner: <b style="color: var(--sys-label)">{selected.spec.thinner_type || '-'}</b>
									{#if selected.spec.thinning_ratio} · Rasio <b style="color: var(--sys-label)">{selected.spec.thinning_ratio}</b>{/if}
								</p>
							{/if}
							{#if selected.spec.overcoating_min_hours != null}
								<p class="text-[11px] mt-1" style="color: var(--sys-label-2)">
									Jeda Overcoating: <b style="color: var(--sys-label)">{selected.spec.overcoating_min_hours}–{selected.spec.overcoating_max_hours ?? '∞'} jam</b>
								</p>
							{/if}
							{#if selected.spec.surface_preparation}
								<div class="mt-2 p-2 rounded-lg text-[11px] leading-relaxed" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
									<p class="font-bold mb-0.5" style="color: var(--sys-label)">Persiapan Permukaan:</p>
									<p style="color: var(--sys-label-2)">{selected.spec.surface_preparation}</p>
								</div>
							{/if}

							<!-- Aturan Kritis Lapangan -->
							<div class="mt-2.5 p-2 rounded-lg flex items-start gap-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200">
								<IconAlertTriangle size={15} class="shrink-0 mt-0.5 text-amber-600" />
								<div>
									<p class="font-bold">Kaidah Kritis Lapangan:</p>
									<p class="mt-0.5">Suhu permukaan substrat wajib ≥ Dew Point + 3°C (RH ≤ 85%). Habiskan adukan 2K dalam 1–1.5 jam (jangan tambah thinner jika sudah mengental).</p>
								</div>
							</div>
						</div>
					{:else}
						<p class="text-[11px] mt-2" style="color: var(--sys-label-2)">Belum ada panduan aplikasi tercatat untuk produk ini.</p>
					{/if}

					<div class="flex flex-wrap gap-2 mt-3 pt-2" style="border-top: 1px solid var(--sys-sep)">
						<button
							class="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-semibold text-white"
							style="background: #2563EB"
							onclick={() => goto('/panduan')}
						>
							<IconBook size={14} /> SOP Lapangan
						</button>
						{#if selected.tds?.tds_url}
							<a href={selected.tds.tds_url} target="_blank" rel="noopener" class="flex-1 min-w-[90px] flex items-center justify-center gap-1 rounded-lg py-2 text-[12px] font-semibold text-white" style="background: var(--g)">
								<IconFileText size={14} /> TDS
							</a>
						{/if}
						{#if selected.tds?.msds_url}
							<a href={selected.tds.msds_url} target="_blank" rel="noopener" class="flex-1 min-w-[90px] flex items-center justify-center gap-1 rounded-lg py-2 text-[12px] font-semibold text-white" style="background: #DC2626">
								<IconFileText size={14} /> MSDS
							</a>
						{/if}
					</div>
				</div>

				{#if selected.spec}
					<div class="rounded-xl p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<p class="text-[13px] font-bold mb-2" style="color: var(--sys-label)">Kalkulator Kebutuhan Cat</p>
						{#if !selected.spec.coverage_sqm_per_liter}
							<p class="text-[11px]" style="color: var(--sys-label-2)">Daya sebar belum diisi untuk produk ini — hubungi R&D.</p>
						{:else}
							<div class="flex gap-2 mb-2">
								<input type="number" bind:value={areaSqm} placeholder="Luas (m²)" class="flex-1 rounded-lg px-3 py-2 text-[13px] outline-none" style="background: var(--sys-fill2); color: var(--sys-label)" />
								<input type="number" bind:value={lossPct} placeholder="Loss %" class="w-20 rounded-lg px-3 py-2 text-[13px] outline-none" style="background: var(--sys-fill2); color: var(--sys-label)" />
							</div>
							<p class="text-[11px]" style="color: var(--sys-label-2)">Daya sebar: {selected.spec.coverage_sqm_per_liter} m²/liter</p>
							{#if paintNeed && !paintNeed.coverageMissing}
								<p class="text-[16px] font-bold mt-2" style="color: var(--sys-label)">≈ {paintNeed.liters} liter</p>
							{/if}
						{/if}
					</div>
				{/if}
			{/if}
		{:else if tab === 'campur'}
			<div class="flex items-center gap-2 mb-4 rounded-lg px-3 py-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconSearch size={16} />
				<input bind:value={mixQuery} oninput={onMixSearch} placeholder="Cari produk untuk hitung campuran…" class="flex-1 bg-transparent text-[13px] outline-none" style="color: var(--sys-label)" />
			</div>
			{#if mixLoading}
				<p class="text-[12px] text-center py-8" style="color: var(--sys-label-2)">Memuat...</p>
			{:else if mixResults.length > 0}
				<div class="space-y-2 mb-4">
					{#each mixResults as f (f.id)}
						<button class="w-full text-left rounded-xl p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" onclick={() => pickMixFormula(f)}>
							<p class="text-[13px] font-bold" style="color: var(--sys-label)">{f.kode_fg_nama}</p>
							<p class="text-[11px]" style="color: var(--sys-label-2)">{f.nama_template} · v{f.version} · Rasio {f.mixing_ratio_value}</p>
						</button>
					{/each}
				</div>
			{/if}
			{#if mixPicked}
				<div class="rounded-xl p-3 mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<p class="text-[13px] font-bold" style="color: var(--sys-label)">{mixPicked.kode_fg_nama}</p>
					<p class="text-[11px] mb-2" style="color: var(--sys-label-2)">Rasio {mixPicked.mixing_ratio_value} ({mixPicked.mixing_ratio_type})</p>
					<input type="number" bind:value={mixTargetQty} placeholder={mixPicked.mixing_ratio_type === 'by_volume' ? 'Target liter' : 'Target kg'} class="w-full rounded-lg px-3 py-2 text-[13px] outline-none" style="background: var(--sys-fill2); color: var(--sys-label)" />
					{#if mixComponents.length > 0}
						<div class="mt-3 space-y-1">
							{#each mixComponents as c}
								<div class="flex justify-between text-[12px]" style="color: var(--sys-label)">
									<span>{c.name} ({c.percentage.toFixed(1)}%)</span>
									<span class="font-semibold">{c.qty_kg.toFixed(2)} kg / {c.qty_liter.toFixed(2)} L</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
</div>
