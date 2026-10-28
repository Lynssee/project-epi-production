<!-- PackingRequestModal.svelte — Modal pembuatan packing request dari template, RAB, atau entry manual -->
<script lang="ts">
	import { tick } from 'svelte';
	import { UNIT_LABELS, normalizeUnitLabel } from '$lib/shared/unitMaster';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import {
		IconX, IconLoader2, IconPlus, IconTrash, IconSearch, IconCheck,
		IconAlertTriangle, IconBulb, IconSparkles, IconPackage, IconInfoCircle
	} from '@tabler/icons-svelte';
	import { authStore } from '$lib/stores/auth';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import {
		getPackingListTemplates, getTemplateItems, getProjectBudgetItems,
		submitPackingRequest, createPackingListItems, submitPackingFromTemplate,
		searchMasterCatalog, precheckPackingGate, type MasterCatalogItem
	} from '$lib/services/packingList';
	import type { TemplateItem } from '$lib/services/packingList';
	import GateCompletionWizard from '$lib/components/shared/GateCompletionWizard.svelte';
	import GateFixTautanBarang from '$lib/components/shared/GateFixTautanBarang.svelte';
	import { fetchGateHints, applyGateHints } from '$lib/services/gateHintClient.js';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';

	interface Props { open: boolean; onsuccess?: () => void; initialProjectId?: number | string | null; }
	let { open = $bindable(false), onsuccess, initialProjectId = null }: Props = $props();

	interface PackingModalDraft {
		selectedProjectId: string;
		selectedTemplate: string;
		activeTab: 'template' | 'rab' | 'manual';
		templateQtyMap: Record<number, number>;
		templateNotesMap: Record<number, string>;
		selectedRabIds: number[];
		rabQtyMap: Record<number, number>;
		manualItems: Array<{
			material_name: string;
			material_color: string;
			qty: number;
			unit: string;
			description: string;
			budget_category: string;
		}>;
	}

	const modalPersist = createFormPersist<PackingModalDraft>('packing_list_modal');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);
	let draftRestoredNotice = $state(false);

	let currentRoleId: string | null = null;
	let currentKaryawanName: string | null = null;
	const unsub = authStore.subscribe(s => { currentRoleId = s.roleId; currentKaryawanName = s.karyawanName; });

	let activeTab = $state<'template' | 'rab' | 'manual'>('template');
	let projects = $state<any[]>([]);
	let selectedProjectId = $state('');
	let templates = $state<any[]>([]);
	let selectedTemplate = $state('');
	let templateItems = $state<TemplateItem[]>([]);
	let templateQtyMap = $state<Record<number, number>>({});
	let templateNotesMap = $state<Record<number, string>>({}); // Keterangan per item template
	let templateSearch = $state('');
	
	let rabItems = $state<any[]>([]);
	let selectedRab = $state<Set<number>>(new Set());
	let rabSearch = $state('');
	
	let manualItems = $state<Array<{ material_name: string; material_color: string; qty: number; unit: string; description: string; budget_category: string }>>([]);
	// PRJ-26: satu master satuan (bukan daftar sendiri).
	const unitOptions = UNIT_LABELS;
	
	let loading = $state(false);
	let loadingTpl = $state(false);
	let loadingRab = $state(false);
	let submitting = $state(false);
	let showConfirm = $state(false);

	// F0 (Audit & Hardening Gate v2, Path A) — wizard kelengkapan gate PL sisi lapangan.
	let wizardOpen = $state(false);
	let wizardGates = $state<any[]>([]);
	let wizardHintsUnavailable = $state(false);

	async function runGatePrecheck(): Promise<{ ok: boolean; gates: any[] }> {
		const pid = Number(selectedProjectId);
		if (!pid) return { ok: true, gates: [] };
		const gateItems = [
			...rabSelected.map((i: any) => ({ qty: i.qty, identitas_barang_id: i.identitas_barang_id, budgetItemId: i.id })),
			...tplSelected.map((i: any) => ({ qty: templateQtyMap[i.id!] || 0, material_name: i.material_name || i.description })),
			...manualValid.map((i) => ({ qty: i.qty, material_name: i.material_name }))
		];
		const gate = await precheckPackingGate(pid, gateItems);
		const hintResult = await fetchGateHints('packing_list', 'packing_list');
		wizardHintsUnavailable = !hintResult.available;
		wizardGates = applyGateHints(gate.gates || [], hintResult);
		return { ok: gate.ok, gates: wizardGates };
	}

	async function handleWizardRecheck() {
		const result = await runGatePrecheck();
		if (result.ok) wizardOpen = false;
	}

	// Fase 3 (Aksi Benahi Inline C) — popup usul tautan barang per baris project_budgets
	// belum tertaut (G_PKL_INVENTORY_LINK). Dipisah dari wizard supaya bisa dibuka berulang.
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
		await handleWizardRecheck();
	}

	// State Autocomplete Master Catalog
	let activeSuggestRow = $state<number | null>(null);
	let searchSuggestions = $state<MasterCatalogItem[]>([]);
	let isSearchingCatalog = $state(false);
	let searchDebounceTimer: any = null;

	const quickConsumableChips = [
		{ name: 'Kuas Roll 4 Inch', category: 'packing_consumable', unit: 'Pcs' },
		{ name: 'Masking Tape 2 Inch', category: 'packing_consumable', unit: 'Roll' },
		{ name: 'Majun Katun Super', category: 'packing_consumable', unit: 'Kg' },
		{ name: 'Sarung Tangan Karet (Latex)', category: 'packing_safety', unit: 'Pcs' },
		{ name: 'Kacamata Safety Clear', category: 'packing_safety', unit: 'Pcs' },
		{ name: 'Thinner Epoxy High Gloss', category: 'packing_supplier', unit: 'Liter' },
		{ name: 'Amplas Lembar No. 80', category: 'packing_consumable', unit: 'Lembar' },
		{ name: 'Helm Safety Putih + Tali Dagu', category: 'packing_safety', unit: 'Pcs' }
	];

	function onMaterialNameInput(index: number, text: string) {
		if (!manualItems[index]) return;
		manualItems[index].material_name = text;
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
		if (!manualItems[index]) return;
		manualItems[index].material_name = item.nama_barang_lengkap;
		if (item.satuan) {
			// Satuan katalog dipetakan lewat master (Meter→M, Lbr→Lembar); tak dikenal dipakai apa adanya.
			const matchUnit = normalizeUnitLabel(item.satuan);
			if (matchUnit) {
				manualItems[index].unit = matchUnit;
			} else if (item.satuan) {
				manualItems[index].unit = item.satuan;
			}
		}
		// Otomatis infer kategori jika ada kata kunci
		const lower = item.nama_barang_lengkap.toLowerCase();
		if (lower.includes('cat') || lower.includes('thinner') || lower.includes('primer') || lower.includes('epoxy') || lower.includes('hardener')) {
			manualItems[index].budget_category = 'packing_supplier';
		} else if (lower.includes('kuas') || lower.includes('amplas') || lower.includes('majun') || lower.includes('tape') || lower.includes('baut') || lower.includes('mata gerinda')) {
			manualItems[index].budget_category = 'packing_consumable';
		} else if (lower.includes('helm') || lower.includes('rompi') || lower.includes('sarung tangan') || lower.includes('kacamata') || lower.includes('masker') || lower.includes('harness') || lower.includes('safety')) {
			manualItems[index].budget_category = 'packing_safety';
		} else if (lower.includes('genset') || lower.includes('kompresor') || lower.includes('scaffold') || lower.includes('mesin') || lower.includes('molen')) {
			manualItems[index].budget_category = 'packing_sewa_alat';
		}

		if (item.kode_item && !manualItems[index].material_color) {
			manualItems[index].material_color = item.kode_item;
		}
		
		searchSuggestions = [];
		activeSuggestRow = null;
	}

	function addQuickChip(chip: { name: string; category: string; unit: string }) {
		manualItems = [
			...manualItems,
			{
				material_name: chip.name,
				material_color: '',
				qty: 1,
				unit: chip.unit,
				description: 'Kebutuhan consumable operasional lapangan',
				budget_category: chip.category
			}
		];
	}

	function getDuplicateWarning(name?: string): { type: 'rab' | 'template'; item: string } | null {
		if (!name || name.trim().length < 3) return null;
		const lower = name.toLowerCase().trim();
		const rabMatch = rabItems.find(r => ((r.material_name || r.description || '')).toLowerCase().includes(lower));
		if (rabMatch) {
			return { type: 'rab', item: rabMatch.material_name || rabMatch.description };
		}
		const tplMatch = templateItems.find(t => (t.material_name || t.description || '').toLowerCase().includes(lower));
		if (tplMatch) {
			return { type: 'template', item: tplMatch.material_name || tplMatch.description };
		}
		return null;
	}

	let filteredTpl = $derived(templateSearch.trim()
		? templateItems.filter(i => (i.material_name || i.description || '').toLowerCase().includes(templateSearch.toLowerCase()))
		: templateItems);
		
	// Group Template Items by Category
	const categoryNames: Record<string, string> = {
		'packing_sewa_alat': 'PERALATAN / SEWA ALAT',
		'packing_consumable': 'CONSUMABLE',
		'packing_supplier': 'MATERIAL SUPPLIER',
		'packing_safety': 'SAFETY',
		'packing_operasional': 'OPERASIONAL',
		'packing_jasa': 'JASA',
		'packing_lain_lain': 'LAIN-LAIN'
	};
	
	let groupedTpl = $derived(() => {
		const groups: Record<string, TemplateItem[]> = {};
		for (const item of filteredTpl) {
			const cat = categoryNames[item.budget_category] || item.budget_category || 'TIDAK BERKATEGORI';
			if (!groups[cat]) groups[cat] = [];
			groups[cat].push(item);
		}
		// Sort categories to show Tools then Consumables then others (approx)
		const sortedKeys = Object.keys(groups).sort((a, b) => {
			if (a.includes('PERALATAN')) return -1;
			if (b.includes('PERALATAN')) return 1;
			if (a.includes('CONSUMABLE')) return -1;
			if (b.includes('CONSUMABLE')) return 1;
			return a.localeCompare(b);
		});
		return { groups, sortedKeys };
	});

	let filteredRab = $derived(rabSearch.trim()
		? rabItems.filter(i => (i.material_name || i.description || '').toLowerCase().includes(rabSearch.toLowerCase()))
		: rabItems);
		
	let groupedRab = $derived(() => {
		const groups: Record<string, any[]> = {};
		for (const item of filteredRab) {
			const cat = categoryNames[item.budget_category] || item.budget_category || 'TIDAK BERKATEGORI';
			if (!groups[cat]) groups[cat] = [];
			groups[cat].push(item);
		}
		const sortedKeys = Object.keys(groups).sort();
		return { groups, sortedKeys };
	});

	let tplSelected = $derived(templateItems.filter(i => i.id != null && (templateQtyMap[i.id!] || 0) > 0));
	let rabSelected = $derived(rabItems.filter(i => selectedRab.has(i.id)));
	let manualValid = $derived(manualItems.filter(i => (i.material_name || '').trim() && i.qty > 0));
	let totalItems = $derived(tplSelected.length + rabSelected.length + manualValid.length);

	function getModalSnapshot(): PackingModalDraft {
		const rabQtyMap: Record<number, number> = {};
		for (const item of rabItems) {
			if (item.id != null && item._rap_qty != null && item.qty !== item._rap_qty) {
				rabQtyMap[item.id] = Number(item.qty) || 0;
			}
		}
		return {
			selectedProjectId,
			selectedTemplate,
			activeTab,
			templateQtyMap,
			templateNotesMap,
			selectedRabIds: [...selectedRab],
			rabQtyMap,
			manualItems
		};
	}

	function discardDraft() {
		modalPersist.clear();
		draftRestoredNotice = false;
		templateQtyMap = {};
		templateNotesMap = {};
		selectedRab = new Set();
		manualItems = [];
		if (selectedProjectId) {
			loadRab(Number(selectedProjectId));
		}
	}

	function handleBackdropClick() {
		if (totalItems > 0) {
			if (confirm('Anda memiliki isian yang belum dikirim. Yakin ingin menutup form? Isian Anda tetap aman tersimpan di draf.')) {
				open = false;
			}
		} else {
			open = false;
		}
	}

	function handleCloseButton() {
		if (totalItems > 0) {
			if (confirm('Tutup form pembuatan packing list? Isian Anda tetap aman tersimpan di draf.')) {
				open = false;
			}
		} else {
			open = false;
		}
	}

	$effect(() => {
		if (open) {
			init();
		} else {
			draftArmed = false;
		}
	});

	// Autosave draf modal
	$effect(() => {
		if (!open || !draftArmed) return;
		void getModalSnapshot();
		modalPersist.save(getModalSnapshot());
		draftSavedAt = new Date();
	});

	// Trigger darurat: flush saat pagehide & visibilitychange (minimize / ganti tab / OS discard)
	$effect(() => {
		if (!open) return;
		return registerFormPersistSaveTriggers(modalPersist, getModalSnapshot);
	});

	async function init() {
		loading = true;
		draftRestoredNotice = false;
		try {
			const [proj, tmpl] = await Promise.all([
				getProjectsForCurrentUser(true),
				getPackingListTemplates()
			]);
			projects = proj || [];
			templates = tmpl || [];

			// Cek draf tersimpan dari sesi sebelumnya
			const draft = modalPersist.restore();
			if (draft) {
				if (draft.selectedProjectId && projects.some(p => String(p.id) === draft.selectedProjectId)) {
					selectedProjectId = draft.selectedProjectId;
				} else if (projects.length > 0) {
					const targetId = initialProjectId && projects.some(p => String(p.id) === String(initialProjectId))
						? String(initialProjectId)
						: String(projects[0].id);
					selectedProjectId = targetId;
				}

				if (selectedProjectId) {
					await loadRab(Number(selectedProjectId));
				}

				if (draft.selectedTemplate && templates.some(t => t.name === draft.selectedTemplate)) {
					selectedTemplate = draft.selectedTemplate;
				} else if (templates.length > 0) {
					selectedTemplate = templates[0].name;
				}

				if (selectedTemplate) {
					await loadTpl(selectedTemplate);
				}

				if (draft.activeTab) activeTab = draft.activeTab;
				if (draft.templateQtyMap) templateQtyMap = { ...draft.templateQtyMap };
				if (draft.templateNotesMap) templateNotesMap = { ...draft.templateNotesMap };
				if (draft.manualItems && Array.isArray(draft.manualItems) && draft.manualItems.length > 0) {
					manualItems = draft.manualItems;
				}

				if (draft.selectedRabIds && draft.selectedRabIds.length > 0) {
					const validRabIds = new Set(rabItems.map(i => i.id));
					selectedRab = new Set(draft.selectedRabIds.filter(id => validRabIds.has(id)));
				}
				if (draft.rabQtyMap && Object.keys(draft.rabQtyMap).length > 0) {
					rabItems = rabItems.map(i => {
						if (draft.rabQtyMap[i.id] !== undefined) {
							return { ...i, qty: draft.rabQtyMap[i.id] };
						}
						return i;
					});
				}

				const savedEpoch = modalPersist.savedAt();
				draftSavedAt = savedEpoch ? new Date(savedEpoch) : new Date();
				if (Object.keys(templateQtyMap).length > 0 || selectedRab.size > 0 || manualItems.length > 0) {
					draftRestoredNotice = true;
				}
			} else {
				if (projects.length > 0) {
					const targetId = initialProjectId && projects.some(p => String(p.id) === String(initialProjectId))
						? String(initialProjectId)
						: String(projects[0].id);
					selectedProjectId = targetId;
					await loadRab(Number(selectedProjectId));
				}
				if (templates.length > 0) {
					selectedTemplate = templates[0].name;
					await loadTpl(selectedTemplate);
				}
			}
		} finally {
			loading = false;
			draftArmed = true;
		}
	}

	function reset() {
		activeTab = 'template'; selectedProjectId = ''; selectedTemplate = '';
		templateItems = []; templateQtyMap = {}; templateNotesMap = {}; templateSearch = '';
		rabItems = []; selectedRab = new Set(); rabSearch = ''; manualItems = []; showConfirm = false;
	}

	async function loadTpl(name: string) {
		if (!name) return;
		loadingTpl = true; templateQtyMap = {}; templateNotesMap = {};
		try { templateItems = (await getTemplateItems(name)) || []; }
		finally { loadingTpl = false; }
	}

	async function loadRab(pid: number) {
		loadingRab = true; selectedRab = new Set();
		try {
			// Fase 5 #3: snapshot qty RAP asli sebelum input request menimpanya
			// (bind:value={item.qty}), supaya sisa budget RAP per baris bisa dihitung.
			rabItems = ((await getProjectBudgetItems(pid)) || []).map((i: any) => ({
				...i,
				_rap_qty: Number(i.qty) || 0
			}));
		}
		finally { loadingRab = false; }
	}

	// Fase 5 #3 — sisa budget RAP baris terkait: qty RAP dikurangi yang sudah pernah dikirim.
	function rabSisa(item: any): number {
		return (Number(item._rap_qty ?? item.qty) || 0) - (Number(item.qty_sudah_dikirim) || 0);
	}
	function rabOverBudget(item: any): boolean {
		return selectedRab.has(item.id) && (Number(item.qty) || 0) > rabSisa(item) + 1e-9;
	}

	async function onProjectChange() {
		if (selectedProjectId) await loadRab(Number(selectedProjectId));
	}

	async function onTemplateChange(name: string) {
		selectedTemplate = name;
		await loadTpl(name);
	}

	function toggleRab(id: number) {
		const s = new Set(selectedRab);
		s.has(id) ? s.delete(id) : s.add(id);
		selectedRab = s;
	}

	function toggleAllRab() {
		selectedRab = selectedRab.size === filteredRab.length && filteredRab.length > 0
			? new Set() : new Set(filteredRab.map((i: any) => i.id));
	}

	function setQty(id: number, val: number) {
		const m = { ...templateQtyMap };
		if (val > 0) m[id] = val; else delete m[id];
		templateQtyMap = m;
	}
	
	function setNotes(id: number, val: string) {
		const m = { ...templateNotesMap };
		m[id] = val;
		templateNotesMap = m;
	}

	async function processSubmit() {
		submitting = true;
		try {
			const pic = currentKaryawanName || 'Leader';
			const pid = Number(selectedProjectId);
			const targetProject = projects.find((p: any) => String(p.id) === String(selectedProjectId));
			const projectName = targetProject?.name || `Proyek #${pid}`;

			// Tangkap jumlah item dan breakdown sebelum proses kirim dan reset
			const countTpl = tplSelected.length;
			const countRab = rabSelected.length;
			const countManual = manualValid.length;
			const totalCount = countTpl + countRab + countManual;

			if (totalCount === 0) {
				alert('Pilih minimal 1 barang dengan mengisi Qty sebelum mengirim.');
				submitting = false;
				return;
			}

			// Fase 5 #3 — cegah permintaan yang melebihi sisa budget RAP baris terkait.
			const overBudget = rabSelected.filter((i: any) => rabOverBudget(i));
			if (overBudget.length > 0) {
				alert(
					`Tidak bisa dikirim — ${overBudget.length} item dari RAB melebihi sisa budget RAP:\n\n` +
					overBudget.map((i: any) =>
						`• ${i.material_name || i.description}: minta ${i.qty} ${i.unit || ''}, sisa RAP ${rabSisa(i)} ${i.unit || ''}`
					).join('\n') +
					`\n\nKurangi qty atau ajukan revisi RAP lebih dulu.`
				);
				submitting = false;
				return;
			}

			// F0 Path A — pra-cek gate PL lapangan (G_PKL_PROJECT memblokir, stok peringatan).
			const gate = await runGatePrecheck();
			if (!gate.ok) {
				wizardOpen = true;
				showConfirm = false;
				submitting = false;
				return;
			}

			let ok = true;

			// 1. Template
			if (tplSelected.length > 0) {
				const submitItems = tplSelected.map(i => {
					const qty = templateQtyMap[i.id!];
					const notes = templateNotesMap[i.id!];
					const matName = (i.material_name || i.description || '').trim();
					const desc = notes && notes.trim() ? notes.trim() : (i.description || matName);
					return {
						item: {
							...i,
							material_name: matName,
							description: desc
						},
						qty
					};
				});
				const r = await submitPackingFromTemplate(pid, submitItems, pic, projectName);
				if (!r) ok = false;
			}

			// 2. RAB
			if (rabSelected.length > 0) {
				const r = await submitPackingRequest(
					rabSelected.map((i: any) => ({ id: i.id, qty: i.qty, unit_price: i.unit_price })),
					{ projectName, requesterName: pic }
				);
				if (!r) ok = false;
			}

			// 3. Manual
			if (manualValid.length > 0) {
				const r = await createPackingListItems(pid, manualValid.map(i => ({ ...i, unit_price: 0 })), pic, projectName);
				if (!r) ok = false;
			}
			
			modalPersist.clear();
			showConfirm = false;
			open = false;
			reset();
			await tick();

			if (ok) {
				const detailLines: string[] = [];
				if (countTpl > 0) detailLines.push(`• Template: ${countTpl} item`);
				if (countRab > 0) detailLines.push(`• RAB / RAP: ${countRab} item`);
				if (countManual > 0) detailLines.push(`• Pengajuan Manual: ${countManual} item`);

				const msg = [
					`✓ Pengajuan Packing List Berhasil Dikirim!`,
					``,
					`Proyek: ${projectName}`,
					`Total Dikirim: ${totalCount} item`,
					...(detailLines.length > 0 ? [``, `Rincian:`, ...detailLines] : []),
					``,
					`Status: Data pengajuan telah dicatat dan diteruskan ke tim Logistik & Admin untuk diproses.`
				].join('\n');

				if (typeof window !== 'undefined' && (window as any).__showToast) {
					(window as any).__showToast(`Pengajuan packing list (${totalCount} item) berhasil dikirim!`, 'success');
				}

				alert(msg);
				if (onsuccess) onsuccess();
			} else {
				alert('Sebagian data packing list gagal dikirim. Silakan periksa kembali daftar pengajuan Anda.');
			}
		} catch (e: any) {
			console.error('[PackingRequestModal] submit error:', e);
			const msg = e?.message || 'Gagal mengirim packing list.';
			// Bila ditolak server oleh gate (laporan harian, P2H, status proyek, dsb),
			// evaluasi ulang gate dan buka Wizard agar leader melihat detail & tautan aksi perbaikan.
			if (
				msg.includes('Pengajuan packing list belum bisa dikirim') ||
				msg.includes('gate') ||
				msg.includes('laporan harian') ||
				msg.includes('P2H') ||
				msg.includes('proyek')
			) {
				await runGatePrecheck();
				wizardOpen = true;
				showConfirm = false;
			} else {
				alert(msg);
			}
		} finally {
			submitting = false;
		}
	}
