<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, tick } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getPersiapanHarian, type PersiapanHarian } from '$lib/services/stockLapangan';
	import { getProgressMap, markPersiapanStatus, type PersiapanProgressRow } from '$lib/services/persiapanProgress';
	import { loadInventorySettings, getInventorySetting } from '$lib/services/inventorySettings';
	import { vibrateTap } from '$lib/utils/haptic';
	import { enqueueStockSubmission, registerStockAutoFlush, type QueuedStockSubmission } from '$lib/utils/offlineStockQueue';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconBox, IconCheck, IconCamera } from '@tabler/icons-svelte';

	let canAccess = $derived(
		hasPermission($authStore.roleId, 'input_stock_lapangan', $rolesStore) ||
		hasPermission($authStore.roleId, 'view_stock_lapangan', $rolesStore)
	);

	$effect(() => {
		const checked = $authStore.checked;
		if (checked && !canAccess) goto('/');
	});

	let loading = $state(true);
	let saving = $state<string | null>(null); // key sedang disimpan
	let wajibFoto = $state(true);
	let data = $state<PersiapanHarian>({ reorderAlerts: [], spkReservations: [], packingPipeline: [], jatahEligible: [] });
	let progress = $state(new Map<string, PersiapanProgressRow>());
	let pendingPhotoKey: string | null = null;
	let pendingBulkGroupId: string | null = null;
	let fileInput: HTMLInputElement;
	let bulkFileInput: HTMLInputElement;
	let highlightItemId = $state<number | null>(null);

	function progressKey(sourceId: string | number, itemId: number | null) {
		return `${sourceId}:${itemId ?? ''}`;
	}

	function isSiap(sourceId: string | number, itemId: number | null) {
		return progress.get(progressKey(sourceId, itemId))?.status === 'siap';
	}

	// Kelompokkan reservasi material per SPK.
	let spkGroups = $derived.by(() => {
		const map = new Map<string, { spkId: string; items: PersiapanHarian['spkReservations'] }>();
		for (const item of data.spkReservations) {
			const key = String(item.spkId);
			if (!map.has(key)) map.set(key, { spkId: key, items: [] });
			map.get(key)!.items.push(item);
		}
		return Array.from(map.values());
	});

	function groupSiapCount(group: { spkId: string; items: PersiapanHarian['spkReservations'] }) {
		return group.items.filter((it) => isSiap(group.spkId, it.itemId)).length;
	}

	async function loadAll() {
		data = await getPersiapanHarian();
		const spkIds = data.spkReservations.map((r) => r.spkId);
		const reorderIds = data.reorderAlerts.map((r) => `reorder-${r.itemId}`);
		progress = await getProgressMap('bahan_baku_spk', [...spkIds, ...reorderIds]);
	}

	async function flushOne(entry: QueuedStockSubmission) {
		if (entry.type !== 'persiapan') throw new Error('bukan antrian bahan-baku');
		const p = entry.payload as any;
		const photoFile = entry.photoBlob ? new File([entry.photoBlob], entry.photoName || 'bukti.jpg', { type: entry.photoBlob.type }) : null;
		const res = await markPersiapanStatus({
			sourceType: p.sourceType,
			sourceId: p.sourceId,
			itemId: p.itemId,
			qtyPrepared: p.qtyPrepared,
			status: p.status,
			karyawanName: p.karyawanName,
			karyawanId: p.karyawanId,
			photoFile
		});
		if (!res.ok) throw new Error(res.error || 'Gagal sinkron');
	}

	onMount(async () => {
		await loadInventorySettings();
		wajibFoto = getInventorySetting('inventory.persiapan.wajib_foto_bukti');
		await loadAll();
		loading = false;
		registerStockAutoFlush(async (entry) => {
			await flushOne(entry);
			await loadAll();
		});

		// Deep-link dari tombol Scan di hub (?itemId=123) — sorot & scroll ke baris terkait.
		const itemIdParam = $page.url.searchParams.get('itemId');
		if (itemIdParam) {
			highlightItemId = Number(itemIdParam);
			await tick();
			document.getElementById(`item-${highlightItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			setTimeout(() => (highlightItemId = null), 3000);
		}
	});

	async function markAllSiap(group: { spkId: string; items: PersiapanHarian['spkReservations'] }) {
		const pendingItems = group.items.filter((it) => !isSiap(group.spkId, it.itemId));
		if (pendingItems.length === 0) return;
		if (wajibFoto) {
			pendingBulkGroupId = group.spkId;
			bulkFileInput.click();
			return;
		}
		for (const it of pendingItems) {
			await persist(group.spkId, it.itemId, it.quantity, 'siap', null);
		}
	}

	async function onBulkFileChosen(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0] || null;
		const spkId = pendingBulkGroupId;
		pendingBulkGroupId = null;
		(e.target as HTMLInputElement).value = '';
		if (!file || !spkId) return;
		const group = spkGroups.find((g) => g.spkId === spkId);
		if (!group) return;
		const pendingItems = group.items.filter((it) => !isSiap(group.spkId, it.itemId));
		for (const it of pendingItems) {
			await persist(spkId, it.itemId, it.quantity, 'siap', file);
		}
	}

	async function toggle(sourceId: string | number, itemId: number | null, qty: number) {
		const k = progressKey(sourceId, itemId);
		const currentlySiap = isSiap(sourceId, itemId);
		const nextStatus = currentlySiap ? 'pending' : 'siap';

		// Wajib foto hanya saat menandai SIAP (bukan saat membatalkan).
		if (!currentlySiap && wajibFoto) {
			pendingPhotoKey = JSON.stringify({ sourceId: String(sourceId), itemId, qty });
			fileInput.click();
			return;
		}
		await persist(sourceId, itemId, qty, nextStatus, null);
	}

	async function onFileChosen(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0] || null;
		const ctx = pendingPhotoKey ? JSON.parse(pendingPhotoKey) : null;
		pendingPhotoKey = null;
		(e.target as HTMLInputElement).value = '';
		if (!file || !ctx) return;
		await persist(ctx.sourceId, ctx.itemId, ctx.qty, 'siap', file);
	}

	async function persist(sourceId: string | number, itemId: number | null, qty: number, status: 'pending' | 'siap', photoFile: File | null) {
		const k = progressKey(sourceId, itemId);
		saving = k;
		try {
			const res = await markPersiapanStatus({
				sourceType: 'bahan_baku_spk',
				sourceId,
				itemId,
				qtyPrepared: qty,
				status,
				karyawanName: $authStore.karyawanName || '',
				karyawanId: $authStore.karyawanId,
				photoFile
			});
			if (res.ok) {
				vibrateTap();
				await loadAll();
			}
		} catch (err: any) {
			if (err instanceof TypeError) {
				// Offline — simpan ke antrian lokal, sync otomatis saat online (registerStockAutoFlush).
				await enqueueStockSubmission({
					client_txn_id: crypto.randomUUID(),
					type: 'persiapan',
					payload: {
						sourceType: 'bahan_baku_spk',
						sourceId: String(sourceId),
						itemId,
						qtyPrepared: qty,
						status,
						karyawanName: $authStore.karyawanName || '',
						karyawanId: $authStore.karyawanId
					},
					photoBlob: photoFile,
					photoName: photoFile?.name ?? null,
					createdAt: new Date().toISOString()
				});
				// Update optimistik lokal supaya UI langsung menunjukkan status baru.
				progress.set(k, { id: -1, sourceType: 'bahan_baku_spk', sourceId: String(sourceId), itemId, qtyPrepared: qty, status, catatan: null, dateUpdated: new Date().toISOString() });
				progress = new Map(progress);
				vibrateTap();
			}
		} finally {
			saving = null;
		}
	}
</script>

<input bind:this={fileInput} type="file" accept="image/*" capture="environment" class="hidden" onchange={onFileChosen} />
<input bind:this={bulkFileInput} type="file" accept="image/*" capture="environment" class="hidden" onchange={onBulkFileChosen} />

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/stock-lapangan/persiapan')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold flex items-center gap-2" style="color: var(--sys-label)">
		<IconBox size={18} /> Bahan Baku → Produksi
	</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
		Status "siap" tersimpan permanen.{wajibFoto ? ' Wajib foto bukti saat menandai siap.' : ''}
	</p>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data bahan baku..." />
		</div>
	{:else}
		{#if data.reorderAlerts.length > 0}
			<div class="section-header mt-0 mb-2 text-[13px]">
				<IconAlertTriangle size={15} class="mr-1.5" /> Perlu Diadakan Dulu (Stok Menipis)
			</div>
			<div class="rounded-xl border overflow-hidden mb-5" style="border-color: var(--sys-sep)">
				{#each data.reorderAlerts as item (item.itemId)}
					{@const sourceId = `reorder-${item.itemId}`}
					{@const k = progressKey(sourceId, item.itemId)}
					<button
						class="w-full text-left p-3 border-b last:border-b-0 flex items-center justify-between gap-2"
						style="border-color: var(--sys-sep)"
						onclick={() => toggle(sourceId, item.itemId, item.stokMinimum - item.stokTersedia)}
					>
						<div class="min-w-0">
							<p class="text-[12.5px] font-medium truncate" style="color: var(--sys-label)">{item.namaBarang}</p>
							<p class="text-[10.5px]" style="color: #DC2626">Sisa {item.stokTersedia} / min {item.stokMinimum} {item.satuan}</p>
						</div>
						<div class="shrink-0 w-6 h-6 rounded-full flex items-center justify-center" style="background: {isSiap(sourceId, item.itemId) ? '#16A34A' : 'var(--sys-fill)'}">
							{#if saving === k}
								<IconLoader2 size={12} class="animate-spin" color="white" />
							{:else if isSiap(sourceId, item.itemId)}
								<IconCheck size={14} color="white" />
							{:else if wajibFoto}
								<IconCamera size={12} style="color: var(--sys-label4)" />
							{/if}
						</div>
					</button>
				{/each}
			</div>
		{/if}

		<div class="section-header mt-0 mb-2 text-[13px]">SPK Terjadwal</div>
		{#if spkGroups.length === 0}
			<div class="rounded-xl border p-8 text-center" style="border-color: var(--sys-sep)">
				<p class="text-[12px]" style="color: var(--sys-label3)">Tidak ada reservasi material aktif.</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each spkGroups as group (group.spkId)}
					{@const siapCount = groupSiapCount(group)}
					<div class="rounded-xl border overflow-hidden" style="border-color: var(--sys-sep)">
						<div class="px-3 py-2 flex items-center justify-between gap-2" style="background: var(--sys-fill)">
							<div class="min-w-0">
								<p class="text-[11.5px] font-bold" style="color: var(--sys-label)">SPK #{group.spkId}</p>
								<div class="flex items-center gap-1.5 mt-1">
									<div class="w-16 h-1.5 rounded-full overflow-hidden" style="background: var(--sys-sep)">
										<div class="h-full rounded-full" style="width: {(siapCount / group.items.length) * 100}%; background: #16A34A"></div>
									</div>
									<span class="text-[9.5px]" style="color: var(--sys-label3)">{siapCount}/{group.items.length} siap</span>
								</div>
							</div>
							{#if siapCount < group.items.length}
								<button
									class="shrink-0 px-2.5 py-1.5 rounded-lg text-[10.5px] font-semibold"
									style="background: var(--sys-fill-strong, #2563EB); color: white"
									onclick={() => markAllSiap(group)}
								>Tandai Semua Siap</button>
							{/if}
						</div>
						{#each group.items as item, idx (idx)}
							{@const k = progressKey(group.spkId, item.itemId)}
							<button
								id={`item-${item.itemId}`}
								class="w-full text-left p-3 border-t flex items-center justify-between gap-2 transition-colors"
								class:baris-disorot={highlightItemId === item.itemId}
								style="border-color: var(--sys-sep)"
								onclick={() => toggle(group.spkId, item.itemId, item.quantity)}
							>
								<div class="min-w-0">
									<p class="text-[12.5px] font-medium truncate" style="color: var(--sys-label)">{item.namaBarang}</p>
									<p class="text-[10.5px]" style="color: var(--sys-label3)">{item.quantity} {item.satuan}</p>
								</div>
								<div class="shrink-0 w-6 h-6 rounded-full flex items-center justify-center" style="background: {isSiap(group.spkId, item.itemId) ? '#16A34A' : 'var(--sys-fill)'}">
									{#if saving === k}
										<IconLoader2 size={12} class="animate-spin" color="white" />
									{:else if isSiap(group.spkId, item.itemId)}
										<IconCheck size={14} color="white" />
									{:else if wajibFoto}
										<IconCamera size={12} style="color: var(--sys-label4)" />
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	/* Dark mode gudang (cahaya minim) — sorotan hasil scan jangan menyilaukan. */
	.baris-disorot { background: #FEF9C3; }
	:global([data-theme='dark']) .baris-disorot { background: rgba(232, 178, 61, 0.18); }
</style>
