<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getAntrianDetail,
		submitPicking,
		dispatchAntrian,
		type AntrianDetail
	} from '$lib/services/gudangAntrian';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { getCurrentPosition, type DevicePosition } from '$lib/utils/geoClient';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { loadInventorySettings, getInventorySetting } from '$lib/services/inventorySettings';
	import { vibrateTap } from '$lib/utils/haptic';
	import {
		IconArrowLeft, IconLoader2, IconCircleCheck, IconPackageExport, IconCamera, IconSend
	} from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';

	let canAccess = $derived(
		hasPermission($authStore.roleId, 'input_stock_lapangan', $rolesStore)
	);

	$effect(() => {
		const checked = $authStore.checked;
		if (checked && !canAccess) goto('/');
	});

	let packingListId = $derived(Number($page.params.id));
	let loading = $state(true);
	let detail = $state<AntrianDetail | null>(null);

	let wajibFoto = $state(true);
	let wajibGps = $state(false);

	let qtyInputs = $state<Record<number, number>>({}); // keyed by packing_list_items.id
	let itemStatus = $state<Record<number, 'idle' | 'sending' | 'done' | 'error'>>({});
	let itemError = $state<Record<number, string>>({});
	let clientTxnIds = $state<Record<number, string>>({});

	let photoFile = $state<File | null>(null);
	let evidencePhotoFileId = $state<string | null>(null);
	let gps = $state<DevicePosition | null>(null);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}
	let gpsError = $state('');

	// Jaring pengaman draf. Yang benar-benar mahal hilang di sini adalah FOTO bukti:
	// diambil sekali lalu dipakai ulang untuk semua item, dan kalau wajibFoto aktif
	// tidak ada item yang bisa disubmit tanpanya. Status per item TIDAK ikut disimpan —
	// itu datang dari qtyDelivered di server, jadi selalu benar setelah reload.
	interface PickDraft {
		qtyInputs: Record<number, number>;
	}
	const PICK_PHOTO_KEY = 'bukti';
	let pickPersist = $derived(createFormPersist<PickDraft>(`gudang_pick_${packingListId}`));
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function pickSnapshot(): PickDraft {
		return { qtyInputs };
	}

	let dispatching = $state(false);
	let dispatchError = $state('');
	let dispatchSuccess = $state(false);

	async function requestGps() {
		gpsError = '';
		try {
			gps = await getCurrentPosition();
		} catch (e: any) {
			gpsError = e?.message || 'Gagal mengambil lokasi.';
		}
	}

	async function load() {
		loading = true;
		await loadInventorySettings();
		wajibFoto = getInventorySetting('inventory.gudang_hq.wajib_foto_pick');
		wajibGps = getInventorySetting('inventory.gudang_hq.wajib_gps');

		detail = await getAntrianDetail(packingListId);
		if (detail) {
			for (const item of detail.items) {
				const remaining = Math.max(0, item.qtyRequired - item.qtyDelivered);
				qtyInputs[item.id] = remaining;
				itemStatus[item.id] = item.qtyDelivered >= item.qtyRequired ? 'done' : 'idle';
			}
		}
		if (wajibGps) requestGps();
		else requestGps(); // non-blocking, tetap dicoba untuk dilampirkan bila tersedia

		// Pulihkan draf SETELAH qty default dari server dipasang, dan hanya untuk item
		// yang masih ada di packing list ini.
		const draft = pickPersist.restore();
		if (draft) {
			for (const item of detail?.items ?? []) {
				const saved = draft.qtyInputs?.[item.id];
				if (typeof saved === 'number') qtyInputs[item.id] = saved;
			}
			const blob = await pickPersist.restorePhoto(PICK_PHOTO_KEY);
			if (blob) photoFile = new File([blob], 'bukti.jpg', { type: blob.type || 'image/jpeg' });
			draftSavedAt = new Date();
		}
		draftArmed = true;
		loading = false;
	}

	onMount(load);

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void pickSnapshot();
		if (!draftArmed) return;
		pickPersist.save(pickSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(pickPersist, pickSnapshot));

	function onPhotoChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		photoFile = file || null;
		evidencePhotoFileId = null; // upload ulang saat submit berikutnya
		if (photoFile) pickPersist.savePhoto(PICK_PHOTO_KEY, photoFile);
	}

	let readyToSubmit = $derived(!wajibFoto || !!photoFile);

	async function ensurePhotoUploaded(): Promise<string | null> {
		if (!photoFile) return null;
		if (evidencePhotoFileId) return evidencePhotoFileId;
		const compressed = await compressPhoto(photoFile);
		const id = await uploadEvidencePhoto(compressed, 'stock_lapangan:gudang_hq_pick');
		evidencePhotoFileId = id;
		return id;
	}

	async function submitItem(itemId: number) {
		if (!detail) return;
		const item = detail.items.find((i) => i.id === itemId);
		if (!item) return;

		const qty = Number(qtyInputs[itemId]) || 0;
		if (qty <= 0) {
			itemError[itemId] = 'Isi jumlah lebih dari 0.';
			return;
		}
		if (wajibFoto && !photoFile) {
			itemError[itemId] = 'Foto bukti wajib diisi dulu (di atas).';
			return;
		}
		if (wajibGps && (!gps || gpsError)) {
			itemError[itemId] = 'GPS wajib aktif dulu.';
			return;
		}

		vibrateTap();
		itemStatus[itemId] = 'sending';
		itemError[itemId] = '';

		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama karyawan tidak ditemukan di sesi login.');

			const photoId = await ensurePhotoUploaded();
			if (!clientTxnIds[itemId]) clientTxnIds[itemId] = crypto.randomUUID();

			const result = await submitPicking({
				packingListId,
				packingListItemId: itemId,
				itemId: item.itemId as number,
				quantity: qty,
				karyawanName,
				clientTxnId: clientTxnIds[itemId],
				evidencePhotoFileId: photoId,
				lat: gps?.lat ?? null,
				lng: gps?.lng ?? null,
				accuracy: gps?.accuracy ?? null,
				capturedAt: new Date().toISOString()
			});

			if (!result.success) {
				itemStatus[itemId] = 'error';
				itemError[itemId] = result.error || 'Gagal submit.';
				return;
			}

			itemStatus[itemId] = 'done';
			// Refresh detail item ini supaya sisa qty & status prep terbaru (mis. bila
			// packing_list.prep_status berubah jadi 'packed' setelah semua item selesai).
			detail = await getAntrianDetail(packingListId);
		} catch (err: any) {
			itemStatus[itemId] = 'error';
			itemError[itemId] = err?.message || 'Gagal submit.';
		}
	}

	let allDelivered = $derived(
		!!detail && detail.items.length > 0 && detail.items.every((i) => i.qtyDelivered >= i.qtyRequired - 0.0001)
	);
	let anyDelivered = $derived(!!detail && detail.items.some((i) => i.qtyDelivered > 0));

	async function handleDispatch() {
		dispatching = true;
		dispatchError = '';
		try {
			const result = await dispatchAntrian(packingListId);
			if (!result.success) {
				dispatchError = result.error || 'Gagal menandai selesai.';
				return;
			}
			// Antrian sudah dikirim seluruhnya — draf lokal (termasuk foto) tidak relevan.
			pickPersist.clear();
			await pickPersist.clearPhotos();
			draftSavedAt = null;
			dispatchSuccess = true;
		} finally {
			dispatching = false;
		}
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto(`/stock-lapangan/antrian/${packingListId}`)}>
		<IconArrowLeft size={15} /> Kembali ke Detail
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat item picking antrian..." />
		</div>
	{:else if !detail}
		<div class="rounded-xl border p-8 text-center" style="border-color: var(--sys-sep)">
			<p class="text-[12px]" style="color: var(--sys-label3)">Antrian tidak ditemukan.</p>
		</div>
	{:else if dispatchSuccess}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Antrian ditandai selesai & dikirim</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">{detail.nomorPl}</p>
			<button class="px-4 py-2 mt-5 rounded-lg text-[12px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/stock-lapangan/antrian')}>
				Kembali ke Antrian
			</button>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-2">
			<h1 class="text-[16px] font-bold flex items-center gap-2" style="color: var(--sys-label)">
				<IconPackageExport size={18} /> Picking — {detail.nomorPl}
			</h1>
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} />
		</div>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
			{detail.requestedByDepartment || 'Tanpa departemen'} · {detail.destinationPicName || 'Tanpa PIC'}
		</p>

		<div class="rounded-xl border p-3 mb-4" style="border-color: var(--sys-sep)">
			<label class="text-[11px] font-semibold flex items-center gap-1.5" style="color: var(--sys-label3)">
				<IconCamera size={14} /> Foto Bukti Packing {wajibFoto ? '(wajib)' : '(opsional)'}
			</label>
			<input type="file" accept="image/*" capture="environment" class="w-full mt-1.5 text-[12px]" onchange={onPhotoChange} />
			{#if photoFile}<p class="text-[10.5px] mt-1" style="color: #16A34A">✓ {photoFile.name}</p>{/if}

			<p class="text-[10.5px] mt-2" style="color: {gpsError ? '#DC2626' : 'var(--sys-label3)'}">
				{#if gpsError}
					⚠ {gpsError}{wajibGps ? ' (wajib)' : ''} <button class="underline" onclick={requestGps}>Coba lagi</button>
				{:else if gps}
					📍 Lokasi terekam (akurasi ~{Math.round(gps.accuracy)}m)
				{:else}
					Mengambil lokasi...
				{/if}
			</p>
			{#if gps}
				<button
					type="button"
					class="text-[10.5px] font-semibold flex items-center gap-1 mb-1"
					style="color: var(--sys-tint, #1F6592)"
					onclick={toggleLocationMap}
				>
					📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
				</button>
				{#if showLocationMap && LocationMap}
					<div transition:slide={{ duration: 200 }}>
						<LocationMap lat={gps.lat} lng={gps.lng} label="Lokasi picking" height="200px" />
					</div>
				{/if}
			{/if}
		</div>

		<div class="rounded-xl border divide-y" style="border-color: var(--sys-sep)">
			{#each detail.items as item (item.id)}
				<div class="p-3">
					<div class="flex items-center justify-between gap-2 mb-1.5">
						<p class="text-[12.5px] font-medium truncate" style="color: var(--sys-label)">{item.namaBarang}</p>
						{#if itemStatus[item.id] === 'done'}
							<IconCircleCheck size={16} style="color: #16A34A" />
						{/if}
					</div>
					<p class="text-[10.5px] mb-2" style="color: var(--sys-label3)">
						Diminta {item.qtyRequired} {item.unit} · Sudah dikirim {item.qtyDelivered} {item.unit}
					</p>

					{#if itemStatus[item.id] !== 'done'}
						<div class="flex gap-2 items-center">
							<input
								type="number"
								min="0"
								step="any"
								class="flex-1 rounded-lg border text-[13px] p-2"
								style="border-color: var(--sys-sep)"
								bind:value={qtyInputs[item.id]}
								disabled={itemStatus[item.id] === 'sending'}
							/>
							<button
								class="h-9 px-3 rounded-lg text-[12px] font-bold text-white flex items-center gap-1.5 disabled:opacity-40 shrink-0"
								style="background: var(--g)"
								disabled={!readyToSubmit || itemStatus[item.id] === 'sending'}
								onclick={() => submitItem(item.id)}
							>
								{#if itemStatus[item.id] === 'sending'}
									<IconLoader2 size={14} class="animate-spin" />
								{:else}
									<IconSend size={14} />
								{/if}
								Kirim
							</button>
						</div>
						{#if itemError[item.id]}
							<p class="text-[10.5px] mt-1.5" style="color: #DC2626">{itemError[item.id]}</p>
						{/if}
					{/if}
				</div>
			{/each}
		</div>

		{#if dispatchError}
			<p class="text-[12px] mt-3" style="color: #DC2626">{dispatchError}</p>
		{/if}

		<button
			class="w-full h-12 mt-4 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
			style="background: {allDelivered ? 'var(--g)' : '#EA580C'}"
			disabled={!anyDelivered || dispatching}
			onclick={handleDispatch}
		>
			{#if dispatching}<IconLoader2 size={16} class="animate-spin" />{/if}
			{allDelivered ? 'Selesai & Kirim' : 'Kirim Sebagian (belum lengkap)'}
		</button>
	{/if}
</div>
