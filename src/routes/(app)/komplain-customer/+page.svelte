<!-- src/routes/(app)/komplain-customer/+page.svelte -->
<!-- Lapor & Pelacakan Komplain Customer (Fase 7, Pertajam KPI Marketing & Manufaktur v2). -->
<!-- Offline-first: gagal kirim -> antrian IndexedDB, auto-kirim ulang saat online. -->
<!-- Menulis ke customer_complaints (kanonik) sebagai D0 "Diterima" -- tahap 8D -->
<!-- lanjutan (investigasi, eskalasi R&D) dikerjakan di app admin & dipantau di sini. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		searchCustomer,
		createComplaintReport,
		uploadComplaintPhoto,
		fetchCustomerComplaints,
		updateComplaintStage,
		type CustomerMatch,
		type CustomerComplaintItem
	} from '$lib/services/customerComplaintApi';
	import {
		enqueueComplaint,
		flushComplaintQueue,
		registerComplaintAutoFlush,
		getQueuedComplaints,
		type QueuedComplaint
	} from '$lib/utils/offlineComplaintQueue';
	import {
		IconCalendar,
		IconLoader2,
		IconCamera,
		IconAlertTriangle,
		IconAlertCircle,
		IconEdit,
		IconList,
		IconPlus,
		IconSearch,
		IconFilter,
		IconRefresh,
		IconBuildingFactory2,
		IconCircleCheck,
		IconClock,
		IconX,
		IconChevronRight,
		IconPhoto,
		IconUser,
		IconPhone,
		IconSparkles,
		IconClipboardCheck,
		IconExternalLink,
		IconFlame,
		IconCopy,
		IconCheck,
		IconTag,
		IconInfoCircle
	} from '@tabler/icons-svelte';
	import PhotoAnnotator from '$lib/components/shared/PhotoAnnotator.svelte';
	import VoiceInputButton from '$lib/components/shared/VoiceInputButton.svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { secureAssetSrc } from '$lib/actions/secureAsset';
	import { compressPhoto } from '$lib/utils/photoCompress';

	const KATEGORI_LABELS: Record<string, string> = {
		kualitas: 'Kualitas Produk / Material',
		pengiriman: 'Pengiriman & Logistik',
		layanan: 'Layanan & Komunikasi',
		harga: 'Harga & Komersial',
		aplikasi: 'Aplikasi Lapangan / Coating',
		lainnya: 'Lainnya'
	};

	const SITE_LABELS: Record<string, string> = {
		pusat: 'Kantor Pusat',
		balaraja: 'Workshop / Plant Balaraja',
		ciketing: 'Plant Ciketing'
	};

	const PRIORITAS_CONFIG: Record<string, { label: string; sla: string; badge: string; dot: string }> = {
		normal: {
			label: 'Biasa (Normal)',
			sla: 'SLA: 72 Jam',
			badge: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
			dot: 'bg-slate-400'
		},
		urgent: {
			label: 'Mendesak (Urgent)',
			sla: 'SLA: 48 Jam',
			badge: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
			dot: 'bg-amber-500'
		},
		critical: {
			label: 'Kritis (Stop Line / Reject)',
			sla: 'SLA: 24 Jam',
			badge: 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800/60',
			dot: 'bg-rose-500'
		}
	};

	const GEJALA_QUICK_CHIPS = [
		'Daya rekat lepas / peeling',
		'Warna tidak sesuai spesifikasi',
		'Cat lambat kering / tacky',
		'Kemasan bocor / penyok',
		'Keterlambatan pengiriman',
		'Salah kirim item / tipe barang',
		'Permukaan bergelembung (blistering)',
		'Kekentalan / viskositas tidak standar',
		'Dokumen COA / TDS belum terlampir'
	];

	const TUNTUTAN_OPTIONS = [
		'Ganti barang baru / replacement',
		'Kunjungan teknisi / inspeksi site',
		'Uji ulang laboratorium (retest)',
		'Surat klarifikasi teknis resmi',
		'Diskon / kompensasi komersial',
		'Penyesuaian jadwal delivery'
	];

	const STAGE_ORDER = ['diterima', 'investigasi', 'tindakan_sementara', 'akar_masalah', 'solusi', 'verifikasi', 'tutup'];

	const STAGE_CONFIG: Record<string, { label: string; short: string; badge: string; dot: string; desc: string }> = {
		diterima: {
			label: 'D0 Diterima',
			short: 'D0 Diterima',
			badge: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
			dot: 'bg-slate-400',
			desc: 'Laporan komplain tercatat dari lapangan, menunggu respon awal tim QC / R&D.'
		},
		investigasi: {
			label: 'D1-D2 Investigasi',
			short: 'D1-D2 Investigasi',
			badge: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/60',
			dot: 'bg-blue-500',
			desc: 'Tim QC/R&D mendeskripsikan masalah, membentuk tim, & memeriksa retained sample batch.'
		},
		tindakan_sementara: {
			label: 'D3 Tindakan Sementara',
			short: 'D3 Sementara',
			badge: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
			dot: 'bg-amber-500',
			desc: 'Tindakan penahanan / isolasi sementara diterapkan pada batch/area terkait.'
		},
		akar_masalah: {
			label: 'D4 Akar Masalah',
			short: 'D4 Akar Masalah',
			badge: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800/60',
			dot: 'bg-orange-500',
			desc: 'Analisis penyebab utama (Root Cause Analysis / RCA) berhasil diidentifikasi.'
		},
		solusi: {
			label: 'D5-D6 Solusi & Validasi',
			short: 'D5-D6 Solusi',
			badge: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60',
			dot: 'bg-indigo-500',
			desc: 'Tindakan korektif permanen diterapkan & divalidasi efektivitasnya.'
		},
		verifikasi: {
			label: 'D7 Verifikasi & Cegah',
			short: 'D7 Verifikasi',
			badge: 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800/60',
			dot: 'bg-cyan-500',
			desc: 'Pencegahan keberulangan SOP & formula sedang dimonitor.'
		},
		tutup: {
			label: 'D8 Selesai / Tutup',
			short: 'D8 Selesai',
			badge: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
			dot: 'bg-emerald-500',
			desc: 'Komplain telah diselesaikan, disetujui customer, & ditutup tuntas.'
		}
	};

	// Active tab: 'lapor' | 'daftar'
	let activeTab = $state<'lapor' | 'daftar'>('lapor');

	// List & Data state
	let complaints = $state<CustomerComplaintItem[]>([]);
	let loadingList = $state(false);
	let selectedDetail = $state<CustomerComplaintItem | null>(null);
	let copiedId = $state<number | null>(null);

	// Filters
	let filterStatus = $state<string>('all');
	let filterKategori = $state<string>('all');
	let filterSite = $state<string>('all');
	let filterPrioritas = $state<string>('all');
	let searchQuery = $state<string>('');
	let filterTanggalDari = $state<string>('');
	let filterTanggalSampai = $state<string>('');

	// 8D stage management (permission-gated)
	let canManage8D = $derived(
		hasPermission($authStore.roleId, 'manage_komplain_8d', $rolesStore, $authStore.roleIds)
	);
	let savingStage = $state(false);
	let stageError = $state('');
	let resolusiInput = $state('');
	let ratingInput = $state<number | null>(null);

	// Offline Queue State
	let offlineQueueCount = $state<number>(0);
	let isFlushingQueue = $state<boolean>(false);

	// Form State
	let saving = $state(false);
	let submitted = $state(false);
	let customerQuery = $state('');
	let customerMatches = $state<CustomerMatch[]>([]);
	let selectedCustomer = $state<CustomerMatch | null>(null);
	let photoFile = $state<File | null>(null);
	let photoPreviewUrl = $state<string | null>(null);
	let annotatingFile = $state<File | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	let form = $state({
		kategori: 'kualitas',
		deskripsi: '',
		site: 'pusat',
		batchNumber: '',
		prioritas: 'normal',
		kontakPelapor: '',
		produkLayanan: '',
		volumeTerdampak: '',
		tuntutanCustomer: ''
	});

	$effect(() => {
		if (!photoFile) {
			photoPreviewUrl = null;
			return;
		}
		const url = URL.createObjectURL(photoFile);
		photoPreviewUrl = url;
		return () => URL.revokeObjectURL(url);
	});

	// Draft Persistence
	interface KomplainDraft {
		customerId: number | null;
		customerLabel: string;
		kategori: string;
		deskripsi: string;
		site: string;
		batchNumber: string;
		prioritas: string;
		kontakPelapor: string;
		produkLayanan: string;
		volumeTerdampak: string;
		tuntutanCustomer: string;
	}
	const KOMPLAIN_PHOTO_KEY = 'bukti';
	const komplainPersist = createFormPersist<KomplainDraft>('komplain_customer_v2');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function komplainSnapshot(): KomplainDraft {
		return {
			customerId: selectedCustomer?.id ?? null,
			customerLabel: selectedCustomer?.nama_sj_fp ?? '',
			kategori: form.kategori,
			deskripsi: form.deskripsi,
			site: form.site,
			batchNumber: form.batchNumber,
			prioritas: form.prioritas,
			kontakPelapor: form.kontakPelapor,
			produkLayanan: form.produkLayanan,
			volumeTerdampak: form.volumeTerdampak,
			tuntutanCustomer: form.tuntutanCustomer
		};
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_komplain_customer', roles)) {
			goto('/');
		}
	});

	async function loadComplaints() {
		loadingList = true;
		try {
			complaints = await fetchCustomerComplaints({
				status: filterStatus,
				kategori: filterKategori,
				site: filterSite,
				prioritas: filterPrioritas,
				search: searchQuery,
				tanggalDari: filterTanggalDari || null,
				tanggalSampai: filterTanggalSampai || null
			});
		} catch (err) {
			console.error('Gagal memuat komplain:', err);
		} finally {
			loadingList = false;
		}
	}

	async function checkOfflineQueue() {
		try {
			const queued = await getQueuedComplaints();
			offlineQueueCount = queued.length;
		} catch {
			offlineQueueCount = 0;
		}
	}

	async function handleManualFlush() {
		isFlushingQueue = true;
		try {
			await flushComplaintQueue(sendEntry);
			await checkOfflineQueue();
			await loadComplaints();
		} finally {
			isFlushingQueue = false;
		}
	}

	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	function onCustomerQueryInput() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(async () => {
			if (customerQuery.trim().length < 2) {
				customerMatches = [];
				return;
			}
			customerMatches = await searchCustomer(customerQuery);
		}, 250);
	}

	function pickCustomer(c: CustomerMatch) {
		selectedCustomer = c;
		customerQuery = c.nama_sj_fp;
		customerMatches = [];
	}

	function clearCustomer() {
		selectedCustomer = null;
		customerQuery = '';
		customerMatches = [];
	}

	function addGejalaChip(gejala: string) {
		if (form.deskripsi.includes(gejala)) return;
		if (!form.deskripsi.trim()) {
			form.deskripsi = `• Gejala: ${gejala}`;
		} else {
			form.deskripsi = `${form.deskripsi.trim()}\n• Gejala: ${gejala}`;
		}
	}

	async function sendEntry(entry: QueuedComplaint) {
		let fotoFileId: string | null = null;
		if (entry.photoBlob) {
			fotoFileId = await uploadComplaintPhoto(entry.photoBlob, entry.photoName || 'komplain.jpg');
		}
		await createComplaintReport({
			clientTxnId: entry.client_txn_id,
			customerId: entry.customer_id,
			kategori: entry.kategori,
			deskripsi: entry.deskripsi,
			site: entry.site,
			fotoFileId,
			pic: entry.pic,
			batchNumber: entry.batch_number,
			prioritas: entry.prioritas,
			kontakPelapor: entry.kontak_pelapor
		});
	}

	onMount(async () => {
		registerComplaintAutoFlush(async (entry) => {
			await sendEntry(entry);
			await checkOfflineQueue();
			await loadComplaints();
		});

		await flushComplaintQueue(sendEntry);
		await checkOfflineQueue();
		await loadComplaints();

		const draft = komplainPersist.restore();
		if (draft) {
			form = {
				kategori: draft.kategori || 'kualitas',
				deskripsi: draft.deskripsi || '',
				site: draft.site || 'pusat',
				batchNumber: draft.batchNumber || '',
				prioritas: draft.prioritas || 'normal',
				kontakPelapor: draft.kontakPelapor || '',
				produkLayanan: draft.produkLayanan || '',
				volumeTerdampak: draft.volumeTerdampak || '',
				tuntutanCustomer: draft.tuntutanCustomer || ''
			};
			if (draft.customerId) {
				selectedCustomer = { id: draft.customerId, nama_sj_fp: draft.customerLabel };
				customerQuery = draft.customerLabel;
			}
			const blob = await komplainPersist.restorePhoto(KOMPLAIN_PHOTO_KEY);
			if (blob) photoFile = new File([blob], 'bukti.jpg', { type: blob.type || 'image/jpeg' });
			draftSavedAt = new Date();
		}
		// Fase 4 QC Re-test: datang dari hasil scan QR kaleng cat (/scan/EPI:BATCH:<id>) -> nomor batch
		// terisi otomatis, supaya komplain tertaut ke batch dan batch itu otomatis ditahan (HOLD) di ERP.
		const batchParam = new URLSearchParams(window.location.search).get('batch');
		if (batchParam) {
			form = { ...form, batchNumber: batchParam };
			activeTab = 'lapor';
		}
		draftArmed = true;
	});

	// Autosave
	$effect(() => {
		void komplainSnapshot();
		if (!draftArmed) return;
		komplainPersist.save(komplainSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(komplainPersist, komplainSnapshot));

	function onPhotoChange(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0] || null;
		if (file) {
			photoFile = file;
			komplainPersist.savePhoto(KOMPLAIN_PHOTO_KEY, file);
		}
	}

	async function submitComplaint() {
		if (!form.deskripsi.trim()) return;
		saving = true;
		const clientTxnId = crypto.randomUUID();
		const compressedPhoto = photoFile ? await compressPhoto(photoFile) : null;
		const payload: QueuedComplaint = {
			client_txn_id: clientTxnId,
			customer_id: selectedCustomer?.id || null,
			kategori: form.kategori,
			deskripsi: form.deskripsi.trim(),
			site: form.site,
			pic: $authStore.karyawanName || null,
			batch_number: form.batchNumber.trim() || null,
			prioritas: form.prioritas,
			kontak_pelapor: form.kontakPelapor.trim() || null,
			photoBlob: compressedPhoto,
			photoName: compressedPhoto?.name || null,
			createdAt: new Date().toISOString()
		};

		try {
			try {
				let fotoFileId: string | null = null;
				if (compressedPhoto) {
					fotoFileId = await uploadComplaintPhoto(compressedPhoto, compressedPhoto.name || 'komplain.jpg');
				}
				await createComplaintReport({
					clientTxnId,
					customerId: selectedCustomer?.id || null,
					customerName: selectedCustomer?.nama_sj_fp || null,
					kategori: form.kategori,
					deskripsi: form.deskripsi.trim(),
					site: form.site,
					fotoFileId,
					pic: $authStore.karyawanName || null,
					batchNumber: form.batchNumber.trim() || null,
					prioritas: form.prioritas,
					kontakPelapor: form.kontakPelapor.trim() || null,
					produkLayanan: form.produkLayanan.trim() || null,
					volumeTerdampak: form.volumeTerdampak.trim() || null,
					tuntutanCustomer: form.tuntutanCustomer.trim() || null
				});
			} catch (err) {
				// Offline or server connection failure -> queue locally
				await enqueueComplaint(payload);
				await checkOfflineQueue();
			}

			submitted = true;
			komplainPersist.clear();
			await komplainPersist.clearPhotos();
			draftSavedAt = null;

			form = {
				kategori: 'kualitas',
				deskripsi: '',
				site: 'pusat',
				batchNumber: '',
				prioritas: 'normal',
				kontakPelapor: '',
				produkLayanan: '',
				volumeTerdampak: '',
				tuntutanCustomer: ''
			};
			selectedCustomer = null;
			customerQuery = '';
			photoFile = null;

			// Reload list
			await loadComplaints();
		} finally {
			saving = false;
		}
	}

	// Filtered list derived
	let filteredComplaints = $derived(
		complaints.filter((c) => {
			if (filterStatus !== 'all') {
				if (filterStatus === 'active' && c.status === 'tutup') return false;
				if (filterStatus !== 'active' && c.status !== filterStatus) return false;
			}
			if (filterKategori !== 'all' && c.kategori !== filterKategori) return false;
			if (filterSite !== 'all' && c.site !== filterSite) return false;
			if (filterPrioritas !== 'all' && c.prioritas !== filterPrioritas) return false;
			if (filterTanggalDari && (c.tanggal || '') < filterTanggalDari) return false;
			if (filterTanggalSampai && (c.tanggal || '') > filterTanggalSampai) return false;
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase();
				const cust = c.customer?.nama_sj_fp?.toLowerCase() || '';
				const desk = c.deskripsi?.toLowerCase() || '';
				const batch = c.batch_number?.toLowerCase() || '';
				const pic = c.pic?.toLowerCase() || '';
				if (!cust.includes(q) && !desk.includes(q) && !batch.includes(q) && !pic.includes(q)) return false;
			}
			return true;
		})
	);

	// Derived KPI Metrics
	let totalCount = $derived(complaints.length);
	let activeCount = $derived(complaints.filter((c) => c.status !== 'tutup').length);
	let closedCount = $derived(complaints.filter((c) => c.status === 'tutup').length);
	let overdueCount = $derived(
		complaints.filter((c) => c.sla_due_at && c.status !== 'tutup' && new Date(c.sla_due_at) < new Date()).length
	);

	function isStagePassed(stage: string, currentStage: string): boolean {
		const currentIndex = STAGE_ORDER.indexOf(currentStage);
		const stageIndex = STAGE_ORDER.indexOf(stage);
		if (currentIndex === -1 || stageIndex === -1) return false;
		return stageIndex <= currentIndex;
	}

	function isOverdue(slaDueAt?: string | null, status?: string): boolean {
		if (!slaDueAt || status === 'tutup') return false;
		return new Date(slaDueAt) < new Date();
	}

	function formatDate(isoStr?: string | null): string {
		if (!isoStr) return '-';
		try {
			const d = new Date(isoStr);
			return d.toLocaleDateString('id-ID', {
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			});
		} catch {
			return isoStr;
		}
	}

	async function copyComplaintSummary(item: CustomerComplaintItem) {
		const stage = STAGE_CONFIG[item.status] || STAGE_CONFIG.diterima;
		const text = `🚨 *LAPORAN KOMPLAIN CUSTOMER #${item.id}*
Customer: ${item.customer?.nama_sj_fp || 'Customer Lapangan'}
Kategori: ${KATEGORI_LABELS[item.kategori] || item.kategori}
Status: ${stage.label}
Prioritas: ${item.prioritas?.toUpperCase() || 'NORMAL'}
Site: ${SITE_LABELS[item.site || 'pusat'] || item.site}
Nomor Batch: ${item.batch_number || '-'}
Pelapor: ${item.pic || '-'}
Tanggal: ${formatDate(item.tanggal)}

*Deskripsi:*
${item.deskripsi}

*Sistem:* SI-TAMA Modul Komplain`;

		try {
			await navigator.clipboard.writeText(text);
			copiedId = item.id;
			setTimeout(() => {
				if (copiedId === item.id) copiedId = null;
			}, 2500);
		} catch (err) {
			console.warn('Gagal salin teks:', err);
		}
	}

	// ── 8D Stage Management (permission-gated: manage_komplain_8d) ──
	const STAGE_WITH_RESOLUSI = ['solusi', 'verifikasi', 'tutup'];

	// Sinkronkan input resolusi/rating tiap kali detail komplain dibuka
	$effect(() => {
		if (selectedDetail) {
			resolusiInput = selectedDetail.resolusi || '';
			ratingInput = selectedDetail.rating_after ?? null;
			stageError = '';
		}
	});

	function stageAt(offset: number, from?: string): string | null {
		const idx = STAGE_ORDER.indexOf(from || '');
		if (idx === -1) return null;
		const next = idx + offset;
		if (next < 0 || next >= STAGE_ORDER.length) return null;
		return STAGE_ORDER[next];
	}

	async function changeStage(dir: 1 | -1) {
		if (!selectedDetail || savingStage || !canManage8D) return;
		const target = stageAt(dir, selectedDetail.status);
		if (!target) return;
		if (STAGE_WITH_RESOLUSI.includes(target) && !resolusiInput.trim()) {
			stageError = 'Isi ringkasan resolusi/tindakan dulu sebelum masuk fase ini.';
			return;
		}
		savingStage = true;
		stageError = '';
		try {
			await updateComplaintStage(selectedDetail.id, {
				status: target as any,
				resolusi: STAGE_WITH_RESOLUSI.includes(target) ? resolusiInput.trim() : null,
				resolvedBy: STAGE_WITH_RESOLUSI.includes(target) ? $authStore.karyawanId || null : null,
				ratingAfter: target === 'tutup' ? ratingInput : null
			});
			await loadComplaints();
			selectedDetail = complaints.find((c) => c.id === selectedDetail!.id) || null;
		} catch (err: any) {
			stageError = err?.message || 'Gagal mengubah fase komplain.';
		} finally {
			savingStage = false;
		}
	}
