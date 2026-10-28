<script lang="ts">
	// ESS HRD v3 Fase 1 — capture selfie via kamera live + liveness challenge acak.
	//
	// Liveness di sini adalah heuristic frame-diff (motion) di browser, BUKAN model ML
	// blink/smile detection (face-api.js/MediaPipe butuh unduh model weight eksternal —
	// di luar cakupan yang bisa diverifikasi jalan tanpa asset itu di sesi ini). Prinsipnya
	// tetap sama: foto statis yang ditahan diam (mis. cetakan/layar HP lain) tidak akan
	// menunjukkan gerakan wajah yang diminta, jadi motion-diff selama window challenge tetap
	// jadi sinyal anti-photo-attack yang nyata, hanya bukan ML lengkap.
	//
	// Fail-safe: kalau kamera/izin tidak tersedia, fallback ke file input native (livenessPassed
	// selalu false pada jalur ini) — absensi tetap bisa lanjut, hasil dicatat utk review HRD
	// (pola sama seperti masuk_valid/pulang_valid existing).

	import { onDestroy, tick } from 'svelte';
	import { IconCamera, IconLoader2, IconX } from '@tabler/icons-svelte';

	let { onCapture }: { onCapture: (file: File, livenessPassed: boolean) => void } = $props();

	const CHALLENGES = ['Gerakkan kepala pelan ke kiri lalu kanan', 'Berkedip 2 kali', 'Tersenyum ke kamera'];
	const CHALLENGE_MS = 3000;
	const SAMPLE_INTERVAL_MS = 150;
	const MOTION_MIN = 4; // ambang bawah: ada gerakan wajar (bukan foto statis diam)
	const MOTION_MAX = 90; // ambang atas: gerakan/goncangan berlebihan dianggap tidak valid

	let stage = $state<'idle' | 'starting' | 'challenge' | 'preview' | 'unsupported'>('idle');
	let challengeText = $state('');
	let countdownMs = $state(CHALLENGE_MS);
	let motionScore = $state(0);
	let previewUrl = $state<string | null>(null);
	let cameraError = $state('');

	let videoEl: HTMLVideoElement | undefined = $state();
	let stream: MediaStream | null = null;
	let sampleTimer: ReturnType<typeof setInterval> | null = null;
	let countdownTimer: ReturnType<typeof setInterval> | null = null;
	let prevFrame: ImageData | null = null;

	function stopStream() {
		if (sampleTimer) clearInterval(sampleTimer);
		if (countdownTimer) clearInterval(countdownTimer);
		sampleTimer = null;
		countdownTimer = null;
		if (stream) {
			stream.getTracks().forEach((t) => t.stop());
			stream = null;
		}
	}

	onDestroy(() => {
		stopStream();
	});

	function sampleGrayscale(): ImageData | null {
		if (!videoEl || videoEl.videoWidth === 0) return null;
		const canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 64;
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		ctx.drawImage(videoEl, 0, 0, 64, 64);
		return ctx.getImageData(0, 0, 64, 64);
	}

	function frameDiff(a: ImageData, b: ImageData): number {
		let total = 0;
		for (let i = 0; i < a.data.length; i += 4) {
			total += Math.abs(a.data[i] - b.data[i]);
		}
		return total / (a.data.length / 4);
	}

	async function start() {
		cameraError = '';
		if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
			stage = 'unsupported';
			return;
		}
		stage = 'starting';
		await tick();

		try {
			stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
			}
		} catch (err: any) {
			cameraError = err?.message || 'Tidak bisa mengakses kamera.';
			stage = 'unsupported';
			stopStream();
			return;
		}

		challengeText = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
		countdownMs = CHALLENGE_MS;
		motionScore = 0;
		prevFrame = null;
		stage = 'challenge';

		sampleTimer = setInterval(() => {
			const frame = sampleGrayscale();
			if (frame) {
				if (prevFrame) motionScore += frameDiff(prevFrame, frame);
				prevFrame = frame;
			}
		}, SAMPLE_INTERVAL_MS);

		countdownTimer = setInterval(() => {
			countdownMs -= 100;
			if (countdownMs <= 0) finishChallenge();
		}, 100);
	}

	function finishChallenge() {
		if (!videoEl) return;

		const canvas = document.createElement('canvas');
		canvas.width = videoEl.videoWidth || 480;
		canvas.height = videoEl.videoHeight || 640;
		const ctx = canvas.getContext('2d');
		ctx?.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

		stopStream();
		if (videoEl) {
			videoEl.srcObject = null;
		}

		canvas.toBlob(
			(blob) => {
				if (!blob) return;
				const file = new File([blob], `liveness-${Date.now()}.jpg`, { type: 'image/jpeg' });
				const livenessPassed = motionScore >= MOTION_MIN && motionScore <= MOTION_MAX;
				previewUrl = URL.createObjectURL(blob);
				stage = 'preview';
				onCapture(file, livenessPassed);
			},
			'image/jpeg',
			0.85
		);
	}

	function retake() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
		stage = 'idle';
	}

	function handleFallbackFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		previewUrl = URL.createObjectURL(file);
		stage = 'preview';
		onCapture(file, false);
	}
</script>

<div class="flex flex-col gap-2">
	{#if stage === 'idle'}
		<button
			class="flex items-center gap-2 text-[12px] font-semibold px-4 py-2 rounded-lg text-white w-fit"
			style="background: var(--p, var(--g))"
			onclick={start}
		>
			<IconCamera size={16} /> Mulai Verifikasi Wajah
		</button>
	{:else if stage === 'starting' || stage === 'challenge'}
		<div class="relative w-40 h-40 rounded-lg overflow-hidden" style="background: #000">
			<!-- svelte-ignore a11y_media_has_caption -->
			<video bind:this={videoEl} muted playsinline class="w-full h-full object-cover scale-x-[-1]"></video>
			{#if stage === 'starting'}
				<div class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/70 text-white text-[12px] p-2 text-center">
					<IconLoader2 size={20} class="animate-spin" />
					<span>Membuka kamera...</span>
				</div>
			{/if}
		</div>
		{#if stage === 'challenge'}
			<p class="text-[12px] font-semibold" style="color: var(--sys-label)">{challengeText}</p>
			<p class="text-[11px]" style="color: var(--sys-label3)">Tahan {Math.ceil(countdownMs / 1000)} detik lagi...</p>
		{/if}
	{:else if stage === 'preview' && previewUrl}
		<div class="relative w-28 h-28">
			<img src={previewUrl} alt="Preview" class="w-28 h-28 object-cover rounded-lg" />
			<button
				class="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-white"
				style="background: #DC2626"
				onclick={retake}
			>
				<IconX size={14} />
			</button>
		</div>
	{:else if stage === 'unsupported'}
		<div class="rounded-lg p-3" style="background: var(--rel)">
			<p class="text-[12px]" style="color: #DC2626">
				{cameraError || 'Kamera tidak tersedia di perangkat ini.'} Gunakan foto manual sebagai gantinya.
			</p>
		</div>
		<label
			class="w-28 h-28 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer"
			style="border-color: var(--sys-sep)"
		>
			<IconCamera size={22} style="color: var(--sys-label4)" />
			<span class="text-[10px]" style="color: var(--sys-label4)">Ambil selfie</span>
			<input type="file" accept="image/*" capture="user" class="hidden" onchange={handleFallbackFile} />
		</label>
	{/if}
</div>

