<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getItemsForPicker,
		submitPenerimaan,
		uploadEvidencePhoto,
		suggestLotNumber,
		fetchGudangList,
		getProjectGudangId,
		type StockItemOption,
		type GudangOption
	} from '$lib/services/stockLapangan';
	import { getCurrentPosition, type DevicePosition } from '$lib/utils/geoClient';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { enqueueStockSubmission, registerStockAutoFlush, flushStockQueue } from '$lib/utils/offlineStockQueue';
	import { enqueueGRSubmission, registerGRAutoFlush, flushGRQueue, type QueuedGRSubmission } from '$lib/utils/offlineGRQueue';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import { SectionGuide, FieldHint, HelpIcon, EmptyStateGuide } from '$lib/components/hints';
	import { GR_CONDITION_OPTIONS, type GRCondition } from '$lib/constants/grCondition';
	import RakPicker from '$lib/components/shared/RakPicker.svelte';
	// Impor modul hint langsung (bukan barrel) — lihat catatan bundling di getHint.ts.
	import { stockLapanganHints } from '$lib/data/hints/stockLapangan';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint modul Stock Lapangan; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(stockLapanganHints, key, 'stock-lapangan');

	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	import {
		fetchInTransitShipments,
		confirmGoodsReceived,
		submitCekKondisiCat,
		type GRShipment
	} from '$lib/services/goodsReceived';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import CekKondisiCat from '$lib/components/shared/CekKondisiCat.svelte';
	import { isCatItem, emptyCekCat, type CekCatState } from '$lib/constants/catItem';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconTruck, IconQrcode, IconPackage, IconAlertTriangle } from '@tabler/icons-svelte';

	function dataUrlToFile(dataUrl: string, filename: string): File {
		const [meta, base64] = dataUrl.split(',');
		const mime = meta.match(/data:(.*);base64/)?.[1] || 'image/png';
		const bytes = atob(base64);
		const arr = new Uint8Array(bytes.length);
		for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
		return new File([arr], filename, { type: mime });
	}
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { vibrateTap } from '$lib/utils/haptic';
	import { stockPenerimaanSchema } from '$lib/schemas/stockPenerimaan';
	import { grItemsSchema } from '$lib/schemas/goodsReceived';
	import KnowledgeCard from '$lib/components/inventory360/KnowledgeCard.svelte';

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_stock_lapangan', roles)) {
			goto('/');
		}
	});

	let loading = $state(true);
	let submitting = $state(false);
	let items = $state<StockItemOption[]>([]);
	let search = $state('');
	let selectedItemId = $state<number | null>(null);
	let quantity = $state<number | null>(null);
	let notes = $state('');
	let lotNumber = $state(suggestLotNumber());
	let expiryDate = $state('');
	let errorMsg = $state('');
	let successInfo = $state<{ referenceNo: string } | null>(null);
	let scanMethod = $state<'qr_item' | 'manual_search'>('manual_search');
	let showScanner = $state(false);

	let gps = $state<DevicePosition | null>(null);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}
	let gpsError = $state('');
	let photoFile = $state<File | null>(null);

	// F0 (Rencana Implementasi Inventory v2.0): lokasi gudang tujuan penerimaan
	let gudangList = $state<GudangOption[]>([]);
	let gudangId = $state<number | null>(null);
	// Fase 5 (opsional): rak/zona spesifik -- null = perilaku lama (level gudang)
	let rakId = $state<number | null>(null);

	// Penyelamatan draf (rencana v2, Fase 3, 3.2 prioritas 5): entri manual (item+qty+lot+
	// expiry+foto) menyakitkan bila harus diulang gara-gara tab ter-refresh. Mode GR (Surat
	// Jalan) tidak diikutkan — alurnya transaksional & selalu mulai dari pilih SJ segar.
	interface MasukDraft {
		selectedItemId: number | null; quantity: number | null; notes: string;
		lotNumber: string; expiryDate: string; scanMethod: 'qr_item' | 'manual_search';
	}
	const masukPersist = createFormPersist<MasukDraft>('stock_masuk');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);
	const MASUK_PHOTO_KEY = 'bukti';

	function masukSnapshot(): MasukDraft {
		return { selectedItemId, quantity, notes, lotNumber, expiryDate, scanMethod };
	}

	// --- Goods Received (GR) mode: konfirmasi penerimaan Surat Jalan material proyek dari ERP ---
	let mode = $state<'manual' | 'gr'>('manual');
	let grLoading = $state(false);
	let grLoadError = $state('');
	let grShipments = $state<GRShipment[]>([]);
	let grSelected = $state<GRShipment | null>(null);
	let grQty = $state<Record<number, number>>({});
	let grCondition = $state<Record<number, GRCondition>>({});
	// Checklist visual kondisi cat (Fase 4 QC Re-test) per projectExpenseId — hanya untuk item bertipe cat.
	let grCekCat = $state<Record<number, CekCatState>>({});
	$effect(() => {
		if (!grSelected) return;
		untrack(() => {
			for (const it of grSelected!.items) {
				const id = it.projectExpenseId;
				if (it.itemType === 'rab' && id != null && isCatItem(it.materialName) && !grCekCat[id]) grCekCat[id] = emptyCekCat();
			}
		});
	});
	// Item non-RAB (generik, B9/K17) — state terpisah dari RAB supaya suratJalanItemId
	// (ruang ID berbeda dari projectExpenseId) tidak bisa tabrakan kunci.
	let grQtyGeneric = $state<Record<number, number>>({});
	let grConditionGeneric = $state<Record<number, GRCondition>>({});
	// Server (/api/goods-received/confirm) hanya izinkan Admin konfirmasi item generik non-RAB.
	let canConfirmGeneric = $derived(hasPermission($authStore.roleId, 'admin_panel', $rolesStore));
	let grPhotoFile = $state<File | null>(null);
	let grSubmitting = $state(false);
	let grError = $state('');
	let grSuccess = $state<{ hasVariance: boolean; claimsCreated: number[]; queuedOffline?: boolean } | null>(null);
	let showGrScanner = $state(false);
	let grScanNotFound = $state('');

	// Bukti tambahan (Fase 1/Gap #1/#2/#8): opsional, tidak memblokir alur bila dilewati.
	let grScanSjFile = $state<File | null>(null);
	let grExtraPhotos = $state<File[]>([]);
	let ttdPenerimaPad: any = $state(null);
	let ttdDriverPad: any = $state(null);

	async function loadGrShipments() {
		grLoading = true;
		grLoadError = '';
		try {
			grShipments = await fetchInTransitShipments();
		} catch (e: any) {
			grLoadError = e?.message || 'Gagal memuat daftar Surat Jalan.';
		} finally {
			grLoading = false;
		}
	}

	function switchMode(next: 'manual' | 'gr') {
		mode = next;
		if (next === 'gr' && grShipments.length === 0 && !grLoading) {
			loadGrShipments();
		}
	}

	function selectShipment(shipment: GRShipment) {
		grSelected = shipment;
		grQty = {};
		grCondition = {};
		grQtyGeneric = {};
		grConditionGeneric = {};
		for (const item of shipment.items) {
			if (item.projectExpenseId != null) {
				grQty[item.projectExpenseId] = item.qtySent;
				grCondition[item.projectExpenseId] = 'ok';
			} else if (item.suratJalanItemId != null) {
				// Item non-RAB (generik, B9/K17) — backend sudah dukung, dulu dibuang di UI mobile ini.
				grQtyGeneric[item.suratJalanItemId] = item.qtySent;
				grConditionGeneric[item.suratJalanItemId] = 'ok';
			}
		}
		grPhotoFile = null;
		grScanSjFile = null;
		grExtraPhotos = [];
		grError = '';
		grSuccess = null;
	}

	function onGrScanDetect(value: string) {
		showGrScanner = false;
		grScanNotFound = '';

		// KRITIS (R1): dua pencocokan wajib. QR SJ terbaru dicetak sebagai URL /scan/EPI%3ASJ%3A<id>%3A<token>
		// (Keputusan D1), tapi SJ yang sudah beredar sebelum rilis ini hanya berisi qrToken mentah.
		// Melewatkan salah satu akan mematikan alur Goods Receipt untuk salah satu golongan SJ.
		let epiPayload = value;
		try {
			const url = new URL(value);
			const last = url.pathname.split('/').filter(Boolean).pop();
			if (last) epiPayload = decodeURIComponent(last);
		} catch {
			// value bukan URL (mis. hasil decode langsung EPI:SJ:...) — pakai apa adanya
		}

		const parsed = parseEpiQr(epiPayload);
		let shipment = parsed && parsed.type === 'SJ'
			? grShipments.find((s) => s.suratJalanId === parsed.id && s.qrToken === parsed.token)
			: undefined;

		if (!shipment) {
			// Format lama — wajib tetap didukung: cocokkan nilai mentah dengan qrToken seperti sebelumnya
			shipment = grShipments.find((s) => s.qrToken && s.qrToken === value);
		}

		if (!shipment) {
			grScanNotFound = 'QR tidak cocok dengan Surat Jalan manapun di daftar. Pilih manual dari daftar di bawah.';
			return;
		}
		selectShipment(shipment);
	}

	function onGrPhotoChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		grPhotoFile = file || null;
	}

	function onGrScanSjChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		grScanSjFile = file || null;
	}

	function onGrExtraPhotosChange(e: Event) {
		const files = Array.from((e.target as HTMLInputElement).files || []);
		grExtraPhotos = files;
	}

	let canSubmitGr = $derived(!!grSelected && !!grPhotoFile && !!gps && !gpsError && !grSubmitting);

	async function handleGrSubmit() {
		if (!canSubmitGr || !grSelected) return;
		grSubmitting = true;
		grError = '';

		const karyawanName = $authStore.karyawanName;
		if (!karyawanName) {
			grError = 'Nama karyawan tidak ditemukan di sesi login.';
			grSubmitting = false;
			return;
		}

		const rabItems = grSelected.items
			.filter((item) => item.projectExpenseId != null)
			.map((item) => ({
				project_expense_id: item.projectExpenseId as number,
				qty_received: grQty[item.projectExpenseId as number] ?? 0,
				condition: grCondition[item.projectExpenseId as number] ?? 'ok'
			}));
		// Item non-RAB (generik, B9/K17) — server hanya izinkan Admin (lihat canConfirmGeneric).
		const genericItems = canConfirmGeneric
			? grSelected.items
					.filter((item) => item.projectExpenseId == null && item.suratJalanItemId != null)
					.map((item) => ({
						surat_jalan_item_id: item.suratJalanItemId as number,
						qty_received: grQtyGeneric[item.suratJalanItemId as number] ?? 0,
						condition: grConditionGeneric[item.suratJalanItemId as number] ?? 'ok'
					}))
			: [];
		const rawItems = [...rabItems, ...genericItems];
		const itemsParsed = grItemsSchema.safeParse(rawItems);
		if (!itemsParsed.success) {
			grError = itemsParsed.error.issues[0]?.message || 'Data item GR tidak valid.';
			grSubmitting = false;
			return;
		}
		const items = itemsParsed.data;

		const currentGps = gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null;
		const captureTimestamp = new Date().toISOString();

		try {
			const compressed = await compressPhoto(grPhotoFile as File);
			const watermarked = await watermarkPhoto(compressed, currentGps, captureTimestamp);
			const fotoTerimaFileId = await uploadEvidencePhoto(watermarked, 'stock_lapangan:gr');
			if (!fotoTerimaFileId) throw new Error('Gagal mengunggah foto bukti serah-terima. Coba lagi.');

			// Bukti tambahan — opsional, tiap upload gagal tidak menggagalkan konfirmasi utama.
			let scanSjFileId: string | null = null;
			if (grScanSjFile) {
				try {
					const wm = await watermarkPhoto(await compressPhoto(grScanSjFile), currentGps, captureTimestamp);
					scanSjFileId = await uploadEvidencePhoto(wm, 'stock_lapangan:gr_scan_sj');
				} catch (e) {
					console.error('Gagal unggah scan SJ:', e);
				}
			}

			let ttdPenerimaFileId: string | null = null;
			if (ttdPenerimaPad && !ttdPenerimaPad.isEmpty()) {
				try {
					const dataUrl = ttdPenerimaPad.toDataURL();
					if (dataUrl) ttdPenerimaFileId = await uploadEvidencePhoto(dataUrlToFile(dataUrl, 'ttd-penerima.png'), 'stock_lapangan:gr_ttd_penerima');
				} catch (e) {
					console.error('Gagal unggah TTD penerima:', e);
				}
			}

			let ttdDriverFileId: string | null = null;
			if (ttdDriverPad && !ttdDriverPad.isEmpty()) {
				try {
					const dataUrl = ttdDriverPad.toDataURL();
					if (dataUrl) ttdDriverFileId = await uploadEvidencePhoto(dataUrlToFile(dataUrl, 'ttd-driver.png'), 'stock_lapangan:gr_ttd_driver');
				} catch (e) {
					console.error('Gagal unggah TTD driver:', e);
				}
			}

			const evidencePhotoIds: string[] = [];
			for (const photo of grExtraPhotos) {
				try {
					const c = await watermarkPhoto(await compressPhoto(photo), currentGps, captureTimestamp);
					const id = await uploadEvidencePhoto(c, 'stock_lapangan:gr_multi_foto');
					if (id) evidencePhotoIds.push(id);
				} catch (e) {
					console.error('Gagal unggah foto tambahan:', e);
				}
			}

			const result = await confirmGoodsReceived(grSelected.suratJalanId, items, fotoTerimaFileId, {
				scanSjFileId,
				ttdPenerimaFileId,
				ttdDriverFileId,
				evidencePhotoIds,
				gps: gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null
			});

			// Efek kedua: catat stok fisik lapangan per item yang benar-benar diterima
			// (reuse engine penerimaan yang sama dengan mode manual — D4). Item generik (B9)
			// ikut dicatat juga bila Admin yang mengonfirmasi (canConfirmGeneric).
			// Fase 5 (opsional, 21 Agu 2026): tujuan HARUS gudang proyek itu sendiri (kode_gudang
			// PROY-<projectId>) -- ini penerimaan fisik di lokasi proyek, bukan gudang admin bebas
			// pilih, jadi TIDAK ADA dropdown manual di sini (beda dengan form masuk/output/opname).
			const projectGudangId = await getProjectGudangId(grSelected.projectId);
			const capturedAt = new Date().toISOString();
			for (const item of grSelected.items) {
				const isGeneric = item.projectExpenseId == null;
				if (isGeneric && !canConfirmGeneric) continue;
				const qtyReceived = isGeneric
					? (grQtyGeneric[item.suratJalanItemId as number] ?? 0)
					: (grQty[item.projectExpenseId as number] ?? 0);
				if (qtyReceived <= 0 || !item.identitasBarangId) continue;
				try {
					await submitPenerimaan({
						itemId: item.identitasBarangId,
						quantity: qtyReceived,
						notes: `GR Surat Jalan ${grSelected.nomorSJ}`,
						karyawanName,
						lat: gps?.lat ?? null,
						lng: gps?.lng ?? null,
						accuracy: gps?.accuracy ?? null,
						capturedAt,
						scanMethod: 'manual_search',
						evidencePhotoFileId: fotoTerimaFileId,
						gudangId: projectGudangId
					});
				} catch (stockErr) {
					console.error(`Gagal mencatat stok fisik untuk ${item.materialName}:`, stockErr);
				}
			}

			// Checklist kondisi cat (opsional, best-effort) — dikirim SETELAH konfirmasi sukses; gagal simpan
			// tidak mengubah hasil konfirmasi. Jalur antrean offline tidak membawa checklist ini.
			const cekRows = grSelected.items
				.filter((item) => item.projectExpenseId != null && grCekCat[item.projectExpenseId as number])
				.map((item) => ({ project_expense_id: item.projectExpenseId as number, nama_barang: item.materialName, ...grCekCat[item.projectExpenseId as number] }));
			if (cekRows.length > 0) {
				const cek = await submitCekKondisiCat(grSelected.suratJalanId, cekRows);
				if (!cek) console.warn('Checklist kondisi cat tidak tersimpan (konfirmasi GR tetap sukses).');
			}
			grCekCat = {};

			grSuccess = { hasVariance: result.hasVariance, claimsCreated: result.claimsCreated };
			grShipments = grShipments.filter((s) => s.suratJalanId !== grSelected!.suratJalanId);
			grSelected = null;
		} catch (err: any) {
			if (err instanceof TypeError) {
				// Kemungkinan besar offline (fetch gagal total, bukan error dari server) — simpan
				// ke antrian lokal untuk dikirim ulang otomatis saat sinyal kembali (Fase 5).
				try {
					const extraPhotoBlobs = await Promise.all(
						grExtraPhotos.map((p) => compressPhoto(p).then((c) => watermarkPhoto(c, currentGps, captureTimestamp)))
					);
					const ttdPenerimaBlob = ttdPenerimaPad && !ttdPenerimaPad.isEmpty() ? dataUrlToFile(ttdPenerimaPad.toDataURL(), 'ttd-penerima.png') : undefined;
					const ttdDriverBlob = ttdDriverPad && !ttdDriverPad.isEmpty() ? dataUrlToFile(ttdDriverPad.toDataURL(), 'ttd-driver.png') : undefined;
					const fotoTerimaBlob = await watermarkPhoto(await compressPhoto(grPhotoFile as File), currentGps, captureTimestamp);
					const scanSjBlob = grScanSjFile ? await watermarkPhoto(await compressPhoto(grScanSjFile), currentGps, captureTimestamp) : undefined;

					await enqueueGRSubmission({
						client_txn_id: crypto.randomUUID(),
						suratJalanId: grSelected!.suratJalanId,
						nomorSJ: grSelected!.nomorSJ,
						items,
						gps: currentGps,
						blobs: {
							fotoTerima: fotoTerimaBlob,
							scanSj: scanSjBlob,
							ttdPenerima: ttdPenerimaBlob,
							ttdDriver: ttdDriverBlob,
							extraPhotos: extraPhotoBlobs
						},
						createdAt: captureTimestamp
					});
					grSuccess = { hasVariance: false, claimsCreated: [], queuedOffline: true };
					grShipments = grShipments.filter((s) => s.suratJalanId !== grSelected!.suratJalanId);
					grSelected = null;
				} catch (queueErr: any) {
					console.error('Gagal menyimpan antrian offline GR:', queueErr);
					grError = 'Tidak ada sinyal dan gagal menyimpan offline. Coba lagi.';
				}
			} else {
				grError = err?.message || 'Gagal mengonfirmasi penerimaan barang.';
			}
		} finally {
			grSubmitting = false;
		}
	}

	async function requestGps() {
		gpsError = '';
		try {
			gps = await getCurrentPosition();
		} catch (e: any) {
			gpsError = e?.message || 'Gagal mengambil lokasi. Wajib aktifkan izin lokasi.';
		}
	}

	onMount(async () => {
		items = await getItemsForPicker();
		loading = false;
		requestGps();

		gudangList = await fetchGudangList();
		if (!gudangId && gudangList.length > 0) {
			const utama = gudangList.find((g) => g.jenis === 'gudang_utama');
			gudangId = (utama || gudangList[0]).id;
		}

		const draft = masukPersist.restore();
		if (draft && draft.selectedItemId && items.some((i) => i.id === draft.selectedItemId)) {
			selectedItemId = draft.selectedItemId;
			quantity = draft.quantity;
			notes = draft.notes;
			lotNumber = draft.lotNumber || suggestLotNumber();
			expiryDate = draft.expiryDate;
			scanMethod = draft.scanMethod;
			const blob = await masukPersist.restorePhoto(MASUK_PHOTO_KEY);
			if (blob) photoFile = new File([blob], 'bukti.jpg', { type: blob.type || 'image/jpeg' });
			draftSavedAt = new Date();
		}
		draftArmed = true;

		// Fase 2 (rencana v2 "Packing List -> Multi Surat Jalan + Pergantian Barang", 23 Sep
		// 2026), fix B4: deep-link dari tombol "Konfirmasi Terima Barang" di TrackingTimeline
		// lapangan (?mode=gr&sj=<surat_jalan_id>) langsung buka tab GR & sorot SJ terkait,
		// tanpa membangun form GR baru — cuma memakai alur yang sudah ada.
		const deepLinkMode = page.url.searchParams.get('mode');
		const deepLinkSj = page.url.searchParams.get('sj');
		if (deepLinkMode === 'gr') {
			mode = 'gr';
			await loadGrShipments();
			if (deepLinkSj) {
				const target = grShipments.find((s) => String(s.suratJalanId) === String(deepLinkSj));
				if (target) selectShipment(target);
			}
		}

		registerStockAutoFlush(async (entry) => {
			let evidencePhotoFileId: string | null = null;
			if (entry.photoBlob) {
				const file = new File([entry.photoBlob], entry.photoName || 'bukti.jpg', { type: entry.photoBlob.type });
				evidencePhotoFileId = await uploadEvidencePhoto(file, 'stock_lapangan:masuk');
			}
			await submitPenerimaan({ ...(entry.payload as any), evidencePhotoFileId });
		});
		flushStockQueue(async (entry) => {
			let evidencePhotoFileId: string | null = null;
			if (entry.photoBlob) {
				const file = new File([entry.photoBlob], entry.photoName || 'bukti.jpg', { type: entry.photoBlob.type });
				evidencePhotoFileId = await uploadEvidencePhoto(file, 'stock_lapangan:masuk');
			}
			await submitPenerimaan({ ...(entry.payload as any), evidencePhotoFileId });
		}).catch(() => {});

		registerGRAutoFlush(sendQueuedGR);
		flushGRQueue(sendQueuedGR).catch(() => {});
	});

	async function sendQueuedGR(entry: QueuedGRSubmission) {
		const fotoTerimaFileId = await uploadEvidencePhoto(
			new File([entry.blobs.fotoTerima], 'bukti.jpg', { type: entry.blobs.fotoTerima.type }),
			'stock_lapangan:gr'
		);
		if (!fotoTerimaFileId) throw new Error('Gagal unggah foto bukti serah-terima saat flush.');

		const scanSjFileId = entry.blobs.scanSj
			? await uploadEvidencePhoto(new File([entry.blobs.scanSj], 'scan-sj.jpg', { type: entry.blobs.scanSj.type }), 'stock_lapangan:gr_scan_sj').catch(() => null)
			: null;
		const ttdPenerimaFileId = entry.blobs.ttdPenerima
			? await uploadEvidencePhoto(new File([entry.blobs.ttdPenerima], 'ttd-penerima.png', { type: entry.blobs.ttdPenerima.type }), 'stock_lapangan:gr_ttd_penerima').catch(() => null)
			: null;
		const ttdDriverFileId = entry.blobs.ttdDriver
			? await uploadEvidencePhoto(new File([entry.blobs.ttdDriver], 'ttd-driver.png', { type: entry.blobs.ttdDriver.type }), 'stock_lapangan:gr_ttd_driver').catch(() => null)
			: null;
		const evidencePhotoIds: string[] = [];
		for (const blob of entry.blobs.extraPhotos || []) {
			const id = await uploadEvidencePhoto(new File([blob], 'foto.jpg', { type: blob.type }), 'stock_lapangan:gr_multi_foto').catch(() => null);
			if (id) evidencePhotoIds.push(id);
		}

		const result = await confirmGoodsReceived(entry.suratJalanId, entry.items, fotoTerimaFileId, {
			scanSjFileId,
			ttdPenerimaFileId,
			ttdDriverFileId,
			evidencePhotoIds,
			gps: entry.gps
		});

		const karyawanName = $authStore.karyawanName;
		const capturedAt = new Date().toISOString();
		for (const item of entry.items) {
			if (item.qty_received <= 0 || !item.identitas_barang_id) continue;
			try {
				await submitPenerimaan({
					itemId: item.identitas_barang_id,
					quantity: item.qty_received,
					notes: `GR Surat Jalan ${entry.nomorSJ} (dikirim offline)`,
					karyawanName: karyawanName || '',
					lat: entry.gps?.lat ?? null,
					lng: entry.gps?.lng ?? null,
					accuracy: entry.gps?.accuracy ?? null,
					capturedAt,
					scanMethod: 'manual_search',
					evidencePhotoFileId: fotoTerimaFileId
				});
			} catch (stockErr) {
				console.error(`Gagal mencatat stok fisik (flush) untuk ${item.material_name}:`, stockErr);
			}
		}

		grShipments = grShipments.filter((s) => s.suratJalanId !== entry.suratJalanId);
		void result;
	}

	$effect(() => {
		void masukSnapshot();
		if (!draftArmed) return;
		masukPersist.save(masukSnapshot());
		draftSavedAt = new Date();
	});

	onMount(() => registerFormPersistSaveTriggers(masukPersist, () => masukSnapshot()));

	let filteredItems = $derived(
		search.trim()
			? items.filter((i) => i.nama_barang_lengkap.toLowerCase().includes(search.trim().toLowerCase()))
			: items
	);

	let canSubmit = $derived(
		!!selectedItemId && !!quantity && quantity > 0 && !!photoFile && !!gps && !gpsError
	);

	function onScanDetect(value: string) {
		showScanner = false;
		const parsed = parseEpiQr(value);
		if (!parsed || parsed.type !== 'ITEM') {
			errorMsg = 'QR tidak dikenali sebagai barang. Gunakan pencarian manual.';
			return;
		}
		const found = items.find((i) => i.id === parsed.id);
		if (!found) {
			errorMsg = 'Barang hasil scan tidak ditemukan di daftar.';
			return;
		}
		selectedItemId = found.id;
		scanMethod = 'qr_item';
		errorMsg = '';
	}

	function onPhotoChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		photoFile = file || null;
		if (file) masukPersist.savePhoto(MASUK_PHOTO_KEY, file);
	}

	async function handleSubmit() {
		if (!canSubmit || submitting) return;
		vibrateTap();
		submitting = true;
		errorMsg = '';
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama karyawan tidak ditemukan di sesi login.');

			const capturedAt = new Date().toISOString();
			const parsed = stockPenerimaanSchema.safeParse({
				itemId: selectedItemId,
				quantity,
				notes,
				karyawanName,
				lat: gps?.lat ?? null,
				lng: gps?.lng ?? null,
				accuracy: gps?.accuracy ?? null,
				capturedAt,
				scanMethod,
				lotNumber: lotNumber || undefined,
				expiryDate: expiryDate || null,
				gudangId: rakId || gudangId
			});
			if (!parsed.success) {
				errorMsg = parsed.error.issues[0]?.message || 'Data barang masuk tidak valid.';
				submitting = false;
				return;
			}
			const basePayload = parsed.data;
			const compressed = await compressPhoto(photoFile as File);

			try {
				const evidencePhotoFileId = await uploadEvidencePhoto(compressed, 'stock_lapangan:masuk');
				const result = await submitPenerimaan({ ...basePayload, evidencePhotoFileId });
				successInfo = { referenceNo: result.reference_no };
			} catch (err: any) {
				if (err instanceof TypeError) {
					await enqueueStockSubmission({
						client_txn_id: crypto.randomUUID(),
						type: 'masuk',
						payload: basePayload,
						photoBlob: compressed,
						photoName: compressed.name,
						createdAt: new Date().toISOString()
					});
					successInfo = { referenceNo: 'Tersimpan offline, akan terkirim otomatis' };
				} else {
					throw err;
				}
			}
			masukPersist.clear();
			await masukPersist.clearPhotos();
			draftSavedAt = null;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mencatat barang masuk.';
		} finally {
			submitting = false;
		}
	}

	function resetForm() {
		selectedItemId = null;
		quantity = null;
		notes = '';
		search = '';
		successInfo = null;
		photoFile = null;
		lotNumber = suggestLotNumber();
		expiryDate = '';
		scanMethod = 'manual_search';
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/stock-lapangan')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if showScanner && QrScannerModal}
		<QrScannerModal expectedPrefix="EPI:" onDetect={onScanDetect} onClose={() => (showScanner = false)} />
	{/if}
	{#if showGrScanner && QrScannerModal}
		<QrScannerModal onDetect={onGrScanDetect} onClose={() => (showGrScanner = false)} />
	{/if}

	<div class="flex rounded-xl border p-1 mb-4" style="border-color: var(--sys-sep)">
		<button
			class="flex-1 h-9 rounded-lg text-[12.5px] font-semibold transition-colors"
			style="background: {mode === 'manual' ? 'var(--g)' : 'transparent'}; color: {mode === 'manual' ? 'white' : 'var(--sys-label3)'}"
			onclick={() => switchMode('manual')}
		>
			Input Manual
		</button>
		<button
			class="flex-1 h-9 rounded-lg text-[12.5px] font-semibold transition-colors"
			style="background: {mode === 'gr' ? 'var(--g)' : 'transparent'}; color: {mode === 'gr' ? 'white' : 'var(--sys-label3)'}"
			onclick={() => switchMode('gr')}
		>
			Terima dari Surat Jalan
		</button>
	</div>

	{#if mode === 'gr'}
		<h1 class="text-[16px] font-bold flex items-center gap-2" style="color: var(--sys-label)">
			<IconPackage size={18} /> Konfirmasi Penerimaan (GR)
		</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Material proyek yang sudah dikirim dari gudang/supplier, menunggu konfirmasi Anda</p>

		<SectionGuide
			id="stockLapangan.masuk.page"
			title={h('masuk.page').sectionGuide?.title}
			steps={h('masuk.page').sectionGuide?.steps ?? []}
		/>

		{#if grSuccess}
			<div class="text-center py-16">
				<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
				{#if grSuccess.queuedOffline}
					<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Tersimpan offline</p>
					<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Tidak ada sinyal — konfirmasi akan otomatis terkirim begitu koneksi kembali.</p>
				{:else}
					<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Penerimaan barang dikonfirmasi</p>
					{#if grSuccess.hasVariance}
						<p class="text-[12px] mt-1" style="color: #DC2626">⚠ Ada selisih — {grSuccess.claimsCreated.length} klaim otomatis dibuat untuk ditindaklanjuti Finance/Logistik.</p>
					{:else}
						<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Jumlah diterima sesuai kiriman. HPP proyek sudah diperbarui.</p>
					{/if}
				{/if}
				<div class="flex gap-2 justify-center mt-5">
					<button class="px-4 py-2 rounded-lg text-[12px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={() => (grSuccess = null)}>
						Konfirmasi SJ Lain
					</button>
					<button class="px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/stock-lapangan')}>
						Kembali ke Hub
					</button>
				</div>
			</div>
		{:else if grSelected}
			<button class="text-[11px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => (grSelected = null)}>
				← Pilih SJ lain
			</button>
			<div class="rounded-xl border p-3 mb-3" style="border-color: var(--sys-sep)">
				<p class="text-[13px] font-semibold" style="color: var(--sys-label)">SJ {grSelected.nomorSJ}</p>
				<p class="text-[11px]" style="color: var(--sys-label3)">{grSelected.projectName} · Driver: {grSelected.driver || '-'}</p>
			</div>

			<p class="text-[11px] font-semibold mb-2 inline-flex items-center gap-1.5" style="color: var(--sys-label3)">
				Jumlah Diterima per Item<HelpIcon text={h('masuk.form.jumlahDiterima').helpIcon} position="bottom" />
			</p>
			<!-- Dua hint ini berlaku untuk SEMUA baris item, jadi ditaruh sekali di sini —
			     dipasang per baris akan terulang sebanyak jumlah item di surat jalan. -->
			<FieldHint
				text={h('masuk.form.jumlahDiterima').fieldHint}
				type={h('masuk.form.jumlahDiterima').type}
			/>
			<FieldHint text={h('masuk.form.kondisi').fieldHint} />
			<div class="rounded-xl border divide-y mb-4 mt-2" style="border-color: var(--sys-sep)">
				{#each grSelected.items.filter((i) => i.itemType === 'rab') as item (item.projectExpenseId)}
					<div class="p-3">
						<p class="text-[12.5px] font-medium mb-1.5" style="color: var(--sys-label)">{item.materialName}</p>{#if item.identitasBarangId}<div class="mb-1.5"><KnowledgeCard itemId={item.identitasBarangId} context="receive" label="Cek barang" /></div>{/if}
						<p class="text-[10.5px] mb-2" style="color: var(--sys-label3)">Dikirim: {item.qtySent} {item.unit}</p>
						<div class="flex gap-2 items-center">
							<input
								type="number"
								min="0"
								step="any"
								class="flex-1 rounded-lg border text-[13px] p-2"
								style="border-color: var(--sys-sep)"
								bind:value={grQty[item.projectExpenseId]}
							/>
							<select class="rounded-lg border text-[12px] p-2" style="border-color: var(--sys-sep)" bind:value={grCondition[item.projectExpenseId]}>
								{#each GR_CONDITION_OPTIONS as opt}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</select>
						</div>
						{#if isCatItem(item.materialName) && grCekCat[item.projectExpenseId]}
							<CekKondisiCat bind:value={grCekCat[item.projectExpenseId]} />
						{/if}
						{#if (grQty[item.projectExpenseId] ?? 0) < item.qtySent}
							<p class="text-[10.5px] mt-1.5 flex items-center gap-1" style="color: #DC2626">
								<IconAlertTriangle size={12} /> Selisih {item.qtySent - (grQty[item.projectExpenseId] ?? 0)} {item.unit} — otomatis dibuatkan klaim
							</p>
						{/if}
					</div>
				{/each}
			</div>

			{#if grSelected.items.some((i) => i.itemType === 'generic')}
				<p class="text-[11px] font-semibold mb-2" style="color: var(--sys-label3)">Barang Non-RAB</p>
				{#if !canConfirmGeneric}
					<p class="text-[10.5px] mb-3 rounded-lg p-2" style="background: var(--aml); color: var(--amd)">
						SJ ini juga berisi barang non-RAB — hanya Admin yang bisa mengonfirmasi item tersebut. Lanjutkan konfirmasi untuk item RAB di atas; hubungi Admin untuk sisanya.
					</p>
				{:else}
					<div class="rounded-xl border divide-y mb-4" style="border-color: var(--sys-sep)">
						{#each grSelected.items.filter((i) => i.itemType === 'generic') as item (item.suratJalanItemId)}
							<div class="p-3">
								<p class="text-[12.5px] font-medium mb-1.5" style="color: var(--sys-label)">{item.materialName}</p>{#if item.identitasBarangId}<div class="mb-1.5"><KnowledgeCard itemId={item.identitasBarangId} context="receive" label="Cek barang" /></div>{/if}
								<p class="text-[10.5px] mb-2" style="color: var(--sys-label3)">Dikirim: {item.qtySent} {item.unit}</p>
								<div class="flex gap-2 items-center">
									<input
										type="number"
										min="0"
										step="any"
										class="flex-1 rounded-lg border text-[13px] p-2"
										style="border-color: var(--sys-sep)"
										bind:value={grQtyGeneric[item.suratJalanItemId as number]}
									/>
									<select class="rounded-lg border text-[12px] p-2" style="border-color: var(--sys-sep)" bind:value={grConditionGeneric[item.suratJalanItemId as number]}>
										{#each GR_CONDITION_OPTIONS as opt}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								</div>
								{#if (grQtyGeneric[item.suratJalanItemId as number] ?? 0) < item.qtySent}
									<p class="text-[10.5px] mt-1.5 flex items-center gap-1" style="color: #DC2626">
										<IconAlertTriangle size={12} /> Selisih {item.qtySent - (grQtyGeneric[item.suratJalanItemId as number] ?? 0)} {item.unit} — otomatis dibuatkan klaim
									</p>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			{/if}

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Foto Bukti Serah-Terima (wajib)</label>
			<input type="file" accept="image/*" capture="environment" class="w-full mt-1 text-[12px]" onchange={onGrPhotoChange} />
			<div class="mb-3">
				<FieldHint
					text={h('masuk.form.fotoBukti').fieldHint}
					type={h('masuk.form.fotoBukti').type}
				/>
			</div>

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Scan Foto Surat Jalan (opsional)</label>
			<input type="file" accept="image/*" capture="environment" class="w-full mt-1 mb-3 text-[12px]" onchange={onGrScanSjChange} />

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Foto Barang Tambahan (opsional, bisa lebih dari satu)</label>
			<input type="file" accept="image/*" multiple class="w-full mt-1 mb-3 text-[12px]" onchange={onGrExtraPhotosChange} />

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Tanda Tangan Penerima (opsional)</label>
			<div class="mt-1 mb-3">
				<SignaturePad bind:this={ttdPenerimaPad} height={130} />
			</div>

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Tanda Tangan Driver (opsional)</label>
			<div class="mt-1 mb-3">
				<SignaturePad bind:this={ttdDriverPad} height={130} />
			</div>

			<p class="text-[10.5px] mb-3" style="color: {gpsError ? '#DC2626' : 'var(--sys-label3)'}">
				{#if gpsError}
					⚠ {gpsError} <button class="underline" onclick={requestGps}>Coba lagi</button>
				{:else if gps}
					📍 Lokasi terekam (akurasi ~{Math.round(gps.accuracy)}m)
				{:else}
					Mengambil lokasi...
				{/if}
			</p>
			{#if gps}
				<button
					type="button"
					class="text-[10.5px] font-semibold flex items-center gap-1 -mt-2 mb-3"
					style="color: var(--sys-tint, #1F6592)"
					onclick={toggleLocationMap}
				>
					📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
				</button>
				{#if showLocationMap && LocationMap}
					<div transition:slide={{ duration: 200 }} class="mb-3">
						<LocationMap lat={gps.lat} lng={gps.lng} label="Lokasi barang masuk" height="200px" />
					</div>
				{/if}
			{/if}

			{#if grError}
				<p class="text-[12px] mt-2" style="color: #DC2626">{grError}</p>
			{/if}

			<button
				class="w-full h-12 mt-3 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--g)"
				disabled={!canSubmitGr}
				onclick={handleGrSubmit}
			>
				{#if grSubmitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Konfirmasi Penerimaan
			</button>
		{:else if grLoading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat pengiriman goods receipt..." />
		</div>
		{:else if grLoadError}
			<p class="text-[12px] text-center py-8" style="color: #DC2626">{grLoadError}</p>
		{:else if grShipments.length === 0}
			<EmptyStateGuide
				message={h('masuk.empty').message}
				hints={h('masuk.empty').hints ?? []}
			/>
		{:else}
			<button
				class="w-full h-11 mb-3 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2"
				style="background: var(--g)"
				onclick={async () => { await loadQrScannerModal(); grScanNotFound = ''; showGrScanner = true; }}
			>
				<IconQrcode size={17} /> Scan QR Surat Jalan
			</button>
			{#if grScanNotFound}
				<p class="text-[11px] mb-3 text-center" style="color: #DC2626">{grScanNotFound}</p>
			{/if}
			<div class="rounded-xl border divide-y" style="border-color: var(--sys-sep)">
				{#each grShipments as shipment (shipment.suratJalanId)}
					<button class="w-full text-left p-3 flex items-center justify-between" onclick={() => selectShipment(shipment)}>
						<div>
							<p class="text-[12.5px] font-medium" style="color: var(--sys-label)">SJ {shipment.nomorSJ}</p>
							<p class="text-[10.5px]" style="color: var(--sys-label3)">{shipment.projectName} · {shipment.items.length} item</p>
						</div>
						<IconArrowLeft size={14} style="transform: rotate(180deg); color: var(--sys-label4)" />
					</button>
				{/each}
			</div>
		{/if}
	{:else if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat form barang masuk..." />
		</div>
	{:else if successInfo}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Barang masuk tersimpan</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Ref: {successInfo.referenceNo}</p>
			<div class="flex gap-2 justify-center mt-5">
				<button class="px-4 py-2 rounded-lg text-[12px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={resetForm}>
					Input Lagi
				</button>
				<button class="px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/stock-lapangan')}>
					Kembali ke Hub
				</button>
			</div>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold flex items-center gap-2" style="color: var(--sys-label)">
			<IconTruck size={18} /> Barang Masuk
		</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Penerimaan barang dari gudang/supplier</p>

		<button
			class="w-full h-11 mb-3 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2"
			style="background: var(--g)"
			onclick={async () => { await loadQrScannerModal(); showScanner = true; }}
		>
			<IconQrcode size={17} /> Scan QR Barang
		</button>

		<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Cari Barang (manual)</label>
		<input
			class="w-full mt-1 mb-2 rounded-lg border text-[13px] p-2.5"
			style="border-color: var(--sys-sep)"
			placeholder="Ketik nama barang..."
			bind:value={search}
			oninput={() => (scanMethod = 'manual_search')}
		/>

		<div class="rounded-xl border max-h-64 overflow-y-auto mb-4" style="border-color: var(--sys-sep)">
			{#if filteredItems.length === 0}
				<p class="p-4 text-[12px] text-center" style="color: var(--sys-label3)">Barang tidak ditemukan.</p>
			{:else}
				{#each filteredItems as item (item.id)}
					<button
						class="w-full text-left p-3 border-b last:border-b-0 flex items-center justify-between transition-colors"
						style="border-color: var(--sys-sep); background: {selectedItemId === item.id ? 'var(--gl)' : 'white'}"
						onclick={() => {
							selectedItemId = item.id;
							scanMethod = 'manual_search';
						}}
					>
						<div>
							<p class="text-[12.5px] font-medium" style="color: var(--sys-label)">
								{item.nama_barang_lengkap}
								{#if item.kode_item}<span class="font-mono font-bold" style="color: var(--g)">{item.kode_item}</span>{/if}
							</p>
							<p class="text-[10.5px]" style="color: var(--sys-label3)">Stok sistem: {parseFloat(item.stok_tersedia) || 0} {item.satuan}</p>
						</div>
						{#if selectedItemId === item.id}
							<IconCircleCheck size={16} style="color: var(--g)" />
						{/if}
					</button>
				{/each}
			{/if}
		</div>

		{#if selectedItemId}
			<!-- Inventory 360°: yang wajib dicek & tanda barang palsu sebelum menerima -->
			<div class="mb-3"><KnowledgeCard itemId={selectedItemId} context="receive" label="Cek barang" /></div>
			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Jumlah Diterima</label>
			<input
				type="number"
				min="0"
				step="any"
				class="w-full mt-1 mb-3 rounded-lg border text-[13px] p-2.5"
				style="border-color: var(--sys-sep)"
				placeholder="0"
				bind:value={quantity}
			/>

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Gudang</label>
			<select
				class="w-full mt-1 mb-3 rounded-lg border text-[13px] p-2.5"
				style="border-color: var(--sys-sep)"
				bind:value={gudangId}
			>
				<option value={null}>Pilih gudang</option>
				{#each gudangList as g}
					<option value={g.id}>{g.nama_gudang}</option>
				{/each}
			</select>
			<div class="mb-3">
				<RakPicker {gudangId} bind:value={rakId} compact={true} />
			</div>

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Nomor Lot/Batch</label>
			<input
				class="w-full mt-1 rounded-lg border text-[13px] p-2.5"
				style="border-color: var(--sys-sep)"
				bind:value={lotNumber}
			/>
			<div class="mb-3"><FieldHint text={h('masuk.form.lot').fieldHint} /></div>

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Tanggal Kadaluarsa (opsional)</label>
			<input
				type="date"
				class="w-full mt-1 rounded-lg border text-[13px] p-2.5"
				style="border-color: var(--sys-sep)"
				bind:value={expiryDate}
			/>
			<div class="mb-3"><FieldHint text={h('masuk.form.kadaluarsa').fieldHint} /></div>

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Foto Bukti (wajib)</label>
			<input
				type="file"
				accept="image/*"
				capture="environment"
				class="w-full mt-1 text-[12px]"
				onchange={onPhotoChange}
			/>
			<div class="mb-3">
				<FieldHint
					text={h('masuk.form.fotoBukti').fieldHint}
					type={h('masuk.form.fotoBukti').type}
				/>
			</div>

			<p class="text-[10.5px] mb-3" style="color: {gpsError ? '#DC2626' : 'var(--sys-label3)'}">
				{#if gpsError}
					⚠ {gpsError} <button class="underline" onclick={requestGps}>Coba lagi</button>
				{:else if gps}
					📍 Lokasi terekam (akurasi ~{Math.round(gps.accuracy)}m)
				{:else}
					Mengambil lokasi...
				{/if}
			</p>
			{#if gps}
				<button
					type="button"
					class="text-[10.5px] font-semibold flex items-center gap-1 -mt-2 mb-3"
					style="color: var(--sys-tint, #1F6592)"
					onclick={toggleLocationMap}
				>
					📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
				</button>
				{#if showLocationMap && LocationMap}
					<div transition:slide={{ duration: 200 }} class="mb-3">
						<LocationMap lat={gps.lat} lng={gps.lng} label="Lokasi barang masuk" height="200px" />
					</div>
				{/if}
			{/if}

			<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Catatan (opsional)</label>
			<textarea
				class="w-full mt-1 rounded-lg border text-[12px] p-2.5"
				style="border-color: var(--sys-sep)"
				rows="2"
				bind:value={notes}
			></textarea>
		{/if}

		{#if errorMsg}
			<p class="text-[12px] mt-3" style="color: #DC2626">{errorMsg}</p>
		{/if}

		<div class="flex justify-center mt-3">
			<DraftIndicator savedAt={draftSavedAt} />
		</div>

		<button
			class="w-full h-12 mt-2 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
			style="background: var(--g)"
			disabled={!canSubmit || submitting}
			onclick={handleSubmit}
		>
			{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
			Simpan Barang Masuk
		</button>
	{/if}
</div>
