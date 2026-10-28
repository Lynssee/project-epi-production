<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { fetchSjiForServah, serahkanSji, type SerahkanItem } from '$lib/services/sjiApi';
	import { searchKaryawan } from '$lib/services/security';
	import { getCurrentPosition } from '$lib/utils/geoClient';
	import { dataUrlToBlob } from '$lib/services/proofOfDelivery';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import { sjiSerahkanItemsSchema } from '$lib/schemas/sjiSerahkan';
	import { IconLoader2, IconAlertTriangle, IconCircleCheck, IconMapPin, IconUserCheck, IconX } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';

	let id = $derived(Number($page.url.searchParams.get('id')));
	let token = $derived($page.url.searchParams.get('token') || '');
	// Tidak ada petugas gudang di tempat (kondisi asal SJI manual dibuat) — pemohon mengambil
	// barang sendiri, jadi wajib ada saksi + foto per item sebagai ganti kontrol PIC gudang.
	let mandiri = $derived($page.url.searchParams.get('mode') === 'mandiri');

	let loading = $state(true);
	let loadError = $state('');
	let header = $state<any>(null);
	let items = $state<SerahkanItem[]>([]);
	let selected = $state<Record<number, boolean>>({});

	let fotoFile = $state<File | null>(null);
	let fotoPerItem = $state<Record<string, File>>({});
	let signaturePad: any = $state(null);
	let lat = $state<number | null>(null);
	let lng = $state<number | null>(null);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}
	let gettingLocation = $state(false);

	let saksiQuery = $state('');
	let saksiResults = $state<{ id: number; nama_karyawan: string }[]>([]);
	let saksiSearching = $state(false);
	let saksiSelected = $state<{ id: number; nama_karyawan: string } | null>(null);
	let saksiKontak = $state('');
	let saksiSearchTimer: ReturnType<typeof setTimeout> | undefined;

	let submitting = $state(false);
	let submitError = $state('');
	let success = $state(false);
	let partialWarning = $state(false);

	// Jaring pengaman draf. Mode "mandiri" paling rawan: wajib foto PER ITEM, jadi
	// kamera native dibuka berkali-kali dan tab bisa mati di tengah jalan. Tanda tangan
	// SENGAJA tidak disimpan — itu langkah terakhir dan murah untuk diulang.
	interface SjiDraft {
		selected: Record<number, boolean>;
		saksiId: number | null;
		saksiNama: string;
		saksiKontak: string;
		itemFotoKeys: string[];
		hasFotoUmum: boolean;
	}
	const SJI_FOTO_UMUM_KEY = 'umum';
	let sjiPersist = $derived(createFormPersist<SjiDraft>(`sji_konfirmasi_${id}`));
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function sjiSnapshot(): SjiDraft {
		return {
			selected,
			saksiId: saksiSelected?.id ?? null,
			saksiNama: saksiSelected?.nama_karyawan ?? '',
			saksiKontak,
			itemFotoKeys: Object.keys(fotoPerItem),
			hasFotoUmum: !!fotoFile
		};
	}

	onMount(async () => {
		if (!Number.isFinite(id) || !token) {
			loadError = 'Link SJI tidak valid — pastikan dibuka lewat scan QR dokumen.';
			loading = false;
			return;
		}
		try {
			const res = await fetchSjiForServah(id, token);
			header = res.header;
			items = res.items;
			for (const it of items) selected[it.id] = true;

			const draft = sjiPersist.restore();
			if (draft) {
				// Centang dipulihkan hanya untuk item yang masih ada di SJI ini.
				for (const it of items) {
					if (typeof draft.selected?.[it.id] === 'boolean') selected[it.id] = draft.selected[it.id];
				}
				if (draft.saksiId) saksiSelected = { id: draft.saksiId, nama_karyawan: draft.saksiNama };
				saksiQuery = draft.saksiNama || '';
				saksiKontak = draft.saksiKontak || '';

				const restored: Record<string, File> = {};
				await Promise.all(
					(draft.itemFotoKeys || []).map(async (key) => {
						const blob = await sjiPersist.restorePhoto(key);
						if (blob) restored[key] = new File([blob], `${key}.jpg`, { type: blob.type || 'image/jpeg' });
					})
				);
				fotoPerItem = restored;

				if (draft.hasFotoUmum) {
					const blob = await sjiPersist.restorePhoto(SJI_FOTO_UMUM_KEY);
					if (blob) fotoFile = new File([blob], 'umum.jpg', { type: blob.type || 'image/jpeg' });
				}
				draftSavedAt = new Date();
			}
			draftArmed = true;
		} catch (e: any) {
			loadError = e?.message || 'Gagal memuat SJI.';
		} finally {
			loading = false;
		}

		if ('geolocation' in navigator) {
			gettingLocation = true;
			getCurrentPosition()
				.then((pos) => {
					lat = pos.lat;
					lng = pos.lng;
				})
				.catch(() => {})
				.finally(() => (gettingLocation = false));
		}
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void sjiSnapshot();
		if (!draftArmed) return;
		sjiPersist.save(sjiSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(sjiPersist, sjiSnapshot));

	function onFotoChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		fotoFile = file || null;
		if (fotoFile) sjiPersist.savePhoto(SJI_FOTO_UMUM_KEY, fotoFile);
		else sjiPersist.clearPhoto(SJI_FOTO_UMUM_KEY);
	}

	function onItemFotoChange(key: string, e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		const next = { ...fotoPerItem };
		if (file) next[key] = file;
		else delete next[key];
		fotoPerItem = next;
		if (file) sjiPersist.savePhoto(key, file);
		else sjiPersist.clearPhoto(key);
	}

	function onSaksiSearchInput() {
		clearTimeout(saksiSearchTimer);
		saksiSelected = null;
		if (saksiQuery.trim().length < 2) {
			saksiResults = [];
			return;
		}
		saksiSearchTimer = setTimeout(async () => {
			saksiSearching = true;
			try {
				const results = await searchKaryawan(saksiQuery);
				// Saksi tidak boleh sama dengan pemohon sendiri.
				const selfId = typeof header?.karyawan_id === 'object' ? header.karyawan_id?.id : header?.karyawan_id;
				saksiResults = results.filter((r) => r.id !== selfId);
			} catch {
				saksiResults = [];
			} finally {
				saksiSearching = false;
			}
		}, 300);
	}

	function pickSaksi(k: { id: number; nama_karyawan: string }) {
		saksiSelected = k;
		saksiQuery = k.nama_karyawan;
		saksiResults = [];
	}

	let selectedItems = $derived(items.filter((it) => selected[it.id]));
	let itemFotoOk = $derived(!mandiri || selectedItems.every((it) => !!fotoPerItem[`${it.collection}_${it.id}`]));
	let saksiOk = $derived(!mandiri || (!!saksiSelected && saksiKontak.trim().length > 0));
	let canSubmit = $derived(selectedItems.length > 0 && itemFotoOk && saksiOk && !submitting);

	async function handleSubmit() {
		if (!canSubmit) return;
		submitting = true;
		submitError = '';
		try {
			const itemsParsed = sjiSerahkanItemsSchema.safeParse(
				selectedItems.map((it) => ({ collection: it.collection, id: it.id }))
			);
			if (!itemsParsed.success) {
				submitError = itemsParsed.error.issues[0]?.message || 'Data item tidak valid.';
				submitting = false;
				return;
			}
			const ttdDataUrl = signaturePad && !signaturePad.isEmpty() ? signaturePad.toDataURL() : null;
			const ttdFile = ttdDataUrl ? new File([dataUrlToBlob(ttdDataUrl)], 'ttd.png', { type: 'image/png' }) : null;

			const fotoCompressed = !mandiri && fotoFile ? await compressPhoto(fotoFile) : null;
			const fotoPerItemCompressed = mandiri
				? Object.fromEntries(
						await Promise.all(
							selectedItems.map(async (it) => {
								const key = `${it.collection}_${it.id}`;
								return [key, await compressPhoto(fotoPerItem[key])] as const;
							})
						)
					)
				: undefined;

			const res = await serahkanSji(id, {
				token,
				items: itemsParsed.data,
				mode: mandiri ? 'mandiri' : 'petugas',
				foto: mandiri ? null : fotoCompressed,
				ttd: mandiri ? null : ttdFile,
				fotoPerItem: fotoPerItemCompressed,
				saksiKaryawanId: mandiri ? saksiSelected?.id : undefined,
				saksiKontak: mandiri ? saksiKontak.trim() : undefined,
				saksiTtd: mandiri ? ttdFile : undefined,
				lat,
				lng,
				clientTxnId: crypto.randomUUID()
			});
			partialWarning = res.partial;
			// Terkirim — draf lokal (termasuk semua foto per item) sudah tidak relevan.
			sjiPersist.clear();
			await sjiPersist.clearPhotos();
			draftSavedAt = null;
			success = true;
		} catch (e: any) {
			submitError = e?.message || 'Gagal memproses serah-terima.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat konfirmasi penerimaan SJI..." />
		</div>
	{:else if loadError}
		<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
			<div>{loadError}</div>
		</div>
	{:else if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: {partialWarning ? '#D97706' : '#16A34A'}; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">
				{partialWarning ? 'Sebagian item berhasil diserahkan' : 'Serah-terima tercatat'}
			</p>
			{#if partialWarning}
				<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Ada item yang gagal diproses (mis. stok kurang). Cek kembali SJI ini nanti.</p>
			{/if}
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/sji')}>
				Kembali ke Daftar SJI
			</button>
		</div>
	{:else if header}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">
			{mandiri ? 'Ambil Barang Sendiri' : 'Konfirmasi Serah-Terima'}
		</h1>
		<div class="flex items-center justify-between gap-2 mb-4">
			<p class="text-[11px]" style="color: var(--sys-label3)">
				{header.reference_no} · {header.gudang_id?.nama_gudang || '-'}
			</p>
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!fotoFile || Object.keys(fotoPerItem).length > 0} />
		</div>

		{#if mandiri}
			<div class="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-amber-800 text-[12px] mb-4">
				<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-amber-600" />
				<div>Tidak ada petugas gudang di tempat. Foto tiap barang wajib sesuai pengajuan, dan wajib ada saksi yang menyaksikan pengambilan ini.</div>
			</div>
		{/if}

		<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Pilih item yang diserahkan sekarang</p>
		<div class="flex flex-col gap-2 mb-4">
			{#each items as it (it.collection + '-' + it.id)}
				{@const itemKey = `${it.collection}_${it.id}`}
				<label class="p-3 rounded-lg border flex items-start gap-3" style="border-color: var(--sys-sep)">
					<input type="checkbox" class="mt-1" bind:checked={selected[it.id]} />
					<div class="min-w-0 flex-1">
						<div class="text-[13px] font-medium" style="color: var(--sys-label)">{it.item_id?.nama_barang_lengkap || '-'}</div>
						<div class="text-[11px]" style="color: var(--sys-label3)">
							{it.tipe === 'pinjam' ? 'Pinjam' : 'Ambil Pakai'} · Qty {it.quantity}{it.ukuran ? ` · ${it.ukuran}` : ''}
							{#if it.tipe === 'pinjam' && it.tanggal_jatuh_tempo}
								· Jatuh tempo {it.tanggal_jatuh_tempo}
							{/if}
						</div>
						{#if mandiri && selected[it.id]}
							<div class="mt-2">
								<p class="text-[10px] mb-1" style="color: var(--sys-label3)">Foto barang ini (wajib, sesuai jumlah & jenis di atas)</p>
								<input
									type="file"
									accept="image/*"
									capture="environment"
									class="w-full text-[11px]"
									onclick={(e) => e.stopPropagation()}
									onchange={(e) => onItemFotoChange(itemKey, e)}
								/>
							</div>
						{/if}
					</div>
				</label>
			{/each}
			{#if items.length === 0}
				<p class="text-[12px]" style="color: var(--sys-label3)">Semua item pada SJI ini sudah diproses.</p>
			{/if}
		</div>

		{#if items.length > 0}
			<div class="flex flex-col gap-4">
				{#if mandiri}
					<div>
						<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Saksi Pengambilan</p>
						<div class="relative">
							<input
								class="w-full rounded-lg border text-[13px] p-3"
								style="border-color: var(--sys-sep)"
								placeholder="Cari nama karyawan sebagai saksi..."
								bind:value={saksiQuery}
								oninput={onSaksiSearchInput}
							/>
							{#if saksiSelected}
								<IconUserCheck size={16} class="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600" />
							{/if}
						</div>
						{#if saksiSearching}
							<p class="text-[11px] mt-1.5" style="color: var(--sys-label3)">Mencari...</p>
						{:else if saksiResults.length > 0}
							<div class="mt-1.5 rounded-lg border overflow-hidden" style="border-color: var(--sys-sep)">
								{#each saksiResults as r (r.id)}
									<button
										class="w-full text-left p-2.5 text-[12px] border-b last:border-b-0 hover:bg-slate-50"
										style="border-color: var(--sys-sep); color: var(--sys-label)"
										onclick={() => pickSaksi(r)}
									>
										{r.nama_karyawan}
									</button>
								{/each}
							</div>
						{/if}
						{#if saksiSelected}
							<div class="mt-2 flex items-center justify-between p-2 rounded-lg" style="background: var(--sys-fill)">
								<span class="text-[12px] font-medium" style="color: var(--sys-label)">{saksiSelected.nama_karyawan}</span>
								<button aria-label="Batal" onclick={() => { saksiSelected = null; saksiQuery = ''; }}><IconX size={14} class="text-red-500" /></button>
							</div>
						{/if}
						<input
							class="w-full rounded-lg border text-[13px] p-3 mt-2"
							style="border-color: var(--sys-sep)"
							placeholder="No. HP saksi"
							bind:value={saksiKontak}
						/>
					</div>

					<div>
						<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Tanda Tangan Saksi</p>
						<SignaturePad bind:this={signaturePad} height={140} />
					</div>
				{:else}
					<div>
						<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Foto Bukti Serah</p>
						<input type="file" accept="image/*" capture="environment" class="w-full text-[12px]" onchange={onFotoChange} />
					</div>

					<div>
						<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Tanda Tangan Penerima</p>
						<SignaturePad bind:this={signaturePad} height={140} />
					</div>
				{/if}

				<div class="flex items-center gap-2 text-[11px]" style="color: var(--sys-label3)">
					<IconMapPin size={15} class={gettingLocation ? 'animate-pulse text-amber-500' : lat ? 'text-emerald-600' : 'text-slate-400'} />
					{#if gettingLocation}
						<span>Mengambil titik GPS lokasi...</span>
					{:else if lat && lng}
						<span class="text-emerald-700 font-medium">GPS Terdeteksi: {lat.toFixed(5)}, {lng.toFixed(5)}</span>
					{:else}
						<span>Lokasi GPS tidak tersedia</span>
					{/if}
				</div>
				{#if lat && lng}
					<button type="button" class="text-[11px] font-semibold text-emerald-700" onclick={toggleLocationMap}>
						📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
					</button>
					{#if showLocationMap && LocationMap}
						<div transition:slide={{ duration: 200 }}>
							<LocationMap {lat} {lng} label="Lokasi konfirmasi SJI" height="200px" />
						</div>
					{/if}
				{/if}

				{#if submitError}
					<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
						<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
						<div>{submitError}</div>
					</div>
				{/if}

				<button
					class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
					style="background: var(--p, var(--g))"
					disabled={!canSubmit}
					onclick={handleSubmit}
				>
					{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
					{mandiri ? 'Konfirmasi Pengambilan' : 'Konfirmasi Serah-Terima'} ({selectedItems.length})
				</button>
			</div>
		{/if}
	{/if}
</div>
