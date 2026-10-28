<!-- src/routes/(app)/site-checkin/+page.svelte -->
<!-- Fase 3: halaman utama Site Check-in modern & terpadu. Cakupan: seluruh karyawan ber-access_ess
     (rollout penuh) — didukung validasi GPS, foto watermark, multi-site 1 hari, & laporan kunjungan. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import {
		IconArrowLeft,
		IconBuildingFactory2,
		IconClock,
		IconMapPin,
		IconLogout,
		IconPlus,
		IconCalendarEvent,
		IconShieldCheck,
		IconLoader2
	} from '@tabler/icons-svelte';
	import { getActiveCheckin, type SiteCheckinRecord } from '$lib/services/siteCheckin';
	import { getMyFleetBookings, getFleetBookingDetail } from '$lib/services/ess/fleetBooking';
	import { getQueuedSiteCheckinSubmissions } from '$lib/utils/offlineSiteCheckinQueue';
	import { isRetryableError } from '$lib/utils/networkError';
	import { SITE_CHECKIN_CHANGED_EVENT } from '$lib/utils/siteCheckinSync';
	import CheckinForm from '$lib/components/site-checkin/CheckinForm.svelte';
	import CheckoutDialog from '$lib/components/site-checkin/CheckoutDialog.svelte';
	import JourneyTimeline from '$lib/components/site-checkin/JourneyTimeline.svelte';
	import { SectionGuide } from '$lib/components/hints';
	import { essHints } from '$lib/data/hints/ess';
	import { getHint } from '$lib/data/hints/getHint';
	import { fade, slide } from 'svelte/transition';

	const siteCheckinGuide = getHint(essHints, 'site-checkin.page', 'ess');

	let activeCheckin = $state<SiteCheckinRecord | null | undefined>(undefined); // undefined = loading
	// Paket 02 §3.7 — kunjungan yang BARU dicatat offline (masih di antrean, belum dikonfirmasi
	// server). Dipakai supaya form check-in TIDAK muncul lagi (worst case B/C: pengguna check-in
	// dobel) selama menunggu sinyal, tanpa berpura-pura server sudah tahu soal kunjungan ini.
	// clientTxnId disimpan supaya bisa checkout (§3.9.2, worst case I) walau checkin.id server
	// belum diketahui — server me-resolve dari clientTxnId ini.
	let localPendingCheckinInfo = $state<{ namaLokasi: string | null; createdAt: string; clientTxnId: string } | null>(null);
	let showCheckout = $state(false);
	let showLocalCheckout = $state(false);
	let showSwitchCheckinForm = $state(false);
	let refreshKey = $state(0);
	let elapsedString = $state('');
	let timerInterval: ReturnType<typeof setInterval> | undefined;

	const todayFormatted = new Intl.DateTimeFormat('id-ID', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'Asia/Jakarta'
	}).format(new Date());

	function updateElapsedTimer() {
		if (!activeCheckin?.check_in_at) {
			elapsedString = '';
			return;
		}
		const ms = Math.max(0, Date.now() - new Date(activeCheckin.check_in_at).getTime());
		const totalSec = Math.floor(ms / 1000);
		const h = Math.floor(totalSec / 3600);
		const m = Math.floor((totalSec % 3600) / 60);
		const s = totalSec % 60;
		const pad = (n: number) => String(n).padStart(2, '0');
		elapsedString = `${pad(h)}:${pad(m)}:${pad(s)}`;
	}

	// Paket 07 Site Visit Release §3.2 (SVR-14) — booking peminjaman kendaraan site_visit, untuk
	// prefill proyek tujuan check-in + banner. Diam saja kalau gagal — bukan alur wajib.
	let siteVisitBookingId = $state<string | null>(null);
	let siteVisitProjectId = $state<number | null>(null);
	let siteVisitBookingCode = $state('');
	// Peminjaman 09 §3.2 — bila ada >1 booking site visit yang cocok, peminjam MEMILIH (tidak diambil pertama diam-diam).
	let siteVisitCandidates = $state<{ id: string; kode: string; tujuan: string; projectId: number | null }[]>([]);
	function pilihBookingSiteVisit(id: string) {
		const c = siteVisitCandidates.find((x) => x.id === id);
		if (!c) return;
		siteVisitBookingId = c.id;
		siteVisitProjectId = c.projectId;
		siteVisitBookingCode = c.kode;
	}

	// §3.2 poin 2-3: booking hari ini DITAWARKAN (butuh konfirmasi), bukan langsung dipasang;
	// booking basi (lewat tanggal, belum ditutup) tampil sebagai peringatan terpisah — keduanya
	// TIDAK PERNAH otomatis menempel ke check-in tanpa persetujuan eksplisit pengguna.
	let bookingTawaran = $state<{ id: string; kode: string; tujuan: string; projectId: number | null } | null>(null);
	let bookingBasi = $state<{ kode: string; tanggalMulai: string } | null>(null);

	function tanggalMencakupHariIniWib(tanggalMulai: string, tanggalSelesai: string | null): boolean {
		const hariIni = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
		const mulaiWib = new Date(tanggalMulai).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
		const selesaiWib = tanggalSelesai
			? new Date(tanggalSelesai).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
			: mulaiWib;
		return hariIni >= mulaiWib && hariIni <= selesaiWib;
	}

	async function loadSiteVisitBooking() {
		try {
			// Fase 2 — datang dari tombol "Mulai Kunjungan" (?booking=<id>): pakai booking itu apa adanya
			// (pengguna SUDAH menekan tombol untuk booking spesifik ini — konfirmasi eksplisit),
			// termasuk kunjungan tanpa kendaraan yang masih berstatus 'disetujui'.
			const bookingParam =
				typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('booking') : null;
			if (bookingParam) {
				const b = await getFleetBookingDetail(bookingParam).catch(() => null);
				if (b && (b.status === 'disetujui' || b.status === 'aktif') && b.tipe_keperluan === 'site_visit') {
					siteVisitBookingId = String(b.id);
					siteVisitProjectId = b.project_id ? Number(b.project_id) : null;
					siteVisitBookingCode = b.kode_booking;
					return;
				}
			}

			const bookings = await getMyFleetBookings();
			// Tanpa syarat project_id: kategori kunjungan yang wajib_project=false tetap harus tertaut ke check-in.
			const cocok = bookings.filter(
				(b) =>
					(b.status === 'aktif' || (b.status === 'disetujui' && b.butuh_kendaraan === false)) &&
					b.tipe_keperluan === 'site_visit'
			);
			if (!active) return;

			if (tanggalMencakupHariIniWib(active.tanggal_mulai, active.tanggal_selesai_rencana)) {
				// §3.2 poin 2 — tawarkan, jangan langsung pasang.
				bookingTawaran = {
					id: String(active.id),
					kode: active.kode_booking,
					tujuan: active.tujuan,
					projectId: active.project_id ? Number(active.project_id) : null
				};
			} else if (active.status === 'aktif') {
				// §3.2 poin 3 — booking aktif yang sudah lewat tanggal selesai (basi, belum ditutup).
				bookingBasi = { kode: active.kode_booking, tanggalMulai: active.tanggal_mulai };
			}
		} catch {
			// diam
		}
	}

	/** Paket 02 §3.7 — cari check-in offline yang belum tersinkron & belum diikuti checkout
	 *  offline (berarti kunjungan itu MASIH berlangsung dari sudut pandang lokal). */
	async function refreshLocalPending() {
		try {
			const pending = await getQueuedSiteCheckinSubmissions();
			const checkins = pending.filter((e) => e.type === 'checkin');
			const lastCheckin = checkins[checkins.length - 1];
			if (!lastCheckin) {
				localPendingCheckinInfo = null;
				return;
			}
			const adaCheckoutSesudahnya = pending.some(
				(e) => e.type === 'checkout' && e.createdAt >= lastCheckin.createdAt
			);
			localPendingCheckinInfo = adaCheckoutSesudahnya
				? null
				: { namaLokasi: lastCheckin.namaLokasi ?? null, createdAt: lastCheckin.createdAt, clientTxnId: lastCheckin.client_txn_id };
		} catch {
			localPendingCheckinInfo = null;
		}
	}

	function terimaBookingTawaran() {
		if (!bookingTawaran) return;
		siteVisitBookingId = bookingTawaran.id;
		siteVisitProjectId = bookingTawaran.projectId;
		siteVisitBookingCode = bookingTawaran.kode;
		bookingTawaran = null;
	}

	function tolakBookingTawaran() {
		bookingTawaran = null;
	}

	async function load() {
		await refreshLocalPending();
		try {
			const res = await getActiveCheckin();
			activeCheckin = res.record;
			showSwitchCheckinForm = false;
			updateElapsedTimer();
		} catch (err) {
			// Paket 02 §3.7 (SVR bug: getActiveCheckin gagal jaringan -> activeCheckin di-set null
			// -> form check-in muncul lagi -> risiko check-in dobel). Sinyal lemah/offline TIDAK
			// boleh disamakan dengan "memang belum ada kunjungan aktif" — hanya set null di sini
			// kalau ini pemuatan PERTAMA (activeCheckin masih undefined); kalau sebelumnya sudah
			// punya nilai, biarkan (data terakhir yang diketahui tetap ditampilkan, bukan hilang).
			if (!isRetryableError(err) || activeCheckin === undefined) {
				activeCheckin = null;
			}
		}
		loadSiteVisitBooking();
	}

	// Sinkronisasi antrean sekarang GLOBAL (siteCheckinSync.ts, didaftarkan sekali di root
	// layout) — halaman ini hanya perlu tahu KAPAN harus refresh tampilan setelah terkirim.
	function onQueueChanged() {
		load();
	}

	onMount(() => {
		load();
		timerInterval = setInterval(updateElapsedTimer, 1000);
		window.addEventListener(SITE_CHECKIN_CHANGED_EVENT, onQueueChanged);
	});

	onDestroy(() => {
		if (timerInterval) clearInterval(timerInterval);
		window.removeEventListener(SITE_CHECKIN_CHANGED_EVENT, onQueueChanged);
	});

	function handleCheckinSuccess() {
		refreshKey++;
		showSwitchCheckinForm = false;
		load();
	}

	function handleCheckoutDone() {
		showCheckout = false;
		refreshKey++;
		load();
	}

	function handleLocalCheckoutDone() {
		showLocalCheckout = false;
		refreshKey++;
		load();
	}

	function formatTime(iso: string | null): string {
		if (!iso) return '-';
		return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
	}

	/** Paket 02 §3.9.2/§3.8 (worst case I) — stub SiteCheckinRecord untuk CheckoutDialog saat
	 *  check-in-nya SENDIRI masih di antrean (belum ada checkin.id server). id sengaja '' —
	 *  CheckoutDialog & submitCheckout memakai checkinClientTxnId sebagai gantinya. */
	function buildLocalStubCheckin(info: { namaLokasi: string | null; createdAt: string }): SiteCheckinRecord {
		return {
			id: '',
			karyawan_id: '',
			referensi_id: 0,
			nama_lokasi: info.namaLokasi,
			tier_absensi: null,
			area_sumber: null,
			area_status: null,
			check_in_at: info.createdAt,
			check_out_at: null,
			in_geofence: null,
			jarak_in_m: null,
			durasi_menit: null,
			status: 'active',
			tipe_checkin: 'proyek'
		};
	}
