<!-- src/routes/(app)/proyek/[project_id]/punch-list/+page.svelte -->
<!-- Punch List lapangan (Quality Management Proyek v2, Fase 2 — 10 Agustus 2026). -->
<!-- Offline-first (R5): gagal kirim (sinyal jelek) -> masuk antrian IndexedDB, auto-kirim -->
<!-- ulang saat online lagi. Severity critical otomatis bikin draft NCR tertaut. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { getProjectById } from '$lib/services/projects';
	import { getCurrentPosition } from '$lib/utils/geoClient';
	import {
		createPunch, fetchProjectPunchList, uploadPunchPhoto, rectifyPunch, verifyPunch,
		type CreatePunchParams
	} from '$lib/services/projectPunchListApi';
	import {
		enqueuePunchSubmission, flushPunchQueue, registerPunchAutoFlush,
		type QueuedPunchSubmission
	} from '$lib/utils/offlinePunchQueue';
	import { IconArrowLeft, IconLoader2, IconCamera, IconEdit } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import PhotoAnnotator from '$lib/components/shared/PhotoAnnotator.svelte';
	import VoiceInputButton from '$lib/components/shared/VoiceInputButton.svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let punches = $state<any[]>([]);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol per item).
	let mapPunchId = $state<number | null>(null);
	let LocationMap = $state<any>(null);
	async function toggleLocationMapFor(punchId: number) {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		mapPunchId = mapPunchId === punchId ? null : punchId;
	}

	let showForm = $state(false);
	let saving = $state(false);
	let form = $state({ areaZone: '', severity: 'minor', deskripsi: '' });
	let photoFile = $state<File | null>(null);
	let photoPreviewUrl = $state<string | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let annotatingFile = $state<File | null>(null);

	$effect(() => {
		if (!photoFile) {
			photoPreviewUrl = null;
			return;
		}
		const url = URL.createObjectURL(photoFile);
		photoPreviewUrl = url;
		return () => URL.revokeObjectURL(url);
	});

	const STATUS_LABEL: Record<string, string> = { open: 'Open', rectified: 'Rectified', closed: 'Closed', void: 'Void' };

	// Antrean offline (offlinePunchQueue) menyelamatkan punch yang SUDAH ditekan kirim
	// saat sinyal mati. Draf di bawah menutup celah berbeda: isian yang BELUM ditekan
	// kirim ketika tab dibunuh OS saat memfoto temuan di lapangan.
	interface PunchDraft {
		showForm: boolean;
		areaZone: string;
		severity: string;
		deskripsi: string;
	}
	const PUNCH_PHOTO_KEY = 'temuan';
	let punchPersist = $derived(createFormPersist<PunchDraft>(`punch_list_${projectId}`));
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function punchSnapshot(): PunchDraft {
		return { showForm, areaZone: form.areaZone, severity: form.severity, deskripsi: form.deskripsi };
	}

	function onPhotoPicked(file: File | null) {
		photoFile = file;
		if (file) punchPersist.savePhoto(PUNCH_PHOTO_KEY, file);
		else punchPersist.clearPhoto(PUNCH_PHOTO_KEY);
	}

	async function sendEntry(entry: QueuedPunchSubmission) {
		let fotoFileId: string | null = null;
		if (entry.photoBlob) {
			fotoFileId = await uploadPunchPhoto(entry.photoBlob, entry.photoName || 'punch.jpg');
		}
		await createPunch({
			clientTxnId: entry.client_txn_id,
			projectId: entry.project_id,
			areaZone: entry.area_zone || undefined,
			severity: entry.severity,
			deskripsi: entry.deskripsi,
			fotoFileId,
			lat: entry.lat,
			lng: entry.lng,
			createdByName: entry.created_by_name || undefined
		});
	}

	async function load() {
		loading = true;
		try {
			const [proj, list] = await Promise.all([getProjectById(projectId), fetchProjectPunchList(Number(projectId))]);
			project = proj;
			punches = list as any[];
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		load();
		registerPunchAutoFlush(sendEntry);
		flushPunchQueue(sendEntry).then((r) => {
			if (r.sent > 0) load();
		});

		const draft = punchPersist.restore();
		if (draft?.showForm) {
			showForm = true;
			form = { areaZone: draft.areaZone, severity: draft.severity, deskripsi: draft.deskripsi };
			const blob = await punchPersist.restorePhoto(PUNCH_PHOTO_KEY);
			if (blob) photoFile = new File([blob], 'temuan.jpg', { type: blob.type || 'image/jpeg' });
			draftSavedAt = new Date();
		}
		draftArmed = true;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void punchSnapshot();
		if (!draftArmed) return;
		punchPersist.save(punchSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(punchPersist, punchSnapshot));

	async function submitPunch() {
		if (!form.deskripsi.trim()) return;
		saving = true;
		const clientTxnId = crypto.randomUUID();
		try {
			let lat: number | null = null;
			let lng: number | null = null;
			try {
				const pos = await getCurrentPosition();
				lat = pos.lat;
				lng = pos.lng;
			} catch {
				// Lokasi opsional -- lanjut tanpa GPS kalau izin ditolak/tidak tersedia
			}

			const compressedPhotoFile = photoFile ? await compressPhoto(photoFile) : null;

			try {
				let fotoFileId: string | null = null;
				if (compressedPhotoFile) fotoFileId = await uploadPunchPhoto(compressedPhotoFile, compressedPhotoFile.name);
				await createPunch({
					clientTxnId,
					projectId: Number(projectId),
					areaZone: form.areaZone || undefined,
					severity: form.severity,
					deskripsi: form.deskripsi.trim(),
					fotoFileId,
					lat,
					lng,
					createdByName: $authStore.karyawanName || undefined
				});
			} catch (err) {
				// Gagal kirim (kemungkinan besar sinyal) -- simpan ke antrian, JANGAN dianggap error ke user
				await enqueuePunchSubmission({
					client_txn_id: clientTxnId,
					project_id: Number(projectId),
					area_zone: form.areaZone || null,
					severity: form.severity,
					deskripsi: form.deskripsi.trim(),
					lat,
					lng,
					photoBlob: compressedPhotoFile,
					photoName: compressedPhotoFile?.name || null,
					created_by_name: $authStore.karyawanName || null,
					createdAt: new Date().toISOString()
				});
			}

			// Terkirim ATAU masuk antrean offline — dua-duanya berarti draf lokal
			// (termasuk foto di IndexedDB) sudah tidak relevan lagi.
			punchPersist.clear();
			await punchPersist.clearPhotos();
			draftSavedAt = null;
			form = { areaZone: '', severity: 'minor', deskripsi: '' };
			photoFile = null;
			showForm = false;
			await load();
		} finally {
			saving = false;
		}
	}

	async function doRectify(punchId: number) {
		await rectifyPunch(punchId, $authStore.karyawanId, undefined);
		await load();
	}

	async function doVerify(punchId: number) {
		await verifyPunch(punchId, $authStore.karyawanId);
		await load();
	}
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<button class="mb-3 flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}`)}>
		<IconArrowLeft size={16} /> Kembali ke Proyek
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-14">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat punch list temuan lapangan..." />
	</div>
	{:else}
		<h1 class="text-lg font-bold text-gray-900">Punch List</h1>
		<p class="mb-4 text-sm text-gray-500">{project?.name || '-'}</p>

		<div class="mb-4 flex items-center justify-between">
			<span class="text-xs text-gray-400">{punches.length} temuan</span>
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} />
			<button class="text-xs font-semibold text-blue-600" onclick={() => (showForm = !showForm)}>
				{showForm ? 'Batal' : '+ Buat Punch'}
			</button>
		</div>

		{#if showForm}
			<div class="mb-4 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
				<select class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" bind:value={form.severity}>
					<option value="minor">Minor</option>
					<option value="major">Major</option>
					<option value="critical">Critical (otomatis jadi NCR)</option>
				</select>
				<input type="text" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="Area/Zone (opsional)" bind:value={form.areaZone} />
				<div class="flex items-start gap-1.5">
					<textarea class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" rows="2" placeholder="Deskripsi temuan" bind:value={form.deskripsi}></textarea>
					<VoiceInputButton onResult={(text) => (form.deskripsi = form.deskripsi ? `${form.deskripsi} ${text}` : text)} />
				</div>

				<input
					bind:this={fileInputEl}
					type="file"
					accept="image/*"
					capture="environment"
					class="hidden"
					onchange={(e) => onPhotoPicked((e.target as HTMLInputElement).files?.[0] || null)}
				/>
				<button
					class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-2 text-xs text-gray-500"
					onclick={() => fileInputEl?.click()}
				>
					<IconCamera size={16} /> {photoFile ? photoFile.name : 'Ambil Foto (opsional)'}
				</button>

				{#if photoFile && photoPreviewUrl}
					<div class="flex items-center gap-2">
						<img src={photoPreviewUrl} alt="Preview temuan" class="h-14 w-14 rounded-lg object-cover" />
						<button
							type="button"
							class="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600"
							onclick={() => (annotatingFile = photoFile)}
						>
							<IconEdit size={14} /> Tandai di foto
						</button>
					</div>
				{/if}

				<button
					class="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white disabled:opacity-60"
					disabled={saving}
					onclick={submitPunch}
				>
					{saving ? '…' : 'Simpan Punch'}
				</button>
				<p class="text-[10px] text-gray-400">Sinyal jelek? Punch tetap tersimpan di perangkat dan otomatis terkirim saat online lagi.</p>
			</div>
		{/if}

		<div class="space-y-2">
			{#each punches as punch (punch.id)}
				<div class="rounded-lg border border-gray-100 bg-white p-3 text-xs">
					<div class="flex items-center justify-between">
						<span class="font-mono text-gray-400">{punch.punch_no}</span>
						<span class="rounded-full px-2 py-0.5 {punch.status === 'closed' ? 'bg-green-100 text-green-700' : punch.status === 'void' ? 'bg-gray-200 text-gray-500' : 'bg-amber-100 text-amber-700'}">
							{STATUS_LABEL[punch.status] || punch.status}
						</span>
					</div>
					<p class="mt-1 text-gray-700">{punch.deskripsi}</p>
					{#if punch.area_zone}<p class="text-gray-400">Area: {punch.area_zone}</p>{/if}
					{#if punch.linked_ncr_id}<p class="text-red-600">⚠️ Tertaut NCR #{punch.linked_ncr_id}</p>{/if}
					{#if punch.geo_lat != null && punch.geo_lng != null}
						<button type="button" class="mt-1 text-blue-600 font-semibold" onclick={() => toggleLocationMapFor(punch.id)}>
							📍 {mapPunchId === punch.id ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
						</button>
						{#if mapPunchId === punch.id && LocationMap}
							<div transition:slide={{ duration: 200 }} class="mt-1">
								<LocationMap lat={punch.geo_lat} lng={punch.geo_lng} label={punch.punch_no} height="180px" />
							</div>
						{/if}
					{/if}
					<div class="mt-2 flex gap-2">
						{#if punch.status === 'open'}
							<button class="rounded-lg bg-blue-600 px-2 py-1 text-white" onclick={() => doRectify(punch.id)}>Tandai Sudah Diperbaiki</button>
						{:else if punch.status === 'rectified'}
							<button class="rounded-lg bg-green-600 px-2 py-1 text-white" onclick={() => doVerify(punch.id)}>Verifikasi & Tutup</button>
						{/if}
					</div>
				</div>
			{:else}
				<p class="text-xs text-gray-400">Belum ada punch list.</p>
			{/each}
		</div>
	{/if}
</div>

{#if annotatingFile}
	<PhotoAnnotator
		file={annotatingFile}
		onSave={(annotated) => {
			photoFile = annotated;
			punchPersist.savePhoto(PUNCH_PHOTO_KEY, annotated);
			annotatingFile = null;
		}}
		onCancel={() => (annotatingFile = null)}
	/>
{/if}
