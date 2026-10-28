<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getItemsForPicker, findItemByCode, submitOpname, uploadEvidencePhoto, fetchGudangList, type StockItemOption, type GudangOption } from '$lib/services/stockLapangan';
	import { submitOpnameGudangHq } from '$lib/services/gudangAntrian';
	import { loadInventorySettings, getInventorySetting } from '$lib/services/inventorySettings';
	import { getCurrentPosition, type DevicePosition } from '$lib/utils/geoClient';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { enqueueStockSubmission, registerStockAutoFlush, flushStockQueue } from '$lib/utils/offlineStockQueue';
	import RakPicker from '$lib/components/shared/RakPicker.svelte';
	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconClipboardCheck, IconCamera, IconQrcode } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { SectionGuide, FieldHint, HelpIcon } from '$lib/components/hints';
	// Impor modul hint langsung (bukan barrel) — lihat catatan bundling di getHint.ts.
	import { stockLapanganHints } from '$lib/data/hints/stockLapangan';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint modul Stock Lapangan; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(stockLapanganHints, key, 'stock-lapangan');
	import { vibrateTap } from '$lib/utils/haptic';
	import { stockOpnameSchema } from '$lib/schemas/stockOpname';

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
	let selectedItem = $state<StockItemOption | null>(null);
	let physicalCount = $state<number | null>(null);
	let notes = $state('');
	let photoFile = $state<File | null>(null);
	let errorMsg = $state('');
	let successInfo = $state<{ noChange: boolean; referenceNo?: string; menungguApproval?: boolean } | null>(null);
	let scanMethod = $state<'qr_item' | 'manual_search'>('manual_search');
	let showScanner = $state(false);

	// Fase 3 — Gudang Pusat Bojongkulur v2: mode "gudang_pusat" pakai gerbang toleransi
	// (submitOpnameGudangHq) alih-alih langsung ubah stok seperti mode umum.
	let gudangHqEnabled = $state(false);
	let mode = $state<'umum' | 'gudang_pusat'>('umum');

	let gps = $state<DevicePosition | null>(null);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}
	let gpsError = $state('');

	// F0 (Rencana Implementasi Inventory v2.0): lokasi gudang objek opname
	let gudangList = $state<GudangOption[]>([]);
	let gudangId = $state<number | null>(null);
	// Fase 5 (opsional): rak/zona spesifik -- null = perilaku lama (level gudang)
	let rakId = $state<number | null>(null);

	// Penyelamatan draf (rencana v2, Fase 3, 3.2 prioritas 5): entri item+hitungan fisik+foto
	// menyakitkan bila harus diulang gara-gara tab ter-refresh.
	interface OpnameDraft {
		selectedItemId: number | null; physicalCount: number | null; notes: string;
		scanMethod: 'qr_item' | 'manual_search';
	}
	const opnamePersist = createFormPersist<OpnameDraft>('stock_opname');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);
	const OPNAME_PHOTO_KEY = 'bukti';

	function opnameSnapshot(): OpnameDraft {
		return { selectedItemId: selectedItem?.id ?? null, physicalCount, notes, scanMethod };
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
			const utama = gudangList.find((g) => g.jenis === 'gudang_utama');
			gudangId = (utama || gudangList[0]).id;
		}

		await loadInventorySettings();
		gudangHqEnabled = getInventorySetting('inventory.gudang_hq.enabled');

		const draft = opnamePersist.restore();
		if (draft && draft.selectedItemId) {
			const found = items.find((i) => i.id === draft.selectedItemId);
			if (found) {
				selectedItem = found;
				physicalCount = draft.physicalCount;
				notes = draft.notes;
				scanMethod = draft.scanMethod;
				const blob = await opnamePersist.restorePhoto(OPNAME_PHOTO_KEY);
				if (blob) photoFile = new File([blob], 'bukti.jpg', { type: blob.type || 'image/jpeg' });
				draftSavedAt = new Date();
			}
		}
		draftArmed = true;

		const sendFn = async (entry: any) => {
			let evidencePhotoFileId: string | null = null;
			if (entry.photoBlob) {
				const file = new File([entry.photoBlob], entry.photoName || 'bukti.jpg', { type: entry.photoBlob.type });
				evidencePhotoFileId = await uploadEvidencePhoto(file, 'stock_opname:evidence');
			}
			await submitOpname({ ...(entry.payload as any), evidencePhotoFileId });
		};
		registerStockAutoFlush(sendFn);
		flushStockQueue(sendFn).catch(() => {});
	});

	$effect(() => {
		void opnameSnapshot();
		if (!draftArmed) return;
		opnamePersist.save(opnameSnapshot());
		draftSavedAt = new Date();
	});

	onMount(() => registerFormPersistSaveTriggers(opnamePersist, () => opnameSnapshot()));

	let filteredItems = $derived(
		search.trim()
			? items.filter((i) => i.nama_barang_lengkap.toLowerCase().includes(search.trim().toLowerCase()))
			: items
	);

	let systemStock = $derived(selectedItem ? parseFloat(selectedItem.stok_tersedia) || 0 : 0);
	let delta = $derived(physicalCount != null ? physicalCount - systemStock : 0);
	let canSubmit = $derived(
		!!selectedItem && physicalCount != null && physicalCount >= 0 && !!photoFile && !!gps && !gpsError
	);

	async function onScanDetect(value: string) {
		showScanner = false;
		const parsed = parseEpiQr(value);
		if (parsed && parsed.type === 'ITEM') {
			const found = items.find((i) => i.id === parsed.id);
			if (!found) {
				errorMsg = 'Barang hasil scan tidak ditemukan di daftar.';
				return;
			}
			selectedItem = found;
			scanMethod = 'qr_item';
			errorMsg = '';
			return;
		}

		if (parsed && parsed.type === 'EQUIPMENT') {
			// Barcode aset EQUIPMENT (EPI:EQUIPMENT:<id_equipment>) -- 99% item EQUIPMENT tanpa
			// kode_item ternyata sudah punya id_equipment (audit barcode 17 Sep 2026, Fase 1).
			// Cari pakai id_equipment polos, bukan raw string berprefix.
			const byEquipment = await findItemByCode(String(parsed.id));
			if (byEquipment) {
				const found = items.find((i) => i.id === byEquipment.id);
				selectedItem = found || byEquipment;
				scanMethod = 'manual_search';
				errorMsg = '';
				return;
			}
			errorMsg = 'Barang aset hasil scan tidak ditemukan. Gunakan pencarian manual.';
			return;
		}

		// Bukan QR internal EPI (mis. barcode vendor tertempel di kemasan) -- coba treat
		// sebagai kode_item/kode_singkat_item/barcode_vendor dulu sebelum menyerah ke
		// pencarian manual (audit barcode 17 Sep 2026, Temuan #7b).
		const byCode = await findItemByCode(value);
		if (byCode) {
			const found = items.find((i) => i.id === byCode.id);
			selectedItem = found || byCode;
			scanMethod = 'manual_search';
			errorMsg = '';
			return;
		}

		errorMsg = 'Kode yang discan tidak dikenali. Gunakan pencarian manual.';
	}

	function switchMode(next: 'umum' | 'gudang_pusat') {
		mode = next;
		if (next === 'gudang_pusat') {
			const gudangIds: number[] = getInventorySetting('inventory.gudang_hq.gudang_ids') || [1];
			const hqGudang = gudangList.find((g) => g.id === gudangIds[0]);
			if (hqGudang) gudangId = hqGudang.id;
		}
	}

	function handlePhotoChange(e: Event) {
		const target = e.target as HTMLInputElement;
		photoFile = target.files?.[0] || null;
		if (photoFile) opnamePersist.savePhoto(OPNAME_PHOTO_KEY, photoFile);
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
			const parsed = stockOpnameSchema.safeParse({
				itemId: (selectedItem as StockItemOption).id,
				systemStock,
				physicalCount,
				notes,
				karyawanName,
				lat: gps?.lat ?? null,
				lng: gps?.lng ?? null,
				accuracy: gps?.accuracy ?? null,
				capturedAt,
				scanMethod,
				gudangId: rakId || gudangId
			});
			if (!parsed.success) {
				errorMsg = parsed.error.issues[0]?.message || 'Data opname tidak valid.';
				submitting = false;
				return;
			}
			const basePayload = parsed.data;
			const compressed = await compressPhoto(photoFile as File);

			if (mode === 'gudang_pusat') {
				// Fase 3 Gudang Pusat: gerbang toleransi, belum ada antrian offline (Q2.5 ditunda
				// ke Fase 6) — kalau gagal kirim, tampilkan error saja, jangan enqueue diam-diam.
				const evidencePhotoFileId = await uploadEvidencePhoto(compressed, 'stock_opname:evidence');
				const hq = await submitOpnameGudangHq({ ...basePayload, evidencePhotoFileId });
				successInfo =
					hq.status === 'no_change'
						? { noChange: true }
						: { noChange: false, referenceNo: hq.result?.reference_no, menungguApproval: hq.status === 'menunggu_approval' };
			} else {
				try {
					const evidencePhotoFileId = await uploadEvidencePhoto(compressed, 'stock_opname:evidence');
					const result = await submitOpname({ ...basePayload, evidencePhotoFileId });
					successInfo = result ? { noChange: false, referenceNo: result.reference_no } : { noChange: true };
				} catch (err: any) {
					if (err instanceof TypeError) {
						await enqueueStockSubmission({
							client_txn_id: crypto.randomUUID(),
							type: 'opname',
							payload: basePayload,
							photoBlob: compressed,
							photoName: compressed.name,
							createdAt: new Date().toISOString()
						});
						successInfo = { noChange: false, referenceNo: 'Tersimpan offline, akan terkirim otomatis' };
					} else {
						throw err;
					}
				}
			}
			opnamePersist.clear();
			await opnamePersist.clearPhotos();
			draftSavedAt = null;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mencatat opname.';
		} finally {
			submitting = false;
		}
	}

	function resetForm() {
		selectedItem = null;
		physicalCount = null;
		notes = '';
		photoFile = null;
		search = '';
		successInfo = null;
		scanMethod = 'manual_search';
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/stock-lapangan')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if showScanner && QrScannerModal}
		<QrScannerModal onDetect={onScanDetect} onClose={() => (showScanner = false)} />
	{/if}

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data opname lapangan..." />
		</div>
	{:else if successInfo}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">
				{successInfo.noChange
					? 'Stok sesuai — tidak ada selisih'
					: successInfo.menungguApproval
						? 'Menunggu approval admin'
						: 'Opname tersimpan'}
			</p>
			{#if successInfo.menungguApproval}
				<div class="px-6 max-w-sm mx-auto text-left">
					<FieldHint text={h('opname.status.menungguApproval').explain} />
				</div>
			{/if}
			{#if successInfo.menungguApproval}
				<p class="text-[11px] mt-1 px-4" style="color: var(--sys-label3)">
					Selisih di luar toleransi — stok belum berubah sampai disetujui admin di Verifikasi Lapangan.
				</p>
			{/if}
			{#if successInfo.referenceNo}
				<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Ref: {successInfo.referenceNo}</p>
			{/if}
			<div class="flex gap-2 justify-center mt-5">
				<button class="px-4 py-2 rounded-lg text-[12px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={resetForm}>
					Opname Lagi
				</button>
				<button class="px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/stock-lapangan')}>
					Kembali ke Hub
				</button>
			</div>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold flex items-center gap-2" style="color: var(--sys-label)">
			<IconClipboardCheck size={18} /> Opname Harian
		</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Hitung fisik vs stok sistem</p>

		<SectionGuide
			id="stockLapangan.opname.page"
			title={h('opname.page').sectionGuide?.title}
			steps={h('opname.page').sectionGuide?.steps ?? []}
		/>

		{#if gudangHqEnabled}
			<div class="flex rounded-xl border p-1 mb-4" style="border-color: var(--sys-sep)">
				<button
					class="flex-1 h-9 rounded-lg text-[12.5px] font-semibold transition-colors"
					style="background: {mode === 'umum' ? 'var(--g)' : 'transparent'}; color: {mode === 'umum' ? 'white' : 'var(--sys-label3)'}"
					onclick={() => switchMode('umum')}
				>
					Opname Umum
				</button>
				<button
					class="flex-1 h-9 rounded-lg text-[12.5px] font-semibold transition-colors"
					style="background: {mode === 'gudang_pusat' ? 'var(--g)' : 'transparent'}; color: {mode === 'gudang_pusat' ? 'white' : 'var(--sys-label3)'}"
					onclick={() => switchMode('gudang_pusat')}
				>
					Gudang Pusat
				</button>
			</div>
			{#if mode === 'gudang_pusat'}
				<p class="text-[10.5px] mb-3 rounded-lg p-2" style="background: var(--sys-fill); color: var(--sys-label3)">
					Selisih di luar toleransi akan menunggu approval admin — stok tidak langsung berubah.
				</p>
			{/if}
		{/if}

		{#if !selectedItem}
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
			/>
			<div class="rounded-xl border max-h-72 overflow-y-auto" style="border-color: var(--sys-sep)">
				{#if filteredItems.length === 0}
					<p class="p-4 text-[12px] text-center" style="color: var(--sys-label3)">Barang tidak ditemukan.</p>
				{:else}
					{#each filteredItems as item (item.id)}
						<button
							class="w-full text-left p-3 border-b last:border-b-0 transition-colors hover:bg-gray-50"
							style="border-color: var(--sys-sep)"
							onclick={() => {
								selectedItem = item;
								scanMethod = 'manual_search';
							}}
						>
							<p class="text-[12.5px] font-medium" style="color: var(--sys-label)">
								{item.nama_barang_lengkap}
								{#if item.kode_item}<span class="font-mono font-bold" style="color: var(--g)">{item.kode_item}</span>{/if}
							</p>
							<p class="text-[10.5px]" style="color: var(--sys-label3)">Stok sistem: {parseFloat(item.stok_tersedia) || 0} {item.satuan}</p>
						</button>
					{/each}
				{/if}
			</div>
		{:else}
			<div class="rounded-xl border p-4 mb-4" style="border-color: var(--sys-sep)">
				<p class="text-[13px] font-semibold" style="color: var(--sys-label)">
					{selectedItem.nama_barang_lengkap}
					{#if selectedItem.kode_item}<span class="font-mono font-bold ml-1" style="color: var(--g)">{selectedItem.kode_item}</span>{/if}
				</p>
				<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Stok sistem: <b>{systemStock}</b> {selectedItem.satuan}</p>
				<button class="text-[11px] font-medium mt-2" style="color: var(--g)" onclick={() => (selectedItem = null)}>
					Ganti Barang
				</button>
			</div>

			<label class="text-[11px] font-semibold inline-flex items-center gap-1.5" style="color: var(--sys-label3)">
				Hitungan Fisik<HelpIcon text={h('opname.form.hitunganFisik').helpIcon} position="bottom" />
			</label>
			<input
				type="number"
				min="0"
				step="any"
				class="w-full mt-1 rounded-lg border text-[13px] p-2.5"
				style="border-color: var(--sys-sep)"
				placeholder="0"
				bind:value={physicalCount}
			/>
			<div class="mb-2">
				<FieldHint
					text={h('opname.form.hitunganFisik').fieldHint}
					type={h('opname.form.hitunganFisik').type}
				/>
			</div>

			{#if physicalCount != null}
				<div
					class="rounded-lg p-2.5 mb-3 text-center text-[13px] font-bold"
					style="background: {delta === 0 ? 'var(--sys-fill)' : delta > 0 ? 'var(--gg)' : 'var(--rel)'}; color: {delta === 0 ? 'var(--sys-label3)' : delta > 0 ? '#16A34A' : '#DC2626'}"
				>
					Selisih: {delta > 0 ? '+' : ''}{delta} {selectedItem.satuan}
				</div>
			{/if}

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

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Catatan (opsional)</label>
			<textarea
				class="w-full mt-1 rounded-lg border text-[12px] p-2.5"
				style="border-color: var(--sys-sep)"
				rows="2"
				bind:value={notes}
			></textarea>
			<div class="mb-3"><FieldHint text={h('opname.form.catatan').fieldHint} /></div>

			<label class="text-[11px] font-semibold flex items-center gap-1.5" style="color: var(--sys-label3)">
				<IconCamera size={14} /> Foto Bukti (wajib)
			</label>
			<input
				type="file"
				accept="image/*"
				capture="environment"
				class="w-full mt-1 text-[12px]"
				onchange={handlePhotoChange}
			/>
			<div class="mb-3">
				<FieldHint
					text={h('opname.form.fotoBukti').fieldHint}
					type={h('opname.form.fotoBukti').type}
				/>
			</div>

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
						<LocationMap lat={gps.lat} lng={gps.lng} label="Lokasi stok opname" height="200px" />
					</div>
				{/if}
			{/if}
		{/if}

		{#if errorMsg}
			<p class="text-[12px] mt-3" style="color: #DC2626">{errorMsg}</p>
		{/if}

		{#if selectedItem}
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
				Simpan Opname
			</button>
		{/if}
	{/if}
</div>
