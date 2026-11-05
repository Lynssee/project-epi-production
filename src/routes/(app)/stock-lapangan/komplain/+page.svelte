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
		fetchSjBarang,
		type SjBarang,
		type ReceivedSJ,
		type ManualComplaintType,
		type ManualComplaintSource
	} from '$lib/services/goodsReceived';
	import { submitReturPengajuan } from '$lib/services/packingList';
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
	// Hanya dipakai bila tipe 'Barang Salah' — menentukan jalur tindak lanjut Admin (retur/tukar vs alihkan ke stok bebas).
	let sumberMasalah = $state<ManualComplaintSource>('salah_kirim_gudang');
	const SUMBER_LABEL: Record<ManualComplaintSource, string> = {
		salah_kirim_gudang: 'Salah kirim dari Gudang / Vendor',
		salah_pesan_proyek: 'Salah pesan dari Proyek (spek di PR/PO keliru)'
	};
	// Barang pada SJ terpilih yang bisa ditandai bermasalah. Yang dipilih = DIKUNCI dari Laporan Harian sampai Admin memutuskan.
	let sjBarang = $state<SjBarang[]>([]);
	let pilihBarang = $state<Record<number, boolean>>({});
	let loadingBarang = $state(false);
	let barangMuat = $state(false);
	let keterangan = $state('');
	let photos = $state<File[]>([]);
	let submitting = $state(false);

	async function muatBarang(sjId: number) {
		loadingBarang = true;
		try {
			sjBarang = await fetchSjBarang(sjId);
		} finally {
			loadingBarang = false;
			barangMuat = true;
		}
	}
	let errorMsg = $state('');
	let successInfo = $state<{ claimId: number | null; lockedItems: number } | null>(null);

	// Retur satu klik dari barang yang dikomplain: memakai alur retur lapangan yang sama (/api/retur-gudang) — gate retur dobel,
	// cek saldo & kunci mutasi tetap berlaku. Idempoten lewat clientSubmissionId = komplain-<claimId> (klik ganda tak membuat dokumen dobel).
	type ReturSiap = NonNullable<Awaited<ReturnType<typeof submitManualComplaint>>['returSiap']>;
	let returSiap = $state<ReturSiap | null>(null);
	let returQty = $state<Record<number, number>>({});
	let returSubmitting = $state(false);
	let returError = $state('');
	let returHasil = $state<{ nomor: string; idempotent: boolean } | null>(null);

	async function ajukanRetur() {
		if (!returSiap || !successInfo || returSubmitting) return;
		const items = returSiap.items
			.map((it) => ({ ...it, qty_returned: Number(returQty[it.item_id]) || 0 }))
			.filter((it) => it.qty_returned > 0);
		if (items.length === 0) {
			returError = 'Isi jumlah yang akan dikembalikan (lebih dari 0).';
			return;
		}
		returSubmitting = true;
		returError = '';
		try {
			const r = await submitReturPengajuan(returSiap.projectId, items, {
				clientSubmissionId: `komplain-${successInfo.claimId ?? 'x'}-${returSiap.projectId}`,
				notes: `Retur dari komplain SJ ${returSiap.nomorSj}`
			});
			returHasil = { nomor: r.doc?.nomor_retur || '(nomor menyusul)', idempotent: r.idempotent };
		} catch (e: any) {
			// Pesan asli server (mis. retur dobel / qty melebihi saldo) ditampilkan apa adanya.
			returError = e?.message || 'Gagal mengajukan retur.';
		} finally {
			returSubmitting = false;
		}
	}

	// Jaring pengaman draf. Foto di sini WAJIB (canSubmit menuntut photos.length > 0),
	// jadi user pasti membuka kamera native — titik paling rawan tab dibunuh OS.
	// Fotonya banyak, jadi disimpan sebagai `foto_<i>` + jumlahnya dicatat di draf.
	interface KomplainStokDraft {
		sj: ReceivedSJ | null;
		tipeKomplain: ManualComplaintType;
		sumberMasalah?: ManualComplaintSource;
		pilihBarang?: number[];
		keterangan: string;
		photoCount: number;
	}
	const komplainPersist = createFormPersist<KomplainStokDraft>('stock_komplain');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function komplainSnapshot(): KomplainStokDraft {
		return {
			sj: selected,
			tipeKomplain,
			sumberMasalah,
			pilihBarang: Object.keys(pilihBarang).filter((k) => pilihBarang[Number(k)]).map(Number),
			keterangan,
			photoCount: photos.length
		};
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
			sumberMasalah = draft.sumberMasalah ?? 'salah_kirim_gudang';
			pilihBarang = Object.fromEntries((draft.pilihBarang ?? []).map((id) => [id, true]));
			if (draft.sj) muatBarang(draft.sj.id);
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
		pilihBarang = {};
		sjBarang = [];
		barangMuat = false;
		muatBarang(sj.id);
	}

	let jumlahDipilih = $derived(Object.values(pilihBarang).filter(Boolean).length);
	// Tipe fisik (salah barang/rusak/mutu) wajib memilih barang bila SJ punya barang master — supaya bisa dikunci.
	let wajibPilihBarang = $derived(tipeKomplain !== 'other' && sjBarang.length > 0);

	function onPhotosChange(e: Event) {
		photos = Array.from((e.target as HTMLInputElement).files || []);
		persistPhotos();
	}

	let canSubmit = $derived(
		!!selected && !!keterangan.trim() && photos.length > 0 && !submitting && !loadingBarang && (!wajibPilihBarang || jumlahDipilih > 0)
	);

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
				evidenceFileIds,
				...(tipeKomplain === 'wrong_item' ? { sumberMasalah } : {}),
				items: sjBarang.filter((b) => pilihBarang[b.identitasBarangId]).map((b) => ({ identitasBarangId: b.identitasBarangId }))
			});
			// Terkirim — draf lokal (termasuk foto di IndexedDB) sudah tidak relevan.
			komplainPersist.clear();
			await komplainPersist.clearPhotos();
			draftSavedAt = null;
			successInfo = { claimId: result.claimId, lockedItems: result.lockedItems ?? 0 };
			returSiap = result.returSiap ?? null;
			returQty = Object.fromEntries((result.returSiap?.items ?? []).map((it) => [it.item_id, it.qty_returned]));
			returHasil = null;
			returError = '';
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
		sumberMasalah = 'salah_kirim_gudang';
		sjBarang = [];
		pilihBarang = {};
		barangMuat = false;
		keterangan = '';
		photos = [];
		successInfo = null;
		returSiap = null;
		returQty = {};
		returHasil = null;
		returError = '';
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
			<p class="text-[11px] mt-2 px-4" style="color: var(--sys-label3)">
				{#if successInfo.lockedItems > 0}
					{successInfo.lockedItems} barang <b>dikunci</b> dari Laporan Harian sampai Admin memutuskan. Kunci lepas otomatis setelah komplain diselesaikan.
				{:else}
					Sambil menunggu keputusan, <b>jangan pakai barang ini</b> di laporan harian (barang tidak terkunci otomatis karena tidak dipilih dari daftar).
				{/if}
			</p>
			{#if tipeKomplain === 'wrong_item' || tipeKomplain === 'damaged'}
				<div class="mx-4 mt-3 rounded-xl p-3 text-left" style="background: var(--sys-fill)">
					<p class="text-[11.5px] font-semibold" style="color: var(--sys-label)">Barang akan dikembalikan ke gudang?</p>
					{#if returHasil}
						<p class="text-[11.5px] mt-1.5 font-semibold" style="color: #16A34A">
							✓ {returHasil.idempotent ? 'Retur ini sudah diajukan sebelumnya' : 'Retur diajukan'}: {returHasil.nomor}
						</p>
						<p class="text-[10.5px] mt-0.5" style="color: var(--sys-label3)">Tim Inventory akan menyiapkan Surat Jalan Pengambilan. Pantau di Status Pengembalian.</p>
					{:else if returSiap}
						<p class="text-[10.5px] mt-0.5" style="color: var(--sys-label3)">
							Admin yang memutuskan retur atau barang pengganti, tetapi bila sudah jelas barang harus ditarik, ajukan retur fisiknya sekarang agar tim Inventory menyiapkan Surat Jalan Pengambilan. Cek jumlahnya dulu.
						</p>
						<div class="mt-2 space-y-2">
							{#each returSiap.items as it (it.item_id)}
								<div class="flex items-center gap-2">
									<span class="flex-1 text-[11.5px]" style="color: var(--sys-label)">{it.material_name}</span>
									<input type="number" min="0" step="any" class="w-20 rounded-lg border text-[12px] p-1.5 text-right" style="border-color: var(--sys-sep)" bind:value={returQty[it.item_id]} />
									<span class="text-[10.5px] w-10" style="color: var(--sys-label3)">{it.unit}</span>
								</div>
							{/each}
						</div>
						{#if returError}<p class="text-[11px] mt-2" style="color: #DC2626">{returError}</p>{/if}
						<div class="flex gap-2 mt-2.5">
							<button class="px-3 py-1.5 rounded-lg text-[11.5px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={returSubmitting} onclick={ajukanRetur}>
								{returSubmitting ? 'Mengajukan…' : 'Ajukan Retur Sekarang'}
							</button>
							<button class="px-3 py-1.5 rounded-lg text-[11.5px] font-semibold" style="background: var(--sys-fill2, rgba(0,0,0,0.06)); color: var(--sys-label)" onclick={() => goto('/packing-list/return')}>
								Nanti / lewat halaman retur
							</button>
						</div>
					{:else}
						<p class="text-[10.5px] mt-0.5" style="color: var(--sys-label3)">
							Admin yang memutuskan retur atau barang pengganti. Bila barang harus ditarik, ajukan retur fisiknya lewat halaman retur agar tim Inventory menyiapkan Surat Jalan Pengambilan.
						</p>
						<button class="mt-2 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/packing-list/return')}>
							Ajukan Retur Barang
						</button>
					{/if}
				</div>
			{/if}
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

			{#if tipeKomplain === 'wrong_item'}
				<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Siapa yang keliru? (wajib dipilih)</label>
				<select class="w-full mt-1 mb-1 rounded-lg border text-[13px] p-2.5" style="border-color: var(--sys-sep)" bind:value={sumberMasalah}>
					{#each Object.entries(SUMBER_LABEL) as [val, label]}
						<option value={val}>{label}</option>
					{/each}
				</select>
				<p class="text-[10.5px] mb-3" style="color: var(--sys-label3)">
					Pilih <b>Salah kirim</b> bila barang yang datang tidak sesuai surat jalan/pesanan (Admin akan retur atau minta barang pengganti).
					Pilih <b>Salah pesan</b> bila barang sesuai pesanan tapi ternyata spek yang diminta proyek keliru (Admin akan alihkan ke stok gudang atau tukar tambah).
				</p>
			{/if}

			{#if tipeKomplain !== 'other'}
				<p class="text-[11px] font-semibold" style="color: var(--sys-label3)">
					Barang yang bermasalah {wajibPilihBarang ? '(wajib pilih minimal satu)' : ''}
				</p>
				{#if loadingBarang}
					<p class="text-[11px] mt-1 mb-3 flex items-center gap-1.5" style="color: var(--sys-label4)"><IconLoader2 size={13} class="animate-spin" /> Memuat daftar barang...</p>
				{:else if sjBarang.length > 0}
					<div class="rounded-xl border divide-y mt-1 mb-1" style="border-color: var(--sys-sep)">
						{#each sjBarang as b (b.identitasBarangId)}
							<label class="flex items-center gap-2.5 p-2.5 text-[12.5px]" style="color: var(--sys-label)">
								<input type="checkbox" bind:checked={pilihBarang[b.identitasBarangId]} />
								<span class="flex-1">{b.namaBarang}</span>
								<span class="text-[10.5px]" style="color: var(--sys-label3)">dikirim {b.qtySent}</span>
							</label>
						{/each}
					</div>
					<p class="text-[10.5px] mb-3" style="color: var(--sys-label3)">
						Barang yang dicentang <b>dikunci</b>: tidak bisa dipakai di Laporan Harian sampai Admin Gudang memutuskan (retur / pengganti / alihkan stok).
					</p>
				{:else if barangMuat}
					<p class="text-[10.5px] mt-1 mb-3" style="color: var(--sys-label3)">
						Daftar barang SJ ini tidak tersedia (barang non-master atau gagal dimuat) — komplain tetap bisa dikirim, tetapi barangnya tidak terkunci otomatis. Sebutkan nama barang di keterangan.
					</p>
				{/if}
			{/if}

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
