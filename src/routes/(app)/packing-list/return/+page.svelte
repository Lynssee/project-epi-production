<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		IconArrowLeft, IconPackage, IconInfoCircle, IconPlus, IconCheck,
		IconLoader2, IconSend, IconTrash, IconSearch, IconNewSection, IconCornerUpLeft
	} from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import {
		getProjectInventoryTerpadu, createReturnEvidencePhoto,
		searchMasterCatalog, getMasterCatalogItemById, fetchReturTracking,
		submitReturPengajuan, ReturSubmitClientError, fetchActiveReturByItem
	} from '$lib/services/packingList';
	import ReturnLifecycleStepper from '$lib/components/packing-list/ReturnLifecycleStepper.svelte';
	import type { ReturTracking } from '$lib/utils/returLifecycle';
	import type { ReturnItem } from '$lib/services/packingList';

	const unwrapId = (v: any): number | null =>
		v == null ? null : typeof v === 'object' ? (v.id ?? null) : Number(v) || null;
	import { RETURN_CONDITION_OPTIONS, RETURN_REASON_CODE_OPTIONS, validateReturnItem } from '$lib/schemas/packingListReturn';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import QrScannerModal from '$lib/components/scanner/QrScannerModal.svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import { getCurrentPosition, type DevicePosition } from '$lib/utils/geoClient';
	import { IconCamera, IconQrcode } from '@tabler/icons-svelte';
	// Fase 3, Rencana v2 "Lifecycle Pengembalian Barang" (§6) — Tutup Massal HABIS_PAKAI di
	// Mode Demobilisasi: klasifikasi Kebijakan Kembali + ambang tutup massal dari system_settings.
	import directus from '$lib/services/directus';
	import { readItems, createItem } from '@directus/sdk';
	import { loadInventorySettings, getInventorySetting } from '$lib/services/inventorySettings';
	import { resolveReturnPolicy, isEligibleForBatchClose, RETURN_POLICY, RETUR_POLICY_MAP_SETTING_KEY, DEFAULT_BATCH_CLOSE_THRESHOLD_IDR } from '$lib/services/returnPolicyResolver';
	import { reportUsageDeltas } from '$lib/services/projectUsageLedger';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { getQtyTerkunci } from '$lib/services/mutasiApi';
	import { IconAlertTriangle } from '@tabler/icons-svelte';

	let projects = $state<any[]>([]);
	let selectedProject = $state('');
	let loading = $state(true);
	let loadingItems = $state(false);
	// Fase 5 — jumlah item yang otomatis tercentang dari deep-link "Buat Draft Retur" (halaman
	// Barang Menganggur/Saldo Stok). null = bukan datang dari deep-link, tidak tampilkan banner.
	let autoDraftItemCount = $state<number | null>(null);
	let submitting = $state(false);
	// RSM-03 §4.1: id pengiriman — sama untuk semua percobaan kirim pada pengisian form yang sama,
	// supaya server tidak membuat baris dobel saat jaringan putus lalu leader menekan Kirim lagi.
	const SUBMISSION_KEY = 'epi_return_submission_id';
	function newSubmissionId(): string {
		const fresh = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
		try {
			let v = localStorage.getItem(SUBMISSION_KEY);
			if (!v) { v = fresh(); localStorage.setItem(SUBMISSION_KEY, v); }
			return v;
		} catch { return fresh(); }
	}
	let clientSubmissionId = $state(newSubmissionId());
	function resetSubmissionId() {
		try { localStorage.removeItem(SUBMISSION_KEY); } catch { /* opsional */ }
		clientSubmissionId = newSubmissionId();
	}
	let showConfirmModal = $state(false);

	let currentRoleId: string | null = null;
	let currentKaryawanId: number | null = null;
	let currentKaryawanName: string | null = null;
	let currentDirectusToken: string | null = null;

	const unsubAuth = authStore.subscribe((s) => {
		currentRoleId = s.roleId;
		currentKaryawanId = s.karyawanId;
		currentKaryawanName = s.karyawanName;
		currentDirectusToken = s.directusToken;
	});

	// === Barang dari Inventory (Barang Terkirim) ===
	let inventoryItems = $state<any[]>([]);
	// RSM-05: dari mana daftar barang berasal ('saldo' = project_stock_balance, 'biaya' = cadangan) & apakah proyek tanpa catatan kirim.
	let inventorySumber = $state<'saldo' | 'biaya'>('saldo');
	let tanpaCatatanKirim = $state(false);
	let selectedInventory = $state<Set<number>>(new Set());
	let inventoryQtyMap = $state<Record<number, number>>({});
	let inventoryNotesMap = $state<Record<number, string>>({});
	// Fase 3 (Goods Return v3): kondisi wajib per item, default 'ok'.
	let inventoryConditionMap = $state<Record<number, string>>({});
	// Fase 4 (Standarisasi Cat & Smart Swatch) — alasan retur terstruktur, hanya relevan untuk
	// item yang punya material_color (cat/material berwarna), opsional.
	let inventoryReasonMap = $state<Record<number, string>>({});
	let searchQuery = $state('');
	// RSM-03 §4.2: qty yang sedang dalam proses retur per identitas_barang_id (cegah pengajuan dobel).
	let activeReturMap = $state<Record<number, { qty: number; docNo: string | null }>>({});
	function blockedInfo(item: any): { docNo: string | null } | null {
		const active = activeReturMap[Number(unwrapId(item?.identitas_barang_id))];
		if (!active || active.qty <= 0) return null;
		const rem = Number(item?.qty_remaining) || 0;
		return rem - active.qty <= 0 ? { docNo: active.docNo } : null;
	}

	let filteredInventory = $derived(
		searchQuery.trim()
			? inventoryItems.filter(i =>
				(i.material_name || i.description || '').toLowerCase().includes(searchQuery.toLowerCase())
			)
			: inventoryItems
	);

	const categoryNames: Record<string, string> = {
		'packing_sewa_alat': 'PERALATAN / SEWA ALAT',
		'packing_consumable': 'CONSUMABLE',
		'packing_supplier': 'MATERIAL SUPPLIER',
		'packing_safety': 'SAFETY',
		'packing_operasional': 'OPERASIONAL',
		'packing_jasa': 'JASA',
		'packing_lain_lain': 'LAIN-LAIN',
		'supplier': 'MATERIAL SUPPLIER',
		'consumable': 'CONSUMABLE',
		'safety': 'SAFETY',
		'sewa_alat': 'PERALATAN / SEWA ALAT',
		'equipment': 'PERALATAN / SEWA ALAT',
		'operasional': 'OPERASIONAL',
		'jasa': 'JASA',
		'lain_lain': 'LAIN-LAIN',
	};

	let groupedInventory = $derived(() => {
		const groups: Record<string, any[]> = {};
		for (const item of filteredInventory) {
			const rawType = item.expense_type || 'supplier';
			const cat = categoryNames[rawType] || rawType.toUpperCase();
			if (!groups[cat]) groups[cat] = [];
			groups[cat].push(item);
		}
		const sortedKeys = Object.keys(groups).sort();
		return { groups, sortedKeys };
	});

	// === Barang baru (input manual) ===
	let manualItems = $state<Array<{
		_key: string;
		material_name: string;
		material_color: string;
		qty_returned: number;
		unit: string;
		leader_notes: string;
		condition: string;
		// Fase 4 (Standarisasi Cat & Smart Swatch) — opsional, hanya relevan bila material_color diisi.
		reason_code: string;
		// 4-Gate Retur Gudang v2 Fase 2 (A1): item baru WAJIB tertaut master katalog.
		item_id: number | null;
		item_label: string;
	}>>([]);
	let manualItemSeq = 0;

	// Pencarian master katalog per baris manual (key = item._key).
	let masterQuery = $state<Record<string, string>>({});
	let masterResults = $state<Record<string, Array<{ id: number; nama_barang_lengkap: string; kode_item?: string; satuan?: string }>>>({});
	let masterSearching = $state<Record<string, boolean>>({});
	let masterSearchTimer: Record<string, ReturnType<typeof setTimeout>> = {};

	function runMasterSearch(key: string, q: string) {
		masterQuery = { ...masterQuery, [key]: q };
		clearTimeout(masterSearchTimer[key]);
		if (!q || q.trim().length < 2) {
			masterResults = { ...masterResults, [key]: [] };
			return;
		}
		masterSearchTimer[key] = setTimeout(async () => {
			masterSearching = { ...masterSearching, [key]: true };
			try {
				const rows = await searchMasterCatalog(q);
				masterResults = { ...masterResults, [key]: rows as any[] };
			} catch {
				masterResults = { ...masterResults, [key]: [] };
			} finally {
				masterSearching = { ...masterSearching, [key]: false };
			}
		}, 300);
	}

	function pickMaster(i: number, row: { id: number; nama_barang_lengkap: string; satuan?: string }) {
		const it = manualItems[i];
		if (!it) return;
		it.item_id = row.id;
		it.item_label = row.nama_barang_lengkap;
		if (!it.material_name.trim()) it.material_name = row.nama_barang_lengkap;
		// RSM-03 §4.5: satuan MASTER dipakai apa adanya; bila belum ada di opsi, ditambahkan (dulu diabaikan -> tetap "Kg").
		if (row.satuan) {
			if (!unitOptions.includes(row.satuan)) unitOptions = [...unitOptions, row.satuan];
			it.unit = row.satuan;
		}
		manualItems = [...manualItems];
		masterResults = { ...masterResults, [it._key]: [] };
		masterQuery = { ...masterQuery, [it._key]: '' };
	}

	function clearMaster(i: number) {
		const it = manualItems[i];
		if (!it) return;
		it.item_id = null;
		it.item_label = '';
		manualItems = [...manualItems];
	}

	// §7 rekomendasi L1 — scan-to-return: pindai label QR barang (EPI:ITEM:<id>, resolver
	// sudah ada di stock-lapangan/masuk) untuk isi item_id langsung, tanpa ketik nama.
	// id di payload QR SUDAH id identitas_barang — cukup satu lookup by id untuk nama/satuan.
	let scanTargetIndex = $state<number | null>(null);
	let scanBusy = $state(false);
	let scanErrorByKey = $state<Record<string, string>>({});

	function openScanFor(i: number) {
		scanTargetIndex = i;
	}
	function closeScan() {
		scanTargetIndex = null;
	}
	async function onScanDetect(value: string) {
		const i = scanTargetIndex;
		closeScan();
		if (i == null) return;
		const it = manualItems[i];
		if (!it) return;
		const parsed = parseEpiQr(value);
		if (!parsed || parsed.type !== 'ITEM') {
			scanErrorByKey = { ...scanErrorByKey, [it._key]: 'QR bukan label barang (ITEM) — pakai pencarian manual.' };
			return;
		}
		scanBusy = true;
		scanErrorByKey = { ...scanErrorByKey, [it._key]: '' };
		try {
			const master = await getMasterCatalogItemById(Number(parsed.id));
			if (!master) {
				scanErrorByKey = { ...scanErrorByKey, [it._key]: 'Barang hasil scan tidak ditemukan di master katalog.' };
				return;
			}
			pickMaster(i, master);
		} finally {
			scanBusy = false;
		}
	}

	// Penerbit surat jalan retur (setelan inventory.retur.penerbit_surat_jalan, default 'inventory'):
	// leader hanya MENGAJUKAN; tim Inventory yang membuat surat jalan pengambilan & mengirim sopir.
	// 'lapangan' = perilaku lama (dokumen RTN dibuat & dicetak leader saat submit). Server
	// (/api/retur-gudang) tetap jadi penentu akhir — nilai di sini hanya mengatur tampilan.
	let returPenerbit = $state<'inventory' | 'lapangan'>('inventory');

	// Data pengiriman dokumen retur (Fase 2) — ikut satu dokumen retur_gudang.
	let driverName = $state('');
	let driverPhone = $state('');
	let vehiclePlate = $state('');
	let expeditionName = $state('');

	// §7 rekomendasi L4 — satu dokumen retur bisa membawa material DAN alat sekaligus
	// (realitas demobilisasi: satu truk, satu kali kirim), bukan dua dokumen terpisah.
	let projectEquipment = $state<Array<{ id: string; equipment?: { name?: string; code?: string } | null; start_date?: string; end_date_planned?: string | null }>>([]);
	let selectedEquipment = $state<Set<string>>(new Set());
	let loadingEquipment = $state(false);

	async function loadProjectEquipment(projectId: number) {
		loadingEquipment = true;
		selectedEquipment = new Set();
		try {
			const { fetchActiveLoansForProject } = await import('$lib/services/loanChecklist');
			projectEquipment = await fetchActiveLoansForProject(projectId);
		} catch (e) {
			console.error('Gagal memuat alat proyek untuk retur:', e);
			projectEquipment = [];
		} finally {
			loadingEquipment = false;
		}
	}

	function toggleEquipment(id: string) {
		const s = new Set(selectedEquipment);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		selectedEquipment = s;
	}

	// §7 rekomendasi L6 — mode "Demobilisasi Proyek": balik alur dari "leader mengingat
	// sendiri apa yang harus dibawa pulang" jadi "centang semua yang masih tercatat di
	// proyek, HAPUS centang yang memang tidak dibawa (habis pakai/rusak/hilang, jelaskan
	// di catatan)". Reuse data yang sudah dimuat (inventoryItems, projectEquipment) — tidak
	// ada query tambahan, murni pra-isi seleksi + catatan.
	let demobilisasiMode = $state(false);
	let demobilisasiNotes = $state('');

	// Fase 3, Rencana v2 "Lifecycle Pengembalian Barang" (§6) — Tutup Massal HABIS_PAKAI:
	// item HABIS_PAKAI (per returnPolicyResolver) dengan nilai (qty*unit_price) di bawah
	// ambang boleh ditandai Terpakai sekaligus, TANPA lewat alur retur fisik ke gudang.
	let habisPakaiEligible = $state<Array<{ id: number; expense_id?: number | null; identitas_barang_id: number; material_name: string; qty: number; nilai: number }>>([]);
	let habisPakaiTotalNilai = $state(0);
	let showTutupMassalModal = $state(false);
	let tutupMassalAlasan = $state('');
	let tutupMassalPhotoFile = $state<File | null>(null);
	let tutupMassalPhotoPreview = $state<string | null>(null);
	let showTutupMassalCamera = $state(false);
	let submittingTutupMassal = $state(false);

	/** Klasifikasi item demobilisasi lewat returnPolicyResolver (query terpisah, Aturan Directus #2). */
	async function computeHabisPakaiEligible(items: typeof inventoryItems) {
		const itemIds = [...new Set(items.map((i) => i.identitas_barang_id).filter(Boolean))];
		if (!itemIds.length) { habisPakaiEligible = []; habisPakaiTotalNilai = 0; return; }

		try {
			await loadInventorySettings();
			const policyMap = getInventorySetting(RETUR_POLICY_MAP_SETTING_KEY) || {};
			const threshold = Number(getInventorySetting('inventory.retur.batch_close_threshold_idr') ?? DEFAULT_BATCH_CLOSE_THRESHOLD_IDR);

			const master = (await directus.request(
				readItems('identitas_barang' as any, {
					filter: { id: { _in: itemIds } },
					fields: ['id', 'is_borrowable', 'consumable', 'sub_category'],
					limit: -1
				})
			)) as any[];
			const masterMap = new Map(master.map((m) => [m.id, m]));

			const eligible: typeof habisPakaiEligible = [];
			for (const item of items) {
				if (!item.identitas_barang_id) continue;
				const m = masterMap.get(item.identitas_barang_id);
				if (!m) continue;
				const { policy } = resolveReturnPolicy(m, policyMap);
				const qty = Number(item.qty_remaining) || 0;
				if (qty <= 0) continue;
				const nilai = qty * (Number(item.unit_price) || 0);
				if (policy === RETURN_POLICY.HABIS_PAKAI && isEligibleForBatchClose(policy, nilai, threshold)) {
					eligible.push({ id: item.id, expense_id: item.expense_id ?? null, identitas_barang_id: item.identitas_barang_id, material_name: item.material_name, qty, nilai });
				}
			}
			habisPakaiEligible = eligible;
			habisPakaiTotalNilai = eligible.reduce((a, e) => a + e.nilai, 0);
		} catch (e) {
			console.warn('[return] gagal klasifikasi Tutup Massal Habis Pakai (diabaikan):', e);
			habisPakaiEligible = [];
			habisPakaiTotalNilai = 0;
		}
	}

	function activateDemobilisasiMode() {
		const withRemaining = inventoryItems.filter((i) => (Number(i.qty_remaining) || 0) > 0);
		selectedInventory = new Set(withRemaining.map((i) => i.id));
		for (const item of withRemaining) {
			inventoryQtyMap[item.id] = Number(item.qty_remaining) || 0;
			if (inventoryConditionMap[item.id] === undefined) inventoryConditionMap[item.id] = 'ok';
		}
		inventoryQtyMap = { ...inventoryQtyMap };
		inventoryConditionMap = { ...inventoryConditionMap };
		// Proteksi G_INV_NON_ELTAMA_RETURN_BLOCK: hanya centang alat milik Eltama, lewati alat Subcon/Customer
		selectedEquipment = new Set(
			projectEquipment
				.filter((l) => (l.ownership_type || l.equipment?.ownership_type || 'eltama') === 'eltama')
				.map((l) => l.id)
		);
		demobilisasiMode = true;
		computeHabisPakaiEligible(withRemaining);
	}

	function cancelDemobilisasiMode() {
		demobilisasiMode = false;
		selectedInventory = new Set();
		selectedEquipment = new Set();
		demobilisasiNotes = '';
		habisPakaiEligible = [];
		habisPakaiTotalNilai = 0;
	}

	async function handleTutupMassalPhotoCapture(file: File) {
		showTutupMassalCamera = false;
		try {
			const compressed = await compressPhoto(file);
			tutupMassalPhotoFile = compressed;
			if (tutupMassalPhotoPreview) URL.revokeObjectURL(tutupMassalPhotoPreview);
			tutupMassalPhotoPreview = URL.createObjectURL(compressed);
		} catch {
			alert('Gagal memproses foto. Coba lagi.');
		}
	}

	/** Kirim delta OUT-USAGE untuk semua item eligible sekaligus, lalu keluarkan dari seleksi retur fisik. */
	async function submitTutupMassalHabisPakai() {
		if (!habisPakaiEligible.length) return;
		if (!tutupMassalPhotoFile) { alert('Foto bukti wajib diisi.'); return; }
		if (!tutupMassalAlasan.trim()) { alert('Alasan wajib diisi.'); return; }
		const projectId = Number(selectedProject);
		if (!Number.isFinite(projectId)) return;

		submittingTutupMassal = true;
		try {
			const batchId = `tutup-massal-habis-pakai-${projectId}-${Date.now()}`;
			await reportUsageDeltas(
				projectId,
				null,
				batchId,
				habisPakaiEligible.map((e) => ({ expenseId: e.expense_id ?? e.id, identitasBarangId: e.identitas_barang_id, delta: e.qty }))
			);

			// Jejak audit foto+alasan (usage endpoint tidak punya field foto) — best-effort, non-fatal.
			try {
				const photoId = await uploadEvidencePhoto(tutupMassalPhotoFile, `tutup_massal_habis_pakai:project-${projectId}:${batchId}`);
				await directus.request(
					createItem('activity_log' as any, {
						module: 'packing_list',
						collection: 'project_expenses',
						record_id: batchId,
						action: 'tutup_massal_habis_pakai',
						activity_type: 'tutup_massal_habis_pakai',
						description: `TUTUP MASSAL HABIS PAKAI: ${habisPakaiEligible.length} item (Rp ${habisPakaiTotalNilai.toLocaleString('id-ID')}) ditandai Terpakai saat demobilisasi. Alasan: ${tutupMassalAlasan.trim()}. Foto: ${photoId || '-'}.`,
						actor_id: $authStore.karyawanName || 'Lapangan',
						actor_name: $authStore.karyawanName || 'Lapangan',
						actor_role: 'Lapangan',
						created_at: new Date().toISOString()
					})
				);
			} catch (logErr) {
				console.warn('[return] gagal mencatat activity log tutup massal (diabaikan):', logErr);
			}

			// Keluarkan item yang sudah ditutup dari seleksi retur fisik -- supaya tidak dobel diretur.
			const closedIds = new Set(habisPakaiEligible.map((e) => e.id));
			const nextSelected = new Set(selectedInventory);
			for (const id of closedIds) nextSelected.delete(id);
			selectedInventory = nextSelected;

			showTutupMassalModal = false;
			tutupMassalAlasan = '';
			if (tutupMassalPhotoPreview) URL.revokeObjectURL(tutupMassalPhotoPreview);
			tutupMassalPhotoPreview = null;
			tutupMassalPhotoFile = null;
			habisPakaiEligible = [];
			habisPakaiTotalNilai = 0;
			alert(`${closedIds.size} item habis pakai berhasil ditandai Terpakai.`);
		} catch (e: any) {
			alert(e?.message || 'Gagal menutup massal barang habis pakai.');
		} finally {
			submittingTutupMassal = false;
		}
	}

	let unitOptions = $state(['Kg', 'Liter', 'Pcs', 'Set', 'Batang', 'Lembar', 'Roll', 'Sak', 'Drum', 'Galon', 'Ls', 'M', 'M²', 'M³', 'Box']);

	// Fase 4 (Goods Return v3, §Fase 4, 19 Agu 2026): foto bukti WAJIB bila kondisi != 'ok' (Q6).
	// Satu instance CameraCaptureModal dipakai bergantian utk semua item lewat activePhotoKey.
	// Foto disimpan di memori (upload langsung) + IndexedDB draf (formPersist) utk ketahanan
	// tab dibunuh OS; metadata GPS/waktu ikut draf JSON karena kecil (bukan blob).
	function photoKeyForInventory(id: number) { return `inv-${id}`; }
	let itemPhotoBlob = $state<Record<string, Blob>>({});
	let itemPhotoPreview = $state<Record<string, string>>({});
	let itemPhotoMeta = $state<Record<string, { gps_lat: number | null; gps_lng: number | null; gps_accuracy: number | null; captured_at: string }>>({});
	let showCamera = $state(false);
	let activePhotoKey = $state<string | null>(null);
	let capturingPhoto = $state(false);

	// === Computed ===
	let invSelectedList = $derived(inventoryItems.filter(i => selectedInventory.has(i.id) && (inventoryQtyMap[i.id] || 0) > 0));
	let validManualItems = $derived(manualItems.filter(i => i.material_name.trim() && i.qty_returned > 0));
	
	let totalInvSelected = $derived(invSelectedList.length);
	let totalManualItems = $derived(validManualItems.length);
	let totalItems = $derived(totalInvSelected + totalManualItems);

	// Fase 3 (F1.8, Goods Return v3): draf lokal -- leader mengisi banyak item lalu tab bisa
	// dibunuh OS/koneksi lapangan putus sebelum sempat kirim. Pola sama dengan ess/reimburse.
	interface ReturnDraft {
		selectedProject: string;
		selectedInventoryIds: number[];
		inventoryQtyMap: Record<number, number>;
		inventoryNotesMap: Record<number, string>;
		inventoryConditionMap: Record<number, string>;
		inventoryReasonMap: Record<number, string>;
		manualItems: typeof manualItems;
		// Fase 4: blob foto disimpan terpisah di IndexedDB (savePhoto), draf JSON ini cuma
		// menyimpan KUNCI mana saja yang punya foto + metadata GPS/waktu (kecil, aman di JSON).
		photoKeys: string[];
		itemPhotoMeta: typeof itemPhotoMeta;
	}
	const returnPersist = createFormPersist<ReturnDraft>('packing_list_return');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function returnSnapshot(): ReturnDraft {
		return {
			selectedProject,
			selectedInventoryIds: [...selectedInventory],
			inventoryQtyMap,
			inventoryNotesMap,
			inventoryConditionMap,
			inventoryReasonMap,
			manualItems,
			photoKeys: Object.keys(itemPhotoBlob),
			itemPhotoMeta
		};
	}

	onMount(() => {
		async function init() {
			try {
				// Gagal-lunak: loadInventorySettings tidak melempar, getInventorySetting jatuh ke default.
				await loadInventorySettings();
				returPenerbit = getInventorySetting('inventory.retur.penerbit_surat_jalan') === 'lapangan' ? 'lapangan' : 'inventory';

				let projResult: any[];
				projResult = await getProjectsForCurrentUser(true);
				projects = projResult || [];

				// Fase 5 (§3.2 Rekomendasi #2, "1-Klik Auto-Draft Retur Barang Menganggur"): deep-link
				// dari halaman Barang Menganggur/Saldo Stok bawa ?projectId=&preselect=<identitas_barang_id,...>
				// supaya proyek & item yang sudah >90% progress + masih ada stok langsung tercentang,
				// tinggal ditinjau & dilengkapi kondisi/foto sebelum kirim (bukan auto-submit).
				const urlProjectId = $page.url.searchParams.get('projectId');
				const urlPreselect = $page.url.searchParams.get('preselect');
				const hasUrlIntent = !!urlProjectId && projects.some((p) => String(p.id) === urlProjectId);

				if (hasUrlIntent) {
					selectedProject = urlProjectId as string;
					await loadInventoryItems(Number(selectedProject));
					await loadProjectEquipment(Number(selectedProject));
					if (urlPreselect) {
						const preselectIds = new Set(
							urlPreselect.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
						);
						const matched = inventoryItems.filter((i) => preselectIds.has(Number(i.identitas_barang_id)));
						selectedInventory = new Set(matched.map((i) => i.id));
						autoDraftItemCount = matched.length;
					}
				} else if (projects.length > 0) {
					selectedProject = String(projects[0].id);
					await loadInventoryItems(Number(selectedProject));
					await loadProjectEquipment(Number(selectedProject));
				}

				// Draf tersimpan TIDAK dipulihkan saat datang dari deep-link auto-draft di atas —
				// niat eksplisit tombol "Buat Draft Retur" (mungkin proyek berbeda) lebih diutamakan.
				const draft = hasUrlIntent ? null : returnPersist.restore();
				if (draft) {
					if (draft.selectedProject && projects.some((p) => String(p.id) === draft.selectedProject) && draft.selectedProject !== selectedProject) {
						selectedProject = draft.selectedProject;
						await loadInventoryItems(Number(selectedProject));
						await loadProjectEquipment(Number(selectedProject));
					}
					const validIds = new Set(inventoryItems.map((i) => i.id));
					selectedInventory = new Set((draft.selectedInventoryIds || []).filter((id) => validIds.has(id)));
					inventoryQtyMap = { ...inventoryQtyMap, ...(draft.inventoryQtyMap || {}) };
					inventoryNotesMap = { ...(draft.inventoryNotesMap || {}) };
					inventoryConditionMap = { ...inventoryConditionMap, ...(draft.inventoryConditionMap || {}) };
					inventoryReasonMap = { ...inventoryReasonMap, ...(draft.inventoryReasonMap || {}) };
					manualItems = draft.manualItems || [];
					manualItemSeq = manualItems.reduce((max, it) => {
						const n = parseInt((it._key || '').replace('manual-', ''), 10);
						return Number.isFinite(n) && n > max ? n : max;
					}, 0);
					itemPhotoMeta = { ...(draft.itemPhotoMeta || {}) };
					for (const key of draft.photoKeys || []) {
						const blob = await returnPersist.restorePhoto(key);
						if (blob) {
							itemPhotoBlob = { ...itemPhotoBlob, [key]: blob };
							itemPhotoPreview = { ...itemPhotoPreview, [key]: URL.createObjectURL(blob) };
						}
					}
					draftSavedAt = new Date();
				}
			} catch (e) {
				console.error('Gagal memuat proyek:', e);
			} finally {
				loading = false;
				draftArmed = true;
			}
		}
		init();
		return () => unsubAuth();
	});

	// Autosave -- baru aktif setelah draf lama sempat dipulihkan (draftArmed), biar tidak
	// langsung menimpanya dengan state kosong sebelum restore selesai.
	$effect(() => {
		void returnSnapshot();
		if (!draftArmed) return;
		returnPersist.save(returnSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(returnPersist, returnSnapshot));

	async function loadInventoryItems(projectId: number) {
		loadingItems = true;
		selectedInventory = new Set();
		inventoryQtyMap = {};
		inventoryNotesMap = {};
		inventoryConditionMap = {};
		inventoryReasonMap = {};
		searchQuery = '';
		
		try {
			const terpadu = await getProjectInventoryTerpadu(projectId);
			// RSM-13 §4.2: barang yang sedang diajukan untuk dimutasi (belum berangkat) tidak bisa diretur — kurangi dari sisa.
			const terkunciMutasi = await getQtyTerkunci(projectId);
			inventoryItems = (terpadu.items || []).map((it: any) => {
				const l = terkunciMutasi[Number(unwrapId(it.identitas_barang_id))] || 0;
				return l > 0 ? { ...it, qty_remaining: Math.max(0, (Number(it.qty_remaining) || 0) - l), qty_terkunci_mutasi: l } : it;
			});
			inventorySumber = terpadu.sumber;
			tanpaCatatanKirim = terpadu.tanpaCatatanKirim;
			activeReturMap = await fetchActiveReturByItem(projectId);

			for (const item of inventoryItems) {
				const rem = Number(item.qty_remaining) || 0;
				const active = activeReturMap[Number(unwrapId(item.identitas_barang_id))]?.qty || 0;
				// qty awal = sisa dikurangi yang sedang diretur; bila habis, item dikunci (lihat blockedInfo).
				if (rem - active > 0) {
					inventoryQtyMap[item.id] = rem - active;
				}
			}
		} catch (e) {
			console.error('Gagal memuat item inventory:', e);
			inventoryItems = [];
		} finally {
			loadingItems = false;
		}
	}

	// Fase 5: status pengembalian proyek terpilih (stepper). Gagal-lunak: tidak boleh mengganggu form pengajuan.
	let returTracking = $state<ReturTracking[]>([]);
	let loadingTracking = $state(false);
	let trackingSeq = 0;
	let trackingReload = $state(0);
	$effect(() => {
		trackingReload; // dependensi: dinaikkan setelah konfirmasi berangkat
		const pid = Number(selectedProject);
		if (!pid) { returTracking = []; return; }
		const seq = ++trackingSeq;
		loadingTracking = true;
		fetchReturTracking(pid)
			.then((r) => { if (seq === trackingSeq) returTracking = r; })
			.catch((e) => { console.warn('[return] stepper gagal dimuat:', e); if (seq === trackingSeq) returTracking = []; })
			.finally(() => { if (seq === trackingSeq) loadingTracking = false; });
	});

	async function handleProjectChange() {
		if (selectedProject) {
			await loadInventoryItems(Number(selectedProject));
			await loadProjectEquipment(Number(selectedProject));
		}
	}

	function toggleInventory(id: number) {
		const target = inventoryItems.find((i) => i.id === id);
		if (target && blockedInfo(target) && !selectedInventory.has(id)) return;
		const s = new Set(selectedInventory);
		if (s.has(id)) {
			s.delete(id);
		} else {
			s.add(id);
			if (inventoryQtyMap[id] === undefined) {
				const item = inventoryItems.find(i => i.id === id);
				if (item) inventoryQtyMap[id] = Math.max(0, (Number(item.qty_remaining) || 0) - (activeReturMap[Number(unwrapId(item.identitas_barang_id))]?.qty || 0));
			}
			if (inventoryConditionMap[id] === undefined) {
				inventoryConditionMap = { ...inventoryConditionMap, [id]: 'ok' };
			}
		}
		selectedInventory = s;
	}

	function toggleAllInventory() {
		const selectable = filteredInventory.filter((i) => !blockedInfo(i));
		if (selectedInventory.size === selectable.length && selectable.length > 0) {
			selectedInventory = new Set();
		} else {
			selectedInventory = new Set(selectable.map(i => i.id));
			selectable.forEach(item => {
				if (inventoryQtyMap[item.id] === undefined) {
					inventoryQtyMap[item.id] = Math.max(0, (Number(item.qty_remaining) || 0) - (activeReturMap[Number(unwrapId(item.identitas_barang_id))]?.qty || 0));
				}
				if (inventoryConditionMap[item.id] === undefined) {
					inventoryConditionMap[item.id] = 'ok';
				}
			});
		}
	}

	function setInvQty(id: number, val: number) {
		const m = { ...inventoryQtyMap };
		if (val >= 0) m[id] = val; else delete m[id];
		inventoryQtyMap = m;
	}

	function setInvNotes(id: number, val: string) {
		const m = { ...inventoryNotesMap };
		m[id] = val;
		inventoryNotesMap = m;
	}

	function setInvCondition(id: number, val: string) {
		inventoryConditionMap = { ...inventoryConditionMap, [id]: val };
	}

	function setInvReason(id: number, val: string) {
		inventoryReasonMap = { ...inventoryReasonMap, [id]: val };
	}

	function addManualItem() {
		manualItemSeq += 1;
		manualItems = [...manualItems, { _key: `manual-${manualItemSeq}`, material_name: '', material_color: '', qty_returned: 1, unit: '', leader_notes: '', condition: 'ok', reason_code: '', item_id: null, item_label: '' }];
	}

	function removeManualItem(index: number) {
		const removed = manualItems[index];
		manualItems = manualItems.filter((_, i) => i !== index);
		if (removed) removePhoto(removed._key);
	}

	function openCameraFor(key: string) {
		activePhotoKey = key;
		showCamera = true;
	}

	async function handlePhotoCapture(file: File) {
		showCamera = false;
		const key = activePhotoKey;
		activePhotoKey = null;
		if (!key) return;
		capturingPhoto = true;
		try {
			let gps: DevicePosition | null = null;
			try { gps = await getCurrentPosition(); } catch { /* opsional -- tidak menghalangi foto */ }
			const compressed = await compressPhoto(file);
			const watermarked = await watermarkPhoto(compressed, gps, new Date().toISOString());
			await returnPersist.savePhoto(key, watermarked);
			itemPhotoBlob = { ...itemPhotoBlob, [key]: watermarked };
			itemPhotoPreview = { ...itemPhotoPreview, [key]: URL.createObjectURL(watermarked) };
			itemPhotoMeta = {
				...itemPhotoMeta,
				[key]: { gps_lat: gps?.lat ?? null, gps_lng: gps?.lng ?? null, gps_accuracy: gps?.accuracy ?? null, captured_at: new Date().toISOString() }
			};
		} catch (e) {
			alert('Gagal memproses foto. Coba lagi.');
		} finally {
			capturingPhoto = false;
		}
	}

	function removePhoto(key: string) {
		returnPersist.clearPhoto(key);
		if (itemPhotoPreview[key]) URL.revokeObjectURL(itemPhotoPreview[key]);
		const b = { ...itemPhotoBlob }; delete b[key]; itemPhotoBlob = b;
		const p = { ...itemPhotoPreview }; delete p[key]; itemPhotoPreview = p;
		const m = { ...itemPhotoMeta }; delete m[key]; itemPhotoMeta = m;
	}

	// Fase 3 (Goods Return v3, §4.3): bangun daftar item siap kirim SEKALIGUS validasi lewat
	// packingListReturnItemSchema (kondisi wajib, catatan >=20 karakter bila kondisi != ok,
	// qty > 0). Dipisah dari processSubmit supaya handleKirimClick bisa menolak SEBELUM modal
	// konfirmasi terbuka -- jangan sampai user melihat "Oke, Kirim" untuk data yang bakal ditolak.
	// Fase 4: juga mengembalikan photoKeys sejajar 1:1 dengan `items`, dipakai processSubmit
	// untuk menautkan foto ke baris packing_returns yang baru dibuat.
	function buildItemsToSubmit(): { items: ReturnItem[]; photoKeys: (string | null)[]; error: string | null } {
		const items: ReturnItem[] = [];
		const photoKeys: (string | null)[] = [];

		for (const item of invSelectedList) {
			const qty = inventoryQtyMap[item.id] || 0;
			const rem = Number(item.qty_remaining) || 0;
			// F1.8: dulu cuma dijaga atribut `max` di <input> (tidak menolak nilai program/ketik).
			// Gate eksplisit di sini, sama pola dengan Fase 0 ReceiveFromPOModal (erp-epi-1).
			if (rem > 0 && qty > rem) {
				return { items: [], photoKeys: [], error: `Qty "${item.material_name || item.description}" melebihi sisa tersedia (${rem}).` };
			}
			const cond = inventoryConditionMap[item.id] || 'ok';
			const key = photoKeyForInventory(item.id);
			if (cond !== 'ok' && !itemPhotoBlob[key]) {
				return { items: [], photoKeys: [], error: `"${item.material_name || item.description}": wajib 1 foto bukti untuk kondisi selain OK/Layak Pakai.` };
			}
			const candidate: ReturnItem = {
				material_name: item.material_name || item.description || 'Barang Terkirim',
				material_color: item.material_color || undefined,
				qty_returned: qty,
				unit: item.unit || 'Ls',
				condition: cond as ReturnItem['condition'],
				leader_notes: inventoryNotesMap[item.id] || undefined,
				reason_code: inventoryReasonMap[item.id] || undefined,
				// 4-Gate Retur Gudang v2 Fase 2 (A1): project_expenses baris "Barang Terkirim"
				// sudah membawa identitas_barang_id — teruskan ke packing_returns.item_id.
				item_id: unwrapId(item.identitas_barang_id)
			};
			const err = validateReturnItem({ ...candidate, leader_notes: candidate.leader_notes || '' });
			if (err) return { items: [], photoKeys: [], error: `"${candidate.material_name}": ${err}` };
			items.push(candidate);
			photoKeys.push(cond !== 'ok' ? key : null);
		}

		for (const item of validManualItems) {
			// Q3 (saldo ledger proyek belum ada utk sebagian besar proyek): item manual tidak
			// punya referensi qty_remaining sama sekali -- diizinkan (bukan ditolak), tapi
			// ditandai di UI (lihat catatan kuning di bawah form manual) sesuai rekomendasi Q3.
			if (item.condition !== 'ok' && !itemPhotoBlob[item._key]) {
				return { items: [], photoKeys: [], error: `"${item.material_name || 'Barang manual'}": wajib 1 foto bukti untuk kondisi selain OK/Layak Pakai.` };
			}
			// 4-Gate Retur Gudang v2 Fase 2 (A1): item baru WAJIB tertaut master katalog —
			// tanpa item_id retur tidak bisa masuk ledger/stok & rekonsiliasi proyek meleset.
			if (!String(item.unit || '').trim()) {
				return { items: [], photoKeys: [], error: `"${item.material_name || 'Barang manual'}": pilih satuan dulu (otomatis terisi bila memilih barang dari master katalog).` };
			}
			if (!item.item_id) {
				return { items: [], photoKeys: [], error: `"${item.material_name || 'Barang manual'}": pilih barang dari daftar master katalog dulu (kolom "Tautkan ke barang master").` };
			}
			const candidate: ReturnItem = {
				material_name: item.material_name,
				material_color: item.material_color || undefined,
				qty_returned: item.qty_returned,
				unit: item.unit,
				condition: item.condition as ReturnItem['condition'],
				// RSM-05 §4.4: proyek tanpa catatan kirim -> baris ditandai agar Admin Inventory menelusuri asal barang.
				leader_notes: tanpaCatatanKirim ? `[tanpa catatan kirim] ${item.leader_notes || ''}`.trim() : item.leader_notes || undefined,
				reason_code: item.reason_code || undefined,
				item_id: item.item_id
			};
			const err = validateReturnItem({ ...candidate, leader_notes: candidate.leader_notes || '' });
			if (err) return { items: [], photoKeys: [], error: `"${candidate.material_name || 'Barang manual'}": ${err}` };
			items.push(candidate);
			photoKeys.push(item.condition !== 'ok' ? item._key : null);
		}

		return { items, photoKeys, error: null };
	}

	function handleKirimClick() {
		if (!selectedProject) {
			alert('Pilih proyek terlebih dahulu.');
			return;
		}
		if (totalItems === 0 && selectedEquipment.size === 0) {
			alert('Pilih minimal 1 barang (Qty > 0) atau 1 alat yang dikembalikan.');
			return;
		}
		const { error } = buildItemsToSubmit();
		if (error) {
			alert(error);
			return;
		}
		showConfirmModal = true;
	}

	async function processSubmit() {
		try {
			submitting = true;
			const { items: itemsToSubmit, photoKeys, error } = buildItemsToSubmit();
			if (error) {
				alert(error);
				submitting = false;
				return;
			}

			// RSM-02/03: SATU request server (baris + dokumen) yang idempoten lewat clientSubmissionId.
			// Dulu: baris dibuat langsung dari browser lalu dokumen di request terpisah -> bila yang kedua
			// gagal, baris sudah tersimpan tetapi leader disuruh "ulangi" (40 baris dobel). Sekarang server
			// me-rollback baris bila dokumen gagal dibuat, sehingga mencoba lagi selalu aman.
			const equipmentIds = [...selectedEquipment];
			let overrideReason: string | null = null;
			let result: Awaited<ReturnType<typeof submitReturPengajuan>> | null = null;
			for (let attempt = 0; attempt < 2 && !result; attempt++) {
				try {
					result = await submitReturPengajuan(Number(selectedProject), itemsToSubmit, {
						clientSubmissionId,
						equipmentLoanIds: equipmentIds,
						overrideReason,
						driverName: driverName.trim() || null,
						driverPhone: driverPhone.trim() || null,
						vehiclePlate: vehiclePlate.trim() || null,
						expeditionName: expeditionName.trim() || null,
						notes: demobilisasiMode ? (demobilisasiNotes.trim() || null) : null
					});
				} catch (e) {
					// Gate G_RTN_DOBEL mode soft: boleh lanjut dengan alasan tertulis (>= 20 karakter).
					if (attempt === 0 && e instanceof ReturSubmitClientError && e.code === 'RTN_DOBEL' && /isi alasan/i.test(e.message)) {
						const alasan = window.prompt(`${e.message}\n\nAlasan mengajukan lagi (minimal 20 karakter):`) || '';
						if (alasan.trim().length < 20) {
							alert('Pengajuan dibatalkan. Cek Status Pengembalian di atas untuk melihat pengajuan sebelumnya.');
							return;
						}
						overrideReason = alasan.trim();
						continue;
					}
					throw e;
				}
			}
			if (!result) throw new Error('Pengajuan tidak berhasil diproses');
			const returDoc = result.doc;
			const createdRows = result.rowIds.map((id) => ({ id }));

			// Fase 4: unggah foto bukti best-effort SETELAH retur tersimpan -- kegagalan upload
			// tidak boleh menghilangkan retur yang datanya sudah masuk. allSettled, bukan
			// Promise.all, supaya satu foto gagal tidak menggagalkan foto lain.
			let photoFailCount = 0;
			if (createdRows.length > 0 && !result.idempotent) {
				const uploads = createdRows.map((row, i) => {
					const key = photoKeys[i];
					if (!key || !itemPhotoBlob[key]) return Promise.resolve(true);
					const meta = itemPhotoMeta[key];
					return createReturnEvidencePhoto({
						returnId: row.id,
						file: itemPhotoBlob[key],
						uploadedBy: currentKaryawanName || 'Leader',
						gpsLat: meta?.gps_lat,
						gpsLng: meta?.gps_lng,
						gpsAccuracy: meta?.gps_accuracy,
						capturedAt: meta?.captured_at
					});
				});
				const results = await Promise.allSettled(uploads);
				photoFailCount = results.filter((r) => r.status === 'rejected' || r.value === false).length;
			}

			showConfirmModal = false;
			returnPersist.clear();
			await returnPersist.clearPhotos();
			resetSubmissionId();
			demobilisasiMode = false;
			demobilisasiNotes = '';

			const fotoGagal = photoFailCount > 0 ? `\n\n⚠️ ${photoFailCount} foto bukti gagal diunggah -- data retur tetap tersimpan.` : '';
			if (returDoc?.id && returDoc.status === 'dikirim') {
				// Penerbit 'lapangan': dokumen langsung dikirim -- buka halaman cetak untuk dititipkan ke sopir.
				const parts = [];
				if (returDoc.linked) parts.push(`${returDoc.linked} barang`);
				if (returDoc.linkedEquipment) parts.push(`${returDoc.linkedEquipment} alat`);
				alert(
					`Dokumen retur ${returDoc.nomor_retur} dibuat (${parts.join(', ') || 'kosong'}) ✓` + fotoGagal +
					`\n\nHalaman cetak akan dibuka — titipkan ke sopir untuk dipindai satpam & gudang.`
				);
				goto(`/packing-list/return/cetak/${returDoc.id}`);
			} else if (returDoc?.id) {
				// RSM-02 §4.7: leader langsung memegang NOMOR RTN. Disalin otomatis ke clipboard (best-effort).
				try { await navigator.clipboard?.writeText(returDoc.nomor_retur); } catch { /* opsional */ }
				const parts = [];
				if (returDoc.linked) parts.push(`${returDoc.linked} barang`);
				if (returDoc.linkedEquipment) parts.push(`${returDoc.linkedEquipment} alat`);
				alert(
					`Pengajuan retur terkirim (${parts.join(', ') || 'kosong'}) ✓` +
					`\n\nNOMOR PENGAJUAN: ${returDoc.nomor_retur}` +
					`\n(sudah disalin — simpan/kirim ke grup proyek)` +
					`\n\nTim Inventory akan menjadwalkan jemput; statusnya bisa dilihat di "Status Pengembalian" pada halaman ini. ` +
					`Jangan ajukan ulang barang yang sama.` + fotoGagal
				);
				goto('/packing-list');
			} else {
				alert(`Pengajuan retur tersimpan (${totalItems} item) ✓` + fotoGagal);
				goto('/packing-list');
			}
		} catch (e) {
			// Pesan asli server ditampilkan (RSM-02 §4.6). Draf form & foto TIDAK dihapus -- aman dicoba lagi,
			// clientSubmissionId yang sama mencegah dobel.
			const msg = e instanceof Error && e.message ? e.message : 'Gagal mengirim pengajuan return packing list.';
			alert(`${msg}\n\nData form masih tersimpan. Bila jaringan putus, jangan kirim ulang di perangkat lain — tekan Kirim lagi di sini.`);
		} finally {
			submitting = false;
		}
	}

	function getProjectName(id: string) {
		return projects.find(p => String(p.id) === id)?.name || `Proyek ID-${id}`;
	}
</script>

<div class="flex-1 flex flex-col h-full">
	<div class="px-4 pt-4 max-w-4xl mx-auto w-full">
		<button
			type="button"
			onclick={() => goto('/packing-list')}
			class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
		>
			<IconArrowLeft size={16} />
			<span>Kembali ke Packing List</span>
		</button>
		<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Pengembalian (Return) Packing List</h2>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat retur packing list..." />
		</div>
	{:else if projects.length === 0}
		<div class="flex-1 flex items-center justify-center px-6">
			<div class="text-center">
				<div class="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
					<IconPackage size={26} class="text-gray-300" />
				</div>
				<p class="text-[13px] font-medium text-gray-500">Tidak ada proyek aktif</p>
				<p class="text-[12px] text-gray-400 mt-1">Belum ada proyek yang bisa diajukan return.</p>
				<button class="mt-4 btn-primary !w-auto px-5" onclick={() => goto('/packing-list')}>
					Kembali
				</button>
			</div>
		</div>
	{:else}
		<div class="scroll-body px-4 py-3">
			<div class="mb-1"><DraftIndicator savedAt={draftSavedAt} /></div>

			<div class="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3 flex gap-2.5 items-start">
				<IconCornerUpLeft size={16} class="text-blue-400 mt-0.5 shrink-0" />
				<p class="text-[12px] text-blue-600 leading-relaxed m-0">
					Daftarkan barang sisa proyek yang akan dikembalikan ke gudang.
					Data sisa barang akan ditampilkan berdasarkan akumulasi Laporan Harian (Daily Report).
				</p>
			</div>

			{#if autoDraftItemCount != null}
				<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3 flex gap-2.5 items-start">
					<IconCheck size={16} class="text-emerald-500 mt-0.5 shrink-0" />
					<p class="text-[12px] text-emerald-700 leading-relaxed m-0">
						{#if autoDraftItemCount > 0}
							<strong>{autoDraftItemCount} item</strong> otomatis tercentang berdasarkan rekomendasi "Barang Menganggur" (proyek sudah &gt;90% progres, barang masih ada di site). Cek kembali kondisi & kuantitasnya sebelum mengirim — ini baru draf, belum terkirim.
						{:else}
							Datang dari rekomendasi "Barang Menganggur", tapi tidak ada item yang cocok untuk dicentang otomatis — silakan pilih manual di bawah.
						{/if}
					</p>
				</div>
			{/if}

			{#if selectedProject}
				<ReturnLifecycleStepper items={returTracking} loading={loadingTracking} onChanged={() => (trackingReload += 1)} />
			{/if}

			<div class="card-section">
				<h4><IconInfoCircle size={16} class="text-[var(--g)]" /> Pilih Proyek</h4>
				<div>
					<label class="f-label">Proyek</label>
					<select bind:value={selectedProject} class="f-select" onchange={handleProjectChange}>
						{#each projects as p}
							<option value={String(p.id)}>{p.name} (ID-{p.id})</option>
						{/each}
					</select>
				</div>
			</div>

			<!-- §7 rekomendasi L6 — Mode Demobilisasi Proyek. Ditempatkan sebelum daftar
			     inventory supaya leader melihat pilihannya SEBELUM mulai mencentang satu-satu. -->
			{#if selectedProject}
				<div class="card-section" style={demobilisasiMode ? 'border-color: var(--g); background: var(--gl)' : ''}>
					{#if !demobilisasiMode}
						<h4><IconCornerUpLeft size={16} class="text-[var(--g)]" /> Mode Demobilisasi Proyek</h4>
						<p class="text-[11px] text-gray-400 -mt-1 mb-3">
							Proyek selesai/pindah lokasi dan semua sisa barang &amp; alat mau dipulangkan sekaligus?
							Tombol ini men-centang <b>semua</b> yang masih tercatat di proyek ini — tinggal HAPUS centang
							yang memang tidak dibawa (habis pakai/rusak/hilang di lokasi), lalu kirim satu dokumen.
						</p>
						<button
							type="button"
							class="w-full py-2.5 rounded-xl text-[12px] font-bold border-2 border-dashed"
							style="border-color: var(--g); color: var(--gd)"
							onclick={activateDemobilisasiMode}
							disabled={loadingItems || loadingEquipment}
						>
							🏁 Aktifkan Mode Demobilisasi ({inventoryItems.filter(i => (Number(i.qty_remaining) || 0) > 0).length} barang + {projectEquipment.length} alat tercatat masih di proyek)
						</button>
					{:else}
						<div class="flex items-start justify-between gap-2 mb-2">
							<div>
								<h4 class="!mb-0"><IconCheck size={16} class="text-[var(--g)]" /> Mode Demobilisasi Aktif</h4>
								<p class="text-[11px] text-[var(--gd)] mt-0.5">
									Semua barang &amp; alat yang tercatat masih di proyek sudah tercentang di bawah.
									Hapus centang yang TIDAK dibawa pulang, lalu jelaskan alasannya di catatan ini.
								</p>
							</div>
							<button type="button" class="text-[11px] font-semibold text-gray-500 hover:underline shrink-0" onclick={cancelDemobilisasiMode}>Batalkan</button>
						</div>
						<label class="f-label">Catatan barang/alat yang TIDAK dibawa pulang (opsional)</label>
						<textarea
							class="f-input !text-[12px]"
							rows="2"
							placeholder="Contoh: 2 kaleng cat habis dipakai, 1 kuas hilang di lokasi"
							bind:value={demobilisasiNotes}
						></textarea>

						<!-- Fase 3, Rencana v2 "Lifecycle Pengembalian Barang" (§6) — Tutup Massal HABIS_PAKAI:
						     item consumable bernilai kecil ditandai Terpakai langsung, tidak perlu dikirim fisik ke gudang. -->
						{#if habisPakaiEligible.length > 0}
							<div class="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
								<p class="text-[11px] font-semibold text-amber-800 mb-1">
									🧴 {habisPakaiEligible.length} item habis pakai bernilai kecil (total Rp {habisPakaiTotalNilai.toLocaleString('id-ID')}) tidak perlu dikirim fisik — tandai langsung Terpakai?
								</p>
								<button
									type="button"
									class="w-full py-1.5 rounded-lg text-[11px] font-bold bg-amber-500 text-white"
									onclick={() => { showTutupMassalModal = true; }}
								>
									Tandai Semua sebagai Terpakai
								</button>
							</div>
						{/if}
					{/if}
				</div>
			{/if}

			<div class="card-section">
				<h4><IconPackage size={16} class="text-[var(--g)]" /> Barang yang tercatat masih di proyek ini
					<span class="cursor-help text-gray-400" title="Diambil dari catatan pengiriman dan laporan pemakaian proyek (sama dengan Saldo Barang Saya). Barang yang tidak ada di sini tetap bisa ditambahkan lewat 'Barang baru (input manual)'.">ⓘ</span>
				</h4>
				<p class="text-[11px] text-gray-400 -mt-1 mb-3">Sisa = dikirim − terpakai − diretur − hilang. Bila pemakaian belum dilaporkan di Laporan Harian, angka sisa masih tinggi.
					{#if inventorySumber === 'biaya'}<span class="text-amber-600"> (Saldo proyek belum ada — memakai catatan biaya.)</span>{/if}</p>

				{#if loadingItems}
					<div class="flex justify-center py-4">
						<IconLoader2 size={24} class="animate-spin text-[var(--g)]" />
					</div>
				{:else if inventoryItems.length === 0}
					{#if tanpaCatatanKirim}
						<div class="text-[12px] bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
							Sistem tidak punya catatan barang yang dikirim ke proyek ini. Barang yang Anda retur lewat <strong>"Barang baru (input manual)"</strong>
							akan ditandai <strong>"tanpa catatan kirim"</strong> dan diperiksa Admin Inventory dulu sebelum diterima gudang.
						</div>
					{:else}
						<div class="text-center py-4 text-gray-400 text-[12px] bg-gray-50 rounded-lg">
							Tidak ada barang bersaldo di proyek ini. Barang lain bisa ditambahkan lewat "Barang baru (input manual)".
						</div>
					{/if}
				{:else}
					<div class="relative mb-2.5">
						<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
						<input
							type="text"
							class="f-input !pl-9 !py-2 !text-[13px]"
							placeholder="Cari material..."
							bind:value={searchQuery}
						/>
					</div>

					<button
						class="w-full flex items-center gap-2 py-2 px-3 rounded-lg bg-gray-50 border border-gray-100 mb-2 cursor-pointer text-[12px] font-medium text-gray-600 transition-all hover:bg-gray-100"
						onclick={toggleAllInventory}
					>
						<div class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors
							{selectedInventory.size === filteredInventory.length && filteredInventory.length > 0 ? 'bg-[var(--g)] border-[var(--g)]' : 'border-gray-300 bg-white'}">
							{#if selectedInventory.size === filteredInventory.length && filteredInventory.length > 0}
								<IconCheck size={12} class="text-white" />
							{/if}
						</div>
						Pilih semua ({filteredInventory.length})
					</button>

					{@const data = groupedInventory()}
					<div class="space-y-3 mt-3">
						{#each data.sortedKeys as categoryKey}
							{@const items = data.groups[categoryKey]}
							<div class="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
								<div class="bg-gray-100 border-b border-gray-200 px-3 py-2 text-[11px] font-bold text-gray-700 flex justify-between items-center uppercase tracking-wider">
									<span>{categoryKey}</span>
									<span class="text-[9px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded-md">{items.length} item</span>
								</div>
								
								<div class="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
									{#each items as item}
										{@const isSelected = selectedInventory.has(item.id)}
										{@const rem = Number(item.qty_remaining) || 0}
										{@const sent = Number(item.qty) || 0}
										<div class="w-full flex flex-col p-2.5 bg-white transition-all {isSelected ? 'bg-[var(--gl)]/20' : 'hover:bg-gray-50'}">
											
											<div class="flex items-start gap-2.5 mb-2">
												<!-- svelte-ignore a11y_click_events_have_key_events -->
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<div class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer mt-0.5
													{isSelected ? 'bg-[var(--g)] border-[var(--g)]' : 'border-gray-300 bg-white hover:border-[var(--g)]'}"
													onclick={() => toggleInventory(item.id)}
												>
													{#if isSelected}
														<IconCheck size={12} class="text-white" />
													{/if}
												</div>

												<!-- svelte-ignore a11y_click_events_have_key_events -->
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<div class="flex-1 min-w-0 cursor-pointer" onclick={() => toggleInventory(item.id)}>
													<p class="text-[12px] font-semibold text-gray-800 leading-tight">
														{item.material_name || item.description || 'Item'}
														{#if item.qty_terkunci_mutasi > 0}<span class="ml-1 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700" title="Sedang diajukan untuk dimutasi ke proyek lain dan belum berangkat. Batalkan mutasinya di menu Mutasi Barang bila ingin meretur.">{item.qty_terkunci_mutasi} dikunci mutasi</span>{/if}
													</p>
													<div class="flex flex-wrap gap-1 mt-1 text-[10px]">
														{#if item.material_color}
															<span class="text-gray-500">{item.material_color}</span>
														{/if}
														<span class="text-blue-500 bg-blue-50 px-1.5 rounded border border-blue-100">Terkirim: {sent}</span>
														<span class="font-bold text-[var(--g)] bg-[var(--gl)] px-1.5 rounded border border-[var(--g)]/20" title="Sisa = dikirim ({sent}) − terpakai ({Number(item.qty_used) || 0}){item.diretur ? ` − diretur (${item.diretur})` : ''}{item.hilang ? ` − hilang (${item.hilang})` : ''}">Sisa: {rem}</span>
														{#if Number(item.qty_used) > 0}<span class="text-gray-500 bg-gray-50 px-1.5 rounded border border-gray-200">Terpakai: {Number(item.qty_used)}</span>{/if}
														{#if item.diretur}<span class="text-gray-500 bg-gray-50 px-1.5 rounded border border-gray-200">Diretur: {item.diretur}</span>{/if}
														{#if item.hilang}<span class="text-rose-600 bg-rose-50 px-1.5 rounded border border-rose-200">Hilang: {item.hilang}</span>{/if}
														{#if blockedInfo(item)}
															<span class="text-amber-700 bg-amber-50 px-1.5 rounded border border-amber-200" title="Barang ini sudah diajukan retur dan belum selesai. Buka Status Pengembalian di atas untuk melihat nomornya.">Sedang diretur{blockedInfo(item)?.docNo ? ` (${blockedInfo(item)?.docNo})` : ''}</span>
														{/if}
													</div>
												</div>
											</div>

											{#if isSelected}
												{@const cond = inventoryConditionMap[item.id] || 'ok'}
												{@const notesLen = (inventoryNotesMap[item.id] || '').trim().length}
												{@const photoKey = photoKeyForInventory(item.id)}
												<div class="pl-7 space-y-1.5 animate-in slide-in-from-top-1 duration-150">
													<div class="grid grid-cols-[80px_1fr] gap-2">
														<div class="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-gray-200 shadow-sm focus-within:border-[var(--g)] focus-within:ring-1 focus-within:ring-[var(--g)]">
															<input
																type="number"
																class="w-full text-center bg-transparent text-[13px] font-bold text-[var(--g)] outline-none px-1"
																value={inventoryQtyMap[item.id] !== undefined ? inventoryQtyMap[item.id] : ''}
																oninput={(e) => setInvQty(item.id, parseFloat((e.target as HTMLInputElement).value) || 0)}
																min="0"
																step="0.1"
																max={rem > 0 ? rem : undefined}
																placeholder="0"
															/>
															<span class="text-[10px] text-gray-500 font-medium pr-1">{item.unit || ''}</span>
														</div>
														<select
															class="w-full px-2 py-1.5 text-[11px] bg-white border border-gray-200 rounded-lg outline-none focus:border-[var(--g)]"
															value={cond}
															onchange={(e) => setInvCondition(item.id, (e.target as HTMLSelectElement).value)}
														>
															{#each RETURN_CONDITION_OPTIONS as opt}
																<option value={opt.value}>{opt.label}</option>
															{/each}
														</select>
													</div>
													{#if item.material_color}
														<select
															class="w-full px-2 py-1.5 text-[11px] bg-white border border-gray-200 rounded-lg outline-none focus:border-[var(--g)]"
															value={inventoryReasonMap[item.id] || ''}
															onchange={(e) => setInvReason(item.id, (e.target as HTMLSelectElement).value)}
														>
															<option value="">Alasan retur (opsional — khusus cat/warna)</option>
															{#each RETURN_REASON_CODE_OPTIONS as opt}
																<option value={opt.value}>{opt.label}</option>
															{/each}
														</select>
													{/if}
													<div>
														<input
															type="text"
															class="w-full px-2.5 py-1.5 text-[11px] bg-white border border-gray-200 rounded-lg outline-none focus:border-[var(--g)]"
															placeholder={cond !== 'ok' ? 'Catatan kondisi (wajib, min 20 karakter)' : 'Catatan kondisi (opsional)'}
															value={inventoryNotesMap[item.id] || ''}
															oninput={(e) => setInvNotes(item.id, (e.target as HTMLInputElement).value)}
														/>
														{#if cond !== 'ok'}
															<p class="text-[10px] mt-0.5 {notesLen < 20 ? 'text-red-500' : 'text-emerald-600'}">
																{notesLen}/20 karakter
															</p>
														{/if}
													</div>
													{#if cond !== 'ok'}
														<div class="flex items-center gap-2">
															{#if itemPhotoPreview[photoKey]}
																<img src={itemPhotoPreview[photoKey]} alt="Bukti kondisi" class="w-12 h-12 rounded-lg object-cover border border-gray-200" />
																<button type="button" class="text-[10px] font-semibold text-red-500 hover:underline" onclick={() => removePhoto(photoKey)}>Hapus foto</button>
															{:else}
																<button
																	type="button"
																	class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border {itemPhotoPreview[photoKey] ? 'border-emerald-200 text-emerald-600 bg-emerald-50' : 'border-red-200 text-red-600 bg-red-50'}"
																	onclick={() => openCameraFor(photoKey)}
																>
																	<IconCamera size={13} /> Ambil Foto (wajib)
																</button>
															{/if}
														</div>
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/each}
					</div>

					{#if selectedInventory.size > 0}
						<div class="bg-[var(--gl)] rounded-lg p-2.5 mt-2 flex justify-between items-center">
							<span class="text-[11px] text-[var(--gd)] font-medium">Dipilih dari Inventory</span>
							<span class="text-[13px] font-semibold text-[var(--gd)]">{invSelectedList.length} item valid</span>
						</div>
					{/if}
				{/if}
			</div>

			<div class="card-section">
				<h4><IconNewSection size={16} class="text-[var(--g)]" /> Tambah barang manual</h4>
				<p class="text-[11px] text-gray-400 -mt-1 mb-3">Input material sisa yang tidak ada di daftar inventory proyek.</p>
				<div class="bg-amber-50 border border-amber-100 rounded-lg p-2 mb-3 text-[11px] text-amber-700">
					⚠️ Qty barang manual tidak bisa dicek otomatis terhadap sisa stok proyek (belum ada saldo tercatat untuk item ini) — tetap diizinkan, tapi pastikan jumlahnya wajar.<br />
					Setiap barang manual <b>wajib ditautkan ke barang master</b> supaya retur ini bisa dihitung otomatis di rekonsiliasi &amp; stok proyek.
				</div>

				{#each manualItems as item, i}
					{@const notesLen = item.leader_notes.trim().length}
					<div class="border border-gray-200 rounded-xl p-3 mb-3 bg-white shadow-sm relative">
						<div class="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
							<span class="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Barang manual #{i + 1}</span>
							<button
								class="w-6 h-6 rounded flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 cursor-pointer border-none bg-transparent transition-colors"
								onclick={() => removeManualItem(i)}
							>
								<IconTrash size={14} />
							</button>
						</div>

						<!-- 4-Gate Retur Gudang v2 Fase 2 (A1): tautan master katalog WAJIB. -->
						<div class="mb-2 relative">
							<label class="text-[10px] font-semibold text-gray-500 mb-1 block">Tautkan ke barang master *</label>
							{#if item.item_id}
								<div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-800">
									<IconCheck size={13} /> <span class="flex-1 truncate">#{item.item_id} — {item.item_label}</span>
									<button type="button" class="text-[10px] font-semibold text-emerald-600 hover:underline" onclick={() => clearMaster(i)}>Ganti</button>
								</div>
							{:else}
								<div class="flex items-center gap-1.5">
									<IconSearch size={13} class="text-gray-300" />
									<input
										type="text"
										class="f-input !py-1.5 !px-2.5 !text-[12px]"
										placeholder="Ketik nama barang (min 2 huruf)…"
										value={masterQuery[item._key] || ''}
										oninput={(e) => runMasterSearch(item._key, (e.currentTarget as HTMLInputElement).value)}
									/>
									<button
										type="button"
										class="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50"
										disabled={scanBusy}
										onclick={() => openScanFor(i)}
										title="Pindai label QR barang — otomatis isi tautan master, tanpa perlu ketik nama"
									>
										<IconQrcode size={14} /> Scan
									</button>
								</div>
								{#if scanErrorByKey[item._key]}
									<p class="text-[10px] text-rose-600 mt-1">{scanErrorByKey[item._key]}</p>
								{/if}
								{#if masterSearching[item._key]}
									<p class="text-[10px] text-gray-400 mt-1">Mencari…</p>
								{:else if (masterResults[item._key] || []).length > 0}
									<ul class="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-auto">
										{#each masterResults[item._key] as row}
											<li>
												<button
													type="button"
													class="w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-emerald-50 border-none bg-transparent cursor-pointer"
													onclick={() => pickMaster(i, row)}
												>
													<span class="font-semibold text-gray-800">{row.nama_barang_lengkap}</span>
													{#if row.kode_item}<span class="text-gray-400"> · {row.kode_item}</span>{/if}
												</button>
											</li>
										{/each}
									</ul>
								{:else if (masterQuery[item._key] || '').trim().length >= 2}
									<p class="text-[10px] text-amber-600 mt-1">Tidak ada kecocokan — coba kata kunci lain.</p>
								{/if}
							{/if}
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
							<div>
								<label class="text-[10px] font-semibold text-gray-500 mb-1 block">Nama Material *</label>
								<input type="text" class="f-input !py-1.5 !px-2.5 !text-[12px]" bind:value={item.material_name} placeholder="Contoh: CAT EPOXY" />
							</div>
							<div>
								<label class="text-[10px] font-semibold text-gray-500 mb-1 block">Warna / Kode</label>
								<input type="text" class="f-input !py-1.5 !px-2.5 !text-[12px]" bind:value={item.material_color} placeholder="Opsional" />
							</div>
						</div>

						{#if item.material_color}
							<div class="mb-2">
								<label class="text-[10px] font-semibold text-gray-500 mb-1 block">Alasan Retur (opsional — khusus cat/warna)</label>
								<select bind:value={item.reason_code} class="f-select !py-1.5 !px-2.5 !text-[12px]">
									<option value="">— Pilih alasan —</option>
									{#each RETURN_REASON_CODE_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>
						{/if}

						<div class="grid grid-cols-[1fr_1fr_1.4fr] gap-2 mb-2">
							<div>
								<label class="text-[10px] font-semibold text-gray-500 mb-1 block">Qty *</label>
								<input type="number" class="f-input !py-1.5 !px-2.5 !text-[12px] font-bold" bind:value={item.qty_returned} min="0.1" step="0.1" />
							</div>
							<div>
								<label class="text-[10px] font-semibold text-gray-500 mb-1 block">Satuan</label>
								<select bind:value={item.unit} class="f-select !py-1.5 !px-2.5 !text-[12px]">
									<option value="">— pilih —</option>
									{#each unitOptions as u}
										<option>{u}</option>
									{/each}
								</select>
							</div>
							<div>
								<label class="text-[10px] font-semibold text-gray-500 mb-1 block">Kondisi *</label>
								<select bind:value={item.condition} class="f-select !py-1.5 !px-2.5 !text-[12px]">
									{#each RETURN_CONDITION_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>
						</div>

						<div class="mb-2">
							<label class="text-[10px] font-semibold text-gray-500 mb-1 block">
								Catatan Kondisi{item.condition !== 'ok' ? ' * (wajib, min 20 karakter)' : ''}
							</label>
							<input type="text" class="f-input !py-1.5 !px-2.5 !text-[12px]" bind:value={item.leader_notes} placeholder={item.condition !== 'ok' ? 'Jelaskan kondisinya, mis. penyebab rusak/hilang' : 'Opsional'} />
							{#if item.condition !== 'ok'}
								<p class="text-[10px] mt-0.5 {notesLen < 20 ? 'text-red-500' : 'text-emerald-600'}">{notesLen}/20 karakter</p>
							{/if}
						</div>

						{#if item.condition !== 'ok'}
							<div class="flex items-center gap-2">
								{#if itemPhotoPreview[item._key]}
									<img src={itemPhotoPreview[item._key]} alt="Bukti kondisi" class="w-12 h-12 rounded-lg object-cover border border-gray-200" />
									<button type="button" class="text-[10px] font-semibold text-red-500 hover:underline" onclick={() => removePhoto(item._key)}>Hapus foto</button>
								{:else}
									<button
										type="button"
										class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-red-200 text-red-600 bg-red-50"
										onclick={() => openCameraFor(item._key)}
									>
										<IconCamera size={13} /> Ambil Foto (wajib)
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}

				<button class="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-semibold text-[12px] hover:border-[var(--g)] hover:text-[var(--g)] hover:bg-[var(--gl)]/20 transition-all cursor-pointer flex justify-center items-center gap-2"
						onclick={addManualItem}>
					<IconPlus size={14} /> Tambah barang manual
				</button>

				{#if manualItems.length > 0 && totalManualItems > 0}
					<div class="bg-[var(--gl)] rounded-lg p-2.5 mt-2 flex justify-between items-center">
						<span class="text-[11px] text-[var(--gd)] font-medium">Total barang manual</span>
						<span class="text-[13px] font-semibold text-[var(--gd)]">{totalManualItems} item valid</span>
					</div>
				{/if}
			</div>

			<!-- §7 rekomendasi L4 — satu dokumen retur bisa membawa material DAN alat sekaligus,
			     sesuai realitas demobilisasi (satu truk, satu kali kirim). -->
			{#if projectEquipment.length > 0 || loadingEquipment}
				<div class="card-section">
					<h4><IconNewSection size={16} class="text-[var(--g)]" /> Alat yang ikut dikembalikan</h4>
					<p class="text-[11px] text-gray-400 -mt-1 mb-3">
						Opsional. Centang alat proyek ini yang naik di kendaraan yang sama — jadi satu dokumen retur dengan barang di atas,
						tak perlu bikin dokumen terpisah. Alat yang tidak dicentang tetap tercatat keluar seperti biasa.
					</p>
					{#if loadingEquipment}
						<p class="text-[11px] text-gray-400 py-2">Memuat alat proyek…</p>
					{:else}
						<div class="space-y-1.5">
							{#each projectEquipment as loan}
								{@const isNonEltama = (loan.ownership_type || loan.equipment?.ownership_type || 'eltama') !== 'eltama'}
								{@const ownerType = loan.ownership_type || loan.equipment?.ownership_type || 'eltama'}
								{@const ownerName = loan.owner_name || loan.equipment?.owner_name || ''}
								<label
									class="flex items-start gap-2.5 px-3 py-2 rounded-xl border transition-all text-[12px] {isNonEltama
										? 'border-amber-200 bg-amber-50/60 cursor-not-allowed'
										: 'border-gray-200 hover:bg-gray-50 cursor-pointer'}"
								>
									{#if isNonEltama}
										<input type="checkbox" disabled checked={false} class="mt-0.5 cursor-not-allowed opacity-50" />
									{:else}
										<input type="checkbox" checked={selectedEquipment.has(loan.id)} onchange={() => toggleEquipment(loan.id)} class="mt-0.5" />
									{/if}
									<div class="flex-1 min-w-0 space-y-0.5">
										<div class="flex items-center gap-1.5 flex-wrap">
											<span class="font-medium text-gray-800 truncate">{loan.equipment?.name || loan.equipment?.code || `Alat #${loan.id.slice(0, 8)}`}</span>
											{#if ownerType === 'subcon'}
												<span class="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300">
													👷 Subcon: {ownerName || 'Subcon'}
												</span>
											{:else if ownerType === 'customer'}
												<span class="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-purple-100 text-purple-800 border border-purple-300">
													🤝 Customer: {ownerName || 'Customer'}
												</span>
											{:else if ownerType === 'sewa_vendor'}
												<span class="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-orange-100 text-orange-800 border border-orange-300">
													🔶 Sewa Vendor
												</span>
											{/if}
										</div>
										{#if isNonEltama}
											<p class="text-[10px] text-amber-800 font-medium">
												⚠️ Gate <code>G_INV_NON_ELTAMA</code>: Alat milik {ownerType === 'subcon' ? `Subcon (${ownerName || 'Primantara'})` : 'Customer'} dilarang diretur ke Gudang Eltama. Serahkan langsung di site.
											</p>
										{/if}
									</div>
									{#if loan.end_date_planned}<span class="text-gray-400 text-[10px] shrink-0">tempo {loan.end_date_planned}</span>{/if}
								</label>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			{#if (totalItems > 0 || selectedEquipment.size > 0) && returPenerbit === 'inventory'}
				<div class="card-section">
					<h4><IconSend size={16} class="text-[var(--g)]" /> Penjemputan oleh tim Inventory</h4>
					<p class="text-[11.5px] text-gray-500 -mt-1">
						Cukup kirim pengajuan ini. Tim Inventory yang menerbitkan <strong>surat jalan</strong> dan mengirim sopir
						untuk menjemput barang — tidak perlu mengisi data sopir atau mencetak dokumen di sini.
						Saat sopir tiba, cocokkan barang dengan surat jalan yang dibawanya, lalu tanda tangani.
					</p>
				</div>
			{/if}

			{#if totalItems > 0 || selectedEquipment.size > 0}
				{#if returPenerbit === 'lapangan'}
				<div class="card-section">
					<h4><IconSend size={16} class="text-[var(--g)]" /> Data pengiriman dokumen retur</h4>
					<p class="text-[11px] text-gray-400 -mt-1 mb-3">
						Satu dokumen retur = satu kali kirim. Isi data sopir/kendaraan yang membawa barang ini —
						nanti tercetak di dokumen yang dipindai satpam &amp; gudang. Boleh dikosongkan bila belum tahu.
					</p>
					<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
						<div>
							<label class="text-[10px] font-semibold text-gray-500 mb-1 block">Nama sopir</label>
							<input type="text" class="f-input !py-1.5 !px-2.5 !text-[12px]" bind:value={driverName} placeholder="Opsional" />
						</div>
						<div>
							<label class="text-[10px] font-semibold text-gray-500 mb-1 block">No. HP sopir</label>
							<input type="tel" class="f-input !py-1.5 !px-2.5 !text-[12px]" bind:value={driverPhone} placeholder="Opsional" />
						</div>
						<div>
							<label class="text-[10px] font-semibold text-gray-500 mb-1 block">Plat kendaraan</label>
							<input type="text" class="f-input !py-1.5 !px-2.5 !text-[12px]" bind:value={vehiclePlate} placeholder="Opsional" />
						</div>
						<div>
							<label class="text-[10px] font-semibold text-gray-500 mb-1 block">Ekspedisi</label>
							<input type="text" class="f-input !py-1.5 !px-2.5 !text-[12px]" bind:value={expeditionName} placeholder="Opsional" />
						</div>
					</div>
				</div>
				{/if}

				<div class="bg-gradient-to-br from-[var(--gl)] to-white rounded-xl p-4 border border-[var(--g)]/15 mb-3">
					<div class="flex justify-between items-center">
						<div>
							<p class="text-[13px] font-semibold text-[var(--gd)]">Total return diajukan</p>
							<p class="text-[11px] text-[var(--g)] mt-0.5">
								{totalInvSelected > 0 ? `${totalInvSelected} dari Inventory` : ''}
								{totalInvSelected > 0 && totalManualItems > 0 ? ' + ' : ''}
								{totalManualItems > 0 ? `${totalManualItems} barang manual` : ''}
								{(totalInvSelected > 0 || totalManualItems > 0) && selectedEquipment.size > 0 ? ' + ' : ''}
								{selectedEquipment.size > 0 ? `${selectedEquipment.size} alat` : ''}
							</p>
						</div>
						<strong class="text-[20px] font-semibold text-[var(--gd)]">{totalItems} item{selectedEquipment.size > 0 ? ` + ${selectedEquipment.size} alat` : ''}</strong>
					</div>
				</div>
			{/if}
			
			<div class="h-4"></div>
		</div>

		<div class="bottom-bar shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
			<button
				class="btn-primary"
				onclick={handleKirimClick}
				disabled={submitting || (totalItems === 0 && selectedEquipment.size === 0)}
			>
				<IconSend size={16} /> Kirim Return ({totalItems} item)
			</button>
		</div>
	{/if}

	{#if showConfirmModal}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onclick={() => showConfirmModal = false}>
			<div class="bg-white rounded-2xl w-full max-w-md shadow-xl flex flex-col overflow-hidden max-h-[85vh] animate-in fade-in zoom-in-95 duration-200" onclick={(e) => e.stopPropagation()}>
				<div class="p-4 border-b border-gray-100 flex items-center gap-3 bg-white relative z-10">
					<div class="w-10 h-10 rounded-full bg-[var(--gl)]/50 flex items-center justify-center text-[var(--g)] shrink-0">
						<IconCornerUpLeft size={20} />
					</div>
					<div>
						<h3 class="text-[15px] font-bold text-gray-800 m-0 leading-tight">Konfirmasi Return</h3>
						<p class="text-[11px] text-gray-500 m-0 mt-0.5">
							{getProjectName(selectedProject)} · {totalItems} item
						</p>
					</div>
				</div>

				<div class="p-4 overflow-y-auto bg-gray-50 space-y-4">
					{#if invSelectedList.length > 0}
						<div>
							<div class="text-[11px] font-bold text-gray-400 mb-2 uppercase tracking-wider flex items-center gap-2">
								<div class="w-1 h-1 rounded-full bg-[var(--g)]"></div>
								Dari Inventory ({invSelectedList.length} item)
							</div>
							<div class="space-y-1.5">
								{#each invSelectedList as item, i}
									<div class="bg-white p-2.5 rounded-xl border border-gray-100 flex justify-between items-start shadow-sm">
										<div class="flex-1 min-w-0 pr-3">
											<div class="text-[12px] font-semibold text-gray-800 truncate">{item.material_name || item.description || 'Item'}</div>
											{#if item.material_color}
												<div class="text-[10px] text-gray-400">{item.material_color}</div>
											{/if}
											{#if inventoryNotesMap[item.id]}
												<div class="text-[10px] text-gray-400 italic mt-0.5">"{inventoryNotesMap[item.id]}"</div>
											{/if}
										</div>
										<div class="text-[13px] font-bold text-[var(--g)] shrink-0 bg-[var(--gl)]/30 px-2 py-0.5 rounded-lg border border-[var(--g)]/10">
											{inventoryQtyMap[item.id]} <span class="text-[10px] font-medium">{item.unit || ''}</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					{#if validManualItems.length > 0}
						<div>
							<div class="text-[11px] font-bold text-gray-400 mb-2 uppercase tracking-wider flex items-center gap-2">
								<div class="w-1 h-1 rounded-full bg-orange-400"></div>
								Manual ({validManualItems.length} item)
							</div>
							<div class="space-y-1.5">
								{#each validManualItems as item}
									<div class="bg-white p-2.5 rounded-xl border border-gray-100 flex justify-between items-start shadow-sm">
										<div class="flex-1 min-w-0 pr-3">
											<div class="text-[12px] font-semibold text-gray-800 truncate">{item.material_name}</div>
											{#if item.material_color}
												<div class="text-[10px] text-gray-400">{item.material_color}</div>
											{/if}
											{#if item.leader_notes}
												<div class="text-[10px] text-gray-400 italic mt-0.5">"{item.leader_notes}"</div>
											{/if}
										</div>
										<div class="text-[13px] font-bold text-orange-600 shrink-0 bg-orange-50 px-2 py-0.5 rounded-lg border border-orange-100">
											{item.qty_returned} <span class="text-[10px] font-medium">{item.unit || ''}</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<div class="p-4 border-t border-gray-100 bg-white grid grid-cols-2 gap-2.5 relative z-10">
					<button class="py-2.5 px-4 rounded-xl text-[13px] font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer border-none" onclick={() => showConfirmModal = false}>
						Batal
					</button>
					<button class="py-2.5 px-4 rounded-xl text-[13px] font-semibold text-white bg-[var(--g)] hover:bg-[var(--gd)] transition-colors flex items-center justify-center gap-2 cursor-pointer border-none disabled:opacity-50" onclick={processSubmit} disabled={submitting}>
						{#if submitting}
							<IconLoader2 size={16} class="animate-spin" /> Mengirim...
						{:else}
							<IconSend size={16} /> Oke, Kirim
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showCamera}
		<CameraCaptureModal onCapture={handlePhotoCapture} onClose={() => { showCamera = false; activePhotoKey = null; }} />
	{/if}

	{#if showTutupMassalModal}
		<div class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
			<div class="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-4 space-y-3">
				<h3 class="text-sm font-bold text-gray-800">Tutup Massal Habis Pakai</h3>
				<p class="text-[11px] text-gray-500">
					{habisPakaiEligible.length} item, total nilai Rp {habisPakaiTotalNilai.toLocaleString('id-ID')}, akan ditandai <b>Terpakai</b> (tidak perlu dikirim fisik ke gudang).
				</p>

				<div>
					<label for="tutup-massal-alasan" class="f-label">Alasan (wajib)</label>
					<textarea
						id="tutup-massal-alasan"
						class="f-input !text-[12px]"
						rows="2"
						placeholder="Contoh: sisa cat/thinner/consumable habis dipakai selama proyek berjalan"
						bind:value={tutupMassalAlasan}
					></textarea>
				</div>

				<div>
					<span class="f-label">Foto Bukti (wajib)</span>
					{#if tutupMassalPhotoPreview}
						<div class="relative">
							<img src={tutupMassalPhotoPreview} alt="Bukti tutup massal" class="w-full h-28 object-cover rounded-lg" />
							<button
								type="button"
								onclick={() => { showTutupMassalCamera = true; }}
								class="absolute bottom-1.5 right-1.5 text-[10px] px-2 py-1 rounded-lg bg-black/60 text-white font-semibold"
							>
								Ambil Ulang
							</button>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => { showTutupMassalCamera = true; }}
							class="w-full flex items-center justify-center gap-1.5 py-3 rounded-lg border border-dashed border-gray-300 text-gray-500 text-xs font-semibold"
						>
							<IconCamera size={16} /> Ambil Foto
						</button>
					{/if}
				</div>

				<div class="flex gap-2 pt-1">
					<button
						type="button"
						onclick={() => { showTutupMassalModal = false; }}
						disabled={submittingTutupMassal}
						class="flex-1 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 disabled:opacity-50"
					>
						Batal
					</button>
					<button
						type="button"
						onclick={submitTutupMassalHabisPakai}
						disabled={submittingTutupMassal}
						class="flex-1 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
					>
						{#if submittingTutupMassal}<IconLoader2 size={14} class="animate-spin" />{/if}
						Tandai Terpakai
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showTutupMassalCamera}
		<CameraCaptureModal onCapture={handleTutupMassalPhotoCapture} onClose={() => { showTutupMassalCamera = false; }} />
	{/if}

	{#if scanTargetIndex !== null}
		<QrScannerModal onDetect={onScanDetect} onClose={closeScan} expectedPrefix="EPI:ITEM:" />
	{/if}

	{#if capturingPhoto}
		<div class="fixed inset-0 z-[110] flex items-center justify-center bg-black/50">
			<div class="bg-white rounded-xl px-5 py-4 flex items-center gap-3 shadow-xl">
				<IconLoader2 size={20} class="animate-spin text-[var(--g)]" />
				<span class="text-[13px] font-medium text-gray-700">Memproses foto...</span>
			</div>
		</div>
	{/if}
</div>
