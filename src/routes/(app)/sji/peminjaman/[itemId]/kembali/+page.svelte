<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import { kembalikanPeminjaman } from '$lib/services/sjiApi';
	import { getCurrentPosition } from '$lib/utils/geoClient';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconAlertTriangle, IconCamera, IconX } from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { sjiKembaliSchema } from '$lib/schemas/sjiKembali';

	let itemId = $derived(Number($page.params.itemId));

	let kondisi = $state<'baik' | 'rusak' | 'hilang'>('baik');
	let catatan = $state('');
	let fotoFile = $state<File | null>(null);
	let fotoPreview = $state<string | null>(null);
	let lat = $state<number | null>(null);
	let lng = $state<number | null>(null);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}

	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);

	// Jaring pengaman draf: kondisi barang difoto dulu baru catatannya diketik,
	// jadi tab bisa mati sebelum apa pun terkirim. Dikunci per item pinjaman.
	interface KembaliDraft {
		kondisi: 'baik' | 'rusak' | 'hilang';
		catatan: string;
	}
	const KEMBALI_PHOTO_KEY = 'kondisi';
	let kembaliPersist = $derived(createFormPersist<KembaliDraft>(`sji_kembali_${itemId}`));
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function kembaliSnapshot(): KembaliDraft {
		return { kondisi, catatan };
	}

	onMount(async () => {
		const draft = kembaliPersist.restore();
		if (draft) {
			kondisi = draft.kondisi;
			catatan = draft.catatan;
			const blob = await kembaliPersist.restorePhoto(KEMBALI_PHOTO_KEY);
			if (blob) {
				fotoFile = new File([blob], 'kondisi.jpg', { type: blob.type || 'image/jpeg' });
				fotoPreview = URL.createObjectURL(fotoFile);
			}
			draftSavedAt = new Date();
		}
		draftArmed = true;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void kembaliSnapshot();
		if (!draftArmed) return;
		kembaliPersist.save(kembaliSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(kembaliPersist, kembaliSnapshot));

	function handleFotoChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		fotoFile = file;
		fotoPreview = URL.createObjectURL(file);
		kembaliPersist.savePhoto(KEMBALI_PHOTO_KEY, file);
	}

	async function handleSubmit() {
		submitting = true;
		errorMsg = '';
		try {
			const pos = await getCurrentPosition().catch(() => null);
			if (pos) {
				lat = pos.lat;
				lng = pos.lng;
			}
			const parsed = sjiKembaliSchema.safeParse({
				kondisi_kembali: kondisi,
				catatan_pengecekan: catatan,
				lat,
				lng
			});
			if (!parsed.success) {
				errorMsg = parsed.error.issues[0]?.message || 'Data pengembalian tidak valid.';
				submitting = false;
				return;
			}
			const compressedFoto = fotoFile ? await compressPhoto(fotoFile) : null;
			await kembalikanPeminjaman(itemId, { ...parsed.data, foto: compressedFoto });
			// Terkirim — draf lokal (termasuk foto di IndexedDB) sudah tidak relevan.
			kembaliPersist.clear();
			await kembaliPersist.clearPhotos();
			draftSavedAt = null;
			success = true;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memproses pengembalian.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => history.back()}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Pengembalian tercatat</p>
			{#if lat && lng}
				<button type="button" class="mt-3 text-[11px] font-semibold text-emerald-700" onclick={toggleLocationMap}>
					📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi pengembalian'}
				</button>
				{#if showLocationMap && LocationMap}
					<div transition:slide={{ duration: 200 }} class="mt-2 text-left">
						<LocationMap {lat} {lng} label="Lokasi pengembalian" height="200px" />
					</div>
				{/if}
			{/if}
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/sji')}>
				Kembali ke Daftar SJI
			</button>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Kembalikan Barang</h1>
		<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!fotoFile} />
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Catat kondisi barang saat dikembalikan</p>

		<div class="flex flex-col gap-4">
			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Kondisi Barang</p>
				<div class="grid grid-cols-3 gap-2">
					{#each [['baik', 'Baik'], ['rusak', 'Rusak'], ['hilang', 'Hilang']] as [val, label] (val)}
						<button
							class="h-10 rounded-lg text-[12px] font-semibold border {kondisi === val ? 'text-white' : ''}"
							style={kondisi === val ? 'background: var(--p, var(--g)); border-color: transparent' : 'border-color: var(--sys-sep); color: var(--sys-label)'}
							onclick={() => (kondisi = val as 'baik' | 'rusak' | 'hilang')}
						>
							{label}
						</button>
					{/each}
				</div>
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="catatan">Catatan Pengecekan</label>
				<textarea id="catatan" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" rows="2" bind:value={catatan}></textarea>
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Foto Kondisi (opsional)</p>
				{#if fotoPreview}
					<div class="relative w-28 h-28 mb-2">
						<img src={fotoPreview} alt="Preview" class="w-28 h-28 object-cover rounded-lg" />
						<button class="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-white" style="background: #DC2626" onclick={() => { fotoFile = null; fotoPreview = null; }}>
							<IconX size={14} />
						</button>
					</div>
				{:else}
					<label class="w-28 h-28 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer" style="border-color: var(--sys-sep)">
						<IconCamera size={22} style="color: var(--sys-label4)" />
						<span class="text-[10px]" style="color: var(--sys-label4)">Ambil foto</span>
						<input type="file" accept="image/*" capture="environment" class="hidden" onchange={handleFotoChange} />
					</label>
				{/if}
			</div>

			{#if errorMsg}
				<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
					<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
					<div>{errorMsg}</div>
				</div>
			{/if}

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--p, var(--g))"
				disabled={submitting}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Kirim Pengembalian
			</button>
		</div>
	{/if}
</div>
