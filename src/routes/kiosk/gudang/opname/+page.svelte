<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/kiosk/gudang/opname/+page.svelte
	// Opname (hitung fisik vs sistem) dari terminal Kiosk Gudang. Selisih dalam toleransi langsung
	// diterapkan ke stok; di luar toleransi masuk inbox verifikasi lapangan (stok tak berubah).
	// Fase 5: Penajaman Kiosk Inventory — Scanner QR/Barcode, Rekomendasi Opname, Touch Stepper, Lokasi Rak.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		IconArrowLeft,
		IconSearch,
		IconLoader2,
		IconCircleCheck,
		IconClockPause,
		IconEqual,
		IconQrcode,
		IconMapPin,
		IconPlus,
		IconMinus,
		IconX,
		IconAlertTriangle,
		IconCheck,
		IconRefresh,
		IconSparkles
	} from '@tabler/icons-svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { openKioskNumpad, isSatuanDesimal } from '$lib/components/kiosk/kioskNumpad';

	// File 11 §5 — numpad layar untuk hitung fisik. `fisik` tetap number|null (dipakai luas di
	// bawah), numpad hanya jembatan string<->number di titik masuk/keluar ini.
	async function bukaNumpadFisik() {
		const satuan = picked?.satuan || '';
		const hasil = await openKioskNumpad({
			judul: 'Hasil Hitung Fisik Sebenarnya',
			nilaiAwal: fisik != null ? String(fisik) : '',
			desimal: isSatuanDesimal(satuan),
			satuan: satuan || 'Pcs'
		});
		if (hasil !== null) fisik = hasil === '' ? null : Number(hasil);
	}

	interface LokasiRak {
		gudang_id: number;
		nama_rak: string;
		kode_rak: string | null;
		expected_qty?: number;
	}

	interface OItem {
		item_id: number;
		nama_barang: string;
		kode_item: string | null;
		satuan: string | null;
		/** null + blind_sesi = item sedang diopname dalam sesi BLIND: stok sistem sengaja tidak dikirim server. */
		stok_sistem: number | null;
		blind_sesi?: boolean;
		stok_minimum?: number | null;
		parent_category?: string | null;
		lokasi_rak?: LokasiRak[];
	}

	interface GateInfo {
		toleransi_pct: number;
		wajib_approval: boolean;
	}

	// --- State Pencarian & Scanner ---
	let q = $state('');
	let searching = $state(false);
	let searchError = $state('');
	let results = $state<OItem[]>([]);
	let recommendations = $state<OItem[]>([]);
	let loadingRecs = $state(false);
	let gate = $state<GateInfo>({ toleransi_pct: 0, wajib_approval: true });
	let selectedRack = $state<{ id: number; nama_gudang: string; kode_gudang: string | null } | null>(null);
	let debounce: ReturnType<typeof setTimeout> | null = null;

	// Modal Scanner QR/Barcode Kamera
	let QrScannerModal = $state<any>(null);
	let showScanner = $state(false);
	let scanError = $state('');

	async function loadScanner() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}

	// --- State Form Opname Terpilih ---
	let picked = $state<OItem | null>(null);
	let fisik = $state<number | null>(null);
	let catatan = $state('');
	let submitting = $state(false);
	let submitError = $state('');
	let result = $state<{ status: string; delta: number; delta_pct: number; reference_no?: string } | null>(null);
	let clientTxn = $state('');

	const QUICK_NOTES = [
		'Kemasan Rusak',
		'Barang Hilang / Kurang',
		'Salah Hitung Awal',
		'Barang Berlebih',
		'Tertukar Rak',
		'Kadaluarsa / Afkir'
	];

	// --- Logika Rekomendasi & Pencarian ---
	async function loadRecommendations() {
		loadingRecs = true;
		try {
			const res = await fetch('/api/kiosk/gudang/opname/cari?rekomendasi=1');
			const data = await res.json().catch(() => null);
			if (data?.gate) gate = data.gate;
			recommendations = data?.items || [];
		} catch (e) {
			console.warn('[Opname] Gagal memuat rekomendasi', e);
		} finally {
			loadingRecs = false;
		}
	}

	async function runSearch() {
		const term = q.trim();
		searchError = '';
		selectedRack = null;

		if (!term) {
			results = [];
			return;
		}

		searching = true;
		try {
			const res = await fetch(`/api/kiosk/gudang/opname/cari?q=${encodeURIComponent(term)}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Pencarian gagal.');
			if (data?.gate) gate = data.gate;
			results = data.items || [];
		} catch (e) {
			searchError = e instanceof Error ? e.message : 'Pencarian gagal.';
			results = [];
		} finally {
			searching = false;
		}
	}

	function onQInput() {
		if (debounce) clearTimeout(debounce);
		debounce = setTimeout(runSearch, 350);
	}

	function clearSearch() {
		q = '';
		results = [];
		selectedRack = null;
		searchError = '';
	}

	async function loadRackItems(gudangId: number) {
		searching = true;
		searchError = '';
		q = '';
		results = [];
		try {
			const res = await fetch(`/api/kiosk/gudang/opname/cari?gudang_id=${gudangId}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal memuat barang rak.');
			if (data?.gate) gate = data.gate;
			selectedRack = data.rack || { id: gudangId, nama_gudang: `Rak #${gudangId}`, kode_gudang: null };
			results = data.items || [];
		} catch (e) {
			searchError = e instanceof Error ? e.message : 'Gagal memuat data rak.';
			selectedRack = null;
		} finally {
			searching = false;
		}
	}

	function handleScanDetect(raw: string) {
		showScanner = false;
		scanError = '';
		const clean = raw.trim();
		if (!clean) return;

		// Satu parser untuk semua format QR EPI (URL /scan/… dan EPI:<TYPE>:<id> ditangani di dalamnya).
		const parsed = parseEpiQr(clean);
		if (parsed) {
			if (parsed.type === 'ITEM' || parsed.type === 'EQUIPMENT') {
				// EQUIPMENT (barcode aset, audit 17 Sep 2026) dicari pakai id polos, sama seperti ITEM.
				q = String(parsed.id);
				runSearch();
				return;
			}
			if (parsed.type === 'LOC') {
				loadRackItems(Number(parsed.id));
				return;
			}
		}

		// Barcode SKU biasa (tidak berformat EPI:)
		q = clean.replace(/[\r\n\t]+/g, '').trim();
		runSearch();
	}

	function handleWindowKeyDown(e: KeyboardEvent) {
		// Enter dari scan cepat sudah ditangani lewat kiosk-hardware-scan (layout menandai
		// e.defaultPrevented). Jalur ini HANYA untuk Enter dari ketikan manusia biasa di input.
		if (e.defaultPrevented) return;
		if (e.key === 'Enter' && !picked) {
			const activeEl = document.activeElement as HTMLElement | null;
			if (activeEl && activeEl.tagName === 'INPUT') {
				runSearch();
			}
		}
	}

	// --- Form Opname ---
	function pick(it: OItem) {
		picked = it;
		fisik = null;
		catatan = '';
		submitError = '';
		result = null;
		clientTxn = `kioskopname-${it.item_id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	}

	function reset() {
		picked = null;
		fisik = null;
		result = null;
		submitError = '';
	}

	// Quick steppers
	function setFisik(val: number) {
		fisik = Math.max(0, val);
	}

	function adjustFisik(delta: number) {
		const base = fisik == null ? (picked?.blind_sesi ? 0 : picked?.stok_sistem || 0) : fisik;
		fisik = Math.max(0, base + delta);
	}

	function toggleCatatan(tag: string) {
		if (!catatan) {
			catatan = tag;
		} else if (catatan.includes(tag)) {
			catatan = catatan.replace(tag, '').replace(/,\s*,/g, ',').trim();
		} else {
			catatan = `${catatan}, ${tag}`;
		}
	}

	// Hitung selisih & toleransi
	let selisih = $derived(picked && !picked.blind_sesi && fisik != null ? fisik - (picked.stok_sistem ?? 0) : null);
	let deltaAbs = $derived(selisih != null ? Math.abs(selisih) : 0);
	let deltaPct = $derived(
		picked && selisih != null && (picked.stok_sistem ?? 0) > 0
			? Math.round((deltaAbs / (picked.stok_sistem ?? 1)) * 1000) / 10
			: (selisih !== 0 && selisih != null ? 100 : 0)
	);
	let isAutoApproved = $derived(
		selisih === 0 || (!gate.wajib_approval || deltaPct <= gate.toleransi_pct)
	);

	async function submit() {
		if (!picked) return;
		submitError = '';
		if (fisik == null || fisik < 0) {
			submitError = 'Isi hasil hitungan fisik (0 kalau tidak ada).';
			return;
		}
		submitting = true;
		try {
			const res = await fetch('/api/kiosk/gudang/opname', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					item_id: picked.item_id,
					// File 06 §2.1 — rak yang sedang dihitung (opname per rak). null bila barang
					// dicari langsung tanpa rak (desain B, belum dipetakan ke rak).
					rak_id: selectedRack?.id ?? null,
					stok_sistem: picked.stok_sistem,
					hitung_fisik: fisik,
					catatan: catatan.trim() || null,
					client_txn_id: clientTxn
				})
			});
			const data = await res.json().catch(() => null);
			if (res.status === 409) {
				// §2.2 — stok berubah sejak layar dibuka (ada pick/transfer). Minta hitung ulang,
				// jangan tebak: muat ulang barang ini supaya stok_sistem yang ditampilkan segar.
				if (selectedRack) await loadRackItems(selectedRack.id);
				else await runSearch();
				throw new Error(data?.message || 'Stok berubah sejak layar dibuka. Hitung ulang barang ini.');
			}
			if (!res.ok) throw new Error(data?.message || `Gagal menyimpan opname (${res.status}).`);
			result = {
				status: data.status,
				delta: data.delta,
				delta_pct: data.delta_pct,
				reference_no: data.reference_no
			};
		} catch (e) {
			submitError = e instanceof Error ? e.message : 'Gagal menyimpan opname.';
		} finally {
			submitting = false;
		}
	}

	function onHardwareScan(e: Event) {
		const custom = e as CustomEvent<{ code: string }>;
		if (custom.detail?.code) {
			handleScanDetect(custom.detail.code);
			e.preventDefault();
		}
	}

	onMount(() => {
		loadRecommendations();
		window.addEventListener('kiosk-hardware-scan', onHardwareScan);
		return () => {
			if (debounce) clearTimeout(debounce);
			window.removeEventListener('kiosk-hardware-scan', onHardwareScan);
		};
	});
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<div class="wrap">
	<header class="header">
		<button class="back" onclick={() => (picked ? reset() : goto('/kiosk/gudang'))}>
			<IconArrowLeft size={20} />
			<span>Kembali</span>
		</button>
		<div class="title-row">
			<h1>Hitung Stok Rak</h1>
			{#if gate.toleransi_pct > 0}
				<span class="badge-tol">Toleransi: {gate.toleransi_pct}%</span>
			{/if}
		</div>
	</header>

	{#if !picked}
		<!-- Mode Pencarian & Rekomendasi -->
		<p class="hint">
			Hitung fisik barang di rak, lalu masukkan angkanya. Selisih dalam batas toleransi ({gate.toleransi_pct}%)
			langsung disesuaikan ke stok sistem.
		</p>

		<div class="search-row">
			<div class="search-box">
				<IconSearch size={20} class="search-icon" />
				<input
					type="text"
					placeholder="Ketik nama, kode barang, atau scan barcode..."
					bind:value={q}
					oninput={onQInput}
				/>
				{#if q}
					<button class="clear-btn" onclick={clearSearch} aria-label="Bersihkan">
						<IconX size={16} />
					</button>
				{/if}
			</div>
			<button
				class="scan-action-btn"
				onclick={async () => {
					await loadScanner();
					scanError = '';
					showScanner = true;
				}}
				title="Scan Barcode / QR Barang atau Rak"
			>
				<IconQrcode size={22} />
				<span>Scan QR / Barcode</span>
			</button>
		</div>

		{#if scanError}
			<div class="alert-box error">
				<IconAlertTriangle size={18} />
				<span>{scanError}</span>
			</div>
		{/if}

		{#if selectedRack}
			<div class="rack-filter-banner">
				<div class="rf-info">
					<IconMapPin size={18} />
					<span>
						Menampilkan barang di <strong>{selectedRack.nama_gudang}</strong>
						{#if selectedRack.kode_gudang}({selectedRack.kode_gudang}){/if}
					</span>
				</div>
				<button class="rf-clear" onclick={clearSearch}>
					<IconX size={15} /> Semua Barang
				</button>
			</div>
		{/if}

		{#if searching}
			<div class="py-8 flex justify-center">
				<CircularProgressGauge size={64} strokeWidth={5} label="Mencari Barang Gudang..." sublabel="Pencarian persediaan fisik" />
			</div>
		{:else if searchError}
			<div class="alert-box error">
				<IconAlertTriangle size={18} />
				<span>{searchError}</span>
			</div>
		{:else if results.length > 0}
			<!-- Hasil Pencarian -->
			<div class="section-title">
				<span>Hasil Pencarian ({results.length})</span>
			</div>
			<div class="list">
				{#each results as it (it.item_id)}
					<button class="item-card" onclick={() => pick(it)}>
						<div class="item-info">
							<div class="item-nama">{it.nama_barang}</div>
							<div class="item-meta">
								{#if it.kode_item}<span class="code-pill">{it.kode_item}</span>{/if}
								{#if it.parent_category}<span class="cat-pill">{it.parent_category}</span>{/if}
								{#if it.lokasi_rak && it.lokasi_rak.length > 0}
									<span class="loc-summary">
										<IconMapPin size={13} />
										{it.lokasi_rak.map((l) => l.nama_rak).join(', ')}
									</span>
								{/if}
							</div>
						</div>
						<div class="item-stok">
							<span class="stok-val">{it.blind_sesi ? '•••' : it.stok_sistem}</span>
							<span class="stok-sat">{it.satuan || ''}</span>
						</div>
					</button>
				{/each}
			</div>
		{:else if q.trim().length > 0}
			<div class="empty-state">
				<p>Tidak ada barang ditemukan untuk kata kunci <strong>"{q}"</strong>.</p>
				<button class="btn-subtle" onclick={clearSearch}>Bersihkan pencarian</button>
			</div>
		{:else}
			<!-- Tampilan Rekomendasi Opname (Saat Belum Cari) -->
			<div class="rec-section">
				<div class="rec-header">
					<div class="rec-title">
						<IconSparkles size={18} class="sparkle" />
						<span>Rekomendasi Opname Hari Ini</span>
					</div>
					<button class="refresh-btn" onclick={loadRecommendations} disabled={loadingRecs} title="Muat ulang">
						<IconRefresh size={16} class={loadingRecs ? 'spin' : ''} />
					</button>
				</div>
				<p class="rec-desc">
					Daftar barang aktif yang belum diverifikasi atau perlu sinkronisasi berkala dengan stok fisik.
				</p>

				{#if loadingRecs}
					<div class="py-8 flex justify-center">
						<CircularProgressGauge size={64} strokeWidth={5} label="Memuat Rekomendasi Opname..." sublabel="Sinkronisasi jadwal audit stok" />
					</div>
				{:else if recommendations.length > 0}
					<div class="list">
						{#each recommendations as it (it.item_id)}
							<button class="item-card" onclick={() => pick(it)}>
								<div class="item-info">
									<div class="item-nama">{it.nama_barang}</div>
									<div class="item-meta">
										{#if it.kode_item}<span class="code-pill">{it.kode_item}</span>{/if}
										{#if it.parent_category}<span class="cat-pill">{it.parent_category}</span>{/if}
										{#if it.lokasi_rak && it.lokasi_rak.length > 0}
											<span class="loc-summary">
												<IconMapPin size={13} />
												{it.lokasi_rak.map((l) => l.nama_rak).join(', ')}
											</span>
										{:else}
											<span class="loc-none">Belum di rak</span>
										{/if}
									</div>
								</div>
								<div class="item-stok">
									<span class="stok-val">{it.blind_sesi ? '•••' : it.stok_sistem}</span>
									<span class="stok-sat">{it.satuan || ''}</span>
								</div>
							</button>
						{/each}
					</div>
				{:else}
					<div class="empty-state">
						<p>Belum ada data barang. Silakan gunakan kotak pencarian atau tombol Scan di atas.</p>
					</div>
				{/if}
			</div>
		{/if}

	{:else if result}
		<!-- Mode Selesai / Feedback Hasil -->
		<div class="done-card">
			{#if result.status === 'no_change'}
				<div class="done-icon icon-green">
					<IconEqual size={36} />
				</div>
				<h2 class="done-title">Cocok — Tidak Ada Selisih</h2>
				<p class="done-sub">
					Hitungan fisik cocok 100% dengan stok sistem (<strong>{picked.stok_sistem} {picked.satuan || ''}</strong>).
					Kondisi stok tercatat sudah sinkron.
				</p>
			{:else if result.status === 'auto_approved'}
				<div class="done-icon icon-green">
					<IconCircleCheck size={36} />
				</div>
				<h2 class="done-title">Stok Berhasil Disesuaikan</h2>
				<p class="done-sub">
					Selisih <strong>{result.delta > 0 ? '+' : ''}{result.delta} {picked.satuan || ''} ({result.delta_pct}%)</strong>
					berada dalam toleransi ({gate.toleransi_pct}%) dan langsung diterapkan ke sistem.
				</p>
			{:else if result.status === 'masuk_sesi'}
				<div class="done-icon icon-green">
					<IconCircleCheck size={36} />
				</div>
				<h2 class="done-title">Hitungan Masuk Sesi Opname</h2>
				<p class="done-sub">
					Hitungan Anda tercatat di sesi opname aktif. Penyesuaian stok baru dibuat setelah admin mereview dan menyetujui sesi.
				</p>
			{:else}
				<div class="done-icon icon-amber">
					<IconClockPause size={36} />
				</div>
				<h2 class="done-title">Menunggu Persetujuan Supervisor</h2>
				<p class="done-sub">
					Selisih <strong>{result.delta > 0 ? '+' : ''}{result.delta} {picked.satuan || ''} ({result.delta_pct}%)</strong>
					melebihi batas toleransi. Stok belum berubah dan telah dimasukkan ke inbox verifikasi supervisor gudang.
				</p>
			{/if}

			{#if result.reference_no}
				<div class="ref-pill">No. Transaksi: <strong>{result.reference_no}</strong></div>
			{/if}

			<div class="done-actions">
				<button class="btn-primary" onclick={reset}>
					Opname Barang Lain
				</button>
				<button class="btn-secondary" onclick={() => goto('/kiosk/gudang')}>
					Kembali ke Menu Gudang
				</button>
			</div>
		</div>

	{:else}
		<!-- Mode Form Input Opname untuk Item Terpilih -->
		<div class="form-container">
			<!-- Detail Barang Terpilih -->
			<div class="item-header-card">
				<div class="ih-top">
					<div class="ih-name">{picked.nama_barang}</div>
					{#if picked.kode_item}<span class="code-pill big">{picked.kode_item}</span>{/if}
				</div>

				<div class="ih-stats">
					<div class="stat-col">
						<span class="stat-label">Stok Tercatat Sistem</span>
						{#if picked.blind_sesi}
							<span class="stat-value" title="Disembunyikan: item ini sedang dihitung dalam sesi opname blind">••• <small>disembunyikan</small></span>
						{:else}
							<span class="stat-value">{picked.stok_sistem} <small>{picked.satuan || ''}</small></span>
						{/if}
					</div>
					{#if picked.stok_minimum != null}
						<div class="stat-col">
							<span class="stat-label">Batas Stok Minimum</span>
							<span class="stat-value-sub">{picked.stok_minimum} {picked.satuan || ''}</span>
						</div>
					{/if}
				</div>

				<!-- Lokasi Rak Tempat Barang Berada -->
				<div class="ih-locations">
					<span class="loc-head"><IconMapPin size={15} /> Lokasi Rak Tersimpan:</span>
					{#if picked.lokasi_rak && picked.lokasi_rak.length > 0}
						<div class="loc-chips">
							{#each picked.lokasi_rak as loc (loc.gudang_id)}
								<div class="loc-badge">
									<strong>{loc.nama_rak}</strong>
									{#if loc.expected_qty}<span>(Rencana: {loc.expected_qty} {picked.satuan || ''})</span>{/if}
								</div>
							{/each}
						</div>
					{:else}
						<span class="loc-unmapped">Belum dipetakan ke rak tertentu (cek stok umum)</span>
					{/if}
				</div>
			</div>

			<!-- Input Hitungan Fisik & Quick Buttons -->
			<div class="count-section">
				<div class="count-head">
					<label class="section-label" for="fisik-input">Hasil Hitung Fisik Sebenarnya</label>
					{#if fisik != null}
						<button class="btn-link" onclick={() => (fisik = null)}>Reset input</button>
					{/if}
				</div>

				<div class="input-display-row">
					<button type="button" id="fisik-input" class="touch-input touch-input--btn" onclick={bukaNumpadFisik}>
						{fisik != null ? String(fisik).replace('.', ',') : '0'}
					</button>
					<span class="unit-suffix">{picked.satuan || 'Pcs'}</span>
				</div>

				<!-- Quick Preset Buttons (1-Tap) -->
				<div class="preset-row">
					{#if !picked.blind_sesi}
					<button
						type="button"
						class="preset-btn match"
						onclick={() => setFisik(picked!.stok_sistem ?? 0)}
					>
						<IconEqual size={17} />
						<span>Sama dg Sistem ({picked.stok_sistem})</span>
					</button>
					{/if}
					<button
						type="button"
						class="preset-btn zero"
						onclick={() => setFisik(0)}
					>
						<span>Kosong / Habis (0)</span>
					</button>
				</div>

				<!-- Quick Stepper Row -->
				<div class="stepper-row">
					<button type="button" class="step-btn" onclick={() => adjustFisik(-10)}>-10</button>
					<button type="button" class="step-btn" onclick={() => adjustFisik(-1)}>-1</button>
					<button type="button" class="step-btn" onclick={() => adjustFisik(1)}>+1</button>
					<button type="button" class="step-btn" onclick={() => adjustFisik(10)}>+10</button>
				</div>
			</div>

			<!-- Indikator Selisih & Status Toleransi Real-Time -->
			{#if fisik != null}
				{#if selisih === 0}
					<div class="diff-banner match">
						<IconCircleCheck size={22} />
						<div class="diff-content">
							<div class="diff-title">Hitungan Cocok (0 Selisih)</div>
							<div class="diff-sub">Stok fisik persis sesuai dengan catatan sistem.</div>
						</div>
					</div>
				{:else}
					<div class="diff-banner {isAutoApproved ? 'auto-ok' : 'need-approval'}">
						{#if isAutoApproved}
							<IconCircleCheck size={22} />
						{:else}
							<IconAlertTriangle size={22} />
						{/if}
						<div class="diff-content">
							<div class="diff-title">
								Selisih: {(selisih ?? 0) > 0 ? '+' : ''}{selisih ?? 0} {picked.satuan || ''} ({deltaPct}%)
							</div>
							<div class="diff-sub">
								{#if isAutoApproved}
									Dalam toleransi ({gate.toleransi_pct}%). Stok akan langsung disesuaikan setelah disimpan.
								{:else}
									Melebihi toleransi ({gate.toleransi_pct}%). Memerlukan review & verifikasi supervisor.
								{/if}
							</div>
						</div>
					</div>
				{/if}
			{/if}

			<!-- Input Catatan dengan Quick Suggestion Chips -->
			<div class="notes-section">
				<label class="section-label" for="catatan-input">Catatan Kondisi / Penyebab (Opsional)</label>
				<input
					id="catatan-input"
					type="text"
					placeholder="mis. barang basah, kemasan rusak, salah rak"
					bind:value={catatan}
					class="note-input"
				/>

				<div class="note-chips">
					{#each QUICK_NOTES as tag}
						<button
							type="button"
							class="note-chip {catatan.includes(tag) ? 'active' : ''}"
							onclick={() => toggleCatatan(tag)}
						>
							{tag}
						</button>
					{/each}
				</div>
			</div>

			{#if submitError}
				<div class="alert-box error">
					<IconAlertTriangle size={18} />
					<span>{submitError}</span>
				</div>
			{/if}

			<button
				class="submit-btn {selisih === 0 ? 'btn-match' : 'btn-submit'}"
				disabled={submitting || fisik == null || fisik < 0}
				onclick={submit}
			>
				{#if submitting}
					<IconLoader2 size={20} class="spin" />
					<span>Menyimpan ke Sistem...</span>
				{:else if selisih === 0}
					<IconCheck size={20} />
					<span>Konfirmasi Stok Cocok</span>
				{:else}
					<span>Simpan Hasil Opname</span>
				{/if}
			</button>

			<p class="legal-hint">
				Hasil opname tercatat otomatis atas badge Anda. Selisih dalam toleransi ({gate.toleransi_pct}%) langsung aktif.
			</p>
		</div>
	{/if}
</div>

<!-- Modal Scanner QR/Barcode Kamera -->
{#if showScanner && QrScannerModal}
	<QrScannerModal
		onDetect={handleScanDetect}
		onClose={() => (showScanner = false)}
	/>
{/if}

<style>
	.wrap {
		padding: 1rem 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
		max-width: 100%;
		margin: 0;
		box-sizing: border-box;
		min-height: 100%;
	}

	.header {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.back {
		align-self: flex-start;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		background: none;
		border: none;
		color: #475569;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
		padding: 0.3rem 0;
	}

	.back:hover {
		color: #0f172a;
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	h1 {
		font-size: 1.45rem;
		font-weight: 800;
		color: #0f172a;
		margin: 0;
	}

	.badge-tol {
		font-size: 0.75rem;
		font-weight: 700;
		background: #f1f5f9;
		color: #475569;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		border: 1px solid #cbd5e1;
	}

	.hint {
		font-size: 0.88rem;
		color: #64748b;
		margin: 0;
		line-height: 1.45;
	}

	.search-row {
		display: flex;
		gap: 0.5rem;
		align-items: stretch;
	}

	.search-box {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		background: white;
		border: 1.5px solid #cbd5e1;
		border-radius: 0.75rem;
		padding: 0 0.65rem;
	}

	.search-box:focus-within {
		border-color: #0284c7;
		box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
	}

	:global(.search-icon) {
		color: #94a3b8;
	}

	.search-box input {
		flex: 1;
		border: none;
		outline: none;
		padding: 0.75rem 0.25rem;
		font-size: 0.95rem;
		min-width: 0;
		background: transparent;
	}

	.clear-btn {
		background: #f1f5f9;
		border: none;
		color: #64748b;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	.scan-action-btn {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		background: #0284c7;
		color: white;
		border: none;
		border-radius: 0.75rem;
		padding: 0 1rem;
		font-size: 0.88rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
		min-height: 48px;
	}

	.scan-action-btn:hover {
		background: #0369a1;
	}

	.alert-box {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-radius: 0.65rem;
		font-size: 0.88rem;
		font-weight: 600;
	}

	.alert-box.error {
		background: #fef2f2;
		color: #b91c1c;
		border: 1px solid #fecaca;
	}

	.rack-filter-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		background: #f0fdf4;
		border: 1px solid #bbf7d0;
		color: #166534;
		border-radius: 0.65rem;
		padding: 0.65rem 0.9rem;
	}

	.rf-info {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.88rem;
	}

	.rf-clear {
		background: white;
		border: 1px solid #86efac;
		color: #166534;
		border-radius: 0.4rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}

	.section-title {
		font-size: 0.82rem;
		font-weight: 800;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-top: 0.25rem;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.item-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		text-align: left;
		background: white;
		border: 1.5px solid #e2e8f0;
		border-radius: 0.85rem;
		padding: 0.85rem 1rem;
		cursor: pointer;
		transition: transform 0.1s ease, border-color 0.15s ease;
	}

	.item-card:hover {
		border-color: #0284c7;
		background: #f8fafc;
	}

	.item-card:active {
		transform: scale(0.99);
	}

	.item-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.item-nama {
		font-size: 0.95rem;
		font-weight: 700;
		color: #0f172a;
		line-height: 1.3;
	}

	.item-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}

	.code-pill {
		font-size: 0.72rem;
		font-weight: 700;
		color: #475569;
		background: #f1f5f9;
		padding: 0.15rem 0.45rem;
		border-radius: 0.35rem;
	}

	.code-pill.big {
		font-size: 0.82rem;
		padding: 0.2rem 0.55rem;
	}

	.cat-pill {
		font-size: 0.7rem;
		font-weight: 600;
		color: #64748b;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		padding: 0.1rem 0.4rem;
		border-radius: 0.35rem;
	}

	.loc-summary {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: #0284c7;
		background: #f0f9ff;
		padding: 0.1rem 0.4rem;
		border-radius: 0.35rem;
	}

	.loc-none {
		font-size: 0.7rem;
		color: #94a3b8;
		font-style: italic;
	}

	.item-stok {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		white-space: nowrap;
	}

	.stok-val {
		font-size: 1.15rem;
		font-weight: 800;
		color: #0f766e;
	}

	.stok-sat {
		font-size: 0.75rem;
		color: #64748b;
		font-weight: 600;
	}

	.rec-section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 0.85rem;
		padding: 1rem;
	}

	.rec-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.rec-title {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.95rem;
		font-weight: 800;
		color: #0f172a;
	}

	:global(.sparkle) {
		color: #ea580c;
	}

	.refresh-btn {
		background: none;
		border: none;
		color: #64748b;
		cursor: pointer;
		padding: 0.3rem;
		border-radius: 0.35rem;
		display: flex;
	}

	.refresh-btn:hover {
		color: #0f172a;
		background: #f1f5f9;
	}

	.rec-desc {
		font-size: 0.82rem;
		color: #64748b;
		margin: 0;
	}

	.center-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2.5rem 1rem;
		color: #64748b;
		font-size: 0.9rem;
	}

	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
		color: #64748b;
		font-size: 0.9rem;
	}

	.btn-subtle {
		margin-top: 0.5rem;
		background: #f1f5f9;
		border: 1px solid #cbd5e1;
		color: #475569;
		padding: 0.45rem 0.85rem;
		border-radius: 0.5rem;
		font-weight: 600;
		cursor: pointer;
	}

	/* --- Form Opname --- */
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.item-header-card {
		background: white;
		border: 1.5px solid #e2e8f0;
		border-radius: 0.85rem;
		padding: 1.15rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.ih-top {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.ih-name {
		font-size: 1.15rem;
		font-weight: 800;
		color: #0f172a;
		line-height: 1.3;
	}

	.ih-stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.75rem;
		background: #f8fafc;
		border-radius: 0.65rem;
		padding: 0.75rem 1rem;
	}

	.stat-col {
		display: flex;
		flex-direction: column;
	}

	.stat-label {
		font-size: 0.72rem;
		font-weight: 700;
		color: #64748b;
		text-transform: uppercase;
	}

	.stat-value {
		font-size: 1.35rem;
		font-weight: 800;
		color: #0f766e;
	}

	.stat-value small {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.stat-value-sub {
		font-size: 1.1rem;
		font-weight: 700;
		color: #475569;
	}

	.ih-locations {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.loc-head {
		font-size: 0.75rem;
		font-weight: 700;
		color: #475569;
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.loc-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.loc-badge {
		background: #f0fdf4;
		border: 1px solid #bbf7d0;
		color: #166534;
		font-size: 0.78rem;
		padding: 0.25rem 0.6rem;
		border-radius: 0.45rem;
		display: flex;
		gap: 0.3rem;
	}

	.loc-unmapped {
		font-size: 0.78rem;
		color: #94a3b8;
		font-style: italic;
	}

	.count-section {
		background: white;
		border: 1.5px solid #cbd5e1;
		border-radius: 0.85rem;
		padding: 1.15rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.count-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.section-label {
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		color: #334155;
		letter-spacing: 0.05em;
	}

	.btn-link {
		background: none;
		border: none;
		color: #dc2626;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
		padding: 0;
	}

	.input-display-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: 2px solid #94a3b8;
		border-radius: 0.75rem;
		padding: 0.25rem 0.75rem;
		background: #f8fafc;
	}

	.input-display-row:focus-within {
		border-color: #0284c7;
		background: white;
		box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.2);
	}

	.touch-input {
		flex: 1;
		border: none;
		outline: none;
		font-size: 1.8rem;
		font-weight: 800;
		color: #0f172a;
		background: transparent;
		min-width: 0;
	}
	.touch-input--btn { text-align: left; cursor: pointer; min-height: 64px; }

	.unit-suffix {
		font-size: 1rem;
		font-weight: 700;
		color: #64748b;
	}

	.preset-row {
		display: grid;
		grid-template-columns: 1.4fr 1fr;
		gap: 0.5rem;
	}

	.preset-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		border: none;
		border-radius: 0.65rem;
		padding: 0.75rem 0.5rem;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		min-height: 46px;
	}

	.preset-btn.match {
		background: #ecfdf5;
		color: #047857;
		border: 1.5px solid #a7f3d0;
	}

	.preset-btn.match:hover {
		background: #d1fae5;
	}

	.preset-btn.zero {
		background: #f8fafc;
		color: #64748b;
		border: 1.5px solid #e2e8f0;
	}

	.preset-btn.zero:hover {
		background: #f1f5f9;
	}

	.stepper-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.45rem;
	}

	.step-btn {
		background: #f1f5f9;
		border: 1px solid #cbd5e1;
		color: #0f172a;
		font-size: 1.05rem;
		font-weight: 800;
		border-radius: 0.6rem;
		padding: 0.7rem 0.25rem;
		cursor: pointer;
		min-height: 48px;
	}

	.step-btn:hover {
		background: #e2e8f0;
	}

	.diff-banner {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		padding: 0.85rem 1rem;
		border-radius: 0.75rem;
		font-size: 0.88rem;
	}

	.diff-banner.match {
		background: #ecfdf5;
		border: 1.5px solid #a7f3d0;
		color: #047857;
	}

	.diff-banner.auto-ok {
		background: #f0f9ff;
		border: 1.5px solid #bae6fd;
		color: #0369a1;
	}

	.diff-banner.need-approval {
		background: #fffbeb;
		border: 1.5px solid #fde68a;
		color: #b45309;
	}

	.diff-content {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.diff-title {
		font-size: 0.95rem;
		font-weight: 800;
	}

	.diff-sub {
		font-size: 0.8rem;
		line-height: 1.35;
	}

	.notes-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.note-input {
		border: 1.5px solid #cbd5e1;
		border-radius: 0.65rem;
		padding: 0.75rem 0.9rem;
		font-size: 0.92rem;
		width: 100%;
		box-sizing: border-box;
	}

	.note-input:focus {
		outline: none;
		border-color: #0284c7;
	}

	.note-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.note-chip {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		color: #475569;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		cursor: pointer;
	}

	.note-chip.active {
		background: #0284c7;
		color: white;
		border-color: #0284c7;
	}

	.submit-btn {
		width: 100%;
		border: none;
		border-radius: 0.75rem;
		padding: 1rem;
		font-size: 1.05rem;
		font-weight: 800;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 52px;
	}

	.submit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-submit {
		background: #ea580c;
		color: white;
	}

	.btn-submit:hover:not(:disabled) {
		background: #c2410c;
	}

	.btn-match {
		background: #059669;
		color: white;
	}

	.btn-match:hover:not(:disabled) {
		background: #047857;
	}

	.legal-hint {
		font-size: 0.72rem;
		color: #94a3b8;
		text-align: center;
		margin: 0;
		line-height: 1.4;
	}

	/* --- Feedback Hasil Selesai --- */
	.done-card {
		background: white;
		border: 1.5px solid #e2e8f0;
		border-radius: 1rem;
		padding: 2rem 1.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.75rem;
	}

	.done-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.done-icon.icon-green {
		background: #ecfdf5;
		color: #059669;
	}

	.done-icon.icon-amber {
		background: #fffbeb;
		color: #d97706;
	}

	.done-title {
		font-size: 1.25rem;
		font-weight: 800;
		color: #0f172a;
		margin: 0;
	}

	.done-sub {
		font-size: 0.9rem;
		color: #475569;
		line-height: 1.5;
		margin: 0;
		max-width: 480px;
	}

	.ref-pill {
		font-size: 0.8rem;
		background: #f1f5f9;
		color: #475569;
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		border: 1px solid #cbd5e1;
	}

	.done-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		max-width: 360px;
		margin-top: 1rem;
	}

	.btn-primary {
		background: #0284c7;
		color: white;
		border: none;
		border-radius: 0.75rem;
		padding: 0.85rem;
		font-size: 0.95rem;
		font-weight: 800;
		cursor: pointer;
	}

	.btn-secondary {
		background: #f1f5f9;
		color: #334155;
		border: 1px solid #cbd5e1;
		border-radius: 0.75rem;
		padding: 0.85rem;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
	}

	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>

