<!-- src/lib/components/scanner/CameraCaptureModal.svelte -->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { IconCamera, IconX, IconRefresh, IconCheck, IconCameraRotate } from '@tabler/icons-svelte';
	import { isWeakDevice } from '$lib/utils/deviceProfile';
	import { isHematActive } from '$lib/stores/hematStore';

	let {
		onCapture,
		onClose,
		// Paket 03 §3.5 — default 'environment' TIDAK BERUBAH untuk semua pemanggil lain
		// (absensi, patroli, laporan, dst.) yang tidak mengisi prop ini secara eksplisit.
		facing = 'environment'
	}: {
		onCapture: (file: File) => void;
		onClose: () => void;
		facing?: 'user' | 'environment';
	} = $props();

	let videoEl: HTMLVideoElement;
	let canvasEl: HTMLCanvasElement;
	let galleryInputEl: HTMLInputElement;
	let stream: MediaStream | null = null;
	let permissionError = $state('');
	let starting = $state(true);
	let capturedImage = $state<string | null>(null);
	// Paket 03 §3.5 — kamera aktif saat ini, bisa ditukar via tombol putar (beda dari `facing`
	// prop yang hanya menentukan titik awal).
	let currentFacing = $state<'user' | 'environment'>(facing);
	// Tombol putar HANYA tampil bila perangkat memang punya >1 kamera video.
	let punyaLebihDariSatuKamera = $state(false);

	async function cekJumlahKamera() {
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			punyaLebihDariSatuKamera = devices.filter((d) => d.kind === 'videoinput').length > 1;
		} catch {
			punyaLebihDariSatuKamera = false; // gagal-lunak — tombol putar disembunyikan, bukan error
		}
	}

	// Perangkat lemah (RAM/CPU rendah) ATAU Mode Hemat aktif dapat resolusi lebih kecil (rencana v2, 1.5 & 5.1).
	function cameraConstraints() {
		const lemah = isWeakDevice() || isHematActive();
		return {
			facingMode: currentFacing,
			width: { ideal: lemah ? 640 : 1280 },
			height: { ideal: lemah ? 480 : 720 }
		};
	}

	async function startCamera() {
		starting = true;
		permissionError = '';
		capturedImage = null;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints() });
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
			}
			starting = false;
			cekJumlahKamera(); // label device kamera baru terisi setelah izin diberikan
		} catch (e: any) {
			starting = false;
			permissionError = 'Kamera tidak tersedia atau izin ditolak.';
			console.error('Gagal membuka kamera', e);
		}
	}

	function putarKamera() {
		currentFacing = currentFacing === 'environment' ? 'user' : 'environment';
		stopStream();
		startCamera();
	}

	function onGalleryFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) {
			stopStream();
			onCapture(file);
		}
	}

	function stopStream() {
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	function capturePhoto() {
		if (!videoEl || !canvasEl) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;

		// Set canvas size to match video resolution
		canvasEl.width = videoEl.videoWidth;
		canvasEl.height = videoEl.videoHeight;

		// Draw current frame to canvas
		ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

		// Get base64 data URL for preview
		capturedImage = canvasEl.toDataURL('image/jpeg', 0.85);

		// Stop camera stream to save resources
		stopStream();
	}

	function retakePhoto() {
		startCamera();
	}

	function usePhoto() {
		if (!canvasEl) return;
		canvasEl.toBlob((blob) => {
			if (blob) {
				const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
				onCapture(file);
			}
		}, 'image/jpeg', 0.85);
	}

	onMount(startCamera);
	onDestroy(stopStream);
</script>

<div class="fixed inset-0 bg-black/95 z-55 flex flex-col items-center justify-center p-4" style="z-index: 9999;">
	<div class="w-full max-w-sm bg-zinc-900 rounded-2xl overflow-hidden relative shadow-2xl flex flex-col">
		<div class="p-4 flex items-center justify-between border-b border-zinc-800 text-white">
			<span class="text-sm font-bold">Ambil Foto</span>
			<button type="button" onclick={() => { stopStream(); onClose(); }} class="text-zinc-400 hover:text-white">
				<IconX size={20} />
			</button>
		</div>

		<div class="relative w-full aspect-[3/4] bg-black flex items-center justify-center overflow-hidden">
			{#if permissionError}
				<div class="p-8 text-center text-white text-sm">
					<p>{permissionError}</p>
				</div>
			{:else if capturedImage}
				<img src={capturedImage} alt="Preview" class="w-full h-full object-cover" />
			{:else}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video bind:this={videoEl} class="w-full h-full object-cover" muted playsinline></video>
				{#if starting}
					<div class="absolute inset-0 flex items-center justify-center text-white text-xs bg-black/60">
						Membuka kamera...
					</div>
				{/if}
				<!-- Paket 03 §3.5 — tombol putar kamera, hanya tampil bila perangkat punya >1 kamera. -->
				{#if punyaLebihDariSatuKamera && !starting}
					<button
						type="button"
						onclick={putarKamera}
						title="Putar kamera"
						class="absolute top-3 right-3 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-all"
					>
						<IconCameraRotate size={20} />
					</button>
				{/if}
			{/if}
			<canvas bind:this={canvasEl} class="hidden"></canvas>
		</div>

		<div class="p-6 bg-zinc-950 flex justify-center items-center gap-6">
			{#if permissionError}
				<div class="flex flex-col items-center gap-3 w-full px-6">
					<button
						type="button"
						onclick={startCamera}
						class="w-full px-6 py-2.5 bg-white hover:bg-zinc-200 text-zinc-900 rounded-xl text-sm font-bold transition-all"
					>
						Coba Lagi
					</button>
					<button
						type="button"
						onclick={() => galleryInputEl?.click()}
						class="w-full px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-bold transition-all"
					>
						Pilih dari Galeri
					</button>
					<button
						type="button"
						onclick={() => { stopStream(); onClose(); }}
						class="text-zinc-400 hover:text-white text-xs font-medium underline"
					>
						Lewati
					</button>
					<input
						bind:this={galleryInputEl}
						type="file"
						accept="image/*"
						capture={currentFacing}
						class="hidden"
						onchange={onGalleryFileChange}
					/>
				</div>
			{:else if capturedImage}
				<button
					type="button"
					onclick={retakePhoto}
					class="flex flex-col items-center gap-1.5 text-zinc-400 hover:text-white transition-all"
				>
					<div class="w-12 h-12 rounded-full bg-zinc-800 hover:bg-zinc-750 flex items-center justify-center text-white">
						<IconRefresh size={20} />
					</div>
					<span class="text-[11px] font-medium">Ulangi</span>
				</button>
				<button
					type="button"
					onclick={usePhoto}
					class="flex flex-col items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition-all"
				>
					<div class="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center text-white shadow-lg">
						<IconCheck size={32} />
					</div>
					<span class="text-[12px] font-bold">Oke</span>
				</button>
			{:else}
				<button
					type="button"
					onclick={capturePhoto}
					disabled={starting}
					class="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 flex items-center justify-center text-white shadow-lg active:scale-95 transition-all"
				>
					<IconCamera size={28} />
				</button>
			{/if}
		</div>
	</div>
</div>
