<!-- src/routes/kiosk/fg-terima/+page.svelte -->
<!-- Fase 5b, rencana Kiosk Fase 5 (docs/(eh) rencana-kiosk-menu-lain-fase5, repo erp-epi-1)
  "opsi notifikasi". Checker gudang kirim REQUEST (rak saran + foto + catatan) -- BUKAN
  menyelesaikan serah-terima beneran. Admin tetap wajib memproses "Receive Finished Goods"
  di dashboard; kiosk ini murni mempercepat pemberitahuan+saran ke admin. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import {
		IconArrowLeft,
		IconLoader2,
		IconCheck,
		IconCamera,
		IconAlertTriangle,
		IconSearch,
		IconX,
		IconRefresh,
		IconBarcode,
		IconTrash,
		IconPackage
	} from '@tabler/icons-svelte';
	import { prepareKioskPhoto } from '$lib/kiosk/kioskPhoto';

	let step = $state<'pilih-spk' | 'form' | 'sukses'>('pilih-spk');
	let activeTab = $state<'ready' | 'transit'>('ready');
	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let searchQuery = $state('');

	let spkList = $state<any[]>([]);
	let selectedSpk = $state<any | null>(null);
	// File 09 §A.3 — rak dari master gudang (bukan RAK_CHIPS hardcode). "Lainnya" (teks bebas)
	// tetap tersedia untuk rak yang belum ada di master / operator belum memilih terminal.
	const LS_TERMINAL_KEY = 'kiosk_gudang_terminal_id';
	let rakOptions = $state<{ id: number; nama: string; kode: string | null }[]>([]);
	let rakSaranId = $state<number | null>(null);
	let rakSaran = $state('');
	let qtyDiterima = $state<string>('');
	let qtySelisihAlasan = $state('');
	let catatan = $state('');
	let fotoFile = $state<File | null>(null);
	let fotoPreviewUrl = $state<string | null>(null);
	let fotoProcessing = $state(false);
	let clientTxnId = '';

	let successTimer: ReturnType<typeof setTimeout> | null = null;

	const NOTE_CHIPS = [
		'Kondisi baik & lengkap',
		'Kemasan rapi di pallet',
		'Kemasan sedikit penyok',
		'Label sedikit pudar',
		'Perlu cek QC ulang'
	];

	/** Bug 6 — tampilan angka kg. Bulatkan 2 desimal, buang trailing zero, aman terhadap null.
	 *  `spk.actual_quantity_produced` datang dari Directus sebagai string/number float mentah. */
	function fmtKg(n: unknown): string {
		const v = Number(n);
		if (!Number.isFinite(v)) return '0';
		return String(Math.round(v * 100) / 100);
	}

	let filteredSpkList = $derived(
		spkList.filter((spk) => {
			if (!searchQuery.trim()) return true;
			const q = searchQuery.toLowerCase().trim();
			const no = (spk.nomor || '').toLowerCase();
			const batch = (spk.batch_no || '').toLowerCase();
			const prod = (spk.product_id?.nama_barang_lengkap || '').toLowerCase();
			return no.includes(q) || batch.includes(q) || prod.includes(q);
		})
	);

	async function loadSpkList() {
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/kiosk/fg-request?tab=${activeTab}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal memuat daftar SPK.');
			spkList = data.spkList || [];
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal memuat daftar SPK.';
		} finally {
			loading = false;
		}
	}

	function switchTab(t: 'ready' | 'transit') {
		if (activeTab === t) return;
		activeTab = t;
		searchQuery = '';
		loadSpkList();
	}

	async function loadRakOptions() {
		try {
			const terminalId = Number(localStorage.getItem(LS_TERMINAL_KEY));
			if (!Number.isFinite(terminalId) || terminalId <= 0) return;
			const res = await fetch(`/api/kiosk/fg-request?rak=1&gudang_id=${terminalId}`);
			const data = await res.json().catch(() => null);
			rakOptions = data?.rak || [];
		} catch {
			/* non-fatal — teks bebas ("Lainnya") tetap bisa dipakai */
		}
	}

	function pilihSpk(spk: any) {
		if (spk.hasPendingRequest) return;
		selectedSpk = spk;
		rakSaran = '';
		rakSaranId = null;
		qtyDiterima = String(selectedSpk?.actual_quantity_produced ?? '');
		qtySelisihAlasan = '';
		catatan = '';
		if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
		fotoFile = null;
		fotoPreviewUrl = null;
		errorMsg = '';
		clientTxnId = crypto.randomUUID();
		step = 'form';
		if (rakOptions.length === 0) loadRakOptions();
	}

	let qtyBeda = $derived(
		qtyDiterima !== '' && Math.abs(Number(qtyDiterima) - (Number(selectedSpk?.actual_quantity_produced) || 0)) > 0.0001
	);

	async function onFotoChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		fotoProcessing = true;
		try {
			const small = await prepareKioskPhoto(file);
			if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
			fotoFile = small;
			fotoPreviewUrl = URL.createObjectURL(small);
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Foto gagal diproses.';
		} finally {
			fotoProcessing = false;
		}
	}

	function removeFoto() {
		if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
		fotoFile = null;
		fotoPreviewUrl = null;
	}

	function pilihRak(r: { id: number; nama: string }) {
		rakSaranId = r.id;
		rakSaran = r.nama;
	}

	function appendNoteChip(chip: string) {
		if (!catatan.trim()) {
			catatan = chip;
		} else if (!catatan.includes(chip)) {
			catatan = `${catatan.trim()}, ${chip}`;
		}
	}

	async function submitRequest() {
		if (!selectedSpk) return;
		if (!fotoFile) {
			errorMsg = 'Foto bukti fisik barang diterima wajib diunggah.';
			return;
		}
		// File 09 §A.3 — tombol kirim TIDAK dimatikan (Aturan #6); validasi saat ditekan dengan
		// pesan dekat tombol, konsisten dengan pola file 04.
		if (qtyBeda && !qtySelisihAlasan.trim()) {
			errorMsg = 'Jumlah diterima berbeda dari hasil produksi — tulis alasannya dulu.';
			return;
		}
		submitting = true;
		errorMsg = '';
		try {
			const form = new FormData();
			form.append('spkId', String(selectedSpk.id));
			if (rakSaran.trim()) form.append('rakSaran', rakSaran.trim());
			if (rakSaranId) form.append('rakSaranId', String(rakSaranId));
			if (qtyDiterima !== '') form.append('qtyDiterima', qtyDiterima);
			if (qtyBeda && qtySelisihAlasan.trim()) form.append('qtySelisihAlasan', qtySelisihAlasan.trim());
			if (catatan.trim()) form.append('catatan', catatan.trim());
			form.append('foto', fotoFile);
			form.append('clientTxnId', clientTxnId);
			form.append('isPhysicalReport', activeTab === 'transit' ? 'true' : 'false');

			const res = await fetch('/api/kiosk/fg-request', { method: 'POST', body: form });
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal mengirim request.');

			step = 'sukses';
			successTimer = setTimeout(() => {
				goto('/kiosk/home');
			}, 4000);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal mengirim request.';
		} finally {
			submitting = false;
		}
	}

	function resetToPilihSpk() {
		if (successTimer) clearTimeout(successTimer);
		if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
		fotoFile = null;
		fotoPreviewUrl = null;
		selectedSpk = null;
		step = 'pilih-spk';
		loadSpkList();
	}

	// Scanner fisik (event global dari +layout.svelte) — SATU jalur, bukan listener keydown
	// lokal (dua listener untuk satu scanner rawan bentrok, lihat file 02).
	function onHardwareScan(e: Event) {
		if (step !== 'pilih-spk') return;
		const { code, parsed } = (e as CustomEvent).detail || {};
		if (!code) return;
		const scanned = String(code).trim();
		if (!scanned) return;
		e.preventDefault();

		const target =
			parsed?.type === 'SPK'
				? spkList.find((s) => String(s.id) === String(parsed.id))
				: spkList.find(
						(s) =>
							s.nomor?.toLowerCase() === scanned.toLowerCase() ||
							s.batch_no?.toLowerCase() === scanned.toLowerCase() ||
							scanned.includes(s.nomor)
					);
		if (target && !target.hasPendingRequest) {
			pilihSpk(target);
		} else {
			searchQuery = scanned;
		}
	}

	onMount(() => {
		loadSpkList();
		window.addEventListener('kiosk-hardware-scan', onHardwareScan);
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('kiosk-hardware-scan', onHardwareScan);
		}
		if (successTimer) clearTimeout(successTimer);
		if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
	});
