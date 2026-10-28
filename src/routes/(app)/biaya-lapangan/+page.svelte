<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		IconLoader2,
		IconAlertTriangle,
		IconCheck,
		IconCamera,
		IconX,
		IconChevronLeft,
		IconSteeringWheel
	} from '@tabler/icons-svelte';
	import { getMyFleetBookings } from '$lib/services/ess/fleetBooking';
	import { auth } from '$lib/firebase';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { isBookingBeruangMuka, JENIS_DOBEL } from '$lib/utils/advanceDouble';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import {
		fetchMyVisits,
		getSiteCheckinSettings,
		type VisitPickerOption,
		type SiteCheckinSettings,
		type SiteCheckinRecord
	} from '$lib/services/siteCheckin';
	import { getQueuedSiteCheckinSubmissions } from '$lib/utils/offlineSiteCheckinQueue';
	import CheckoutDialog from '$lib/components/site-checkin/CheckoutDialog.svelte';
	import {
		enqueueBiayaLapangan,
		registerBiayaLapanganAutoFlush,
		flushBiayaLapanganQueue,
		type QueuedBiayaLapangan
	} from '$lib/utils/offlineBiayaLapanganQueue';
	import GateChecklistCard from '$lib/components/shared/GateChecklistCard.svelte';
	import { getActiveFleetExpenseTypes, type FleetExpenseTypeOption } from '$lib/services/fleetExpenseTypeApi';
	import KlaimLapanganSection from '$lib/components/biaya-lapangan/KlaimLapanganSection.svelte';

	interface GateResultView {
		key: string;
		status: 'passed' | 'failed' | 'not_applicable';
		mode: 'shadow' | 'soft' | 'hard';
		message: string;
		action?: { label: string; href: string };
	}

	type Mode = 'talangan' | 'proyek' | 'klaim';
	// R2 (Audit Konfigurabilitas Lifecycle, 16 Sep 2026): jenis biaya sekarang dinamis
	// (koleksi fleet_expense_type) — tipe dilonggarkan dari union tetap jadi string.
	// Perbandingan eksplisit (jenis === 'bbm' dst di bawah) tetap type-safe dan tetap
	// berlaku hanya untuk kode yang memang punya perilaku khusus (odometer, kendaraan).
	type Jenis = string;

	interface Proyek {
		id: number;
		name: string;
	}

	let JENIS_OPTIONS = $state<FleetExpenseTypeOption[]>([
		{ value: 'bbm', label: 'BBM', emoji: '⛽' },
		{ value: 'tol', label: 'Tol', emoji: '🛣️' },
		{ value: 'parkir', label: 'Parkir', emoji: '🅿️' },
		{ value: 'lain', label: 'Lain-lain', emoji: '📋' }
	]);
	$effect(() => {
		getActiveFleetExpenseTypes().then((opts) => {
			if (opts.length > 0) JENIS_OPTIONS = opts;
		});
	});

	// Form state
	let jenis = $state<Jenis>('bbm');
	let nominal = $state('');
	let catatan = $state('');
	// PRJ-29: dibuka dari tombol Keluar Uang di proyek -> mode Dana Proyek + proyek terpilih (?project_id=).
	const qpProject = typeof window !== 'undefined' ? Number(new URLSearchParams(window.location.search).get('project_id')) : 0;
	const qpValid = Number.isFinite(qpProject) && qpProject > 0;
	let mode = $state<Mode>(qpValid ? 'proyek' : 'talangan');
	let selectedProjectId = $state<number | null>(qpValid ? qpProject : null);
	let fotoFile = $state<File | null>(null);
	let fotoPreview = $state<string | null>(null);

	// Fase 4 v2 (9 Sep 2026): kendaraan perusahaan (opsional) — dibatasi ke yang
	// di-booking/ditugaskan (keputusan user 8 Sep 2026), pemicu G_P2H_UNIT_LAPANGAN.
	interface Kendaraan {
		id: number;
		label: string;
	}
	let kendaraanList = $state<Kendaraan[]>([]);
	let loadingKendaraan = $state(false);
	let selectedVehicleId = $state<number | null>(null);
	// Odometer + foto odometer — hanya relevan untuk jenis='bbm' (G_BUKTI_BBM).
	let odometer = $state('');
	let fotoOdometerFile = $state<File | null>(null);
	let fotoOdometerPreview = $state<string | null>(null);

	// Checklist gate hidup (Fase 4, Aturan #6) — dievaluasi ulang tiap field relevan
	// berubah, ditampilkan SEBELUM submit.
	let gateResults = $state<GateResultView[]>([]);
	let loadingGates = $state(false);
	let gatePreflightTimer: ReturnType<typeof setTimeout> | null = null;

	async function loadKendaraan() {
		loadingKendaraan = true;
		try {
			const res = await fetch('/api/fleet/my-vehicles', { headers: await authHeaders() });
			if (res.ok) {
				const data = await res.json();
				kendaraanList = data.vehicles || [];
			}
		} catch {
			// Gagal-lunak — picker tampil kosong, field kendaraan tetap opsional.
		} finally {
			loadingKendaraan = false;
		}
	}

	async function refreshGatePreflight() {
		loadingGates = true;
		try {
			const params = new URLSearchParams({ jenis });
			if (selectedSiteCheckinId) params.set('site_checkin_id', selectedSiteCheckinId);
			if (linkedTripId) params.set('trip_id', String(linkedTripId));
			if (selectedVehicleId) params.set('vehicle_id', String(selectedVehicleId));
			if (odometer) params.set('odometer', odometer);
			if (fotoFile) params.set('has_foto_struk', '1');
			if (fotoOdometerFile) params.set('has_foto_odometer', '1');
			if (mode) params.set('mode', mode);
			if (selectedProjectId) params.set('project_id', String(selectedProjectId));
			if (nominal) {
				const n = parseFloat(nominal.replace(/\./g, '').replace(',', '.'));
				if (n > 0) params.set('nominal', String(n));
			}
			const res = await fetch(`/api/biaya-lapangan/preflight?${params.toString()}`, { headers: await authHeaders() });
			if (res.ok) {
				const data = await res.json();
				gateResults = data.gates || [];
			}
		} catch {
			// Gagal-lunak — checklist tidak tampil, penegakan sesungguhnya tetap di server saat submit.
		} finally {
			loadingGates = false;
		}
	}

	function scheduleGatePreflight() {
		if (gatePreflightTimer) clearTimeout(gatePreflightTimer);
		gatePreflightTimer = setTimeout(refreshGatePreflight, 400);
	}

	function onGateAction(href: string) {
		if (href.startsWith('#')) {
			document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		} else {
			goto(href);
		}
	}

	function setFotoOdometerPreview(url: string | null) {
		if (fotoOdometerPreview && fotoOdometerPreview.startsWith('blob:')) URL.revokeObjectURL(fotoOdometerPreview);
		fotoOdometerPreview = url;
	}

	function onFotoOdometerChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		if (!file) return;
		fotoOdometerFile = file;
		setFotoOdometerPreview(URL.createObjectURL(file));
		scheduleGatePreflight();
	}

	function hapusFotoOdometer() {
		fotoOdometerFile = null;
		setFotoOdometerPreview(null);
		scheduleGatePreflight();
	}

	// Pengaju bisa mewakili rekan lain (mis. leader menalangi BBM sales untuk visit site).
	// null = diri sendiri; klaim reimburse otomatis atas nama karyawan yang dipilih.
	let forKaryawanId = $state<number | null>(null);
	let karyawanList = $state<{ id: number; nama_karyawan: string }[]>([]);

	// UI state
	let loadingProyek = $state(true);
	let submitting = $state(false);
	let sukses = $state(false);
	let queuedOffline = $state(false);
	let errorMsg = $state('');
	let proyekList = $state<Proyek[]>([]);

	// Offline-First Receipt Capture (rekomendasi rekonsiliasi rekening koran Jan-Agu 2026):
	// dipakai untuk pesan status koneksi di DraftIndicator, sama seperti pola di
	// laporan/[project_id] dan ess/slip-gaji.
	let isOffline = $state(typeof navigator !== 'undefined' ? !navigator.onLine : false);

	// Prefill dari peminjaman kendaraan aktif (Fase 3, §11.1.2a) — trip_log_id otomatis terisi
	let linkedTripId = $state<string | number | null>(null);
	let linkedBookingCode = $state('');
	// Peminjaman 06 Fase 3 — trip ini memakai UANG MUKA: struk BBM/tol/parkir lewat LPJ Kas Kecil, bukan reimburse.
	let linkedAdvance = $state(false);
	const jenisTercakupUangMuka = $derived((JENIS_DOBEL as readonly string[]).includes(jenis));
	const dobelTerkunci = $derived(linkedAdvance && !!linkedTripId && mode === 'talangan' && jenisTercakupUangMuka);

	// "Ini bukan untuk perjalanan {kode}": lepaskan tautan trip supaya biaya pribadi di hari yang sama tetap bisa diajukan (Aturan #6).
	function bukanPerjalananIni() {
		linkedTripId = null;
		linkedAdvance = false;
	}

	// "4-Gate Site Visit System" Fase 3b (8 Sep 2026) — G_BBM_VISIT: tanpa trip peminjaman
	// kendaraan aktif, pencatatan biaya lapangan wajib terkait site_checkin. Auto-pilih
	// check-in aktif kalau ada; kalau tidak, user pilih dari daftar 7 hari terakhir.
	let visits = $state<VisitPickerOption[]>([]);
	let loadingVisits = $state(false);
	let selectedSiteCheckinId = $state<string | null>(null);
	let showVisitPicker = $state(false);
	// Paket 06 §2.4 — settings (visit_picker_hari) + checkout langsung dari picker.
	let siteCheckinSettings = $state<SiteCheckinSettings | null>(null);
	let jumlahKunjunganAntre = $state(0);
	let checkoutTarget = $state<VisitPickerOption | null>(null);

	async function loadVisits() {
		loadingVisits = true;
		try {
			const settingsRes = await getSiteCheckinSettings().catch(() => null);
			siteCheckinSettings = settingsRes?.settings || null;
			const hari = siteCheckinSettings?.visit_picker_hari || 7;
			const res = await fetchMyVisits(hari);
			visits = res.visits || [];
			const active = visits.find((v) => v.status === 'active');
			if (active && !selectedSiteCheckinId) selectedSiteCheckinId = active.id;
		} catch {
			// Gagal-lunak — VisitPicker akan tampil kosong, user tetap bisa isi manual bila
			// nanti ada opsi lain, tapi saat ini gate tetap ditegakkan server-side.
		} finally {
			loadingVisits = false;
		}
		try {
			const antre = await getQueuedSiteCheckinSubmissions();
			jumlahKunjunganAntre = antre.filter((e) => e.type === 'checkin').length;
		} catch {
			jumlahKunjunganAntre = 0;
		}
	}

	function buildStubCheckinUntukCheckout(v: VisitPickerOption): SiteCheckinRecord {
		return {
			id: v.id,
			karyawan_id: '',
			referensi_id: 0,
			nama_lokasi: v.nama_lokasi,
			tier_absensi: null,
			area_sumber: null,
			area_status: null,
			check_in_at: v.check_in_at,
			check_out_at: null,
			in_geofence: v.in_geofence,
			jarak_in_m: null,
			durasi_menit: v.durasi_menit,
			status: v.status,
			tipe_checkin: v.tipe_checkin
		};
	}

	function handleCheckoutSelesai() {
		checkoutTarget = null;
		loadVisits();
	}

	const selectedVisit = $derived(visits.find((v) => v.id === selectedSiteCheckinId) || null);
	const needsVisitPicker = $derived(!linkedTripId && mode !== 'klaim');

	// Wajib foto struk hanya untuk mode talangan (reimburse) — bukti pengeluaran pribadi.
	// Mode "Dana Proyek" boleh tanpa struk karena uangnya baru diajukan, belum dibelanjakan.
	let fotoWajib = $derived(mode === 'talangan');

	// Paket 06 §2.5 — mode gate G_BBM_VISIT dari preflight (gateResults), dipakai UI untuk
	// menentukan apakah "(wajib)"/border merah ditampilkan (hanya saat 'hard').
	const bbmGateMode = $derived(gateResults.find((g) => g.key === 'G_BBM_VISIT')?.mode ?? 'shadow');

	// Alasan tombol submit belum bisa ditekan — ditampilkan ke user supaya jelas apa yang kurang.
	// Sebelumnya tombol hanya di-`disabled` tanpa keterangan, jadi terlihat "rusak".
	let blockReason = $derived.by(() => {
		const n = parseFloat(nominal.replace(/\./g, '').replace(',', '.'));
		if (!Number.isFinite(n) || n <= 0) return 'Isi nominal biaya terlebih dahulu.';
		// Proyek hanya wajib untuk mode "Dana Proyek". Reimburse (Uang Saya) boleh tanpa proyek
		// — biaya visit site / prospek yang belum ada nomor proyek tetap bisa diajukan.
		if (mode === 'proyek' && !selectedProjectId) return 'Mode Dana Proyek wajib pilih proyek.';
		if (dobelTerkunci) return `Perjalanan ${linkedBookingCode} memakai uang muka — struk BBM/tol/parkir-nya lewat LPJ Kas Kecil, bukan reimburse. Jika biaya ini bukan untuk perjalanan itu, tekan "Ini bukan untuk perjalanan ${linkedBookingCode}".`;
		if (fotoWajib && !fotoFile) return 'Lampirkan foto struk (wajib untuk klaim Uang Saya).';
		// Paket 06 §2.5 (Aturan #3) — HANYA gate G_BBM_VISIT bermode 'hard' yang boleh
		// memblokir submit (preflight sudah mode-aware, lihat gateResults). Sebelumnya ada
		// pengunci terpisah "needsVisitPicker && !selectedSiteCheckinId" yang mengunci APA
		// PUN mode gate-nya — bug nyata, sudah dihapus (digantikan pemeriksaan ini).
		const hardGateFailed = gateResults.filter((g) => g.status === 'failed' && g.mode === 'hard');
		if (hardGateFailed.length > 0) return hardGateFailed.map((g) => g.message).join('; ');
		return '';
	});

	// Jaring pengaman draf (lihat formPersist.ts): di sebagian perangkat OS mematikan tab saat
	// kamera dibuka, lalu halaman "refresh sendiri" begitu foto selesai — semua isian hilang.
	// Draf (isian + foto di IndexedDB) dipulihkan otomatis saat halaman dimuat ulang.
	interface BiayaLapanganDraft {
		jenis: Jenis;
		nominal: string;
		catatan: string;
		mode: Mode;
		selectedProjectId: number | null;
		forKaryawanId: number | null;
	}
	const STRUK_PHOTO_KEY = 'struk';
	const biayaPersist = createFormPersist<BiayaLapanganDraft>('biaya_lapangan');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function biayaSnapshot(): BiayaLapanganDraft {
		return { jenis, nominal, catatan, mode, selectedProjectId, forKaryawanId };
	}

	function setFotoPreview(url: string | null) {
		if (fotoPreview && fotoPreview.startsWith('blob:')) URL.revokeObjectURL(fotoPreview);
		fotoPreview = url;
	}

	// Semua endpoint /api/ess/* & /api/biaya-lapangan butuh Bearer Firebase ID token
	// (server: requireUser). Tanpa ini submit gagal "Sesi tidak ditemukan".
	async function authHeaders(): Promise<Record<string, string>> {
		const idToken = await auth.currentUser?.getIdToken();
		return idToken ? { Authorization: `Bearer ${idToken}` } : {};
	}

	// Ambil proyek aktif (reuse endpoint yang sama dengan form lembur)
	async function loadProyek() {
		loadingProyek = true;
		try {
			const res = await fetch('/api/ess/lembur/projects', { headers: await authHeaders() });
			if (res.ok) {
				const data = await res.json();
				proyekList = (data.projects || []).map((p: any) => ({
					id: p.id,
					name: [p.name, p.nomor_po].filter(Boolean).join(' — ')
				}));
			}
		} catch {
			// Fallback diam: tampilkan input kosong
		} finally {
			loadingProyek = false;
		}
	}

	// Daftar karyawan aktif untuk picker "Diajukan untuk" — reuse endpoint kandidat delegasi
	// cuti (whitelist id + nama_karyawan, sudah difilter karyawan aktif).
	async function loadKaryawan() {
		try {
			const res = await fetch('/api/ess/cuti/delegasi-kandidat', { headers: await authHeaders() });
			if (res.ok) {
				const data = await res.json();
				karyawanList = data.employees || [];
			}
		} catch {
			// Diam saja — tanpa daftar, form tetap jalan untuk "diri sendiri"
		}
	}

	async function loadActiveBookingTrip() {
		try {
			const bookings = await getMyFleetBookings();
			const active = bookings.find((b) => b.status === 'aktif' && b.trip_log_id);
			if (active) {
				linkedTripId = active.trip_log_id;
				linkedBookingCode = active.kode_booking;
				linkedAdvance = isBookingBeruangMuka(active);
			}
		} catch {
			// Diam saja — prefill bersifat kenyamanan, bukan wajib
		}
	}

	// Kirim ulang satu pengajuan biaya lapangan yang tersimpan offline — merekonstruksi
	// FormData yang persis sama dengan alur online (endpoint menerima field + foto dalam
	// satu multipart request, beda dari GR yang upload foto terpisah dulu).
	async function sendQueuedBiaya(entry: QueuedBiayaLapangan) {
		const form = new FormData();
		for (const [key, value] of Object.entries(entry.fields)) {
			if (value !== undefined && value !== '') form.set(key, value);
		}
		if (entry.blobs.fotoStruk) {
			form.set('foto_struk', new File([entry.blobs.fotoStruk], 'struk.jpg', { type: entry.blobs.fotoStruk.type || 'image/jpeg' }));
		}
		if (entry.blobs.fotoOdometer) {
			form.set('foto_odometer', new File([entry.blobs.fotoOdometer], 'odometer.jpg', { type: entry.blobs.fotoOdometer.type || 'image/jpeg' }));
		}

		const res = await fetch('/api/biaya-lapangan', {
			method: 'POST',
			headers: await authHeaders(),
			body: form
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body?.message || `HTTP ${res.status}`);
		}
	}

	onMount(async () => {
		loadProyek();
		loadKaryawan();
		loadActiveBookingTrip();
		loadVisits();
		loadKendaraan();
		refreshGatePreflight();

		// Pulihkan draf bila halaman sempat ter-reload (OS membunuh tab saat kamera terbuka).
		const draft = biayaPersist.restore();
		if (draft) {
			jenis = draft.jenis;
			nominal = draft.nominal;
			catatan = draft.catatan;
			mode = draft.mode;
			selectedProjectId = draft.selectedProjectId;
			forKaryawanId = draft.forKaryawanId ?? null;
			const blob = await biayaPersist.restorePhoto(STRUK_PHOTO_KEY);
			if (blob) {
				fotoFile = new File([blob], 'struk.jpg', { type: blob.type || 'image/jpeg' });
				setFotoPreview(URL.createObjectURL(fotoFile));
			}
			draftSavedAt = new Date();
		}
		draftArmed = true;

		registerBiayaLapanganAutoFlush(sendQueuedBiaya);
		flushBiayaLapanganQueue(sendQueuedBiaya).catch(() => {});
	});

	onMount(() => {
		const onOnline = () => (isOffline = false);
		const onOffline = () => (isOffline = true);
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		return () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
		};
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void biayaSnapshot();
		if (!draftArmed) return;
		biayaPersist.save(biayaSnapshot());
		draftSavedAt = new Date();
	});

	// Titik simpan wajib: pagehide & visibilitychange (dipicu tepat sebelum kamera membuka).
	$effect(() => registerFormPersistSaveTriggers(biayaPersist, biayaSnapshot));

	// Checklist gate hidup — dievaluasi ulang tiap field yang relevan berubah (debounce
	// 400ms, lihat scheduleGatePreflight). Baca semua dependensi eksplisit di sini supaya
	// Svelte 5 melacaknya dengan benar.
	$effect(() => {
		void jenis;
		void selectedSiteCheckinId;
		void linkedTripId;
		void selectedVehicleId;
		void odometer;
		void mode;
		void selectedProjectId;
		void nominal;
		if (!draftArmed) return;
		scheduleGatePreflight();
	});

	function onFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		if (!file) return;
		fotoFile = file;
		// createObjectURL, bukan FileReader.readAsDataURL — base64 foto kamera resolusi penuh
		// menahan RAM besar di state + DOM dan ikut memperbesar peluang tab dibunuh OS.
		setFotoPreview(URL.createObjectURL(file));
		// Simpan blob asli ke IndexedDB supaya foto ikut pulih bila tab ter-reload.
		biayaPersist.savePhoto(STRUK_PHOTO_KEY, file);
		scheduleGatePreflight();
	}

	function hapusFoto() {
		fotoFile = null;
		setFotoPreview(null);
		biayaPersist.clearPhoto(STRUK_PHOTO_KEY);
		scheduleGatePreflight();
	}

	async function submit() {
		errorMsg = '';
		const nominalNum = parseFloat(nominal.replace(/\./g, '').replace(',', '.'));
		if (!Number.isFinite(nominalNum) || nominalNum <= 0) {
			errorMsg = 'Nominal harus lebih dari 0.';
			return;
		}
		if (mode === 'proyek' && !selectedProjectId) {
			errorMsg = 'Mode Dana Proyek wajib memilih proyek.';
			return;
		}
		if (dobelTerkunci) {
			errorMsg = `Perjalanan ${linkedBookingCode} memakai uang muka — struk BBM/tol/parkir-nya lewat LPJ Kas Kecil, bukan reimburse.`;
			return;
		}
		if (fotoWajib && !fotoFile) {
			errorMsg = 'Foto struk wajib untuk pengajuan reimburse (Uang Saya).';
			return;
		}
		// Paket 06 §2.5 (Aturan #3, bug nyata diperbaiki): SEBELUMNYA blok ini mengunci submit
		// tanpa kunjungan terpilih APA PUN mode gate G_BBM_VISIT — soft/shadow pun terkunci,
		// padahal server (preflight & submit) sudah lama mode-aware (hanya 'hard' yang block).
		// Penegakan sesungguhnya sekarang MURNI lewat hardGateFailed di bawah (G_BBM_VISIT
		// sudah termasuk gateResults, lihat preflight/+server.ts).
		const hardGateFailed = gateResults.filter((g) => g.status === 'failed' && g.mode === 'hard');
		if (hardGateFailed.length > 0) {
			errorMsg = `Syarat wajib belum lengkap: ${hardGateFailed.map((g) => g.message).join('; ')}`;
			return;
		}

		submitting = true;
		const fieldsSnapshot = {
			jenis,
			nominal: String(nominalNum),
			mode,
			project_id: selectedProjectId ? String(selectedProjectId) : undefined,
			for_karyawan_id: forKaryawanId ? String(forKaryawanId) : undefined,
			trip_id: linkedTripId ? String(linkedTripId) : undefined,
			site_checkin_id: selectedSiteCheckinId || undefined,
			catatan: catatan.trim() || undefined,
			vehicle_id: selectedVehicleId ? String(selectedVehicleId) : undefined,
			odometer: odometer.trim() || undefined
		};
		try {
			const compressedFotoStruk = fotoFile ? await compressPhoto(fotoFile) : null;
			const compressedFotoOdometer = fotoOdometerFile ? await compressPhoto(fotoOdometerFile) : null;

			const form = new FormData();
			for (const [key, value] of Object.entries(fieldsSnapshot)) {
				if (value !== undefined) form.set(key, value);
			}
			if (compressedFotoStruk) form.set('foto_struk', compressedFotoStruk);
			if (compressedFotoOdometer) form.set('foto_odometer', compressedFotoOdometer);

			const res = await fetch('/api/biaya-lapangan', {
				method: 'POST',
				headers: await authHeaders(),
				body: form
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body?.message || `HTTP ${res.status}`);
			}
			// Terkirim — draf lokal (termasuk foto struk di IndexedDB) sudah tidak relevan.
			biayaPersist.clear();
			await biayaPersist.clearPhotos();
			draftSavedAt = null;
			sukses = true;
		} catch (err: any) {
			if (err instanceof TypeError) {
				// Kemungkinan besar offline (fetch gagal total, bukan error dari server) — simpan
				// ke antrian lokal untuk dikirim ulang otomatis saat sinyal kembali (Offline-First
				// Receipt Capture, rekomendasi rekonsiliasi Jan-Agu 2026). Sama seperti pola GR.
				try {
					const fotoStrukBlob = fotoFile ? await compressPhoto(fotoFile) : undefined;
					const fotoOdometerBlob = fotoOdometerFile ? await compressPhoto(fotoOdometerFile) : undefined;
					await enqueueBiayaLapangan({
						client_txn_id: crypto.randomUUID(),
						fields: fieldsSnapshot,
						blobs: { fotoStruk: fotoStrukBlob, fotoOdometer: fotoOdometerBlob },
						createdAt: new Date().toISOString()
					});
					biayaPersist.clear();
					await biayaPersist.clearPhotos();
					draftSavedAt = null;
					sukses = true;
					queuedOffline = true;
				} catch (queueErr: any) {
					console.error('Gagal menyimpan antrian offline biaya lapangan:', queueErr);
					errorMsg = 'Tidak ada sinyal dan gagal menyimpan offline. Coba lagi.';
				}
			} else {
				errorMsg = err?.message || 'Terjadi kesalahan. Coba lagi.';
			}
		} finally {
			submitting = false;
		}
	}

	function reset() {
		jenis = 'bbm';
		nominal = '';
		catatan = '';
		mode = 'talangan';
		forKaryawanId = null;
		fotoFile = null;
		setFotoPreview(null);
		selectedVehicleId = null;
		odometer = '';
		fotoOdometerFile = null;
		setFotoOdometerPreview(null);
		errorMsg = '';
		sukses = false;
		queuedOffline = false;
		biayaPersist.clear();
		void biayaPersist.clearPhotos();
		draftSavedAt = null;
	}

	function formatRupiah(val: string): string {
		const num = val.replace(/\D/g, '');
		return num.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	}

	function onNominalInput(e: Event) {
		const raw = (e.target as HTMLInputElement).value.replace(/\./g, '');
		nominal = formatRupiah(raw);
	}