</script>

<svelte:head>
	<title>Lapor & Pelacakan Komplain Customer — SI-TAMA</title>
</svelte:head>

<div class="mx-auto max-w-5xl p-3 sm:p-5 pb-28 space-y-4 font-sans text-slate-800 dark:text-slate-100">
	<!-- Top Navigation Header & Title -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900/90 p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs backdrop-blur-sm">
		<div>
			<div class="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400 mb-1">
				<IconAlertTriangle size={17} class="animate-pulse" />
				<span>SI-TAMA Modul Sales & Lapangan</span>
				<span class="text-slate-300 dark:text-slate-700">•</span>
				<span class="text-slate-500 dark:text-slate-400 font-normal">Titik Tangkap Komplain & Alur 8D</span>
			</div>
			<h1 class="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">Lapor & Pelacakan Komplain Customer</h1>
			<p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl leading-relaxed">
				Mencatat keluhan customer secara terstruktur (D0 "Diterima"), memicu notifikasi supervisor sales, dan terhubung langsung ke investigasi tim QC & R&D.
			</p>
		</div>

		<!-- Action Tabs Switcher -->
		<div class="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/90 p-1.5 rounded-xl self-start sm:self-auto border border-slate-200/50 dark:border-slate-700/60 shadow-inner">
			<button
				type="button"
				class="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all {activeTab === 'lapor' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs ring-1 ring-slate-200/60 dark:ring-slate-700' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}"
				onclick={() => {
					activeTab = 'lapor';
					submitted = false;
				}}
			>
				<IconPlus size={16} />
				<span>Lapor Baru</span>
				<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} />
			</button>

			<button
				type="button"
				class="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all {activeTab === 'daftar' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs ring-1 ring-slate-200/60 dark:ring-slate-700' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}"
				onclick={() => {
					activeTab = 'daftar';
					loadComplaints();
				}}
			>
				<IconList size={16} />
				<span>Daftar & Status</span>
				{#if activeCount > 0}
					<span class="px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold">
						{activeCount}
					</span>
				{/if}
			</button>
		</div>
	</div>

	<!-- Offline Queue Alert Banner (If Any) -->
	{#if offlineQueueCount > 0}
		<div class="flex items-center justify-between gap-3 p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 rounded-xl text-amber-900 dark:text-amber-200 text-xs shadow-xs">
			<div class="flex items-center gap-2.5">
				<IconAlertCircle size={20} class="text-amber-600 dark:text-amber-400 shrink-0" />
				<div>
					<span class="font-bold">{offlineQueueCount} laporan komplain</span> tersimpan lokal di perangkat (offline / sinyal lemah).
					<span class="text-amber-700 dark:text-amber-300 block sm:inline">Akan terkirim otomatis saat perangkat online kembali.</span>
				</div>
			</div>
			<button
				type="button"
				class="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shrink-0 flex items-center gap-1.5 transition-colors shadow-xs"
				disabled={isFlushingQueue}
				onclick={handleManualFlush}
			>
				{#if isFlushingQueue}
					<IconLoader2 size={14} class="animate-spin" />
				{:else}
					<IconRefresh size={14} />
				{/if}
				<span>Kirim Sekarang</span>
			</button>
		</div>
	{/if}

	<!-- ================= TAB 1: FORM LAPOR KOMPLAIN BARU ================= -->
	{#if activeTab === 'lapor'}
		<div class="bg-white dark:bg-slate-900/90 p-4 sm:p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
			<!-- Header Alert Card (Alur 8D Stage D0) -->
			<div class="p-4 rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
				<div class="flex items-start gap-3">
					<div class="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
						<IconAlertTriangle size={20} />
					</div>
					<div>
						<h2 class="text-sm font-black text-amber-950 dark:text-amber-200">Formulir Laporan Komplain Customer</h2>
						<p class="text-xs text-amber-800 dark:text-amber-300/90 mt-0.5 leading-relaxed">
							Laporan ini tercatat sebagai status <strong class="font-bold underline decoration-amber-400">"D0 Diterima"</strong>. Tindak lanjut investigasi, akar masalah (RCA), dan solusi permanen diproses oleh tim QC & R&D.
						</p>
					</div>
				</div>
				<div class="self-end sm:self-center shrink-0">
					<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} />
				</div>
			</div>

			{#if submitted}
				<div class="p-8 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/80 dark:bg-emerald-950/30 text-center space-y-4">
					<div class="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
						<IconCircleCheck size={40} />
					</div>
					<div>
						<h3 class="text-lg font-black text-emerald-900 dark:text-emerald-200">Laporan Komplain Berhasil Dicatat!</h3>
						<p class="text-xs text-emerald-700 dark:text-emerald-300 mt-1 max-w-md mx-auto leading-relaxed">
							Data komplain masuk ke antrean investigasi 8D (Tahap D0) dan supervisor sales telah menerima notifikasi sistem.
						</p>
					</div>
					<div class="flex flex-wrap justify-center gap-3 pt-2">
						<button
							type="button"
							class="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-slate-700 transition-colors shadow-2xs"
							onclick={() => (submitted = false)}
						>
							+ Buat Laporan Komplain Lain
						</button>
						<button
							type="button"
							class="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-xs"
							onclick={() => {
								activeTab = 'daftar';
								submitted = false;
								loadComplaints();
							}}
						>
							Pantau di Daftar & Status 8D
						</button>
					</div>
				</div>
			{:else}
				<form onsubmit={(e) => { e.preventDefault(); submitComplaint(); }} class="space-y-6">
					<!-- SECTION 1: DATA CUSTOMER & PELAPOR -->
					<div class="space-y-3">
						<div class="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
							<IconUser size={18} class="text-blue-600 dark:text-blue-400" />
							<h3 class="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">1. Data Customer & Narahubung</h3>
						</div>

						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
							<!-- Customer Search Autocomplete -->
							<div class="sm:col-span-2">
								<label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
									Nama Customer / Klien <span class="text-slate-400 font-normal">(Ketik minimal 2 huruf)</span>
								</label>
								<div class="relative">
									<input
										type="text"
										placeholder="Cari nama perusahaan / customer (contoh: PT Krakatau, PT Pertamina)..."
										class="w-full pl-9 pr-9 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
										bind:value={customerQuery}
										oninput={onCustomerQueryInput}
									/>
									<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
									{#if selectedCustomer || customerQuery}
										<button
											type="button"
											class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
											onclick={clearCustomer}
										>
											<IconX size={15} />
										</button>
									{/if}

									{#if customerMatches.length > 0}
										<div class="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl divide-y divide-slate-100 dark:divide-slate-700">
											{#each customerMatches as c}
												<button
													type="button"
													class="flex items-center justify-between w-full px-4 py-2.5 text-left text-xs hover:bg-blue-50 dark:hover:bg-slate-700/60 transition-colors"
													onclick={() => pickCustomer(c)}
												>
													<div>
														<span class="font-bold text-slate-800 dark:text-slate-100 block">{c.nama_sj_fp}</span>
														{#if c.kode_customer}
															<span class="text-[10px] font-mono text-blue-600 dark:text-blue-400">{c.kode_customer}</span>
														{/if}
													</div>
													<span class="text-[10px] px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-semibold">Pilih</span>
												</button>
											{/each}
										</div>
									{/if}
								</div>
								{#if selectedCustomer}
									<div class="mt-1.5 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
										<IconCircleCheck size={14} />
										<span>Customer Terpilih: <strong>{selectedCustomer.nama_sj_fp}</strong></span>
									</div>
								{/if}
							</div>

							<!-- Kontak PIC Customer -->
							<div>
								<label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
									Kontak PIC Customer <span class="text-slate-400 font-normal">(No. HP / WhatsApp)</span>
								</label>
								<div class="relative">
									<input
										type="text"
										placeholder="Contoh: Pak Budi (0812-3456-7890)"
										class="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
										bind:value={form.kontakPelapor}
									/>
									<IconPhone size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
								</div>
							</div>

							<!-- Site Operasional Terkait -->
							<div>
								<label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
									Site / Plant Operasional
								</label>
								<div class="relative">
									<select
										class="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
										bind:value={form.site}
									>
										{#each Object.entries(SITE_LABELS) as [val, label]}
											<option value={val}>{label}</option>
										{/each}
									</select>
									<IconBuildingFactory2 size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
								</div>
							</div>
						</div>
					</div>

					<!-- SECTION 2: KLASIFIKASI & DETAIL PRODUK/PROYEK -->
					<div class="space-y-3">
						<div class="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
							<IconTag size={18} class="text-blue-600 dark:text-blue-400" />
							<h3 class="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">2. Klasifikasi & Identifikasi Produk/Proyek</h3>
						</div>

						<div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
							<!-- Kategori Komplain -->
							<div>
								<label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
									Kategori Komplain <span class="text-rose-500">*</span>
								</label>
								<select
									class="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
									bind:value={form.kategori}
								>
									{#each Object.entries(KATEGORI_LABELS) as [val, label]}
										<option value={val}>{label}</option>
									{/each}
								</select>
							</div>

							<!-- Tingkat Urgensi / Prioritas -->
							<div>
								<label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
									Tingkat Urgensi (SLA Target)
								</label>
								<select
									class="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
									bind:value={form.prioritas}
								>
									<option value="normal">Biasa (Normal - SLA 72 Jam)</option>
									<option value="urgent">Mendesak (Urgent - SLA 48 Jam)</option>
									<option value="critical">Kritis (Stop Line / Reject - SLA 24 Jam)</option>
								</select>
							</div>

							<!-- Nomor Batch / SJ / PO -->
							<div>
								<label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
									No. Batch / No. SJ / No. PO
								</label>
								<input
									type="text"
									placeholder="Contoh: BATCH-2026-08 / SJ-089"
									class="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
									bind:value={form.batchNumber}
								/>
							</div>

							<!-- Nama Produk / Jasa Terkait -->
							<div class="sm:col-span-2">
								<label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
									Nama Produk / Jasa yang Dikeluhkan
								</label>
								<input
									type="text"
									placeholder="Contoh: Eltaprime Epoxy Primer 2-Pack, Polyurethane Topcoat Glossy..."
									class="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
									bind:value={form.produkLayanan}
								/>
							</div>

							<!-- Volume / Kuantitas Terdampak -->
							<div>
								<label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
									Volume / Kuantitas Terdampak
								</label>
								<input
									type="text"
									placeholder="Contoh: 10 Pail / 200 m²"
									class="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
									bind:value={form.volumeTerdampak}
								/>
							</div>
						</div>
					</div>

					<!-- SECTION 3: KRONOLOGI & GEJALA MASALAH -->
					<div class="space-y-3">
						<div class="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
							<IconEdit size={18} class="text-blue-600 dark:text-blue-400" />
							<h3 class="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">3. Kronologi, Gejala & Tuntutan Customer</h3>
						</div>

						<!-- Quick Chips Gejala Umum -->
						<div>
							<span class="text-[11px] font-bold text-slate-500 dark:text-slate-400 block mb-1.5">
								Pintasan Gejala / Isu Lapangan (Klik untuk menambahkan):
							</span>
							<div class="flex flex-wrap gap-1.5">
								{#each GEJALA_QUICK_CHIPS as chip}
									<button
										type="button"
										class="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-700 text-slate-700 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300 transition-colors cursor-pointer"
										onclick={() => addGejalaChip(chip)}
									>
										+ {chip}
									</button>
								{/each}
							</div>
						</div>

						<!-- Deskripsi Detail Komplain with Voice Input -->
						<div>
							<div class="flex items-center justify-between mb-1.5">
								<label class="block text-xs font-bold text-slate-700 dark:text-slate-300">
									Deskripsi Lengkap Masalah <span class="text-rose-500">*</span>
								</label>
								<span class="text-[10px] text-slate-400 dark:text-slate-500">
									Jelaskan: Apa, di mana lokasinya, kapan terjadi, & gejalanya
								</span>
							</div>
							<div class="relative">
								<textarea
									class="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-3.5 pr-12 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 leading-relaxed focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
									rows="4"
									placeholder="Tuliskan keluhan atau kronologi kejadian secara detail..."
									bind:value={form.deskripsi}
								></textarea>
								<div class="absolute right-3 top-3">
									<VoiceInputButton onResult={(text) => (form.deskripsi = form.deskripsi ? `${form.deskripsi} ${text}` : text)} />
								</div>
							</div>
						</div>

						<!-- Tuntutan / Harapan Solusi dari Customer -->
						<div>
							<label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
								Harapan / Tuntutan Tindakan dari Customer
							</label>
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
								<select
									class="px-3 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
									onchange={(e) => {
										const val = (e.target as HTMLSelectElement).value;
										if (val) form.tuntutanCustomer = val;
									}}
								>
									<option value="">— Pilih Opsi Tindakan —</option>
									{#each TUNTUTAN_OPTIONS as opt}
										<option value={opt}>{opt}</option>
									{/each}
								</select>
								<input
									type="text"
									placeholder="Atau tuliskan tuntutan khusus..."
									class="px-3 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
									bind:value={form.tuntutanCustomer}
								/>
							</div>
						</div>
					</div>

					<!-- SECTION 4: BUKTI FOTO & ANOTASI CACAT -->
					<div class="space-y-3">
						<div class="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
							<IconPhoto size={18} class="text-blue-600 dark:text-blue-400" />
							<h3 class="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">4. Foto Dokumentasi & Bukti Defect</h3>
						</div>

						<input
							bind:this={fileInputEl}
							type="file"
							accept="image/*"
							capture="environment"
							class="hidden"
							onchange={onPhotoChange}
						/>

						{#if photoFile && photoPreviewUrl}
							<div class="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-3.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-2xl">
								<img
									src={photoPreviewUrl}
									alt="Preview bukti"
									class="h-24 w-24 sm:h-20 sm:w-20 rounded-xl object-cover border border-slate-300 dark:border-slate-600 shrink-0 shadow-2xs"
								/>
								<div class="flex-1 min-w-0">
									<p class="text-xs font-bold text-slate-900 dark:text-white truncate">{photoFile.name}</p>
									<p class="text-[11px] text-slate-500 dark:text-slate-400">
										Ukuran: {(photoFile.size / 1024).toFixed(0)} KB • Foto siap dilampirkan & terkompresi otomatis.
									</p>
									<div class="flex flex-wrap gap-2 mt-2">
										<button
											type="button"
											class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-xs font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-100 transition-colors shadow-2xs"
											onclick={() => (annotatingFile = photoFile)}
										>
											<IconEdit size={14} /> Tandai di Foto (Coret / Lingkari)
										</button>
										<button
											type="button"
											class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 transition-colors"
											onclick={() => fileInputEl?.click()}
										>
											<IconCamera size={14} /> Ganti Foto
										</button>
										<button
											type="button"
											class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 transition-colors"
											onclick={() => {
												photoFile = null;
												komplainPersist.clearPhotos();
											}}
										>
											<IconX size={14} /> Hapus
										</button>
									</div>
								</div>
							</div>
						{:else}
							<button
								type="button"
								class="flex w-full flex-col sm:flex-row items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 py-6 px-4 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
								onclick={() => fileInputEl?.click()}
							>
								<div class="p-2.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
									<IconCamera size={22} />
								</div>
								<div class="text-center sm:text-left">
									<span class="font-bold text-slate-800 dark:text-slate-200 block">Ambil / Unggah Foto Bukti Lapangan</span>
									<span class="text-[11px] text-slate-400 dark:text-slate-500">Mendukung kamera HP langsung & coret/lingkari area defect</span>
								</div>
							</button>
						{/if}
					</div>

					<!-- SECTION 5: SUBMIT & OFFLINE-READY STATUS -->
					<div class="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
						<button
							type="submit"
							class="w-full rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] py-3.5 text-xs sm:text-sm font-bold text-white shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all cursor-pointer"
							disabled={saving || !form.deskripsi.trim()}
						>
							{#if saving}
								<IconLoader2 size={18} class="animate-spin" />
								<span>Menyimpan Laporan Komplain (D0)...</span>
							{:else}
								<IconAlertTriangle size={18} />
								<span>Kirim Laporan Komplain Customer (D0 Diterima)</span>
							{/if}
						</button>

						<div class="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
							<IconInfoCircle size={13} />
							<span>Sinyal lemah? Laporan otomatis tersimpan di perangkat (IndexedDB) dan terkirim saat online kembali.</span>
						</div>
					</div>
				</form>
			{/if}
		</div>
	{/if}

	<!-- ================= TAB 2: DAFTAR & STATUS KOMPLAIN (8D TRACKER) ================= -->
	{#if activeTab === 'daftar'}
		<!-- KPI Summary Cards -->
		<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
			<div class="bg-white dark:bg-slate-900/90 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs">
				<div class="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-1 font-semibold">
					<span>Total Komplain</span>
					<IconClipboardCheck size={18} class="text-slate-400" />
				</div>
				<div class="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">{totalCount}</div>
				<div class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Semua data komplain</div>
			</div>

			<div class="bg-white dark:bg-slate-900/90 p-4 rounded-2xl border border-blue-100 dark:border-blue-900/60 shadow-2xs">
				<div class="flex items-center justify-between text-blue-700 dark:text-blue-400 text-xs mb-1 font-bold">
					<span>Dalam Proses (Aktif)</span>
					<span class="h-2 w-2 rounded-full bg-blue-500 animate-ping"></span>
				</div>
				<div class="text-2xl sm:text-3xl font-black text-blue-700 dark:text-blue-400">{activeCount}</div>
				<div class="text-[11px] text-blue-600/80 dark:text-blue-400/80 mt-0.5">Tahap D0 s/d D7 (QC / R&D)</div>
			</div>

			<div class="bg-white dark:bg-slate-900/90 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-900/60 shadow-2xs">
				<div class="flex items-center justify-between text-emerald-700 dark:text-emerald-400 text-xs mb-1 font-bold">
					<span>Selesai (D8 Tutup)</span>
					<IconCircleCheck size={18} class="text-emerald-500" />
				</div>
				<div class="text-2xl sm:text-3xl font-black text-emerald-700 dark:text-emerald-400">{closedCount}</div>
				<div class="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">Selesai & terverifikasi</div>
			</div>

			<div class="bg-white dark:bg-slate-900/90 p-4 rounded-2xl border border-rose-100 dark:border-rose-900/60 shadow-2xs">
				<div class="flex items-center justify-between text-rose-700 dark:text-rose-400 text-xs mb-1 font-bold">
					<span>Melewati SLA</span>
					<IconClock size={18} class="text-rose-500" />
				</div>
				<div class="text-2xl sm:text-3xl font-black text-rose-700 dark:text-rose-400">{overdueCount}</div>
				<div class="text-[11px] text-rose-600/80 dark:text-rose-400/80 mt-0.5">Perlu eskalasi segera</div>
			</div>
		</div>

		<!-- Filters & Search Toolbar -->
		<div class="bg-white dark:bg-slate-900/90 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-3">
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
				<!-- Search Query -->
				<div class="relative sm:col-span-2 lg:col-span-2">
					<input
						type="text"
						placeholder="Cari customer, deskripsi, batch, PIC..."
						class="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
						bind:value={searchQuery}
					/>
					<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
					{#if searchQuery}
						<button
							class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
							onclick={() => (searchQuery = '')}
						>
							<IconX size={14} />
						</button>
					{/if}
				</div>

				<!-- Status Filter -->
				<select
					class="px-3 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
					bind:value={filterStatus}
					onchange={loadComplaints}
				>
					<option value="all">Semua Status 8D</option>
					<option value="active">Aktif (Belum Tutup)</option>
					<option value="diterima">D0 Diterima</option>
					<option value="investigasi">D1-D2 Investigasi</option>
					<option value="tindakan_sementara">D3 Tindakan Sementara</option>
					<option value="akar_masalah">D4 Akar Masalah</option>
					<option value="solusi">D5-D6 Solusi</option>
					<option value="verifikasi">D7 Verifikasi</option>
					<option value="tutup">D8 Selesai / Tutup</option>
				</select>

				<!-- Kategori Filter -->
				<select
					class="px-3 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
					bind:value={filterKategori}
					onchange={loadComplaints}
				>
					<option value="all">Semua Kategori</option>
					{#each Object.entries(KATEGORI_LABELS) as [val, label]}
						<option value={val}>{label}</option>
					{/each}
				</select>

				<!-- Refresh Button -->
				<button
					type="button"
					class="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors shrink-0 shadow-2xs"
					onclick={loadComplaints}
					disabled={loadingList}
				>
					<IconRefresh size={15} class={loadingList ? 'animate-spin' : ''} />
					<span>Segarkan</span>
				</button>
			</div>

			<!-- Baris 2: Site, Rentang Tanggal, & Aksi -->
			<div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
				<!-- Site Filter -->
				<select
					class="px-3 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
					bind:value={filterSite}
					onchange={loadComplaints}
				>
					<option value="all">Semua Site</option>
					{#each Object.entries(SITE_LABELS) as [val, label]}
						<option value={val}>{label}</option>
					{/each}
				</select>

				<!-- Tanggal Dari -->
				<label class="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-[11px] font-semibold text-slate-500 dark:text-slate-400">
					<span class="shrink-0">Dari</span>
					<input
						type="date"
						class="w-full bg-transparent text-xs text-slate-700 dark:text-slate-200 focus:outline-hidden"
						bind:value={filterTanggalDari}
						onchange={loadComplaints}
					/>
				</label>

				<!-- Tanggal Sampai -->
				<label class="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-[11px] font-semibold text-slate-500 dark:text-slate-400">
					<span class="shrink-0">s/d</span>
					<input
						type="date"
						class="w-full bg-transparent text-xs text-slate-700 dark:text-slate-200 focus:outline-hidden"
						bind:value={filterTanggalSampai}
						onchange={loadComplaints}
					/>
				</label>

				{#if filterSite !== 'all' || filterTanggalDari || filterTanggalSampai || filterKategori !== 'all' || filterStatus !== 'all' || searchQuery}
					<button
						type="button"
						class="px-3 py-2 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors"
						onclick={() => {
							filterSite = 'all';
							filterTanggalDari = '';
							filterTanggalSampai = '';
							filterKategori = 'all';
							filterStatus = 'all';
							searchQuery = '';
							loadComplaints();
						}}
					>
						Reset Filter
					</button>
				{/if}

				<button
					type="button"
					class="col-start-2 sm:col-start-auto lg:col-start-5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-xs"
					onclick={() => (activeTab = 'lapor')}
				>
					<IconPlus size={15} /> Komplain Baru
				</button>
			</div>
		</div>

		<!-- Complaint Cards List -->
		{#if loadingList}
			<CircularProgressGauge size={52} strokeWidth={4} label="Memuat data komplain customer..." />
		{:else if filteredComplaints.length === 0}
			<div class="bg-white dark:bg-slate-900/90 p-12 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-center">
				<IconClipboardCheck size={44} class="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
				<p class="text-sm font-bold text-slate-800 dark:text-slate-200">Tidak ada komplain yang sesuai kriteria</p>
				<p class="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-sm mx-auto">
					Coba sesuaikan filter pencarian atau buat laporan komplain baru dari lapangan.
				</p>
				<button
					type="button"
					class="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
					onclick={() => (activeTab = 'lapor')}
				>
					<IconPlus size={16} /> Buat Laporan Komplain Baru
				</button>
			</div>
		{:else}
			<div class="space-y-3">
				{#each filteredComplaints as item (item.id)}
					{@const stage = STAGE_CONFIG[item.status] || STAGE_CONFIG.diterima}
					{@const prio = PRIORITAS_CONFIG[item.prioritas || 'normal'] || PRIORITAS_CONFIG.normal}
					{@const overdue = isOverdue(item.sla_due_at, item.status)}

					<div
						role="button"
						tabindex="0"
						class="w-full text-left bg-white dark:bg-slate-900/90 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 hover:border-blue-500/50 dark:hover:border-blue-500/50 shadow-2xs hover:shadow-md transition-all group flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer"
						onclick={() => (selectedDetail = item)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								selectedDetail = item;
							}
						}}
					>
						<div class="flex items-start gap-4 flex-1 min-w-0">
							<!-- Photo Thumbnail / Fallback Icon -->
							<div class="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0 overflow-hidden flex items-center justify-center">
								{#if item.foto}
									<img
										use:secureAssetSrc={item.foto}
										alt="Bukti"
										class="w-full h-full object-cover"
									/>
								{:else}
									<IconPhoto size={22} class="text-slate-400 dark:text-slate-500" />
								{/if}
							</div>

							<!-- Content Details -->
							<div class="min-w-0 flex-1 space-y-1.5">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-xs font-black text-slate-900 dark:text-white tracking-tight">
										#{item.id} {item.customer?.nama_sj_fp || 'Customer Lapangan'}
									</span>
									{#if item.customer?.kode_customer}
										<span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-mono font-bold">
											{item.customer.kode_customer}
										</span>
									{/if}

									<!-- Priority Badge -->
									{#if item.prioritas && item.prioritas !== 'normal'}
										<span class="px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 {prio.badge}">
											<IconFlame size={12} /> {prio.label}
										</span>
									{/if}

									<!-- Overdue SLA Badge -->
									{#if overdue}
										<span class="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[10px] font-bold flex items-center gap-1 animate-pulse">
											<IconClock size={12} /> Overdue SLA
										</span>
									{/if}
								</div>

								<p class="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
									{item.deskripsi}
								</p>

								<!-- Meta tags -->
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 dark:text-slate-500 font-medium">
									<span class="flex items-center gap-1">
										<IconCalendar size={13} /> {formatDate(item.tanggal)}
									</span>
									<span>•</span>
									<span class="capitalize text-slate-700 dark:text-slate-300 font-semibold">
										{KATEGORI_LABELS[item.kategori] || item.kategori}
									</span>
									<span>•</span>
									<span>Site: {SITE_LABELS[item.site || 'pusat'] || item.site}</span>
									{#if item.batch_number}
										<span>•</span>
										<span class="text-blue-600 dark:text-blue-400 font-mono font-bold">Batch: {item.batch_number}</span>
									{/if}
									{#if item.pic}
										<span>•</span>
										<span>Pelapor: {item.pic}</span>
									{/if}
								</div>
							</div>
						</div>

						<!-- Right Status Badge & Stepper Preview -->
						<div class="flex items-center justify-between md:justify-end gap-4 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800">
							<div class="flex flex-col items-start md:items-end gap-1.5">
								<span class="px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 {stage.badge}">
									<span class="h-2 w-2 rounded-full {stage.dot}"></span>
									{stage.label}
								</span>
								{#if item.resolved_date}
									<span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
										Tuntas: {formatDate(item.resolved_date)}
									</span>
								{/if}
							</div>
							<div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/40 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
								<IconChevronRight size={18} />
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- ================= MODAL DETAIL KOMPLAIN & TRACKER 8D ================= -->
{#if selectedDetail}
	{@const item = selectedDetail}
	{@const stage = STAGE_CONFIG[item.status] || STAGE_CONFIG.diterima}
	{@const prio = PRIORITAS_CONFIG[item.prioritas || 'normal'] || PRIORITAS_CONFIG.normal}

	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
		onclick={(e) => {
			if (e.target === e.currentTarget) selectedDetail = null;
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') selectedDetail = null;
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col text-slate-800 dark:text-slate-100">
			<!-- Modal Header -->
			<div class="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3 bg-slate-50/80 dark:bg-slate-800/60">
				<div>
					<div class="flex flex-wrap items-center gap-2 mb-1">
						<span class="text-xs font-black text-slate-900 dark:text-white">Komplain #{item.id}</span>
						<span class="px-2.5 py-0.5 rounded-full text-xs font-bold border {stage.badge}">
							{stage.label}
						</span>
						{#if item.prioritas && item.prioritas !== 'normal'}
							<span class="px-2 py-0.5 rounded-full text-[10px] font-bold border {prio.badge}">
								<IconFlame size={12} class="inline mr-0.5" /> {prio.label}
							</span>
						{/if}
					</div>
					<h3 class="text-base font-black text-slate-900 dark:text-white">
						{item.customer?.nama_sj_fp || 'Customer Lapangan'}
					</h3>
				</div>
				<button
					type="button"
					class="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
					onclick={() => (selectedDetail = null)}
				>
					<IconX size={20} />
				</button>
			</div>

			<!-- Modal Body -->
			<div class="p-4 sm:p-5 overflow-y-auto space-y-5 text-xs">
				<!-- 8D Stage Progress Stepper -->
				<div class="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
					<div class="text-[11px] font-black uppercase text-slate-700 dark:text-slate-300 mb-3 flex items-center justify-between">
						<span>Alur Penanganan 8D Terpadu</span>
						<span class="text-[10px] font-medium text-slate-500 dark:text-slate-400 capitalize">{stage.desc}</span>
					</div>

					<div class="grid grid-cols-4 sm:grid-cols-7 gap-1.5 text-center">
						{#each STAGE_ORDER as sKey}
							{@const sCfg = STAGE_CONFIG[sKey]}
							{@const isPassed = isStagePassed(sKey, item.status)}
							{@const isCurrent = item.status === sKey}
							<div class="flex flex-col items-center gap-1">
								<div
									class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black transition-all {isCurrent ? 'bg-blue-600 text-white ring-4 ring-blue-500/20 shadow-xs' : isPassed ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500'}"
								>
									{#if isPassed && !isCurrent}
										<IconCircleCheck size={15} />
									{:else}
										{sKey.slice(0, 2).toUpperCase()}
									{/if}
								</div>
								<span class="text-[9px] font-bold leading-tight {isCurrent ? 'text-blue-600 dark:text-blue-400' : isPassed ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}">
									{sCfg.short}
								</span>
							</div>
						{/each}
					</div>

					<!-- Meta fase & tautan tiket support -->
					<div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-700/70 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
						{#if item.status_changed_at}
							<span>Fase terakhir diubah: <span class="text-slate-700 dark:text-slate-300">{formatDate(item.status_changed_at)}</span></span>
						{/if}
						{#if item.sla_due_at}
							<span class={isOverdue(item.sla_due_at, item.status) ? 'text-rose-600 dark:text-rose-400' : ''}>
								Batas SLA tahap ini: <span class="font-bold">{formatDate(item.sla_due_at)}</span>
							</span>
						{/if}
						{#if item.support_tiket_id}
							<a
								href={`/support/${item.support_tiket_id}`}
								class="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
							>
								<IconExternalLink size={13} /> Tiket Support #{item.support_tiket_id}
							</a>
						{/if}
					</div>
				</div>

				<!-- Kontrol Fase 8D (permission-gated: manage_komplain_8d) -->
				{#if canManage8D}
					{@const prevStage = stageAt(-1, item.status)}
					{@const nextStage = stageAt(1, item.status)}
					<div class="p-4 bg-white dark:bg-slate-900 border-2 border-blue-200 dark:border-blue-900/70 rounded-2xl space-y-3">
						<div class="flex items-center gap-2 text-blue-900 dark:text-blue-200 font-black text-xs">
							<IconClipboardCheck size={16} class="text-blue-600 dark:text-blue-400" />
							<span>Kelola Fase Penanganan 8D</span>
						</div>

						{#if STAGE_WITH_RESOLUSI.includes(item.status) || (nextStage && STAGE_WITH_RESOLUSI.includes(nextStage))}
							<div class="space-y-2">
								<label class="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 block">
									Ringkasan Resolusi / Tindakan
								</label>
								<textarea
									rows="2"
									bind:value={resolusiInput}
									placeholder="Tindakan korektif yang diambil, hasil validasi, kesepakatan dengan customer..."
									class="w-full p-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
								></textarea>
								<div class="flex items-center gap-2">
									<span class="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Rating Customer (saat tutup)</span>
									<select
										bind:value={ratingInput}
										class="px-2 py-1 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-hidden"
									>
										<option value={null}>—</option>
										{#each [1, 2, 3, 4, 5] as r}
											<option value={r}>{r} ★</option>
										{/each}
									</select>
								</div>
							</div>
						{/if}

						{#if stageError}
							<p class="text-[11px] font-bold text-rose-600 dark:text-rose-400">{stageError}</p>
						{/if}

						<div class="flex items-center justify-between gap-2">
							<button
								type="button"
								class="px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
								disabled={!prevStage || savingStage}
								onclick={() => changeStage(-1)}
							>
								← {prevStage ? STAGE_CONFIG[prevStage].short : 'Mundur'}
							</button>
							<button
								type="button"
								class="flex-1 px-4 py-2.5 rounded-xl text-xs font-black text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xs transition-colors"
								disabled={!nextStage || savingStage}
								onclick={() => changeStage(1)}
							>
								{#if savingStage}
									<IconLoader2 size={15} class="animate-spin" />
								{:else}
									<IconChevronRight size={15} />
								{/if}
								<span>Maju ke {nextStage ? STAGE_CONFIG[nextStage].label : 'fase berikutnya'}</span>
							</button>
						</div>
						<p class="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
							Perubahan menulis <span class="font-mono">status</span> &amp; <span class="font-mono">status_changed_at</span>. Investigasi mendalam &amp; SLA tetap dikelola tim QC/R&amp;D di dashboard admin.
						</p>
					</div>
				{/if}

				<!-- Resolusi & Penutupan (read-only, jika ada) -->
				{#if item.resolusi || item.resolved_date || item.rating_after}
					<div class="p-4 bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/80 rounded-2xl space-y-2">
						<div class="flex items-center gap-2 text-emerald-900 dark:text-emerald-200 font-black text-xs">
							<IconCircleCheck size={16} class="text-emerald-600 dark:text-emerald-400" />
							<span>Resolusi &amp; Penutupan</span>
						</div>
						{#if item.resolusi}
							<p class="text-[11px] text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{item.resolusi}</p>
						{/if}
						<div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
							{#if item.resolved_date}
								<span>Tuntas: <span class="font-bold text-slate-800 dark:text-slate-200">{formatDate(item.resolved_date)}</span></span>
							{/if}
							{#if item.resolved_by_name}
								<span>Oleh: <span class="font-bold text-slate-800 dark:text-slate-200">{item.resolved_by_name}</span></span>
							{/if}
							{#if item.rating_after}
								<span>Rating customer: <span class="font-bold text-amber-600 dark:text-amber-400">{item.rating_after} ★</span></span>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Information Grid -->
				<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50/50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
					<div>
						<span class="text-[10px] text-slate-400 dark:text-slate-500 font-bold block">Tanggal Lapor</span>
						<span class="font-bold text-slate-800 dark:text-slate-200">{formatDate(item.tanggal)}</span>
					</div>
					<div>
						<span class="text-[10px] text-slate-400 dark:text-slate-500 font-bold block">Kategori</span>
						<span class="font-bold text-slate-800 dark:text-slate-200">{KATEGORI_LABELS[item.kategori] || item.kategori}</span>
					</div>
					<div>
						<span class="text-[10px] text-slate-400 dark:text-slate-500 font-bold block">Site / Pabrik</span>
						<span class="font-bold text-slate-800 dark:text-slate-200">{SITE_LABELS[item.site || 'pusat'] || item.site}</span>
					</div>
					<div>
						<span class="text-[10px] text-slate-400 dark:text-slate-500 font-bold block">No. Batch / SJ</span>
						<span class="font-mono font-bold text-blue-600 dark:text-blue-400">{item.batch_number || '-'}</span>
					</div>
					<div>
						<span class="text-[10px] text-slate-400 dark:text-slate-500 font-bold block">Pelapor Lapangan</span>
						<span class="font-bold text-slate-800 dark:text-slate-200">{item.pic || '-'}</span>
					</div>
					<div>
						<span class="text-[10px] text-slate-400 dark:text-slate-500 font-bold block">Kontak Customer</span>
						<span class="font-bold text-slate-800 dark:text-slate-200">{item.kontak_pelapor || '-'}</span>
					</div>
				</div>

				<!-- Deskripsi Komplain -->
				<div class="space-y-1.5">
					<div class="flex items-center justify-between">
						<h4 class="text-xs font-black uppercase text-slate-700 dark:text-slate-300">Deskripsi & Kronologi Masalah:</h4>
						<button
							type="button"
							class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline"
							onclick={() => copyComplaintSummary(item)}
						>
							{#if copiedId === item.id}
								<IconCheck size={13} class="text-emerald-500" />
								<span class="text-emerald-600 dark:text-emerald-400">Tersalin!</span>
							{:else}
								<IconCopy size={13} />
								<span>Salin Ringkasan (WhatsApp)</span>
							{/if}
						</button>
					</div>
					<div class="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
						{item.deskripsi}
					</div>
				</div>

				<!-- Foto Bukti Lampiran -->
				{#if item.foto}
					<div class="space-y-1.5">
						<h4 class="text-xs font-black uppercase text-slate-700 dark:text-slate-300">Foto Bukti Lampiran:</h4>
						<div class="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-2 flex items-center justify-center">
							<img
								use:secureAssetSrc={item.foto}
								alt="Foto Bukti Komplain"
								class="max-h-72 w-auto object-contain rounded-xl shadow-xs"
							/>
						</div>
					</div>
				{/if}

				<!-- Investigasi QC / R&D & Catatan Solusi (Jika ada) -->
				{#if item.sebab || item.catatan_internal || item.escalated_project_id || item.retest_session_id}
					<div class="p-4 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/80 rounded-2xl space-y-2.5">
						<div class="flex items-center gap-2 text-blue-900 dark:text-blue-200 font-black text-xs">
							<IconSparkles size={16} class="text-blue-600 dark:text-blue-400" />
							<span>Tindak Lanjut QC & R&D (Alur 8D)</span>
						</div>
						{#if item.sebab}
							<div class="text-[11px]">
								<span class="text-slate-500 dark:text-slate-400 font-bold">Akar Masalah (D4):</span>
								<span class="font-black text-slate-900 dark:text-white ml-1">{item.sebab}</span>
							</div>
						{/if}
						{#if item.catatan_internal}
							<div class="text-[11px]">
								<span class="text-slate-500 dark:text-slate-400 font-bold">Catatan Tindakan Korektif:</span>
								<p class="text-slate-800 dark:text-slate-200 mt-0.5 whitespace-pre-wrap">{item.catatan_internal}</p>
							</div>
						{/if}
						<div class="flex flex-wrap gap-2 pt-1">
							{#if item.retest_session_id}
								<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold">
									<IconCircleCheck size={13} /> Sesi Uji Retest #{item.retest_session_id}
								</span>
							{/if}
							{#if item.escalated_project_id}
								<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-300 text-[10px] font-bold">
									<IconExternalLink size={13} /> Proyek R&D Terkait #{item.escalated_project_id}
								</span>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<!-- Modal Footer -->
			<div class="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-800/60">
				<button
					type="button"
					class="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors"
					onclick={() => copyComplaintSummary(item)}
				>
					<IconCopy size={14} class="inline mr-1" /> Salin Ringkasan
				</button>
				<button
					type="button"
					class="px-5 py-2.5 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 text-white font-bold rounded-xl text-xs transition-colors shadow-xs"
					onclick={() => (selectedDetail = null)}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Photo Annotator Component -->
{#if annotatingFile}
	<PhotoAnnotator
		file={annotatingFile}
		onSave={(annotated) => {
			photoFile = annotated;
			komplainPersist.savePhoto(KOMPLAIN_PHOTO_KEY, annotated);
			annotatingFile = null;
		}}
		onCancel={() => (annotatingFile = null)}
	/>
{/if}

