<!-- src/routes/NavigationProgressBar.svelte -->
<script lang="ts">
	import { navigating } from '$app/stores';
	import { onDestroy } from 'svelte';

	let progress = $state(0);
	let visible = $state(false);
	let isSlow = $state(false);
	let trickleInterval: ReturnType<typeof setInterval> | null = null;
	let slowTimeout: ReturnType<typeof setTimeout> | null = null;
	let resetTimeout: ReturnType<typeof setTimeout> | null = null;

	function start() {
		clearTimers();
		visible = true;
		isSlow = false;
		progress = 25; // Feedback instan saat klik menu/tombol

		// Kurva trickle dinamis
		trickleInterval = setInterval(() => {
			if (progress < 50) {
				progress += 8 + Math.random() * 4;
			} else if (progress < 70) {
				progress += 4 + Math.random() * 3;
			} else if (progress < 85) {
				progress += 1.5 + Math.random() * 1.5;
			} else if (progress < 95) {
				progress += 0.4 + Math.random() * 0.4;
			}
			if (progress > 95) progress = 95;
		}, 200);

		// Jika navigasi > 2.2 detik (sinyal lapangan 3G/4G lemot), tampilkan status pill
		slowTimeout = setTimeout(() => {
			if (visible && progress < 100) {
				isSlow = true;
			}
		}, 2200);
	}

	function complete() {
		if (!visible) return;
		if (trickleInterval) clearInterval(trickleInterval);
		if (slowTimeout) clearTimeout(slowTimeout);
		progress = 100;
		isSlow = false;

		// Tunggu transisi ke 100%, lalu fade-out
		resetTimeout = setTimeout(() => {
			visible = false;
			setTimeout(() => {
				progress = 0;
			}, 250);
		}, 180);
	}

	function clearTimers() {
		if (trickleInterval) clearInterval(trickleInterval);
		if (slowTimeout) clearTimeout(slowTimeout);
		if (resetTimeout) clearTimeout(resetTimeout);
	}

	$effect(() => {
		if ($navigating) {
			start();
		} else {
			complete();
		}
	});

	onDestroy(() => {
		clearTimers();
	});
</script>

{#if visible}
	<div 
		class="fixed top-0 left-0 right-0 z-[999999] pointer-events-none transition-opacity duration-200"
		style="opacity: {visible ? 1 : 0}"
		role="progressbar"
		aria-valuenow={Math.round(progress)}
		aria-valuemin={0}
		aria-valuemax={100}
	>
		<!-- Top Progress Bar with Field-Branded Glow (Emerald / Cyan) -->
		<div 
			class="h-[3px] bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 shadow-[0_0_12px_rgba(16,185,129,0.8)] transition-all ease-out relative"
			style="width: {progress}%; transition-duration: {progress === 100 ? '160ms' : '220ms'};"
		>
			<!-- Glowing Peg Head -->
			<div class="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-r from-transparent to-white/70 blur-[1px]"></div>
		</div>

		<!-- Floating Slow Notification Pill -->
		{#if isSlow}
			<div class="absolute top-2 right-4 flex items-center gap-2 px-3 py-1 bg-slate-900/90 text-white border border-emerald-500/40 rounded-full shadow-lg text-xs backdrop-blur-md">
				<span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
				<span class="font-medium text-slate-200">Memuat halaman... <span class="text-emerald-300 font-bold">{Math.round(progress)}%</span></span>
			</div>
		{/if}
	</div>
{/if}
