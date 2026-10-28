<!-- src/lib/components/site-checkin/CheckinForm.svelte -->
<!-- Fase 3: form check-in modern & intuitif. Proyek dari penugasan aktif / leader + semua proyek aktif untuk kunjungan.
     GPS + foto terverifikasi + deteksi jarak geofence real-time. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { watchPositionUntilAccurate, type DevicePosition } from '$lib/utils/geoClient';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import {
		getMyProjects,
		getMyWorkOrders,
		getSiteCheckinSettings,
		submitCheckin,
		saveProjectCoordinate,
		laporKoordinatProyekSalah,
		type SiteCheckinProjectOption,
		type SiteCheckinWorkOrderOption,
		type SiteCheckinSettings
	} from '$lib/services/siteCheckin';
	import { enqueueSiteCheckinSubmission, removeQueuedSiteCheckinSubmission } from '$lib/utils/offlineSiteCheckinQueue';
	import { isRetryableError, pesanErrorAwam } from '$lib/utils/networkError';
	import { simpanCache, bacaCache, labelDariCache } from '$lib/utils/siteCheckinCache';
	import { auth } from '$lib/firebase';
	import { getTodayStatus, clockIn } from '$lib/services/ess/attendance';
	// Paket 08a Site Visit Release — kunjungan customer/prospek sekarang lewat menu
	// Sales → Kunjungan Baru (/sales/baru), bukan tab "Marketing" di sini (keputusan Opsi 1,
	// Lead 29 Sep 2026). Tautan hanya tampil bagi pemegang izin input_sales.
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		IconLoader2,
		IconMapPin,
		IconCamera,
		IconX,
		IconAlertTriangle,
		IconSearch,
		IconCheck,
		IconBuildingFactory2,
		IconUserCheck,
		IconShieldCheck,
		IconCompass,
		IconMap2,
		IconSparkles,
		IconInfoCircle,
		IconTool,
		IconExternalLink
	} from '@tabler/icons-svelte';
	import { slide, fade } from 'svelte/transition';
	import { onDestroy } from 'svelte';

	let {
		onSuccess,
		presetBookingId = null,
		presetProjectId = null,
		presetBookingCode = ''
	}: {
		onSuccess: () => void;
		presetBookingId?: string | null;
		presetProjectId?: number | null;
		presetBookingCode?: string;
	} = $props();

	// "4-Gate Site Visit System" Fase 3 (8 Sep 2026) — Type Selector: Proyek / Maintenance.
	// Paket 08a: 'marketing' dihapus dari sini — kunjungan customer/prospek lewat /sales/baru.
	let tipeKeperluan = $state<'proyek' | 'maintenance'>('proyek');

	// Paket 08a Site Visit Release — tautan "Sales ↗" hanya untuk pemegang izin input_sales
	// (atau super admin), pola sama halaman lain (mis. ess/+page.svelte).
	const bolehInputSales = $derived(
		$authStore.roleId === 'super_admin' ||
			$authStore.roleIds?.includes('super_admin') ||
			hasPermission($authStore.roleId, 'input_sales', $rolesStore, $authStore.roleIds)
	);
	// Peminjaman 09 §3.1/2.4 — kunci idempotensi check-in: dibuat saat form dibuka, dipakai ULANG saat retry
	// (online maupun antrean offline); baru diganti setelah berhasil/antre.
	let checkinTxnId = crypto.randomUUID();

	// UX-03: kunci localStorage untuk "proyek terakhir dipakai" per perangkat.
	const LAST_PROJECT_KEY = 'site-checkin:last-project-id';

	let projects = $state<SiteCheckinProjectOption[]>([]);
	let loadingProjects = $state(true);
	let assignedCount = $state(0);
	let selectedProjectId = $state<number | null>(null);
	let settings = $state<SiteCheckinSettings | null>(null);
	// Paket 02 §3.11 (SVR-04) — daftar proyek dari cache lokal (offline total), bukan server.
	let daftarDariCacheLabel = $state<string | null>(null);
	// Belum ada cache SAMA SEKALI & offline — tidak ada apa pun yang bisa ditampilkan.
	let offlineTanpaCache = $state(false);

	// SV-09 (correction plan site-visit-payroll): site_checkin = bukti, absensi_harian = kebenaran
	// payroll — tanpa absen BK (jam_masuk) hari itu, lokasi kunjungan TIDAK PERNAH tertulis untuk
	// tunjangan (lihat syncAbsensiLokasi -> anomali 'tanpa_absen_bk'). Leader perlu tahu ini SEBELUM
	// check-in, bukan menebak-nebak setelah kunjungan selesai.
	let sudahAbsenBk = $state<boolean | null>(null); // null = belum dicek / gagal cek (jangan blokir)

	let absenSekaligusLoading = $state(false);
	let absenSekaligusError = $state('');
	async function handleAbsenMasukSekaligus() {
		if (!position || !photoFile || absenSekaligusLoading) return;
		absenSekaligusLoading = true;
		absenSekaligusError = '';
		try {
			await clockIn({ lat: position.lat, lng: position.lng, accuracy: position.accuracy, photoFile, livenessPassed: false });
			sudahAbsenBk = true;
		} catch (e: any) {
			// 409 = sudah absen masuk (mis. dari perangkat lain) — anggap beres, bukan error.
			if (/sudah absen masuk/i.test(String(e?.message))) sudahAbsenBk = true;
			else absenSekaligusError = e?.message || 'Gagal absen masuk. Coba lewat halaman Absensi.';
		} finally {
			absenSekaligusLoading = false;
		}
	}

	async function cekAbsenBkHariIni() {
		try {
			const status = await getTodayStatus();
			const jamMasuk = status.record?.jam_masuk;
			sudahAbsenBk = !!jamMasuk && jamMasuk !== '-';
		} catch {
			sudahAbsenBk = null; // gagal-lunak — jangan blokir check-in hanya karena cek ini gagal
		}
	}

	let workOrders = $state<SiteCheckinWorkOrderOption[]>([]);
	let loadingWorkOrders = $state(false);
	let workOrdersLoaded = $state(false);
	let selectedWorkOrderId = $state<string | null>(null);
	let workOrderSearchQuery = $state('');
	let isWorkOrderSelectorOpen = $state(false);

	async function loadWorkOrders() {
		if (workOrdersLoaded || loadingWorkOrders) return;
		loadingWorkOrders = true;
		try {
			const res = await getMyWorkOrders();
			workOrders = res.workOrders || [];
			workOrdersLoaded = true;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat daftar work order.';
		} finally {
			loadingWorkOrders = false;
		}
	}

	$effect(() => {
		if (tipeKeperluan === 'maintenance') loadWorkOrders();
	});

	const selectedWorkOrder = $derived(workOrders.find((w) => w.id === selectedWorkOrderId) || null);
	const filteredWorkOrders = $derived.by(() => {
		if (!workOrderSearchQuery.trim()) return workOrders;
		const q = workOrderSearchQuery.toLowerCase();
		return workOrders.filter((w) => (w.wo_number || '').toLowerCase().includes(q) || (w.equipment_name || '').toLowerCase().includes(q));
	});

	// Search & Filter
	let projectSearchQuery = $state('');
	// Paket 04 §3.7 — tab "Semua" dihapus (diganti kotak cari untuk 'visit'); default 'assigned'.
	let activeTab = $state<'assigned' | 'visit'>('assigned');
	let isProjectSelectorOpen = $state(false);

	let locating = $state(false);
	let locationError = $state('');
	let position = $state<DevicePosition | null>(null);

	// UX-02: kualitas sinyal GPS saat ini — 🟢 akurat cukup untuk geofence, 🟡 masih bisa dipakai,
	// 🔴 sebaiknya pindah tempat terbuka sebelum lanjut. Ambang sama dengan targetAccuracyM watch.
	const gpsQuality = $derived.by((): 'baik' | 'cukup' | 'lemah' | null => {
		if (!position) return null;
		if (position.accuracy <= 50) return 'baik';
		if (position.accuracy <= 150) return 'cukup';
		return 'lemah';
	});

	// true selama watch masih mencoba memperbaiki akurasi (dipakai untuk hint "masih mencari
	// sinyal lebih baik", terpisah dari `locating` yang berhenti begitu bacaan PERTAMA masuk).
	let refiningLocation = $state(false);
	let stopWatchingPosition: (() => void) | null = null;
	function startWatchingLocation() {
		stopWatchingPosition?.();
		locating = true;
		refiningLocation = true;
		locationError = '';
		stopWatchingPosition = watchPositionUntilAccurate(
			(pos) => {
				position = pos;
				locating = false; // sudah dapat >=1 pembacaan — form tidak lagi terlihat "memuat"
				if (pos.accuracy <= 50) refiningLocation = false;
				// §3.2: hitung bacaan kasar (>=1000m) berturut-turut — indikasi "Lokasi perkiraan"
				// aktif di HP, bukan cuma sinyal lemah sesaat.
				bacaanKasarBerturut = pos.accuracy >= 1000 ? bacaanKasarBerturut + 1 : 0;
			},
			(err) => {
				locating = false;
				refiningLocation = false;
				if (!position) locationError = err.message; // fail-soft: kalau sudah ada bacaan lama, jangan timpa dengan error
			},
			{ targetAccuracyM: 50, timeoutMs: 20000 }
		);
		setTimeout(() => (refiningLocation = false), 20000);
	}

	// Alias lama dipakai tombol "Perbarui GPS" & retry manual — sama-sama mulai watch baru.
	function requestLocation() {
		startWatchingLocation();
	}

	onDestroy(() => stopWatchingPosition?.());

	// Peta Mini
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}

	let showCamera = $state(false);
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);
	// Paket 03 §3.3 — indikator selama watermark diproses (bisa beberapa detik di sinyal
	// lemah karena reverse-geocode + tile peta). Tanpa ini, orang awam mengira tombol
	// kamera "tidak merespons" dan memotret ulang / menutup aplikasi.
	let memprosesFoto = $state(false);

	let catatan = $state('');
	let submitting = $state(false);
	let errorMsg = $state('');
	// Paket 02 §3.6 — hasil submit terakhir, dipakai canSubmit (cegah tekan dobel setelah
	// "tersimpan di HP") dan kartu status di bawah tombol. Menggantikan `queuedOffline` lama
	// (di-set tapi TIDAK PERNAH dirender — bug SVR yang sudah tercatat).
	let hasil = $state<'terkirim' | 'tersimpan' | null>(null);

	const quickTags = [
		'🔍 Inspeksi Lapangan',
		'👷 Supervisi Tim',
		'🤝 Meeting Klien',
		'📦 Cek Material & Stok',
		'🛠️ Troubleshooting',
		'📋 Audit K3 / QC'
	];

	function addTag(tag: string) {
		const cleanTag = tag.replace(/^[^\w\s]+/, '').trim();
		if (!catatan.trim()) {
			catatan = cleanTag;
		} else if (!catatan.includes(cleanTag)) {
			catatan = `${catatan} • ${cleanTag}`;
		}
	}

	// Paket 02 §3.11 (SVR-04) — default aman dipakai HANYA saat settings gagal dimuat DAN
	// tidak ada cache sama sekali (mis. HP baru, belum pernah online di halaman ini).
	// Nilai dipilih paling KETAT (aman) — foto tetap diwajibkan, radius default wajar.
	const SETTINGS_DEFAULT_AMAN: SiteCheckinSettings = {
		foto_checkin_wajib: true,
		foto_checkout_wajib: false,
		radius_default_m: 300,
		min_durasi_menit: 15,
		max_durasi_jam: 16,
		auto_checkout_on_report: false,
		akurasi_maks_m: null,
		akurasi_mode: null,
		akurasi_enforce_from: null,
		visit_picker_hari: 7,
		maks_selisih_hari_klaim: 3
	};

	// Paket 07 §3.3 (SVR-14) — race fix: +page.svelte memuat booking secara ASYNC dan bisa
	// menetapkan presetProjectId SETELAH effect di bawah pertama kali jalan (mis. pengguna cepat
	// pilih tab lain sebelum booking termuat). pilihanManualProyek mencegah prefill menimpa pilihan
	// pengguna sendiri.
	let pilihanManualProyek = $state(false);
	$effect(() => {
		// Dibaca SINKRON (sebelum await manapun) supaya $effect ini benar-benar re-run setiap kali
		// presetProjectId berubah, bukan cuma sekali saat mount.
		const presetProjectIdSnapshot = presetProjectId;
		if (presetProjectIdSnapshot && !pilihanManualProyek && projects.some((p) => p.id === presetProjectIdSnapshot) && selectedProjectId !== presetProjectIdSnapshot) {
			selectedProjectId = presetProjectIdSnapshot;
		}
	});

	$effect(() => {
		(async () => {
			const uid = auth.currentUser?.uid || null;
			try {
				cekAbsenBkHariIni(); // fail-soft, tidak perlu ditunggu (Promise.all) — bukan pemblokir render
				startWatchingLocation(); // UX-02: GPS otomatis saat form dibuka, tidak menunggu leader menekan tombol

				// Paket 02 §3.11 (SVR-04, worst case C: offline total) — Promise.allSettled, BUKAN
				// Promise.all: satu gagal (mis. settings) TIDAK BOLEH menggagalkan yang lain (proyek)
				// seperti sebelumnya (satu gagal, dua-duanya hilang).
				const [projSettled, settingsSettled] = await Promise.allSettled([getMyProjects(), getSiteCheckinSettings()]);

				if (projSettled.status === 'fulfilled') {
					projects = projSettled.value.projects || [];
					assignedCount = projSettled.value.assignedCount || 0;
					if (uid) simpanCache(uid, 'projects', { projects, assignedCount });
					daftarDariCacheLabel = null;
				} else {
					const cached = uid ? bacaCache<{ projects: SiteCheckinProjectOption[]; assignedCount: number }>(uid, 'projects') : null;
					if (cached) {
						projects = cached.data.projects || [];
						assignedCount = cached.data.assignedCount || 0;
						daftarDariCacheLabel = labelDariCache(cached.savedAt);
					} else {
						offlineTanpaCache = true;
						errorMsg = 'Belum ada daftar proyek di HP ini. Buka menu ini sekali saat ada sinyal supaya bisa dipakai tanpa sinyal nanti.';
					}
				}

				if (settingsSettled.status === 'fulfilled') {
					settings = settingsSettled.value.settings;
					if (uid) simpanCache(uid, 'settings', settings);
				} else {
					const cached = uid ? bacaCache<SiteCheckinSettings>(uid, 'settings') : null;
					settings = cached?.data || SETTINGS_DEFAULT_AMAN;
				}

				// UX-03/Paket 04 §3.7: default ke tab Penugasan Anda kalau ada — tab "Kunjungan" perlu
				// dicari manual (kotak cari), tidak menampilkan daftar panjang begitu saja.
				activeTab = assignedCount > 0 ? 'assigned' : 'visit';

				// Fase 4 (§11.2.2b) — datang dari peminjaman kendaraan site_visit: proyek tujuan sudah ditentukan.
				if (presetProjectId && !pilihanManualProyek && projects.some((p) => p.id === presetProjectId)) {
					selectedProjectId = presetProjectId;
				} else if (!presetProjectId) {
					// Jika hanya ada 1 proyek penugasan, pilih otomatis
					const assigned = projects.filter((p) => p.peran !== 'kunjungan');
					if (assigned.length === 1) {
						selectedProjectId = assigned[0].id;
					} else if (projects.length === 1) {
						selectedProjectId = projects[0].id;
					} else {
						// UX-03: default ke proyek terakhir dipakai (localStorage) — leader dengan 2+
						// proyek tidak perlu mencari lagi tiap hari kalau kunjungannya masih sama.
						try {
							const lastId = Number(localStorage.getItem(LAST_PROJECT_KEY));
							if (Number.isFinite(lastId) && projects.some((p) => p.id === lastId)) {
								selectedProjectId = lastId;
							}
						} catch {
							/* localStorage tidak tersedia (mode privat dll) — abaikan, bukan fitur wajib */
						}
					}
				}
			} catch (e: any) {
				// Jaring pengaman — semua jalur yang bisa gagal di atas sudah gagal-lunak
				// (Promise.allSettled, try/catch localStorage), ini hanya untuk hal tak terduga.
				errorMsg = e?.message || 'Gagal memuat daftar proyek.';
			} finally {
				loadingProjects = false;
			}
		})();
	});

	const selectedProject = $derived(projects.find((p) => p.id === selectedProjectId) || null);

	// UX-03: proyek bernama identik (mis. 2 baris proyek dari SO yang sama) — tandai #id + status
	// di daftar supaya leader tidak salah pilih, tanpa membuat SETIAP baris berantakan dengan label.
	const duplicateProjectNames = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const p of projects) counts.set(p.name, (counts.get(p.name) || 0) + 1);
		return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name));
	});

	// Paket 04 §3.7 — tab "Semua" diganti kotak cari: tab 'visit' (proyek non-penugasan) tidak
	// menampilkan daftar panjang sampai user mengetik >=2 huruf (2G-friendly, dan mencari lewat
	// server bila daftar > 200 hasil awal, bukan cuma menyaring 200 yang sudah dimuat).
	let visitSearchResults = $state<SiteCheckinProjectOption[] | null>(null);
	let visitSearchLoading = $state(false);
	let visitSearchTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const q = projectSearchQuery.trim();
		if (activeTab !== 'visit' || q.length < 2) {
			visitSearchResults = null;
			clearTimeout(visitSearchTimer);
			return;
		}
		clearTimeout(visitSearchTimer);
		visitSearchTimer = setTimeout(async () => {
			visitSearchLoading = true;
			try {
				const r = await getMyProjects(q);
				visitSearchResults = r.projects.filter((p) => p.peran === 'kunjungan');
			} catch {
				/* fail-soft — tetap pakai 200 hasil awal yang sudah dimuat */
			} finally {
				visitSearchLoading = false;
			}
		}, 300);
	});

	// Filtered project list for searchable selector
	const filteredProjects = $derived.by(() => {
		if (activeTab === 'visit') {
			const q = projectSearchQuery.trim().toLowerCase();
			if (q.length < 2) return [];
			if (visitSearchResults) return visitSearchResults; // hasil dari server, sudah disaring nama
			return projects.filter((p) => p.peran === 'kunjungan' && (p.name.toLowerCase().includes(q) || (p.lokasi && p.lokasi.toLowerCase().includes(q))));
		}
		return projects.filter((p) => {
			if (activeTab === 'assigned' && p.peran === 'kunjungan') return false;
			if (!projectSearchQuery.trim()) return true;
			const q = projectSearchQuery.toLowerCase();
			return p.name.toLowerCase().includes(q) || (p.lokasi && p.lokasi.toLowerCase().includes(q));
		});
	});

	function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
		const R = 6371000;
		const toRad = (d: number) => (d * Math.PI) / 180;
		const dLat = toRad(lat2 - lat1);
		const dLng = toRad(lng2 - lng1);
		const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
		const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
		return Math.round(R * c);
	}

	// Geofence status calculation
	const geofenceInfo = $derived.by(() => {
		if (!position || !selectedProject || selectedProject.geo_lat == null || selectedProject.geo_lng == null) {
			return null;
		}
		const distanceM = haversineMeters(position.lat, position.lng, selectedProject.geo_lat, selectedProject.geo_lng);
		const radiusM = selectedProject.geo_radius_m || settings?.radius_default_m || 100;
		const isInside = distanceM <= radiusM;
		return {
			distanceM,
			radiusM,
			isInside,
			label: isInside
				? `Dalam radius area proyek (${distanceM}m dari titik pusat)`
				: `Di luar radius (${distanceM > 1000 ? (distanceM / 1000).toFixed(1) + ' km' : distanceM + 'm'} dari titik proyek)`
		};
	});

	async function handleCapture(file: File) {
		showCamera = false;
		memprosesFoto = true;
		try {
			const gps = position ? { lat: position.lat, lng: position.lng, accuracy: position.accuracy } : null;
			const namaTujuan = tipeKeperluan === 'maintenance' ? selectedWorkOrder?.equipment_name : selectedProject?.name;
			const stamped = await watermarkPhoto(file, gps, new Date().toISOString(), {
				lokasi: namaTujuan || undefined
			});
			if (photoPreview) URL.revokeObjectURL(photoPreview); // cegah kebocoran memori saat ambil ulang
			photoFile = stamped;
			photoPreview = URL.createObjectURL(stamped);
		} catch (e) {
			console.error('[site-checkin] watermark gagal, pakai foto asli', e);
			if (photoPreview) URL.revokeObjectURL(photoPreview);
			photoFile = file;
			photoPreview = URL.createObjectURL(file);
		} finally {
			memprosesFoto = false;
		}
	}

	function retakePhoto() {
		photoFile = null;
		photoPreview = null;
	}

	// R1 (Fase 0) — leader menyumbang koordinat proyek yang belum dipetakan (B6)
	let savingCoord = $state(false);
	let coordSaved = $state(false);
	let coordErr = $state('');
	// Paket 04 §3.6 (SVR-19) — dialog konfirmasi 2 langkah sebelum mematok titik proyek
	// (sebelumnya langsung tersimpan begitu tombol ditekan, terlalu mudah dipicu tanpa sadar).
	let showSimpanTitikDialog = $state(false);
	let SimpanTitikMap = $state<any>(null);
	async function bukaDialogSimpanTitik() {
		if (!SimpanTitikMap) SimpanTitikMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showSimpanTitikDialog = true;
	}
	async function konfirmasiSimpanTitik() {
		showSimpanTitikDialog = false;
		await handleSaveCoordinate();
	}

	async function handleSaveCoordinate() {
		if (!selectedProject || !position || savingCoord) return;
		savingCoord = true;
		coordErr = '';
		try {
			const r = await saveProjectCoordinate({
				projectId: selectedProject.id,
				lat: position.lat,
				lng: position.lng,
				accuracy: position.accuracy
			});
			// Perbarui daftar lokal supaya status geofence langsung muncul
			projects = projects.map((p) =>
				p.id === selectedProject!.id
					? { ...p, geo_lat: r.geo_lat, geo_lng: r.geo_lng, geo_radius_m: r.geo_radius_m }
					: p
			);
			coordSaved = true;
		} catch (e: any) {
			coordErr = e?.message || 'Gagal menyimpan koordinat proyek.';
		} finally {
			savingCoord = false;
		}
	}

	// UX-07: usulan koreksi koordinat (proyek SUDAH punya koordinat, tapi kelihatan salah) —
	// beda dari handleSaveCoordinate di atas yang untuk proyek TANPA koordinat sama sekali.
	let laporKoordinatLoading = $state(false);
	let koordinatUsulanTerkirim = $state(false);
	async function handleLaporKoordinatSalah() {
		if (!selectedProject || !position || laporKoordinatLoading) return;
		laporKoordinatLoading = true;
		try {
			await laporKoordinatProyekSalah({
				projectId: selectedProject.id,
				lat: position.lat,
				lng: position.lng,
				accuracy: position.accuracy
			});
			koordinatUsulanTerkirim = true;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal mengirim usulan koordinat.';
		} finally {
			laporKoordinatLoading = false;
		}
	}

	const fotoWajib = $derived(settings?.foto_checkin_wajib ?? true);
	const selectedReferensiId = $derived(tipeKeperluan === 'maintenance' ? selectedWorkOrderId : selectedProjectId);
	// Paket 04 Site Visit Release §3.2 — kartu panduan akurasi GPS. Mode efektif dihitung di
	// klien HANYA untuk UI (tampilkan/kunci tombol); server (createCheckin) tetap sumber
	// kebenaran final untuk penolakan mode `hard` — Aturan #3, tidak retroaktif.
	const akurasiBuruk = $derived(!!position && position.accuracy > (settings?.akurasi_maks_m ?? 500));
	const modeAkurasiEfektifKlien = $derived.by((): 'shadow' | 'soft' | 'hard' => {
		const mode = settings?.akurasi_mode;
		const enforceFrom = settings?.akurasi_enforce_from;
		if (mode !== 'hard' && mode !== 'soft') return 'shadow';
		if (!enforceFrom) return 'shadow';
		const hariIni = new Date().toISOString().slice(0, 10);
		return hariIni < String(enforceFrom).slice(0, 10) ? 'shadow' : mode;
	});
	const akurasiTerkunci = $derived(akurasiBuruk && modeAkurasiEfektifKlien === 'hard');

	// §3.2: deteksi izin lokasi "perkiraan" (bukan "tepat") — bacaan >=1000m berulang menandakan
	// setelan HP, bukan sekadar sinyal lemah sesaat, jadi langkah ② (izinkan Lokasi tepat)
	// ditonjolkan.
	let bacaanKasarBerturut = $state(0);

	const canSubmit = $derived(
		!!selectedReferensiId &&
		!!position &&
		(!fotoWajib || !!photoFile) &&
		!submitting &&
		!memprosesFoto &&
		!akurasiTerkunci &&
		hasil !== 'tersimpan'
	);

	const submitValidationMessage = $derived.by(() => {
		if (!selectedReferensiId) {
			return tipeKeperluan === 'maintenance' ? 'Pilih work order tujuan terlebih dahulu' : 'Pilih proyek tujuan terlebih dahulu';
		}
		if (!position) return 'Ambil lokasi GPS Anda';
		if (fotoWajib && !photoFile) return 'Ambil foto selfie bukti kehadiran';
		if (akurasiTerkunci) return 'Lokasi HP belum cukup tepat — ikuti langkah di atas lalu tekan Coba Lagi';
		return '';
	});

	// UX-03: ingat proyek terakhir dipakai (localStorage per perangkat) — dibaca lagi saat
	// form dibuka berikutnya bila leader punya 2+ proyek dan belum ada auto-select lain.
	function simpanProyekTerakhir() {
		if (tipeKeperluan !== 'proyek' || !selectedProjectId) return;
		try {
			localStorage.setItem(LAST_PROJECT_KEY, String(selectedProjectId));
		} catch {
			/* localStorage tidak tersedia — abaikan, bukan fitur wajib */
		}
	}

	async function handleSubmit() {
		if (!canSubmit || !selectedReferensiId || !position) return;
		submitting = true;
		errorMsg = '';
		hasil = null;

		const finalPhoto = photoFile ? await compressPhoto(photoFile) : null;
		if (!finalPhoto) {
			errorMsg = 'Foto wajib diambil saat check-in.';
			submitting = false;
			return;
		}

		// Paket 02 §3.6 (write-ahead) — client_txn_id dibuat SEKALI di sini dan dipakai baik
		// untuk entri antrean (bila offline) MAUPUN dikirim di percobaan online langsung.
		// Ini menutup SVR-01: kalau request online SEBENARNYA sukses di server tapi
		// responsnya hilang (jaringan putus tepat setelah itu), server tetap mengenali
		// client_txn_id yang sama pada percobaan berikutnya dan mengembalikan baris yang
		// sama — bukan membuat check-in kedua.
		const clientTxnId = crypto.randomUUID();
		// Antrean offline (write-ahead) SENGAJA hanya untuk tipe 'proyek' — kunjungan maintenance
		// offline menyusul paket 09 (jembatan mekanik_activity belum tentu aman direplay tanpa uji
		// terpisah). Maintenance offline tetap gagal terbuka (errorMsg di bawah), bukan salah
		// tersimpan diam-diam.
		const bolehOffline = tipeKeperluan === 'proyek';
		let entryTersimpan = false;

		try {
			if (bolehOffline) {
				await enqueueSiteCheckinSubmission({
					v: 2,
					client_txn_id: clientTxnId,
					type: 'checkin',
					status: 'pending',
					referensiId: selectedProjectId,
					tipeKeperluan,
					bookingId: presetBookingId,
					namaLokasi: selectedProject?.name ?? null,
					checkinId: null,
					lat: position.lat,
					lng: position.lng,
					accuracy: position.accuracy,
					photoBlob: finalPhoto,
					photoName: finalPhoto.name || 'checkin.jpg',
					catatan: catatan || null,
					kegiatan: null,
					temuan: null,
					tindakLanjut: null,
					rencanaBesok: null,
					createdAt: new Date().toISOString()
				});
				entryTersimpan = true;
			}

			const { record } = await submitCheckin({
				referensiId: selectedReferensiId,
				lat: position.lat,
				lng: position.lng,
				accuracy: position.accuracy,
				photoFile: finalPhoto,
				catatan: catatan || undefined,
				bookingId: presetBookingId,
				tipeKeperluan,
				// Online: TANPA clientCreatedAt (jam HP bisa salah; server pakai jam server).
				// clientTxnId TETAP dikirim — lihat catatan write-ahead di atas.
				clientTxnId
			});
			if (entryTersimpan) await removeQueuedSiteCheckinSubmission(clientTxnId).catch(() => {});
			hasil = 'terkirim';
			// Paket 09 §2.2 (SVR-27) — mekanik tanpa tautan personnel diberi tahu SEKARANG
			if (record?.peringatan) {
				alert(record.peringatan);
			}
			simpanProyekTerakhir();
			onSuccess();
		} catch (err) {
			if (entryTersimpan && isRetryableError(err)) {
				// Entri SUDAH tersimpan di antrean sebelum percobaan online di atas — biarkan,
				// siteCheckinSync.ts (sinkronisasi global) yang akan mengirimkannya nanti.
				hasil = 'tersimpan';
				simpanProyekTerakhir();
				onSuccess();
			} else if (!bolehOffline && isRetryableError(err)) {
				// Maintenance: TIDAK ada antrean offline (bolehOffline=false), jadi
				// pesanErrorAwam()'s teks "tersimpan di HP" akan BOHONG di sini — tidak ada apa
				// pun yang tersimpan. Pesan berbeda: gagal jaringan murni, coba lagi manual.
				errorMsg = 'Sinyal sedang lemah dan kunjungan tipe ini belum bisa disimpan offline. Coba lagi saat sinyal lebih baik.';
			} else {
				// Error PERMANEN (data ditolak server) — jangan tinggalkan entri sampah di
				// antrean kalau sempat ditulis (write-ahead menulis SEBELUM tahu hasilnya).
				if (entryTersimpan) await removeQueuedSiteCheckinSubmission(clientTxnId).catch(() => {});
				errorMsg = pesanErrorAwam(err);
			}
		} finally {
			submitting = false;
		}
	}

	function getPeranBadge(peran: string) {
		switch (peran) {
			case 'leader':
				return { label: 'Project Leader', bg: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800' };
			case 'manpower_leader':
				return { label: 'Manpower Leader', bg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800' };
			case 'wakil_leader':
				return { label: 'Wakil Leader', bg: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-800' };
			case 'anggota_regu':
				return { label: 'Anggota Regu', bg: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800' };
			default:
				return { label: 'Kunjungan / Site Visit', bg: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700' };
		}
	}
</script>

<div class="flex flex-col gap-4">
	{#if presetBookingId}
		<div class="rounded-2xl border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-3.5 flex items-center gap-2.5">
			<IconShieldCheck size={18} class="text-blue-600 dark:text-blue-400 shrink-0" />
			<p class="text-xs font-semibold text-blue-800 dark:text-blue-200">
				<!-- Paket 07 §3.3 — teks HANYA klaim "sudah terisi otomatis" bila memang terisi
				     (presetProjectId ada); selector tipe tetap dipilih sendiri, tidak pernah tersirat "sudah lengkap". -->
				{#if presetProjectId}
					🚗 Terhubung ke peminjaman {presetBookingCode}. Proyek tujuan sudah terisi otomatis — tetap pilih jenis kunjungan: Proyek / Maintenance.
				{:else}
					🚗 Terhubung ke peminjaman {presetBookingCode}. Pilih tujuan kunjungan Anda.
				{/if}
			</p>
		</div>
	{/if}

	<!-- SV-09: peringatan belum absen masuk (BK) — TANPA ini, lokasi kunjungan hari ini tidak
	     akan tercatat untuk tunjangan sama sekali, walau check-in/check-out lengkap. -->
	{#if sudahAbsenBk === false && tipeKeperluan === 'proyek'}
		<div class="rounded-2xl border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3.5 flex items-start gap-2.5" transition:slide>
			<IconAlertTriangle size={18} class="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
			<div class="min-w-0 flex-1">
				<p class="text-xs font-bold text-amber-900 dark:text-amber-200">Anda belum absen masuk hari ini</p>
				<p class="text-[11px] text-amber-800/90 dark:text-amber-300/90 mt-0.5">
					Lokasi kunjungan ini tidak akan tercatat untuk tunjangan sampai Anda absen masuk.
				</p>
				<!-- U1 (disetujui HRD): absen masuk sekaligus dari sini — memakai GPS & foto form ini,
				     lewat endpoint clock-in ESS yang sama (validasi/anti-fake-GPS/face verify tidak berubah). -->
				<button
					type="button"
					class="mt-2 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-3 py-1.5 rounded-lg inline-flex items-center gap-1"
					onclick={handleAbsenMasukSekaligus}
					disabled={!position || !photoFile || absenSekaligusLoading}
				>
					{absenSekaligusLoading ? 'Mengirim absen...' : '✅ Absen Masuk Sekarang'}
				</button>
				{#if !position || !photoFile}
					<p class="text-[10px] text-amber-800/80 dark:text-amber-300/80 mt-1">Ambil GPS dan foto di bawah dulu — dipakai untuk absen masuk sekaligus check-in.</p>
				{/if}
				{#if absenSekaligusError}
					<p class="text-[11px] text-rose-600 mt-1">{absenSekaligusError}</p>
				{/if}
				<a
					href="/ess/absen"
					class="inline-flex items-center gap-1 mt-2 text-[11px] font-bold text-amber-900 dark:text-amber-200 underline underline-offset-2"
				>
					Buka halaman Absensi →
				</a>
			</div>
		</div>
	{/if}

	<!-- 0. TYPE SELECTOR (Fase 3 "4-Gate Site Visit System") — Paket 07 §3.3 (SVR-14): SELALU
	     tampil, tidak pernah disembunyikan karena booking terhubung. Sebelumnya check-in yang
	     datang dari booking kendaraan memaksa tipe='peminjaman_kendaraan' server-side dan
	     menyembunyikan selector ini, membuat sales/mekanik tidak bisa memilih Marketing/Maintenance.
	     Paket 08a: tombol "Marketing" diganti tautan "Sales ↗" ke /sales/baru (satu-satunya pintu
	     kunjungan customer/prospek sekarang, keputusan Opsi 1) — hanya untuk pemegang izin
	     input_sales (atau super admin). -->
	<div class="rounded-2xl border bg-white dark:bg-slate-900 p-2 shadow-2xs border-slate-200/80 dark:border-slate-800 flex items-center gap-1.5">
		<button
			type="button"
			class="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all {tipeKeperluan === 'proyek' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}"
			onclick={() => (tipeKeperluan = 'proyek')}
		>
			<IconBuildingFactory2 size={16} /> Proyek
		</button>
		{#if bolehInputSales}
			<a
				href="/sales/baru"
				class="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
			>
				<IconExternalLink size={16} /> Sales
			</a>
		{/if}
		{#if settings?.tipe_maintenance_aktif}
			<button
				type="button"
				class="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all {tipeKeperluan === 'maintenance' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}"
				onclick={() => (tipeKeperluan = 'maintenance')}
			>
				<IconTool size={16} /> Maintenance
			</button>
		{/if}
	</div>
	{#if bolehInputSales}
		<p class="text-[11px] text-slate-400 dark:text-slate-500 -mt-2">
			Kunjungan ke customer atau prospek sekarang dicatat di menu <strong>Sales → Kunjungan Baru</strong>.
		</p>
	{/if}

	<!-- 1c. SELEKSI WORK ORDER TUJUAN (tipe maintenance) -->
	{#if tipeKeperluan === 'maintenance'}
		<div class="rounded-2xl border bg-white dark:bg-slate-900 p-4 shadow-2xs border-slate-200/80 dark:border-slate-800">
			<div class="flex items-center justify-between mb-2">
				<label for="wo-select-btn" class="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
					<IconTool size={16} class="text-blue-600 dark:text-blue-400" />
					Work Order Tujuan
				</label>
				{#if selectedWorkOrder?.peran === 'assigned'}
					<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800">
						WO Anda
					</span>
				{/if}
			</div>

			{#if loadingWorkOrders}
				<div class="py-3 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/50"><CircularProgressGauge size={42} strokeWidth={3} label="Memuat daftar work order..." /></div>
			{:else if workOrders.length === 0 && workOrdersLoaded}
				<div class="rounded-xl p-3.5 bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
					<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-amber-600" />
					<div>
						<p class="text-xs font-bold">Belum Ada Work Order Terbuka</p>
						<p class="text-[11px] opacity-90 mt-0.5">Tidak ditemukan WO yang belum selesai. Buat WO baru di modul Maintenance terlebih dahulu.</p>
					</div>
				</div>
			{:else}
				<button
					id="wo-select-btn"
					type="button"
					class="w-full text-left p-3 rounded-xl border bg-slate-50/70 dark:bg-slate-800/60 hover:bg-slate-100/80 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all flex items-center justify-between gap-3 group shadow-2xs"
					onclick={() => (isWorkOrderSelectorOpen = !isWorkOrderSelectorOpen)}
				>
					<div class="min-w-0 flex-1">
						{#if selectedWorkOrder}
							<p class="text-sm font-bold text-slate-900 dark:text-slate-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
								{selectedWorkOrder.wo_number || `WO #${selectedWorkOrder.id}`}
							</p>
							<p class="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
								{selectedWorkOrder.equipment_name || 'Unit tidak diketahui'}
							</p>
						{:else}
							<p class="text-xs font-medium text-slate-400 dark:text-slate-500">
								Pilih work order yang akan Anda kerjakan...
							</p>
						{/if}
					</div>
					<span class="text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/80 dark:border-blue-800 shrink-0">
						{isWorkOrderSelectorOpen ? 'Tutup' : 'Cari / Ganti'}
					</span>
				</button>

				{#if isWorkOrderSelectorOpen}
					<div transition:slide={{ duration: 180 }} class="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800 flex flex-col gap-2">
						<div class="relative">
							<IconSearch size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
							<input
								type="text"
								class="w-full h-10 pl-9 pr-3 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100"
								placeholder="Cari nomor WO atau unit..."
								bind:value={workOrderSearchQuery}
							/>
						</div>

						<div class="max-h-56 overflow-y-auto flex flex-col gap-1.5 pr-0.5">
							{#if filteredWorkOrders.length === 0}
								<p class="text-xs text-slate-400 dark:text-slate-500 py-3 text-center">Tidak ada WO yang sesuai filter pencarian.</p>
							{:else}
								{#each filteredWorkOrders as w (w.id)}
									<button
										type="button"
										class="w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 {w.id === selectedWorkOrderId ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-400 dark:border-blue-600' : 'bg-slate-50/40 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200/70 dark:border-slate-700/70'}"
										onclick={() => {
											selectedWorkOrderId = w.id;
											isWorkOrderSelectorOpen = false;
										}}
									>
										<div class="min-w-0 flex-1">
											<p class="text-xs font-bold truncate {w.id === selectedWorkOrderId ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-200'}">
												{w.wo_number || `WO #${w.id}`}
											</p>
											<p class="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
												{w.equipment_name || 'Unit tidak diketahui'}
											</p>
										</div>
										{#if w.id === selectedWorkOrderId}
											<IconCheck size={16} class="text-blue-600 dark:text-blue-400 shrink-0" />
										{/if}
									</button>
								{/each}
							{/if}
						</div>
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- 1. SELEKSI PROYEK TUJUAN -->
	{#if tipeKeperluan === 'proyek'}
	<div class="rounded-2xl border bg-white dark:bg-slate-900 p-4 shadow-2xs border-slate-200/80 dark:border-slate-800">
		<div class="flex items-center justify-between mb-2">
			<label for="project-select-btn" class="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
				<IconBuildingFactory2 size={16} class="text-blue-600 dark:text-blue-400" />
				Proyek Tujuan
			</label>
			{#if selectedProject}
				<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full border {getPeranBadge(selectedProject.peran).bg}">
					{getPeranBadge(selectedProject.peran).label}
				</span>
			{/if}
		</div>

		{#if loadingProjects}
			<div class="flex items-center gap-2.5 py-4 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500">
				<IconLoader2 size={16} class="animate-spin text-blue-600" /> Memuat daftar proyek operasional...
			</div>
		{:else if offlineTanpaCache}
			<!-- Paket 02 §3.11 (SVR-04) — offline total, belum pernah ada cache di HP ini. -->
			<div class="rounded-xl p-3.5 bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
				<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-amber-600" />
				<div>
					<p class="text-xs font-bold">Belum Ada Sinyal &amp; Belum Ada Daftar Tersimpan</p>
					<p class="text-[11px] opacity-90 mt-0.5">Belum ada daftar proyek di HP ini. Buka menu ini sekali saat ada sinyal supaya bisa dipakai tanpa sinyal nanti.</p>
				</div>
			</div>
		{:else if projects.length === 0}
			<div class="rounded-xl p-3.5 bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
				<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-amber-600" />
				<div>
					<p class="text-xs font-bold">Belum Ada Proyek Aktif</p>
					<p class="text-[11px] opacity-90 mt-0.5">Tidak ditemukan proyek aktif di database. Hubungi admin proyek atau HRD.</p>
				</div>
			</div>
		{:else}
			{#if daftarDariCacheLabel}
				<p class="text-[10px] font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1 mb-1.5">
					<IconAlertTriangle size={12} class="shrink-0" /> {daftarDariCacheLabel}
				</p>
			{/if}
			<!-- Trigger Button for Project Selector Combobox -->
			<button
				id="project-select-btn"
				type="button"
				class="w-full text-left p-3 rounded-xl border bg-slate-50/70 dark:bg-slate-800/60 hover:bg-slate-100/80 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all flex items-center justify-between gap-3 group shadow-2xs"
				onclick={() => (isProjectSelectorOpen = !isProjectSelectorOpen)}
			>
				<div class="min-w-0 flex-1">
					{#if selectedProject}
						<p class="text-sm font-bold text-slate-900 dark:text-slate-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
							{selectedProject.name}
						</p>
						<p class="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 flex items-center gap-1">
							<IconMapPin size={13} class="shrink-0 text-slate-400" />
							{selectedProject.lokasi || 'Lokasi umum'}
						</p>
					{:else}
						<p class="text-xs font-medium text-slate-400 dark:text-slate-500">
							Pilih proyek yang akan Anda kunjungi...
						</p>
					{/if}
				</div>
				<span class="text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/80 dark:border-blue-800 shrink-0">
					{isProjectSelectorOpen ? 'Tutup' : 'Cari / Ganti'}
				</span>
			</button>

			<!-- Expandable Searchable Combobox -->
			{#if isProjectSelectorOpen}
				<div transition:slide={{ duration: 180 }} class="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800 flex flex-col gap-2">
					<!-- Search Input -->
					<div class="relative">
						<IconSearch size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
						<input
							type="text"
							class="w-full h-10 pl-9 pr-3 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100"
							placeholder={activeTab === 'visit' ? 'Cari proyek lain… (min. 2 huruf)' : 'Cari nama atau lokasi proyek...'}
							bind:value={projectSearchQuery}
						/>
					</div>

					<!-- Paket 04 §3.7 — tab "Semua" dihapus; hanya Penugasan Anda vs Kunjungan (dicari manual). -->
					{#if assignedCount > 0}
						<div class="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-[11px] font-semibold">
							<button
								type="button"
								class="flex-1 py-1 rounded-lg transition-all text-center {activeTab === 'assigned' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs font-bold' : 'text-slate-500 hover:text-slate-800'}"
								onclick={() => (activeTab = 'assigned')}
							>
								🎯 Penugasan Anda ({assignedCount})
							</button>
							<button
								type="button"
								class="flex-1 py-1 rounded-lg transition-all text-center {activeTab === 'visit' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs font-bold' : 'text-slate-500 hover:text-slate-800'}"
								onclick={() => (activeTab = 'visit')}
							>
								🌐 Kunjungan lain
							</button>
						</div>
					{/if}

					<!-- Projects List Items -->
					<div class="max-h-56 overflow-y-auto flex flex-col gap-1.5 pr-0.5">
						{#if activeTab === 'visit' && projectSearchQuery.trim().length < 2}
							<p class="text-xs text-slate-400 dark:text-slate-500 py-3 text-center">Ketik minimal 2 huruf nama proyek untuk mencari.</p>
						{:else if activeTab === 'visit' && visitSearchLoading}
							<p class="text-xs text-slate-400 dark:text-slate-500 py-3 text-center flex items-center justify-center gap-1.5">
								<IconLoader2 size={13} class="animate-spin" /> Mencari...
							</p>
						{:else if filteredProjects.length === 0}
							<p class="text-xs text-slate-400 dark:text-slate-500 py-3 text-center">Tidak ada proyek yang sesuai filter pencarian.</p>
						{:else}
							{#each filteredProjects as p (p.id)}
								<button
									type="button"
									class="w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 {p.id === selectedProjectId ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-400 dark:border-blue-600' : 'bg-slate-50/40 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200/70 dark:border-slate-700/70'}"
									onclick={() => {
										selectedProjectId = p.id;
										isProjectSelectorOpen = false;
										// Paket 07 §3.3 — pengguna memilih manual: jangan pernah timpa lagi
										// dengan prefill booking (race fix di bawah).
										pilihanManualProyek = true;
									}}
								>
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-1.5">
											<p class="text-xs font-bold truncate {p.id === selectedProjectId ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-200'}">
												{p.name}
											</p>
											{#if p.peran !== 'kunjungan'}
												<span class="text-[9px] font-bold px-1.5 py-0.2 rounded border {getPeranBadge(p.peran).bg}">
													{getPeranBadge(p.peran).label}
												</span>
											{/if}
										</div>
										<p class="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
											{p.lokasi || 'Lokasi umum'}
											<!-- UX-03: proyek ganda (nama sama persis) — beri penanda #id + status supaya tidak salah pilih -->
											{#if duplicateProjectNames.has(p.name)}
												<span class="font-semibold text-slate-500 dark:text-slate-400">· #{p.id}{p.status ? ` · ${p.status}` : ''}</span>
											{/if}
										</p>
									</div>
									{#if p.id === selectedProjectId}
										<IconCheck size={16} class="text-blue-600 dark:text-blue-400 shrink-0" />
									{/if}
								</button>
							{/each}
						{/if}
					</div>
				</div>
			{/if}

			<!-- UX-04: kartu status payroll — tier yang akan dicatat ke absensi, atau peringatan
			     jujur kalau belum bisa. Ganti kesan lama "tetap dicatat sebagai bukti" yang menutupi
			     bahwa kunjungan ini mungkin TIDAK menambah tunjangan sama sekali (SV-01/SV-08). -->
			{#if selectedProject}
				<div class="mt-2.5 p-2.5 rounded-xl border text-[11px] {selectedProject.tier_absensi ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200'}">
					{#if selectedProject.tier_absensi}
						<span class="font-bold flex items-center gap-1"><IconCheck size={13} /> Tercatat untuk tunjangan: {selectedProject.tier_absensi}</span>
					{:else}
						<span class="font-bold flex items-center gap-1"><IconAlertTriangle size={13} /> Tier proyek belum diatur admin</span>
						<p class="opacity-90 mt-0.5">Kunjungan tetap dicatat, tapi tunjangan lokasi menunggu admin mengisi tier proyek ini.</p>
					{/if}
				</div>
			{/if}

			<!-- Selected Project Geofence Status Note -->
			{#if selectedProject}
				<div class="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[11px]">
					{#if selectedProject.geo_lat}
						<span class="text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1">
							<IconShieldCheck size={14} /> Koordinat terdaftar (Radius geofence: {selectedProject.geo_radius_m || settings?.radius_default_m || 100}m)
						</span>
					{:else if coordSaved}
						<span class="text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1">
							<IconCheck size={14} /> Titik proyek berhasil dipetakan dari lokasi Anda. Terima kasih!
						</span>
					{:else}
						<div class="flex flex-col gap-1.5">
							<span class="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
								<IconAlertTriangle size={14} /> Titik proyek ini belum dipetakan
							</span>
							{#if selectedProject.peran === 'kunjungan'}
								<span class="text-slate-400 dark:text-slate-500">Hanya leader proyek ini yang bisa memetakan titik.</span>
							{:else if position}
								<!-- Paket 04 §3.6 — tombol membuka dialog konfirmasi, TIDAK langsung menyimpan. -->
								<button
									type="button"
									class="self-start text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 shadow-2xs"
									onclick={bukaDialogSimpanTitik}
									disabled={savingCoord}
								>
									{#if savingCoord}
										<IconLoader2 size={12} class="animate-spin" /> Menyimpan...
									{:else}
										<IconMapPin size={12} /> Simpan Titik Ini sebagai Koordinat Proyek
									{/if}
								</button>
								<span class="text-slate-400 dark:text-slate-500 leading-relaxed">
									Lakukan ini <b>hanya bila Anda benar-benar berada di area proyek</b>. Koordinat langsung dipakai untuk validasi geofence kunjungan berikutnya; perubahan setelahnya lewat GA.
								</span>
								{#if coordErr}
									<span class="text-rose-600 dark:text-rose-400 font-medium">{coordErr}</span>
								{/if}
							{:else}
								<span class="text-slate-400 dark:text-slate-500">Ambil lokasi GPS Anda dulu untuk bisa membantu memetakan titik proyek ini.</span>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
	{/if}

	<!-- 2. DETEKSI LOKASI & GEOFENCE -->
	<div class="rounded-2xl border bg-white dark:bg-slate-900 p-4 shadow-2xs border-slate-200/80 dark:border-slate-800">
		<div class="flex items-center justify-between mb-2">
			<span class="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
				<IconCompass size={16} class="text-emerald-600 dark:text-emerald-400" />
				Lokasi Anda (GPS)
			</span>
			{#if position}
				<button
					type="button"
					class="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1"
					onclick={requestLocation}
					disabled={locating}
				>
					{#if locating}<IconLoader2 size={12} class="animate-spin" />{:else}Perbarui GPS{/if}
				</button>
			{/if}
		</div>

		{#if locating && !position}
			<div class="py-4 px-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/50 flex items-center gap-2.5 text-xs text-blue-700 dark:text-blue-300">
				<IconLoader2 size={16} class="animate-spin text-blue-600" />
				<span>Mendeteksi koordinat GPS perangkat Anda dengan akurasi tinggi...</span>
			</div>
		{:else if locationError && !position}
			<div class="rounded-xl p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300">
				<p class="text-xs font-semibold flex items-center gap-1.5">
					<IconAlertTriangle size={15} /> {locationError}
				</p>
				<button
					type="button"
					class="mt-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-lg inline-flex items-center gap-1 shadow-2xs"
					onclick={requestLocation}
				>
					Coba Ambil Lokasi Ulang
				</button>
			</div>
		{:else if position}
			<div class="flex flex-col gap-2.5">
				<!-- UX-02: indikator kualitas GPS — 🟢 akurat, 🟡 cukup, 🔴 lemah (pindah ke tempat terbuka) -->
				<div class="p-3 rounded-xl border flex items-center justify-between gap-3 {gpsQuality === 'baik' ? 'bg-emerald-500/10 border-emerald-500/30' : gpsQuality === 'cukup' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-rose-500/10 border-rose-500/30'}">
					<div class="flex items-center gap-2.5 min-w-0">
						<div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 {gpsQuality === 'baik' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : gpsQuality === 'cukup' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'}">
							<IconMapPin size={18} />
						</div>
						<div class="min-w-0">
							<p class="text-xs font-bold {gpsQuality === 'baik' ? 'text-emerald-900 dark:text-emerald-200' : gpsQuality === 'cukup' ? 'text-amber-900 dark:text-amber-200' : 'text-rose-900 dark:text-rose-200'}">
								{gpsQuality === 'baik' ? '🟢 Sinyal Akurat' : gpsQuality === 'cukup' ? '🟡 Sinyal Cukup' : '🔴 Sinyal Lemah'}
								{#if refiningLocation}<span class="font-normal opacity-70">— menyempurnakan...</span>{/if}
							</p>
							<p class="text-[11px] opacity-80 truncate">
								{position.lat.toFixed(6)}, {position.lng.toFixed(6)} (±{Math.round(position.accuracy)}m)
							</p>
						</div>
					</div>
					<button
						type="button"
						class="text-[11px] font-bold bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 px-2.5 py-1.5 rounded-lg shrink-0 flex items-center gap-1"
						onclick={toggleLocationMap}
					>
						<IconMap2 size={13} /> {showLocationMap ? 'Tutup Peta' : 'Lihat Peta'}
					</button>
				</div>
				{#if gpsQuality === 'lemah'}
					<p class="text-[11px] text-rose-600 dark:text-rose-400 -mt-1 flex items-center gap-1">
						<IconInfoCircle size={13} class="shrink-0" /> Pindah ke tempat terbuka / dekat jendela, lalu tekan "Perbarui GPS".
					</p>
				{/if}

				<!-- Paket 04 Site Visit Release §3.2 — kartu panduan akurasi buruk (bukan sekadar teks
				     kecil). Hanya tampil setelah watch GPS selesai (!refiningLocation), supaya tidak
				     berkedip saat bacaan pertama masih kasar sebelum sempat diperhalus. -->
				{#if akurasiBuruk && !refiningLocation}
					<div class="p-3.5 rounded-xl border-2 {akurasiTerkunci ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-400 dark:border-rose-800' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-400 dark:border-amber-800'}">
						<p class="text-xs font-bold flex items-center gap-1.5 {akurasiTerkunci ? 'text-rose-800 dark:text-rose-200' : 'text-amber-800 dark:text-amber-200'}">
							<IconMapPin size={15} class="shrink-0" /> Lokasi HP Anda kurang tepat (±{(position.accuracy / 1000).toFixed(1)} km)
						</p>
						<p class="text-[11px] mt-1 opacity-90 {akurasiTerkunci ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}">
							Biasanya karena pengaturan "Lokasi akurat" mati.
						</p>
						<ol class="text-[11px] mt-1.5 space-y-0.5 list-decimal list-inside {akurasiTerkunci ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}">
							<li>Buka <strong>Setelan → Lokasi</strong> → nyalakan <strong>Akurasi lokasi / Lokasi akurat</strong></li>
							<li class={bacaanKasarBerturut >= 2 ? 'font-bold' : ''}>Izinkan aplikasi memakai <strong>Lokasi tepat</strong>{bacaanKasarBerturut >= 2 ? ' — ini kemungkinan penyebabnya' : ''}</li>
							<li>Keluar ke tempat terbuka, lalu tekan tombol di bawah</li>
						</ol>
						<p class="text-[11px] mt-1.5 italic opacity-80 {akurasiTerkunci ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}">
							{#if akurasiTerkunci}
								Check-in belum bisa dikirim sampai lokasi cukup akurat.
							{:else}
								(Tetap bisa check-in, tapi kunjungan ini perlu dicek HRD dulu sebelum masuk tunjangan.)
							{/if}
						</p>
						<button
							type="button"
							class="mt-2 text-xs font-bold text-white {akurasiTerkunci ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'} px-3 py-1.5 rounded-lg inline-flex items-center gap-1 shadow-2xs"
							onclick={requestLocation}
						>
							Coba Lagi
						</button>
					</div>
				{/if}

				<!-- Geofence Proximity Feedback if project is selected -->
				{#if geofenceInfo}
					<div class="p-3 rounded-xl border flex items-center gap-2.5 {geofenceInfo.isInside ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800/60 text-amber-800 dark:text-amber-200'}">
						{#if geofenceInfo.isInside}
							<IconShieldCheck size={18} class="text-emerald-600 dark:text-emerald-400 shrink-0" />
							<div class="min-w-0">
								<!-- UX-08: label "Presisi" hanya bila akurasi GPS benar-benar tinggi (<=50m) -->
								<p class="text-xs font-bold">Dalam Radius Proyek{position.accuracy <= 50 ? ' (Presisi)' : ''}</p>
								<p class="text-[11px] opacity-90">{geofenceInfo.label}</p>
							</div>
						{:else}
							<IconAlertTriangle size={18} class="text-amber-600 dark:text-amber-400 shrink-0" />
							<div class="min-w-0 flex-1">
								<p class="text-xs font-bold">Di Luar Titik Pusat Proyek</p>
								<!-- UX-04: teks jujur — di luar geofence berarti kunjungan ditandai anomali di
								     sistem (skor GPS/geofence dicek HRD), bukan sekadar "tetap dicatat" tanpa
								     konsekuensi. -->
								<p class="text-[11px] opacity-90">{geofenceInfo.label} — Kunjungan tetap tersimpan, tapi ditandai di luar geofence untuk ditinjau HRD.</p>
								<!-- UX-07: kalau ini terjadi TIAP kunjungan, kemungkinan koordinat proyek yang
								     salah, bukan leader-nya. Usulan GPS leader masuk antrean GA, tidak langsung
								     menimpa koordinat final. -->
								{#if !koordinatUsulanTerkirim}
									<button
										type="button"
										class="mt-1.5 text-[11px] font-bold text-amber-800 dark:text-amber-300 underline underline-offset-2 disabled:opacity-50"
										onclick={handleLaporKoordinatSalah}
										disabled={laporKoordinatLoading}
									>
										{laporKoordinatLoading ? 'Mengirim...' : '📍 Koordinat proyek salah?'}
									</button>
								{:else}
									<p class="mt-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">✅ Usulan koordinat terkirim ke GA, terima kasih.</p>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Map Preview (Lazy Loaded MapLibre) -->
				{#if showLocationMap && LocationMap}
					<div transition:slide={{ duration: 200 }} class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
						<LocationMap lat={position.lat} lng={position.lng} label="Lokasi Check-in Anda" height="200px" />
					</div>
				{/if}
			</div>
		{:else}
			<button
				type="button"
				class="w-full py-3.5 px-4 rounded-xl font-bold text-xs text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 transition-all flex items-center justify-center gap-2 shadow-2xs active:scale-[0.99]"
				onclick={requestLocation}
			>
				<IconMapPin size={17} /> Ambil Lokasi GPS Anda
			</button>
		{/if}
	</div>

	<!-- 3. FOTO BUKTI KEHADIRAN (WATERMARK) -->
	<div class="rounded-2xl border bg-white dark:bg-slate-900 p-4 shadow-2xs border-slate-200/80 dark:border-slate-800">
		<div class="flex items-center justify-between mb-2">
			<span class="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
				<IconCamera size={16} class="text-purple-600 dark:text-purple-400" />
				Foto Bukti Kunjungan
				{#if !fotoWajib}<span class="text-[10px] lowercase text-slate-400">(opsional)</span>{/if}
			</span>
			{#if photoPreview}
				<span class="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
					<IconCheck size={13} /> Ter-watermark
				</span>
			{/if}
		</div>

		{#if photoPreview}
			<div class="flex items-center gap-3">
				<div class="relative w-24 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-2xs shrink-0 group">
					<img src={photoPreview} alt="Bukti Foto" class="w-full h-full object-cover" />
					<button
						type="button"
						class="absolute top-1 right-1 w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-md hover:bg-rose-700 transition-all"
						onclick={retakePhoto}
						title="Hapus foto"
					>
						<IconX size={13} />
					</button>
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-xs font-bold text-slate-800 dark:text-slate-200">Foto Siap Digunakan</p>
					<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
						Dilengkapi stempel digital waktu & titik GPS untuk integritas audit.
					</p>
					<button
						type="button"
						class="mt-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
						onclick={() => (showCamera = true)}
					>
						Ambil Ulang Foto
					</button>
				</div>
			</div>
		{:else if memprosesFoto}
			<!-- Paket 03 §3.3/§4 — indikator wajib selama watermark diproses. -->
			<div class="w-full py-3.5 px-4 rounded-xl font-bold text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 flex items-center justify-center gap-2">
				<IconLoader2 size={17} class="animate-spin" />
				⏳ Memproses foto… Mohon tunggu, jangan tutup aplikasi.
			</div>
		{:else}
			<!-- UX-08: tombol foto aktif setelah GPS didapat — watermark foto butuh koordinat, dan
			     memaksa urutan GPS dulu-baru-foto mencegah foto tanpa titik lokasi. -->
			<button
				type="button"
				class="w-full py-3.5 px-4 rounded-xl font-bold text-xs text-white bg-purple-600 hover:bg-purple-700 transition-all flex items-center justify-center gap-2 shadow-2xs active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
				onclick={() => (showCamera = true)}
				disabled={!position}
			>
				<IconCamera size={17} /> Ambil Foto (wajah + lokasi)
			</button>
			{#if !position}
				<p class="text-[11px] text-slate-400 dark:text-slate-500 text-center mt-1.5">Ambil lokasi GPS dulu di atas sebelum foto.</p>
			{:else}
				<p class="text-[11px] text-slate-400 dark:text-slate-500 text-center mt-1.5">Foto otomatis diberi tanggal, jam, dan titik GPS. Tidak bisa diedit.</p>
			{/if}
		{/if}
	</div>

	<!-- 4. CATATAN & QUICK TAGS -->
	<div class="rounded-2xl border bg-white dark:bg-slate-900 p-4 shadow-2xs border-slate-200/80 dark:border-slate-800">
		<div class="flex items-center justify-between mb-2">
			<label for="checkin-notes-area" class="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
				<IconSparkles size={16} class="text-amber-500" />
				Catatan Kunjungan <span class="text-[10px] lowercase text-slate-400">(opsional)</span>
			</label>
		</div>

		<!-- Quick Activity Tag Chips -->
		<div class="flex flex-wrap gap-1.5 mb-2.5">
			{#each quickTags as tag}
				<button
					type="button"
					class="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/60 hover:text-blue-600 dark:hover:text-blue-400 border border-slate-200/80 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 transition-all active:scale-95"
					onclick={() => addTag(tag)}
				>
					{tag}
				</button>
			{/each}
		</div>

		<textarea
			id="checkin-notes-area"
			class="w-full px-3.5 py-2.5 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 transition-all"
			rows="2"
			bind:value={catatan}
			placeholder="Tuliskan tujuan atau ringkasan singkat kehadiran di lokasi ini..."
		></textarea>
	</div>

	<!-- Paket 02 §4 — kartu "Tersimpan di HP". State lamanya (queuedOffline) di-set tapi
	     TIDAK PERNAH dirender — bug ini sudah diperbaiki di sini. -->
	{#if hasil === 'tersimpan'}
		<div transition:slide={{ duration: 150 }} class="rounded-xl p-3.5 bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
			<IconInfoCircle size={16} class="shrink-0 text-amber-600 mt-0.5" />
			<span>📱 <strong>Tersimpan di HP</strong> — sinyal lemah. Jangan tekan lagi, data akan terkirim otomatis saat ada sinyal.</span>
		</div>
	{/if}

	<!-- Error Alert -->
	{#if errorMsg}
		<div transition:slide={{ duration: 150 }} class="rounded-xl p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
			<IconAlertTriangle size={16} class="shrink-0 text-rose-600" />
			<span>{errorMsg}</span>
		</div>
	{/if}

	<!-- 5. ACTION SUBMIT BUTTON -->
	<div class="flex flex-col gap-1.5">
		<button
			type="button"
			class="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
			style="background: linear-gradient(135deg, #1E40AF 0%, #2563EB 100%)"
			disabled={!canSubmit}
			onclick={handleSubmit}
		>
			{#if submitting}
				<IconLoader2 size={18} class="animate-spin" /> Menyimpan Check-in...
			{:else}
				<IconCheck size={18} /> Check-In Sekarang
			{/if}
		</button>

		{#if submitValidationMessage && !canSubmit}
			<p class="text-[11px] text-center text-slate-400 dark:text-slate-500 flex items-center justify-center gap-1">
				<IconInfoCircle size={13} /> {submitValidationMessage}
			</p>
		{/if}
	</div>
</div>

{#if showCamera}
	<!-- Paket 03 §3.5 — keputusan HR: check-in wajib menyertakan wajah (29 Sep 2026). -->
	<CameraCaptureModal facing="user" onCapture={handleCapture} onClose={() => (showCamera = false)} />
{/if}

<!-- Paket 04 §3.6 — dialog konfirmasi 2 langkah "Simpan Titik Ini sebagai Koordinat Proyek". -->
{#if showSimpanTitikDialog && selectedProject && position}
	<div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3" transition:fade={{ duration: 150 }}>
		<div class="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-2xl" transition:slide={{ duration: 200 }}>
			<p class="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
				<IconMapPin size={16} class="text-amber-600" /> Konfirmasi Titik Proyek
			</p>
			<p class="text-xs text-slate-600 dark:text-slate-300 mt-2">
				Apakah Anda <b>sekarang berdiri di dalam area proyek {selectedProject.name}</b>? Titik ini akan dipakai untuk semua kunjungan berikutnya dan hanya bisa diubah GA.
			</p>
			{#if SimpanTitikMap}
				<div class="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
					<SimpanTitikMap lat={position.lat} lng={position.lng} label="Posisi Anda sekarang" height="160px" />
				</div>
			{/if}
			<div class="mt-4 flex gap-2">
				<button
					type="button"
					class="flex-1 h-10 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
					onclick={() => (showSimpanTitikDialog = false)}
				>
					Batal
				</button>
				<button
					type="button"
					class="flex-1 h-10 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700"
					onclick={konfirmasiSimpanTitik}
				>
					Ya, saya di lokasi proyek
				</button>
			</div>
		</div>
	</div>
{/if}

