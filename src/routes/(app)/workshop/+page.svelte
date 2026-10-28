<!-- src/routes/(app)/workshop/+page.svelte -->
<!-- Rencana v2 (TAJAM) Pusat Order Workshop Ciketing — Fase 4 §9. Fase 7c Unifikasi Workshop: berlaku juga untuk Balaraja
     (pemilih workshop di atas halaman; ?ws=ciketing|balaraja; pilihan terakhir diingat di HP).
     Hub "Workshop Ops" mobile-first: Papan Order (read-only) + 2 kartu tulis
     (Laporan Harian, Terima Barang) + 2 kartu deep-link ke modul existing
     (Inspeksi, Scan). Ini alamat akar masalah Fase 0: laporan harian & SJ Masuk
     sebelumnya HANYA bisa diisi dari dashboard admin erp-epi, jadi mandor/leader
     lapangan tidak pernah mengisinya. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import {
		getMyOrders,
		getSoItemsForSoIds,
		getProjectSubtasksAndAccum,
		getSjMasukOptionsForProjects,
		submitLaporanHarianWorkshop,
		resolveWorkshopForProjects,
		getWorkshopRoster,
		getMaterialSuggestions,
		type MaterialSuggestion,
		submitTerimaBarangLapangan,
		submitQuickFieldReport,
		validateTerimaBarangInput,
		uploadWorkshopPhoto,
		type MyOrderRow,
		type SoItemOption,
		type SjMasukOption,
		type KondisiBarang,
		type LaporanPoDetailInput
	} from '$lib/services/workshopOpsApi';
	import { WORKSHOP_OPS, parseOpsWorkshop, type OpsWorkshopKey } from '$lib/services/workshopOpsProfile';
	import { fetchWsTimelineStatusBatch, type WsTimelineStatus } from '$lib/services/wsTimelineStatus';
	import {
		enqueueTerimaBarangSubmission,
		getQueuedTerimaBarangSubmissions,
		registerTerimaBarangAutoFlush,
		flushTerimaBarangQueue,
		type QueuedTerimaBarangSubmission
	} from '$lib/utils/offlineTerimaBarangQueue';
	import {
		enqueueLaporanHarianSubmission,
		getQueuedLaporanHarianSubmissions,
		registerLaporanHarianAutoFlush,
		flushLaporanHarianQueue,
		type QueuedLaporanHarianSubmission
	} from '$lib/utils/offlineLaporanHarianQueue';
	import { todayWib } from '$lib/utils/wibDate';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import LaporanKehadiranMaterial from '$lib/components/workshop/LaporanKehadiranMaterial.svelte';
	import { rosterToRows, countHadir, derivePoManpower, toSubmitRows, type AttendanceRow, type MaterialRow } from '$lib/utils/laporanAbsensi';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import QrCameraScanner from '$lib/components/ui/QrCameraScanner.svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import {
		IconLoader2,
		IconAlertTriangle,
		IconClipboardList,
		IconTruckDelivery,
		IconClipboardCheck,
		IconQrcode,
		IconX,
		IconCamera,
		IconCheck,
		IconPlus,
		IconFileAlert,
		IconPackages
	} from '@tabler/icons-svelte';

	// Rekomendasi Tambahan Lapangan #3 (Offline Mode Enhancement) — jumlah submission
	// tertunda di HP ini (belum berhasil terkirim karena offline saat disimpan).
	let pendingTerimaCount = $state(0);
	let pendingLaporanCount = $state(0);
	async function refreshPendingCounts() {
		pendingTerimaCount = (await getQueuedTerimaBarangSubmissions()).length;
		pendingLaporanCount = (await getQueuedLaporanHarianSubmissions()).length;
	}

	// Fase 7c — workshop aktif. Sumber: ?ws= → pilihan terakhir (localStorage) → ciketing.
	const WS_STORAGE_KEY = 'workshopOps.ws';
	let wsKey = $state<OpsWorkshopKey>('ciketing');
	const P = $derived(WORKSHOP_OPS[wsKey]);

	function initialWorkshop(): OpsWorkshopKey {
		const q = page.url.searchParams.get('ws');
		if (q) return parseOpsWorkshop(q);
		try {
			return parseOpsWorkshop(localStorage.getItem(WS_STORAGE_KEY));
		} catch {
			return 'ciketing';
		}
	}

	async function switchWorkshop(next: OpsWorkshopKey) {
		if (next === wsKey) return;
		wsKey = next;
		try { localStorage.setItem(WS_STORAGE_KEY, next); } catch { /* penyimpanan diblokir — pilihan tidak diingat */ }
		goto(`?ws=${next}`, { replaceState: true, noScroll: true, keepFocus: true });
		// Bersihkan semua data & form milik workshop sebelumnya (jangan campur PO dua workshop).
		orders = [];
		soItemsBySoId = {};
		wsStatusByProjectId = {};
		sjOptionsByProjectId = {};
		laporanRows = [];
		showLaporanForm = false;
		showTerimaForm = false;
		showQuickReport = false;
		await loadOrders();
	}

	let orders = $state<MyOrderRow[]>([]);
	let loadingOrders = $state(true);
	let ordersError = $state('');
	// Fase 5 §paritas lapangan — item PO (so_customer_details) per so_customer_id,
	// dipakai memilih so_detail_id di form Laporan Harian saat PO punya >1 item.
	let soItemsBySoId = $state<Record<number, SoItemOption[]>>({});
	// §5 Rekomendasi #3 lapangan — "Kartu PO Saya": progres fisik vs plan + lampu
	// serapan (tanpa rupiah), per projectId. Diisi fire-and-forget setelah Papan
	// Order termuat, tidak menghambat render awal.
	let wsStatusByProjectId = $state<Record<number, WsTimelineStatus | null>>({});

	let toastMsg = $state('');
	let toastType = $state<'ok' | 'err'>('ok');
	let toastTimer = 0;
	function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
		toastMsg = msg;
		toastType = type;
		clearTimeout(toastTimer);
		toastTimer = window.setTimeout(() => (toastMsg = ''), 4000);
	}

	async function loadOrders() {
		loadingOrders = true;
		ordersError = '';
		try {
			const reqWs = wsKey;
			const fetched = await getMyOrders(reqWs);
			if (reqWs !== wsKey) return; // pindah workshop saat memuat — hasil ini basi
			orders = fetched;
			const soIds = orders.map((o) => o.soCustomerId).filter((id): id is number => !!id);
			soItemsBySoId = soIds.length > 0 ? await getSoItemsForSoIds(soIds) : {};

			// §5 Rekomendasi #3 — lampu+progres semua PO dalam SATU request (WSK-15), tidak menghambat render.
			const forWs = wsKey;
			fetchWsTimelineStatusBatch(orders.map((o) => o.projectId), forWs).then((map) => {
				if (forWs !== wsKey) return; // pengguna sudah pindah workshop — abaikan hasil basi
				wsStatusByProjectId = { ...wsStatusByProjectId, ...map };
			});
		} catch (e: any) {
			ordersError = e?.message || 'Gagal memuat Papan Order';
		} finally {
			loadingOrders = false;
		}
	}
	onMount(() => {
		wsKey = initialWorkshop();
		loadOrders();
		refreshPendingCounts();
		registerTerimaBarangAutoFlush(sendQueuedTerimaBarang);
		flushTerimaBarangQueue(sendQueuedTerimaBarang).finally(refreshPendingCounts);
		registerLaporanHarianAutoFlush(sendQueuedLaporanHarian);
		flushLaporanHarianQueue(sendQueuedLaporanHarian).finally(refreshPendingCounts);
	});

	function soItemsForOrder(po: MyOrderRow | undefined): SoItemOption[] {
		if (!po?.soCustomerId) return [];
		return soItemsBySoId[po.soCustomerId] || [];
	}

	const STAGE_COLOR: Record<string, string> = {
		order: 'bg-slate-100 text-slate-600',
		inbound: 'bg-sky-100 text-sky-700',
		produksi: 'bg-amber-100 text-amber-700',
		qc: 'bg-purple-100 text-purple-700',
		siap_kirim: 'bg-indigo-100 text-indigo-700',
		dikirim: 'bg-teal-100 text-teal-700',
		tagih: 'bg-emerald-100 text-emerald-700'
	};

	function daysUntil(dateStr: string | null): number | null {
		if (!dateStr) return null;
		return Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000);
	}
	function deadlineLabel(days: number | null): string {
		if (days === null) return 'Tanpa deadline';
		if (days < 0) return `${Math.abs(days)} hari lewat`;
		if (days === 0) return 'Hari ini';
		return `${days} hari lagi`;
	}

	// ─── Kartu ① Laporan Harian Workshop ────────────────────────────────────
	interface LaporanSubtaskRow {
		po_id: number;
		subtask_id: string | null;
		subtask_name: string;
		category_name: string;
		so_detail_id: number | null;
		satuan: string;
		target_volume: number;
		plan_hari_ini: number;
		accum_volume: number;
		sisa_volume: number;
		volume_aktual: number;
		progress_hari_ini: number;
		total_progress_percentage: number;
		jumlah_manpower: number;
		aktivitas: string;
		kendala_po: string;
		sandblasting: number;
		primer: number;
		second: number;
		topcoat: number;
		surat_jalan_masuk_id: number | null; // Fase 4 Link SJ — sama untuk semua subtask 1 PO
	}

	let showLaporanForm = $state(false);
	let loadingLaporanData = $state(false);
	// WSK-13 §4e: tanggal bawaan WIB (bukan UTC) — form dibuka sebelum 07.00 WIB tidak lagi bertanggal kemarin.
	let laporanTanggal = $state(todayWib());
	// id transaksi per pembukaan form → dipakai jalur online DAN antrian offline (WSK-13 §4d)
	let laporanTxnId = $state(crypto.randomUUID());
	const shiftPagiWib = () => new Date(Date.now() + 7 * 3600 * 1000).getUTCHours() < 7;
	let laporanCuaca = $state('cerah');
	let laporanJumlahTenaga = $state(0);
	let laporanKendala = $state('');
	let laporanCatatan = $state('');
	let laporanRows = $state<LaporanSubtaskRow[]>([]);
	let laporanFotos = $state<File[]>([]);
	// WSK-13 §4a — Kehadiran + Alokasi + Material + foto grup/per-PO
	const uploadedPhotoCache = new Map<string, string>();
	let absensiRows = $state<AttendanceRow[]>([]);
	let materialRows = $state<MaterialRow[]>([]);
	let tidakAdaMaterial = $state(false);
	let fotoGrupMasuk = $state<File | null>(null);
	let fotoGrupPulang = $state<File | null>(null);
	let poFotos = $state<Record<number, File[]>>({});
	let materialSuggestions = $state<MaterialSuggestion[]>([]);
	/** Roster tersedia → Jumlah Tenaga & Orang-per-PO diturunkan otomatis. Roster kosong/gagal dimuat → mode manual lama. */
	let useAbsensi = $derived(absensiRows.length > 0);
	const rowFilled = (r: LaporanSubtaskRow) =>
		(Number(r.volume_aktual) || 0) > 0 || (Number(r.sandblasting) || 0) > 0 || (Number(r.primer) || 0) > 0 || (Number(r.second) || 0) > 0 || (Number(r.topcoat) || 0) > 0 || !!(r.aktivitas || '').trim() || !!(r.kendala_po || '').trim();
	/** PO yang hari ini ada isian pekerjaannya (dasar pilihan alokasi & foto per PO) */
	let reportedPos = $derived.by(() => {
		const ids = [...new Set(laporanRows.filter(rowFilled).map((r) => r.po_id))];
		return ids.map((id) => ({ id, label: orders.find((o) => o.projectId === id)?.nomorPo || `PO #${id}` }));
	});
	$effect(() => {
		if (!useAbsensi) return;
		const ids = reportedPos.map((p) => p.id);
		const per = derivePoManpower(absensiRows, ids);
		for (const o of orders) { const want = per[o.projectId] || 0; if (getPoManpower(o.projectId) !== want) setPoManpower(o.projectId, want); }
		const hadir = countHadir(absensiRows);
		if (laporanJumlahTenaga !== hadir) laporanJumlahTenaga = hadir;
	});
	let savingLaporan = $state(false);
	// Fase 4 Link SJ (Audit Timeline Ciketing) — daftar SJ Masuk 90 hari terakhir per PO,
	// untuk dropdown opsional "SJ Terkait" di form Laporan Harian.
	let sjOptionsByProjectId = $state<Record<number, SjMasukOption[]>>({});

	// Manpower helper: 1 PO = N orang (disimpan di baris pertama PO)
	function getPoManpower(poId: number): number {
		const first = laporanRows.find((r) => r.po_id === poId);
		return Number(first?.jumlah_manpower) || 0;
	}

	function setPoManpower(poId: number, count: number) {
		const val = Math.max(0, Math.round(Number(count) || 0));
		let found = false;
		for (const r of laporanRows) {
			if (r.po_id === poId) {
				if (!found) {
					r.jumlah_manpower = val;
					found = true;
				} else {
					r.jumlah_manpower = 0;
				}
			}
		}
	}

	// Fase 4 Link SJ — SJ Terkait disimpan di baris pertama PO (pola sama getPoManpower/setPoManpower).
	function getPoSjId(poId: number): number | null {
		const first = laporanRows.find((r) => r.po_id === poId);
		return first?.surat_jalan_masuk_id ?? null;
	}
	function setPoSjId(poId: number, sjId: number | null) {
		let found = false;
		for (const r of laporanRows) {
			if (r.po_id === poId) {
				if (!found) {
					r.surat_jalan_masuk_id = sjId;
					found = true;
				} else {
					r.surat_jalan_masuk_id = sjId; // konsisten di semua baris subtask PO ini
				}
			}
		}
	}

	function updateSubtaskRow(row: LaporanSubtaskRow) {
		const target = Number(row.target_volume) || 0;
		const accum = Number(row.accum_volume) || 0;
		const curr = Math.max(0, Number(row.volume_aktual) || 0);
		const total = accum + curr;
		row.progress_hari_ini = target > 0 ? Math.round((curr / target) * 100) : (curr > 0 ? 100 : 0);
		row.total_progress_percentage = target > 0 ? Math.min(100, Math.round((total / target) * 100)) : (total > 0 ? 100 : 0);
		row.sisa_volume = Math.max(0, target - total);
	}

	function fillRemaining(row: LaporanSubtaskRow) {
		const target = Number(row.target_volume) || 0;
		const accum = Number(row.accum_volume) || 0;
		row.volume_aktual = Math.max(0, target - accum);
		updateSubtaskRow(row);
	}

	function fillComplete(row: LaporanSubtaskRow) {
		row.volume_aktual = Number(row.target_volume) || 0;
		updateSubtaskRow(row);
	}

	function addCustomSubtask(poId: number) {
		laporanRows = [
			...laporanRows,
			{
				po_id: poId,
				subtask_id: `custom_${Date.now()}`,
				subtask_name: 'Pekerjaan Tambahan Lapangan',
				category_name: 'Tambahan',
				so_detail_id: null,
				satuan: 'ls',
				target_volume: 1,
				plan_hari_ini: 0,
				accum_volume: 0,
				sisa_volume: 1,
				volume_aktual: 1,
				progress_hari_ini: 100,
				total_progress_percentage: 100,
				jumlah_manpower: 0,
				aktivitas: '',
				kendala_po: '',
				sandblasting: 0, primer: 0, second: 0, topcoat: 0, surat_jalan_masuk_id: null
			}
		];
	}

	// Fase 5 §Draf otomatis — anti hilang input kalau sinyal lapangan terputus/app
	// ditutup tak sengaja saat sedang isi laporan.
	function draftKey(tanggal: string) {
		return wsKey === 'ciketing' ? `ws_laporan_draft_${tanggal}` : `ws_laporan_draft_${wsKey}_${tanggal}`;
	}
	function saveDraft() {
		if (!showLaporanForm) return;
		try {
			localStorage.setItem(
				draftKey(laporanTanggal),
				JSON.stringify({
					cuaca: laporanCuaca,
					jumlah_tenaga: laporanJumlahTenaga,
					kendala: laporanKendala,
					catatan: laporanCatatan,
					rows: laporanRows,
					absensi: absensiRows.map((r) => ({ tipe: r.tipe, rosterId: r.rosterId, status_hadir: r.status_hadir, keterangan: r.keterangan, alokasi: r.alokasi })),
					materials: materialRows,
					tidakAdaMaterial,
					savedAt: new Date().toISOString()
				})
			);
		} catch {
			/* localStorage penuh/diblokir — draf sekadar tidak tersimpan, form tetap jalan */
		}
	}
	function loadDraft(tanggal: string): any | null {
		try {
			const raw = localStorage.getItem(draftKey(tanggal));
			return raw ? JSON.parse(raw) : null;
		} catch {
			return null;
		}
	}
	function clearDraft(tanggal: string) {
		try {
			localStorage.removeItem(draftKey(tanggal));
		} catch {
			/* aman diabaikan */
		}
	}
	let draftSaveTimer = 0;
	function scheduleDraftSave() {
		clearTimeout(draftSaveTimer);
		draftSaveTimer = window.setTimeout(saveDraft, 800);
	}
	$effect(() => {
		// Referensi state relevan supaya effect ini re-run tiap ada perubahan.
		void laporanCuaca; void laporanJumlahTenaga; void laporanKendala; void laporanCatatan; void laporanRows; void JSON.stringify(absensiRows); void JSON.stringify(materialRows); void tidakAdaMaterial;
		scheduleDraftSave();
	});

	const CUACA_OPTIONS = [
		['cerah', 'Cerah'], ['berawan', 'Berawan'], ['mendung', 'Mendung'],
		['hujan_ringan', 'Hujan Ringan'], ['hujan_lebat', 'Hujan Lebat']
	];

	async function openLaporanForm() {
		loadingLaporanData = true;
		showLaporanForm = true;
		try {
			const projectIds = orders.map((o) => o.projectId);
			const [{ subtasksByPoId, accumMap }, sjOptions] = await Promise.all([
				getProjectSubtasksAndAccum(projectIds, wsKey),
				getSjMasukOptionsForProjects(projectIds, wsKey)
			]);
			sjOptionsByProjectId = sjOptions;
			// WSK-13 §4a: roster tim + master material (2 + 1 query, paralel). Gagal → mode manual lama, tidak memblokir laporan.
			absensiRows = []; materialRows = []; tidakAdaMaterial = false; fotoGrupMasuk = null; fotoGrupPulang = null; poFotos = {};
			try {
				const [roster, sugg] = await Promise.all([getWorkshopRoster(wsKey), getMaterialSuggestions(wsKey)]);
				absensiRows = rosterToRows(roster);
				materialSuggestions = sugg;
				if (roster.length === 0) showToast('Daftar tim workshop belum tersedia — isi Jumlah Tenaga & Orang per PO manual.', 'err');
			} catch (e: any) {
				console.error('[workshop] gagal memuat roster/material:', e);
				showToast('Daftar tim gagal dimuat — isi Jumlah Tenaga & Orang per PO manual.', 'err');
			}

			const newRows: LaporanSubtaskRow[] = [];
			for (const o of orders) {
				const activeSubtasks = subtasksByPoId[o.projectId] || [];
				if (activeSubtasks.length > 0) {
					for (const sub of activeSubtasks) {
						const target = Number(sub.target_volume) || 0;
						const accum = Number(accumMap[sub.id]) || 0;
						const sisa = Math.max(0, target - accum);
						const planHariIni = Number(sub.plan?.[laporanTanggal]) || 0;
						newRows.push({
							po_id: o.projectId,
							subtask_id: String(sub.id),
							subtask_name: sub.name,
							category_name: sub.category_name || 'Pekerjaan',
							so_detail_id: sub.so_detail_id || null,
							satuan: sub.unit || 'ls',
							target_volume: target,
							plan_hari_ini: planHariIni,
							accum_volume: accum,
							sisa_volume: sisa,
							volume_aktual: 0,
							progress_hari_ini: 0,
							total_progress_percentage: target > 0 ? Math.min(100, Math.round((accum / target) * 100)) : (accum > 0 ? 100 : 0),
							jumlah_manpower: 0,
							aktivitas: '',
							kendala_po: '',
							sandblasting: 0, primer: 0, second: 0, topcoat: 0, surat_jalan_masuk_id: null
						});
					}
				} else {
					// Fallback item SO jika belum ada subtask di timeline
					const items = soItemsForOrder(o);
					if (items.length > 0) {
						for (const it of items) {
							const accum = Number(accumMap[String(it.id)]) || 0;
							newRows.push({
								po_id: o.projectId,
								subtask_id: `item_${it.id}`,
								subtask_name: it.label,
								category_name: 'Item PO',
								so_detail_id: it.id,
								satuan: 'pcs',
								target_volume: 0,
								plan_hari_ini: 0,
								accum_volume: accum,
								sisa_volume: 0,
								volume_aktual: 0,
								progress_hari_ini: 0,
								total_progress_percentage: 0,
								jumlah_manpower: 0,
								aktivitas: '',
								kendala_po: '',
								sandblasting: 0, primer: 0, second: 0, topcoat: 0, surat_jalan_masuk_id: null
							});
						}
					} else {
						newRows.push({
							po_id: o.projectId,
							subtask_id: `proj_${o.projectId}`,
							subtask_name: o.nomorPo || 'Pekerjaan Workshop',
							category_name: 'Umum',
							so_detail_id: null,
							satuan: 'ls',
							target_volume: 1,
							plan_hari_ini: 0,
							accum_volume: 0,
							sisa_volume: 1,
							volume_aktual: 0,
							progress_hari_ini: 0,
							total_progress_percentage: 0,
							jumlah_manpower: 0,
							aktivitas: '',
							kendala_po: '',
							sandblasting: 0, primer: 0, second: 0, topcoat: 0, surat_jalan_masuk_id: null
						});
					}
				}
			}

			const draft = loadDraft(laporanTanggal);
			if (draft) {
				laporanCuaca = draft.cuaca ?? laporanCuaca;
				laporanJumlahTenaga = draft.jumlah_tenaga ?? laporanJumlahTenaga;
				laporanKendala = draft.kendala ?? '';
				laporanCatatan = draft.catatan ?? '';
				if (Array.isArray(draft.rows)) {
					const draftMap = new Map(draft.rows.map((r: any) => [`${r.po_id}_${r.subtask_id || r.so_detail_id || ''}`, r]));
					for (const r of newRows) {
						const key = `${r.po_id}_${r.subtask_id || r.so_detail_id || ''}`;
						const d = draftMap.get(key);
						if (d) {
							r.volume_aktual = d.volume_aktual ?? r.volume_aktual;
							r.jumlah_manpower = d.jumlah_manpower ?? r.jumlah_manpower;
							r.aktivitas = d.aktivitas ?? r.aktivitas;
							r.kendala_po = d.kendala_po ?? r.kendala_po;
							r.surat_jalan_masuk_id = d.surat_jalan_masuk_id ?? r.surat_jalan_masuk_id;
							updateSubtaskRow(r);
						}
					}
				}
				if (Array.isArray(draft.absensi)) {
					const dm = new Map(draft.absensi.map((a: any) => [`${a.tipe}:${a.rosterId}`, a]));
					for (const r of absensiRows) {
						const d: any = dm.get(`${r.tipe}:${r.rosterId}`);
						if (d) { r.status_hadir = d.status_hadir ?? r.status_hadir; r.keterangan = d.keterangan ?? ''; r.alokasi = d.alokasi ?? 'none'; }
					}
				}
				if (Array.isArray(draft.materials)) materialRows = draft.materials;
				tidakAdaMaterial = !!draft.tidakAdaMaterial;
				showToast(`Draf tersimpan ${draft.savedAt ? new Date(draft.savedAt).toLocaleTimeString('id-ID') : ''} dipulihkan`);
			}

			laporanRows = newRows;
		} catch (e: any) {
			showToast('Gagal memuat subtask timeline: ' + (e?.message || e), 'err');
		} finally {
			loadingLaporanData = false;
		}
	}

	let sumOrangLaporan = $derived(orders.reduce((s, o) => s + getPoManpower(o.projectId), 0));

	/** Sumber data satu pengiriman laporan — dipakai jalur ONLINE (File) dan REPLAY antrian (Blob) supaya logikanya identik. */
	interface LaporanSource {
		ws: OpsWorkshopKey; txn: string; tanggal: string; cuaca: string; jumlah_tenaga: number; kendala: string; catatan: string; dibuat_oleh?: string;
		rows: LaporanPoDetailInput[]; fotoUmum: Blob[]; absensi?: ReturnType<typeof toSubmitRows>; materials?: MaterialRow[];
		fotoMasuk?: Blob | null; fotoPulang?: Blob | null; poFotos?: Record<number, Blob[]>; compress: boolean;
	}

	/** Unggah 1 foto (kompres dulu bila diminta); id hasil unggah disimpan per transaksi supaya percobaan ulang tidak mengunggah dua kali. */
	async function uploadLaporanPhoto(src: LaporanSource, key: string, blob: Blob, name: string): Promise<string | null> {
		const ck = `${src.txn}:${key}`;
		const cached = uploadedPhotoCache.get(ck);
		if (cached) return cached;
		const body = src.compress && blob instanceof File ? await compressPhoto(blob).catch(() => blob) : blob;
		const id = await uploadWorkshopPhoto(body, name);
		if (id) uploadedPhotoCache.set(ck, id);
		return id;
	}

	/**
	 * Unggah semua foto lalu simpan laporan. SATU foto gagal = tidak ada yang disimpan (kembalikan nama foto yang gagal).
	 * TypeError (tidak ada sinyal) sengaja dilempar ke pemanggil → masuk antrian offline.
	 */
	async function kirimLaporan(src: LaporanSource): Promise<{ gagalFoto: string[]; res?: Awaited<ReturnType<typeof submitLaporanHarianWorkshop>> }> {
		const gagalFoto: string[] = [];
		const fotoIds: string[] = [];
		for (let i = 0; i < src.fotoUmum.length; i++) {
			const id = await uploadLaporanPhoto(src, `u${i}`, src.fotoUmum[i], (src.fotoUmum[i] as File).name || 'laporan-harian.jpg');
			if (id) fotoIds.push(id); else gagalFoto.push((src.fotoUmum[i] as File).name || `foto umum ke-${i + 1}`);
		}
		let masukId: string | null = null; let pulangId: string | null = null;
		if (src.fotoMasuk) { masukId = await uploadLaporanPhoto(src, 'gm', src.fotoMasuk, 'absensi-masuk.jpg'); if (!masukId) gagalFoto.push('foto grup masuk'); }
		if (src.fotoPulang) { pulangId = await uploadLaporanPhoto(src, 'gp', src.fotoPulang, 'absensi-pulang.jpg'); if (!pulangId) gagalFoto.push('foto grup pulang'); }
		// foto progres per PO → foto_urls di rincian PO yang bersangkutan (baris terisi pertama), bukan teks di catatan
		const fotoPerPo: Record<number, Array<{ stage: null; file_id: string }>> = {};
		for (const [poIdStr, blobs] of Object.entries(src.poFotos || {})) {
			for (let i = 0; i < blobs.length; i++) {
				const id = await uploadLaporanPhoto(src, `p${poIdStr}-${i}`, blobs[i], (blobs[i] as File).name || `progres-po-${poIdStr}.jpg`);
				if (id) (fotoPerPo[Number(poIdStr)] ||= []).push({ stage: null, file_id: id }); else gagalFoto.push(`foto PO #${poIdStr} ke-${i + 1}`);
			}
		}
		if (gagalFoto.length > 0) return { gagalFoto };
		const attached = new Set<number>();
		const poDetails = src.rows.map((d) => {
			const f = fotoPerPo[d.po_id];
			if (f && !attached.has(d.po_id) && (Number(d.volume_aktual) > 0 || (d.aktivitas || '').trim() || Number(d.sandblasting) > 0 || Number(d.primer) > 0 || Number(d.second) > 0 || Number(d.topcoat) > 0 || (d.kendala_po || '').trim())) {
				attached.add(d.po_id);
				return { ...d, foto_urls: f } as LaporanPoDetailInput;
			}
			return d;
		});
		const materials = (src.materials || []).filter((m) => m.nama_material.trim() && Number(m.qty) > 0);
		const res = await submitLaporanHarianWorkshop({
			ws: src.ws,
			client_txn_id: src.txn,
			tanggal: src.tanggal,
			cuaca: src.cuaca,
			jumlah_tenaga: src.jumlah_tenaga,
			kendala: src.kendala,
			catatan: src.catatan,
			dibuat_oleh: src.dibuat_oleh,
			fotoIds,
			fotoAbsensiMasukId: masukId,
			fotoAbsensiPulangId: pulangId,
			...(src.absensi && src.absensi.length > 0 ? { absensi: src.absensi } : {}),
			...(materials.length > 0 ? { materials } : {}),
			po_details: poDetails
		});
		return { gagalFoto, res };
	}

	/** Replay 1 laporan harian dari antrian offline — logic identik jalur online (kirimLaporan). */
	async function sendQueuedLaporanHarian(entry: QueuedLaporanHarianSubmission) {
		// Entri antrian lama tanpa `ws` (WSK-12): tentukan dari workshop PO-nya — bukan otomatis Ciketing. Gagal → entri tetap di antrian.
		const entryWs = entry.ws ?? (await resolveWorkshopForProjects(entry.po_details.map((d) => d.po_id)));
		const { gagalFoto, res } = await kirimLaporan({
			ws: entryWs, txn: entry.client_txn_id, tanggal: entry.tanggal, cuaca: entry.cuaca, jumlah_tenaga: entry.jumlah_tenaga,
			kendala: entry.kendala, catatan: entry.catatan, dibuat_oleh: entry.dibuat_oleh || undefined,
			rows: entry.po_details, fotoUmum: entry.fotoBlobs, absensi: entry.absensi as any, materials: entry.materials as any,
			fotoMasuk: entry.fotoAbsensiMasukBlob, fotoPulang: entry.fotoAbsensiPulangBlob, poFotos: entry.poFotoBlobs, compress: false
		});
		// Error biasa (BUKAN PermanentQueueError): entri tetap di antrian — jangan sampai laporan + foto terhapus karena satu foto bermasalah.
		if (gagalFoto.length > 0) throw new Error(`Foto gagal diunggah (${gagalFoto.join(', ')}) — laporan tertunda ditahan, periksa ukuran/format foto.`);
		if (!res?.success) throw new Error(res?.error || 'Gagal mengirim ulang laporan harian');
	}

	async function saveLaporanHarian() {
		// Validasi lunak sebelum kirim (selaras form admin): material wajib diisi atau dicentang "tidak ada".
		if (!tidakAdaMaterial && materialRows.filter((m) => m.nama_material.trim() && Number(m.qty) > 0).length === 0) {
			showToast('Isi minimal 1 material terpakai, atau centang “Tidak ada pemakaian material hari ini”.', 'err');
			return;
		}
		savingLaporan = true;
		const absensiPayload = useAbsensi ? toSubmitRows(absensiRows, reportedPos.map((p) => p.id)) : undefined;
		const src: LaporanSource = {
			ws: wsKey, txn: laporanTxnId, tanggal: laporanTanggal, cuaca: laporanCuaca, jumlah_tenaga: laporanJumlahTenaga,
			kendala: laporanKendala, catatan: laporanCatatan, dibuat_oleh: $authStore.karyawanName || undefined,
			rows: laporanRows, fotoUmum: laporanFotos, absensi: absensiPayload, materials: tidakAdaMaterial ? [] : materialRows,
			fotoMasuk: fotoGrupMasuk, fotoPulang: fotoGrupPulang, poFotos, compress: true
		};
		try {
			// WSK-13 §4c: kompres dulu (hemat kuota, cegah gagal karena ukuran); SATU foto gagal = simpan dibatalkan dengan nama file.
			const { gagalFoto, res } = await kirimLaporan(src);
			if (gagalFoto.length > 0) {
				showToast(`${gagalFoto.length} foto gagal diunggah (${gagalFoto.join(', ')}). Coba lagi atau hapus foto itu — laporan BELUM tersimpan.`, 'err');
				return;
			}
			if (res?.success) {
				// sukses = header + SEMUA anak tersimpan (WSK-13 §4b); draf baru dihapus di sini
				clearDraft(laporanTanggal);
				showToast(res.alreadyProcessed ? 'Laporan ini sudah tersimpan sebelumnya — tidak dibuat dobel.' : 'Laporan harian tersimpan. Muncul di Pusat Order admin dalam ±1 menit.');
				showLaporanForm = false;
				laporanFotos = []; fotoGrupMasuk = null; fotoGrupPulang = null; poFotos = {};
				laporanTxnId = crypto.randomUUID();
			} else {
				// draf TIDAK dihapus; isian & foto tetap di layar supaya bisa Simpan lagi
				showToast(res?.error || 'Gagal menyimpan laporan', 'err');
			}
		} catch (err: any) {
			if (err instanceof TypeError) {
				// Rekomendasi Tambahan Lapangan #3 (Offline Mode Enhancement) — tidak ada
				// sinyal sama sekali (fetch gagal total, bukan error dari server). Simpan ke
				// antrian lokal (dgn foto sbg Blob) untuk dikirim ulang otomatis saat online.
				try {
					await enqueueLaporanHarianSubmission({
						ws: wsKey,
						client_txn_id: laporanTxnId,
						tanggal: laporanTanggal,
						cuaca: laporanCuaca,
						jumlah_tenaga: laporanJumlahTenaga,
						kendala: laporanKendala,
						catatan: laporanCatatan,
						dibuat_oleh: $authStore.karyawanName || null,
						po_details: laporanRows as LaporanPoDetailInput[],
						fotoBlobs: laporanFotos,
						...(absensiPayload ? { absensi: absensiPayload } : {}),
						materials: tidakAdaMaterial ? [] : materialRows.filter((m) => m.nama_material.trim() && Number(m.qty) > 0),
						fotoAbsensiMasukBlob: fotoGrupMasuk,
						fotoAbsensiPulangBlob: fotoGrupPulang,
						poFotoBlobs: poFotos,
						createdAt: new Date().toISOString()
					});
					clearDraft(laporanTanggal);
					laporanTxnId = crypto.randomUUID();
					await refreshPendingCounts();
					showToast('Tidak ada sinyal — laporan disimpan di HP, akan terkirim otomatis saat online.');
					showLaporanForm = false;
					laporanFotos = []; fotoGrupMasuk = null; fotoGrupPulang = null; poFotos = {};
				} catch (queueErr: any) {
					showToast('Tidak ada sinyal dan gagal menyimpan offline: ' + (queueErr?.message || ''), 'err');
				}
			} else {
				showToast(err?.message || 'Gagal menyimpan laporan', 'err');
			}
		} finally {
			savingLaporan = false;
		}
	}

	// ─── Kartu ② Terima Barang Customer ─────────────────────────────────────
	let showTerimaForm = $state(false);
	let terimaProjectId = $state<number | null>(null);
	let terimaNoSj = $state('');
	let terimaTanggal = $state(todayWib());
	let terimaNamaBarang = $state('');
	let terimaQty = $state(0);
	let terimaSatuan = $state('');
	let terimaLuasan = $state(0);
	let terimaFotoSj = $state<File | null>(null);
	let terimaFotoBarang = $state<File | null>(null);
	// Rekomendasi Tambahan Lapangan #1 (Checklist Penerimaan Barang) — kondisi fisik
	// barang wajib dipilih; foto barang jadi wajib juga bila bukan "utuh".
	let terimaKondisiBarang = $state<KondisiBarang | ''>('');
	let savingTerima = $state(false);

	let terimaSatuanIsM2 = $derived(['m2', 'm²'].some((h) => terimaSatuan.toLowerCase().replace('²', '2').includes(h)));
	const KONDISI_OPTIONS: [KondisiBarang, string][] = [
		['utuh', 'Utuh / Baik'],
		['cacat', 'Cacat / Rusak'],
		['berkarat', 'Berkarat'],
		['lainnya', 'Lainnya (jelaskan via foto)']
	];

	function openTerimaForm() {
		terimaProjectId = orders[0]?.projectId ?? null;
		terimaKondisiBarang = '';
		showTerimaForm = true;
	}

	// Rekomendasi Tambahan Lapangan #5 (alternatif Scan QR) — QR resmi EPI:SO:<id>
	// (dicetak Sales di /sales/po-verify) untuk auto-pilih PO, mengurangi cari manual
	// di dropdown saat PO customer banyak. TIDAK bisa membaca dokumen SJ fisik customer
	// (bukan format QR EPI) — lihat catatan di qrParse.ts.
	let showQrScanner = $state(false);
	function handlePoQrDetected(raw: string) {
		showQrScanner = false;
		const parsed = parseEpiQr(raw);
		if (!parsed || parsed.type !== 'SO') {
			showToast('QR tidak dikenali sebagai QR PO/SO EPI.', 'err');
			return;
		}
		const match = orders.find((o) => o.soCustomerId === Number(parsed.id));
		if (!match) {
			showToast('PO untuk SO ini tidak ditemukan di Papan Order Anda.', 'err');
			return;
		}
		terimaProjectId = match.projectId;
		showToast(`PO ${match.nomorPo} dipilih dari QR.`);
	}

	/** Replay 1 SJ Masuk dari antrian offline — logic identik jalur online. */
	async function sendQueuedTerimaBarang(entry: QueuedTerimaBarangSubmission) {
		const fotoSjId = await uploadWorkshopPhoto(entry.blobs.fotoSj, 'foto-sj.jpg');
		if (!fotoSjId) throw new Error('Gagal mengunggah foto SJ saat kirim ulang.');
		const fotoBarangId = entry.blobs.fotoBarang
			? await uploadWorkshopPhoto(entry.blobs.fotoBarang, 'foto-barang.jpg')
			: null;
		// Entri antrian lama tanpa `ws` (WSK-12): tentukan dari workshop PO-nya.
		const entryWs = entry.ws ?? (await resolveWorkshopForProjects([entry.projectId]));
		const res = await submitTerimaBarangLapangan({
			ws: entryWs,
			projectId: entry.projectId,
			no_sj: entry.no_sj,
			tanggal: entry.tanggal,
			nama_barang: entry.nama_barang,
			qty: entry.qty,
			satuan: entry.satuan,
			luasan_m2: entry.luasan_m2,
			fotoSjId,
			fotoBarangId,
			pic: entry.pic || undefined,
			kondisi_barang: entry.kondisi_barang
		});
		if (!res.success) throw new Error(res.error || 'Gagal mengirim ulang SJ Masuk');
	}

	async function saveTerimaBarang() {
		const validationError = validateTerimaBarangInput({
			projectId: Number(terimaProjectId),
			no_sj: terimaNoSj,
			satuan: terimaSatuan,
			luasan_m2: terimaLuasan,
			kondisi_barang: terimaKondisiBarang as KondisiBarang,
			hasFotoSj: !!terimaFotoSj,
			hasFotoBarang: !!terimaFotoBarang
		});
		if (validationError) { showToast(validationError, 'err'); return; }

		savingTerima = true;
		try {
			const fotoSjId = await uploadWorkshopPhoto(terimaFotoSj as File, (terimaFotoSj as File).name);
			const fotoBarangId = terimaFotoBarang ? await uploadWorkshopPhoto(terimaFotoBarang, terimaFotoBarang.name) : null;
			if (!fotoSjId) { showToast('Gagal mengunggah foto SJ', 'err'); savingTerima = false; return; }
			const res = await submitTerimaBarangLapangan({
				ws: wsKey,
				projectId: Number(terimaProjectId),
				no_sj: terimaNoSj,
				tanggal: terimaTanggal,
				nama_barang: terimaNamaBarang,
				qty: terimaQty,
				satuan: terimaSatuan,
				luasan_m2: terimaLuasan,
				fotoSjId,
				fotoBarangId,
				pic: $authStore.karyawanName || undefined,
				kondisi_barang: terimaKondisiBarang as KondisiBarang
			});
			if (res.success) {
				showToast('SJ Masuk dicatat. Muncul di Pusat Order admin dalam ±1 menit.');
				showTerimaForm = false;
				terimaNoSj = ''; terimaNamaBarang = ''; terimaQty = 0; terimaSatuan = ''; terimaLuasan = 0;
				terimaFotoSj = null; terimaFotoBarang = null; terimaKondisiBarang = '';
			} else {
				showToast(res.error || 'Gagal menyimpan SJ Masuk', 'err');
			}
		} catch (err: any) {
			if (err instanceof TypeError) {
				// Rekomendasi Tambahan Lapangan #3 (Offline Mode Enhancement) — tidak ada sinyal
				// sama sekali. Simpan foto sbg Blob mentah ke antrian lokal, kirim ulang otomatis
				// saat online (registerTerimaBarangAutoFlush di onMount).
				try {
					await enqueueTerimaBarangSubmission({
						ws: wsKey,
						client_txn_id: crypto.randomUUID(),
						projectId: Number(terimaProjectId),
						no_sj: terimaNoSj,
						tanggal: terimaTanggal,
						nama_barang: terimaNamaBarang,
						qty: terimaQty,
						satuan: terimaSatuan,
						luasan_m2: terimaLuasan,
						kondisi_barang: terimaKondisiBarang as KondisiBarang,
						pic: $authStore.karyawanName || null,
						blobs: {
							fotoSj: terimaFotoSj as File,
							fotoBarang: terimaFotoBarang || undefined
						},
						createdAt: new Date().toISOString()
					});
					await refreshPendingCounts();
					showToast('Tidak ada sinyal — SJ Masuk disimpan di HP, akan terkirim otomatis saat online.');
					showTerimaForm = false;
					terimaNoSj = ''; terimaNamaBarang = ''; terimaQty = 0; terimaSatuan = ''; terimaLuasan = 0;
					terimaFotoSj = null; terimaFotoBarang = null; terimaKondisiBarang = '';
				} catch (queueErr: any) {
					showToast('Tidak ada sinyal dan gagal menyimpan offline: ' + (queueErr?.message || ''), 'err');
				}
			} else {
				showToast(err?.message || 'Gagal menyimpan SJ Masuk', 'err');
			}
		} finally {
			savingTerima = false;
		}
	}

	// ─── Kartu ③ Quick Report via Kamera (Rekomendasi Tambahan Lapangan #2) ────
	// Shortcut cepat: pilih PO -> foto -> catatan singkat -> kirim. TIDAK ada
	// validasi jumlah orang/tenaga (pelengkap laporan lengkap, bukan pengganti).
	let showQuickReport = $state(false);
	let quickProjectId = $state<number | null>(null);
	let quickAktivitas = $state('');
	let quickFotos = $state<File[]>([]);
	let savingQuick = $state(false);
	// WSK-13: id transaksi tetap selama form terbuka → ketuk ulang / timeout tidak membuat quick report dobel
	let quickTxnId = $state('');

	function openQuickReport() {
		quickProjectId = orders[0]?.projectId ?? null;
		quickAktivitas = '';
		quickFotos = [];
		quickTxnId = crypto.randomUUID();
		showQuickReport = true;
	}

	async function saveQuickReport() {
		if (!quickProjectId) { showToast('Pilih PO terlebih dahulu', 'err'); return; }
		if (quickFotos.length === 0) { showToast('Ambil foto minimal 1', 'err'); return; }
		savingQuick = true;
		try {
			const fotoIds: string[] = [];
			for (const f of quickFotos) {
				const id = await uploadWorkshopPhoto(f, f.name);
				if (id) fotoIds.push(id);
			}
			if (fotoIds.length === 0) { showToast('Gagal mengunggah foto', 'err'); savingQuick = false; return; }
			const res = await submitQuickFieldReport({
				ws: wsKey,
				projectId: quickProjectId,
				aktivitas: quickAktivitas,
				fotoIds,
				client_txn_id: quickTxnId || undefined
			});
			if (res.success) {
				showToast(res.alreadyProcessed ? 'Quick report ini sudah terkirim sebelumnya — tidak dibuat dobel.' : 'Quick report terkirim.');
				showQuickReport = false;
				quickAktivitas = ''; quickFotos = [];
			} else {
				showToast(res.error || 'Gagal mengirim quick report', 'err');
			}
		} catch (err: any) {
			showToast(err instanceof TypeError ? 'Tidak ada sinyal — coba lagi saat online.' : (err?.message || 'Gagal mengirim quick report'), 'err');
		} finally {
			savingQuick = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<div class="mb-4">
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Workshop Ops — {P.label}</h1>
		<p class="text-[11px]" style="color: var(--sys-label3)">
			Isi laporan harian & terima barang langsung dari lapangan — data ini yang dipakai Pusat Order admin.
		</p>
		<!-- Fase 7c — pemilih workshop. Pilihan diingat di HP; PO, form, dan draf selalu mengikuti workshop terpilih. -->
		<div class="mt-3 inline-flex rounded-xl p-0.5 text-[11px] font-bold" style="background: var(--sys-fill)" role="tablist" aria-label="Pilih workshop">
			{#each Object.values(WORKSHOP_OPS) as w (w.key)}
				<button
					type="button"
					role="tab"
					aria-selected={wsKey === w.key}
					onclick={() => switchWorkshop(w.key)}
					class="px-3.5 py-1.5 rounded-[10px] transition-colors"
					style={wsKey === w.key ? 'background: white; color: var(--sys-label); box-shadow: 0 1px 2px rgba(0,0,0,.12)' : 'color: var(--sys-label3)'}
				>
					{w.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Rekomendasi Tambahan Lapangan #3 (Offline Mode Enhancement) — antrian tertunda -->
	{#if pendingTerimaCount + pendingLaporanCount > 0}
		<div class="mb-4 p-3 rounded-xl flex items-center justify-between gap-2" style="background: #fffbeb; border: 1px solid #fde68a">
			<div class="flex flex-col">
				<DraftIndicator savedAt={null} isOffline={true} />
				<span class="text-[10px] mt-0.5" style="color: var(--sys-label3)">
					{pendingLaporanCount > 0 ? `${pendingLaporanCount} laporan harian` : ''}{pendingLaporanCount > 0 && pendingTerimaCount > 0 ? ' · ' : ''}{pendingTerimaCount > 0 ? `${pendingTerimaCount} SJ Masuk` : ''} menunggu sinkron — otomatis terkirim saat online.
				</span>
			</div>
			<button
				type="button"
				onclick={async () => {
					await Promise.all([
						flushTerimaBarangQueue(sendQueuedTerimaBarang),
						flushLaporanHarianQueue(sendQueuedLaporanHarian)
					]);
					await refreshPendingCounts();
					showToast('Sinkronisasi selesai.');
				}}
				class="text-[10px] font-bold px-2.5 py-1.5 rounded-lg shrink-0"
				style="background: #f59e0b; color: white"
			>
				Coba Sekarang
			</button>
		</div>
	{/if}

	<!-- Papan Order (read-only, tanpa Rupiah) -->
	<div class="mb-5">
		<h2 class="text-[13px] font-bold mb-2" style="color: var(--sys-label)">Papan Order Saya</h2>
		{#if loadingOrders}
			<div class="py-8 flex justify-center">
				<CircularProgressGauge size={64} strokeWidth={5} label="Memuat Papan Order..." sublabel="Sinkronisasi PO aktif workshop" />
			</div>
		{:else if ordersError}
			<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]" role="alert">
				<IconAlertTriangle size={16} class="shrink-0 mt-0.5" />
				<span class="flex-1">{ordersError}</span>
				<button type="button" class="shrink-0 px-2.5 py-1 rounded-lg border border-red-300 bg-white font-bold" onclick={loadOrders} title="Muat ulang Papan Order">Muat ulang</button>
			</div>
		{:else if orders.length === 0}
			<div class="p-4 rounded-xl border text-center text-[12px]" style="border-color: var(--sys-sep); color: var(--sys-label3)">
				Belum ada PO {P.label} aktif atas nama Anda.
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each orders as o (o.projectId)}
					{@const d = daysUntil(o.endDate)}
					{@const ws = wsStatusByProjectId[o.projectId]}
					<div class="p-3 rounded-xl border" style="border-color: var(--sys-sep)">
						<div class="flex items-center justify-between gap-2">
							<div class="min-w-0 flex-1">
								<div class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{o.nomorPo}{#if o.mine} <span class="ml-1 align-middle text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700" title="PO yang Anda pimpin / dampingi">PO saya</span>{/if}</div>
								<div class="text-[11px] truncate" style="color: var(--sys-label3)">
									{o.customerName} · {deadlineLabel(d)}
								</div>
							</div>
							<span class="text-[9px] font-bold px-2 py-1 rounded-full shrink-0 {STAGE_COLOR[o.stage] || 'bg-slate-100 text-slate-600'}">
								{o.stageLabel}
							</span>
							<button
								type="button"
								class="shrink-0 p-1.5 rounded-lg"
								style="background: var(--sys-fill)"
								title="Lihat foto progres before/after"
								onclick={() => goto(`/workshop/foto-progress/${o.projectId}?ws=${wsKey}`)}
							>
								📷
							</button>
							<button
								type="button"
								class="shrink-0 p-1.5 rounded-lg"
								style="background: var(--sys-fill)"
								title="Lihat status SPK/Tiket Kerja"
								onclick={() => goto(`/workshop/spk-status/${o.projectId}?ws=${wsKey}`)}
							>
								📋
							</button>
						</div>
						{#if ws?.found}
							<!-- §5 Rekomendasi #3 — progres fisik vs serapan biaya, TANPA rupiah -->
							<div class="flex items-center gap-1.5 mt-2 pt-2 border-t" style="border-color: var(--sys-sep)">
								{#if ws.evFlag === 'red'}🔴{:else if ws.evFlag === 'yellow'}🟡{:else if ws.evFlag === 'green'}🟢{/if}
								<span class="text-[11px] font-semibold" style="color: var(--sys-label2)">
									Progres {ws.progressPct ?? '—'}%
									{#if ws.serapanPct != null}· Serapan {ws.serapanPct}%{#if ws.manpowerEstimasi}<span style="color: var(--sys-label4)"> (est.)</span>{/if}{/if}
								</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- 4 Kartu -->
	<div class="grid grid-cols-2 gap-2.5">
		<button class="p-3.5 rounded-xl border text-left flex flex-col gap-1.5" style="border-color: var(--sys-sep)" onclick={openLaporanForm}>
			<IconClipboardList size={22} style="color: var(--p, var(--g))" />
			<span class="text-[12px] font-bold" style="color: var(--sys-label)">Laporan Harian Workshop</span>
			<span class="text-[10px]" style="color: var(--sys-label3)">Progres blasting/coating hari ini per PO</span>
		</button>
		<button class="p-3.5 rounded-xl border text-left flex flex-col gap-1.5" style="border-color: var(--sys-sep)" onclick={openTerimaForm} disabled={orders.length === 0}>
			<IconTruckDelivery size={22} style="color: var(--p, var(--g))" />
			<span class="text-[12px] font-bold" style="color: var(--sys-label)">Terima Barang Customer</span>
			<span class="text-[10px]" style="color: var(--sys-label3)">Catat SJ Masuk + foto</span>
		</button>
		<button class="p-3.5 rounded-xl border text-left flex flex-col gap-1.5" style="border-color: var(--sys-sep)" onclick={() => goto('/inspection')}>
			<IconClipboardCheck size={22} style="color: var(--p, var(--g))" />
			<span class="text-[12px] font-bold" style="color: var(--sys-label)">Inspeksi Coating</span>
			<span class="text-[10px]" style="color: var(--sys-label3)">Buka modul BPIR existing</span>
		</button>
		<button class="p-3.5 rounded-xl border text-left flex flex-col gap-1.5" style="border-color: var(--sys-sep)" onclick={() => goto('/scan')}>
			<IconQrcode size={22} style="color: var(--p, var(--g))" />
			<span class="text-[12px] font-bold" style="color: var(--sys-label)">Scan Rak / SJ</span>
			<span class="text-[10px]" style="color: var(--sys-label3)">Kamera QR — rak & SJ Keluar</span>
		</button>
		{#if P.hasOverstay}
		<button class="p-3.5 rounded-xl border text-left flex flex-col gap-1.5" style="border-color: var(--sys-sep)" onclick={() => goto('/workshop/overstay')}>
			<IconAlertTriangle size={22} style="color: var(--p, var(--g))" />
			<span class="text-[12px] font-bold" style="color: var(--sys-label)">Denda Overstay</span>
			<span class="text-[10px]" style="color: var(--sys-label3)">Konfirmasi barang sudah diambil</span>
		</button>
		{/if}
		{#if P.hasPoBayangan}
		<button class="p-3.5 rounded-xl border text-left flex flex-col gap-1.5" style="border-color: var(--sys-sep)" onclick={() => goto('/workshop/po-bayangan')}>
			<IconFileAlert size={22} style="color: var(--p, var(--g))" />
			<span class="text-[12px] font-bold" style="color: var(--sys-label)">Proyek Tanpa PO</span>
			<span class="text-[10px]" style="color: var(--sys-label3)">Status PO proyek Anda</span>
		</button>
		{/if}
		<button class="p-3.5 rounded-xl border text-left flex flex-col gap-1.5" style="border-color: var(--sys-sep)" onclick={() => goto(`/workshop/stok?ws=${wsKey}`)}>
			<IconPackages size={22} style="color: var(--p, var(--g))" />
			<span class="text-[12px] font-bold" style="color: var(--sys-label)">Cek Stok</span>
			<span class="text-[10px]" style="color: var(--sys-label3)">Stok material workshop saat ini</span>
		</button>
	</div>

	<p class="text-[10px] mt-4" style="color: var(--sys-label4)">
		Belum tersedia di kartu ini: prefill otomatis PO saat lompat ke Inspeksi/SJ Keluar (Fase berikutnya).
	</p>
</div>

<!-- Modal Laporan Harian -->
{#if showLaporanForm}
	<div class="fixed inset-0 z-50 flex flex-col bg-black/40" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) showLaporanForm = false; }}>
		<div class="mt-auto sm:m-auto sm:max-w-lg w-full bg-white rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto p-4">
			<div class="flex items-center justify-between mb-1">
				<h3 class="text-[14px] font-bold">Laporan Harian — {P.label}</h3>
				<button onclick={() => (showLaporanForm = false)}><IconX size={20} /></button>
			</div>
			<p class="text-[10px] mb-3" style="color: var(--sys-label4)">💾 Diketik otomatis tersimpan sebagai draf di HP ini — aman kalau sinyal putus atau app tertutup tak sengaja.</p>

			<div class="grid grid-cols-2 gap-2 mb-2">
				<div>
					<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">Tanggal</label>
					<input type="date" bind:value={laporanTanggal} class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)" />
					{#if shiftPagiWib()}<p class="text-[10px] mt-0.5" style="color: var(--sys-label3)">Shift malam/pagi? Pastikan tanggal laporan sudah benar.</p>{/if}
				</div>
				<div>
					<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">Cuaca</label>
					<select bind:value={laporanCuaca} class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)">
						{#each CUACA_OPTIONS as [val, label]}<option value={val}>{label}</option>{/each}
					</select>
				</div>
			</div>

			<div class="mb-3">
				<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">Jumlah Tenaga Hari Ini</label>
				<input type="number" min="0" bind:value={laporanJumlahTenaga} disabled={useAbsensi} class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px] disabled:bg-slate-100" style="border-color: var(--sys-sep)" />
				{#if useAbsensi}
					<p class="text-[10px] mt-0.5 text-emerald-600">Otomatis = jumlah yang Hadir di “Kehadiran Tim” (di bawah).</p>
				{:else}
					<p class="text-[10px] mt-0.5 {sumOrangLaporan === laporanJumlahTenaga ? 'text-emerald-600' : 'text-amber-600'}">
						Total orang per PO saat ini: {sumOrangLaporan} {sumOrangLaporan === laporanJumlahTenaga ? '✓ cocok' : '— harus sama dengan Jumlah Tenaga'}
					</p>
				{/if}
			</div>

			<div class="mb-3 space-y-3">
				<div class="flex items-center justify-between">
					<label class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label2)">
						Pekerjaan per PO Workshop
					</label>
					<span class="text-[10px]" style="color: var(--sys-label4)">Isi yang dikerjakan hari ini</span>
				</div>

				{#if loadingLaporanData}
					<div class="py-8 flex justify-center">
						<CircularProgressGauge size={64} strokeWidth={5} label="Memuat Subtask Timeline..." sublabel="Sinkronisasi timeline proyek" />
					</div>
				{:else if orders.length === 0}
					<div class="py-4 text-center text-xs text-slate-400 border rounded-lg" style="border-color: var(--sys-sep)">
						Belum ada PO aktif untuk dilaporkan.
					</div>
				{:else}
					{#each orders as po (po.projectId)}
						{@const poRows = laporanRows.filter((r) => r.po_id === po.projectId)}
						{@const poManpower = getPoManpower(po.projectId)}
						{@const poSjOptions = sjOptionsByProjectId[po.projectId] || []}
						{@const poSjId = getPoSjId(po.projectId)}
						{@const hasSubtasks = poRows.some((r) => r.subtask_id && !r.subtask_id.startsWith('item_') && !r.subtask_id.startsWith('proj_'))}

						<div class="p-3 rounded-xl border bg-slate-50/60 dark:bg-slate-900/60 space-y-2.5" style="border-color: var(--sys-sep)">
							<!-- Header PO Card -->
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0 flex-1">
									<div class="text-[13px] font-bold text-slate-900 dark:text-slate-100 truncate">
										{po.nomorPo}
									</div>
									<div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
										{po.customerName}
									</div>
								</div>
								<div class="flex items-center gap-1 shrink-0">
									{#if hasSubtasks}
										<span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
											🏭 {poRows.length} Subtask
										</span>
									{:else}
										<span class="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
											📦 {poRows.length} Item
										</span>
									{/if}
								</div>
							</div>

							<!-- Tenaga Kerja di PO Ini -->
							<div class="flex items-center justify-between bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
								<div class="flex flex-col">
									<span class="text-[10px] font-bold uppercase text-slate-700 dark:text-slate-200">
										Orang di PO Ini <span class="text-red-500">*</span>
									</span>
									<span class="text-[9px] text-slate-400">{useAbsensi ? 'Otomatis dari alokasi di “Kehadiran Tim”' : 'Total orang yang aktif di PO ini hari ini'}</span>
								</div>
								<div class="flex items-center gap-1">
									<input
										type="number"
										min="0"
										step="1"
										value={poManpower}
										disabled={useAbsensi}
										oninput={(e) => setPoManpower(po.projectId, Number((e.target as HTMLInputElement).value))}
										class="w-16 px-1.5 py-1 text-center font-black text-xs border rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
										style="border-color: var(--sys-sep)"
										placeholder="0"
									/>
									<span class="text-[11px] text-slate-500 font-medium">Org</span>
								</div>
							</div>

							<!-- Fase 4 Link SJ (Audit Timeline Ciketing) — opsional, hanya tampil bila ada SJ Masuk
							     90 hari terakhir untuk PO ini. Membantu admin telusuri material dari SJ mana. -->
							{#if poSjOptions.length > 0}
								<div class="flex items-center justify-between bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
									<div class="flex flex-col min-w-0">
										<span class="text-[10px] font-bold uppercase text-slate-700 dark:text-slate-200">
											SJ Terkait <span class="text-slate-400 font-normal normal-case">(opsional)</span>
										</span>
										<span class="text-[9px] text-slate-400">Pilih Surat Jalan Masuk yang jadi dasar pekerjaan hari ini, kalau ada</span>
									</div>
									<select
										value={poSjId ?? ''}
										onchange={(e) => setPoSjId(po.projectId, (e.target as HTMLSelectElement).value ? Number((e.target as HTMLSelectElement).value) : null)}
										class="max-w-[140px] px-1.5 py-1 text-[10px] border rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white shrink-0"
										style="border-color: var(--sys-sep)"
									>
										<option value="">— Tidak dipilih —</option>
										{#each poSjOptions as opt (opt.id)}
											<option value={opt.id}>{opt.label}</option>
										{/each}
									</select>
								</div>
							{/if}

							<!-- Subtasks List -->
							<div class="space-y-2">
								{#each poRows as row (row.subtask_id || row.so_detail_id || row.po_id)}
									{@const target = row.target_volume}
									{@const isDone = target > 0 && row.accum_volume >= target}

									<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2">
										<!-- Subtask Info & Target -->
										<div class="flex items-start justify-between gap-2">
											<div class="min-w-0 flex-1">
												{#if row.category_name}
													<span class="text-[9px] font-bold text-slate-400 uppercase tracking-wide block">
														{row.category_name}
													</span>
												{/if}
												<div class="text-[12px] font-bold text-slate-800 dark:text-slate-200 leading-snug">
													{row.subtask_name}
												</div>
											</div>
											<div class="text-right shrink-0">
												<div class="text-[11px] font-black text-slate-800 dark:text-slate-200">
													{target} {row.satuan}
												</div>
												<div class="text-[9px] text-slate-400">
													Sdh: {row.accum_volume} · Sisa: <b class="text-amber-600 dark:text-amber-400">{row.sisa_volume}</b>
												</div>
											</div>
										</div>

										<!-- Input Realisasi & Shortcut -->
										<div class="flex items-center gap-2 pt-1 border-t border-dashed border-slate-100 dark:border-slate-700">
											<div class="flex-1 flex items-center gap-1.5">
												<label class="text-[10px] font-bold text-slate-500 shrink-0">Hari ini:</label>
												<input
													type="number"
													min="0"
													step="any"
													bind:value={row.volume_aktual}
													oninput={() => updateSubtaskRow(row)}
													class="w-20 px-1.5 py-1 text-center font-black text-xs border rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
													style="border-color: var(--sys-sep)"
													placeholder="0"
												/>
												<span class="text-[10px] text-slate-400 font-semibold">{row.satuan}</span>
											</div>

											<div class="flex items-center gap-1">
												{#if row.sisa_volume > 0}
													<button
														type="button"
														onclick={() => fillRemaining(row)}
														class="text-[9px] font-bold px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
														title="Isi sisa target ({row.sisa_volume} {row.satuan})"
													>
														Sisa ({row.sisa_volume})
													</button>
												{/if}
												<button
													type="button"
													onclick={() => fillComplete(row)}
													class="text-[9px] font-medium px-2 py-1 rounded bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 transition-colors"
												>
													100%
												</button>
											</div>
										</div>

										<!-- Progres Bar Mini -->
										<div class="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
											<div class="flex items-center gap-1">
												{#if row.progress_hari_ini > 0}
													<span class="font-black text-blue-600 dark:text-blue-400">+{row.progress_hari_ini}%</span>
												{/if}
												<span class="font-bold">{row.total_progress_percentage}% total</span>
											</div>
											<div class="w-24 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
												<div
													class="h-full bg-emerald-500 rounded-full transition-all"
													style="width: {Math.min(row.total_progress_percentage, 100)}%"
												></div>
											</div>
										</div>

										<!-- Catatan Aktivitas Subtask -->
										<input
											type="text"
											placeholder="Catatan pengerjaan subtask ini (opsional)..."
											bind:value={row.aktivitas}
											class="w-full px-2 py-1 text-[11px] border rounded bg-slate-50/50 dark:bg-slate-900/50"
											style="border-color: var(--sys-sep)"
										/>
									</div>
								{/each}

								<!-- Tombol Tambah Subtask Lapangan -->
								<button
									type="button"
									onclick={() => addCustomSubtask(po.projectId)}
									class="w-full py-1.5 text-center text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-lg border border-dashed border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1"
								>
									<IconPlus size={13} />
									<span>Tambah Subtask Tambahan Lapangan</span>
								</button>
							</div>

							<!-- Kendala PO -->
							{#if poRows.length > 0}
								<div>
									<input
										type="text"
										placeholder="Kendala khusus PO ini (opsional)..."
										bind:value={poRows[0].kendala_po}
										class="w-full px-2 py-1.5 border rounded-lg text-[11px] bg-white dark:bg-slate-900"
										style="border-color: var(--sys-sep)"
									/>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>

			{#if useAbsensi}
				<LaporanKehadiranMaterial bind:rows={absensiRows} bind:materials={materialRows} bind:tidakAdaMaterial bind:fotoMasuk={fotoGrupMasuk} bind:fotoPulang={fotoGrupPulang} bind:poFotos {reportedPos} suggestions={materialSuggestions} />
			{/if}

			<div class="mb-3">
				<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">Kendala Umum (opsional)</label>
				<textarea bind:value={laporanKendala} rows="2" class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)"></textarea>
			</div>
			<div class="mb-3">
				<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">Catatan (opsional)</label>
				<textarea bind:value={laporanCatatan} rows="2" class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)"></textarea>
			</div>
			<div class="mb-4">
				<label class="text-[10px] font-bold uppercase block mb-1" style="color: var(--sys-label3)">Foto Umum (opsional)</label>
				<input type="file" accept="image/*" capture="environment" multiple onchange={(e: any) => (laporanFotos = Array.from(e.target.files || []))} class="text-[12px]" />
			</div>

			<button onclick={saveLaporanHarian} disabled={savingLaporan} class="w-full py-3 rounded-xl text-white font-bold text-[13px] flex items-center justify-center gap-2" style="background: var(--p, var(--g))">
				{#if savingLaporan}<IconLoader2 size={16} class="animate-spin" />{:else}<IconCheck size={16} />{/if}
				Simpan ke {P.label}
			</button>
		</div>
	</div>
{/if}

<!-- Modal Terima Barang -->
{#if showTerimaForm}
	<div class="fixed inset-0 z-50 flex flex-col bg-black/40" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) showTerimaForm = false; }}>
		<div class="mt-auto sm:m-auto sm:max-w-md w-full bg-white rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto p-4">
			<div class="flex items-center justify-between mb-3">
				<h3 class="text-[14px] font-bold">Terima Barang Customer</h3>
				<button onclick={() => (showTerimaForm = false)}><IconX size={20} /></button>
			</div>

			<div class="mb-2">
				<div class="flex items-center justify-between mb-0.5">
					<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">PO</label>
					<button
						type="button"
						onclick={() => (showQrScanner = true)}
						class="text-[10px] font-bold flex items-center gap-1 px-2 py-0.5 rounded-full"
						style="background: var(--sys-fill2, #f1f5f9); color: var(--p, var(--g))"
						title="Scan QR PO (bila Sales sudah cetak label QR untuk PO ini)"
					>
						<IconQrcode size={12} /> Scan QR PO
					</button>
				</div>
				<select bind:value={terimaProjectId} class="w-full px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)">
					{#each orders as o}<option value={o.projectId}>{o.nomorPo} — {o.customerName}</option>{/each}
				</select>
			</div>
			<div class="grid grid-cols-2 gap-2 mb-2">
				<div>
					<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">No. SJ</label>
					<input type="text" bind:value={terimaNoSj} class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)" />
				</div>
				<div>
					<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">Tanggal</label>
					<input type="date" bind:value={terimaTanggal} class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)" />
				</div>
			</div>
			<div class="mb-2">
				<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">Nama Barang</label>
				<input type="text" bind:value={terimaNamaBarang} class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)" />
			</div>
			<div class="grid grid-cols-3 gap-2 mb-1">
				<div>
					<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">Qty</label>
					<input type="number" min="0" bind:value={terimaQty} class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)" />
				</div>
				<div>
					<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">Satuan</label>
					<input type="text" placeholder="pcs / m2" bind:value={terimaSatuan} class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)" />
				</div>
				<div>
					<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">Luasan m²{terimaSatuanIsM2 ? ' *' : ''}</label>
					<input type="number" min="0" step="0.01" bind:value={terimaLuasan} class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: {terimaSatuanIsM2 && !terimaLuasan ? '#f59e0b' : 'var(--sys-sep)'}" />
				</div>
			</div>
			{#if terimaSatuanIsM2 && !terimaLuasan}
				<p class="text-[10px] text-amber-600 mb-2">* Wajib diisi karena satuan m²</p>
			{/if}

			<!-- Rekomendasi Tambahan Lapangan #1: Checklist Penerimaan Barang -->
			<div class="mb-2">
				<label class="text-[10px] font-bold uppercase block mb-1" style="color: var(--sys-label3)">Kondisi Barang (wajib)</label>
				<div class="grid grid-cols-2 gap-1.5">
					{#each KONDISI_OPTIONS as [val, label]}
						<button
							type="button"
							onclick={() => (terimaKondisiBarang = val)}
							class="px-2 py-2 rounded-lg text-[11px] font-semibold border text-left {terimaKondisiBarang === val ? 'text-white' : ''}"
							style={terimaKondisiBarang === val
								? `background: ${val === 'utuh' ? '#059669' : '#dc2626'}; border-color: ${val === 'utuh' ? '#059669' : '#dc2626'}`
								: 'border-color: var(--sys-sep)'}
						>
							{label}
						</button>
					{/each}
				</div>
				{#if !terimaKondisiBarang}
					<p class="text-[10px] text-amber-600 mt-1">* Pilih kondisi fisik barang saat diterima</p>
				{/if}
			</div>

			<div class="mb-2">
				<label class="text-[10px] font-bold uppercase block mb-1" style="color: var(--sys-label3)">Foto SJ (wajib)</label>
				<input type="file" accept="image/*" capture="environment" onchange={(e: any) => (terimaFotoSj = e.target.files?.[0] || null)} class="text-[12px]" />
			</div>
			<div class="mb-4">
				<label class="text-[10px] font-bold uppercase block mb-1" style="color: var(--sys-label3)">
					Foto Barang {terimaKondisiBarang && terimaKondisiBarang !== 'utuh' ? '(wajib — bukti kondisi)' : '(opsional)'}
				</label>
				<input type="file" accept="image/*" capture="environment" onchange={(e: any) => (terimaFotoBarang = e.target.files?.[0] || null)} class="text-[12px]" />
				{#if terimaKondisiBarang && terimaKondisiBarang !== 'utuh' && !terimaFotoBarang}
					<p class="text-[10px] text-amber-600 mt-1">* Wajib diisi sbg bukti klaim kerusakan/karat</p>
				{/if}
			</div>

			<button onclick={saveTerimaBarang} disabled={savingTerima} class="w-full py-3 rounded-xl text-white font-bold text-[13px] flex items-center justify-center gap-2" style="background: var(--p, var(--g))">
				{#if savingTerima}<IconLoader2 size={16} class="animate-spin" />{:else}<IconCamera size={16} />{/if}
				Simpan SJ Masuk
			</button>
		</div>
	</div>
{/if}

<!-- Scanner QR PO (Rekomendasi Tambahan Lapangan #5) -->
{#if showQrScanner}
	<QrCameraScanner
		expectedPrefix="EPI:SO:"
		onDetect={handlePoQrDetected}
		onClose={() => (showQrScanner = false)}
	/>
{/if}

<!-- FAB Quick Report (Rekomendasi Tambahan Lapangan #2) -->
{#if orders.length > 0 && !showLaporanForm && !showTerimaForm && !showQuickReport}
	<button
		type="button"
		onclick={openQuickReport}
		class="fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white"
		style="background: var(--p, var(--g))"
		title="Quick Report — foto cepat tanpa isi form lengkap"
	>
		<IconCamera size={24} />
	</button>
{/if}

<!-- Modal Quick Report -->
{#if showQuickReport}
	<div class="fixed inset-0 z-50 flex flex-col bg-black/40" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) showQuickReport = false; }}>
		<div class="mt-auto sm:m-auto sm:max-w-sm w-full bg-white rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto p-4">
			<div class="flex items-center justify-between mb-1">
				<h3 class="text-[14px] font-bold">Quick Report</h3>
				<button onclick={() => (showQuickReport = false)}><IconX size={20} /></button>
			</div>
			<p class="text-[10px] mb-3" style="color: var(--sys-label4)">Pelengkap cepat — bukan pengganti Laporan Harian lengkap. Tidak perlu isi jumlah orang.</p>

			<div class="mb-2">
				<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">PO</label>
				<select bind:value={quickProjectId} class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)">
					{#each orders as o}<option value={o.projectId}>{o.nomorPo} — {o.customerName}</option>{/each}
				</select>
			</div>
			<div class="mb-2">
				<label class="text-[10px] font-bold uppercase" style="color: var(--sys-label3)">Catatan Singkat (opsional)</label>
				<input type="text" bind:value={quickAktivitas} placeholder="Sedang blasting sisi kiri..." class="w-full mt-0.5 px-2 py-2 border rounded-lg text-[13px]" style="border-color: var(--sys-sep)" />
			</div>
			<div class="mb-4">
				<label class="text-[10px] font-bold uppercase block mb-1" style="color: var(--sys-label3)">Foto (wajib min. 1)</label>
				<input type="file" accept="image/*" capture="environment" multiple onchange={(e: any) => (quickFotos = Array.from(e.target.files || []))} class="text-[12px]" />
				{#if quickFotos.length > 0}
					<p class="text-[10px] mt-1 text-emerald-600">{quickFotos.length} foto dipilih</p>
				{/if}
			</div>

			<button onclick={saveQuickReport} disabled={savingQuick} class="w-full py-3 rounded-xl text-white font-bold text-[13px] flex items-center justify-center gap-2" style="background: var(--p, var(--g))">
				{#if savingQuick}<IconLoader2 size={16} class="animate-spin" />{:else}<IconCamera size={16} />{/if}
				Kirim Quick Report
			</button>
		</div>
	</div>
{/if}

{#if toastMsg}
	<div class="fixed bottom-4 left-4 right-4 z-[60] p-3 rounded-xl text-[12px] font-semibold text-center {toastType === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}">
		{toastMsg}
	</div>
{/if}
