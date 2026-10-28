<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, onDestroy } from 'svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import CrashRecoveryCard from '$lib/components/shared/CrashRecoveryCard.svelte';
	import AbnormalSessionBanner from '$lib/components/shared/AbnormalSessionBanner.svelte';
	import KioskHelpButton from '$lib/components/kiosk/KioskHelpButton.svelte';
	import { initSessionCleanlinessTracking } from '$lib/utils/sessionCleanliness';
	import { initGlobalAutoDraft } from '$lib/utils/autoDraftGlobal';
	import * as Sentry from '@sentry/sveltekit';
	import {
		IconWifi,
		IconWifiOff,
		IconLogout,
		IconPhoneCall,
		IconUserCircle,
		IconMaximize,
		IconMinimize,
		IconBarcode,
		IconAlertTriangle
	} from '@tabler/icons-svelte';

	let { data, children } = $props();

	let online = $state(true);
	// R7 — lihat catatan panjang di markup kiosk-body di bawah.
	let offlineQueueReady = $derived(page.url.pathname.startsWith('/kiosk/input-produksi'));
	let now = $state(new Date());
	let isFullscreen = $state(false);

	// Fase 2D "Pertajam Modul Kiosk Produksi v2" (12 Sep 2026) — dulu tombol ini toast statis
	// yang SELALU bilang berhasil tanpa mengirim apa pun. Sekarang benar-benar memanggil
	// /api/kiosk/supervisor-call, dan toastnya jujur (beda pesan sukses vs gagal).
	const ALASAN_CHIPS = ['Bahan habis', 'Mesin bermasalah', 'Butuh QC', 'Lainnya'];
	let showSupervisorModal = $state(false);
	let selectedAlasan = $state('');
	let customAlasan = $state('');
	let callingSupervisor = $state(false);
	let supervisorResult = $state<{ tone: 'ok' | 'err'; msg: string } | null>(null);
	let supervisorResultTimer: ReturnType<typeof setTimeout> | null = null;

	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let clockTimer: ReturnType<typeof setInterval> | null = null;

	// Hardware Barcode Scanner (Keyboard Wedge) listener
	let scanBuffer = '';
	let lastKeyTime = 0;
	let scanToastMsg = $state('');
	let scanToastTimer: ReturnType<typeof setTimeout> | null = null;

	// Fase 2 (rencana Draf Otomatis Universal & Anti-White-Screen): <svelte:boundary>
	// menangkap error RENDER komponen yang sebelumnya = layar putih total — kritis di
	// Kiosk karena operator lapangan tidak bisa buka devtools untuk diagnosa.
	function onErrorBoundary(error: unknown) {
		console.error('[SVELTE BOUNDARY]', error);
		try {
			Sentry.captureException(error);
		} catch {
			// Sentry belum diinisialisasi (PUBLIC_SENTRY_DSN kosong) — abaikan, sudah di-log ke console.
		}
	}

	let showAbnormalBanner = $state(false);
	let abnormalSessionDraftCount = $state(0);

	// Halaman "hub" — satu-satunya tempat yang boleh auto-redirect dari hasil scan mentah.
	// Halaman kerja (Transfer, Opname, FG, dst.) selalu diberi kesempatan pertama menangani
	// event kiosk-hardware-scan lewat preventDefault(); lihat langkah 1-3 di bawah.
	const HUB_PATHS = ['/kiosk/home', '/kiosk/gudang'];

	function isEditingContext(): boolean {
		const el = document.activeElement as HTMLElement | null;
		if (!el) return false;
		const tag = el.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
		return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
	}

	function showScanToast(msg: string) {
		scanToastMsg = msg;
		if (scanToastTimer) clearTimeout(scanToastTimer);
		scanToastTimer = setTimeout(() => {
			scanToastMsg = '';
		}, 3500);
	}

	function handleGlobalKeyDown(e: KeyboardEvent) {
		if (e.ctrlKey || e.altKey || e.metaKey) return;

		const nowTime = Date.now();
		const timeDiff = nowTime - lastKeyTime;
		lastKeyTime = nowTime;

		if (e.key === 'Enter') {
			if (scanBuffer.length >= 2) {
				const scanned = scanBuffer.trim();
				scanBuffer = '';
				if (!data.kioskSession) return; // halaman login mengurus sendiri (lihat api/kiosk/login)

				const parsed = parseEpiQr(scanned);

				// 1. Halaman aktif dapat giliran pertama — sebelum aturan redirect apa pun.
				const ev = new CustomEvent('kiosk-hardware-scan', { detail: { code: scanned, parsed }, cancelable: true });
				const handled = !window.dispatchEvent(ev);
				if (handled) {
					e.preventDefault();
					return;
				}

				// 2. Redirect otomatis hanya dari hub & bukan saat mengetik/modal terbuka.
				const isHub = HUB_PATHS.includes(page.url.pathname);
				if (isHub && !isEditingContext()) {
					if (parsed?.type === 'LOC') {
						showScanToast(`Rak #${parsed.id} terdeteksi`);
						goto(`/kiosk/cek-stok/${parsed.id}`);
					} else if (parsed?.type === 'ITEM') {
						showScanToast(`Barang #${parsed.id}`);
						goto(`/kiosk/cek-stok?q=${encodeURIComponent(String(parsed.id))}`);
					} else {
						showScanToast(`Mencari: ${scanned}`);
						goto(`/kiosk/cek-stok?q=${encodeURIComponent(scanned)}`);
					}
					e.preventDefault();
					return;
				}

				// 3. Halaman kerja yang tidak mengenali kode ini: beri tahu, JANGAN pindah halaman.
				// Sengaja tidak preventDefault() di sini — biarkan Enter tetap bekerja normal
				// di input (mis. submit pencarian), lihat file 02 §3.1.
				showScanToast('Kode ini tidak dipakai di halaman ini. Isian Anda aman.');
			}
			scanBuffer = '';
			return;
		}

		if (e.key && e.key.length === 1) {
			// Jika jeda antar tombol > 100ms, ini ketikan manual manusia biasa -> reset buffer
			if (timeDiff > 100) {
				scanBuffer = e.key;
			} else {
				scanBuffer += e.key;
			}
		}
	}

	// File 11 §1 — logout otomatis dulu tanpa peringatan sama sekali: operator kehilangan
	// isian tanpa tahu kenapa. Sekarang overlay penuh muncul 30 detik sebelum benar-benar
	// logout, dan bisa dibatalkan dengan menyentuh layar mana pun.
	const WARNING_BEFORE_MS = 30_000;
	let showLogoutWarning = $state(false);
	let logoutCountdown = $state(30);
	let warningTimer: ReturnType<typeof setTimeout> | null = null;
	let countdownInterval: ReturnType<typeof setInterval> | null = null;

	function currentTimeoutMs(): number {
		const perMenu = data.timeoutPerMenu || {};
		const path = page.url.pathname;
		// Cocokkan path yang paling spesifik dulu (mis. 'gudang/opname' sebelum 'gudang').
		const match = Object.keys(perMenu)
			.filter((k) => path.includes(k))
			.sort((a, b) => b.length - a.length)[0];
		const minutes = (match ? perMenu[match] : null) ?? data.timeoutMinutes ?? 5;
		return Math.max(1, Number(minutes) || 5) * 60 * 1000;
	}

	function clearLogoutTimers() {
		if (idleTimer) clearTimeout(idleTimer);
		if (warningTimer) clearTimeout(warningTimer);
		if (countdownInterval) clearInterval(countdownInterval);
		showLogoutWarning = false;
	}

	function resetIdleTimer() {
		clearLogoutTimers();
		if (!data.kioskSession) return;
		const ms = currentTimeoutMs();
		const warnAt = Math.max(0, ms - WARNING_BEFORE_MS);
		warningTimer = setTimeout(() => {
			showLogoutWarning = true;
			logoutCountdown = Math.round(WARNING_BEFORE_MS / 1000);
			countdownInterval = setInterval(() => {
				logoutCountdown -= 1;
				if (logoutCountdown <= 0 && countdownInterval) clearInterval(countdownInterval);
			}, 1000);
		}, warnAt);
		idleTimer = setTimeout(doLogout, ms);
	}

	/** Disentuh dari overlay peringatan — sentuhan di mana saja pada overlay membatalkan logout. */
	function tetapDisini() {
		resetIdleTimer();
	}

	async function doLogout() {
		clearLogoutTimers();
		try {
			await fetch('/api/kiosk/logout', { method: 'POST' });
		} catch {
			/* non-fatal — tetap redirect ke login */
		}
		goto('/kiosk');
	}

	// File 11 §1 item 5 — sesi habis di tengah aksi (401 dari endpoint kiosk lain) sebelumnya
	// hanya membalas error generik di halaman, operator tidak tahu harus login ulang. Ini
	// membungkus fetch global (hanya untuk /api/kiosk/*, bukan API lain) supaya SATU tempat
	// menangani semua 401 kiosk, bukan tiap halaman menambahkan pengecekan sendiri.
	let showSessionExpired = $state(false);
	function installFetchInterceptor() {
		const original = window.fetch;
		window.fetch = async (...args) => {
			const res = await original(...args);
			const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';
			if (res.status === 401 && url.includes('/api/kiosk/') && !url.includes('/api/kiosk/login')) {
				showSessionExpired = true;
			}
			return res;
		};
		return () => {
			window.fetch = original;
		};
	}
	function loginUlang() {
		const next = encodeURIComponent(page.url.pathname + page.url.search);
		goto(`/kiosk?next=${next}`);
	}

	function openSupervisorModal() {
		selectedAlasan = '';
		customAlasan = '';
		showSupervisorModal = true;
	}

	function closeSupervisorModal() {
		if (callingSupervisor) return;
		showSupervisorModal = false;
	}

	function showSupervisorResult(tone: 'ok' | 'err', msg: string) {
		supervisorResult = { tone, msg };
		if (supervisorResultTimer) clearTimeout(supervisorResultTimer);
		supervisorResultTimer = setTimeout(() => (supervisorResult = null), 5000);
	}

	async function kirimPanggilanSupervisor() {
		const alasan =
			selectedAlasan === 'Lainnya' ? customAlasan.trim() : selectedAlasan || undefined;

		callingSupervisor = true;
		try {
			const res = await fetch('/api/kiosk/supervisor-call', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ alasan })
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) {
				showSupervisorResult('err', data?.message || 'Gagal memanggil supervisor. Hubungi langsung.');
			} else if (data?.usedFallback) {
				showSupervisorResult('ok', 'Supervisor bertugas tidak terdeteksi — panggilan diteruskan ke cadangan.');
			} else {
				showSupervisorResult('ok', `Supervisor diberi tahu (${data?.penerimaCount || 1} orang).`);
			}
		} catch {
			showSupervisorResult('err', 'Gagal terhubung ke server. Coba lagi atau hubungi supervisor langsung.');
		} finally {
			callingSupervisor = false;
			showSupervisorModal = false;
		}
	}

	function checkFullscreen() {
		isFullscreen = Boolean(document.fullscreenElement);
	}

	function toggleFullscreen() {
		if (!document.fullscreenElement) {
			document.documentElement.requestFullscreen().catch(() => {});
		} else {
			document.exitFullscreen().catch(() => {});
		}
	}

	onMount(() => {
		const sessionCheck = initSessionCleanlinessTracking();
		if (sessionCheck.abnormal) {
			abnormalSessionDraftCount = sessionCheck.draftCount;
			showAbnormalBanner = true;
		}
		// Fase 4 (rencana Draf Otomatis Universal v2) — rollout Lapis 1 menyeluruh,
		// config-gated (default OFF).
		initGlobalAutoDraft();

		online = navigator.onLine;
		const onOnline = () => (online = true);
		const onOffline = () => (online = false);
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);

		// File 08 & File 11 — operator membuka kamera (input[type=file] utk foto QC/FG/gerbang) dan
		// selama itu layar tidak menerima sentuhan sampai kamera ditutup. 'change', 'input', 'scroll'
		// dianggap aktivitas juga agar sesi tidak logout saat menimbang lama atau memotret.
		const onVisibility = () => {
			if (document.visibilityState === 'visible') resetIdleTimer();
		};
		const activityEvents = ['click', 'touchstart', 'keydown', 'change', 'input', 'scroll'];
		activityEvents.forEach((ev) => window.addEventListener(ev, resetIdleTimer));
		document.addEventListener('visibilitychange', onVisibility);
		resetIdleTimer();

		const uninstallFetch = installFetchInterceptor();

		clockTimer = setInterval(() => (now = new Date()), 1000 * 15);

		checkFullscreen();
		document.addEventListener('fullscreenchange', checkFullscreen);
		window.addEventListener('keydown', handleGlobalKeyDown, true);

		return () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
			activityEvents.forEach((ev) => window.removeEventListener(ev, resetIdleTimer));
			document.removeEventListener('visibilitychange', onVisibility);
			document.removeEventListener('fullscreenchange', checkFullscreen);
			window.removeEventListener('keydown', handleGlobalKeyDown, true);
			uninstallFetch();
			clearLogoutTimers();
		};
	});

	onDestroy(() => {
		if (idleTimer) clearTimeout(idleTimer);
		if (clockTimer) clearInterval(clockTimer);
		if (scanToastTimer) clearTimeout(scanToastTimer);
		if (supervisorResultTimer) clearTimeout(supervisorResultTimer);
	});

	$effect(() => {
		const isLoginPage = page.url.pathname === '/kiosk';
		if (!data.kioskSession && !isLoginPage) {
			goto('/kiosk');
		} else if (data.kioskSession && isLoginPage) {
			goto('/kiosk/home');
		}
	});
