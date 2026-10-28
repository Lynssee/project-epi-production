<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { submitSafetyObservation, fetchMySafetyObservations, uploadHseFoto, type SafetyObservation } from '$lib/services/hse';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { IconArrowLeft, IconCamera, IconThumbUp } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';

	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');
	let myObservations = $state<SafetyObservation[]>([]);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol per item).
	let mapObservationId = $state<number | null>(null);
	let LocationMap = $state<any>(null);
	async function toggleLocationMapFor(id: number) {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		mapObservationId = mapObservationId === id ? null : id;
	}
	let loadingHistory = $state(true);
	let fotoFile = $state<File | null>(null);

	let form = $state({
		kategori: 'tindakan_aman',
		lokasi: '',
		deskripsi: ''
	});

	// Jaring pengaman draf: OS bisa membunuh tab selagi kamera native terbuka saat
	// memfoto kondisi/tindakan tidak aman. Observasi yang hilang = temuan keselamatan
	// yang tidak pernah dilaporkan, jadi isian dipertahankan lintas reload.
	type SocDraft = { kategori: string; lokasi: string; deskripsi: string };
	const SOC_PHOTO_KEY = 'foto';
	const socPersist = createFormPersist<SocDraft>('hse_soc');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function socSnapshot(): SocDraft {
		return { kategori: form.kategori, lokasi: form.lokasi, deskripsi: form.deskripsi };
	}

	function getGpsPosition(): Promise<GeolocationPosition | null> {
		return new Promise((resolve) => {
			if (!navigator.geolocation) { resolve(null); return; }
			navigator.geolocation.getCurrentPosition((pos) => resolve(pos), () => resolve(null), { enableHighAccuracy: true, timeout: 5000 });
		});
	}

	function onFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		fotoFile = input.files?.[0] || null;
		if (fotoFile) socPersist.savePhoto(SOC_PHOTO_KEY, fotoFile);
	}

	function reporterName(): string {
		return $authStore.karyawanName || $authStore.user?.displayName || $authStore.user?.email || 'Lapangan';
	}

	async function loadHistory() {
		loadingHistory = true;
		myObservations = await fetchMySafetyObservations(reporterName());
		loadingHistory = false;
	}

	onMount(async () => {
		await loadHistory();
		const draft = socPersist.restore();
		if (draft) {
			form = { kategori: draft.kategori, lokasi: draft.lokasi, deskripsi: draft.deskripsi };
			const blob = await socPersist.restorePhoto(SOC_PHOTO_KEY);
			if (blob) fotoFile = new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' });
			draftSavedAt = new Date();
		}
		draftArmed = true;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void socSnapshot();
		if (!draftArmed) return;
		socPersist.save(socSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(socPersist, socSnapshot));

	async function submitForm() {
		errorMsg = ''; successMsg = '';
		if (!form.deskripsi.trim()) { errorMsg = 'Isi deskripsi observasi.'; return; }
		saving = true;
		try {
			const pos = await getGpsPosition();
			let fotoId: string | null = null;
			if (fotoFile) {
				const compressed = await compressPhoto(fotoFile);
				fotoId = await uploadHseFoto(compressed, `SOC ${form.kategori} - ${form.lokasi || 'lapangan'}`);
			}

			await submitSafetyObservation({
				kategori: form.kategori,
				lokasi: form.lokasi,
				deskripsi: form.deskripsi,
				foto: fotoId,
				gps_lat: pos?.coords.latitude ?? null,
				gps_lng: pos?.coords.longitude ?? null,
				pelapor: reporterName(),
				pelapor_id: $authStore.karyawanId ?? null
			});
			successMsg = 'Kartu observasi terkirim. Terima kasih sudah peduli keselamatan!';
			// Terkirim — draf lokal (termasuk foto di IndexedDB) sudah tidak relevan.
			socPersist.clear();
			await socPersist.clearPhotos();
			draftSavedAt = null;
			form = { kategori: 'tindakan_aman', lokasi: '', deskripsi: '' };
			fotoFile = null;
			await loadHistory();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal mengirim observasi.';
		}
		saving = false;
	}

	const KATEGORI_LABELS: Record<string, string> = {
		tindakan_aman: '👍 Tindakan Aman',
		tindakan_tidak_aman: '⚠️ Tindakan Tidak Aman',
		kondisi_tidak_aman: '⚠️ Kondisi Tidak Aman'
	};
	const STATUS_LABELS: Record<string, string> = {
		baru: 'Baru',
		ditindaklanjuti: 'Ditindaklanjuti',
		selesai: 'Selesai'
	};
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/hse')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold flex-1" style="color: var(--sys-label)">👀 Kartu Observasi Keselamatan (SOC)</h1>
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!fotoFile} />
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">
			Amati &amp; catat — tindakan aman untuk apresiasi, atau tindakan/kondisi tidak aman untuk perbaikan
		</p>

		<select class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={form.kategori}>
			<option value="tindakan_aman">👍 Tindakan Aman (Apresiasi)</option>
			<option value="tindakan_tidak_aman">⚠️ Tindakan Tidak Aman</option>
			<option value="kondisi_tidak_aman">⚠️ Kondisi Tidak Aman</option>
		</select>

		<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Lokasi (mis. Area Blasting)" bind:value={form.lokasi} />

		<textarea rows="3" class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Deskripsi observasi" bind:value={form.deskripsi}></textarea>

		<label class="flex items-center gap-2 text-[12px] mb-3" style="color: var(--sys-label)">
			<IconCamera size={16} />
			<input type="file" accept="image/*" capture="environment" onchange={onFotoChange} class="text-[12px]" />
		</label>

		<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2" style="background: var(--g)" disabled={saving} onclick={submitForm}>
			<IconThumbUp size={16} />
			{saving ? 'Mengirim…' : 'Kirim Observasi'}
		</button>

		<div class="mt-6">
			<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Riwayat Observasi Saya</p>
			{#if loadingHistory}
				<CircularProgressGauge size={44} strokeWidth={3} label="Memuat riwayat observasi SOC..." />
			{:else if myObservations.length === 0}
				<p class="text-[12px]" style="color: var(--sys-label-2)">Belum ada observasi.</p>
			{:else}
				<div class="space-y-2">
					{#each myObservations as o (o.id)}
						<div class="rounded-lg p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<div class="flex items-center justify-between mb-1">
								<span class="text-[11px] font-semibold" style="color: var(--sys-label)">{KATEGORI_LABELS[o.kategori] || o.kategori}</span>
								<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: var(--rel); color: var(--sys-label-2)">{STATUS_LABELS[o.status] || o.status}</span>
							</div>
							<p class="text-[12px]" style="color: var(--sys-label)">{o.deskripsi}</p>
							<p class="text-[10px] mt-1" style="color: var(--sys-label-2)">{o.lokasi || '-'} · {new Date(o.date_created).toLocaleDateString('id-ID')}</p>
							{#if o.tindak_lanjut}
								<p class="text-[11px] mt-1.5 pt-1.5" style="color: var(--g); border-top: 1px solid var(--sys-sep)"><b>Tindak lanjut:</b> {o.tindak_lanjut}</p>
							{/if}
							{#if o.gps_lat != null && o.gps_lng != null}
								<button type="button" class="text-[10px] font-semibold mt-1.5" style="color: var(--g)" onclick={() => toggleLocationMapFor(o.id)}>
									📍 {mapObservationId === o.id ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
								</button>
								{#if mapObservationId === o.id && LocationMap}
									<div transition:slide={{ duration: 200 }} class="mt-1">
										<LocationMap lat={o.gps_lat} lng={o.gps_lng} label={o.lokasi || 'Observasi keselamatan'} height="180px" />
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
