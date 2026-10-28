<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authStore, getUserDisplay } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { fetchMyPengajuan, fetchPengajuanDetail, type PengajuanLapanganItem, type PengajuanSummary } from '$lib/services/procurementApi';
	import { searchIdentitasBarang } from '$lib/services/requisitionApi';
	import { secureDirectusJson } from '$lib/services/secureDirectus';
	import {
		getCategoriesCached,
		getEffectiveFormSchema,
		getRecentCategoryKodes,
		recordRecentCategoryKode,
		type PurchaseCategory
	} from '$lib/services/purchaseCategoryApi';
	import DynamicFieldRenderer from '$lib/components/procurement/DynamicFieldRenderer.svelte';
	import UkbRingkas from '$lib/components/procurement/UkbRingkas.svelte';
	import { getLampiranRules, type LampiranRule } from '$lib/services/attachmentApi';
	import { getProjects } from '$lib/services/projects';
	import { getWorkshopScope, getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { resolveWorkshop } from '$lib/services/workshopRegistry';
	import { getActiveDepartmentNames } from '$lib/services/departmentApi';
	import { createFormPersist } from '$lib/utils/formPersist';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconPlus, IconTrash, IconChevronRight } from '@tabler/icons-svelte';
	import { SectionGuide, FieldHint, HelpIcon } from '$lib/components/hints';
	// Impor modul hint langsung (bukan barrel) — lihat catatan bundling di getHint.ts.
	import { procurementLapanganHints } from '$lib/data/hints/procurementLapangan';
	import { getHint } from '$lib/data/hints/getHint';
	import AtasNamaPanel from '$lib/components/konfirmasi/AtasNamaPanel.svelte';
	import KnowledgeCard from '$lib/components/inventory360/KnowledgeCard.svelte';

	/** Pintasan pembaca hint Procurement Lapangan; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(procurementLapanganHints, key, 'procurementLapangan');

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'submit_pengajuan_pembelian', roles)) {
			goto('/');
		}
	});

	// R1 (Audit Konfigurabilitas Lifecycle, 16 Sep 2026): fallback statis HANYA bila
	// koleksi department gagal dimuat/kosong — departemen baru sekarang otomatis muncul
	// tanpa deploy lewat departmentApi.getActiveDepartmentNames().
	const DEPARTMENTS_FALLBACK = [
		'Accounting', 'Admin', 'Engineering', 'Finance', 'HRGA', 'IT',
		'Inventory', 'Maintenance', 'Marketing', 'Operasional', 'Plant Manager',
		'Procurement', 'Production', 'PROJECT', 'Purchasing', 'QC', 'Sales',
		'Security', 'Warehouse'
	];
	let DEPARTMENTS = $state<string[]>(DEPARTMENTS_FALLBACK);
	$effect(() => {
		getActiveDepartmentNames().then((names) => {
			if (names.length > 0) DEPARTMENTS = names;
		});
	});

	// ==================== LANGKAH 1: KATEGORI ====================
	let step = $state<1 | 2 | 3>(1);
	let categories = $state<PurchaseCategory[]>([]);
	let categoriesLoaded = $state(false);
	let drillParentId = $state<number | null>(null); // kategori level 1 yang sedang di-drill-down
	let selectedKode = $state<string | null>(null);
	let recentKodes = $state<string[]>([]);
	// "Ajukan Ulang" (23 Agu 2026): 5 PR terakhir milik user sendiri, ditampilkan di
	// Langkah 1 sebagai shortcut mengisi ulang form dari pola pengajuan sebelumnya.
	let myRecentPRs = $state<PengajuanSummary[]>([]);
	let loadingRiwayat = $state(false);
	let applyingUlang = $state(false);

	let topLevel = $derived(categories.filter((c) => !c.parent_id));
	let childrenOfDrill = $derived(drillParentId ? categories.filter((c) => c.parent_id === drillParentId) : []);
	let recentCategories = $derived(
		recentKodes.map((k) => categories.find((c) => c.kode === k)).filter(Boolean) as PurchaseCategory[]
	);
	let effectiveSchema = $derived(selectedKode ? getEffectiveFormSchema(categories, selectedKode) : []);
	let selectedCategory = $derived(selectedKode ? categories.find((c) => c.kode === selectedKode) ?? null : null);

	// Fase 0 Penajaman PR (24 Agu 2026): kategori dengan requires_project=true (mis.
	// INV-PRJ, MNT-PRJ) wajib tertaut proyek. Daftar proyek dimuat lazy, hanya saat
	// kategori seperti itu dipilih — mayoritas PR lapangan bukan project-scoped.
	let projects = $state<any[]>([]);
	let loadingProjects = $state(false);
	let selectedProject = $state('');
	// Uji Kebutuhan Beli Fase 4.2: WO auto-created oleh P2H No-Go, diteruskan dari URL.
	let selectedWorkOrderId = $state<string | null>(null);
	let projectRequired = $derived(selectedCategory?.requires_project ?? false);

	// Fase 5 (Pertajam Modul Ciketing & MB v2) — koordinator workshop melihat radio
	// Umum Workshop / PO Tertentu, sama seperti admin. Non-koordinator: form standar
	// tanpa perubahan (workshopScope kosong).
	let workshopScope = $derived(getWorkshopScope());
	let bebanPR = $state<'po' | 'umum'>('po');
	let resolvedWorkshopId = $state<number | null>(null);
	$effect(() => {
		const ws = workshopScope[0];
		if (!ws) { resolvedWorkshopId = null; return; }
		resolveWorkshop(ws).then((w) => { resolvedWorkshopId = w?.id ?? null; });
	});

	// Lampiran Otomatis PR v2 (Fase 5): pratinjau non-blocking daftar lampiran yang
	// akan diminta kategori ini — ditampilkan di Langkah 3. PR belum dibuat, jadi
	// belum ada unggahan di sini; unggah dilakukan setelah PR jadi (LampiranMobile).
	let lampiranRulesPreview = $state<LampiranRule[]>([]);
	let lampiranRulesLoadedFor = $state<string | null>(null);
	$effect(() => {
		if (step !== 3 || !selectedKode || lampiranRulesLoadedFor === selectedKode) return;
		const kode = selectedKode;
		lampiranRulesLoadedFor = kode;
		getLampiranRules(kode)
			.then((r) => { lampiranRulesPreview = r; })
			.catch(() => { lampiranRulesPreview = []; });
	});

	$effect(() => {
		// Kolom Proyek Terkait SELALU tampil (opsional bila kategori tak mewajibkan) — dibutuhkan juga untuk
		// Pengajuan Atas Nama. Daftar proyek baru dimuat setelah kategori dipilih (hemat API).
		const needsProjects = !!selectedKode || projectRequired || workshopScope.length > 0;
		if (!needsProjects || projects.length > 0 || loadingProjects) return;
		loadingProjects = true;
		// Fase 5 — koordinator workshop: daftar proyek sudah ter-scope ke workshopnya
		// (getProjectsForCurrentUser), bukan seluruh proyek tanpa filter.
		const loader = workshopScope.length > 0
			? getProjectsForCurrentUser(true)
			: getProjects(null, true, $authStore.directusToken);
		loader
			.then((res) => { projects = res || []; })
			.finally(() => { loadingProjects = false; });
	});

	$effect(() => {
		(async () => {
			categories = await getCategoriesCached();
			categoriesLoaded = true;
			recentKodes = getRecentCategoryKodes();
			// Datang dari kartu "Kategori Favorit" di Pusat Pengajuan (?kategori=KODE) —
			// langsung pilih kategori itu dan lompat ke Langkah 2, tak perlu klik ulang.
			const kodeFromUrl = page.url.searchParams.get('kategori');
			if (kodeFromUrl) {
				const cat = categories.find((c) => c.kode === kodeFromUrl);
				if (cat) pickCategory(cat);
			}

			// Uji Kebutuhan Beli Fase 4.2: datang dari tombol "Ajukan Sparepart untuk
			// Unit Ini" di P2H No-Go (?work_order_id=&equipment=&keluhan=) — prefill
			// WO + tujuan + department supaya kategori benar sejak lahir (bukan ETC).
			const woFromUrl = page.url.searchParams.get('work_order_id');
			if (woFromUrl) {
				selectedWorkOrderId = woFromUrl;
				department = 'Maintenance';
				const equipmentName = page.url.searchParams.get('equipment') || '';
				const keluhan = page.url.searchParams.get('keluhan') || '';
				tujuanPengajuan = `Sparepart hasil P2H No-Go${equipmentName ? ` — Unit ${equipmentName}` : ''}${keluhan ? `: ${keluhan}` : ''}`;
			}
		})();
	});

	$effect(() => {
		const namaPengajuAwal = getUserDisplay($authStore.user);
		if (!namaPengajuAwal) return;
		loadingRiwayat = true;
		fetchMyPengajuan(namaPengajuAwal)
			.then((rows) => { myRecentPRs = rows.slice(0, 5); })
			.finally(() => { loadingRiwayat = false; });
	});

	async function ajukanUlang(id: number) {
		applyingUlang = true;
		try {
			const detail = await fetchPengajuanDetail(id);
			if (!detail) { errorMsg = 'Gagal memuat PR sebelumnya'; return; }
			department = detail.department || '';
			urgency = detail.urgency || 'Normal';
			tujuanPengajuan = detail.tujuan_pengajuan || '';
			isNonStock = !!detail.is_non_stock;
			customFieldsData = detail.custom_fields_data ? { ...detail.custom_fields_data } : {};
			if (detail.items?.length) {
				items = detail.items.map((it) => ({ ...it }));
			}
			if (detail.kategori_pembelian) {
				selectedKode = detail.kategori_pembelian;
				recordRecentCategoryKode(detail.kategori_pembelian);
			} else {
				selectedKode = null;
			}
			step = 2;
		} finally {
			applyingUlang = false;
		}
	}

	function pickCategory(cat: PurchaseCategory) {
		const hasChildren = categories.some((c) => c.parent_id === cat.id);
		if (hasChildren) {
			drillParentId = cat.id;
			return;
		}
		selectedKode = cat.kode;
		if (cat.is_non_stock_default) isNonStock = true;
		selectedProject = '';
		recordRecentCategoryKode(cat.kode);
		restoreDraftForCategory(cat.kode);
		step = 2;
	}

	// ==================== LANGKAH 2: DETAIL ====================
	let namaPengaju = $state(getUserDisplay($authStore.user));
	let department = $state('');
	let urgency = $state('Normal');
	// Pengajuan Darurat Atas Nama (Leader/Wakil proyek / Supervisor) — hak ditentukan server, lihat AtasNamaPanel.
	let atasNama = $state(false);
	let atasNamaAlasan = $state('');
	let atasNamaPemohonId = $state<number | null>(null);
	let atasNamaPemohonNama = $state('');
	let tujuanPengajuan = $state('');
	let tanggalDibutuhkan = $state('');
	let isNonStock = $state(false);
	// Fase 3 Kontrol Patroli (15 Sep 2026): kaitkan pengajuan ke ruangan (opsional) —
	// dasar gerbang GATE.CHECKLIST.AREA_NOT_DONE (hold ATK/RTK bila checklist area gagal).
	let areaId = $state<string>('');
	let gaAreasList = $state<{ id: number; area_name: string }[]>([]);
	onMount(async () => {
		try {
			const { fetchGaAreasSimple } = await import('$lib/services/security');
			gaAreasList = await fetchGaAreasSimple();
		} catch (err) {
			console.error('[ajukan] gagal memuat daftar ruangan:', err);
		}
	});
	// Fase 0 Penajaman PR (24 Agu 2026, T1): field UI-only tambahan di luar payload submit
	// (searchQuery/searchResults/dst) untuk pencarian & katup pendaftaran barang master.
	type ItemRow = PengajuanLapanganItem & {
		searchQuery?: string;
		searchResults?: any[];
		searching?: boolean;
		kode_item?: string | null;
		pending_registration?: boolean;
		register_open?: boolean;
		register_nama?: string;
		register_satuan?: string;
		register_parent_category?: number | null;
		registering?: boolean;
	};
	function newItemRow(): ItemRow {
		return { nama_barang: '', quantity: 1, units: 'Pcs', harga: null, searchQuery: '', searchResults: [], searching: false };
	}
	let items = $state<ItemRow[]>([newItemRow()]);

	// Kategori stok (INV*) wajib tautan barang master — sama seperti Admin
	// (AjukanPengajuanModal.svelte). Mode teks bebas dimatikan untuk kategori ini.
	let itemLinkRequired = $derived(!!selectedCategory?.kode?.startsWith('INV'));

	let parentCategories = $state<any[]>([]);
	let loadingParentCategories = $state(false);
	async function loadParentCategoriesOnce() {
		if (parentCategories.length > 0 || loadingParentCategories) return;
		loadingParentCategories = true;
		try {
			const json = await secureDirectusJson<any>('/items/parent_category?filter[is_active][_eq]=true&sort=parent_category&limit=-1');
			parentCategories = json?.data || [];
		} catch {
			parentCategories = [];
		} finally {
			loadingParentCategories = false;
		}
	}

	let searchTimers: Record<number, ReturnType<typeof setTimeout>> = {};
	function onSearchBarang(idx: number) {
		clearTimeout(searchTimers[idx]);
		const row = items[idx];
		if (!row) return;
		row.identitas_barang_id = null;
		if (!itemLinkRequired) row.nama_barang = row.searchQuery || '';
		items = [...items];
		if (!row.searchQuery || row.searchQuery.trim().length < 2) {
			row.searchResults = [];
			items = [...items];
			return;
		}
		searchTimers[idx] = setTimeout(async () => {
			row.searching = true;
			items = [...items];
			try {
				row.searchResults = await searchIdentitasBarang(row.searchQuery || '');
			} catch {
				row.searchResults = [];
			} finally {
				row.searching = false;
				items = [...items];
			}
		}, 300);
	}

	function pickBarang(idx: number, barang: any) {
		const row = items[idx];
		row.identitas_barang_id = barang.id;
		row.nama_barang = barang.nama_barang_lengkap;
		row.units = barang.satuan || row.units;
		row.kode_item = barang.kode_item || null;
		row.pending_registration = false;
		row.searchQuery = barang.nama_barang_lengkap;
		row.searchResults = [];
		row.register_open = false;
		items = [...items];
	}

	function clearBarang(idx: number) {
		const row = items[idx];
		row.identitas_barang_id = null;
		row.kode_item = null;
		row.pending_registration = false;
		row.nama_barang = '';
		row.searchQuery = '';
		items = [...items];
	}

	function openRegisterForm(idx: number) {
		const row = items[idx];
		row.register_open = true;
		row.register_nama = row.searchQuery || '';
		row.register_satuan = row.units || 'Pcs';
		row.register_parent_category = null;
		row.searchResults = [];
		items = [...items];
		loadParentCategoriesOnce();
	}

	function closeRegisterForm(idx: number) {
		items[idx].register_open = false;
		items = [...items];
	}

	async function submitRegisterBarang(idx: number) {
		const row = items[idx];
		const nama = (row.register_nama || '').trim();
		const satuan = (row.register_satuan || '').trim();
		if (!nama) { errorMsg = 'Nama barang wajib diisi'; return; }
		if (!satuan) { errorMsg = 'Satuan wajib diisi'; return; }
		errorMsg = '';
		row.registering = true;
		items = [...items];
		try {
			const token = await getIdToken();
			const res = await fetch('/api/inventory/daftar-barang-cepat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ nama_barang_lengkap: nama, satuan, parent_category: row.register_parent_category || null })
			});
			const json = await res.json();
			if (!res.ok || !json.success) {
				errorMsg = json.message || 'Gagal mendaftarkan barang baru';
				return;
			}
			pickBarang(idx, json.data);
			row.pending_registration = true;
			items = [...items];
		} catch (e: any) {
			errorMsg = 'Error: ' + e.message;
		} finally {
			row.registering = false;
			items = [...items];
		}
	}
	let customFieldsData = $state<Record<string, any>>({});

	let submitting = $state(false);
	let errorMsg = $state('');
	let successInfo = $state<{ id: number } | null>(null);
	// Idempotensi (Fase 0/B5): dibuat sekali saat form dibuka, dipakai untuk semua
	// percobaan submit termasuk retry setelah gagal — tombol dikunci saat submitting
	// jadi double-tap tidak mungkin, tapi ini melindungi dari retry jaringan juga.
	let clientTxnId = crypto.randomUUID();

	let needsStockGate = $derived(true);

	// Draf per kategori (Fase 3): kunci draf memuat kode kategori supaya ganti kategori
	// tidak mewarisi isian custom field lama yang tak relevan.
	function draftKeyFor(kode: string | null) {
		return `procurement-pr-ajukan:${kode || 'none'}`;
	}
	function restoreDraftForCategory(kode: string | null) {
		const persist = createFormPersist<any>(draftKeyFor(kode));
		const draft = persist.restore();
		if (draft) {
			namaPengaju = draft.namaPengaju ?? namaPengaju;
			department = draft.department ?? department;
			urgency = draft.urgency ?? urgency;
			tujuanPengajuan = draft.tujuanPengajuan ?? tujuanPengajuan;
			tanggalDibutuhkan = draft.tanggalDibutuhkan ?? tanggalDibutuhkan;
			isNonStock = draft.isNonStock ?? isNonStock;
			items = draft.items?.length ? draft.items : items;
			customFieldsData = draft.customFieldsData || {};
		} else {
			customFieldsData = {};
		}
	}
	$effect(() => {
		if (step !== 2) return;
		const persist = createFormPersist<any>(draftKeyFor(selectedKode));
		persist.save({ namaPengaju, department, urgency, tujuanPengajuan, tanggalDibutuhkan, isNonStock, items, customFieldsData });
	});

	function addItem() {
		items = [...items, newItemRow()];
	}

	function removeItem(idx: number) {
		if (items.length <= 1) return;
		items = items.filter((_, i) => i !== idx);
	}

	function goToReview() {
		errorMsg = '';
		if (!selectedKode) { errorMsg = 'Kategori pembelian wajib dipilih'; return; }
		if (projectRequired && !selectedProject) { errorMsg = `Untuk kategori ${selectedCategory?.nama || 'ini'}, Proyek Terkait wajib dipilih`; return; }
		if (workshopScope.length > 0 && bebanPR === 'po' && !selectedProject) { errorMsg = 'Pilih PO tujuan terlebih dahulu'; return; }
		if (!namaPengaju.trim()) { errorMsg = 'Nama pengaju wajib diisi'; return; }
		if (atasNama && (!selectedProject || !atasNamaPemohonId || atasNamaAlasan.trim().length < 10)) { errorMsg = 'Pengajuan atas nama: pilih Proyek Terkait, pilih pemohon (anggota proyek), dan isi alasan darurat minimal 10 karakter.'; return; }
		if (!department.trim()) { errorMsg = 'Departemen wajib diisi'; return; }
		if (!tujuanPengajuan.trim()) { errorMsg = 'Tujuan pengajuan wajib diisi'; return; }
		const validItems = items.filter((it) => it.nama_barang.trim() && it.quantity > 0);
		if (validItems.length === 0) { errorMsg = 'Minimal 1 item harus diisi lengkap'; return; }
		if (itemLinkRequired && validItems.some((it) => !it.identitas_barang_id)) {
			errorMsg = `Kategori "${selectedCategory?.nama || ''}" wajib tautkan barang dari master — pilih dari hasil pencarian atau "Ajukan Pendaftaran" bila belum ada.`;
			return;
		}
		for (const f of effectiveSchema) {
			if (f.required && !customFieldsData[f.key] && f.type !== 'boolean') {
				errorMsg = `Field "${f.label || f.key}" wajib diisi`;
				return;
			}
		}
		step = 3;
	}

	// ==================== LANGKAH 3: SUBMIT ====================
	async function handleSubmit() {
		errorMsg = '';
		const validItems = items.filter((it) => it.nama_barang.trim() && it.quantity > 0);

		submitting = true;
		try {
			const token = await getIdToken();
			const res = await fetch('/api/procurement/pengajuan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					namaPengaju: namaPengaju.trim(),
					department: department.trim(),
					urgency,
					tujuanPengajuan: tujuanPengajuan.trim(),
					tanggalDibutuhkan: tanggalDibutuhkan || null,
					isNonStock,
					items: validItems,
					clientTxnId,
					kategoriPembelian: selectedKode,
					// Fase 5 — Umum Workshop: project_id null. PO Tertentu / kategori requires_project
					// / konteks non-workshop lama: tak berubah, project_id terisi bila dipilih.
					projectId: (workshopScope.length > 0 && bebanPR === 'umum') ? null : (selectedProject ? Number(selectedProject) : null),
					workshopId: workshopScope.length > 0 && bebanPR === 'umum' ? resolvedWorkshopId : null,
					customFieldsData: Object.keys(customFieldsData).length ? customFieldsData : null,
					workOrderId: selectedWorkOrderId || null,
					areaId: areaId ? Number(areaId) : null,
					// Atas Nama: server mengotorisasi ulang & mengambil nama pemohon dari data karyawan.
					atasNama: atasNama ? { pemohonKaryawanId: atasNamaPemohonId, alasan: atasNamaAlasan.trim() } : undefined
				})
			});
			const json = await res.json().catch(() => ({}));
			if (res.ok && json.success && json.id) {
				successInfo = { id: json.id };
				createFormPersist(draftKeyFor(selectedKode)).clear();
			} else {
				errorMsg = json.error || json.message || 'Gagal mengajukan pembelian';
			}
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal mengajukan pembelian';
		} finally {
			submitting = false;
		}
	}

	const FIELD_TYPE_LABELS: Record<string, string> = {
		text: 'Teks', textarea: 'Teks', number: 'Angka', currency: 'Rupiah',
		date: 'Tanggal', select: 'Pilihan', boolean: 'Ya/Tidak', image: 'Foto', lookup: 'Cari Data'
	};
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm px-4 py-3 flex items-center gap-3">
		<button
			onclick={() => {
				if (successInfo) return goto('/procurement');
				if (step === 1) return goto('/procurement');
				if (step === 2) { drillParentId = null; step = 1; return; }
				step = 2;
			}}
			class="p-2 -ml-2 rounded-full hover:bg-slate-100"
		>
			<IconArrowLeft size={20} />
		</button>
		<h1 class="text-base font-bold" style="color: var(--sys-label)">Ajukan Pembelian</h1>
		{#if !successInfo}
			<span class="ml-auto text-xs font-semibold" style="color: var(--sys-label3)">Langkah {step}/3</span>
		{/if}
	</div>

	<div class="flex-1 overflow-y-auto px-4 py-6 pb-24">
		<div class="max-w-xl mx-auto w-full">
			{#if successInfo}
				<div class="glass-panel rounded-2xl p-6 text-center border border-white/50 shadow-sm">
					<IconCircleCheck size={40} class="mx-auto mb-3 text-emerald-500" />
					<p class="text-base font-bold mb-1" style="color: var(--sys-label)">Pengajuan #{successInfo.id} berhasil dikirim</p>
					<p class="text-xs mb-4" style="color: var(--sys-label3)">
						{needsStockGate
							? 'Menunggu review stok Inventory sebelum diteruskan ke approval.'
							: 'Langsung masuk antrian approval.'}
					</p>
					<button
						class="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold"
						onclick={() => goto('/procurement')}
					>Kembali ke Menu</button>
				</div>

			{:else if step === 1}
				<SectionGuide
					id="procurementLapangan.ajukan.page"
					title={h('ajukan.page').sectionGuide?.title}
					steps={h('ajukan.page').sectionGuide?.steps ?? []}
				/>
				<p class="text-sm font-semibold mb-3" style="color: var(--sys-label)">Pilih Kategori Pembelian</p>

				{#if !categoriesLoaded}
					<div class="text-center py-8 text-sm" style="color: var(--sys-label3)">Memuat kategori...</div>
				{:else}
					{#if drillParentId === null}
						{#if myRecentPRs.length > 0}
							<p class="text-xs font-semibold mb-1.5" style="color: var(--sys-label3)">Riwayat Saya — Ajukan Ulang</p>
							<div class="space-y-2 mb-4">
								{#each myRecentPRs as pr (pr.id)}
									<button
										onclick={() => ajukanUlang(pr.id)}
										disabled={applyingUlang}
										class="w-full glass-panel rounded-xl p-3 border border-white/50 shadow-sm flex items-center justify-between text-left hover:border-blue-300 disabled:opacity-50"
									>
										<div class="min-w-0 flex-1">
											<p class="text-xs font-semibold truncate" style="color: var(--sys-label)">{pr.tujuan_pengajuan}</p>
											<p class="text-[11px]" style="color: var(--sys-label3)">{pr.department} · {pr.status}</p>
										</div>
										<span class="text-[11px] font-semibold text-blue-600 shrink-0 ml-2">🔁 Ulang</span>
									</button>
								{/each}
							</div>
						{:else if loadingRiwayat}
							<p class="text-xs mb-4" style="color: var(--sys-label4)">Memuat riwayat...</p>
						{/if}

						{#if recentCategories.length > 0}
							<p class="text-xs font-semibold mb-1.5" style="color: var(--sys-label3)">Sering dipakai</p>
							<div class="flex flex-wrap gap-2 mb-4">
								{#each recentCategories as cat (cat.id)}
									<button onclick={() => pickCategory(cat)} class="px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-700">
										{cat.icon || '🛒'} {cat.nama}
									</button>
								{/each}
							</div>
						{/if}

						<div class="grid grid-cols-2 gap-3">
							{#each topLevel as cat (cat.id)}
								<button
									onclick={() => pickCategory(cat)}
									class="glass-panel rounded-2xl p-4 border border-white/50 shadow-sm text-left flex flex-col items-start gap-1 hover:border-blue-300"
								>
									<span class="text-2xl">{cat.icon || '🛒'}</span>
									<span class="text-sm font-bold" style="color: var(--sys-label)">{cat.nama}</span>
									{#if cat.description}<span class="text-[11px]" style="color: var(--sys-label3)">{cat.description}</span>{/if}
								</button>
							{/each}
						</div>
					{:else}
						{@const parent = categories.find((c) => c.id === drillParentId)}
						<button onclick={() => (drillParentId = null)} class="text-xs font-semibold text-blue-600 mb-3">← Kembali</button>
						<p class="text-xs font-semibold mb-2" style="color: var(--sys-label3)">{parent?.nama} — pilih sub-kategori</p>
						<div class="space-y-2">
							{#each childrenOfDrill as child (child.id)}
								<button
									onclick={() => pickCategory(child)}
									class="w-full glass-panel rounded-xl p-3 border border-white/50 shadow-sm flex items-center justify-between text-left hover:border-blue-300"
								>
									<span class="flex items-center gap-2 text-sm font-semibold" style="color: var(--sys-label)">
										{child.icon || '🛒'} {child.nama}
									</span>
									<IconChevronRight size={16} style="color: var(--sys-label3)" />
								</button>
							{/each}
						</div>
					{/if}

					<p class="w-full mt-5 text-[11px] text-center" style="color: var(--sys-label4)">ⓘ Kategori wajib dipilih — menentukan gerbang pemeriksaan & field tambahan yang berlaku.</p>
				{/if}

			{:else if step === 2}
				<div class="glass-panel rounded-2xl p-5 border border-white/50 shadow-sm space-y-4">
					{#if selectedKode}
						<div class="flex items-center justify-between rounded-xl p-2.5 bg-blue-50 border border-blue-200">
							<span class="text-xs font-semibold text-blue-700">Kategori: {categories.find((c) => c.kode === selectedKode)?.nama}</span>
							<button onclick={() => { drillParentId = null; step = 1; }} class="text-[11px] text-blue-600 underline">Ganti</button>
						</div>
					{/if}

					{#if selectedWorkOrderId}
						<div class="rounded-xl p-2.5 bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800">
							🔧 Tertaut ke Work Order #{selectedWorkOrderId} (dari hasil P2H No-Go) — biaya sparepart ini akan menempel ke perbaikan unit yang benar.
						</div>
					{/if}

					{#if workshopScope.length > 0}
						<!-- Fase 5 (Pertajam Modul Ciketing & MB v2) — koordinator workshop -->
						<div>
							<label class="block text-xs font-semibold mb-1" style="color: var(--sys-label3)">Alokasi Workshop</label>
							<div class="grid grid-cols-2 gap-2">
								<button
									type="button"
									onclick={() => (bebanPR = 'po')}
									class="p-2.5 rounded-xl border text-left text-xs {bebanPR === 'po' ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}"
								>
									<span class="font-bold">📋 PO Tertentu</span><br />Material milik satu PO.
								</button>
								<button
									type="button"
									onclick={() => (bebanPR = 'umum')}
									class="p-2.5 rounded-xl border text-left text-xs {bebanPR === 'umum' ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}"
								>
									<span class="font-bold">🏭 Umum Workshop</span><br />Consumable/operasional bersama.
								</button>
							</div>
						</div>
					{/if}

					{#if !(workshopScope.length > 0 && bebanPR === 'umum')}
						<div>
							<label for="f-proyek" class="block text-xs font-semibold mb-1" style="color: var(--sys-label3)">Proyek Terkait{projectRequired || (workshopScope.length > 0 && bebanPR === 'po') ? ' *' : ' (opsional)'}</label>
							<select id="f-proyek" bind:value={selectedProject} class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm">
								<option value="">{loadingProjects ? 'Memuat daftar proyek...' : (projectRequired || (workshopScope.length > 0 && bebanPR === 'po') ? '— Pilih Proyek —' : '— Tanpa proyek —')}</option>
								{#each projects as p}<option value={String(p.id)}>{p.name} (ID-{p.id})</option>{/each}
							</select>
							<p class="text-[11px] mt-1" style="color: var(--sys-label4)">
								{#if projectRequired}ⓘ Kategori "{selectedCategory?.nama}" wajib tertaut proyek supaya biaya masuk pagu RAB proyek yang benar.
								{:else if workshopScope.length > 0}ⓘ Hanya PO workshop yang masih berjalan ditampilkan.
								{:else}ⓘ Opsional. Pilih proyek bila pembelian ini untuk proyek tertentu (biaya masuk pagu RAB) atau bila Anda mengajukan atas nama anggota proyek.{/if}
							</p>
						</div>
					{:else if workshopScope.length > 0 && bebanPR === 'umum'}
						<p class="text-[11px]" style="color: var(--sys-label4)">
							💡 Beban dicatat sebagai Umum Workshop — tidak dialokasikan ke satu proyek.
						</p>
					{/if}

					<AtasNamaPanel
						projectId={selectedProject ? Number(selectedProject) : null}
						bind:enabled={atasNama}
						bind:alasan={atasNamaAlasan}
						bind:pemohonId={atasNamaPemohonId}
						bind:pemohonNama={atasNamaPemohonNama}
						jenisLabel="pengajuan pembelian (PR)"
					/>

					<div>
						<label for="f-nama-pengaju" class="block text-xs font-semibold mb-1" style="color: var(--sys-label3)">Nama Pengaju</label>
						<input id="f-nama-pengaju" type="text" bind:value={namaPengaju} class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
					</div>

					<div>
						<label for="f-department" class="block text-xs font-semibold mb-1" style="color: var(--sys-label3)">Departemen *</label>
						<select id="f-department" bind:value={department} class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm">
							<option value="">Pilih departemen...</option>
							{#each DEPARTMENTS as d}<option value={d}>{d}</option>{/each}
						</select>
						<FieldHint text={h('ajukan.form.departemen').fieldHint} />
					</div>

					{#if needsStockGate}
						<div class="rounded-xl p-3 bg-amber-50 border border-amber-200 text-xs text-amber-800">
							{h('ajukan.status.reviewStok').explain}
						</div>
					{/if}

					<div>
						<label class="flex items-start gap-2 rounded-xl p-3 bg-slate-50 border border-slate-200">
							<input type="checkbox" bind:checked={isNonStock} class="mt-0.5" />
							<span class="text-xs" style="color: var(--sys-label2)">
								Ini pengajuan jasa/non-stok (misal: jasa perbaikan, sewa) — lewati cek stok gudang.
							</span>
							<HelpIcon text={h('ajukan.form.nonStok').helpIcon} position="left" />
						</label>
						<FieldHint text={h('ajukan.form.nonStok').fieldHint} />
					</div>

					<div>
						<label for="f-urgency" class="text-xs font-semibold mb-1 inline-flex items-center gap-1.5" style="color: var(--sys-label3)">
							Urgensi<HelpIcon text={h('ajukan.form.urgensi').helpIcon} position="bottom" />
						</label>
						<select id="f-urgency" bind:value={urgency} class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm">
							<option value="Normal">Normal</option>
							<option value="Kloter">Kloter</option>
							<option value="Urgent">Urgent</option>
							<option value="Very Urgent">Very Urgent</option>
						</select>
						<FieldHint text={h('ajukan.form.urgensi').fieldHint} />
					</div>

					<div>
						<label for="f-tujuan" class="block text-xs font-semibold mb-1" style="color: var(--sys-label3)">Tujuan Pengajuan *</label>
						<input id="f-tujuan" type="text" bind:value={tujuanPengajuan} placeholder="Contoh: Perbaikan kompressor" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
						<FieldHint
							text={h('ajukan.form.tujuan').fieldHint}
							type={h('ajukan.form.tujuan').type}
						/>
					</div>

					<div>
						<label for="f-area" class="block text-xs font-semibold mb-1" style="color: var(--sys-label3)">Untuk Ruangan (opsional)</label>
						<select id="f-area" bind:value={areaId} class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm">
							<option value="">— Tidak terkait ruangan tertentu —</option>
							{#each gaAreasList as a}
								<option value={String(a.id)}>{a.area_name}</option>
							{/each}
						</select>
						<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Isi bila pengajuan ini untuk kebutuhan ruangan tertentu (mis. ATK/RTK toilet, pantry). Bila checklist kebersihan ruangan itu belum dicek/gagal hari ini, pengajuan tetap terkirim tapi ditandai untuk ditinjau.</p>
					</div>

					<div>
						<label for="f-tanggal" class="block text-xs font-semibold mb-1" style="color: var(--sys-label3)">Tanggal Dibutuhkan</label>
						<input id="f-tanggal" type="date" bind:value={tanggalDibutuhkan} class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
						<FieldHint text={h('ajukan.form.tanggalDibutuhkan').fieldHint} />
					</div>

					<DynamicFieldRenderer schema={effectiveSchema} bind:values={customFieldsData} />

					<div>
						<div class="flex items-center justify-between mb-2">
							<span class="text-xs font-semibold" style="color: var(--sys-label3)">Item Belanja *</span>
							<button onclick={addItem} class="flex items-center gap-1 text-xs font-semibold text-blue-600">
								<IconPlus size={14} /> Tambah
							</button>
						</div>
						<FieldHint
							text={h('ajukan.form.item').fieldHint}
							type={h('ajukan.form.item').type}
						/>
						<div class="space-y-3">
							{#each items as item, idx}
								<div class="rounded-xl border border-slate-200 p-3 space-y-2 relative">
									{#if items.length > 1}
										<button
											onclick={() => removeItem(idx)}
											class="absolute top-2 right-2 p-1 rounded-full hover:bg-red-50 text-red-500"
										><IconTrash size={14} /></button>
									{/if}
									{#if item.identitas_barang_id}
										<!-- Selected View -->
										<div class="flex items-center justify-between px-3 py-2 rounded-lg border {item.pending_registration ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'}">
											<div class="flex flex-col overflow-hidden">
												<span class="text-sm font-medium truncate">{item.nama_barang}</span>
												<span class="text-[10px] font-semibold {item.pending_registration ? 'text-amber-700' : 'text-green-600'}">
													{#if item.pending_registration}
														⏳ Baru didaftarkan — menunggu verifikasi Inventory
													{:else}
														{#if item.kode_item}<span class="font-mono">{item.kode_item}</span> · {/if}ID: #{item.identitas_barang_id}
													{/if}
												</span>
											</div>
											<div class="flex shrink-0 items-center gap-1">
												{#if !item.pending_registration}
													<!-- Inventory 360°: spek, tanda barang palsu, & panduan beli — terutama untuk pembelian langsung di toko -->
													<KnowledgeCard itemId={item.identitas_barang_id} context="purchase" />
												{/if}
												<button type="button" onclick={() => clearBarang(idx)} class="text-gray-400 hover:text-red-500 p-1">✕</button>
											</div>
										</div>
									{:else if item.register_open}
										<!-- Katup: mini-form Ajukan Pendaftaran Barang Baru (Fase 0, T1) -->
										<div class="border border-amber-300 bg-amber-50 rounded-lg p-2 space-y-1.5">
											<p class="text-[10px] font-semibold text-amber-800">📝 Ajukan Pendaftaran Barang Baru</p>
											<input type="text" bind:value={item.register_nama} placeholder="Nama barang" class="w-full px-2 py-1.5 border border-amber-300 rounded text-xs" />
											<input type="text" bind:value={item.register_satuan} placeholder="Satuan (mis. Pcs, Kg, Liter)" class="w-full px-2 py-1.5 border border-amber-300 rounded text-xs" />
											<select bind:value={item.register_parent_category} class="w-full px-2 py-1.5 border border-amber-300 rounded text-xs">
												<option value={null}>{loadingParentCategories ? 'Memuat kategori...' : '— Kategori induk (opsional) —'}</option>
												{#each parentCategories as pc (pc.id)}
													<option value={pc.id}>{pc.parent_category}</option>
												{/each}
											</select>
											<div class="flex gap-1.5 pt-0.5">
												<button
													type="button"
													disabled={item.registering}
													onclick={() => submitRegisterBarang(idx)}
													class="flex-1 text-[10px] font-semibold px-2 py-1.5 rounded bg-amber-500 text-white disabled:opacity-50"
												>{item.registering ? 'Mendaftarkan...' : '✓ Daftarkan & Pakai'}</button>
												<button type="button" onclick={() => closeRegisterForm(idx)} class="text-[10px] px-2 py-1.5 rounded border border-gray-300 text-gray-600">Batal</button>
											</div>
											<p class="text-[9px] text-amber-700">ⓘ Barang belum terdaftar? Ajukan pendaftaran — pembelian bisa dilanjutkan setelah barang terdaftar (menunggu verifikasi Inventory).</p>
										</div>
									{:else}
										<!-- Search View -->
										<div class="relative">
											<input
												type="text"
												bind:value={item.searchQuery}
												oninput={() => onSearchBarang(idx)}
												placeholder={itemLinkRequired ? '🔍 Cari barang dari master...' : '🔍 Cari barang atau ketik nama bebas'}
												class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
											/>
											{#if item.searching}
												<IconLoader2 class="animate-spin absolute right-2 top-2.5 text-gray-400" size={16} />
											{/if}
											{#if (item.searchResults?.length ?? 0) > 0 || (item.searchQuery?.trim().length ?? 0) >= 2}
												<div class="absolute z-10 bg-white border rounded-lg shadow-lg w-full mt-1 max-h-48 overflow-y-auto">
													{#if item.searching}
														<div class="px-3 py-2 text-xs text-gray-500 text-center">Mencari...</div>
													{:else}
														{#each item.searchResults ?? [] as barang (barang.id)}
															<button
																type="button"
																class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-b-0"
																onclick={() => pickBarang(idx, barang)}
															>
																{barang.nama_barang_lengkap}
																{#if barang.kode_item}<span class="text-[10px] font-mono font-bold text-emerald-600 ml-1">{barang.kode_item}</span>{/if}
																<span class="text-xs text-gray-400">(stok: {barang.stok_tersedia ?? 0})</span>
															</button>
														{/each}
														{#if itemLinkRequired && (item.searchQuery?.trim().length ?? 0) >= 2}
															<button
																type="button"
																onclick={() => openRegisterForm(idx)}
																class="w-full text-left px-3 py-2 bg-amber-50 text-[11px] font-semibold text-amber-700 border-t border-amber-200"
															>➕ Barang belum ada di master → Ajukan Pendaftaran</button>
														{/if}
													{/if}
												</div>
											{/if}
										</div>
									{/if}
									<div class="grid grid-cols-3 gap-2">
										<input type="number" bind:value={item.quantity} min="0" step="any" placeholder="Qty" class="px-3 py-2 rounded-lg border border-slate-200 text-sm" />
										<input type="text" bind:value={item.units} placeholder="Satuan" class="px-3 py-2 rounded-lg border border-slate-200 text-sm" />
										<input type="number" bind:value={item.harga} min="0" placeholder="Est. Harga" class="px-3 py-2 rounded-lg border border-slate-200 text-sm" />
									</div>
								</div>
							{/each}
						</div>
					</div>

					<UkbRingkas {items} kategoriKode={selectedKode} {department} projectId={selectedProject || null} />

					{#if errorMsg}
						<p class="text-xs text-red-600 font-medium">{errorMsg}</p>
					{/if}

					<button
						onclick={goToReview}
						class="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-bold"
					>
						Lanjut ke Tinjau &amp; Kirim
					</button>
				</div>

			{:else if step === 3}
				{@const cat = selectedKode ? categories.find((c) => c.kode === selectedKode) : null}
				{@const validItems = items.filter((it) => it.nama_barang.trim() && it.quantity > 0)}
				<div class="glass-panel rounded-2xl p-5 border border-white/50 shadow-sm space-y-4">
					<p class="text-sm font-bold" style="color: var(--sys-label)">Tinjau Sebelum Kirim</p>

					<div class="rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
						<div class="flex justify-between p-2.5"><span style="color: var(--sys-label3)">Kategori</span><span class="font-medium">{cat ? `${cat.icon || ''} ${cat.nama}` : 'Tanpa kategori'}</span></div>
						<div class="flex justify-between p-2.5"><span style="color: var(--sys-label3)">Pengaju</span><span class="font-medium">{namaPengaju}</span></div>
						<div class="flex justify-between p-2.5"><span style="color: var(--sys-label3)">Departemen</span><span class="font-medium">{department}</span></div>
						<div class="flex justify-between p-2.5"><span style="color: var(--sys-label3)">Urgensi</span><span class="font-medium">{urgency}</span></div>
						<div class="flex justify-between p-2.5"><span style="color: var(--sys-label3)">Tujuan</span><span class="font-medium text-right">{tujuanPengajuan}</span></div>
						<div class="flex justify-between p-2.5"><span style="color: var(--sys-label3)">Jasa/Non-stok</span><span class="font-medium">{isNonStock ? 'Ya' : 'Tidak'}</span></div>
					</div>

					{#if effectiveSchema.length > 0}
						<div class="rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
							{#each effectiveSchema as f (f.key)}
								<div class="flex justify-between p-2.5">
									<span style="color: var(--sys-label3)">{f.label || f.key} <span class="text-[10px]">({FIELD_TYPE_LABELS[f.type]})</span></span>
									<span class="font-medium text-right">{customFieldsData[f.key] ?? '—'}</span>
								</div>
							{/each}
						</div>
					{/if}

					<div class="rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
						{#each validItems as item}
							<div class="p-2.5">
								<p class="font-medium">{item.nama_barang}</p>
								<p class="text-[11px]" style="color: var(--sys-label3)">{item.quantity} {item.units} @ Rp {(item.harga || 0).toLocaleString('id-ID')}</p>
							</div>
						{/each}
					</div>

					{#if lampiranRulesPreview.length > 0}
						<div class="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
							<p class="font-semibold text-amber-800 mb-1">Lampiran yang akan diminta</p>
							<ul class="space-y-1">
								{#each lampiranRulesPreview as r (r.attachment_type_id)}
									<li class="flex items-start gap-1.5 text-[12px] text-amber-900">
										<span>•</span>
										<span>
											{r.label}
											{#if r.is_required}<span class="text-[10px] font-semibold"> · wajib ({r.stage})</span>{/if}
										</span>
									</li>
								{/each}
							</ul>
							<p class="text-[11px] text-amber-700 mt-1.5">
								Tidak menahan pengiriman. Unggah foto/dokumennya setelah PR dibuat — kelengkapan
								ditagih sebelum tahap persetujuan.
							</p>
						</div>
					{/if}

					{#if errorMsg}
						<p class="text-xs text-red-600 font-medium">{errorMsg}</p>
					{/if}

					<button
						onclick={handleSubmit}
						disabled={submitting}
						class="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
					>
						{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
						{submitting ? 'Mengirim...' : 'Ajukan Procurement'}
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>
