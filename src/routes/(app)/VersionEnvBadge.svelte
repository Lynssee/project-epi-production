<!-- src/routes/(app)/VersionEnvBadge.svelte -->
<!-- Indikator Lingkungan & Versi Aplikasi di Header Lapangan (project-epi, Fase 1 & 2).
     Zero-Overhead:
     1. Deteksi lingkungan lokal / sandbox / live via browser hostname.
     2. Metadata build (git commit hash, branch Major, versi) terbaca dari /api/version-info (cached 5m).
     3. Terintegrasi dengan deteksi update PWA / SvelteKit.
     4. Popover hover/click informatif dengan Catatan Pembaruan Lapangan & tombol salin diagnostik. -->

<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { fade, scale } from 'svelte/transition';
	import { IconCheck, IconCopy, IconRefresh, IconSparkles } from '@tabler/icons-svelte';

	interface ReleaseNoteItem {
		id: number;
		versi: string;
		judul: string;
		ringkasan: string;
		tipe: string;
		tanggal_rilis: string;
	}

	interface EnvRules {
		show_accent_bar: boolean;
		custom_sandbox_domains: string[];
	}

	interface VersionData {
		version: string;
		gitHash: string;
		gitBranch: string;
		commitDate: string;
		commitMessage: string;
		releaseNotes?: ReleaseNoteItem[];
		envRules?: EnvRules;
	}

	let appVersion = $state<VersionData>({
		version: 'v2026.10.27',
		gitHash: '2279fbd',
		gitBranch: 'Major',
		commitDate: '2026-10-27',
		commitMessage: 'Latest release build',
		releaseNotes: []
	});

	let hostname = $state('');
	let port = $state('');
	let popoverOpen = $state(false);
	let closeTimeout: ReturnType<typeof setTimeout> | null = null;
	let copiedDiagnostic = $state(false);
	let isUpdateAvailable = $state(false);
	let loadingReleaseNotes = $state(false);
	let hasFetched = $state(false);

	// Klasifikasi lingkungan
	let envType = $derived.by(() => {
		if (!browser && !hostname) return 'local';
		const h = (hostname || '').toLowerCase();
		if (
			h === 'localhost' ||
			h === '127.0.0.1' ||
			h.endsWith('.local') ||
			/^192\.168\./.test(h) ||
			/^10\./.test(h)
		) {
			return 'local';
		}
		if (
			h.includes('sandbox') ||
			h.includes('dev.') ||
			h.includes('staging') ||
			h.startsWith('dev-') ||
			h.startsWith('sandbox-') ||
			(appVersion.envRules?.custom_sandbox_domains || []).some((d) => h.includes(d.toLowerCase()))
		) {
			return 'sandbox';
		}
		return 'live';
	});

	// Konfigurasi visual lingkungan
	let envConfig = $derived.by(() => {
		switch (envType) {
			case 'local':
				return {
					label: 'LOKAL',
					fullTitle: 'Lingkungan Lokal Lapangan (Dev)',
					badgeBg: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
					dotColor: 'bg-emerald-500',
					accentBar: 'bg-emerald-500',
					tagLabel: `Port ${port || '5173'}`
				};
			case 'sandbox':
				return {
					label: 'SANDBOX',
					fullTitle: 'Lingkungan Sandbox Lapangan',
					badgeBg: 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800',
					dotColor: 'bg-amber-500',
					accentBar: 'bg-amber-500',
					tagLabel: 'Staging Test'
				};
			case 'live':
			default:
				return {
					label: 'LIVE',
					fullTitle: 'Server Live Lapangan (Produksi)',
					badgeBg: 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
					dotColor: 'bg-blue-500',
					accentBar: null,
					tagLabel: 'Cloudflare Edge'
				};
		}
	});

	function fetchVersionInfo() {
		if (!browser || hasFetched || loadingReleaseNotes) return;
		loadingReleaseNotes = true;
		fetch('/api/version-info')
			.then((r) => r.json())
			.then((res) => {
				if (res?.success && res?.data) {
					appVersion = res.data;
					hasFetched = true;
				}
			})
			.catch(() => {})
			.finally(() => {
				loadingReleaseNotes = false;
			});
	}

	onMount(() => {
		if (browser) {
			hostname = window.location.hostname;
			port = window.location.port;

			// Pantau PWA Service Worker needRefresh jika ada
			import('virtual:pwa-register/svelte')
				.then(({ useRegisterSW }) => {
					const sw = useRegisterSW({});
					sw.needRefresh?.subscribe((val) => {
						isUpdateAvailable = val;
					});
				})
				.catch(() => {});
		}
	});

	function handleMouseEnter() {
		if (closeTimeout) clearTimeout(closeTimeout);
		popoverOpen = true;
		fetchVersionInfo();
	}

	function handleMouseLeave() {
		closeTimeout = setTimeout(() => {
			popoverOpen = false;
		}, 250);
	}

	function togglePopover() {
		popoverOpen = !popoverOpen;
		if (popoverOpen) {
			fetchVersionInfo();
		}
	}

	function getBadgeTipe(t: string) {
		switch (t) {
			case 'major':
				return 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300';
			case 'minor':
				return 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300';
			case 'patch':
			case 'fix':
				return 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300';
			case 'security':
				return 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300';
			default:
				return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
		}
	}

	function getLabelTipe(t: string) {
		switch (t) {
			case 'major':
				return 'Major';
			case 'minor':
				return 'Fitur Baru';
			case 'patch':
				return 'Patch';
			case 'fix':
				return 'Perbaikan';
			case 'security':
				return 'Keamanan';
			default:
				return 'Update';
		}
	}

	async function copySystemDiagnostic() {
		if (!browser) return;
		const diagText = [
			`[DIAGNOSTIK SISTEM ELTAMA LAPANGAN]`,
			`Aplikasi: project-epi (Lapangan)`,
			`Lingkungan: ${envConfig.label} (${hostname}${port ? `:${port}` : ''})`,
			`Versi: ${appVersion.version}`,
			`Git Commit: ${appVersion.gitHash || 'N/A'} (${appVersion.gitBranch})`,
			`Tanggal Rilis: ${appVersion.commitDate || 'N/A'}`,
			`Status Kesegaran: ${isUpdateAvailable ? 'Ada update baru' : 'Up-to-date'}`,
			`User Agent: ${navigator.userAgent}`
		].join('\n');

		try {
			await navigator.clipboard.writeText(diagText);
			copiedDiagnostic = true;
			setTimeout(() => {
				copiedDiagnostic = false;
			}, 3000);
		} catch {
			// abaikan
		}
	}

	function reloadApplication() {
		if (browser) {
			window.location.reload();
		}
	}
