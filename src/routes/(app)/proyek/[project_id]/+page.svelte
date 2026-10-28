<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { openPlaceholderWindow } from '$lib/utils/openWindowAsync';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { authStore, shouldFilterProjectsByLeader } from '$lib/stores/auth';
	import { bolehAksesProyek, fetchDemisionerProjectIds, isDemisionerLeader } from '$lib/services/projectScope';
	import {
		getProjectById,
		getSoCustomerById,
		getSoCustomerByProjectId,
		getSoCustomerDetails,
		getProjectSoIds,
		getSoCustomersByIds,
		getSoCustomerDetailsForSos
	} from '$lib/services/projects';
	import { sumNilaiPo } from '$lib/utils/projectSoIds';
	import { getReports } from '$lib/services/reports';
	import { getDokumenByProject, uploadDokumen, deleteDokumen, getDownloadUrl, formatFileSize, getFileTypeIcon } from '$lib/services/dokumenApi';
	import {
		getProjectDocuments,
		getDocumentTypes,
		uploadProjectDocument,
		deleteProjectDocument,
		getDownloadUrl as getUnifiedDownloadUrl,
		getTransmittals,
		createTransmittal,
		updateTransmittal,
		getChecklistTemplates,
		getProjectChecklistOverride,
		getProjectDocumentTypeStatuses,
		updateProjectDocumentSimpleStatus,
		type ProjectDocument,
		type DocumentType,
		type Transmittal,
		type ChecklistTemplate
	} from '$lib/services/projectDocumentsApi';
	import {
		enqueueDocumentUpload,
		getQueuedDocumentUploads,
		flushDocumentQueue,
		registerDocumentQueueAutoFlush,
		type QueuedDocumentUpload
	} from '$lib/utils/offlineDocumentQueue';
	import {
		cacheDocumentFile,
		getCachedDocumentFile,
		removeCachedDocumentFile,
		getAllCachedFileIds
	} from '$lib/utils/offlineDocumentCache';
	import { createSendRequest, getSendRequestsByProject, uploadSendRequestMedia, type SendRequestRow } from '$lib/services/omniSendRequest';
	import ProjectAktualisasiPanel from '$lib/components/project/ProjectAktualisasiPanel.svelte';
	import ProjectBepTrackerCard from '$lib/components/project/ProjectBepTrackerCard.svelte';
	import KesiapanHariIniCard from '$lib/components/project/KesiapanHariIniCard.svelte';
	import ProjectBpjstkBadge from '$lib/components/project/ProjectBpjstkBadge.svelte';
	import PenagihanStatusCard from '$lib/components/project/PenagihanStatusCard.svelte';
	import LegalDisputeBadge from '$lib/components/project/LegalDisputeBadge.svelte';
	import ProjectFinancialHealthBadge from '$lib/components/project/ProjectFinancialHealthBadge.svelte';
	import ProjectCompressorClaimCard from '$lib/components/project/ProjectCompressorClaimCard.svelte';
	import ProjectManpowerAssign from '$lib/components/project/ProjectManpowerAssign.svelte';
	import ProjectCharterTab from '$lib/components/ProjectCharterTab.svelte';
	import ProjectPayrollRecap from '$lib/components/project/ProjectPayrollRecap.svelte';
	import ManualAbsensiModal from '$lib/components/project/ManualAbsensiModal.svelte';
	import HseCompletenessCard from '$lib/components/project/HseCompletenessCard.svelte';
	import WpoComplianceCard from '$lib/components/project/WpoComplianceCard.svelte';
	import ProjectKontrakPanel from '$lib/components/proyek/ProjectKontrakPanel.svelte';
	import GrandPoPaketCards from '$lib/components/project/GrandPoPaketCards.svelte';
	import PersiapanLeaderPanel from '$lib/components/proyek/PersiapanLeaderPanel.svelte';
	import ProjectBoronganPanel from '$lib/components/proyek/ProjectBoronganPanel.svelte';
	import ProjectInventoryTab from '$lib/components/project/ProjectInventoryTab.svelte';
	import ProjectSitePlanTab from '$lib/components/project/ProjectSitePlanTab.svelte';
	import { fetchWbsTree, updateLeafCompletion, type WbsNode } from '$lib/services/wbsApi';
	import {
		getProjectContractSummary, getProjectContractTermins, retentionDaysRemaining,
		type ProjectContractSummary, type ProjectContractTermin
	} from '$lib/services/projectContract';
	import { getProjectBudgetHealth, type ProjectBudgetHealth } from '$lib/services/projectSummary';
	import { getMyDelegationInfo, type DelegationInfo } from '$lib/services/plDelegation';
	import { getProjectSpkStatus, type ProjectSpkStatus } from '$lib/services/paintOrderStatus';
	import { fetchInTransitShipments, type GRShipment } from '$lib/services/goodsReceived';
	import { getProjectStatusLabel, getProjectStatusClass } from '$lib/utils/projectStatus';
	import ProjectPhaseWizardCompact from '$lib/components/ProjectPhaseWizardCompact.svelte';
	import SiteDemobSignalCard from '$lib/components/project/SiteDemobSignalCard.svelte';
	import PaStatusCard from '$lib/components/project/PaStatusCard.svelte';
	import ProjectHandoverBriefingCard from '$lib/components/leader/ProjectHandoverBriefingCard.svelte';
	import { printSuratTugas } from '$lib/utils/printSuratTugas';
	import {
		IconArrowLeft, IconBuilding, IconMapPin, IconUser,
		IconInfoCircle, IconFileText, IconWallet,
		IconClipboardList, IconPackage, IconCalendarTime,
		IconReceipt2, IconExternalLink, IconAlertCircle,
		IconChartBar, IconLoader2, IconBriefcase, IconCalendar,
		IconUsers, IconTool, IconFolder, IconClock, IconList,
		IconCurrencyDollar, IconChartLine, IconFileInvoice,
		IconUserCheck, IconCheckbox, IconBox,
		IconUpload, IconDownload, IconTrash, IconCamera, IconRefresh,
		IconCloudDownload, IconCloudCheck,
		IconSend, IconChevronRight, IconCopy, IconCheck,
		IconPrinter, IconFileExport
	} from '@tabler/icons-svelte';
	import ProjectExportSheet from '$lib/components/project/ProjectExportSheet.svelte';
	import FotoAwalProyekCard from '$lib/components/project/FotoAwalProyekCard.svelte';
	import { auth as firebaseAuth } from '$lib/firebase';
	import {
		registerPdfExportAutoFlush,
		type QueuedPdfExport
	} from '$lib/utils/offlineExportPdfQueue';

	// Antrian PDF lapangan (§5.5): begitu online, kirim ulang & langsung unduh + notif.
	async function sendQueuedPdfExport(entry: QueuedPdfExport): Promise<void> {
		const user = firebaseAuth?.currentUser;
		if (!user) throw new Error('Belum login');
		const token = await user.getIdToken();
		const res = await fetch('/api/export/project', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				projectId: entry.projectId,
				section: entry.section,
				title: entry.title,
				columns: entry.columns,
				rows: entry.rows
			})
		});
		if (!res.ok) throw new Error(`PDF antrean gagal (${res.status})`);
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${entry.section}-${entry.projectId}.pdf`;
		a.click();
		URL.revokeObjectURL(url);
		(window as any).__showToast?.('PDF yang tertunda sudah siap & terunduh.', 'success');
	}

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let isLeaderView = $state(false);

	// 2-level tab state
	type MainTab = 'informasi' | 'keuangan' | 'laporan' | 'progress' | 'manpower' | 'barang' | 'hse' | 'dokumen' | 'kirim';
	let activeTab = $state<MainTab>('informasi');
	let activeSubTab = $state<string>('charter');
	let showManualAbsensi = $state(false);
	let showExportSheet = $state(false);
	let pendingGrShipments = $state<GRShipment[]>([]);

	let SUB_TABS = $derived({
		informasi: [
			{ id: 'charter', label: 'Charter', emoji: '📋' },
			{ id: 'info', label: 'Info', emoji: 'ℹ️' }
		],
		keuangan: isLeaderView ? [
			{ id: 'rap', label: 'Detail Pekerjaan', emoji: '📝' },
			{ id: 'pengajuan-anggaran', label: 'Keuangan', emoji: '💸' },
			{ id: 'gajian', label: 'Gajian', emoji: '💰' },
			{ id: 'kontrak', label: 'Kontrak', emoji: '📄' }
		] : [
			{ id: 'rap', label: 'RAP', emoji: '💰' },
			{ id: 'aktualisasi', label: 'Aktualisasi', emoji: '📊' },
			{ id: 'laporan-keuangan', label: 'Laporan Keuangan (HPP)', emoji: '📈' },
			{ id: 'pengajuan-anggaran', label: 'Keuangan', emoji: '💸' },
			{ id: 'gajian', label: 'Gajian', emoji: '💰' },
			{ id: 'kontrak', label: 'Kontrak', emoji: '📄' }
		],
		laporan: [
			{ id: 'report', label: 'Report', emoji: '📋' },
			{ id: 'laporan-harian', label: 'Laporan Harian', emoji: '📆' },
			{ id: 'dokumentasi-ba', label: 'Dokumentasi Before/After', emoji: '📸' },
			{ id: 'galeri', label: 'Galeri Foto', emoji: '🖼️' }
		],
		progress: [
			{ id: 'persiapan', label: 'Persiapan', emoji: '🚦' },
			{ id: 'timeline', label: 'Timeline', emoji: '📅' },
			{ id: 'wbs', label: 'WBS', emoji: '🌳' },
			{ id: 'list-pekerjaan', label: 'List Pekerjaan', emoji: '📝' },
			{ id: 'packing-list', label: 'Packing List', emoji: '📦' },
			{ id: 'site-plan', label: 'Site Plan', emoji: '📐' },
			{ id: 'site-survey', label: 'Site Survey', emoji: '📍' },
			{ id: 'quality', label: 'Quality Cockpit', emoji: '✅' },
			{ id: 'punch-list', label: 'Punch List', emoji: '📌' },
			{ id: 'rfi', label: 'RFI', emoji: '📨' },
			{ id: 'itp', label: 'ITP', emoji: '📐' },
			{ id: 'material-inspection', label: 'Material Inspection', emoji: '📦' },
			{ id: 'coating-log', label: 'Coating Log', emoji: '🖌️' },
			{ id: 'closeout', label: 'Checklist Closeout', emoji: '🏁' },
			{ id: 'presentasi', label: 'Mode Presentasi', emoji: '📽️' }
		],
		manpower: [
			{ id: 'manpower-spk', label: 'Manpower & SPK', emoji: '👷' },
			{ id: 'project-leader', label: 'Project Leader', emoji: '👨‍💼' },
			{ id: 'borongan', label: 'Borongan', emoji: '📐' },
			{ id: 'absensi', label: 'Absensi', emoji: '🕒' }
		],
		barang: [
			{ id: 'list-permintaan', label: 'List Permintaan', emoji: '📦' },
			{ id: 'status-permintaan', label: 'Status Permintaan', emoji: '📊' },
			{ id: 'stock-management', label: 'Stock Management', emoji: '🏢' }
		],
		hse: [],
		dokumen: [],
		kirim: []
	});

	// Default sub-tab for each main tab
	let DEFAULT_SUB = $derived({
		informasi: 'charter',
		keuangan: isLeaderView ? 'rap' : 'rap',
		laporan: 'report',
		// Kickoff Wizard v2: saat mode Persiapan (proyek belum jalan), buka langsung ke
		// sub-tab Persiapan — itu pekerjaan utama Leader di fase ini.
		progress:
			project?.status === 'waiting' || project?.status === 'draft' ? 'persiapan' : 'timeline',
		manpower: 'manpower-spk',
		barang: 'list-permintaan',
		hse: '',
		dokumen: '',
		kirim: ''
	});

	// Dokumen state — dokumen lama (tag directus_files, dokumenApi.ts) + dokumen terpadu
	// (project_documents, projectDocumentsApi.ts). Upload BARU selalu ke jalur terpadu;
	// dokumen lama tetap ditampilkan sampai admin menjalankan migrasi backfill (Fase 1 ERP).
	let dokumen = $state<any[]>([]);
	let dokumenLoading = $state(false);
	let uploadingDokumen = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let cameraInputEl = $state<HTMLInputElement | null>(null);
	let uploadingCameraPhoto = $state(false);

	// Offline Upload Queue — Fitur Lapangan #3: dokumen yang gagal terkirim karena
	// sinyal lemah/offline disimpan lokal (IndexedDB), otomatis kirim ulang saat online.
	let offlineQueueCount = $state(0);
	let isFlushingDocQueue = $state(false);

	async function refreshOfflineQueueCount() {
		if (!projectId) return;
		const all = await getQueuedDocumentUploads();
		offlineQueueCount = all.filter((e) => e.projectId === projectId).length;
	}

	async function sendQueuedDocument(entry: QueuedDocumentUpload) {
		const file = new File([entry.fileBlob], entry.fileName);
		const res = await uploadProjectDocument(entry.projectId, file, {
			documentTypeId: entry.documentTypeId,
			documentPhase: entry.documentPhase,
			isSensitive: entry.isSensitive,
			uploadedByName: entry.uploadedByName
		});
		if (!res.success) throw new Error(res.error || 'Gagal mengunggah dokumen saat sinkronisasi');
	}

	async function handleManualFlushDocQueue() {
		isFlushingDocQueue = true;
		await flushDocumentQueue(sendQueuedDocument).catch(() => {});
		await refreshOfflineQueueCount();
		await loadDokumen();
		loadChecklistForBadge().catch(() => {});
		isFlushingDocQueue = false;
	}

	// Download for Offline — Fitur Lapangan #6: simpan file penting (Method Statement,
	// Drawing, dst) di HP supaya bisa dibuka tanpa sinyal. BEDA dari Offline Upload Queue
	// di atas (arah datanya kebalik -- ini file yang SUDAH ada di server).
	let cachedFileIds = $state<Set<string>>(new Set());
	let savingOfflineFileId = $state<string | null>(null);

	async function refreshCachedFileIds() {
		cachedFileIds = new Set(await getAllCachedFileIds());
	}

	async function handleSaveOffline(doc: UnifiedDoc) {
		if (!doc.fileId || !doc.downloadUrl) return;
		savingOfflineFileId = doc.fileId;
		try {
			const res = await fetch(doc.downloadUrl);
			if (!res.ok) throw new Error('Gagal mengunduh file');
			const blob = await res.blob();
			await cacheDocumentFile(doc.fileId, blob, doc.title);
			cachedFileIds = new Set([...cachedFileIds, doc.fileId]);
		} catch (e) {
			alert('Gagal menyimpan dokumen untuk offline. Coba lagi saat sinyal lebih baik.');
		} finally {
			savingOfflineFileId = null;
		}
	}

	// PRJ-28 (Aturan #5): jendela dibuka SINKRON di handler klik, baru diisi setelah cache IndexedDB terbaca —
	// kalau `await` dulu, Safari iOS memblokirnya sebagai pop-up.
	function handleOpenOffline(doc: UnifiedDoc) {
		if (!doc.fileId) return;
		const w = openPlaceholderWindow();
		getCachedDocumentFile(doc.fileId)
			.then((cached) => {
				if (!cached) {
					w.cancel();
					alert('Dokumen offline tidak ditemukan. Simpan ulang saat online.');
					return;
				}
				w.navigate(URL.createObjectURL(cached.blob));
			})
			.catch((e) => {
				w.cancel();
				console.error('Gagal membuka dokumen offline:', e);
				alert('Gagal membuka dokumen offline.');
			});
	}

	async function handleRemoveOffline(doc: UnifiedDoc) {
		if (!doc.fileId) return;
		await removeCachedDocumentFile(doc.fileId);
		const next = new Set(cachedFileIds);
		next.delete(doc.fileId);
		cachedFileIds = next;
	}

	let projectDocs = $state<ProjectDocument[]>([]);
	let documentTypes = $state<DocumentType[]>([]);
	let pendingFiles = $state<File[]>([]);
	let showTypePicker = $state(false);
	let pickedDocTypeId = $state<number | null>(null);

	const FASE_LABELS: Record<string, string> = {
		pre_project: 'Pre-Project & Tender', kontrak: 'Kontrak & Administrasi', engineering: 'Engineering & Teknis',
		pelaksanaan: 'Pelaksanaan & Progress', quality: 'Quality & Inspection', hse: 'HSE',
		korespondensi: 'Korespondensi', keuangan: 'Keuangan & Progress Claim', closeout: 'Closeout & Serah Terima', umum: 'Umum'
	};

	let groupedDocTypes = $derived(
		documentTypes.reduce((acc: Record<string, DocumentType[]>, t) => {
			(acc[t.fase_default] ??= []).push(t);
			return acc;
		}, {})
	);

	// Gabungan dokumen lama + terpadu, normalisasi bentuk supaya list dirender seragam.
	type UnifiedDoc = {
		key: string; source: 'legacy' | 'unified'; id: string | number; title: string; type: string | null;
		filesize: number | null; uploaded_on: string | null; fase: string | null; downloadUrl: string; status: string | null;
		fileId: string | null;
	};
	let unifiedDocs = $derived<UnifiedDoc[]>([
		...projectDocs.map((d) => ({
			key: `unified-${d.id}`, source: 'unified' as const, id: d.id, title: d.nomor_dokumen ? `${d.nama_dokumen} · ${d.nomor_dokumen}` : d.nama_dokumen,
			type: null, filesize: null, uploaded_on: d.date_created, fase: d.document_phase,
			downloadUrl: d.file_id ? getUnifiedDownloadUrl(d.file_id) : '', status: d.status, fileId: d.file_id || null
		})),
		...dokumen.map((d) => ({
			key: `legacy-${d.id}`, source: 'legacy' as const, id: d.id, title: d.title || d.filename_download,
			type: d.type, filesize: d.filesize, uploaded_on: d.uploaded_on, fase: null,
			downloadUrl: getDownloadUrl(d.id), status: null, fileId: d.id
		}))
	].sort((a, b) => new Date(b.uploaded_on || 0).getTime() - new Date(a.uploaded_on || 0).getTime()));

	// Search & filter Document Browser — cari nama dokumen, filter per fase.
	let docSearchQuery = $state('');
	let docFaseFilter = $state('semua');

	let availableFases = $derived([...new Set(unifiedDocs.map((d) => d.fase || '_belum_dikategorikan'))]);

	let filteredUnifiedDocs = $derived(
		unifiedDocs.filter((d) => {
			if (docFaseFilter !== 'semua' && (d.fase || '_belum_dikategorikan') !== docFaseFilter) return false;
			if (docSearchQuery.trim() && !d.title.toLowerCase().includes(docSearchQuery.trim().toLowerCase())) return false;
			return true;
		})
	);

	let groupedDocs = $derived(
		filteredUnifiedDocs.reduce((acc: Record<string, UnifiedDoc[]>, d) => {
			const key = d.fase || '_belum_dikategorikan';
			(acc[key] ??= []).push(d);
			return acc;
		}, {})
	);

	function getActorName(): string {
		const auth = get(authStore);
		return auth.karyawanName || auth.user?.displayName || auth.user?.email || 'Lapangan';
	}

	async function loadDokumen() {
		if (!projectId) return;
		dokumenLoading = true;
		const [legacyRes, unifiedRes] = await Promise.all([getDokumenByProject(projectId), getProjectDocuments(projectId)]);
		dokumen = legacyRes.data;
		projectDocs = unifiedRes.data;
		dokumenLoading = false;
	}

	async function loadDocumentTypes() {
		if (documentTypes.length) return;
		const res = await getDocumentTypes();
		documentTypes = res.data;
	}

	// Notification Badge — hitung jenis dokumen wajib (dari template checklist admin) yang
	// belum ada di proyek ini, ditampilkan sebagai badge merah di tab Dokumen.
	let checklistTemplates = $state<ChecklistTemplate[]>([]);
	let projectTemplateOverride = $state<number | null>(null);
	let docTypeStatusesForBadge = $state<{ document_type_id: number | null; status: string | null }[]>([]);

	async function loadChecklistForBadge() {
		if (!projectId) return;
		const [templatesRes, overrideRes, statusesRes] = await Promise.all([
			getChecklistTemplates(),
			getProjectChecklistOverride(projectId),
			getProjectDocumentTypeStatuses(projectId)
		]);
		checklistTemplates = templatesRes.data;
		projectTemplateOverride = overrideRes.data;
		docTypeStatusesForBadge = statusesRes.data;
	}

	let applicableTemplate = $derived(checklistTemplates.find((t) => t.id === projectTemplateOverride) || checklistTemplates.find((t) => t.is_default) || null);
	let requiredChecklistItems = $derived((applicableTemplate?.items || []).filter((i) => i.is_required));
	let missingRequiredCount = $derived(
		requiredChecklistItems.filter((i) => !docTypeStatusesForBadge.some((d) => d.document_type_id === i.document_type_id && d.status !== 'superseded')).length
	);
	let checklistViewItems = $derived(
		requiredChecklistItems.map((i) => ({
			...i,
			fulfilled: docTypeStatusesForBadge.some((d) => d.document_type_id === i.document_type_id && d.status !== 'superseded'),
			nama: documentTypes.find((t) => t.id === i.document_type_id)?.nama || `#${i.document_type_id}`
		}))
	);
	let showChecklistView = $state(false);

	function handleUploadDokumen(files: FileList | null) {
		if (!files || !files.length || !projectId) return;
		pendingFiles = Array.from(files);
		pickedDocTypeId = null;
		showTypePicker = true;
		loadDocumentTypes();
	}

	function cancelTypePicker() {
		showTypePicker = false;
		pendingFiles = [];
		if (fileInputEl) fileInputEl.value = '';
	}

	async function confirmUploadWithType() {
		if (!projectId || !pendingFiles.length) return;
		uploadingDokumen = true;
		const type = documentTypes.find((t) => t.id === pickedDocTypeId) || null;
		const actorName = getActorName();
		for (const file of pendingFiles) {
			const res = await uploadProjectDocument(projectId, file, {
				documentTypeId: type?.id ?? null,
				documentPhase: type?.fase_default ?? null,
				isSensitive: type?.is_sensitive_default ?? false,
				uploadedByName: actorName
			});
			if (!res.success && res.isNetworkError) {
				await enqueueDocumentUpload({
					client_txn_id: crypto.randomUUID(),
					projectId,
					fileBlob: file,
					fileName: file.name,
					namaDokumen: file.name,
					documentTypeId: type?.id ?? null,
					documentPhase: type?.fase_default ?? null,
					isSensitive: type?.is_sensitive_default ?? false,
					uploadedByName: actorName,
					createdAt: new Date().toISOString()
				});
			}
		}
		showTypePicker = false;
		pendingFiles = [];
		if (fileInputEl) fileInputEl.value = '';
		await loadDokumen();
		loadChecklistForBadge().catch(() => {});
		await refreshOfflineQueueCount();
		uploadingDokumen = false;
	}

	// Camera Integration — Fitur Lapangan #4: foto langsung dari kamera otomatis masuk ke
	// jenis dokumen PHT (Dokumentasi Foto), tanpa lewat sheet pilih jenis (sudah pasti fotonya).
	async function handleCameraCapture(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file || !projectId) return;
		await loadDocumentTypes();
		const phtType = documentTypes.find((t) => t.kode === 'PHT') || null;
		uploadingCameraPhoto = true;
		const actorName = getActorName();
		const res = await uploadProjectDocument(projectId, file, {
			documentTypeId: phtType?.id ?? null,
			documentPhase: phtType?.fase_default ?? 'pelaksanaan',
			isSensitive: false,
			uploadedByName: actorName
		});
		if (!res.success && res.isNetworkError) {
			await enqueueDocumentUpload({
				client_txn_id: crypto.randomUUID(),
				projectId,
				fileBlob: file,
				fileName: file.name,
				namaDokumen: file.name,
				documentTypeId: phtType?.id ?? null,
				documentPhase: phtType?.fase_default ?? 'pelaksanaan',
				isSensitive: false,
				uploadedByName: actorName,
				createdAt: new Date().toISOString()
			});
		}
		if (cameraInputEl) cameraInputEl.value = '';
		await loadDokumen();
		loadChecklistForBadge().catch(() => {});
		await refreshOfflineQueueCount();
		uploadingCameraPhoto = false;
	}

	async function handleDeleteDokumen(doc: UnifiedDoc) {
		if (!confirm(`Hapus dokumen "${doc.title}"?`)) return;
		if (doc.source === 'unified') {
			const res = await deleteProjectDocument(doc.id as number);
			if (res.success) projectDocs = projectDocs.filter((d) => d.id !== doc.id);
		} else {
			const res = await deleteDokumen(doc.id as string);
			if (res.success) dokumen = dokumen.filter((d) => d.id !== doc.id);
		}
	}

	// Simple Status Update — geser antara "Sudah Upload" (draft) dan "Butuh Review" (review)
	// tanpa workflow approval penuh (itu tetap khusus admin).
	async function toggleSimpleStatus(doc: UnifiedDoc) {
		const next = doc.status === 'review' ? 'draft' : 'review';
		const res = await updateProjectDocumentSimpleStatus(doc.id as number, next);
		if (res.success) {
			const target = projectDocs.find((d) => d.id === doc.id);
			if (target) { target.status = next; projectDocs = [...projectDocs]; }
		}
	}

	// Transmittal Log — catat pengiriman dokumen fisik/salinan ke klien/konsultan
	let transmittals = $state<Transmittal[]>([]);
	let showTransmittalLog = $state(false);
	let showTransmittalForm = $state(false);
	let transmittalSaving = $state(false);
	function emptyTransmittalForm() {
		return { project_document_id: null as number | null, nama_dokumen_manual: '', tujuan: '', pic_penerima: '', tanggal_kirim: new Date().toISOString().slice(0, 10), metode: 'langsung', catatan: '' };
	}
	let transmittalForm = $state(emptyTransmittalForm());

	async function loadTransmittals() {
		if (!projectId || transmittals.length) { showTransmittalLog = !showTransmittalLog; return; }
		const res = await getTransmittals(projectId);
		transmittals = res.data;
		showTransmittalLog = true;
	}

	async function handleCreateTransmittal() {
		if (!transmittalForm.tujuan.trim()) return;
		if (!transmittalForm.project_document_id && !transmittalForm.nama_dokumen_manual.trim()) return;
		transmittalSaving = true;
		const auth = get(authStore);
		const dikirimOleh = auth.karyawanName || auth.user?.displayName || auth.user?.email || 'Lapangan';
		const res = await createTransmittal(projectId, { ...transmittalForm, project_document_id: transmittalForm.project_document_id ?? undefined, dikirim_oleh: dikirimOleh });
		if (res.success) {
			transmittalForm = emptyTransmittalForm();
			showTransmittalForm = false;
			transmittals = [];
			await loadTransmittals();
		}
		transmittalSaving = false;
	}

	async function markTransmittalReceived(t: Transmittal) {
		const res = await updateTransmittal(t.id, { status: 'diterima', tanggal_terima: new Date().toISOString().slice(0, 10) });
		if (res.success) {
			t.status = 'diterima';
			t.tanggal_terima = new Date().toISOString().slice(0, 10);
			transmittals = [...transmittals];
		}
	}

	// Manpower summary (rekap kehadiran dari laporan harian)
	let manpowerSummary = $state<{ workers: Record<string, { count: number; roles: string[]; }>, totalDays: number; totalManpower: number } | null>(null);
	let manpowerSummaryLoading = $state(false);

	async function loadManpowerSummary() {
		if (!projectId || manpowerSummaryLoading || manpowerSummary) return;
		manpowerSummaryLoading = true;
		try {
			const reports = await getReports(projectId, { limit: 30, sort: '-date_created' });
			const workerMap: Record<string, { count: number; roles: Set<string> }> = {};
			let totalManpower = 0;

			for (const report of reports as any[]) {
				let mp = report.manpower;
				if (typeof mp === 'string') { try { mp = JSON.parse(mp); } catch { continue; } }
				if (!Array.isArray(mp)) continue;
				for (const group of mp) {
					totalManpower += Number(group.count) || 0;
					if (Array.isArray(group.workers)) {
						for (const w of group.workers) {
							const name = w?.nama || w?.name || (typeof w === 'string' ? w : null);
							if (!name) continue;
							if (!workerMap[name]) workerMap[name] = { count: 0, roles: new Set() };
							workerMap[name].count++;
							if (group.role) workerMap[name].roles.add(group.role);
						}
					}
				}
			}

			// Convert Sets to arrays for reactivity
			const workersOut: Record<string, { count: number; roles: string[] }> = {};
			for (const [k, v] of Object.entries(workerMap)) {
				workersOut[k] = { count: v.count, roles: Array.from(v.roles) };
			}
			manpowerSummary = { workers: workersOut, totalDays: (reports as any[]).length, totalManpower };
		} catch (e) {
			console.error('loadManpowerSummary:', e);
		} finally {
			manpowerSummaryLoading = false;
		}
	}

	const MAIN_TAB_IDS: MainTab[] = ['informasi', 'keuangan', 'laporan', 'progress', 'manpower', 'barang', 'hse', 'dokumen', 'kirim'];
	const MAIN_TAB_LABELS: Record<MainTab, string> = {
		informasi: 'Informasi', keuangan: 'Keuangan', laporan: 'Laporan', progress: 'Progress',
		manpower: 'Manpower & Leader', barang: 'Barang', hse: 'HSE', dokumen: 'Dokumen', kirim: 'Kirim ke Pelanggan'
	};
	const MAIN_TAB_ICONS: Record<MainTab, any> = {
		informasi: IconInfoCircle,
		keuangan: IconWallet,
		laporan: IconFileText,
		progress: IconChartBar,
		manpower: IconUsers,
		barang: IconBox,
		hse: IconAlertCircle,
		dokumen: IconFolder,
		kirim: IconSend
	};

	// Fase 1 (Pertajam Navigasi Project v2): sinkron tab aktif ke URL (?tab=&sub=) agar
	// refresh/share link tidak balik ke tab awal (perbaiki F2). replaceState — bukan entri histori baru.
	function syncTabToUrl(tab: MainTab, sub: string) {
		const url = new URL(window.location.href);
		url.searchParams.set('tab', tab);
		if (sub) url.searchParams.set('sub', sub); else url.searchParams.delete('sub');
		goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function switchMainTab(tab: MainTab) {
		activeTab = tab;
		activeSubTab = DEFAULT_SUB[tab];
		if (tab === 'dokumen') loadDokumen();
		if (tab === 'manpower') loadManpowerSummary();
		if (tab === 'kirim') loadSendRequests();
		syncTabToUrl(tab, activeSubTab);
	}

	let linkCopied = $state(false);
	let linkCopiedTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyProjectLink() {
		try {
			await navigator.clipboard.writeText(window.location.href);
			linkCopied = true;
			clearTimeout(linkCopiedTimer);
			linkCopiedTimer = setTimeout(() => (linkCopied = false), 2000);
		} catch {
			// clipboard API tak tersedia (http/permission) — abaikan senyap
		}
	}

	// Fase 7 (Revamp Project Management v2): WBS read + update completion_pct node daun.
	// Struktur/bobot tetap diedit di Admin ERP — di lapangan hanya update progress harian.
	let wbsRoots = $state<WbsNode[]>([]);
	let wbsLoaded = $state(false);
	let wbsLoading = $state(false);
	let savingWbsId = $state<number | null>(null);
	let wbsSaveError = $state<string | null>(null);

	async function loadWbs() {
		if (!projectId || wbsLoading) return;
		wbsLoading = true;
		try {
			const { roots } = await fetchWbsTree(projectId);
			wbsRoots = roots;
			wbsLoaded = true;
		} finally {
			wbsLoading = false;
		}
	}

	async function saveLeafCompletion(nodeId: number, pct: number) {
		if (!projectId) return;
		savingWbsId = nodeId;
		wbsSaveError = null;
		try {
			await updateLeafCompletion(projectId, nodeId, pct);
			wbsLoaded = false;
			await loadWbs();
		} catch (e: any) {
			wbsSaveError = e?.message || 'Gagal menyimpan progress. Coba lagi.';
		} finally {
			savingWbsId = null;
		}
	}

	// Fase 6 (Rencana Laporan Keuangan v2): tab "Laporan Keuangan" — status penyerapan
	// budget dalam PERSENTASE saja (tanpa nilai Rupiah), konsisten dengan keputusan lama
	// app ini yang menyembunyikan angka finansial dari project leader.
	let budgetHealth = $state<ProjectBudgetHealth | null>(null);
	let budgetHealthLoading = $state(false);
	let budgetHealthLoaded = $state(false);

	async function loadBudgetHealth() {
		if (!project?.id || budgetHealthLoading) return;
		budgetHealthLoading = true;
		try {
			budgetHealth = await getProjectBudgetHealth(Number(project.id));
			budgetHealthLoaded = true;
		} catch (_) {
			budgetHealth = null;
		} finally {
			budgetHealthLoading = false;
		}
	}

	// Fase 6 (Sumber SPK Terpusat, 17 Sep 2026): "Status Permintaan" dulu placeholder
	// "tersedia di Admin ERP" — sekarang daftar SPK proyek read-only. Lapangan tetap
	// tidak membuat SPK di sini (lewat PL → Gudang seperti biasa).
	let spkStatusList = $state<ProjectSpkStatus[]>([]);
	let spkStatusLoading = $state(false);
	let spkStatusLoaded = $state(false);
	let spkStatusError = $state<string | null>(null);

	async function loadSpkStatus() {
		if (!project?.id || spkStatusLoading) return;
		spkStatusLoading = true;
		spkStatusError = null;
		try {
			spkStatusList = await getProjectSpkStatus(Number(project.id));
			spkStatusLoaded = true;
		} catch (e) {
			spkStatusError = e instanceof Error ? e.message : 'Gagal memuat status permintaan SPK.';
			spkStatusList = [];
		} finally {
			spkStatusLoading = false;
		}
	}

	// Sistem Delegasi Project Leader (Fase 2) — info siapa mendelegasikan, kapan, kenapa.
	let delegationInfo = $state<DelegationInfo | null>(null);
	let delegationInfoLoading = $state(false);
	let delegationInfoLoaded = $state(false);

	async function loadDelegationInfo() {
		if (!project?.id || delegationInfoLoading) return;
		delegationInfoLoading = true;
		try {
			delegationInfo = await getMyDelegationInfo(project.id);
			delegationInfoLoaded = true;
		} catch (_) {
			delegationInfo = null;
		} finally {
			delegationInfoLoading = false;
		}
	}

	function handlePrintSuratTugas() {
		if (!project) return;
		const mockSurat = {
			id: delegationInfo?.surat_tugas_id || null,
			nomor_surat: delegationInfo?.surat_tugas_nomor || `ST/EPI/${new Date().getMonth() + 1}${new Date().getFullYear()}/${project.id}`,
			tanggal_surat: delegationInfo?.tanggal_efektif || project.start_date || new Date().toISOString(),
			leader: delegationInfo?.leader_baru_nama || project.leader || '-',
			jabatan: 'Project Leader',
			lokasi: project.lokasi || '-',
			jenis_pekerjaan: project.jenis_project || 'Jasa Lapangan',
			periode_mulai: project.start_date || null,
			periode_selesai: project.end_date || null,
			keterangan: delegationInfo?.alasan || ''
		};
		const targetProject = {
			name: project.name || (soCustomer?.nomor_so ? `Proyek ${soCustomer.customer_name || ''} (${soCustomer.nomor_so})` : 'Pekerjaan Jasa Lapangan'),
			nomor_po: project.nomor_po || soCustomer?.nomor_so || '-',
			customer: project.customer || soCustomer?.customer_name || '-',
			lokasi: project.lokasi || '-',
			jenis_project: project.jenis_project || 'Jasa Lapangan'
		};
		printSuratTugas(mockSurat, targetProject, soDetails || []);
	}

	function openDossierPrint(type: string = 'all_components') {
		if (!project?.id) return;
		const adminBase = typeof window !== 'undefined' && window.location.hostname === 'localhost'
			? 'http://localhost:9390'
			: 'https://internal.eltamaprimaindo.com';
		const printUrl = `${adminBase}/print/grand-po/p${project.id}?type=${type}&stakeholder=operasional&depth=detailed`;
		window.open(printUrl, '_blank', 'noopener,noreferrer');
	}

	function selectSubTab(id: string) {
		if (id === 'site-survey') {
			goto(`/proyek/${projectId}/site-survey`);
			return;
		}
		if (id === 'quality') {
			goto(`/proyek/${projectId}/quality`);
			return;
		}
		if (id === 'punch-list') {
			goto(`/proyek/${projectId}/punch-list`);
			return;
		}
		if (id === 'rfi') {
			goto(`/proyek/${projectId}/rfi`);
			return;
		}
		if (id === 'itp') {
			goto(`/proyek/${projectId}/itp`);
			return;
		}
		if (id === 'material-inspection') {
			goto(`/proyek/${projectId}/material-inspection`);
			return;
		}
		if (id === 'coating-log') {
			goto(`/proyek/${projectId}/coating-log`);
			return;
		}
		if (id === 'dokumentasi-ba') {
			goto(`/proyek/${projectId}/dokumentasi-ba`);
			return;
		}
		if (id === 'galeri') {
			goto(`/proyek/${projectId}/galeri`);
			return;
		}
		if (id === 'closeout') {
			goto(`/proyek/${projectId}/closeout`);
			return;
		}
		if (id === 'presentasi') {
			goto(`/proyek/${projectId}/presentasi`);
			return;
		}
		activeSubTab = id;
		if (id === 'wbs' && !wbsLoaded) loadWbs();
		if (id === 'laporan-keuangan' && !budgetHealthLoaded) loadBudgetHealth();
		if (id === 'project-leader' && !delegationInfoLoaded) loadDelegationInfo();
		if (id === 'status-permintaan' && !spkStatusLoaded) loadSpkStatus();
		syncTabToUrl(activeTab, id);
	}

	function flattenWbs(nodes: WbsNode[], depth = 0, out: Array<{ node: WbsNode; depth: number }> = []) {
		for (const n of nodes) {
			out.push({ node: n, depth });
			if (n.children?.length) flattenWbs(n.children, depth + 1, out);
		}
		return out;
	}

	// ── Kirim via Admin (K-4, Bagian 9): PL tidak boleh chat langsung ke pelanggan ──
	let sendRequests = $state<SendRequestRow[]>([]);
	let sendRequestsLoading = $state(false);
	let sendNote = $state('');
	let sendMediaFile = $state<{ id: string; filename: string } | null>(null);
	let sendUploading = $state(false);
	let sendSubmitting = $state(false);
	let sendFileInputEl = $state<HTMLInputElement | null>(null);

	async function loadSendRequests() {
		if (!projectId) return;
		sendRequestsLoading = true;
		sendRequests = await getSendRequestsByProject(Number(projectId));
		sendRequestsLoading = false;
	}

	async function handleSendMediaPick(files: FileList | null) {
		const file = files?.[0];
		if (!file) return;
		sendUploading = true;
		sendMediaFile = await uploadSendRequestMedia(file);
		sendUploading = false;
	}

	async function submitSendRequest() {
		if (!sendNote.trim() && !sendMediaFile) return;
		const auth = get(authStore);
		sendSubmitting = true;
		try {
			await createSendRequest({
				project_id: Number(projectId),
				requested_by_uid: auth.user?.uid || null,
				requested_by_name: auth.karyawanName || auth.user?.displayName || auth.user?.email || 'Project Leader',
				note: sendNote.trim(),
				media_file: sendMediaFile?.id || null,
				media_filename: sendMediaFile?.filename || null
			});
			sendNote = '';
			sendMediaFile = null;
			await loadSendRequests();
		} finally {
			sendSubmitting = false;
		}
	}

	function sendStatusLabel(s: string): string {
		if (s === 'pending') return '⏳ Menunggu admin';
		if (s === 'sent') return '✅ Disetujui & Terkirim';
		if (s === 'rejected') return '❌ Ditolak';
		if (s === 'failed') return '⚠️ Gagal kirim';
		return s;
	}

	let project = $state<any>(null);

	// Rekomendasi #5 (Pertajam Perencanaan & Persiapan Proyek v2): Mode "Persiapan" — leader
	// hanya lihat Informasi/Persiapan/Dokumen selama proyek belum "on progress", UI bersih
	// dari tab eksekusi (Manpower/Barang/HSE/Kirim) yang belum relevan sebelum mobilisasi.
	let isPersiapanMode = $derived(project?.status === 'waiting' || project?.status === 'draft');
	let visibleMainTabs = $derived(
		isPersiapanMode
			? [
					{ id: 'informasi', label: 'Informasi' },
					{ id: 'progress', label: 'Persiapan' },
					{ id: 'dokumen', label: 'Dokumen' }
				]
			: [
					{ id: 'informasi', label: 'Informasi' },
					{ id: 'keuangan', label: 'Keuangan' },
					{ id: 'laporan', label: 'Laporan' },
					{ id: 'progress', label: 'Progress' },
					{ id: 'manpower', label: 'Manpower & Leader' },
					{ id: 'barang', label: 'Barang' },
					{ id: 'hse', label: 'HSE' },
					{ id: 'dokumen', label: 'Dokumen' },
					{ id: 'kirim', label: 'Kirim ke Pelanggan' }
				]
	);

	let awarenessContract = $state<ProjectContractSummary | null>(null);
	let awarenessTermins = $state<ProjectContractTermin[]>([]);
	let soCustomer = $state<any>(null);
	// Grand PO: proyek gabungan memuat >1 PO jasa. soCustomer tetap PO utama (header); daftar ini = SEMUA PO proyek.
	let soCustomers = $state<any[]>([]);
	let soDetails = $state<any[]>([]);

	// Reports count for Laporan tab badge
	let reportsCount = $state(0);

	function getSoDetailQty(d: any): number {
		return parseFloat(d.qty || d.jumlah_pcs || 0);
	}
	function getSoDetailUnit(d: any): string {
		return d.input_unit || d.packing || '-';
	}
	function getSoDetailName(d: any): string {
		return d.nama_barang || d.jenis_jasa || '-';
	}
	function getSoDetailType(d: any): string {
		if (d.jenis_jasa) return 'Jasa';
		if (d.nama_barang) return 'Barang';
		return '-';
	}

	let subTotal = $derived(
		soDetails.reduce((sum: number, d: any) => {
			const qty = getSoDetailQty(d);
			const harga = parseFloat(d.harga_satuan || 0);
			return sum + qty * harga;
		}, 0)
	);
	let ppn = $derived(subTotal * 0.11);
	let grandTotal = $derived(subTotal + ppn);
	let nilaiPo = $derived(soCustomers.length > 1 ? sumNilaiPo(soCustomers) : parseFloat(soCustomer?.nilai_po || 0));

	function formatRupiah(val: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			maximumFractionDigits: 0
		}).format(val || 0);
	}

	function formatDate(dateStr: string | null | undefined): string {
		if (!dateStr) return '-';
		try {
			return new Intl.DateTimeFormat('id-ID', {
				day: 'numeric', month: 'long', year: 'numeric'
			}).format(new Date(dateStr));
		} catch {
			return '-';
		}
	}

	onMount(async () => {
		registerPdfExportAutoFlush(sendQueuedPdfExport);

		const auth = get(authStore);
		const { roleId, directusToken, karyawanId } = auth;
		isLeaderView = shouldFilterProjectsByLeader(roleId);

		try {
			if (karyawanId) {
				await fetchDemisionerProjectIds(karyawanId).catch(() => {});
			}
			const result = await getProjectById(projectId, directusToken);
			if (!result) {
				goto('/');
				return;
			}

			// Semua jalur kepemilikan (kursi lapangan, leader FK/nama, koordinator
			// workshop) dihitung di satu tempat — lihat projectScope.bolehAksesProyek().
			if (!bolehAksesProyek(result)) {
				if (!hasPermission(roleId, 'view_all_projects', undefined, auth.roleIds)) {
					goto('/');
					return;
				}
			}

			project = result;
			loadChecklistForBadge().catch(() => {});
			loadDocumentTypes().catch(() => {});
			registerDocumentQueueAutoFlush(sendQueuedDocument);
			flushDocumentQueue(sendQueuedDocument).then(() => { refreshOfflineQueueCount(); loadDokumen(); }).catch(() => {});
			refreshOfflineQueueCount();
			refreshCachedFileIds();
			loadDelegationInfo().catch(() => {});
			fetchInTransitShipments().then((list) => {
				pendingGrShipments = (list || []).filter((s) => Number(s.projectId) === Number(project.id));
			}).catch(() => {});

			// Fetch independent data in parallel (kontrak, SO customer, reports count)
			const [contractRes, soRes, repsRes] = await Promise.allSettled([
				getProjectContractSummary(project.id).catch(() => null),
				(project.so_customer_id ? getSoCustomerById(project.so_customer_id) : getSoCustomerByProjectId(project.id)).catch(() => null),
				getReports(project.id, { limit: 1 }).catch(() => [])
			]);

			if (contractRes.status === 'fulfilled' && contractRes.value) {
				awarenessContract = contractRes.value;
				getProjectContractTermins(awarenessContract.id)
					.then(termins => { awarenessTermins = termins; })
					.catch(() => {});
			}

			if (soRes.status === 'fulfilled' && soRes.value) {
				soCustomer = soRes.value;
				soCustomers = [soCustomer];
				if (soCustomer?.id) {
					// Semua PO proyek (PO utama + saudara hasil gabung). Proyek 1-PO: perilaku lama (1 kueri detail).
					getProjectSoIds(project)
						.then(async (ids) => {
							const allIds = ids.includes(Number(soCustomer.id)) ? ids : [Number(soCustomer.id), ...ids];
							if (allIds.length <= 1) return getSoCustomerDetails(soCustomer.id);
							getSoCustomersByIds(allIds).then((rows) => { if (rows.length) soCustomers = rows; }).catch(() => {});
							return getSoCustomerDetailsForSos(allIds);
						})
						.then(details => { soDetails = details || []; })
						.catch((e) => { console.error('[proyek] gagal memuat detail PO:', e); soDetails = []; });
				}
			}

			if (repsRes.status === 'fulfilled') {
				const reps = repsRes.value;
				reportsCount = Array.isArray(reps) ? reps.length : 0;
			}

			// Fase 1 (Pertajam Navigasi Project v2): baca ?tab=&sub= dari URL saat mount
			// (deep-link/refresh) — tidak menulis ulang URL di sini, hanya mengikuti state-nya.
			const urlTab = $page.url.searchParams.get('tab') as MainTab | null;
			const urlSub = $page.url.searchParams.get('sub');
			if (urlTab && MAIN_TAB_IDS.includes(urlTab)) {
				activeTab = urlTab;
				const validSubs = SUB_TABS[urlTab].map((s) => s.id);
				activeSubTab = urlSub && validSubs.includes(urlSub) ? urlSub : DEFAULT_SUB[urlTab];
			}
			if (activeTab === 'dokumen') loadDokumen();
			if (activeTab === 'manpower') loadManpowerSummary();
			if (activeTab === 'kirim') loadSendRequests();
			if (activeSubTab === 'wbs') loadWbs();
			if (activeSubTab === 'laporan-keuangan') loadBudgetHealth();
			if (activeSubTab === 'project-leader') loadDelegationInfo();

		} catch (e) {
			console.error('Gagal memuat project detail:', e);
			error = 'Gagal memuat data proyek. Silakan coba lagi.';
		} finally {
			loading = false;
		}
	});