</script>

<div class="w-full max-w-2xl mx-auto p-4 sm:p-6 pb-28 flex flex-col gap-5">
	<!-- Top Navigation / Back button -->
	<div class="flex items-center justify-between">
		<button
			type="button"
			class="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors"
			onclick={() => goto('/')}
		>
			<IconArrowLeft size={16} /> Kembali ke Beranda
		</button>
		<div class="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-full">
			<IconCalendarEvent size={13} class="text-blue-600 dark:text-blue-400" />
			<span>{todayFormatted}</span>
		</div>
	</div>

	<!-- Main Page Title & Intro -->
	<div class="flex flex-col gap-1">
		<div class="flex items-center gap-2">
			<h1 class="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
				Site Check-in Proyek
			</h1>
			<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-600/10 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800">
				GPS + Foto
			</span>
		</div>
		<p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
			Rekam kehadiran di titik lokasi proyek untuk validasi bukti kunjungan lapangan, audit kepatuhan, dan integrasi absensi.
		</p>
	</div>

	<SectionGuide
		id="ess.site-checkin.page"
		title={siteCheckinGuide.sectionGuide?.title}
		steps={siteCheckinGuide.sectionGuide?.steps ?? []}
	/>

	<!-- Loading State -->
	{#if activeCheckin === undefined}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memeriksa status kunjungan aktif..." />
		</div>

	<!-- Active Checkin State Banner Card -->
	{:else if activeCheckin && !showSwitchCheckinForm}
		<div
			class="rounded-3xl border p-5 sm:p-6 shadow-sm flex flex-col gap-4 relative overflow-hidden bg-gradient-to-br from-emerald-500/10 via-white to-emerald-500/5 dark:from-emerald-950/30 dark:via-slate-900 dark:to-emerald-950/20 border-emerald-500/30 dark:border-emerald-800/60"
			transition:slide={{ duration: 200 }}
		>
			<!-- Status header & live ticker -->
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold mb-1.5 border border-emerald-500/30">
						<span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
						<span>Sedang Berlangsung di Lokasi</span>
					</div>
					<h2 class="text-lg sm:text-xl font-black text-slate-900 dark:text-slate-100 truncate">
						{activeCheckin.nama_lokasi}
					</h2>
					<p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
						<IconClock size={14} class="text-emerald-600 dark:text-emerald-400" />
						<span>Masuk pukul {formatTime(activeCheckin.check_in_at)} WIB</span>
						{#if activeCheckin.tier_absensi}
							<span class="text-slate-300 dark:text-slate-600">•</span>
							<span>Tier: {activeCheckin.tier_absensi}</span>
						{/if}
					</p>
				</div>

				<!-- Digital StopWatch Ticker -->
				<div class="px-3.5 py-2 rounded-2xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800/80 shadow-2xs text-right shrink-0">
					<p class="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Durasi</p>
					<p class="font-mono text-sm sm:text-base font-black text-emerald-700 dark:text-emerald-400 mt-0.5">
						{elapsedString || '00:00:00'}
					</p>
				</div>
			</div>

			<!-- Action Buttons (Checkout & Switch) -->
			<div class="pt-2 border-t border-emerald-500/20 flex flex-col sm:flex-row items-center gap-2">
				<button
					type="button"
					class="w-full sm:flex-1 h-12 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 shadow-sm transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
					onclick={() => (showCheckout = true)}
				>
					<IconLogout size={17} /> Check-out Sekarang
				</button>
				<button
					type="button"
					class="w-full sm:w-auto h-12 px-4 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 shadow-2xs transition-all flex items-center justify-center gap-1.5"
					onclick={() => {
						// UX-05: konfirmasi eksplisit — sebelumnya banner FYI saja, klik ini langsung
						// membuka form baru tanpa jeda keputusan. Tombol ini SATU-SATUNYA titik yang
						// benar-benar menutup kunjungan aktif (auto_next_checkin), jadi harus jelas.
						if (confirm(`Kunjungan di "${activeCheckin?.nama_lokasi || 'proyek ini'}" akan ditutup sekarang. Lanjutkan?`)) {
							showSwitchCheckinForm = true;
						}
					}}
				>
					<IconPlus size={16} /> Check-in Proyek Baru
				</button>
			</div>
		</div>

	<!-- Paket 02 §3.7 — kunjungan tersimpan lokal, belum dikonfirmasi server. Form check-in
	     SENGAJA tidak ditampilkan di sini (worst case B/C: cegah check-in dobel). -->
	{:else if !activeCheckin && localPendingCheckinInfo && !showSwitchCheckinForm}
		<div
			class="rounded-3xl border p-5 sm:p-6 shadow-sm flex flex-col gap-3 bg-amber-500/10 border-amber-500/30 dark:bg-amber-950/20 dark:border-amber-800/60"
			transition:slide={{ duration: 200 }}
		>
			<div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 text-[11px] font-bold w-fit">
				<span>📱 Tersimpan di HP</span>
			</div>
			<h2 class="text-lg font-black text-slate-900 dark:text-slate-100">
				{localPendingCheckinInfo.namaLokasi || 'Kunjungan'}
			</h2>
			<p class="text-xs text-slate-600 dark:text-slate-400">
				Masuk pukul {formatTime(localPendingCheckinInfo.createdAt)} WIB (belum ada sinyal). Data ini
				aman tersimpan di HP dan akan terkirim otomatis begitu sinyal kembali — <strong>jangan check-in ulang</strong>.
			</p>
			<!-- Paket 02 §3.9.2 (worst case I) — checkout tetap bisa dilakukan walau check-in
			     belum dikonfirmasi server; server me-resolve dari client_txn_id (checkinClientTxnId). -->
			<button
				type="button"
				class="w-full h-11 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
				onclick={() => (showLocalCheckout = true)}
			>
				<IconLogout size={16} /> Check-out Sekarang
			</button>
		</div>

	<!-- Form Checkin (New or Switch) -->
	{:else}
		{#if showSwitchCheckinForm && activeCheckin}
			<div class="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-3 mb-2">
				<div>
					<p class="font-bold">Check-in di Proyek Baru</p>
					<p class="text-[11px] opacity-90">Kunjungan di {activeCheckin.nama_lokasi} akan otomatis di-checkout saat Anda check-in di sini.</p>
				</div>
				<button
					type="button"
					class="text-xs font-bold text-amber-800 dark:text-amber-300 underline shrink-0"
					onclick={() => (showSwitchCheckinForm = false)}
				>
					Batal
				</button>
			</div>
		{/if}

		<!-- Paket 07 §3.2 poin 2 — kartu tawaran hubungkan booking hari ini (butuh konfirmasi). -->
		{#if bookingTawaran}
			<div class="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex flex-col gap-2.5 mb-3" transition:slide={{ duration: 180 }}>
				<p class="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
					🚗 Anda punya peminjaman <b>{bookingTawaran.kode}</b> hari ini ke <b>{bookingTawaran.tujuan}</b>. Check-in ini bagian dari perjalanan itu?
				</p>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="flex-1 h-9 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700"
						onclick={terimaBookingTawaran}
					>
						Ya, hubungkan
					</button>
					<button
						type="button"
						class="flex-1 h-9 rounded-lg text-xs font-bold text-blue-700 dark:text-blue-300 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-800"
						onclick={tolakBookingTawaran}
					>
						Bukan
					</button>
				</div>
			</div>
		{/if}

		<!-- Paket 07 §3.2 poin 3 — peringatan booking basi (lewat tanggal, belum ditutup). -->
		{#if bookingBasi}
			<div class="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-3 mb-3">
				<span>
					Peminjaman <b>{bookingBasi.kode}</b> belum ditutup sejak {new Date(bookingBasi.tanggalMulai).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' })}.
					Tutup di menu Kendaraan supaya tidak tercampur dengan kunjungan hari ini.
				</span>
				<a href="/ess/kendaraan" class="shrink-0 text-[11px] font-bold underline whitespace-nowrap">Buka Kendaraan</a>
			</div>
		{/if}

		<CheckinForm
			onSuccess={handleCheckinSuccess}
			presetBookingId={siteVisitBookingId}
			presetProjectId={siteVisitProjectId}
			presetBookingCode={siteVisitBookingCode}
		/>
	{/if}

	<!-- Today's Journey Timeline -->
	<div class="mt-4 pt-5 border-t border-slate-200/80 dark:border-slate-800">
		<JourneyTimeline {refreshKey} />
	</div>
</div>

<!-- Modal Checkout -->
{#if showCheckout && activeCheckin}
	<CheckoutDialog checkin={activeCheckin} onDone={handleCheckoutDone} onClose={() => (showCheckout = false)} />
{/if}

<!-- Modal Checkout — kunjungan yang check-in-nya SENDIRI masih di antrean (§3.9.2) -->
{#if showLocalCheckout && localPendingCheckinInfo}
	<CheckoutDialog
		checkin={buildLocalStubCheckin(localPendingCheckinInfo)}
		checkinClientTxnId={localPendingCheckinInfo.clientTxnId}
		onDone={handleLocalCheckoutDone}
		onClose={() => (showLocalCheckout = false)}
	/>
{/if}

