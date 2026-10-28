<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getCustomerOptions,
		getCustomerById,
		getRecentVisitedCustomers,
		checkInVisit,
		getCurrentPosition,
		type CustomerOption
	} from '$lib/services/sales';
	// Paket 08c Site Visit Release §5.1 — GPS dipantau sampai akurat (bukan sekali ambil tanpa
	// akurasi), foto diberi watermark saat diambil (pola sama CheckinForm.svelte Paket 03/04).
	import { watchPositionUntilAccurate } from '$lib/utils/geoClient';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import { getSiteCheckinSettings, getMyProspects, type SiteCheckinProspectOption } from '$lib/services/siteCheckin';
	// Paket 08c §5.3 — write-ahead offline (pola sama CheckinForm.svelte Paket 02): entri ditulis
	// SEBELUM mencoba kirim online, supaya aplikasi crash/sinyal putus tepat setelah itu tidak
	// pernah berakhir "hilang tanpa jejak". siteCheckinSync.ts (didaftarkan di root layout) yang
	// mengirim ulang entri tertunda saat sinyal kembali.
	import { enqueueSiteCheckinSubmission, removeQueuedSiteCheckinSubmission } from '$lib/utils/offlineSiteCheckinQueue';
	import { isRetryableError, pesanErrorAwam } from '$lib/utils/networkError';
	import {
		IconArrowLeft,
		IconLoader2,
		IconMapPin,
		IconSearch,
		IconBuildingStore,
		IconX,
		IconClock,
		IconCalendar,
		IconUser,
		IconPhone,
		IconAlertCircle,
		IconAlertTriangle,
		IconRefresh,
		IconExternalLink,
		IconShieldCheck,
		IconSparkles,
		IconNotes,
		IconMapPinFilled,
		IconCircleCheckFilled,
		IconCamera,
		IconUsers,
		IconBriefcase
	} from '@tabler/icons-svelte';

	let loading = $state(false);
	let errorMsg = $state('');
	let search = $state('');
	let customers = $state<CustomerOption[]>([]);
	let recentCustomers = $state<CustomerOption[]>([]);
	let selectedCustomer = $state<CustomerOption | null>(null);
	let tujuan = $state('');
	let selectedCategory = $state('');
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout>;

	// Paket 08c §5.1 — tab "Prospek Baru" di samping pencarian customer existing. Sumber sama
	// dengan CheckinForm.svelte (sebelum 08a menghapusnya dari sana): /api/site-checkin/my-prospects.
	let targetMode = $state<'customer' | 'prospek'>('customer');
	let prospects = $state<SiteCheckinProspectOption[]>([]);
	let loadingProspects = $state(false);
	let prospectsLoaded = $state(false);
	let assignedProspectCount = $state(0);
	let selectedProspect = $state<SiteCheckinProspectOption | null>(null);
	let prospectSearch = $state('');
	let isProspectSelectorOpen = $state(false);

	const filteredProspects = $derived.by(() => {
		if (!prospectSearch.trim()) return prospects;
		const q = prospectSearch.toLowerCase();
		return prospects.filter((p) => p.name.toLowerCase().includes(q) || (p.company && p.company.toLowerCase().includes(q)));
	});

	async function loadProspects() {
		if (prospectsLoaded || loadingProspects) return;
		loadingProspects = true;
		try {
			const res = await getMyProspects();
			prospects = res.prospects || [];
			assignedProspectCount = res.assignedCount || 0;
			prospectsLoaded = true;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat daftar prospek.';
		} finally {
			loadingProspects = false;
		}
	}

	function selectTargetMode(mode: 'customer' | 'prospek') {
		targetMode = mode;
		errorMsg = '';
		if (mode === 'prospek') loadProspects();
	}

	const hasTarget = $derived(targetMode === 'prospek' ? !!selectedProspect : !!selectedCustomer);

	function selectProspect(p: SiteCheckinProspectOption) {
		selectedProspect = p;
		isProspectSelectorOpen = false;
		if (!tujuan.trim()) tujuan = `Kunjungan ke ${p.company || p.name}`;
	}

	// Live GPS sensor states
	let gpsStatus = $state<'idle' | 'detecting' | 'ready' | 'error'>('detecting');
	let gpsCoords = $state<{ latitude: number; longitude: number; accuracy: number } | null>(null);
	let gpsError = $state<string | null>(null);
	// Paket 08c §5.1 — true selama watch GPS masih mencoba memperhalus akurasi (beda dari
	// gpsStatus='detecting' yang berhenti begitu bacaan PERTAMA masuk).
	let refiningLocation = $state(false);
	let stopWatchingPosition: (() => void) | null = null;

	// Paket 08c §5.1 — foto saat mulai kunjungan (opsional/wajib sesuai settings).
	let fotoWajibCheckin = $state(false);
	let showCamera = $state(false);
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);
	let memprosesFoto = $state(false);

	// Live clock
	let currentTime = $state('');
	let currentDate = $state('');
	let clockTimer: ReturnType<typeof setInterval>;

	// Quick Purpose Presets
	const PURPOSE_PRESETS = [
		{ label: 'Follow-up Penawaran', icon: '💼', text: 'Follow-up penawaran harga & konfirmasi PO' },
		{ label: 'Survey Lapangan', icon: '🔍', text: 'Survey kondisi lapangan & pengukuran area proyek' },
		{ label: 'Routine Visit', icon: '🤝', text: 'Kunjungan rutin silaturahmi & maintain relasi' },
		{ label: 'Demo & Presentasi', icon: '📊', text: 'Presentasi produk & demonstrasi teknis aplikasi' },
		{ label: 'Penagihan / Faktur', icon: '📑', text: 'Follow-up invoice, faktur, dan administrasi pembayaran' },
		{ label: 'Komplain / Servis', icon: '🛠️', text: 'Pengecekan kendala aplikasi produk & komplain teknis' },
		{ label: 'Pengecekan Sampel', icon: '📦', text: 'Pengiriman & pengetesan sampel coating/material' },
		{ label: 'Negosiasi Kontrak', icon: '📝', text: 'Negosiasi klausul kontrak kerja & kesepakatan akhir' }
	];

	function updateClock() {
		const now = new Date();
		currentTime = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';
		currentDate = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	onMount(async () => {
		updateClock();
		clockTimer = setInterval(updateClock, 1000);

		// Paket 08c §5.1 — GPS otomatis dipantau sampai akurat saat halaman dibuka (pola sama
		// CheckinForm.svelte), bukan sekali ambil tanpa akurasi seperti sebelumnya.
		startWatchingLocation();

		getSiteCheckinSettings()
			.then((res) => {
				fotoWajibCheckin = !!res.settings?.foto_checkin_wajib;
			})
			.catch(() => {
				// fail-soft: foto tetap opsional kalau settings gagal dimuat, jangan blokir check-in
			});

		// Load recent customers for fast picking
		const salesId = $authStore.karyawanId || null;
		getRecentVisitedCustomers(salesId, 6).then((res) => {
			recentCustomers = res;
		});

		// Check if customer_id or prospect_id or customer_name is provided via query parameter
		const paramCustomerId = $page.url.searchParams.get('customer_id');
		const paramProspectId = $page.url.searchParams.get('prospect_id');
		const paramCustomerName = $page.url.searchParams.get('customer_name');
		const paramTujuan = $page.url.searchParams.get('tujuan');

		if (paramTujuan) tujuan = paramTujuan;

		if (paramCustomerId) {
			const cId = Number(paramCustomerId);
			if (cId) {
				const cust = await getCustomerById(cId);
				if (cust) {
					selectCustomer(cust);
				}
			}
		} else if (paramProspectId) {
			const pId = Number(paramProspectId);
			if (pId) {
				selectTargetMode('prospek');
				await loadProspects();
				const match = prospects.find((p) => p.id === pId);
				if (match) {
					selectProspect(match);
				} else if (paramCustomerName) {
					prospectSearch = paramCustomerName;
				}
			}
		} else if (paramCustomerName) {
			search = paramCustomerName;
		}
	});

	onDestroy(() => {
		if (clockTimer) clearInterval(clockTimer);
		if (searchTimer) clearTimeout(searchTimer);
		stopWatchingPosition?.();
	});

	// Paket 08c §5.1 — ganti ambil-sekali tanpa akurasi dengan watch sampai akurat (<=50m) atau
	// timeout 20dtk, pola sama CheckinForm.svelte. refiningLocation tetap true selama masih
	// mencoba memperhalus walau bacaan pertama sudah masuk (gpsStatus sudah 'ready').
	function startWatchingLocation() {
		stopWatchingPosition?.();
		gpsStatus = 'detecting';
		gpsError = null;
		refiningLocation = true;
		stopWatchingPosition = watchPositionUntilAccurate(
			(pos) => {
				gpsCoords = { latitude: pos.lat, longitude: pos.lng, accuracy: pos.accuracy };
				gpsStatus = 'ready';
				if (pos.accuracy <= 50) refiningLocation = false;
			},
			(err) => {
				refiningLocation = false;
				if (!gpsCoords) {
					gpsStatus = 'error';
					gpsError = err.message || 'Izin lokasi tidak diberikan atau sinyal GPS belum terkunci.';
				}
			},
			{ targetAccuracyM: 50, timeoutMs: 20000 }
		);
		setTimeout(() => (refiningLocation = false), 20000);
	}

	// Alias dipakai tombol "Muat Ulang" / "Aktifkan & Deteksi GPS" — mulai watch baru.
	function detectGPS() {
		startWatchingLocation();
	}

	// Paket 08c §5.1 — jarak ke alamat customer (haversine), informatif saja (tidak memblokir
	// check-in) karena koordinat master_customer tidak selalu terisi/akurat.
	const distanceToCustomerM = $derived.by((): number | null => {
		if (!gpsCoords || !selectedCustomer?.latitude || !selectedCustomer?.longitude) return null;
		const R = 6371000;
		const dLat = ((selectedCustomer.latitude - gpsCoords.latitude) * Math.PI) / 180;
		const dLng = ((selectedCustomer.longitude - gpsCoords.longitude) * Math.PI) / 180;
		const lat1 = (gpsCoords.latitude * Math.PI) / 180;
		const lat2 = (selectedCustomer.latitude * Math.PI) / 180;
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return Math.round(R * c);
	});

	async function handleCapture(file: File) {
		showCamera = false;
		memprosesFoto = true;
		try {
			const gps = gpsCoords
				? { lat: gpsCoords.latitude, lng: gpsCoords.longitude, accuracy: gpsCoords.accuracy }
				: null;
			const stamped = await watermarkPhoto(file, gps, new Date().toISOString(), {
				lokasi: selectedCustomer?.customer_name || undefined
			});
			if (photoPreview) URL.revokeObjectURL(photoPreview);
			photoFile = await compressPhoto(stamped);
			photoPreview = URL.createObjectURL(photoFile);
		} catch (e) {
			console.error('[sales/baru] watermark gagal, pakai foto asli', e);
			if (photoPreview) URL.revokeObjectURL(photoPreview);
			photoFile = file;
			photoPreview = URL.createObjectURL(file);
		} finally {
			memprosesFoto = false;
		}
	}

	function retakePhoto() {
		if (photoPreview) URL.revokeObjectURL(photoPreview);
		photoFile = null;
		photoPreview = null;
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		const q = search.trim();
		if (!q) {
			customers = [];
			searching = false;
			return;
		}
		searching = true;
		searchTimer = setTimeout(async () => {
			customers = await getCustomerOptions(q);
			searching = false;
		}, 250);
	}

	async function selectCustomer(c: CustomerOption) {
		selectedCustomer = c;
		customers = [];
		search = c.customer_name;
		errorMsg = '';
		if (!c.alamat && !c.alamat_surat_jalan && !c.pic_nama && !c.contact_person && c.id) {
			const full = await getCustomerById(c.id);
			if (full && selectedCustomer?.id === c.id) {
				selectedCustomer = full;
			}
		}
	}

	function clearCustomer() {
		selectedCustomer = null;
		search = '';
		customers = [];
	}

	function applyPreset(preset: (typeof PURPOSE_PRESETS)[0]) {
		selectedCategory = preset.label;
		if (!tujuan.trim() || PURPOSE_PRESETS.some((p) => p.text === tujuan.trim())) {
			tujuan = preset.text;
		} else {
			tujuan = `${preset.label}: ${tujuan}`;
		}
	}

	async function handleCheckIn() {
		if (loading) return;
		if (targetMode === 'customer' && !selectedCustomer) return;
		if (targetMode === 'prospek' && !selectedProspect) return;
		const salesId = $authStore.karyawanId;
		const salesName = $authStore.karyawanName;
		if (!salesId || !salesName) {
			errorMsg = 'Profil karyawan tidak ditemukan di sesi login.';
			return;
		}

		if (fotoWajibCheckin && !photoFile) {
			errorMsg = 'Foto lokasi wajib diambil sebelum check-in (pengaturan admin).';
			return;
		}

		loading = true;
		errorMsg = '';
		try {
			let latitude = gpsCoords?.latitude;
			let longitude = gpsCoords?.longitude;

			if (!latitude || !longitude) {
				const pos = await getCurrentPosition();
				latitude = pos.latitude;
				longitude = pos.longitude;
				gpsCoords = { ...pos, accuracy: gpsCoords?.accuracy ?? 0 };
				gpsStatus = 'ready';
			}

			const defaultTujuan =
				targetMode === 'prospek'
					? `Kunjungan ke ${selectedProspect!.company || selectedProspect!.name}`
					: `Kunjungan ke ${selectedCustomer!.customer_name}`;
			const tujuanFinal = tujuan.trim() || defaultTujuan;

			// Paket 08c §5.3 — write-ahead: client_txn_id dibuat SEKALI di sini, dipakai baik untuk
			// entri antrean (bila ternyata offline) maupun percobaan online langsung — replay dari
			// antrean nanti (siteCheckinSync.ts) mengirim ID yang SAMA, bukan baru tiap percobaan.
			const clientTxnId = crypto.randomUUID();
			let entryTersimpan = false;

			try {
				await enqueueSiteCheckinSubmission({
					v: 2,
					client_txn_id: clientTxnId,
					type: 'checkin',
					status: 'pending',
					referensiId: null,
					tipeKeperluan: 'marketing',
					extra: {
						jalur: 'sales',
						target_type: targetMode === 'prospek' ? 'prospect' : 'customer',
						target_id: String(targetMode === 'prospek' ? selectedProspect!.id : selectedCustomer!.id),
						tujuan: tujuanFinal
					},
					namaLokasi: targetMode === 'prospek' ? selectedProspect!.company || selectedProspect!.name : selectedCustomer!.customer_name,
					checkinId: null,
					lat: latitude,
					lng: longitude,
					accuracy: gpsCoords?.accuracy ?? null,
					photoBlob: photoFile,
					photoName: photoFile?.name || 'checkin.jpg',
					catatan: null,
					kegiatan: null,
					temuan: null,
					tindakLanjut: null,
					rencanaBesok: null,
					createdAt: new Date().toISOString()
				});
				entryTersimpan = true;

				// Paket 08b — sales_id/sales_name TIDAK LAGI dikirim: server meresolusinya sendiri
				// dari token Firebase (salesIdentity.ts), tidak lagi dipercaya dari klien.
				const visit = await checkInVisit({
					customerId: targetMode === 'customer' ? selectedCustomer!.id : null,
					prospectId: targetMode === 'prospek' ? selectedProspect!.id : null,
					tujuan: tujuanFinal,
					latitude,
					longitude,
					accuracy: gpsCoords?.accuracy ?? null,
					fotoFile,
					clientTxnId
				});
				if (entryTersimpan) await removeQueuedSiteCheckinSubmission(clientTxnId).catch(() => {});
				goto(`/sales/${visit.id}`);
			} catch (err) {
				if (entryTersimpan && isRetryableError(err)) {
					// Sudah tersimpan di antrean sebelum percobaan online di atas — biarkan,
					// siteCheckinSync.ts (sinkronisasi global) yang mengirimkannya nanti.
					// Paket 08c §5.3 — arahkan ke halaman resume (bukan /sales langsung): visit.id
					// belum ada, tapi sales tetap bisa isi hasil kunjungan sekarang (juga write-ahead).
					goto(`/sales/offline/${clientTxnId}`);
					return;
				}
				// Error PERMANEN (data ditolak server) — jangan tinggalkan entri sampah di antrean
				// kalau sempat ditulis (write-ahead menulis SEBELUM tahu hasilnya).
				if (entryTersimpan) await removeQueuedSiteCheckinSubmission(clientTxnId).catch(() => {});
				throw err;
			}
		} catch (err: any) {
			errorMsg = pesanErrorAwam(err) || err?.message || 'Gagal check-in. Pastikan GPS aktif dan izin lokasi diizinkan.';
			gpsStatus = 'error';
			gpsError = errorMsg;
		} finally {
			loading = false;
		}
	}
</script>

<div class="scroll-body pb-24">
	<div class="max-w-4xl mx-auto p-4 sm:p-6">
		<!-- Top Bar Navigation -->
		<div class="flex items-center justify-between gap-3 mb-4">
			<button
				type="button"
				class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[12px] font-semibold transition-all hover:bg-black/5 dark:hover:bg-white/5 active:scale-95"
				style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
				onclick={() => goto('/sales')}
			>
				<IconArrowLeft size={16} /> Kembali ke Kunjungan
			</button>

			<div class="flex items-center gap-2 text-[11px] font-medium" style="color: var(--sys-label3)">
				<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
					<IconShieldCheck size={13} class="text-emerald-500" /> Presensi Lapangan Resmi
				</span>
			</div>
		</div>

		<!-- Page Header Banner -->
		<div class="rounded-3xl border p-4 sm:p-6 mb-6 shadow-sm overflow-hidden relative" style="border-color: var(--sys-sep); background: linear-gradient(135deg, var(--sys-bg) 0%, var(--sys-fill) 100%)">
			<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<div class="flex items-center gap-2 mb-1">
						<span class="px-2.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider text-white" style="background: var(--p, var(--g))">
							Sales Mobile Check-In
						</span>
						{#if gpsStatus === 'ready' && refiningLocation}
							<span class="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md">
								<IconLoader2 size={11} class="animate-spin" /> Menyempurnakan Akurasi ({gpsCoords?.accuracy ? Math.round(gpsCoords.accuracy) : '?'}m)
							</span>
						{:else if gpsStatus === 'ready'}
							<span class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
								<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> GPS Terkunci
							</span>
						{:else if gpsStatus === 'detecting'}
							<span class="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md">
								<IconLoader2 size={11} class="animate-spin" /> Mencari Sinyal GPS...
							</span>
						{:else if gpsStatus === 'error'}
							<span class="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-md">
								<IconAlertCircle size={11} /> GPS Perlu Diaktifkan
							</span>
						{/if}
					</div>
					<h1 class="text-[20px] sm:text-[22px] font-extrabold" style="color: var(--sys-label)">Check-in Kunjungan Baru</h1>
					<p class="text-[12px] mt-0.5" style="color: var(--sys-label3)">
						Pilih customer tujuan, tentukan agenda kunjungan, dan rekam waktu tiba beserta titik koordinat GPS lokasi.
					</p>
				</div>

				<!-- Live Officer & Realtime Clock Badge -->
				<div class="sm:text-right shrink-0 p-3 rounded-2xl border bg-black/5 dark:bg-white/5" style="border-color: var(--sys-sep)">
					<div class="flex sm:justify-end items-center gap-1.5 text-[11px] font-bold" style="color: var(--sys-label)">
						<IconUser size={13} class="text-blue-500" />
						<span>{$authStore.karyawanName || 'Sales Officer'}</span>
					</div>
					<div class="flex sm:justify-end items-center gap-1.5 text-[10px] mt-0.5" style="color: var(--sys-label3)">
						<IconCalendar size={12} />
						<span>{currentDate || 'Memuat tanggal...'}</span>
					</div>
					<div class="flex sm:justify-end items-center gap-1.5 text-[12px] font-mono font-extrabold mt-1 text-emerald-600 dark:text-emerald-400">
						<IconClock size={13} />
						<span>{currentTime || '--:--:--'}</span>
					</div>
				</div>
			</div>

			<!-- Step Progress Indicator -->
			<div class="grid grid-cols-3 gap-2 mt-5 pt-4 border-t text-[11px]" style="border-color: var(--sys-sep)">
				<div class="flex items-center gap-2 {hasTarget ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'font-semibold'}" style={!hasTarget ? 'color: var(--sys-label)' : ''}>
					<span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold {hasTarget ? 'bg-emerald-500 text-white' : 'bg-[var(--p,var(--g))] text-white'}">
						{hasTarget ? '✓' : '1'}
					</span>
					<span class="truncate">{targetMode === 'prospek' ? 'Pilih Prospek' : 'Pilih Customer'}</span>
				</div>

				<div class="flex items-center gap-2 {tujuan.trim() ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'font-semibold'}" style={!tujuan.trim() ? 'color: var(--sys-label2)' : ''}>
					<span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold {tujuan.trim() ? 'bg-emerald-500 text-white' : 'bg-black/10 dark:bg-white/10'}" style={!tujuan.trim() ? 'color: var(--sys-label3)' : ''}>
						{tujuan.trim() ? '✓' : '2'}
					</span>
					<span class="truncate">Tujuan & Agenda</span>
				</div>

				<div class="flex items-center gap-2 {gpsStatus === 'ready' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'font-semibold'}" style={gpsStatus !== 'ready' ? 'color: var(--sys-label3)' : ''}>
					<span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold {gpsStatus === 'ready' ? 'bg-emerald-500 text-white' : 'bg-black/10 dark:bg-white/10'}" style={gpsStatus !== 'ready' ? 'color: var(--sys-label3)' : ''}>
						3
					</span>
					<span class="truncate">Kunci GPS & Tiba</span>
				</div>
			</div>
		</div>

		<!-- Main Form Layout (2 Columns on Desktop) -->
		<div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
			<!-- Left Column: Form Controls (7/12) -->
			<div class="lg:col-span-7 flex flex-col gap-5">
				<!-- Section 1: Customer Picker -->
				<div class="rounded-2xl border p-4 sm:p-5 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<div class="flex items-center justify-between mb-2">
						<label class="text-[12px] font-extrabold flex items-center gap-1.5" style="color: var(--sys-label)">
							<IconBuildingStore size={16} class="text-blue-500" /> {targetMode === 'prospek' ? 'Prospek Tujuan' : 'Customer Tujuan'} <span class="text-rose-500">*</span>
						</label>
						{#if targetMode === 'customer' && selectedCustomer}
							<button
								type="button"
								class="text-[11px] font-bold text-rose-500 hover:underline flex items-center gap-1"
								onclick={clearCustomer}
							>
								<IconX size={13} /> Ganti Customer
							</button>
						{/if}
					</div>

					<!-- Paket 08c §5.1 — tab "Prospek Baru" di samping pencarian customer existing, untuk
					     kunjungan ke lead yang belum jadi customer (sumber sama CheckinForm.svelte sebelum
					     08a menutup tab Marketing di Site Check-in). -->
					<div class="grid grid-cols-2 gap-1.5 p-1 rounded-xl mb-3" style="background: var(--sys-fill)">
						<button
							type="button"
							class="py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all {targetMode === 'customer' ? 'shadow-sm' : ''}"
							style={targetMode === 'customer' ? 'background: var(--sys-bg); color: var(--p, var(--g))' : 'color: var(--sys-label3)'}
							onclick={() => selectTargetMode('customer')}
						>
							<IconBuildingStore size={14} /> Customer
						</button>
						<button
							type="button"
							class="py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all {targetMode === 'prospek' ? 'shadow-sm' : ''}"
							style={targetMode === 'prospek' ? 'background: var(--sys-bg); color: var(--p, var(--g))' : 'color: var(--sys-label3)'}
							onclick={() => selectTargetMode('prospek')}
						>
							<IconUsers size={14} /> Prospek Baru
						</button>
					</div>

					{#if targetMode === 'prospek'}
						<!-- Pemilihan Prospek -->
						{#if loadingProspects}
							<div class="flex items-center gap-2.5 py-4 px-3 rounded-xl text-[12px]" style="background: var(--sys-fill); color: var(--sys-label3)">
								<IconLoader2 size={16} class="animate-spin text-blue-600" /> Memuat daftar prospek...
							</div>
						{:else if prospects.length === 0 && prospectsLoaded}
							<div class="rounded-xl p-3.5 bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5">
								<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-amber-600" />
								<div>
									<p class="text-[12px] font-bold text-amber-800 dark:text-amber-300">Belum Ada Prospek Aktif</p>
									<p class="text-[11px] opacity-90 mt-0.5 text-amber-800 dark:text-amber-300">Tidak ditemukan prospek di pipeline Anda. Tambahkan prospek baru di menu Prospek terlebih dahulu.</p>
								</div>
							</div>
						{:else if !selectedProspect}
							<div class="relative">
								<IconSearch size={16} class="absolute left-3.5 top-1/2 -translate-y-1/2" style="color: var(--sys-label3)" />
								<input
									class="w-full h-11 pl-10 pr-9 rounded-xl border text-[13px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[var(--p,var(--g))]/20"
									style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
									placeholder="Cari nama prospek atau perusahaan..."
									bind:value={prospectSearch}
								/>
								{#if prospectSearch}
									<button
										type="button"
										class="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-[var(--sys-label3)]"
										onclick={() => (prospectSearch = '')}
									>
										<IconX size={14} />
									</button>
								{/if}
							</div>
							<div class="mt-2 max-h-56 overflow-y-auto rounded-xl border divide-y" style="border-color: var(--sys-sep); divide-color: var(--sys-sep)">
								{#each filteredProspects as p (p.id)}
									<button
										type="button"
										class="w-full text-left p-3 text-[12px] hover:bg-blue-500/5 transition-colors flex items-center justify-between group"
										onclick={() => selectProspect(p)}
									>
										<div class="min-w-0">
											<p class="font-bold truncate group-hover:text-blue-600 transition-colors" style="color: var(--sys-label)">{p.company || p.name}</p>
											<p class="text-[11px] truncate" style="color: var(--sys-label3)">{p.name}{p.stage ? ` — ${p.stage}` : ''}</p>
										</div>
										{#if p.peran === 'assigned'}
											<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800 shrink-0">
												Prospek Anda
											</span>
										{/if}
									</button>
								{:else}
									<p class="p-3 text-[11px] text-center" style="color: var(--sys-label3)">Tidak ada prospek yang cocok.</p>
								{/each}
							</div>
						{:else}
							<!-- Selected Prospect Preview Card -->
							<div class="p-4 rounded-xl border flex flex-col gap-2 relative overflow-hidden" style="border-color: var(--p, #3b82f6); background: rgba(59, 130, 246, 0.05)">
								<div class="flex items-start justify-between gap-2">
									<div class="flex items-start gap-2.5">
										<div class="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 mt-0.5" style="background: var(--p, #3b82f6)">
											<IconBriefcase size={20} />
										</div>
										<div>
											<h3 class="text-[14px] font-bold" style="color: var(--sys-label)">{selectedProspect.company || selectedProspect.name}</h3>
											<p class="text-[11px] mt-0.5" style="color: var(--sys-label2)">{selectedProspect.name}{selectedProspect.stage ? ` — ${selectedProspect.stage}` : ''}</p>
										</div>
									</div>
									<span class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full shrink-0">
										<IconCircleCheckFilled size={12} /> Siap
									</span>
								</div>
								<div class="flex items-center justify-end pt-2 mt-1 border-t text-[11px]" style="border-color: rgba(59, 130, 246, 0.15)">
									<button type="button" class="font-semibold text-rose-500 hover:underline" onclick={() => (selectedProspect = null)}>
										Pilih prospek lain
									</button>
								</div>
							</div>
						{/if}
					{:else if !selectedCustomer}
						<div class="relative">
							<IconSearch size={16} class="absolute left-3.5 top-1/2 -translate-y-1/2" style="color: var(--sys-label3)" />
							<input
								class="w-full h-11 pl-10 pr-9 rounded-xl border text-[13px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[var(--p,var(--g))]/20"
								style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
								placeholder="Cari nama perusahaan, kode customer, atau toko..."
								bind:value={search}
								oninput={onSearchInput}
							/>
							{#if search}
								<button
									type="button"
									class="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-[var(--sys-label3)]"
									onclick={() => { search = ''; customers = []; }}
								>
									<IconX size={14} />
								</button>
							{:else if searching}
								<div class="absolute right-3 top-1/2 -translate-y-1/2">
									<IconLoader2 size={15} class="animate-spin text-[var(--sys-label3)]" />
								</div>
							{/if}

							<!-- Dropdown Autocomplete -->
							{#if customers.length > 0}
								<div
									class="absolute z-30 w-full mt-1.5 rounded-2xl border bg-white dark:bg-zinc-900 shadow-2xl max-h-64 overflow-y-auto divide-y"
									style="border-color: var(--sys-sep); divide-color: var(--sys-sep)"
								>
									{#each customers as c (c.id)}
										<button
											type="button"
											class="w-full text-left p-3.5 text-[12px] hover:bg-blue-500/5 transition-colors flex items-center justify-between group"
											onclick={() => selectCustomer(c)}
										>
											<div>
												<p class="font-bold group-hover:text-blue-600 transition-colors" style="color: var(--sys-label)">{c.customer_name}</p>
												{#if c.alamat || c.kota}
													<p class="text-[11px] mt-0.5 line-clamp-1" style="color: var(--sys-label3)">
														📍 {[c.alamat, c.kota].filter(Boolean).join(', ')}
													</p>
												{/if}
											</div>
											<div class="text-right shrink-0 pl-3">
												<span class="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label2)">
													{c.kode_customer || `#${c.id}`}
												</span>
											</div>
										</button>
									{/each}
								</div>
							{:else if search.trim().length > 1 && !searching}
								<div class="absolute z-30 w-full mt-1.5 p-3 rounded-xl border bg-white dark:bg-zinc-900 shadow-lg text-[11px] text-center" style="border-color: var(--sys-sep); color: var(--sys-label3)">
									Customer "{search}" tidak ditemukan. Pastikan ejaan sesuai atau hubungi admin.
								</div>
							{/if}
						</div>

						<!-- Recent Customer Quick Chips -->
						{#if recentCustomers.length > 0}
							<div class="mt-3">
								<p class="text-[10px] font-bold uppercase tracking-wider mb-1.5" style="color: var(--sys-label3)">
									⚡ Customer Terakhir Dikunjungi:
								</p>
								<div class="flex flex-wrap gap-1.5">
									{#each recentCustomers as rc (rc.id)}
										<button
											type="button"
											class="px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 hover:border-blue-500 hover:text-blue-600 transition-all active:scale-95"
											style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label2)"
											onclick={() => selectCustomer(rc)}
										>
											<IconBuildingStore size={12} class="opacity-70" />
											<span class="truncate max-w-[150px]">{rc.customer_name}</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
					{:else}
						<!-- Selected Customer Preview Card -->
						<div class="p-4 rounded-xl border flex flex-col gap-2 relative overflow-hidden" style="border-color: var(--p, #3b82f6); background: rgba(59, 130, 246, 0.05)">
							<div class="flex items-start justify-between gap-2">
								<div class="flex items-start gap-2.5">
									<div class="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 mt-0.5" style="background: var(--p, #3b82f6)">
										<IconBuildingStore size={20} />
									</div>
									<div>
										<div class="flex items-center gap-2">
											<h3 class="text-[14px] font-bold" style="color: var(--sys-label)">{selectedCustomer.customer_name}</h3>
											<span class="text-[10px] font-mono font-bold px-2 py-0.2 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
												{selectedCustomer.kode_customer || `#${selectedCustomer.id}`}
											</span>
										</div>
										{#if selectedCustomer.alamat || selectedCustomer.alamat_surat_jalan}
											<p class="text-[11px] mt-0.5" style="color: var(--sys-label2)">
												📍 {selectedCustomer.alamat_surat_jalan || selectedCustomer.alamat}
											</p>
										{/if}
										{#if selectedCustomer.contact_person || selectedCustomer.pic_nama || selectedCustomer.telp || selectedCustomer.telepon}
											<div class="flex items-center gap-2 mt-1 text-[11px] font-medium" style="color: var(--sys-label3)">
												{#if selectedCustomer.contact_person || selectedCustomer.pic_nama}
													<span class="flex items-center gap-1"><IconUser size={12} /> PIC: {selectedCustomer.contact_person || selectedCustomer.pic_nama}</span>
												{/if}
												{#if selectedCustomer.telp || selectedCustomer.telepon}
													<span class="flex items-center gap-1"><IconPhone size={12} /> {selectedCustomer.telp || selectedCustomer.telepon}</span>
												{/if}
											</div>
										{/if}
									</div>
								</div>

								<span class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full shrink-0">
									<IconCircleCheckFilled size={12} /> Siap
								</span>
							</div>

							{#if distanceToCustomerM !== null}
								<div class="flex items-center gap-1.5 text-[11px] font-semibold {distanceToCustomerM <= 300 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}">
									{#if distanceToCustomerM <= 300}
										<IconCircleCheckFilled size={13} /> Anda di lokasi customer
									{:else}
										<IconAlertTriangle size={13} />
										±{distanceToCustomerM > 1000 ? (distanceToCustomerM / 1000).toFixed(1) + ' km' : distanceToCustomerM + ' m'} dari alamat customer
									{/if}
								</div>
							{/if}

							<div class="flex items-center justify-between pt-2 mt-1 border-t text-[11px]" style="border-color: rgba(59, 130, 246, 0.15)">
								<a
									href={`/sales/customer/${selectedCustomer.id}`}
									target="_blank"
									class="font-bold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
								>
									Lihat Riwayat & Prospek Customer <IconExternalLink size={12} />
								</a>
								<button
									type="button"
									class="font-semibold text-rose-500 hover:underline"
									onclick={clearCustomer}
								>
									Pilih customer lain
								</button>
							</div>
						</div>
					{/if}
				</div>

				<!-- Section 2: Tujuan & Kategori Agenda -->
				<div class="rounded-2xl border p-4 sm:p-5 shadow-sm flex flex-col gap-3.5" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<div>
						<div class="flex items-center justify-between mb-1.5">
							<label class="text-[12px] font-extrabold flex items-center gap-1.5" style="color: var(--sys-label)">
								<IconNotes size={16} class="text-amber-500" /> Tujuan & Agenda Kunjungan
							</label>
							<span class="text-[10px] font-medium" style="color: var(--sys-label3)">Pilih template cepat atau ketik</span>
						</div>

						<!-- Quick Preset Chips -->
						<div class="flex flex-wrap gap-1.5 mb-3">
							{#each PURPOSE_PRESETS as preset}
								{@const active = selectedCategory === preset.label}
								<button
									type="button"
									class="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border flex items-center gap-1.5 transition-all active:scale-95 {active
										? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold shadow-xs'
										: 'hover:border-black/20 dark:hover:border-white/20'}"
									style={!active ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label2)' : ''}
									onclick={() => applyPreset(preset)}
								>
									<span>{preset.icon}</span>
									<span>{preset.label}</span>
								</button>
							{/each}
						</div>

						<div class="relative">
							<input
								class="w-full h-11 px-3.5 rounded-xl border text-[13px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[var(--p,var(--g))]/20"
								style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
								placeholder="mis. Follow-up penawaran coating tangki, survey batching plant..."
								bind:value={tujuan}
							/>
							{#if tujuan}
								<button
									type="button"
									class="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-[var(--sys-label3)]"
									onclick={() => { tujuan = ''; selectedCategory = ''; }}
								>
									<IconX size={14} />
								</button>
							{/if}
						</div>
						<p class="text-[10px] mt-1.5" style="color: var(--sys-label3)">
							💡 Tips: Anda dapat melengkapi ringkasan hasil pembicaraan dan foto dokumentasi nanti setelah check-in berhasil.
						</p>
					</div>
				</div>

				<!-- Section 3: Foto Lokasi (Paket 08c §5.1) -->
				<div class="rounded-2xl border p-4 sm:p-5 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<div class="flex items-center justify-between mb-2">
						<label class="text-[12px] font-extrabold flex items-center gap-1.5" style="color: var(--sys-label)">
							<IconCamera size={16} class="text-violet-500" /> Foto Lokasi
							{#if fotoWajibCheckin}<span class="text-rose-500">*</span>{:else}<span class="text-[10px] font-semibold" style="color: var(--sys-label3)">(opsional)</span>{/if}
						</label>
					</div>

					{#if photoPreview}
						<div class="relative rounded-xl overflow-hidden border" style="border-color: var(--sys-sep)">
							<img src={photoPreview} alt="Foto check-in" class="w-full h-40 object-cover" />
							<button
								type="button"
								class="absolute top-2 right-2 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-black/60 text-white hover:bg-black/80 transition-colors"
								onclick={retakePhoto}
							>
								Ambil Ulang
							</button>
						</div>
					{:else}
						<button
							type="button"
							class="w-full h-24 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 hover:border-blue-500 hover:text-blue-600 transition-all disabled:opacity-50"
							style="border-color: var(--sys-sep); color: var(--sys-label3)"
							disabled={memprosesFoto}
							onclick={() => (showCamera = true)}
						>
							{#if memprosesFoto}
								<IconLoader2 size={20} class="animate-spin" />
								<span class="text-[11px] font-semibold">Memproses watermark foto...</span>
							{:else}
								<IconCamera size={22} />
								<span class="text-[11px] font-semibold">Ambil Foto Lokasi</span>
							{/if}
						</button>
					{/if}
					<p class="text-[10px] mt-1.5" style="color: var(--sys-label3)">
						💡 Foto akan diberi watermark koordinat GPS & waktu otomatis saat diambil — gunakan kamera langsung, bukan galeri.
					</p>
				</div>

				<!-- Error Alert -->
				{#if errorMsg}
					<div class="p-3.5 rounded-2xl border bg-rose-500/10 border-rose-500/30 flex items-start gap-2.5 text-[12px] text-rose-600 dark:text-rose-400 font-semibold">
						<IconAlertCircle size={18} class="shrink-0 mt-0.5" />
						<div>
							<p>{errorMsg}</p>
							<p class="text-[11px] font-normal mt-0.5 opacity-90">
								Pastikan browser telah diizinkan mengakses lokasi GPS perangkat Anda.
							</p>
						</div>
					</div>
				{/if}

				<!-- Check-in Action Button (Mobile & Desktop Primary) -->
				<button
					type="button"
					class="w-full h-13 rounded-2xl text-[14px] font-extrabold text-white flex items-center justify-center gap-2.5 shadow-md shadow-[var(--p,var(--g))]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.99]"
					style="background: var(--p, var(--g))"
					disabled={!hasTarget || loading || gpsStatus === 'detecting'}
					onclick={handleCheckIn}
				>
					{#if loading}
						<IconLoader2 size={20} class="animate-spin" />
						<span>Merekam GPS & Membuat Kunjungan...</span>
					{:else if !hasTarget}
						<IconBuildingStore size={20} />
						<span>{targetMode === 'prospek' ? 'Pilih Prospek Tujuan Terlebih Dahulu' : 'Pilih Customer Tujuan Terlebih Dahulu'}</span>
					{:else}
						<IconMapPinFilled size={20} />
						<span>Check-in & Rekam Lokasi Sekarang</span>
					{/if}
				</button>
			</div>

			<!-- Right Column: Live GPS Status & Guidelines (5/12) -->
			<div class="lg:col-span-5 flex flex-col gap-5">
				<!-- GPS & Sensor Status Card -->
				<div class="rounded-2xl border p-4 sm:p-5 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<div class="flex items-center justify-between mb-3">
						<h2 class="text-[13px] font-extrabold flex items-center gap-1.5" style="color: var(--sys-label)">
							<IconMapPin size={16} class="text-emerald-500" /> Status Sinyal GPS
						</h2>
						<button
							type="button"
							class="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
							onclick={detectGPS}
						>
							<IconRefresh size={13} class={gpsStatus === 'detecting' ? 'animate-spin' : ''} />
							<span>Muat Ulang</span>
						</button>
					</div>

					{#if gpsStatus === 'detecting'}
						<div class="p-4 rounded-xl border border-dashed text-center flex flex-col items-center justify-center py-6" style="border-color: var(--sys-sep)">
							<IconLoader2 size={24} class="animate-spin text-amber-500 mb-2" />
							<p class="text-[12px] font-bold" style="color: var(--sys-label)">Mendeteksi Lokasi Presisi...</p>
							<p class="text-[10px] mt-0.5" style="color: var(--sys-label3)">Mengambil koordinat satelit GPS perangkat Anda.</p>
						</div>
					{:else if gpsStatus === 'ready' && gpsCoords}
						<div class="p-3.5 rounded-xl border bg-emerald-500/5 border-emerald-500/20 flex flex-col gap-2">
							<div class="flex items-center justify-between">
								<span class="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
									<IconCircleCheckFilled size={15} /> Sensor GPS Terkunci
								</span>
								<span class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
									±{Math.round(gpsCoords.accuracy)}m
								</span>
							</div>

							<div class="grid grid-cols-2 gap-2 mt-1 text-[11px] font-mono">
								<div class="p-2 rounded-lg bg-black/5 dark:bg-white/5">
									<span class="text-[9px] text-[var(--sys-label3)] block font-sans">Latitude</span>
									<span class="font-bold" style="color: var(--sys-label)">{gpsCoords.latitude.toFixed(6)}</span>
								</div>
								<div class="p-2 rounded-lg bg-black/5 dark:bg-white/5">
									<span class="text-[9px] text-[var(--sys-label3)] block font-sans">Longitude</span>
									<span class="font-bold" style="color: var(--sys-label)">{gpsCoords.longitude.toFixed(6)}</span>
								</div>
							</div>

							{#if refiningLocation}
								<p class="text-[10px] text-amber-700 dark:text-amber-400/80 leading-relaxed flex items-center gap-1">
									<IconLoader2 size={11} class="animate-spin" /> Masih menyempurnakan akurasi di latar belakang...
								</p>
							{:else}
								<p class="text-[10px] text-emerald-700 dark:text-emerald-400/80 leading-relaxed">
									📍 Titik ini akan otomatis dicocokkan dengan alamat kantor/proyek customer saat verifikasi supervisor.
								</p>
							{/if}
						</div>
					{:else}
						<div class="p-3.5 rounded-xl border bg-rose-500/5 border-rose-500/20 flex flex-col gap-2">
							<div class="flex items-center gap-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
								<IconAlertCircle size={15} /> Sinyal GPS Belum Terkunci
							</div>
							<p class="text-[11px] text-rose-600 dark:text-rose-400/90 leading-relaxed">
								{gpsError || 'Browser belum mendapatkan izin lokasi GPS.'}
							</p>
							<button
								type="button"
								class="mt-1 w-full h-8 rounded-lg bg-rose-600 text-white text-[11px] font-bold flex items-center justify-center gap-1 hover:bg-rose-700 transition-colors"
								onclick={detectGPS}
							>
								<IconRefresh size={13} /> Aktifkan & Deteksi GPS
							</button>
						</div>
					{/if}
				</div>

				<!-- SOP & Guidelines Card -->
				<div class="rounded-2xl border p-4 sm:p-5 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<h2 class="text-[12px] font-extrabold flex items-center gap-1.5 mb-2.5" style="color: var(--sys-label)">
						<IconSparkles size={15} class="text-blue-500" /> Panduan Presensi Kunjungan
					</h2>

					<ul class="flex flex-col gap-2.5 text-[11px] leading-relaxed" style="color: var(--sys-label2)">
						<li class="flex items-start gap-2">
							<span class="w-4 h-4 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[9px] shrink-0 mt-0.5">1</span>
							<span><strong>Check-in saat Tiba</strong>: Tekan tombol check-in tepat saat Anda sampai di lokasi customer agar waktu tiba tercatat akurat.</span>
						</li>
						<li class="flex items-start gap-2">
							<span class="w-4 h-4 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[9px] shrink-0 mt-0.5">2</span>
							<span><strong>Ambil Dokumentasi Foto</strong>: Di halaman detail selanjutnya, Anda dapat mengambil foto di lokasi (bersama customer / kondisi proyek).</span>
						</li>
						<li class="flex items-start gap-2">
							<span class="w-4 h-4 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[9px] shrink-0 mt-0.5">3</span>
							<span><strong>Submit Hasil Kunjungan</strong>: Tuliskan notulen singkat, target follow-up, lalu submit laporan untuk diverifikasi oleh SPV.</span>
						</li>
					</ul>
				</div>
			</div>
		</div>
	</div>
</div>

{#if showCamera}
	<CameraCaptureModal facing="environment" onCapture={handleCapture} onClose={() => (showCamera = false)} />
{/if}
