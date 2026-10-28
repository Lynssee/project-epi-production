<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getItemsForPicker, submitHasilProduksi, uploadEvidencePhoto, fetchGudangList, type StockItemOption, type GudangOption } from '$lib/services/stockLapangan';
	import RakPicker from '$lib/components/shared/RakPicker.svelte';
	import { getCurrentPosition, type DevicePosition } from '$lib/utils/geoClient';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { enqueueStockSubmission, registerStockAutoFlush, flushStockQueue } from '$lib/utils/offlineStockQueue';
	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconPackageExport, IconQrcode } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { vibrateTap } from '$lib/utils/haptic';
	import { stockOutputSchema } from '$lib/schemas/stockOutput';

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_stock_lapangan', roles)) {
			goto('/');
		}
	});

	let loading = $state(true);
	let submitting = $state(false);
	let items = $state<StockItemOption[]>([]);
	let search = $state('');
	let selectedItemId = $state<number | null>(null);
	let quantity = $state<number | null>(null);
	let notes = $state('');
	let errorMsg = $state('');
	let successInfo = $state<{ referenceNo: string } | null>(null);
	let scanMethod = $state<'qr_item' | 'manual_search'>('manual_search');
	let showScanner = $state(false);
	let showBatchScanner = $state(false);
	let itemBatchId = $state<number | null>(null);

	let gps = $state<DevicePosition | null>(null);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}
	let gpsError = $state('');
	let photoFile = $state<File | null>(null);

	// F0 (Rencana Implementasi Inventory v2.0): lokasi gudang hasil produksi
	let gudangList = $state<GudangOption[]>([]);
	let gudangId = $state<number | null>(null);
	// Fase 5 (opsional): rak/zona spesifik -- null = perilaku lama (level gudang)
	let rakId = $state<number | null>(null);

	// Penyelamatan draf (rencana v2, Fase 3, 3.2 prioritas 5): entri item+qty+batch+foto
	// menyakitkan bila harus diulang gara-gara tab ter-refresh.
	interface OutputDraft {
		selectedItemId: number | null; quantity: number | null; notes: string;
		scanMethod: 'qr_item' | 'manual_search'; itemBatchId: number | null;
	}
	const outputPersist = createFormPersist<OutputDraft>('stock_output');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);
	const OUTPUT_PHOTO_KEY = 'bukti';

	function outputSnapshot(): OutputDraft {
		return { selectedItemId, quantity, notes, scanMethod, itemBatchId };
	}

	async function requestGps() {
		gpsError = '';
		try {
			gps = await getCurrentPosition();
		} catch (e: any) {
			gpsError = e?.message || 'Gagal mengambil lokasi. Wajib aktifkan izin lokasi.';
		}
	}

	onMount(async () => {
		items = await getItemsForPicker();
		loading = false;
		requestGps();

		gudangList = await fetchGudangList();
		if (!gudangId && gudangList.length > 0) {
			// Hasil produksi default ke gudang_produksi (finished goods) bila ada
			const fg = gudangList.find((g) => g.jenis === 'gudang_produksi');
			gudangId = (fg || gudangList[0]).id;
		}

		const draft = outputPersist.restore();
		if (draft && draft.selectedItemId && items.some((i) => i.id === draft.selectedItemId)) {
			selectedItemId = draft.selectedItemId;
			quantity = draft.quantity;
			notes = draft.notes;
			scanMethod = draft.scanMethod;
			itemBatchId = draft.itemBatchId;
			const blob = await outputPersist.restorePhoto(OUTPUT_PHOTO_KEY);
			if (blob) photoFile = new File([blob], 'bukti.jpg', { type: blob.type || 'image/jpeg' });
			draftSavedAt = new Date();
		}
		draftArmed = true;

		const sendFn = async (entry: any) => {
			let evidencePhotoFileId: string | null = null;
			if (entry.photoBlob) {
				const file = new File([entry.photoBlob], entry.photoName || 'bukti.jpg', { type: entry.photoBlob.type });
				evidencePhotoFileId = await uploadEvidencePhoto(file, 'stock_lapangan:output');
			}
			await submitHasilProduksi({ ...(entry.payload as any), evidencePhotoFileId });
		};
		registerStockAutoFlush(sendFn);
		flushStockQueue(sendFn).catch(() => {});
	});

	$effect(() => {
		void outputSnapshot();
		if (!draftArmed) return;
		outputPersist.save(outputSnapshot());
		draftSavedAt = new Date();
	});

	onMount(() => registerFormPersistSaveTriggers(outputPersist, () => outputSnapshot()));

	let filteredItems = $derived(
		search.trim()
			? items.filter((i) => i.nama_barang_lengkap.toLowerCase().includes(search.trim().toLowerCase()))
			: items
	);

	let canSubmit = $derived(
		!!selectedItemId && !!quantity && quantity > 0 && !!photoFile && !!gps && !gpsError
	);

	function onScanDetect(value: string) {
		showScanner = false;
		const parsed = parseEpiQr(value);
		if (!parsed || parsed.type !== 'ITEM') {
			errorMsg = 'QR tidak dikenali sebagai barang. Gunakan pencarian manual.';
			return;
		}
		const found = items.find((i) => i.id === parsed.id);
		if (!found) {
			errorMsg = 'Barang hasil scan tidak ditemukan di daftar.';
			return;
		}
		selectedItemId = found.id;
		scanMethod = 'qr_item';
		errorMsg = '';
	}

	function onBatchScanDetect(value: string) {
		showBatchScanner = false;
		const parsed = parseEpiQr(value);
		if (!parsed || parsed.type !== 'BATCH') {
			errorMsg = 'QR tidak dikenali sebagai batch/lot.';
			return;
		}
		itemBatchId = parsed.id;
		errorMsg = '';
	}

	function onPhotoChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		photoFile = file || null;
		if (file) outputPersist.savePhoto(OUTPUT_PHOTO_KEY, file);
	}

	async function handleSubmit() {
		if (!canSubmit || submitting) return;
		vibrateTap();
		submitting = true;
		errorMsg = '';
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama karyawan tidak ditemukan di sesi login.');

			const capturedAt = new Date().toISOString();
			const parsed = stockOutputSchema.safeParse({
				itemId: selectedItemId,
				quantity,
				notes,
				karyawanName,
				lat: gps?.lat ?? null,
				lng: gps?.lng ?? null,
				accuracy: gps?.accuracy ?? null,
				capturedAt,
				scanMethod,
				itemBatchId,
				gudangId: rakId || gudangId
			});
			if (!parsed.success) {
				errorMsg = parsed.error.issues[0]?.message || 'Data hasil produksi tidak valid.';
				submitting = false;
				return;
			}
			const basePayload = parsed.data;
			const compressed = await compressPhoto(photoFile as File);

			try {
				const evidencePhotoFileId = await uploadEvidencePhoto(compressed, 'stock_lapangan:output');
				const result = await submitHasilProduksi({ ...basePayload, evidencePhotoFileId });
				successInfo = { referenceNo: result.reference_no };
			} catch (err: any) {
				if (err instanceof TypeError) {
					await enqueueStockSubmission({
						client_txn_id: crypto.randomUUID(),
						type: 'output',
						payload: basePayload,
						photoBlob: compressed,
						photoName: compressed.name,
						createdAt: new Date().toISOString()
					});
					successInfo = { referenceNo: 'Tersimpan offline, akan terkirim otomatis' };
				} else {
					throw err;
				}
			}
			outputPersist.clear();
			await outputPersist.clearPhotos();
			draftSavedAt = null;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mencatat hasil produksi.';
		} finally {
			submitting = false;
		}
	}

	function resetForm() {
		selectedItemId = null;
		quantity = null;
		notes = '';
		search = '';
		successInfo = null;
		photoFile = null;
		itemBatchId = null;
		scanMethod = 'manual_search';
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/stock-lapangan')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if showScanner && QrScannerModal}
		<QrScannerModal expectedPrefix="EPI:" onDetect={onScanDetect} onClose={() => (showScanner = false)} />
	{/if}
	{#if showBatchScanner && QrScannerModal}
		<QrScannerModal expectedPrefix="EPI:BATCH:" onDetect={onBatchScanDetect} onClose={() => (showBatchScanner = false)} />
	{/if}

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data output barang..." />
		</div>
	{:else if successInfo}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Hasil produksi tersimpan</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Ref: {successInfo.referenceNo}</p>
			<div class="flex gap-2 justify-center mt-5">
				<button class="px-4 py-2 rounded-lg text-[12px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={resetForm}>
					Input Lagi
				</button>
				<button class="px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/stock-lapangan')}>
					Kembali ke Hub
				</button>
			</div>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold flex items-center gap-2" style="color: var(--sys-label)">
			<IconPackageExport size={18} /> Hasil Produksi
		</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Finish good selesai produksi</p>

		<button
			class="w-full h-11 mb-3 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2"
			style="background: var(--g)"
			onclick={async () => { await loadQrScannerModal(); showScanner = true; }}
		>
			<IconQrcode size={17} /> Scan QR Barang
		</button>

		<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Cari Barang (manual)</label>
		<input
			class="w-full mt-1 mb-2 rounded-lg border text-[13px] p-2.5"
			style="border-color: var(--sys-sep)"
			placeholder="Ketik nama barang..."
			bind:value={search}
			oninput={() => (scanMethod = 'manual_search')}
		/>

		<div class="rounded-xl border max-h-64 overflow-y-auto mb-4" style="border-color: var(--sys-sep)">
			{#if filteredItems.length === 0}
				<p class="p-4 text-[12px] text-center" style="color: var(--sys-label3)">Barang tidak ditemukan.</p>
			{:else}
				{#each filteredItems as item (item.id)}
					<button
						class="w-full text-left p-3 border-b last:border-b-0 flex items-center justify-between transition-colors"
						style="border-color: var(--sys-sep); background: {selectedItemId === item.id ? 'var(--gl)' : 'white'}"
						onclick={() => {
							selectedItemId = item.id;
							scanMethod = 'manual_search';
						}}
					>
						<div>
							<p class="text-[12.5px] font-medium" style="color: var(--sys-label)">
								{item.nama_barang_lengkap}
								{#if item.kode_item}<span class="font-mono font-bold" style="color: var(--g)">{item.kode_item}</span>{/if}
							</p>
							<p class="text-[10.5px]" style="color: var(--sys-label3)">Stok sistem: {parseFloat(item.stok_tersedia) || 0} {item.satuan}</p>
						</div>
						{#if selectedItemId === item.id}
							<IconCircleCheck size={16} style="color: var(--g)" />
						{/if}
					</button>
				{/each}
			{/if}
		</div>

		{#if selectedItemId}
			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Jumlah Hasil Produksi</label>
			<input
				type="number"
				min="0"
				step="any"
				class="w-full mt-1 mb-3 rounded-lg border text-[13px] p-2.5"
				style="border-color: var(--sys-sep)"
				placeholder="0"
				bind:value={quantity}
			/>

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Gudang</label>
			<select
				class="w-full mt-1 mb-3 rounded-lg border text-[13px] p-2.5"
				style="border-color: var(--sys-sep)"
				bind:value={gudangId}
			>
				<option value={null}>Pilih gudang</option>
				{#each gudangList as g}
					<option value={g.id}>{g.nama_gudang}</option>
				{/each}
			</select>
			<div class="mb-3">
				<RakPicker {gudangId} bind:value={rakId} compact={true} />
			</div>

			<button
				class="w-full h-10 mb-3 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-2"
				style="background: var(--sys-fill); color: var(--sys-label)"
				onclick={async () => { await loadQrScannerModal(); showBatchScanner = true; }}
			>
				<IconQrcode size={15} /> {itemBatchId ? `Batch #${itemBatchId} terpilih` : 'Scan QR Batch (opsional)'}
			</button>

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Foto Bukti (wajib)</label>
			<input
				type="file"
				accept="image/*"
				capture="environment"
				class="w-full mt-1 mb-3 text-[12px]"
				onchange={onPhotoChange}
			/>

			<p class="text-[10.5px] mb-3" style="color: {gpsError ? '#DC2626' : 'var(--sys-label3)'}">
				{#if gpsError}
					⚠ {gpsError} <button class="underline" onclick={requestGps}>Coba lagi</button>
				{:else if gps}
					📍 Lokasi terekam (akurasi ~{Math.round(gps.accuracy)}m)
				{:else}
					Mengambil lokasi...
				{/if}
			</p>
			{#if gps}
				<button
					type="button"
					class="text-[10.5px] font-semibold flex items-center gap-1 -mt-2 mb-3"
					style="color: var(--sys-tint, #1F6592)"
					onclick={toggleLocationMap}
				>
					📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
				</button>
				{#if showLocationMap && LocationMap}
					<div transition:slide={{ duration: 200 }} class="mb-3">
						<LocationMap lat={gps.lat} lng={gps.lng} label="Lokasi barang keluar" height="200px" />
					</div>
				{/if}
			{/if}

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Catatan (opsional)</label>
			<textarea
				class="w-full mt-1 rounded-lg border text-[12px] p-2.5"
				style="border-color: var(--sys-sep)"
				rows="2"
				bind:value={notes}
			></textarea>
		{/if}

		{#if errorMsg}
			<p class="text-[12px] mt-3" style="color: #DC2626">{errorMsg}</p>
		{/if}

		<div class="flex justify-center mt-3">
			<DraftIndicator savedAt={draftSavedAt} />
		</div>

		<button
			class="w-full h-12 mt-2 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
			style="background: var(--g)"
			disabled={!canSubmit || submitting}
			onclick={handleSubmit}
		>
			{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
			Simpan Hasil Produksi
		</button>
	{/if}
</div>
