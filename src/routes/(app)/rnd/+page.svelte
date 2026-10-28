<!-- src/routes/(app)/rnd/+page.svelte -->
<!-- Pertajam Modul R&D v2.0, Fase 7 — R&D di Dashboard Lapangan. Read-heavy, ringan. -->
<!-- Formula/komposisi TIDAK ditampilkan di sini sama sekali (rahasia dagang). -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import {
		searchTds,
		searchMsds,
		findDocByProductCode,
		resolveProductCodeById,
		fetchPanduanAplikasi,
		reportProductIssue,
		JENIS_MASALAH_APLIKASI,
		requestDocument,
		searchMaterialProfiles,
		searchMaterialsLite,
		checkFieldCompatibility,
		type TdsMsdsDoc,
		type PanduanAplikasi,
		type MaterialProfileView,
		type FieldCompatFinding
	} from '$lib/services/rndField';
	import { searchB3, type HseB3 } from '$lib/services/hse';
	import { searchFormulaRatios, type FormulaRatio } from '$lib/services/rndMixing';
	import { calculateComponentsWithConversion, isMultiComponent, type MixComponent } from '$lib/utils/mixingRatio';
	import MaterialGuidanceModal from '$lib/components/shared/MaterialGuidanceModal.svelte';
	import {
		logRetainedSample,
		fetchRetainedSamplesByBatch,
		logWeatheringObservation,
		fetchWeatheringLogsByPanel,
		type RetainedSampleLogRow,
		type WeatheringLogRow
	} from '$lib/services/rndFieldLogs';
	import { IconArrowLeft, IconSearch, IconQrcode, IconAlertTriangle, IconFileText, IconSend, IconFlask } from '@tabler/icons-svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';

	type Tab = 'tds' | 'msds' | 'b3' | 'katalog' | 'kompat' | 'mixing' | 'retensi' | 'weathering' | 'lapor' | 'minta';
	let tab = $state<Tab>('tds');

	// --- Modal Edukasi & Guidance Bahan ---
	let guidanceModalOpen = $state(false);
	let selectedGuidanceMaterial = $state<MaterialProfileView | null>(null);
	function openGuidance(m: MaterialProfileView) {
		selectedGuidanceMaterial = m;
		guidanceModalOpen = true;
	}

	// --- Katalog Bahan (read-only) ---
	let katQuery = $state('');
	let katResults = $state<MaterialProfileView[]>([]);
	let katLoading = $state(false);
	let katExpanded = $state<number | null>(null);
	async function doSearchKatalog() {
		katLoading = true;
		katResults = await searchMaterialProfiles(katQuery);
		katLoading = false;
	}
	function kvPairs(obj: Record<string, unknown> | null): [string, unknown][] {
		if (!obj || typeof obj !== 'object') return [];
		return Object.entries(obj).filter(([, v]) => v !== '' && v != null);
	}

	// --- Cek Cepat Kompatibilitas ---
	let cmpQA = $state('');
	let cmpQB = $state('');
	let cmpResA = $state<Array<{ id: number; nama: string; kode_item: string }>>([]);
	let cmpResB = $state<Array<{ id: number; nama: string; kode_item: string }>>([]);
	let cmpPickA = $state<{ id: number; nama: string } | null>(null);
	let cmpPickB = $state<{ id: number; nama: string } | null>(null);
	let cmpFinding = $state<FieldCompatFinding | null>(null);
	let cmpChecked = $state(false);
	let cmpLoading = $state(false);
	let cmpTimerA: ReturnType<typeof setTimeout>;
	let cmpTimerB: ReturnType<typeof setTimeout>;
	function onCmpSearchA() {
		clearTimeout(cmpTimerA);
		cmpTimerA = setTimeout(async () => {
			cmpResA = cmpQA.trim().length >= 2 ? await searchMaterialsLite(cmpQA) : [];
		}, 300);
	}
	function onCmpSearchB() {
		clearTimeout(cmpTimerB);
		cmpTimerB = setTimeout(async () => {
			cmpResB = cmpQB.trim().length >= 2 ? await searchMaterialsLite(cmpQB) : [];
		}, 300);
	}
	function pickCmpA(m: { id: number; nama: string }) {
		cmpPickA = m; cmpQA = m.nama; cmpResA = []; cmpChecked = false; cmpFinding = null;
	}
	function pickCmpB(m: { id: number; nama: string }) {
		cmpPickB = m; cmpQB = m.nama; cmpResB = []; cmpChecked = false; cmpFinding = null;
	}
	async function runCmp() {
		if (!cmpPickA || !cmpPickB) return;
		cmpLoading = true;
		const r = await checkFieldCompatibility(cmpPickA.id, cmpPickB.id);
		cmpFinding = r.finding;
		cmpChecked = true;
		cmpLoading = false;
	}

	// --- Cari TDS ---
	let tdsQuery = $state('');
	let tdsResults = $state<TdsMsdsDoc[]>([]);
	let tdsLoading = $state(false);
	let panduan = $state<PanduanAplikasi[]>([]);
	let panduanFor = $state<string | null>(null);

	async function doSearchTds() {
		tdsLoading = true;
		tdsResults = await searchTds(tdsQuery);
		tdsLoading = false;
	}

	async function showPanduan(doc: TdsMsdsDoc) {
		if (panduanFor === doc.product_code) {
			panduanFor = null;
			return;
		}
		panduanFor = doc.product_code;
		panduan = await fetchPanduanAplikasi(doc.product_code);
	}

	// --- Cari MSDS ---
	let msdsQuery = $state('');
	let msdsResults = $state<TdsMsdsDoc[]>([]);
	let msdsLoading = $state(false);

	async function doSearchMsds() {
		msdsLoading = true;
		msdsResults = await searchMsds(msdsQuery);
		msdsLoading = false;
	}

	// --- Akses Darurat B3 ---
	let b3Query = $state('');
	let b3Results = $state<HseB3[]>([]);
	let b3Loading = $state(false);

	async function doSearchB3() {
		b3Loading = true;
		b3Results = await searchB3(b3Query);
		b3Loading = false;
	}

	// --- Scan QR ---
	let QrScannerModal = $state<any>(null);
	let showScanner = $state(false);
	let scanMsg = $state('');
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
		const kodeItem = await resolveProductCodeById(parsed.id);
		if (!kodeItem) {
			scanMsg = 'Barang tidak ditemukan di Master Barang.';
			return;
		}
		const doc = await findDocByProductCode(kodeItem);
		if (!doc) {
			scanMsg = `Belum ada TDS/MSDS untuk kode ${kodeItem}.`;
			return;
		}
		scanMsg = '';
		tab = 'tds';
		tdsResults = [doc];
		tdsQuery = doc.product_name;
	}

	// --- Lapor Masalah Produk ---
	let laporBatch = $state('');
	let laporDeskripsi = $state('');
	let laporSite = $state('');
	let laporFoto = $state<File | null>(null);
	let laporSubmitting = $state(false);
	let laporSuccess = $state(false);
	// Fase 6.4 (rencana lifecycle produksi v2, 15 Sep 2026): kategori masalah aplikasi + daya
	// sebar aktual terstruktur, supaya bisa jadi input keputusan eskalasi ke proyek R&D.
	let laporJenisMasalah = $state('');
	let laporDayaSebarAktual = $state('');

	async function submitLapor() {
		if (!laporDeskripsi.trim()) return;
		laporSubmitting = true;
		try {
			const nama = $authStore.user?.displayName || $authStore.user?.email || '(lapangan)';
			const compressedFoto = laporFoto ? await compressPhoto(laporFoto) : null;
			await reportProductIssue({
				batchNumber: laporBatch,
				deskripsi: laporDeskripsi,
				site: laporSite,
				fotoFile: compressedFoto,
				reportedBy: nama,
				jenisMasalah: laporJenisMasalah || null,
				dayaSebarAktual: laporDayaSebarAktual ? Number(laporDayaSebarAktual) : null
			});
			laporSuccess = true;
			laporBatch = '';
			laporDeskripsi = '';
			laporFoto = null;
			laporJenisMasalah = '';
			laporDayaSebarAktual = '';
		} catch (e) {
			console.error(e);
		} finally {
			laporSubmitting = false;
		}
	}

	// --- Minta Dokumen ---
	let mintaTipe = $state<'tds' | 'msds'>('tds');
	let mintaKodeProduk = $state('');
	let mintaCatatan = $state('');
	let mintaSubmitting = $state(false);
	let mintaSuccess = $state(false);

	async function submitMinta() {
		if (!mintaKodeProduk.trim()) return;
		mintaSubmitting = true;
		try {
			const nama = $authStore.user?.displayName || $authStore.user?.email || '(lapangan)';
			await requestDocument({ tipe: mintaTipe, kodeProduk: mintaKodeProduk, catatan: mintaCatatan, site: laporSite, requestedBy: nama });
			mintaSuccess = true;
			mintaKodeProduk = '';
			mintaCatatan = '';
		} catch (e) {
			console.error(e);
		} finally {
			mintaSubmitting = false;
		}
	}

	const TABS: { id: Tab; label: string }[] = [
		{ id: 'tds', label: 'TDS' },
		{ id: 'msds', label: 'MSDS' },
		{ id: 'katalog', label: 'Katalog Bahan' },
		{ id: 'kompat', label: 'Cek Campur' },
		{ id: 'mixing', label: 'Kalkulator Campuran' },
		{ id: 'b3', label: 'B3 Darurat' },
		{ id: 'retensi', label: 'Retensi Sample' },
		{ id: 'weathering', label: 'Weathering' },
		{ id: 'lapor', label: 'Lapor Masalah' },
		{ id: 'minta', label: 'Minta Dokumen' }
	];

	// --- Retensi Sample QR (Rekomendasi Tambahan lapangan #2) ---
	// Label batch FG (spk.batch_no) dicetak sebagai barcode/QR biasa, BUKAN format EPI: —
	// jadi hasil scan langsung dipakai sebagai teks nomor batch, tanpa parseEpiQr.
	let retensiScanner = $state<any>(null);
	let showRetensiScanner = $state(false);
	let retensiBatchNo = $state('');
	let retensiLokasi = $state('');
	let retensiExpiry = $state('');
	let retensiCatatan = $state('');
	let retensiSite = $state('');
	let retensiFoto = $state<File | null>(null);
	let retensiSubmitting = $state(false);
	let retensiSuccess = $state(false);
	let retensiRiwayat = $state<RetainedSampleLogRow[]>([]);
	let retensiTimer: ReturnType<typeof setTimeout>;

	async function loadRetensiScanner() {
		retensiScanner ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	function onRetensiScanDetect(value: string) {
		showRetensiScanner = false;
		retensiBatchNo = value.trim();
		onRetensiBatchInput();
	}
	function onRetensiBatchInput() {
		clearTimeout(retensiTimer);
		retensiTimer = setTimeout(async () => {
			retensiRiwayat = retensiBatchNo.trim() ? await fetchRetainedSamplesByBatch(retensiBatchNo) : [];
		}, 300);
	}
	async function submitRetensi() {
		if (!retensiBatchNo.trim() || !retensiLokasi.trim()) return;
		retensiSubmitting = true;
		try {
			const nama = $authStore.user?.displayName || $authStore.user?.email || '(lapangan)';
			const compressedFoto = retensiFoto ? await compressPhoto(retensiFoto) : null;
			await logRetainedSample({
				batchNo: retensiBatchNo,
				lokasiSimpan: retensiLokasi,
				expiryDate: retensiExpiry || null,
				catatan: retensiCatatan,
				site: retensiSite,
				dicatatOleh: nama,
				fotoFile: compressedFoto
			});
			retensiSuccess = true;
			retensiBatchNo = '';
			retensiLokasi = '';
			retensiExpiry = '';
			retensiCatatan = '';
			retensiFoto = null;
			retensiRiwayat = [];
		} catch (e) {
			console.error(e);
		} finally {
			retensiSubmitting = false;
		}
	}

	// --- Weathering / Outdoor Exposure Log (Rekomendasi Tambahan lapangan #3) ---
	let weaNamaPanel = $state('');
	let weaKondisi = $state('cerah');
	let weaPengamatan = $state('');
	let weaSite = $state('');
	let weaFoto = $state<File | null>(null);
	let weaSubmitting = $state(false);
	let weaSuccess = $state(false);
	let weaRiwayat = $state<WeatheringLogRow[]>([]);
	let weaTimer: ReturnType<typeof setTimeout>;

	function onWeaPanelInput() {
		clearTimeout(weaTimer);
		weaTimer = setTimeout(async () => {
			weaRiwayat = weaNamaPanel.trim() ? await fetchWeatheringLogsByPanel(weaNamaPanel) : [];
		}, 300);
	}
	async function submitWeathering() {
		if (!weaNamaPanel.trim() || !weaPengamatan.trim()) return;
		weaSubmitting = true;
		try {
			const nama = $authStore.user?.displayName || $authStore.user?.email || '(lapangan)';
			const compressedFoto = weaFoto ? await compressPhoto(weaFoto) : null;
			await logWeatheringObservation({
				namaPanel: weaNamaPanel,
				kondisiCuaca: weaKondisi,
				pengamatan: weaPengamatan,
				site: weaSite,
				dicatatOleh: nama,
				fotoFile: compressedFoto
			});
			weaSuccess = true;
			weaPengamatan = '';
			weaFoto = null;
			await onWeaPanelInput();
		} catch (e) {
			console.error(e);
		} finally {
			weaSubmitting = false;
		}
	}

	// --- Kalkulator Campuran (Rekomendasi Tambahan #2) ---
	// Hanya rasio komponen (Base:Hardener dst) — bukan komposisi bahan baku (rahasia dagang).
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
		return calculateComponentsWithConversion(
			parseFloat(mixTargetQty),
			mixPicked.mixing_ratio_value,
			mixPicked.mixing_ratio_type,
			mixPicked.sg
		);
	});