</script>

{#if step === 'sukses'}
	<div class="success-overlay">
		<div class="success-card">
			<div class="success-icon-wrap" class:success-icon-wrap--transit={activeTab === 'transit'}>
				<IconCheck size={64} stroke={3} />
			</div>
			{#if activeTab === 'transit'}
				<h2 class="success-title">LAPORAN FISIK BERHASIL DIKIRIM</h2>
				<div class="success-spk-badge">
					<strong>{selectedSpk?.nomor}</strong>
					{#if rakSaran}<span>Saran: {rakSaran}</span>{/if}
				</div>
				<p class="success-sub">
					Laporan fisik telah diteruskan otomatis via <strong>n8n & Alert In-App</strong> ke Tim Lab QC dan Formulator.
					Tim pabrik akan segera menuntaskan verifikasi SPK agar barang bisa resmi diterima di gudang.
				</p>
			{:else}
				<h2 class="success-title">REQUEST BERHASIL DIKIRIM</h2>
				<div class="success-spk-badge">
					<strong>{selectedSpk?.nomor}</strong>
					{#if rakSaran}<span>Saran: {rakSaran}</span>{/if}
				</div>
				<p class="success-sub">
					Pemberitahuan fisik barang diterima telah masuk ke antrean admin. Admin Inventory akan memproses "Receive Finished
					Goods" resmi di dashboard untuk memasukkan barang ke stok fisik.
				</p>
			{/if}
			<div class="success-actions">
				<button class="btn-success-sec" onclick={resetToPilihSpk}>
					{activeTab === 'transit' ? 'Lapor SPK Lain' : 'Terima SPK Lain'}
				</button>
				<button class="btn-success-pri" onclick={() => goto('/kiosk/home')}>Kembali ke Beranda</button>
			</div>
		</div>
	</div>
{:else}
	<div class="wrap">
		<!-- HEADER -->
		<div class="header">
			<button
				class="back"
				onclick={() => (step === 'pilih-spk' ? goto('/kiosk/home') : (step = 'pilih-spk'))}
				aria-label="Kembali"
			>
				<IconArrowLeft size={22} />
			</button>
			<div class="header-text">
				<h1>Terima Barang Jadi</h1>
				<span class="sub-hint">Penerimaan fisik barang jadi dari produksi ke gudang</span>
			</div>
			{#if step === 'pilih-spk'}
				<button class="btn-refresh" onclick={loadSpkList} disabled={loading} title="Segarkan daftar">
					<IconRefresh size={20} class={loading ? 'animate-spin' : ''} />
					<span class="refresh-text">Segarkan</span>
				</button>
			{/if}
		</div>

		<!-- ERROR BANNER -->
		{#if errorMsg}
			<div class="error-box">
				<div class="error-content">
					<IconAlertTriangle size={24} class="shrink-0" />
					<div class="error-text">
						<strong>Kendala Sistem:</strong>
						<p>{errorMsg}</p>
					</div>
				</div>
				<button class="retry-btn" onclick={loadSpkList}>
					<IconRefresh size={16} />
					Coba Lagi
				</button>
			</div>
		{/if}

		<!-- STEP 1: PILIH SPK -->
		{#if step === 'pilih-spk'}
			<!-- MODE SWITCHER TABS -->
			<div class="mode-tabs">
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'ready'}
					onclick={() => switchTab('ready')}
				>
					<IconPackage size={18} />
					<span>Siap Terima Gudang</span>
				</button>
				<button
					type="button"
					class="tab-btn tab-btn--transit"
					class:active={activeTab === 'transit'}
					onclick={() => switchTab('transit')}
				>
					<IconAlertTriangle size={18} />
					<span>📢 Lapor Fisik di Transit</span>
					<span class="tab-badge">Belum Ready</span>
				</button>
			</div>

			{#if activeTab === 'transit'}
				<div class="info-banner info-banner--transit">
					<IconAlertTriangle size={20} class="shrink-0" />
					<span>
						<strong>Mode Lapor Fisik Transit:</strong> Gunakan menu ini bila pallet cat fisiknya sudah ada di area transit pabrik, namun SPK belum berstatus <em>Ready for Warehouse</em> (karena QC atau formula belum selesai). Mengirim laporan foto akan otomatis memicu <strong>Alert n8n ke Tim QC & Formulator</strong>!
					</span>
				</div>
			{:else}
				<div class="info-banner">
					<IconPackage size={20} class="shrink-0" />
					<span>
						Pilih SPK yang barangnya sudah selesai diproduksi dan fisik barangnya tiba di gudang. Ini mengirim notifikasi ke
						admin untuk memproses penerimaan resmi di dashboard.
					</span>
				</div>
			{/if}

			<!-- SEARCH & COUNTER BAR -->
			<div class="toolbar">
				<div class="search-box">
					<IconSearch size={18} class="search-ic" />
					<input
						type="text"
						placeholder="Cari SPK, No. Batch, atau Nama Barang..."
						bind:value={searchQuery}
					/>
					{#if searchQuery}
						<button class="clear-ic" onclick={() => (searchQuery = '')} aria-label="Hapus filter">
							<IconX size={16} />
						</button>
					{/if}
				</div>
				<div class="count-badge">
					<strong>{filteredSpkList.length}</strong> {activeTab === 'transit' ? 'SPK Transit' : 'SPK Siap'}
				</div>
			</div>

			{#if loading}
				<div class="py-12 flex justify-center">
					<CircularProgressGauge size={72} strokeWidth={6} label={activeTab === 'transit' ? 'Memuat SPK Transit...' : 'Memuat SPK Serah-Terima...'} sublabel="Sinkronisasi antrean Directus" />
				</div>
			{:else if spkList.length === 0 && !errorMsg}
				<div class="empty-state">
					<div class="empty-icon-wrap">
						<IconPackage size={48} stroke={1.5} />
					</div>
					{#if activeTab === 'transit'}
						<h3>Tidak Ada SPK Transit Menunggu</h3>
						<p>Tidak ada SPK aktif (requested/in-progress/qc_pending) yang memerlukan pelaporan fisik saat ini.</p>
					{:else}
						<h3>Belum Ada SPK Siap Diterima</h3>
						<p>Tidak ada SPK dengan status <em>Ready for Warehouse</em> saat ini. Jika fisik sudah tiba di gudang, gunakan tab <strong>Lapor Fisik di Transit</strong>.</p>
					{/if}
					<button class="btn-secondary" onclick={loadSpkList}>
						<IconRefresh size={18} />
						Periksa Ulang
					</button>
				</div>
			{:else if filteredSpkList.length === 0}
				<div class="empty-search">
					<p>Tidak ditemukan SPK yang sesuai dengan kata kunci "<strong>{searchQuery}</strong>".</p>
					<button class="btn-text" onclick={() => (searchQuery = '')}>Reset Pencarian</button>
				</div>
			{:else}
				<div class="spk-list">
					{#each filteredSpkList as spk}
						<button
							class="spk-card"
							class:pending={spk.hasPendingRequest}
							onclick={() => pilihSpk(spk)}
							disabled={spk.hasPendingRequest}
						>
							<div class="card-head">
								<div class="spk-title-wrap">
									<span class="spk-no">{spk.nomor}</span>
									{#if spk.batch_no}
										<span class="batch-pill">
											<IconBarcode size={13} />
											{spk.batch_no}
										</span>
									{/if}
								</div>
								{#if spk.hasPendingRequest}
									<span class="status-badge badge-pending">
										<span class="dot-pending"></span>
										Menunggu Verifikasi Admin
									</span>
								{:else if activeTab === 'transit'}
									<span class="status-badge badge-transit">
										<span class="dot-transit"></span>
										Status: {spk.status || 'Transit'}
									</span>
								{:else}
									<span class="status-badge badge-ready">
										<span class="dot-ready"></span>
										Siap Terima
									</span>
								{/if}
							</div>

							<div class="prod-name">
								{spk.product_id?.nama_barang_lengkap || '-'}
							</div>

							<div class="card-footer">
								<span class="qty-pill">
									{activeTab === 'transit' ? 'Estimasi/Target:' : 'Hasil Produksi:'} <strong>{fmtKg(spk.actual_quantity_produced)} {spk.unit}</strong>
								</span>
								{#if spk.hasPendingRequest}
									<span class="pending-hint">Sudah diajukan oleh checker lain</span>
								{:else}
									<span class="action-hint">Sentuh untuk proses →</span>
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}

		<!-- STEP 2: FORM INPUT -->
		{:else if step === 'form'}
			{#if activeTab === 'transit'}
				<div class="transit-form-alert">
					<IconAlertTriangle size={24} class="shrink-0 text-amber-600" />
					<div class="transit-alert-text">
						<strong>Mode Lapor Fisik Pallet di Transit</strong>
						<p>Foto pallet fisik cat dan pastikan label/kondisinya terlihat jelas. Notifikasi otomatis akan dikirim ke WhatsApp Lab QC & Formulator via n8n.</p>
					</div>
				</div>
			{/if}
			<!-- SELECTED SPK SUMMARY -->
			<div class="spk-summary-card">
				<div class="summary-top">
					<div>
						<span class="summary-label">Nomor SPK</span>
						<div class="summary-no">{selectedSpk?.nomor}</div>
					</div>
					{#if selectedSpk?.batch_no}
						<div class="text-right">
							<span class="summary-label">Nomor Batch</span>
							<div class="summary-batch">{selectedSpk?.batch_no}</div>
						</div>
					{/if}
				</div>
				<div class="summary-prod">{selectedSpk?.product_id?.nama_barang_lengkap || '-'}</div>
				<div class="summary-qty">
					Hasil produksi tercatat: <strong>{fmtKg(selectedSpk?.actual_quantity_produced)} {selectedSpk?.unit}</strong>
				</div>
			</div>

			<!-- FIELD 0: QTY DITERIMA (File 09 §A.3 — hitungan fisik checker, bukan angka produksi) -->
			<div class="form-section">
				<label class="section-label" for="input-qty">
					Jumlah yang Anda terima (hitung fisik)
					<span class="section-sub">Hitung jumlah yang benar-benar sampai di gudang. Kalau beda dengan hasil produksi, tulis alasannya.</span>
				</label>
				<div class="qty-row">
					<input id="input-qty" class="input-text" type="number" inputmode="decimal" step="any" min="0" bind:value={qtyDiterima} />
					<span class="qty-unit">{selectedSpk?.unit}</span>
					<button type="button" class="btn-samakan" onclick={() => (qtyDiterima = String(selectedSpk?.actual_quantity_produced ?? ''))}>
						Sama dengan hasil produksi
					</button>
				</div>
				{#if qtyBeda}
					<input
						class="input-text input-text--warn"
						type="text"
						placeholder="Kenapa berbeda? (mis. 2 pail penyok, tertinggal di lini)"
						bind:value={qtySelisihAlasan}
					/>
				{/if}
			</div>

			<!-- FIELD 1: SARAN RAK -->
			<div class="form-section">
				<label class="section-label" for="input-rak">
					Saran Lokasi Rak Gudang (Opsional)
					<span class="section-sub">Scan QR rak tempat barang ditaruh, atau sentuh nama raknya.</span>
				</label>

				{#if rakOptions.length > 0}
					<div class="chips-wrap">
						{#each rakOptions as r (r.id)}
							<button
								type="button"
								class="chip-btn"
								class:active={rakSaranId === r.id}
								onclick={() => pilihRak(r)}
							>
								{r.nama}{r.kode ? ` (${r.kode})` : ''}
							</button>
						{/each}
					</div>
				{/if}

				<input
					id="input-rak"
					class="input-text"
					type="text"
					placeholder={rakOptions.length > 0 ? 'Atau ketik manual (Lainnya)' : 'Pilih "Terminal ini di gudang" di Menu Gudang untuk daftar rak, atau ketik manual'}
					bind:value={rakSaran}
					oninput={() => (rakSaranId = null)}
				/>
			</div>

			<!-- FIELD 2: FOTO BUKTI -->
			<div class="form-section">
				<span class="section-label">
					Foto Bukti Fisik Barang <strong class="req">*Wajib</strong>
					<span class="section-sub">Foto palet / tumpukan barang yang baru tiba di gudang</span>
				</span>

				{#if fotoPreviewUrl}
					<div class="preview-wrap">
						<img src={fotoPreviewUrl} alt="Bukti barang diterima" class="foto-preview" />
						<div class="preview-actions">
							<label class="btn-retake">
								<IconCamera size={18} />
								Ganti Foto
								<input type="file" accept="image/*" capture="environment" class="hidden" onchange={onFotoChange} />
							</label>
							<button type="button" class="btn-remove-foto" onclick={removeFoto}>
								<IconTrash size={18} />
								Hapus
							</button>
						</div>
					</div>
				{:else}
					<label class="foto-btn">
						<div class="foto-btn-inner">
							<div class="cam-icon-box">
								<IconCamera size={32} />
							</div>
							<strong>Ambil Foto Bukti Fisik Barang</strong>
							<span>Sentuh untuk membuka kamera / unggah berkas</span>
						</div>
						<input type="file" accept="image/*" capture="environment" class="hidden" onchange={onFotoChange} />
					</label>
				{/if}
			</div>

			<!-- FIELD 3: CATATAN KONDISI -->
			<div class="form-section">
				<label class="section-label" for="notes-area">
					Catatan Kondisi Barang (Opsional)
					<span class="section-sub">Laporkan jika ada kemasan rusak, penyok, atau label tidak terbaca</span>
				</label>

				<!-- QUICK NOTE CHIPS -->
				<div class="chips-wrap">
					{#each NOTE_CHIPS as chip}
						<button type="button" class="chip-btn" onclick={() => appendNoteChip(chip)}>
							+ {chip}
						</button>
					{/each}
				</div>

				<textarea
					id="notes-area"
					class="notes-textarea"
					rows="3"
					placeholder="Tuliskan catatan tambahan kondisi barang bila ada..."
					bind:value={catatan}
				></textarea>
			</div>

			<!-- SUBMIT BUTTONS -->
			<div class="form-footer">
				<button class="btn-cancel" disabled={submitting} onclick={() => (step = 'pilih-spk')}>
					Kembali
				</button>
				<button class="btn-submit" disabled={submitting || fotoProcessing || !fotoFile} onclick={submitRequest}>
					{#if submitting}
						<IconLoader2 size={22} class="animate-spin" />
						<span>Mengirim ke Admin...</span>
					{:else}
						<IconCheck size={22} />
						<span>{activeTab === 'transit' ? 'KIRIM LAPORAN FISIK KE QC & FORMULATOR' : 'KIRIM NOTIFIKASI KE ADMIN'}</span>
					{/if}
				</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.wrap {
		padding: 1rem 1.25rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.15rem;
		width: 100%;
		max-width: 100%;
		box-sizing: border-box;
		min-height: 100%;
	}

	/* HEADER */
	.header {
		display: flex;
		align-items: center;
		gap: 0.85rem;
	}
	.back {
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		color: #1e293b;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}
	.back:hover {
		background: #e2e8f0;
	}
	.header-text {
		flex: 1;
		min-width: 0;
	}
	h1 {
		font-size: 1.35rem;
		font-weight: 800;
		margin: 0;
		color: #0f172a;
		line-height: 1.2;
	}
	.sub-hint {
		font-size: 0.82rem;
		color: #64748b;
		display: block;
		margin-top: 0.15rem;
	}
	.btn-refresh {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		background: #f8fafc;
		border: 1px solid #cbd5e1;
		padding: 0.55rem 0.85rem;
		border-radius: 0.65rem;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 600;
		color: #334155;
	}
	.btn-refresh:hover:not(:disabled) {
		background: #f1f5f9;
	}

	/* ERROR & NOTICES */
	.error-box {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #991b1b;
		padding: 0.85rem 1rem;
		border-radius: 0.75rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.error-content {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.error-text p {
		margin: 0.15rem 0 0;
		font-size: 0.85rem;
	}
	.retry-btn {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		background: #b91c1c;
		color: white;
		border: none;
		border-radius: 0.5rem;
		padding: 0.45rem 0.75rem;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}

	/* MODE SWITCHER TABS */
	.mode-tabs {
		display: flex;
		gap: 0.5rem;
		background: #f1f5f9;
		padding: 0.35rem;
		border-radius: 0.85rem;
		border: 1px solid #e2e8f0;
	}
	.tab-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-radius: 0.65rem;
		border: none;
		background: transparent;
		color: #64748b;
		font-weight: 700;
		font-size: 0.92rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.tab-btn:hover:not(.active) {
		background: #e2e8f0;
		color: #1e293b;
	}
	.tab-btn.active {
		background: white;
		color: #0f172a;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
	}
	.tab-btn--transit.active {
		background: #fffbeb;
		color: #b45309;
		border: 1px solid #fde68a;
	}
	.tab-badge {
		font-size: 0.72rem;
		padding: 0.15rem 0.45rem;
		border-radius: 1rem;
		background: #fee2e2;
		color: #dc2626;
		font-weight: 800;
	}

	.info-banner {
		background: #f0fdf4;
		border: 1px solid #bbf7d0;
		color: #166534;
		padding: 0.75rem 0.95rem;
		border-radius: 0.75rem;
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		font-size: 0.88rem;
		line-height: 1.35;
	}
	.info-banner--transit {
		background: #fffbeb;
		border-color: #fde68a;
		color: #92400e;
	}

	/* TOOLBAR & SEARCH */
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.search-box {
		flex: 1;
		position: relative;
		display: flex;
		align-items: center;
	}
	:global(.search-ic) {
		position: absolute;
		left: 0.85rem;
		color: #94a3b8;
		pointer-events: none;
	}
	.search-box input {
		width: 100%;
		padding: 0.75rem 2.25rem 0.75rem 2.5rem;
		font-size: 0.95rem;
		border: 1.5px solid #cbd5e1;
		border-radius: 0.75rem;
		background: white;
		color: #0f172a;
		box-sizing: border-box;
	}
	.search-box input:focus {
		outline: none;
		border-color: #ea580c;
		box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.12);
	}
	.clear-ic {
		position: absolute;
		right: 0.65rem;
		background: none;
		border: none;
		color: #94a3b8;
		cursor: pointer;
		padding: 0.35rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.count-badge {
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		padding: 0.65rem 0.85rem;
		border-radius: 0.75rem;
		font-size: 0.85rem;
		color: #475569;
		white-space: nowrap;
	}
	.count-badge strong {
		color: #0f172a;
		font-size: 0.95rem;
	}

	/* STATES */
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 1rem;
		gap: 0.85rem;
		color: #64748b;
	}
	.empty-state {
		background: #f8fafc;
		border: 2px dashed #cbd5e1;
		border-radius: 1rem;
		padding: 2.5rem 1.5rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.65rem;
	}
	.empty-icon-wrap {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		background: #f1f5f9;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #94a3b8;
		margin-bottom: 0.35rem;
	}
	.empty-state h3 {
		font-size: 1.15rem;
		font-weight: 800;
		color: #1e293b;
		margin: 0;
	}
	.empty-state p {
		color: #64748b;
		font-size: 0.9rem;
		max-width: 420px;
		margin: 0 0 0.5rem;
		line-height: 1.4;
	}
	.empty-search {
		background: #f8fafc;
		border-radius: 0.75rem;
		padding: 1.5rem;
		text-align: center;
		color: #64748b;
		font-size: 0.92rem;
	}
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		background: white;
		border: 1.5px solid #cbd5e1;
		padding: 0.65rem 1.15rem;
		border-radius: 0.65rem;
		font-weight: 700;
		font-size: 0.9rem;
		color: #1e293b;
		cursor: pointer;
	}
	.btn-text {
		background: none;
		border: none;
		color: #ea580c;
		font-weight: 700;
		cursor: pointer;
		margin-top: 0.5rem;
	}

	/* SPK CARDS */
	.spk-list {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.spk-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1.15rem 1.35rem;
		border-radius: 0.9rem;
		border: 1.5px solid #e2e8f0;
		background: white;
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
	}
	.spk-card:hover:not(:disabled) {
		border-color: #ea580c;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(234, 88, 12, 0.08);
	}
	.spk-card.pending {
		background: #f8fafc;
		opacity: 0.75;
		cursor: not-allowed;
		border-style: dashed;
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.spk-title-wrap {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.spk-no {
		font-size: 1.15rem;
		font-weight: 800;
		color: #0f172a;
	}
	.batch-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: #f1f5f9;
		color: #475569;
		padding: 0.2rem 0.5rem;
		border-radius: 0.35rem;
		font-size: 0.78rem;
		font-weight: 600;
	}
	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.65rem;
		border-radius: 2rem;
		font-size: 0.78rem;
		font-weight: 700;
	}
	.badge-ready {
		background: #dcfce7;
		color: #15803d;
	}
	.dot-ready {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #16a34a;
	}
	.badge-pending {
		background: #fef3c7;
		color: #b45309;
	}
	.dot-pending {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #d97706;
	}
	.badge-transit {
		background: #fffbeb;
		color: #b45309;
		border: 1px solid #fde68a;
	}
	.dot-transit {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #f59e0b;
	}

	.transit-form-alert {
		background: #fffbeb;
		border: 1.5px solid #fde68a;
		border-radius: 0.85rem;
		padding: 0.85rem 1.15rem;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		color: #92400e;
		margin-bottom: 0.25rem;
	}
	.transit-alert-text strong {
		display: block;
		font-size: 0.95rem;
		font-weight: 800;
		color: #b45309;
	}
	.transit-alert-text p {
		margin: 0.2rem 0 0;
		font-size: 0.84rem;
		color: #78350f;
		line-height: 1.35;
	}

	.success-icon-wrap--transit {
		background: #fef3c7 !important;
		color: #d97706 !important;
	}

	.prod-name {
		font-size: 1rem;
		font-weight: 600;
		color: #334155;
		line-height: 1.35;
	}
	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.25rem;
		padding-top: 0.5rem;
		border-top: 1px solid #f1f5f9;
	}
	.qty-pill {
		font-size: 0.85rem;
		color: #64748b;
	}
	.qty-pill strong {
		color: #ea580c;
		font-size: 0.95rem;
	}
	.action-hint {
		font-size: 0.82rem;
		font-weight: 700;
		color: #ea580c;
	}
	.pending-hint {
		font-size: 0.8rem;
		color: #94a3b8;
		font-style: italic;
	}

	/* FORM STEP */
	.spk-summary-card {
		background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
		color: white;
		border-radius: 1rem;
		padding: 1.25rem 1.35rem;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
	}
	.summary-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}
	.summary-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
		display: block;
		margin-bottom: 0.15rem;
	}
	.summary-no {
		font-size: 1.35rem;
		font-weight: 900;
		color: #f8fafc;
	}
	.summary-batch {
		font-size: 0.95rem;
		font-weight: 700;
		color: #cbd5e1;
	}
	.summary-prod {
		font-size: 1.05rem;
		font-weight: 600;
		color: #e2e8f0;
	}
	.summary-qty {
		font-size: 0.88rem;
		color: #cbd5e1;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}
	.summary-qty strong {
		color: #fb923c;
		font-size: 1.05rem;
	}

	.form-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: white;
		padding: 1.15rem 1.25rem;
		border-radius: 0.9rem;
		border: 1px solid #e2e8f0;
	}
	.section-label {
		font-size: 0.95rem;
		font-weight: 800;
		color: #0f172a;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.section-sub {
		font-size: 0.8rem;
		font-weight: 400;
		color: #64748b;
	}
	.req {
		color: #dc2626;
		font-size: 0.8rem;
		margin-left: 0.25rem;
	}

	.chips-wrap {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.25rem 0;
	}
	.chip-btn {
		background: #f8fafc;
		border: 1px solid #cbd5e1;
		border-radius: 2rem;
		padding: 0.4rem 0.85rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: #334155;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.chip-btn:hover {
		background: #f1f5f9;
		border-color: #94a3b8;
	}
	.chip-btn.active {
		background: #ffedd5;
		border-color: #ea580c;
		color: #c2410c;
	}

	.input-text {
		padding: 0.75rem 0.95rem;
		font-size: 0.95rem;
		border: 1.5px solid #cbd5e1;
		border-radius: 0.65rem;
		width: 100%;
		box-sizing: border-box;
	}
	.input-text:focus {
		outline: none;
		border-color: #ea580c;
	}
	.input-text--warn { border-color: #f59e0b; background: #fffbeb; margin-top: 0.5rem; }
	.qty-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
	.qty-row .input-text { width: auto; flex: 1; min-width: 100px; }
	.qty-unit { color: #64748b; font-weight: 700; }
	.btn-samakan {
		background: #f1f5f9; border: 1.5px solid #cbd5e1; color: #334155;
		font-weight: 700; font-size: 0.82rem; padding: 0.5rem 0.75rem;
		border-radius: 0.5rem; cursor: pointer; min-height: 44px;
	}

	.foto-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 1.75rem 1rem;
		border: 2px dashed #cbd5e1;
		border-radius: 0.85rem;
		background: #fafafa;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.foto-btn:hover {
		border-color: #ea580c;
		background: #fff7ed;
	}
	.foto-btn-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		text-align: center;
	}
	.cam-icon-box {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: #ffedd5;
		color: #ea580c;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 0.25rem;
	}
	.foto-btn-inner strong {
		color: #1e293b;
		font-size: 0.98rem;
	}
	.foto-btn-inner span {
		color: #64748b;
		font-size: 0.82rem;
	}

	.preview-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.foto-preview {
		width: 100%;
		max-height: 240px;
		object-fit: cover;
		border-radius: 0.75rem;
		border: 1.5px solid #e2e8f0;
	}
	.preview-actions {
		display: flex;
		gap: 0.65rem;
	}
	.btn-retake {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		background: #f1f5f9;
		border: 1px solid #cbd5e1;
		padding: 0.6rem;
		border-radius: 0.6rem;
		font-weight: 700;
		font-size: 0.85rem;
		color: #1e293b;
		cursor: pointer;
	}
	.btn-remove-foto {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #b91c1c;
		padding: 0.6rem 0.95rem;
		border-radius: 0.6rem;
		font-weight: 700;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.notes-textarea {
		padding: 0.75rem;
		font-size: 0.92rem;
		border: 1.5px solid #cbd5e1;
		border-radius: 0.65rem;
		resize: vertical;
		font-family: inherit;
		box-sizing: border-box;
		width: 100%;
	}
	.notes-textarea:focus {
		outline: none;
		border-color: #ea580c;
	}

	.form-footer {
		display: flex;
		gap: 0.85rem;
		margin-top: 0.5rem;
	}
	.btn-cancel {
		flex: 1;
		min-height: 56px;
		background: #f1f5f9;
		border: 1.5px solid #cbd5e1;
		color: #334155;
		font-weight: 800;
		font-size: 1rem;
		border-radius: 0.85rem;
		cursor: pointer;
	}
	.btn-submit {
		flex: 2;
		min-height: 56px;
		background: #ea580c;
		color: white;
		border: none;
		border-radius: 0.85rem;
		font-weight: 800;
		font-size: 1.05rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		box-shadow: 0 4px 14px rgba(234, 88, 12, 0.25);
		transition: all 0.15s ease;
	}
	.btn-submit:hover:not(:disabled) {
		background: #c2410c;
	}
	.btn-submit:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		box-shadow: none;
	}

	/* SUCCESS OVERLAY */
	.success-overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.85);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 60;
		padding: 1.5rem;
	}
	.success-card {
		background: white;
		border-radius: 1.25rem;
		padding: 2.25rem 1.75rem;
		max-width: 440px;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 1rem;
		box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
	}
	.success-icon-wrap {
		width: 90px;
		height: 90px;
		border-radius: 50%;
		background: #dcfce7;
		color: #16a34a;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.success-title {
		font-size: 1.45rem;
		font-weight: 900;
		color: #0f172a;
		margin: 0;
	}
	.success-spk-badge {
		background: #f1f5f9;
		padding: 0.5rem 1rem;
		border-radius: 2rem;
		display: flex;
		gap: 0.5rem;
		font-size: 0.95rem;
	}
	.success-spk-badge strong {
		color: #0f172a;
	}
	.success-spk-badge span {
		color: #ea580c;
		font-weight: 700;
	}
	.success-sub {
		color: #475569;
		font-size: 0.92rem;
		line-height: 1.45;
		margin: 0;
	}
	.success-actions {
		display: flex;
		gap: 0.75rem;
		width: 100%;
		margin-top: 0.5rem;
	}
	.btn-success-sec {
		flex: 1;
		padding: 0.85rem;
		background: #f1f5f9;
		border: 1.5px solid #cbd5e1;
		color: #1e293b;
		border-radius: 0.75rem;
		font-weight: 800;
		font-size: 0.95rem;
		cursor: pointer;
	}
	.btn-success-pri {
		flex: 1;
		padding: 0.85rem;
		background: #16a34a;
		border: none;
		color: white;
		border-radius: 0.75rem;
		font-weight: 800;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.hidden {
		display: none;
	}
</style>
