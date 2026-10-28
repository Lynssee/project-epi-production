<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { DEFAULT_UNITS, normalizeUnitLabel, type UnitDef } from '$lib/shared/unitMaster';
	import { guessPlCategory, DEFAULT_PL_CATEGORY_KEYWORDS, type PlCategoryKeywords } from '$lib/shared/plCategoryGuess';
	import { chipsForJenis, topRequested, mergeChips, type QuickChip } from '$lib/shared/plQuickItems';
	import { loadProjectSettings, getProjectSetting } from '$lib/services/projectSettings';
	import { goto } from '$app/navigation';
	import {
		IconArrowLeft, IconPackage, IconInfoCircle, IconPlus, IconCheck,
		IconLoader2, IconSend, IconTrash, IconListNumbers, IconSearch, IconNewSection, IconTemplate,
		IconBulb, IconSparkles, IconAlertTriangle
	} from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import {
		getProjectBudgetItems, submitPackingRequest, createPackingListItems, fetchKodeItemMap,
		checkStockAvailability, searchMasterCatalog, precheckPackingGate, getRequestedItemHistory, type MasterCatalogItem
	} from '$lib/services/packingList';
	import TemplateSelector from '$lib/components/packing-list/TemplateSelector.svelte';
	import GateCompletionWizard from '$lib/components/shared/GateCompletionWizard.svelte';
	import GateFixTautanBarang from '$lib/components/shared/GateFixTautanBarang.svelte';
	import PlLampiranPreviewCard from '$lib/components/packing-list/PlLampiranPreviewCard.svelte';
	import PlDisiplinBanner from '$lib/components/packing-list/PlDisiplinBanner.svelte';
	import ColorSwatchSelect from '$lib/components/packing-list/ColorSwatchSelect.svelte';
	import ColorChip from '$lib/components/packing-list/ColorChip.svelte';
	import { isPaintItem, isClearPaint, cleanColor } from '$lib/shared/paintColorUtils';
	import { fetchGateHints, applyGateHints } from '$lib/services/gateHintClient';
	import { fetchCustomerMaterialHint, type HitMaterialCustomerDto } from '$lib/services/grandPoLapangan';
	import { fetchForecastForProject, type ForecastRow } from '$lib/services/forecastKebutuhan';
	import { markForecastRequested } from '$lib/services/forecastMobilizationRequest';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import { isPlanningDerived, plannedFirst } from '$lib/shared/planningRef';
	import PlanningFieldPanels from '$lib/components/packing-list/PlanningFieldPanels.svelte';

	interface PackingListBaruDraft {
		selectedProject: string;
		newItems: Array<{
			material_name: string;
			material_color: string;
			qty: number;
			unit: string;
			unit_price: number;
			description: string;
			budget_category: string;
			forecast_id?: string;
		}>;
		selectedExistingIds: number[];
		existingQtyOverrides: Record<number, number>;
	}

	const persist = createFormPersist<PackingListBaruDraft>('packing_list_baru');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);
	let draftRestoredNotice = $state(false);

	let projects = $state<any[]>([]);
	let selectedProject = $state('');
	let loading = $state(true);
	let loadingItems = $state(false);
	let submitting = $state(false);
	let showConfirmModal = $state(false);
	// Grand PO Fase 6 (shadow): barang yang juga ada di PO material customer — hanya catatan, tidak memblokir.
	let customerMaterialHits = $state<HitMaterialCustomerDto[]>([]);

	// F0 (Audit & Hardening Gate v2, Path A) — wizard kelengkapan gate PL sisi lapangan.
	// Fase 2 (Gate Transparan & Popup Benahi Data, 16 Sep 2026): tambah onGoToField
	// (D2 — sebelumnya wizard ini tak pernah mengoper handler, tombol langkah mati)
	// + onRecheck (D6) + konten hint dari admin (gateHintClient.ts).
	let wizardOpen = $state(false);
	let wizardGates = $state<any[]>([]);
	let wizardHintsUnavailable = $state(false);

	// Fase 3 (Aksi Benahi Inline C) — popup usul tautan barang per baris project_budgets
	// yang belum tertaut (G_PKL_INVENTORY_LINK). Dipisah dari wizard supaya bisa dibuka
	// berulang tanpa menutup wizard-nya.
	let fixTautanOpen = $state(false);
	let fixTautanBudgetId = $state<number | null>(null);
	let fixTautanLabel = $state('');

	function handleWizardFixItem(gateKey: string, item: { id: number; label: string }) {
		if (gateKey === 'G_PKL_INVENTORY_LINK') {
			fixTautanBudgetId = item.id;
			fixTautanLabel = item.label;
			fixTautanOpen = true;
		}
	}

	async function handleFixTautanSuccess() {
		fixTautanOpen = false;
		await runGatePrecheck();
	}

	// gate_key -> id elemen untuk scroll-into-view (form ini satu layar, tanpa tab).
	const GATE_SCROLL_TARGET: Record<string, string> = {
		G_PKL_PROJECT: 'pkl-project-section',
		G_PKL_STOK: 'pkl-stok-section'
	};

	function goToGateSection(gateKey: string) {
		const id = GATE_SCROLL_TARGET[gateKey];
		if (!id) return;
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

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

	// === Barang yang sudah ada di RAP ===
	let existingItems = $state<any[]>([]);
	let selectedExisting = $state<Set<number>>(new Set());
	let searchQuery = $state('');
	let kodeItemMap = $state<Record<number, string>>({});
	// Fase 2: stok (info-only) & sisa alokasi RAB per item, dihitung dari qty ASLI
	// sebelum diedit leader (bind:value={item.qty} menimpa field yang sama).
	let stockMap = $state<Record<number, number>>({});

	function stockLevel(item: any): 'ok' | 'partial' | 'none' {
		const stock = stockMap[item.identitas_barang_id];
		if (stock == null) return 'partial'; // tidak terhubung ke identitas_barang, tak diketahui
		if (stock <= 0) return 'none';
		if (stock >= item.qty) return 'ok';
		return 'partial';
	}

	function overRab(item: any): boolean {
		const remaining = (item.original_qty ?? item.qty) - (item.qty_sudah_dikirim || 0);
		return item.qty > remaining + 0.0001;
	}

	let filteredExisting = $derived(
		plannedFirst(searchQuery.trim()
			? existingItems.filter(i =>
				(i.material_name || i.description || '').toLowerCase().includes(searchQuery.toLowerCase())
			)
			: existingItems)
	);

	// Paket Planning: baris RAP hasil kalkulasi Charter oleh admin (Planning Suite Fase 4).
	let plannedItems = $derived(existingItems.filter(isPlanningDerived));
	let plannedAllSelected = $derived(plannedItems.length > 0 && plannedItems.every(i => selectedExisting.has(i.id)));

	function togglePlannedPackage() {
		const s = new Set(selectedExisting);
		if (plannedAllSelected) plannedItems.forEach(i => s.delete(i.id));
		else plannedItems.forEach(i => s.add(i.id));
		selectedExisting = s;
	}

	// === Barang baru (input manual) ===
	let newItems = $state<Array<{
		material_name: string;
		material_color: string;
		qty: number;
		unit: string;
		unit_price: number;
		description: string;
		budget_category: string;
		forecast_id?: string;
		/** PRJ-26: satuan dikunci mengikuti master barang (dipilih dari katalog). */
		unit_locked?: boolean;
	}>>([]);

	const categoryNames: Record<string, string> = {
		'packing_sewa_alat': 'PERALATAN / SEWA ALAT',
		'packing_consumable': 'CONSUMABLE',
		'packing_supplier': 'MATERIAL SUPPLIER',
		'packing_safety': 'SAFETY',
		'packing_operasional': 'OPERASIONAL',
		'packing_jasa': 'JASA',
		'packing_lain_lain': 'LAIN-LAIN'
	};

	// PRJ-26: satu master satuan (sama dgn RAP) — bukan daftar sendiri.
	// Setelan (project.units / project.pl.category_keywords / project.pl.quick_items) dimuat di onMount; default di kode bila kosong/rusak.
	let unitMasterList = $state<UnitDef[]>(DEFAULT_UNITS);
	let categoryKeywords = $state<PlCategoryKeywords>(DEFAULT_PL_CATEGORY_KEYWORDS);
	let quickItemsSetting = $state<unknown>({});
	let frequentChips = $state<QuickChip[]>([]);
	const unitOptions = $derived(unitMasterList.map((u) => u.label));
	async function loadPlSettings() {
		try {
			await loadProjectSettings();
			const u = getProjectSetting('project.units');
			if (Array.isArray(u) && u.length && u.every((x: any) => x && typeof x.code === 'string' && typeof x.label === 'string')) {
				unitMasterList = u.map((x: any) => ({ code: x.code, label: x.label, aliases: Array.isArray(x.aliases) ? x.aliases : [] }));
			}
			const k = getProjectSetting('project.pl.category_keywords');
			if (k && typeof k === 'object' && !Array.isArray(k) && Object.keys(k).length) categoryKeywords = k as PlCategoryKeywords;
			quickItemsSetting = getProjectSetting('project.pl.quick_items') ?? {};
		} catch (e) {
			console.warn('[packing-list/baru] setelan PL gagal dimuat, memakai default:', e);
		}
	}

	// State Autocomplete Master Catalog
	let activeSuggestRow = $state<number | null>(null);
	let searchSuggestions = $state<MasterCatalogItem[]>([]);
	let isSearchingCatalog = $state(false);
	let searchDebounceTimer: any = null;

	// PRJ-26: chip per jenis pekerjaan (setelan) + yang paling sering diminta proyek ini.
	const selectedJenis = $derived(projects.find((p) => String(p.id) === String(selectedProject))?.jenis_project ?? null);
	const quickChips = $derived(mergeChips(frequentChips, chipsForJenis(quickItemsSetting, selectedJenis)));
	$effect(() => {
		const pid = Number(selectedProject);
		if (!pid) { frequentChips = []; return; }
		getRequestedItemHistory(pid).then((rows) => { if (Number(selectedProject) === pid) frequentChips = topRequested(rows, 5); });
	});

	function onMaterialNameInput(index: number, text: string) {
		if (!newItems[index]) return;
		newItems[index].material_name = text;
		newItems[index].unit_locked = false; // mengetik ulang nama = bukan lagi barang katalog
		activeSuggestRow = index;
		clearTimeout(searchDebounceTimer);
		if (!text || text.trim().length < 2) {
			searchSuggestions = [];
			return;
		}
		searchDebounceTimer = setTimeout(async () => {
			isSearchingCatalog = true;
			try {
				const res = await searchMasterCatalog(text);
				searchSuggestions = res || [];
			} catch (err) {
				console.warn('[searchMasterCatalog] Gagal mencari katalog master:', err);
				searchSuggestions = [];
			} finally {
				isSearchingCatalog = false;
			}
		}, 250);
	}

	function selectMasterItem(index: number, item: MasterCatalogItem) {
		if (!newItems[index]) return;
		newItems[index].material_name = item.nama_barang_lengkap;
		if (item.satuan) {
			// Satuan katalog dipetakan lewat master (Meter→M, Lbr→Lembar); tak dikenal dipakai apa adanya.
			const matchUnit = normalizeUnitLabel(item.satuan, unitMasterList);
			if (matchUnit) {
				newItems[index].unit = matchUnit;
				newItems[index].unit_locked = true; // satuan barang katalog dikunci mengikuti master (stok & RAP cocok)
			} else if (item.satuan) {
				newItems[index].unit = item.satuan;
			}
		}
		// Otomatis infer kategori dari KATA UTUH (PRJ-26) — "Catridge" tidak lagi tertebak sebagai "cat".
		const guessed = guessPlCategory(item.nama_barang_lengkap, categoryKeywords);
		if (guessed) newItems[index].budget_category = guessed;

		if (isClearPaint(item.nama_barang_lengkap) && !newItems[index].material_color) {
			newItems[index].material_color = 'Clear / Bening';
		} else if (item.kode_item && !newItems[index].material_color && !isPaintItem(item.nama_barang_lengkap, { category: newItems[index].budget_category })) {
			newItems[index].material_color = item.kode_item;
		}
		
		searchSuggestions = [];
		activeSuggestRow = null;
	}

	// === Dari Kebutuhan Timeline (Integrasi Timeline <-> PL, Fase 2) ===
	// Baris forecast berstatus 'forecast' (belum ditangani dept), bukan equipment, belum tertaut
	// dokumen apa pun. Dipilih leader lalu disalin ke daftar Barang Baru (qty bisa diedit);
	// pengiriman tetap lewat alur + gate yang sama dengan barang manual.
	let forecastRows = $state<ForecastRow[]>([]);
	let forecastSelected = $state<Set<string>>(new Set());
	let loadingForecast = $state(false);
	let forecastStageParam = $state<string | null>(null);

	const forecastAddedIds = $derived(new Set(newItems.map((i) => i.forecast_id).filter(Boolean) as string[]));
	const forecastAvailable = $derived(
		forecastRows.filter((r) => r.status === 'forecast' && r.ref_type !== 'equipment' && !r.linked_ref_id && !forecastAddedIds.has(r.id))
	);
	const forecastGroups = $derived.by(() => {
		const map = new Map<string, ForecastRow[]>();
		for (const r of forecastAvailable) {
			const key = r.mob_stage || '_none';
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(r);
		}
		return [...map.entries()].sort(([a], [b]) => (a === forecastStageParam ? -1 : b === forecastStageParam ? 1 : a.localeCompare(b)));
	});

	async function loadForecast(projectId: number) {
		loadingForecast = true;
		forecastSelected = new Set();
		try {
			forecastRows = await fetchForecastForProject(projectId);
			// Datang dari "Buat PL Fase Ini": pra-centang seluruh item tahap tsb.
			if (forecastStageParam) {
				forecastSelected = new Set(forecastAvailable.filter((r) => r.mob_stage === forecastStageParam).map((r) => r.id));
			}
		} finally {
			loadingForecast = false;
		}
	}

	function toggleForecast(id: string) {
		const s = new Set(forecastSelected);
		if (s.has(id)) s.delete(id); else s.add(id);
		forecastSelected = s;
	}

	function addForecastToList() {
		const picked = forecastAvailable.filter((r) => forecastSelected.has(r.id));
		if (picked.length === 0) return;
		newItems = [
			...newItems,
			...picked.map((r) => ({
				material_name: r.ref_name,
				material_color: '',
				qty: Number(r.qty) || 1,
				// PRJ-26: tanpa default 'Pcs'/'packing_supplier' — dari master satuan & kata utuh; tak dikenal = kosong (wajib dipilih).
				unit: normalizeUnitLabel(r.unit, unitMasterList) || '',
				unit_price: 0,
				description: `Kebutuhan timeline: ${r.subtask_name || 'subtask'}${r.mob_stage ? ` — ${r.mob_stage}` : ''}`,
				budget_category: guessPlCategory(r.ref_name, categoryKeywords) || '',
				forecast_id: r.id
			}))
		];
		forecastSelected = new Set();
	}

	function addQuickChip(chip: { name: string; category: string; unit: string }) {
		newItems = [
			...newItems,
			{
				material_name: chip.name,
				material_color: '',
				qty: 1,
				unit: chip.unit,
				unit_price: 0,
				description: 'Kebutuhan consumable operasional lapangan',
				budget_category: chip.category
			}
		];
	}

	function getDuplicateWarning(name?: string): { type: 'rap'; item: string; id: number } | null {
		if (!name || name.trim().length < 3) return null;
		const lower = name.toLowerCase().trim();
		const rapMatch = existingItems.find(r => (r.material_name || r.description || '').toLowerCase().includes(lower));
		if (rapMatch) {
			return { type: 'rap', item: rapMatch.material_name || rapMatch.description, id: rapMatch.id };
		}
		return null;
	}

	// PRJ-12: satu klik pindahkan barang baru ke barang RAP yang sama (alokasi RAP terpotong, tanpa input ganda).
	function takeFromRap(newIndex: number, rapId: number) {
		const s = new Set(selectedExisting);
		s.add(rapId);
		selectedExisting = s;
		removeNewItem(newIndex);
	}

	// === Computed ===
	let validNewItems = $derived(newItems.filter(i => (i.material_name || '').trim()));
	let totalExistingSelected = $derived(selectedExisting.size);
	let totalNewItems = $derived(validNewItems.length);
	let totalItems = $derived(totalExistingSelected + totalNewItems);

	// Menu Lampiran v2 F4 — item draf untuk pratinjau lampiran otomatis (barang baru manual tak punya master → "?").
	let lampiranPreviewItems = $derived([
		...existingItems.filter((i) => selectedExisting.has(i.id)).map((i) => ({
			item_id: i.identitas_barang_id ?? null,
			nama_barang: i.material_name || i.description || '',
			unit: i.unit || '',
			qty_required: Number(i.qty) || 0
		})),
		...validNewItems.map((i) => ({ item_id: null, nama_barang: i.material_name, unit: i.unit, qty_required: Number(i.qty) || 0 }))
	]);

	function getDraftSnapshot(): PackingListBaruDraft {
		const existingQtyOverrides: Record<number, number> = {};
		for (const item of existingItems) {
			if (item.id != null && item.original_qty != null && item.qty !== item.original_qty) {
				existingQtyOverrides[item.id] = Number(item.qty) || 0;
			}
		}
		return {
			selectedProject,
			newItems,
			selectedExistingIds: [...selectedExisting],
			existingQtyOverrides
		};
	}

	function discardDraft() {
		persist.clear();
		draftRestoredNotice = false;
		newItems = [];
		selectedExisting = new Set();
		if (selectedProject) {
			loadExistingItems(Number(selectedProject));
		}
	}

	onMount(() => {
		loadPlSettings();
		async function init() {
			try {
				let projResult: any[];
				projResult = await getProjectsForCurrentUser(true);
				projects = projResult || [];
				// Fase 5 (Pertajam Modul Ciketing & MB v2) — bug yang sama seperti
				// anggaran/baru: auto-pilih proyek pertama diam-diam. Untuk koordinator
				// workshop dengan puluhan PO, ini memuat RAP proyek yang salah tanpa
				// disadari. Placeholder memaksa pemilihan eksplisit.
			} catch (e) {
				console.error('Gagal memuat proyek:', e);
			} finally {
				loading = false;
			}
		}
		async function initFromUrlAndDraft() {
			// "Buat PL Fase Ini" dari KebutuhanFaseSheet: /packing-list/baru?project_id=X&mob_stage=Y&source=forecast
			const q = new URLSearchParams(window.location.search);
			const pid = q.get('project_id');
			const hasUrlParam = !!pid && projects.some((p) => String(p.id) === pid);

			if (hasUrlParam) {
				forecastStageParam = q.get('mob_stage');
				selectedProject = pid!;
				await handleProjectChange();
			} else {
				// Cek apakah ada draf tersimpan dari sesi sebelumnya
				const draft = persist.restore();
				if (draft) {
					if (draft.selectedProject && projects.some((p) => String(p.id) === draft.selectedProject)) {
						selectedProject = draft.selectedProject;
						await handleProjectChange();
					}
					if (draft.newItems && Array.isArray(draft.newItems) && draft.newItems.length > 0) {
						newItems = draft.newItems;
					}
					if (draft.selectedExistingIds && draft.selectedExistingIds.length > 0) {
						const validIds = new Set(existingItems.map((i) => i.id));
						selectedExisting = new Set(draft.selectedExistingIds.filter((id) => validIds.has(id)));
					}
					if (draft.existingQtyOverrides && Object.keys(draft.existingQtyOverrides).length > 0) {
						existingItems = existingItems.map((i) => {
							if (draft.existingQtyOverrides[i.id] !== undefined) {
								return { ...i, qty: draft.existingQtyOverrides[i.id] };
							}
							return i;
						});
					}
					const savedEpoch = persist.savedAt();
					draftSavedAt = savedEpoch ? new Date(savedEpoch) : new Date();
					if (newItems.length > 0 || selectedExisting.size > 0) {
						draftRestoredNotice = true;
					}
				}
			}
			draftArmed = true;
		}
		init().then(initFromUrlAndDraft);
		return () => unsubAuth();
	});

	// Autosave draf otomatis (debounced 500ms di formPersist)
	$effect(() => {
		void getDraftSnapshot();
		if (!draftArmed) return;
		persist.save(getDraftSnapshot());
		draftSavedAt = new Date();
	});

	// Trigger darurat: flush saat pagehide & visibilitychange (minimize / ganti tab / OS discard)
	$effect(() => registerFormPersistSaveTriggers(persist, getDraftSnapshot));

	async function loadExistingItems(projectId: number) {
		loadingItems = true;
		selectedExisting = new Set();
		try {
			const result = await getProjectBudgetItems(projectId);
			existingItems = (result || []).map((i: any) => ({ ...i, original_qty: i.qty }));
			kodeItemMap = await fetchKodeItemMap(existingItems.map((i: any) => i.identitas_barang_id));
			stockMap = await checkStockAvailability(existingItems.map((i: any) => i.identitas_barang_id));
		} catch (e) {
			console.error('Gagal memuat item RAB:', e);
			existingItems = [];
		} finally {
			loadingItems = false;
		}
	}

	async function handleProjectChange() {
		forecastRows = [];
		if (selectedProject) {
			await Promise.all([loadExistingItems(Number(selectedProject)), loadForecast(Number(selectedProject))]);
		}
	}

	function toggleExisting(id: number) {
		const s = new Set(selectedExisting);
		if (s.has(id)) s.delete(id); else s.add(id);
		selectedExisting = s;
	}

	function toggleAllExisting() {
		if (selectedExisting.size === filteredExisting.length && filteredExisting.length > 0) {
			selectedExisting = new Set();
		} else {
			selectedExisting = new Set(filteredExisting.map(i => i.id));
		}
	}

	function addNewItem() {
		newItems = [...newItems, { material_name: '', material_color: '', qty: 1, unit: '', unit_price: 0, description: '', budget_category: '' }];
	}

	function removeNewItem(index: number) {
		newItems = newItems.filter((_, i) => i !== index);
	}

	function formatCurrency(val: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0);
	}

	// PRJ-26 & Standarisasi Cat: validasi inline untuk satuan, kategori, & spesifikasi warna cat.
	let submitTried = $state(false);
	const rowMissing = (it: any) => ({
		unit: !String(it.unit || '').trim(),
		category: !String(it.budget_category || '').trim(),
		color: isPaintItem(it.material_name, { category: it.budget_category }) && !cleanColor(it.material_color)
	});

	function handleKirimClick() {
		submitTried = true;
		if (totalItems === 0) {
			alert('Pilih minimal 1 barang atau tambahkan barang baru.');
			return;
		}
		// Validasi satuan, kategori, & spesifikasi warna cat untuk item baru
		const bad = newItems.findIndex(
			(it) => (it.material_name || '').trim() && (rowMissing(it).unit || rowMissing(it).category || rowMissing(it).color)
		);
		if (bad !== -1) {
			document.getElementById('pl-new-' + bad)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			return;
		}
		showConfirmModal = true;
		loadCustomerMaterialHint();
	}

	async function loadCustomerMaterialHint() {
		customerMaterialHits = [];
		const pid = Number(selectedProject);
		if (!pid) return;
		const names = [
			...existingItems.filter((i) => selectedExisting.has(i.id)).map((i) => i.material_name || i.description || ''),
			...validNewItems.map((i) => i.material_name)
		].filter(Boolean);
		if (names.length) customerMaterialHits = await fetchCustomerMaterialHint(pid, names);
	}

	// F0 Path A — gerbang gate PL lapangan. Hanya G_PKL_PROJECT yang memblokir; stok
	// cuma peringatan. Server (packingListSubmit.ts / gate-precheck) tetap jadi penegak
	// authoritative — ini pra-cek agar user tahu sebelum klik. Fase 2: gate ditempeli
	// `tab` (untuk scroll target) + konten hint dari admin (checklist_items/consequence/
	// owner_role/bypass_policy) sebelum ditampilkan wizard.
	async function runGatePrecheck(): Promise<{ ok: boolean; gates: any[] }> {
		const gateItems = [
			...existingItems.filter(i => selectedExisting.has(i.id)).map(i => ({ qty: i.qty, identitas_barang_id: i.identitas_barang_id, budgetItemId: i.id })),
			...validNewItems.map(i => ({ qty: i.qty }))
		];
		const gate = await precheckPackingGate(Number(selectedProject), gateItems);
		const gatesWithTab = (gate.gates || []).map((g: any) => ({ ...g, tab: GATE_SCROLL_TARGET[g.gate_key] ? g.gate_key : undefined }));

		const hintResult = await fetchGateHints('packing_list', 'packing_list');
		wizardHintsUnavailable = !hintResult.available;
		wizardGates = applyGateHints(gatesWithTab, hintResult);

		return { ok: gate.ok, gates: wizardGates };
	}

	async function handleWizardRecheck() {
		const result = await runGatePrecheck();
		if (result.ok) wizardOpen = false;
	}

	async function processSubmit() {
		try {
			submitting = true;

			const gate = await runGatePrecheck();
			if (!gate.ok) {
				wizardOpen = true;
				showConfirmModal = false;
				submitting = false;
				return;
			}

			let success = true;
			const projectName = projects.find(p => String(p.id) === String(selectedProject))?.name;

			// 1. Submit existing items (update packing_status)
			if (selectedExisting.size > 0) {
				const itemsToSubmit = existingItems
					.filter(i => selectedExisting.has(i.id))
					.map(i => ({ id: i.id, qty: i.qty, unit_price: i.unit_price }));

				const result = await submitPackingRequest(itemsToSubmit, {
					projectName,
					requesterName: currentKaryawanName || undefined
				});
				if (!result) success = false;
			}

			// 2. Create new items
			if (validNewItems.length > 0) {
				const result = await createPackingListItems(
					Number(selectedProject),
					validNewItems,
					currentKaryawanName || 'Leader',
					projectName
				);
				if (!result) success = false;
			}

			if (success) {
				const forecastIds = validNewItems.map((i) => i.forecast_id).filter(Boolean) as string[];
				if (forecastIds.length) {
					const marked = await markForecastRequested(forecastIds, currentKaryawanName || 'Leader');
					if (!marked) console.warn('[packing-list/baru] PL terkirim tapi gagal menandai forecast — admin dapat menandai manual.');
				}
				persist.clear();
				showConfirmModal = false;

				const countRap = totalExistingSelected;
				const countNew = totalNewItems;
				const countAll = totalItems;
				const detailLines: string[] = [];
				if (countRap > 0) detailLines.push(`• RAB / RAP: ${countRap} item`);
				if (countNew > 0) detailLines.push(`• Item Tambahan Baru: ${countNew} item`);

				const msg = [
					`✓ Pengajuan Packing List Berhasil Dikirim!`,
					``,
					`Proyek: ${projectName}`,
					`Total Dikirim: ${countAll} item`,
					...(detailLines.length > 0 ? [``, `Rincian:`, ...detailLines] : []),
					``,
					`Status: Data pengajuan telah dicatat dan diteruskan ke tim Logistik & Admin untuk diproses.`
				].join('\n');

				if (typeof window !== 'undefined' && (window as any).__showToast) {
					(window as any).__showToast(`Pengajuan packing list (${countAll} item) berhasil dikirim!`, 'success');
				}

				alert(msg);
				goto('/packing-list');
			} else {
				alert('Terjadi kesalahan saat mengirim sebagian data.');
			}
		} catch (e: any) {
			console.error('[packing-list/baru] submit error:', e);
			const msg = e?.message || 'Gagal mengirim pengajuan packing list.';
			if (
				msg.includes('Pengajuan packing list belum bisa dikirim') ||
				msg.includes('gate') ||
				msg.includes('laporan harian') ||
				msg.includes('P2H') ||
				msg.includes('proyek')
			) {
				await runGatePrecheck();
				wizardOpen = true;
				showConfirmModal = false;
			} else {
				alert(msg);
			}
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex-1 flex flex-col h-full">
	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat formulir packing list..." />
		</div>
	{:else}
		<div class="scroll-body px-4 py-4 max-w-4xl mx-auto w-full">
			<div class="mb-4">
				<button
					type="button"
					onclick={() => goto('/packing-list')}
					class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
				>
					<IconArrowLeft size={16} />
					<span>Kembali ke Packing List</span>
				</button>
				<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Form Pembuatan Packing List</h2>
			</div>

			<!-- Banner Pemulihan Draf -->
			{#if draftRestoredNotice && (newItems.length > 0 || selectedExisting.size > 0)}
				<div class="mb-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 flex items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-300 animate-in fade-in duration-200">
					<div class="flex items-center gap-2">
						<IconCheck size={16} class="text-emerald-600 shrink-0" />
						<span>
							<strong>Draf isian dipulihkan:</strong> Data yang Anda input sebelumnya tersimpan aman di perangkat.
							{#if draftSavedAt}
								<span class="text-emerald-600/80 dark:text-emerald-400/80">({draftSavedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})</span>
							{/if}
						</span>
					</div>
					<button
						type="button"
						class="px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-emerald-100 cursor-pointer transition-colors shrink-0"
						onclick={discardDraft}
					>
						Buang Draf
					</button>
				</div>
			{/if}
			<!-- Pilih Project -->
			<div class="card-section" id="pkl-project-section">
				<h4><IconInfoCircle size={16} class="text-[var(--g)]" /> Pilih Proyek</h4>
				<div>
					<label class="f-label">Proyek</label>
					<select bind:value={selectedProject} class="f-select" onchange={handleProjectChange}>
						<option value="">— Pilih Proyek —</option>
						{#each projects as p}
							<option value={String(p.id)}>{p.name} (ID-{p.id})</option>
						{/each}
					</select>
				</div>
				<!-- Penajaman Gate PL: ringkasan P2H alat & laporan harian proyek (semua pengaju). -->
				<div class="mt-3"><PlDisiplinBanner projectId={selectedProject ? Number(selectedProject) : null} /></div>
			</div>

			<!-- ====== SECTION 0: Load dari Template ====== -->
			<div class="card-section">
				<h4><IconTemplate size={16} class="text-[var(--g)]" /> Load dari Template</h4>
				<p class="text-[11px] text-gray-400 -mt-1 mb-3">Muat item dari template yang sudah ada.</p>

				{#if selectedProject}
					<TemplateSelector
						projectId={Number(selectedProject)}
						onTemplateLoaded={() => loadExistingItems(Number(selectedProject))}
					/>
				{:else}
					<div class="text-center py-4 text-gray-400 text-[12px] bg-gray-50 rounded-lg">
						Pilih project terlebih dahulu untuk memuat template.
					</div>
				{/if}
			</div>

			<!-- ====== SECTION 0b: Dari Kebutuhan Timeline ====== -->
			{#if selectedProject && (loadingForecast || forecastAvailable.length > 0)}
				<div class="card-section" id="pkl-forecast-section">
					<h4><IconListNumbers size={16} class="text-[var(--g)]" /> Dari Kebutuhan Timeline</h4>
					<p class="text-[11px] text-gray-400 -mt-1 mb-3">
						Daftar barang yang sudah direncanakan admin di Timeline proyek ini. Centang yang ingin dikirim, tekan "Tambahkan ke daftar", lalu atur qty jika perlu dan ajukan seperti biasa.
					</p>
					{#if loadingForecast}
						<div class="flex justify-center py-4"><IconLoader2 size={24} class="animate-spin text-[var(--g)]" /></div>
					{:else}
						{#each forecastGroups as [stageKey, stageRows] (stageKey)}
							<div class="mb-2.5">
								<div class="text-[11px] font-bold text-gray-500 mb-1">{stageKey === '_none' ? 'Tahap belum ditentukan' : stageKey}</div>
								<div class="space-y-1.5">
									{#each stageRows as r (r.id)}
										{@const picked = forecastSelected.has(r.id)}
										<button type="button" class="w-full flex items-center gap-2.5 p-2 rounded-xl border text-left cursor-pointer transition-all {picked ? 'border-[var(--g)] bg-[var(--gl)]/30' : 'border-gray-100 bg-white hover:border-gray-200'}" onclick={() => toggleForecast(r.id)}>
											<div class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 {picked ? 'bg-[var(--g)] border-[var(--g)]' : 'border-gray-300 bg-white'}">
												{#if picked}<IconCheck size={12} class="text-white" />{/if}
											</div>
											<div class="flex-1 min-w-0">
												<div class="text-[13px] font-medium text-gray-800 truncate">{r.ref_name}</div>
												<div class="text-[10.5px] text-gray-400 truncate">{r.subtask_name || '-'}{r.need_date ? ` · butuh ${r.need_date}` : ''}</div>
											</div>
											<div class="text-[12px] text-gray-600 tabular-nums shrink-0">{r.qty} {r.unit || ''}</div>
										</button>
									{/each}
								</div>
							</div>
						{/each}
						<button type="button" class="mt-1 px-3 py-2 rounded-lg bg-[var(--g)] text-white text-[12px] font-semibold border-none cursor-pointer disabled:opacity-40" disabled={forecastSelected.size === 0} onclick={addForecastToList}>
							+ Tambahkan {forecastSelected.size || ''} item ke daftar
						</button>
					{/if}
				</div>
			{/if}

			<!-- Planning Suite Fase 8: ceklist pra-mobilisasi K3 + monitoring kuota RAP (dimuat saat dibuka) -->
			<PlanningFieldPanels projectId={selectedProject ? Number(selectedProject) : null} />

			<!-- ====== SECTION 1: Barang yang sudah ada di RAP ====== -->
			<div class="card-section" id="pkl-stok-section">
				<h4><IconPackage size={16} class="text-[var(--g)]" /> Pilih dari RAP yang ada</h4>
				<p class="text-[11px] text-gray-400 -mt-1 mb-3">Pilih material yang sudah ada di RAP proyek ini.</p>

				{#if loadingItems}
					<div class="flex justify-center py-4">
						<IconLoader2 size={24} class="animate-spin text-[var(--g)]" />
					</div>
				{:else if existingItems.length === 0}
					<div class="text-center py-4 text-gray-400 text-[12px] bg-gray-50 rounded-lg">
						Tidak ada item RAP tersedia di proyek ini.
					</div>
				{:else}
					<!-- Search -->
					<div class="relative mb-2.5">
						<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
						<input
							type="text"
							class="f-input !pl-9 !py-2 !text-[13px]"
							placeholder="Cari material..."
							bind:value={searchQuery}
						/>
					</div>

					{#if plannedItems.length > 0}
						<button
							type="button"
							class="w-full flex items-center justify-between gap-2 py-2 px-3 rounded-lg border mb-2 cursor-pointer text-left transition-all
								{plannedAllSelected ? 'border-[var(--g)] bg-[var(--gl)]/40' : 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100'}"
							onclick={togglePlannedPackage}
							title="Barang yang sudah direncanakan admin dari Project Charter. Tekan sekali untuk memilih semuanya, lalu atur qty bila perlu."
						>
							<span class="text-[12px] font-semibold text-indigo-900">
								📦 Paket Mobilisasi Awal ({plannedItems.length} barang)
								<span class="block text-[10px] font-normal text-indigo-700">Dari perencanaan admin — {plannedAllSelected ? 'tekan untuk batal pilih semua' : 'tekan untuk pilih semua'}</span>
							</span>
							<span class="text-[11px] font-bold {plannedAllSelected ? 'text-[var(--g)]' : 'text-indigo-700'}">{plannedAllSelected ? '✓ Terpilih' : 'Pilih paket'}</span>
						</button>
					{/if}

					<!-- Select all -->
					<button
						class="w-full flex items-center gap-2 py-2 px-3 rounded-lg bg-gray-50 border border-gray-100 mb-2 cursor-pointer text-[12px] font-medium text-gray-600 transition-all hover:bg-gray-100"
						onclick={toggleAllExisting}
					>
						<div class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors
							{selectedExisting.size === filteredExisting.length && filteredExisting.length > 0 ? 'bg-[var(--g)] border-[var(--g)]' : 'border-gray-300 bg-white'}">
							{#if selectedExisting.size === filteredExisting.length && filteredExisting.length > 0}
								<IconCheck size={12} class="text-white" />
							{/if}
						</div>
						Pilih semua ({filteredExisting.length})
					</button>

					<!-- Item list -->
					<div class="space-y-1.5 max-h-[250px] overflow-y-auto">
						{#each filteredExisting as item}
							{@const isSelected = selectedExisting.has(item.id)}
							{@const level = stockLevel(item)}
							<div
								class="w-full flex items-center gap-2.5 p-2 rounded-xl border transition-all
									{isSelected ? 'border-[var(--g)] bg-[var(--gl)]/30' : 'border-gray-100 bg-white hover:border-gray-200'}"
							>
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer
									{isSelected ? 'bg-[var(--g)] border-[var(--g)]' : 'border-gray-300 bg-white'}"
									onclick={() => toggleExisting(item.id)}
								>
									{#if isSelected}
										<IconCheck size={12} class="text-white" />
									{/if}
								</div>

								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="flex-1 min-w-0 cursor-pointer" onclick={() => toggleExisting(item.id)}>
									<p class="text-[12px] font-medium text-gray-800 leading-tight">
										{item.material_name || item.description || 'Item'}
										{#if kodeItemMap[item.identitas_barang_id]}<span class="text-[10px] font-mono font-bold text-emerald-600 ml-1">{kodeItemMap[item.identitas_barang_id]}</span>{/if}
										{#if isPlanningDerived(item)}<span class="ml-1 px-1.5 py-px rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-bold align-middle" title="Direncanakan admin dari Project Charter">Terencana di Planning</span>{/if}
										<span
											class="ml-1 text-[9px] align-middle"
											title={level === 'ok' ? 'Stok cukup' : level === 'partial' ? 'Stok kurang / tidak diketahui' : 'Stok kosong'}
										>{level === 'ok' ? '🟢' : level === 'partial' ? '🟡' : '🔴'}</span>
									</p>
									<p class="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
										{#if cleanColor(item.material_color)}
											<ColorChip color={cleanColor(item.material_color)} size="xs" />
											<span>·</span>
										{:else if isPaintItem(item.material_name || item.description)}
											<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold text-[9.5px]">
												⚠️ Butuh Warna
											</span>
											{#if isClearPaint(item.material_name || item.description)}
												<button
													type="button"
													class="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-700 text-[9.5px] font-bold hover:bg-emerald-100 cursor-pointer"
													onclick={(e) => { e.stopPropagation(); item.material_color = 'Clear / Bening'; }}
												>
													⚡ Set Clear
												</button>
											{/if}
											<span>·</span>
										{/if}
										<span>{formatCurrency(item.unit_price || 0)}/sat</span>
									</p>
									{#if overRab(item)}
										<p class="text-[9px] text-amber-600 font-medium mt-0.5">⚠ Melebihi sisa alokasi RAB ({(item.original_qty - (item.qty_sudah_dikirim || 0)).toLocaleString('id-ID')} {item.unit || ''} tersisa)</p>
									{/if}
								</div>

								<div class="shrink-0 flex items-center gap-1.5 bg-gray-50/50 p-1.5 rounded-lg border border-gray-100">
									<input
										type="number"
										class="w-12 text-center bg-transparent text-[13px] font-semibold text-[var(--gd)] outline-none border-b border-dashed border-gray-300 focus:border-[var(--g)] p-0"
										bind:value={item.qty}
										min="0"
										step="0.1"
										onfocus={(e) => {
											if (!isSelected) {
												selectedExisting.add(item.id);
												selectedExisting = selectedExisting;
											}
											e.currentTarget.select();
										}}
									/>
									<span class="text-[10px] text-gray-500 font-medium w-6 text-left">{item.unit || ''}</span>
								</div>
							</div>
						{/each}
					</div>

					{#if selectedExisting.size > 0}
						<div class="bg-[var(--gl)] rounded-lg p-2.5 mt-2 flex justify-between items-center">
							<span class="text-[11px] text-[var(--gd)] font-medium">Dipilih dari RAP</span>
							<span class="text-[13px] font-semibold text-[var(--gd)]">{selectedExisting.size} item</span>
						</div>
					{/if}
				{/if}
			</div>

			<!-- ====== SECTION 2: Tambah barang baru ====== -->
			<div class="card-section">
				<div class="flex items-center justify-between mb-3">
					<div>
						<h4 class="flex items-center gap-1.5"><IconNewSection size={16} class="text-[var(--g)]" /> Tambah Barang Manual (Non-RAP)</h4>
						<p class="text-[11px] text-gray-400 mt-0.5">Input material baru yang tidak tercantum di RAP proyek.</p>
					</div>
				</div>

				<!-- Guidance Banner -->
				<div class="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-xl p-3.5 mb-4">
					<div class="flex items-center gap-2 mb-2">
						<div class="w-5 h-5 rounded bg-blue-600 text-white flex items-center justify-center shrink-0">
							<IconBulb size={13} />
						</div>
						<h5 class="text-[12px] font-bold text-blue-950">Panduan Standar Penginputan Manual</h5>
					</div>
					<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-blue-900">
						<div class="bg-white/80 border border-blue-100 rounded-lg p-2 flex items-start gap-1.5">
							<span class="w-3.5 h-3.5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[9px]">1</span>
							<span><strong>Katalog Master:</strong> Ketik nama untuk memilih item resmi dari gudang.</span>
						</div>
						<div class="bg-white/80 border border-blue-100 rounded-lg p-2 flex items-start gap-1.5">
							<span class="w-3.5 h-3.5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[9px]">2</span>
							<span><strong>Format Standar:</strong> [Jenis] [Merk/Tipe] [Ukuran] (cth: <em>Thinner PU 5L</em>).</span>
						</div>
						<div class="bg-white/80 border border-blue-100 rounded-lg p-2 flex items-start gap-1.5">
							<span class="w-3.5 h-3.5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[9px]">3</span>
							<span><strong>Keterangan:</strong> Cantumkan alasan kebutuhan agar cepat di-approve.</span>
						</div>
					</div>
				</div>

				<!-- Quick Chips -->
				<div class="mb-4 bg-white border border-gray-200 rounded-xl p-3 shadow-2xs">
					<div class="flex items-center justify-between mb-2">
						<span class="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
							<IconSparkles size={14} class="text-amber-500" /> Quick Add Consumable & Safety:
						</span>
						<span class="text-[10px] text-gray-400" title="Daftar mengikuti jenis pekerjaan proyek dan barang yang paling sering Anda minta. Satuan mengikuti master barang supaya stok &amp; RAP cocok.">Klik untuk tambah instan · urut sering diminta</span>
					</div>
					<div class="flex flex-wrap gap-1.5">
						{#each quickChips as chip}
							<button
								type="button"
								class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-gray-50 hover:bg-[var(--gl)] text-gray-700 hover:text-[var(--gd)] border border-gray-200 hover:border-[var(--g)]/40 transition-all cursor-pointer shadow-2xs active:scale-95"
								onclick={() => addQuickChip(chip)}
							>
								<IconPlus size={12} class="text-[var(--g)]" />
								<span>{chip.name}</span>
							</button>
						{/each}
					</div>
				</div>

				{#each newItems as item, i}
					{@const dup = getDuplicateWarning(item.material_name)}
					<div id="pl-new-{i}" class="border border-gray-200 rounded-xl p-3.5 mb-3 bg-white shadow-2xs relative scroll-mt-16">
						<div class="flex items-center justify-between mb-2.5 pb-2 border-b border-gray-100">
							<span class="text-[11px] font-bold text-gray-600">Barang Baru #{i + 1}</span>
							<button
								class="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 cursor-pointer border-none bg-transparent transition-colors"
								title="Hapus baris"
								onclick={() => removeNewItem(i)}
							>
								<IconTrash size={14} />
							</button>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2.5">
							<div class="relative">
								<label class="f-label flex items-center justify-between">
									<span>Nama Material <span class="text-red-500">*</span></span>
									{#if isSearchingCatalog && activeSuggestRow === i}
										<span class="flex items-center gap-1 text-[10px] text-gray-400 font-normal">
											<IconLoader2 size={10} class="animate-spin text-[var(--g)]" /> Mencari...
										</span>
									{/if}
								</label>
								<input
									type="text"
									class="f-input"
									value={item.material_name}
									oninput={(e) => onMaterialNameInput(i, (e.target as HTMLInputElement).value)}
									onfocus={() => { if (item.material_name.trim().length >= 2) onMaterialNameInput(i, item.material_name); }}
									placeholder="Contoh: CAT PRIMER EPOXY / THINNER PU"
								/>
								
								<!-- Dropdown Saran -->
								{#if activeSuggestRow === i && searchSuggestions.length > 0}
									<div class="absolute z-30 left-0 right-0 top-[calc(100%+4px)] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden max-h-56 overflow-y-auto divide-y divide-gray-100">
										<div class="px-2.5 py-1.5 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider flex justify-between items-center">
											<span>Saran Master Katalog</span>
											<button type="button" class="text-gray-400 hover:text-gray-600 cursor-pointer" onclick={() => { activeSuggestRow = null; }}>Tutup ✕</button>
										</div>
										{#each searchSuggestions as sug}
											<button
												type="button"
												class="w-full text-left px-3 py-2 hover:bg-[var(--gl)]/30 transition-colors flex items-start justify-between gap-2 cursor-pointer border-none bg-transparent"
												onclick={() => selectMasterItem(i, sug)}
											>
												<div>
													<div class="text-[12px] font-bold text-gray-800">{sug.nama_barang_lengkap}</div>
													<div class="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2">
														{#if sug.kode_item}<span class="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono">{sug.kode_item}</span>{/if}
														{#if sug.satuan}<span>Satuan: {sug.satuan}</span>{/if}
													</div>
												</div>
												{#if sug.stok_tersedia != null}
													<span class="text-[10px] font-medium px-2 py-0.5 rounded-full {parseFloat(String(sug.stok_tersedia)) > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'} shrink-0">
														Stok: {sug.stok_tersedia} {sug.satuan || ''}
													</span>
												{/if}
											</button>
										{/each}
									</div>
								{/if}
								<div class="mt-1 text-[10px] text-gray-400">💡 <em>Format: [Jenis] [Merk/Tipe] [Ukuran]</em></div>
							</div>

							<div>
								{#if isPaintItem(item.material_name, { category: item.budget_category }) || item.budget_category === 'packing_supplier'}
									<div class="flex items-center justify-between mb-1">
										<label class="f-label !mb-0">
											Warna Cat
											{#if isPaintItem(item.material_name, { category: item.budget_category })}
												<span class="text-rose-500 font-bold ml-1">* Wajib untuk Cat</span>
											{/if}
										</label>
										{#if isClearPaint(item.material_name) && cleanColor(item.material_color) !== 'Clear / Bening'}
											<button
												type="button"
												class="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-300 rounded px-1.5 py-0.5 hover:bg-emerald-100 transition-colors cursor-pointer"
												onclick={() => { item.material_color = 'Clear / Bening'; }}
											>
												✨ Set "Clear / Bening"
											</button>
										{/if}
									</div>
									<ColorSwatchSelect bind:value={item.material_color} />
									{#if submitTried && item.material_name?.trim() && rowMissing(item).color}
										<div class="mt-1 text-[11px] text-red-600 font-medium">⚠️ Warna cat wajib diisi agar gudang & tinting tidak salah kirim.</div>
									{:else}
										<div class="mt-1 text-[10px] text-gray-400">🎨 <em>Pilih dari katalog warna standar (swatch & kode RAL) atau ketik bebas bila khusus.</em></div>
									{/if}
								{:else}
									<label class="f-label">Kode / Part # (opsional)</label>
									<input type="text" class="f-input" bind:value={item.material_color} placeholder="Contoh: nomor part, ukuran, varian" />
									<div class="mt-1 text-[10px] text-gray-400">🏷️ <em>Hanya untuk kategori Material Utama (Cat/Thinner) yang pakai katalog warna standar.</em></div>
								{/if}
							</div>

							<div>
								<label class="f-label">Kategori</label>
								<select bind:value={item.budget_category} class="f-select" class:!border-red-500={submitTried && item.material_name?.trim() && rowMissing(item).category}>
									<option value="" disabled>— Pilih kategori —</option>
									<option value="packing_supplier">📦 Material Utama / Supplier (Cat, Thinner)</option>
									<option value="packing_sewa_alat">🚜 Sewa Alat (Genset, Kompresor, Scaff)</option>
									<option value="packing_consumable">🛠️ Consumables (Kuas, Majun, Tape, Amplas)</option>
									<option value="packing_safety">🦺 Safety / APD (Helm, Rompi, Sarung Tangan)</option>
									<option value="packing_operasional">⛽ Operasional (BBM, Transport Lapangan)</option>
									<option value="packing_jasa">👷 Jasa / Subkon (Aplikator, Tukang)</option>
									<option value="packing_lain_lain">📋 Lain-Lain</option>
								</select>
								{#if submitTried && item.material_name?.trim() && rowMissing(item).category}
									<div class="mt-1 text-[11px] text-red-600">Pilih kategori barang ini.</div>
								{:else}
									<div class="mt-1 text-[10px] text-gray-400">🏷️ <em>Pilih pos biaya yang sesuai</em></div>
								{/if}
							</div>
						</div>

						{#if dup}
							<div class="mb-2.5 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-start gap-1.5">
								<IconAlertTriangle size={14} class="shrink-0 mt-0.5 text-amber-600" />
								<span><strong>Peringatan:</strong> Item serupa <em>"{dup.item}"</em> sudah ada di RAP. Disarankan memilih dari bagian RAP agar alokasi budget terpotong otomatis.</span>
								<button type="button" class="ml-auto shrink-0 px-2 py-1 rounded-md bg-amber-600 text-white text-[11px] font-semibold cursor-pointer border-none" onclick={() => takeFromRap(i, dup.id)}>Ambil dari RAP</button>
							</div>
						{/if}

						<div class="grid grid-cols-1 md:grid-cols-12 gap-3 mb-1">
							<div class="md:col-span-2">
								<label class="f-label">Qty <span class="text-red-500">*</span></label>
								<input type="number" class="f-input font-bold" bind:value={item.qty} min="0.1" step="0.1" />
							</div>
							<div class="md:col-span-2">
								<label class="f-label">Satuan</label>
								<select bind:value={item.unit} class="f-select" disabled={!!item.unit_locked} class:!border-red-500={submitTried && item.material_name?.trim() && rowMissing(item).unit}>
									<option value="">— Pilih satuan —</option>
									{#each unitOptions as u}
										<option>{u}</option>
									{/each}
								</select>
								{#if submitTried && item.material_name?.trim() && rowMissing(item).unit}
									<div class="mt-1 text-[11px] text-red-600">Pilih satuan barang ini.</div>
								{:else if item.unit_locked}
									<div class="mt-1 text-[10px] text-emerald-700">🔒 <em>Dikunci mengikuti master barang. Ketik ulang nama untuk mengubah.</em></div>
								{:else}
									<div class="mt-1 text-[10px] text-gray-400">📏 <em>Satuan mengikuti master barang supaya stok &amp; RAP cocok.</em></div>
								{/if}
							</div>
							<div class="md:col-span-3">
								<label class="f-label">Estimasi Harga / {item.unit || 'sat'} (Rp)</label>
								<input type="number" class="f-input" bind:value={item.unit_price} min="0" step="1000" placeholder="Perkiraan harga" />
								<div class="mt-1 text-[10px] text-gray-400">💰 <em>Barang di luar RAP wajib diberi perkiraan harga agar approver tahu nilainya.</em></div>
							</div>
							<div class="md:col-span-5">
								<label class="f-label">Keterangan / Justifikasi</label>
								<input type="text" class="f-input" bind:value={item.description} placeholder="Cth: Kebutuhan mendesak area C" />
								<div class="mt-1 text-[10px] text-gray-400">📝 <em>Alasan pengadaan agar approval cepat</em></div>
							</div>
						</div>
					</div>
				{/each}

				<button class="btn-action" onclick={addNewItem}>
					<IconPlus size={14} /> Tambah barang baru
				</button>

				{#if newItems.length > 0 && totalNewItems > 0}
					<div class="bg-[var(--gl)] rounded-lg p-2.5 mt-2 flex justify-between items-center">
						<span class="text-[11px] text-[var(--gd)] font-medium">Total barang baru</span>
						<span class="text-[13px] font-semibold text-[var(--gd)]">{totalNewItems} item</span>
					</div>
				{/if}
			</div>

			<PlLampiranPreviewCard projectId={selectedProject ? Number(selectedProject) : null} items={lampiranPreviewItems} />

			<!-- Summary Total -->
			{#if totalItems > 0}
				<div class="bg-gradient-to-br from-[var(--gl)] to-white rounded-xl p-4 border border-[var(--g)]/15 mb-3">
					<div class="flex justify-between items-center">
						<div>
							<p class="text-[13px] font-semibold text-[var(--gd)]">Total pengajuan</p>
							<p class="text-[11px] text-[var(--g)] mt-0.5">
								{totalExistingSelected > 0 ? `${totalExistingSelected} dari RAP` : ''}
								{totalExistingSelected > 0 && totalNewItems > 0 ? ' + ' : ''}
								{totalNewItems > 0 ? `${totalNewItems} barang baru` : ''}
							</p>
						</div>
						<strong class="text-[20px] font-semibold text-[var(--gd)]">{totalItems} item</strong>
					</div>
				</div>
			{/if}
		</div>

		<!-- Bottom Bar -->
		<div class="bottom-bar shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
			<button
				class="btn-primary"
				onclick={handleKirimClick}
				disabled={submitting || totalItems === 0}
			>
				<IconSend size={16} /> Kirim packing list ({totalItems} item)
			</button>
		</div>
	{/if}

	<!-- Confirmation Modal -->
	{#if showConfirmModal}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onclick={() => showConfirmModal = false}>
			<div class="bg-white rounded-2xl w-full max-w-md shadow-xl flex flex-col overflow-hidden max-h-[85vh] animate-in fade-in zoom-in-95 duration-200" onclick={(e) => e.stopPropagation()}>
				<div class="p-4 border-b border-gray-100 flex items-center gap-3 bg-white relative z-10">
					<div class="w-10 h-10 rounded-full bg-[var(--gl)]/50 flex items-center justify-center text-[var(--g)] shrink-0">
						<IconPackage size={20} />
					</div>
					<div>
						<h3 class="text-[15px] font-bold text-gray-800 m-0 leading-tight">Konfirmasi Pengajuan</h3>
						<p class="text-[11px] text-gray-500 m-0 mt-0.5">Pastikan barang & qty sudah sesuai</p>
					</div>
				</div>

				<div class="p-4 overflow-y-auto bg-gray-50 space-y-4">
					{#if customerMaterialHits.length}
						<div class="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-[11px] leading-snug" data-testid="pl-customer-material-hint">
							<div class="font-bold mb-1">Barang ini juga ada di PO material customer</div>
							<ul class="list-disc pl-4 mb-1">
								{#each customerMaterialHits as h}<li>{h.material_name} ≈ {h.produk_po}</li>{/each}
							</ul>
							Cat dari PO customer dikirim langsung ke proyek — cek panel Material dari Customer di ringkasan proyek. Ajukan PL proyek hanya bila memang kurang (touch-up / salah hitung); ini tetap boleh diajukan dan dicatat sebagai biaya proyek.
						</div>
					{/if}
					{#if selectedExisting.size > 0}
						<div>
							<div class="text-[11px] font-bold text-gray-400 mb-2 uppercase tracking-wider flex items-center gap-2">
								<div class="w-1 h-1 rounded-full bg-gray-300"></div>
								Dari RAP ({selectedExisting.size} item)
							</div>
							<div class="space-y-1.5">
								{#each filteredExisting.filter(i => selectedExisting.has(i.id)) as item}
									<div class="bg-white p-2.5 rounded-xl border border-gray-100 flex justify-between items-center shadow-sm">
										<div class="flex-1 min-w-0 pr-3">
											<div class="text-[12px] font-semibold text-gray-800 truncate">
												{item.material_name || item.description || 'Item'}
												{#if kodeItemMap[item.identitas_barang_id]}<span class="text-[10px] font-mono font-bold text-emerald-600 ml-1">{kodeItemMap[item.identitas_barang_id]}</span>{/if}
											</div>
											{#if cleanColor(item.material_color)}
												<div class="text-[10px] text-gray-500 mt-0.5"><ColorChip color={cleanColor(item.material_color)} size="xs" /></div>
											{:else if isPaintItem(item.material_name || item.description)}
												<div class="text-[10px] text-amber-600 font-bold mt-0.5">⚠️ Belum ada spesifikasi warna</div>
											{/if}
										</div>
										<div class="text-[13px] font-bold text-[var(--g)] shrink-0 bg-[var(--gl)]/30 px-2 py-0.5 rounded-lg border border-[var(--g)]/10">
											{item.qty} <span class="text-[10px] font-medium">{item.unit || ''}</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					{#if validNewItems.length > 0}
						<div>
							<div class="text-[11px] font-bold text-gray-400 mb-2 uppercase tracking-wider flex items-center gap-2">
								<div class="w-1 h-1 rounded-full bg-gray-300"></div>
								Barang Baru ({validNewItems.length} item)
							</div>
							<div class="space-y-1.5">
								{#each validNewItems as item}
									<div class="bg-white p-2.5 rounded-xl border border-gray-100 flex justify-between items-center shadow-sm">
										<div class="flex-1 min-w-0 pr-3">
											<div class="text-[12px] font-semibold text-gray-800 truncate">{item.material_name}</div>
											<div class="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
												{#if cleanColor(item.material_color)}
													<ColorChip color={cleanColor(item.material_color)} size="xs" />
													<span>·</span>
												{:else if isPaintItem(item.material_name, { category: item.budget_category })}
													<span class="text-amber-600 font-bold">⚠️ Belum ada spesifikasi warna</span>
													<span>·</span>
												{/if}
												<span class="text-gray-400">{categoryNames[item.budget_category] || item.budget_category}</span>
											</div>
										</div>
										<div class="text-[13px] font-bold text-[var(--g)] shrink-0 bg-[var(--gl)]/30 px-2 py-0.5 rounded-lg border border-[var(--g)]/10">
											{item.qty} <span class="text-[10px] font-medium">{item.unit || ''}</span>
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
							<IconLoader2 size={16} class="animate-spin" /> Menyimpan...
						{:else}
							<IconSend size={16} /> Oke, Kirim
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<GateCompletionWizard
	open={wizardOpen}
	gates={wizardGates}
	title="Kelengkapan Gate Packing List"
	onClose={() => (wizardOpen = false)}
	onGoToField={(gateKey) => goToGateSection(gateKey)}
	onRecheck={handleWizardRecheck}
	onFixItem={handleWizardFixItem}
	hintsUnavailable={wizardHintsUnavailable}
/>

<GateFixTautanBarang
	open={fixTautanOpen}
	projectBudgetId={fixTautanBudgetId ?? 0}
	itemLabel={fixTautanLabel}
	onClose={() => (fixTautanOpen = false)}
	onSuccess={handleFixTautanSuccess}
/>
