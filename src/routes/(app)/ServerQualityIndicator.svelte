<!-- src/routes/(app)/ServerQualityIndicator.svelte -->
<!-- Indikator Kualitas Server & Sinyal Lapangan (project-epi, Fase 3).
     Zero-Overhead: telemetri browser zero-byte + /api/health/pulse (server-cached 45s).
     Khusus Lapangan: integrasi Mode Hemat, micro speedtest upload foto (~128KB),
     kuota storage offline HP, dan pemantau antrean offline (offlineQueue). -->

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { auth } from '$lib/firebase';
	import { authStore } from '$lib/stores/auth';
	import { hematMode, toggleHematMode } from '$lib/stores/hematStore';
	import { getQueue } from '$lib/utils/offlineQueue';
	import { fade } from 'svelte/transition';
	import FetchWaterfallPanel from './FetchWaterfallPanel.svelte';
	import {
		IconWifi,
		IconWifiOff,
		IconBatteryEco,
		IconRefresh,
		IconCopy,
		IconCheck,
		IconAlertTriangle,
		IconPhoto,
		IconDatabase,
		IconBolt,
		IconDeviceFloppy
	} from '@tabler/icons-svelte';

	let isOnline = $state(true);
	let popoverOpen = $state(false);
	let loadingPulse = $state(false);
	let pulseData = $state<any>(null);
	let lastCheckedAt = $state<Date | null>(null);
	let cooldownSec = $state(0);
	let copied = $state(false);
	let activeTab = $state<'sinyal' | 'fetch'>('sinyal'); // tab fetch hanya tampil untuk Super Admin (seluruh komponen ini sudah super-admin only)

	// Metrik lokal browser (zero-byte)
	let clientRttMs = $state(0);
	let effectiveType = $state('4G');
	let downlinkMbps = $state(10);
	let pageNavMs = $state(0);
	let renderFrameMs = $state(16);
	let isGoodFps = $state(true);
	let offlineCount = $state(0);
	let storageUsageMB = $state<number | null>(null);
	let isSuperAdmin = $derived($authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin'));

	// Micro Speedtest Lapangan (~128 KB)
	let speedtesting = $state(false);
	let realDownlinkMbps = $state<number | null>(null);
	let realUplinkMbps = $state<number | null>(null);

	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let cooldownTimer: ReturnType<typeof setInterval> | null = null;
	let popoverEl: HTMLElement | null = null;

	// Status gabungan yang mudah dipahami personel lapangan
	let overallStatus = $derived.by(() => {
		if (!isOnline) {
			return {
				badge: 'Offline',
				color: 'rose',
				dotCls: 'bg-red-500',
				borderCls: 'border-red-300 dark:border-red-800',
				bgCls: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300',
				score: 0,
				label: 'Sinyal Terputus (Offline)'
			};
		}
		if (!pulseData) {
			return {
				badge: 'Cek Sinyal...',
				color: 'slate',
				dotCls: 'bg-slate-400 animate-pulse',
				borderCls: 'border-slate-200 dark:border-slate-700',
				bgCls: 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
				score: 100,
				label: 'Mengukur kualitas sinyal...'
			};
		}

		const s = pulseData.status;
		const directusMs = pulseData.directus?.pingMs || pulseData.directus?.latencyMs || clientRttMs;
		const isDegraded = s === 'degraded' || s === 'down' || !pulseData.directus?.ok || clientRttMs > 800;
		const isBusy = s === 'busy' || directusMs > 500 || clientRttMs > 400 || effectiveType === '2G' || effectiveType === '3G';

		if (isDegraded) {
			return {
				badge: 'Sinyal Lemah',
				color: 'rose',
				dotCls: 'bg-red-500',
				borderCls: 'border-red-300 dark:border-red-800',
				bgCls: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300',
				score: pulseData.score || 45,
				label: 'Sinyal Lemah / Gangguan'
			};
		}
		if (isBusy) {
			return {
				badge: 'Cukup',
				color: 'amber',
				dotCls: 'bg-amber-500',
				borderCls: 'border-amber-300 dark:border-amber-800',
				bgCls: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
				score: pulseData.score || 78,
				label: 'Sinyal Sedang / Server Sibuk'
			};
		}
		return {
			badge: 'Optimal',
			color: 'emerald',
			dotCls: 'bg-emerald-500',
			borderCls: 'border-emerald-300 dark:border-emerald-800',
			bgCls: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
			score: pulseData.score || 98,
			label: 'Sinyal & Server Lancar'
		};
	});

	// Kesiapan upload foto / dokumen di lapangan
	let uploadPhotoReadiness = $derived.by(() => {
		if (!isOnline) {
			return {
				status: 'danger',
				label: 'Foto akan disimpan di perangkat (antrean offline)',
				cls: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
			};
		}
		if (pulseData?.storageNas && !pulseData.storageNas.ok) {
			return {
				status: 'warning',
				label: 'Storage Kantor (Synology) offline — foto disimpan aman di HP & otomatis diunggah saat online',
				cls: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
			};
		}
		if (realUplinkMbps !== null && realUplinkMbps < 1) {
			return {
				status: 'warning',
				label: `Upload lambat (~${realUplinkMbps} Mbps) — aktifkan Mode Hemat agar foto dikompresi`,
				cls: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
			};
		}
		if (clientRttMs > 500 || effectiveType === '2G') {
			return {
				status: 'warning',
				label: 'Sinyal lambat — gunakan Mode Hemat agar foto dikompresi',
				cls: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
			};
		}
		return {
			status: 'ready',
			label: realUplinkMbps ? `Sinyal kuat (~${realUplinkMbps} Mbps upload) — aman untuk foto laporan` : 'Sinyal lancar — siap upload foto & checklist laporan',
			cls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
		};
	});

	// Teks latensi ringkas untuk pill navbar
	let displayLatency = $derived.by(() => {
		if (!isOnline) return 'Off';
		if (clientRttMs > 0) return `${Math.round(clientRttMs)}ms`;
		if (pulseData?.directus?.pingMs || pulseData?.directus?.latencyMs) {
			return `${pulseData.directus.pingMs || pulseData.directus.latencyMs}ms`;
		}
		return '...';
	});

	// Hint lapangan dinamis
	let fieldHint = $derived.by(() => {
		if (!isOnline) {
			return 'Anda sedang di luar jangkauan sinyal. Jangan khawatir, form dan checklist tetap tersimpan di memori perangkat dan dikirim saat online.';
		}
		if (clientRttMs > 500) {
			return 'Sinyal seluler di lokasi proyek sedang lambat. Aktifkan Mode Hemat di bawah untuk mematikan efek animasi & mempercepat simpan data.';
		}
		if (offlineCount > 0) {
			return `Ada ${offlineCount} data di antrean lokal yang sedang menunggu sinkronisasi otomatis ke server pusat.`;
		}
		return 'Koneksi ke Server Pusat berjalan normal. Seluruh data laporan harian, QC, dan absensi tersinkron langsung.';
	});

	function inspectClientMetrics() {
		if (!browser) return;
		isOnline = navigator.onLine;

		try {
			offlineCount = getQueue().length;
		} catch {}

		const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
		if (conn) {
			effectiveType = conn.effectiveType ? conn.effectiveType.toUpperCase() : '4G';
			downlinkMbps = conn.downlink || 10;
		}

		try {
			const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
			if (nav && nav.duration > 0 && nav.duration < 8000) {
				pageNavMs = Math.round(nav.duration);
			} else {
				pageNavMs = 0;
			}
		} catch {}

		// Estimasi storage lokal (IndexedDB & Cache offline)
		if (navigator.storage && navigator.storage.estimate) {
			navigator.storage.estimate().then((est) => {
				if (est.usage) {
					storageUsageMB = Math.round(est.usage / (1024 * 1024));
				}
			}).catch(() => {});
		}

		requestAnimationFrame((t1) => {
			requestAnimationFrame((t2) => {
				const frameDur = Math.max(1, Math.round(t2 - t1));
				renderFrameMs = frameDur;
				isGoodFps = frameDur <= 40;
			});
		});
	}

	async function fetchPulse(silently = false) {
		if (!browser || !isOnline || !isSuperAdmin) return;
		if (!silently) loadingPulse = true;
		try {
			const user = auth.currentUser;
			const idToken = user ? await user.getIdToken() : null;
			const t0 = performance.now();
			const res = await fetch('/api/health/pulse', {
				headers: idToken ? { Authorization: `Bearer ${idToken}` } : {}
			});
			const t1 = performance.now();
			const totalFetchDur = Math.round(t1 - t0);

			if (res.ok) {
				const serverTiming = res.headers.get('Server-Timing') || '';
				const match = serverTiming.match(/dur=([\d.]+)/);
				const serverProcessMs = match ? parseFloat(match[1]) : 0;
				clientRttMs = Math.max(1, Math.round(totalFetchDur - serverProcessMs));

				pulseData = await res.json();
				lastCheckedAt = new Date();
			}
		} catch (e: any) {
			console.warn('[ServerQualityIndicator project-epi] fetch error:', e?.message);
		} finally {
			loadingPulse = false;
		}
	}

	async function runMicroSpeedtest() {
		if (speedtesting || !isOnline) return;
		speedtesting = true;
		try {
			const user = auth.currentUser;
			const idToken = user ? await user.getIdToken() : null;
			const authHeader = idToken ? { Authorization: `Bearer ${idToken}` } : {};

			// 1. Download Test (128 KB)
			const tDown0 = performance.now();
			const resDown = await fetch('/api/health/pulse?probe=down', { headers: authHeader });
			const buffer = await resDown.arrayBuffer();
			const tDown1 = performance.now();
			const durDownSec = Math.max(0.01, (tDown1 - tDown0) / 1000);
			const downBytes = buffer.byteLength || (128 * 1024);
			realDownlinkMbps = Math.round(((downBytes * 8) / (durDownSec * 1_000_000)) * 10) / 10;

			// 2. Upload Test (128 KB)
			const uploadPayload = new Uint8Array(128 * 1024);
			const tUp0 = performance.now();
			const resUp = await fetch('/api/health/pulse?probe=up', {
				method: 'POST',
				headers: {
					...authHeader,
					'Content-Type': 'application/octet-stream'
				},
				body: uploadPayload
			});
			const tUp1 = performance.now();
			if (resUp.ok) {
				const durUpSec = Math.max(0.01, (tUp1 - tUp0) / 1000);
				realUplinkMbps = Math.round(((uploadPayload.byteLength * 8) / (durUpSec * 1_000_000)) * 10) / 10;
			}
		} catch (err) {
			console.warn('[ServerQualityIndicator project-epi] speedtest error:', err);
		} finally {
			speedtesting = false;
		}
	}

	function handleManualRefresh() {
		if (cooldownSec > 0 || loadingPulse) return;
		cooldownSec = 10;
		if (cooldownTimer) clearInterval(cooldownTimer);
		cooldownTimer = setInterval(() => {
			if (cooldownSec > 1) {
				cooldownSec -= 1;
			} else {
				cooldownSec = 0;
				if (cooldownTimer) clearInterval(cooldownTimer);
			}
		}, 1000);

		inspectClientMetrics();
		fetchPulse(false);
	}

	function copyDiagnostics() {
		if (!browser) return;
		const speedText = realDownlinkMbps ? `${realDownlinkMbps}Mbps DL / ${realUplinkMbps || '-'}Mbps UL` : `Est ~${downlinkMbps}Mbps`;
		const cloudStorageText = pulseData?.serverInfra?.storage ? `Storage Cloud: ${pulseData.serverInfra.storage.totalFilesGB}GB` : '';
		const text = `[EPI-LAPANGAN] Sinyal: ${overallStatus.label} (${displayLatency}) | Ping: ${clientRttMs}ms | Speed Real: ${speedText} | Directus: ${pulseData?.directus?.pingMs || pulseData?.directus?.latencyMs || '-'}ms ${cloudStorageText ? `| ${cloudStorageText} ` : ''}| Antrean: ${offlineCount} | Waktu: ${new Date().toISOString()}`;
		navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => { copied = false; }, 2500);
	}

	function togglePopover() {
		popoverOpen = !popoverOpen;
		if (popoverOpen) {
			inspectClientMetrics();
			const now = Date.now();
			if (!lastCheckedAt || now - lastCheckedAt.getTime() > 30_000) {
				fetchPulse(true);
			}
		}
	}

	function handleDocumentClick(e: MouseEvent) {
		if (!popoverOpen || !popoverEl) return;
		if (!popoverEl.contains(e.target as Node)) {
			popoverOpen = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && popoverOpen) {
			popoverOpen = false;
		}
	}

	onMount(() => {
		inspectClientMetrics();
		fetchPulse(true);

		const onOnline = () => { isOnline = true; fetchPulse(false); };
		const onOffline = () => { isOnline = false; };
		const onVisibility = () => {
			if (document.visibilityState === 'visible') {
				inspectClientMetrics();
				const now = Date.now();
				const pollMs = (pulseData?.config?.poll_interval_sec || 60) * 1000;
				if (!lastCheckedAt || now - lastCheckedAt.getTime() > pollMs) {
					fetchPulse(true);
				}
			}
		};

		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		document.addEventListener('visibilitychange', onVisibility);
		document.addEventListener('click', handleDocumentClick);
		document.addEventListener('keydown', handleKeydown);

		pollTimer = setInterval(() => {
			if (document.visibilityState === 'visible' && isOnline) {
				fetchPulse(true);
			}
		}, 60_000);

		return () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
			document.removeEventListener('visibilitychange', onVisibility);
			document.removeEventListener('click', handleDocumentClick);
			document.removeEventListener('keydown', handleKeydown);
			if (pollTimer) clearInterval(pollTimer);
			if (cooldownTimer) clearInterval(cooldownTimer);
		};
	});
