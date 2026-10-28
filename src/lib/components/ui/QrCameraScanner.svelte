<!-- src/lib/components/ui/QrCameraScanner.svelte -->
<!--
  Komponen Pemindai QR Code Kamera HP Berbasis html5-qrcode
  Mendukung: Auto-camera environment, Flashlight toggle, Camera switch, & Fallback File Upload
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
	import IconCamera from '@tabler/icons-svelte/icons/camera';
	import IconSwitchHorizontal from '@tabler/icons-svelte/icons/switch-horizontal';
	import IconBolt from '@tabler/icons-svelte/icons/bolt';
	import IconPhoto from '@tabler/icons-svelte/icons/photo';
	import IconX from '@tabler/icons-svelte/icons/x';
	import { vibrateTap } from '$lib/utils/haptic';

	let {
		onDetect,
		onClose,
		expectedPrefix = null,
		continuous = false,
		debounceMs = 1500
	}: {
		onDetect: (value: string) => void;
		onClose: () => void;
		expectedPrefix?: string | null;
		continuous?: boolean;
		debounceMs?: number;
	} = $props();

	let scannerId = `qr-reader-${Math.random().toString(36).substring(2, 9)}`;
	let html5Qrcode: Html5Qrcode | null = null;
	let isScanning = $state(false);
	let permissionError = $state('');
	let hintMsg = $state('');
	let torchSupported = $state(false);
	let torchOn = $state(false);
	let facingMode = $state<'environment' | 'user'>('environment');
	let fileInputEl: HTMLInputElement;
	let lastCode = '';
	let lastDetectAt = 0;

	// iPhone mengekspos beberapa lensa belakang (Wide/Ultra Wide/Telephoto) sebagai
	// device terpisah. Constraint `facingMode: environment` di Safari kerap memilih
	// lensa Ultra Wide, yang fokus minimumnya jauh lebih jauh dari label QR/barcode
	// kecil yang discan dari jarak dekat -- gambar selalu blur & tidak pernah
	// terbaca walau kotak overlay sudah pas membingkai QR. Pilih eksplisit lensa
	// Wide (utama) lewat device id untuk menghindari ini.
	async function pickBackCameraId(): Promise<string | null> {
		try {
			const cameras = await Html5Qrcode.getCameras();
			if (!cameras || cameras.length === 0) return null;
			const backCams = cameras.filter((c) => !/front/i.test(c.label));
			const pool = backCams.length > 0 ? backCams : cameras;
			const wideLens = pool.find((c) => !/ultra\s*wide|telephoto/i.test(c.label));
			return (wideLens || pool[0]).id;
		} catch {
			return null;
		}
	}

	// Track video aktif -- dipakai untuk mengatur fokus langsung (wrapper
	// applyVideoConstraints menolak key aspectRatio & tidak mengekspos setelan lain).
	function getVideoTrack(): MediaStreamTrack | null {
		const video = document.querySelector<HTMLVideoElement>(`#${scannerId} video`);
		const stream = video?.srcObject as MediaStream | null | undefined;
		return stream?.getVideoTracks?.()[0] ?? null;
	}

	// Paksa autofokus kontinu bila didukung perangkat. Dipanggil juga saat layar
	// disentuh (tap-to-focus) agar kamera mengulang fokus pada label yang dekat.
	async function applyContinuousFocus(refocus = false) {
		const track = getVideoTrack();
		if (!track) return;
		try {
			const caps = (track.getCapabilities?.() ?? {}) as any;
			const modes: string[] = caps.focusMode ?? [];
			if (!modes.includes('continuous')) return;
			if (refocus && modes.includes('single-shot')) {
				await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] } as any);
				await new Promise((r) => setTimeout(r, 400));
			}
			await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any);
		} catch {
			// perangkat tidak mendukung -- abaikan
		}
	}

	function describeCameraError(err: unknown): string {
		const name = (err as any)?.name || '';
		const text = String((err as any)?.message || err || '');
		if (name === 'NotAllowedError' || /permission|denied|NotAllowed/i.test(text)) {
			return 'Izin kamera ditolak — izinkan akses kamera untuk situs ini di pengaturan browser, lalu coba lagi.';
		}
		if (name === 'NotFoundError' || /no camera|not found|Requested device/i.test(text)) {
			return 'Kamera tidak ditemukan pada perangkat ini. Gunakan "File Gambar" atau input manual.';
		}
		if (name === 'NotReadableError' || /in use|not readable|Could not start/i.test(text)) {
			return 'Kamera sedang dipakai aplikasi/tab lain. Tutup aplikasi tersebut lalu coba lagi.';
		}
		if (!window.isSecureContext) {
			return 'Kamera hanya bisa dipakai lewat koneksi HTTPS.';
		}
		return 'Kamera tidak dapat dibuka — coba lagi atau gunakan "File Gambar".';
	}

	async function initScanner() {
		try {
			permissionError = '';
			hintMsg = '';
			if (!html5Qrcode) {
				html5Qrcode = new Html5Qrcode(scannerId, {
					// Hanya QR -- decoder tidak membuang waktu mencoba format barcode lain.
					formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
					// Native BarcodeDetector (Android Chrome) jauh lebih akurat dari fallback JS.
					experimentalFeatures: { useBarCodeDetectorIfSupported: true },
					verbose: false
				} as any);
			}

			// Kamera & resolusi diminta dalam SATU constraint getUserMedia. Sebelumnya
			// aspectRatio dikirim lewat config sehingga library memanggil applyConstraints
			// terpisah yang mereset resolusi ke default rendah (QR padat jadi blur/tak terbaca),
			// dan constraint `advanced` (fokus) ikut terbuang karena cameraIdOrConfig
			// hanya menerima 1 key (facingMode ATAU deviceId) -> 'Ganti Kamera' ke depan error.
			const videoConstraints: MediaTrackConstraints = {
				width: { ideal: 1280 },
				height: { ideal: 1280 },
				aspectRatio: { ideal: 1 },
				advanced: [{ focusMode: 'continuous' } as any]
			};
			const backCameraId = facingMode === 'environment' ? await pickBackCameraId() : null;
			if (backCameraId) {
				videoConstraints.deviceId = { exact: backCameraId };
			} else {
				videoConstraints.facingMode = { ideal: facingMode };
			}

			const config = {
				fps: 15,
				qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
					// Box responsif ~75% sisi terpendek — box tetap (250px) sering
					// lebih besar dari area video di HP sehingga gagal start/scan.
					const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
					const size = Math.floor(minEdge * 0.75);
					return { width: size, height: size };
				},
				videoConstraints
			};

			await html5Qrcode.start(
				// Diabaikan library bila videoConstraints valid, tapi wajib ada.
				{ facingMode },
				config as any,
				(decodedText) => {
					handleSuccess(decodedText);
				},
				() => {
					// scan failure / quiet frame - normal loop
				}
			);

			isScanning = true;
			torchOn = false;
			hintMsg = 'Jauhkan HP ±15–20 cm dari QR, ketuk layar untuk fokus ulang.';

			// Cek dukungan senter / torch + pastikan autofokus kontinu aktif
			try {
				const capabilities = html5Qrcode.getRunningTrackCapabilities();
				torchSupported = Boolean((capabilities as any)?.torch);
			} catch {
				torchSupported = false;
			}
			await applyContinuousFocus();
		} catch (err: any) {
			isScanning = false;
			permissionError = describeCameraError(err);
			console.error('[QrCameraScanner] Gagal membuka kamera:', err);
		}
	}

	function handleSuccess(decodedText: string) {
		if (expectedPrefix && !decodedText.startsWith(expectedPrefix)) {
			return; // abaikan QR yang tidak cocok dengan prefix
		}

		vibrateTap();

		if (!continuous) {
			stopScanner().then(() => {
				onDetect(decodedText);
			});
			return;
		}

		const now = performance.now();
		if (decodedText !== lastCode || now - lastDetectAt > debounceMs) {
			lastCode = decodedText;
			lastDetectAt = now;
			onDetect(decodedText);
		}
	}

	async function toggleTorch() {
		if (!html5Qrcode || !torchSupported) return;
		try {
			torchOn = !torchOn;
			await html5Qrcode.applyVideoConstraints({
				advanced: [{ torch: torchOn }] as any
			});
		} catch (e) {
			console.warn('[QrCameraScanner] Gagal merubah status senter:', e);
		}
	}

	async function switchCamera() {
		if (!html5Qrcode) return;
		facingMode = facingMode === 'environment' ? 'user' : 'environment';
		await stopScanner();
		await initScanner();
	}

	async function handleFileUpload(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		// scanFile() melempar error selama kamera masih berjalan ("ongoing camera scan"),
		// jadi kamera dihentikan dulu dan dinyalakan lagi bila gambar gagal dibaca.
		await stopScanner();
		let result: string | null = null;
		try {
			if (!html5Qrcode) {
				html5Qrcode = new Html5Qrcode(scannerId, {
					formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
					verbose: false
				} as any);
			}
			result = await html5Qrcode.scanFile(file, false);
		} catch {
			result = null;
		}
		target.value = '';

		if (result && (!expectedPrefix || result.startsWith(expectedPrefix))) {
			if (!continuous) {
				vibrateTap();
				onDetect(result);
				return;
			}
			handleSuccess(result);
		} else {
			alert(result ? 'QR pada gambar bukan jenis yang diharapkan.' : 'QR Code tidak ditemukan pada gambar. Pastikan gambar jelas dan QR terlihat utuh.');
		}
		await initScanner();
	}

	async function stopScanner() {
		if (html5Qrcode && isScanning) {
			try {
				await html5Qrcode.stop();
			} catch {}
			isScanning = false;
			torchSupported = false;
			torchOn = false;
		}
	}

	onMount(() => {
		initScanner();
	});

	onDestroy(() => {
		stopScanner();
	});
