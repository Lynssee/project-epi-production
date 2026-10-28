<!-- src/routes/kiosk/absen-istirahat/+page.svelte -->
<!-- Rencana Absensi Istirahat v2, Fase 1 (P1 — inti permintaan K1+K3): kiosk tap badge di
  titik setor HP untuk mencatat absen kembali dari istirahat. Layar besar, kontras tinggi,
  bisa dipakai bersarung tangan (tidak perlu ketik apa pun). Nama karyawan tampil besar
  3 detik setelah tap (kontrol sosial anti-titip — rencana v2 §3.3.1). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount, onDestroy } from 'svelte';
	import QrCameraScanner from '$lib/components/ui/QrCameraScanner.svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { hapticOk, hapticError, hapticWarning } from '$lib/utils/haptic';
	import {
		enqueueKioskIstirahatSubmission,
		flushKioskIstirahatQueue,
		registerKioskIstirahatAutoFlush,
		getQueuedKioskIstirahatSubmissions,
		type QueuedKioskIstirahatSubmission
	} from '$lib/utils/offlineKioskIstirahatQueue';
	import IconLoader2 from '@tabler/icons-svelte/icons/loader-2';

	const STORAGE_KEY = 'epi_kiosk_workstation_id';

	let workstationId = $state<string | null>(null);
	let workstationLabel = $state('');
	let workstations = $state<{ id: number; kode: string; nama: string }[]>([]);
	let loadingSetup = $state(true);
	let showScanner = $state(true);

	let resultState = $state<'idle' | 'ok' | 'warn' | 'error'>('idle');
	let resultText = $state('');
	let resultSub = $state('');
	let resultTimer: ReturnType<typeof setTimeout> | null = null;
	let submitting = false;
	let pendingCount = $state(0);

	async function refreshPendingCount() {
		pendingCount = (await getQueuedKioskIstirahatSubmissions()).length;
	}

	// Idempotency: jeda yang SUDAH tertutup (retry setelah respons hilang) atau baru saja
	// diproses (rate-limit) dianggap SUKSES, bukan kegagalan yang perlu diulang terus —
	// lihat catatan di offlineKioskIstirahatQueue.ts.
	async function sendQueuedTap(entry: QueuedKioskIstirahatSubmission) {
		const body = new FormData();
		body.append('no_badge', entry.noBadge);
		body.append('badge_token', entry.badgeToken);
		if (entry.workstationId) body.append('workstation_id', entry.workstationId);
		if (entry.photoBlob && entry.photoBlob.size > 0) body.append('foto', entry.photoBlob, entry.photoName);

		const res = await fetch('/api/kiosk/absen-istirahat', { method: 'POST', body });
		if (!res.ok) {
			const data = await res.json().catch(() => null);
			const msg = String(data?.message || '').toLowerCase();
			const benign = /belum absen keluar istirahat|sudah absen pulang|baru saja tap/i.test(msg);
			if (benign) return;
			throw new Error(msg || `HTTP ${res.status}`);
		}
	}

	onMount(async () => {
		workstationId = localStorage.getItem(STORAGE_KEY);
		try {
			const res = await fetch('/api/kiosk/workstations');
			if (res.ok) {
				const data = await res.json();
				workstations = data.workstations || [];
			}
		} catch {
			/* biarkan kosong — operator akan lihat pesan "belum ada workstation" */
		}
		if (workstationId) {
			const found = workstations.find((w) => String(w.id) === workstationId);
			workstationLabel = found ? `${found.kode} — ${found.nama}` : `#${workstationId}`;
		}
		loadingSetup = false;

		registerKioskIstirahatAutoFlush(sendQueuedTap);
		await refreshPendingCount();
		if (navigator.onLine) {
			await flushKioskIstirahatQueue(sendQueuedTap).catch(() => {});
			await refreshPendingCount();
		}
	});

	onDestroy(() => {
		if (resultTimer) clearTimeout(resultTimer);
	});

	function pilihWorkstation(w: { id: number; kode: string; nama: string }) {
		workstationId = String(w.id);
		workstationLabel = `${w.kode} — ${w.nama}`;
		localStorage.setItem(STORAGE_KEY, workstationId);
	}

	function gantiWorkstation() {
		localStorage.removeItem(STORAGE_KEY);
		workstationId = null;
		loadingSetup = true;
		fetch('/api/kiosk/workstations')
			.then((r) => (r.ok ? r.json() : { workstations: [] }))
			.then((d) => (workstations = d.workstations || []))
			.finally(() => (loadingSetup = false));
	}

	function beep(freq: number, durationMs: number) {
		try {
			const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.frequency.value = freq;
			osc.connect(gain);
			gain.connect(ctx.destination);
			gain.gain.setValueAtTime(0.15, ctx.currentTime);
			osc.start();
			osc.stop(ctx.currentTime + durationMs / 1000);
			osc.onended = () => ctx.close();
		} catch {
			/* abaikan bila WebAudio tidak tersedia */
		}
	}

	// Snapshot webcam otomatis saat tap (kontrol sosial anti-titip, rencana v2 §3.3.1 butir 1).
	// Diambil dari <video> milik QrCameraScanner SEBELUM komponennya di-unmount oleh
	// showResult() — kegagalan capture tidak boleh memblokir absen (fail-open).
	async function captureSnapshot(): Promise<Blob | null> {
		try {
			const video = document.querySelector('video') as HTMLVideoElement | null;
			if (!video || video.readyState < 2) return null;
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth || 480;
			canvas.height = video.videoHeight || 480;
			const ctx = canvas.getContext('2d');
			if (!ctx) return null;
			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
			return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.7));
		} catch {
			return null;
		}
	}

	function isNetworkError(err: unknown): boolean {
		return err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(String((err as any)?.message || ''));
	}

	async function handleDetect(raw: string) {
		if (submitting) return;
		const parsed = parseEpiQr(raw);
		if (!parsed || parsed.type !== 'BADGE' || !parsed.token) {
			showResult('error', 'Kartu Tidak Dikenali', 'Pastikan yang ditempelkan adalah kartu badge karyawan.');
			return;
		}

		submitting = true;
		const snapshot = await captureSnapshot();
		try {
			const body = new FormData();
			body.append('no_badge', String(parsed.id));
			body.append('badge_token', parsed.token);
			if (workstationId) body.append('workstation_id', workstationId);
			if (snapshot) body.append('foto', snapshot, 'snap.jpg');

			const res = await fetch('/api/kiosk/absen-istirahat', { method: 'POST', body });
			const data = await res.json().catch(() => null);

			if (!res.ok) {
				hapticError();
				beep(220, 300);
				showResult('error', 'Gagal', data?.message || 'Tidak bisa mencatat absen. Coba lagi atau hubungi supervisor.');
				return;
			}

			hapticOk();
			beep(880, 150);
			const overrun = Number(data?.overrunMenit || 0);
			const tier = Number(data?.tier || 0);
			if (overrun > 0) {
				// Fase 4 (rencana v2 §5) — gerbang 'warn': peringatan eksplisit di layar, murni
				// informasional, TIDAK PERNAH memblokir (K5: hanya teguran, tidak menyentuh payroll).
				const peringatanGerbang = data?.modeGerbang === 'warn' && tier > 0
					? ' Ini tercatat dan dapat berujung teguran bila berulang.'
					: '';
				showResult('warn', data?.nama || 'Berhasil', `Kembali dari istirahat — telat ${overrun} menit.${peringatanGerbang}`);
			} else {
				showResult('ok', data?.nama || 'Berhasil', 'Kembali dari istirahat tercatat.');
			}
		} catch (err) {
			if (isNetworkError(err)) {
				// Mode luring — simpan ke antrian, dikirim otomatis saat koneksi kembali
				// (registerKioskIstirahatAutoFlush, dipasang saat onMount).
				await enqueueKioskIstirahatSubmission({
					client_txn_id: crypto.randomUUID(),
					noBadge: String(parsed.id),
					badgeToken: parsed.token,
					workstationId,
					photoBlob: snapshot || new Blob([], { type: 'image/jpeg' }),
					photoName: 'snap.jpg',
					createdAt: new Date().toISOString()
				});
				await refreshPendingCount();
				hapticWarning();
				beep(440, 200);
				showResult('warn', 'Tersimpan Offline', 'Koneksi terputus — akan dikirim otomatis saat kembali online.');
			} else {
				hapticError();
				showResult('error', 'Koneksi Bermasalah', 'Periksa koneksi internet kiosk lalu coba lagi.');
			}
		} finally {
			submitting = false;
		}
	}

	function showResult(state: 'ok' | 'warn' | 'error', text: string, sub: string) {
		resultState = state;
		resultText = text;
		resultSub = sub;
		showScanner = false;
		if (resultTimer) clearTimeout(resultTimer);
		resultTimer = setTimeout(() => {
			resultState = 'idle';
			showScanner = true;
		}, 3000);
	}
