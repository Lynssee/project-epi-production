<!-- src/routes/(app)/maintenance/servis-luar/+page.svelte -->
<!-- Fase 6: konfirmasi retur equipment dari bengkel rekanan (scan QR -> halaman ini) -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { resolveServisLuarQr, uploadServisLuarPhoto, confirmServisLuarRetur, type DispatchDetail } from '$lib/services/servisLuar';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconCamera, IconAlertTriangle } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';

	// Halaman diakses lewat redirect dari /scan/[code] dengan ?code=<qr_token> —
	// resolveServisLuarQr() memanggil GET /api/surat-jalan/servis-luar?code=... di server,
	// yang meresolusi qr_token menjadi id Surat Jalan sekaligus detail dispatch-nya.
	const code = page.url.searchParams.get('code') || '';

	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);

	let dispatch = $state<DispatchDetail | null>(null);
	let kondisi = $state<Record<number, 'baik' | 'rusak' | 'hilang'>>({});
	// Gate Bengkel Fase 6: checklist retur berbasis item Perjanjian Kerja (kalau ada) --
	// terpisah dari `kondisi` (kondisi fisik equipment) karena ini menilai APAKAH pekerjaan
	// yang disepakati benar-benar dikerjakan, bukan kondisi alat.
	let hasilRetur = $state<Record<string, 'sesuai' | 'tidak_dikerjakan' | 'bermasalah'>>({});
	let photoFile = $state<File | null>(null);
	let gps = $state<{ lat: number | null; lng: number | null; accuracy: number | null }>({ lat: null, lng: null, accuracy: null });

	// Jaring pengaman draf: foto serah-terima di sini WAJIB, jadi user pasti membuka
	// kamera native — titik paling rawan tab dibunuh OS. Dikunci per token QR supaya
	// draf Surat Jalan satu tidak terbawa ke Surat Jalan lain.
	const SERVIS_PHOTO_KEY = 'terima';
	const servisPersist = createFormPersist<{
		kondisi: Record<number, 'baik' | 'rusak' | 'hilang'>;
		hasilRetur: Record<string, 'sesuai' | 'tidak_dikerjakan' | 'bermasalah'>;
	}>(`servis_luar_${code}`);
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function servisSnapshot() {
		return { kondisi, hasilRetur };
	}

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}

	onMount(async () => {
		if (!code) {
			errorMsg = 'Kode QR tidak ditemukan.';
			loading = false;
			return;
		}
		try {
			dispatch = await resolveServisLuarQr(code);
			for (const it of dispatch.items) kondisi[it.id] = 'baik';
			for (const it of dispatch.scopeItems) hasilRetur[it.id] = it.hasil_retur || 'sesuai';

			// Pulihkan draf setelah default 'baik' dipasang, dan hanya untuk item yang
			// masih ada di Surat Jalan (isi Surat Jalan bisa berubah di sisi admin).
			const draft = servisPersist.restore();
			if (draft) {
				for (const it of dispatch.items) {
					const saved = draft.kondisi?.[it.id];
					if (saved) kondisi[it.id] = saved;
				}
				for (const it of dispatch.scopeItems) {
					const saved = draft.hasilRetur?.[it.id];
					if (saved) hasilRetur[it.id] = saved;
				}
				const blob = await servisPersist.restorePhoto(SERVIS_PHOTO_KEY);
				if (blob) photoFile = new File([blob], 'terima.jpg', { type: blob.type || 'image/jpeg' });
				draftSavedAt = new Date();
			}
			draftArmed = true;

			if (navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(
					(pos) => { gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }; },
					() => { /* GPS opsional */ }
				);
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat Surat Jalan.';
		} finally {
			loading = false;
		}
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void servisSnapshot();
		if (!draftArmed) return;
		servisPersist.save(servisSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(servisPersist, servisSnapshot));

	function handlePhoto(e: Event) {
		const input = e.target as HTMLInputElement;
		photoFile = input.files?.[0] || null;
		if (photoFile) servisPersist.savePhoto(SERVIS_PHOTO_KEY, photoFile);
	}

	async function handleSubmit() {
		if (!dispatch || submitting) return;
		if (!photoFile) {
			errorMsg = 'Foto bukti serah-terima wajib diunggah.';
			return;
		}
		submitting = true;
		errorMsg = '';
		try {
			const compressedPhoto = await compressPhoto(photoFile);
			const fotoId = await uploadServisLuarPhoto(compressedPhoto);
			if (!fotoId) throw new Error('Gagal mengunggah foto.');

			await confirmServisLuarRetur({
				suratJalanId: dispatch.id,
				items: dispatch.items.map((it) => ({ surat_jalan_item_id: it.id, kondisi_kembali: kondisi[it.id] || 'baik' })),
				fotoTerimaFileId: fotoId,
				gps,
				scopeResults: dispatch.scopeItems.map((it) => ({ itemId: it.id, hasilRetur: hasilRetur[it.id] || 'sesuai' }))
			});
			// Terkirim — draf lokal (termasuk foto di IndexedDB) sudah tidak relevan.
			servisPersist.clear();
			await servisPersist.clearPhotos();
			draftSavedAt = null;
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan konfirmasi retur.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/maintenance/work-order')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat servis luar alat..." />
		</div>
	{:else if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Retur dikonfirmasi</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Surat Jalan {dispatch?.nomor_sj} ditandai selesai.</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/maintenance/work-order')}>
				Kembali ke Work Order
			</button>
		</div>
	{:else if errorMsg && !dispatch}
		<div class="rounded-xl p-6" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
			<IconAlertTriangle size={28} style="color: var(--red); margin: 0 auto 8px" />
			<p class="text-[13px] font-semibold mb-1 text-center" style="color: var(--sys-label)">Gagal memuat</p>
			<p class="text-[12px] text-center" style="color: var(--sys-label3)">{errorMsg}</p>
		</div>
	{:else if dispatch}
		<h1 class="text-[16px] font-bold mb-1" style="color: var(--sys-label)">Konfirmasi Retur — {dispatch.nomor_sj}</h1>
		<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} />
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Dari bengkel: {dispatch.bengkel_name}</p>

		{#if dispatch.status === 'received' || dispatch.return_status === 'selesai'}
			<div class="rounded-xl p-4 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<p class="text-[13px] font-semibold" style="color: var(--sys-label)">Surat Jalan ini sudah dikonfirmasi sebelumnya.</p>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each dispatch.items as item}
					<div class="glass-panel rounded-xl p-3">
						<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">{item.nama_barang || item.equipment_id}</p>
						<p class="text-[10px] mb-2" style="color: var(--sys-label4)">Kondisi berangkat: {item.kondisi_berangkat || '-'}</p>
						<div class="grid grid-cols-3 gap-2">
							<button
								class="h-9 rounded-lg text-[11px] font-bold"
								style={kondisi[item.id] === 'baik' ? 'background:#16A34A; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
								onclick={() => (kondisi[item.id] = 'baik')}
							>Baik</button>
							<button
								class="h-9 rounded-lg text-[11px] font-bold"
								style={kondisi[item.id] === 'rusak' ? 'background:#DC2626; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
								onclick={() => (kondisi[item.id] = 'rusak')}
							>Rusak</button>
							<button
								class="h-9 rounded-lg text-[11px] font-bold"
								style={kondisi[item.id] === 'hilang' ? 'background:#6B7280; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
								onclick={() => (kondisi[item.id] = 'hilang')}
							>Hilang</button>
						</div>
					</div>
				{/each}

				{#if dispatch.scopeItems.length > 0}
					<div class="glass-panel rounded-xl p-3">
						<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Kesesuaian Pekerjaan (Perjanjian Kerja)</p>
						<p class="text-[10px] mb-2" style="color: var(--sys-label4)">Periksa apakah tiap pekerjaan yang disepakati benar-benar dikerjakan bengkel.</p>
						<div class="flex flex-col gap-2">
							{#each dispatch.scopeItems as item}
								<div class="rounded-lg border p-2.5" style="border-color: var(--sys-sep)">
									<p class="text-[11px] font-semibold mb-1.5" style="color: var(--sys-label)">{item.deskripsi}</p>
									<div class="grid grid-cols-3 gap-2">
										<button
											class="h-8 rounded-lg text-[10px] font-bold"
											style={hasilRetur[item.id] === 'sesuai' ? 'background:#16A34A; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
											onclick={() => (hasilRetur[item.id] = 'sesuai')}
										>Sesuai</button>
										<button
											class="h-8 rounded-lg text-[10px] font-bold"
											style={hasilRetur[item.id] === 'tidak_dikerjakan' ? 'background:#D97706; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
											onclick={() => (hasilRetur[item.id] = 'tidak_dikerjakan')}
										>Tidak Dikerjakan</button>
										<button
											class="h-8 rounded-lg text-[10px] font-bold"
											style={hasilRetur[item.id] === 'bermasalah' ? 'background:#DC2626; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
											onclick={() => (hasilRetur[item.id] = 'bermasalah')}
										>Bermasalah</button>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div>
					<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Foto Bukti Serah-Terima *</p>
					<label class="w-20 h-20 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer" style="border-color: var(--sys-sep)">
						<IconCamera size={18} style="color: var(--sys-label4)" />
						<input type="file" accept="image/*" capture="environment" class="hidden" onchange={handlePhoto} />
					</label>
					{#if photoFile}
						<p class="text-[10px] mt-1" style="color: var(--sys-label3)">1 foto dipilih</p>
					{/if}
				</div>

				{#if gps.lat != null && gps.lng != null}
					<button type="button" class="text-[11px] font-semibold" style="color: var(--g)" onclick={toggleLocationMap}>
						📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi Anda saat ini'}
					</button>
					{#if showLocationMap && LocationMap}
						<div transition:slide={{ duration: 200 }}>
							<LocationMap lat={gps.lat} lng={gps.lng} label="Lokasi serah-terima servis luar" height="200px" />
						</div>
					{/if}
				{/if}

				{#if errorMsg}
					<p class="text-[12px]" style="color: #DC2626">{errorMsg}</p>
				{/if}

				<button
					class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
					style="background: var(--g)"
					disabled={!photoFile || submitting}
					onclick={handleSubmit}
				>
					{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
					Konfirmasi Retur
				</button>
			</div>
		{/if}
	{/if}
</div>