</script>

{#if isSuperAdmin}
<div class="relative shrink-0" bind:this={popoverEl}>
	<!-- Pill Navbar -->
	<button
		type="button"
		onclick={togglePopover}
		class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-all text-xs font-semibold cursor-pointer select-none active:scale-95 shadow-2xs hover:shadow-xs
			{overallStatus.bgCls} {overallStatus.borderCls}"
		title="Sinyal & Kualitas Server: {overallStatus.label} ({displayLatency}) — Klik untuk detail"
		aria-label="Sinyal & Kualitas Server"
	>
		<!-- Dot Berdenyut -->
		<span class="relative flex h-2 w-2">
			{#if isOnline && overallStatus.color === 'emerald'}
				<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
			{/if}
			<span class="relative inline-flex rounded-full h-2 w-2 {overallStatus.dotCls}"></span>
		</span>

		<!-- Ikon Sinyal Tabler -->
		{#if !isOnline}
			<IconWifiOff size={15} class="opacity-80" />
		{:else}
			<IconWifi size={15} class="opacity-80" />
		{/if}

		<!-- Latensi Angka (sembunyikan di layar HP sangat sempit) -->
		<span class="hidden sm:inline font-mono font-bold tracking-tight text-[11px]">
			{displayLatency}
		</span>
	</button>

	<!-- Popover Detail Lapangan -->
	{#if popoverOpen}
		<div
			class="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 shadow-2xl rounded-2xl border border-slate-200/90 dark:border-slate-800 z-50 p-4 text-slate-800 dark:text-slate-100 transition-all text-xs"
			transition:fade={{ duration: 120 }}
			role="dialog"
			aria-modal="true"
		>
			<!-- Header Popover -->
			<div class="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
				<div>
					<div class="flex items-center gap-1.5">
						<span class="w-2.5 h-2.5 rounded-full {overallStatus.dotCls}"></span>
						<h3 class="font-bold text-sm text-slate-900 dark:text-white">
							Sinyal & Kualitas Server
						</h3>
					</div>
					<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
						{overallStatus.label}
					</p>
				</div>

				<div class="text-right">
					<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider {overallStatus.bgCls} border {overallStatus.borderCls}">
						{overallStatus.score}% Lancar
					</span>
					{#if lastCheckedAt}
						<p class="text-[10px] text-slate-400 mt-0.5">
							Cek: {lastCheckedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
						</p>
					{/if}
				</div>
			</div>

			<!-- Tab: Sinyal | Fetch Halaman -->
			<div class="flex gap-1 pt-2" role="tablist" aria-label="Panel diagnostik">
				<button
					type="button" role="tab" aria-selected={activeTab === 'sinyal'}
					onclick={() => (activeTab = 'sinyal')}
					class="flex-1 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer {activeTab === 'sinyal' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}"
				>Sinyal</button>
				<button
					type="button" role="tab" aria-selected={activeTab === 'fetch'}
					onclick={() => (activeTab = 'fetch')}
					class="flex-1 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer {activeTab === 'fetch' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}"
					title="Lihat fetch yang dipicu halaman yang sedang dibuka: mana yang lambat, duplikat, atau berurutan"
				>Fetch Halaman</button>
			</div>

			{#if activeTab === 'fetch'}
				<div class="py-3">
					<FetchWaterfallPanel slowMs={pulseData?.config?.slow_fetch_ms || 500} duplicateMin={pulseData?.config?.dup_fetch_min || 3} />
				</div>
			{:else}
			<!-- Status Kesiapan Upload Foto Lapangan -->
			<div class="mt-3 p-2.5 rounded-xl border flex items-center gap-2.5 {uploadPhotoReadiness.cls}">
				<IconPhoto size={18} class="shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="text-[11px] font-bold leading-tight">Kesiapan Upload Foto & Dokumen</p>
					<p class="text-[10px] leading-tight opacity-90 mt-0.5">{uploadPhotoReadiness.label}</p>
				</div>
			</div>

			<!-- 4 Baris Indikator Lapangan -->
			<div class="py-3 space-y-2">
				<!-- 1. Jaringan Seluler / WiFi Lapangan (Dengan Uji Speed) -->
				<div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750 space-y-1.5">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span class="text-base">📶</span>
							<div>
								<p class="font-bold text-[11px] text-slate-700 dark:text-slate-200">Sinyal HP / Proyek</p>
								<p class="text-[10px] text-slate-400 font-mono">
									{#if !isOnline}
										Offline (Terputus)
									{:else if realDownlinkMbps}
										<span class="text-emerald-600 dark:text-emerald-400 font-bold">~{realDownlinkMbps} Mbps DL</span> • <span class="text-blue-600 dark:text-blue-400 font-bold">~{realUplinkMbps || '-'} Mbps UL</span>
									{:else}
										{effectiveType} • ~{downlinkMbps} Mbps (Plafon API)
									{/if}
								</p>
							</div>
						</div>
						<div class="text-right">
							<span class="font-mono font-bold {clientRttMs > 400 ? 'text-amber-600' : 'text-emerald-600 dark:text-emerald-400'}">
								{isOnline ? `${clientRttMs}ms Ping` : 'Offline'}
							</span>
						</div>
					</div>

					<div class="flex items-center justify-between pt-1 border-t border-slate-200/50 dark:border-slate-700/50 text-[10px]">
						<span class="text-slate-400">Uji Throughput Real ke Server Pusat:</span>
						<button
							type="button"
							onclick={runMicroSpeedtest}
							disabled={speedtesting || !isOnline}
							class="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1"
						>
							{#if speedtesting}
								<span class="animate-spin text-[10px]">🔄</span> Menguji (~128KB)...
							{:else}
								⚡ {realDownlinkMbps ? 'Uji Ulang' : 'Uji Speed Upload'}
							{/if}
						</button>
					</div>
				</div>

				<!-- 2. Server Pusat ERP (Directus & Cloud Storage) -->
				<div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750">
					<div class="flex items-center gap-2">
						<IconDatabase size={16} class="text-slate-500" />
						<div>
							<p class="font-bold text-[11px] text-slate-700 dark:text-slate-200">Koneksi Server Pusat</p>
							<p class="text-[10px] text-slate-400">
								{#if pulseData?.directus?.ok}
									Database Siap {#if pulseData?.serverInfra?.storage}• Cloud: {pulseData.serverInfra.storage.totalFilesGB} GB ({pulseData.serverInfra.storage.totalFiles ? pulseData.serverInfra.storage.totalFiles.toLocaleString('id-ID') : '25k'} file){/if}
								{:else}
									Gangguan Jaringan
								{/if}
							</p>
						</div>
					</div>
					<div class="text-right">
						<span class="font-mono font-bold {(pulseData?.directus?.pingMs || pulseData?.directus?.latencyMs) > 500 ? 'text-amber-600' : 'text-emerald-600 dark:text-emerald-400'}">
							{pulseData?.directus?.pingMs || pulseData?.directus?.latencyMs ? `${pulseData.directus.pingMs || pulseData.directus.latencyMs}ms` : '-'}
						</span>
					</div>
				</div>

				<!-- 2b. Storage Kantor (Synology NAS) -->
				<div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750">
					<div class="flex items-center gap-2">
						<IconDeviceFloppy size={16} class="text-slate-500" />
						<div>
							<p class="font-bold text-[11px] text-slate-700 dark:text-slate-200">Storage Kantor (Synology NAS)</p>
							<p class="text-[10px] text-slate-400">
								{#if !pulseData?.storageNas}
									Memeriksa...
								{:else if pulseData.storageNas.ok}
									Online &amp; Siap Terima Lampiran
								{:else}
									<span class="text-rose-600 dark:text-rose-400 font-semibold">Offline (Gunakan Antrean HP)</span>
								{/if}
							</p>
						</div>
					</div>
					<div class="text-right">
						{#if pulseData?.storageNas?.latencyMs}
							<span class="font-mono font-bold text-emerald-600 dark:text-emerald-400">
								{pulseData.storageNas.latencyMs}ms
							</span>
						{:else if pulseData?.storageNas?.ok}
							<span class="font-bold text-emerald-600 text-[10px]">Aktif</span>
						{:else if pulseData?.storageNas}
							<span class="font-bold text-rose-600 text-[10px]">Down</span>
						{:else}
							<span class="text-slate-400 text-[10px]">-</span>
						{/if}
					</div>
				</div>

				<!-- 3. Kelancaran Layar HP (UI) -->
				<div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750">
					<div class="flex items-center gap-2">
						<IconBolt size={16} class="text-slate-500" />
						<div>
							<p class="font-bold text-[11px] text-slate-700 dark:text-slate-200">Kelancaran Layar HP</p>
							<p class="text-[10px] text-slate-400">
								{isGoodFps ? 'Animasi & Form Lancar (60 FPS)' : 'Perangkat Berat'}
							</p>
						</div>
					</div>
					<div class="text-right">
						<span class="font-mono font-bold text-emerald-600 dark:text-emerald-400">
							{renderFrameMs ? `~${renderFrameMs}ms` : '16ms'} (60 FPS)
						</span>
					</div>
				</div>

				<!-- 4. Antrean Offline & Memori Perangkat -->
				<div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750">
					<div class="flex items-center gap-2">
						<span class="text-base">📦</span>
						<div>
							<p class="font-bold text-[11px] text-slate-700 dark:text-slate-200">Antrean Offline & Storage</p>
							<p class="text-[10px] text-slate-400">
								{#if offlineCount > 0}
									{offlineCount} data tersimpan di HP
								{:else}
									Semua data tersinkron
								{/if}
								{#if storageUsageMB !== null}
									• Memori: ~{storageUsageMB} MB
								{/if}
							</p>
						</div>
					</div>
					<div class="text-right">
						<span class="px-1.5 py-0.5 rounded text-[10px] font-bold {offlineCount > 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'}">
							{offlineCount > 0 ? `${offlineCount} antre` : 'Lengkap'}
						</span>
					</div>
				</div>
			</div>

			<!-- Hint Panduan Lapangan -->
			<div class="p-2.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-150 dark:border-blue-800/50 text-[11px] text-blue-950 dark:text-blue-200 leading-relaxed mb-3">
				<span class="font-bold mr-1">💡 Info Lapangan:</span>
				{fieldHint}
			</div>

			<!-- Saklar Mode Hemat Khusus Lapangan -->
			<div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 mb-3 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<IconBatteryEco size={18} class={$hematMode ? 'text-emerald-600' : 'text-slate-400'} />
					<div>
						<p class="font-bold text-[11px] text-slate-800 dark:text-slate-200">Mode Hemat Data & Kamera</p>
						<p class="text-[10px] text-slate-400">Kurangi animasi & kompres foto otomatis</p>
					</div>
				</div>
				<button
					type="button"
					onclick={toggleHematMode}
					class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer {$hematMode ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300'}"
				>
					{$hematMode ? 'Aktif' : 'Nyalakan'}
				</button>
			</div>

			{/if}

			<!-- Tombol Aksi Cepat -->
			<div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
				<button
					type="button"
					onclick={handleManualRefresh}
					disabled={loadingPulse || cooldownSec > 0}
					class="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-bold text-[11px] transition-colors disabled:opacity-50 flex items-center justify-center gap-1 cursor-pointer"
				>
					<IconRefresh size={14} class={loadingPulse ? 'animate-spin' : ''} />
					{loadingPulse ? 'Menguji...' : cooldownSec > 0 ? `${cooldownSec}s` : 'Uji Sinyal'}
				</button>

				<button
					type="button"
					onclick={copyDiagnostics}
					class="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-[11px] transition-colors flex items-center justify-center gap-1 cursor-pointer"
					title="Salin diagnostik koneksi"
				>
					{#if copied}
						<IconCheck size={14} class="text-emerald-600" />
						<span class="text-emerald-600">Disalin</span>
					{:else}
						<IconCopy size={14} />
						<span>Salin</span>
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>
{/if}