</script>

<div class="fixed inset-0 bg-black/85 z-50 flex flex-col items-center justify-center p-4">
	<div class="w-full max-w-sm bg-slate-900 rounded-2xl overflow-hidden relative shadow-2xl border border-slate-800 flex flex-col">
		<!-- Header bar -->
		<div class="p-3 bg-slate-950/80 flex items-center justify-between border-b border-slate-800 text-white">
			<div class="flex items-center gap-2">
				<IconCamera size={18} class="text-emerald-400" />
				<span class="text-xs font-semibold">Pindai QR Code</span>
			</div>
			<button
				onclick={async () => {
					await stopScanner();
					onClose();
				}}
				class="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
			>
				<IconX size={18} />
			</button>
		</div>

		<!-- Scanner container -->
		<div class="relative w-full aspect-square bg-black flex items-center justify-center">
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div id={scannerId} class="w-full h-full object-cover" onclick={() => applyContinuousFocus(true)}></div>

			{#if permissionError}
				<div class="absolute inset-0 p-6 text-center text-white text-xs bg-slate-950/90 flex flex-col items-center justify-center gap-3">
					<p class="text-rose-400 font-medium">{permissionError}</p>
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={initScanner}
							class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold"
						>
							Coba Lagi
						</button>
						<button
							type="button"
							onclick={() => fileInputEl?.click()}
							class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1"
						>
							<IconPhoto size={15} /> Upload Gambar
						</button>
					</div>
				</div>
			{/if}
		</div>

		{#if hintMsg && !permissionError}
			<p class="px-3 py-1.5 bg-slate-950/90 text-center text-[11px] text-slate-400 border-t border-slate-800">{hintMsg}</p>
		{/if}

		<!-- Controls bar -->
		<div class="p-3 bg-slate-950/90 flex items-center justify-around border-t border-slate-800 text-slate-300">
			{#if torchSupported}
				<button
					onclick={toggleTorch}
					class="flex flex-col items-center gap-1 text-[11px] hover:text-white transition-colors {torchOn ? 'text-amber-400' : ''}"
					title="Senter Kamera"
				>
					<IconBolt size={20} />
					<span>Senter</span>
				</button>
			{/if}

			<button
				onclick={switchCamera}
				class="flex flex-col items-center gap-1 text-[11px] hover:text-white transition-colors"
				title="Ganti Kamera Front/Back"
			>
				<IconSwitchHorizontal size={20} />
				<span>Ganti Kamera</span>
			</button>

			<button
				onclick={() => fileInputEl?.click()}
				class="flex flex-col items-center gap-1 text-[11px] hover:text-white transition-colors"
				title="Pindai Gambar dari Galeri"
			>
				<IconPhoto size={20} />
				<span>File Gambar</span>
			</button>

			<input
				type="file"
				accept="image/*"
				bind:this={fileInputEl}
				onchange={handleFileUpload}
				class="hidden"
			/>
		</div>
	</div>

	<button
		onclick={async () => {
			await stopScanner();
			onClose();
		}}
		class="mt-4 px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold backdrop-blur-md transition-colors"
	>
		Tutup / Cari Manual
	</button>
</div>