</script>

<!-- Dev Safeguard: Bar aksen 2.5px di tepi atas layar untuk Lokal & Sandbox -->
{#if envConfig.accentBar && appVersion.envRules?.show_accent_bar !== false}
	<div
		class="fixed top-0 left-0 right-0 h-[2.5px] {envConfig.accentBar} z-[9999] pointer-events-none opacity-90 transition-all"
		title="Indikator {envConfig.fullTitle}"
	></div>
{/if}

<div
	class="relative inline-block"
	onmouseenter={handleMouseEnter}
	onmouseleave={handleMouseLeave}
	role="region"
	aria-label="Informasi Lingkungan dan Versi Aplikasi Lapangan"
>
	<!-- Tombol Badge / Chip Navbar -->
	<button
		type="button"
		onclick={togglePopover}
		class="flex items-center gap-1.5 px-2 py-1 rounded-xl text-[11px] font-semibold border transition-all duration-200 select-none {envConfig.badgeBg} hover:shadow-xs active:scale-95"
		title="Lingkungan: {envConfig.fullTitle} • Versi: {appVersion.version}"
		aria-expanded={popoverOpen}
	>
		<!-- Titik Indikator Warna Lingkungan -->
		<span class="relative flex h-2 w-2">
			{#if isUpdateAvailable}
				<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
			{/if}
			<span class="relative inline-flex rounded-full h-2 w-2 {envConfig.dotColor}"></span>
		</span>

		<!-- Label Lingkungan -->
		<span class="font-bold tracking-wider">{envConfig.label}</span>

		<span class="opacity-30">•</span>

		<!-- Versi / Commit Hash -->
		<span class="font-mono text-[10.5px] opacity-90">
			{appVersion.version}{appVersion.gitHash ? `#${appVersion.gitHash.slice(0, 5)}` : ''}
		</span>

		<!-- Indikator Update Jika Tersedia -->
		{#if isUpdateAvailable}
			<span class="ml-0.5 inline-flex items-center gap-0.5 px-1 py-0.2 text-[9px] font-bold rounded-md bg-amber-500 text-white animate-pulse">
				<IconSparkles size={10} />
				Update
			</span>
		{/if}
	</button>

	<!-- Popover Detail (Saat di-Hover atau di-Klik) -->
	{#if popoverOpen}
		<div
			transition:scale={{ duration: 150, start: 0.95 }}
			class="absolute right-0 mt-2 w-84 sm:w-92 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50 p-4 text-slate-800 dark:text-slate-100 backdrop-blur-md"
			style="transform-origin: top right;"
		>
			<!-- Header Popover -->
			<div class="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800/80">
				<div>
					<div class="flex items-center gap-2">
						<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide uppercase {envConfig.badgeBg}">
							<span class="w-1.5 h-1.5 rounded-full {envConfig.dotColor}"></span>
							{envConfig.label}
						</span>
						<span class="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-[150px]">
							{hostname || 'localhost'}{port ? `:${port}` : ''}
						</span>
					</div>
					<h4 class="text-xs font-semibold text-slate-900 dark:text-white mt-1">
						{envConfig.fullTitle}
					</h4>
				</div>

				<!-- Tag Status Freshness -->
				{#if isUpdateAvailable}
					<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800">
						Pembaruan Ada!
					</span>
				{:else}
					<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
						✓ Up to Date
					</span>
				{/if}
			</div>

			<!-- Detail Versi & Git Build -->
			<div class="py-3 space-y-2 text-xs">
				<div class="flex items-center justify-between text-slate-600 dark:text-slate-400">
					<span>Versi Rilis</span>
					<span class="font-mono font-semibold text-slate-900 dark:text-slate-100">
						{appVersion.version}
					</span>
				</div>

				<div class="flex items-center justify-between text-slate-600 dark:text-slate-400">
					<span>Commit Hash</span>
					<span class="font-mono text-[11px] text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
						{appVersion.gitHash || 'unknown'} ({appVersion.gitBranch || 'Major'})
					</span>
				</div>

				<div class="flex items-center justify-between text-slate-600 dark:text-slate-400">
					<span>Tanggal Build / Commit</span>
					<span class="text-slate-700 dark:text-slate-300">
						{appVersion.commitDate || '27 Okt 2026'}
					</span>
				</div>

				{#if appVersion.commitMessage}
					<div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
						<span class="font-semibold text-slate-700 dark:text-slate-200">Commit Terakhir:</span> {appVersion.commitMessage}
					</div>
				{/if}
			</div>

			<!-- Banner Aksi Jika Ada Update Baru -->
			{#if isUpdateAvailable}
				<div class="p-2.5 mb-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 flex items-center justify-between gap-2">
					<div class="text-[11px] text-amber-800 dark:text-amber-300">
						Versi baru siap dipasang. Muat ulang untuk memperbarui aplikasi lapangan.
					</div>
					<button
						type="button"
						onclick={reloadApplication}
						class="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors shrink-0 shadow-2xs flex items-center gap-1"
					>
						<IconRefresh size={12} />
						Muat Ulang
					</button>
				</div>
			{/if}

			<!-- Seksi Yang Baru di Versi Lapangan (Fase 2) -->
			<div class="py-2.5 border-t border-slate-100 dark:border-slate-800/80">
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10.5px] font-bold tracking-wide uppercase text-slate-500 dark:text-slate-400">
						✨ Pembaruan Lapangan
					</span>
					{#if loadingReleaseNotes}
						<span class="text-[10px] text-slate-400 animate-pulse">Memeriksa...</span>
					{/if}
				</div>

				{#if loadingReleaseNotes && (!appVersion.releaseNotes || appVersion.releaseNotes.length === 0)}
					<div class="space-y-1.5 py-1">
						<div class="h-4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse w-3/4"></div>
						<div class="h-3 bg-slate-100 dark:bg-slate-800 rounded animate-pulse w-full"></div>
					</div>
				{:else if appVersion.releaseNotes && appVersion.releaseNotes.length > 0}
					<div class="space-y-2 max-h-48 overflow-y-auto pr-1 text-xs">
						{#each appVersion.releaseNotes as note}
							<div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 transition-colors">
								<div class="flex items-center justify-between gap-1.5 mb-1">
									<span class="font-semibold text-slate-900 dark:text-slate-100 truncate text-[11px]">
										{note.judul}
									</span>
									<span class="text-[9.5px] px-1.5 py-0.2 rounded font-medium shrink-0 {getBadgeTipe(note.tipe)}">
										{getLabelTipe(note.tipe)}
									</span>
								</div>
								{#if note.ringkasan}
									<p class="text-[10.5px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
										{note.ringkasan}
									</p>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="p-2 rounded-lg bg-slate-50/50 dark:bg-slate-800/30 text-center text-[10.5px] text-slate-400">
						Sistem berjalan pada build stabil. Belum ada catatan rilis khusus.
					</div>
				{/if}
			</div>

			<!-- Footer Popover -->
			<div class="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
				<a
					href="/bantuan"
					class="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
				>
					Catatan Rilis Lengkap →
				</a>

				<button
					type="button"
					onclick={copySystemDiagnostic}
					class="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1 transition-colors"
					title="Salin ringkasan lingkungan dan versi untuk pelaporan kendala"
				>
					{#if copiedDiagnostic}
						<span class="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
							<IconCheck size={12} /> Tersalin
						</span>
					{:else}
						<span class="flex items-center gap-1">
							<IconCopy size={12} /> Salin Info Sistem
						</span>
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>
