<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getEquipmentById,
		getP2hTemplates,
		getTodayP2hSession,
		getP2hLogsBySession,
		submitP2hSessionAtomic,
		closeP2hSessionAtomic,
		logActivity,
		COMPRESSOR_CATEGORY_IDS,
		FORKLIFT_CATEGORY_IDS,
		VEHICLE_CATEGORY_IDS,
		PRODUKSI_CATEGORY_IDS,
		getEquipmentCategoriesMap,
		type P2hTemplateItem
	} from '$lib/services/preventive';
	import FieldExportSheet from '$lib/components/shared/FieldExportSheet.svelte';
	import IconArrowLeft from '@tabler/icons-svelte/icons/arrow-left';
	import IconCheck from '@tabler/icons-svelte/icons/check';
	import IconX from '@tabler/icons-svelte/icons/x';
	import IconLoader2 from '@tabler/icons-svelte/icons/loader-2';
	import IconAlertTriangle from '@tabler/icons-svelte/icons/alert-triangle';
	import IconCircleCheck from '@tabler/icons-svelte/icons/circle-check';
	import IconQrcode from '@tabler/icons-svelte/icons/qrcode';
	import IconPrinter from '@tabler/icons-svelte/icons/printer';
	import IconClock from '@tabler/icons-svelte/icons/clock';
	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	import { hasValidScanProof, saveScanProof } from '$lib/utils/p2hScanProof';
	import { saveP2hDraft, loadP2hDraft, clearP2hDraft } from '$lib/utils/p2hDraft';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import directus from '$lib/services/directus';
	import { secureDirectusFetch } from '$lib/services/secureDirectus';
	import { todayWib } from '$lib/utils/wibDate';
	import { SectionGuide, FieldHint, HelpIcon, StatusExplainer } from '$lib/components/hints';
	// Impor modul hint langsung (bukan barrel) — lihat catatan bundling di getHint.ts.
	import { preventiveHints } from '$lib/data/hints/preventive';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint modul Preventive; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(preventiveHints, key, 'preventive-maintenance');
	import { getCurrentPosition, type DevicePosition } from '$lib/utils/geoClient';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import { p2hAnswerSchema, p2hSessionSchema } from '$lib/schemas/p2hSession';
	import ComponentVerifySection from '$lib/components/preventive/ComponentVerifySection.svelte';
	import KnowledgeCard from '$lib/components/inventory360/KnowledgeCard.svelte';

	let equipmentId = $derived($page.params.equipment_id as string);
	const today = todayWib();

	let loading = $state(true);
	let submitting = $state(false);
	let equipment = $state<any>(null);
	let templates = $state<P2hTemplateItem[]>([]);
	let categoryName = $state('');
	let alreadySubmitted = $state(false);
	let todaySession = $state<any>(null);
	let todayLogs = $state<Awaited<ReturnType<typeof getP2hLogsBySession>>>([]);
	let showExportSheet = $state(false);
	let showCloseForm = $state(false);
	let closingSession = $state(false);
	let closeCatatan = $state('');
	let closeError = $state('');
	let closeSuccess = $state(false);
	let closeSignaturePad: any = $state();
	let answers = $state<Record<string, { result: 'Go' | 'No-Go' | null; notes: string; foto?: string | null; fotoPreview?: string | null; uploading?: boolean; numeric_value?: number | null; text_value?: string | null }>>({});
	let errorMsg = $state('');
	let successInfo = $state<{ hasNoGo: boolean; workOrderCreated: boolean; queued: boolean; workOrderId?: number | string | null } | null>(null);

	let keteranganTambahan = $state('');
	let fotoUnitFileId = $state<string | null>(null);
	let fotoUnitPreview = $state<string | null>(null);
	let uploadingFotoUnit = $state(false);
	let hoursmeterInput = $state<number | null>(null);
	let gpsPosition = $state<DevicePosition | null>(null);
	let gpsError = $state('');

	// Sebagian HP (RAM rendah) bisa blank/refresh sendiri saat kompresi foto kamera resolusi
	// penuh dijalankan lewat canvas. Beri jalan keluar manual: unggah foto asli tanpa kompresi.
	// Preferensi disimpan per-HP (localStorage) supaya user tidak perlu ganti ulang tiap sesi.
	const PHOTO_MODE_KEY = 'epi_p2h_photo_mode';
	let photoUploadMode = $state<'compress' | 'direct'>('compress');
	function loadPhotoUploadMode() {
		try {
			const saved = localStorage.getItem(PHOTO_MODE_KEY);
			if (saved === 'direct' || saved === 'compress') photoUploadMode = saved;
		} catch {
			// localStorage tidak tersedia — pakai default 'compress'.
		}
	}
	function setPhotoUploadMode(mode: 'compress' | 'direct') {
		photoUploadMode = mode;
		try {
			localStorage.setItem(PHOTO_MODE_KEY, mode);
		} catch {
			// localStorage tidak tersedia — preferensi tidak akan bertahan setelah reload.
		}
	}

	// Gaya tombol foto item (kamera & galeri berbagi styling yang sama berdasarkan status).
	function photoButtonStyle(templateId: string, wajibFoto: boolean): string {
		const a = answers[templateId];
		if (a?.uploading) return 'border-color: var(--sys-sep); color: var(--sys-label3); opacity: 0.7;';
		if (wajibFoto && !a?.foto) return 'border-color: #D97706; color: #D97706; background: rgba(217, 119, 6, 0.08)';
		if (a?.foto) return 'border-color: #16A34A; color: #16A34A; background: rgba(22, 163, 74, 0.08)';
		return 'border-color: var(--sys-sep); color: var(--sys-label2)';
	}

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}
	let signaturePad: any = $state();
	let draftRestored = $state(false); // B5 — gerbang autosave, biar tidak menimpa draft sebelum sempat dipulihkan
	let hadDraft = $state(false); // B5 — tampilkan notifikasi kalau ada isian lama yang dipulihkan

	// ── Upload foto (item checklist & foto unit berbagi satu jalur) ─────────────────────
	// Catatan perbaikan "foto P2H tidak bisa diunggah" (19 Okt 2026): di HP RAM rendah,
	// (1) kompresi bisa macet/crash, (2) preview <img> foto asli 12MP+ menahan ~48MB bitmap
	// per item sampai tab di-kill, (3) halaman di-reload diam-diam saat kamera/galeri
	// terbuka, dan (4) pesan gagal hanya tampil di bawah dekat tombol kirim. Sekarang:
	// kompresi punya batas waktu + fallback file asli, preview memakai thumbnail kecil dari
	// server, pesan tampil di item itu sendiri, dan reload saat memilih foto terdeteksi.
	const UNIT_SLOT = '__unit__';
	const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // = BODY_SIZE_LIMIT server (.env)
	const MAX_RAW_PHOTO_BYTES = 30 * 1024 * 1024; // file mentah > ini tidak dicoba dikompres (rawan crash)
	const COMPRESS_TIMEOUT_MS = 20_000;
	const PENDING_PHOTO_KEY = 'epi_p2h_pending_photo';
	const PENDING_PHOTO_MAX_AGE_MS = 10 * 60 * 1000;

	type PhotoMessage = { tone: 'error' | 'warn'; text: string };
	let photoMessages = $state<Record<string, PhotoMessage>>({});

	function photoThumbUrl(fileId: string): string {
		return `${directus.url}/assets/${fileId}?width=96&height=96&fit=cover&quality=70`;
	}

	// Penanda di sessionStorage: kalau HP me-reload halaman saat kamera/galeri terbuka atau saat
	// foto diproses, penanda ini masih ada ketika halaman dimuat ulang -> beri tahu user di item itu.
	function markPendingPhoto(slot: string, stage: 'picking' | 'processing') {
		try {
			sessionStorage.setItem(PENDING_PHOTO_KEY, JSON.stringify({ equipmentId, slot, stage, at: Date.now() }));
		} catch {
			// sessionStorage tidak tersedia — deteksi reload dilewati.
		}
	}
	function clearPendingPhoto() {
		try {
			sessionStorage.removeItem(PENDING_PHOTO_KEY);
		} catch {
			// abaikan
		}
	}
	function takePendingPhoto(): { slot: string; stage: 'picking' | 'processing' } | null {
		try {
			const raw = sessionStorage.getItem(PENDING_PHOTO_KEY);
			sessionStorage.removeItem(PENDING_PHOTO_KEY);
			if (!raw) return null;
			const p = JSON.parse(raw);
			if (p?.equipmentId !== equipmentId || Date.now() - Number(p?.at) > PENDING_PHOTO_MAX_AGE_MS) return null;
			return { slot: String(p.slot), stage: p.stage === 'processing' ? 'processing' : 'picking' };
		} catch {
			return null;
		}
	}

	async function restoreInterruptedPhoto() {
		const pending = takePendingPhoto();
		if (!pending) return;
		const isKnownSlot = pending.slot === UNIT_SLOT || templates.some((t) => t.id === pending.slot);
		if (!isKnownSlot) return;
		let text: string;
		if (pending.stage === 'processing' && photoUploadMode === 'compress') {
			setPhotoUploadMode('direct');
			text = 'Halaman sempat dimuat ulang oleh HP saat foto dikompres, jadi foto belum terunggah. Mode unggah otomatis dialihkan ke "Upload Langsung" — silakan ambil/pilih foto lagi.';
		} else if (pending.stage === 'processing') {
			text = 'Halaman sempat dimuat ulang saat foto diunggah, jadi foto belum terunggah. Silakan ambil/pilih foto lagi.';
		} else {
			text = 'Halaman sempat dimuat ulang oleh HP saat kamera/galeri terbuka (memori HP penuh), jadi foto belum terunggah. Isian lain sudah dipulihkan — tutup aplikasi lain lalu coba lagi, atau pakai "Unggah dari Galeri".';
		}
		photoMessages[pending.slot] = { tone: 'warn', text };
		await tick();
		const target = document.getElementById(pending.slot === UNIT_SLOT ? 'p2h-foto-unit' : `p2h-item-${pending.slot}`);
		target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Kompresi foto melebihi batas waktu.')), ms);
			promise.then(
				(v) => { clearTimeout(timer); resolve(v); },
				(e) => { clearTimeout(timer); reject(e); }
			);
		});
	}

	function buildPhotoFileName(slot: string, file: File): string {
		const code = String(equipment?.code || equipmentId).replace(/[^a-zA-Z0-9_-]+/g, '-');
		const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
		return `p2h-${code}-${slot === UNIT_SLOT ? 'unit' : 'item'}-${Date.now()}.${ext}`;
	}

	async function uploadErrorMessage(res: Response): Promise<string> {
		if (res.status === 401) return 'Sesi login habis. Muat ulang halaman lalu login lagi, kemudian unggah ulang fotonya.';
		if (res.status === 413) return 'Foto terlalu besar untuk server. Pilih mode "Kompres Otomatis" lalu coba lagi.';
		let detail = '';
		try {
			const body = await res.json();
			detail = body?.errors?.[0]?.message || body?.error || body?.message || '';
		} catch {
			// respons bukan JSON
		}
		return `Gagal mengunggah foto (${res.status}${detail ? `: ${detail}` : ''}). Silakan coba lagi.`;
	}

	/** Kompres (sesuai mode) lalu unggah ke Directus lewat proxy. Mengembalikan file id. */
	async function uploadP2hPhoto(file: File, slot: string): Promise<string> {
		if (file.size > MAX_RAW_PHOTO_BYTES) {
			throw new Error(`Ukuran foto ${(file.size / 1024 / 1024).toFixed(1)}MB terlalu besar. Turunkan resolusi kamera (mis. 12MP) lalu foto ulang.`);
		}
		let toUpload = file;
		if (photoUploadMode === 'compress') {
			try {
				toUpload = await withTimeout(compressPhoto(file), COMPRESS_TIMEOUT_MS);
			} catch (err) {
				// Kompresi gagal/macet di HP ini — kirim file asli selama masih di bawah batas server.
				console.warn('[P2H] Kompresi foto gagal, mengunggah file asli:', err);
				toUpload = file;
			}
		}
		if (toUpload.size > MAX_UPLOAD_BYTES) {
			throw new Error(
				photoUploadMode === 'direct'
					? `Foto asli ${(toUpload.size / 1024 / 1024).toFixed(1)}MB melebihi batas 15MB. Pilih mode "Kompres Otomatis" lalu coba lagi.`
					: `Foto ${(toUpload.size / 1024 / 1024).toFixed(1)}MB gagal diperkecil di HP ini. Turunkan resolusi kamera lalu foto ulang.`
			);
		}
		const formData = new FormData();
		formData.append('file', toUpload, buildPhotoFileName(slot, toUpload));
		let res: Response;
		try {
			res = await secureDirectusFetch('/files', { method: 'POST', body: formData });
		} catch (err: any) {
			if (err instanceof TypeError) throw new Error('Koneksi terputus saat mengunggah foto. Periksa sinyal lalu coba lagi.');
			throw err;
		}
		if (!res.ok) throw new Error(await uploadErrorMessage(res));
		const data = await res.json().catch(() => null);
		const fileId = data?.data?.id;
		if (!fileId) throw new Error('Respons server tidak berisi file foto. Silakan coba lagi.');
		return fileId;
	}

	async function handleFotoUnitUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) {
			clearPendingPhoto();
			return;
		}
		markPendingPhoto(UNIT_SLOT, 'processing');
		delete photoMessages[UNIT_SLOT];
		uploadingFotoUnit = true;
		try {
			const fileId = await uploadP2hPhoto(file, UNIT_SLOT);
			fotoUnitFileId = fileId;
			fotoUnitPreview = photoThumbUrl(fileId);
		} catch (err: any) {
			console.error('[P2H] Upload foto unit gagal:', err);
			// Foto lama (kalau ada) dibiarkan — tidak ditimpa oleh percobaan yang gagal.
			photoMessages[UNIT_SLOT] = { tone: 'error', text: err?.message || 'Gagal mengunggah foto unit. Silakan coba lagi.' };
		} finally {
			uploadingFotoUnit = false;
			input.value = '';
			clearPendingPhoto();
		}
	}

	async function handleItemFotoUpload(templateId: string, event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) {
			clearPendingPhoto();
			return;
		}
		markPendingPhoto(templateId, 'processing');
		delete photoMessages[templateId];
		answers[templateId] = { ...answers[templateId], uploading: true };
		try {
			const fileId = await uploadP2hPhoto(file, templateId);
			answers[templateId] = { ...answers[templateId], foto: fileId, fotoPreview: photoThumbUrl(fileId), uploading: false };
		} catch (err: any) {
			console.error('[P2H] Upload foto item gagal:', err);
			// Foto lama (kalau ada) dibiarkan — tidak ditimpa oleh percobaan yang gagal.
			answers[templateId] = { ...answers[templateId], uploading: false };
			photoMessages[templateId] = { tone: 'error', text: err?.message || 'Gagal mengunggah foto. Silakan coba lagi.' };
		} finally {
			input.value = '';
			clearPendingPhoto();
		}
	}


	let isCompressorUnit = $derived(!!equipment?.category_id && COMPRESSOR_CATEGORY_IDS.includes(equipment.category_id));
	let isForkliftUnit = $derived(!!equipment?.category_id && FORKLIFT_CATEGORY_IDS.includes(equipment.category_id));
	let isVehicleUnit = $derived(!!equipment?.category_id && VEHICLE_CATEGORY_IDS.includes(equipment.category_id));
	let isProduksiUnit = $derived(!!equipment?.category_id && PRODUKSI_CATEGORY_IDS.includes(equipment.category_id));

	// F4 (Fase 4 "Export Maintenance v2" rencana) — Hasil P2H hari ini, PDF saja
	// (dokumen hasil pemeriksaan untuk dilampirkan/ditunjukkan, bukan diolah lanjut).
	const exportColumns = [
		{ key: 'item', label: 'Item Pemeriksaan' },
		{ key: 'hasil', label: 'Hasil' },
		{ key: 'catatan', label: 'Catatan' }
	];
	let exportRows = $derived(
		todayLogs.map((l) => ({
			item: l.p2h_template_id?.item_name || '-',
			hasil: l.result?.name || '-',
			catatan: l.notes || l.text_value || (l.numeric_value != null ? String(l.numeric_value) : '') || '-'
		}))
	);

	// Wajib scan barcode unit ini dulu sebelum checklist P2H bisa diisi.
	let scanVerified = $state(false);
	let scanMethod = $state<'scan' | 'manual'>('scan');
	let showScanner = $state(false);
	let scanError = $state('');
	let showManualInput = $state(false);
	let manualCode = $state('');

	function onScanDetect(value: string) {
		showScanner = false;
		const code = value.replace(/^EPI:EQUIPMENT:/, '');
		if (code !== equipment?.code) {
			scanError = `Barcode yang discan ("${code}") bukan milik unit ini (${equipment?.code}). Scan ulang barcode yang tertempel di unit.`;
			return;
		}
		scanError = '';
		scanVerified = true;
		scanMethod = 'scan';
		saveScanProof(equipmentId);
	}

	function verifyManualCode() {
		const entered = manualCode.trim().toUpperCase();
		const targetCode = (equipment?.code || '').trim().toUpperCase();
		const targetCodeWithPrefix = `EPI:EQUIPMENT:${targetCode}`;

		if (entered === targetCode || entered === targetCodeWithPrefix) {
			scanError = '';
			scanVerified = true;
			scanMethod = 'manual';
			saveScanProof(equipmentId);
		} else {
			scanError = 'Kode unit yang Anda masukkan salah. Periksa kembali kode unit.';
		}
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_preventive', roles)) {
			goto('/');
		}
	});

	onMount(async () => {
		loadPhotoUploadMode();
		equipment = await getEquipmentById(equipmentId);
		if (!equipment) {
			errorMsg = 'Unit tidak ditemukan.';
			loading = false;
			return;
		}
		if (equipment.category_id) {
			const catMap = await getEquipmentCategoriesMap([equipment.category_id]);
			categoryName = catMap[equipment.category_id] || '';
		}
		const existing = await getTodayP2hSession(equipmentId, today);
		if (existing) {
			alreadySubmitted = true;
			todaySession = existing;
			loading = false;
			todayLogs = await getP2hLogsBySession(existing.id);
			return;
		}
		scanVerified = hasValidScanProof(equipmentId);
		templates = await getP2hTemplates(equipment.category_id);
		for (const t of templates) answers[t.id] = { result: null, notes: '', numeric_value: null, text_value: null };

		// B5 — pulihkan draft tersimpan (kalau ada) sebelum autosave mulai jalan.
		const draft = loadP2hDraft(equipmentId, today);
		if (draft) {
			hadDraft = true;
			for (const t of templates) {
				const saved = draft.answers[t.id];
				if (!saved) continue;
				answers[t.id] = {
					...answers[t.id],
					...saved,
					// fotoPreview blob: URL sudah mati setelah reload -- bangun ulang dari file id
					// yang sudah diunggah ke Directus lewat proxy, bukan dari draft mentah.
					fotoPreview: saved.foto ? photoThumbUrl(saved.foto) : null
				};
			}
			keteranganTambahan = draft.keteranganTambahan || '';
			hoursmeterInput = draft.hoursmeterInput ?? null;
			fotoUnitFileId = draft.fotoUnitFileId || null;
			fotoUnitPreview = draft.fotoUnitFileId ? photoThumbUrl(draft.fotoUnitFileId) : null;
		}
		draftRestored = true;
		loading = false;
		void restoreInterruptedPhoto();

		// GPS bersifat best-effort (audit B4) — gagal/ditolak tidak menghalangi pengisian P2H.
		getCurrentPosition()
			.then((pos) => { gpsPosition = pos; })
			.catch((err) => { gpsError = err?.message || 'Lokasi tidak tersedia'; });
	});

	function setResult(templateId: string, result: 'Go' | 'No-Go') {
		answers[templateId] = { ...answers[templateId], result };
	}

	let activeFilter = $state<'all' | 'unanswered' | 'nogo'>('all');

	function setAllGo() {
		for (const t of templates) {
			if (!answers[t.id]?.result) {
				answers[t.id] = { ...answers[t.id], result: 'Go' };
			}
		}
	}

	let answeredCount = $derived(templates.filter((t) => !!answers[t.id]?.result).length);
	let nogoCount = $derived(templates.filter((t) => answers[t.id]?.result === 'No-Go').length);
	let unansweredCount = $derived(templates.length - answeredCount);
	let progressPercent = $derived(templates.length > 0 ? Math.round((answeredCount / templates.length) * 100) : 0);

	let filteredTemplates = $derived(
		templates.filter((t) => {
			if (activeFilter === 'unanswered') return !answers[t.id]?.result;
			if (activeFilter === 'nogo') return answers[t.id]?.result === 'No-Go';
			return true;
		})
	);

	// B5 — autosave draft tiap kali isian berubah, setelah draft lama (kalau ada) selesai dipulihkan.
	$effect(() => {
		if (!draftRestored) return;
		const serializable: Record<string, { result: 'Go' | 'No-Go' | null; notes: string; foto?: string | null; numeric_value?: number | null; text_value?: string | null }> = {};
		for (const [id, a] of Object.entries(answers)) {
			serializable[id] = { result: a.result, notes: a.notes, foto: a.foto ?? null, numeric_value: a.numeric_value ?? null, text_value: a.text_value ?? null };
		}
		saveP2hDraft(equipmentId, today, {
			answers: serializable,
			keteranganTambahan,
			hoursmeterInput,
			fotoUnitFileId
		});
	});

	let allAnswered = $derived(templates.length > 0 && templates.every((t) => answers[t.id]?.result));
	let allRequiredPhotosAttached = $derived(
		templates.every((t) => !t.wajib_foto || !!answers[t.id]?.foto)
	);
	let anyPhotoUploading = $derived(
		templates.some((t) => answers[t.id]?.uploading)
	);
	let canSubmit = $derived(allAnswered && allRequiredPhotosAttached && !anyPhotoUploading);


	async function handleCloseSession() {
		if (closingSession || !todaySession) return;
		if (!closeSignaturePad || closeSignaturePad.isEmpty()) {
			closeError = 'Tanda tangan wajib diisi.';
			return;
		}
		closingSession = true;
		closeError = '';
		try {
			const signatureData = closeSignaturePad.toDataURL();
			const result = await closeP2hSessionAtomic(todaySession.id, signatureData, closeCatatan.trim() || undefined);
			if ('queued' in result) {
				closeSuccess = true;
				todaySession = { ...todaySession, jam_selesai_pakai: new Date().toISOString() };
			} else {
				todaySession = result.session;
				closeSuccess = true;
			}
			showCloseForm = false;
		} catch (err: any) {
			closeError = err?.message || 'Gagal menutup sesi P2H.';
		} finally {
			closingSession = false;
		}
	}

	async function handleSubmit() {
		if (!canSubmit || submitting) return;
		for (const t of templates) {
			if (t.wajib_foto && !answers[t.id]?.foto) {
				errorMsg = `Foto bukti wajib diunggah untuk item: ${t.item_name}`;
				return;
			}
		}
		if (!signaturePad || signaturePad.isEmpty()) {
			errorMsg = 'Tanda tangan wajib diisi.';
			return;
		}
		submitting = true;
		errorMsg = '';
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama operator tidak ditemukan di sesi login.');

			const signatureData = signaturePad.toDataURL();
			if (!signatureData) throw new Error('Tanda tangan gagal diproses.');

			const sessionParsed = p2hSessionSchema.safeParse({
				equipment_id: equipmentId,
				date: today,
				keterangan_tambahan: keteranganTambahan.trim() || undefined,
				foto_unit: fotoUnitFileId || undefined,
				gps_lat: gpsPosition?.lat ?? null,
				gps_lng: gpsPosition?.lng ?? null,
				hoursmeter: hoursmeterInput ?? null,
				signature: signatureData
			});
			if (!sessionParsed.success) {
				errorMsg = sessionParsed.error.issues[0]?.message || 'Data sesi P2H tidak valid.';
				submitting = false;
				return;
			}

			const checklistItems = templates.map((t) => {
				const answerParsed = p2hAnswerSchema.safeParse({
					result: answers[t.id].result,
					notes: answers[t.id].notes,
					foto: answers[t.id].foto || null,
					numeric_value: answers[t.id].numeric_value ?? null,
					text_value: answers[t.id].text_value || null
				});
				if (!answerParsed.success) {
					throw new Error(`Jawaban item "${t.item_name}" tidak valid: ${answerParsed.error.issues[0]?.message}`);
				}
				return { template: t, ...answerParsed.data };
			});

			const result = await submitP2hSessionAtomic(
				{
					...sessionParsed.data,
					scan_method: scanMethod
				},
				checklistItems
			);

			if ('queued' in result) {
				successInfo = { hasNoGo: false, workOrderCreated: false, queued: true };
			} else {
				await logActivity({
					user_name: karyawanName,
					action: 'create',
					entity_type: 'p2h_session',
					entity_id: equipmentId,
					summary: `P2H harian ${equipment.name} — ${checklistItems.some((c) => c.result === 'No-Go') ? 'ada No-Go' : 'semua Go'}`
				});
				successInfo = {
					hasNoGo: checklistItems.some((c) => c.result === 'No-Go'),
					workOrderCreated: !!result.workOrder,
					workOrderId: result.workOrder?.id ?? null,
					queued: false
				};
			}
			// B5 — sukses terkirim (langsung atau diantre) berarti draft lokal sudah tidak relevan.
			clearP2hDraft(equipmentId, today);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim ceklist P2H.';
		} finally {
			submitting = false;
		}
	}