</script>

<div class="wrap">
	<h1>Absen Kembali dari Istirahat</h1>

	{#if loadingSetup}
		<div class="center py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Terminal Kerja..." sublabel="Sinkronisasi workstation kiosk" />
		</div>
	{:else if !workstationId}
		<div class="setup">
			<p class="setup-title">Kiosk ini di titik mana?</p>
			<p class="setup-hint">Pilih sekali saja — akan diingat perangkat ini seterusnya.</p>
			{#if workstations.length === 0}
				<div class="empty-state">
					Belum ada kiosk terdaftar. Minta HRD menambahkan di Admin &gt; HRD &gt; Meja &amp; Kiosk terlebih dulu.
				</div>
			{:else}
				<div class="ws-list">
					{#each workstations as w}
						<button class="ws-btn" onclick={() => pilihWorkstation(w)}>
							<strong>{w.kode}</strong>
							<span>{w.nama}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<p class="ws-current">
			📍 {workstationLabel}
			<button class="ws-change" onclick={gantiWorkstation}>Ganti</button>
		</p>
		{#if pendingCount > 0}
			<p class="pending-note">⏳ {pendingCount} absen tersimpan offline, menunggu koneksi untuk dikirim.</p>
		{/if}

		{#if showScanner}
			<div class="scan-hint">Tempelkan kartu badge Anda ke kamera. Tunggu sampai nama Anda muncul di layar.</div>
			<QrCameraScanner
				onDetect={handleDetect}
				onClose={() => {}}
				expectedPrefix="EPI:BADGE:"
				continuous={true}
				debounceMs={2500}
			/>
		{:else}
			<div class="result result--{resultState}">
				<div class="result-text">{resultText}</div>
				<div class="result-sub">{resultSub}</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.wrap { padding: 1rem 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 100%; box-sizing: border-box; min-height: 100%; align-items: center; }
	h1 { font-size: 1.4rem; text-align: center; margin: 0; }
	.center { display: flex; align-items: center; justify-content: center; padding: 3rem; }
	.setup { width: 100%; max-width: 420px; text-align: center; }
	.setup-title { font-size: 1.15rem; font-weight: 800; margin: 0.5rem 0 0.25rem; }
	.setup-hint { color: #64748b; margin: 0 0 1rem; }
	.ws-list { display: flex; flex-direction: column; gap: 0.75rem; }
	.ws-btn {
		display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem;
		padding: 1rem 1.25rem; border-radius: 0.75rem; border: 2px solid #cbd5e1;
		background: white; cursor: pointer; font-size: 1rem;
	}
	.ws-btn strong { font-size: 1.05rem; }
	.ws-btn span { color: #64748b; }
	.empty-state { background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 0.75rem; padding: 1.5rem; text-align: center; color: #64748b; }
	.ws-current { display: flex; align-items: center; gap: 0.75rem; font-weight: 700; color: #0f172a; }
	.ws-change { border: none; background: #e2e8f0; color: #334155; border-radius: 0.5rem; padding: 0.35rem 0.75rem; font-size: 0.85rem; cursor: pointer; }
	.pending-note { font-size: 0.85rem; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 0.5rem; padding: 0.5rem 0.75rem; margin: 0; }
	.scan-hint { text-align: center; color: #475569; font-size: 1rem; max-width: 400px; }
	.result {
		width: 100%; max-width: 420px; min-height: 260px;
		display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem;
		border-radius: 1rem; padding: 2rem; text-align: center;
	}
	.result--ok { background: #16a34a; color: white; }
	.result--warn { background: #f59e0b; color: #1e293b; }
	.result--error { background: #dc2626; color: white; }
	.result-text { font-size: 2rem; font-weight: 900; }
	.result-sub { font-size: 1.1rem; }
</style>
