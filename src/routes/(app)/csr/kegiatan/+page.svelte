<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { fetchActivePrograms, submitKegiatan, getCurrentPosition, type CsrProgram } from '$lib/services/csr';
	import { IconArrowLeft, IconLoader2, IconCamera, IconMapPin, IconTrash } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { csrKegiatanSchema } from '$lib/schemas/csrKegiatan';
	import VoiceInputButton from '$lib/components/shared/VoiceInputButton.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';

	let loading = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');
	let programs = $state<CsrProgram[]>([]);

	let programId = $state<number | null>(Number(page.url.searchParams.get('program_id')) || null);
	let jenis = $state('');
	let jumlahPenerima = $state(0);
	let catatanLapangan = $state('');
	let photos = $state<File[]>([]);
	let photoPreviews = $state<string[]>([]);
	let gps = $state<{ lat: number; lng: number } | null>(null);
	let gpsLoading = $state(true);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — GPS sudah ditangkap & ditampilkan
	// sebagai teks mentah, sebelumnya tidak pernah sebagai peta. Lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'access_csr', roles)) {
			goto('/');
		}
	});

	// Jaring pengaman draf: minimal satu foto WAJIB dan biasanya diambil beberapa
	// (dokumentasi kegiatan), jadi kamera native dibuka berulang kali setelah catatan
	// lapangan diketik. Foto disimpan sebagai `foto_<i>` + jumlahnya dicatat di draf.
	interface CsrDraft {
		programId: number | null;
		jenis: string;
		jumlahPenerima: number;
		catatanLapangan: string;
		photoCount: number;
	}
	const csrPersist = createFormPersist<CsrDraft>('csr_kegiatan');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function csrSnapshot(): CsrDraft {
		return { programId, jenis, jumlahPenerima, catatanLapangan, photoCount: photos.length };
	}

	/** Tulis ulang SEMUA foto ke IndexedDB; dipanggil tiap daftar foto berubah. */
	async function persistPhotos() {
		await csrPersist.clearPhotos();
		await Promise.all(photos.map((f, i) => csrPersist.savePhoto(`foto_${i}`, f)));
	}

	onMount(async () => {
		try {
			programs = await fetchActivePrograms();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat program CSR.';
		}
		loading = false;

		const draft = csrPersist.restore();
		if (draft) {
			// program_id dari query string menang atas draf — itu konteks yang baru
			// saja dipilih user saat membuka halaman ini.
			programId = Number(page.url.searchParams.get('program_id')) || draft.programId;
			jenis = draft.jenis;
			jumlahPenerima = draft.jumlahPenerima;
			catatanLapangan = draft.catatanLapangan;
			const blobs = await Promise.all(
				Array.from({ length: draft.photoCount || 0 }, (_, i) => csrPersist.restorePhoto(`foto_${i}`))
			);
			const restored = blobs
				.map((b, i) => (b ? new File([b], `foto_${i}.jpg`, { type: b.type || 'image/jpeg' }) : null))
				.filter((f): f is File => !!f);
			photos = restored;
			photoPreviews = restored.map((f) => URL.createObjectURL(f));
			draftSavedAt = new Date();
		}
		draftArmed = true;

		gps = await getCurrentPosition();
		gpsLoading = false;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void csrSnapshot();
		if (!draftArmed) return;
		csrPersist.save(csrSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(csrPersist, csrSnapshot));

	function onPhotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files || []);
		for (const file of files) {
			photos = [...photos, file];
			photoPreviews = [...photoPreviews, URL.createObjectURL(file)];
		}
		input.value = '';
		persistPhotos();
	}

	function removePhoto(i: number) {
		photos = photos.filter((_, idx) => idx !== i);
		photoPreviews = photoPreviews.filter((_, idx) => idx !== i);
		persistPhotos();
	}

	async function submit() {
		errorMsg = '';
		successMsg = '';
		if (photos.length === 0) { errorMsg = 'Minimal satu foto bukti kegiatan wajib diunggah.'; return; }
		const parsed = csrKegiatanSchema.safeParse({
			program_id: programId,
			jenis,
			jumlah_penerima: jumlahPenerima,
			catatan_lapangan: catatanLapangan,
			lat: gps?.lat ?? null,
			lng: gps?.lng ?? null
		});
		if (!parsed.success) {
			errorMsg = parsed.error.issues[0]?.message || 'Data kegiatan CSR tidak valid.';
			return;
		}

		saving = true;
		try {
			const compressedPhotos = await Promise.all(photos.map((f) => compressPhoto(f)));
			await submitKegiatan({ ...parsed.data, photos: compressedPhotos });
			// Terkirim — draf lokal (termasuk semua foto di IndexedDB) sudah tidak relevan.
			csrPersist.clear();
			await csrPersist.clearPhotos();
			draftSavedAt = null;
			successMsg = 'Kegiatan CSR berhasil dicatat. Menunggu verifikasi Admin.';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal mengirim kegiatan.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/csr')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Catat Kegiatan CSR</h1>
			<div class="ml-auto"><DraftIndicator savedAt={draftSavedAt} hasPhotos={photos.length > 0} /></div>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat kegiatan CSR..." />
		{:else}
			{#if errorMsg}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
			{/if}
			{#if successMsg}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>
			{/if}

			{#if !successMsg}
				<div class="flex flex-col gap-3">
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Program CSR</label>
						<select
							class="w-full rounded-lg px-3 py-2.5 text-[13px]"
							style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
							bind:value={programId}
						>
							<option value={null}>— pilih program —</option>
							{#each programs as p (p.id)}<option value={p.id}>{p.nama} ({p.pilar})</option>{/each}
						</select>
					</div>

					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Jenis Kegiatan</label>
						<input
							type="text"
							placeholder="mis. Bakti sosial, penyerahan bantuan, penanaman pohon"
							class="w-full rounded-lg px-3 py-2.5 text-[13px]"
							style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
							bind:value={jenis}
						/>
					</div>

					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Jumlah Penerima (perkiraan)</label>
						<input
							type="number"
							min="0"
							class="w-full rounded-lg px-3 py-2.5 text-[13px]"
							style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
							bind:value={jumlahPenerima}
						/>
					</div>

					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Catatan Lapangan</label>
						<div class="flex items-start gap-1.5">
							<textarea
								rows="3"
								class="w-full rounded-lg px-3 py-2.5 text-[13px]"
								style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
								bind:value={catatanLapangan}
							></textarea>
							<VoiceInputButton onResult={(text) => (catatanLapangan = catatanLapangan ? `${catatanLapangan} ${text}` : text)} />
						</div>
					</div>

					<div class="rounded-lg p-3 flex items-center gap-2 text-[11px]" style="background: var(--sys-fill); color: var(--sys-label3)">
						<IconMapPin size={14} />
						{#if gpsLoading}
							Mengambil lokasi GPS…
						{:else if gps}
							Lokasi tercatat: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
						{:else}
							Lokasi GPS tidak tersedia (izin ditolak/sinyal lemah) — kegiatan tetap bisa disimpan tanpa titik GPS.
						{/if}
					</div>
					{#if gps}
						<button
							type="button"
							class="text-[11px] font-semibold flex items-center gap-1 -mt-2"
							style="color: var(--sys-tint, #1F6592)"
							onclick={toggleLocationMap}
						>
							📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
						</button>
						{#if showLocationMap && LocationMap}
							<div transition:slide={{ duration: 200 }}>
								<LocationMap lat={gps.lat} lng={gps.lng} label="Lokasi kegiatan CSR" height="200px" />
							</div>
						{/if}
					{/if}

					<div>
						<label class="flex items-center gap-2 text-[12px] font-semibold cursor-pointer" style="color: var(--g)">
							<IconCamera size={16} />
							Ambil / Unggah Foto Bukti
							<input type="file" accept="image/*" capture="environment" multiple class="hidden" onchange={onPhotoChange} />
						</label>
						{#if photoPreviews.length > 0}
							<div class="grid grid-cols-3 gap-2 mt-2">
								{#each photoPreviews as src, i}
									<div class="relative">
										<img {src} alt="Bukti kegiatan" class="rounded-lg w-full h-24 object-cover" />
										<button
											type="button"
											class="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center"
											style="background: rgba(0,0,0,0.5)"
											onclick={() => removePhoto(i)}
										>
											<IconTrash size={12} color="#fff" />
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<button
						class="w-full rounded-lg py-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
						style="background: var(--g)"
						disabled={saving}
						onclick={submit}
					>
						{#if saving}<IconLoader2 size={16} class="animate-spin" />{/if}
						{saving ? 'Mengirim…' : 'Simpan Kegiatan'}
					</button>
				</div>
			{/if}
		{/if}
	</div>
</div>
