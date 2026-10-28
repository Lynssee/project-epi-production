<!-- src/routes/(app)/proyek/[project_id]/site-survey/+page.svelte -->
<!-- Fase 5 (Pertajam Perencanaan & Persiapan Proyek v2, 6 Agustus 2026): form Site Survey + -->
<!-- checklist mobilisasi pra-berangkat. Submit = "Ajukan Siap Mobilisasi" (rekomendasi #8) -->
<!-- yang otomatis memberi makan Gerbang Kesiapan di admin (item auto site_survey_submitted / -->
<!-- mobilization_ready — lihat projectReadinessApi.js admin). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { getProjectById } from '$lib/services/projects';
	import { getCurrentPosition, type DevicePosition } from '$lib/utils/geoClient';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import {
		submitSiteSurvey,
		getLatestSiteSurvey,
		getMobilizationChecklist,
		setMobilizationCheck
	} from '$lib/services/projectSiteSurvey';
	import { IconArrowLeft, IconLoader2, IconMapPin, IconCamera } from '@tabler/icons-svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let latestSurvey = $state<any>(null);
	let mobilizationItems = $state<Array<{ id: string; label: string; wajib: boolean; checked: boolean }>>([]);

	let aksesJalan = $state(false);
	let listrik = $state(false);
	let air = $state(false);
	let areaKerja = $state('');
	let catatan = $state('');

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
	let photoPreview = $state<string>('');

	let submitting = $state(false);
	let togglingItem = $state<string | null>(null);
	let offlineSaved = $state(false);
	let draftRestored = $state(false);

	// Rekomendasi #6: draft lokal — lapangan sering minim sinyal. Foto TIDAK ikut disimpan
	// (File tak bisa di-JSON-kan ke localStorage); kalau draft di-resume, foto wajib dipilih ulang.
	function draftKey() {
		return `site_survey_draft_${projectId}`;
	}

	function saveDraftLocal() {
		try {
			localStorage.setItem(
				draftKey(),
				JSON.stringify({ aksesJalan, listrik, air, areaKerja, catatan, gps, savedAt: new Date().toISOString() })
			);
		} catch {
			// localStorage penuh/tak tersedia — draft lokal sifatnya best-effort, jangan gagalkan form
		}
	}

	function clearDraftLocal() {
		try {
			localStorage.removeItem(draftKey());
		} catch {
			/* best-effort */
		}
	}

	function restoreDraftLocal() {
		try {
			const raw = localStorage.getItem(draftKey());
			if (!raw) return;
			const draft = JSON.parse(raw);
			aksesJalan = !!draft.aksesJalan;
			listrik = !!draft.listrik;
			air = !!draft.air;
			areaKerja = draft.areaKerja || '';
			catatan = draft.catatan || '';
			if (draft.gps) gps = draft.gps;
			draftRestored = true;
		} catch {
			/* draft korup — abaikan, mulai form kosong */
		}
	}

	$effect(() => {
		// Autosave setiap field berubah — baca semua dependency dulu supaya $effect ter-track benar.
		void aksesJalan;
		void listrik;
		void air;
		void areaKerja;
		void catatan;
		void gps;
		if (!loading) saveDraftLocal();
	});

	onMount(async () => {
		loading = true;
		restoreDraftLocal();
		try {
			const [proj, survey, checklist] = await Promise.all([
				getProjectById(projectId),
				getLatestSiteSurvey(Number(projectId)),
				getMobilizationChecklist(Number(projectId))
			]);
			project = proj;
			latestSurvey = survey;
			mobilizationItems = checklist;
		} finally {
			loading = false;
		}

		try {
			const pos = await getCurrentPosition();
			gps = pos;
		} catch (e: any) {
			gpsError = e?.message || 'Gagal mengambil lokasi';
		}

		window.addEventListener('online', () => {
			if (localStorage.getItem(draftKey())) {
				handleSubmit(true);
			}
		});
	});

	function onPhotoSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		photoFile = file;
		photoPreview = URL.createObjectURL(file);
	}

	async function toggleMobilizationItem(itemId: string, checked: boolean) {
		togglingItem = itemId;
		try {
			await setMobilizationCheck(Number(projectId), itemId, checked, $authStore.karyawanName || 'lapangan');
			mobilizationItems = mobilizationItems.map((m) => (m.id === itemId ? { ...m, checked } : m));
		} finally {
			togglingItem = null;
		}
	}

	async function handleSubmit(isAutoRetry = false) {
		if (!navigator.onLine) {
			saveDraftLocal();
			offlineSaved = true;
			return;
		}

		submitting = true;
		try {
			let evidencePhotoFileId: string | null = null;
			if (photoFile) {
				const compressed = await compressPhoto(photoFile);
				evidencePhotoFileId = await uploadEvidencePhoto(compressed, 'site_survey:evidence');
			}

			await submitSiteSurvey({
				projectId: Number(projectId),
				aksesJalan,
				listrik,
				air,
				areaKerja,
				catatan,
				lat: gps?.lat ?? null,
				lng: gps?.lng ?? null,
				accuracy: gps?.accuracy ?? null,
				evidencePhotoFileId,
				submittedBy: $authStore.karyawanName || 'lapangan',
				submittedById: $authStore.karyawanId ?? null
			});

			clearDraftLocal();
			if (!isAutoRetry) goto(`/proyek/${projectId}`);
		} catch (e) {
			// Gagal kirim (jaringan putus di tengah jalan) — draft SUDAH tersimpan via autosave,
			// biarkan tersimpan, coba lagi otomatis saat event 'online' berikutnya.
			if (!isAutoRetry) {
				offlineSaved = true;
			}
		} finally {
			submitting = false;
		}
	}
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<button class="mb-3 flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}`)}>
		<IconArrowLeft size={16} /> Kembali ke Proyek
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-14">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data survey lokasi proyek..." />
	</div>
	{:else}
		<h1 class="text-lg font-bold text-gray-900">Site Survey &amp; Kesiapan Mobilisasi</h1>
		<p class="mb-4 text-sm text-gray-500">{project?.name || '-'}</p>

		{#if latestSurvey}
			<div class="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
				Survey terakhir dikirim {new Date(latestSurvey.submitted_at).toLocaleString('id-ID')} oleh {latestSurvey.submitted_by}.
				Mengirim ulang akan menambah catatan baru (bukan menimpa).
			</div>
		{/if}

		<div class="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
			<h2 class="text-sm font-bold text-gray-800">Kondisi Lokasi</h2>
			<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={aksesJalan} /> Akses jalan memadai</label>
			<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={listrik} /> Listrik tersedia</label>
			<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={air} /> Air tersedia</label>
			<textarea
				class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
				rows="2"
				placeholder="Deskripsi area kerja…"
				bind:value={areaKerja}
			></textarea>
			<textarea
				class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
				rows="2"
				placeholder="Catatan tambahan…"
				bind:value={catatan}
			></textarea>

			<div class="flex items-center gap-2 text-xs {gps ? 'text-green-700' : 'text-amber-600'}">
				<IconMapPin size={14} />
				{#if gps}
					GPS: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} (±{Math.round(gps.accuracy)}m)
				{:else}
					{gpsError || 'Mengambil lokasi…'}
				{/if}
			</div>
			{#if gps}
				<button type="button" class="text-xs font-semibold text-green-700" onclick={toggleLocationMap}>
					📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
				</button>
				{#if showLocationMap && LocationMap}
					<div transition:slide={{ duration: 200 }}>
						<LocationMap lat={gps.lat} lng={gps.lng} label="Lokasi survey" height="200px" />
					</div>
				{/if}
			{/if}

			<div>
				<label class="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600">
					<IconCamera size={16} /> {photoFile ? 'Ganti Foto' : 'Ambil Foto'}
					<input type="file" accept="image/*" capture="environment" class="hidden" onchange={onPhotoSelected} />
				</label>
				{#if photoPreview}
					<img src={photoPreview} alt="preview" class="mt-2 h-32 rounded-lg object-cover" />
				{/if}
			</div>
		</div>

		<div class="mt-4 space-y-2 rounded-xl border border-gray-200 bg-white p-4">
			<h2 class="text-sm font-bold text-gray-800">Checklist Mobilisasi</h2>
			{#each mobilizationItems as item (item.id)}
				<label class="flex items-center justify-between text-sm">
					<span>{item.label}{#if item.wajib}<span class="ml-1 text-xs text-red-500">*wajib</span>{/if}</span>
					<input
						type="checkbox"
						checked={item.checked}
						disabled={togglingItem === item.id}
						onchange={(e) => toggleMobilizationItem(item.id, (e.target as HTMLInputElement).checked)}
					/>
				</label>
			{/each}
		</div>

		{#if offlineSaved}
			<div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
				📴 Tidak ada koneksi — data tersimpan di perangkat ini dan akan otomatis terkirim begitu sinyal kembali.
				Foto (kalau ada) perlu dipilih ulang saat kirim berhasil kalau halaman ini sempat ditutup.
			</div>
		{:else if draftRestored}
			<div class="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
				📝 Draft tersimpan sebelumnya dipulihkan.
			</div>
		{/if}

		<button
			class="mt-4 w-full rounded-lg bg-gray-900 py-3 text-sm font-bold text-white disabled:opacity-50"
			disabled={submitting}
			onclick={() => handleSubmit()}
		>
			{submitting ? 'Mengirim…' : '📍 Ajukan Siap Mobilisasi'}
		</button>
	{/if}
</div>