</script>

<div class="kiosk-shell">
	{#if !data.kioskEnabled}
		<!-- File 10 §2.4 — sakelar pemeliharaan. Ditampilkan di ATAS segalanya, termasuk layar
		     login, supaya operator tidak mengira aplikasi rusak/tidak ada koneksi. -->
		<div class="kiosk-maintenance">
			<IconAlertTriangle size={56} />
			<h1>Kiosk sedang dalam perbaikan</h1>
			<p>Catat manual di kertas &amp; lapor supervisor. Fitur ini akan aktif kembali setelah admin menyalakannya.</p>
		</div>
	{:else}
		<!-- File 11 §6 — tombol "?" global, ikut semua rute kiosk (termasuk login) lewat layout ini
		     sekali pasang, isi mengikuti path aktif (lihat $lib/kiosk/panduan.ts). -->
		<KioskHelpButton adaStatusbar={Boolean(data.kioskSession)} />
		{#if data.kioskSession}
			<div class="kiosk-statusbar">
				<div class="kiosk-statusbar__profile">
					<IconUserCircle size={22} class="profile-icon" />
					<span class="kiosk-statusbar__nama">{data.kioskSession.nama}</span>
				</div>
				<div class="kiosk-statusbar__right">
					<button
						type="button"
						class="kiosk-statusbar__fullscreen-btn"
						onclick={toggleFullscreen}
						title={isFullscreen ? 'Keluar Layar Penuh' : 'Layar Penuh'}
						aria-label={isFullscreen ? 'Keluar Layar Penuh' : 'Layar Penuh'}
					>
						{#if isFullscreen}
							<IconMinimize size={18} />
							<span class="fullscreen-label">Keluar Penuh</span>
						{:else}
							<IconMaximize size={18} />
							<span class="fullscreen-label">Layar Penuh</span>
						{/if}
					</button>
					<span class="kiosk-statusbar__jam">{now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
					<span class="kiosk-statusbar__koneksi" class:offline={!online}>
						{#if online}<IconWifi size={18} />{:else}<IconWifiOff size={18} />{/if}
						{online ? 'Online' : 'Tidak ada sinyal — tunggu sebentar'}
					</span>
				</div>
			</div>
		{/if}
	{/if}

	<!-- R7 (rekomendasi audit Kiosk Produksi, 12 Sep 2026) — membalik keputusan arsitektur
	     "online_only" (Fase 2, 24 Agu 2026) KHUSUS untuk /kiosk/input-produksi, atas
	     konfirmasi eksplisit Lead: halaman itu sekarang punya antrean offline sendiri
	     (offlineKioskProduksiQueue.ts, idempoten lewat client_txn_id yang sudah ada sejak
	     Bug 4 Fase 1). Halaman kiosk LAIN tetap terkunci total saat offline seperti semula --
	     ini bukan pencabutan lock global, hanya pengecualian untuk satu halaman yang sudah
	     dibuat siap menangani offline. -->
	{#if data.kioskEnabled}
	<div class="kiosk-body" class:locked={data.kioskSession && !online && !offlineQueueReady}>
		{#if data.kioskSession && !online}
			<div class="kiosk-offline-banner" class:kiosk-offline-banner--queued={offlineQueueReady}>
				{#if offlineQueueReady}
					Koneksi terputus — input tetap bisa disimpan, akan terkirim otomatis begitu sinyal kembali.
				{:else}
					Koneksi terputus. Tunggu sinyal kembali sebelum mengisi form — data belum bisa tersimpan saat offline.
				{/if}
			</div>
		{/if}
		{#if showAbnormalBanner}
			<AbnormalSessionBanner
				draftCount={abnormalSessionDraftCount}
				onDismiss={() => (showAbnormalBanner = false)}
			/>
		{/if}
		<svelte:boundary onerror={onErrorBoundary}>
			{@render children()}
			{#snippet failed(error)}
				<CrashRecoveryCard {error} />
			{/snippet}
		</svelte:boundary>
	</div>
	{/if}

	{#if data.kioskEnabled && data.kioskSession}
		<div class="kiosk-footer">
			<button class="kiosk-footer__btn kiosk-footer__btn--logout" onclick={doLogout}>
				<IconLogout size={20} />
				<span>Logout</span>
			</button>
			<button class="kiosk-footer__btn kiosk-footer__btn--supervisor" onclick={openSupervisorModal}>
				<IconPhoneCall size={20} />
				<span>Panggil Supervisor</span>
			</button>
		</div>
		{#if supervisorResult}
			<div class="kiosk-toast" class:kiosk-toast--err={supervisorResult.tone === 'err'}>{supervisorResult.msg}</div>
		{/if}
		{#if scanToastMsg}
			<div class="kiosk-scan-toast">
				<IconBarcode size={22} class="scan-icon" />
				<span>{scanToastMsg}</span>
			</div>
		{/if}
	{/if}

	{#if showSupervisorModal}
		<div class="supervisor-modal-backdrop" onclick={closeSupervisorModal}>
			<div class="supervisor-modal" onclick={(e) => e.stopPropagation()}>
				<h3>Panggil Supervisor</h3>
				<p class="supervisor-modal__hint">
					Pilih alasan singkat (opsional) supaya supervisor tahu apa yang perlu disiapkan. Bisa
					langsung kirim tanpa memilih alasan.
				</p>
				<div class="supervisor-chip-row">
					{#each ALASAN_CHIPS as chip}
						<button
							type="button"
							class="supervisor-chip"
							class:supervisor-chip--active={selectedAlasan === chip}
							onclick={() => (selectedAlasan = selectedAlasan === chip ? '' : chip)}
						>
							{chip}
						</button>
					{/each}
				</div>
				{#if selectedAlasan === 'Lainnya'}
					<input
						class="supervisor-custom-input"
						type="text"
						placeholder="Tulis alasan singkat..."
						bind:value={customAlasan}
						maxlength="200"
					/>
				{/if}
				<div class="supervisor-modal__actions">
					<button class="supervisor-btn supervisor-btn--cancel" onclick={closeSupervisorModal} disabled={callingSupervisor}>
						Batal
					</button>
					<button class="supervisor-btn supervisor-btn--send" onclick={kirimPanggilanSupervisor} disabled={callingSupervisor}>
						{callingSupervisor ? 'Mengirim...' : 'Kirim Panggilan'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- File 11 §1 — peringatan 30 detik sebelum logout otomatis. Sentuhan di mana saja pada
	     overlay ini membatalkan logout (bukan hanya tombol). -->
	{#if showLogoutWarning}
		<div class="logout-warning-overlay" role="dialog" aria-modal="true" onclick={tetapDisini}>
			<div class="logout-warning-card">
				<span class="logout-warning-icon">⏳</span>
				<h2>Masih di sini?</h2>
				<p>Sentuh layar untuk lanjut. Keluar otomatis dalam <strong>{logoutCountdown}</strong> detik…</p>
				<button class="logout-warning-btn" onclick={tetapDisini}>Saya masih di sini</button>
			</div>
		</div>
	{/if}

	<!-- File 11 §1 item 5 — sesi habis di tengah aksi (401 dari endpoint kiosk). -->
	{#if showSessionExpired}
		<div class="logout-warning-overlay" role="dialog" aria-modal="true">
			<div class="logout-warning-card">
				<span class="logout-warning-icon">🔒</span>
				<h2>Waktu login habis</h2>
				<p>Isian Anda disimpan. Login lagi untuk melanjutkan.</p>
				<button class="logout-warning-btn" onclick={loginUlang}>Login Lagi</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.kiosk-shell {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: #0f172a;
		color: #f1f5f9;
		font-size: 18px;
	}
	.kiosk-statusbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		padding: 0.75rem 1.5rem;
		background: #1e293b;
		border-bottom: 1px solid #334155;
		font-weight: 600;
	}
	.kiosk-statusbar__profile {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
	}
	:global(.profile-icon) {
		color: #94a3b8;
		flex-shrink: 0;
	}
	.kiosk-statusbar__nama {
		font-weight: 700;
		font-size: 1rem;
		color: #f8fafc;
		letter-spacing: 0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.kiosk-statusbar__right {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		flex-shrink: 0;
	}
	.kiosk-statusbar__fullscreen-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: #334155;
		color: #e2e8f0;
		border: 1px solid #475569;
		border-radius: 0.5rem;
		padding: 0.35rem 0.75rem;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s ease;
		touch-action: manipulation;
		user-select: none;
	}
	.kiosk-statusbar__fullscreen-btn:hover {
		background: #475569;
		color: #ffffff;
	}
	.kiosk-statusbar__fullscreen-btn:active {
		transform: scale(0.96);
	}
	.fullscreen-label {
		font-size: 0.8rem;
		letter-spacing: 0.01em;
	}
	.kiosk-statusbar__jam {
		font-size: 1rem;
		font-weight: 700;
		color: #cbd5e1;
		font-variant-numeric: tabular-nums;
	}
	.kiosk-statusbar__koneksi {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: #4ade80;
		font-size: 0.85rem;
		font-weight: 700;
	}
	.kiosk-statusbar__koneksi.offline {
		color: #f87171;
	}
	.kiosk-maintenance {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 2rem;
		text-align: center;
		color: #f1f5f9;
	}
	.kiosk-maintenance h1 { font-size: 1.5rem; margin: 0; }
	.kiosk-maintenance p { color: #cbd5e1; max-width: 32rem; margin: 0; font-size: 1.05rem; }
	.kiosk-body {
		flex: 1;
		overflow-y: auto;
		background: #f8fafc;
		color: #0f172a;
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	.kiosk-body.locked :global(form),
	.kiosk-body.locked :global(button:not(.kiosk-offline-banner *)) {
		pointer-events: none;
		opacity: 0.5;
	}
	.kiosk-offline-banner {
		background: #fef2f2;
		color: #b91c1c;
		padding: 1rem 1.5rem;
		font-weight: 600;
		text-align: center;
	}
	.kiosk-offline-banner--queued {
		background: #eff6ff;
		color: #1d4ed8;
	}
	.kiosk-footer {
		display: flex;
		gap: 1rem;
		padding: 1rem 1.5rem;
		background: #1e293b;
		border-top: 1px solid #334155;
	}
	.kiosk-footer__btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		min-height: 60px;
		border-radius: 0.85rem;
		font-weight: 700;
		font-size: 1.05rem;
		border: none;
		cursor: pointer;
		transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
		touch-action: manipulation;
		user-select: none;
	}
	.kiosk-footer__btn:active {
		transform: scale(0.985);
	}
	.kiosk-footer__btn--logout {
		background: #334155;
		color: #f1f5f9;
		border: 1px solid #475569;
	}
	.kiosk-footer__btn--logout:hover {
		background: #475569;
	}
	.kiosk-footer__btn--supervisor {
		background: #f59e0b;
		color: #0f172a;
		box-shadow: 0 2px 8px rgba(245, 158, 11, 0.25);
	}
	.kiosk-footer__btn--supervisor:hover {
		background: #d97706;
		color: #ffffff;
	}
	.kiosk-toast {
		position: fixed;
		bottom: 6rem;
		left: 50%;
		transform: translateX(-50%);
		background: #16a34a;
		color: white;
		padding: 0.75rem 1.5rem;
		border-radius: 0.75rem;
		font-weight: 600;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		z-index: 9999;
		max-width: 90vw;
		text-align: center;
	}
	.kiosk-toast--err {
		background: #dc2626;
	}
	.logout-warning-overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.92);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		z-index: 20000;
		cursor: pointer;
	}
	.logout-warning-card {
		background: #ffffff;
		color: #0f172a;
		border-radius: 1.25rem;
		padding: 2.5rem 2rem;
		max-width: 420px;
		width: 100%;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
	}
	.logout-warning-icon { font-size: 3rem; line-height: 1; }
	.logout-warning-card h2 { margin: 0; font-size: 1.4rem; font-weight: 800; }
	.logout-warning-card p { margin: 0; color: #475569; font-size: 1.05rem; }
	.logout-warning-btn {
		margin-top: 0.5rem;
		min-height: 60px;
		width: 100%;
		background: #16a34a;
		color: #fff;
		border: none;
		border-radius: 0.85rem;
		font-weight: 800;
		font-size: 1.1rem;
		cursor: pointer;
	}
	.supervisor-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		z-index: 10000;
	}
	.supervisor-modal {
		background: #ffffff;
		color: #0f172a;
		border-radius: 1rem;
		padding: 1.5rem;
		max-width: 420px;
		width: 100%;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
	}
	.supervisor-modal h3 {
		margin: 0 0 0.5rem;
		font-size: 1.15rem;
		font-weight: 800;
	}
	.supervisor-modal__hint {
		margin: 0 0 1rem;
		font-size: 0.85rem;
		color: #64748b;
		line-height: 1.4;
	}
	.supervisor-chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.supervisor-chip {
		background: #f1f5f9;
		border: 1.5px solid #cbd5e1;
		color: #334155;
		font-weight: 700;
		font-size: 0.85rem;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		cursor: pointer;
		min-height: 44px;
		transition: all 0.15s ease;
	}
	.supervisor-chip--active {
		background: #f59e0b;
		border-color: #d97706;
		color: #0f172a;
	}
	.supervisor-custom-input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.65rem 0.85rem;
		border: 1.5px solid #cbd5e1;
		border-radius: 0.6rem;
		font-size: 0.95rem;
		margin-bottom: 0.75rem;
		color: #0f172a;
		background: #ffffff;
	}
	.supervisor-modal__actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}
	.supervisor-btn {
		flex: 1;
		min-height: 48px;
		border-radius: 0.65rem;
		font-weight: 800;
		font-size: 0.95rem;
		border: none;
		cursor: pointer;
	}
	.supervisor-btn--cancel {
		background: #f1f5f9;
		color: #334155;
		border: 1.5px solid #cbd5e1;
	}
	.supervisor-btn--send {
		background: #f59e0b;
		color: #0f172a;
	}
	.supervisor-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.kiosk-scan-toast {
		position: fixed;
		bottom: 5.5rem;
		left: 50%;
		transform: translateX(-50%);
		background: #0f172a;
		color: #38bdf8;
		border: 1px solid #0284c7;
		padding: 0.65rem 1.25rem;
		border-radius: 9999px;
		font-weight: 700;
		font-size: 0.95rem;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		z-index: 9999;
		pointer-events: none;
	}
	:global(.scan-icon) {
		color: #38bdf8;
		flex-shrink: 0;
	}
</style>