</script>

<div class="w-full max-w-lg mx-auto p-4 pb-28">
	<!-- Header -->
	<div class="flex items-center gap-3 mb-6">
		<button
			onclick={() => goto('/pusat-pengajuan')}
			class="p-2 rounded-xl hover:bg-black/5 transition-colors"
			style="color: var(--sys-label3)"
		>
			<IconChevronLeft size={22} />
		</button>
		<div>
			<h1 class="text-xl font-extrabold tracking-tight" style="color: var(--sys-label)">
				Biaya Lapangan
			</h1>
			<p class="text-xs font-medium mt-0.5" style="color: var(--sys-label3)">
				BBM · Tol · Parkir · Lain-lain
			</p>
		</div>
		<button
			onclick={() => goto('/biaya-lapangan/rekap')}
			class="ml-auto px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70"
			title="Lihat & cetak kumpulan nota yang sudah Anda catat"
		>
			📒 Rekap Nota
		</button>
	</div>

	{#if !sukses}
		<div class="mb-3">
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!fotoFile} {isOffline} />
		</div>

		<!-- Mode Utama: Uang Saya vs Dana Proyek vs Klaim & Backcharge (Fase 2) -->
		<div class="grid grid-cols-3 gap-2 mb-4">
			<button
				type="button"
				onclick={() => (mode = 'talangan')}
				class="flex flex-col items-center gap-1 p-2.5 rounded-xl text-center text-xs font-bold transition-all border"
				style={mode === 'talangan'
					? 'background: var(--b6, #eff6ff); border-color: var(--blue, #3b82f6); color: var(--blue, #1d4ed8)'
					: 'background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label2)'}
			>
				<span class="text-base">💳</span>
				<span>Uang Saya</span>
				<span class="text-[10px] font-normal opacity-80">(Reimburse)</span>
			</button>

			<button
				type="button"
				onclick={() => (mode = 'proyek')}
				class="flex flex-col items-center gap-1 p-2.5 rounded-xl text-center text-xs font-bold transition-all border"
				style={mode === 'proyek'
					? 'background: var(--g6, #f0fdf4); border-color: var(--green, #16a34a); color: var(--green, #15803d)'
					: 'background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label2)'}
			>
				<span class="text-base">🏗️</span>
				<span>Dana Proyek</span>
				<span class="text-[10px] font-normal opacity-80">(BBM / Tol)</span>
			</button>

			<button
				type="button"
				onclick={() => (mode = 'klaim')}
				class="flex flex-col items-center gap-1 p-2.5 rounded-xl text-center text-xs font-bold transition-all border"
				style={mode === 'klaim'
					? 'background: var(--o6, #fff7ed); border-color: var(--orange, #f97316); color: var(--orange, #c2410c)'
					: 'background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label2)'}
			>
				<span class="text-base">🚜</span>
				<span>Backcharge</span>
				<span class="text-[10px] font-normal opacity-80">(Puing / Alat)</span>
			</button>
		</div>
	{/if}

	{#if linkedTripId && !sukses}
		<div
			class="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-4 border"
			style="background: var(--b6); border-color: var(--blue); color: var(--blue)"
		>
			<IconSteeringWheel size={16} class="shrink-0" />
			<p class="text-xs font-semibold">Terkait Peminjaman {linkedBookingCode} — biaya ini otomatis tertaut ke trip yang sedang berjalan.</p>
		</div>
	{/if}

	{#if linkedAdvance && linkedTripId && mode === 'talangan' && !sukses}
		<!-- Peminjaman 06 Fase 3 — cegah bayar dobel -->
		<div class="rounded-xl px-3 py-2.5 mb-4 border" style="background: var(--o6, #fff7ed); border-color: var(--orange, #f97316); color: var(--orange, #c2410c)">
			<p class="text-xs font-semibold">Perjalanan {linkedBookingCode} memakai uang muka.</p>
			<p class="text-xs mt-1">Struk BBM / tol / parkir perjalanan ini <b>jangan diajukan sebagai reimburse</b> — simpan untuk LPJ Kas Kecil (Petty Cash) agar uang tidak keluar dua kali. Biaya lain-lain tetap bisa diajukan di sini.</p>
			<button type="button" class="mt-2 text-xs font-bold underline" onclick={bukanPerjalananIni}>
				Ini bukan untuk perjalanan {linkedBookingCode}
			</button>
		</div>
	{/if}

	{#if needsVisitPicker && !sukses}
		<!-- G_BBM_VISIT — "4-Gate Site Visit System" Fase 3b. Paket 06 §2.5: "(wajib)" &
		     border merah HANYA saat mode gate 'hard' — sebelumnya selalu tampil apa pun mode. -->
		<div id="site-checkin" class="glass-panel rounded-2xl p-4 mb-4" style={bbmGateMode === 'hard' && !selectedSiteCheckinId ? 'border: 1px solid var(--red)' : ''}>
			<div class="flex items-center justify-between mb-2">
				<label class="block text-xs font-bold uppercase tracking-widest" style="color: var(--sys-label3)">
					Kunjungan Terkait {#if bbmGateMode === 'hard'}<span class="font-bold normal-case" style="color: var(--red)">(wajib)</span>{/if}
				</label>
				<button type="button" class="text-xs font-semibold" style="color: var(--blue)" onclick={loadVisits}>
					{loadingVisits ? 'Memuat…' : 'Muat Ulang'}
				</button>
			</div>
			<p class="text-xs mb-2" style="color: var(--sys-label3)">
				Tidak ada peminjaman kendaraan aktif — pilih kunjungan site yang mendasari biaya ini (maks. {siteCheckinSettings?.visit_picker_hari ?? 7} hari terakhir).
			</p>
			{#if loadingVisits}
				<CircularProgressGauge size={44} strokeWidth={3} label="Memuat daftar kunjungan..." />
			{:else if visits.length === 0}
				<p class="text-sm py-1" style="color: var(--sys-label3)">
					Belum ada kunjungan tercatat. Bila biaya ini bukan untuk kunjungan lapangan, tetap bisa dicatat (lihat checklist di bawah).
				</p>
			{:else}
				<select bind:value={selectedSiteCheckinId} class="w-full bg-transparent text-sm font-medium py-1 outline-none" style="color: var(--sys-label)">
					<option value={null} disabled selected>Pilih kunjungan…</option>
					{#each visits as v (v.id)}
						<option value={v.id}>
							{v.nama_lokasi || v.id} — {new Date(v.check_in_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}{v.status === 'active' ? ' — ⏳ belum check-out' : ''}{v.flagged_durasi_rendah || v.flagged_luar_geofence ? ' ⚠' : ''}
						</option>
					{/each}
				</select>
				{#if selectedVisit?.status === 'active'}
					<div class="mt-1.5 p-2.5 rounded-lg flex items-center justify-between gap-2" style="background: #FEF3C7">
						<span class="text-[11px]" style="color: #92400E">⏳ Kunjungan ini belum check-out.</span>
						<button type="button" class="text-[11px] font-bold shrink-0" style="color: #92400E" onclick={() => (checkoutTarget = selectedVisit)}>
							Check-out sekarang
						</button>
					</div>
				{/if}
				{#if selectedVisit && (selectedVisit.flagged_durasi_rendah || selectedVisit.flagged_luar_geofence)}
					<p class="text-xs mt-1.5" style="color: var(--red)">
						⚠ Kunjungan ini {selectedVisit.flagged_durasi_rendah ? 'durasinya di bawah minimum' : ''}{selectedVisit.flagged_durasi_rendah && selectedVisit.flagged_luar_geofence ? ' dan ' : ''}{selectedVisit.flagged_luar_geofence ? 'tercatat di luar geofence' : ''} — biaya tetap bisa dicatat, tapi pastikan datanya benar.
					</p>
				{/if}
			{/if}
			{#if jumlahKunjunganAntre > 0}
				<p class="text-[11px] mt-1.5" style="color: var(--sys-label4)">
					📱 {jumlahKunjunganAntre} kunjungan menunggu sinyal — akan bisa dipilih setelah terkirim.
				</p>
			{/if}
		</div>
	{/if}

	<!-- Paket 06 §2.4 — checkout langsung dari picker kunjungan aktif. -->
	{#if checkoutTarget}
		<CheckoutDialog
			checkin={buildStubCheckinUntukCheckout(checkoutTarget)}
			onDone={handleCheckoutSelesai}
			onClose={() => (checkoutTarget = null)}
		/>
	{/if}

	{#if sukses}
		<!-- Sukses -->
		<div class="glass-panel rounded-2xl p-8 text-center">
			<div
				class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
				style="background: var(--g6); color: var(--green)"
			>
				<IconCheck size={32} style="color: var(--green)" />
			</div>
			<h2 class="text-lg font-bold mb-2" style="color: var(--sys-label)">
				{queuedOffline ? 'Tersimpan di Perangkat' : 'Berhasil Dicatat!'}
			</h2>
			{#if queuedOffline}
				<p class="text-sm mb-6" style="color: var(--sys-label3)">
					Tidak ada sinyal — pengajuan beserta foto struk disimpan aman di perangkat ini dan
					akan otomatis terkirim begitu koneksi internet kembali. Tidak perlu diulang manual.
				</p>
			{:else if mode === 'talangan'}
				<p class="text-sm mb-6" style="color: var(--sys-label3)">
					Pengajuan reimburse sudah dibuat dan dikirim ke atasan untuk disetujui.
				</p>
			{:else if mode === 'klaim'}
				<p class="text-sm mb-6" style="color: var(--sys-label3)">
					Klaim lapangan / backcharge berhasil dicatat dan siap diverifikasi oleh admin proyek di kantor.
				</p>
			{:else}
				<p class="text-sm mb-6" style="color: var(--sys-label3)">
					Biaya lapangan tercatat sebagai realisasi proyek.
				</p>
			{/if}
			<div class="flex gap-2 justify-center">
				<button
					class="px-5 py-2 rounded-xl text-sm font-bold border transition-colors hover:bg-black/5 dark:hover:bg-white/5 bg-[var(--sys-bg2)]"
					style="border-color: var(--sys-sep); color: var(--sys-label2)"
					onclick={() => goto(mode === 'talangan' ? '/ess/reimburse' : (mode === 'klaim' ? '/proyek' : '/pusat-pengajuan'))}
				>
					Lihat Status
				</button>
				<button
					class="px-5 py-2 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity"
					onclick={reset}
				>
					Catat Lagi
				</button>
			</div>
		</div>
	{:else}
		{#if mode === 'klaim'}
			<!-- Modul Klaim Lapangan & Backcharge Pemborong (Fase 2) -->
			<KlaimLapanganSection
				bind:selectedProjectId
				{proyekList}
				onSuccess={() => {
					sukses = true;
				}}
			/>
		{:else}
			<!-- Form Biasa (Talangan Reimburse / Dana Proyek) -->
			<div class="space-y-4">
			<!-- Pilih Proyek -->
			<div class="glass-panel rounded-2xl p-4">
				<label class="block text-xs font-bold uppercase tracking-widest mb-2" style="color: var(--sys-label3)">
					Proyek
					{#if mode === 'talangan'}
						<span class="font-normal normal-case">(opsional)</span>
					{/if}
				</label>
				{#if loadingProyek}
					<div class="flex items-center gap-2 py-2" style="color: var(--sys-label4)">
						<IconLoader2 size={16} class="animate-spin" />
						<span class="text-sm">Memuat daftar proyek…</span>
					</div>
				{:else if proyekList.length > 0}
					<select
						bind:value={selectedProjectId}
						class="w-full bg-transparent text-sm font-medium py-1 outline-none"
						style="color: var(--sys-label)"
					>
						<option value={null}>{mode === 'talangan' ? 'Tanpa proyek (visit site / umum)' : 'Pilih proyek…'}</option>
						{#each proyekList as p (p.id)}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
				{:else}
					<p class="text-sm py-1" style="color: var(--sys-label3)">
						Tidak ada proyek aktif yang tersedia.
					</p>
				{/if}
			</div>

			<!-- Jenis Biaya -->
			<div class="glass-panel rounded-2xl p-4">
				<p class="text-xs font-bold uppercase tracking-widest mb-3" style="color: var(--sys-label3)">
					Jenis Biaya
				</p>
				<div class="grid grid-cols-4 gap-2">
					{#each JENIS_OPTIONS as opt (opt.value)}
						<button
							onclick={() => (jenis = opt.value)}
							class="flex flex-col items-center gap-1 py-3 rounded-xl text-xs font-bold transition-all"
							style={jenis === opt.value
								? 'background: var(--color-accent, #ea580c); color: #fff'
								: 'background: var(--sys-bg2); color: var(--sys-label2); border: 1px solid var(--sys-sep)'}
						>
							<span class="text-xl">{opt.emoji}</span>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>

			{#if jenis === 'bbm' || jenis === 'tol'}
				<!-- Kendaraan Perusahaan (Fase 4 v2, 9 Sep 2026) — opsional, dibatasi ke yang
				     di-booking/ditugaskan. Pemicu G_P2H_UNIT_LAPANGAN. -->
				<div class="glass-panel rounded-2xl p-4">
					<label class="block text-xs font-bold uppercase tracking-widest mb-2" style="color: var(--sys-label3)">
						Kendaraan Perusahaan <span class="font-normal normal-case">(opsional)</span>
					</label>
					{#if loadingKendaraan}
						<div class="flex items-center gap-2 py-2" style="color: var(--sys-label4)">
							<IconLoader2 size={16} class="animate-spin" />
							<span class="text-sm">Memuat kendaraan…</span>
						</div>
					{:else if kendaraanList.length > 0}
						<select
							bind:value={selectedVehicleId}
							class="w-full bg-transparent text-sm font-medium py-1 outline-none"
							style="color: var(--sys-label)"
						>
							<option value={null}>Tidak pakai kendaraan perusahaan</option>
							{#each kendaraanList as k (k.id)}
								<option value={k.id}>{k.label}</option>
							{/each}
						</select>
						<p class="text-xs mt-1.5" style="color: var(--sys-label4)">
							Hanya menampilkan kendaraan yang ditugaskan/di-booking atas nama Anda. Pilih bila biaya ini pakai kendaraan perusahaan — sistem akan mengecek P2H hari ini.
						</p>
					{:else}
						<p class="text-sm py-1" style="color: var(--sys-label3)">
							Tidak ada kendaraan perusahaan yang ditugaskan/di-booking atas nama Anda hari ini.
						</p>
					{/if}
				</div>
			{/if}

			{#if jenis === 'bbm'}
				<!-- Odometer + Foto Odometer (Fase 1/4 v2, 9 Sep 2026) — bukti G_BUKTI_BBM. -->
				<div id="foto-odometer" class="glass-panel rounded-2xl p-4">
					<label class="block text-xs font-bold uppercase tracking-widest mb-2" style="color: var(--sys-label3)">
						Odometer Saat Ini <span class="font-normal normal-case">(untuk BBM)</span>
					</label>
					<input
						type="number"
						inputmode="numeric"
						placeholder="Mis: 45230"
						bind:value={odometer}
						class="w-full bg-transparent text-sm font-medium py-1 outline-none mb-3"
						style="color: var(--sys-label)"
					/>
					{#if fotoOdometerPreview}
						<div class="relative">
							<img src={fotoOdometerPreview} alt="Odometer" class="w-full max-h-40 object-contain rounded-xl" />
							<button
								onclick={hapusFotoOdometer}
								class="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center"
								style="background: rgba(0,0,0,0.5); color: #fff"
							>
								<IconX size={14} />
							</button>
						</div>
					{:else}
						<label
							class="flex flex-col items-center gap-2 py-5 rounded-xl cursor-pointer border-2 border-dashed transition-colors hover:border-orange-400"
							style="border-color: var(--sys-sep)"
						>
							<IconCamera size={24} style="color: var(--sys-label4)" />
							<span class="text-xs" style="color: var(--sys-label3)">Foto odometer (opsional, sebaiknya dilampirkan)</span>
							<input type="file" accept="image/*" capture="environment" class="hidden" onchange={onFotoOdometerChange} />
						</label>
					{/if}
				</div>
			{/if}

			<!-- Nominal -->
			<div class="glass-panel rounded-2xl p-4">
				<label
					for="nominal"
					class="block text-xs font-bold uppercase tracking-widest mb-2"
					style="color: var(--sys-label3)"
				>
					Nominal
				</label>
				<div class="flex items-center gap-2">
					<span class="text-sm font-bold shrink-0" style="color: var(--sys-label3)">Rp</span>
					<input
						id="nominal"
						type="text"
						inputmode="numeric"
						placeholder="0"
						value={nominal}
						oninput={onNominalInput}
						class="flex-1 bg-transparent text-lg font-bold outline-none"
						style="color: var(--sys-label)"
					/>
				</div>
			</div>

			<!-- Mode Pembayaran -->
			<div class="glass-panel rounded-2xl p-4">
				<p class="text-xs font-bold uppercase tracking-widest mb-3" style="color: var(--sys-label3)">
					Siapa yang Bayar?
				</p>
				<div class="grid grid-cols-2 gap-2">
					<button
						onclick={() => (mode = 'talangan')}
						class="flex flex-col gap-1 p-3 rounded-xl text-left transition-all border"
						style={mode === 'talangan'
							? 'background: var(--b6); border-color: var(--blue, #3b82f6)'
							: 'background: var(--sys-bg2); border-color: var(--sys-sep)'}
					>
						<span class="text-lg">💳</span>
						<span class="text-xs font-bold" style="color: var(--sys-label)">Uang Saya</span>
						<span class="text-xs leading-snug" style="color: var(--sys-label3)">
							Akan diajukan reimburse ke atasan
						</span>
					</button>
					<button
						onclick={() => (mode = 'proyek')}
						class="flex flex-col gap-1 p-3 rounded-xl text-left transition-all border"
						style={mode === 'proyek'
							? 'background: var(--g6); border-color: var(--green, #16a34a)'
							: 'background: var(--sys-bg2); border-color: var(--sys-sep)'}
					>
						<span class="text-lg">🏗️</span>
						<span class="text-xs font-bold" style="color: var(--sys-label)">Dana Proyek</span>
						<span class="text-xs leading-snug" style="color: var(--sys-label3)">
							Dicatat sebagai realisasi proyek, tidak perlu ganti rugi
						</span>
					</button>
				</div>
			</div>

			<!-- Diajukan Untuk — default diri sendiri, bisa wakili rekan (mis. BBM sales visit site) -->
			<div class="glass-panel rounded-2xl p-4">
				<label
					for="for-karyawan"
					class="block text-xs font-bold uppercase tracking-widest mb-2"
					style="color: var(--sys-label3)"
				>
					Diajukan Untuk
				</label>
				{#if karyawanList.length > 0}
					<select
						id="for-karyawan"
						bind:value={forKaryawanId}
						class="w-full bg-transparent text-sm font-medium py-1 outline-none"
						style="color: var(--sys-label)"
					>
						<option value={null}>Saya sendiri</option>
						{#each karyawanList as k (k.id)}
							<option value={k.id}>{k.nama_karyawan}</option>
						{/each}
					</select>
				{:else}
					<p class="text-sm py-1" style="color: var(--sys-label3)">Saya sendiri</p>
				{/if}
				{#if mode === 'talangan'}
					<p class="text-xs mt-1.5 leading-snug" style="color: var(--sys-label3)">
						Pilih rekan bila biaya ini untuk karyawan lain (mis. BBM sales untuk visit site).
						Reimburse masuk ke klaim orang yang dipilih.
					</p>
				{/if}
			</div>

			<!-- Foto Struk -->
			<div
				id="foto-struk"
				class="glass-panel rounded-2xl p-4"
				style={fotoWajib && !fotoFile ? 'border: 1px solid var(--red)' : ''}
			>
				<p class="text-xs font-bold uppercase tracking-widest mb-3" style="color: var(--sys-label3)">
					Foto Struk
					{#if fotoWajib}
						<span class="font-bold normal-case" style="color: var(--red)">(wajib)</span>
					{:else}
						<span class="font-normal normal-case">(opsional)</span>
					{/if}
				</p>
				{#if fotoPreview}
					<div class="relative">
						<img
							src={fotoPreview}
							alt="Struk"
							class="w-full max-h-48 object-contain rounded-xl"
						/>
						<button
							onclick={hapusFoto}
							class="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center"
							style="background: rgba(0,0,0,0.5); color: #fff"
						>
							<IconX size={14} />
						</button>
					</div>
				{:else}
					<label
						class="flex flex-col items-center gap-2 py-6 rounded-xl cursor-pointer border-2 border-dashed transition-colors hover:border-orange-400"
						style="border-color: var(--sys-sep)"
					>
						<IconCamera size={28} style="color: var(--sys-label4)" />
						<span class="text-xs" style="color: var(--sys-label3)">Ambil foto atau pilih gambar</span>
						<input
							type="file"
							accept="image/*"
							capture="environment"
							class="hidden"
							onchange={onFotoChange}
						/>
					</label>
					{#if fotoWajib}
						<p class="text-xs mt-2 leading-snug" style="color: var(--sys-label3)">
							Struk wajib dilampirkan untuk klaim <strong>Uang Saya</strong>. Pilih
							<strong>Dana Proyek</strong> bila uang baru mau diajukan dan belum ada struk.
						</p>
					{/if}
				{/if}
			</div>

			<!-- Catatan -->
			<div class="glass-panel rounded-2xl p-4">
				<label
					for="catatan"
					class="block text-xs font-bold uppercase tracking-widest mb-2"
					style="color: var(--sys-label3)"
				>
					Catatan <span class="font-normal normal-case">(opsional)</span>
				</label>
				<textarea
					id="catatan"
					bind:value={catatan}
					rows="2"
					placeholder="Mis: Isi BBM untuk perjalanan ke site Balaraja"
					class="w-full bg-transparent text-sm outline-none resize-none"
					style="color: var(--sys-label)"
				></textarea>
			</div>

			<!-- Checklist Gate (Fase 4 v2, 9 Sep 2026) — hidup sejak form dibuka (Aturan #6) -->
			{#if gateResults.length > 0 || loadingGates}
				<GateChecklistCard gates={gateResults} onAction={onGateAction} />
			{/if}

			<!-- Error -->
			{#if errorMsg}
				<div
					class="flex items-start gap-2 rounded-xl px-3 py-2.5 border"
					style="background: var(--rel); border-color: var(--red); color: var(--red)"
				>
					<IconAlertTriangle size={16} style="color: var(--red)" class="shrink-0 mt-0.5" />
					<p class="text-xs font-medium">{errorMsg}</p>
				</div>
			{/if}

			<!-- Ringkasan & Submit -->
			{#if mode === 'talangan' && nominal}
				<div
					class="rounded-xl px-3 py-2.5 text-xs border"
					style="background: var(--b6); border-color: var(--blue); color: var(--blue)"
				>
					{#if forKaryawanId}
						Rp {nominal} akan diajukan sebagai <strong>reimburse</strong> atas nama
						<strong>{karyawanList.find((k) => k.id === forKaryawanId)?.nama_karyawan ?? 'karyawan terpilih'}</strong>
						dan dikirim ke atasannya untuk disetujui.
					{:else}
						Rp {nominal} akan diajukan sebagai <strong>reimburse</strong> dan dikirim ke atasan Anda
						untuk disetujui.
					{/if}
				</div>
			{/if}

			{#if blockReason && !submitting}
				<p class="text-xs text-center font-medium" style="color: var(--sys-label3)">
					{blockReason}
				</p>
			{/if}

			<button
				onclick={submit}
				disabled={submitting || !!blockReason}
				class="w-full py-3.5 rounded-2xl text-sm font-bold text-white transition-opacity disabled:opacity-50 gradient-bg hover:opacity-90"
			>
				{#if submitting}
					<IconLoader2 size={18} class="animate-spin inline mr-2" />
					Mengirim…
				{:else}
					{mode === 'talangan' ? '💳 Ajukan Reimburse' : '🏗️ Catat Realisasi'}
				{/if}
			</button>
		</div>
		{/if}
	{/if}
</div>