</script>

{#if open}
<div class="fixed inset-0 z-[100] flex flex-col justify-end bg-black/50 backdrop-blur-sm"
	 onclick={handleBackdropClick}
	 role="dialog" aria-modal="true">
	<div class="bg-white rounded-t-2xl flex flex-col overflow-hidden"
		 style="height:96vh; max-width: 1400px; margin: 0 auto; width: 100%;"
		 onclick={e => e.stopPropagation()}>

		<!-- Drag handle + Header -->
		<div class="shrink-0 px-4 pt-3 pb-3 border-b border-gray-100 bg-white">
			<div class="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-3 md:hidden"></div>
			<div class="flex items-center justify-between mb-2.5">
				<h2 class="text-[16px] md:text-[18px] font-bold text-gray-800 flex items-center gap-2">
					<IconPlus size={20} class="text-[var(--g)]"/> Buat Packing List
				</h2>
				<button class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 cursor-pointer border-none transition-colors"
						onclick={handleCloseButton}>
					<IconX size={16} />
				</button>
			</div>
			{#if loading}
				<div class="h-10 bg-gray-100 rounded-xl animate-pulse"></div>
			{:else}
				<div class="flex flex-col md:flex-row gap-3">
					<div class="flex-1">
						<label class="text-[11px] font-semibold text-gray-500 mb-1 block uppercase tracking-wider">Pilih Proyek</label>
						{#if projects.length === 0}
							<div class="p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-xs flex items-center gap-1.5">
								<IconAlertTriangle size={15} class="shrink-0 text-amber-600" />
								<span class="truncate">Belum ada proyek aktif yang ditugaskan</span>
							</div>
						{:else}
							<select bind:value={selectedProjectId} onchange={onProjectChange} class="w-full px-3 py-2 text-[13px] bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[var(--g)]">
								{#each projects as p}<option value={String(p.id)}>{p.name} (ID-{p.id})</option>{/each}
							</select>
						{/if}
					</div>
					<div class="flex-1 md:max-w-xs">
						<label class="text-[11px] font-semibold text-gray-500 mb-1 block uppercase tracking-wider">Cari Item</label>
						<div class="relative">
							<IconSearch size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
							{#if activeTab === 'template'}
								<input type="text" bind:value={templateSearch} placeholder="Cari material template..."
									   class="w-full pl-8 pr-3 py-2 text-[13px] bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[var(--g)] transition-colors" />
							{:else if activeTab === 'rab'}
								<input type="text" bind:value={rabSearch} placeholder="Cari material RAB..."
									   class="w-full pl-8 pr-3 py-2 text-[13px] bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[var(--g)] transition-colors" />
							{:else}
								<input type="text" placeholder="Pencarian tidak tersedia" disabled
									   class="w-full pl-8 pr-3 py-2 text-[13px] bg-gray-100 text-gray-400 border border-gray-200 rounded-xl outline-none" />
							{/if}
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Tabs -->
		<div class="shrink-0 flex border-b border-gray-200 bg-white px-2">
			{#each [['template','1. Dari Template'], ['rab','2. Dari RAB'], ['manual','3. Manual Baru']] as [id, label]}
				<button class="px-4 py-3 text-[13px] font-semibold border-b-[3px] transition-colors cursor-pointer outline-none
							   {activeTab === id ? 'border-[var(--g)] text-[var(--g)]' : 'border-transparent text-gray-400 hover:text-gray-600'}"
						onclick={() => activeTab = id as any}>{label}</button>
			{/each}
		</div>

		<!-- Body -->
		<div class="flex-1 overflow-y-auto bg-slate-50">
			<!-- Banner Bila Belum Ada Proyek -->
			{#if !loading && projects.length === 0}
				<div class="m-3 p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200 shadow-xs">
					<IconAlertTriangle size={20} class="text-amber-600 shrink-0 mt-0.5" />
					<div class="space-y-1.5">
						<p class="font-bold text-[13px]">Belum Ada Proyek Ditugaskan</p>
						<p class="leading-relaxed text-amber-800/90 dark:text-amber-300/90">
							Akun Anda belum memiliki proyek aktif yang ditugaskan sebagai Lead PIC atau Co-Leader.
						</p>
						<ul class="list-disc list-inside space-y-0.5 text-amber-800 dark:text-amber-300 pl-0.5">
							<li>Pastikan email login sudah terhubung ke data karyawan oleh HRD.</li>
							<li>Pastikan Anda sudah di-assign pada proyek terkait di ERP Admin.</li>
							<li>Pastikan proyek sudah dibuat dari SO dan berstatus aktif (bukan selesai/batal).</li>
						</ul>
					</div>
				</div>
			{/if}

			<!-- Banner Pemulihan Draf -->
			{#if draftRestoredNotice && totalItems > 0}
				<div class="m-3 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-300 animate-in fade-in duration-200">
					<div class="flex items-center gap-2">
						<IconCheck size={16} class="text-emerald-600 shrink-0" />
						<span>
							<strong>Draf isian dipulihkan:</strong> Data sebelumnya tersimpan aman di perangkat ini.
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
			{#if activeTab === 'template'}
				<!-- Template chips -->
				<div class="sticky top-0 z-10 bg-slate-50/90 backdrop-blur-sm border-b border-gray-100 p-3 shadow-sm">
					{#if loading}
						<div class="h-8 bg-gray-200 rounded animate-pulse w-48"></div>
					{:else}
						<div class="flex gap-2 overflow-x-auto pb-1 items-center">
							<span class="text-[11px] font-semibold text-gray-400 shrink-0 mr-1 uppercase">Pilih Template:</span>
							{#each templates as t}
								<button class="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all cursor-pointer whitespace-nowrap
											   {selectedTemplate === t.name ? 'bg-[var(--g)] text-white border-[var(--g)] shadow-md' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}"
										onclick={() => onTemplateChange(t.name)}>
									{t.name} <span class="opacity-70 text-[10px] ml-1">({t.item_count})</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>

				{#if loadingTpl}
					<div class="py-8 text-center">
						<CircularProgressGauge
							compact={true}
							stepLabel="Memuat item template packing list..."
							subLabel="Mengambil daftar item template Directus"
						/>
					</div>
				{:else if filteredTpl.length === 0}
					<div class="text-center py-12 text-gray-400 text-[13px]">Tidak ada item template.</div>
				{:else}
					{@const data = groupedTpl()}
					<!-- Dense Grid View -->
					<div class="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
						{#each data.sortedKeys as categoryKey}
							{@const items = data.groups[categoryKey]}
							<div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm h-fit">
								<!-- Header Kategori -->
								<div class="bg-gray-100 border-b border-gray-200 px-3 py-2 text-[12px] font-bold text-gray-700 flex justify-between items-center">
									<span>{categoryKey}</span>
									<span class="text-[10px] font-normal text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">{items.length} item</span>
								</div>
								
								<!-- Tabel Padat -->
								<div class="overflow-x-auto">
									<table class="w-full text-left border-collapse">
										<thead>
											<tr class="bg-gray-50 text-[10px] text-gray-500 uppercase tracking-wider border-b border-gray-200">
												<th class="py-1.5 px-3 font-semibold">Nama Item</th>
												<th class="py-1.5 px-2 font-semibold w-16 text-center">Qty</th>
												<th class="py-1.5 px-2 font-semibold w-16">Satuan</th>
												<th class="py-1.5 px-3 font-semibold w-24">Keterangan</th>
											</tr>
										</thead>
										<tbody>
											{#each items as item}
												{@const qty = item.id != null ? (templateQtyMap[item.id] || 0) : 0}
												{@const isSelected = qty > 0}
												<tr class="border-b border-gray-100 last:border-0 transition-colors
														   {isSelected ? 'bg-[var(--gl)]/30' : 'hover:bg-gray-50'}">
													<td class="py-1 px-3">
														<div class="text-[11px] font-medium text-gray-800 {isSelected ? 'text-[var(--gd)]' : ''} leading-tight">
															{item.material_name || item.description || 'Nama Tidak Tersedia'}
														</div>
														{#if item.material_color}
															<div class="text-[9px] text-gray-400">{item.material_color}</div>
														{/if}
													</td>
													<td class="py-1 px-1">
														<input type="number" min="0" step="1"
															   value={qty || ''} placeholder="0"
															   oninput={(e) => item.id != null && setQty(item.id, parseFloat((e.target as HTMLInputElement).value) || 0)}
															   class="w-full text-center py-1 text-[12px] font-semibold border rounded outline-none transition-colors
																	  {isSelected ? 'border-[var(--g)] text-[var(--gd)] bg-white' : 'border-gray-200 text-gray-600 bg-white focus:border-[var(--g)]'}" />
													</td>
													<td class="py-1 px-2 text-[10px] text-gray-500">
														{item.unit}
													</td>
													<td class="py-1 px-2">
														<input type="text"
															   value={item.id != null ? (templateNotesMap[item.id] || '') : ''}
															   oninput={(e) => item.id != null && setNotes(item.id, (e.target as HTMLInputElement).value)}
															   placeholder="..."
															   class="w-full text-[10px] py-1 px-1.5 border border-transparent hover:border-gray-200 focus:border-[var(--g)] focus:bg-white rounded outline-none transition-colors bg-transparent" />
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							</div>
						{/each}
					</div>
				{/if}

			{:else if activeTab === 'rab'}
				<!-- RAB Dense Grid View -->
				{#if loadingRab}
					<div class="py-8 text-center">
						<CircularProgressGauge
							compact={true}
							stepLabel="Memuat item RAP / RAB proyek..."
							subLabel="Mengambil alokasi kebutuhan proyek Directus"
						/>
					</div>
				{:else if filteredRab.length === 0}
					<div class="text-center py-12 text-gray-400 text-[13px]">Tidak ada item RAB tersedia.</div>
				{:else}
					<div class="p-3 sticky top-0 z-10 bg-slate-50/90 backdrop-blur-sm border-b border-gray-100">
						<button class="inline-flex items-center gap-2 py-1.5 px-3 rounded-lg bg-white border border-gray-300 shadow-sm hover:border-[var(--g)] cursor-pointer text-[12px] font-semibold text-gray-700 transition-colors"
								onclick={toggleAllRab}>
							<div class="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors
										{selectedRab.size === filteredRab.length && filteredRab.length > 0 ? 'bg-[var(--g)] border-[var(--g)]' : 'border-gray-300 bg-white'}">
								{#if selectedRab.size === filteredRab.length && filteredRab.length > 0}<IconCheck size={10} class="text-white" />{/if}
							</div>
							Pilih semua ({filteredRab.length})
						</button>
					</div>
					
					{@const data = groupedRab()}
					<div class="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
						{#each data.sortedKeys as categoryKey}
							{@const items = data.groups[categoryKey]}
							<div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm h-fit">
								<div class="bg-gray-100 border-b border-gray-200 px-3 py-2 text-[12px] font-bold text-gray-700 flex justify-between items-center">
									<span>{categoryKey}</span>
									<span class="text-[10px] font-normal text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">{items.length} item</span>
								</div>
								<div class="overflow-x-auto">
									<table class="w-full text-left border-collapse">
										<thead>
											<tr class="bg-gray-50 text-[10px] text-gray-500 uppercase tracking-wider border-b border-gray-200">
												<th class="py-1.5 px-3 font-semibold w-8 text-center">Pilih</th>
												<th class="py-1.5 px-2 font-semibold">Nama Item</th>
												<th class="py-1.5 px-2 font-semibold w-16 text-center">Qty</th>
												<th class="py-1.5 px-2 font-semibold w-16">Satuan</th>
											</tr>
										</thead>
										<tbody>
											{#each items as item}
												{@const isSel = selectedRab.has(item.id)}
												<tr class="border-b border-gray-100 last:border-0 transition-colors cursor-pointer
														   {isSel ? 'bg-[var(--gl)]/30' : 'hover:bg-gray-50'}"
													onclick={() => toggleRab(item.id)}>
													<td class="py-1 px-3 text-center" onclick={e => e.stopPropagation()}>
														<button class="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors mx-auto
																	{isSel ? 'bg-[var(--g)] border-[var(--g)]' : 'border-gray-300 bg-white hover:border-[var(--g)]'}"
																onclick={() => toggleRab(item.id)}>
															{#if isSel}<IconCheck size={10} class="text-white" />{/if}
														</button>
													</td>
													<td class="py-1 px-2" onclick={() => toggleRab(item.id)}>
														<div class="text-[11px] font-medium text-gray-800 {isSel ? 'text-[var(--gd)]' : ''} leading-tight">
															{item.material_name || item.description || 'Item'}
														</div>
														{#if item.material_color}
															<div class="text-[9px] text-gray-400">{item.material_color}</div>
														{/if}
														<!-- Fase 5 #3: sisa budget RAP baris ini -->
														<div class="text-[9px] {rabSisa(item) > 0 ? 'text-gray-400' : 'text-amber-600 font-semibold'}">
															Sisa RAP: {rabSisa(item)} {item.unit || ''}
															{#if rabOverBudget(item)}
																<span class="text-red-600 font-bold ml-1">⚠ lebih {((Number(item.qty) || 0) - rabSisa(item)).toFixed(0)}</span>
															{/if}
														</div>
													</td>
													<td class="py-1 px-1" onclick={e => e.stopPropagation()}>
														<input type="number" bind:value={item.qty} min="0.1" step="1"
															   class="w-full text-center py-1 text-[12px] font-semibold border rounded outline-none transition-colors
																	  {isSel ? 'border-[var(--g)] text-[var(--gd)] bg-white' : 'border-transparent text-gray-600 bg-transparent hover:border-gray-200 focus:border-[var(--g)] focus:bg-white'}"
															   onfocus={() => !isSel && toggleRab(item.id)} />
													</td>
													<td class="py-1 px-2 text-[10px] text-gray-500">
														{item.unit || ''}
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							</div>
						{/each}
					</div>
				{/if}

			{:else}
				<!-- Manual -->
				<div class="p-4 max-w-3xl mx-auto">
					<!-- Guidance Banner -->
					<div class="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-2xl p-4 mb-4 shadow-sm">
						<div class="flex items-center gap-2 mb-2">
							<div class="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm">
								<IconBulb size={15} />
							</div>
							<h4 class="text-[13px] font-bold text-blue-950">Panduan Penginputan Material Manual</h4>
						</div>
						<div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px] text-blue-900 mt-2">
							<div class="bg-white/80 border border-blue-100 rounded-xl p-2.5 flex items-start gap-2 shadow-2xs">
								<span class="w-4 h-4 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
								<span><strong>Katalog Master:</strong> Ketik nama material untuk memilih item resmi gudang secara otomatis.</span>
							</div>
							<div class="bg-white/80 border border-blue-100 rounded-xl p-2.5 flex items-start gap-2 shadow-2xs">
								<span class="w-4 h-4 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
								<span><strong>Format Standar:</strong> Sertakan merk, jenis, dan ukuran (cth: <em>Thinner PU 5L</em>, <em>Baut M12</em>).</span>
							</div>
							<div class="bg-white/80 border border-blue-100 rounded-xl p-2.5 flex items-start gap-2 shadow-2xs">
								<span class="w-4 h-4 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
								<span><strong>Justifikasi:</strong> Berikan keterangan alasan kebutuhan manual agar approval cepat disetujui.</span>
							</div>
						</div>
					</div>

					<!-- Quick Consumable / Safety Chips -->
					<div class="mb-4 bg-white border border-gray-200 rounded-xl p-3 shadow-2xs">
						<div class="flex items-center justify-between mb-2">
							<span class="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
								<IconSparkles size={14} class="text-amber-500" /> Quick Add Consumable & Safety:
							</span>
							<span class="text-[10px] text-gray-400">Klik untuk tambah instan</span>
						</div>
						<div class="flex flex-wrap gap-1.5">
							{#each quickConsumableChips as chip}
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
					
					{#if manualItems.length === 0}
						<div class="text-center py-8 px-4 bg-white border border-dashed border-gray-300 rounded-2xl mb-4">
							<div class="w-12 h-12 rounded-full bg-gray-100 text-gray-400 mx-auto flex items-center justify-center mb-2">
								<IconPackage size={24} />
							</div>
							<div class="text-[13px] font-bold text-gray-700">Belum ada barang manual</div>
							<p class="text-[11px] text-gray-400 mt-1 max-w-sm mx-auto">Gunakan tombol Quick Add di atas atau klik tombol di bawah untuk menambah barang secara manual.</p>
						</div>
					{/if}

					{#each manualItems as item, i}
						{@const duplicateInfo = getDuplicateWarning(item.material_name)}
						<div class="border border-gray-200 rounded-xl p-3.5 mb-3.5 bg-white shadow-sm transition-all hover:border-gray-300">
							<div class="flex justify-between items-center mb-3 pb-2 border-b border-gray-100">
								<div class="flex items-center gap-2">
									<span class="px-2 py-0.5 rounded-md bg-gray-100 text-[11px] font-bold text-gray-700">Barang #{i + 1}</span>
									{#if item.material_name.trim()}
										<span class="text-[11px] font-semibold text-gray-500 truncate max-w-[220px]">{item.material_name}</span>
									{/if}
								</div>
								<button class="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer border-none transition-colors"
										title="Hapus baris ini"
										onclick={() => manualItems = manualItems.filter((_, idx) => idx !== i)}>
									<IconTrash size={15} />
								</button>
							</div>

							<!-- Row 1: Nama Material & Warna & Kategori -->
							<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
								<!-- Nama Material with Autocomplete -->
								<div class="relative">
									<label class="text-[11px] font-bold text-gray-700 mb-1 flex items-center justify-between">
										<span>Nama Material <span class="text-red-500">*</span></span>
										{#if isSearchingCatalog && activeSuggestRow === i}
											<span class="flex items-center gap-1 text-[10px] text-gray-400 font-normal">
												<IconLoader2 size={10} class="animate-spin text-[var(--g)]" /> Mencari...
											</span>
										{/if}
									</label>
									<input
										type="text"
										class="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-[var(--g)] transition-colors bg-white font-medium"
										value={item.material_name}
										oninput={(e) => onMaterialNameInput(i, (e.target as HTMLInputElement).value)}
										onfocus={() => { if (item.material_name.trim().length >= 2) onMaterialNameInput(i, item.material_name); }}
										placeholder="Cth: CAT PRIMER EPOXY / THINNER PU"
									/>
									
									<!-- Suggestions Dropdown -->
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

									<div class="mt-1 text-[10px] text-gray-400 leading-tight">
										💡 <em>Format: [Jenis Barang] [Merk/Tipe] [Ukuran]</em>
									</div>
								</div>

								<!-- Warna / Kode -->
								<div>
									<label class="text-[11px] font-bold text-gray-700 mb-1 block">Warna / Kode / Part #</label>
									<input
										type="text"
										class="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-[var(--g)] transition-colors bg-white"
										bind:value={item.material_color}
										placeholder="Cth: RAL 7035 / OX-101 / M12"
									/>
									<div class="mt-1 text-[10px] text-gray-400 leading-tight">
										🎨 <em>Kode warna, nomor RAL, atau part no.</em>
									</div>
								</div>

								<!-- Kategori -->
								<div>
									<label class="text-[11px] font-bold text-gray-700 mb-1 block">Kategori Anggaran</label>
									<select bind:value={item.budget_category} class="w-full px-3 py-2 text-[12px] border border-gray-200 rounded-lg outline-none focus:border-[var(--g)] bg-white font-medium text-gray-800">
										<option value="packing_supplier">📦 Material Utama / Supplier (Cat, Thinner)</option>
										<option value="packing_sewa_alat">🚜 Sewa Alat (Genset, Kompresor, Scaff)</option>
										<option value="packing_consumable">🛠️ Consumables (Kuas, Majun, Tape, Amplas)</option>
										<option value="packing_safety">🦺 Safety / APD (Helm, Rompi, Sarung Tangan)</option>
										<option value="packing_operasional">⛽ Operasional (BBM, Transport Lapangan)</option>
										<option value="packing_jasa">👷 Jasa / Subkon (Aplikator, Tukang)</option>
										<option value="packing_lain_lain">📋 Lain-Lain</option>
									</select>
									<div class="mt-1 text-[10px] text-gray-400 leading-tight">
										🏷️ <em>Pilih pos biaya yang sesuai</em>
									</div>
								</div>
							</div>

							<!-- Duplicate Alert if detected -->
							{#if duplicateInfo}
								<div class="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-start gap-2">
									<IconAlertTriangle size={15} class="shrink-0 mt-0.5 text-amber-600" />
									<div>
										<strong>Peringatan Duplikasi:</strong> Item serupa <em>"{duplicateInfo.item}"</em> sudah terdaftar di <strong>{duplicateInfo.type === 'rab' ? 'RAB Proyek' : 'Template Standar'}</strong>.
										Sebaiknya pilih dari tab <strong>{duplicateInfo.type === 'rab' ? '2. Dari RAB' : '1. Dari Template'}</strong> agar budget sinkron dan tidak ganda.
									</div>
								</div>
							{/if}

							<!-- Row 2: Qty, Satuan, Keterangan -->
							<div class="grid grid-cols-1 sm:grid-cols-12 gap-3">
								<div class="sm:col-span-3">
									<label class="text-[11px] font-bold text-gray-700 mb-1 block">Qty <span class="text-red-500">*</span></label>
									<input
										type="number"
										class="w-full px-3 py-2 text-[13px] font-bold text-gray-900 border border-gray-200 rounded-lg outline-none focus:border-[var(--g)] bg-white"
										bind:value={item.qty}
										min="0.1"
										step="0.1"
									/>
									<div class="mt-1 text-[10px] text-gray-400"><em>Jumlah kebutuhan</em></div>
								</div>
								<div class="sm:col-span-3">
									<label class="text-[11px] font-bold text-gray-700 mb-1 block">Satuan</label>
									<select bind:value={item.unit} class="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-[var(--g)] bg-white font-medium">
										{#each unitOptions as u}<option>{u}</option>{/each}
									</select>
									<div class="mt-1 text-[10px] text-gray-400"><em>Satuan baku</em></div>
								</div>
								<div class="sm:col-span-6">
									<label class="text-[11px] font-bold text-gray-700 mb-1 block">Keterangan / Justifikasi Kebutuhan</label>
									<input
										type="text"
										class="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-[var(--g)] transition-colors bg-white"
										bind:value={item.description}
										placeholder="Cth: Kebutuhan mendesak area C / pengganti aus"
									/>
									<div class="mt-1 text-[10px] text-gray-400 leading-tight">
										📝 <em>Tulis alasan pengadaan agar approval cepat</em>
									</div>
								</div>
							</div>
						</div>
					{/each}

					<button class="w-full py-3.5 border-2 border-dashed border-gray-300 hover:border-[var(--g)] rounded-xl text-gray-600 hover:text-[var(--g)] font-bold text-[13px] bg-white hover:bg-[var(--gl)]/20 transition-all cursor-pointer flex justify-center items-center gap-2 shadow-2xs active:scale-[0.99]"
							onclick={() => manualItems = [...manualItems, { material_name: '', material_color: '', qty: 1, unit: 'Kg', description: '', budget_category: 'packing_supplier' }]}>
						<IconPlus size={16} /> Tambah Baris Barang Manual
					</button>
				</div>
			{/if}
			<div class="h-8"></div>
		</div>

		<!-- Footer -->
		<div class="shrink-0 px-4 py-3 border-t border-gray-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
			<div class="flex flex-col md:flex-row justify-between items-center gap-3">
				{#if totalItems > 0}
					<div class="flex items-center gap-2">
						<span class="text-[12px] text-gray-500 font-medium">Siap dikirim:</span>
						{#if tplSelected.length > 0}<span class="px-2.5 py-1 bg-[var(--gl)] text-[var(--gd)] text-[11px] font-bold rounded-lg">{tplSelected.length} dari Template</span>{/if}
						{#if rabSelected.length > 0}<span class="px-2.5 py-1 bg-[var(--gl)] text-[var(--gd)] text-[11px] font-bold rounded-lg">{rabSelected.length} dari RAB</span>{/if}
						{#if manualValid.length > 0}<span class="px-2.5 py-1 bg-[var(--gl)] text-[var(--gd)] text-[11px] font-bold rounded-lg">{manualValid.length} Manual</span>{/if}
					</div>
				{:else}
					<div class="text-[12px] text-gray-400 italic">Pilih barang dengan mengisi angka qty</div>
				{/if}
				
				<button class="w-full md:w-auto px-8 py-2.5 rounded-xl text-white font-bold text-[14px] bg-[var(--g)] hover:bg-[var(--gd)] transition-colors shadow-md shadow-[var(--g)]/30 disabled:opacity-50 disabled:shadow-none cursor-pointer border-none flex items-center justify-center"
						onclick={() => { if (totalItems === 0) { alert('Pilih minimal 1 barang dengan mengisi Qty.'); return; } showConfirm = true; }}
						disabled={submitting || totalItems === 0 || projects.length === 0}>
					Lanjut Konfirmasi ({totalItems})
				</button>
			</div>
		</div>
	</div>
</div>
{/if}

<!-- Confirm Modal -->
{#if showConfirm}
<div class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
	 onclick={() => showConfirm = false}>
	<div class="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onclick={e => e.stopPropagation()}>
		<div class="p-4 border-b border-gray-100 bg-gray-50 flex items-center gap-3">
			<div class="w-10 h-10 rounded-full bg-[var(--gl)] flex items-center justify-center text-[var(--g)]">
				<IconCheck size={24} />
			</div>
			<div>
				<h3 class="text-[16px] font-bold text-gray-800">Konfirmasi Pengajuan</h3>
				<p class="text-[12px] text-gray-500 mt-0.5">Total <strong>{totalItems} item</strong> akan dikirim</p>
			</div>
		</div>
		<div class="p-0 overflow-y-auto bg-white flex-1">
			<table class="w-full text-left text-[11px] md:text-[12px]">
				<thead class="bg-gray-50 sticky top-0">
					<tr class="text-gray-500 uppercase tracking-wider">
						<th class="py-2 px-4 font-semibold border-b">Item</th>
						<th class="py-2 px-4 font-semibold border-b text-right w-24">Qty</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each tplSelected as i}
						<tr class="hover:bg-gray-50">
							<td class="py-2 px-4">
								<div class="font-medium text-gray-800">{i.material_name}</div>
								{#if templateNotesMap[i.id!]}<div class="text-[10px] text-gray-400 italic">Ket: {templateNotesMap[i.id!]}</div>{/if}
							</td>
							<td class="py-2 px-4 text-right font-bold text-[var(--g)]">{templateQtyMap[i.id!]} {i.unit}</td>
						</tr>
					{/each}
					{#each rabSelected as i}
						<tr class="hover:bg-gray-50">
							<td class="py-2 px-4 font-medium text-gray-800">{(i as any).material_name}</td>
							<td class="py-2 px-4 text-right font-bold text-[var(--g)]">{(i as any).qty} {(i as any).unit}</td>
						</tr>
					{/each}
					{#each manualValid as i}
						<tr class="hover:bg-gray-50">
							<td class="py-2 px-4">
								<div class="font-medium text-gray-800">
									{i.material_name}
									<span class="text-[9px] ml-1 px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">Manual</span>
								</div>
								<div class="text-[10px] text-gray-400 font-normal">
									Kategori: {categoryNames[i.budget_category] || i.budget_category || 'TIDAK BERKATEGORI'}
								</div>
							</td>
							<td class="py-2 px-4 text-right font-bold text-[var(--g)]">{i.qty} {i.unit}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="p-4 grid grid-cols-2 gap-3 border-t border-gray-100 bg-gray-50 shrink-0">
			<button class="py-2.5 rounded-xl text-[13px] font-bold text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 cursor-pointer transition-colors"
					onclick={() => showConfirm = false}>Kembali Edit</button>
			<button class="py-2.5 rounded-xl text-[13px] font-bold text-white bg-[var(--g)] hover:bg-[var(--gd)] flex items-center justify-center gap-2 cursor-pointer border-none shadow-md shadow-[var(--g)]/30 transition-all disabled:opacity-50 disabled:shadow-none"
					onclick={processSubmit} disabled={submitting}>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" /> Menyimpan...{:else}<IconCheck size={16} /> Kirim Sekarang{/if}
			</button>
		</div>
	</div>
</div>
{/if}

<GateCompletionWizard
	open={wizardOpen}
	gates={wizardGates}
	title="Kelengkapan Gate Packing List"
	onClose={() => (wizardOpen = false)}
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