</script>

<div class="flex-1 flex flex-col h-full">

	<!-- Loading -->
	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data proyek..." />
		</div>

	<!-- Error -->
	{:else if error}
		<div class="flex-1 flex items-center justify-center px-6" style="background: var(--sys-bg)">
			<div class="text-center">
				<div class="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center" style="background: var(--rel)">
					<IconAlertCircle size={24} style="color: var(--re)" />
				</div>
				<p class="text-[14px] font-semibold mb-1" style="color: var(--sys-label)">{error}</p>
				<button class="text-[13px] font-medium mt-3" style="color: var(--g)" onclick={() => goto('/')}>
					Kembali ke Beranda
				</button>
			</div>
		</div>

	<!-- Content -->
	{:else if project}
		<div class="scroll-body" style="background: var(--sys-bg)">

			<!-- Header gradient -->
			<div style="background: linear-gradient(135deg, var(--g) 0%, var(--gd) 100%); padding: 16px 16px 20px">
				<div class="flex items-start gap-3">
					<div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style="background: rgba(255,255,255,0.2)">
						<IconBuilding size={24} style="color: white" />
					</div>
					<div class="flex-1 min-w-0">
						{#if soCustomer?.customer_name}
							<p class="text-[11px] font-medium mb-0.5" style="color: rgba(255,255,255,0.7)">
								{soCustomer.customer_name}
							</p>
						{/if}
						<h2 class="text-[18px] font-bold leading-tight" style="color: white; letter-spacing: -0.4px">
							{project.name}
						</h2>
						<ProjectBpjstkBadge {projectId} />
						<div class="flex items-center gap-3 mt-2 flex-wrap">
							{#if soCustomer?.nomor_so}
								<span class="text-[11px] font-semibold px-2 py-0.5 rounded-lg" style="background: rgba(255,255,255,0.2); color: white">
									SO: {soCustomer.nomor_so}
								</span>
							{/if}
							{#if soCustomer?.nomor_po || project?.nomor_po}
								<span class="text-[11px] font-semibold px-2 py-0.5 rounded-lg" style="background: rgba(255,255,255,0.2); color: white">
									PO: {soCustomer?.nomor_po || project?.nomor_po}
								</span>
							{/if}
							{#if project.lokasi}
								<span class="flex items-center gap-1 text-[11px]" style="color: rgba(255,255,255,0.8)">
									<IconMapPin size={12} />
									{project.lokasi}
								</span>
							{/if}
							{#if project.leader}
								<span class="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg" style="background: rgba(255,255,255,0.15); color: white" title="Lead PIC: {project.leader}">
									<IconUser size={12} />
									<span>{project.leader}</span>
									<span class="text-[9px] opacity-80 font-bold">(Lead)</span>
								</span>
							{/if}
							{#if project.co_leader}
								<span class="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg" style="background: rgba(20, 184, 166, 0.35); color: #ccfbf1; border: 1px solid rgba(45, 212, 191, 0.4)" title="Co-Leader / Site PIC: {project.co_leader}">
									<IconUsers size={12} />
									<span>{project.co_leader}</span>
									<span class="text-[9px] opacity-90 font-bold">(Co-Leader)</span>
								</span>
							{/if}
							<ProjectFinancialHealthBadge projectId={project.id} projectName={project.name} />
							<button
								class="text-[11px] font-semibold px-2 py-0.5 rounded-lg flex items-center gap-1"
								style="background: rgba(255,255,255,0.2); color: white"
								onclick={() => goto(`/proyek/${projectId}/ringkasan`)}
							>
								📊 Ringkasan Bulanan
							</button>
							<button
								class="text-[11px] font-semibold px-2 py-0.5 rounded-lg flex items-center gap-1"
								style="background: rgba(255,255,255,0.2); color: white"
								onclick={() => (showExportSheet = true)}
								title="Unduh data proyek (Excel / CSV / PDF)"
							>
								<IconFileExport size={12} /> Export
							</button>
						</div>
					</div>
				</div>
			</div>

			<!-- Foto awal proyek (kamera-first) — syarat gate Pengajuan Anggaran & Packing List; hilang sendiri setelah foto ada. -->
			<FotoAwalProyekCard bind:project />

			<!-- ── Banner Fast-Track WS Ciketing (Fase 4, 25 Sep 2026) ──
			     Project dibuat otomatis dari PO sebelum Charter/RAP lengkap — beri tahu leader
			     supaya tidak bingung kenapa RAP masih kosong, tanpa memblokir apa pun. -->
			{#if project.fast_track}
				<div class="flex items-start gap-2.5 px-4 py-3" style="background: #fff7ed; border-bottom: 1px solid #fed7aa">
					<span class="text-[15px] leading-none shrink-0">⚡</span>
					<div class="flex-1 min-w-0">
						<p class="text-[12px] font-bold" style="color: #9a3412">Fast-Track — Charter & RAP Menyusul</p>
						<p class="text-[11px] mt-0.5" style="color: #c2410c">
							Project ini dibuat otomatis dari PO supaya kerja lapangan bisa langsung mulai. Charter dan RAP
							akan dilengkapi admin menyusul — pengeluaran (PA/PR/pembelian) tetap butuh RAP disetujui dulu.
						</p>
					</div>
				</div>
			{/if}

			<!-- ── Banner Mantan Leader (Demisioner) ── -->
			{#if isDemisionerLeader(project)}
				<div class="flex items-start gap-2.5 px-4 py-3 bg-purple-50 dark:bg-purple-950/40 border-b border-purple-200 dark:border-purple-800">
					<span class="text-[15px] leading-none shrink-0">📁</span>
					<div class="flex-1 min-w-0">
						<p class="text-[12px] font-bold text-purple-900 dark:text-purple-200">Mode Demisioner (Akses Read-Only)</p>
						<p class="text-[11px] mt-0.5 text-purple-700 dark:text-purple-300">
							Anda adalah mantan Project Leader pada proyek ini. Seluruh informasi dan riwayat kerja dapat Anda pantau sebagai referensi, namun pengisian laporan harian dan perubahan data hanya dapat dilakukan oleh leader aktif saat ini ({project.leader || '-'}).
						</p>
					</div>
				</div>
			{/if}

			<!-- ── Paket Serah Terima / Handover Briefing Pack untuk Leader Baru ── -->
			{#if !isDemisionerLeader(project) && delegationInfo && (delegationInfo.tipe === 'transisi' || delegationInfo.leader_lama_nama)}
				<div class="px-4 pt-3">
					<ProjectHandoverBriefingCard
						bind:delegationInfo
						{project}
						onackUpdated={() => {
							loadDelegationInfo();
						}}
					/>
				</div>
			{/if}

			<!-- ── Breadcrumb + Salin Link (Fase 1, Pertajam Navigasi Project v2) ── -->
			<div class="breadcrumb-bar">
				<button class="breadcrumb-crumb flex items-center gap-1.5" onclick={() => goto('/proyek')} title="Kembali ke List Project">
					<IconArrowLeft size={13} class="shrink-0 text-blue-400" />
					<span>List Project</span>
				</button>
				<IconChevronRight size={11} class="breadcrumb-sep shrink-0" />
				<span class="breadcrumb-crumb breadcrumb-current truncate">{MAIN_TAB_LABELS[activeTab]}</span>
				{#if SUB_TABS[activeTab].length > 0}
					{@const subLabel = SUB_TABS[activeTab].find((s) => s.id === activeSubTab)?.label}
					{#if subLabel}
						<IconChevronRight size={11} class="breadcrumb-sep shrink-0" />
						<span class="breadcrumb-crumb breadcrumb-current truncate">{subLabel}</span>
					{/if}
				{/if}
				<button class="breadcrumb-copy flex items-center gap-1.5" onclick={copyProjectLink} title="Salin link halaman ini">
					{#if linkCopied}
						<IconCheck size={13} class="text-emerald-400" />
						<span>Tersalin</span>
					{:else}
						<IconCopy size={13} />
						<span>Salin Link</span>
					{/if}
				</button>
			</div>

			<ProjectPhaseWizardCompact {project} />

			<SiteDemobSignalCard
				{projectId}
				{project}
				onTabSwitch={(tab, subTab) => {
					switchMainTab(tab as MainTab);
					if (subTab) selectSubTab(subTab);
				}}
			/>

			<!-- Fase 5 (audit hidden cost #1051): PA menunggu persetujuan + alat menganggur, tanpa nominal rupiah -->
			<PaStatusCard {projectId} />

			{#if pendingGrShipments.length > 0}
				<div class="p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/5 border border-amber-500/30 text-amber-950 dark:text-amber-100 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
					<div class="flex items-start gap-3">
						<div class="p-2.5 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
							<IconPackage size={22} />
						</div>
						<div>
							<div class="flex items-center gap-2">
								<span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300">
									Tindakan Diperlukan
								</span>
								<span class="text-xs font-semibold text-amber-800 dark:text-amber-300">
									{pendingGrShipments.length} Surat Jalan Menunggu Konfirmasi Diterima (GR)
								</span>
							</div>
							<p class="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 mt-1">
								Barang telah dikirim dari gudang ({pendingGrShipments.map(s => s.nomorSJ || s.nomor_sj).join(', ')}). Mohon konfirmasi penerimaan fisik di site agar stok terdata resmi.
							</p>
						</div>
					</div>
					<div class="flex items-center gap-2 shrink-0">
						<a
							href="/stock-lapangan/masuk?mode=gr&sj={pendingGrShipments[0].suratJalanId}"
							class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs transition-colors shadow-sm active:scale-95"
						>
							<IconCheck size={16} />
							Konfirmasi GR Sekarang
						</a>
					</div>
				</div>
			{/if}

			{#if isPersiapanMode}
				<div class="persiapan-banner">
					🚧 <b>Mode Persiapan</b> — proyek belum mulai eksekusi. Lengkapi Charter, Timeline, dan
					<button class="persiapan-banner-link" onclick={() => goto(`/proyek/${projectId}/site-survey`)}>Site Survey</button>
					sebelum mobilisasi.
				</div>
			{/if}

			<!-- ── LEVEL 1 TAB BAR (Main Categories) ── -->
			<div class="main-tab-bar">
				{#each visibleMainTabs as tab}
					{@const IconComp = MAIN_TAB_ICONS[tab.id as MainTab]}
					<button
						class="main-tab-item {activeTab === tab.id ? 'active' : ''}"
						onclick={() => switchMainTab(tab.id as MainTab)}
					>
						{#if IconComp}
							<IconComp size={16} class="tab-icon shrink-0" />
						{/if}
						<span>{tab.label}</span>
						{#if tab.id === 'dokumen' && missingRequiredCount > 0}
							<span
								class="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white"
								style="background: var(--re)"
								title="{missingRequiredCount} jenis dokumen wajib belum diupload"
							>
								{missingRequiredCount}
							</span>
						{/if}
					</button>
				{/each}
			</div>

			<!-- ── LEVEL 2 SUB-TAB BAR ── -->
			{#if SUB_TABS[activeTab].length > 0}
				<div class="sub-tab-bar">
					{#each SUB_TABS[activeTab] as sub}
						<button
							class="sub-tab-item {activeSubTab === sub.id ? 'active' : ''}"
							onclick={() => selectSubTab(sub.id)}
						>
							<span class="sub-tab-emoji">{sub.emoji}</span>
							<span>{sub.label}</span>
						</button>
					{/each}
				</div>
			{/if}

			<!-- ══════════════════════════════════════════════════
			     TAB: INFORMASI
			══════════════════════════════════════════════════ -->
			{#if activeTab === 'informasi'}

				<!-- Sub: CHARTER -->
				{#if activeSubTab === 'charter'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<ProjectCharterTab project={project} />
					</div>
					<div class="flex flex-col gap-2.5 mt-4 pt-4 px-4" style="border-top: 1px solid var(--sys-sep)">
								<div class="flex items-center justify-between">
									<span class="text-[12px]" style="color: var(--sys-label3)">Status</span>
									<span class="badge {getProjectStatusClass(project.status)}">{getProjectStatusLabel(project.status)}</span>
								</div>
								<div class="flex items-center justify-between">
									<span class="text-[12px]" style="color: var(--sys-label3)">Jenis Proyek</span>
									<span class="text-[13px] font-medium" style="color: var(--sys-label)">{project.jenis_project || '-'}</span>
								</div>
								<div class="flex items-center justify-between">
									<span class="text-[12px]" style="color: var(--sys-label3)">Leader</span>
									<span class="text-[13px] font-medium" style="color: var(--sys-label)">{project.leader || '-'}</span>
								</div>
								<div class="flex items-center justify-between">
									<span class="text-[12px]" style="color: var(--sys-label3)">Mulai</span>
									<span class="text-[13px] font-medium" style="color: var(--sys-label)">{formatDate(project.start_date)}</span>
								</div>
								<div class="flex items-center justify-between">
									<span class="text-[12px]" style="color: var(--sys-label3)">Deadline</span>
									<span class="text-[13px] font-medium" style="color: var(--sys-label)">{formatDate(project.end_date)}</span>
								</div>
							</div>

					<!-- R8 Kontrak Awareness Card — hanya tampil jika kontrak sudah terdaftar -->
					{#if awarenessContract}
						{@const deadlineDays = project.end_date ? Math.round((new Date(project.end_date).getTime() - Date.now()) / 86400000) : null}
						{@const readyToBillTermin = awarenessTermins.find((t) => t.status === 'bast_signed')}
						{@const sisaRetensi = awarenessContract.bast_final_date ? retentionDaysRemaining(awarenessContract) : null}
						{#if deadlineDays !== null || readyToBillTermin || sisaRetensi !== null}
							<div class="flex flex-col gap-2 mt-3 px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5">
								{#if deadlineDays !== null}
									<div class="flex items-center justify-between text-[12px]">
										<span style="color: var(--sys-label3)">📄 Kontrak</span>
										<span class="font-medium {deadlineDays < 30 ? 'text-red-600' : deadlineDays < 90 ? 'text-amber-600' : 'text-green-600'}">
											{deadlineDays < 0 ? `Lewat ${Math.abs(deadlineDays)} hari` : `Berakhir ${deadlineDays} hari lagi`}
										</span>
									</div>
								{/if}
								{#if readyToBillTermin}
									<div class="flex items-center justify-between text-[12px]">
										<span style="color: var(--sys-label3)">💵 Termin</span>
										<span class="font-medium text-green-600">
											{readyToBillTermin.label || `Termin ${readyToBillTermin.urutan}`} sudah bisa ditagih
										</span>
									</div>
								{/if}
								{#if sisaRetensi !== null}
									<div class="flex items-center justify-between text-[12px]">
										<span style="color: var(--sys-label3)">🔒 Retensi</span>
										<span class="font-medium {sisaRetensi < 14 ? 'text-red-600' : ''}" style={sisaRetensi < 14 ? '' : 'color: var(--sys-label)'}>
											Jatuh tempo {sisaRetensi} hari lagi
										</span>
									</div>
								{/if}
							</div>
						{/if}
					{/if}

				<!-- Sub: INFO -->
				{:else if activeSubTab === 'info'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<IconInfoCircle size={16} style="color: var(--g)" /> Informasi Proyek
							</h4>
							<div class="grid grid-cols-2 gap-x-4 gap-y-4">
								<div>
									<p class="text-[10px] font-semibold uppercase tracking-wider mb-1" style="color: var(--sys-label3)">Leader</p>
									<p class="text-[13px] font-medium" style="color: var(--sys-label)">{project.leader || '-'}</p>
								</div>
								<div>
									<p class="text-[10px] font-semibold uppercase tracking-wider mb-1" style="color: var(--sys-label3)">Jenis Proyek</p>
									<p class="text-[13px] font-medium" style="color: var(--sys-label)">{project.jenis_project || '-'}</p>
								</div>
								<div>
									<p class="text-[10px] font-semibold uppercase tracking-wider mb-1" style="color: var(--sys-label3)">Mulai</p>
									<p class="text-[13px] font-medium" style="color: var(--sys-label)">{formatDate(project.start_date)}</p>
								</div>
								<div>
									<p class="text-[10px] font-semibold uppercase tracking-wider mb-1" style="color: var(--sys-label3)">Deadline</p>
									<p class="text-[13px] font-medium" style="color: var(--sys-label)">{formatDate(project.end_date)}</p>
								</div>
								<div>
									<p class="text-[10px] font-semibold uppercase tracking-wider mb-1" style="color: var(--sys-label3)">Lokasi</p>
									<p class="text-[13px] font-medium" style="color: var(--sys-label)">{project.lokasi || '-'}</p>
								</div>
								<div>
									<p class="text-[10px] font-semibold uppercase tracking-wider mb-1" style="color: var(--sys-label3)">No. PO</p>
									<p class="text-[13px] font-medium" style="color: var(--sys-label)">{project.nomor_po || '-'}</p>
								</div>
							</div>
							{#if project.description}
								<div class="mt-4 pt-4" style="border-top: 1px solid var(--sys-sep)">
									<p class="text-[10px] font-semibold uppercase tracking-wider mb-2" style="color: var(--sys-label3)">Deskripsi</p>
									<p class="text-[13px] leading-relaxed" style="color: var(--sys-label2)">{project.description}</p>
								</div>
							{/if}
						</div>

						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<IconChartBar size={16} style="color: var(--g)" /> Status Proyek
							</h4>
							<div class="flex items-center justify-between">
								<span class="text-[13px]" style="color: var(--sys-label2)">Status saat ini</span>
								<span class="badge {getProjectStatusClass(project.status)}">{getProjectStatusLabel(project.status)}</span>
							</div>
						</div>

						<!-- Grand PO Fase 5: paket PO + material dari customer (read-only, muncul hanya bila proyek anggota Grand PO) -->
						<GrandPoPaketCards {project} />
					</div>
				{/if}

			<!-- ══════════════════════════════════════════════════
			     TAB: KEUANGAN
			══════════════════════════════════════════════════ -->
			{:else if activeTab === 'keuangan'}

				<!-- Sub: RAP -->
				{#if activeSubTab === 'rap'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<!-- Informasi PO -->
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<IconBriefcase size={16} style="color: var(--g)" /> Informasi PO
							</h4>
							<div class="flex flex-col gap-2.5">
								<div class="flex items-center justify-between">
									<span class="text-[12px] font-medium" style="color: var(--sys-label3)">NO. SO</span>
									<span class="text-[13px] font-semibold" style="color: var(--sys-label)">{soCustomer?.nomor_so || '-'}</span>
								</div>
								<div style="height:1px; background: var(--sys-sep)"></div>
								<div class="flex items-center justify-between">
									<span class="text-[12px] font-medium" style="color: var(--sys-label3)">NO. PO Customer</span>
									<span class="text-[13px] font-semibold" style="color: var(--sys-label)">{soCustomer?.nomor_po || project.nomor_po || '-'}</span>
								</div>
								{#if soCustomers.length > 1}
									<div style="height:1px; background: var(--sys-sep)"></div>
									<div class="flex items-start justify-between gap-3" data-testid="proyek-po-gabungan">
										<span class="text-[12px] font-medium shrink-0" style="color: var(--sys-label3)" title="Proyek ini memuat lebih dari satu PO jasa (hasil gabung proyek / Grand PO).">PO dalam proyek ini</span>
										<span class="text-[12px] font-semibold text-right" style="color: var(--sys-label)">
											{#each soCustomers as so (so.id)}
												<span class="block">{so.nomor_po_customer || so.nomor_po || so.nomor_so}</span>
											{/each}
										</span>
									</div>
								{/if}
								<div style="height:1px; background: var(--sys-sep)"></div>
								<div class="flex items-center justify-between">
									<span class="text-[12px] font-medium" style="color: var(--sys-label3)">Customer</span>
									<span class="text-[13px] font-semibold" style="color: var(--sys-label)">{soCustomer?.customer_name || '-'}</span>
								</div>
								{#if !isLeaderView}
									<div style="height:1px; background: var(--sys-sep)"></div>
									<div class="flex items-center justify-between">
										<span class="text-[12px] font-medium" style="color: var(--sys-label3)">Nilai PO{soCustomers.length > 1 ? ` (${soCustomers.length} PO)` : ''}</span>
										<span class="text-[14px] font-bold" style="color: var(--g)">
											{soCustomer ? formatRupiah(nilaiPo) : '-'}
										</span>
									</div>
								{/if}
							</div>
						</div>

						<!-- Detail Pekerjaan -->
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<IconFileText size={16} style="color: var(--g)" /> Detail Pekerjaan (RAP)
							</h4>
							{#if soDetails.length === 0}
								<div class="text-center py-6">
									<p class="text-[12px]" style="color: var(--sys-label3)">
										{soCustomer ? 'Tidak ada detail pekerjaan.' : 'Data SO tidak tersedia.'}
									</p>
								</div>
							{:else}
								<div style="overflow-x: auto; margin: 0 -16px; padding: 0 16px">
									<table style="width: 100%; border-collapse: collapse; min-width: 460px">
										<thead>
											<tr style="border-bottom: 1.5px solid var(--sys-sep)">
												<th style="text-align:left; font-size:10px; font-weight:700; color:var(--sys-label3); padding:0 6px 8px 0; text-transform:uppercase; letter-spacing:0.4px; white-space:nowrap">Tipe</th>
												<th style="text-align:left; font-size:10px; font-weight:700; color:var(--sys-label3); padding:0 6px 8px; text-transform:uppercase; letter-spacing:0.4px">Jenis Pekerjaan</th>
												<th style="text-align:right; font-size:10px; font-weight:700; color:var(--sys-label3); padding:0 6px 8px; text-transform:uppercase; letter-spacing:0.4px; white-space:nowrap">QTY</th>
												<th style="text-align:left; font-size:10px; font-weight:700; color:var(--sys-label3); padding:0 6px 8px; text-transform:uppercase; letter-spacing:0.4px; white-space:nowrap">Satuan</th>
												{#if !isLeaderView}
													<th style="text-align:right; font-size:10px; font-weight:700; color:var(--sys-label3); padding:0 6px 8px; text-transform:uppercase; letter-spacing:0.4px; white-space:nowrap">Harga Satuan</th>
													<th style="text-align:right; font-size:10px; font-weight:700; color:var(--sys-label3); padding:0 0 8px 6px; text-transform:uppercase; letter-spacing:0.4px; white-space:nowrap">Total</th>
												{/if}
											</tr>
										</thead>
										<tbody>
											{#each soDetails as detail}
												{@const qty = getSoDetailQty(detail)}
												{@const harga = parseFloat(detail.harga_satuan || 0)}
												{@const total = qty * harga}
												<tr style="border-bottom: 1px solid var(--sys-sep)">
													<td style="padding:8px 6px 8px 0; font-size:11px; color:var(--sys-label3); white-space:nowrap">
														<span class="badge pend" style="font-size:9px; padding:1px 6px">{getSoDetailType(detail)}</span>
													</td>
													<td style="padding:8px 6px; font-size:12px; font-weight:500; color:var(--sys-label)">
														{getSoDetailName(detail)}
													</td>
													<td style="padding:8px 6px; font-size:12px; text-align:right; color:var(--sys-label); white-space:nowrap">
														{qty}
													</td>
													<td style="padding:8px 6px; font-size:12px; color:var(--sys-label3); white-space:nowrap">
														{getSoDetailUnit(detail)}
													</td>
													{#if !isLeaderView}
														<td style="padding:8px 6px; font-size:12px; text-align:right; color:var(--sys-label); white-space:nowrap">
															{harga > 0 ? formatRupiah(harga) : '-'}
														</td>
														<td style="padding:8px 0 8px 6px; font-size:12px; font-weight:600; text-align:right; color:var(--sys-label); white-space:nowrap">
															{total > 0 ? formatRupiah(total) : '-'}
														</td>
													{/if}
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
								{#if !isLeaderView}
									<div class="flex flex-col gap-1.5 mt-4 pt-3" style="border-top: 1.5px solid var(--sys-sep)">
										<div class="flex justify-between items-center">
											<span class="text-[12px]" style="color: var(--sys-label3)">Sub Total</span>
											<span class="text-[13px] font-semibold" style="color: var(--sys-label)">{formatRupiah(subTotal)}</span>
										</div>
										<div class="flex justify-between items-center">
											<span class="text-[12px]" style="color: var(--sys-label3)">PPN 11%</span>
											<span class="text-[13px] font-semibold" style="color: var(--sys-label)">{formatRupiah(ppn)}</span>
										</div>
										<div class="flex justify-between items-center pt-1.5" style="border-top: 1px solid var(--sys-sep)">
											<span class="text-[13px] font-bold" style="color: var(--sys-label)">Grand Total</span>
											<span class="text-[15px] font-bold" style="color: var(--g)">{formatRupiah(grandTotal)}</span>
										</div>
									</div>
								{/if}
							{/if}
						</div>

						<!-- Ringkasan Budget RAP -->
						{#if !isLeaderView}
							<div class="card-section">
								<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-1" style="color: var(--sys-label)">
									<IconWallet size={16} style="color: var(--g)" /> Ringkasan Budget RAP
								</h4>
								<p class="text-[11px] mb-3" style="color: var(--sys-label3)">
									RAP lengkap tersedia di Admin ERP.
								</p>
								<div class="grid grid-cols-2 gap-2.5">
									{#each [
										{ label: 'Man Power', icon: '👷' },
										{ label: 'Biaya Operasional', icon: '⚙️' },
										{ label: 'Material Cat', icon: '🪣' },
										{ label: 'Jasa / Subkon', icon: '🔧' },
										{ label: 'Alat & Equipment', icon: '🛠️' },
										{ label: 'Consumables', icon: '📦' }
									] as item}
										<div class="rounded-xl p-3" style="background: var(--sys-fill)">
											<div class="text-[16px] mb-1">{item.icon}</div>
											<p class="text-[10px] font-semibold uppercase tracking-wider mb-2" style="color: var(--sys-label3)">{item.label}</p>
											<div class="flex justify-between items-end">
												<div>
													<p class="text-[9px]" style="color: var(--sys-label4)">RAP</p>
													<p class="text-[12px] font-bold" style="color: var(--sys-label)">Rp 0</p>
												</div>
												<div class="text-right">
													<p class="text-[9px]" style="color: var(--sys-label4)">Aktual</p>
													<p class="text-[12px] font-bold" style="color: var(--sys-label3)">Rp 0</p>
												</div>
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>

				<!-- Sub: Aktualisasi -->
				{:else if activeSubTab === 'aktualisasi'}
					<div class="px-2 py-4 flex flex-col gap-3">
						<!-- Penajaman Finance CVP Fase 5 — Sisa Jatah / posisi impas proyek -->
						{#if project?.id}
							<ProjectBepTrackerCard projectId={project.id} />
						{/if}
						<!-- Sengketa hukum penagihan customer (read-only, tanpa nominal) -->
						{#if project?.id}
							<LegalDisputeBadge projectId={project.id} />
						{/if}
						<!-- Forecast Keuangan Global Fase 4 — status penagihan customer (Gap G6) -->
						{#if project?.id}
							<PenagihanStatusCard projectId={project.id} projectName={project.name} />
						{/if}
						<ProjectAktualisasiPanel {project} />
					</div>

				<!-- Sub: Laporan Keuangan (Fase 6 Rencana Laporan Keuangan v2) -->
				{:else if activeSubTab === 'laporan-keuangan'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-1" style="color: var(--sys-label)">
								<IconChartLine size={16} style="color: var(--g)" /> Kesehatan Budget Proyek
							</h4>
							<p class="text-[11px] mb-3" style="color: var(--sys-label3)">
								Status penyerapan anggaran ditampilkan sebagai persentase saja. Nilai Rupiah lengkap tersedia di Admin ERP.
							</p>

							{#if budgetHealthLoading}
								<div class="flex justify-center py-8">
									<IconLoader2 size={28} class="animate-spin" style="color: var(--sys-label3)" />
								</div>
							{:else if !budgetHealth || budgetHealth.usedPct === null}
								<div class="text-center py-6">
									<p class="text-[12px]" style="color: var(--sys-label3)">RAP belum diisi untuk proyek ini — status budget belum bisa dihitung.</p>
								</div>
							{:else}
								{@const pct = Math.min(budgetHealth.usedPct, 100)}
								{@const statusCfg = {
									sehat: { label: 'Sehat', color: '#16a34a', bg: '#dcfce7' },
									waspada: { label: 'Waspada', color: '#d97706', bg: '#fef3c7' },
									kritis: { label: 'Kritis — Melebihi RAP', color: '#dc2626', bg: '#fee2e2' },
									unknown: { label: '-', color: 'var(--sys-label3)', bg: 'var(--sys-fill)' }
								}[budgetHealth.status]}

								<div class="flex items-center justify-between mb-2">
									<span class="text-[12px] font-medium" style="color: var(--sys-label3)">Budget Terpakai</span>
									<span class="text-[13px] font-bold" style="color: {statusCfg.color}">{budgetHealth.usedPct.toFixed(0)}%</span>
								</div>
								<div class="w-full rounded-full overflow-hidden mb-3" style="height: 10px; background: var(--sys-fill)">
									<div style="height: 100%; width: {pct}%; background: {statusCfg.color}; transition: width 0.3s"></div>
								</div>
								<div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style="background: {statusCfg.bg}">
									<span class="text-[11px] font-semibold" style="color: {statusCfg.color}">{statusCfg.label}</span>
								</div>

								{#if project?.total_progress != null}
									{@const progressPct = parseFloat(project.total_progress) || 0}
									{@const gap = budgetHealth.usedPct - progressPct}
									<div style="height:1px; background: var(--sys-sep); margin: 14px 0"></div>
									<div class="flex items-center justify-between mb-2">
										<span class="text-[12px] font-medium" style="color: var(--sys-label3)">Progress Pekerjaan</span>
										<span class="text-[13px] font-bold" style="color: var(--sys-label)">{progressPct.toFixed(0)}%</span>
									</div>
									{#if gap >= 15}
										<div class="flex items-start gap-2 p-3 rounded-xl mt-2" style="background: #fee2e2">
											<IconAlertCircle size={16} style="color: #dc2626; margin-top: 1px; flex-shrink: 0" />
											<p class="text-[11px]" style="color: #991b1b">
												Kecepatan pemakaian budget ({budgetHealth.usedPct.toFixed(0)}%) jauh melebihi kemajuan pekerjaan ({progressPct.toFixed(0)}%). Perlu dicek penyebabnya.
											</p>
										</div>
									{/if}
								{/if}
							{/if}
						</div>

						<div class="card-section">
							<p class="text-[12px] text-center py-2" style="color: var(--sys-label3)">
								📈 Laporan HPP &amp; Laba Rugi lengkap (dalam Rupiah) tersedia di Admin ERP.
							</p>
						</div>
					</div>

				<!-- Sub: Pengajuan Anggaran -->
				{:else if activeSubTab === 'pengajuan-anggaran'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<IconReceipt2 size={16} style="color: var(--p)" /> Keuangan
							</h4>
							<p class="text-[12px] mb-3" style="color: var(--sys-label3)">Ajukan kebutuhan dana proyek melalui modul Anggaran.</p>
							<!-- PRJ-29: pintu utama uang keluar, membawa proyek ini ke form tujuan. -->
							<button
								class="w-full flex items-center gap-3 p-3 mb-3 rounded-xl text-left font-semibold text-[13px] text-white active:scale-[0.98]"
								style="background: var(--g, #059669)"
								onclick={() => goto(`/procurement/keluar-uang?project_id=${projectId}`)}
								title="Bingung memilih form? Jawab beberapa pertanyaan; proyek ini otomatis terpilih di form tujuan."
							>
								💸 Keluar Uang untuk proyek ini
							</button>
							<!-- PRJ-22: pencatatan pengeluaran dari dana kerja proyek (alur Petty Cash ESS yang sama). -->
							<button
								class="w-full flex items-center gap-3 p-3 mb-3 rounded-xl text-left font-semibold text-[13px] active:scale-[0.98]"
								style="background: var(--pl); color: var(--sys-label)"
								onclick={() => goto(`/ess/petty-cash/baru?mode=reimburse&project_id=${projectId}`)}
								title="Catat pengeluaran kecil dari dana kerja proyek ini (foto nota). Dilaporkan lewat LPJ."
							>
								🧾 Catat pengeluaran dana kerja
							</button>
							<button
								class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
								style="background: var(--pl);"
								onclick={() => goto(`/anggaran`)}
							>
								<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--p)">
									<IconReceipt2 size={20} style="color: white" />
								</div>
								<div class="flex-1 min-w-0">
									<p class="text-[14px] font-semibold" style="color: var(--pd)">Buka Keuangan</p>
									<p class="text-[11px] mt-0.5" style="color: var(--p)">Ajukan kebutuhan dana proyek</p>
								</div>
								<IconExternalLink size={16} style="color: var(--p)" />
							</button>
						</div>
					</div>

				<!-- Sub: Gajian -->
				{:else if activeSubTab === 'gajian'}
					<div class="px-2 py-4">
						<ProjectPayrollRecap projectId={project.id} projectName={project.name} />
					</div>

				<!-- Sub: Kontrak -->
				{:else if activeSubTab === 'kontrak'}
					<ProjectKontrakPanel {project} />
				{/if}

			<!-- ══════════════════════════════════════════════════
			     TAB: LAPORAN
			══════════════════════════════════════════════════ -->
			{:else if activeTab === 'laporan'}

				<!-- Sub: Report -->
				{#if activeSubTab === 'report'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<IconClipboardList size={16} style="color: var(--g)" /> Laporan Harian
							</h4>
							<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Input progress dan dokumentasi pekerjaan harian.</p>
							<button
								class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
								style="background: var(--gl);"
								onclick={() => goto(`/laporan/${projectId}`)}
							>
								<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--g)">
									<IconClipboardList size={20} style="color: white" />
								</div>
								<div class="flex-1 min-w-0">
									<p class="text-[14px] font-semibold" style="color: var(--gd)">Laporan Harian</p>
									<p class="text-[11px] mt-0.5" style="color: var(--g)">Input progress & dokumentasi harian</p>
								</div>
								<IconExternalLink size={16} style="color: var(--g)" />
							</button>
						</div>

						<ProjectCompressorClaimCard projectId={projectId} />
					</div>

				<!-- Sub: Laporan Harian -->
				{:else if activeSubTab === 'laporan-harian'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<span style="font-size:16px">📆</span> Laporan Harian Kalender
							</h4>
							<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Lihat riwayat laporan harian per tanggal.</p>
							<button
								class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
								style="background: var(--gl);"
								onclick={() => goto(`/laporan/${projectId}`)}
							>
								<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--g)">
									<IconCalendar size={20} style="color: white" />
								</div>
								<div class="flex-1 min-w-0">
									<p class="text-[14px] font-semibold" style="color: var(--gd)">Buka Laporan Harian</p>
									<p class="text-[11px] mt-0.5" style="color: var(--g)">Lihat riwayat laporan per tanggal</p>
								</div>
								<IconExternalLink size={16} style="color: var(--g)" />
							</button>
						</div>
					</div>
				{/if}

			<!-- ══════════════════════════════════════════════════
			     TAB: PROGRESS
			══════════════════════════════════════════════════ -->
			{:else if activeTab === 'progress'}

				<!-- Sub: Persiapan (Kickoff Wizard v2 — porsi Leader) -->
				{#if activeSubTab === 'persiapan'}
					<PersiapanLeaderPanel
						{projectId}
						onStarted={() => {
							if (project) project = { ...project, status: 'on progress' };
						}}
					/>

				<!-- Sub: Timeline -->
				{:else if activeSubTab === 'timeline'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<KesiapanHariIniCard {projectId} />
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<span style="font-size:16px">📅</span> Timeline
							</h4>
							<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Lihat jadwal dan progress timeline proyek.</p>
							<button
								class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
								style="background: var(--gl);"
								onclick={() => goto(`/timeline/${projectId}`)}
							>
								<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--g)">
									<IconCalendarTime size={20} style="color: white" />
								</div>
								<div class="flex-1 min-w-0">
									<p class="text-[14px] font-semibold" style="color: var(--gd)">Buka Timeline</p>
									<p class="text-[11px] mt-0.5" style="color: var(--g)">Jadwal dan progress timeline</p>
								</div>
								<IconExternalLink size={16} style="color: var(--g)" />
							</button>
						</div>
					</div>

				<!-- Sub: WBS (Fase 7, Revamp Project Management v2 — read + update completion_pct daun) -->
				{:else if activeSubTab === 'wbs'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-1" style="color: var(--sys-label)">
								<span style="font-size:16px">🌳</span> Work Breakdown Structure
							</h4>
							<p class="text-[12px] mb-3" style="color: var(--sys-label3)">
								Update progress item kerja Anda. Struktur & bobot dikelola Admin ERP.
							</p>
							{#if wbsSaveError}
								<p class="text-[11px] mb-2" style="color: var(--re)">⚠️ {wbsSaveError}</p>
							{/if}
							{#if wbsLoading}
								<div class="flex items-center justify-center py-8">
									<IconLoader2 size={20} class="animate-spin" style="color: var(--sys-label4)" />
								</div>
							{:else if wbsRoots.length === 0}
								<p class="text-[12px] text-center py-6" style="color: var(--sys-label3)">
									Belum ada WBS untuk proyek ini.
								</p>
							{:else}
								<div class="flex flex-col gap-2">
									{#each flattenWbs(wbsRoots) as { node, depth } (node.id)}
										<div class="rounded-xl p-3" style="background: var(--sys-fill2); margin-left: {depth * 12}px">
											<div class="flex items-center justify-between gap-2">
												<p class="text-[12px] font-semibold flex-1 min-w-0 truncate" style="color: var(--sys-label)">{node.name}</p>
												<span class="text-[11px] font-bold shrink-0" style="color: var(--sys-label3)">
													{node.completion_pct ?? 0}%
												</span>
											</div>
											{#if node.children && node.children.length > 0}
												<p class="text-[10px] mt-1" style="color: var(--sys-label4)">Turunan dari {node.children.length} sub-item</p>
											{:else}
												<input
													type="range"
													min="0"
													max="100"
													step="5"
													value={node.completion_pct ?? 0}
													disabled={savingWbsId === node.id}
													onchange={(e) => saveLeafCompletion(node.id, Number((e.target as HTMLInputElement).value))}
													class="w-full mt-2"
												/>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>

				<!-- Sub: List Pekerjaan -->
				{:else if activeSubTab === 'list-pekerjaan'}
					<div class="px-4 py-8 text-center">
						<div class="text-4xl mb-3">📝</div>
						<p class="text-[14px] font-semibold" style="color: var(--sys-label)">List Pekerjaan</p>
						<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Fitur ini tersedia di Admin ERP.</p>
					</div>

				<!-- Sub: Packing List -->
				{:else if activeSubTab === 'packing-list'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<span style="font-size:16px">📦</span> Packing List
							</h4>
							<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Kelola material dan inventory proyek.</p>
							<button
								class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
								style="background: var(--gl);"
								onclick={() => goto(`/packing-list/${projectId}`)}
							>
								<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--g)">
									<IconPackage size={20} style="color: white" />
								</div>
								<div class="flex-1 min-w-0">
									<p class="text-[14px] font-semibold" style="color: var(--gd)">Buka Packing List</p>
									<p class="text-[11px] mt-0.5" style="color: var(--g)">Kelola material & inventory proyek</p>
								</div>
								<IconExternalLink size={16} style="color: var(--g)" />
							</button>
						</div>
					</div>

				<!-- Sub: Site Plan & Denah Interaktif -->
				{:else if activeSubTab === 'site-plan'}
					<div class="px-4 py-4">
						<ProjectSitePlanTab {projectId} canEdit={true} />
					</div>
				{/if}

			<!-- ══════════════════════════════════════════════════
			     TAB: MANPOWER & LEADER
			══════════════════════════════════════════════════ -->
			{:else if activeTab === 'manpower'}

				<!-- Sub: Manpower & SPK -->
				{#if activeSubTab === 'manpower-spk'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<span style="font-size:16px">👷</span> Rekap Kehadiran Manpower
							</h4>
							<p class="text-[12px] mb-3" style="color: var(--sys-label3)">Data dihitung dari laporan harian 30 hari terakhir.</p>

							{#if manpowerSummaryLoading}
								<div class="flex items-center justify-center gap-2 py-6">
									<IconLoader2 size={18} class="animate-spin" style="color: var(--g)" />
									<span class="text-[12px]" style="color: var(--sys-label3)">Menghitung data...</span>
								</div>
							{:else if manpowerSummary}
								<div class="grid grid-cols-3 gap-2 mb-4">
									<div class="rounded-xl p-3 text-center" style="background: var(--gl); border: 1px solid var(--g)/20">
										<p class="text-[22px] font-bold" style="color: var(--g)">{Object.keys(manpowerSummary.workers).length}</p>
										<p class="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style="color: var(--gd)">Pekerja Unik</p>
									</div>
									<div class="rounded-xl p-3 text-center" style="background: var(--pl); border: 1px solid var(--p)/20">
										<p class="text-[22px] font-bold" style="color: var(--p)">{manpowerSummary.totalDays}</p>
										<p class="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style="color: var(--pd)">Hari Lapor</p>
									</div>
									<div class="rounded-xl p-3 text-center" style="background: #FFF4E6; border: 1px solid #D97706/20">
										<p class="text-[22px] font-bold" style="color: #D97706">{manpowerSummary.totalManpower}</p>
										<p class="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style="color: var(--amd)">Total M-Day</p>
									</div>
								</div>

								{#if Object.keys(manpowerSummary.workers).length > 0}
									<div class="rounded-xl overflow-hidden" style="border: 1px solid var(--sys-sep)">
										<div class="px-3 py-2" style="background: var(--sys-fill); border-bottom: 1px solid var(--sys-sep)">
											<p class="text-[10px] font-semibold uppercase tracking-wide" style="color: var(--sys-label3)">Daftar Pekerja & Frekuensi Hadir</p>
										</div>
										<div class="divide-y" style="border-color: var(--sys-sep)">
											{#each Object.entries(manpowerSummary.workers).sort((a, b) => b[1].count - a[1].count) as [name, data]}
												<div class="flex items-center gap-2.5 px-3 py-2.5">
													<div class="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold text-white" style="background: var(--g)">
														{name.charAt(0).toUpperCase()}
													</div>
													<div class="flex-1 min-w-0">
														<p class="text-[12px] font-medium truncate" style="color: var(--sys-label)">{name}</p>
														{#if data.roles.length > 0}
															<p class="text-[10px] truncate" style="color: var(--sys-label3)">{data.roles.join(', ')}</p>
														{/if}
													</div>
													<span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background: var(--gl); color: var(--gd)">{data.count}x hadir</span>
												</div>
											{/each}
										</div>
									</div>
								{:else}
									<div class="text-center py-4">
										<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada data kehadiran dari laporan harian.</p>
									</div>
								{/if}
							{:else}
								<div class="text-center py-4">
									<p class="text-[12px]" style="color: var(--sys-label3)">Tap tab ini untuk memuat rekap kehadiran.</p>
								</div>
							{/if}

							<div class="mt-4 border-t pt-4" style="border-color: var(--sys-sep)">
								<div class="flex items-center justify-between mb-3">
									<h5 class="text-[12px] font-semibold text-gray-700">Assign Pekerja</h5>
									<button class="px-3 py-1.5 rounded-lg bg-[var(--pl)] text-[var(--pd)] text-[11px] font-semibold hover:bg-[var(--p)] hover:text-white transition-colors" onclick={() => showManualAbsensi = true}>
										Input Absensi Manual
									</button>
								</div>
								<ProjectManpowerAssign {project} actorName={($authStore?.user as any)?.first_name || 'Project Leader'} />
							</div>
						</div>
					</div>

				<!-- Sub: Project Leader -->
				{:else if activeSubTab === 'project-leader'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<span style="font-size:16px">👨‍💼</span> Project Leader
							</h4>
							<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
								<div class="flex items-center gap-4 p-4 rounded-xl" style="background: var(--sys-fill)">
									<div class="w-14 h-14 rounded-full flex items-center justify-center shrink-0" style="background: var(--gl)">
										<IconUser size={28} style="color: var(--g)" />
									</div>
									<div class="min-w-0">
										<p class="text-[16px] font-bold truncate" style="color: var(--sys-label)">{project.leader || 'Belum ditentukan'}</p>
										<p class="text-[12px] mt-0.5" style="color: var(--sys-label3)">Lead Project Leader</p>
										{#if project.jenis_project}
											<span class="badge pend mt-1" style="font-size:10px">{project.jenis_project}</span>
										{/if}
									</div>
								</div>
								{#if project.co_leader}
									<div class="flex items-center gap-4 p-4 rounded-xl border border-teal-500/20" style="background: var(--sys-fill)">
										<div class="w-14 h-14 rounded-full flex items-center justify-center shrink-0 bg-teal-500/15 text-teal-600 dark:text-teal-400">
											<IconUsers size={28} />
										</div>
										<div class="min-w-0">
											<p class="text-[16px] font-bold truncate" style="color: var(--sys-label)">{project.co_leader}</p>
											<p class="text-[12px] mt-0.5 text-teal-600 dark:text-teal-400 font-semibold">Co-Leader / Site PIC Lapangan</p>
											<span class="badge ok mt-1" style="font-size:10px">Kolaborasi Site</span>
										</div>
									</div>
								{/if}
							</div>
							<div class="flex flex-col gap-2.5 mt-4 pt-4" style="border-top: 1px solid var(--sys-sep)">
								<div class="flex items-center justify-between">
									<span class="text-[12px]" style="color: var(--sys-label3)">Lokasi</span>
									<span class="text-[13px] font-medium" style="color: var(--sys-label)">{project.lokasi || '-'}</span>
								</div>
								<div class="flex items-center justify-between">
									<span class="text-[12px]" style="color: var(--sys-label3)">Status Proyek</span>
									<span class="badge {getProjectStatusClass(project.status)}">{getProjectStatusLabel(project.status)}</span>
								</div>
								<div class="flex items-center justify-between">
									<span class="text-[12px]" style="color: var(--sys-label3)">Mulai</span>
									<span class="text-[13px] font-medium" style="color: var(--sys-label)">{formatDate(project.start_date)}</span>
								</div>
								<div class="flex items-center justify-between">
									<span class="text-[12px]" style="color: var(--sys-label3)">Deadline</span>
									<span class="text-[13px] font-medium" style="color: var(--sys-label)">{formatDate(project.end_date)}</span>
								</div>
							</div>
						</div>

						<!-- Info Delegasi (Sistem Delegasi Project Leader, Fase 2) -->
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<span style="font-size:16px">📋</span> Info Penugasan
							</h4>
							{#if delegationInfoLoading}
								<p class="text-[12px] text-center py-3" style="color: var(--sys-label3)">Memuat info penugasan...</p>
							{:else if !delegationInfo}
								<p class="text-[12px] text-center py-3" style="color: var(--sys-label3)">Belum ada catatan delegasi tercatat untuk proyek ini.</p>
							{:else}
								<div class="flex flex-col gap-2.5">
									{#if delegationInfo.delegated_by_nama}
										<div class="flex items-center justify-between">
											<span class="text-[12px]" style="color: var(--sys-label3)">Ditugaskan oleh</span>
											<span class="text-[13px] font-medium" style="color: var(--sys-label)">{delegationInfo.delegated_by_nama}</span>
										</div>
									{/if}
									<div class="flex items-center justify-between">
										<span class="text-[12px]" style="color: var(--sys-label3)">Tanggal Efektif</span>
										<span class="text-[13px] font-medium" style="color: var(--sys-label)">{formatDate(delegationInfo.tanggal_efektif)}</span>
									</div>
									{#if delegationInfo.leader_lama_nama}
										<div class="flex items-center justify-between">
											<span class="text-[12px]" style="color: var(--sys-label3)">Transisi dari</span>
											<span class="text-[13px] font-medium" style="color: var(--sys-label)">{delegationInfo.leader_lama_nama}</span>
										</div>
									{/if}
									{#if delegationInfo.surat_tugas_nomor}
										<div class="flex items-center justify-between">
											<span class="text-[12px]" style="color: var(--sys-label3)">Surat Tugas</span>
											<span class="text-[13px] font-medium" style="color: var(--sys-label)">{delegationInfo.surat_tugas_nomor}</span>
										</div>
									{/if}
									{#if delegationInfo.alasan}
										<div class="mt-1 pt-2.5" style="border-top: 1px solid var(--sys-sep)">
											<span class="text-[12px]" style="color: var(--sys-label3)">Alasan Penugasan</span>
											<p class="text-[13px] mt-1" style="color: var(--sys-label)">{delegationInfo.alasan}</p>
										</div>
									{/if}
									<div class="mt-2 pt-2.5 flex justify-end items-center gap-2" style="border-top: 1px solid var(--sys-sep)">
										<button
											type="button"
											class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.98] shadow-2xs border border-indigo-500/40 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100"
											onclick={() => openDossierPrint('all_components')}
											title="Buka Master Dossier & Lampiran Operasional Proyek (Log Harian, WBS, Presensi, QC DFT)"
										>
											<IconFileText size={15} />
											<span>📑 Buka Dossier Proyek</span>
										</button>
										<button
											type="button"
											class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.98] shadow-2xs"
											style="background: var(--color-primary, #ea580c); color: #ffffff;"
											onclick={handlePrintSuratTugas}
											title="Cetak format cetak A4 resmi Surat Tugas"
										>
											<IconPrinter size={15} />
											<span>Cetak Surat Tugas</span>
										</button>
									</div>
								</div>
							{/if}
						</div>
					</div>

				<!-- Sub: Borongan (Fase 4 — Termin Pembayaran Borongan Manpower) -->
				{:else if activeSubTab === 'borongan'}
					{#if project}
						<ProjectBoronganPanel {project} />
					{/if}

				<!-- Sub: Absensi -->
				{:else if activeSubTab === 'absensi'}
					<div class="px-4 py-8 text-center max-w-md mx-auto">
						<div class="text-4xl mb-3">🕒</div>
						<p class="text-[14px] font-semibold" style="color: var(--sys-label)">Jurnal Presensi & Kehadiran Lapangan</p>
						<p class="text-[12px] mt-1 mb-4" style="color: var(--sys-label3)">
							Lihat rekapitulasi kehadiran personil, jam lembur harian, dan absensi site proyek ini secara komprehensif.
						</p>
						<button
							type="button"
							class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white shadow-md transition-all active:scale-[0.98] cursor-pointer"
							style="background: var(--color-primary, #ea580c);"
							onclick={() => openDossierPrint('annex_absensi')}
						>
							<IconPrinter size={16} />
							<span>Lihat / Cetak Jurnal Presensi Proyek</span>
						</button>
					</div>
				{/if}

			<!-- ══════════════════════════════════════════════════
			     TAB: BARANG
			══════════════════════════════════════════════════ -->
			{:else if activeTab === 'barang'}

				<!-- Sub: List Permintaan -->
				{#if activeSubTab === 'list-permintaan'}
					<div class="px-4 py-4 flex flex-col gap-3">
						<div class="card-section">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
								<span style="font-size:16px">📦</span> List Permintaan Barang
							</h4>
							<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Permintaan barang dan material untuk proyek ini dikelola melalui Packing List.</p>
							<button
								class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
								style="background: var(--gl);"
								onclick={() => goto(`/packing-list/${projectId}`)}
							>
								<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--g)">
									<IconPackage size={20} style="color: white" />
								</div>
								<div class="flex-1 min-w-0">
									<p class="text-[14px] font-semibold" style="color: var(--gd)">Buka Packing List</p>
									<p class="text-[11px] mt-0.5" style="color: var(--g)">Kelola permintaan material proyek</p>
								</div>
								<IconExternalLink size={16} style="color: var(--g)" />
							</button>
						</div>
					</div>

				<!-- Sub: Status Permintaan -->
				{:else if activeSubTab === 'status-permintaan'}
					<div class="px-4 py-4">
						<div class="rounded-xl p-3 mb-3" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
							<p class="text-[11px]" style="color: var(--sys-label3)">
								Status SPK (perintah produksi) yang dibuat Gudang dari Packing List proyek ini — hanya untuk dipantau. Pengajuan kebutuhan material tetap lewat "Buka Packing List" di atas, bukan di sini.
							</p>
						</div>

						{#if spkStatusLoading}
							<div class="flex items-center justify-center py-8">
								<IconLoader2 size={20} class="animate-spin" style="color: var(--sys-label3)" />
							</div>
						{:else if spkStatusError}
							<div class="px-4 py-6 text-center">
								<p class="text-[12px]" style="color: var(--r)">{spkStatusError}</p>
								<button
									class="mt-2 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
									style="background: var(--sys-fill); color: var(--sys-label)"
									onclick={loadSpkStatus}
								>
									Coba Lagi
								</button>
							</div>
						{:else if spkStatusList.length === 0}
							<div class="px-4 py-8 text-center">
								<div class="text-4xl mb-3">📊</div>
								<p class="text-[14px] font-semibold" style="color: var(--sys-label)">Belum Ada SPK</p>
								<p class="text-[12px] mt-1" style="color: var(--sys-label3)">SPK muncul di sini setelah Gudang memproses Packing List proyek ini dan mengajukan kekurangan stok ke Produksi.</p>
							</div>
						{:else}
							<div class="space-y-2">
								{#each spkStatusList as spk (spk.id)}
									<div class="rounded-xl p-3" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
										<div class="flex items-center justify-between gap-2">
											<div class="min-w-0 flex-1">
												<p class="text-[12px] font-semibold truncate" style="color: var(--sys-label)">
													{spk.product_name || `SPK ${spk.nomor}`}
												</p>
												<p class="text-[11px] truncate" style="color: var(--sys-label-2)">
													{spk.nomor}
													{#if spk.quantity != null}· {spk.quantity} {spk.unit || ''}{/if}
													{#if spk.tanggal}· {new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(new Date(spk.tanggal))}{/if}
												</p>
											</div>
											<span
												class="text-[10px] px-2 py-0.5 rounded-full shrink-0"
												style="background: {spk.is_selesai ? 'var(--gl)' : spk.stage_key === 'menunggu_analisa_rnd' ? 'var(--aml)' : 'var(--sys-fill)'}; color: {spk.is_selesai ? 'var(--g)' : spk.stage_key === 'menunggu_analisa_rnd' ? 'var(--amd)' : 'var(--sys-label)'}"
											>
												{spk.stage_label}
											</span>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

				<!-- Sub: Stock Management -->
				{:else if activeSubTab === 'stock-management'}
					<div class="px-4 py-4">
						<ProjectInventoryTab {projectId} />
					</div>
				{/if}

			<!-- ══════════════════════════════════════════════════
			     TAB: HSE
			══════════════════════════════════════════════════ -->
			{:else if activeTab === 'hse'}
				<div class="px-4 py-4 flex flex-col gap-3">
					<HseCompletenessCard projectId={project.id} />
					<WpoComplianceCard projectId={project.id} />
					<div class="card-section">
						<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
							<span style="font-size:16px">📋</span> JSA (Job Safety Analysis)
						</h4>
						<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Buat & kelola JSA per aktivitas kerja di proyek ini.</p>
						<button
							class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
							style="background: var(--gl);"
							onclick={() => goto(`/jsa/${projectId}`)}
						>
							<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--g)">
								<span style="font-size:18px">📋</span>
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-[14px] font-semibold" style="color: var(--gd)">Buka JSA Proyek</p>
								<p class="text-[11px] mt-0.5" style="color: var(--g)">Buat baru / lihat status persetujuan</p>
							</div>
							<IconExternalLink size={16} style="color: var(--g)" />
						</button>
					</div>
					<div class="card-section">
						<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
							<span style="font-size:16px">🚦</span> Checklist Pra-Mobilisasi
						</h4>
						<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Centang kesiapan manpower/alat/APD/JSA sebelum tim berangkat ke site setiap hari.</p>
						<button
							class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
							style="background: var(--gl);"
							onclick={() => goto(`/pra-mobilisasi/${projectId}`)}
						>
							<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--g)">
								<span style="font-size:18px">🚦</span>
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-[14px] font-semibold" style="color: var(--gd)">Buka Checklist Pra-Mobilisasi</p>
								<p class="text-[11px] mt-0.5" style="color: var(--g)">Isi checklist hari ini / lihat status</p>
							</div>
							<IconExternalLink size={16} style="color: var(--g)" />
						</button>
					</div>
					<div class="card-section">
						<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
							<span style="font-size:16px">🗣️</span> Toolbox Meeting
						</h4>
						<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Briefing pagi harian — peserta otomatis dari laporan harian, TTD digital.</p>
						<button
							class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
							style="background: var(--gl);"
							onclick={() => goto(`/toolbox/${projectId}`)}
						>
							<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--g)">
								<span style="font-size:18px">🗣️</span>
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-[14px] font-semibold" style="color: var(--gd)">Buka Toolbox Meeting</p>
								<p class="text-[11px] mt-0.5" style="color: var(--g)">Isi/lihat briefing hari ini</p>
							</div>
							<IconExternalLink size={16} style="color: var(--g)" />
						</button>
					</div>
					<div class="card-section">
						<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
							<span style="font-size:16px">📄</span> Dokumen HSE Proyek
						</h4>
						<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Induksi, rencana tanggap darurat (ERP), method statement.</p>
						<button
							class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
							style="background: var(--gl);"
							onclick={() => goto(`/proyek/${projectId}/hse-dok`)}
						>
							<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--g)">
								<span style="font-size:18px">📄</span>
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-[14px] font-semibold" style="color: var(--gd)">Buka Dokumen HSE</p>
								<p class="text-[11px] mt-0.5" style="color: var(--g)">Induksi / ERP / Method Statement</p>
							</div>
							<IconExternalLink size={16} style="color: var(--g)" />
						</button>
					</div>
					<div class="card-section">
						<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
							<span style="font-size:16px">🦺</span> Lapor & Izin HSE
						</h4>
						<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Lapor near-miss/insiden, ajukan izin kerja (PTW), dan lihat APD/MSDS.</p>
						<button
							class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
							style="background: var(--gl);"
							onclick={() => goto(`/hse`)}
						>
							<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--g)">
								<span style="font-size:18px">🦺</span>
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-[14px] font-semibold" style="color: var(--gd)">Buka Modul HSE</p>
								<p class="text-[11px] mt-0.5" style="color: var(--g)">Lapor insiden, izin kerja, APD &amp; MSDS</p>
							</div>
							<IconExternalLink size={16} style="color: var(--g)" />
						</button>
					</div>
					<div class="card-section">
						<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
							<span style="font-size:16px">👀</span> Kartu Observasi Keselamatan (SOC)
						</h4>
						<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Catat tindakan aman (apresiasi) atau tidak aman yang dilihat di lapangan.</p>
						<button
							class="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
							style="background: var(--gl);"
							onclick={() => goto(`/hse/soc`)}
						>
							<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--g)">
								<span style="font-size:18px">👀</span>
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-[14px] font-semibold" style="color: var(--gd)">Buat Observasi (SOC)</p>
								<p class="text-[11px] mt-0.5" style="color: var(--g)">Aman atau tidak aman — keduanya penting</p>
							</div>
							<IconExternalLink size={16} style="color: var(--g)" />
						</button>
					</div>
				</div>

			<!-- ══════════════════════════════════════════════════
			     TAB: DOKUMEN
			══════════════════════════════════════════════════ -->
			{:else if activeTab === 'dokumen'}
				<div class="px-4 py-4 flex flex-col gap-3">
					{#if offlineQueueCount > 0}
						<div class="flex items-center justify-between gap-3 p-3 rounded-xl text-[12px]" style="background: var(--aml); color: var(--amd)" title="Upload gagal karena sinyal lemah/offline disimpan di HP ini dan otomatis dicoba lagi saat online. Jangan hapus/logout sebelum tersinkron.">
							<div class="flex items-center gap-2">
								<IconAlertCircle size={18} class="shrink-0" />
								<span><span class="font-bold">{offlineQueueCount} dokumen</span> tersimpan lokal, belum terkirim (offline/sinyal lemah).</span>
							</div>
							<button
								class="px-3 py-1.5 rounded-lg text-white font-semibold shrink-0 flex items-center gap-1.5"
								style="background: var(--g)"
								disabled={isFlushingDocQueue}
								onclick={handleManualFlushDocQueue}
							>
								{#if isFlushingDocQueue}
									<IconLoader2 size={13} class="animate-spin" />
								{:else}
									<IconRefresh size={13} />
								{/if}
								Coba Kirim
							</button>
						</div>
					{/if}
					<div class="rounded-xl px-3 py-2 text-[12px]" style="background: var(--sys-fill); color: var(--sys-label3)">
						ℹ️ Dokumen baru dikelompokkan per fase proyek (Kontrak, Engineering, HSE, dst) — pilih jenisnya saat upload supaya lebih mudah dicari admin. Dokumen lama tanpa jenis muncul di grup "Belum Dikategorikan".
					</div>

					{#if applicableTemplate && requiredChecklistItems.length > 0}
						<div class="card-section">
							<button class="w-full flex items-center justify-between" onclick={() => (showChecklistView = !showChecklistView)} title="Daftar jenis dokumen wajib dari template checklist admin ({applicableTemplate.nama}) -- read-only, admin yang atur isinya">
								<span class="flex items-center gap-1.5 text-[13px] font-semibold" style="color: var(--sys-label)">
									📋 Checklist Dokumen Wajib
									<span class="text-[11px] font-normal px-1.5 py-0.5 rounded-full" style="background: {missingRequiredCount === 0 ? 'var(--gg)' : 'var(--sys-fill)'}; color: {missingRequiredCount === 0 ? 'var(--g)' : 'var(--sys-label3)'}">
										{requiredChecklistItems.length - missingRequiredCount}/{requiredChecklistItems.length}
									</span>
								</span>
								<span style="color: var(--sys-label3)">{showChecklistView ? '▲' : '▼'}</span>
							</button>
							{#if showChecklistView}
								<div class="mt-2 flex flex-col gap-1">
									{#each checklistViewItems as item (item.id)}
										<div class="flex items-center gap-2 text-[12px] py-0.5">
											<span style="color: {item.fulfilled ? 'var(--g)' : 'var(--sys-label3)'}">{item.fulfilled ? '✓' : '○'}</span>
											<span style="color: {item.fulfilled ? 'var(--sys-label)' : 'var(--sys-label3)'}">{item.nama}</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}

					<div class="card-section">
						<div class="flex items-center justify-between mb-3">
							<h4 class="flex items-center gap-2 text-[13px] font-semibold" style="color: var(--sys-label)">
								<IconFolder size={16} style="color: var(--g)" /> Dokumen Proyek
								{#if unifiedDocs.length > 0}
									<span class="text-[11px] font-normal px-1.5 py-0.5 rounded-full" style="background: var(--sys-fill); color: var(--sys-label3)">{unifiedDocs.length}</span>
								{/if}
							</h4>
							<div class="flex items-center gap-1.5">
								<button
									class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
									style="background: var(--g)"
									onclick={() => cameraInputEl?.click()}
									disabled={uploadingCameraPhoto}
									title="Foto langsung dari kamera, otomatis masuk sebagai Dokumentasi Foto (tanpa perlu pilih jenis)"
								>
									{#if uploadingCameraPhoto}
										<IconLoader2 size={14} class="animate-spin" />
									{:else}
										<IconCamera size={14} /> Foto
									{/if}
								</button>
								<button
									class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
									style="background: var(--g)"
									onclick={() => fileInputEl?.click()}
									disabled={uploadingDokumen}
									title="Pilih file, lalu pilih jenis dokumennya sebelum diunggah"
								>
									{#if uploadingDokumen}
										<IconLoader2 size={14} class="animate-spin" />
										Mengupload...
									{:else}
										<IconUpload size={14} /> Upload
									{/if}
								</button>
							</div>
							<input
								bind:this={cameraInputEl}
								type="file"
								accept="image/*"
								capture="environment"
								class="hidden"
								onchange={handleCameraCapture}
							/>
							<input
								bind:this={fileInputEl}
								type="file"
								multiple
								class="hidden"
								onchange={(e) => handleUploadDokumen((e.target as HTMLInputElement).files)}
							/>
						</div>

						{#if unifiedDocs.length > 0}
							<div class="flex gap-2 mb-3">
								<input
									type="text"
									bind:value={docSearchQuery}
									placeholder="Cari nama dokumen..."
									class="flex-1 rounded-xl px-3 py-2 text-[13px]"
									style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
								/>
								<select
									bind:value={docFaseFilter}
									class="rounded-xl px-2 py-2 text-[13px]"
									style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
									title="Filter berdasarkan fase proyek"
								>
									<option value="semua">Semua Fase</option>
									{#each availableFases as fase (fase)}
										<option value={fase}>{fase === '_belum_dikategorikan' ? 'Belum Dikategorikan' : (FASE_LABELS[fase] || fase)}</option>
									{/each}
								</select>
							</div>
						{/if}

						{#if dokumenLoading}
							<div class="flex items-center justify-center py-8 gap-2">
								<IconLoader2 size={20} class="animate-spin" style="color: var(--g)" />
								<span class="text-[13px]" style="color: var(--sys-label3)">Memuat dokumen...</span>
							</div>
						{:else if unifiedDocs.length > 0 && filteredUnifiedDocs.length === 0}
							<div class="text-center py-8">
								<div class="text-4xl mb-3">🔍</div>
								<p class="text-[13px] font-semibold" style="color: var(--sys-label)">Tidak ada dokumen yang cocok</p>
								<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Coba ubah kata kunci atau filter fase.</p>
							</div>
						{:else if unifiedDocs.length === 0}
							<div class="text-center py-8">
								<div class="text-4xl mb-3">📂</div>
								<p class="text-[13px] font-semibold" style="color: var(--sys-label)">Belum ada dokumen</p>
								<p class="text-[12px] mt-1 mb-4" style="color: var(--sys-label3)">Upload dokumen proyek seperti kontrak, SPK, foto, dll.</p>
								<button
									class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold text-white"
									style="background: var(--g)"
									onclick={() => fileInputEl?.click()}
								>
									<IconUpload size={14} /> Upload Dokumen Pertama
								</button>
							</div>
						{:else}
							<div class="flex flex-col gap-4">
								{#each Object.entries(groupedDocs) as [fase, docs] (fase)}
									<div>
										<p class="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style="color: var(--sys-label3)">
											{fase === '_belum_dikategorikan' ? 'Belum Dikategorikan' : (FASE_LABELS[fase] || fase)}
										</p>
										<div class="flex flex-col divide-y" style="border-color: var(--sys-sep)">
											{#each docs as doc (doc.key)}
												<div class="flex items-center gap-3 py-2.5">
													<div class="text-2xl shrink-0 leading-none">{getFileTypeIcon(doc.type || '')}</div>
													<div class="flex-1 min-w-0">
														<p class="text-[13px] font-medium truncate" style="color: var(--sys-label)">{doc.title}</p>
														<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
															{#if doc.filesize}{formatFileSize(doc.filesize)} · {/if}
															{#if doc.uploaded_on}
																{new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(doc.uploaded_on))}
															{/if}
														</p>
														{#if doc.source === 'unified' && (doc.status === 'draft' || doc.status === 'review')}
															<button
																class="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
																style="background: {doc.status === 'review' ? 'var(--gg)' : 'var(--sys-fill)'}; color: {doc.status === 'review' ? 'var(--g)' : 'var(--sys-label3)'}"
																onclick={() => toggleSimpleStatus(doc)}
																title="Klik untuk ganti status -- 'Butuh Review' memberi tahu admin dokumen ini perlu ditinjau"
															>
																{doc.status === 'review' ? '👁 Butuh Review' : '✓ Sudah Upload'}
															</button>
														{/if}
													</div>
													<div class="flex items-center gap-1 shrink-0">
														<a
															href={doc.downloadUrl}
															target="_blank"
															rel="noopener"
															class="p-2 rounded-lg transition-colors flex items-center justify-center"
															style="color: var(--g); background: var(--gg)"
															title="Download"
														>
															<IconDownload size={15} />
														</a>
														{#if doc.fileId}
															{#if cachedFileIds.has(doc.fileId)}
																<button
																	class="p-2 rounded-lg transition-colors flex items-center justify-center"
																	style="color: var(--gg); background: var(--gl)"
																	title="Tersimpan offline -- klik untuk buka tanpa sinyal, tahan lama untuk hapus"
																	onclick={() => handleOpenOffline(doc)}
																	oncontextmenu={(e) => { e.preventDefault(); handleRemoveOffline(doc); }}
																>
																	<IconCloudCheck size={15} />
																</button>
															{:else}
																<button
																	class="p-2 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50"
																	style="color: var(--sys-label3); background: var(--sys-fill)"
																	title="Simpan untuk dibuka tanpa sinyal (offline)"
																	disabled={savingOfflineFileId === doc.fileId}
																	onclick={() => handleSaveOffline(doc)}
																>
																	{#if savingOfflineFileId === doc.fileId}
																		<IconLoader2 size={15} class="animate-spin" />
																	{:else}
																		<IconCloudDownload size={15} />
																	{/if}
																</button>
															{/if}
														{/if}
														<button
															class="p-2 rounded-lg transition-colors flex items-center justify-center"
															style="color: var(--re); background: var(--rel)"
															title="Hapus"
															onclick={() => handleDeleteDokumen(doc)}
														>
															<IconTrash size={15} />
														</button>
													</div>
												</div>
											{/each}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<div class="card-section">
						<div class="flex items-center justify-between">
							<button class="flex items-center gap-1.5 text-[13px] font-semibold" style="color: var(--sys-label)" onclick={loadTransmittals} title="Catat pengiriman dokumen fisik/salinan ke klien atau konsultan, dan pantau apakah sudah diterima">
								📦 Transmittal Log {transmittals.length > 0 ? `(${transmittals.length})` : ''}
								<span style="color: var(--sys-label3)">{showTransmittalLog ? '▲' : '▼'}</span>
							</button>
							{#if showTransmittalLog}
								<button class="text-[12px] px-2.5 py-1.5 rounded-lg" style="background: var(--gg); color: var(--g)" onclick={() => (showTransmittalForm = !showTransmittalForm)}>
									+ Catat Pengiriman
								</button>
							{/if}
						</div>

						{#if showTransmittalForm}
							<div class="mt-3 p-3 rounded-xl space-y-2" style="background: var(--sys-fill)">
								<select bind:value={transmittalForm.project_document_id} class="w-full rounded-lg px-2.5 py-2 text-[12px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)">
									<option value={null}>— Dokumen manual (isi nama di bawah) —</option>
									{#each projectDocs as d (d.id)}
										<option value={d.id}>{d.nama_dokumen}</option>
									{/each}
								</select>
								{#if !transmittalForm.project_document_id}
									<input type="text" bind:value={transmittalForm.nama_dokumen_manual} placeholder="Nama dokumen" class="w-full rounded-lg px-2.5 py-2 text-[12px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								{/if}
								<input type="text" bind:value={transmittalForm.tujuan} placeholder="Tujuan (nama perusahaan) *" class="w-full rounded-lg px-2.5 py-2 text-[12px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input type="text" bind:value={transmittalForm.pic_penerima} placeholder="PIC Penerima (opsional)" class="w-full rounded-lg px-2.5 py-2 text-[12px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<div class="grid grid-cols-2 gap-2">
									<input type="date" bind:value={transmittalForm.tanggal_kirim} class="rounded-lg px-2.5 py-2 text-[12px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
									<select bind:value={transmittalForm.metode} class="rounded-lg px-2.5 py-2 text-[12px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)">
										<option value="langsung">Langsung/Tangan</option>
										<option value="kurir">Kurir</option>
										<option value="email">Email</option>
										<option value="pos">Pos</option>
									</select>
								</div>
								<input type="text" bind:value={transmittalForm.catatan} placeholder="Catatan (opsional)" class="w-full rounded-lg px-2.5 py-2 text-[12px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<div class="flex gap-2">
									<button class="flex-1 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60" style="background: var(--g)" onclick={handleCreateTransmittal} disabled={transmittalSaving}>
										{transmittalSaving ? 'Menyimpan...' : 'Simpan'}
									</button>
									<button class="px-3 py-2 rounded-lg text-[12px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" onclick={() => { showTransmittalForm = false; transmittalForm = emptyTransmittalForm(); }}>
										Batal
									</button>
								</div>
							</div>
						{/if}

						{#if showTransmittalLog}
							<div class="mt-2 flex flex-col gap-1.5">
								{#if transmittals.length === 0}
									<p class="text-[12px] text-center py-2" style="color: var(--sys-label3)">Belum ada transmittal tercatat.</p>
								{:else}
									{#each transmittals as t (t.id)}
										<div class="flex items-center gap-2 text-[12px] rounded-lg px-2.5 py-2" style="background: var(--sys-fill)">
											<div class="flex-1 min-w-0">
												<p class="font-medium truncate" style="color: var(--sys-label)">{t.project_document_id ? projectDocs.find((d) => d.id === t.project_document_id)?.nama_dokumen || t.nama_dokumen_manual : t.nama_dokumen_manual} → {t.tujuan}</p>
												<p style="color: var(--sys-label3)">
													{new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t.tanggal_kirim))} · {t.metode}
													{#if t.pic_penerima}· {t.pic_penerima}{/if}
												</p>
											</div>
											<span class="px-1.5 py-0.5 rounded font-medium shrink-0" style="background: {t.status === 'diterima' ? 'var(--gg)' : t.status === 'ditolak' ? 'var(--rel)' : 'var(--sys-fill)'}; color: {t.status === 'diterima' ? 'var(--g)' : t.status === 'ditolak' ? 'var(--re)' : 'var(--sys-label3)'}">
												{t.status === 'diterima' ? 'Diterima' : t.status === 'ditolak' ? 'Ditolak' : 'Terkirim'}
											</span>
											{#if t.status === 'terkirim'}
												<button class="shrink-0" style="color: var(--g)" onclick={() => markTransmittalReceived(t)}>Tandai Diterima</button>
											{/if}
										</div>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				</div>

				{#if showTypePicker}
					<div class="fixed inset-0 z-50 flex items-end justify-center" style="background: rgba(0,0,0,0.4)">
						<div class="w-full max-w-md rounded-t-2xl p-4 pb-6" style="background: var(--sys-bg)">
							<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">Pilih Jenis Dokumen</p>
							<p class="text-[11px] mb-3" style="color: var(--sys-label3)">
								{pendingFiles.length} file dipilih — pilih jenisnya supaya mudah dicari admin nanti. Kosongkan bila tidak tahu, bisa dikategorikan admin belakangan.
							</p>
							<select
								bind:value={pickedDocTypeId}
								class="w-full rounded-xl px-3 py-2.5 text-[13px] mb-3"
								style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
							>
								<option value={null}>— Belum tahu / Lainnya —</option>
								{#each Object.entries(groupedDocTypes) as [fase, types] (fase)}
									<optgroup label={FASE_LABELS[fase] || fase}>
										{#each types as t (t.id)}
											<option value={t.id}>{t.nama}</option>
										{/each}
									</optgroup>
								{/each}
							</select>
							<div class="flex gap-2">
								<button
									class="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-60"
									style="background: var(--g)"
									onclick={confirmUploadWithType}
									disabled={uploadingDokumen}
								>
									{uploadingDokumen ? 'Mengunggah...' : 'Upload'}
								</button>
								<button
									class="px-4 py-2.5 rounded-xl text-[13px] font-semibold"
									style="background: var(--sys-fill); color: var(--sys-label)"
									onclick={cancelTypePicker}
									disabled={uploadingDokumen}
								>
									Batal
								</button>
							</div>
						</div>
					</div>
				{/if}

			{:else if activeTab === 'kirim'}
				<div class="px-4 py-4 flex flex-col gap-3">
					<div class="card-section">
						<div class="rounded-xl px-3 py-2 mb-3 text-[12px]" style="background: var(--sys-fill); color: var(--sys-label3)">
							ℹ️ Anda tidak bisa chat langsung ke pelanggan. Ajukan foto/catatan di sini — admin akan meninjau lalu mengirimkannya dari nomor WhatsApp resmi perusahaan.
						</div>

						<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-2" style="color: var(--sys-label)">
							📨 Ajukan Kirim ke Pelanggan
						</h4>

						{#if sendMediaFile}
							<div class="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg text-[12px]" style="background: var(--gg); color: var(--g)">
								<span>📎 {sendMediaFile.filename}</span>
								<button class="font-bold ml-auto" onclick={() => sendMediaFile = null}>✕</button>
							</div>
						{/if}

						<textarea
							class="w-full rounded-xl px-3 py-2 text-[13px] resize-none mb-2"
							style="border: 1px solid var(--sys-sep); background: var(--sys-bg)"
							rows="3"
							placeholder="Tulis catatan untuk pelanggan…"
							bind:value={sendNote}
						></textarea>

						<div class="flex gap-2">
							<input
								bind:this={sendFileInputEl}
								type="file"
								accept="image/*,.pdf"
								class="hidden"
								onchange={(e) => handleSendMediaPick((e.target as HTMLInputElement).files)}
							/>
							<button
								class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold disabled:opacity-60"
								style="border: 1px solid var(--sys-sep); color: var(--sys-label)"
								onclick={() => sendFileInputEl?.click()}
								disabled={sendUploading || !!sendMediaFile}
							>
								{sendUploading ? 'Mengunggah…' : '📷 Lampirkan Foto'}
							</button>
							<button
								class="flex-1 px-3 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-60"
								style="background: var(--g)"
								onclick={submitSendRequest}
								disabled={sendSubmitting || sendUploading || (!sendNote.trim() && !sendMediaFile)}
							>
								{sendSubmitting ? 'Mengajukan…' : 'Ajukan'}
							</button>
						</div>
					</div>

					<div class="card-section">
						<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-2" style="color: var(--sys-label)">
							Riwayat Pengajuan
						</h4>
						{#if sendRequestsLoading}
							<div class="flex items-center justify-center py-6 gap-2">
								<IconLoader2 size={18} class="animate-spin" style="color: var(--g)" />
								<span class="text-[13px]" style="color: var(--sys-label3)">Memuat…</span>
							</div>
						{:else if sendRequests.length === 0}
							<p class="text-[12px] text-center py-6" style="color: var(--sys-label3)">Belum ada pengajuan.</p>
						{:else}
							<div class="flex flex-col divide-y" style="border-color: var(--sys-sep)">
								{#each sendRequests as r}
									<div class="py-2.5">
										<div class="flex items-center justify-between gap-2">
											<span class="text-[12px] font-semibold" style="color: var(--sys-label)">{sendStatusLabel(r.status)}</span>
											<span class="text-[11px]" style="color: var(--sys-label3)">
												{new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(r.date_created))}
											</span>
										</div>
										{#if r.note}<p class="text-[12px] mt-1" style="color: var(--sys-label2)">{r.note}</p>{/if}
										{#if r.status === 'rejected' && r.reject_reason}
											<p class="text-[11px] mt-1" style="color: var(--re)">Alasan: {r.reject_reason}</p>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<div class="h-6"></div>
		</div>
	{/if}
</div>

{#if showManualAbsensi}
	<ManualAbsensiModal
		projectId={project.id}
		onClose={() => showManualAbsensi = false}
		onSuccess={() => { showManualAbsensi = false; loadManpowerSummary(); }}
	/>
{/if}

{#if showExportSheet && project}
	<ProjectExportSheet
		projectId={project.id}
		projectName={project.name}
		arsip={String(project.status || '').trim().toLowerCase() === 'closed'}
		onClose={() => (showExportSheet = false)}
	/>
{/if}

<style>
	.persiapan-banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		padding: 8px 12px;
		font-size: 12px;
		background: #fef3c7;
		color: #92400e;
		border-bottom: 1px solid #fde68a;
	}
	/* ── Breadcrumb + Link ──────────────────────────── */
	.breadcrumb-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		background: rgba(15, 23, 42, 0.35);
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.breadcrumb-bar::-webkit-scrollbar { display: none; }
	.breadcrumb-crumb {
		font-size: 12px;
		font-weight: 500;
		color: var(--sys-label3);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
		padding: 3px 9px;
		cursor: pointer;
		font-family: inherit;
		white-space: nowrap;
		max-width: 180px;
		transition: all 0.15s ease;
	}
	.breadcrumb-crumb:hover {
		color: var(--p);
		background: rgba(59, 130, 246, 0.1);
		border-color: rgba(59, 130, 246, 0.25);
	}
	.breadcrumb-current {
		color: var(--sys-label);
		font-weight: 600;
		background: rgba(255, 255, 255, 0.08);
		border-color: rgba(255, 255, 255, 0.12);
		cursor: default;
	}
	.breadcrumb-current:hover {
		color: var(--sys-label);
		background: rgba(255, 255, 255, 0.08);
	}
	.breadcrumb-sep {
		color: var(--sys-label4, var(--sys-label3));
		opacity: 0.6;
	}
	.breadcrumb-copy {
		margin-left: auto;
		flex-shrink: 0;
		font-size: 11.5px;
		font-weight: 600;
		color: #60a5fa;
		background: rgba(59, 130, 246, 0.12);
		border: 1px solid rgba(59, 130, 246, 0.3);
		border-radius: 20px;
		padding: 4px 12px;
		cursor: pointer;
		font-family: inherit;
		white-space: nowrap;
		transition: all 0.2s ease;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
	}
	.breadcrumb-copy:hover {
		background: rgba(59, 130, 246, 0.22);
		border-color: rgba(59, 130, 246, 0.5);
		transform: translateY(-1px);
	}

	/* ── Level 1: Main Tab Bar ─────────────────────── */
	.main-tab-bar {
		display: flex;
		align-items: center;
		overflow-x: auto;
		scrollbar-width: none;
		-ms-overflow-style: none;
		background: var(--sys-bg);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--sys-sep);
		position: sticky;
		top: 0;
		z-index: 20;
		padding: 0 8px;
		gap: 2px;
	}
	.main-tab-bar::-webkit-scrollbar { display: none; }

	.main-tab-item {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 14px;
		font-size: 13px;
		font-weight: 600;
		color: var(--sys-label3);
		background: transparent;
		border: none;
		border-bottom: 2.5px solid transparent;
		cursor: pointer;
		white-space: nowrap;
		font-family: inherit;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		border-radius: 6px 6px 0 0;
	}
	.main-tab-item:hover {
		color: var(--sys-label);
		background: rgba(255, 255, 255, 0.04);
	}
	.main-tab-item.active {
		color: var(--p);
		border-bottom-color: var(--p);
		font-weight: 700;
		background: rgba(59, 130, 246, 0.06);
		box-shadow: inset 0 -6px 10px -6px rgba(59, 130, 246, 0.35);
	}
	.main-tab-item :global(.tab-icon) {
		opacity: 0.7;
		transition: opacity 0.2s ease, transform 0.2s ease;
	}
	.main-tab-item:hover :global(.tab-icon) {
		opacity: 1;
	}
	.main-tab-item.active :global(.tab-icon) {
		opacity: 1;
		color: var(--p);
		transform: scale(1.08);
	}

	/* ── Level 2: Sub-Tab Bar (Segmented Control Pill Bar) ──────────────────────── */
	.sub-tab-bar {
		display: flex;
		align-items: center;
		overflow-x: auto;
		scrollbar-width: none;
		-ms-overflow-style: none;
		background: var(--sys-fill);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--sys-sep);
		padding: 6px 12px;
		position: sticky;
		top: 44px;
		z-index: 15;
		gap: 6px;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
	}
	.sub-tab-bar::-webkit-scrollbar { display: none; }

	.sub-tab-item {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		font-size: 12px;
		font-weight: 500;
		color: var(--sys-label2);
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		cursor: pointer;
		white-space: nowrap;
		font-family: inherit;
		transition: all 0.18s ease;
	}
	.sub-tab-item:hover {
		color: var(--sys-label);
		background: rgba(255, 255, 255, 0.08);
		border-color: rgba(255, 255, 255, 0.12);
	}
	.sub-tab-item.active {
		color: #ffffff;
		background: var(--p);
		border-color: rgba(255, 255, 255, 0.2);
		font-weight: 600;
		box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
		transform: translateY(-0.5px);
	}
	.sub-tab-emoji {
		font-size: 13px;
		line-height: 1;
		filter: drop-shadow(0 1px 1px rgba(0,0,0,0.2));
	}

	/* ── Charter Status Row ─────────────────────────── */
	.charter-status-row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px;
		border-radius: 10px;
		background: var(--gg);
	}
	.charter-check-icon {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		font-weight: 700;
		flex-shrink: 0;
	}
	.charter-check-icon.ok { background: var(--ggd); color: white; }
	.charter-check-icon.warn { background: var(--am); color: white; }
	.charter-status-row.warn { background: var(--aml); }

	/* ── Manpower Info Grid ─────────────────────────── */
	.manpower-info-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.manpower-info-card {
		padding: 16px;
		border-radius: 12px;
		background: var(--sys-fill);
		text-align: center;
	}
</style>
