<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';
	import { createFormPersist } from '$lib/utils/formPersist';
	import { isNetworkError } from '$lib/utils/fetchTimeout';
	import { labelUangMuka } from '$lib/utils/fleetAdvanceLabel';
	import { toWaNumber, waLink } from '$lib/utils/waNumber';
	import { buildSteps, teksDitolak } from '$lib/data/bookingStepper';
	import { pilihLangkah, type AksiLangkah } from '$lib/data/langkahBerikutnya';
	import {
		getPendingP2HOverlay,
		getRejectedP2H,
		removeQueuedP2H,
		type QueuedP2HSubmission
	} from '$lib/utils/offlineP2HQueue';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getMyFleetBookings,
		getFleetBookingMeta,
		submitFleetBooking,
		cancelFleetBooking,
		submitSettlementSetor,
		getFleetAvailability,
		type FleetBookingRecord,
		type FleetBookingMeta,
		type VehicleOption,
		type AvailabilityBlock
	} from '$lib/services/ess/fleetBooking';
	import { getMyProjects, type SiteCheckinProjectOption } from '$lib/services/siteCheckin';
	import { SectionGuide, FieldHint, HelpIcon } from '$lib/components/hints';
	import { essHints } from '$lib/data/hints/ess';
	import { getHint } from '$lib/data/hints/getHint';
	import {
		IconCar,
		IconSteeringWheel,
		IconClock,
		IconCalendar,
		IconMapPin,
		IconPlus,
		IconSearch,
		IconFilter,
		IconPhone,
		IconBrandWhatsapp,
		IconInfoCircle,
		IconLoader2,
		IconAlertTriangle,
		IconCircleCheck,
		IconX,
		IconGasStation,
		IconUsers,
		IconGauge,
		IconArrowRight,
		IconRefresh,
		IconShieldCheck,
		IconFileDescription,
		IconTrash,
		IconEye
	} from '@tabler/icons-svelte';

	const h = (key: string) => getHint(essHints, key, 'ess');

	// State Data
	let loading = $state(true);
	let refreshing = $state(false);
	let errorMsg = $state('');
	let meta = $state<FleetBookingMeta | null>(null);
	let bookings = $state<FleetBookingRecord[]>([]);
	// Peminjaman 07 — ketahanan jaringan
	let metaError = $state('');
	let offlineSejak = $state<string | null>(null); // ISO waktu cache riwayat yang sedang ditampilkan (null = data segar)
	let lastLoadedAt = $state<number | null>(null);
	let nowTick = $state(Date.now());
	let networkPending = $state(false); // kirim terakhir belum pasti (jaringan) — jangan isi ulang, tekan Kirim Lagi
	let formTxnId = $state('');
	let draftSavedAt = $state<Date | null>(null);
	let draftRestored = $state(false);

	// Form State
	let showModal = $state(false);
	let submitting = $state(false);
	let submitError = $state('');
	let submitSuccess = $state(false);
	let submitWarning = $state('');

	// Form Fields
	let formTujuan = $state('');
	let formKeperluan = $state('');
	let formVehicleId = $state<number | ''>('');
	let formButuhDriver = $state<boolean | null>(null); // null = belum dipilih (wajib memilih, tanpa default)
	let opsiLanjutOpen = $state(false);
	let formTanggalMulai = $state('');
	let formTanggalSelesai = $state('');
	let formCatatan = $state('');
	let formTipeKeperluan = $state('operasional');
	let formProjectId = $state<number | ''>('');
	let formKategoriKunjungan = $state<string>('');
	let formZona = $state<'' | 'dalam_kota' | 'luar_kota'>('');
	let formButuhKendaraan = $state(true); // Fase 2 — hanya relevan saat site_visit
	// ESS Redesign Fase 2 — Uang Muka Operasional (Cash Advance)
	let formAdvanceDiminta = $state(false);
	let formAdvBbm = $state<number | ''>('');
	let formAdvTol = $state<number | ''>('');
	let formAdvLain = $state<number | ''>('');
	// Peminjaman 06 K9 — kunjungan tanpa kendaraan tidak mendapat uang muka (klaim lewat Biaya Lapangan).
	let advanceEnabled = $derived(
		(Number(meta?.settings?.advance_aktif) === 1 || meta?.settings?.advance_aktif === true) &&
			!(formTipeKeperluan === 'site_visit' && !formButuhKendaraan)
	);
	let advTotal = $derived(
		(Number(formAdvBbm) || 0) + (Number(formAdvTol) || 0) + (Number(formAdvLain) || 0)
	);
	let myProjects = $state<SiteCheckinProjectOption[]>([]);
	let bentrokBlocks = $state<AvailabilityBlock[]>([]);
	let checkingBentrok = $state(false);

	const TIPE_KEPERLUAN_OPTIONS = [
		{ value: 'operasional', label: 'Operasional Harian' },
		{ value: 'dinas', label: 'Perjalanan Dinas' },
		{ value: 'site_visit', label: 'Kunjungan Lapangan / Site Visit' },
		{ value: 'antar_jemput', label: 'Antar-Jemput' },
		{ value: 'lainnya', label: 'Lainnya' }
	];

	// Filter & Search State
	let activeTab = $state<'semua' | 'diajukan' | 'disetujui' | 'aktif' | 'selesai' | 'batal'>('semua');
	let searchQuery = $state('');
	let vehicleCatalogFilter = $state<string>('semua');
	let showCatalog = $state(false);

	// Detail Modal State
	let selectedBooking = $state<FleetBookingRecord | null>(null);
	// ESS Redesign Fase 3 — bukti setor balik sisa uang muka
	let setorFile = $state<File | null>(null);
	let setorBusy = $state(false);
	let setorErr = $state('');
	let cancelingId = $state<number | string | null>(null);
	let cancelReason = $state('');
	let showCancelModal = $state(false);
	let cancelError = $state('');
	let canceling = $state(false);

	// Inisialisasi default waktu form (besok jam 08:00 sampai besok jam 17:00)
	function initDefaultDates() {
		const now = new Date();
		const tomorrow = new Date(now.getTime() + 25 * 3600 * 1000); // 25 jam dari sekarang
		tomorrow.setMinutes(0, 0, 0);

		const tomorrowEnd = new Date(tomorrow.getTime() + 9 * 3600 * 1000); // +9 jam (08:00 -> 17:00)

		const pad = (n: number) => String(n).padStart(2, '0');
		const toIsoInput = (d: Date) =>
			`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

		formTanggalMulai = toIsoInput(tomorrow);
		formTanggalSelesai = toIsoInput(tomorrowEnd);
	}

	// ---- Cache riwayat terakhir (Peminjaman 07 §3.3). Kunci ber-uid: akun lain di HP yang sama tidak bisa membacanya.
	const cacheKey = () => `ess_kendaraan_riwayat_v1:${get(authStore).user?.uid || 'anon'}`;
	function simpanCacheRiwayat(data: FleetBookingRecord[]) {
		try {
			localStorage.setItem(cacheKey(), JSON.stringify({ at: new Date().toISOString(), data: (data || []).slice(0, 30) }));
		} catch {
			/* localStorage penuh/diblokir — cache hanya kenyamanan */
		}
	}
	function bacaCacheRiwayat(): { at: string; data: FleetBookingRecord[] } | null {
		try {
			const r = localStorage.getItem(cacheKey());
			return r ? JSON.parse(r) : null;
		} catch {
			return null;
		}
	}

	// Peminjaman 08 Fase B — P2H yang tersimpan di HP (belum terkirim) dianggap sudah berlaku: booking tampil
	// aktif/selesai (peminjam boleh berangkat/pulang). Overlay hanya tampilan; server yang menetapkan status asli saat terkirim.
	let p2hDitolak = $state<QueuedP2HSubmission[]>([]);
	const pendingP2H = (b: FleetBookingRecord): 'sebelum' | 'setelah' | null => (b as any)._pending_p2h ?? null;
	async function terapkanOverlayP2H(list: FleetBookingRecord[]): Promise<FleetBookingRecord[]> {
		try {
			p2hDitolak = await getRejectedP2H();
			const ov = await getPendingP2HOverlay();
			if (ov.size === 0) return list;
			return list.map((b) => {
				const t = ov.get(String(b.id));
				if (!t || b.status === 'selesai') return b;
				if (t === 'sebelum' && b.status !== 'disetujui') return b;
				return { ...b, status: t === 'setelah' ? 'selesai' : 'aktif', _pending_p2h: t } as FleetBookingRecord;
			});
		} catch (e) {
			console.warn('[p2h] gagal membaca antrean offline untuk overlay:', e);
			return list;
		}
	}
	async function buangP2HDitolak(e: QueuedP2HSubmission) {
		try {
			await removeQueuedP2H(e.client_txn_id);
		} catch (err) {
			console.error('[p2h] gagal membuang entri ditolak:', err);
		}
		p2hDitolak = p2hDitolak.filter((x) => x.client_txn_id !== e.client_txn_id);
	}

	// Pisahkan "gagal memuat" dari "kosong": error TIDAK ditelan jadi daftar kosong (yang memancing user mengajukan ulang).
	async function loadData() {
		loading = true;
		errorMsg = '';
		metaError = '';
		const [metaR, bookingsR] = await Promise.allSettled([getFleetBookingMeta(), getMyFleetBookings()]);
		if (metaR.status === 'fulfilled') {
			meta = metaR.value;
			if (metaR.value?.visit_categories_error) metaError = 'Sebagian data pendukung (kategori kunjungan) gagal dimuat.';
		} else {
			metaError = metaR.reason?.message || 'Data pendukung gagal dimuat.';
		}
		if (bookingsR.status === 'fulfilled') {
			const segar = bookingsR.value ?? [];
			offlineSejak = null;
			simpanCacheRiwayat(segar); // cache = tampilan SERVER (tanpa overlay)
			bookings = await terapkanOverlayP2H(segar);
		} else {
			const cache = bacaCacheRiwayat();
			if (cache) {
				bookings = await terapkanOverlayP2H(cache.data ?? []);
				offlineSejak = cache.at;
			}
			errorMsg = bookingsR.reason?.message || 'Gagal memuat riwayat.';
		}
		lastLoadedAt = Date.now();
		nowTick = Date.now();
		loading = false;
		refreshing = false;
	}

	// Muat ulang data pendukung (meta) saja — dipakai tombol "Muat Ulang" di form.
	async function reloadMeta() {
		metaError = '';
		try {
			meta = await getFleetBookingMeta();
			if (meta?.visit_categories_error) metaError = 'Sebagian data pendukung (kategori kunjungan) gagal dimuat.';
		} catch (e: any) {
			metaError = e?.message || 'Data pendukung gagal dimuat.';
		}
	}

	function labelDiperbarui(now: number, at: number | null): string {
		if (!at) return '';
		const menit = Math.floor((now - at) / 60000);
		if (menit < 1) return 'Diperbarui baru saja';
		if (menit < 60) return `Diperbarui ${menit} menit lalu`;
		return `Diperbarui ${Math.floor(menit / 60)} jam lalu`;
	}

	onMount(() => {
		initDefaultDates();
		loadData();

		// Auto-refresh berbasis EVENT, tanpa polling ke server (hemat API): tab kembali aktif (>60 dtk sejak muat
		// terakhir) atau koneksi kembali. Timer di bawah hanya memperbarui teks "Diperbarui x menit lalu" (lokal).
		// Tab disembunyikan / halaman ditutup: tulis draf SEKARANG (debounce 500ms bisa keburu terputus).
		const flushDraft = () => {
			if (!showModal || submitSuccess) return;
			const snap = formSnapshot();
			if (snap.tujuan.trim() || snap.keperluan.trim() || snap.catatan.trim()) formPersist.flushNow(snap);
		};
		const onVisible = () => {
			if (document.visibilityState === 'hidden') flushDraft();
			if (document.visibilityState !== 'visible') return;
			nowTick = Date.now();
			if (!loading && !showModal && lastLoadedAt && Date.now() - lastLoadedAt > 60_000) loadData();
		};
		const onOnline = () => {
			if (!loading && !showModal) loadData();
		};
		document.addEventListener('visibilitychange', onVisible);
		window.addEventListener('online', onOnline);
		window.addEventListener('p2h-queue-flushed', onOnline);
		window.addEventListener('pagehide', flushDraft);
		const tickTimer = setInterval(() => (nowTick = Date.now()), 30_000);
		return () => {
			document.removeEventListener('visibilitychange', onVisible);
			window.removeEventListener('online', onOnline);
			window.removeEventListener('p2h-queue-flushed', onOnline);
			window.removeEventListener('pagehide', flushDraft);
			clearInterval(tickTimer);
		};
	});

	async function handleRefresh() {
		refreshing = true;
		await loadData();
	}

	// Draf form pengajuan (Peminjaman 07 §3.4) — memakai lapisan draf bersama (localStorage + TTL + kunci per user).
	type KendaraanDraft = {
		tujuan: string; keperluan: string; vehicleId: number | ''; butuhDriver: boolean | null; catatan: string; tipe: string;
		projectId: number | ''; kategori: string; zona: '' | 'dalam_kota' | 'luar_kota'; butuhKendaraan: boolean;
		tanggalMulai: string; tanggalSelesai: string; txnId: string;
	};
	const formPersist = createFormPersist<KendaraanDraft>('ess_kendaraan_form');
	const formSnapshot = (): KendaraanDraft => ({
		tujuan: formTujuan, keperluan: formKeperluan, vehicleId: formVehicleId, butuhDriver: formButuhDriver,
		catatan: formCatatan, tipe: formTipeKeperluan, projectId: formProjectId, kategori: formKategoriKunjungan,
		zona: formZona, butuhKendaraan: formButuhKendaraan, tanggalMulai: formTanggalMulai, tanggalSelesai: formTanggalSelesai,
		txnId: formTxnId
	});
	// Simpan hanya bila user sudah mengetik sesuatu (tanggal default saja bukan draf).
	$effect(() => {
		if (!showModal || submitSuccess) return;
		const snap = formSnapshot();
		if (snap.tujuan.trim() || snap.keperluan.trim() || snap.catatan.trim()) {
			formPersist.save(snap);
			draftSavedAt = new Date();
		}
	});

	// Chip waktu cepat (Peminjaman 07 §3.6) — batas minimal dari setting, bukan hardcode.
	const toInputValue = (d: Date) => {
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	};
	let minJam = $derived(Math.max(1, Number(meta?.settings?.minimal_pengajuan_jam_sebelum ?? 1)));
	function chipTime(kind: 'segera' | 'siang' | 'besok'): Date {
		const d = new Date();
		if (kind === 'segera') {
			// + batas minimal + margin 5 menit, dibulatkan ke atas per 5 menit
			const t = new Date(Date.now() + minJam * 3600 * 1000 + 5 * 60 * 1000);
			t.setMinutes(Math.ceil(t.getMinutes() / 5) * 5, 0, 0);
			return t;
		}
		if (kind === 'siang') d.setHours(13, 0, 0, 0);
		else {
			d.setDate(d.getDate() + 1);
			d.setHours(8, 0, 0, 0);
		}
		return d;
	}
	const chipDisabled = (kind: 'segera' | 'siang' | 'besok') =>
		chipTime(kind).getTime() - nowTick < minJam * 3600 * 1000 - 60_000;
	function pakaiChip(kind: 'segera' | 'siang' | 'besok') {
		const start = chipTime(kind);
		formTanggalMulai = toInputValue(start);
		formTanggalSelesai = toInputValue(new Date(start.getTime() + 4 * 3600 * 1000)); // rencana kembali +4 jam (bisa diubah)
	}

	function closeForm() {
		if (!networkPending) {
			formPersist.clear();
			draftSavedAt = null;
		}
		showModal = false;
	}

	// Peminjaman 08 §3.6 — simpan detail booking ke sessionStorage saat membuka checklist supaya halaman checklist
	// tetap terbuka walau sinyal hilang di pool/basement. Navigasi TIDAK menunggu apa pun (Aturan #5-style: tanpa await).
	function bukaChecklist(b: FleetBookingRecord, query: string) {
		try {
			sessionStorage.setItem(`ess_kendaraan_booking_${b.id}`, JSON.stringify(b));
		} catch {
			/* penyimpanan penuh/diblokir — hanya kenyamanan */
		}
		goto(`/ess/kendaraan/checklist/${b.id}?${query}`);
	}
	// Peminjaman 09 §3.5 — site visit berkendaraan yang sedang jalan tetapi BELUM check-in di lokasi.
	const perluCheckinLokasi = (b: FleetBookingRecord) =>
		b.status === 'aktif' && b.tipe_keperluan === 'site_visit' && b.butuh_kendaraan !== false && !(b as any).referensi_site_visit_id;
	const sudahCheckinLokasi = (b: FleetBookingRecord) =>
		b.status === 'aktif' && b.tipe_keperluan === 'site_visit' && b.butuh_kendaraan !== false && !!(b as any).referensi_site_visit_id;

	// Peminjaman 11 §3.1 — "Ajukan Ulang" dari booking yang ditolak: form terisi data lama, TANGGAL di-reset (default baru).
	// skipDraft: txn id & draf lama tidak boleh ikut (kalau tidak, server bisa membalas booking lama sebagai replay).
	function ajukanUlang(b: FleetBookingRecord) {
		selectedBooking = null;
		openCreateForm(undefined, { skipDraft: true });
		formTujuan = b.tujuan || '';
		formKeperluan = b.keperluan || '';
		formVehicleId = (b.vehicle_id as number | null) || '';
		formButuhDriver = b.butuh_kendaraan === false ? null : !!b.butuh_driver;
		formTipeKeperluan = b.tipe_keperluan && b.tipe_keperluan !== 'kendaraan_pribadi' ? b.tipe_keperluan : 'operasional';
		formProjectId = (b.project_id as number | null) || '';
		formKategoriKunjungan = b.kategori_kunjungan || '';
		formZona = (b.zona as '' | 'dalam_kota' | 'luar_kota' | null) || '';
		formButuhKendaraan = b.butuh_kendaraan !== false;
	}

	// Label zona dari konfigurasi (Peminjaman 11 §3.7); kode tetap dalam_kota/luar_kota.
	let labelZonaDalam = $derived(meta?.settings?.label_zona_dalam_kota || 'Dalam Kota (Jabodetabek)');
	let labelZonaLuar = $derived(meta?.settings?.label_zona_luar_kota || 'Luar Kota');

	// Judul & tombol form mengikuti jenis pengajuan (Peminjaman 11 §3.6): kunjungan tanpa kendaraan bukan "peminjaman kendaraan".
	let judulForm = $derived(formTipeKeperluan === 'site_visit' && !formButuhKendaraan ? 'Ajukan Kunjungan Lapangan' : 'Ajukan Peminjaman Kendaraan');
	let labelKirim = $derived(formTipeKeperluan === 'site_visit' && !formButuhKendaraan ? 'Kirim Pengajuan Kunjungan' : 'Kirim Pengajuan Peminjaman');

	// Kartu "Langkah Berikutnya" (Peminjaman 11 §3.8)
	const fmtJamWib = (iso?: string | null) =>
		iso ? new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\./g, ':') + ' WIB' : '-';
	let kartuLangkah = $derived(pilihLangkah(bookings as any, { adaKontakGa: !!toWaNumber((meta as any)?.kontak_ga_wa), fmtJam: fmtJamWib }));
	function jalankanAksi(aksi: AksiLangkah) {
		const b = kartuLangkah.booking as FleetBookingRecord | null;
		switch (aksi) {
			case 'detail': if (b) selectedBooking = b; break;
			case 'mulai_pakai': if (b) bukaChecklist(b, 'tahap=sebelum'); break;
			case 'kembalikan': if (b) bukaChecklist(b, 'tahap=setelah'); break;
			case 'checkin': if (b) goto(`/site-checkin?booking=${b.id}`); break;
			case 'kunjungan': goto(b ? `/site-checkin?booking=${b.id}` : '/site-checkin'); break;
			case 'chat_ga': { const u = waLink((meta as any)?.kontak_ga_wa, b ? `Halo GA, peminjaman ${b.kode_booking} sudah disetujui tetapi unit belum ditetapkan. Mohon dibantu.` : undefined); if (u) window.open(u, '_blank', 'noopener'); break; }
			case 'ajukan_ulang': if (b) ajukanUlang(b); break;
			case 'ajukan': openCreateForm(); break;
		}
	}
	const TONE_KELAS: Record<string, string> = {
		ok: 'border-emerald-400/50 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent',
		info: 'border-amber-300/60 bg-gradient-to-r from-amber-400/10 to-transparent',
		warn: 'border-amber-400/60 bg-gradient-to-r from-amber-400/15 to-transparent',
		error: 'border-rose-300/60 bg-gradient-to-r from-rose-400/10 to-transparent',
		neutral: 'border-blue-300/50 bg-gradient-to-r from-blue-500/10 to-transparent'
	};

	// Booking disetujui yang jadwal berangkatnya sudah lewat: peminjam mungkin sudah berangkat tanpa P2H sebelum pakai.
	const sudahLewatJadwal = (b: FleetBookingRecord) => !!b.tanggal_mulai && new Date(b.tanggal_mulai).getTime() < Date.now();

	function openCreateForm(preselectedVehicleId?: number, opts: { skipDraft?: boolean } = {}) {
		formTujuan = '';
		formKeperluan = '';
		formVehicleId = preselectedVehicleId || '';
		formButuhDriver = null;
		opsiLanjutOpen = false;
		formCatatan = '';
		formTipeKeperluan = 'operasional';
		formProjectId = '';
		formKategoriKunjungan = '';
		formZona = '';
		formButuhKendaraan = true;
		formAdvanceDiminta = false;
		formAdvBbm = '';
		formAdvTol = '';
		formAdvLain = '';
		bentrokBlocks = [];
		submitError = '';
		submitSuccess = false;
		submitWarning = '';
		networkPending = false;
		draftRestored = false;
		draftSavedAt = null;
		formTxnId = crypto.randomUUID(); // ID baru per form; dipakai ULANG untuk setiap percobaan kirim dari form ini
		initDefaultDates();
		// Pulihkan draf (bila ada) — termasuk txn id-nya, supaya kirim yang belum pasti sebelum app ditutup tetap idempoten.
		if (!preselectedVehicleId && !opts.skipDraft) {
			const d = formPersist.restore();
			if (d) {
				formTujuan = d.tujuan ?? '';
				formKeperluan = d.keperluan ?? '';
				formVehicleId = d.vehicleId ?? '';
				formButuhDriver = d.butuhDriver ?? null;
				formCatatan = d.catatan ?? '';
				formTipeKeperluan = d.tipe ?? 'operasional';
				formProjectId = d.projectId ?? '';
				formKategoriKunjungan = d.kategori ?? '';
				formZona = d.zona ?? '';
				formButuhKendaraan = d.butuhKendaraan ?? true;
				if (d.tanggalMulai) formTanggalMulai = d.tanggalMulai;
				if (d.tanggalSelesai) formTanggalSelesai = d.tanggalSelesai;
				if (d.txnId) formTxnId = d.txnId;
				draftRestored = true;
				const at = formPersist.savedAt();
				draftSavedAt = at ? new Date(at) : null;
			}
		}
		showModal = true;
		if (myProjects.length === 0) {
			getMyProjects().then((r) => (myProjects = r.projects || [])).catch(() => {});
		}
	}

	// Cek bentrok jadwal unit terpilih (kalender ringkas, §9.1.3) setiap kali unit/tanggal berubah
	let bentrokCheckKey = $derived(`${formVehicleId}|${formTanggalMulai}|${formTanggalSelesai}`);
	$effect(() => {
		bentrokCheckKey; // trigger
		if (!showModal || !formVehicleId || !formTanggalMulai || sembunyikanKendaraan) {
			bentrokBlocks = [];
			return;
		}
		checkingBentrok = true;
		const from = new Date(formTanggalMulai).toISOString();
		const to = formTanggalSelesai ? new Date(formTanggalSelesai).toISOString() : from;
		getFleetAvailability(from, to, Number(formVehicleId))
			.then((blocks) => (bentrokBlocks = blocks))
			.catch(() => (bentrokBlocks = []))
			.finally(() => (checkingBentrok = false));
	});

	// Live Duration Calculator
	let durationText = $derived.by(() => {
		if (!formTanggalMulai || !formTanggalSelesai) return '';
		const start = new Date(formTanggalMulai).getTime();
		const end = new Date(formTanggalSelesai).getTime();
		if (isNaN(start) || isNaN(end) || end <= start) return 'Waktu selesai harus setelah waktu mulai';

		const diffMs = end - start;
		const hoursTotal = Math.floor(diffMs / (1000 * 60 * 60));
		const days = Math.floor(hoursTotal / 24);
		const remainingHours = hoursTotal % 24;

		if (days > 0) {
			return `${days} Hari ${remainingHours > 0 ? remainingHours + ' Jam' : ''}`;
		}
		return `${hoursTotal} Jam`;
	});

	// Notice Jam Pengajuan
	let leadTimeHours = $derived.by(() => {
		if (!formTanggalMulai) return 0;
		const start = new Date(formTanggalMulai).getTime();
		const now = Date.now();
		return (start - now) / (1000 * 60 * 60);
	});

	let isLeadTimeValid = $derived.by(() => {
		const minHours = meta?.settings?.minimal_pengajuan_jam_sebelum ?? 1;
		return leadTimeHours >= minHours - 0.05;
	});

	// Fase 1 — kategori & zona kunjungan (site_visit)
	let visitCategories = $derived(meta?.visit_categories ?? []);
	let selectedCategory = $derived(visitCategories.find((c) => c.kode === formKategoriKunjungan) || null);

	function handleKategoriChange() {
		const cat = visitCategories.find((c) => c.kode === formKategoriKunjungan) || null;
		// Zona terisi otomatis bila kategori punya default pasti; 'keduanya' = peminjam pilih manual
		formZona = cat && cat.zona_default !== 'keduanya' ? cat.zona_default : '';
		// Fase 2 — default "butuh kendaraan" mengikuti kategori (peminjam tetap bisa mengubah)
		formButuhKendaraan = cat ? cat.wajib_kendaraan_default !== false : true;
	}

	// Fase 2 — sembunyikan unit/driver/bentrok saat kunjungan tanpa kendaraan
	let sembunyikanKendaraan = $derived(formTipeKeperluan === 'site_visit' && !formButuhKendaraan);

	let siteVisitDetailsValid = $derived(
		formTipeKeperluan !== 'site_visit' ||
		(!!formKategoriKunjungan &&
			(formZona === 'dalam_kota' || formZona === 'luar_kota') &&
			(!selectedCategory?.wajib_project || !!formProjectId))
	);

	// Validasi Submit
	let canSubmit = $derived(
		!!formTujuan.trim() &&
		!!formTanggalMulai &&
		!!formTanggalSelesai &&
		new Date(formTanggalSelesai) > new Date(formTanggalMulai) &&
		(isLeadTimeValid || networkPending) &&
		siteVisitDetailsValid &&
		(sembunyikanKendaraan || formButuhDriver !== null) &&
		(!(advanceEnabled && formAdvanceDiminta) || advTotal > 0) &&
		!submitting
	);

	// Alasan tombol kirim belum aktif — ditampilkan di bawah tombol (Peminjaman 11 §3.9, U7).
	let alasanBlokir = $derived.by(() => {
		if (submitting || networkPending) return '';
		if (!formTujuan.trim()) return 'Isi tujuan perjalanan dulu.';
		if (!formTanggalMulai) return 'Pilih kapan berangkat.';
		if (!isLeadTimeValid) return 'Waktu berangkat terlalu dekat — geser waktu berangkat.';
		if (!sembunyikanKendaraan && formButuhDriver === null) return 'Pilih perlu sopir atau tidak.';
		if (!siteVisitDetailsValid) return 'Lengkapi kategori, zona, dan proyek kunjungan.';
		if (!formTanggalSelesai || new Date(formTanggalSelesai) <= new Date(formTanggalMulai)) return 'Rencana kembali harus setelah waktu berangkat (ada di Opsi lanjutan).';
		if (advanceEnabled && formAdvanceDiminta && advTotal <= 0) return 'Isi minimal salah satu estimasi uang muka.';
		return '';
	});
	// Bila masalahnya ada di isian yang tersembunyi di "Opsi lanjutan", buka otomatis supaya terlihat.
	$effect(() => {
		if (showModal && alasanBlokir.startsWith('Rencana kembali')) opsiLanjutOpen = true;
	});
	// Hanya ada satu proyek aktif → pilih otomatis (kunjungan proyek).
	$effect(() => {
		if (showModal && formTipeKeperluan === 'site_visit' && myProjects.length === 1 && !formProjectId) formProjectId = myProjects[0].id as number;
	});

	// 4 kartu jenis perjalanan (§3.9) — jenis rinci lain (mis. antar-jemput) ada di Opsi lanjutan.
	const JENIS_KARTU: { value: string; label: string; ket: string; icon: any }[] = [
		{ value: 'operasional', label: 'Operasional', ket: 'Kegiatan harian kantor', icon: IconCar },
		{ value: 'dinas', label: 'Dinas', ket: 'Perjalanan dinas', icon: IconCalendar },
		{ value: 'site_visit', label: 'Kunjungan Proyek', ket: 'Ke lokasi proyek/customer', icon: IconMapPin },
		{ value: 'lainnya', label: 'Lainnya', ket: 'Selain di atas', icon: IconFileDescription }
	];
	let jenisKartuAktif = $derived(['operasional', 'dinas', 'site_visit'].includes(formTipeKeperluan) ? formTipeKeperluan : 'lainnya');

	async function handleFormSubmit() {
		if (!canSubmit) return;
		submitting = true;
		submitError = '';
		submitWarning = '';
		networkPending = false;
		try {
			const created = await submitFleetBooking({
				client_txn_id: formTxnId || undefined,
				tujuan: formTujuan.trim(),
				keperluan: formKeperluan.trim() || undefined,
				vehicle_id: formVehicleId ? Number(formVehicleId) : null,
				butuh_driver: formButuhDriver === true,
				tanggal_mulai: new Date(formTanggalMulai).toISOString(),
				tanggal_selesai_rencana: new Date(formTanggalSelesai).toISOString(),
				catatan: formCatatan.trim() || undefined,
				tipe_keperluan: formTipeKeperluan,
				project_id: formTipeKeperluan === 'site_visit' && formProjectId ? Number(formProjectId) : null,
				kategori_kunjungan: formTipeKeperluan === 'site_visit' ? formKategoriKunjungan || null : null,
				zona: formTipeKeperluan === 'site_visit' && formZona ? formZona : null,
				butuh_kendaraan: formTipeKeperluan === 'site_visit' ? formButuhKendaraan : true,
				advance_diminta: advanceEnabled && formAdvanceDiminta,
				advance_est_bbm: Number(formAdvBbm) || 0,
				advance_est_tol: Number(formAdvTol) || 0,
				advance_est_lain: Number(formAdvLain) || 0
			});
			submitWarning = (created as any)?._warning || '';
			submitSuccess = true;
			formPersist.clear(); // sukses → draf & txn id dibuang (form berikutnya dapat ID baru)
			draftSavedAt = null;
			setTimeout(async () => {
				showModal = false;
				await loadData();
			}, submitWarning ? 3500 : 1200);
		} catch (err: any) {
			if (isNetworkError(err)) {
				// Tidak ada respons: booking MUNGKIN sudah masuk. Jangan tampilkan "Gagal" — Kirim Lagi memakai txn id yang sama.
				networkPending = true;
				submitError = '';
			} else {
				submitError = err?.message || 'Gagal mengajukan peminjaman kendaraan.';
			}
		} finally {
			submitting = false;
		}
	}

	async function handleSetorBalik() {
		if (!selectedBooking || !setorFile) {
			setorErr = 'Pilih file bukti transfer/setor dulu.';
			return;
		}
		setorBusy = true;
		setorErr = '';
		try {
			const updated = await submitSettlementSetor(selectedBooking.id, setorFile);
			if (updated) selectedBooking = { ...selectedBooking, ...updated };
			setorFile = null;
			await loadData();
		} catch (e: any) {
			setorErr = e?.message || 'Gagal mengunggah bukti setor balik.';
		} finally {
			setorBusy = false;
		}
	}

	function confirmCancelBooking(booking: FleetBookingRecord) {
		cancelingId = booking.id;
		cancelReason = '';
		cancelError = '';
		showCancelModal = true;
	}
	// Info di modal: booking yang sudah disetujui berarti GA & sopir sudah menyiapkan unit — mereka diberi tahu otomatis.
	const cancelingBooking = $derived(bookings.find((b) => b.id === cancelingId) || null);

	async function handleExecuteCancel() {
		if (!cancelingId) return;
		canceling = true;
		try {
			await cancelFleetBooking(cancelingId, cancelReason);
			showCancelModal = false;
			if (selectedBooking && selectedBooking.id === cancelingId) {
				selectedBooking = null;
			}
			await loadData();
		} catch (err: any) {
			// Pesan tampil DI DALAM modal (bukan alert()) dan modal tetap terbuka supaya bisa dicoba lagi.
			cancelError = err?.message || 'Gagal membatalkan peminjaman. Coba lagi.';
			canceling = false;
			return;
		} finally {
			canceling = false;
		}
		cancelingId = null;
	}

	// Filtered Bookings
	let filteredBookings = $derived.by(() => {
		return bookings.filter((b) => {
			// Tab Filter
			if (activeTab === 'diajukan' && b.status !== 'diajukan') return false;
			if (activeTab === 'disetujui' && b.status !== 'disetujui') return false;
			if (activeTab === 'aktif' && b.status !== 'aktif') return false;
			if (activeTab === 'selesai' && b.status !== 'selesai') return false;
			if (activeTab === 'batal' && !['dibatalkan', 'ditolak'].includes(b.status)) return false;

			// Search Filter
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase();
				const vName = b.vehicle?.name?.toLowerCase() || '';
				const vPlate = b.vehicle?.nomor_polisi?.toLowerCase() || '';
				const dName = b.driver?.nama?.toLowerCase() || '';
				const code = b.kode_booking?.toLowerCase() || '';
				const dest = b.tujuan?.toLowerCase() || '';
				const req = b.keperluan?.toLowerCase() || '';
				return (
					vName.includes(q) ||
					vPlate.includes(q) ||
					dName.includes(q) ||
					code.includes(q) ||
					dest.includes(q) ||
					req.includes(q)
				);
			}
			return true;
		});
	});

	// Active Ongoing Booking (if any)
	let activeBooking = $derived(bookings.find((b) => b.status === 'aktif'));

	// Stats Calculation
	let countDiajukan = $derived(bookings.filter((b) => b.status === 'diajukan').length);
	let countDisetujui = $derived(bookings.filter((b) => b.status === 'disetujui').length);
	let countAktif = $derived(bookings.filter((b) => b.status === 'aktif').length);
	let countSelesai = $derived(bookings.filter((b) => b.status === 'selesai').length);

	// Catalog Filtering
	// Kelompok filter dari nilai unik `jenis` armada (bukan kata kunci hardcode mobil/pickup/motor).
	let jenisKatalog = $derived([...new Set((meta?.vehicles || []).map((v) => (v.jenis || '').trim()).filter(Boolean))].sort());
	let filteredVehicles = $derived.by(() => {
		const list = meta?.vehicles || [];
		if (vehicleCatalogFilter === 'semua') return list;
		return list.filter((v) => (v.jenis || '').trim() === vehicleCatalogFilter);
	});

	// Helpers Format
	function formatDateTime(dtStr: string | null | undefined) {
		if (!dtStr) return '-';
		try {
			const d = new Date(dtStr);
			return d.toLocaleString('id-ID', {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return dtStr;
		}
	}

	function getStatusConfig(status: string) {
		switch (status) {
			case 'diajukan':
				return {
					label: 'Menunggu Review GA',
					bg: 'bg-amber-50 dark:bg-amber-950/30',
					text: 'text-amber-700 dark:text-amber-400',
					border: 'border-amber-200 dark:border-amber-800/40',
					icon: IconClock
				};
			case 'disetujui':
				return {
					label: 'Disetujui / Siap',
					bg: 'bg-blue-50 dark:bg-blue-950/30',
					text: 'text-blue-700 dark:text-blue-400',
					border: 'border-blue-200 dark:border-blue-800/40',
					icon: IconShieldCheck
				};
			case 'aktif':
				return {
					label: 'Sedang Berjalan',
					bg: 'bg-emerald-50 dark:bg-emerald-950/30',
					text: 'text-emerald-700 dark:text-emerald-400',
					border: 'border-emerald-200 dark:border-emerald-800/40',
					icon: IconSteeringWheel
				};
			case 'selesai':
				return {
					label: 'Selesai Dikembalikan',
					bg: 'bg-slate-100 dark:bg-slate-800/60',
					text: 'text-slate-700 dark:text-slate-300',
					border: 'border-slate-200 dark:border-slate-700',
					icon: IconCircleCheck
				};
			case 'ditolak':
				return {
					label: 'Ditolak',
					bg: 'bg-rose-50 dark:bg-rose-950/30',
					text: 'text-rose-700 dark:text-rose-400',
					border: 'border-rose-200 dark:border-rose-800/40',
					icon: IconX
				};
			case 'dibatalkan':
				return {
					label: 'Dibatalkan',
					bg: 'bg-zinc-100 dark:bg-zinc-800/50',
					text: 'text-zinc-500 dark:text-zinc-400',
					border: 'border-zinc-200 dark:border-zinc-700',
					icon: IconTrash
				};
			default:
				return {
					label: status,
					bg: 'bg-slate-100 dark:bg-slate-800',
					text: 'text-slate-600 dark:text-slate-400',
					border: 'border-slate-200',
					icon: IconInfoCircle
				};
		}
	}
</script>

<div class="w-full p-4 md:p-6 pb-28 max-w-7xl mx-auto">
	<!-- Top Navigation / Header -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
		<div>
			<div class="flex items-center gap-2 mb-1 text-xs font-semibold" style="color: var(--sys-label3)">
				<a href="/ess" class="hover:underline flex items-center gap-1">
					<span>Portal Karyawan</span>
				</a>
				<span>/</span>
				<span style="color: var(--sys-label)">Peminjaman Kendaraan &amp; Kunjungan Lapangan</span>
			</div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text flex items-center gap-2">
				<IconCar size={28} class="inline text-blue-600" />
				Peminjaman Kendaraan &amp; Kunjungan Lapangan
			</h1>
			<p class="text-xs md:text-sm font-medium mt-1" style="color: var(--sys-label3)">
				Ajukan &amp; pantau kendaraan operasional, atau kunjungan lapangan / site visit — dengan atau tanpa kendaraan perusahaan.
			</p>
		</div>

		<div class="flex items-center gap-2 shrink-0">
			<button
				class="px-3 py-2 rounded-xl border flex flex-col items-center justify-center transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 leading-tight"
				style="border-color: var(--sys-sep); color: var(--sys-label)"
				onclick={handleRefresh}
				title="Ketuk untuk memuat status terbaru pengajuan Anda"
			>
				<span class="flex items-center gap-1.5 text-xs font-bold">
					<IconRefresh size={15} class={refreshing ? 'animate-spin' : ''} />
					Perbarui
				</span>
				{#if lastLoadedAt}
					<span class="text-[10px] font-medium" style="color: var(--sys-label3)">{labelDiperbarui(nowTick, lastLoadedAt)}</span>
				{/if}
			</button>

			<button
				class="px-4 py-2.5 rounded-xl text-sm font-bold text-white flex items-center gap-2 gradient-bg btn-pulse hover:scale-[1.02] active:scale-[0.98] transition-all shadow-md"
				onclick={() => openCreateForm()}
			>
				<IconPlus size={18} />
				<span>Ajukan Kendaraan</span>
			</button>
		</div>
	</div>

	<!-- Section Guide & SOP Hint -->
	<div class="mb-6">
		<SectionGuide
			id="ess.kendaraan.page"
			title={h('kendaraan.page').sectionGuide?.title}
			steps={h('kendaraan.page').sectionGuide?.steps ?? []}
		/>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-24">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat armada & riwayat peminjaman..." />
		</div>
	{:else if errorMsg && bookings.length === 0}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto my-8">
			<div class="w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} class="text-red-600 dark:text-red-400" />
			</div>
			<h3 class="text-lg font-bold text-red-600 dark:text-red-400 mb-2">Gagal Memuat Data</h3>
			<p class="text-xs text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg shadow-md" onclick={loadData}>
				Coba Lagi
			</button>
		</div>
	{:else}
		{#if errorMsg}
			<div class="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-[12px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
				<IconAlertTriangle size={16} class="shrink-0 text-amber-600 mt-0.5" />
				<div class="flex-1">
					Sinyal lemah — menampilkan data terakhir{offlineSejak ? ` (jam ${new Date(offlineSejak).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})` : ''}. Status terbaru mungkin belum tampil.
					<button class="font-bold underline ml-1" onclick={handleRefresh}>Coba Lagi</button>
				</div>
			</div>
		{/if}
		{#each p2hDitolak as pd (pd.client_txn_id)}
			<div class="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-[12px] text-rose-800 dark:text-rose-300 flex items-start gap-2">
				<IconAlertTriangle size={16} class="shrink-0 text-rose-600 mt-0.5" />
				<div class="flex-1">
					P2H {pd.tahap === 'setelah' ? 'pengembalian' : 'sebelum pakai'} yang tersimpan di HP <strong>ditolak server</strong>: {pd.lastError || 'tidak diketahui'}.
					Hubungi GA bila kendaraan sudah terlanjur dipakai.
					<button class="font-bold underline ml-1" onclick={() => buangP2HDitolak(pd)}>Buang</button>
				</div>
			</div>
		{/each}
		<!-- Langkah Berikutnya (Peminjaman 11 §3.8): satu kartu "sekarang saya harus apa" — menggantikan banner aktif + 4 kartu KPI -->
		<div class="glass-panel rounded-3xl p-5 md:p-6 mb-3 border-2 {TONE_KELAS[kartuLangkah.tone]}">
			<p class="text-[11px] font-bold uppercase tracking-wider mb-2" style="color: var(--sys-label3)">Langkah berikutnya</p>
			<div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
				<div class="flex items-start gap-3">
					<span class="text-3xl leading-none" aria-hidden="true">{kartuLangkah.emoji}</span>
					<div>
						<h3 class="text-base md:text-lg font-extrabold" style="color: var(--sys-label)">{kartuLangkah.judul}</h3>
						<p class="text-sm mt-1" style="color: var(--sys-label3)">{kartuLangkah.detail}</p>
						{#if kartuLangkah.booking}
							<p class="text-xs font-mono mt-1 text-slate-400">{kartuLangkah.booking.kode_booking}</p>
						{/if}
					</div>
				</div>
				<div class="flex flex-col sm:flex-row gap-2 md:items-center shrink-0">
					<button class="min-h-[48px] px-5 py-3 rounded-2xl text-sm font-bold text-white gradient-bg shadow-md" onclick={() => jalankanAksi(kartuLangkah.utama.aksi)}>
						{kartuLangkah.utama.label}
					</button>
					{#each kartuLangkah.sekunder as sek}
						<button class="min-h-[48px] px-4 py-3 rounded-2xl text-sm font-semibold border border-slate-300 dark:border-slate-600 bg-white/70 dark:bg-slate-900/70 text-slate-700 dark:text-slate-200" onclick={() => jalankanAksi(sek.aksi)}>{sek.label}</button>
					{/each}
					{#if kartuLangkah.booking && (kartuLangkah.kind.startsWith('aktif') || kartuLangkah.kind === 'disetujui') && waLink((kartuLangkah.booking as any).driver?.no_telepon)}
						<a class="min-h-[48px] px-4 py-3 rounded-2xl text-sm font-semibold bg-green-600 text-white flex items-center justify-center gap-1.5" href={waLink((kartuLangkah.booking as any).driver?.no_telepon)} target="_blank" rel="noreferrer"><IconBrandWhatsapp size={16} /> Hubungi Sopir</a>
					{/if}
				</div>
			</div>
			<FieldHint text="Kartu ini menunjukkan satu hal yang perlu Anda lakukan sekarang. Riwayat lengkap ada di bawah." />
		</div>

		<!-- Ringkasan status (satu baris chip; ketuk untuk menyaring daftar) -->
		<div class="flex flex-wrap gap-2 mb-6 text-xs font-semibold">
			<button class="px-3 py-2 rounded-full bg-amber-50 text-amber-800 border border-amber-200 min-h-[36px]" onclick={() => (activeTab = 'diajukan')}>Menunggu {countDiajukan}</button>
			<button class="px-3 py-2 rounded-full bg-blue-50 text-blue-800 border border-blue-200 min-h-[36px]" onclick={() => (activeTab = 'disetujui')}>Disetujui {countDisetujui}</button>
			<button class="px-3 py-2 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 min-h-[36px]" onclick={() => (activeTab = 'aktif')}>Dipakai {countAktif}</button>
			<button class="px-3 py-2 rounded-full bg-slate-100 text-slate-700 border border-slate-200 min-h-[36px]" onclick={() => (activeTab = 'selesai')}>Selesai {countSelesai}</button>
		</div>

		<!-- Toggle Fleet Catalog / Preview -->
		<div class="mb-6">
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<h2 class="text-sm md:text-base font-bold" style="color: var(--sys-label)">Armada Kendaraan Kantor</h2>
					<span class="text-xs px-2 py-0.5 rounded-full font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
						{meta?.vehicles?.length || 0} Unit
					</span>
				</div>
				<button
					class="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
					onclick={() => (showCatalog = !showCatalog)}
				>
					<span>{showCatalog ? 'Sembunyikan Katalog' : 'Lihat Katalog Armada'}</span>
				</button>
			</div>

			{#if meta?.vehiclesError}
				<div class="mb-4 p-3 rounded-xl text-xs font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
					Katalog kendaraan gagal dimuat dari server. Coba muat ulang halaman; bila masih gagal, hubungi Admin GA/IT.
				</div>
			{/if}

			{#if showCatalog}
				<div class="glass-panel rounded-3xl p-4 md:p-6 mb-6">
					<!-- Category Filter Pills -->
					<div class="flex items-center gap-2 overflow-x-auto pb-3 mb-4 text-xs font-semibold">
						<button
							class="px-3.5 py-1.5 rounded-xl transition-colors shrink-0 {vehicleCatalogFilter === 'semua' ? 'bg-blue-600 text-white font-bold' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}"
							onclick={() => (vehicleCatalogFilter = 'semua')}
						>
							Semua Tipe
						</button>
						{#each jenisKatalog as j}
							<button
								class="px-3.5 py-1.5 rounded-xl transition-colors shrink-0 {vehicleCatalogFilter === j ? 'bg-blue-600 text-white font-bold' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}"
								onclick={() => (vehicleCatalogFilter = j)}
							>
								{j}
							</button>
						{/each}
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
						{#each filteredVehicles as v}
							<div class="p-4 rounded-2xl border flex flex-col justify-between transition-all hover:shadow-md bg-white/60 dark:bg-slate-900/60" style="border-color: var(--sys-sep)">
								<div>
									<div class="flex items-start justify-between gap-2 mb-2">
										<div>
											<h4 class="text-sm font-bold truncate" style="color: var(--sys-label)">{v.name}</h4>
											<span class="inline-block font-mono text-xs font-black tracking-wider px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 mt-1 border border-slate-300/40">
												{v.plat}
											</span>
										</div>
										<span
											class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full {v.status === 'Tersedia' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'}"
										>
											{v.status}
										</span>
									</div>

									<div class="grid grid-cols-2 gap-2 text-[11px] my-3" style="color: var(--sys-label3)">
										<div class="flex items-center gap-1">
											<IconUsers size={14} class="text-blue-500" />
											<span>{v.kapasitas} Penumpang</span>
										</div>
										<div class="flex items-center gap-1">
											<IconGauge size={14} class="text-amber-500" />
											<span>{(v.odometer ?? 0).toLocaleString('id-ID')} km</span>
										</div>
										<div class="flex items-center gap-1">
											<IconGasStation size={14} class="text-emerald-500" />
											<span>{v.bahan_bakar}</span>
										</div>
										<div class="flex items-center gap-1">
											<IconMapPin size={14} class="text-rose-500" />
											<span class="truncate">{v.lokasi}</span>
										</div>
									</div>
								</div>

								<button
									class="w-full mt-2 py-2 rounded-xl text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
									onclick={() => openCreateForm(v.id)}
								>
									Pilih Unit Ini
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- History & Search Section -->
		<div class="glass-panel rounded-3xl p-4 md:p-6">
			<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
				<!-- Tab Filter Buttons -->
				<div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-bold">
					<button
						class="px-3.5 py-2 rounded-xl transition-all shrink-0 {activeTab === 'semua' ? 'gradient-bg text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 hover:bg-slate-200'}"
						onclick={() => (activeTab = 'semua')}
					>
						Semua ({bookings.length})
					</button>
					<button
						class="px-3.5 py-2 rounded-xl transition-all shrink-0 {activeTab === 'diajukan' ? 'bg-amber-500 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 hover:bg-slate-200'}"
						onclick={() => (activeTab = 'diajukan')}
					>
						Menunggu ({countDiajukan})
					</button>
					<button
						class="px-3.5 py-2 rounded-xl transition-all shrink-0 {activeTab === 'disetujui' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 hover:bg-slate-200'}"
						onclick={() => (activeTab = 'disetujui')}
					>
						Disetujui ({countDisetujui})
					</button>
					<button
						class="px-3.5 py-2 rounded-xl transition-all shrink-0 {activeTab === 'aktif' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 hover:bg-slate-200'}"
						onclick={() => (activeTab = 'aktif')}
					>
						Berjalan ({countAktif})
					</button>
					<button
						class="px-3.5 py-2 rounded-xl transition-all shrink-0 {activeTab === 'selesai' ? 'bg-slate-700 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 hover:bg-slate-200'}"
						onclick={() => (activeTab = 'selesai')}
					>
						Selesai ({countSelesai})
					</button>
					<button
						class="px-3.5 py-2 rounded-xl transition-all shrink-0 {activeTab === 'batal' ? 'bg-rose-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 hover:bg-slate-200'}"
						onclick={() => (activeTab = 'batal')}
					>
						Ditolak / Batal
					</button>
				</div>

				<!-- Search Input -->
				<div class="relative min-w-[240px]">
					<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Cari booking, tujuan, plat..."
						class="w-full pl-9 pr-4 py-2 rounded-xl text-xs bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-slate-100"
					/>
				</div>
			</div>

			<!-- Booking Cards List -->
			{#if filteredBookings.length === 0}
				<div class="py-16 text-center">
					<div class="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-400">
						<IconCar size={26} />
					</div>
					<h4 class="text-sm font-bold" style="color: var(--sys-label)">Tidak Ada Data Pengajuan</h4>
					<p class="text-xs mt-1" style="color: var(--sys-label3)">
						{searchQuery ? 'Tidak ada pengajuan yang cocok dengan pencarian Anda.' : 'Anda belum memiliki riwayat pengajuan peminjaman pada tab ini.'}
					</p>
					{#if !searchQuery}
						<button
							class="mt-4 px-4 py-2 rounded-xl text-xs font-bold text-white gradient-bg shadow-sm"
							onclick={() => openCreateForm()}
						>
							+ Ajukan Peminjaman Sekarang
						</button>
					{/if}
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					{#each filteredBookings as b (b.id)}
						{@const st = getStatusConfig(b.status)}
						<div class="p-4 md:p-5 rounded-2xl border transition-all hover:shadow-md bg-white/60 dark:bg-slate-900/60 relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4" style="border-color: var(--sys-sep)">
							<div class="flex-1">
								<div class="flex items-center gap-2 flex-wrap mb-2">
									<span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border flex items-center gap-1 {st.bg} {st.text} {st.border}">
										<st.icon size={12} />
										{st.label}
									</span>
									{#if pendingP2H(b)}
										<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200" title="P2H Anda tersimpan di HP dan terkirim otomatis saat ada sinyal. Anda tidak perlu mengisi ulang.">Menunggu terkirim</span>
									{/if}
									<span class="font-mono text-xs font-bold text-slate-500 dark:text-slate-400">{b.kode_booking}</span>
									{#if b.butuh_kendaraan === false}
										<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Tanpa Kendaraan</span>
									{/if}
									<span class="text-xs" style="color: var(--sys-label3)">·</span>
									<span class="text-[11px] font-medium" style="color: var(--sys-label3)">Diajukan {formatDateTime(b.date_created)}</span>
								</div>

								<div class="flex items-start gap-2 mb-2">
									<IconMapPin size={18} class="text-rose-500 shrink-0 mt-0.5" />
									<div>
										<h3 class="text-sm md:text-base font-extrabold" style="color: var(--sys-label)">
											{b.tujuan}
										</h3>
										{#if b.keperluan}
											<p class="text-xs mt-0.5 font-medium" style="color: var(--sys-label3)">
												Keperluan: <span style="color: var(--sys-label)">{b.keperluan}</span>
											</p>
										{/if}
									</div>
								</div>

								<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-y-1.5 gap-x-4 text-xs mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80" style="color: var(--sys-label3)">
									<div class="flex items-center gap-1.5">
										<IconCalendar size={14} class="text-blue-500 shrink-0" />
										<span>Mulai: <strong style="color: var(--sys-label)">{formatDateTime(b.tanggal_mulai)}</strong></span>
									</div>
									<div class="flex items-center gap-1.5">
										<IconClock size={14} class="text-amber-500 shrink-0" />
										<span>Rencana Selesai: <strong style="color: var(--sys-label)">{formatDateTime(b.tanggal_selesai_rencana)}</strong></span>
									</div>
									<div class="flex items-center gap-1.5">
										<IconCar size={14} class="text-emerald-500 shrink-0" />
										<span>
											Unit: <strong style="color: var(--sys-label)">{b.vehicle?.name ? `${b.vehicle.name} (${b.vehicle.nomor_polisi})` : (b.status === 'diajukan' ? 'Menunggu GA' : 'Tidak Ditentukan')}</strong>
										</span>
									</div>
									<div class="flex items-center gap-1.5">
										<IconSteeringWheel size={14} class="text-purple-500 shrink-0" />
										<span>
											Driver: <strong style="color: var(--sys-label)">{b.butuh_driver ? (b.driver?.nama ? b.driver.nama : 'Perlu Driver (Menunggu GA)') : 'Bawa Sendiri (Self-drive)'}</strong>
										</span>
									</div>
									{#if b.status === 'ditolak'}
										<div class="flex items-start gap-1.5 text-rose-700 dark:text-rose-400">
											<IconAlertTriangle size={14} class="shrink-0 mt-0.5" />
											<span class="font-semibold">{teksDitolak(b)}</span>
										</div>
									{/if}
									{#if b.approver}
										<div class="flex items-center gap-1.5">
											<IconShieldCheck size={14} class="text-teal-500 shrink-0" />
											<span>Review: <strong style="color: var(--sys-label)">{b.approver}</strong></span>
										</div>
									{/if}
								</div>
							</div>

							<!-- Action Buttons (Peminjaman 11 §3.10: tombol ≥44px di layar kecil; "Batalkan" didorong ke kanan, jauh dari "Mulai Pakai") -->
							<div class="aksi-kartu flex items-center gap-2 shrink-0 self-end md:self-center flex-wrap w-full md:w-auto">
								{#if b.status === 'disetujui' && sudahLewatJadwal(b) && !pendingP2H(b)}
									<!-- Peminjaman 05 §3.4 — booking disetujui yang terlupa: jangan biarkan menggantung (mengunci kuota/unit) -->
									<p class="w-full text-[11px] font-semibold p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
										Jadwal sudah lewat. Masih akan dipakai? Ketuk <strong>Mulai Pakai</strong>, atau <strong>Batalkan</strong> bila tidak jadi (booking yang tidak dipakai akan dibatalkan otomatis).
									</p>
								{/if}
								{#if waLink(b.driver?.no_telepon) && (b.status === 'disetujui' || b.status === 'aktif')}
									<a
										href={waLink(b.driver?.no_telepon)}
										target="_blank"
										rel="noreferrer"
										class="p-2.5 rounded-xl border border-green-200 dark:border-green-800/40 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 hover:bg-green-100 flex items-center gap-1 text-xs font-bold transition-transform hover:scale-105"
										title="WhatsApp Driver: {b.driver.nama}"
									>
										<IconBrandWhatsapp size={16} />
										<span class="hidden sm:inline">Chat Driver</span>
									</a>
								{/if}

								<button
									class="px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors"
									onclick={() => (selectedBooking = b)}
								>
									<IconEye size={15} />
									<span>Detail & Tracking</span>
								</button>

								{#if b.status === 'disetujui' && !b.vehicle_id && b.butuh_kendaraan !== false}
									<div class="w-full order-last p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-[12px] text-amber-800 dark:text-amber-300">
										Disetujui, tetapi unit belum ditetapkan GA. Hubungi GA agar unit segera ditentukan.
										{#if meta?.kontak_ga_wa}
											<a href="https://wa.me/{meta.kontak_ga_wa}" target="_blank" rel="noreferrer" class="font-bold underline">Chat GA</a>
										{/if}
									</div>
								{/if}

								{#if b.status === 'disetujui' && b.vehicle_id && b.butuh_kendaraan !== false}
									<button
										class="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5 transition-colors"
										onclick={() => bukaChecklist(b, 'tahap=sebelum')}
									>
										<IconSteeringWheel size={15} />
										<span>Mulai Pakai</span>
									</button>
									{#if sudahLewatJadwal(b)}
										<!-- Peminjaman 08 §3.7 — jalan keluar bila sudah berangkat tanpa P2H: booking tetap bisa ditutup -->
										<button
											class="px-3.5 py-2 rounded-xl text-xs font-bold border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 flex items-center gap-1.5 transition-colors"
											title="Pilih ini bila Anda sudah memakai kendaraan tanpa mengisi P2H sebelum pakai. Anda langsung mengisi pengembalian; kejadian ini ditandai untuk GA."
											onclick={() => bukaChecklist(b, 'tahap=setelah&lupa_sebelum=1')}
										>
											<span>Saya sudah terlanjur berangkat</span>
										</button>
									{/if}
								{/if}

								{#if perluCheckinLokasi(b)}
									<button
										class="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5 transition-colors"
										onclick={() => goto(`/site-checkin?booking=${b.id}`)}
									>
										<IconMapPin size={15} />
										<span>Check-in di Lokasi</span>
									</button>
								{:else if sudahCheckinLokasi(b)}
									<span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">✓ Sudah check-in</span>
								{/if}

								{#if b.status === 'aktif' && b.butuh_kendaraan !== false}
									<button
										class="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors {perluCheckinLokasi(b) ? 'border border-emerald-300 text-emerald-800 bg-white/70 hover:bg-emerald-50' : 'text-white bg-emerald-600 hover:bg-emerald-700'}"
										onclick={() => bukaChecklist(b, 'tahap=setelah')}
									>
										<IconCircleCheck size={15} />
										<span>Kembalikan Kendaraan</span>
									</button>
									{#if perluCheckinLokasi(b)}
										<p class="w-full text-[11px] font-medium text-amber-700">Check-in dulu di lokasi — tanpa check-in pengembalian bisa ditolak.</p>
									{/if}
								{/if}

								<!-- Fase 2 — kunjungan tanpa kendaraan: langsung ke site check-in -->
								{#if b.butuh_kendaraan === false && b.status === 'disetujui'}
									<button
										class="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5 transition-colors"
										onclick={() => goto(`/site-checkin?booking=${b.id}`)}
									>
										<IconMapPin size={15} />
										<span>Mulai Kunjungan</span>
									</button>
								{/if}
								{#if b.butuh_kendaraan === false && b.status === 'aktif'}
									<button
										class="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1.5 transition-colors"
										onclick={() => goto('/site-checkin')}
									>
										<IconCircleCheck size={15} />
										<span>Selesaikan Kunjungan</span>
									</button>
								{/if}

								{#if b.status === 'ditolak'}
									<button
										class="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5 transition-colors"
										onclick={() => ajukanUlang(b)}
										title="Buka form dengan data pengajuan ini; tanggal diisi ulang"
									>
										<IconRefresh size={15} />
										<span>Ajukan Ulang</span>
									</button>
								{/if}

								{#if b.status === 'diajukan' || b.status === 'disetujui'}
									<button
										class="ml-auto px-3 py-2 rounded-xl text-xs font-bold border border-rose-200 dark:border-rose-900/30 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 flex items-center gap-1 transition-colors"
										onclick={() => confirmCancelBooking(b)}
									>
										<IconTrash size={14} />
										<span class="hidden sm:inline">Batalkan</span>
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- ========================================================================= -->
<!-- MODAL: FORM PENGAJUAN PEMINJAMAN KENDARAAN                                 -->
<!-- ========================================================================= -->
{#if showModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
		<div class="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
			<div class="flex items-center justify-between pb-4 mb-4 border-b border-slate-100 dark:border-slate-800">
				<div>
					<h3 class="text-lg font-extrabold text-slate-900 dark:text-slate-100">{judulForm}</h3>
					<p class="text-xs font-medium text-slate-500 dark:text-slate-400">Isi formulir pengajuan armada operasional kantor</p>
				</div>
				<button
					class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
					onclick={closeForm}
				>
					<IconX size={18} />
				</button>
			</div>

			{#if submitSuccess}
				<div class="py-12 text-center">
					<div class="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center mx-auto mb-4 text-emerald-600">
						<IconCircleCheck size={36} />
					</div>
					<h4 class="text-base font-bold text-emerald-700 dark:text-emerald-400">Pengajuan Berhasil Terkirim!</h4>
					<p class="text-xs mt-1 text-slate-500 dark:text-slate-400">Pengajuan Anda sedang diproses oleh Tim HRD & General Affairs.</p>
					{#if submitWarning}
						<div class="mt-3 mx-auto max-w-sm p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2 text-left">
							<IconAlertTriangle size={15} class="shrink-0 text-amber-600 mt-0.5" />
							<span>{submitWarning}</span>
						</div>
					{/if}
				</div>
			{:else}
				{#if draftRestored}
					<div class="p-2.5 mb-3 rounded-xl text-[11px] font-medium bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/30 text-blue-700 dark:text-blue-300">
						Draf terakhir dipulihkan — isian Anda tidak hilang.
					</div>
				{/if}
				{#if metaError}
					<div class="p-2.5 mb-3 rounded-xl text-[11px] font-medium bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2">
						<span>Data pendukung gagal dimuat — {metaError}</span>
						<button type="button" class="font-bold underline shrink-0" onclick={reloadMeta}>Muat Ulang</button>
					</div>
				{/if}
				{#if networkPending}
					<div class="p-3 mb-4 rounded-xl text-xs font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40">
						Belum pasti terkirim karena sinyal. <strong>Jangan isi ulang.</strong> Tekan <strong>Kirim Lagi</strong> — sistem otomatis mencegah pengajuan ganda.
					</div>
				{/if}
				{#if submitError}
					<div class="p-3 mb-4 rounded-xl text-xs font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40 flex items-start gap-2">
						<IconAlertTriangle size={16} class="shrink-0 mt-0.5" />
						<span>{submitError}</span>
					</div>
				{/if}

				<form onsubmit={(e) => { e.preventDefault(); handleFormSubmit(); }} class="space-y-4">
					<!-- Tujuan -->
					<div>
						<label class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">
							Mau ke mana? <span class="text-rose-500">*</span>
						</label>
						<input
							type="text"
							bind:value={formTujuan}
							placeholder="Cth: Proyek Cikarang / ambil dokumen supplier"
							class="w-full px-3.5 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
							required
						/>
						<FieldHint text={h('kendaraan.form.tujuan').fieldHint} type={h('kendaraan.form.tujuan').type} />
					</div>

					<!-- Pilihan waktu cepat (Peminjaman 07 §3.6) -->
					<div>
						<div class="flex flex-wrap gap-2">
							<button type="button" class="px-3 py-1.5 rounded-full text-[11px] font-bold border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 disabled:opacity-40" onclick={() => pakaiChip('segera')}>Sekarang +{minJam} jam</button>
							<button type="button" class="px-3 py-1.5 rounded-full text-[11px] font-bold border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 disabled:opacity-40" disabled={chipDisabled('siang')} onclick={() => pakaiChip('siang')}>Nanti siang 13:00</button>
							<button type="button" class="px-3 py-1.5 rounded-full text-[11px] font-bold border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 disabled:opacity-40" disabled={chipDisabled('besok')} onclick={() => pakaiChip('besok')}>Besok pagi 08:00</button>
						</div>
						<FieldHint text="Ketuk salah satu, lalu ubah bila perlu. Rencana kembali terisi otomatis +4 jam." />
						<FieldHint text={h('kendaraan.form.waktu').fieldHint} />
					</div>

					<!-- 2. Kapan berangkat? -->
					<div>
						<label class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">
							Kapan berangkat? <span class="text-rose-500">*</span>
						</label>
						<input
							type="datetime-local"
							bind:value={formTanggalMulai}
							class="w-full px-3 py-3 rounded-xl text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
							required
						/>
					</div>

					{#if !isLeadTimeValid}
						<div class="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
							<IconAlertTriangle size={16} class="shrink-0 text-amber-600 mt-0.5" />
							<span>
								Pengajuan wajib minimal <strong>{meta?.settings?.minimal_pengajuan_jam_sebelum ?? 1} jam</strong> sebelum waktu keberangkatan.
								{#if leadTimeHours <= 0}
									Waktu berangkat sudah lewat.
								{:else if leadTimeHours < 1}
									Saat ini hanya ± <strong>{Math.round(leadTimeHours * 60)} menit</strong> lagi.
								{:else}
									Saat ini hanya ± <strong>{leadTimeHours.toFixed(1)} jam</strong> lagi.
								{/if}
								Geser waktu berangkat agar tombol Ajukan aktif.
							</span>
						</div>
					{/if}

					{#if !sembunyikanKendaraan}
					<!-- 3. Perlu sopir? — dua tombol besar, TANPA default: wajib dipilih (tidak ada lagi "Perlu Driver" tanpa sengaja) -->
					<div>
						<p class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">Perlu sopir? <span class="text-rose-500">*</span></p>
						<div class="grid grid-cols-2 gap-2">
							<button type="button" aria-pressed={formButuhDriver === true} class="min-h-[56px] px-3 rounded-2xl border-2 text-sm font-bold transition-colors {formButuhDriver === true ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'}" onclick={() => (formButuhDriver = true)}>Ya, minta sopir</button>
							<button type="button" aria-pressed={formButuhDriver === false} class="min-h-[56px] px-3 rounded-2xl border-2 text-sm font-bold transition-colors {formButuhDriver === false ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'}" onclick={() => (formButuhDriver = false)}>Tidak, saya nyetir sendiri</button>
						</div>
						<FieldHint text={h('kendaraan.form.driver').fieldHint} />
						{#if formButuhDriver === true}
							<p class="text-[11px] mt-1 text-slate-500 dark:text-slate-400">Admin GA akan menugaskan sopir resmi untuk perjalanan ini.</p>
						{:else if formButuhDriver === false}
							<p class="text-[11px] mt-1 text-slate-500 dark:text-slate-400">Anda mengemudi sendiri — wajib punya SIM aktif.</p>
						{/if}
						<p class="text-[11px] leading-snug text-slate-500 dark:text-slate-400 mt-2">
							Pakai kendaraan pribadi &amp; mau klaim bensin/tol? Tidak perlu mengajukan di sini — langsung catat di menu <strong>Biaya Lapangan</strong> setelah check-in di lokasi.
							<a href="/biaya-lapangan" class="font-semibold text-blue-600 dark:text-blue-400 underline">Buka Biaya Lapangan</a>
						</p>
					</div>
					{/if}

					<!-- 4. Jenis perjalanan — 4 kartu ikon (bukan dropdown) -->
					<div>
						<p class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">Jenis perjalanan</p>
						<div class="grid grid-cols-2 gap-2">
							{#each JENIS_KARTU as k (k.value)}
								<button type="button" aria-pressed={jenisKartuAktif === k.value} class="min-h-[64px] px-3 py-2 rounded-2xl border-2 text-left flex items-center gap-2.5 transition-colors {jenisKartuAktif === k.value ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}" onclick={() => (formTipeKeperluan = k.value)}>
									<k.icon size={22} class="shrink-0 {jenisKartuAktif === k.value ? 'text-blue-600' : 'text-slate-400'}" />
									<span>
										<span class="block text-sm font-bold text-slate-800 dark:text-slate-100">{k.label}</span>
										<span class="block text-[11px] text-slate-500 dark:text-slate-400">{k.ket}</span>
									</span>
								</button>
							{/each}
						</div>
						<FieldHint text={h('kendaraan.form.tipe_keperluan').fieldHint} />
					</div>

					{#if formTipeKeperluan === 'site_visit'}
						<!-- Fase 1 — Kategori Kunjungan -->
						<div>
							<label class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">
								Kategori Kunjungan <span class="text-rose-500">*</span>
							</label>
							<select
								bind:value={formKategoriKunjungan}
								onchange={handleKategoriChange}
								class="w-full px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
							>
								<option value="">{visitCategories.length === 0 && metaError ? '— Gagal dimuat, ketuk Muat Ulang di atas —' : '— Pilih jenis kunjungan —'}</option>
								{#each visitCategories as c}
									<option value={c.kode}>{c.label}</option>
								{/each}
							</select>
							<FieldHint text="Pilih jenis kunjungan. Zona terisi otomatis; ubah bila lokasi sebenarnya berbeda — zona luar kota butuh 1 persetujuan tambahan." />
						</div>

						<!-- Fase 1 — Zona -->
						<div>
							<label class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">
								Zona Perjalanan <span class="text-rose-500">*</span>
							</label>
							<select
								bind:value={formZona}
								class="w-full px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
							>
								<option value="">— Pilih zona —</option>
								<option value="dalam_kota">{labelZonaDalam}</option>
								<option value="luar_kota">{labelZonaLuar}</option>
							</select>
							{#if formZona === 'luar_kota'}
								<p class="text-[11px] mt-1 text-amber-700 dark:text-amber-400 flex items-start gap-1">
									<IconInfoCircle size={13} class="shrink-0 mt-0.5" />
									Zona luar kota memerlukan 1 tahap persetujuan tambahan, jadi proses persetujuan lebih lama.
								</p>
							{/if}
						</div>

						<!-- Proyek Tujuan (wajib tergantung kategori) -->
						<div>
							<label class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">
								Proyek Tujuan
								{#if selectedCategory?.wajib_project}<span class="text-rose-500">*</span>{:else}<span class="font-normal text-slate-500 dark:text-slate-400">(opsional)</span>{/if}
							</label>
							<select
								bind:value={formProjectId}
								class="w-full px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
							>
								<option value="">— Pilih proyek —</option>
								{#each myProjects as p}
									<option value={p.id}>{p.name}{p.peran === 'kunjungan' ? ' (Kunjungan)' : ''}</option>
								{/each}
							</select>
							<FieldHint text={h('kendaraan.form.proyek').fieldHint} />
						</div>

						{#if selectedCategory?.wajib_customer}
							<p class="text-[11px] -mt-1 text-blue-700 dark:text-blue-400 flex items-start gap-1">
								<IconInfoCircle size={13} class="shrink-0 mt-0.5" />
								Cantumkan nama customer pada kolom "Tujuan Perjalanan" atau "Keperluan / Agenda Tugas" di atas.
							</p>
						{/if}

						<!-- Fase 2 — Perlu kendaraan perusahaan? -->
						<div class="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
							<label class="flex items-center gap-3 cursor-pointer">
								<input
									type="checkbox"
									bind:checked={formButuhKendaraan}
									class="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
								/>
								<div>
									<p class="text-xs font-bold text-slate-800 dark:text-slate-200">Perlu kendaraan perusahaan</p>
									<p class="text-[11px] text-slate-500 dark:text-slate-400">
										{formButuhKendaraan
											? 'Unit & driver akan ditetapkan Admin GA; wajib P2H sebelum & sesudah pakai.'
											: 'Saya pakai kendaraan sendiri / ojek. Tidak ada unit, driver, atau P2H — cukup check-in di lokasi.'}
									</p>
								</div>
							</label>
						</div>
					{/if}

					<!-- Peminjaman 06 K9 — petunjuk: kunjungan tanpa kendaraan tidak ada uang muka -->
					{#if sembunyikanKendaraan && (Number(meta?.settings?.advance_aktif) === 1 || meta?.settings?.advance_aktif === true)}
						<p class="text-[11px] text-slate-500 dark:text-slate-400">
							Kunjungan tanpa kendaraan tidak mendapat uang muka. Biaya yang Anda keluarkan sendiri diklaim lewat menu Biaya Lapangan.
						</p>
					{/if}

					<!-- ESS Redesign Fase 2 — Uang Muka Operasional (Cash Advance) -->
					{#if advanceEnabled}
						<div class="p-3 rounded-xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/60 dark:bg-emerald-950/20 space-y-3">
							<label class="flex items-start gap-3 cursor-pointer">
								<input
									type="checkbox"
									bind:checked={formAdvanceDiminta}
									class="w-4 h-4 mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
								/>
								<div>
									<p class="text-xs font-bold text-slate-800 dark:text-slate-200">Butuh Uang Muka Operasional</p>
									<p class="text-[11px] text-slate-500 dark:text-slate-400">
										Dana BBM / E-Toll / parkir. Diproses otomatis setelah peminjaman disetujui — ambil uangnya ke Kasir Kas Kecil. Simpan semua struk untuk LPJ (bukan lewat Biaya Lapangan); sisa dana dikembalikan ke kasir.
									</p>
								</div>
							</label>

							{#if formAdvanceDiminta}
								<div class="grid grid-cols-3 gap-2">
									<div>
										<label class="block text-[11px] font-bold mb-1 text-slate-700 dark:text-slate-300">Estimasi BBM (Rp)</label>
										<input
											type="number" min="0" step="1000" inputmode="numeric"
											bind:value={formAdvBbm}
											placeholder="200000"
											class="w-full px-2.5 py-2 rounded-lg text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
										/>
									</div>
									<div>
										<label class="block text-[11px] font-bold mb-1 text-slate-700 dark:text-slate-300">Estimasi E-Toll (Rp)</label>
										<input
											type="number" min="0" step="1000" inputmode="numeric"
											bind:value={formAdvTol}
											placeholder="100000"
											class="w-full px-2.5 py-2 rounded-lg text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
										/>
									</div>
									<div>
										<label class="block text-[11px] font-bold mb-1 text-slate-700 dark:text-slate-300">Parkir / Lain (Rp)</label>
										<input
											type="number" min="0" step="1000" inputmode="numeric"
											bind:value={formAdvLain}
											placeholder="50000"
											class="w-full px-2.5 py-2 rounded-lg text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
										/>
									</div>
								</div>
								<div class="flex items-center justify-between text-xs font-bold text-emerald-800 dark:text-emerald-300 pt-1 border-t border-emerald-200/70 dark:border-emerald-800/40">
									<span>Total Uang Muka Diajukan</span>
									<span>Rp {advTotal.toLocaleString('id-ID')}</span>
								</div>
								{#if advTotal <= 0}
									<p class="text-[11px] text-rose-600 dark:text-rose-400">Isi minimal salah satu estimasi.</p>
								{/if}
							{/if}
						</div>
					{/if}

					<!-- Opsi lanjutan: isian jarang dipakai disembunyikan supaya form default cukup 4 hal -->
					<details bind:open={opsiLanjutOpen} class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40">
						<summary class="cursor-pointer select-none px-4 py-3 min-h-[48px] flex items-center text-sm font-bold text-slate-700 dark:text-slate-200">Opsi lanjutan (agenda, unit, kembali, catatan)</summary>
						<div class="px-4 pb-4 space-y-4">
					<!-- Keperluan -->
					<div>
						<label class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">
							Keperluan / Agenda Tugas
						</label>
						<input
							type="text"
							bind:value={formKeperluan}
							placeholder="Cth: Meeting koordinasi lapangan & serah terima invoice"
							class="w-full px-3.5 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
						/>
					</div>


						<!-- Rencana kembali (default +4 jam / sesuai chip) -->
						<div>
							<label class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">Rencana Kembali</label>
							<input
								type="datetime-local"
								bind:value={formTanggalSelesai}
								class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
							/>
							<FieldHint text="Terisi otomatis +4 jam dari waktu berangkat. Ubah bila perjalanan lebih lama." />
						</div>

					<!-- Duration Indicator -->
					<div class="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/30 flex items-center justify-between text-xs">
						<span class="font-medium text-blue-700 dark:text-blue-300">Estimasi Durasi Peminjaman:</span>
						<strong class="font-extrabold text-blue-800 dark:text-blue-200">{durationText || '-'}</strong>
					</div>


					<!-- Tipe Keperluan -->
					<div>
						<label class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">
							Jenis keperluan rinci
						</label>
						<select
							bind:value={formTipeKeperluan}
							class="w-full px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
						>
							{#each TIPE_KEPERLUAN_OPTIONS as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
						<div class="flex items-center gap-1.5">
							<FieldHint text={h('kendaraan.form.tipe_keperluan').fieldHint} />
							{#if h('kendaraan.form.tipe_keperluan').helpIcon}
								<HelpIcon text={h('kendaraan.form.tipe_keperluan').helpIcon} />
							{/if}
						</div>
					</div>


					{#if !sembunyikanKendaraan}
					<!-- Preferensi Kendaraan -->
					<div>
						<label class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">
							Preferensi Unit Kendaraan (Opsional)
						</label>
						<select
							bind:value={formVehicleId}
							class="w-full px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
						>
							<option value="">— Tidak ada preferensi (Biar Admin GA yang tentukan unit terbaik) —</option>
							{#each meta?.vehicles || [] as v}
								<option value={v.id}>
									{v.name} ({v.plat}) — {v.kapasitas} Penumpang [{v.status}]
								</option>
							{/each}
						</select>
						<div class="flex items-center gap-1.5">
							<FieldHint text={h('kendaraan.form.kendaraan').fieldHint} />
							{#if h('kendaraan.form.kendaraan').helpIcon}
								<HelpIcon text={h('kendaraan.form.kendaraan').helpIcon} />
							{/if}
						</div>

						{#if checkingBentrok}
							<p class="text-[11px] mt-1.5 text-slate-500 dark:text-slate-400">Mengecek jadwal unit...</p>
						{:else if bentrokBlocks.length > 0}
							<div class="mt-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-[11px] text-amber-800 dark:text-amber-300">
								<div class="flex items-start gap-2 mb-1">
									<IconAlertTriangle size={16} class="shrink-0 text-amber-600 mt-0.5" />
									<span class="font-bold">Unit ini punya jadwal beririsan:</span>
								</div>
								<ul class="pl-6 list-disc space-y-0.5">
									{#each bentrokBlocks as bl}
										<li>{bl.label}</li>
									{/each}
								</ul>
								<FieldHint text={h('kendaraan.bentrok').fieldHint} />
								<button type="button" class="mt-2 px-3 py-2 rounded-lg text-[12px] font-bold bg-white border border-amber-300 text-amber-800 min-h-[40px]" onclick={() => (formVehicleId = '')}>
									Kosongkan pilihan unit
								</button>
							</div>
						{/if}
					</div>


					{/if}
					<!-- Catatan / Muatan Tambahan -->
					<div>
						<label class="block text-xs font-bold mb-1 text-slate-800 dark:text-slate-200">
							Catatan / Muatan Tambahan (Opsional)
						</label>
						<textarea
							bind:value={formCatatan}
							rows={2}
							placeholder="Cth: Membawa 3 dus sample material berat ±30kg"
							class="w-full px-3.5 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
						></textarea>
					</div>




						</div>
					</details>

					<!-- Form Actions -->
					<div class="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 pt-4 pb-1 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
						{#if alasanBlokir}
							<p class="w-full text-[12px] font-semibold text-amber-700 dark:text-amber-400 text-right">Belum bisa dikirim: {alasanBlokir}</p>
						{/if}
						<div class="mr-auto"><DraftIndicator savedAt={draftSavedAt} /></div>
						<button
							type="button"
							class="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300"
							onclick={closeForm}
						>
							Batal
						</button>
						<button
							type="submit"
							disabled={!canSubmit || submitting}
							class="px-6 py-2.5 rounded-xl text-xs font-bold text-white gradient-bg shadow-md disabled:opacity-50 flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all"
						>
							{#if submitting}
								<IconLoader2 size={16} class="animate-spin" />
								<span>Mengirim Pengajuan...</span>
							{:else if networkPending}
								<span>Kirim Lagi</span>
							{:else}
								<span>{labelKirim}</span>
							{/if}
						</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{/if}

<!-- ========================================================================= -->
<!-- MODAL: DETAIL & STATUS TRACKING                                            -->
<!-- ========================================================================= -->
{#if selectedBooking}
	{@const st = getStatusConfig(selectedBooking.status)}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
		<div class="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
			<div class="flex items-center justify-between pb-4 mb-4 border-b border-slate-100 dark:border-slate-800">
				<div>
					<span class="font-mono text-xs font-bold text-slate-400">{selectedBooking.kode_booking}</span>
					<h3 class="text-base font-extrabold mt-0.5 text-slate-900 dark:text-slate-100">Detail Peminjaman Kendaraan</h3>
				</div>
				<button
					class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
					onclick={() => (selectedBooking = null)}
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Status Header Box -->
			<div class="p-4 rounded-2xl border mb-5 {st.bg} {st.border} flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-white/80 dark:bg-slate-900/80 flex items-center justify-center {st.text}">
						<st.icon size={22} />
					</div>
					<div>
						<p class="text-[11px] font-bold uppercase tracking-wider text-slate-500">Status Pengajuan</p>
						<p class="text-sm font-extrabold {st.text}">{st.label}</p>
					</div>
				</div>
				{#if selectedBooking.status === 'diajukan' || selectedBooking.status === 'disetujui'}
					<button
						class="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 text-white shadow-sm hover:bg-rose-700"
						onclick={() => {
							const b = selectedBooking;
							selectedBooking = null;
							if (b) confirmCancelBooking(b);
						}}
					>
						Batalkan
					</button>
				{/if}
			</div>

			<!-- Tahapan (Peminjaman 11 §3.2): jumlah & nama tahap mengikuti approval NYATA; penolakan menyebut siapa + alasan -->
			<div class="mb-5 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
				<p class="text-xs font-bold mb-3 text-slate-800 dark:text-slate-200">Tahapan Peminjaman</p>
				<div class="space-y-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
					{#each buildSteps(selectedBooking, formatDateTime, selectedBooking.date_created, selectedBooking.tanggal_approve) as stp, i (stp.key)}
						<div class="flex items-start gap-3 relative">
							<div class="w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10 {stp.state === 'done' ? 'bg-emerald-500 text-white' : stp.state === 'rejected' ? 'bg-rose-500 text-white' : stp.state === 'current' ? 'bg-amber-400 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'}">
								{#if stp.icon === 'x'}<IconX size={14} />{:else if stp.icon === 'wheel'}<IconSteeringWheel size={14} />{:else if stp.icon === 'pin'}<IconMapPin size={14} />{:else if stp.state === 'done' || stp.icon === 'check'}<IconCircleCheck size={14} />{:else}<IconClock size={14} />{/if}
							</div>
							<div>
								<p class="text-[13px] font-bold text-slate-800 dark:text-slate-200">{i + 1}. {stp.label}</p>
								<p class="text-xs {stp.state === 'rejected' ? 'text-rose-600 font-semibold' : 'text-slate-500 dark:text-slate-400'}">{stp.detail}</p>
							</div>
						</div>
					{/each}
				</div>
				{#if selectedBooking.status === 'ditolak'}
					<button class="mt-4 w-full py-3 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700" onclick={() => selectedBooking && ajukanUlang(selectedBooking)}>
						Ajukan Ulang
					</button>
				{/if}
			</div>

			<!-- Information Grid -->
			<div class="space-y-3 text-xs">
				<div class="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
					<p class="text-[11px] font-bold text-slate-400 mb-1">Tujuan & Agenda</p>
					<p class="font-bold text-sm text-slate-900 dark:text-slate-100">{selectedBooking.tujuan}</p>
					{#if selectedBooking.keperluan}
						<p class="mt-1 text-slate-600 dark:text-slate-300">{selectedBooking.keperluan}</p>
					{/if}
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div class="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
						<p class="text-[11px] font-bold text-slate-400 mb-1">Waktu Berangkat</p>
						<p class="font-bold text-slate-900 dark:text-slate-100">{formatDateTime(selectedBooking.tanggal_mulai)}</p>
					</div>
					<div class="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
						<p class="text-[11px] font-bold text-slate-400 mb-1">Rencana Kembali</p>
						<p class="font-bold text-slate-900 dark:text-slate-100">{formatDateTime(selectedBooking.tanggal_selesai_rencana)}</p>
					</div>
				</div>

				<!-- Assigned Vehicle -->
				<div class="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
					<div>
						<p class="text-[11px] font-bold text-slate-400">Unit Kendaraan Ditugaskan</p>
						{#if selectedBooking.vehicle}
							<p class="font-bold text-sm mt-0.5 text-slate-900 dark:text-slate-100">
								{selectedBooking.vehicle.name} ({selectedBooking.vehicle.nomor_polisi})
							</p>
							<p class="text-[11px] mt-0.5 text-slate-500 dark:text-slate-400">
								{selectedBooking.vehicle.bahan_bakar} · {selectedBooking.vehicle.kapasitas} Penumpang
							</p>
						{:else}
							<p class="font-medium text-slate-500 dark:text-slate-400 mt-0.5">Belum ditentukan (akan ditetapkan oleh Admin GA)</p>
						{/if}
					</div>
					<div class="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center">
						<IconCar size={22} />
					</div>
				</div>

				<!-- Assigned Driver -->
				<div class="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
					<div>
						<p class="text-[11px] font-bold text-slate-400">Pengemudi / Driver</p>
						{#if selectedBooking.butuh_driver}
							{#if selectedBooking.driver}
								<p class="font-bold text-sm mt-0.5 text-slate-900 dark:text-slate-100">{selectedBooking.driver.nama}</p>
								{#if selectedBooking.driver.no_telepon}
									<a
										href="tel:{selectedBooking.driver.no_telepon}"
										class="text-[11px] text-blue-600 hover:underline flex items-center gap-1 mt-0.5"
									>
										<IconPhone size={12} /> {selectedBooking.driver.no_telepon}
									</a>
								{/if}
							{:else}
								<p class="font-medium text-slate-500 dark:text-slate-400 mt-0.5">Driver kantor akan ditugaskan saat approve</p>
							{/if}
						{:else}
							<p class="font-bold text-sm mt-0.5 text-slate-900 dark:text-slate-100">Mengemudi Sendiri (Self-Drive)</p>
							<p class="text-[11px] text-slate-500 dark:text-slate-400">Pemohon bertanggung jawab atas unit kendaraan</p>
						{/if}
					</div>
					<div class="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 flex items-center justify-center">
						<IconSteeringWheel size={22} />
					</div>
				</div>

				{#if selectedBooking.catatan}
					<div class="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
						<p class="text-[11px] font-bold text-slate-400 mb-1">Catatan</p>
						<p class="text-slate-800 dark:text-slate-200">{selectedBooking.catatan}</p>
					</div>
				{/if}

				<!-- ESS Redesign Fase 2 — Kartu Uang Muka Operasional -->
				{#if selectedBooking.advance_diminta}
					{@const advSt = selectedBooking.advance_status || 'none'}
					{@const advDiterima = Number(selectedBooking.advance_amount_disbursed || 0)}
					{@const advRealisasi =
						Number((selectedBooking as any).realisasi_bbm || 0) +
						Number((selectedBooking as any).realisasi_tol || 0) +
						Number((selectedBooking as any).realisasi_parkir || 0) +
						Number((selectedBooking as any).realisasi_lain || 0) +
						Number((selectedBooking as any).penyesuaian_manual || 0)}
					<div class="p-3 rounded-xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/60 dark:bg-emerald-950/20">
						<div class="flex items-center justify-between mb-2">
							<p class="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Uang Muka Operasional</p>
							<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
								{labelUangMuka(advSt).label}
							</span>
						</div>
						{#if labelUangMuka(advSt).hint}
							<p class="mb-2 text-[11px] text-slate-600 dark:text-slate-400">{labelUangMuka(advSt).hint}</p>
						{/if}
						<div class="grid grid-cols-3 gap-2 text-center">
							<div>
								<p class="text-[10px] text-slate-500 dark:text-slate-400">Diajukan</p>
								<p class="text-xs font-bold text-slate-800 dark:text-slate-200">Rp {Number(selectedBooking.advance_amount_requested || 0).toLocaleString('id-ID')}</p>
							</div>
							<div>
								<p class="text-[10px] text-slate-500 dark:text-slate-400">Diterima</p>
								<p class="text-xs font-bold text-slate-800 dark:text-slate-200">Rp {advDiterima.toLocaleString('id-ID')}</p>
							</div>
							<div>
								<p class="text-[10px] text-slate-500 dark:text-slate-400">Realisasi Struk</p>
								<p class="text-xs font-bold text-slate-800 dark:text-slate-200">Rp {advRealisasi.toLocaleString('id-ID')}</p>
							</div>
						</div>
						{#if advSt === 'dicairkan' && advDiterima > 0}
							<div class="mt-2 pt-2 border-t border-emerald-200/70 dark:border-emerald-800/40 flex items-center justify-between text-xs font-bold">
								<span class="text-slate-600 dark:text-slate-300">Sisa Saldo (perkiraan)</span>
								<span class={advDiterima - advRealisasi < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-300'}>
									Rp {(advDiterima - advRealisasi).toLocaleString('id-ID')}
								</span>
							</div>
						{/if}
						{#if advSt === 'ditolak' && selectedBooking.advance_alasan_tolak}
							<p class="mt-2 text-[11px] text-rose-600 dark:text-rose-400">Alasan: {selectedBooking.advance_alasan_tolak}</p>
						{/if}
						{#if selectedBooking.settlement_status && selectedBooking.settlement_status !== 'none'}
							{@const ss = selectedBooking.settlement_status}
							<div class="mt-2 pt-2 border-t border-emerald-200/70 dark:border-emerald-800/40">
								<p class="text-[11px] font-bold text-slate-600 dark:text-slate-300">
									Settlement:
									{ss === 'menunggu_setor_balik' ? `Ada sisa Rp ${Number(selectedBooking.settlement_selisih || 0).toLocaleString('id-ID')} — kembalikan ke Finance`
										: ss === 'menunggu_reimburse' ? `Dana pribadi terpakai Rp ${Math.abs(Number(selectedBooking.settlement_selisih || 0)).toLocaleString('id-ID')} — draf reimbursement dibuat otomatis`
										: ss === 'balanced' ? 'Pas / balanced — selesai'
										: ss === 'menunggu_struk_final' ? 'Menunggu struk disetujui — selisih dihitung otomatis setelah semua struk diputuskan'
										: ss === 'closed' ? 'Sudah ditutup & diaudit Finance' : '—'}
								</p>
								{#if ss === 'menunggu_setor_balik'}
									{#if selectedBooking.settlement_bukti_setor_balik_file}
										<p class="mt-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">✓ Bukti setor sudah diunggah — menunggu verifikasi Finance.</p>
									{:else}
										<p class="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">Transfer/setor sisa dana ke kasir Finance, lalu unggah bukti di sini.</p>
										<input
											type="file" accept="image/*,application/pdf"
											onchange={(e) => (setorFile = (e.currentTarget as HTMLInputElement).files?.[0] || null)}
											class="mt-1.5 w-full text-[11px] text-slate-600 dark:text-slate-400"
										/>
										{#if setorErr}<p class="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{setorErr}</p>{/if}
										<button
											type="button"
											disabled={!setorFile || setorBusy}
											onclick={handleSetorBalik}
											class="mt-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 disabled:opacity-50"
										>
											{setorBusy ? 'Mengunggah…' : 'Unggah Bukti Setor Balik'}
										</button>
									{/if}
								{/if}
							</div>
						{/if}
						<p class="mt-2 text-[10px] text-slate-400">Struk BBM/E-Toll diinput lewat menu Biaya Lapangan selama perjalanan. Angka realisasi & sisa final dihitung saat perjalanan diselesaikan.</p>
					</div>
				{/if}
			</div>

			<div class="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
				<button
					class="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300"
					onclick={() => (selectedBooking = null)}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ========================================================================= -->
<!-- MODAL: KONFIRMASI PEMBATALAN                                               -->
<!-- ========================================================================= -->
{#if showCancelModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
		<div class="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
			<div class="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/50 text-rose-600 flex items-center justify-center mx-auto mb-4">
				<IconTrash size={24} />
			</div>
			<h4 class="text-base font-bold text-center mb-1 text-slate-900 dark:text-slate-100">Batalkan Pengajuan?</h4>
			<p class="text-xs text-center mb-4 text-slate-500 dark:text-slate-400">
				Apakah Anda yakin ingin membatalkan peminjaman kendaraan ini?
			</p>
			{#if cancelingBooking?.status === 'disetujui'}
				<p class="text-[11px] mb-3 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/30 text-blue-700 dark:text-blue-300">
					GA{cancelingBooking?.driver_id ? ' & sopir' : ''} akan diberi tahu otomatis, dan unit dilepas untuk peminjam lain.
				</p>
			{/if}
			{#if cancelError}
				<p class="text-[11px] mb-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-medium">{cancelError}</p>
			{/if}

			<div class="mb-4">
				<label class="block text-[11px] font-bold mb-1 text-slate-800 dark:text-slate-200">Alasan Pembatalan (Opsional)</label>
				<input
					type="text"
					bind:value={cancelReason}
					placeholder="Cth: Jadwal kunjungan ditunda"
					class="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
				/>
			</div>

			<div class="flex items-center gap-2">
				<button
					class="flex-1 py-2.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
					onclick={() => (showCancelModal = false)}
				>
					Kembali
				</button>
				<button
					class="flex-1 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm disabled:opacity-50"
					disabled={canceling}
					onclick={handleExecuteCancel}
				>
					{canceling ? 'Membatalkan...' : 'Ya, Batalkan'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Peminjaman 11 §3.10 — target sentuh ≥44px di HP; teks tombol lebih besar */
	@media (max-width: 640px) {
		.aksi-kartu :global(button),
		.aksi-kartu :global(a) {
			min-height: 44px;
			font-size: 0.875rem;
		}
	}
</style>
