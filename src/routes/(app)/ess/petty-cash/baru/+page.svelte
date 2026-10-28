<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import {
		ajukanPettyCash,
		perbaikiPettyCash,
		getPettyCashData,
		PettyCashApiError,
		compressPhoto,
		type PettyCashFund,
		searchInventoryItems,
		getInventoryWarehouses,
		type InventoryItemOption,
		type GudangOption
	} from '$lib/services/ess/pettyCash';
	import { collectDecisionNotes, type DecisionNote } from '$lib/shared/pettyCashRules';
	import { fetchMyVisits, getSiteCheckinSettings, type VisitPickerOption } from '$lib/services/siteCheckin';
	import { getVehiclesForCheck, getTodayVehicleCheck } from '$lib/services/driver';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import ProjectSelect from '$lib/components/anggaran/ProjectSelect.svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import {
		IconArrowLeft,
		IconLoader2,
		IconCircleCheck,
		IconCamera,
		IconX,
		IconReceipt,
		IconWallet,
		IconBuildingBank,
		IconSend,
		IconZoomIn,
		IconInfoCircle,
		IconSparkles,
		IconCheck,
		IconBox,
		IconSearch
	} from '@tabler/icons-svelte';

	// Deep-link dari wizard "Saya Keluar Uang Duluan" (?mode=reimburse|advance) prefill mode.
	const modeParam = page.url.searchParams.get('mode');
	// FLD-01: ?edit=<id> = perbaiki tiket "Perlu Revisi" lalu kirim ulang (nomor PCR tetap).
	const editParam = Number(page.url.searchParams.get('edit'));
	const editId: number | null = Number.isFinite(editParam) && editParam > 0 ? editParam : null;
	let revisiNotes = $state<DecisionNote[]>([]);
	// FLD-04: server mendeteksi tiket identik yang baru tersimpan (mis. timeout lalu Kirim lagi).
	let dupWarning = $state<{ message: string; requestNumber?: string } | null>(null);

	let mode = $state<'reimburse' | 'advance'>(modeParam === 'advance' ? 'advance' : 'reimburse');
	let fundId = $state('');
	// PRJ-22: dibuka dari "Catat pengeluaran" di proyek -> pilih dana kerja proyek itu bila Anda pemegangnya.
	const projectParam = page.url.searchParams.get('project_id');
	let imprestMissing = $state(false);
	let jumlah = $state('');
	let deskripsi = $state('');
	let penerima = $state('');
	let noNota = $state('');
	let tglButuh = $state('');

	let notaFile = $state<File | null>(null);
	let notaPreview = $state<string | null>(null);
	let showImageModal = $state(false);

	// Fase 2/F1 lanjutan "Gate Disiplin Lapangan" (6 Okt 2026) — auto-match kunjungan untuk
	// klaim BBM/eToll/parkir. Pola SAMA PERSIS visit picker di ess/reimburse (reuse
	// fetchMyVisits/getSiteCheckinSettings, bukan konsep baru). Murni SARAN, tidak ada yang
	// diblokir di sini — gate server (G_PC_VISIT) sendiri masih shadow/soft.
	const BBM_VISIT_KEYWORDS = ['bbm', 'bensin', 'solar', 'pertalite', 'pertamax', 'etoll', 'e-toll', 'tol', 'parkir'];
	let visits = $state<VisitPickerOption[]>([]);
	let loadingVisits = $state(false);
	let visitsLoaded = $state(false);
	let selectedSiteCheckinId = $state<string | null>(null);
	let noVisitMode = $state(false);
	let visitExceptionText = $state('');
	let visitPickerHari = $state(7);
	let visitMinChar = $state(20);

	// PRJ-21 — proyek penanggung biaya (opsional). Default = proyek terakhir yang dipakai (kemudahan per-perangkat saja).
	const LAST_PROJECT_KEY = 'ess_pc_last_project';
	let pcProjects = $state<any[]>([]);
	let selectedProject = $state('');
	async function loadPcProjects() {
		try {
			pcProjects = (await getProjectsForCurrentUser(true)) || [];
			if (!selectedProject && !editId) {
				let last = '';
				try { last = localStorage.getItem(LAST_PROJECT_KEY) || ''; } catch { /* storage dinonaktifkan */ }
				if (last && pcProjects.some((p) => String(p.id) === last)) selectedProject = last;
			}
		} catch (e) {
			console.warn('[petty-cash] gagal memuat daftar proyek (pemilih proyek opsional, form tetap jalan):', e);
		}
	}

	// Interlocking Kas Kecil Fase 3 (13 Okt 2026) — klaim BBM: tanggal nota WAJIB; bila untuk kendaraan terdaftar,
	// pilih kendaraan + KM odometer WAJIB (keputusan Lead). P2H dicek otomatis & cukup dilakukan driver pertama hari itu.
	const BBM_FUEL_KEYWORDS = ['bbm', 'bensin', 'solar', 'pertalite', 'pertamax', 'dexlite'];
	const todayJkt = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
	let bbmTarget = $state<'kendaraan' | 'lainnya'>('kendaraan');
	let vehicles = $state<{ id: number | string; name: string; code: string }[]>([]);
	let vehiclesLoaded = $state(false);
	let vehicleId = $state('');
	let odometer = $state('');
	let literBbm = $state('');
	let receiptDate = $state('');
	let p2hStatus = $state<'unknown' | 'checking' | 'ok' | 'belum' | 'tidak_laik'>('unknown');

	const isBbm = $derived(BBM_FUEL_KEYWORDS.some((kw) => deskripsi.toLowerCase().includes(kw)));
	const useVehicle = $derived(isBbm && bbmTarget === 'kendaraan');
	const odometerNum = $derived(Number(odometer.replace(',', '.')) || 0);
	const literNum = $derived(Number(literBbm.replace(',', '.')) || 0);
	/** Daftar kekurangan isian BBM - ditampilkan di bawah form agar pemohon tahu apa yang kurang (tombol tidak diam-diam mati). */
	const bbmMissing = $derived.by(() => {
		const m: string[] = [];
		if (isBbm && !receiptDate) m.push('tanggal pada nota');
		if (useVehicle && !vehicleId) m.push('kendaraan');
		if (useVehicle && vehicleId && odometerNum <= 0) m.push('KM odometer');
		if (receiptDate && receiptDate > todayJkt()) m.push('tanggal nota tidak boleh di masa depan');
		return m;
	});

	async function loadVehicles() {
		if (vehiclesLoaded) return;
		try {
			vehicles = (await getVehiclesForCheck()) as any[];
			vehiclesLoaded = true;
		} catch (e) {
			console.warn('[petty-cash] gagal memuat daftar kendaraan (pemilih opsional, form tetap jalan):', e);
		}
	}

	$effect(() => {
		if (isBbm) {
			if (!receiptDate) receiptDate = todayJkt();
			loadVehicles();
		}
	});

	// Status P2H kendaraan pada tanggal nota - saran saja; yang menegakkan gate server (masih shadow).
	$effect(() => {
		const vid = useVehicle ? vehicleId : '';
		const day = receiptDate || todayJkt();
		if (!vid) { p2hStatus = 'unknown'; return; }
		p2hStatus = 'checking';
		let cancelled = false;
		getTodayVehicleCheck(String(vid), day)
			.then((c) => { if (!cancelled) p2hStatus = !c ? 'belum' : c.status === 'tidak_laik' ? 'tidak_laik' : 'ok'; })
			.catch(() => { if (!cancelled) p2hStatus = 'unknown'; });
		return () => { cancelled = true; };
	});

	const needsVisitPicker = $derived(BBM_VISIT_KEYWORDS.some((kw) => deskripsi.toLowerCase().includes(kw)));

	async function loadVisitsUntukBbm() {
		if (visitsLoaded || loadingVisits) return;
		loadingVisits = true;
		try {
			const settingsRes = await getSiteCheckinSettings().catch(() => null);
			visitPickerHari = settingsRes?.settings?.visit_picker_hari || 7;
			const res = await fetchMyVisits(visitPickerHari);
			visits = res.visits || [];
			visitsLoaded = true;
		} catch {
			// gagal-lunak — pemohon tetap bisa isi alasan pengecualian tanpa kunjungan
		} finally {
			loadingVisits = false;
		}
	}

	$effect(() => {
		if (needsVisitPicker) loadVisitsUntukBbm();
	});

	let funds = $state<PettyCashFund[]>([]);
	let loadingFunds = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);
	let successData = $state<{ request_number?: string; amount: number; mode: string } | null>(null);

	// Integrasi Kas Kecil Pembelian Stok Persediaan (Cash Purchase / Stock-IN)
	let isInventoryIn = $state(false);
	let selectedItem = $state<InventoryItemOption | null>(null);
	let inventoryQty = $state('');
	let selectedGudangId = $state('');
	let warehouses = $state<GudangOption[]>([]);
	let warehousesLoaded = $state(false);
	let loadingWarehouses = $state(false);
	let itemSearchInput = $state('');
	let itemSearchResults = $state<InventoryItemOption[]>([]);
	let searchingItems = $state(false);
	let searchDebounceTimer: any = null;

	async function loadWarehouses() {
		if (warehousesLoaded || loadingWarehouses) return;
		loadingWarehouses = true;
		try {
			warehouses = await getInventoryWarehouses();
			warehousesLoaded = true;
			if (!selectedGudangId && warehouses.length > 0) {
				const ws = warehouses.find((w) => w.nama_gudang.toLowerCase().includes('workshop') || w.jenis === 'gudang_produksi' || w.jenis === 'workshop');
				if (ws) selectedGudangId = String(ws.id);
				else selectedGudangId = String(warehouses[0].id);
			}
		} catch (e) {
			console.warn('[petty-cash] gagal memuat daftar gudang:', e);
		} finally {
			loadingWarehouses = false;
		}
	}

	$effect(() => {
		if (isInventoryIn) loadWarehouses();
	});

	function handleItemSearchInput(e: Event) {
		const q = (e.target as HTMLInputElement).value;
		itemSearchInput = q;
		clearTimeout(searchDebounceTimer);
		if (q.trim().length < 2) {
			itemSearchResults = [];
			searchingItems = false;
			return;
		}
		searchingItems = true;
		searchDebounceTimer = setTimeout(async () => {
			try {
				itemSearchResults = await searchInventoryItems(q);
			} catch {
				itemSearchResults = [];
			} finally {
				searchingItems = false;
			}
		}, 300);
	}

	function selectInventoryItem(item: InventoryItemOption) {
		selectedItem = item;
		itemSearchInput = '';
		itemSearchResults = [];
		if (!deskripsi || deskripsi.trim().length < 5) {
			deskripsi = `Pembelian tunai stok persediaan: ${item.nama_barang_lengkap}`;
		}
	}

	function clearInventoryItem() {
		selectedItem = null;
		itemSearchInput = '';
		itemSearchResults = [];
	}

	// Jaring pengaman draf — nota difoto lalu nominalnya diketik dari struk itu.
	interface Draft {
		mode: 'reimburse' | 'advance';
		fundId: string;
		jumlah: string;
		deskripsi: string;
		penerima: string;
		noNota: string;
		tglButuh: string;
		/** PC3-19 — kunci idempoten; ikut draf supaya tetap sama walau aplikasi ditutup lalu dibuka lagi */
		txnId?: string;
		isInventoryIn?: boolean;
		inventoryItemId?: number | null;
		inventoryItemName?: string | null;
		inventoryItemSatuan?: string | null;
		inventoryQty?: string;
		selectedGudangId?: string;
	}
	const NOTA_KEY = 'nota';
	const persist = createFormPersist<Draft>(editId ? `ess_petty_cash_edit_${editId}` : 'ess_petty_cash_baru');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	const newTxnId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}${Math.random().toString(36).slice(2, 10)}`);
	let txnId = $state(newTxnId());
	const snapshot = (): Draft => ({
		mode,
		fundId,
		jumlah,
		deskripsi,
		penerima,
		noNota,
		tglButuh,
		txnId,
		isInventoryIn,
		inventoryItemId: selectedItem?.id || null,
		inventoryItemName: selectedItem?.nama_barang_lengkap || null,
		inventoryItemSatuan: selectedItem?.satuan || null,
		inventoryQty,
		selectedGudangId
	});

	onMount(async () => {
		// mode edit: data awal dari server (bukan draf lokal)
		const draft = editId ? null : persist.restore();
		if (draft) {
			mode = draft.mode ?? 'reimburse';
			fundId = draft.fundId ?? '';
			jumlah = draft.jumlah ?? '';
			deskripsi = draft.deskripsi ?? '';
			penerima = draft.penerima ?? '';
			noNota = draft.noNota ?? '';
			tglButuh = draft.tglButuh ?? '';
			if (draft.txnId) txnId = draft.txnId; // kunci yang sama dengan pengiriman sebelumnya (mungkin sudah tersimpan di server)
			if (draft.isInventoryIn) {
				isInventoryIn = true;
				if (draft.inventoryItemId && draft.inventoryItemName) {
					selectedItem = {
						id: draft.inventoryItemId,
						nama_barang_lengkap: draft.inventoryItemName,
						satuan: draft.inventoryItemSatuan || null
					};
				}
				if (draft.inventoryQty) inventoryQty = draft.inventoryQty;
				if (draft.selectedGudangId) selectedGudangId = draft.selectedGudangId;
			}
			const blob = await persist.restorePhoto(NOTA_KEY);
			if (blob) {
				notaFile = new File([blob], 'nota.jpg', { type: blob.type || 'image/jpeg' });
				notaPreview = URL.createObjectURL(notaFile);
			}
			draftSavedAt = new Date();
		}
		draftArmed = true;

		loadPcProjects();
		try {
			const res = await getPettyCashData();
			funds = res.funds || [];
			if (projectParam && !editId) {
				const match = funds.find((f) => f.fund_type === 'project_imprest' && String(f.project_id) === projectParam);
				if (match) fundId = String(match.id);
				else imprestMissing = true;
			}
			if (editId) {
				const rec = (res.requests || []).find((r) => r.id === editId);
				if (!rec) {
					errorMsg = 'Pengajuan yang akan diperbaiki tidak ditemukan.';
				} else if (rec.status !== 'revisi') {
					errorMsg = 'Hanya pengajuan berstatus "Perlu Revisi" yang bisa diperbaiki.';
				} else {
					mode = rec.mode === 'advance' ? 'advance' : 'reimburse';
					const fid = typeof rec.fund_id === 'object' ? rec.fund_id?.id : rec.fund_id;
					fundId = fid ? String(fid) : '';
					jumlah = rec.amount ? Number(rec.amount).toLocaleString('id-ID') : '';
					deskripsi = rec.description || '';
					penerima = rec.payee_name || '';
					noNota = rec.receipt_number || '';
					receiptDate = (rec as any).receipt_date ? String((rec as any).receipt_date).slice(0, 10) : '';
					if ((rec as any).vehicle_ref_id) vehicleId = String((rec as any).vehicle_ref_id);
					else if ((rec as any).liter_bbm != null || (rec as any).receipt_date) bbmTarget = 'lainnya';
					if ((rec as any).odometer_km != null) odometer = String((rec as any).odometer_km);
					if ((rec as any).liter_bbm != null) literBbm = String((rec as any).liter_bbm);
					tglButuh = rec.needed_date ? String(rec.needed_date).slice(0, 10) : '';
					if ((rec as any).is_inventory_in) {
						isInventoryIn = true;
						const itm = (rec as any).inventory_item_id;
						if (itm) {
							selectedItem = typeof itm === 'object'
								? { id: itm.id, nama_barang_lengkap: itm.nama_barang_lengkap || `Item #${itm.id}`, satuan: itm.satuan || null }
								: { id: itm, nama_barang_lengkap: `Item #${itm}` };
						}
						if ((rec as any).inventory_qty) inventoryQty = String((rec as any).inventory_qty);
						const gid = typeof (rec as any).gudang_id === 'object' ? (rec as any).gudang_id?.id : (rec as any).gudang_id;
						if (gid) selectedGudangId = String(gid);
					}
					revisiNotes = collectDecisionNotes(rec);
					const pidRaw = (rec as any).project_id;
					const pid = typeof pidRaw === 'object' ? pidRaw?.id : pidRaw;
					if (pid) selectedProject = String(pid);
				}
			}
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat daftar dana kas kecil.';
		} finally {
			loadingFunds = false;
		}
	});

	$effect(() => {
		void snapshot();
		if (!draftArmed) return;
		persist.save(snapshot());
		draftSavedAt = new Date();
	});
	$effect(() => registerFormPersistSaveTriggers(persist, snapshot));

	let compressing = $state(false);

	// PC3-06: perkecil saat dipilih (bukan saat Kirim) → ukuran akhir terlihat & sinyal lemah tak menambah beban.
	async function onNotaChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const picked = input.files?.[0];
		if (!picked) return;
		compressing = true;
		errorMsg = '';
		try {
			const f = await compressPhoto(picked);
			notaFile = f;
			if (notaPreview) URL.revokeObjectURL(notaPreview);
			notaPreview = URL.createObjectURL(f);
			persist.savePhoto(NOTA_KEY, f);
		} catch (err: any) {
			// Aturan #6: tombol Kirim tetap aktif — pengaju boleh lanjut tanpa foto (nota fisik ke kasir).
			errorMsg = err?.message || 'Foto tidak bisa diproses. Coba foto ulang atau kirim tanpa foto.';
			input.value = '';
		} finally {
			compressing = false;
		}
	}

	function removeNota() {
		if (notaPreview) URL.revokeObjectURL(notaPreview);
		notaFile = null;
		notaPreview = null;
		void persist.savePhoto(NOTA_KEY, new Blob([]));
	}

	let jumlahNum = $derived(Number(jumlah.replace(/\D/g, '')) || 0);

	function formatCurrencyInput(val: string) {
		const clean = val.replace(/\D/g, '');
		if (!clean) return '';
		return Number(clean).toLocaleString('id-ID');
	}

	function handleJumlahInput(e: Event) {
		const target = e.target as HTMLInputElement;
		const formatted = formatCurrencyInput(target.value);
		jumlah = formatted;
	}

	function addPresetAmount(n: number) {
		const current = jumlahNum;
		jumlah = (current + n).toLocaleString('id-ID');
	}

	function angkaTerbilang(n: number): string {
		if (n === 0) return '';
		const satuan = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas'];
		function helper(num: number): string {
			if (num < 12) return satuan[num];
			if (num < 20) return helper(num - 10) + ' Belas';
			if (num < 100) return helper(Math.floor(num / 10)) + ' Puluh ' + helper(num % 10);
			if (num < 200) return 'Seratus ' + helper(num - 100);
			if (num < 1000) return helper(Math.floor(num / 100)) + ' Ratus ' + helper(num % 100);
			if (num < 2000) return 'Seribu ' + helper(num - 1000);
			if (num < 1000000) return helper(Math.floor(num / 1000)) + ' Ribu ' + helper(num % 1000);
			if (num < 1000000000) return helper(Math.floor(num / 1000000)) + ' Juta ' + helper(num % 1000000);
			if (num < 1000000000000) return helper(Math.floor(num / 1000000000)) + ' Miliar ' + helper(num % 1000000000);
			return '';
		}
		const res = helper(Math.floor(n)).trim();
		return res ? res.replace(/\s+/g, ' ') + ' Rupiah' : '';
	}

	const selectedFund = $derived(funds.find((f) => String(f.id) === String(fundId)));
	// U1 — batas per transaksi & wajib foto diketahui SEBELUM memotret/mengunggah (dari data dana, bukan hardcode)
	// PRJ-22: dana kerja proyek (imprest) mengunci proyek — dipilih otomatis & tidak bisa diganti (server juga memaksa).
	const imprestProjectId = $derived(selectedFund?.fund_type === 'project_imprest' && selectedFund?.project_id ? String(selectedFund.project_id) : '');
	const imprestProjectName = $derived(pcProjects.find((p) => String(p.id) === imprestProjectId)?.name || (imprestProjectId ? `Proyek #${imprestProjectId}` : ''));
	$effect(() => {
		if (imprestProjectId && selectedProject !== imprestProjectId) selectedProject = imprestProjectId;
	});
	const fundCeiling = $derived(Number(selectedFund?.ceiling_per_transaksi) || 0);
	const fundWajibBukti = $derived(Number(selectedFund?.wajib_bukti_diatas) || 0);
	const overCeiling = $derived(fundCeiling > 0 && jumlahNum > fundCeiling);
	const terbilangText = $derived(angkaTerbilang(jumlahNum));
	const rupiah = (n: number) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

	const inventoryQtyNum = $derived(Number(inventoryQty.replace(',', '.')) || 0);
	const stockInMissing = $derived.by(() => {
		if (!isInventoryIn) return [];
		const m: string[] = [];
		if (!selectedItem) m.push('pilihan barang inventori');
		if (inventoryQtyNum <= 0) m.push('kuantitas barang (> 0)');
		if (!selectedGudangId) m.push('gudang tujuan');
		return m;
	});

	const canSubmit = $derived(
		!!fundId &&
			jumlahNum > 0 &&
			deskripsi.trim().length >= 5 &&
			bbmMissing.length === 0 &&
			stockInMissing.length === 0 &&
			!submitting
	);

	async function handleSubmit(allowDuplicate = false) {
		if (!canSubmit) return;
		submitting = true;
		errorMsg = '';
		try {
			const params = {
				mode,
				fund_id: Number(fundId),
				amount: jumlahNum,
				description: deskripsi.trim(),
				payee_name: penerima.trim() || undefined,
				receipt_number: noNota.trim() || undefined,
				...(receiptDate ? { receiptDate } : {}),
				...(useVehicle && vehicleId ? { vehicleRefId: Number(vehicleId), odometerKm: odometerNum } : {}),
				...(isBbm && literNum > 0 ? { literBbm: literNum } : {}),
				needed_date: mode === 'advance' && tglButuh ? tglButuh : undefined,
				buktiFile: notaFile,
				allowDuplicate,
				...(selectedProject ? { projectId: Number(selectedProject) } : {}),
				...(editId ? {} : { clientTxnId: txnId }),
				...(needsVisitPicker && !noVisitMode && selectedSiteCheckinId ? { siteCheckinId: selectedSiteCheckinId } : {}),
				...(needsVisitPicker && noVisitMode && visitExceptionText.trim() ? { visitException: visitExceptionText.trim() } : {}),
				// Integrasi Kas Kecil Pembelian Stok Persediaan (Cash Purchase / Stock-IN)
				...(isInventoryIn && selectedItem
					? {
							isInventoryIn: true,
							inventoryItemId: selectedItem.id,
							inventoryQty: inventoryQtyNum,
							gudangId: Number(selectedGudangId)
						}
					: {
							isInventoryIn: false
						})
			};
			const res = editId ? await perbaikiPettyCash(editId, params) : await ajukanPettyCash(params);
			try { if (selectedProject) localStorage.setItem(LAST_PROJECT_KEY, selectedProject); } catch { /* abaikan */ }
			dupWarning = null;
			persist.clear();
			await persist.clearPhotos();
			txnId = newTxnId(); // sukses → pengisian berikutnya memakai kunci baru
			draftSavedAt = null;
			successData = {
				request_number: res?.record?.request_number || 'PCR-BARU',
				amount: jumlahNum,
				mode: mode === 'reimburse' ? 'Reimburse' : 'Uang Muka'
			};
			success = true;
		} catch (err: any) {
			if (err instanceof PettyCashApiError && err.code === 'possible_duplicate') {
				dupWarning = { message: err.message, requestNumber: err.record?.request_number };
			} else {
				errorMsg = err?.message || 'Gagal mengajukan kas kecil.';
			}
		} finally {
			submitting = false;
		}
	}

	function resetForm() {
		vehicleId = '';
		odometer = '';
		literBbm = '';
		receiptDate = '';
		bbmTarget = 'kendaraan';
		isInventoryIn = false;
		selectedItem = null;
		inventoryQty = '';
		selectedGudangId = '';
		mode = 'reimburse';
		fundId = '';
		jumlah = '';
		deskripsi = '';
		penerima = '';
		noNota = '';
		tglButuh = '';
		removeNota();
		success = false;
		successData = null;
	}
