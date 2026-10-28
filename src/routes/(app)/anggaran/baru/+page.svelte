<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { isDeferredGate, deferredHandlerLabel, contactHint, canRequestDispensasi } from '$lib/utils/paGateStage';
	import { shareInflight } from '$lib/services/preflightShare';
	import GateRequestDispensasi from '$lib/components/anggaran/GateRequestDispensasi.svelte';
	import {
		IconArrowLeft, IconInfoCircle, IconListNumbers, IconPlus,
		IconNote, IconPaperclip, IconDeviceFloppy, IconSend, IconLoader2, IconCheck
	} from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { readItems, uploadFiles } from '@directus/sdk';
	import directus from '$lib/services/directus';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { createPengajuanAnggaran, getPengajuanById, getPengajuanItems } from '$lib/services/finance';
	import { getKaryawanByEmail } from '$lib/services/karyawan';
	import { authStore, isLeaderRole } from '$lib/stores/auth';
	import PlafonMandiriMeter from '$lib/components/anggaran/PlafonMandiriMeter.svelte';
	import RekeningSelect from '$lib/components/anggaran/RekeningSelect.svelte';
	import { IconUsers } from '@tabler/icons-svelte';
	import { SectionGuide, FieldHint, HelpIcon } from '$lib/components/hints';
	import { anggaranHints } from '$lib/data/hints/anggaran';
	import { getHint } from '$lib/data/hints/getHint';
	import {
		listPengajuanTemplates, savePengajuanTemplate, deletePengajuanTemplate,
		type PengajuanTemplate
	} from '$lib/services/pengajuanTemplate';
	import CategoryPicker from '$lib/components/anggaran/CategoryPicker.svelte';
	import { topRecentCategories } from '$lib/utils/recentCategories';
	import PayablePickerLite from '$lib/components/anggaran/PayablePickerLite.svelte';
	import DynamicBudgetForm from '$lib/components/anggaran/DynamicBudgetForm.svelte';
	import BbmSplitAllocator from '$lib/components/anggaran/BbmSplitAllocator.svelte';
	import ProjectSelect from '$lib/components/anggaran/ProjectSelect.svelte';
	import AttachmentChecklist from '$lib/components/anggaran/AttachmentChecklist.svelte';
	import { getBudgetCategories, getCategoryFields, type BudgetCategory, type BudgetCategoryField } from '$lib/services/budgetCategory';
	import { getCostBehaviorByKategoriBelanja, COST_BEHAVIOR_BADGE, getProjectCostPosition } from '$lib/services/projectCostBehaviorApi';
	import { guessKategoriBelanja } from '$lib/services/kategoriGuess';
	import { getCategoryClue } from '$lib/data/budgetCategoryClues';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { getPettyCashFunds } from '$lib/services/ess/pettyCash';
	import { fetchGateHints, applyGateHints } from '$lib/services/gateHintClient';
	import { fetchFieldBudgetPct, previewFieldBudgetAfter, type FieldBudgetPct } from '$lib/services/projectFinancePct';
	import { collectErrors, hasBlockingError, type ValidationInput } from '$lib/utils/anggaranValidation';
	import { getRapPosOptions, type RapPosOption } from '$lib/services/soRabApi';
	import { loadProjectSettings, getProjectSetting } from '$lib/services/projectSettings';
	import GateFixKtpNik from '$lib/components/shared/GateFixKtpNik.svelte';
	import GateFixBapBorongan from '$lib/components/anggaran/GateFixBapBorongan.svelte';
	import AtasNamaPanel from '$lib/components/konfirmasi/AtasNamaPanel.svelte';

	const h = (key: string) => getHint(anggaranHints, key, 'anggaran');

	// Fallback (Checkpoint 2 gagal-lunak): dipakai HANYA bila budget_category_config gagal
	// dimuat/kosong — sama seperti KATEGORI_BUTUH_LAMPIRAN di admin (erp-epi-1
	// validate/+server.js). "contingency" tidak ada di form ini.
	const KATEGORI_BUTUH_LAMPIRAN = ['operasional'];

	const itemCategories = [
		{ value: 'operasional', label: 'Biaya Operasional' },
		{ value: 'supplier', label: 'Supplier / Material' },
		{ value: 'consumable', label: 'Consumables' },
		{ value: 'jasa', label: 'Jasa / Subkon' },
		{ value: 'safety', label: 'Safety' },
		{ value: 'sewa_alat', label: 'Sewa Alat Internal' },
		{ value: 'lain_lain', label: 'Biaya Lain-Lain' }
	];

	// === PRJ-23: saran kategori item dari uraian (proxy ke admin; gagal-lunak) ===
	// Kode saran admin (kategori_item ERP) dipetakan ke 7 kategori form ini.
	const SUGGEST_BUCKET: Record<string, string> = {
		transport_mobilisasi: 'operasional', utilitas_lapangan: 'operasional', entertain_konsumsi: 'operasional',
		bensin: 'operasional', e_toll: 'operasional', kasbon_manpower: 'jasa', gaji_thr_lembur: 'jasa', lain_lain: 'lain_lain'
	};
	let catSuggest = $state<Record<number, string | null>>({});
	const suggestTimers: Record<number, ReturnType<typeof setTimeout>> = {};
	function scheduleSuggest(i: number, text: string) {
		clearTimeout(suggestTimers[i]);
		if (!text || text.trim().length < 3) { catSuggest[i] = null; return; }
		suggestTimers[i] = setTimeout(async () => {
			try {
				const token = await getIdToken();
				const res = await fetch('/api/category-suggest?text=' + encodeURIComponent(text), { headers: { Authorization: 'Bearer ' + token } });
				const j = await res.json().catch(() => null);
				const kode = j?.suggestion?.kode as string | undefined;
				catSuggest[i] = kode ? (SUGGEST_BUCKET[kode] ?? (itemCategories.some((c) => c.value === kode) ? kode : null)) : null;
			} catch {
				catSuggest[i] = null; // saran hanya bantuan — jangan pernah mengganggu pengisian
			}
		}, 400);
	}
	const catLabel = (v: string) => itemCategories.find((c) => c.value === v)?.label || v;

	// === G_KATEGORI_COCOK (Fase 4): kategori header vs isi pengajuan (proxy ke admin; gagal-lunak, server validate tetap otoritas) ===
	type KatMatch = { kode: string; nama: string; alasan: string; wajib: boolean };
	let katMatch = $state<KatMatch | null>(null);
	let katMatchTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const text = `${tujuanPengajuan} ${items.map((it) => it.name).join(' ')}`.trim();
		const chosen = selectedCategoryKode;
		clearTimeout(katMatchTimer);
		if (!chosen || text.length < 3) { katMatch = null; return; }
		katMatchTimer = setTimeout(async () => {
			try {
				const token = await getIdToken();
				const qs = new URLSearchParams({ text, chosen });
				const res = await fetch('/api/category-match?' + qs, { headers: { Authorization: 'Bearer ' + token } });
				const j = await res.json().catch(() => null);
				katMatch = j?.suggestion && j.suggestion.kode !== chosen ? j.suggestion : null;
			} catch {
				katMatch = null; // saran hanya bantuan — jangan pernah mengganggu pengisian
			}
		}, 400);
		return () => clearTimeout(katMatchTimer);
	});
	let katMatchCat = $derived(katMatch ? categories.find((c) => c.kode === katMatch!.kode) || null : null);

	// === PRJ-24: Pos RAP per item (aktif hanya bila setelan project.pa.rab_link_enabled = true) ===
	let rabLinkEnabled = $state(false);
	let rapPos = $state<RapPosOption[]>([]);
	$effect(() => {
		const pid = selectedProject ? Number(selectedProject) : null;
		if (!rabLinkEnabled || !pid) { rapPos = []; return; }
		getRapPosOptions(pid).then((r) => (rapPos = r));
	});

	let projects = $state<any[]>([]);
	// PRJ-29: dibuka dari "Keluar Uang" di detail proyek -> proyek sudah terpilih (?project_id=).
	let selectedProject = $state(typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('project_id') || '' : '');
	let tujuanPengajuan = $state('');
	let kategori = $state('operasional');

	// Fase 3 (Pengajuan Anggaran v3, 22 Agu 2026): CategoryPicker WAJIB (Checkpoint 3) —
	// menggantikan dropdown Operasional/Jasa lama. `kategori` (legacy) tetap terisi
	// otomatis dari legacy_kategori kategori terpilih (K3, nol downtime laporan lama).
	let categories = $state<BudgetCategory[]>([]);
	let selectedCategoryKode = $state<string | null>(null);
	let selectedCategory = $derived(categories.find((c) => c.kode === selectedCategoryKode) || null);

	// PC3-08 (FLD-11) — kategori Petty Cash = isi ulang dana: wajib memilih dana yang saldonya ditambah.
	let pettyCashFundId = $state('');
	let pettyCashFunds = $state<{ id: number; fund_name: string; department: string | null }[]>([]);
	let pettyCashFundsLoading = $state(false);
	let pettyCashFundsError = $state('');
	let isPettyCashCategory = $derived(selectedCategoryKode === 'petty_cash');
	$effect(() => {
		// muat sekali saat kategori Petty Cash dipilih (bukan tiap form dibuka)
		if (!isPettyCashCategory || pettyCashFunds.length > 0 || pettyCashFundsLoading) return;
		pettyCashFundsLoading = true;
		pettyCashFundsError = '';
		getPettyCashFunds()
			.then((f) => { pettyCashFunds = f; })
			.catch((e) => {
				console.error('[anggaran/baru] gagal memuat dana kas kecil:', e);
				pettyCashFundsError = e?.message || 'Gagal memuat daftar dana. Periksa sinyal lalu pilih ulang kategori.';
			})
			.finally(() => { pettyCashFundsLoading = false; });
	});
	let activeClue = $derived(getCategoryClue(selectedCategoryKode, selectedCategory));

	// Penajaman Finance CVP Fase 5 — badge perilaku biaya untuk pos terpilih.
	let costBehaviorMap = $state<Record<string, string>>({});
	let selectedCostBehavior = $derived(
		selectedCategoryKode ? costBehaviorMap[selectedCategoryKode] || null : null
	);

	let categoryFields = $state<BudgetCategoryField[]>([]);
	let dynamicValues = $state<Record<string, any>>({});
	// requires_attachment efektif: dari config kategori terpilih, fallback ke daftar lama
	// bila config kosong/gagal (gagal-lunak) atau belum ada kategori dipilih.
	let needsAttachment = $derived(
		selectedCategory ? selectedCategory.requires_attachment : KATEGORI_BUTUH_LAMPIRAN.includes(kategori)
	);
	// Axis TIDAK ditanyakan ke user (K2/Fase 3): proyek jadi wajib otomatis kalau kategori
	// terpilih requires_project (mis. Upah Manpower), bukan cuma hardcode kategori==='jasa'.
	// 25 Agu 2026: ditambah wajib juga untuk departemen PROJECT terlepas kategorinya —
	// akar bug PA-0257 (leader project submit "gaji catur dakwah" dgn kategori Lain-lain,
	// yang requires_project=0, dropdown proyek kelewat kosong -> masuk pos Non-Proyek).
	// Departemen PROJECT nyaris selalu punya proyek spesifik yang terkait.
	let projectRequired = $derived(
		(selectedCategory ? !!selectedCategory.requires_project : kategori === 'jasa') ||
		departmentName.trim().toUpperCase() === 'PROJECT'
	);

	// Kategori komisi/agen (komisi_internal, komisi_external) memakai legacy_kategori 'jasa'
	// hanya untuk COA — bukan upah manpower proyek. axis_allowed-nya ['department']. Info
	// card "Upah Manpower" di bawah hanya relevan untuk kategori jasa bersumbu proyek.
	// Gagal-lunak: config tak termuat -> selectedCategory null -> perilaku lama.
	let categoryUsesProjectAxis = $derived(
		selectedCategory
			? (Array.isArray(selectedCategory.axis_allowed)
				? selectedCategory.axis_allowed.includes('project')
				: !!selectedCategory.requires_project)
			: true
	);

	// Default kategori_item per kategori_belanja — TANPA ini, gate item-level yang scoped
	// ke kategori_item (mis. G_PO -> 'supplier') tidak pernah menyala kecuali user secara
	// manual mengubah dropdown Kategori Item di tiap baris, yang gampang terlewat.
	const DEFAULT_ITEM_KATEGORI: Record<string, string> = {
		material_supplier: 'supplier',
		sewa_alat: 'sewa_alat',
		gaji_manpower: 'jasa',
		subkon_jasa: 'jasa',
		komisi_internal: 'jasa',
		komisi_external: 'jasa',
		subkontraktor_termin: 'jasa'
	};

	async function handleCategorySelect(cat: BudgetCategory) {
		kategori = cat.legacy_kategori || 'operasional';
		dynamicValues = {};
		categoryFields = await getCategoryFields(cat.id);
		bbmSplitEnabled = false;
		bbmSplits = [];
		// Reset semua item ke default kategori_item per kategori_belanja terpilih.
		// Default spesifik per kategori (mis. material_supplier → 'supplier') supaya gate
		// item-level bisa menyala. Fallback ke 'lain_lain' sesuai erp-epi.
		const defaultItemKategori = cat.default_item_kategori || DEFAULT_ITEM_KATEGORI[cat.kode] || 'lain_lain';
		items = items.map((it) => ({ ...it, kategori_item: defaultItemKategori }));
	}

	// G_BBM_SPLIT (v3.1) — hanya relevan untuk bbm_transport, opsional (default nonaktif).
	let bbmSplitEnabled = $state(false);
	let bbmSplits = $state<{ project_id: number | null; persentase: number }[]>([]);

	let urgency = $state('Normal');
	// Pengajuan Darurat Atas Nama (Leader/Wakil proyek / Supervisor) — hak ditentukan server, lihat AtasNamaPanel.
	let atasNama = $state(false);
	let atasNamaAlasan = $state('');
	let atasNamaPemohonId = $state<number | null>(null);
	let atasNamaPemohonNama = $state('');
	let tanggalDibutuhkan = $state(new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000).toISOString().split('T')[0]);
	let notes = $state('');
	let submitting = $state(false);
	let loading = $state(true);
	let showSuccessModal = $state(false);
	let createdNomorPengajuan = $state('');

	let paymentMethod = $state('Transfer');
	let penerimaDanaType = $state('');
	let penerimaDanaNama = $state('');
	let bankName = $state('');
	let bankAccountNumber = $state('');
	let bankAccountName = $state('');
	// Penajaman Penerima Dana & Track Record v2, Fase 4 (11 Sep)
	let rekeningPenerimaId = $state<number | null>(null);
	let isTagihanRekening = $state(false);

	let items = $state<Array<{ name: string; kategori_item: string; qty: number; unit: string; price: number; vendorName: string; notes: string; rabBudgetId?: string | number }>>([{ name: '', kategori_item: 'lain_lain', qty: 1, unit: 'Pcs', price: 0, vendorName: '', notes: '' }]);
	let totalAmount = $derived(items.reduce((acc, curr) => acc + (curr.qty * curr.price), 0));

	// PA-Rilis Hutang v2 (Fase 4) — kategori 'rilis_hutang': blok item manual diganti
	// PayablePickerLite (hanya tagihan proyek yang ditugaskan ke PL ini). `items` tetap
	// disinkron 1 baris otomatis supaya totalAmount & validItems jalan tanpa perubahan lain.
	let selectedPayableInvoice = $state<any>(null);
	let rilisNominal = $state(0);
	let prefillPayableId = $state<string | null>(null);
	function handlePayableSelect(invoice: any) {
		selectedPayableInvoice = invoice;
		rilisNominal = invoice ? Number(invoice.outstanding_amount) || 0 : 0;
		if (invoice?.project_id) selectedProject = String(invoice.project_id);
	}
	$effect(() => {
		if (selectedCategoryKode !== 'rilis_hutang') return;
		items = selectedPayableInvoice
			? [{
				name: `Rilis tagihan ${selectedPayableInvoice.invoice_number} — ${selectedPayableInvoice.supplier_name || 'supplier'}`,
				kategori_item: 'supplier',
				qty: 1,
				unit: 'paket',
				price: rilisNominal,
				vendorName: selectedPayableInvoice.supplier_name || '',
				notes: ''
			}]
			: [];
	});

	// Rekomendasi §6.8 — tebakan kategori dari teks tujuan + nama item (tanpa AI).
	let guessedKode = $derived(
		guessKategoriBelanja(
			`${tujuanPengajuan} ${items.map((it) => it.name).join(' ')}`,
			categories.map((c) => c.kode),
			categories
		)
	);
	let guessedCat = $derived(guessedKode ? categories.find((c) => c.kode === guessedKode) : null);

	// Rekomendasi §6.9 — pratinjau dampak: pengajuan ini menaikkan realisasi biaya variabel
	// proyek dari X% -> Y% dari plafon RAP.
	let projPos = $state<any>(null);
	let projPosFor = $state<string>('');
	$effect(() => {
		const pid = selectedProject;
		if (pid && pid !== projPosFor) {
			projPosFor = pid;
			projPos = null;
			getProjectCostPosition(Number(pid))
				.then((p) => { if (projPosFor === pid) projPos = p; })
				.catch(() => {});
		}
	});
	let impactPreview = $derived.by(() => {
		if (selectedCostBehavior !== 'VARIABLE' || !projPos || !(projPos.rap_plafon > 0)) return null;
		const before = projPos.variable_realized / projPos.rap_plafon;
		const after = (projPos.variable_realized + (totalAmount || 0)) / projPos.rap_plafon;
		return { before, after, over: after > 1 };
	});

	let currentRoleId = $state<string | null>(null);
	let currentKaryawanName = $state<string | null>(null);
	let currentKaryawanId = $state<number | null>(null);
	let currentKaryawanEmail = $state<string | null>(null);
	let currentKaryawanDivisi = $state<string | null>(null);
	let currentUser = $state<any>(null);
	let currentDirectusToken = $state<string | null>(null);

	// Fase 0.2/3 (AI Analysis Engine v2.0): dropdown department dari master,
	// menggantikan auto-fill divisi teks bebas yang tidak pernah mengisi department_id
	// (akar penyebab gate G1 gagal untuk hampir semua submission lapangan).
	let departments = $state<{ id: number; nama_department: string; kode_department?: string }[]>([]);
	let departmentId = $state<number | null>(null);
	let departmentName = $derived(departments.find((d) => d.id === departmentId)?.nama_department || currentKaryawanDivisi || '');
	let departmentCode = $derived(departments.find((d) => d.id === departmentId)?.kode_department || null);

	// Auto-sync: bila proyek dipilih tapi departmentId belum terisi, arahkan otomatis ke department PROJECT
	$effect(() => {
		if (selectedProject && !departmentId && departments.length > 0) {
			const projDept = departments.find(
				(d) => d.kode_department?.toUpperCase() === 'PROJECT' || d.nama_department?.toUpperCase() === 'PROJECT'
			);
			if (projDept) departmentId = projDept.id;
		}
	});

	// Fase 3 Bagian B: lampiran sungguhan (sebelumnya kotak dekoratif tanpa fungsi)
	// Fase 0.1 (Lampiran Otomatis v2, 27 Agu 2026): multi-file — pola persis
	// AjukanAnggaranModal.svelte di admin (lampiranFiles[] + lampiran_file_ids).
	// Menutup asimetri Admin (multi) ↔ Lapangan (single) yang sudah hidup di produksi.
	let lampiranFiles = $state<{ file: File; id: string | null; name: string; uploading: boolean }[]>([]);
	let lampiranInputEl: HTMLInputElement | undefined = $state();
	let uploadingLampiran = $derived(lampiranFiles.some((f) => f.uploading));
	let uploadedLampiranIds = $derived(lampiranFiles.filter((f) => f.id).map((f) => f.id as string));
	let hasLampiran = $derived(uploadedLampiranIds.length > 0);

	// Fase 0.5 (Penajaman Pengajuan Anggaran v2, 18 Agu 2026): lampiran TETAP wajib
	// untuk kategori Operasional — tidak dilonggarkan by nominal. Jalur pengecualian
	// terstruktur ini satu-satunya cara lolos tanpa lampiran fisik, dan tercatat
	// permanen di record (sama seperti dicek G8 di erp-epi-1/validate/+server.js).
	const MIN_EXCEPTION_NOTE_LENGTH = 15;
	const lampiranExceptionReasons = [
		{ value: 'bukti_hilang_rusak', label: 'Bukti fisik hilang/rusak' },
		{ value: 'transaksi_tunai_tanpa_kuitansi', label: 'Transaksi tunai tanpa kuitansi resmi' },
		{ value: 'kondisi_darurat_lapangan', label: 'Kondisi darurat/mendesak di lapangan' },
		{ value: 'vendor_tidak_menerbitkan_bukti', label: 'Vendor/pihak ketiga tidak menerbitkan bukti' },
		{ value: 'lainnya', label: 'Lainnya (jelaskan di keterangan)' }
	];
	let showLampiranException = $state(false);
	let lampiranExceptionReason = $state('');
	let lampiranExceptionNote = $state('');

	// Fase 3 Bagian C: panel pra-terbang (pre-flight gate check, warning-only)
	let preflightResult = $state<any>(null);
	let checkingPreflight = $state(false);
	// Fase 2 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — hasil preflight
	// terakhir yang gagal dikirim (blocking, bukan warning-only) supaya kartu di bawah
	// bisa disorot & di-scroll-ke, menggantikan notify() polos (F6 di rencana).
	let submitBlockedError = $state<string | null>(null);

	// Fase 3-KTP susulan (29 Sep 2026) — dialog "Benahi Identitas" per pekerja untuk gate
	// G_MANPOWER_IDENTITAS, memakai affected_items (id+label) yang server sudah kirim.
	// Fase 4 tambahan — dialog "Unggah BAP sekarang" untuk gate G_BAP_BORONGAN.
	let bapDialogOpen = $state(false);
	let dispensasiGate = $state<string | null>(null); // gate yang sedang dimintakan dispensasi (GateRequestDispensasi)
	let ktpDialog = $state<{ open: boolean; manpowerId: number; manpowerName: string }>({
		open: false,
		manpowerId: 0,
		manpowerName: ''
	});

	// Fase 2 susulan — resolve href action_config.links dari gate_definitions: prefix
	// "LAPANGAN:" menandai route lapangan (project-epi), placeholder {project_id} diganti
	// proyek yang sedang dipilih di form ini. Link tanpa prefix (route admin) disembunyikan.
	function resolveLapanganLink(g: any): { label: string; href: string } | null {
		const links: Array<{ label: string; href: string }> = g?.action_config?.links || [];
		const l = links.find((x) => x.href?.startsWith('LAPANGAN:'));
		if (!l) return null;
		const path = l.href.slice('LAPANGAN:'.length).replace('{project_id}', selectedProject || '');
		return { label: l.label, href: path };
	}

	import { gatesNeedingPernyataan, hasValidPernyataan } from '$lib/services/evaluateSubmitDecision';

	// Fase 4 Gate-KPI: kategori termin borongan (kode baku `borongan_manpower_termin`, sama dengan gate G_BORONGAN_KANAL
	// & G_BAP_BORONGAN di admin) — diperluas agar tangguh bila master kategori memakai variasi kode/nama.
	const KODE_BORONGAN_TERMIN = 'borongan_manpower_termin';
	let boronganTerminCat = $derived(
		categories.find((c) => c.kode === 'borongan_manpower_termin') ||
		categories.find((c) => c.kode === 'subkontraktor_termin') ||
		categories.find((c) => c.kode?.toLowerCase().includes('borongan') && c.kode?.toLowerCase().includes('termin')) ||
		categories.find((c) => c.nama?.toLowerCase().includes('borongan') && c.nama?.toLowerCase().includes('termin')) ||
		null
	);
	async function handleBoronganTermin(cat: BudgetCategory) {
		selectedCategoryKode = cat.kode;
		await handleCategorySelect(cat);
		handlePeriksaSebelumKirim(); // cek ulang otomatis agar hasil gate langsung terlihat
	}

	let hasLoaded = false;
	const unsubAuth = authStore.subscribe((s) => {
		currentRoleId = s.roleId;
		currentKaryawanName = s.karyawanName;
		currentKaryawanId = s.karyawanId;
		currentDirectusToken = s.directusToken;
		currentUser = s.user;

		if (s.checked && !hasLoaded) {
			hasLoaded = true;
			loadData();
		}
	});

	// Catatan: reset kategori_item per baris item sekarang ditangani di handleCategorySelect
	// (default per kategori_belanja, mis. material_supplier -> 'supplier' supaya G_PO bisa
	// menyala) -- $effect generik yang dulu ada di sini SELALU menimpa balik ke 'lain_lain'
	// tiap kategori (legacy) berubah, yang akan menghapus default itu tepat setelah diisi.

	// R5: kategori yang terakhir/paling sering dipakai pengaju ini — satu query ringan (50 PA terakhir).
	let recentKodes = $state<string[]>([]);
	let recentCats = $derived(recentKodes.map((k) => categories.find((c) => c.kode === k)).filter((c): c is BudgetCategory => !!c));
	async function loadRecentKategori() {
		const email = currentKaryawanEmail || currentUser?.email;
		if (!email) return;
		try {
			const rows = (await directus.request(
				readItems('pengajuan_anggaran', {
					filter: { created_by_email: { _eq: email }, kategori_belanja: { _nnull: true } },
					fields: ['kategori_belanja'],
					sort: ['-id'],
					limit: 50
				})
			)) as Array<{ kategori_belanja?: string | null }>;
			recentKodes = topRecentCategories(rows, 4);
		} catch (e: any) {
			console.warn('[anggaran/baru] kategori terakhir dilewati:', e?.message);
		}
	}

	async function loadData() {
		try {
			if (currentUser?.email) {
				const kary = await getKaryawanByEmail(currentUser.email);
				if (kary) {
					currentKaryawanDivisi = kary.divisi;
					currentKaryawanEmail = kary.email_company;
					currentKaryawanName = kary.nama_karyawan;
					currentKaryawanId = kary.id;
				}
			}

			try {
				const deptResult = (await directus.request(
					readItems('department' as any, {
						filter: { is_active: { _eq: true } },
						sort: ['nama_department'],
						fields: ['id', 'nama_department', 'kode_department'],
						limit: -1
					})
				)) as any[];
				departments = deptResult || [];
				if (currentKaryawanDivisi) {
					const match = departments.find(
						(d) =>
							d.nama_department.trim().toUpperCase() === currentKaryawanDivisi!.trim().toUpperCase() ||
							d.kode_department?.trim().toUpperCase() === currentKaryawanDivisi!.trim().toUpperCase()
					);
					if (match) departmentId = match.id;
				}
				if (!departmentId && selectedProject) {
					const projDept = departments.find(
						(d) => d.kode_department?.toUpperCase() === 'PROJECT' || d.nama_department?.toUpperCase() === 'PROJECT'
					);
					if (projDept) departmentId = projDept.id;
				}
			} catch (e) {
				console.error('Gagal memuat master department:', e);
			}

			let projResult: any[];
			projResult = await getProjectsForCurrentUser(true);
			projects = projResult || [];
			// Fase 5 (Pertajam Modul Ciketing & MB v2) — bug nyata: auto-pilih proyek
			// pertama secara diam-diam. Untuk koordinator workshop dengan puluhan PO,
			// ini memberi proyek default yang keliru dan mudah lolos kalau user langsung
			// mengisi nominal. Placeholder "— Pilih Proyek —" (ProjectSelect sudah
			// mendukungnya) memaksa pemilihan eksplisit.

			categories = await getBudgetCategories();
			loadRecentKategori(); // R5: chip "Terakhir dipakai" (fail-soft, tidak menahan form)
			getCostBehaviorByKategoriBelanja().then((m) => (costBehaviorMap = m)).catch(() => {});

			// PA-Rilis Hutang v2 (Fase 4) — datang dari /hutang-proyek?invoice_id=X via
			// tombol "Ajukan Rilis": prefill kategori + proyek, PayablePickerLite mengambil
			// alih pemilihan invoice-nya sendiri lewat prefillPayableId.
			const qp = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
			if (qp?.get('kategori') === 'rilis_hutang') {
				selectedCategoryKode = 'rilis_hutang';
				const qProjectId = qp.get('project_id');
				if (qProjectId && projects.some((p) => String(p.id) === qProjectId)) {
					selectedProject = qProjectId;
				}
				prefillPayableId = qp.get('invoice_id');
			} else {
				// Fase 4 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — tombol "Ajukan
				// untuk proyek ini" di halaman Kesiapan Proyek Saya (/anggaran/cek-gate).
				const qProjectIdOnly = qp?.get('project_id');
				if (qProjectIdOnly && projects.some((p) => String(p.id) === qProjectIdOnly)) {
					selectedProject = qProjectIdOnly;
				}
			}

			// L4/L5 — master siap: mode duplikat dari ?duplikat=<id>, atau tawarkan pulihkan draf.
			const dupId = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('duplikat') : null;
			if (dupId) {
				await loadDuplikat(dupId);
				draftRestored = true; // jangan tawarkan draf saat menyalin
			} else {
				try {
					const raw = localStorage.getItem(DRAFT_KEY);
					if (raw) {
						savedDraftAt = JSON.parse(raw)?.savedAt || null;
						draftAvailable = true; // tunggu keputusan user sebelum autosave menimpa
					} else {
						draftRestored = true;
					}
				} catch {
					draftRestored = true;
				}
			}
		} catch (e) {
			console.error('Gagal memuat proyek:', e);
			draftRestored = true;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadSpjCheck(); // Fase 5B (Penajaman v2, 2 Sep 2026) — self-check, tidak menahan apa pun
		loadTemplates();
		// Fase 2 (Rencana v2 Shift-Left Gate Anggaran) — kembali ke tab ini (mis. setelah
		// mengisi Timeline/Laporan Harian di tab lain) -> cek ulang otomatis, tanpa perlu
		// klik "Cek Ulang" manual.
		const onVisible = () => {
			if (document.visibilityState === 'visible' && preflightResult) handlePeriksaSebelumKirim();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => { unsubAuth(); document.removeEventListener('visibilitychange', onVisible); };
	});

	// ── Fase 5B (Penajaman v2 — Gate & Analisa Pengajuan Anggaran, 2 Sep 2026) ──────────
	// Self-check SPJ: tunggakan SPJ MILIK SENDIRI, dimuat sekali saat form dibuka —
	// mendidik pengaju sebelum ditolak G17 setelah submit, bukan setelahnya.
	let spjCheck = $state<any>(null);
	let loadingSpjCheck = $state(false);
	async function loadSpjCheck() {
		loadingSpjCheck = true;
		try {
			const token = await getIdToken();
			const res = await fetch('/api/spj-saya', { headers: { Authorization: `Bearer ${token}` } });
			spjCheck = await res.json().catch(() => null);
		} catch {
			spjCheck = null;
		} finally {
			loadingSpjCheck = false;
		}
	}

	// Banner Sisa Pagu (UPFE Fase 3/4, keputusan Lead 12 Okt 2026): peran lapangan HANYA melihat PERSEN, tanpa rupiah RAP.
	// Muncul otomatis begitu proyek dipilih; engine keuangan tunggal di admin (komitmen ikut dihitung). Informatif, tidak pernah menahan submit.
	let pagu = $state<FieldBudgetPct | null>(null);
	let loadingPagu = $state(false);
	let paguAfter = $state<FieldBudgetPct['after']>(null);
	$effect(() => {
		const pid = selectedProject ? Number(selectedProject) : null;
		pagu = null;
		paguAfter = null;
		if (!pid) return;
		loadingPagu = true;
		fetchFieldBudgetPct(pid)
			.then((r) => { if (Number(selectedProject) === pid) pagu = r; })
			.finally(() => { loadingPagu = false; });
	});
	// Pre-flight nominal: debounce 700 ms agar tidak memanggil server tiap ketikan (hemat API).
	$effect(() => {
		const pid = selectedProject ? Number(selectedProject) : null;
		const amt = totalAmount;
		if (!pid || !(amt > 0) || pagu?.status !== 'ok') { paguAfter = null; return; }
		const t = setTimeout(async () => {
			const r = await previewFieldBudgetAfter(pid, amt);
			if (Number(selectedProject) === pid && totalAmount === amt) paguAfter = r;
		}, 700);
		return () => clearTimeout(t);
	});

	// Peringatan over-budget DINI (Real Profit §4B.2): banner di atas ikut bereaksi pada nominal yang sedang diketik — memakai data
	// pagu yang SUDAH dimuat (tanpa API baru). Informatif, tidak pernah menahan submit. Ambang = project.monitor.thresholds (setelan).
	onMount(async () => {
		try {
			await loadProjectSettings();
			rabLinkEnabled = getProjectSetting('project.pa.rab_link_enabled') === true;
			const fo = Number(getProjectSetting('project.pa.fail_open_threshold'));
			if (Number.isFinite(fo) && fo > 0) failOpenThreshold = fo;
		} catch {
			/* gagal-lunak: tetap 90/100 */
		}
	});
	const PROYEKSI_CLS: Record<string, string> = {
		safe: 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300',
		warn: 'border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 text-amber-800 dark:text-amber-300',
		danger: 'border-rose-300 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-800 text-rose-800 dark:text-rose-300',
		none: 'border-slate-200 bg-slate-50 dark:bg-slate-800/50 dark:border-slate-700 text-slate-600 dark:text-slate-300',
		aman: 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300',
		perhatian: 'border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 text-amber-800 dark:text-amber-300',
		melebihi: 'border-rose-300 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-800 text-rose-800 dark:text-rose-300'
	};

	// B.4 — Fail-open BERTINGKAT (keputusan user 2 Sep 2026, pertanyaan #6 rencana
	// Penajaman v2): preflight tak terjangkau + nominal > Rp 5 juta TIDAK mengunci
	// pengaju lapangan (sinyal jaringan/server buruk sering terjadi), TAPI wajib
	// mengetik alasan singkat -- tersimpan di dynamic_fields untuk audit.
	// PRJ-25: ambang dari system_settings project.pa.fail_open_threshold (default 5 jt); dimuat di onMount.
	let failOpenThreshold = $state(5_000_000);
	let failOpenReason = $state('');
	// Dual Gate PA (soft): pernyataan tertulis bila laporan bolong / MoM belum ada.
	let gatePernyataan = $state('');
	let gatesButuhPernyataan = $derived(gatesNeedingPernyataan(preflightResult?.gates || []));
	let showFailOpenReasonField = $state(false);

	function formatCurrency(val: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
	}

	// L2 — draft object utk Pratinjau lampiran pra-submit (AttachmentChecklist).
	let attachmentDraft = $derived({
		project_id: selectedProject ? Number(selectedProject) : null,
		kategori_belanja: selectedCategoryKode,
		kategori,
		department: departmentName || currentKaryawanDivisi || '',
		nama_pengaju: currentKaryawanName || currentUser?.displayName || '',
		budget_axis: selectedProject ? 'project' : 'department',
		tujuan_pengajuan: tujuanPengajuan,
		urgency: urgency === 'Sangat Urgent' ? 'Very Urgent' : urgency,
		tanggal_dibutuhkan: tanggalDibutuhkan,
		payment_method: paymentMethod,
		penerima_dana_nama: penerimaDanaNama,
		penerima_dana_type: penerimaDanaType,
		bank_name: bankName,
		bank_account_number: bankAccountNumber,
		bank_account_name: bankAccountName,
		comments: notes,
		items: items
			.filter((it) => it.name.trim())
			.map((it) => ({
				deskripsi: it.name,
				vendor_name: it.vendorName || '',
				quantity: it.qty,
				units: it.unit,
				harga: it.price,
				total: (Number(it.qty) || 0) * (Number(it.price) || 0)
			}))
	});

	// ── L5: Draf offline (localStorage) ────────────────────────────────────────
	// Autosave isian form ke perangkat supaya tidak hilang kalau tab tertutup / sinyal
	// lapangan putus sebelum sempat kirim. Lampiran (File) TIDAK ikut disimpan.
	const DRAFT_KEY = 'pengajuan_anggaran_draft_v1';
	let draftAvailable = $state(false);
	let savedDraftAt = $state<string | null>(null);
	let draftRestored = false; // supaya autosave tidak menimpa sebelum user memilih
	let duplikatFrom = $state<string | null>(null);

	function collectDraft() {
		return {
			savedAt: new Date().toISOString(),
			selectedProject, tujuanPengajuan, kategori, selectedCategoryKode,
			dynamicValues: $state.snapshot(dynamicValues),
			urgency, tanggalDibutuhkan, notes, paymentMethod,
			penerimaDanaType, penerimaDanaNama, bankName, bankAccountNumber, bankAccountName,
			departmentId,
			items: $state.snapshot(items)
		};
	}

	function applyDraft(d: any) {
		if (!d) return;
		selectedProject = d.selectedProject ?? '';
		tujuanPengajuan = d.tujuanPengajuan ?? '';
		kategori = d.kategori ?? 'operasional';
		selectedCategoryKode = d.selectedCategoryKode ?? null;
		dynamicValues = d.dynamicValues ?? {};
		urgency = d.urgency ?? 'Normal';
		if (d.tanggalDibutuhkan) tanggalDibutuhkan = d.tanggalDibutuhkan;
		notes = d.notes ?? '';
		paymentMethod = d.paymentMethod ?? 'Transfer';
		penerimaDanaType = d.penerimaDanaType ?? '';
		penerimaDanaNama = d.penerimaDanaNama ?? '';
		bankName = d.bankName ?? '';
		bankAccountNumber = d.bankAccountNumber ?? '';
		bankAccountName = d.bankAccountName ?? '';
		if (d.departmentId) departmentId = d.departmentId;
		if (Array.isArray(d.items) && d.items.length) items = d.items;
	}

	function restoreDraft() {
		try {
			const raw = localStorage.getItem(DRAFT_KEY);
			if (raw) applyDraft(JSON.parse(raw));
		} catch { /* abaikan */ }
		draftAvailable = false;
		draftRestored = true;
	}

	function discardDraft() {
		try { localStorage.removeItem(DRAFT_KEY); } catch { /* abaikan */ }
		draftAvailable = false;
		draftRestored = true;
	}

	let draftSaveTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		// Referensikan field yg dipantau supaya effect re-run saat berubah
		const _watch = [selectedProject, tujuanPengajuan, kategori, selectedCategoryKode,
			urgency, tanggalDibutuhkan, notes, paymentMethod, penerimaDanaNama,
			bankAccountNumber, JSON.stringify($state.snapshot(items)), JSON.stringify($state.snapshot(dynamicValues))];
		if (loading || !draftRestored) return;
		clearTimeout(draftSaveTimer);
		draftSaveTimer = setTimeout(() => {
			try {
				const hasContent = tujuanPengajuan.trim() || penerimaDanaNama.trim() ||
					items.some((it) => it.name.trim() || (Number(it.price) || 0) > 0);
				if (hasContent) localStorage.setItem(DRAFT_KEY, JSON.stringify(collectDraft()));
			} catch { /* kuota/privasi — abaikan */ }
		}, 800);
	});

	// ── L4: Duplikat pengajuan berulang ───────────────────────────────────────
	// ?duplikat=<id> — salin isian dari pengajuan lama (cocok untuk operasional bulanan).
	// TIDAK menyalin lampiran, tanggal dibutuhkan (di-reset ke hari ini), atau nomor.
	async function loadDuplikat(id: string) {
		try {
			const [p, its] = await Promise.all([getPengajuanById(id), getPengajuanItems(id)]);
			if (!p) return;
			duplikatFrom = p.nomor_pengajuan || `#${id}`;
			selectedProject = p.project_id ? String(p.project_id) : '';
			tujuanPengajuan = p.tujuan_pengajuan || '';
			kategori = p.kategori || 'operasional';
			selectedCategoryKode = p.kategori_belanja || null;
			dynamicValues = p.dynamic_fields || {};
			urgency = p.urgency === 'Very Urgent' ? 'Sangat Urgent' : (p.urgency || 'Normal');
			notes = p.comments || '';
			paymentMethod = p.payment_method || 'Transfer';
			penerimaDanaType = p.penerima_dana_type || '';
			penerimaDanaNama = p.penerima_dana_nama || '';
			bankName = p.bank_name || '';
			bankAccountNumber = p.bank_account_number || '';
			bankAccountName = p.bank_account_name || '';
			if (p.department_id) departmentId = p.department_id;
			if (Array.isArray(its) && its.length) {
				items = its.map((it: any) => ({
					name: it.deskripsi || '', kategori_item: it.kategori_item || 'lain_lain',
					qty: Number(it.quantity) || 1, unit: it.units || 'Pcs',
					price: Number(it.harga) || 0, vendorName: it.vendor_name || '', notes: it.notes || ''
				}));
			}
		} catch (e) {
			console.error('Gagal menyalin pengajuan:', e);
		}
	}

	function addItem() {
		const defaultItemKategori = (selectedCategory && DEFAULT_ITEM_KATEGORI[selectedCategory.kode]) || 'lain_lain';
		items = [...items, { name: '', kategori_item: defaultItemKategori, qty: 1, unit: 'Pcs', price: 0, vendorName: '', notes: '' }];
	}

	function removeItem(i: number) {
		if (items.length > 1) {
			items = items.filter((_, idx) => idx !== i);
		}
	}

	// ── Template pengajuan rutin (Rekomendasi Section 4) ──────────────────────────
	let templates = $state<PengajuanTemplate[]>([]);
	let selectedTemplateId = $state<number | ''>('');
	let savingTemplate = $state(false);
	let templateNotice = $state('');

	async function loadTemplates() {
		templates = await listPengajuanTemplates();
	}

	function applyTemplate(id: number | '') {
		selectedTemplateId = id;
		const t = templates.find((x) => x.id === Number(id));
		if (!t) return;
		if (t.kategori_belanja) {
			selectedCategoryKode = t.kategori_belanja;
			const cat = categories.find((c) => c.kode === t.kategori_belanja);
			if (cat) handleCategorySelect(cat);
		}
		if (t.department_id) departmentId = t.department_id;
		if (t.tujuan_pengajuan) tujuanPengajuan = t.tujuan_pengajuan;
		if (t.payment_method) paymentMethod = t.payment_method;
		if (t.penerima) {
			penerimaDanaType = t.penerima.type || penerimaDanaType;
			penerimaDanaNama = t.penerima.nama || penerimaDanaNama;
			bankName = t.penerima.bankName || bankName;
			bankAccountNumber = t.penerima.bankAccountNumber || bankAccountNumber;
			bankAccountName = t.penerima.bankAccountName || bankAccountName;
			// Penajaman Penerima Dana & Track Record v2, Fase 4 — template lama tanpa field
			// ini tetap jalan (fallback ke bank* mentah di atas, seperti sebelumnya).
			rekeningPenerimaId = t.penerima.rekeningPenerimaId ?? null;
			isTagihanRekening = false;
		}
		if (Array.isArray(t.items) && t.items.length > 0) {
			items = t.items.map((i) => ({
				name: i.name || '',
				kategori_item: i.kategori_item || '',
				qty: Number(i.qty) || 1,
				unit: i.unit || 'Pcs',
				price: Number(i.price) || 0,
				vendorName: i.vendorName || '',
				notes: i.notes || ''
			}));
		}
		templateNotice = `Template "${t.nama}" dimuat — periksa & sesuaikan sebelum kirim.`;
		setTimeout(() => (templateNotice = ''), 4000);
	}

	async function saveAsTemplate() {
		const nama = prompt('Nama template (mis. "Kontrakan Bulanan MP Bekasi"):', tujuanPengajuan || '');
		if (nama === null) return;
		if (!nama.trim()) { notify('Nama template tidak boleh kosong.'); return; }
		savingTemplate = true;
		try {
			const res = await savePengajuanTemplate({
				nama: nama.trim(),
				department_id: departmentId,
				kategori_belanja: selectedCategoryKode,
				tujuan_pengajuan: tujuanPengajuan,
				payment_method: paymentMethod,
				penerima: {
					type: penerimaDanaType,
					nama: penerimaDanaNama,
					bankName,
					bankAccountNumber,
					bankAccountName,
					// Penajaman Penerima Dana & Track Record v2, Fase 4
					rekeningPenerimaId: isTagihanRekening ? null : rekeningPenerimaId
				},
				items: items
					.filter((it) => it.name.trim())
					.map((it) => ({
						name: it.name,
						kategori_item: it.kategori_item,
						qty: it.qty,
						unit: it.unit,
						price: it.price,
						vendorName: it.vendorName,
						notes: it.notes
					}))
			});
			if (res) {
				templateNotice = `Template "${nama.trim()}" disimpan.`;
				await loadTemplates();
				setTimeout(() => (templateNotice = ''), 4000);
			} else {
				notify('Gagal menyimpan template.');
			}
		} finally {
			savingTemplate = false;
		}
	}

	async function removeTemplate(id: number, nama: string) {
		if (!confirm(`Hapus template "${nama}"?`)) return;
		const ok = await deletePengajuanTemplate(id);
		if (ok) {
			if (selectedTemplateId === id) selectedTemplateId = '';
			await loadTemplates();
		}
	}

	// Fase 3 (T9) — deteksi baris yang tampak berisi >1 pos biaya berbeda (peringatan, BUKAN blokir).
	const POS_KEYWORDS: RegExp[] = [
		/\b(sewa|kontrakan|mess|kos|penginapan)\b/i,
		/\b(transport|transpot|ongkos|bbm|bensin|solar|grab|gojek|ojek|tol|toll|parkir|tiket|angkut)\b/i,
		/\b(operasional|ops|opps)\b/i,
		/\b(gaji|upah|thr|lembur|honor|borongan)\b/i,
		/\b(konsumsi|makan|snack|catering)\b/i
	];
	function parseAmounts(text: string): number[] {
		if (!text) return [];
		const out: number[] = [];
		const re = /(?:rp\.?\s*)?(\d[\d.,]*)\s*(jt|juta|rb|ribu|k)?\b/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			const raw = m[1];
			const unit = (m[2] || '').toLowerCase();
			let n: number;
			if (unit === 'jt' || unit === 'juta') n = parseFloat(raw.replace(/\./g, '').replace(',', '.')) * 1_000_000;
			else if (unit === 'rb' || unit === 'ribu' || unit === 'k') n = parseFloat(raw.replace(/\./g, '').replace(',', '.')) * 1_000;
			else n = parseFloat(raw.replace(/[.,]/g, ''));
			if (Number.isFinite(n) && n >= 1000) out.push(Math.round(n));
		}
		return out;
	}
	function rowLooksMixed(it: { name: string }): boolean {
		const hits = POS_KEYWORDS.filter((re) => re.test(it.name || '')).length;
		return hits >= 2 || parseAmounts(it.name || '').length >= 2;
	}
	let mixedRowIdx = $derived(
		items.map((it, i) => (it.name.trim() && rowLooksMixed(it) ? i : -1)).filter((i) => i >= 0)
	);
	// Fase 5 (T6) — indikasi "pemindahan kas" (bukan belanja) dari judul / rincian item.
	const TRANSFER_KAS_RE = /\b(penarikan dana|pindah dana|pemindahan dana|isi kas kecil|pengisian (petty ?cash|kas kecil)|tarik tunai|tarik dana)\b/i;
	let looksLikeTransferKas = $derived(
		TRANSFER_KAS_RE.test(tujuanPengajuan || '') || items.some((it) => TRANSFER_KAS_RE.test(it.name || ''))
	);
	function autoSplitRow(i: number) {
		const src = items[i];
		const nums = parseAmounts(src.name);
		const parts = (src.name || '')
			.split(/[,.;\n]| dan | \+ /i)
			.map((x) => x.trim())
			.filter(Boolean);
		if (nums.length < 2) {
			// tak ada angka jelas → tetap pecah jadi 2 baris kosong sebagai kerangka
			const clone = { ...src, name: src.name, price: 0 };
			items = [...items.slice(0, i), { ...clone }, { ...clone, name: '' }, ...items.slice(i + 1)];
			return;
		}
		const rows = nums.map((n, k) => ({
			name: (parts[k] || `Pos ${k + 1}`).replace(/\s*rp?\.?\s*[\d.,]+\s*(jt|juta|rb|ribu|k)?/i, '').trim() || `Pos ${k + 1}`,
			kategori_item: '',
			qty: 1,
			unit: src.unit || 'Pcs',
			price: n,
			vendorName: src.vendorName || '',
			notes: src.notes || ''
		}));
		items = [...items.slice(0, i), ...rows, ...items.slice(i + 1)];
	}

	// Fase 3 Bagian B — pola sama seperti dokumenApi.ts::uploadDokumen (uploadFiles SDK)
	// Fase 0.1 — multi-file: tiap berkas diunggah paralel, entry-nya menyimpan state
	// uploading sendiri (pola AjukanAnggaranModal.svelte::handleFileChange di admin).
	async function handleLampiranChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files || []);
		if (files.length === 0) return;

		for (const file of files) {
			// Foto kamera HP sering > 5MB mentah tapi < 1MB setelah dikompres, jadi batas 5MB untuk gambar dicek SETELAH kompresi
			// (mentah maks 15MB, sama dengan P2H). PDF/berkas lain tetap 5MB.
			const isImage = file.type.startsWith('image/');
			if (file.size > (isImage ? 15 : 5) * 1024 * 1024) {
				notify(`"${file.name}" melebihi batas ${isImage ? 15 : 5}MB — dilewati.`);
				continue;
			}
			const entry = { file, id: null as string | null, name: file.name, uploading: true };
			lampiranFiles = [...lampiranFiles, entry];
			const idx = lampiranFiles.length - 1;
			try {
				const compressed = isImage ? await compressPhoto(file) : file;
				if (compressed.size > 5 * 1024 * 1024) {
					notify(`"${file.name}" masih melebihi 5MB setelah dikompres — dilewati.`);
					lampiranFiles = lampiranFiles.filter((_, i) => i !== idx);
					continue;
				}
				const formData = new FormData();
				formData.append('file', compressed);
				formData.append('title', file.name);
				const result = (await directus.request(uploadFiles(formData))) as any;
				lampiranFiles[idx] = { ...lampiranFiles[idx], id: result?.id || null, uploading: false };
				if (!result?.id) {
					notify(`Gagal mengunggah "${file.name}".`);
					lampiranFiles = lampiranFiles.filter((_, i) => i !== idx);
				}
			} catch (err) {
				console.error('Gagal mengunggah lampiran:', err);
				notify(`Gagal mengunggah "${file.name}". Coba lagi.`);
				lampiranFiles = lampiranFiles.filter((_, i) => i !== idx);
			}
		}
		if (lampiranInputEl) lampiranInputEl.value = '';
	}

	function removeLampiran(index: number) {
		lampiranFiles = lampiranFiles.filter((_, i) => i !== index);
		if (lampiranInputEl) lampiranInputEl.value = '';
	}

	// Fase 3 Bagian C — panggil proxy project-epi (bukan admin langsung), warning-only:
	// tidak pernah memblokir submit, hanya menampilkan daftar gate untuk kesadaran pengaju.
	async function handlePeriksaSebelumKirim() {
		checkingPreflight = true;
		submitBlockedError = null;
		try {
			const token = await getIdToken();
			const validItems = items.filter((it) => it.name.trim());
			const payload = JSON.stringify({
				department_id: departmentId,
				project_id: selectedProject ? Number(selectedProject) : null,
				tujuan_pengajuan: tujuanPengajuan,
				kategori,
				kategori_belanja: selectedCategoryKode,
				dynamic_fields:
					Object.keys(dynamicValues).length > 0 || (bbmSplitEnabled && bbmSplits.length > 0)
						? { ...dynamicValues, ...(bbmSplitEnabled && bbmSplits.length > 0 ? { bbm_splits: bbmSplits } : {}) }
						: null,
				items: validItems.map((it) => ({
					deskripsi: it.name,
					kategori_item: it.kategori_item,
					total: it.qty * it.price
				})),
				tanggal_dibutuhkan: tanggalDibutuhkan,
				lampiran_count: uploadedLampiranIds.length
			});
			// Panggilan identik yang sedang berjalan dibagi (bukan cache): hasil tak pernah basi, hanya hemat panggilan ganda.
			const shared = await shareInflight(payload, async () => {
				const res = await fetch('/api/pengajuan-preflight', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
					body: payload
				});
				return res.json().catch(() => ({ available: false, reason: 'Respons tidak valid' }));
			});
			const result = { ...shared }; // salinan: penerapan hint di bawah tidak boleh memutasi objek yang dibagi
			// Fase 2 — tempelkan hint (Kenapa/checklist/action) dari gate_definitions erp-epi
			// alih-alih hardcode kalimat per gate_key di template (F3 di rencana). Gagal
			// dimuat -> gates tetap tampil, hanya tanpa hint tambahan (fail-soft).
			if (result?.available && Array.isArray(result.gates)) {
				const jenisPengajuan = selectedProject ? 'PA-PRJ' : 'PA-OPS';
				const hintResult = await fetchGateHints('pengajuan_anggaran', 'pa', jenisPengajuan).catch(() => null);
				result.gates = applyGateHints(result.gates, hintResult);
			}
			preflightResult = result;
		} catch (e) {
			console.error('Gagal memeriksa gate:', e);
			preflightResult = { available: false, reason: 'Gagal menghubungi pemeriksa gate' };
		} finally {
			checkingPreflight = false;
		}
	}

	// Fase 2 (Rencana v2 Shift-Left Gate Anggaran) — preflight OTOMATIS (debounce
	// 800ms) saat input relevan berubah, menggantikan tombol manual "Periksa" sebagai
	// satu-satunya jalan. Cache per signature input -- tidak memanggil ulang kalau
	// input tidak berubah (hemat API, sesuai instruksi umum proyek).
	let preflightAutoTimer: ReturnType<typeof setTimeout> | null = null;
	let lastPreflightSignature = '';
	$effect(() => {
		const signature = JSON.stringify({
			p: selectedProject,
			d: departmentId,
			t: tujuanPengajuan,
			k: kategori,
			kb: selectedCategoryKode,
			n: totalAmount,
			l: uploadedLampiranIds.length,
			df: dynamicValues,
			bbm: bbmSplitEnabled ? bbmSplits : null,
			td: tanggalDibutuhkan
		});
		if (signature === lastPreflightSignature) return;
		if (preflightAutoTimer) clearTimeout(preflightAutoTimer);
		// Belum ada input minimal (departemen/proyek) -- jangan panggil API untuk form kosong.
		if (!departmentId && !selectedProject) return;
		preflightAutoTimer = setTimeout(() => {
			lastPreflightSignature = signature;
			handlePeriksaSebelumKirim();
		}, 800);
		return () => { if (preflightAutoTimer) clearTimeout(preflightAutoTimer); };
	});

	// PRJ-25: SEMUA validasi pra-kirim dikumpulkan sekali (anggaranValidation.collectErrors) lalu ditampilkan sebagai
	// panel ringkasan + disorot per field — bukan notify() satu per satu. Aturannya identik dengan sebelumnya.
	let showIssues = $state(false);
	function validationInput(): ValidationInput {
		return {
			tujuanPengajuan, atasNama, atasNamaPemohonId, atasNamaAlasan, penerimaDanaNama, paymentMethod, bankName, bankAccountNumber, bankAccountName,
			items, mixedRowCount: mixedRowIdx.length,
			categoriesLoaded: categories.length > 0, selectedCategoryKode, categoryFields, dynamicValues,
			isPettyCashCategory, pettyCashFundId, projectRequired, selectedProject,
			projectRequiredLabel: selectedCategory?.nama || 'Jasa / Pembayaran Proyek',
			isRilisHutang: selectedCategoryKode === 'rilis_hutang',
			hasSelectedPayableInvoice: !!selectedPayableInvoice, rilisNominal: Number(rilisNominal) || 0,
			sisaHutang: Number(selectedPayableInvoice?.outstanding_amount) || 0,
			needsAttachment, hasLampiran: !!hasLampiran,
			hasLampiranException: !!(lampiranExceptionReason && lampiranExceptionNote.trim().length >= MIN_EXCEPTION_NOTE_LENGTH),
			minExceptionNoteLength: MIN_EXCEPTION_NOTE_LENGTH, uploadingLampiran: !!uploadingLampiran,
			bbmSplitEnabled, bbmSplits, formatCurrency
		};
	}
	// Terhitung ulang otomatis saat pengaju memperbaiki field — panel berkurang tanpa reload.
	const liveIssues = $derived(showIssues ? collectErrors(validationInput()) : []);
	// Validasi ringan saat field kehilangan fokus (onblur) + sorotan per field. Pesan baru muncul setelah field disentuh
	// atau setelah Kirim ditekan; hanya severity 'error' yang membuat border merah.
	let touched = $state<Record<string, boolean>>({});
	const touch = (anchor: string) => { if (!touched[anchor]) touched[anchor] = true; };
	const allIssues = $derived(collectErrors(validationInput()));
	const msgsFor = (anchor: string): string[] =>
		showIssues || touched[anchor] ? allIssues.filter((x) => x.severity === 'error' && x.anchorId === anchor).map((x) => x.message) : [];
	function notify(message: string, type: 'info' | 'success' | 'error' = 'info') {
		const t = typeof window !== 'undefined' ? (window as any).__showToast : null;
		if (typeof t === 'function') t(message, type);
		else alert(message);
	}
	function focusIssue(anchorId: string) {
		const el = typeof document !== 'undefined' ? document.getElementById(anchorId) : null;
		if (!el) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		(el as HTMLElement).focus?.();
	}

	async function handleSubmit() {
		showIssues = true;
		const issues = collectErrors(validationInput());
		if (hasBlockingError(issues)) {
			// Scroll ke panel ringkasan; tiap baris di panel bisa diklik untuk loncat ke field-nya.
			setTimeout(() => document.getElementById('panel-kesalahan-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
			return;
		}

		const validItems = items.filter(it => it.name.trim());

		// Dual Gate PA (soft): wajib pernyataan tertulis bila laporan bolong / MoM belum ada.
		if (gatesButuhPernyataan.length > 0 && !hasValidPernyataan(gatePernyataan)) {
			notify('Ada laporan harian yang bolong / MoM belum ada. Isi laporan susulannya, atau tulis pernyataan tertulis (minimal 20 karakter) di panel "Periksa Sebelum Kirim".');
			return;
		}

		// B.4 — Fail-open bertingkat: nominal besar + pemeriksa gate tak terjangkau ->
		// bukan blokir, tapi wajib alasan tertulis. Selalu periksa ULANG di sini (bukan
		// mengandalkan klik manual "Periksa" sebelumnya) supaya sinyal reachability aktual.
		if (totalAmount > failOpenThreshold) {
			await handlePeriksaSebelumKirim();
			if (preflightResult?.available === false) {
				if (failOpenReason.trim().length < 10) {
					showFailOpenReasonField = true;
					notify(
						'Pemeriksa gate tidak dapat dihubungi saat ini. Karena nominal pengajuan ini besar (> ' + formatCurrency(failOpenThreshold) + '), ' +
						'tuliskan dulu alasan singkat (minimal 10 karakter) kenapa tetap dikirim tanpa pemeriksaan — ' +
						'lihat kolom yang baru muncul di atas tombol kirim.'
					);
					return;
				}
			}
		}

		try {
			submitting = true;

			const mappedItems = validItems.map(it => {
				return {
					deskripsi: it.name,
					kategori_item: it.kategori_item,
					vendor_name: it.vendorName || '',
					quantity: it.qty,
					units: it.unit,
					harga: it.price,
					notes: it.notes || '',
					// PRJ-24: hanya dikirim bila fitur dinyalakan (kolom baru) DAN pengaju memilih pos RAP.
					...(rabLinkEnabled && (it as any).rabBudgetId ? { rab_budget_id: Number((it as any).rabBudgetId) } : {})
				};
			});

			// B.4: alasan fail-open HANYA disertakan bila memang kondisinya terpenuhi (nominal
			// besar + preflight tak terjangkau saat submit) -- bukan disimpan untuk semua pengajuan.
			const failOpenExtra = (totalAmount > failOpenThreshold && preflightResult?.available === false && failOpenReason.trim())
				? { _preflight_fail_open_reason: failOpenReason.trim() }
				: {};
			const pernyataanExtra = (gatesButuhPernyataan.length > 0 && hasValidPernyataan(gatePernyataan))
				? { _gate_pernyataan: { teks: gatePernyataan.trim(), gates: gatesButuhPernyataan.map((g) => g.gate_key), at: new Date().toISOString() } }
				: {};

			const formData = {
				nama_pengaju: atasNama ? atasNamaPemohonNama : (currentKaryawanName || currentUser?.displayName || 'Leader'),
				pengaju_id: atasNama ? atasNamaPemohonId : (currentKaryawanId || null),
				...(atasNama ? { is_on_behalf: true, pengisi_karyawan_id: currentKaryawanId, alasan_darurat: atasNamaAlasan.trim() } : {}),
				department: departmentName || currentKaryawanDivisi || 'Project',
				department_id: departmentId,
				lampiran_file_ids: uploadedLampiranIds,
				kategori: kategori,
				kategori_belanja: selectedCategoryKode,
				dynamic_fields: (Object.keys(dynamicValues).length > 0 || (bbmSplitEnabled && bbmSplits.length > 0) || Object.keys(failOpenExtra).length > 0 || Object.keys(pernyataanExtra).length > 0)
					? { ...dynamicValues, ...(bbmSplitEnabled && bbmSplits.length > 0 ? { bbm_splits: bbmSplits } : {}), ...failOpenExtra, ...pernyataanExtra }
					: null,
				urgency: urgency === 'Sangat Urgent' ? 'Very Urgent' : urgency,
				tujuan_pengajuan: tujuanPengajuan,
				tanggal_dibutuhkan: tanggalDibutuhkan,
				payment_method: paymentMethod,
				total_amount: totalAmount,
				comments: notes,
				project_id: selectedProject ? Number(selectedProject) : null,
				penerima_dana_type: penerimaDanaType || null,
				penerima_dana_nama: penerimaDanaNama,
				bank_name: paymentMethod === 'Transfer' ? bankName : '',
				bank_account_number: paymentMethod === 'Transfer' ? bankAccountNumber : '',
				bank_account_name: paymentMethod === 'Transfer' ? bankAccountName : '',
				// Penajaman Penerima Dana & Track Record v2, Fase 4
				rekening_penerima_id: paymentMethod === 'Transfer' && !isTagihanRekening ? rekeningPenerimaId : null,
				created_by_email: currentKaryawanEmail || currentUser?.email || null,
				lampiran_exception_reason: hasLampiran ? null : (lampiranExceptionReason || null),
				lampiran_exception_note: hasLampiran ? null : (lampiranExceptionNote.trim() || null),
				// PA-Rilis Hutang v2 (Fase 4) — submitPengajuanAnggaran (admin) & preflight
				// gate membaca field ini khusus kategori_belanja='rilis_hutang'.
				source_payable_id: selectedCategoryKode === 'rilis_hutang' ? (selectedPayableInvoice?.id ?? null) : null,
				// PC3-08 (FLD-11): dana tujuan isi ulang (createPettyCashReplenishmentFromPA: fund eksplisit menang atas tebakan departemen)
				petty_cash_fund_id: isPettyCashCategory ? Number(pettyCashFundId) || null : null
			};

			const created = await createPengajuanAnggaran(formData, mappedItems, { onWarning: (m) => notify(m, 'error') });
			if (created) {
				createdNomorPengajuan = created.nomor_pengajuan;
				showSuccessModal = true;
				try { localStorage.removeItem(DRAFT_KEY); } catch { /* abaikan */ }
			} else {
				notify('Gagal mengirim pengajuan.');
			}
		} catch (e: any) {
			console.error(e);
			// Fase 2 (F6 di rencana) — gate WAJIB gagal ditolak server tetap dilempar sebagai
			// Error biasa (createPengajuanAnggaran), tapi tidak lagi notify() polos: disorot di
			// panel "Syarat Pengajuan" + scroll ke situ, supaya pengaju tahu PERSIS harus
			// berbuat apa alih-alih membaca kotak dialog lalu bingung.
			const msg = e?.message || 'Gagal mengirim pengajuan.';
			if (msg.startsWith('Pengajuan tidak bisa dikirim')) {
				submitBlockedError = msg;
				await handlePeriksaSebelumKirim();
				document.getElementById('panel-syarat-pengajuan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			} else {
				notify(msg);
			}
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex-1 flex flex-col h-full">
	{#if loading}
		<CircularProgressGauge size={50} strokeWidth={4} label="Memuat formulir pengajuan anggaran..." />
	{:else}
		<div class="scroll-body px-4 py-4 max-w-4xl mx-auto w-full">
			<div class="mb-4">
				<button
					type="button"
					onclick={() => goto('/anggaran')}
					class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
				>
					<IconArrowLeft size={16} />
					<span>Kembali ke Daftar Anggaran</span>
				</button>
				<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Form Pengajuan Anggaran Baru</h2>
			</div>

			{#if duplikatFrom}
				<div class="mb-3 flex items-center gap-2 rounded-xl border border-[var(--p)]/30 bg-[var(--p)]/5 px-3 py-2 text-[12px] text-slate-600 dark:text-slate-300">
					<IconCheck size={16} class="text-[var(--p)] shrink-0" />
					<span>Isian disalin dari <strong class="font-mono">{duplikatFrom}</strong> — periksa & sesuaikan (tanggal, lampiran, nominal) sebelum kirim.</span>
				</div>
			{/if}

			{#if draftAvailable}
				<div class="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
					<div class="flex items-center justify-between gap-2 flex-wrap">
						<span class="text-[12px] text-amber-800">
							💾 Ada draf tersimpan di perangkat ini{savedDraftAt ? ` (${new Date(savedDraftAt).toLocaleString('id-ID')})` : ''}.
						</span>
						<div class="flex gap-2 shrink-0">
							<button type="button" class="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[var(--p)] text-white" onclick={restoreDraft}>Pulihkan</button>
							<button type="button" class="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-amber-300 text-amber-700" onclick={discardDraft}>Buang</button>
						</div>
					</div>
				</div>
			{/if}

			<!-- Fase 5B (Penajaman v2, 2 Sep 2026): Self-check SPJ — mendidik pengaju SEBELUM
			     ditolak G17 setelah submit, TIDAK PERNAH menahan pengaju membuka/mengisi form. -->
			{#if !loadingSpjCheck && spjCheck?.available && ((spjCheck.data?.overdueBlocking?.length ?? 0) > 0 || (spjCheck.data?.overdueNullOnly?.length ?? 0) > 0)}
				<div class="mb-3 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-900 px-3 py-2.5">
					<p class="text-[12px] font-semibold text-red-800 dark:text-red-300">
						⚠ Anda punya {(spjCheck.data.overdueBlocking?.length ?? 0) + (spjCheck.data.overdueNullOnly?.length ?? 0)} pengajuan yang belum dipertanggungjawabkan (SPJ)
					</p>
					<ul class="mt-1 space-y-0.5 text-[11px] text-red-700 dark:text-red-400">
						{#each [...(spjCheck.data.overdueBlocking ?? []), ...(spjCheck.data.overdueNullOnly ?? [])].slice(0, 5) as p}
							<li>• {p.nomor_pengajuan || `#${p.id}`} — {formatCurrency(p.total_amount)}, terlambat {p.hariTerlambat} hari</li>
						{/each}
					</ul>
					<p class="text-[10px] text-red-500 mt-1">
						{#if (spjCheck.data.overdueBlocking?.length ?? 0) > 0}
							Selesaikan pertanggungjawaban di atas dulu — pengajuan baru bisa tertahan gate saat dikirim.
						{:else}
							Ini data lama (belum wajib diselesaikan), tapi lebih baik dituntaskan.
						{/if}
					</p>
				</div>
			{/if}

			<SectionGuide
				id="anggaran.baru.sectionGuide"
				title={h('baru.sectionGuide')?.sectionGuide?.title}
				steps={h('baru.sectionGuide')?.sectionGuide?.steps ?? []}
			/>

			<!-- Template pengajuan rutin (Rekomendasi Section 4) -->
			<div class="card-section">
				<h4><IconDeviceFloppy size={16} class="text-[var(--p)]" /> Template pengajuan</h4>
				<p class="text-[11px] text-gray-400 mb-2">
					Untuk pengajuan yang berulang (kontrakan bulanan, BBM mingguan). Muat template lalu sesuaikan angka/tanggal sebelum kirim.
				</p>
				<div class="flex gap-2">
					<select
						class="f-select flex-1"
						value={selectedTemplateId}
						onchange={(e) => applyTemplate((e.currentTarget.value ? Number(e.currentTarget.value) : ''))}
					>
						<option value="">— Muat dari template —</option>
						{#each templates as t}
							<option value={t.id}>{t.nama}</option>
						{/each}
					</select>
					<button
						type="button"
						class="py-2 px-3 border border-gray-200 rounded-xl text-gray-600 text-[12px] font-medium whitespace-nowrap active:bg-gray-50 disabled:opacity-60"
						onclick={saveAsTemplate}
						disabled={savingTemplate}
					>
						{savingTemplate ? 'Menyimpan…' : '💾 Simpan sbg template'}
					</button>
				</div>
				{#if selectedTemplateId}
					{@const cur = templates.find((x) => x.id === Number(selectedTemplateId))}
					{#if cur}
						<button
							type="button"
							class="text-[11px] text-red-500 mt-1.5 hover:underline"
							onclick={() => removeTemplate(cur.id!, cur.nama)}
						>Hapus template "{cur.nama}"</button>
					{/if}
				{/if}
				{#if templateNotice}
					<p class="text-[11px] text-emerald-600 mt-1.5">{templateNotice}</p>
				{/if}
			</div>

			<!-- Informasi -->
			<div class="card-section">
				<h4><IconInfoCircle size={16} class="text-[var(--p)]" /> Informasi pengajuan</h4>

				<div class="grid grid-cols-2 gap-2 mb-2.5">
					<div>
						<div class="flex items-center gap-1.5 mb-1">
							<label class="f-label mb-0">Nama Pengaju *</label>
							<span class="text-[9px] bg-blue-50 text-blue-500 px-1 py-0.5 rounded font-semibold lowercase">dari akun</span>
						</div>
						<input type="text" class="f-input bg-gray-50 border-gray-200 text-gray-400" value={currentKaryawanName || currentUser?.displayName || 'Leader'} disabled>
					</div>
					<div>
						<label class="f-label">Departemen *</label>
						<select bind:value={departmentId} class="f-select">
							<option value={null}>— Pilih Departemen —</option>
							{#each departments as d}
								<option value={d.id}>{d.nama_department}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="mb-2.5">
					<label class="f-label">Urgensi</label>
					<select bind:value={urgency} class="f-select">
						<option value="Normal">Normal</option>
						<option value="Urgent">Urgent</option>
						<option value="Sangat Urgent">Sangat Urgent</option>
					</select>
				</div>

				<div class="mb-2.5">
					<div class="flex items-center gap-1 mb-1">
						<label class="f-label mb-0">Tujuan Pengajuan *</label>
						<HelpIcon text={h('baru.form.tujuan')?.fieldHint} />
					</div>
					<input id="f-tujuan" type="text" bind:value={tujuanPengajuan} onblur={() => touch('f-tujuan')} placeholder="Contoh: Biaya operasional kendaraan bulan April" class="f-input" class:!border-red-500={msgsFor('f-tujuan').length > 0} aria-invalid={msgsFor('f-tujuan').length > 0}>
					{#each msgsFor('f-tujuan') as m}<p class="text-[11px] text-red-600 mt-0.5">{m}</p>{/each}
				</div>

				<div class="grid grid-cols-2 gap-2 mb-2.5">
					<div>
						<label class="f-label">Tanggal Dibutuhkan *</label>
						<input type="date" bind:value={tanggalDibutuhkan} class="f-input">
					</div>
					<div>
						<label class="f-label">Metode Pembayaran</label>
						<select bind:value={paymentMethod} class="f-select">
							<option value="Transfer">Transfer</option>
							<option value="Cash">Cash</option>
						</select>
					</div>
				</div>

				<div>
					<div class="flex items-center gap-1 mb-1">
						<label class="f-label mb-0">Proyek Terkait {projectRequired ? '*' : '(opsional)'}</label>
						<HelpIcon text={h('baru.form.proyek')?.helpIcon || h('baru.form.proyek')?.fieldHint} />
					</div>
					<ProjectSelect {projects} bind:value={selectedProject} />
					<!-- Fase 5B (Penajaman v2, 2 Sep 2026): Banner Sisa Anggaran — informatif, TIDAK PERNAH menahan submit -->
					{#if selectedProject}
						{#if loadingPagu}
							<p class="text-[11px] text-slate-400 mt-1.5">Memeriksa sisa pagu proyek...</p>
						{:else if pagu?.status === 'ok' && pagu.used_pct != null}
							{@const lvl = paguAfter?.level ?? pagu.level}
							<div class="mt-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] {PROYEKSI_CLS[lvl] ?? PROYEKSI_CLS.none}" data-testid="pagu-banner" data-tone={lvl}>
								💰 Sisa pagu RAP proyek: <strong>{Math.max(pagu.remaining_pct ?? 0, 0).toFixed(1)}%</strong> (terpakai {pagu.used_pct.toFixed(1)}%, sudah termasuk pengajuan yang masih menunggu persetujuan)
								{#if paguAfter}
									{#if paguAfter.over}
										<div class="mt-1 font-semibold">⚠️ Dengan nominal pengajuan ini, pagu proyek akan terlampaui.</div>
										<div class="mt-0.5 opacity-80">Tetap bisa dikirim, tetapi akan ditandai pada pemeriksaan dan butuh persetujuan/override sesuai aturan. Pertimbangkan mengurangi atau memecah nominal.</div>
									{:else if paguAfter.level === 'warn'}
										<div class="mt-1 font-semibold">🟡 Setelah pengajuan ini pagu proyek mendekati batas.</div>
									{:else}
										<div class="mt-1 opacity-80">Nominal pengajuan ini masih dalam batas aman pagu proyek.</div>
									{/if}
								{:else if pagu.level === 'danger'}
									<div class="mt-1 font-semibold">⚠️ Pagu RAP proyek ini sudah habis/terlampaui.</div>
								{/if}
								<div class="mt-0.5 text-[10px] opacity-70">Angka rupiah pagu hanya dilihat Finance/Admin. Isi nominal pengajuan untuk melihat dampaknya.</div>
							</div>
						{:else if pagu?.status === 'unknown'}
							<div class="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800/50 dark:border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-500 dark:text-slate-400">
								ℹ️ Sisa pagu tidak dapat dihitung: {pagu.note || 'RAP proyek belum disusun'}.
							</div>
						{/if}
						<PlafonMandiriMeter projectId={selectedProject} amount={totalAmount} kategori={selectedCategoryKode} />
					{/if}
				</div>

				<AtasNamaPanel
					projectId={selectedProject ? Number(selectedProject) : null}
					bind:enabled={atasNama}
					bind:alasan={atasNamaAlasan}
					bind:pemohonId={atasNamaPemohonId}
					bind:pemohonNama={atasNamaPemohonNama}
					jenisLabel="pengajuan anggaran"
				/>
			</div>

			<!-- Fase 3 (Pengajuan Anggaran v3): CategoryPicker menggantikan dropdown Operasional/Jasa -->
			<div class="card-section">
				<div class="flex items-center justify-between gap-1 mb-2">
					<div class="flex items-center gap-1">
						<h4 class="mb-0">Kategori Pengajuan *</h4>
						<HelpIcon text={h('baru.form.kategori')?.helpIcon || h('baru.form.kategori')?.fieldHint} />
					</div>
					{#if selectedCategoryKode}
						<span class="text-[11px] font-semibold text-[var(--p)] bg-[var(--p)]/10 px-2 py-0.5 rounded-full">
							{selectedCategory?.nama || activeClue?.nama || selectedCategoryKode}
						</span>
					{/if}
				</div>
				{#if recentCats.length > 0 && !selectedCategoryKode}
					<div class="flex flex-wrap items-center gap-1.5 text-[11px] mb-2">
						<span class="text-gray-500" title="Kategori yang paling sering/terakhir Anda pakai. Ketuk untuk memilih cepat.">⭐ Terakhir dipakai</span>
						{#each recentCats as rc (rc.kode)}
							<button type="button" class="px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-900 font-semibold" onclick={() => { selectedCategoryKode = rc.kode; handleCategorySelect(rc); }}>{rc.icon || ''} {rc.nama}</button>
						{/each}
					</div>
				{/if}
				<CategoryPicker {categories} bind:selectedKode={selectedCategoryKode} {departmentCode} onSelect={handleCategorySelect} />

				{#if isPettyCashCategory}
					<div class="mt-3">
						<label class="f-label" for="pc-fund-target">Dana kas kecil yang diisi ulang <span class="text-red-500">*</span></label>
						<select id="pc-fund-target" class="f-select" bind:value={pettyCashFundId} disabled={pettyCashFundsLoading}>
							<option value="">{pettyCashFundsLoading ? 'Memuat dana…' : '-- Pilih dana --'}</option>
							{#each pettyCashFunds as f (f.id)}
								<option value={String(f.id)}>{f.fund_name}{f.department ? ` (${f.department})` : ''}</option>
							{/each}
						</select>
						{#if pettyCashFundsError}
							<p class="text-[11px] text-red-600 mt-1">{pettyCashFundsError}</p>
						{/if}
						<p class="text-[11px] text-slate-500 mt-1">
							Pilih dana yang saldonya akan ditambah. Untuk meminta uang belanja kecil, gunakan menu Kas Kecil, bukan form ini.
						</p>
					</div>
				{/if}

				{#if katMatch?.wajib}
					<!-- Hard: tidak bisa ditutup. Server memblokir pengiriman bila kategori tidak dipindah (pengecualian GM/Finance). -->
					<div class="mt-2 flex items-start justify-between gap-2 text-[11px] bg-red-50 border border-red-300 rounded-lg p-2.5 text-red-900" role="alert">
						<div>
							<div>⛔ Kategori tidak sesuai isi pengajuan. Pindahkan ke <strong>{katMatch.nama}</strong>.</div>
							<div class="opacity-80">{katMatch.alasan}</div>
							<div class="opacity-70 mt-0.5">❓ Kategori menentukan syarat dokumen, aturan, dan akun biaya. Pengajuan tidak bisa dikirim sebelum dipindah.</div>
							{#if !katMatchCat}<div class="mt-0.5 font-semibold">Kategori ini tidak tersedia di akun Anda — hubungi Finance untuk reklasifikasi.</div>{/if}
						</div>
						{#if katMatchCat}
							<button type="button" class="shrink-0 px-2.5 py-1 rounded bg-red-600 text-white font-semibold"
								onclick={() => { if (katMatchCat) { selectedCategoryKode = katMatchCat.kode; handleCategorySelect(katMatchCat); } }}>
								Pindah ke {katMatch.nama}
							</button>
						{/if}
					</div>
				{:else if katMatch && katMatchCat}
					<div class="mt-2 flex items-center gap-2 text-[11px] bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-900">
						<span>⚠️ Isi pengajuan lebih cocok dengan <strong>{katMatch.nama}</strong>. {katMatch.alasan}.</span>
						<button type="button" class="px-2 py-0.5 rounded bg-amber-600 text-white font-semibold"
							onclick={() => { if (katMatchCat) { selectedCategoryKode = katMatchCat.kode; handleCategorySelect(katMatchCat); } }}>
							Pindah
						</button>
					</div>
				{:else if guessedCat && guessedKode !== selectedCategoryKode}
					<div class="mt-2 flex items-center gap-2 text-[11px] bg-indigo-50 border border-indigo-200 rounded-lg p-2 text-indigo-800">
						<span>💡 Dari keterangan, sepertinya ini <strong>{guessedCat.nama}</strong>.</span>
						<button
							type="button"
							class="px-2 py-0.5 rounded bg-indigo-600 text-white font-semibold"
							onclick={() => { selectedCategoryKode = guessedKode; if (guessedCat) handleCategorySelect(guessedCat); }}
						>
							Pakai
						</button>
					</div>
				{/if}

				{#if looksLikeTransferKas && selectedCategoryKode !== 'transfer_kas'}
					<div class="mt-2 text-[11px] bg-sky-50 border border-sky-200 rounded p-2 text-sky-800">
						💡 Judul/rincian menyebut penarikan atau pemindahan dana. Kalau ini <strong>bukan belanja</strong>
						(mis. mengisi kas kecil, tarik tunai dari bank), pilih kategori <strong>“Pemindahan Kas (Non-Beban)”</strong>
						agar tidak tercatat sebagai beban proyek.
					</div>
				{/if}

				{#if selectedCategoryKode && activeClue}
					<div class="mt-3 p-3 bg-gray-50/90 rounded-xl border border-gray-200 space-y-2">
						<div class="flex items-start gap-2.5">
							<span class="text-2xl p-1 bg-white rounded-lg shadow-2xs border border-gray-100 shrink-0">
								{activeClue.icon || selectedCategory?.icon || '📄'}
							</span>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-1.5 flex-wrap">
									<h5 class="text-xs font-bold text-gray-800">{activeClue.nama}</h5>
									<span class="text-[9px] font-mono px-1 py-0.2 bg-gray-200 text-gray-700 rounded">
										{selectedCategoryKode}
									</span>
									{#if selectedCostBehavior && COST_BEHAVIOR_BADGE[selectedCostBehavior]}
										<span
											class="text-[9px] font-semibold px-1.5 py-0.5 rounded border {COST_BEHAVIOR_BADGE[selectedCostBehavior].cls}"
											title={COST_BEHAVIOR_BADGE[selectedCostBehavior].hint}
										>
											{COST_BEHAVIOR_BADGE[selectedCostBehavior].label}
										</span>
									{/if}
								</div>
								{#if selectedCostBehavior === 'VARIABLE'}
									<p class="text-[10px] text-emerald-700 mt-0.5">
										Biaya ini langsung memotong margin kontribusi proyek — cek "Sisa Jatah" di menu RAP vs Aktual.
									</p>
								{/if}
								<p class="text-[11px] text-gray-600 mt-0.5 leading-snug">
									{activeClue.description}
								</p>
							</div>
						</div>

						{#if activeClue.examples?.length}
							<div class="pt-2 border-t border-gray-200/70">
								<div class="text-[10px] font-bold text-gray-700 mb-1">💡 Contoh Pengeluaran:</div>
								<div class="flex flex-wrap gap-1">
									{#each activeClue.examples as ex}
										<span class="text-[9.5px] bg-white text-gray-700 px-1.5 py-0.5 rounded border border-gray-200">
											{ex}
										</span>
									{/each}
								</div>
							</div>
						{/if}

						{#if activeClue.requirements?.length}
							<div class="pt-2 border-t border-gray-200/70">
								<div class="text-[10px] font-bold text-amber-800 mb-1">📋 Ketentuan Wajib:</div>
								<ul class="text-[10px] text-gray-600 space-y-0.5 list-disc list-inside">
									{#each activeClue.requirements as req}
										<li>{req}</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{:else if !selectedCategoryKode}
					<p class="text-[11px] text-gray-400 mt-2 italic">
						💡 Pilih kategori di atas untuk melihat panduan pengeluaran &amp; ketentuan lampiran wajib.
					</p>
				{/if}
			</div>

			<DynamicBudgetForm fields={categoryFields} bind:values={dynamicValues} />

			{#if selectedCategory?.kode === 'bbm_transport'}
				<BbmSplitAllocator bind:splits={bbmSplits} bind:enabled={bbmSplitEnabled} />
			{/if}

			{#if kategori === 'jasa' && categoryUsesProjectAxis}
				<div class="card-section">
					<h4><IconUsers size={16} class="text-[var(--p)]" /> Upah Manpower</h4>
					<p class="text-[12px] text-gray-500 leading-relaxed">
						Pembayaran upah manpower sekarang wajib lewat modul <strong>Rekap Upah</strong> (buat rekap dari absensi →
						disetujui → pengajuan kas ke Finance dibuat otomatis) — bukan diinput manual di sini lagi.
						Kalau pengajuan ini untuk kebutuhan jasa/subkon lain (bukan upah manpower harian/borongan), lanjutkan seperti biasa.
					</p>
				</div>
			{/if}

			<!-- Penerima Dana -->
			<div class="card-section">
				<div class="flex items-center justify-between mb-2">
					<h4 class="mb-0"><IconNote size={16} class="text-[var(--p)]" /> Penerima Dana</h4>
					<HelpIcon text={h('baru.form.penerima')?.fieldHint} />
				</div>
				
				<div class="grid grid-cols-2 gap-2 mb-2.5">
					<div>
						<label class="f-label">Tipe Penerima Dana</label>
						<select bind:value={penerimaDanaType} class="f-select">
							<option value="">— Pilih Tipe —</option>
							<option value="pt">PT (Perusahaan)</option>
							<option value="individu">Individu</option>
							<option value="vendor">Vendor</option>
							<option value="pihak_ketiga">Pihak Ketiga</option>
						</select>
					</div>
					<div>
						<label class="f-label">Nama Penerima Dana</label>
						<input id="f-penerima" type="text" bind:value={penerimaDanaNama} onblur={() => touch('f-penerima')} placeholder="Nama PT / Individu / Vendor" class="f-input" class:!border-red-500={msgsFor('f-penerima').length > 0} aria-invalid={msgsFor('f-penerima').length > 0}>
						{#each msgsFor('f-penerima') as m}<p class="text-[11px] text-red-600 mt-0.5">{m}</p>{/each}
					</div>
				</div>

				{#if paymentMethod === 'Transfer'}
					<div id="f-rekening" tabindex="-1" onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) touch('f-rekening'); }} class="border rounded-xl p-3 bg-gray-50 mt-1 scroll-mt-16 {msgsFor('f-rekening').length > 0 ? 'border-red-500' : 'border-gray-100'}">
						<div class="flex justify-end mb-0.5">
							<HelpIcon text={h('baru.form.rekening')?.helpIcon || h('baru.form.rekening')?.fieldHint} />
						</div>
						<RekeningSelect
							bind:bankName
							bind:bankAccountNumber
							bind:bankAccountName
							bind:rekeningPenerimaId
							bind:isTagihan={isTagihanRekening}
						/>
						{#each msgsFor('f-rekening') as m}<p class="text-[11px] text-red-600 mt-1">{m}</p>{/each}
					</div>
				{/if}
			</div>

			<!-- Daftar Pos Anggaran (disembunyikan utk kategori 'rilis_hutang' — lihat blok PA-Rilis di bawah) -->
			{#if selectedCategoryKode !== 'rilis_hutang'}
			<div class="card-section">
				<div class="flex justify-between items-center mb-3">
					<div class="flex items-center gap-1.5">
						<h4 class="mb-0"><IconListNumbers size={16} class="text-[var(--p)]" /> Daftar Pos Anggaran *</h4>
						<HelpIcon text={h('baru.form.item')?.fieldHint} />
					</div>
					<span class="text-[12px] font-semibold text-[var(--p)]">Total: {formatCurrency(totalAmount)}</span>
				</div>

				<div id="f-items" class="scroll-mt-16"></div>
				{#each items as item, i}
					<div id="f-item-{i}" onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) touch('f-item-' + i); }} class="border-b border-gray-100 pb-3 mb-3 last:border-none last:pb-0 last:mb-0 relative scroll-mt-16" class:border-l-2={msgsFor('f-item-' + i).length > 0} class:border-l-red-500={msgsFor('f-item-' + i).length > 0} class:pl-2={msgsFor('f-item-' + i).length > 0}>
						{#each msgsFor('f-item-' + i) as m}<p class="text-[11px] text-red-600 mb-1">{m}</p>{/each}
						{#if items.length > 1}
							<button class="absolute top-0 right-0 text-gray-300 hover:text-red-400 text-[11px]" onclick={() => removeItem(i)}>✕</button>
						{/if}
						<div class="mb-2">
							<label class="f-label">Deskripsi</label>
							<input type="text" bind:value={item.name} oninput={() => scheduleSuggest(i, item.name)} class="f-input" placeholder="Deskripsi pos anggaran">
							{#if catSuggest[i] && catSuggest[i] !== item.kategori_item}
								<div class="mt-1 text-[11px] rounded p-1.5 flex items-center gap-2 {item.kategori_item ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-blue-50 border border-blue-200 text-blue-800'}">
									<span class="flex-1">{item.kategori_item ? `⚠️ Kategori "${catLabel(item.kategori_item)}" mungkin kurang tepat. ` : ''}Saran: <strong>{catLabel(catSuggest[i] as string)}</strong></span>
									<button type="button" class="shrink-0 px-2 py-0.5 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700" onclick={() => { item.kategori_item = catSuggest[i] as string; }}>Pakai saran</button>
								</div>
							{/if}
							{#if item.name.trim() && rowLooksMixed(item)}
								<div class="mt-1 text-[11px] bg-amber-50 border border-amber-200 rounded p-1.5 text-amber-800 flex items-start gap-2">
									<span class="flex-1">⚠️ Baris ini sepertinya berisi lebih dari satu pos biaya. Pisahkan jadi item terpisah agar Finance bisa membukukan ke akun yang benar — dan pengajuan Anda tidak tertahan.</span>
									<button type="button" class="shrink-0 px-2 py-0.5 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700" onclick={() => autoSplitRow(i)}>✂️ Pisahkan Otomatis</button>
								</div>
							{/if}
						</div>

						<div class="grid grid-cols-2 gap-2 mb-2">
							<div>
								<label class="f-label">Kategori</label>
								<select bind:value={item.kategori_item} class="f-select" class:ring-1={!item.kategori_item} class:ring-amber-400={!item.kategori_item}>
									<option value="" disabled>— Pilih kategori —</option>
									{#each itemCategories as cat}
										<option value={cat.value}>{cat.label}</option>
									{/each}
								</select>
								{#if !item.kategori_item}
									<p class="text-[11px] text-amber-600 mt-0.5">Wajib dipilih agar Finance membukukan ke akun yang benar.</p>
								{:else}
									<p class="text-[10px] text-gray-400 mt-0.5">Kategori menentukan pos biaya proyek. Ikuti saran bila ragu.</p>
								{/if}
							</div>
							<div>
								<label class="f-label">Vendor (opsional)</label>
								<input type="text" bind:value={item.vendorName} class="f-input" placeholder="Nama vendor">
							</div>
						</div>

						{#if rabLinkEnabled && selectedProject && rapPos.length > 0}
							<div class="mb-2">
								<label class="f-label">Pos RAP (opsional)</label>
								<select bind:value={item.rabBudgetId} class="f-select">
									<option value="">— Tidak ditautkan —</option>
									{#each rapPos.filter((p) => !item.kategori_item || p.bucket === item.kategori_item) as p}
										<option value={p.id}>{p.label} · RAP {formatCurrency(p.rap)} · terpakai {formatCurrency(p.terpakai)}</option>
									{/each}
								</select>
								<p class="text-[10px] text-gray-400 mt-0.5">Pilih pos RAP agar sisa anggaran per item terlihat.</p>
							</div>
						{/if}

						<div class="grid grid-cols-3 gap-2 mb-2">
							<div>
								<label class="f-label">Qty</label>
								<input type="number" bind:value={item.qty} class="f-input" min="1">
							</div>
							<div>
								<label class="f-label">Satuan</label>
								<select bind:value={item.unit} class="f-select">
									<option value="Pcs">Pcs</option>
									<option value="Liter">Liter</option>
									<option value="Sak">Sak</option>
									<option value="Kg">Kg</option>
									<option value="Unit">Unit</option>
									<option value="Set">Set</option>
									<option value="Hari">Hari</option>
									<option value="Jam">Jam</option>
									<option value="Box">Box</option>
									<option value="Lainnya">Lainnya</option>
								</select>
							</div>
							<div>
								<label class="f-label">Est. Harga</label>
								<input type="number" bind:value={item.price} class="f-input">
							</div>
						</div>

						<div class="bg-gray-50 rounded-lg p-2 flex justify-between items-center border border-gray-100">
							<span class="text-[11px] text-gray-400">Subtotal</span>
							<span class="text-[12px] font-semibold text-[var(--pd)]">{formatCurrency(item.qty * item.price)}</span>
						</div>
					</div>
				{/each}

				<button class="btn-action purple" onclick={addItem}>
					<IconPlus size={14} /> + Tambah Pos Anggaran
				</button>
			</div>
			{:else}
			<!-- PA-Rilis Hutang v2 (Fase 4) -->
			<div class="card-section">
				<div class="flex items-center gap-1.5 mb-3">
					<h4 class="mb-0"><IconListNumbers size={16} class="text-[var(--p)]" /> Rilis Pembayaran Hutang Supplier *</h4>
					<HelpIcon text={h('baru.form.item')?.fieldHint} />
				</div>

				<PayablePickerLite
					projectIds={projects.map((p) => p.id)}
					bind:value={prefillPayableId}
					onSelect={handlePayableSelect}
				/>

				{#if selectedPayableInvoice}
					<div class="mt-3 p-3 bg-purple-50/60 border border-purple-200 rounded-xl space-y-2.5">
						<div class="grid grid-cols-2 gap-2 text-xs text-slate-600">
							<div>Total tagihan<br /><strong>{formatCurrency(selectedPayableInvoice.total_amount)}</strong></div>
							<div>Sisa hutang<br /><strong class="text-purple-700">{formatCurrency(selectedPayableInvoice.outstanding_amount)}</strong></div>
						</div>
						<div>
							<label class="f-label">Nominal Rilis *</label>
							<input type="number" bind:value={rilisNominal} max={selectedPayableInvoice.outstanding_amount} min="0" class="f-input" />
							<p class="text-[11px] text-gray-500 mt-1">Isi lebih kecil dari sisa kalau mau bayar bertahap. Sisa hutang tetap tercatat.</p>
						</div>
						<div class="text-right text-xs">
							<span class="text-slate-500">Total pengajuan:</span>
							<span class="font-bold text-purple-700 ml-1">{formatCurrency(rilisNominal)}</span>
						</div>
					</div>
				{/if}

				<div class="mt-2.5 text-[11px] text-gray-500 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-1.5">
					💡 Pengajuan rilis hutang tidak butuh lampiran atau SPJ terpisah — invoice supplier sudah jadi pertanggungjawabannya.
				</div>
			</div>
			{/if}

			<!-- Catatan Tambahan & Lampiran -->
			<div class="card-section">
				<div class="flex items-center justify-between mb-2">
					<h4 class="mb-0"><IconNote size={16} class="text-[var(--p)]" /> Dokumen Bukti & Catatan</h4>
					<HelpIcon text={h('baru.form.lampiran')?.helpIcon || h('baru.form.lampiran')?.fieldHint} />
				</div>
				<div class="mb-2.5">
					<textarea bind:value={notes} rows="3" placeholder="Tambahkan catatan atau keterangan pengajuan..." class="f-textarea"></textarea>
				</div>
				<input type="file" multiple accept="image/jpeg,image/png,application/pdf" class="hidden" bind:this={lampiranInputEl} onchange={handleLampiranChange} />
				{#if lampiranFiles.length > 0}
					<div class="space-y-1.5 mb-2">
						{#each lampiranFiles as lf, i}
							<div class="flex items-center justify-between border border-gray-200 rounded-xl p-3 bg-gray-50">
								<div class="flex items-center gap-2 min-w-0">
									<IconPaperclip size={18} class="text-[var(--p)] shrink-0" />
									<span class="text-[12px] text-gray-700 truncate">{lf.name}</span>
									{#if lf.uploading}<IconLoader2 size={14} class="animate-spin text-gray-400 shrink-0" />{/if}
								</div>
								<button class="text-gray-300 hover:text-red-400 text-[12px] shrink-0" onclick={() => removeLampiran(i)}>✕</button>
							</div>
						{/each}
					</div>
				{/if}

				<button
					type="button"
					class="w-full border border-dashed border-gray-300 rounded-xl p-4 text-center cursor-pointer hover:bg-gray-50 transition-colors"
					onclick={() => lampiranInputEl?.click()}
				>
					<IconPaperclip size={22} class="text-gray-300 mx-auto" />
					<p class="text-[12px] text-gray-400 mt-1.5">
						{lampiranFiles.length > 0 ? 'Tambah Berkas Lampiran Lain' : `Unggah Dokumen ${needsAttachment ? `(Wajib untuk kategori ${selectedCategory?.nama || 'Operasional'})` : '(Opsional)'}`}
					</p>
					<p class="text-[11px] text-gray-300 mt-0.5">Bisa pilih beberapa berkas sekaligus · JPG, PNG, PDF — maks 5MB per berkas</p>
				</button>

				{#if needsAttachment && !hasLampiran}
					{#if !showLampiranException}
							<button
								type="button"
								class="w-full text-center text-[11px] text-gray-400 underline mt-2"
								onclick={() => (showLampiranException = true)}
							>Tidak ada lampiran fisik? Ajukan alasan pengecualian</button>
						{:else}
							<div class="mt-2 border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-[11px] font-semibold text-amber-700">Alasan pengecualian lampiran</span>
									<button type="button" class="text-[11px] text-gray-400" onclick={() => { showLampiranException = false; lampiranExceptionReason = ''; lampiranExceptionNote = ''; }}>✕ Batal</button>
								</div>
								<select bind:value={lampiranExceptionReason} class="f-select">
									<option value="">— Pilih alasan —</option>
									{#each lampiranExceptionReasons as r}
										<option value={r.value}>{r.label}</option>
									{/each}
								</select>
								<textarea
									bind:value={lampiranExceptionNote}
									rows="2"
									placeholder={`Jelaskan detailnya (minimal ${MIN_EXCEPTION_NOTE_LENGTH} karakter)...`}
									class="f-textarea"
								></textarea>
								<p class="text-[10px] {lampiranExceptionNote.trim().length >= MIN_EXCEPTION_NOTE_LENGTH ? 'text-green-600' : 'text-amber-500'}">
									{lampiranExceptionNote.trim().length}/{MIN_EXCEPTION_NOTE_LENGTH} karakter minimal · alasan ini tercatat permanen untuk audit
								</p>
							</div>
						{/if}
					{/if}

					<AttachmentChecklist
						categoryId={selectedCategory?.id ?? null}
						uploadedCount={uploadedLampiranIds.length}
						hasException={!!lampiranExceptionReason && lampiranExceptionNote.trim().length >= MIN_EXCEPTION_NOTE_LENGTH}
						draft={attachmentDraft}
					/>
			</div>

			<!-- Fase 3 Bagian C: Panel Pra-Terbang -->
			<div class="card-section" id="panel-syarat-pengajuan">
				{#if submitBlockedError}
					<div class="mb-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">
						❌ {submitBlockedError}
					</div>
				{/if}
				<div class="flex items-center justify-between mb-2">
					<h4 class="mb-0 flex items-center gap-1.5">
						🛫 Syarat Pengajuan
						<HelpIcon text="Dicek otomatis setiap Anda mengubah isian (proyek, kategori, nominal, lampiran). Merah = wajib dilengkapi sebelum dikirim; kuning = catatan untuk approver." />
					</h4>
					<button class="text-[11px] text-[var(--p)] font-medium disabled:opacity-50" onclick={handlePeriksaSebelumKirim} disabled={checkingPreflight}>
						{checkingPreflight ? 'Mengecek...' : '🔄 Cek Ulang'}
					</button>
				</div>
				{#if preflightResult}
					{#if preflightResult.available === false}
						<p class="text-[11px] text-gray-400">{preflightResult.reason || 'Pemeriksaan gate belum tersedia — pengajuan tetap bisa dikirim.'}</p>
					{:else if preflightResult.gates}
						<!-- Meteran pagu department (Rekomendasi Section 4). Angka dari pemeriksa gate admin. -->
						{#if preflightResult.budget && preflightResult.budget.pagu_exists}
							{@const b = preflightResult.budget}
							{@const pakai = (b.realisasi_ytd || 0) + (b.komitmen_ytd || 0)}
							{@const pct = b.pagu_ytd > 0 ? Math.min(100, Math.round((pakai / b.pagu_ytd) * 100)) : 0}
							{@const habis = (b.sisa_pagu || 0) < totalAmount}
							<div class="mb-2 p-2 rounded-lg border {habis ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}">
								<div class="flex items-center justify-between text-[11px] mb-1">
									<span class="font-medium text-gray-700">Meteran Pagu Department (tahun berjalan)</span>
									<span class="{habis ? 'text-red-600 font-semibold' : 'text-gray-500'}">
										Sisa: Rp {Math.round(b.sisa_pagu || 0).toLocaleString('id-ID')}
									</span>
								</div>
								<div class="h-1.5 rounded-full bg-gray-200 overflow-hidden">
									<div class="h-full {pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500'}" style="width: {pct}%"></div>
								</div>
								<div class="flex justify-between text-[10px] text-gray-400 mt-1">
									<span>Terpakai Rp {Math.round(pakai).toLocaleString('id-ID')} ({pct}%)</span>
									<span>Pagu Rp {Math.round(b.pagu_ytd || 0).toLocaleString('id-ID')}</span>
								</div>
								{#if habis}
									<p class="text-[10px] text-red-600 mt-1">⚠️ Nominal pengajuan ini (Rp {Math.round(totalAmount).toLocaleString('id-ID')}) melebihi sisa pagu. Pengajuan tetap bisa dikirim, tapi kemungkinan tertahan gate G5.</p>
								{/if}
							</div>
						{:else if preflightResult.budget && preflightResult.budget.pagu_exists === false}
							<p class="text-[11px] text-gray-400 mb-2">Pagu department tahun ini belum disusun Finance — meteran pagu tidak tersedia.</p>
						{/if}
						<!-- Fase 2 — header ringkas: "Syarat pengajuan: X/Y terpenuhi" + chip merah per
						     gate WAJIB gagal (klik -> scroll ke kartunya). -->
						{@const wajibGates = preflightResult.gates.filter((g: any) => g.severity === 'WAJIB' && !isDeferredGate(g))}
						{@const wajibTerpenuhi = wajibGates.filter((g: any) => g.status !== 'failed').length}
						{#if wajibGates.length > 0}
							<div class="sticky top-0 z-10 -mx-1 mb-2 px-1 py-1.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-gray-100 dark:border-slate-800">
								<div class="flex items-center justify-between text-[12px] font-semibold">
									<span class="{wajibTerpenuhi === wajibGates.length ? 'text-emerald-600' : 'text-gray-700 dark:text-gray-200'}">
										Syarat pengajuan: {wajibTerpenuhi}/{wajibGates.length} terpenuhi
									</span>
								</div>
								{#if wajibTerpenuhi < wajibGates.length}
									<div class="flex flex-wrap gap-1 mt-1">
										{#each wajibGates.filter((g: any) => g.status === 'failed') as g}
											<a href="#gate-{g.gate_key}" class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
												🔴 {g.gate_key}
											</a>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
						<div class="space-y-1.5">
							{#each preflightResult.gates as g}
								<div id="gate-{g.gate_key}" class="flex flex-col gap-0.5 text-[12px] scroll-mt-16">
									<div class="flex items-start gap-1.5">
										<span>{g.status === 'passed' ? '✅' : g.status === 'failed' && isDeferredGate(g) ? '🕓' : g.severity === 'WAJIB' ? '🔴' : '🟡'}</span>
										<span class="text-gray-600 dark:text-gray-300"><strong class="text-gray-800 dark:text-gray-100">{g.label}:</strong> {g.message}
											{#if g.status === 'failed' && isDeferredGate(g)}
												<em class="block text-[11px] text-slate-500">Ditangani {deferredHandlerLabel(g)} — bukan tugas Anda saat ini, tidak menahan pengiriman.</em>
											{/if}
											{#if contactHint(g)}
												<em class="block text-[11px] text-slate-500">📞 {contactHint(g)}</em>
											{/if}
											{#if canRequestDispensasi(g) && selectedProject}
												<button type="button" onclick={() => (dispensasiGate = g.gate_key)}
													title="Kirim permintaan kelonggaran gate ini ke GM/Direktur (alasan wajib)"
													class="mt-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-amber-400 text-amber-700">🆘 Minta dispensasi</button>
											{/if}</span>
									</div>
									<!-- Fase 2 — hint generik dari gate_definitions (gateHintClient::applyGateHints),
									     bukan hardcode per gate_key (F3 di rencana). Gate tanpa hint tersimpan tetap
									     tampil apa adanya (fail-soft, nol regresi). -->
									{#if g.status !== 'passed' && (g.hint || g.checklist_items?.length || g.affected_items?.length)}
										{@const lapanganLink = resolveLapanganLink(g)}
										<div class="ml-5 mt-0.5 text-[11px] text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 p-2 rounded-md border border-blue-200 dark:border-blue-800">
											{#if g.hint}<p>💡 <strong>Kenapa:</strong> {g.hint}</p>{/if}
											{#if g.checklist_items?.length}
												<ol class="list-decimal list-inside mt-1 space-y-0.5">
													{#each g.checklist_items as step}
														<li>{step.label}</li>
													{/each}
												</ol>
											{/if}
											{#if g.owner_role}
												<p class="mt-1 italic">Penolong: {g.owner_role}</p>
											{/if}
											<!-- Fase 3-KTP susulan — tombol "Benahi" per pekerja untuk G_MANPOWER_IDENTITAS,
											     memakai affected_items yang server kirim (id+label per pekerja). -->
											{#if g.gate_key === 'G_MANPOWER_IDENTITAS' && g.affected_items?.length}
												<div class="flex flex-wrap gap-1.5 mt-1.5">
													{#each g.affected_items as item}
														<button
															type="button"
															onclick={() => (ktpDialog = { open: true, manpowerId: item.id, manpowerName: item.label })}
															class="text-[10px] font-semibold px-2 py-1 rounded-lg bg-blue-600 text-white"
														>
															Benahi {item.label}
														</button>
													{/each}
												</div>
											{:else if g.gate_key === 'G10_HARIAN' && g.affected_items?.length && selectedProject}
												<!-- Laporan susulan: buka form laporan harian proyek ini langsung di tanggal yang bolong. -->
												<div class="flex flex-wrap gap-1.5 mt-1.5">
													{#each g.affected_items as item}
														<a
															href="/laporan/{selectedProject}?tanggal={item.id}"
															target="_blank"
															rel="noopener"
															class="text-[10px] font-semibold px-2 py-1 rounded-lg bg-blue-600 text-white"
														>
															+ Isi laporan {item.label}
														</a>
													{/each}
												</div>
												<p class="mt-1 text-[10px] opacity-80">Selesai mengisi? Kembali ke sini lalu klik "Cek Ulang". Bila laporan tidak mungkin diisi, tulis pernyataan tertulis di kolom "Pernyataan tertulis" di bawah daftar syarat.</p>
											{:else if lapanganLink}
												<a href={lapanganLink.href} target="_blank" rel="noopener" class="block text-[11px] font-medium hover:underline mt-1">
													→ {lapanganLink.label}
												</a>
											{/if}
										</div>
									{/if}
									<!-- Fase 4 Gate-KPI — solusi 1-klik: pengeluaran berpola borongan -> pindah ke kategori
									     termin resmi (kode dari master kategori; tombol hanya muncul bila kategorinya ada & aktif). -->
									{#if g.gate_key === 'G_BORONGAN_KANAL' && g.status === 'failed'}
										{#if boronganTerminCat && selectedCategoryKode !== boronganTerminCat.kode}
											<div class="ml-5 mt-1.5 p-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
												<div class="flex items-center gap-2">
													<button type="button" onclick={() => handleBoronganTermin(boronganTerminCat)}
														class="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition">
														⚡ Ubah kategori ke "{boronganTerminCat.nama}"
													</button>
													<span class="text-[10px] text-blue-700 dark:text-blue-300 font-medium">Kanal Resmi Proyek</span>
												</div>
												<p class="mt-1 text-[10px] text-slate-600 dark:text-slate-400">Pembayaran borongan proyek wajib lewat termin resmi (SPK/Termin) agar tidak tertahan. Setelah pindah kategori, lengkapi BAP/foto progres bila diminta lalu Cek Ulang.</p>
											</div>
										{:else if !boronganTerminCat}
											<p class="ml-5 text-[10px] text-amber-600 dark:text-amber-400 mt-1">
												⚠️ Terdeteksi indikasi borongan. Pastikan pengajuan ini menggunakan kategori termin borongan resmi departemen proyek.
											</p>
										{/if}
									{/if}
									{#if g.gate_key === 'G_BAP_BORONGAN' && g.status === 'failed' && !isDeferredGate(g)}
										<button type="button" onclick={() => (bapDialogOpen = true)}
											class="ml-5 mt-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-blue-600 text-white">
											📷 Unggah BAP sekarang
										</button>
									{/if}
								</div>
							{/each}
						</div>
						<p class="text-[10px] text-gray-300 mt-2">Mode peringatan — tidak menahan pengiriman. Perbaiki bila memungkinkan.</p>
					{/if}
				{:else}
					<p class="text-[11px] text-gray-400">Isi departemen atau pilih proyek — syarat pengajuan akan dicek otomatis di sini.</p>
				{/if}

				<!-- Dual Gate PA (mode soft): pernyataan tertulis sebagai jalur keluar bila laporan tidak bisa dilengkapi. -->
				{#if gatesButuhPernyataan.length > 0}
					<div class="mt-2.5 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-2.5">
						<label class="text-[11px] font-semibold text-amber-800 dark:text-amber-300" for="gatePernyataan">
							✍️ Pernyataan tertulis (jalur keluar): {gatesButuhPernyataan.map((g) => g.label || g.gate_key).join(' · ')}
						</label>
						<textarea
							id="gatePernyataan"
							bind:value={gatePernyataan}
							rows="3"
							placeholder="Tulis: tanggal yang bolong, sebab laporan tidak bisa diisi, dan komitmen melengkapi. Contoh: Laporan 5-6 Okt belum diisi karena tidak ada sinyal di lokasi; akan dilengkapi paling lambat besok."
							class="w-full mt-1 text-[12px] border border-amber-300 dark:border-amber-800 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900"
						></textarea>
						<p class="text-[10px] mt-0.5 {gatePernyataan.trim().length < 20 ? 'text-amber-600' : 'text-gray-400'}">{gatePernyataan.trim().length}/20 karakter minimal · pernyataan tersimpan di pengajuan dan ikut ditinjau approver. Lebih baik: isi laporan susulan (tombol di atas), pernyataan tidak diperlukan lagi.</p>
					</div>
				{/if}

				<!-- B.4 (Fase 5B, keputusan user 2 Sep 2026): fail-open bertingkat. Nominal > Rp 5 juta
				     + pemeriksa gate tak terjangkau saat kirim -> bukan diblokir, tapi wajib alasan. -->
				{#if showFailOpenReasonField && totalAmount > failOpenThreshold && preflightResult?.available === false}
					<div class="mt-2.5 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-2.5">
						<label class="text-[11px] font-semibold text-amber-800 dark:text-amber-300" for="failOpenReason">
							⚠ Pemeriksa gate tidak terhubung — nominal pengajuan ini &gt; {formatCurrency(failOpenThreshold)}. Tuliskan alasan tetap mengirim:
						</label>
						<textarea
							id="failOpenReason"
							bind:value={failOpenReason}
							rows="2"
							placeholder="Contoh: sinyal lokasi lemah, mendesak untuk kebutuhan hari ini, sudah dikoordinasikan dengan atasan lewat WA..."
							class="w-full mt-1 text-[12px] border border-amber-300 dark:border-amber-800 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900"
						></textarea>
						<p class="text-[10px] mt-0.5 {failOpenReason.trim().length < 10 ? 'text-amber-600' : 'text-gray-400'}">{failOpenReason.trim().length}/10 karakter minimal</p>
					</div>
				{/if}

				<!-- Rekomendasi §6.9 — pratinjau dampak sebelum kirim -->
				{#if impactPreview}
					<div class="mt-2.5 rounded-lg border p-2.5 text-[11px] {impactPreview.over ? 'border-red-300 bg-red-50 text-red-800' : 'border-gray-200 bg-gray-50 text-gray-700'}">
						Pengajuan ini menaikkan realisasi biaya variabel proyek dari
						<strong>{Math.round(impactPreview.before * 100)}%</strong> →
						<strong>{Math.round(impactPreview.after * 100)}%</strong> dari plafon RAP.
						{#if impactPreview.over}
							<span class="block mt-0.5 font-semibold">⚠️ Melewati plafon RAP — pengajuan tetap bisa dikirim (mode peringatan), koordinasikan dengan Admin/PM.</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		{#if liveIssues.length > 0}
			<div id="panel-kesalahan-form" class="mx-3 mb-2 rounded-xl border border-gray-200 bg-white p-3 text-[12px] shadow-xs" role="alert">
				<p class="font-semibold text-gray-700 mb-1.5">Perbaiki item merah. Item kuning hanya saran.</p>
				<ul class="space-y-1">
					{#each liveIssues as it}
						<li>
							<button type="button" class="w-full text-left rounded-lg px-2 py-1.5 flex gap-2 items-start {it.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}" onclick={() => focusIssue(it.anchorId)}>
								<span>{it.severity === 'error' ? '⛔' : '⚠️'}</span>
								<span class="flex-1">{it.message}</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="bottom-bar shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
			<div class="flex gap-2">
				<button class="py-2.5 px-4 border border-gray-200 rounded-xl text-gray-500 text-[13px] font-medium flex items-center gap-1.5 cursor-pointer active:bg-gray-50 transition-all" onclick={() => notify('Disimpan sebagai draft')}>
					<IconDeviceFloppy size={16} /> Draft
				</button>
				<button
					class="flex-1 py-2.5 bg-[var(--p)] text-white border-none rounded-xl text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer active:bg-[var(--pd)] transition-all disabled:opacity-60"
					onclick={handleSubmit}
					disabled={submitting}
				>
					{#if submitting}
						<IconLoader2 size={16} class="animate-spin" /> Mengirim...
					{:else}
						<IconSend size={16} /> Kirim pengajuan
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>

<!-- Fase 3-KTP susulan — dialog Benahi Identitas (GateFixKtpNik, sebelumnya orphan) -->
<GateFixKtpNik
	open={ktpDialog.open}
	manpowerId={ktpDialog.manpowerId}
	manpowerName={ktpDialog.manpowerName}
	onClose={() => (ktpDialog = { ...ktpDialog, open: false })}
	onSuccess={() => handlePeriksaSebelumKirim()}
/>

<GateFixBapBorongan
	open={bapDialogOpen}
	projectId={selectedProject || null}
	onClose={() => (bapDialogOpen = false)}
	onSuccess={() => handlePeriksaSebelumKirim()}
/>

<GateRequestDispensasi
	open={dispensasiGate !== null}
	projectId={selectedProject || null}
	gateKey={dispensasiGate}
	onClose={() => (dispensasiGate = null)}
/>

<!-- Success Popup Modal -->
{#if showSuccessModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
		<div class="bg-white rounded-2xl w-full max-w-xs shadow-xl flex flex-col overflow-hidden max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
			<div class="p-6 text-center">
				<div class="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center text-green-500 mx-auto mb-4 border border-green-100">
					<IconCheck size={28} />
				</div>
				
				<h3 class="text-[15px] font-bold text-gray-800 mb-2 leading-tight">Pengajuan telah terkirim</h3>
				<p class="text-[11px] text-gray-400 mb-5 px-1 leading-relaxed">
					Silahkan foto notifikasi ini dan dikirim ke admin
				</p>

				<!-- Nomor Pengajuan Box -->
				<div class="bg-gray-50 rounded-xl p-3 border border-gray-100 mb-5">
					<span class="text-[9px] text-gray-400 block mb-0.5 font-semibold uppercase tracking-wider">Nomor Pengajuan</span>
					<strong class="text-[16px] font-mono text-gray-800 tracking-wide">{createdNomorPengajuan}</strong>
				</div>

				<button
					class="w-full py-2.5 px-4 bg-[var(--p)] hover:bg-[var(--pd)] text-white border-none rounded-xl text-[12px] font-semibold transition-colors cursor-pointer active:scale-[0.98]"
					onclick={() => {
						showSuccessModal = false;
						goto('/anggaran');
					}}
				>
					Selesai
				</button>
			</div>
		</div>
	</div>
{/if}
