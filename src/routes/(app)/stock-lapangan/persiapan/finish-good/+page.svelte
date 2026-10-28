<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, tick } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getFinishGoodStock, type FinishGoodStockItem } from '$lib/services/stockLapangan';
	import { getProjects } from '$lib/services/projects';
	import { createFinishGoodDraftSJ, type FinishGoodDispatchItem } from '$lib/services/finishGoodDispatch';
	import { loadInventorySettings, getInventorySetting } from '$lib/services/inventorySettings';
	import { vibrateTap } from '$lib/utils/haptic';
	import { IconArrowLeft, IconLoader2, IconTruckDelivery, IconInfoCircle, IconCheck, IconCamera } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';

	const PHOTO_ANGLES = [
		{ key: 'depan', label: 'Depan' },
		{ key: 'label', label: 'Label' },
		{ key: 'kondisi', label: 'Kondisi' }
	] as const;

	let canAccess = $derived(
		hasPermission($authStore.roleId, 'input_stock_lapangan', $rolesStore) ||
		hasPermission($authStore.roleId, 'view_stock_lapangan', $rolesStore)
	);

	$effect(() => {
		const checked = $authStore.checked;
		if (checked && !canAccess) goto('/');
	});

	let loading = $state(true);
	let items = $state<FinishGoodStockItem[]>([]);
	let projects = $state<{ id: number; name: string }[]>([]);

	// Pilihan qty per item (0 = tidak dipilih)
	let selectedQty = $state<Record<number, number>>({});
	let selectedKondisi = $state<Record<number, 'baik' | 'rusak'>>({});

	let destinationType = $state<'proyek' | 'customer'>('proyek');
	let destinationProjectId = $state<number | null>(null);
	let destinationCustomerName = $state('');

	let submitting = $state(false);
	let successNomorSj = $state<string | null>(null);
	let errorMsg = $state<string | null>(null);
	let highlightItemId = $state<number | null>(null);
	let wajibFoto = $state(true);
	let photoFiles = $state<Record<string, File | null>>({ depan: null, label: null, kondisi: null });
	let photoInputs: Record<string, HTMLInputElement> = {};

	// Jaring pengaman draf: form ini menuntut TIGA foto (depan/label/kondisi), jadi
	// kamera native dibuka tiga kali setelah qty & tujuan diisi. Tab dibunuh OS di
	// foto ketiga = seluruh pemilihan qty hilang. Tiap sudut foto punya kunci sendiri.
	interface FinishGoodDraft {
		selectedQty: Record<number, number>;
		selectedKondisi: Record<number, 'baik' | 'rusak'>;
		destinationType: 'proyek' | 'customer';
		destinationProjectId: number | null;
		destinationCustomerName: string;
		photoAngles: string[];
	}
	const fgPersist = createFormPersist<FinishGoodDraft>('stock_finish_good');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function fgSnapshot(): FinishGoodDraft {
		return {
			selectedQty,
			selectedKondisi,
			destinationType,
			destinationProjectId,
			destinationCustomerName,
			// Catat sudut mana saja yang fotonya ada, supaya saat pulih kita tahu
			// kunci mana yang perlu dibaca dari IndexedDB.
			photoAngles: PHOTO_ANGLES.filter((a) => !!photoFiles[a.key]).map((a) => a.key)
		};
	}

	function onPhotoPicked(angleKey: string, file: File | null) {
		photoFiles = { ...photoFiles, [angleKey]: file };
		if (file) fgPersist.savePhoto(angleKey, file);
		else fgPersist.clearPhoto(angleKey);
	}

	let selectedItems = $derived.by(() =>
		items
			.filter((it) => (selectedQty[it.itemId] || 0) > 0)
			.map((it) => ({
				itemId: it.itemId,
				namaBarang: it.namaBarang,
				satuan: it.satuan,
				qty: selectedQty[it.itemId],
				kondisi: selectedKondisi[it.itemId] || 'baik'
			}))
	);

	let photosComplete = $derived(!wajibFoto || PHOTO_ANGLES.every((a) => !!photoFiles[a.key]));

	let canSubmit = $derived(
		selectedItems.length > 0 &&
		photosComplete &&
		(destinationType === 'proyek' ? destinationProjectId != null : destinationCustomerName.trim().length > 0)
	);

	onMount(async () => {
		await loadInventorySettings();
		wajibFoto = getInventorySetting('inventory.persiapan.wajib_foto_bukti');

		const [fg, projectList] = await Promise.all([
			getFinishGoodStock(),
			getProjects(null, true, null, { limit: 100 })
		]);
		items = fg;
		const rawProjects: any = projectList;
		projects = (rawProjects?.data || rawProjects || []).map((p: any) => ({ id: p.id, name: p.name }));

		const draft = fgPersist.restore();
		if (draft) {
			// Qty dipulihkan hanya untuk item yang MASIH ada di stok FG — kalau barangnya
			// sudah keluar duluan lewat SJ lain, angka lama tidak boleh muncul lagi.
			const validIds = new Set(items.map((it) => it.itemId));
			selectedQty = Object.fromEntries(
				Object.entries(draft.selectedQty || {}).filter(([id]) => validIds.has(Number(id)))
			) as Record<number, number>;
			selectedKondisi = draft.selectedKondisi || {};
			destinationType = draft.destinationType;
			destinationProjectId = draft.destinationProjectId;
			destinationCustomerName = draft.destinationCustomerName || '';

			const restored: Record<string, File | null> = { depan: null, label: null, kondisi: null };
			await Promise.all(
				(draft.photoAngles || []).map(async (key) => {
					const blob = await fgPersist.restorePhoto(key);
					if (blob) restored[key] = new File([blob], `${key}.jpg`, { type: blob.type || 'image/jpeg' });
				})
			);
			photoFiles = restored;
			draftSavedAt = new Date();
		}
		draftArmed = true;
		loading = false;

		const itemIdParam = $page.url.searchParams.get('itemId');
		if (itemIdParam) {
			highlightItemId = Number(itemIdParam);
			await tick();
			document.getElementById(`fg-item-${highlightItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			setTimeout(() => (highlightItemId = null), 3000);
		}
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void fgSnapshot();
		if (!draftArmed) return;
		fgPersist.save(fgSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(fgPersist, fgSnapshot));

	function setQty(itemId: number, max: number, raw: string) {
		const n = Math.max(0, Math.min(max, Number(raw) || 0));
		selectedQty = { ...selectedQty, [itemId]: n };
	}

	async function submit() {
		if (!canSubmit) return;
		submitting = true;
		errorMsg = null;
		const destinationName = destinationType === 'proyek'
			? (projects.find((p) => p.id === destinationProjectId)?.name || '')
			: destinationCustomerName.trim();

		const compressedPhotoFiles = await Promise.all(
			PHOTO_ANGLES.map((a) => {
				const f = photoFiles[a.key];
				return f ? compressPhoto(f) : Promise.resolve(null);
			})
		);

		const res = await createFinishGoodDraftSJ({
			destinationType,
			destinationId: destinationType === 'proyek' ? destinationProjectId : null,
			destinationName,
			items: selectedItems as FinishGoodDispatchItem[],
			karyawanName: $authStore.karyawanName || '',
			karyawanId: $authStore.karyawanId,
			photoFiles: compressedPhotoFiles
		});

		if (res.ok) {
			vibrateTap();
			successNomorSj = res.nomorSj || null;
			// Terkirim — draf lokal (termasuk ketiga foto di IndexedDB) sudah tidak relevan.
			fgPersist.clear();
			await fgPersist.clearPhotos();
			draftSavedAt = null;
			selectedQty = {};
			selectedKondisi = {};
			photoFiles = { depan: null, label: null, kondisi: null };
		} else {
			errorMsg = res.error || 'Gagal membuat draft Surat Jalan.';
		}
		submitting = false;
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/stock-lapangan/persiapan')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<div class="flex items-center justify-between gap-2">
		<h1 class="text-[16px] font-bold flex items-center gap-2" style="color: var(--sys-label)">
			<IconTruckDelivery size={18} /> Finish Good → Kirim
		</h1>
		<DraftIndicator savedAt={draftSavedAt} hasPhotos={PHOTO_ANGLES.some((a) => !!photoFiles[a.key])} />
	</div>

	<div class="flex items-start gap-2 rounded-lg p-2.5 mb-4 mt-2 banner-amber">
		<IconInfoCircle size={14} class="shrink-0 mt-0.5 banner-amber-icon" />
		<p class="text-[10.5px] leading-relaxed banner-amber-text">
			Konfirmasi di sini membuat <b>draft</b> Surat Jalan — tidak memotong stok otomatis, admin
			tetap harus review & finalisasi dari dashboard.
		</p>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data finish good..." />
		</div>
	{:else if successNomorSj}
		<div class="rounded-xl border p-6 text-center" style="border-color: var(--sys-sep)">
			<div class="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
				<IconCheck size={22} style="color: #16A34A" />
			</div>
			<p class="text-[13px] font-bold" style="color: var(--sys-label)">Draft {successNomorSj} dibuat</p>
			<p class="text-[11px] mt-1.5" style="color: var(--sys-label3)">Menunggu review admin sebelum dikirim.</p>
			<button
				class="mt-4 px-4 py-2 rounded-lg text-[12px] font-medium"
				style="background: var(--sys-fill); color: var(--sys-label)"
				onclick={() => { successNomorSj = null; goto('/stock-lapangan/persiapan'); }}
			>Kembali ke Hub</button>
		</div>
	{:else if items.length === 0}
		<div class="rounded-xl border p-8 text-center" style="border-color: var(--sys-sep)">
			<p class="text-[12px]" style="color: var(--sys-label3)">Tidak ada stok Finish Good tersedia.</p>
		</div>
	{:else}
		<!-- Tujuan -->
		<div class="section-header mt-0 mb-2 text-[13px]">Tujuan</div>
		<div class="flex items-center gap-2 mb-3">
			<button
				class="flex-1 py-2 rounded-lg text-[12px] font-medium"
				style="background: {destinationType === 'proyek' ? 'var(--sys-fill-strong, #2563EB)' : 'var(--sys-fill)'}; color: {destinationType === 'proyek' ? 'white' : 'var(--sys-label3)'}"
				onclick={() => (destinationType = 'proyek')}
			>Proyek</button>
			<button
				class="flex-1 py-2 rounded-lg text-[12px] font-medium"
				style="background: {destinationType === 'customer' ? 'var(--sys-fill-strong, #2563EB)' : 'var(--sys-fill)'}; color: {destinationType === 'customer' ? 'white' : 'var(--sys-label3)'}"
				onclick={() => (destinationType = 'customer')}
			>Customer Eksternal</button>
		</div>

		{#if destinationType === 'proyek'}
			<select
				bind:value={destinationProjectId}
				class="w-full px-3 py-2.5 rounded-lg text-[12.5px] border mb-5"
				style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
			>
				<option value={null}>Pilih proyek...</option>
				{#each projects as p (p.id)}
					<option value={p.id}>{p.name}</option>
				{/each}
			</select>
		{:else}
			<input
				type="text"
				bind:value={destinationCustomerName}
				placeholder="Nama customer / tujuan pengiriman"
				class="w-full px-3 py-2.5 rounded-lg text-[12.5px] border mb-5"
				style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
			/>
		{/if}

		<!-- Item -->
		<div class="section-header mt-0 mb-2 text-[13px]">Pilih Barang & Qty</div>
		<div class="rounded-xl border overflow-hidden mb-5" style="border-color: var(--sys-sep)">
			{#each items as item (item.itemId)}
				<div id={`fg-item-${item.itemId}`} class="p-3 border-b last:border-b-0 transition-colors" class:baris-disorot={highlightItemId === item.itemId} style="border-color: var(--sys-sep)">
					<div class="flex items-center justify-between gap-2 mb-2">
						<p class="text-[12.5px] font-medium truncate" style="color: var(--sys-label)">{item.namaBarang}</p>
						<p class="text-[10.5px] shrink-0" style="color: var(--sys-label3)">Stok: {item.stokTersedia} {item.satuan}</p>
					</div>
					<div class="flex items-center gap-2">
						<input
							type="number"
							min="0"
							max={item.stokTersedia}
							placeholder="Qty kirim"
							value={selectedQty[item.itemId] || ''}
							oninput={(e) => setQty(item.itemId, item.stokTersedia, (e.target as HTMLInputElement).value)}
							class="w-24 px-2.5 py-1.5 rounded-lg text-[12px] border"
							style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
						/>
						{#if (selectedQty[item.itemId] || 0) > 0}
							<select
								bind:value={selectedKondisi[item.itemId]}
								class="flex-1 px-2.5 py-1.5 rounded-lg text-[12px] border"
								style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
							>
								<option value="baik">Kondisi: Baik</option>
								<option value="rusak">Kondisi: Rusak</option>
							</select>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		<!-- Foto multi-angle -->
		<div class="section-header mt-0 mb-2 text-[13px]">
			Foto Bukti{wajibFoto ? ' (wajib, 3 sudut)' : ' (opsional)'}
		</div>
		<div class="grid grid-cols-3 gap-2 mb-5">
			{#each PHOTO_ANGLES as angle (angle.key)}
				{@const file = photoFiles[angle.key]}
				<input
					bind:this={photoInputs[angle.key]}
					type="file"
					accept="image/*"
					capture="environment"
					class="hidden"
					onchange={(e) => onPhotoPicked(angle.key, (e.target as HTMLInputElement).files?.[0] || null)}
				/>
				<button
					class="rounded-xl border overflow-hidden flex flex-col items-center gap-1.5 {file ? 'foto-terisi' : ''}"
					style="border-color: {file ? '#16A34A' : 'var(--sys-sep)'}"
					onclick={() => photoInputs[angle.key]?.click()}
				>
					{#if file}
						<img src={URL.createObjectURL(file)} alt={angle.label} class="w-full aspect-square object-cover" />
					{:else}
						<div class="w-full aspect-square flex items-center justify-center">
							<IconCamera size={18} style="color: var(--sys-label4)" />
						</div>
					{/if}
					<span class="text-[10px] font-medium pb-1.5" style="color: var(--sys-label3)">{angle.label}</span>
				</button>
			{/each}
		</div>

		{#if errorMsg}
			<p class="text-[11px] mb-3" style="color: #DC2626">{errorMsg}</p>
		{/if}

		<button
			class="w-full py-3 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2"
			style="background: {canSubmit ? 'var(--sys-fill-strong, #2563EB)' : 'var(--sys-fill)'}; color: {canSubmit ? 'white' : 'var(--sys-label4)'}"
			disabled={!canSubmit || submitting}
			onclick={submit}
		>
			{#if submitting}
				<IconLoader2 size={16} class="animate-spin" /> Membuat draft...
			{:else}
				Buat Draft Surat Jalan ({selectedItems.length} item)
			{/if}
		</button>
	{/if}
</div>

<style>
	/* Dark mode gudang (cahaya minim) — latar pastel diganti overlay transparan. */
	.banner-amber { background: #FFFBEB; }
	/* Ikon dirender oleh komponen anak (IconInfoCircle) — wajib :global agar style terpakai. */
	:global(.banner-amber-icon) { color: #B45309; }
	.banner-amber-text { color: #92400E; }
	.foto-terisi { background: #F0FDF4; }
	.baris-disorot { background: #FEF9C3; }

	:global([data-theme='dark']) .banner-amber { background: rgba(232, 178, 61, 0.14); }
	:global([data-theme='dark'] .banner-amber-icon) { color: #F0C25E; }
	:global([data-theme='dark']) .banner-amber-text { color: #F0C25E; }
	:global([data-theme='dark']) .foto-terisi { background: rgba(52, 201, 140, 0.15); }
	:global([data-theme='dark']) .baris-disorot { background: rgba(232, 178, 61, 0.18); }
</style>