</script>

<div class="w-full max-w-3xl mx-auto p-4 md:p-6 pb-28">
	<!-- Top Navigation -->
	<div class="flex items-center justify-between mb-4">
		<button
			class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-slate-700/40 transition-all"
			onclick={() => goto('/ess/petty-cash')}
		>
			<IconArrowLeft size={16} />
			<span>Kembali ke Riwayat</span>
		</button>
		<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!notaFile} />
	</div>

	{#if success}
		<!-- Success State Card -->
		<div class="glass-panel rounded-3xl p-8 md:p-12 text-center relative overflow-hidden border border-emerald-500/20 shadow-2xl">
			<div class="absolute -top-12 -right-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
			<div class="w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-5 text-emerald-400 shadow-inner">
				<IconCircleCheck size={44} />
			</div>
			<h2 class="text-2xl font-black text-slate-100 tracking-tight">{editId ? 'Perbaikan Berhasil Dikirim!' : 'Pengajuan Berhasil Dikirim!'}</h2>
			<p class="text-sm font-medium text-slate-400 max-w-md mx-auto mt-2">
				Tiket <span class="font-bold text-slate-200">#{successData?.request_number}</span> senilai
				<span class="font-bold text-emerald-400">Rp {successData?.amount.toLocaleString('id-ID')}</span> ({successData?.mode}) telah masuk ke antrean persetujuan atasan.
			</p>

			<div class="bg-slate-900/60 rounded-2xl border border-slate-800 p-4 max-w-sm mx-auto mt-6 text-left space-y-2 text-xs">
				<div class="flex justify-between text-slate-400">
					<span>Alur Selanjutnya:</span>
					<span class="font-semibold text-slate-200">2 Tahap Verifikasi</span>
				</div>
				<div class="flex items-center gap-2 text-slate-300">
					<span class="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-[10px]">1</span>
					<span>Persetujuan oleh Atasan Langsung</span>
				</div>
				<div class="flex items-center gap-2 text-slate-300">
					<span class="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px]">2</span>
					<span>Verifikasi & Pencairan oleh Kasir Kas Kecil</span>
				</div>
			</div>

			<div class="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
				<button
					class="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-bold text-white gradient-bg shadow-lg hover:opacity-90 transition-opacity"
					onclick={() => goto('/ess/petty-cash')}
				>
					Lihat Status Pengajuan
				</button>
				<button
					class="w-full sm:w-auto px-5 py-3 rounded-xl text-sm font-bold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 transition-all"
					onclick={resetForm}
				>
					Ajukan Lainnya
				</button>
			</div>
		</div>
	{:else}
		<!-- Main Form -->
		<div class="glass-panel rounded-3xl p-5 md:p-8 border border-slate-700/60 shadow-xl relative overflow-hidden">
			<!-- Form Header -->
			<div class="mb-6 pb-5 border-b border-slate-800/80">
				<div class="flex items-center gap-2.5">
					<div class="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
						<IconReceipt size={22} />
					</div>
					<div>
						<h1 class="text-xl md:text-2xl font-black text-slate-100 tracking-tight">{editId ? 'Perbaiki Pengajuan Kas Kecil' : 'Ajukan Kas Kecil'}</h1>
						<p class="text-xs md:text-sm text-slate-400 mt-0.5">Biaya operasional lapangan, konsumsi proyek, & kebutuhan darurat kerja</p>
					</div>
				</div>
			</div>

			<div class="space-y-6">
				{#if editId}
					<!-- FLD-01/BUG-15: tampilkan alasan revisi agar pemohon tahu apa yang diperbaiki -->
					<div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-1.5">
						<p class="font-bold text-amber-300">Yang perlu diperbaiki:</p>
						{#each revisiNotes as n (n.role + n.text)}
							<p><span class="font-semibold">{n.label}:</span> {n.text}</p>
						{:else}
							<p>Pengajuan dikembalikan untuk diperbaiki. Periksa nominal, uraian, dan foto nota.</p>
						{/each}
						<p class="text-amber-400/80">Nomor tiket tetap sama. Foto lama tetap terlampir kecuali Anda memilih foto baru.</p>
					</div>
				{/if}

				<!-- Section 1: Mode Selector -->
				<div>
					<label class="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2.5">
						1. Jenis Pengajuan <span class="text-red-400">*</span>
					</label>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<!-- Mode Reimburse -->
						<button
							type="button"
							class="text-left p-4 rounded-2xl border transition-all relative {mode === 'reimburse'
								? 'bg-blue-600/15 border-blue-500/80 ring-2 ring-blue-500/20 shadow-md shadow-blue-500/5'
								: 'bg-slate-900/40 border-slate-800 hover:border-slate-700'}"
							onclick={() => (mode = 'reimburse')}
						>
							<div class="flex items-start justify-between">
								<div class="w-9 h-9 rounded-xl flex items-center justify-center {mode === 'reimburse' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-400'}">
									<IconReceipt size={20} />
								</div>
								{#if mode === 'reimburse'}
									<span class="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">
										<IconCheck size={12} stroke={3} />
									</span>
								{/if}
							</div>
							<div class="mt-3">
								<p class="text-sm font-extrabold {mode === 'reimburse' ? 'text-blue-400' : 'text-slate-200'}">Reimburse (Klaim)</p>
								<p class="text-xs text-slate-400 mt-1 leading-relaxed">
									Uang pribadi sudah dipakai. Ajukan klaim dengan bukti nota/struk asli.
								</p>
							</div>
						</button>

						<!-- Mode Advance -->
						<button
							type="button"
							class="text-left p-4 rounded-2xl border transition-all relative {mode === 'advance'
								? 'bg-purple-600/15 border-purple-500/80 ring-2 ring-purple-500/20 shadow-md shadow-purple-500/5'
								: 'bg-slate-900/40 border-slate-800 hover:border-slate-700'}"
							onclick={() => (mode = 'advance')}
						>
							<div class="flex items-start justify-between">
								<div class="w-9 h-9 rounded-xl flex items-center justify-center {mode === 'advance' ? 'bg-purple-500 text-white' : 'bg-slate-800 text-slate-400'}">
									<IconWallet size={20} />
								</div>
								{#if mode === 'advance'}
									<span class="w-5 h-5 rounded-full bg-purple-500 text-white flex items-center justify-center text-xs">
										<IconCheck size={12} stroke={3} />
									</span>
								{/if}
							</div>
							<div class="mt-3">
								<p class="text-sm font-extrabold {mode === 'advance' ? 'text-purple-400' : 'text-slate-200'}">Uang Muka (Kasbon Operasional)</p>
								<p class="text-xs text-slate-400 mt-1 leading-relaxed">
									Minta dana di muka. Wajib lapor nota realisasi (LPJ) setelah dipakai.
								</p>
							</div>
						</button>
					</div>
				</div>

				{#if imprestMissing}
					<div class="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
						Anda belum punya dana kerja untuk proyek ini. Hubungi Finance/Admin Project untuk dibuatkan, atau pilih dana lain di bawah.
					</div>
				{/if}

				<!-- Section 2: Dana Kas Kecil -->
				<div>
					<label class="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2" for="fund">
						2. Sumber Dana Kas Kecil <span class="text-red-400">*</span>
					</label>
					<div class="relative">
						<select
							id="fund"
							class="w-full rounded-xl border border-slate-700/80 bg-slate-900/80 text-sm p-3.5 text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all disabled:opacity-50"
							bind:value={fundId}
							disabled={loadingFunds}
						>
							<option value="">{loadingFunds ? 'Memuat daftar dana kas kecil...' : '— Pilih Pos Dana Kas Kecil —'}</option>
							{#each funds as f (f.id)}
								<option value={f.id}>
									{f.fund_name}{f.department ? ` · Divisi ${f.department}` : ''}
								</option>
							{/each}
						</select>
					</div>
					{#if selectedFund}
						<p class="mt-2 text-[11px] text-slate-400" title="Angka ini dari pengaturan dana, bukan tebakan.">
							ℹ️ {#if fundCeiling > 0}Batas per transaksi <b class="text-slate-200">{rupiah(fundCeiling)}</b>{:else}Tidak ada batas per transaksi{/if}
							{#if fundWajibBukti > 0} · Foto nota wajib di atas <b class="text-slate-200">{rupiah(fundWajibBukti)}</b>{/if}
							{#if selectedFund.balance_level === 'rendah'} · <span class="text-amber-400">Saldo dana menipis — pencairan bisa tertunda</span>{/if}
							{#if selectedFund.balance_level === 'habis'} · <span class="text-red-400">Saldo dana habis — pengajuan tetap diterima, dicairkan setelah isi ulang</span>{/if}
						</p>
						{#if overCeiling}
							<p class="mt-1.5 text-[11px] text-red-400">Nominal melebihi batas per transaksi dana ini. Untuk nominal lebih besar, ajukan lewat Pengajuan Anggaran (bukan Kas Kecil).</p>
						{/if}
						<div class="mt-2.5 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs flex items-center justify-between text-slate-300">
							<span class="flex items-center gap-1.5 text-slate-400">
								<IconBuildingBank size={15} /> Pos Dana: <strong class="text-slate-200">{selectedFund.fund_name}</strong>
							</span>
							{#if selectedFund.department}
								<span class="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 font-semibold text-[11px]">
									{selectedFund.department}
								</span>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Section 3: Nominal / Jumlah -->
				<div>
					<div class="flex items-center justify-between mb-2">
						<label class="text-xs font-bold uppercase tracking-wider text-slate-400" for="jumlah">
							3. Jumlah Nominal (Rp) <span class="text-red-400">*</span>
						</label>
						{#if jumlahNum > 0}
							<span class="text-xs font-extrabold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">
								Rp {jumlahNum.toLocaleString('id-ID')}
							</span>
						{/if}
					</div>

					<div class="relative">
						<span class="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 select-none">Rp</span>
						<input
							id="jumlah"
							type="text"
							inputmode="numeric"
							class="w-full pl-12 pr-4 py-3.5 rounded-xl border border-slate-700/80 bg-slate-900/80 text-base md:text-lg font-black tracking-tight text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
							placeholder="0"
							value={jumlah}
							oninput={handleJumlahInput}
						/>
					</div>

					<!-- Quick Presets -->
					<div class="mt-2.5 flex items-center gap-1.5 flex-wrap">
						<span class="text-[11px] text-slate-500 font-medium mr-1">Tambah cepat:</span>
						{#each [20000, 50000, 100000, 250000, 500000] as preset}
							<button
								type="button"
								class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/60 hover:text-white transition-all active:scale-95"
								onclick={() => addPresetAmount(preset)}
							>
								+{preset >= 1000000 ? `${preset / 1000000}jt` : `${preset / 1000}rb`}
							</button>
						{/each}
						{#if jumlahNum > 0}
							<button
								type="button"
								class="px-2 py-1 rounded-lg text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-all ml-auto"
								onclick={() => (jumlah = '')}
							>
								Reset
							</button>
						{/if}
					</div>

					<!-- Spelled-out Currency -->
					{#if terbilangText}
						<p class="text-xs text-slate-400 italic mt-2 px-3 py-1.5 rounded-lg bg-slate-900/50 border border-slate-800/80">
							Terbilang: <span class="font-medium text-slate-200">{terbilangText}</span>
						</p>
					{/if}
				</div>

				<!-- Section 4: Uraian Keperluan -->
				<div>
					<div class="flex items-center justify-between mb-2">
						<label class="text-xs font-bold uppercase tracking-wider text-slate-400" for="deskripsi">
							4. Uraian Keperluan <span class="text-red-400">*</span>
						</label>
						<span class="text-[11px] {deskripsi.trim().length >= 5 ? 'text-emerald-400 font-medium' : 'text-slate-500'}">
							{deskripsi.trim().length}/5 min.
						</span>
					</div>
					<textarea
						id="deskripsi"
						rows="3"
						class="w-full rounded-xl border border-slate-700/80 bg-slate-900/80 text-sm p-3.5 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all resize-none"
						placeholder="Contoh: Beli konsumsi rapat teknis proyek PLTU & cetak gambar teknik arsitektur"
						bind:value={deskripsi}
					></textarea>
					<div class="flex items-start gap-1.5 mt-1.5 text-[11px] text-slate-400">
						<IconSparkles size={14} class="text-amber-400 shrink-0 mt-0.5" />
						<span>Kategori & akun biaya otomatis dianalisis dari uraian ini saat diverifikasi oleh Kasir.</span>
					</div>
				</div>

				<!-- Section 4a: Proyek (PRJ-21) — opsional; terisi → biaya masuk anggaran proyek saat Kasir memposting -->
				<div>
					<label class="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
						Untuk Proyek (opsional)
					</label>
					{#if imprestProjectId}
						<div class="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
							🔒 {imprestProjectName}
							<span class="block text-[11px] text-emerald-300/80">Dana kerja ini khusus untuk proyek di atas — proyek terpilih otomatis.</span>
						</div>
					{:else}
						<ProjectSelect projects={pcProjects} bind:value={selectedProject} placeholder="— Bukan untuk proyek —" />
					{/if}
					<div class="flex items-start gap-1.5 mt-1.5 text-[11px] text-slate-400">
						<IconSparkles size={14} class="text-amber-400 shrink-0 mt-0.5" />
						<span>Pilih proyek agar biaya ini tercatat di anggaran proyek (RAP vs Aktual). Kosongkan bila bukan biaya proyek.</span>
					</div>
				</div>

				<!-- Section 4b: Auto-Match Kunjungan (Fase 2/F1 lanjutan Gate Disiplin Lapangan, 6 Okt
				     2026) — hanya tampil bila uraian terindikasi BBM/eToll/parkir. Murni saran, tidak
				     ada yang diblokir di sini. -->
				{#if needsVisitPicker}
					<div class="p-4 rounded-2xl bg-blue-950/20 border border-blue-800/40">
						<label class="text-xs font-bold uppercase tracking-wider text-blue-300 block mb-2">
							Kaitkan ke Kunjungan Lapangan
						</label>
						<p class="text-[11px] text-blue-400/80 mb-2.5">
							Uraian menyebut BBM/eToll/parkir — kaitkan ke kunjungan terkait (membantu verifikasi lebih cepat), atau tandai tanpa kunjungan fisik.
						</p>

						{#if loadingVisits}
							<CircularProgressGauge size={42} strokeWidth={3} label="Memuat daftar kunjungan..." />
						{:else if !noVisitMode}
							{#if visits.length === 0}
								<p class="text-[12px] text-slate-400">Belum ada kunjungan tercatat {visitPickerHari} hari terakhir. Tandai "Tanpa kunjungan fisik" di bawah bila memang bukan kunjungan lapangan.</p>
							{:else}
								<select
									class="w-full rounded-xl border border-blue-700/60 bg-slate-900/80 text-sm p-3 text-slate-100 focus:border-blue-400 outline-none transition-all"
									bind:value={selectedSiteCheckinId}
								>
									<option value={null} disabled selected>Pilih kunjungan…</option>
									{#each visits as v (v.id)}
										<option value={v.id}>
											{v.nama_lokasi || 'Lokasi tidak diketahui'} — {new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v.check_in_at))}
											{v.status === 'active' ? '(masih aktif)' : ''}
										</option>
									{/each}
								</select>
							{/if}
						{/if}

						<label class="flex items-center gap-2 mt-3 text-xs font-semibold text-slate-300 cursor-pointer">
							<input type="checkbox" bind:checked={noVisitMode} />
							<span>Tidak terkait kunjungan fisik (mis. beli online, antar dokumen)</span>
						</label>

						{#if noVisitMode}
							<textarea
								rows="2"
								class="w-full mt-2 rounded-xl border border-blue-700/60 bg-slate-900/80 text-sm p-3 text-slate-100 placeholder:text-slate-500 focus:border-blue-400 outline-none transition-all resize-none"
								placeholder="Jelaskan kenapa tanpa kunjungan fisik (minimal {visitMinChar} karakter)"
								bind:value={visitExceptionText}
							></textarea>
							<p class="text-[11px] mt-1 {visitExceptionText.trim().length >= visitMinChar ? 'text-emerald-400' : 'text-amber-400'}">
								{visitExceptionText.trim().length}/{visitMinChar} karakter minimal
							</p>
						{/if}
					</div>
				{/if}

				<!-- Section 4c: BBM (Interlocking Kas Kecil Fase 3, 13 Okt 2026) - tampil bila uraian menyebut BBM. -->
				{#if isBbm}
					<div class="p-4 rounded-2xl bg-amber-950/20 border border-amber-800/40 space-y-3">
						<div>
							<p class="text-xs font-bold uppercase tracking-wider text-amber-300">Data Pengisian BBM</p>
							<p class="text-[11px] text-amber-400/80 mt-1">
								Isi KM odometer dari dashboard saat di SPBU. KM dan tanggal nota harus diisi sekarang agar tidak ditahan verifikasi; foto nota boleh menyusul.
							</p>
						</div>

						<div class="grid grid-cols-2 gap-2">
							<button type="button"
								class="px-3 py-2 rounded-xl text-xs font-bold border transition-all {bbmTarget === 'kendaraan' ? 'bg-amber-500/20 border-amber-500/70 text-amber-200' : 'bg-slate-900/50 border-slate-800 text-slate-400'}"
								onclick={() => (bbmTarget = 'kendaraan')}>🚗 Kendaraan</button>
							<button type="button"
								class="px-3 py-2 rounded-xl text-xs font-bold border transition-all {bbmTarget === 'lainnya' ? 'bg-amber-500/20 border-amber-500/70 text-amber-200' : 'bg-slate-900/50 border-slate-800 text-slate-400'}"
								onclick={() => { bbmTarget = 'lainnya'; vehicleId = ''; odometer = ''; }}>⚙️ Alat / Lainnya</button>
						</div>

						{#if useVehicle}
							<div>
								<label class="text-[11px] font-bold text-slate-300 block mb-1" for="bbm-kendaraan">Kendaraan <span class="text-red-400">*</span></label>
								<select id="bbm-kendaraan" bind:value={vehicleId}
									class="w-full rounded-xl border border-amber-700/60 bg-slate-900/80 text-sm p-3 text-slate-100 focus:border-amber-400 outline-none transition-all">
									<option value="">{vehiclesLoaded ? '— Pilih kendaraan —' : 'Memuat kendaraan…'}</option>
									{#each vehicles as v (v.id)}
										<option value={String(v.id)}>{v.name} · {v.code}</option>
									{/each}
								</select>
							</div>

							{#if vehicleId}
								{#if p2hStatus === 'ok'}
									<p class="text-[11px] text-emerald-400">✅ Kendaraan sudah P2H pada {receiptDate || 'hari ini'} (cukup sekali per hari oleh pengguna pertama).</p>
								{:else if p2hStatus === 'belum'}
									<div class="text-[11px] text-amber-300 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2">
										⚠️ Belum ada P2H untuk kendaraan ini pada {receiptDate || 'hari ini'}.
										<a href="/driver/check" class="underline font-bold">Buka Form P2H (±2 menit)</a>. Pengajuan tetap bisa dikirim, tetapi akan ditandai.
									</div>
								{:else if p2hStatus === 'tidak_laik'}
									<p class="text-[11px] text-red-400">⛔ P2H terakhir menyatakan kendaraan TIDAK LAIK jalan. Pengajuan tetap bisa dikirim, tetapi akan ditandai.</p>
								{:else if p2hStatus === 'checking'}
									<p class="text-[11px] text-slate-400">Memeriksa P2H…</p>
								{/if}
							{/if}

							<div class="grid grid-cols-2 gap-3">
								<div>
									<label class="text-[11px] font-bold text-slate-300 block mb-1" for="bbm-km">KM Odometer <span class="text-red-400">*</span></label>
									<input id="bbm-km" type="text" inputmode="decimal" bind:value={odometer} placeholder="mis. 123456"
										class="w-full rounded-xl border border-amber-700/60 bg-slate-900/80 text-sm p-3 text-slate-100 placeholder:text-slate-500 focus:border-amber-400 outline-none transition-all" />
								</div>
								<div>
									<label class="text-[11px] font-bold text-slate-300 block mb-1" for="bbm-liter">Liter BBM</label>
									<input id="bbm-liter" type="text" inputmode="decimal" bind:value={literBbm} placeholder="mis. 25"
										class="w-full rounded-xl border border-amber-700/60 bg-slate-900/80 text-sm p-3 text-slate-100 placeholder:text-slate-500 focus:border-amber-400 outline-none transition-all" />
								</div>
							</div>
							<p class="text-[11px] text-slate-400">KM dipakai memeriksa kewajaran konsumsi BBM. Liter membantu pemeriksaan tetapi boleh dikosongkan.</p>
						{:else}
							<div>
								<label class="text-[11px] font-bold text-slate-300 block mb-1" for="bbm-liter2">Liter BBM</label>
								<input id="bbm-liter2" type="text" inputmode="decimal" bind:value={literBbm} placeholder="mis. 20 (opsional)"
									class="w-full rounded-xl border border-amber-700/60 bg-slate-900/80 text-sm p-3 text-slate-100 placeholder:text-slate-500 focus:border-amber-400 outline-none transition-all" />
							</div>
						{/if}
					</div>
				{/if}

				<!-- Section 4d: Pembelian Masuk Persediaan Gudang / Workshop (Stock-IN) -->
				<div class="p-4 rounded-2xl transition-all border {isInventoryIn ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-slate-900/40 border-slate-800'}">
					<div class="flex items-start justify-between gap-3">
						<div class="flex items-start gap-3">
							<div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 {isInventoryIn ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}">
								<IconBox size={20} />
							</div>
							<div>
								<div class="flex items-center gap-2">
									<p class="text-sm font-extrabold {isInventoryIn ? 'text-emerald-300' : 'text-slate-200'}">
										Barang Masuk Stok Persediaan Gudang (Stock-IN)
									</p>
									<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
										Inventory
									</span>
								</div>
								<p class="text-xs text-slate-400 mt-0.5 leading-relaxed">
									Aktifkan jika pembelian tunai ini disimpan sebagai stok workshop / cadangan proyek.
								</p>
							</div>
						</div>
						<label class="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
							<input type="checkbox" bind:checked={isInventoryIn} class="sr-only peer" />
							<div class="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
						</label>
					</div>

					<!-- Hint & Panduan Lapangan -->
					<div class="mt-3 p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 text-[11px] text-slate-300 space-y-1.5">
						<div class="flex items-center gap-1.5 font-bold text-amber-300">
							<IconInfoCircle size={14} class="shrink-0" />
							<span>Panduan Pemilihan:</span>
						</div>
						<ul class="list-disc list-inside space-y-1 text-slate-400 pl-1">
							<li><strong class="text-emerald-300">Centang (Masuk Stok):</strong> Barang dibeli untuk cadangan/stok gudang (contoh: kabel 1 roll, amplas, baut, cat). Stok gudang otomatis bertambah saat disetujui kasir.</li>
							<li><strong class="text-slate-300">Jangan centang (Beban Langsung):</strong> Barang langsung habis terpasang saat itu juga untuk perbaikan darurat di lapangan.</li>
						</ul>
					</div>

					{#if isInventoryIn}
						<div class="mt-4 pt-4 border-t border-emerald-500/20 space-y-3.5">
							<!-- 1. Pilih Item dari Identitas Barang -->
							<div>
								<label class="text-xs font-bold uppercase tracking-wider text-emerald-300 block mb-1.5">
									Pilih Barang dari Katalog <span class="text-red-400">*</span>
								</label>

								{#if selectedItem}
									<!-- Selected Item Badge -->
									<div class="flex items-center justify-between p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2">
												<span class="text-xs font-bold text-emerald-200 truncate">{selectedItem.nama_barang_lengkap}</span>
												{#if selectedItem.satuan}
													<span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
														{selectedItem.satuan}
													</span>
												{/if}
											</div>
											{#if selectedItem.kode_item}
												<p class="text-[11px] text-emerald-400/80 mt-0.5 font-mono">Kode: {selectedItem.kode_item}</p>
											{/if}
										</div>
										<button
											type="button"
											class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800/80 hover:bg-red-500/20 text-slate-300 hover:text-red-300 border border-slate-700 hover:border-red-500/40 transition-all shrink-0 ml-2"
											onclick={clearInventoryItem}
										>
											Ganti
										</button>
									</div>
								{:else}
									<!-- Autocomplete Search Input -->
									<div class="relative">
										<div class="relative">
											<span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
												{#if searchingItems}
													<IconLoader2 size={16} class="animate-spin text-emerald-400" />
												{:else}
													<IconSearch size={16} />
												{/if}
											</span>
											<input
												type="text"
												class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-emerald-700/60 bg-slate-900/90 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
												placeholder="Ketik minimal 2 huruf nama barang (mis: kabel, amplas, cat)..."
												value={itemSearchInput}
												oninput={handleItemSearchInput}
											/>
										</div>

										<!-- Autocomplete Dropdown -->
										{#if itemSearchResults.length > 0}
											<div class="absolute left-0 right-0 top-full mt-1.5 z-30 max-h-56 overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 shadow-2xl divide-y divide-slate-800">
												{#each itemSearchResults as it (it.id)}
													<button
														type="button"
														class="w-full text-left p-2.5 hover:bg-emerald-500/10 transition-colors flex items-center justify-between gap-2 group"
														onclick={() => selectInventoryItem(it)}
													>
														<div class="min-w-0">
															<p class="text-xs font-bold text-slate-200 group-hover:text-emerald-300 truncate">
																{it.nama_barang_lengkap}
															</p>
															{#if it.kode_item}
																<p class="text-[10px] text-slate-500 font-mono">{it.kode_item}</p>
															{/if}
														</div>
														{#if it.satuan}
															<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 shrink-0">
																{it.satuan}
															</span>
														{/if}
													</button>
												{/each}
											</div>
										{:else if itemSearchInput.trim().length >= 2 && !searchingItems}
											<div class="absolute left-0 right-0 top-full mt-1.5 z-30 p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-400 text-center">
												Tidak ada barang yang cocok dengan "{itemSearchInput}".
											</div>
										{/if}
									</div>
								{/if}
							</div>

							<!-- 2. Kuantitas & Gudang Tujuan -->
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
								<div>
									<label class="text-xs font-bold uppercase tracking-wider text-emerald-300 block mb-1.5" for="invqty">
										Kuantitas Masuk <span class="text-red-400">*</span>
									</label>
									<div class="relative">
										<input
											id="invqty"
											type="number"
											step="any"
											min="0.01"
											class="w-full pr-14 pl-3.5 py-2.5 rounded-xl border border-emerald-700/60 bg-slate-900/80 text-sm font-bold text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 outline-none transition-all"
											placeholder="1"
											bind:value={inventoryQty}
										/>
										<span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
											{selectedItem?.satuan || 'QTY'}
										</span>
									</div>
								</div>

								<div>
									<label class="text-xs font-bold uppercase tracking-wider text-emerald-300 block mb-1.5" for="gudang">
										Gudang Tujuan <span class="text-red-400">*</span>
									</label>
									<select
										id="gudang"
										class="w-full rounded-xl border border-emerald-700/60 bg-slate-900/80 text-sm p-2.5 text-slate-100 focus:border-emerald-400 outline-none transition-all"
										bind:value={selectedGudangId}
										disabled={loadingWarehouses}
									>
										<option value="">{loadingWarehouses ? 'Memuat gudang...' : '— Pilih Gudang Tujuan —'}</option>
										{#each warehouses as g (g.id)}
											<option value={g.id}>
												{g.nama_gudang} ({g.kode_gudang || g.jenis})
											</option>
										{/each}
									</select>
								</div>
							</div>
						</div>
					{/if}
				</div>

				<!-- Section 5: Penerima & No. Nota -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div>
						<label class="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2" for="penerima">
							Dibayarkan ke / Vendor
						</label>
						<input
							id="penerima"
							type="text"
							class="w-full rounded-xl border border-slate-700/80 bg-slate-900/80 text-sm p-3.5 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
							placeholder="Opsional (mis. Toko Bangunan Berkah)"
							bind:value={penerima}
						/>
					</div>
					<div>
						<label class="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2" for="nonota">
							Nomor Nota / Struk
						</label>
						<input
							id="nonota"
							type="text"
							class="w-full rounded-xl border border-slate-700/80 bg-slate-900/80 text-sm p-3.5 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
							placeholder="Opsional (mis. INV-98213)"
							bind:value={noNota}
						/>
					</div>
				</div>

				<!-- Tanggal pada nota - wajib untuk klaim BBM; membantu pemeriksaan nota basi/duplikat -->
				<div>
					<label class="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2" for="tglnota">
						Tanggal di Nota {#if isBbm}<span class="text-red-400">*</span>{:else}<span class="text-slate-500 normal-case font-medium">(opsional)</span>{/if}
					</label>
					<input id="tglnota" type="date" max={todayJkt()} bind:value={receiptDate}
						class="w-full rounded-xl border border-slate-700/80 bg-slate-900/80 text-sm p-3.5 text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
					<p class="text-[11px] text-slate-500 mt-1.5">Tanggal yang tertera di struk. Nota yang terlalu lama (lebih dari beberapa hari kerja) akan ditandai.</p>
				</div>

				<!-- Section 6: Advance Only (Tanggal Dibutuhkan) -->
				{#if mode === 'advance'}
					<div class="p-4 rounded-2xl bg-purple-950/20 border border-purple-800/40">
						<label class="text-xs font-bold uppercase tracking-wider text-purple-300 block mb-2" for="tglbutuh">
							Kapan Dana Dibutuhkan di Lapangan?
						</label>
						<input
							id="tglbutuh"
							type="date"
							class="w-full rounded-xl border border-purple-700/60 bg-slate-900/80 text-sm p-3.5 text-slate-100 focus:border-purple-400 outline-none transition-all"
							bind:value={tglButuh}
						/>
						<p class="text-[11px] text-purple-400 mt-1.5">
							Membantu atasan & kasir memprioritaskan pencairan dana kas kecil sesuai jadwal kegiatan.
						</p>
					</div>
				{/if}

				<!-- Section 7: Bukti Foto / Nota -->
				<div>
					<div class="flex items-center justify-between mb-2">
						<label class="text-xs font-bold uppercase tracking-wider text-slate-400">
							Foto Nota / Struk Bukti {mode === 'reimburse' ? '(Disarankan)' : '(Opsional)'}
						</label>
						{#if compressing}
							<span class="text-[11px] text-amber-400 font-semibold">Memperkecil foto…</span>
						{:else if notaFile}
							<span class="text-[11px] text-emerald-400 font-semibold flex items-center gap-1" title="Foto sudah diperkecil otomatis agar cepat terkirim di sinyal lemah.">
								<IconCheck size={14} /> Siap kirim (± {Math.max(1, Math.round(notaFile.size / 1024))} KB)
							</span>
						{/if}
					</div>

					{#if notaPreview}
						<!-- Photo Attached Card -->
						<div class="flex items-center gap-4 p-3.5 rounded-2xl bg-slate-900/70 border border-slate-700/80">
							<button
								type="button"
								class="relative w-20 h-20 rounded-xl overflow-hidden group shrink-0 border border-slate-700"
								onclick={() => (showImageModal = true)}
								title="Perbesar gambar"
							>
								<img src={notaPreview} alt="Bukti nota" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
								<div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
									<IconZoomIn size={18} />
								</div>
							</button>

							<div class="flex-1 min-w-0">
								<p class="text-sm font-bold text-slate-200 truncate">{notaFile?.name || 'Foto Nota Terlampir'}</p>
								<p class="text-xs text-slate-400 mt-0.5">Otomatis dikompresi agar hemat kuota internet</p>
								<div class="flex items-center gap-3 mt-2">
									<button
										type="button"
										class="text-xs font-semibold text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
										onclick={() => (showImageModal = true)}
									>
										<IconZoomIn size={14} /> Perbesar
									</button>
									<button
										type="button"
										class="text-xs font-semibold text-red-400 hover:text-red-300 inline-flex items-center gap-1"
										onclick={removeNota}
									>
										<IconX size={14} /> Hapus Foto
									</button>
								</div>
							</div>
						</div>
					{:else}
						<!-- Upload Box Dropzone -->
						<label class="rounded-2xl border-2 border-dashed border-slate-700 hover:border-blue-500/70 bg-slate-900/40 hover:bg-slate-900/80 p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all group">
							<div class="w-12 h-12 rounded-full bg-slate-800 group-hover:bg-blue-500/20 text-slate-400 group-hover:text-blue-400 flex items-center justify-center transition-colors">
								<IconCamera size={24} />
							</div>
							<p class="text-sm font-bold text-slate-300 group-hover:text-blue-400 transition-colors">
								Ambil Foto atau Pilih Gambar
							</p>
							<p class="text-xs text-slate-500 text-center max-w-xs">
								Foto struk/nota belanjaan asli dari kamera HP atau galeri file dokumen.
							</p>
							<input type="file" accept="image/*" capture="environment" class="hidden" onchange={onNotaChange} />
						</label>
					{/if}
				</div>

									<!-- FLD-04: peringatan lunak tiket ganda (bukan blokir) -->
					{#if dupWarning}
						<div class="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-2.5">
							<div class="flex items-start gap-2">
								<IconInfoCircle size={16} class="shrink-0 mt-0.5" />
								<span>{dupWarning.message}</span>
							</div>
							<div class="flex flex-wrap gap-2">
								<button type="button" class="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 font-bold text-slate-200" onclick={() => goto('/ess/petty-cash')}>Lihat Riwayat</button>
								<button type="button" class="px-3 py-1.5 rounded-lg bg-amber-600 font-bold text-white disabled:opacity-40" disabled={submitting} onclick={() => handleSubmit(true)}>Tetap Kirim Sebagai Pengajuan Baru</button>
							</div>
						</div>
					{/if}

					<!-- Error Alert -->
				{#if errorMsg}
					<div class="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
						<IconInfoCircle size={16} class="shrink-0 mt-0.5" />
						<span>{errorMsg}</span>
					</div>
				{/if}

				<!-- Action Submit Bar -->
				<div class="pt-4 border-t border-slate-800/80">
					<div class="flex items-center justify-between mb-3 text-xs">
						<span class="text-slate-400">Status Kelengkapan:</span>
						{#if canSubmit}
							<span class="text-emerald-400 font-bold flex items-center gap-1">
								<IconCheck size={14} /> Formulir siap dikirim
							</span>
						{:else}
							<span class="text-amber-400 font-medium">
								{!fundId ? '• Pilih dana kas kecil' : jumlahNum <= 0 ? '• Masukkan nominal' : deskripsi.trim().length < 5 ? '• Uraian minimal 5 karakter' : bbmMissing.length ? '• Lengkapi: ' + bbmMissing.join(', ') : stockInMissing.length ? '• Lengkapi persediaan: ' + stockInMissing.join(', ') : ''}
							</span>
						{/if}
					</div>

					<button
						type="button"
						class="w-full h-12 md:h-14 rounded-2xl text-sm md:text-base font-extrabold text-white flex items-center justify-center gap-2.5 transition-all shadow-xl disabled:opacity-40 disabled:cursor-not-allowed gradient-bg hover:opacity-95 active:scale-[0.99]"
						disabled={!canSubmit}
						onclick={() => handleSubmit()}
					>
						{#if submitting}
							<IconLoader2 size={20} class="animate-spin" />
							<span>Mengirim Pengajuan...</span>
						{:else}
							<IconSend size={18} />
							<span>{editId ? 'Kirim Ulang Perbaikan' : 'Kirim Pengajuan Kas Kecil'}</span>
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- Modal Zoom Nota -->
{#if showImageModal && notaPreview}
	<div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="relative max-w-xl w-full max-h-[85vh] bg-slate-900 rounded-3xl border border-slate-700 overflow-hidden flex flex-col shadow-2xl">
			<div class="flex items-center justify-between p-4 border-b border-slate-800">
				<h3 class="text-sm font-bold text-slate-200">Pratinjau Foto Nota</h3>
				<button
					class="w-8 h-8 rounded-full bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
					onclick={() => (showImageModal = false)}
				>
					<IconX size={16} />
				</button>
			</div>
			<div class="p-4 flex-1 overflow-auto flex items-center justify-center bg-black/50">
				<img src={notaPreview} alt="Nota Full Size" class="max-w-full max-h-[65vh] object-contain rounded-xl" />
			</div>
			<div class="p-3 border-t border-slate-800 flex justify-end">
				<button
					class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 transition-colors"
					onclick={() => (showImageModal = false)}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}
