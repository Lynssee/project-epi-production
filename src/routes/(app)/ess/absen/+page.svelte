<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { slide } from 'svelte/transition';
	import { getCurrentPosition, type DevicePosition } from '$lib/utils/geoClient';
	import QrCameraScanner from '$lib/components/ui/QrCameraScanner.svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { clockIn, clockOut, breakOut, breakIn, getTodayStatus, previewKonteksLokasi, type TodayStatus } from '$lib/services/ess/attendance';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconX, IconMapPin, IconAlertTriangle, IconClock } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import LivenessCamera from '$lib/components/ess/LivenessCamera.svelte';
	import { vibrateTap } from '$lib/utils/haptic';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import {
		enqueueAttendanceSubmission,
		registerAttendanceAutoFlush,
		type QueuedAttendanceSubmission
	} from '$lib/utils/offlineAttendanceQueue';

	type Mode = 'in' | 'out' | 'break-out' | 'break-in';

	function resolveMode(raw: string | null): Mode {
		if (raw === 'out' || raw === 'break-out' || raw === 'break-in') return raw;
		return 'in';
	}

	let mode = $derived(resolveMode(page.url.searchParams.get('mode')));
	let isBreakMode = $derived(mode === 'break-out' || mode === 'break-in');

	const MODE_TITLE: Record<Mode, string> = {
		in: 'Absen Masuk',
		out: 'Absen Pulang',
		'break-out': 'Mulai Istirahat',
		'break-in': 'Absen Setelah Istirahat'
	};

	let locating = $state(false);
	let locationError = $state('');
	let position = $state<DevicePosition | null>(null);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}

	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);
	let livenessPassed = $state(false);

	async function handleCapture(file: File, passed: boolean) {
		const gps = position ? { lat: position.lat, lng: position.lng, accuracy: position.accuracy } : null;
		const stampedFile = await watermarkPhoto(file, gps);
		photoFile = stampedFile;
		livenessPassed = passed;
		photoPreview = null; // LivenessCamera merender preview-nya sendiri
		await absenPersist.savePhoto(PHOTO_KEY, stampedFile);
		persistNow();
	}

	function retakePhoto() {
		photoFile = null;
		photoPreview = null;
		livenessPassed = false;
	}

	// --- Fase 2 Absensi Istirahat (Foto Wajib): status istirahat (kategori, jendela, jeda terbuka) ---
	let istirahatStatus = $state<TodayStatus['istirahat'] | null>(null);
	let istirahatLoading = $state(false);
	let selectedKategoriId = $state<string | null>(null);

	async function loadIstirahatStatus() {
		istirahatLoading = true;
		try {
			const status = await getTodayStatus();
			istirahatStatus = status.istirahat;
			if (mode === 'break-out' && !selectedKategoriId && istirahatStatus?.kategoriAktif?.length) {
				selectedKategoriId = istirahatStatus.kategoriAktif[0].id;
			}
		} catch {
			// Gagal muat status istirahat tidak boleh memblokir absen masuk/pulang biasa —
			// hanya relevan untuk mode break-out/break-in.
			istirahatStatus = null;
		} finally {
			istirahatLoading = false;
		}
	}

	let selectedKategori = $derived(istirahatStatus?.kategoriAktif?.find((k) => k.id === selectedKategoriId) || null);

	// Fase 2 (rencana absensi istirahat v2 §3.2) — mode "istirahat di perjalanan": karyawan
	// mobile boleh mulai istirahat tanpa foto (foto ditunda sampai tiba, demi keselamatan
	// berkendara). Server yang memutuskan apakah pola kerjanya benar mobile — di sini hanya
	// toggle UI, tidak pernah dipaksakan sendiri di client.
	let perjalananMode = $state(false);

	// Fase 3 (rencana absensi istirahat v2 §3.1) — Dynamic Screen QR meja desk, opsional,
	// hanya relevan saat break-in. Gagal/tidak dipindai TIDAK memblokir apa pun (cadangan).
	let showWstnScanner = $state(false);
	let wstnPayload = $state<string | null>(null);

	function handleWstnDetect(raw: string) {
		const parsed = parseEpiQr(raw);
		if (!parsed || parsed.type !== 'WSTN') return;
		wstnPayload = raw;
		showWstnScanner = false;
	}

	// Foto wajib per mode: masuk/pulang selalu wajib; break-in selalu wajib (keputusan produk);
	// break-out ikut override kategori, fallback ke konfigurasi global istirahat_foto_keluar_wajib,
	// TAPI dilonggarkan bila mode "istirahat di perjalanan" aktif.
	let fotoWajib = $derived.by(() => {
		if (mode === 'break-out' && perjalananMode) return false;
		if (mode === 'in' || mode === 'out' || mode === 'break-in') return true;
		if (mode === 'break-out') return selectedKategori?.foto_wajib ?? istirahatStatus?.konfig?.foto_keluar_wajib ?? false;
		return true;
	});

	// Timer berjalan untuk banner durasi istirahat (mode break-in).
	let nowTick = $state(Date.now());
	let tickTimer: ReturnType<typeof setInterval> | null = null;

	function parseHHmmToMinutesAgo(hhmm: string | null | undefined): number | null {
		if (!hhmm || hhmm === '-') return null;
		const [h, m] = hhmm.split(':').map(Number);
		if (Number.isNaN(h) || Number.isNaN(m)) return null;
		const now = new Date(nowTick);
		const target = new Date(now);
		target.setHours(h, m, 0, 0);
		let diffMin = Math.floor((now.getTime() - target.getTime()) / 60000);
		if (diffMin < 0) diffMin += 1440; // lintas tengah malam
		return diffMin;
	}

	let jedaTerbukaKategori = $derived(
		istirahatStatus?.jedaTerbuka?.kategori_id
			? istirahatStatus?.kategoriAktif?.find((k) => k.id === istirahatStatus?.jedaTerbuka?.kategori_id) || null
			: null
	);
	let menitBerjalan = $derived(parseHHmmToMinutesAgo(istirahatStatus?.jedaTerbuka?.jam_keluar ?? null));
	let kuotaMenit = $derived(jedaTerbukaKategori?.kuota_menit_sendiri ?? istirahatStatus?.konfig?.makan_siang_menit ?? null);
	let hitungKuota = $derived(jedaTerbukaKategori?.hitung_kuota ?? true);
	let lewatBatas = $derived(hitungKuota && kuotaMenit != null && menitBerjalan != null && menitBerjalan > kuotaMenit);

	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);
	// Fase 2 — chip konteks lokasi & label kualitas bukti (hanya terisi utk pola kerja mobile,
	// null untuk pola lain — lihat respons /api/ess/attendance/break-in).
	let hasilKonteksLokasi = $state<string | null>(null);
	let hasilKualitasLabel = $state<string | null>(null);
	let hasilMejaTerverifikasi = $state(false);
	// Fase 4 (rencana v2 §5) — gerbang 'warn': peringatan eksplisit, murni informasional,
	// TIDAK PERNAH memblokir (K5: hanya teguran, tidak menyentuh payroll).
	let hasilPeringatanGerbang = $state(false);

	const KONTEKS_LABEL: Record<string, string> = {
		kantor: '✅ Di kantor',
		site_proyek: '✅ Di site proyek',
		customer: '✅ Di customer',
		perjalanan: '⚠️ Dalam perjalanan',
		luar_area: '⚠️ Di luar area terdaftar'
	};
	const KONTEKS_PILIHAN: { value: string; label: string }[] = [
		{ value: 'kantor', label: 'Di kantor' },
		{ value: 'site_proyek', label: 'Di site proyek' },
		{ value: 'customer', label: 'Di customer' },
		{ value: 'perjalanan', label: 'Dalam perjalanan' },
		{ value: 'luar_area', label: 'Di luar area terdaftar' }
	];

	// Fase 2 §5 — chip konteks otomatis SEBELUM submit + tombol koreksi (bukan cuma tampilan
	// setelah absen berhasil seperti sebelumnya). Hanya relevan break-in; null utk pola non-mobile
	// (endpoint mengembalikan null, chip tidak ditampilkan). Gagal-lunak: kegagalan pratinjau
	// hanya menyembunyikan chip, tidak pernah memblokir tombol kirim.
	let previewKonteks = $state<string | null>(null);
	let previewLoading = $state(false);
	let konteksOverride = $state<string | null>(null);
	let showKonteksPicker = $state(false);

	async function loadKonteksPreview() {
		if (mode !== 'break-in' || !position) return;
		previewLoading = true;
		try {
			const hasil = await previewKonteksLokasi(position.lat, position.lng);
			previewKonteks = hasil?.konteksLokasi ?? null;
		} catch {
			previewKonteks = null; // gagal-lunak — chip disembunyikan, absen tetap bisa lanjut
		} finally {
			previewLoading = false;
		}
	}

	function pilihKonteksOverride(value: string) {
		konteksOverride = value;
		showKonteksPicker = false;
	}

	// Penyelamatan draf (rencana v2, Fase 3, 3.2 prioritas 3): GPS + foto absen berdampak
	// langsung ke penggajian — sayang kalau harus diulang gara-gara tab ter-refresh saat
	// membuka kamera native. TTL sengaja pendek (20 menit) karena posisi GPS lama tidak
	// boleh dipakai diam-diam sebagai bukti absen saat ini.
	interface AbsenDraft { mode: string; lat: number; lng: number; accuracy: number; kategoriId?: string | null }
	const absenPersist = createFormPersist<AbsenDraft>('ess_absen', { ttlMenit: 20 });
	let draftSavedAt = $state<Date | null>(null);
	const PHOTO_KEY = 'selfie';

	function persistNow() {
		if (!position) return;
		absenPersist.flushNow({ mode, lat: position.lat, lng: position.lng, accuracy: position.accuracy, kategoriId: selectedKategoriId });
		draftSavedAt = new Date();
	}

	onMount(() => {
		(async () => {
			const draft = absenPersist.restore();
			if (draft && draft.mode === mode) {
				position = { lat: draft.lat, lng: draft.lng, accuracy: draft.accuracy } as DevicePosition;
				if (draft.kategoriId) selectedKategoriId = draft.kategoriId;
				const blob = await absenPersist.restorePhoto(PHOTO_KEY);
				if (blob) {
					photoFile = new File([blob], 'selfie.jpg', { type: blob.type || 'image/jpeg' });
					photoPreview = URL.createObjectURL(blob);
				}
				draftSavedAt = new Date();
				loadKonteksPreview();
			}
		})();
		registerAttendanceAutoFlush(sendQueuedPunch);
		if (isBreakMode) {
			loadIstirahatStatus();
			tickTimer = setInterval(() => (nowTick = Date.now()), 15000);
		}

		return registerFormPersistSaveTriggers(absenPersist, () => {
			if (!position) return { mode, lat: 0, lng: 0, accuracy: 0, kategoriId: selectedKategoriId };
			return { mode, lat: position.lat, lng: position.lng, accuracy: position.accuracy, kategoriId: selectedKategoriId };
		});
	});

	onDestroy(() => {
		if (tickTimer) clearInterval(tickTimer);
	});

	// Retry antrian offline HARUS menelan 409 "sudah absen..." sebagai sukses — itu
	// berarti punch yang sama sudah tercatat sebelumnya (lihat catatan idempotency di
	// offlineAttendanceQueue.ts), bukan kegagalan yang perlu diulang terus.
	async function sendQueuedPunch(entry: QueuedAttendanceSubmission) {
		const photoFile =
			entry.photoBlob.size > 0 ? new File([entry.photoBlob], entry.photoName, { type: entry.photoBlob.type || 'image/jpeg' }) : null;
		const params = {
			lat: entry.lat,
			lng: entry.lng,
			accuracy: entry.accuracy,
			lokasiAbsensiId: entry.lokasiAbsensiId,
			photoFile,
			livenessPassed: entry.livenessPassed,
			kategoriId: entry.kategoriId,
			perjalanan: entry.perjalanan ?? false,
			wstnPayload: entry.wstnPayload ?? null,
			konteksOverride: entry.konteksOverride ?? null
		};
		try {
			if (entry.type === 'clock_in') await clockIn({ ...params, photoFile: photoFile as File });
			else if (entry.type === 'clock_out') await clockOut({ ...params, photoFile: photoFile as File });
			else if (entry.type === 'break_out') await breakOut(params);
			else await breakIn({ ...params, photoFile: photoFile as File });
		} catch (err: any) {
			const msg = String(err?.message || '').toLowerCase();
			if (msg.includes('sudah absen')) return;
			throw err;
		}
	}

	async function requestLocation() {
		locating = true;
		locationError = '';
		try {
			position = await getCurrentPosition();
			if (photoFile) {
				const stampedFile = await watermarkPhoto(photoFile, { lat: position.lat, lng: position.lng, accuracy: position.accuracy });
				photoFile = stampedFile;
				await absenPersist.savePhoto(PHOTO_KEY, stampedFile);
			}
			persistNow();
			loadKonteksPreview();
		} catch (err: any) {
			locationError = err?.message || 'Gagal mengambil lokasi.';
		} finally {
			locating = false;
		}
	}

	let canSubmit = $derived.by(() => {
		if (submitting || !position) return false;
		if (fotoWajib && !photoFile) return false;
		if (mode === 'break-out' && !selectedKategoriId) return false;
		return true;
	});
	let queuedOffline = $state(false);

	async function handleSubmit() {
		if (!canSubmit || !position) return;
		vibrateTap();
		submitting = true;
		errorMsg = '';
		queuedOffline = false;
		try {
			const finalPhoto = photoFile ? await watermarkPhoto(photoFile, { lat: position.lat, lng: position.lng, accuracy: position.accuracy }) : null;
			const params = { lat: position.lat, lng: position.lng, accuracy: position.accuracy, livenessPassed, kategoriId: selectedKategoriId, perjalanan: perjalananMode, konteksOverride };
			if (mode === 'in') {
				await clockIn({ ...params, photoFile: finalPhoto as File });
			} else if (mode === 'out') {
				await clockOut({ ...params, photoFile: finalPhoto as File });
			} else if (mode === 'break-out') {
				await breakOut({ ...params, photoFile: finalPhoto });
			} else {
				const hasil = await breakIn({ ...params, photoFile: finalPhoto as File, wstnPayload });
				hasilKonteksLokasi = hasil?.konteksLokasi ?? null;
				hasilKualitasLabel = hasil?.kualitasLabel ?? null;
				hasilMejaTerverifikasi = !!hasil?.mejaTerverifikasi;
				hasilPeringatanGerbang = hasil?.modeGerbang === 'warn' && Number(hasil?.tier || 0) > 0;
			}
			success = true;
			absenPersist.clear();
			await absenPersist.clearPhotos();
			draftSavedAt = null;
		} catch (err: any) {
			// L-02 fix: `err instanceof TypeError` terlalu luas — bisa match bug kode biasa (mis. akses
			// properti undefined), bukan hanya kegagalan fetch jaringan. Cek juga pesan khas fetch gagal
			// (berbeda per browser: Chrome "Failed to fetch", Firefox "NetworkError...", Safari "Load failed").
			const isNetworkError = err instanceof TypeError &&
				/failed to fetch|networkerror|load failed/i.test(String(err?.message || ''));
			if (isNetworkError) {
				// Gagal jaringan (bukan error HTTP dari server) — simpan ke antrian offline,
				// dikirim ulang otomatis saat koneksi kembali (registerAttendanceAutoFlush).
				// Catatan risiko: berbeda dari clock-in/out (upsert per hari), break-out/break-in
				// menulis baris baru tanpa unique key — retry ganda secara teori bisa membuat 2
				// baris. Risiko rendah (network loss persis saat submit break jarang) dan diterima
				// sesuai rencana Fase 2; HRD bisa koreksi manual bila terjadi.
				try {
					const finalPhoto = photoFile
						? await watermarkPhoto(photoFile, { lat: position.lat, lng: position.lng, accuracy: position.accuracy })
						: null;
					await enqueueAttendanceSubmission({
						client_txn_id: crypto.randomUUID(),
						type: mode === 'in' ? 'clock_in' : mode === 'out' ? 'clock_out' : mode === 'break-out' ? 'break_out' : 'break_in',
						lat: position.lat,
						lng: position.lng,
						accuracy: position.accuracy,
						lokasiAbsensiId: null,
						photoBlob: finalPhoto || new Blob([], { type: 'image/jpeg' }),
						photoName: finalPhoto?.name || 'selfie.jpg',
						livenessPassed,
						kategoriId: selectedKategoriId,
						perjalanan: perjalananMode,
						wstnPayload,
						konteksOverride,
						createdAt: new Date().toISOString()
					});
					queuedOffline = true;
					success = true;
					absenPersist.clear();
					await absenPersist.clearPhotos();
					draftSavedAt = null;
				} catch (queueErr: any) {
					errorMsg = queueErr?.message || 'Gagal menyimpan absensi offline.';
				}
			} else {
				errorMsg = err?.message || 'Gagal mengirim absensi.';
			}
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">
				{MODE_TITLE[mode]} {queuedOffline ? 'tersimpan' : 'berhasil'}
			</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">
				{queuedOffline
					? 'Koneksi terputus — akan dikirim otomatis begitu sinyal kembali.'
					: 'Terima kasih, sampai jumpa lagi.'}
			</p>
			{#if hasilKonteksLokasi}
				<div class="mt-3 flex flex-col items-center gap-1.5">
					<span class="inline-block px-3 py-1 rounded-full text-[11px] font-semibold" style="background: var(--sys-bg2); color: var(--sys-label)">
						{KONTEKS_LABEL[hasilKonteksLokasi] ?? hasilKonteksLokasi}
					</span>
					{#if hasilKualitasLabel === 'BUKTI LEMAH'}
						<p class="text-[11px]" style="color: var(--sys-label3)">Tidak ada sanksi untuk istirahat di luar kantor — yang penting tercatat jujur.</p>
					{/if}
				</div>
			{/if}
			{#if hasilMejaTerverifikasi}
				<p class="mt-2 text-[11px] font-semibold" style="color: var(--green)">🖥️ Meja terverifikasi</p>
			{/if}
			{#if hasilPeringatanGerbang}
				<p class="mt-2 text-[11px] font-semibold" style="color: #D97706">⚠️ Ini tercatat dan dapat berujung teguran bila berulang.</p>
			{/if}
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/ess')}>
				Kembali ke Beranda
			</button>
		</div>
	{:else if isBreakMode && !istirahatLoading && istirahatStatus && !istirahatStatus.aktif}
		<div class="text-center py-16">
			<IconAlertTriangle size={32} style="color: #D97706; margin: 0 auto" />
			<p class="text-[13px] font-semibold mt-3" style="color: var(--sys-label)">Fitur absen istirahat mandiri belum aktif</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Hubungi HRD bila Anda merasa seharusnya sudah bisa memakai fitur ini.</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/ess')}>
				Kembali ke Beranda
			</button>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">{MODE_TITLE[mode]}</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
			{#if mode === 'break-out'}
				Pilih jenis istirahat, lalu izinkan lokasi untuk melanjutkan
			{:else}
				Ambil selfie dan izinkan lokasi untuk melanjutkan
			{/if}
		</p>

		<div class="flex flex-col gap-4">
			{#if mode === 'break-out'}
				<div>
					<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Jenis Istirahat</p>
					{#if istirahatLoading}
						<div class="flex items-center gap-2 text-[12px]" style="color: var(--sys-label3)">
							<IconLoader2 size={15} class="animate-spin" /> Memuat kategori...
						</div>
					{:else}
						<select
							class="w-full h-11 rounded-lg px-3 text-[13px] border"
							style="border-color: var(--sys-separator); background: var(--sys-bg2); color: var(--sys-label)"
							bind:value={selectedKategoriId}
						>
							{#each istirahatStatus?.kategoriAktif ?? [] as k (k.id)}
								<option value={k.id}>{k.nama}</option>
							{/each}
						</select>
						<p class="text-[11px] mt-1.5" style="color: var(--sys-label3)">
							{selectedKategori?.hitung_kuota
								? `Dihitung terhadap jatah istirahat ${istirahatStatus?.konfig?.makan_siang_menit ?? 60} menit.`
								: 'Tidak dihitung terhadap jatah istirahat.'}
						</p>
					{/if}
					<label class="flex items-center gap-2 mt-3 text-[12px]" style="color: var(--sys-label)">
						<input type="checkbox" bind:checked={perjalananMode} />
						Saya sedang dalam perjalanan (foto ditunda sampai tiba)
					</label>
				</div>
			{/if}

			{#if mode === 'break-in' && istirahatStatus?.jedaTerbuka}
				<div
					class="rounded-lg p-3 border"
					style={lewatBatas
						? 'background: var(--rel); border-color: #DC2626'
						: (menitBerjalan ?? 0) >= (kuotaMenit ?? Infinity) * 0.8 && hitungKuota
							? 'background: #FEF3C7; border-color: #D97706'
							: 'background: var(--g6); border-color: var(--green)'}
				>
					<p class="text-[12px] flex items-center gap-1.5" style={lewatBatas ? 'color: #DC2626' : 'color: var(--sys-label)'}>
						<IconClock size={14} />
						{jedaTerbukaKategori?.nama ?? 'Istirahat'} sejak {istirahatStatus.jedaTerbuka.jam_keluar} — sudah {menitBerjalan ?? 0} menit{hitungKuota && kuotaMenit != null ? ` dari ${kuotaMenit} menit` : ' berjalan'}
					</p>
					{#if lewatBatas}
						<p class="text-[11px] mt-1" style="color: #DC2626">
							Istirahat Anda lewat {(menitBerjalan ?? 0) - (kuotaMenit ?? 0)} menit. Akan tercatat sesuai kebijakan kedisiplinan.
						</p>
					{/if}
				</div>
			{/if}

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Lokasi</p>
				{#if locating}
					<div class="flex items-center gap-2 text-[12px]" style="color: var(--sys-label3)">
						<IconLoader2 size={15} class="animate-spin" /> Mengambil lokasi GPS...
					</div>
				{:else if locationError}
					<div class="rounded-lg p-3" style="background: var(--rel)">
						<p class="text-[12px] flex items-center gap-1.5" style="color: #DC2626"><IconAlertTriangle size={14} /> {locationError}</p>
						<button class="mt-2 text-[11px] font-semibold underline" style="color: #DC2626" onclick={requestLocation}>Coba lagi</button>
					</div>
				{:else if position}
					<div class="rounded-lg p-3 flex items-center gap-2 border" style="background: var(--g6); border-color: var(--green)">
						<IconMapPin size={16} style="color: var(--green)" />
						<p class="text-[12px]" style="color: var(--green)">Lokasi terdeteksi (akurasi ±{Math.round(position.accuracy)}m)</p>
					</div>
					<button
						type="button"
						class="mt-1.5 text-[11px] font-semibold flex items-center gap-1"
						style="color: var(--green)"
						onclick={toggleLocationMap}
					>
						📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
					</button>
					{#if showLocationMap && LocationMap}
						<div transition:slide={{ duration: 200 }}>
							<LocationMap lat={position.lat} lng={position.lng} label="Lokasi absen" height="200px" />
						</div>
					{/if}
				{:else}
					<button class="flex items-center gap-2 text-[12px] font-semibold px-4 py-2 rounded-lg text-white" style="background: var(--p, var(--g))" onclick={requestLocation}>
						<IconMapPin size={16} /> Ambil Lokasi
					</button>
				{/if}
			</div>

			{#if mode === 'break-in' && (previewLoading || previewKonteks || konteksOverride)}
				<div>
					<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Konteks Lokasi</p>
					{#if previewLoading && !previewKonteks && !konteksOverride}
						<div class="flex items-center gap-2 text-[12px]" style="color: var(--sys-label3)">
							<IconLoader2 size={15} class="animate-spin" /> Mendeteksi konteks lokasi...
						</div>
					{:else}
						<div class="rounded-lg p-3 flex items-center justify-between gap-2 border" style="background: var(--sys-bg2); border-color: var(--sys-separator)">
							<span class="text-[12px]" style="color: var(--sys-label)">
								{KONTEKS_LABEL[konteksOverride ?? previewKonteks ?? ''] ?? (konteksOverride ?? previewKonteks)}
							</span>
							<button type="button" class="text-[11px] font-semibold underline shrink-0" style="color: var(--p, var(--g))" onclick={() => (showKonteksPicker = !showKonteksPicker)}>
								Ubah lokasi
							</button>
						</div>
						{#if showKonteksPicker}
							<div class="mt-2 flex flex-col gap-1.5" transition:slide={{ duration: 150 }}>
								<p class="text-[11px]" style="color: var(--sys-label3)">Bila deteksi otomatis salah, pilih lokasi yang sebenarnya:</p>
								{#each KONTEKS_PILIHAN as opt}
									<button
										type="button"
										class="text-left text-[12px] px-3 py-2 rounded-lg border"
										style={`background: ${(konteksOverride ?? previewKonteks) === opt.value ? 'var(--g6)' : 'var(--sys-bg2)'}; border-color: ${(konteksOverride ?? previewKonteks) === opt.value ? 'var(--green)' : 'var(--sys-separator)'}; color: var(--sys-label)`}
										onclick={() => pilihKonteksOverride(opt.value)}
									>
										{opt.label}
									</button>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			{/if}

			{#if mode === 'break-in'}
				<div>
					<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">
						QR Meja <span style="color: var(--sys-label3); font-weight: 400">(opsional, untuk karyawan desk)</span>
					</p>
					{#if wstnPayload}
						<div class="rounded-lg p-3 flex items-center gap-2 border" style="background: var(--g6); border-color: var(--green)">
							<p class="text-[12px]" style="color: var(--green)">✓ QR meja terdeteksi</p>
						</div>
					{:else if showWstnScanner}
						<QrCameraScanner onDetect={handleWstnDetect} onClose={() => (showWstnScanner = false)} expectedPrefix="EPI:WSTN:" continuous={false} />
					{:else}
						<button type="button" class="text-[11px] font-semibold flex items-center gap-1" style="color: var(--p, var(--g))" onclick={() => (showWstnScanner = true)}>
							📷 Pindai QR di layar PC Anda
						</button>
					{/if}
				</div>
			{/if}

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">
					Verifikasi Wajah{#if !fotoWajib} <span style="color: var(--sys-label3); font-weight: 400">(opsional)</span>{/if}
				</p>
				{#if photoPreview}
					<div class="relative w-28 h-28 mb-2">
						<img src={photoPreview} alt="Preview" class="w-28 h-28 object-cover rounded-lg" />
						<button
							class="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-white"
							style="background: #DC2626"
							onclick={retakePhoto}
						>
							<IconX size={14} />
						</button>
					</div>
				{:else}
					<LivenessCamera onCapture={handleCapture} />
					{#if fotoWajib}
						<p class="text-[11px] mt-1.5" style="color: var(--sys-label3)">Foto wajib — pastikan wajah terlihat jelas dan tidak membelakangi cahaya.</p>
					{/if}
				{/if}
			</div>

			{#if errorMsg}
				<p class="text-[12px]" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<div class="flex justify-center">
				<DraftIndicator savedAt={draftSavedAt} />
			</div>

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--p, var(--g))"
				disabled={!canSubmit}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Kirim {MODE_TITLE[mode]}
			</button>
		</div>
	{/if}
</div>