</script>

{#snippet photoMessageBox(slot: string)}
	{#if photoMessages[slot]}
		<p
			role={photoMessages[slot].tone === 'error' ? 'alert' : 'status'}
			class="text-[11px] leading-snug px-2.5 py-1.5 rounded-lg border {photoMessages[slot].tone === 'error'
				? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
				: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'}"
		>
			{photoMessages[slot].tone === 'error' ? '⚠️' : 'ℹ️'} {photoMessages[slot].text}
		</p>
	{/if}
{/snippet}

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24 no-print">
		{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat checklist inspeksi P2H..." />
		</div>
		{:else if errorMsg && !equipment}
			<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">{errorMsg}</div>
		{:else}
			<div class="flex items-center justify-between mb-4">
				<button class="flex items-center gap-1.5 text-[12px] font-medium" style="color: var(--sys-label3)" onclick={() => goto('/preventive')}>
					<IconArrowLeft size={15} /> Kembali
				</button>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="px-3 py-1.5 rounded-lg text-[12px] font-semibold border flex items-center gap-1.5"
						style="border-color: var(--sys-sep); color: var(--sys-label2)"
						onclick={() => goto(`/preventive/riwayat/${equipmentId}`)}
					>
						<IconClock size={15} /> Riwayat
					</button>
					<button
						type="button"
						class="px-3 py-1.5 rounded-lg text-[12px] font-semibold border flex items-center gap-1.5"
						style="border-color: var(--sys-sep); color: var(--sys-label2)"
						onclick={() => window.print()}
					>
						<IconPrinter size={15} /> Cetak Versi Kertas
					</button>
				</div>
			</div>

			{#if hadDraft && !successInfo}
				<div class="mb-4 px-3 py-2 rounded-lg text-[12px] font-medium bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
					Isian sebelumnya yang belum terkirim sudah dipulihkan.
				</div>
			{/if}

			{#if successInfo}
				<div class="text-center py-16">
					<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
					<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">
						{successInfo.queued ? 'Ceklist P2H diantre' : 'Ceklist P2H tersimpan'}
					</p>
					<p class="text-[12px] mt-1" style="color: var(--sys-label3)">
						{#if successInfo.queued}
							Sinyal sedang lemah — ceklist disimpan di HP dan akan otomatis terkirim saat sinyal kembali.
						{:else if successInfo.workOrderCreated}
							Ada item No-Go — work order otomatis dibuat.
						{:else if successInfo.hasNoGo}
							Ada item No-Go, dicatat di sesi.
						{:else}
							Semua item Go.
						{/if}
					</p>
					{#if successInfo.workOrderCreated && successInfo.workOrderId}
						<button
							class="mt-5 mb-2 px-4 py-2 rounded-lg text-[12px] font-semibold text-white flex items-center gap-1.5 mx-auto"
							style="background: #DC2626"
							onclick={() => {
								const nogoNames = templates
									.filter((t) => answers[t.id]?.result === 'No-Go')
									.map((t) => t.item_name)
									.join(', ');
								const params = new URLSearchParams({
									kategori: 'INV-SPR',
									work_order_id: String(successInfo?.workOrderId),
									equipment: equipment?.name || '',
									keluhan: nogoNames
								});
								goto(`/procurement/ajukan?${params.toString()}`);
							}}
						>
							🔧 Ajukan Sparepart untuk Unit Ini
						</button>
					{/if}
					<button
						class="mt-2 px-4 py-2 rounded-lg text-[12px] font-semibold text-white"
						style="background: var(--g)"
						onclick={() => goto('/preventive')}
					>
						Kembali ke Daftar Unit
					</button>
				</div>
			{:else if alreadySubmitted}
				<div class="text-center py-10">
					<IconCircleCheck size={36} style="color: #16A34A; margin: 0 auto" />
					<p class="text-[13px] font-semibold mt-3" style="color: var(--sys-label)">P2H hari ini sudah diisi</p>

					{#if todayLogs.length > 0}
						<button
							class="mt-3 mx-auto flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border"
							style="border-color: var(--sys-sep); color: var(--sys-label3)"
							onclick={() => (showExportSheet = true)}
						>
							<IconPrinter size={13} /> Bagikan Hasil P2H (PDF)
						</button>
					{/if}

					{#if todaySession?.jam_selesai_pakai}
						<div class="mt-4 mx-auto max-w-xs px-3 py-2 rounded-lg text-[12px] font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
							✓ Pemakaian sudah ditutup pukul {new Date(todaySession.jam_selesai_pakai).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
						</div>
					{:else if closeSuccess}
						<div class="mt-4 mx-auto max-w-xs px-3 py-2 rounded-lg text-[12px] font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
							✓ Penutupan pemakaian tersimpan.
						</div>
					{:else if !showCloseForm}
						<div class="mt-5 mx-auto max-w-xs px-4 py-3 rounded-xl border" style="border-color: var(--sys-sep)">
							<p class="text-[11px] font-semibold" style="color: var(--sys-label2)">⏳ Sesi ini belum ditutup</p>
							<p class="text-[10px] mt-1" style="color: var(--sys-label3)">Sudah selesai memakai unit ini hari ini? Konfirmasi kondisi akhir sebelum unit dikembalikan.</p>
							<button
								type="button"
								class="mt-3 px-4 py-2 rounded-lg text-[12px] font-bold text-white w-full"
								style="background: var(--g)"
								onclick={() => (showCloseForm = true)}
							>
								Tutup Pemakaian Unit Ini
							</button>
						</div>
					{:else}
						<div class="mt-5 mx-auto max-w-xs text-left rounded-xl border p-4 space-y-3" style="border-color: var(--sys-sep)">
							<p class="text-[12px] font-bold" style="color: var(--sys-label)">Tutup Pemakaian — {equipment?.name}</p>
							<div>
								<label for="closeCatatan" class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label2)">Catatan kondisi akhir (opsional)</label>
								<textarea
									id="closeCatatan"
									class="w-full rounded-lg border text-[12px] p-2 bg-transparent"
									style="border-color: var(--sys-sep); color: var(--sys-label)"
									placeholder="Mis. ada kerusakan baru selama dipakai..."
									rows="2"
									bind:value={closeCatatan}
								></textarea>
							</div>
							<div>
								<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label2)">Tanda Tangan Digital (Wajib)</label>
								<SignaturePad bind:this={closeSignaturePad} height={120} />
							</div>
							{#if closeError}
								<p class="text-[11px]" style="color: #DC2626">{closeError}</p>
							{/if}
							<div class="flex gap-2">
								<button
									type="button"
									class="flex-1 h-10 rounded-lg text-[12px] font-semibold border"
									style="border-color: var(--sys-sep); color: var(--sys-label2)"
									onclick={() => { showCloseForm = false; closeError = ''; }}
								>
									Batal
								</button>
								<button
									type="button"
									class="flex-1 h-10 rounded-lg text-[12px] font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
									style="background: var(--g)"
									disabled={closingSession}
									onclick={handleCloseSession}
								>
									{#if closingSession}<IconLoader2 size={14} class="animate-spin" />{/if}
									Simpan
								</button>
							</div>
						</div>
					{/if}

					<ComponentVerifySection {equipmentId} sessionId={todaySession?.id ?? null} />

					<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/preventive')}>
						Kembali ke Daftar Unit
					</button>
				</div>
			{:else}
				<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">{equipment?.name}</h1>
				<p class="text-[11px] mb-4" style="color: var(--sys-label3)">P2H harian · {today}</p>
				{#if equipment?.identitas_barang_id}<div class="mb-3"><KnowledgeCard itemId={equipment.identitas_barang_id} context="usage" label="Panduan unit" /></div>{/if}

				<SectionGuide
					id="preventive.p2h.page"
					title={h('p2h.page').sectionGuide?.title}
					steps={h('p2h.page').sectionGuide?.steps ?? []}
				/>

				{#if !scanVerified}
					<div class="text-center py-14 rounded-xl border px-6" style="border-color: var(--sys-sep)">
						<IconQrcode size={36} style="color: var(--g); margin: 0 auto" />
						<p class="text-[13px] font-semibold mt-3" style="color: var(--sys-label)">Scan barcode unit dulu</p>
						<p class="text-[11px] mt-1 max-w-xs mx-auto" style="color: var(--sys-label3)">
							Ceklist P2H hanya bisa diisi setelah scan barcode yang tertempel di unit ini ({equipment?.code}), untuk memastikan operator benar-benar berada di unit yang diperiksa.
						</p>
						{#if scanError}
							<p class="text-[12px] mt-3 px-4" style="color: #DC2626">{scanError}</p>
						{/if}

						{#if !showManualInput}
							<div class="flex flex-col items-center gap-3 mt-5">
								<button
									class="px-5 py-2.5 rounded-xl text-[13px] font-bold text-white inline-flex items-center gap-2"
									style="background: var(--g)"
									onclick={async () => { scanError = ''; await loadQrScannerModal(); showScanner = true; }}
								>
									<IconQrcode size={16} /> Scan Barcode Sekarang
								</button>
								<button
									type="button"
									class="text-[11px] font-medium transition-colors hover:underline"
									style="color: var(--sys-label3)"
									onclick={() => { scanError = ''; showManualInput = true; }}
								>
									Kamera rusak? Masukkan kode secara manual
								</button>
							</div>
						{:else}
							<div class="mt-5 max-w-xs mx-auto">
								<label for="manualCodeInput" class="block text-left text-[11px] font-semibold mb-1" style="color: var(--sys-label2)">
									Masukkan Kode Unit secara manual
								</label>
								<div class="flex gap-2">
									<input
										id="manualCodeInput"
										type="text"
										class="flex-1 px-3 py-2 rounded-lg border text-[13px] bg-transparent"
										style="border-color: var(--sys-sep); color: var(--sys-label)"
										placeholder="Contoh: {equipment?.code}"
										bind:value={manualCode}
										onkeydown={(e) => e.key === 'Enter' && verifyManualCode()}
									/>
									<button
										type="button"
										class="px-4 py-2 rounded-lg text-[13px] font-bold text-white"
										style="background: var(--g)"
										onclick={verifyManualCode}
									>
										Verifikasi
									</button>
								</div>
								<button
									type="button"
									class="mt-3 text-[11px] font-medium hover:underline"
									style="color: var(--sys-label3)"
									onclick={() => { scanError = ''; showManualInput = false; manualCode = ''; }}
								>
									Kembali ke Scan Barcode
								</button>
							</div>
						{/if}
					</div>
				{:else if templates.length === 0}
					<div class="text-center py-12 text-[12px]" style="color: var(--sys-label3)">
						Belum ada template ceklist untuk kategori unit ini.
					</div>
				{:else}
					<!-- Progress & Quick Action Header -->
					<div class="mb-4 rounded-xl border p-3 bg-[var(--sys-fill)] space-y-2.5" style="border-color: var(--sys-sep)">
						<div class="flex items-center justify-between gap-2">
							<div>
								<div class="text-[12px] font-bold" style="color: var(--sys-label)">Progres Pengisian P2H</div>
								<div class="text-[10px]" style="color: var(--sys-label3)">{answeredCount} dari {templates.length} item terisi ({progressPercent}%)</div>
							</div>
							{#if unansweredCount > 0}
								<button
									type="button"
									class="px-3 py-1.5 rounded-lg text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-900/50 flex items-center gap-1 shrink-0"
									onclick={setAllGo}
								>
									⚡ Set Semua Go ({unansweredCount})
								</button>
							{/if}
						</div>

						<div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
							<div class="bg-emerald-600 h-1.5 rounded-full transition-all duration-300" style="width: {progressPercent}%"></div>
						</div>

						<div class="flex items-center gap-1.5 pt-1 overflow-x-auto text-[11px]">
							<button
								type="button"
								class="px-2.5 py-1 rounded-md font-semibold transition-colors whitespace-nowrap {activeFilter === 'all' ? 'bg-emerald-600 text-white' : 'border border-[var(--sys-sep)] text-[var(--sys-label2)] hover:bg-[var(--sys-fill2)]'}"
								onclick={() => activeFilter = 'all'}
							>
								Semua ({templates.length})
							</button>
							<button
								type="button"
								class="px-2.5 py-1 rounded-md font-semibold transition-colors whitespace-nowrap {activeFilter === 'unanswered' ? 'bg-amber-500 text-white' : 'border border-[var(--sys-sep)] text-[var(--sys-label2)] hover:bg-[var(--sys-fill2)]'}"
								onclick={() => activeFilter = 'unanswered'}
							>
								Belum Diisi ({unansweredCount})
							</button>
							<button
								type="button"
								class="px-2.5 py-1 rounded-md font-semibold transition-colors whitespace-nowrap {activeFilter === 'nogo' ? 'bg-red-600 text-white' : 'border border-[var(--sys-sep)] text-[var(--sys-label2)] hover:bg-[var(--sys-fill2)]'}"
								onclick={() => activeFilter = 'nogo'}
							>
								No-Go ({nogoCount})
							</button>
						</div>
					</div>

					<div class="mb-4 rounded-xl border p-3 flex items-center justify-between gap-2 flex-wrap" style="border-color: var(--sys-sep)">
						<div>
							<div class="text-[11px] font-bold" style="color: var(--sys-label)">Mode Unggah Foto</div>
							<div class="text-[10px]" style="color: var(--sys-label3)">
								{#if photoUploadMode === 'compress'}
									Foto dikompres dulu sebelum diunggah (hemat kuota).
								{:else}
									Foto diunggah asli tanpa dikompres (lebih berat, tapi aman kalau HP sering blank/refresh saat kompresi).
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-1.5 text-[11px]">
							<button
								type="button"
								class="px-2.5 py-1 rounded-md font-semibold transition-colors whitespace-nowrap {photoUploadMode === 'compress' ? 'bg-emerald-600 text-white' : 'border border-[var(--sys-sep)] text-[var(--sys-label2)] hover:bg-[var(--sys-fill2)]'}"
								onclick={() => setPhotoUploadMode('compress')}
							>
								🗜️ Kompres Otomatis
							</button>
							<button
								type="button"
								class="px-2.5 py-1 rounded-md font-semibold transition-colors whitespace-nowrap {photoUploadMode === 'direct' ? 'bg-emerald-600 text-white' : 'border border-[var(--sys-sep)] text-[var(--sys-label2)] hover:bg-[var(--sys-fill2)]'}"
								onclick={() => setPhotoUploadMode('direct')}
							>
								📤 Upload Langsung
							</button>
						</div>
					</div>

					<!-- Dua hint ini berlaku untuk SEMUA item, jadi ditaruh sekali di sini.
					     Kalau dipasang per item, teksnya terulang 20+ kali dan justru
					     menenggelamkan isi ceklistnya sendiri. -->
					<FieldHint text={h('p2h.form.hasilItem').fieldHint} />
					<FieldHint
						text={h('p2h.form.fotoItem').fieldHint}
						type={h('p2h.form.fotoItem').type}
					/>

					<div class="flex flex-col gap-3 mt-3">
						{#each filteredTemplates as t (t.id)}
							<div id="p2h-item-{t.id}" class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
								<div class="flex items-start justify-between gap-2 mb-2">
									<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{t.item_name}</p>
									<div class="flex items-center gap-1.5 shrink-0">
										{#if t.wajib_foto}
											<span class="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
												📷 Wajib Foto
											</span>
										{/if}
										{#if t.is_critical}
											<StatusExplainer status="KRITIS" explain={h('p2h.status.kritis').explain}>
												<span class="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded" style="background:var(--rel); color:var(--red)">
													<IconAlertTriangle size={10} /> KRITIS
												</span>
											</StatusExplainer>
										{/if}
									</div>
								</div>
								{#if t.go_criteria}
									<p class="text-[11px] mb-2" style="color: var(--sys-label2)">{t.go_criteria}</p>
								{/if}

								{#if t.input_type === 'number'}
									<div class="mt-2 mb-3.5 p-2.5 rounded-lg border flex flex-col gap-2 bg-[var(--sys-fill)]" style="border-color: var(--sys-sep)">
										<div class="flex items-center justify-between gap-2">
											<label class="text-[11px] font-semibold whitespace-nowrap inline-flex items-center gap-1" style="color: var(--sys-label2)">
												Nilai ({t.unit_of_measure || 'Nilai'}):<HelpIcon text={h('p2h.form.nilaiNumerik').helpIcon} position="bottom" />
											</label>
											{#if answers[t.id]?.numeric_value !== undefined && answers[t.id]?.numeric_value !== null && !isNaN(Number(answers[t.id].numeric_value))}
												{#if (t.min_value !== undefined && t.min_value !== null && Number(answers[t.id].numeric_value) < t.min_value) || (t.max_value !== undefined && t.max_value !== null && Number(answers[t.id].numeric_value) > t.max_value)}
													<span class="text-[9px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
														⚠ Diluar Rentang Aman [{t.min_value ?? '∞'} - {t.max_value ?? '∞'}]
													</span>
												{:else}
													<span class="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
														✓ Aman Dalam Rentang [{t.min_value ?? '∞'} - {t.max_value ?? '∞'}]
													</span>
												{/if}
											{/if}
										</div>
										<input
											type="number"
											step="any"
											placeholder={t.min_value !== null || t.max_value !== null ? `Rentang aman: [${t.min_value ?? '∞'} - ${t.max_value ?? '∞'}]` : 'Masukkan angka...'}
											class="w-full px-3 py-1.5 rounded-lg border text-[13px] bg-transparent outline-none focus:ring-1 focus:ring-emerald-500"
											style="border-color: var(--sys-sep); color: var(--sys-label)"
											bind:value={answers[t.id].numeric_value}
											aria-describedby={`nilai-hint-${t.id}`}
											oninput={() => {
												const val = answers[t.id].numeric_value;
												if (val !== undefined && val !== null && !isNaN(val)) {
													if ((t.min_value !== undefined && t.min_value !== null && val < t.min_value) || (t.max_value !== undefined && t.max_value !== null && val > t.max_value)) {
														answers[t.id].result = 'No-Go';
													} else {
														answers[t.id].result = 'Go';
													}
												}
											}}
										/>
										<div id={`nilai-hint-${t.id}`}>
											<FieldHint text={h('p2h.form.nilaiNumerik').fieldHint} />
										</div>
									</div>
								{:else if t.input_type === 'string'}
									<div class="mt-2 mb-3.5 p-2.5 rounded-lg border flex items-center gap-3 bg-[var(--sys-fill)]" style="border-color: var(--sys-sep)">
										<label class="text-[11px] font-semibold whitespace-nowrap" style="color: var(--sys-label2)">
											Teks:
										</label>
										<input
											type="text"
											placeholder="Tuliskan keterangan..."
											class="flex-1 px-3 py-1.5 rounded-lg border text-[13px] bg-transparent outline-none focus:ring-1 focus:ring-emerald-500"
											style="border-color: var(--sys-sep); color: var(--sys-label)"
											bind:value={answers[t.id].text_value}
										/>
									</div>
								{:else if t.input_type === 'date'}
									<div class="mt-2 mb-3.5 p-2.5 rounded-lg border flex items-center gap-3 bg-[var(--sys-fill)]" style="border-color: var(--sys-sep)">
										<label class="text-[11px] font-semibold whitespace-nowrap" style="color: var(--sys-label2)">
											Tanggal:
										</label>
										<input
											type="date"
											class="flex-1 px-3 py-1.5 rounded-lg border text-[13px] bg-transparent outline-none focus:ring-1 focus:ring-emerald-500"
											style="border-color: var(--sys-sep); color: var(--sys-label)"
											bind:value={answers[t.id].text_value}
										/>
									</div>
								{:else if t.input_type === 'time'}
									<div class="mt-2 mb-3.5 p-2.5 rounded-lg border flex items-center gap-3 bg-[var(--sys-fill)]" style="border-color: var(--sys-sep)">
										<label class="text-[11px] font-semibold whitespace-nowrap" style="color: var(--sys-label2)">
											Waktu:
										</label>
										<input
											type="time"
											class="flex-1 px-3 py-1.5 rounded-lg border text-[13px] bg-transparent outline-none focus:ring-1 focus:ring-emerald-500"
											style="border-color: var(--sys-sep); color: var(--sys-label)"
											bind:value={answers[t.id].text_value}
										/>
									</div>
								{/if}

								<div class="grid grid-cols-2 gap-2">
									<button
										class="h-11 rounded-lg text-[13px] font-bold flex items-center justify-center gap-1.5 transition-colors"
										style={answers[t.id]?.result === 'Go' ? 'background:#16A34A; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
										onclick={() => setResult(t.id, 'Go')}
									>
										<IconCheck size={16} /> Go
									</button>
									<button
										class="h-11 rounded-lg text-[13px] font-bold flex items-center justify-center gap-1.5 transition-colors"
										style={answers[t.id]?.result === 'No-Go' ? 'background:#DC2626; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
										onclick={() => setResult(t.id, 'No-Go')}
									>
										<IconX size={16} /> No-Go
									</button>
								</div>
								{#if answers[t.id]?.result === 'No-Go'}
									<textarea
										class="w-full mt-2 rounded-lg border text-[12px] p-2 bg-transparent"
										style="border-color: var(--sys-sep); color: var(--sys-label)"
										placeholder="Catatan kerusakan (opsional)"
										rows="2"
										bind:value={answers[t.id].notes}
									></textarea>
									<FieldHint text={h('p2h.form.catatanNoGo').fieldHint} />

									{#if t.action_if_nogo_operator || t.action_if_nogo_mekanik}
										<div class="mt-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
											{#if t.action_if_nogo_operator}
												<div><strong class="text-amber-950 dark:text-amber-100">⚡ Tindakan Operator:</strong> {t.action_if_nogo_operator}</div>
											{/if}
											{#if t.action_if_nogo_mekanik}
												<div><strong class="text-amber-950 dark:text-amber-100">🛠️ Tindakan Mekanik:</strong> {t.action_if_nogo_mekanik}</div>
											{/if}
										</div>
									{/if}
								{/if}
								<div class="mt-2.5 pt-2 border-t border-dashed flex flex-col gap-2" style="border-color: var(--sys-sep)">
									<div class="flex items-center gap-2 flex-wrap">
										<label
											class="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors"
											style={photoButtonStyle(t.id, !!t.wajib_foto)}
										>
											📷 {answers[t.id]?.foto ? 'Ganti (Kamera)' : 'Ambil Foto'}
											<input type="file" accept="image/*" capture="environment" class="hidden" onclick={() => markPendingPhoto(t.id, 'picking')} oncancel={clearPendingPhoto} onchange={(e) => handleItemFotoUpload(t.id, e)} disabled={answers[t.id]?.uploading} />
										</label>
										<label
											class="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors"
											style={photoButtonStyle(t.id, !!t.wajib_foto)}
										>
											🖼️ {answers[t.id]?.foto ? 'Ganti (Galeri)' : 'Unggah dari Galeri'}
											<input type="file" accept="image/*" class="hidden" onclick={() => markPendingPhoto(t.id, 'picking')} oncancel={clearPendingPhoto} onchange={(e) => handleItemFotoUpload(t.id, e)} disabled={answers[t.id]?.uploading} />
										</label>
									</div>
									<div class="flex items-center justify-end gap-2">
										{#if answers[t.id]?.uploading}
											<span class="text-[10px] animate-pulse" style="color: var(--sys-label3)">Mengunggah…</span>
										{:else if answers[t.id]?.fotoPreview}
											<div class="flex items-center gap-1.5">
												<span class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓ Terlampir</span>
												<img src={answers[t.id].fotoPreview} alt="Foto Preview" class="w-10 h-10 object-cover rounded-lg border border-emerald-500/40" />
											</div>
										{:else if t.wajib_foto}
											<span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">Wajib Upload Foto</span>
										{/if}
									</div>
									{@render photoMessageBox(t.id)}
								</div>
							</div>
						{/each}
					</div>

					<!-- Keterangan Tambahan & Foto Unit -->
					<div class="mt-5 rounded-xl border p-4 space-y-4" style="border-color: var(--sys-sep)">
						<h3 class="text-[13px] font-bold" style="color: var(--sys-label)">Informasi Tambahan</h3>
						
						<div id="p2h-foto-unit">
							<label class="block text-[11px] font-semibold mb-1.5" style="color: var(--sys-label2)">
								Foto Unit / Bukti Inspeksi (Opsional)
							</label>
							<div class="flex items-center gap-2 flex-wrap">
								<label class="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold border text-white" style="background: var(--g)">
									📷 {fotoUnitPreview ? 'Ganti (Kamera)' : 'Ambil Foto'}
									<input type="file" accept="image/*" capture="environment" class="hidden" onclick={() => markPendingPhoto(UNIT_SLOT, 'picking')} oncancel={clearPendingPhoto} onchange={handleFotoUnitUpload} disabled={uploadingFotoUnit} />
								</label>
								<label class="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold border" style="border-color: var(--sys-sep); color: var(--sys-label2)">
									🖼️ {fotoUnitPreview ? 'Ganti (Galeri)' : 'Unggah dari Galeri'}
									<input type="file" accept="image/*" class="hidden" onclick={() => markPendingPhoto(UNIT_SLOT, 'picking')} oncancel={clearPendingPhoto} onchange={handleFotoUnitUpload} disabled={uploadingFotoUnit} />
								</label>
								{#if uploadingFotoUnit}
									<span class="text-[11px] animate-pulse" style="color: var(--sys-label3)">Mengunggah…</span>
								{:else if fotoUnitPreview}
									<img src={fotoUnitPreview} alt="Foto Unit Preview" class="w-16 h-12 object-cover rounded-lg border" />
								{/if}
							</div>
							{#if photoMessages[UNIT_SLOT]}
								<div class="mt-2">{@render photoMessageBox(UNIT_SLOT)}</div>
							{/if}
							<FieldHint text={h('p2h.form.fotoUnit').fieldHint} />
						</div>

						<div>
							<label for="keterangan" class="block text-[11px] font-semibold mb-1.5" style="color: var(--sys-label2)">
								Keterangan Tambahan (Opsional)
							</label>
							<textarea
								id="keterangan"
								class="w-full rounded-lg border text-[12px] p-2.5 bg-transparent"
								style="border-color: var(--sys-sep); color: var(--sys-label)"
								placeholder="Tulis keterangan atau catatan umum untuk unit..."
								rows="3"
								bind:value={keteranganTambahan}
							></textarea>
							<FieldHint text={h('p2h.form.keterangan').fieldHint} />
						</div>

						<div>
							<label class="block text-[11px] font-semibold mb-1.5" style="color: var(--sys-label2)">
								Tanda Tangan Digital (Wajib)
							</label>
							<SignaturePad bind:this={signaturePad} height={140} />
							<FieldHint
								text={h('p2h.form.ttd').fieldHint}
								type={h('p2h.form.ttd').type}
							/>
						</div>

						{#if isCompressorUnit || isForkliftUnit || isProduksiUnit}
							<div>
								<label for="hoursmeter" class="block text-[11px] font-semibold mb-1.5" style="color: var(--sys-label2)">
									Hour Meter Hari Ini (Opsional)
								</label>
								<input
									id="hoursmeter"
									type="number"
									step="0.1"
									min="0"
									class="w-full rounded-lg border text-[12px] p-2.5 bg-transparent"
									style="border-color: var(--sys-sep); color: var(--sys-label)"
									placeholder="Contoh: 1250.5"
									bind:value={hoursmeterInput}
								/>
								<FieldHint text={h('p2h.form.hourMeter').fieldHint} />
							</div>
						{:else if isVehicleUnit}
							<div>
								<label for="hoursmeter" class="block text-[11px] font-semibold mb-1.5" style="color: var(--sys-label2)">
									Kilometer Hari Ini (Opsional)
								</label>
								<input
									id="hoursmeter"
									type="number"
									step="1"
									min="0"
									class="w-full rounded-lg border text-[12px] p-2.5 bg-transparent"
									style="border-color: var(--sys-sep); color: var(--sys-label)"
									placeholder="Contoh: 120500"
									bind:value={hoursmeterInput}
								/>
								<FieldHint text={h('p2h.form.hourMeter').fieldHint} />
							</div>
						{/if}

						<p class="text-[10px]" style="color: var(--sys-label3)">
							{#if gpsPosition}
								Lokasi tercatat ({gpsPosition.lat.toFixed(5)}, {gpsPosition.lng.toFixed(5)})
							{:else if gpsError}
								Lokasi tidak tersedia — {gpsError}
							{:else}
								Mengambil lokasi…
							{/if}
						</p>
						{#if gpsPosition}
							<button
								type="button"
								class="text-[10px] font-semibold flex items-center gap-1 mt-1"
								style="color: var(--g, #1F6592)"
								onclick={toggleLocationMap}
							>
								📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
							</button>
							{#if showLocationMap && LocationMap}
								<div transition:slide={{ duration: 200 }} class="mt-1">
									<LocationMap lat={gpsPosition.lat} lng={gpsPosition.lng} label="Lokasi P2H" height="200px" />
								</div>
							{/if}
						{/if}
					</div>

					{#if errorMsg}
						<p class="text-[12px] mt-3" style="color: #DC2626">{errorMsg}</p>
					{:else if allAnswered && anyPhotoUploading}
						<p class="text-[12px] mt-3 font-medium animate-pulse" style="color: var(--sys-label3)">Sedang mengunggah foto bukti...</p>
					{:else if allAnswered && !allRequiredPhotosAttached}
						<p class="text-[12px] mt-3 font-medium" style="color: #D97706">Ada item checklist yang mewajibkan foto bukti (Wajib Foto) yang belum diunggah.</p>
					{/if}

					<button
						class="w-full h-12 mt-5 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
						style="background: var(--g)"
						disabled={!canSubmit || submitting}
						onclick={handleSubmit}
					>
						{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
						Submit Ceklist
					</button>
				{/if}
			{/if}
		{/if}
	</div>

	{#if !loading && equipment}
		<div class="print-only print-container">
			<div class="print-header">
				<h1 class="print-title">LEMBAR PEMELIHARAAN & PEMERIKSAAN HARIAN (P2H)</h1>
				<p class="print-subtitle">PT. ELTAMA PRIMA INDO</p>
			</div>

			<div class="print-metadata">
				<table class="metadata-table">
					<tbody>
						<tr>
							<td class="meta-label">Nama Unit</td>
							<td class="meta-value">: {equipment?.name || '-'}</td>
							<td class="meta-label">Hari / Tanggal</td>
							<td class="meta-value">: .............................................</td>
						</tr>
						<tr>
							<td class="meta-label">Kode Unit</td>
							<td class="meta-value">: {equipment?.code || '-'}</td>
							<td class="meta-label">Shift / Waktu</td>
							<td class="meta-value">: .............................................</td>
						</tr>
						<tr>
							<td class="meta-label">Kategori Unit</td>
							<td class="meta-value">: {categoryName || '-'}</td>
							<td class="meta-label">Nama Operator</td>
							<td class="meta-value">: .............................................</td>
						</tr>
						<tr>
							<td class="meta-label">HM / KM Awal</td>
							<td class="meta-value">: .............................................</td>
							<td class="meta-label">HM / KM Akhir</td>
							<td class="meta-value">: .............................................</td>
						</tr>
					</tbody>
				</table>
			</div>

			<div class="print-instructions">
				<p><strong>Petunjuk Pengisian:</strong> Berikan tanda centang (✓) pada kolom <strong>Go</strong> jika kondisi baik/aman, atau <strong>No-Go</strong> jika terjadi kerusakan/tidak aman, serta tuliskan catatan detail jika memilih No-Go.</p>
			</div>

			<table class="print-table">
				<thead>
					<tr>
						<th style="width: 5%; text-align: center;">No</th>
						<th style="width: 40%;">Item Pemeriksaan / Bagian yang Diperiksa</th>
						<th style="width: 25%;">Kriteria Baik (Go)</th>
						<th style="width: 15%; text-align: center;">Kondisi</th>
						<th style="width: 15%;">Catatan Kerusakan</th>
					</tr>
				</thead>
				<tbody>
					{#each templates as t, index (t.id)}
						<tr>
							<td class="text-center">{index + 1}</td>
							<td>
								<span style="font-weight: 600;">{t.item_name}</span>
								{#if t.is_critical}
									<span class="critical-badge">⚠ KRITIS</span>
								{/if}
							</td>
							<td class="text-gray-600">{t.go_criteria || '-'}</td>
							<td class="text-center">
								<div class="checkbox-container">
									<span class="checkbox-box">[  ] Go</span>
									<span class="checkbox-box">[  ] No-Go</span>
								</div>
							</td>
							<td class="notes-line"></td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="print-footer">
				<div class="additional-notes">
					<p style="font-weight: 600; margin-bottom: 4px;">Keterangan Tambahan / Catatan Umum Operator:</p>
					<div class="blank-lines">
						<div class="line"></div>
						<div class="line"></div>
					</div>
				</div>

				<div class="signature-grid">
					<div class="signature-box">
						<p>Dilaporkan Oleh,</p>
						<div class="signature-space"></div>
						<p class="signature-name">..................................................</p>
						<p class="signature-title">Operator / Mekanik</p>
					</div>
					<div class="signature-box">
						<p>Diperiksa Oleh,</p>
						<div class="signature-space"></div>
						<p class="signature-name">..................................................</p>
						<p class="signature-title">Pengawas / Supervisor</p>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

{#if showScanner}
	{#if QrScannerModal}
		<QrScannerModal expectedPrefix="EPI:EQUIPMENT:" onDetect={onScanDetect} onClose={() => (showScanner = false)} />
	{/if}
{/if}

{#if todaySession}
	<FieldExportSheet
		open={showExportSheet}
		onClose={() => (showExportSheet = false)}
		judul={`Hasil P2H — ${equipment?.name || equipmentId}`}
		filename={`p2h-${equipmentId}-${today}`}
		columns={exportColumns}
		rows={exportRows}
		formats={['pdf']}
	/>
{/if}

<style>
	.print-only {
		display: none;
	}

	@media print {
		:global(body) {
			background: white !important;
			color: black !important;
		}
		:global(.no-print) {
			display: none !important;
		}
		:global(.scroll-body) {
			overflow: visible !important;
			height: auto !important;
			padding: 0 !important;
		}
		.print-only {
			display: block !important;
		}

		.print-container {
			font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			color: #000;
			background: #fff;
			padding: 10px;
			max-width: 100%;
			margin: 0 auto;
		}

		.print-container {
			font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			color: #000;
			background: #fff;
			padding: 5px;
			max-width: 100%;
			margin: 0 auto;
		}

		.print-header {
			border-bottom: 2px solid #000;
			padding-bottom: 5px;
			margin-bottom: 10px;
			text-align: center;
		}

		.print-title {
			font-size: 14px;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: 0.5px;
			margin: 0;
		}

		.print-subtitle {
			font-size: 10px;
			font-weight: 600;
			color: #374151;
			margin: 2px 0 0 0;
		}

		.metadata-table {
			width: 100%;
			border-collapse: collapse;
			margin-bottom: 10px;
		}

		.metadata-table td {
			padding: 3px 5px;
			font-size: 10px;
			vertical-align: top;
		}

		.meta-label {
			font-weight: 600;
			width: 18%;
		}

		.meta-value {
			width: 32%;
		}

		.print-instructions {
			font-size: 9px;
			background: #f3f4f6;
			border: 1px solid #e5e7eb;
			padding: 5px 8px;
			border-radius: 4px;
			margin-bottom: 10px;
		}

		.print-table {
			width: 100%;
			border-collapse: collapse;
			margin-bottom: 12px;
		}

		.print-table th, .print-table td {
			border: 1px solid #000;
			padding: 4px 6px;
			font-size: 9px;
			text-align: left;
			vertical-align: middle;
		}

		.print-table th {
			background-color: #f3f4f6;
			font-weight: 700;
			text-transform: uppercase;
		}

		.text-center {
			text-align: center !important;
		}

		.critical-badge {
			display: inline-block;
			background-color: #fee2e2;
			color: #991b1b;
			border: 1px solid #fca5a5;
			font-size: 8px;
			font-weight: 700;
			padding: 1px 3px;
			border-radius: 2px;
			margin-left: 4px;
		}

		.checkbox-container {
			display: flex;
			justify-content: center;
			gap: 10px;
		}

		.checkbox-box {
			font-family: monospace;
			font-size: 9px;
			white-space: nowrap;
		}

		.notes-line {
			height: 18px;
		}

		.print-footer {
			margin-top: 10px;
			page-break-inside: avoid;
		}

		.additional-notes {
			margin-bottom: 10px;
		}

		.blank-lines {
			margin-top: 4px;
		}

		.blank-lines .line {
			border-bottom: 1px dashed #9ca3af;
			height: 15px;
		}

		.signature-grid {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 20px;
			margin-top: 10px;
		}

		.signature-box {
			text-align: center;
			font-size: 10px;
		}

		.signature-space {
			height: 35px;
		}

		.signature-name {
			font-weight: 600;
			margin-bottom: 2px;
		}

		.signature-title {
			color: #4b5563;
			font-size: 9px;
		}
	}
</style>
