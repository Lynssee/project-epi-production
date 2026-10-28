<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import {
		searchReceivedShipments,
		submitManualComplaint,
		type ReceivedSJ,
		type ManualComplaintType
	} from '$lib/services/goodsReceived';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconAlertTriangle, IconSearch } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { onMount } from 'svelte';

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_stock_lapangan', roles)) {
			goto('/');
		}
	});

	const TIPE_LABEL: Record<ManualComplaintType, string> = {
		wrong_item: 'Barang Salah',
		damaged: 'Rusak',
		quality_issue: 'Masalah Mutu',
		other: 'Lainnya'
	};

	let search = $state('');
	let searching = $state(false);
	let results = $state<ReceivedSJ[]>([]);
	let selected = $state<ReceivedSJ | null>(null);

	let tipeKomplain = $state<ManualComplaintType>('quality_issue');
	let keterangan = $state('');
	let photos = $state<File[]>([]);
	let submitting = $state(false);
	let errorMsg = $state('');
	let successInfo = $state<{ claimId: number | null } | null>(null);

	// Jaring pengaman draf. Foto di sini WAJIB (canSubmit menuntut photos.length > 0),
	// jadi user pasti membuka kamera native — titik paling rawan tab dibunuh OS.
	// Fotonya banyak, jadi disimpan sebagai `foto_<i>` + jumlahnya dicatat di draf.
	interface KomplainStokDraft {
		sj: ReceivedSJ | null;
		tipeKomplain: ManualComplaintType;
		keterangan: string;
		photoCount: number;
	}
	const komplainPersist = createFormPersist<KomplainStokDraft>('stock_komplain');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function komplainSnapshot(): KomplainStokDraft {
		return { sj: selected, tipeKomplain, keterangan, photoCount: photos.length };
	}

	/** Tulis ulang SEMUA foto ke IndexedDB; dipanggil tiap daftar foto berubah. */
	async function persistPhotos() {
		await komplainPersist.clearPhotos();
		await Promise.all(photos.map((f, i) => komplainPersist.savePhoto(`foto_${i}`, f)));
	}

	onMount(async () => {
		const draft = komplainPersist.restore();
		if (draft) {
			// SJ disimpan utuh: datanya read-only (nomor & tanggal terima) dan tidak
			// dipakai untuk menghitung apa pun, jadi aman tanpa fetch ulang.
			selected = draft.sj;
			if (draft.sj) search = draft.sj.nomor_sj;
			tipeKomplain = draft.tipeKomplain;
			keterangan = draft.keterangan;
			const blobs = await Promise.all(
				Array.from({ length: draft.photoCount || 0 }, (_, i) => komplainPersist.restorePhoto(`foto_${i}`))
			);
			photos = blobs
				.map((b, i) => (b ? new File([b], `foto_${i}.jpg`, { type: b.type || 'image/jpeg' }) : null))
				.filter((f): f is File => !!f);
			draftSavedAt = new Date();
		}
		draftArmed = true;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void komplainSnapshot();
		if (!draftArmed) return;
		komplainPersist.save(komplainSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(komplainPersist, komplainSnapshot));

	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	function onSearchInput() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(async () => {
			if (search.trim().length < 2) {
				results = [];
				return;
			}
			searching = true;
			try {
				results = await searchReceivedShipments(search.trim());
			} finally {
				searching = false;
			}
		}, 350);
	}

	function selectSj(sj: ReceivedSJ) {
		selected = sj;
		results = [];
		search = sj.nomor_sj;
	}

	function onPhotosChange(e: Event) {
		photos = Array.from((e.target as HTMLInputElement).files || []);
		persistPhotos();
	}

	let canSubmit = $derived(!!selected && !!keterangan.trim() && photos.length > 0 && !submitting);

	async function handleSubmit() {
		if (!canSubmit || !selected) return;
		submitting = true;
		errorMsg = '';
		try {
			const evidenceFileIds: string[] = [];
			for (const photo of photos) {
				const compressed = await compressPhoto(photo);
				const id = await uploadEvidencePhoto(compressed, 'stock_lapangan:komplain_manual');
				if (id) evidenceFileIds.push(id);
			}
			if (evidenceFileIds.length === 0) throw new Error('Gagal mengunggah foto bukti. Coba lagi.');

			const result = await submitManualComplaint({
				suratJalanId: selected.id,
				tipeKomplain,
				keterangan,
				evidenceFileIds
			});
			// Terkirim — draf lokal (termasuk foto di IndexedDB) sudah tidak relevan.
			komplainPersist.clear();
			await komplainPersist.clearPhotos();
			draftSavedAt = null;
			successInfo = { claimId: result.claimId };
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim komplain.';
		} finally {
			submitting = false;
		}
	}

	function resetForm() {
		selected = null;
		search = '';
		results = [];
		tipeKomplain = 'quality_issue';
		keterangan = '';
		photos = [];
		successInfo = null;
		errorMsg = '';
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/stock-lapangan')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<div class="flex items-center justify-between gap-2">
		<h1 class="text-[16px] font-bold flex items-center gap-2" style="color: var(--sys-label)">
			<IconAlertTriangle size={18} /> Komplain Barang
		</h1>
		<DraftIndicator savedAt={draftSavedAt} hasPhotos={photos.length > 0} />
	</div>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Lapor masalah yang baru terlihat setelah barang diterima — salah barang, rusak, atau mutu tidak sesuai.</p>

	{#if successInfo}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Komplain terkirim</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Tim Admin/Inventory akan meninjau dan menindaklanjuti.</p>
			<div class="flex gap-2 justify-center mt-5">
				<button class="px-4 py-2 rounded-lg text-[12px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={resetForm}>
					Lapor Lagi
				</button>
				<button class="px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/stock-lapangan')}>
					Kembali ke Hub
				</button>
			</div>
		</div>
	{:else}
		<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Cari Surat Jalan (nomor SJ)</label>
		<div class="relative mt-1 mb-2">
			<input
				class="w-full rounded-lg border text-[13px] p-2.5 pr-8"
				style="border-color: var(--sys-sep)"
				placeholder="Ketik nomor SJ..."
				bind:value={search}
				oninput={onSearchInput}
			/>
			{#if searching}
				<IconLoader2 size={16} class="animate-spin absolute right-2.5 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
			{:else}
				<IconSearch size={16} class="absolute right-2.5 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
			{/if}
		</div>

		{#if results.length > 0}
			<div class="rounded-xl border divide-y mb-4" style="border-color: var(--sys-sep)">
				{#each results as sj (sj.id)}
					<button class="w-full text-left p-3" onclick={() => selectSj(sj)}>
						<p class="text-[12.5px] font-medium" style="color: var(--sys-label)">SJ {sj.nomor_sj}</p>
						<p class="text-[10.5px]" style="color: var(--sys-label3)">Driver: {sj.driver || '-'} · Status: {sj.status}</p>
					</button>
				{/each}
			</div>
		{/if}

		{#if selected}
			<div class="rounded-xl border p-3 mb-4" style="border-color: var(--sys-sep); background: var(--sys-fill)">
				<p class="text-[13px] font-semibold" style="color: var(--sys-label)">SJ {selected.nomor_sj} terpilih</p>
				<button class="text-[11px] underline mt-1" style="color: var(--sys-label3)" onclick={() => (selected = null)}>Ganti SJ</button>
			</div>

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Jenis Masalah</label>
			<select class="w-full mt-1 mb-3 rounded-lg border text-[13px] p-2.5" style="border-color: var(--sys-sep)" bind:value={tipeKomplain}>
				{#each Object.entries(TIPE_LABEL) as [val, label]}
					<option value={val}>{label}</option>
				{/each}
			</select>

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Keterangan (wajib)</label>
			<textarea
				class="w-full mt-1 mb-3 rounded-lg border text-[12px] p-2.5"
				style="border-color: var(--sys-sep)"
				rows="3"
				placeholder="Jelaskan masalahnya..."
				bind:value={keterangan}
			></textarea>

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Foto Bukti (wajib, bisa lebih dari satu)</label>
			<input type="file" accept="image/*" multiple capture="environment" class="w-full mt-1 mb-3 text-[12px]" onchange={onPhotosChange} />

			{#if errorMsg}
				<p class="text-[12px] mt-2" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<button
				class="w-full h-12 mt-3 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--g)"
				disabled={!canSubmit}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Kirim Komplain
			</button>
		{/if}
	{/if}
</div>