</script>

{#if showScanner && QrScannerModal}
	<QrScannerModal expectedPrefix="EPI:" onDetect={onScanDetect} onClose={() => (showScanner = false)} />
{/if}
{#if showRetensiScanner && retensiScanner}
	{@const RetensiScanner = retensiScanner}
	<RetensiScanner onDetect={onRetensiScanDetect} onClose={() => (showRetensiScanner = false)} />
{/if}

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">R&D — TDS/MSDS Lapangan</h1>
		</div>

		<button
			class="w-full h-11 mb-3 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2"
			style="background: var(--g)"
			onclick={async () => { await loadQrScannerModal(); showScanner = true; }}
		>
			<IconQrcode size={17} /> Scan QR Produk
		</button>
		<!-- Fase 2 R&D v2: halaman Permintaan Sample sudah ada & fungsional (Sales §7),
		     tapi tidak pernah ditemukan sales — tautan ini yang tadinya hilang. -->
		<button
			class="w-full h-11 mb-4 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2"
			style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
			onclick={() => goto('/sales/sample-request')}
		>
			<IconSend size={16} /> Permintaan Sample Customer
		</button>
		{#if scanMsg}
			<p class="text-[11px] mb-3 px-2" style="color: #DC2626">{scanMsg}</p>
		{/if}

		<div class="flex gap-1 mb-4 overflow-x-auto">
			{#each TABS as t}
				<button
					class="px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap"
					style={tab === t.id ? 'background: var(--g); color: white' : 'background: var(--sys-fill); color: var(--sys-label-2)'}
					onclick={() => (tab = t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>

		{#if tab === 'tds'}
			<div class="flex items-center gap-2 mb-4 rounded-lg px-3 py-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconSearch size={16} />
				<input bind:value={tdsQuery} oninput={doSearchTds} placeholder="Cari nama produk…" class="flex-1 bg-transparent text-[13px] outline-none" style="color: var(--sys-label)" />
			</div>
			{#if tdsLoading}
				<p class="text-[12px] text-center py-8" style="color: var(--sys-label-2)">Memuat...</p>
			{:else if tdsResults.length === 0}
				<p class="text-[12px] text-center py-8" style="color: var(--sys-label-2)">{tdsQuery ? 'Tidak ditemukan.' : 'Ketik nama produk untuk mencari TDS.'}</p>
			{:else}
				<div class="space-y-3">
					{#each tdsResults as doc (doc.id)}
						<div class="rounded-xl p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<p class="text-[13px] font-bold" style="color: var(--sys-label)">{doc.product_name}</p>
							<p class="text-[11px]" style="color: var(--sys-label-2)">Kode: {doc.product_code} · v{doc.tds_version || '-'}</p>
							<div class="flex gap-2 mt-2">
								<a href={doc.tds_url} target="_blank" rel="noopener" class="flex-1 text-center rounded-lg py-2 text-[12px] font-semibold text-white" style="background: var(--g)">Buka TDS</a>
								<button class="flex-1 rounded-lg py-2 text-[12px] font-semibold" style="background: var(--sys-fill2); color: var(--sys-label)" onclick={() => showPanduan(doc)}>
									{panduanFor === doc.product_code ? 'Tutup Panduan' : 'Panduan Aplikasi'}
								</button>
							</div>
							{#if panduanFor === doc.product_code}
								<div class="mt-2 rounded-lg p-2" style="background: var(--sys-fill2)">
									{#if panduan.length === 0}
										<p class="text-[11px]" style="color: var(--sys-label-2)">Belum ada data hasil uji tercatat untuk parameter aplikasi.</p>
									{:else}
										{#each panduan as p}
											<p class="text-[12px]" style="color: var(--sys-label)"><b>{p.parameter}:</b> {p.value} {p.satuan || ''}</p>
										{/each}
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{:else if tab === 'msds'}
			<div class="flex items-center gap-2 mb-4 rounded-lg px-3 py-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconSearch size={16} />
				<input bind:value={msdsQuery} oninput={doSearchMsds} placeholder="Cari nama produk/bahan…" class="flex-1 bg-transparent text-[13px] outline-none" style="color: var(--sys-label)" />
			</div>
			{#if msdsLoading}
				<p class="text-[12px] text-center py-8" style="color: var(--sys-label-2)">Memuat...</p>
			{:else if msdsResults.length === 0}
				<p class="text-[12px] text-center py-8" style="color: var(--sys-label-2)">{msdsQuery ? 'Tidak ditemukan.' : 'Ketik nama produk/bahan untuk mencari MSDS.'}</p>
			{:else}
				<div class="space-y-3">
					{#each msdsResults as doc (doc.id)}
						<div class="rounded-xl p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<p class="text-[13px] font-bold" style="color: var(--sys-label)">{doc.product_name}</p>
							<p class="text-[11px]" style="color: var(--sys-label-2)">Kode: {doc.product_code} · v{doc.msds_version || '-'}</p>
							<a href={doc.msds_url} target="_blank" rel="noopener" class="block text-center rounded-lg py-2 mt-2 text-[12px] font-semibold text-white" style="background: #DC2626">Buka MSDS</a>
						</div>
					{/each}
				</div>
			{/if}
		{:else if tab === 'katalog'}
			<div class="flex items-center gap-2 mb-3 rounded-lg px-3 py-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconSearch size={16} />
				<input bind:value={katQuery} oninput={doSearchKatalog} placeholder="Cari nama bahan baku…" class="flex-1 bg-transparent text-[13px] outline-none" style="color: var(--sys-label)" />
			</div>
			<p class="text-[11px] mb-3" style="color: var(--sys-label-2)">Profil teknis, cara simpan & larangan campur. Formula/komposisi tidak ditampilkan.</p>
			{#if katLoading}
				<p class="text-[12px] text-center py-8" style="color: var(--sys-label-2)">Memuat...</p>
			{:else if katResults.length === 0}
				<p class="text-[12px] text-center py-8" style="color: var(--sys-label-2)">{katQuery ? 'Tidak ditemukan.' : 'Ketik nama bahan baku untuk mencari profilnya.'}</p>
			{:else}
				<div class="space-y-3">
					{#each katResults as m (m.id)}
						<div class="rounded-xl p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<div class="flex items-start justify-between gap-2">
								<button class="flex-1 text-left" onclick={() => (katExpanded = katExpanded === m.id ? null : m.id)}>
									<p class="text-[13px] font-bold" style="color: var(--sys-label)">{m.nama}</p>
									<p class="text-[11px]" style="color: var(--sys-label-2)">
										{m.kode_item}{m.kelas ? ` · ${m.kelas}` : ''}{m.cas_number ? ` · CAS ${m.cas_number}` : ''}
									</p>
								</button>
								<button
									type="button"
									class="px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
									style="background: rgba(59, 130, 246, 0.15); color: #3B82F6; border: 1px solid rgba(59, 130, 246, 0.3)"
									onclick={() => openGuidance(m)}
									title="Pelajari fungsi, edukasi & panduan APD bahan ini"
								>
									<span>💡</span> Panduan
								</button>
							</div>
							{#if m.fungsi_utama}
								<p class="text-[11px] mt-1.5 font-medium" style="color: var(--sys-label)">
									<span class="text-blue-500 font-bold">Fungsi:</span> {m.fungsi_utama}
								</p>
							{/if}
							{#if m.panduan_apd && m.panduan_apd.length}
								<div class="mt-2 flex flex-wrap gap-1 items-center">
									<span class="text-[10px] font-semibold" style="color: var(--sys-label-2)">APD:</span>
									{#each m.panduan_apd as apd}
										<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium" style="background: var(--sys-fill2); color: var(--sys-label)">
											🛡️ {apd}
										</span>
									{/each}
								</div>
							{/if}

							<div class="mt-2 rounded-lg p-2 text-[12px]" style="background: var(--sys-fill2); color: var(--sys-label)">
								<p><b>Cara simpan:</b> {m.kondisi_simpan || 'lihat MSDS'}</p>
								{#if m.umur_simpan_hari}<p><b>Umur simpan:</b> ± {m.umur_simpan_hari} hari sejak diterima</p>{/if}
								{#if m.inkompatibilitas_tags.length}
									<p style="color: #DC2626"><b>Jangan campur dengan:</b> {m.inkompatibilitas_tags.join(', ')}</p>
								{/if}
							</div>

							{#if katExpanded === m.id}
								{#if m.deskripsi_tds}
									<p class="text-[12px] mt-2" style="color: var(--sys-label-2)">{m.deskripsi_tds}</p>
								{/if}
								{#each [['Sifat fisik', kvPairs(m.sifat_fisik)], ['Karakteristik film', kvPairs(m.karakteristik_film)]] as [judul, pairs]}
									{#if pairs.length}
										<div class="mt-2 rounded-lg p-2" style="background: var(--sys-fill2)">
											<p class="text-[11px] font-bold mb-1" style="color: var(--sys-label-2)">{judul}</p>
											{#each pairs as [k, v]}
												<p class="text-[12px]" style="color: var(--sys-label)"><b>{k}:</b> {v}</p>
											{/each}
										</div>
									{/if}
								{/each}
								{#if m.catatan_aplikasi}
									<p class="text-[12px] mt-2" style="color: var(--sys-label-2)"><b>Catatan aplikasi:</b> {m.catatan_aplikasi}</p>
								{/if}
								{#if !m.deskripsi_tds && !kvPairs(m.sifat_fisik).length && !kvPairs(m.karakteristik_film).length && !m.catatan_aplikasi}
									<p class="text-[11px] mt-2" style="color: var(--sys-label-2)">Profil teknis belum diisi oleh tim R&D.</p>
								{/if}
							{/if}

							{#if m.tds_url || m.msds_url}
								<div class="flex gap-2 mt-2">
									{#if m.tds_url}<a href={m.tds_url} target="_blank" rel="noopener" class="flex-1 text-center rounded-lg py-2 text-[12px] font-semibold text-white" style="background: var(--g)">Buka TDS</a>{/if}
									{#if m.msds_url}<a href={m.msds_url} target="_blank" rel="noopener" class="flex-1 text-center rounded-lg py-2 text-[12px] font-semibold text-white" style="background: #DC2626">Buka MSDS</a>{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{:else if tab === 'kompat'}
			<p class="text-[11px] mb-3" style="color: var(--sys-label-2)">Cek 2 bahan sebelum dicampur di gudang. Hijau = aman, kuning = perlu perhatian, merah = jangan dicampur.</p>
			<div class="space-y-2">
				<div class="relative">
					<div class="flex items-center gap-2 rounded-lg px-3 py-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<IconSearch size={16} />
						<input bind:value={cmpQA} oninput={onCmpSearchA} placeholder="Bahan 1…" class="flex-1 bg-transparent text-[13px] outline-none" style="color: var(--sys-label)" />
					</div>
					{#if cmpResA.length}
						<div class="absolute z-10 mt-1 w-full rounded-lg overflow-hidden" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)">
							{#each cmpResA as m (m.id)}
								<button class="w-full text-left px-3 py-2 text-[12px]" style="color: var(--sys-label)" onclick={() => pickCmpA(m)}>{m.nama} <span style="color: var(--sys-label-2)">· {m.kode_item}</span></button>
							{/each}
						</div>
					{/if}
				</div>
				<div class="relative">
					<div class="flex items-center gap-2 rounded-lg px-3 py-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<IconSearch size={16} />
						<input bind:value={cmpQB} oninput={onCmpSearchB} placeholder="Bahan 2…" class="flex-1 bg-transparent text-[13px] outline-none" style="color: var(--sys-label)" />
					</div>
					{#if cmpResB.length}
						<div class="absolute z-10 mt-1 w-full rounded-lg overflow-hidden" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)">
							{#each cmpResB as m (m.id)}
								<button class="w-full text-left px-3 py-2 text-[12px]" style="color: var(--sys-label)" onclick={() => pickCmpB(m)}>{m.nama} <span style="color: var(--sys-label-2)">· {m.kode_item}</span></button>
							{/each}
						</div>
					{/if}
				</div>
				<button
					class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
					style="background: var(--g)"
					disabled={!cmpPickA || !cmpPickB || cmpLoading}
					onclick={runCmp}
				>{cmpLoading ? 'Memeriksa…' : 'Periksa'}</button>
			</div>

			{#if cmpChecked}
				<div class="mt-4 rounded-xl p-3 text-[13px]" style={cmpFinding ? (cmpFinding.hasil === 'incompatible' ? 'background: #FEE2E2; color: #991B1B' : 'background: #FEF3C7; color: #92400E') : 'background: #DCFCE7; color: #166534'}>
					{#if !cmpFinding}
						<p class="font-bold">✓ Aman dicampur</p>
						<p class="text-[12px] mt-1">Tidak ada aturan yang melarang kombinasi ini. Tetap ikuti urutan & rasio pada TDS.</p>
					{:else}
						<p class="font-bold">{cmpFinding.hasil === 'incompatible' ? '⛔ JANGAN dicampur' : '⚠️ Perlu perhatian'}</p>
						<p class="text-[12px] mt-1">{cmpFinding.alasan}</p>
						{#if cmpFinding.hasil === 'incompatible'}
							<p class="text-[11px] mt-2">Hubungi R&D / supervisor sebelum melanjutkan.</p>
						{/if}
					{/if}
					<p class="text-[10px] mt-2 opacity-70">{cmpPickA?.nama} ↔ {cmpPickB?.nama}</p>
				</div>
			{/if}
		{:else if tab === 'mixing'}
			<p class="text-[11px] mb-3" style="color: var(--sys-label-2)">Hitung takaran Base/Hardener dari rasio formula resmi (released) — bukan resep bahan baku, hanya rasio campuran yang sudah tertera di TDS.</p>
			<div class="relative mb-3">
				<div class="flex items-center gap-2 rounded-lg px-3 py-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<IconSearch size={16} />
					<input bind:value={mixQuery} oninput={onMixSearch} placeholder="Cari nama produk…" class="flex-1 bg-transparent text-[13px] outline-none" style="color: var(--sys-label)" />
				</div>
				{#if mixResults.length}
					<div class="absolute z-10 mt-1 w-full rounded-lg overflow-hidden" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)">
						{#each mixResults as f (f.id)}
							<button class="w-full text-left px-3 py-2 text-[12px]" style="color: var(--sys-label)" onclick={() => pickMixFormula(f)}>
								{f.kode_fg_nama} <span style="color: var(--sys-label-2)">· v{f.version} · rasio {f.mixing_ratio_value}</span>
							</button>
						{/each}
					</div>
				{:else if mixLoading}
					<p class="text-[11px] mt-1" style="color: var(--sys-label-2)">Mencari…</p>
				{/if}
			</div>

			{#if mixPicked}
				<div class="rounded-xl p-3 mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<p class="text-[13px] font-bold" style="color: var(--sys-label)">{mixPicked.kode_fg_nama}</p>
					<p class="text-[11px]" style="color: var(--sys-label-2)">
						{mixPicked.nama_template} · v{mixPicked.version} · Rasio {mixPicked.mixing_ratio_value}
						({mixPicked.mixing_ratio_type === 'by_volume' ? 'volume' : 'berat'})
						{#if !isMultiComponent(mixPicked.mixing_ratio_value)}
							<span> — komponen tunggal, tidak perlu campur</span>
						{/if}
					</p>
				</div>

				<div class="flex items-center gap-2 rounded-lg px-3 py-2 mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<input
						type="number"
						min="0"
						step="0.1"
						bind:value={mixTargetQty}
						placeholder={`Target total campuran (${mixPicked.mixing_ratio_type === 'by_volume' ? 'Liter' : 'Kg'})`}
						class="flex-1 bg-transparent text-[13px] outline-none"
						style="color: var(--sys-label)"
					/>
				</div>

				{#if mixComponents.length > 0}
					<div class="space-y-2">
						{#each mixComponents as c (c.id)}
							<div class="rounded-xl p-3 flex items-center justify-between" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
								<div>
									<p class="text-[13px] font-bold" style="color: var(--sys-label)">{c.name}</p>
									<p class="text-[11px]" style="color: var(--sys-label-2)">Rasio {c.ratio} · {c.percentage.toFixed(1)}%</p>
								</div>
								<div class="text-right">
									<p class="text-[15px] font-bold" style="color: var(--g)">{c.qty_kg.toFixed(2)} kg</p>
									<p class="text-[11px]" style="color: var(--sys-label-2)">{c.qty_liter.toFixed(2)} L</p>
								</div>
							</div>
						{/each}
					</div>
					<p class="text-[10px] mt-2" style="color: var(--sys-label-2)">Perkiraan berdasarkan SG {mixPicked.sg ?? '1 (default)'}. Cek TDS untuk urutan & cara pencampuran.</p>
				{/if}
			{/if}
		{:else if tab === 'b3'}
			<div class="flex items-center gap-2 mb-4 rounded-lg px-3 py-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconAlertTriangle size={16} />
				<input bind:value={b3Query} oninput={doSearchB3} placeholder="Cari nama bahan…" class="flex-1 bg-transparent text-[13px] outline-none" style="color: var(--sys-label)" />
			</div>
			<p class="text-[11px] mb-3" style="color: var(--sys-label-2)">1 ketuk: bahaya, P3K, APD. Sumber data sama dengan MSDS (Fase 4).</p>
			{#if b3Loading}
				<p class="text-[12px] text-center py-8" style="color: var(--sys-label-2)">Memuat...</p>
			{:else}
				<div class="space-y-3">
					{#each b3Results as item (item.id)}
						<div class="rounded-xl p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<p class="text-[13px] font-bold" style="color: var(--sys-label)">{item.nama_bahan}</p>
							<p class="text-[11px]" style="color: var(--sys-label-2)">Lokasi: {item.lokasi_simpan || '-'}</p>
							{#if item.apd_wajib}
								<p class="text-[11px] mt-1" style="color: var(--sys-label)"><b>APD Wajib:</b> {item.apd_wajib}</p>
							{/if}
							{#if item.msds_document_id?.msds_url}
								<a href={item.msds_document_id.msds_url} target="_blank" rel="noopener" class="block text-center rounded-lg py-2 mt-2 text-[12px] font-semibold text-white" style="background: #DC2626">Lihat MSDS Lengkap</a>
							{/if}
						</div>
					{/each}
					{#if b3Results.length === 0 && b3Query}
						<p class="text-[12px] text-center py-8" style="color: var(--sys-label-2)">Tidak ditemukan. Lihat juga <a href="/hse/b3" style="color: var(--g)">halaman HSE B3 lengkap</a>.</p>
					{/if}
				</div>
			{/if}
		{:else if tab === 'retensi'}
			<p class="text-[11px] mb-3" style="color: var(--sys-label-2)">Catat lokasi simpan sampel retensi QC untuk sebuah batch. Scan label batch atau ketik manual — beda dari kolom retensi di form komplain (itu baru terisi kalau sudah ada komplain).</p>
			{#if retensiSuccess}
				<div class="rounded-xl p-4 text-center" style="background: var(--sys-fill)">
					<p class="text-[13px] font-bold" style="color: var(--sys-label)">Retensi sample tercatat.</p>
					<button class="mt-3 text-[12px] font-semibold" style="color: var(--g)" onclick={() => (retensiSuccess = false)}>Catat Lagi</button>
				</div>
			{:else}
				<div class="space-y-2">
					<button
						class="w-full h-10 rounded-lg text-[12px] font-bold text-white flex items-center justify-center gap-2"
						style="background: var(--g)"
						onclick={async () => { await loadRetensiScanner(); showRetensiScanner = true; }}
					>
						<IconQrcode size={16} /> Scan Label Batch
					</button>
					<input bind:value={retensiBatchNo} oninput={onRetensiBatchInput} placeholder="Nomor batch (atau hasil scan)" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" />
					{#if retensiRiwayat.length > 0}
						<div class="rounded-lg p-2 text-[11px]" style="background: #FEF3C7; color: #92400E">
							Batch ini sudah pernah dicatat {retensiRiwayat.length}×. Terakhir: {retensiRiwayat[0].lokasi_simpan || '-'} ({retensiRiwayat[0].tanggal_simpan ? new Date(retensiRiwayat[0].tanggal_simpan).toLocaleDateString('id-ID') : '-'}).
						</div>
					{/if}
					<input bind:value={retensiLokasi} placeholder="Lokasi simpan (rak/gudang)" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" />
					<input type="date" bind:value={retensiExpiry} placeholder="Estimasi kedaluwarsa" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" />
					<input bind:value={retensiSite} placeholder="Lokasi/proyek" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" />
					<textarea bind:value={retensiCatatan} rows="2" placeholder="Catatan (opsional)" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"></textarea>
					<input type="file" accept="image/*" onchange={(e: any) => (retensiFoto = e.target.files?.[0] || null)} class="text-[12px]" />
					<button
						class="w-full h-11 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
						style="background: var(--g)"
						disabled={retensiSubmitting || !retensiBatchNo.trim() || !retensiLokasi.trim()}
						onclick={submitRetensi}
					>
						<IconSend size={16} /> {retensiSubmitting ? 'Menyimpan…' : 'Simpan Retensi'}
					</button>
				</div>
			{/if}
		{:else if tab === 'weathering'}
			<p class="text-[11px] mb-3" style="color: var(--sys-label-2)">Catat progres panel uji outdoor/weathering secara berkala (foto, cuaca, pengamatan visual). Ketik nama panel yang sama tiap kunjungan supaya jadi satu riwayat.</p>
			{#if weaSuccess}
				<div class="rounded-xl p-4 text-center mb-3" style="background: var(--sys-fill)">
					<p class="text-[13px] font-bold" style="color: var(--sys-label)">Observasi tercatat.</p>
					<button class="mt-3 text-[12px] font-semibold" style="color: var(--g)" onclick={() => (weaSuccess = false)}>Tutup</button>
				</div>
			{/if}
			<div class="space-y-2">
				<input bind:value={weaNamaPanel} oninput={onWeaPanelInput} placeholder="Nama/kode panel, mis. Panel A - Cat Tembok Exterior XX" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" />
				<div class="flex gap-1">
					{#each [['cerah', 'Cerah'], ['hujan', 'Hujan'], ['mendung', 'Mendung'], ['lainnya', 'Lainnya']] as [val, lbl]}
						<button
							class="flex-1 h-9 rounded-lg text-[11px] font-semibold"
							style={weaKondisi === val ? 'background: var(--g); color: white' : 'background: var(--sys-fill); color: var(--sys-label)'}
							onclick={() => (weaKondisi = val)}
						>{lbl}</button>
					{/each}
				</div>
				<textarea bind:value={weaPengamatan} rows="3" placeholder="Pengamatan visual: perubahan warna, retak, chalking, dll." class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"></textarea>
				<input bind:value={weaSite} placeholder="Lokasi/proyek" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" />
				<input type="file" accept="image/*" onchange={(e: any) => (weaFoto = e.target.files?.[0] || null)} class="text-[12px]" />
				<button
					class="w-full h-11 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
					style="background: var(--g)"
					disabled={weaSubmitting || !weaNamaPanel.trim() || !weaPengamatan.trim()}
					onclick={submitWeathering}
				>
					<IconSend size={16} /> {weaSubmitting ? 'Menyimpan…' : 'Simpan Observasi'}
				</button>
			</div>
			{#if weaRiwayat.length > 0}
				<div class="mt-4 space-y-2">
					<p class="text-[11px] font-bold" style="color: var(--sys-label-2)">Riwayat panel ini:</p>
					{#each weaRiwayat as r (r.id)}
						<div class="rounded-lg p-2 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<p style="color: var(--sys-label-2)">{r.tanggal_observasi ? new Date(r.tanggal_observasi).toLocaleDateString('id-ID') : '-'} · {r.kondisi_cuaca || '-'}</p>
							<p style="color: var(--sys-label)">{r.pengamatan || '-'}</p>
						</div>
					{/each}
				</div>
			{/if}
		{:else if tab === 'lapor'}
			{#if laporSuccess}
				<div class="rounded-xl p-4 text-center" style="background: var(--sys-fill)">
					<p class="text-[13px] font-bold" style="color: var(--sys-label)">Laporan terkirim.</p>
					<p class="text-[11px] mt-1" style="color: var(--sys-label-2)">Masuk ke antrean komplain R&D (Fase 2, alur 8D).</p>
					<button class="mt-3 text-[12px] font-semibold" style="color: var(--g)" onclick={() => (laporSuccess = false)}>Lapor Lagi</button>
				</div>
			{:else}
				<div class="space-y-2">
					<input bind:value={laporBatch} placeholder="Nomor batch (bila ada)" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" />
					<input bind:value={laporSite} placeholder="Lokasi/proyek" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" />
					<select bind:value={laporJenisMasalah} class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)">
						<option value="">Jenis masalah aplikasi (opsional)</option>
						{#each JENIS_MASALAH_APLIKASI as j (j.value)}
							<option value={j.value}>{j.label}</option>
						{/each}
					</select>
					{#if laporJenisMasalah === 'daya_sebar'}
						<input
							type="number"
							step="0.1"
							bind:value={laporDayaSebarAktual}
							placeholder="Daya sebar aktual di lapangan (m²/L)"
							class="w-full rounded-lg px-3 py-2 text-[13px]"
							style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
						/>
					{/if}
					<textarea bind:value={laporDeskripsi} rows="4" placeholder="Deskripsi masalah (apa, sejak kapan, berapa banyak)" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"></textarea>
					<input type="file" accept="image/*" onchange={(e: any) => (laporFoto = e.target.files?.[0] || null)} class="text-[12px]" />
					<button
						class="w-full h-11 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
						style="background: var(--g)"
						disabled={laporSubmitting || !laporDeskripsi.trim()}
						onclick={submitLapor}
					>
						<IconSend size={16} /> {laporSubmitting ? 'Mengirim…' : 'Kirim Laporan'}
					</button>
				</div>
			{/if}
		{:else if tab === 'minta'}
			{#if mintaSuccess}
				<div class="rounded-xl p-4 text-center" style="background: var(--sys-fill)">
					<p class="text-[13px] font-bold" style="color: var(--sys-label)">Permintaan terkirim.</p>
					<p class="text-[11px] mt-1" style="color: var(--sys-label-2)">Masuk antrean admin R&D.</p>
					<button class="mt-3 text-[12px] font-semibold" style="color: var(--g)" onclick={() => (mintaSuccess = false)}>Minta Lagi</button>
				</div>
			{:else}
				<div class="space-y-2">
					<div class="flex gap-2">
						<button class="flex-1 h-9 rounded-lg text-[12px] font-semibold" style={mintaTipe === 'tds' ? 'background: var(--g); color: white' : 'background: var(--sys-fill); color: var(--sys-label)'} onclick={() => (mintaTipe = 'tds')}>TDS</button>
						<button class="flex-1 h-9 rounded-lg text-[12px] font-semibold" style={mintaTipe === 'msds' ? 'background: var(--g); color: white' : 'background: var(--sys-fill); color: var(--sys-label)'} onclick={() => (mintaTipe = 'msds')}>MSDS</button>
					</div>
					<input bind:value={mintaKodeProduk} placeholder="Nama/kode produk yang dibutuhkan" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" />
					<textarea bind:value={mintaCatatan} rows="3" placeholder="Catatan tambahan (opsional)" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"></textarea>
					<button
						class="w-full h-11 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
						style="background: var(--g)"
						disabled={mintaSubmitting || !mintaKodeProduk.trim()}
						onclick={submitMinta}
					>
						<IconFileText size={16} /> {mintaSubmitting ? 'Mengirim…' : 'Kirim Permintaan'}
					</button>
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Modal Edukasi & Guidance Bahan Baku Lapangan -->
<MaterialGuidanceModal
	open={guidanceModalOpen}
	material={selectedGuidanceMaterial}
	onClose={() => (guidanceModalOpen = false)}
/>
