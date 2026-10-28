<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import {
		fetchActiveRoutes, fetchRouteById, fetchCheckpointByCode, fetchActiveCheckpoints,
		getActivePatrolLog, startPatrolLog, finishPatrolLog, submitPatrolScan, fetchScansForLog,
		uploadSecurityFoto, fetchGaAreasSimple, fetchPatrolLogsHistory, fetchSatpamSchedules,
		startDwellWork, finishDwellWork, submitIncident,
		type PatrolRoute, type Checkpoint, type GaArea
	} from '$lib/services/security';
	import {
		fetchTemplateWithItems, submitSecurityChecklistResponse,
		type ChecklistItemDef, type ItemAnswer
	} from '$lib/services/gaChecklist';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import { isVelocityViolation, velocitySecondsRemaining, isPatrolDurationViolation, isDwellViolation } from '$lib/utils/patrolThresholds';
	import { fetchPatrolControlSettings, PATROL_CONTROL_DEFAULTS, type PatrolControlSettings } from '$lib/services/patrolControl';
	import {
		enqueuePatrolSubmission, getQueuedPatrolSubmissions, flushPatrolSubmissionQueue, registerPatrolSubmissionAutoFlush,
		type QueuedPatrolSubmission
	} from '$lib/utils/offlinePatrolScanQueue';
	// Dimuat dinamis (rencana v2, 1.3): jsQR & kamera baru diunduh saat benar-benar dipakai.
	import QrScannerModal from '$lib/components/scanner/QrScannerModal.svelte';
	let CameraCaptureModal = $state<any>(null);
	let cameraLoadFailed = $state(false);
	async function loadCameraCaptureModal() {
		if (CameraCaptureModal) return;
		try {
			CameraCaptureModal = (await import('$lib/components/scanner/CameraCaptureModal.svelte')).default;
		} catch (err) {
			console.error('[patroli] CameraCaptureModal gagal dimuat, pakai fallback input file:', err);
			cameraLoadFailed = true;
		}
	}
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { vibrateTap } from '$lib/utils/haptic';
	import {
		IconLoader2, IconArrowLeft, IconCircleCheck, IconCircle, IconQrcode, IconCamera, IconX, IconTrash,
		IconChevronDown, IconChevronUp, IconTrophy, IconAward, IconChartBar, IconStar
	} from '@tabler/icons-svelte';

	const ROUTE_STORAGE_PREFIX = 'satpam_patrol_route_';
	// Draft popup Checklist Pos disimpan di sessionStorage supaya tidak hilang bila tab
	// ter-refresh oleh OS saat membuka kamera native untuk mengambil foto (bug refresh kamera).
	const CHECKLIST_DRAFT_KEY = 'satpam_checklist_draft_v1';
	// Masa berlaku draf (rencana v2, Fase 3, 3.1) — draf kemarin tidak boleh muncul di form hari ini.
	const CHECKLIST_DRAFT_TTL_MS = 12 * 60 * 60 * 1000;
	let checklistDraftSavedAt = $state<Date | null>(null);

	// Radius toleransi GPS vs checkpoint (meter) — GPS hanya penanda, bukan bukti utama (QR tetap wajib).
	const GPS_TOLERANCE_METERS = 150;

	let loading = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');

	let karyawanId = $state<number | null>(null);
	let activeLog = $state<any>(null);
	let routes = $state<PatrolRoute[]>([]);
	let selectedRoute = $state<PatrolRoute | null>(null);
	let allCheckpoints = $state<Checkpoint[]>([]);
	let gaAreas = $state<GaArea[]>([]);
	let scans = $state<any[]>([]);

	// ---- R3 Rute Acak Harian (rekomendasi) — urutan pos diacak per sesi ronda, anti hafalan
	// jalur. Diacak SEKALI per patrol_log (disimpan localStorage), bukan tiap render — supaya
	// urutan konsisten sepanjang sesi ronda yang sama, tapi beda tiap sesi/hari. ----
	let shuffledCheckpointIds = $state<number[]>([]);
	function shuffleArray<T>(arr: T[]): T[] {
		const a = [...arr];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	}
	function getShuffledOrder(logId: number, ids: number[]): number[] {
		const key = `satpam_patrol_order_${logId}`;
		try {
			const raw = localStorage.getItem(key);
			if (raw) {
				const stored: number[] = JSON.parse(raw);
				if (Array.isArray(stored) && stored.length === ids.length && stored.every((id) => ids.includes(id))) {
					return stored;
				}
			}
		} catch {}
		const shuffled = shuffleArray(ids);
		try { localStorage.setItem(key, JSON.stringify(shuffled)); } catch {}
		return shuffled;
	}
	$effect(() => {
		shuffledCheckpointIds = activeLog && selectedRoute ? getShuffledOrder(activeLog.id, selectedRoute.checkpoint_ids) : [];
	});

	let pickRouteId = $state('');
	let patrolHistory = $state<any[]>([]);
	let schedules = $state<any[]>([]);
	let historyLoading = $state(false);

	let expandedLogId = $state<number | null>(null);
	let expandedLogScans = $state<any[]>([]);
	let loadingExpandedScans = $state(false);

	let activeTab = $state<'patrol' | 'gamification'>('patrol');

	// XP & Level calculations
	let userXp = $derived.by(() => {
		let totalXp = 0;
		for (const hist of patrolHistory) {
			if (hist.selesai && hist.skor_kepatuhan !== null) {
				totalXp += hist.skor_kepatuhan;
			}
		}
		return totalXp;
	});

	let userLevelInfo = $derived.by(() => {
		const xp = userXp;
		if (xp < 300) {
			return { level: 1, title: 'Garda Pratama 🛡️', minXp: 0, maxXp: 300, currentProgress: xp };
		} else if (xp < 700) {
			return { level: 2, title: 'Garda Madya ⚔️', minXp: 300, maxXp: 700, currentProgress: xp - 300 };
		} else if (xp < 1200) {
			return { level: 3, title: 'Garda Utama 🏆', minXp: 700, maxXp: 1200, currentProgress: xp - 700 };
		} else {
			return { level: 4, title: 'Garda Sakti 👑', minXp: 1200, maxXp: 99999, currentProgress: xp - 1200 };
		}
	});

	let stats = $derived.by(() => {
		const finished = patrolHistory.filter(h => h.selesai);
		const totalPatrols = finished.length;
		const sumScore = finished.reduce((acc, h) => acc + (h.skor_kepatuhan || 0), 0);
		const avgScore = totalPatrols > 0 ? Math.round(sumScore / totalPatrols) : 0;
		return { totalPatrols, avgScore };
	});

	let badges = $derived.by(() => {
		const finished = patrolHistory.filter(h => h.selesai);
		const hasPerfectPatrol = patrolHistory.some(h => h.skor_kepatuhan === 100);
		const hasScheduledPatrol = patrolHistory.some(h => h.schedule_id !== null && h.schedule_id !== undefined);
		const hasReportedIssue = finished.length > 0;

		return [
			{ id: 'disiplin', name: 'Garda Disiplin', desc: 'Ronda Sempurna (Skor 100%)', icon: '🎯', unlocked: hasPerfectPatrol },
			{ id: 'rutin', name: 'Patroli Rutin', desc: 'Selesaikan 3+ sesi ronda', icon: '🔋', unlocked: finished.length >= 3 },
			{ id: 'terjadwal', name: 'Ronda Teratur', desc: 'Selesai ronda terjadwal', icon: '📅', unlocked: hasScheduledPatrol },
			{ id: 'pelapor', name: 'Mata Elang', desc: 'Mulai melaporkan pos patroli', icon: '👁️', unlocked: hasReportedIssue }
		];
	});

	let mockLeaderboard = $derived.by(() => {
		return [
			{ name: 'Pak Thoufan', xp: 1250, avatar: '👤' },
			{ name: $authStore.karyawanName || 'Anda', xp: userXp, avatar: '👮', isUser: true },
			{ name: 'Pak Subhan', xp: 980, avatar: '👤' },
			{ name: 'Pak Dedi', xp: 850, avatar: '👤' },
			{ name: 'Pak Ahmad', xp: 620, avatar: '👤' }
		].sort((a, b) => b.xp - a.xp);
	});



	async function toggleExpandLog(logId: number) {
		if (expandedLogId === logId) {
			expandedLogId = null;
			expandedLogScans = [];
		} else {
			expandedLogId = logId;
			expandedLogScans = [];
			loadingExpandedScans = true;
			try {
				expandedLogScans = await fetchScansForLog(logId);
			} catch (err) {
				console.error(err);
			} finally {
				loadingExpandedScans = false;
			}
		}
	}

	// ---- Scan modal ----
	let showScanModal = $state(false);
	let scanCode = $state('');
	let scanKondisi = $state('baik');
	let scanCatatan = $state('');
	let scanFoto = $state<File | null>(null);
	let scanError = $state('');
	let scanning = $state(false);
	let showCameraScanner = $state(false);
	let pendingScanPayload = $state<any>(null);

	// ---- Kontrol Patroli Fase 1: setelan admin + anti-titip/speedrun ----
	let patrolSettings = $state<PatrolControlSettings>(PATROL_CONTROL_DEFAULTS);
	let showManualCodeInput = $state(false);
	let manualOverrideReason = $state('');
	let manualHoldTimer: ReturnType<typeof setTimeout> | null = null;
	let manualHoldProgress = $state(0);
	let manualHoldInterval: ReturnType<typeof setInterval> | null = null;
	function startManualHold() {
		manualHoldProgress = 0;
		manualHoldInterval = setInterval(() => { manualHoldProgress = Math.min(100, manualHoldProgress + 100 / 30); }, 100);
		manualHoldTimer = setTimeout(() => {
			showManualCodeInput = true;
			cancelManualHold();
		}, 3000);
	}
	function cancelManualHold() {
		if (manualHoldTimer) clearTimeout(manualHoldTimer);
		if (manualHoldInterval) clearInterval(manualHoldInterval);
		manualHoldTimer = null;
		manualHoldInterval = null;
		manualHoldProgress = 0;
	}

	let lastScanCompletedAt = $state<number | null>(null);
	let velocityBlocked = $state(false);
	let velocitySecondsLeft = $state(0);

	let showDurasiOverrideModal = $state(false);
	let durasiOverrideReason = $state('');

	// ---- Wajib cek ruangan (kebersihan dengan barang terdaftar) — Fase 1 ----
	let ruanganCekGate = $state<{ wajib: boolean; sudahCek: boolean; areaId: number | null } | null>(null);
	let ruanganCekSkipReason = $state('');

	// ---- Two-Tap Kebersihan (Fase 2) ----
	// Checkpoint role_scope='kebersihan': Tap 1 = Mulai Kerja (buat baris scan, belum checklist).
	// Tap 2 = Selesai Kerja (buka checklist, lengkapi baris scan yang sama).
	let activeDwellScan = $state<{ id: number; checkpointId: number; mulaiKerja: string } | null>(null);
	let dwellOverrideReason = $state('');
	let dwellInfoMsg = $state('');
	// Timer visual (2.2.4) — detak tiap 30 detik supaya "X menit lalu" ikut berjalan tanpa reload.
	let dwellTick = $state(Date.now());

	function findOpenDwellScan(checkpointId: number) {
		return scans.find((s: any) => s.checkpoint_id === checkpointId && s.mulai_kerja && !s.selesai_kerja) || null;
	}

	function dwellElapsedMinutes(mulaiKerja: string): number {
		void dwellTick; // dependensi reaktif — lihat onMount interval di bawah
		return (Date.now() - new Date(mulaiKerja).getTime()) / 60000;
	}

	// ---- R1 Offline Queue Scan — kirim ulang otomatis saat online kembali ----
	let queuedCount = $state(0);
	let flushingQueue = $state(false);

	/** Urutan kirim sebenarnya (upload foto -> checklist -> scan/dwell) — dipakai submit
	 *  langsung maupun saat flush antrian offline, supaya logikanya satu tempat. */
	async function performPatrolSubmission(entry: QueuedPatrolSubmission): Promise<void> {
		const fotoId = entry.scan_foto ? await uploadSecurityFoto(await compressPhoto(entry.scan_foto), `security_patrol_scan:${entry.checkpoint_code}`) : null;

		if (entry.template_id && entry.responses && entry.signature) {
			const compressedChecklistPhotos: Record<number, File> = {};
			for (const [itemId, file] of Object.entries(entry.checklist_photos)) {
				compressedChecklistPhotos[Number(itemId)] = await compressPhoto(file as File);
			}
			await submitSecurityChecklistResponse({
				route_id: entry.route_id!,
				template_id: entry.template_id,
				checkpoint_id: entry.checkpoint_id,
				responses: entry.responses,
				signature: entry.signature,
				photos: compressedChecklistPhotos,
				ruangan_cek_skip_reason: entry.ruangan_cek_skip_reason
			});
		}

		if (entry.dwell_scan_id) {
			await finishDwellWork(entry.dwell_scan_id, {
				foto: fotoId,
				kondisi: entry.kondisi,
				catatan: entry.catatan,
				dwell_override_reason: entry.dwell_override_reason
			});
		} else {
			await submitPatrolScan({
				patrol_log_id: entry.patrol_log_id,
				checkpoint_id: entry.checkpoint_id,
				lat: entry.lat,
				lng: entry.lng,
				foto: fotoId,
				kondisi: entry.kondisi,
				catatan: entry.catatan,
				in_radius: entry.in_radius,
				override_reason: entry.override_reason
			});
		}
	}

	async function flushOfflineQueue() {
		flushingQueue = true;
		try {
			const { sent } = await flushPatrolSubmissionQueue(performPatrolSubmission);
			queuedCount = (await getQueuedPatrolSubmissions()).length;
			if (sent > 0 && activeLog) {
				scans = await fetchScansForLog(activeLog.id);
				dwellInfoMsg = `${sent} checklist offline berhasil dikirim.`;
			}
		} catch (err) {
			console.error('[patroli] gagal flush antrian offline:', err);
		}
		flushingQueue = false;
	}

	// ---- R4 Panic Button — akses cepat dari halaman patroli aktif (tanpa pindah ke /satpam/insiden) ----
	let showPanicConfirm = $state(false);
	let panicSaving = $state(false);
	let panicSentMsg = $state('');
	async function triggerPanic() {
		showPanicConfirm = false;
		panicSaving = true;
		panicSentMsg = '';
		try {
			const pos = await getGpsPosition();
			const lokasi = pos ? `GPS: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}` : 'Lokasi tidak terdeteksi';
			await submitIncident({
				kategori: 'lainnya',
				severity: 'critical',
				lokasi,
				kronologi: `PANIC — dikirim langsung dari alur patroli aktif${selectedRoute ? ` (rute ${selectedRoute.name})` : ''}.`,
				status: 'open',
				is_panic: true,
				reported_by_id: karyawanId
			});
			panicSentMsg = 'Panic terkirim! Supervisor & HRD sudah diberitahu.';
		} catch (err) {
			panicSentMsg = err instanceof Error ? `Gagal mengirim panic: ${err.message}` : 'Gagal mengirim panic.';
		}
		panicSaving = false;
	}

	// ---- Checklist pos (Fase 3 konsolidasi GA/Security 2026-07-13) ----
	// Muncul setelah scan presence bila checkpoint.checklist_mode != 'presence-only'.
	let checklistStep = $state(false);
	let checklistCheckpoint = $state<Checkpoint | null>(null);
	let checklistTemplateId = $state<number | null>(null);
	let checklistTemplateName = $state('');
	let checklistItems = $state<ChecklistItemDef[]>([]);
	let checklistAnswers = $state<Record<number, { answer: 'yes' | 'no' | 'na'; notes: string }>>({});
	let checklistPhotos = $state<Record<number, File>>({});
	let checklistPhotoPreviews = $state<Record<number, string>>({});
	let checklistLoading = $state(false);
	let checklistSaving = $state(false);
	let checklistError = $state('');
	let checklistCanvasEl: HTMLCanvasElement;
	let checklistDrawing = false;
	let checklistHasSignature = $state(false);

	let showCameraCapture = $state(false);
	let cameraCaptureTarget = $state<'scanFoto' | { itemId: number } | null>(null);

	/** R2 — overlay watermark waktu/GPS/petugas ke setiap foto bukti scan sebelum disimpan. */
	async function stampPhoto(file: File): Promise<File> {
		try {
			const pos = await getGpsPosition();
			const gps = pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } : null;
			return await watermarkPhoto(file, gps, new Date().toISOString(), { lokasi: $authStore.karyawanName || undefined });
		} catch {
			return file;
		}
	}

	async function handleCameraCapture(file: File) {
		const stamped = await stampPhoto(file);
		if (cameraCaptureTarget === 'scanFoto') {
			scanFoto = stamped;
		} else if (cameraCaptureTarget && typeof cameraCaptureTarget === 'object' && 'itemId' in cameraCaptureTarget) {
			const itemId = cameraCaptureTarget.itemId;
			checklistPhotos[itemId] = stamped;
			checklistPhotoPreviews[itemId] = URL.createObjectURL(stamped);
		}
		showCameraCapture = false;
		cameraCaptureTarget = null;
	}

	function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
		const R = 6371000;
		const toRad = (d: number) => (d * Math.PI) / 180;
		const dLat = toRad(lat2 - lat1);
		const dLng = toRad(lng2 - lng1);
		const a =
			Math.sin(dLat / 2) ** 2 +
			Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
		return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	}

	function getGpsPosition(): Promise<GeolocationPosition | null> {
		return new Promise((resolve) => {
			if (!navigator.geolocation) { resolve(null); return; }
			navigator.geolocation.getCurrentPosition(
				(pos) => resolve(pos),
				() => resolve(null),
				{ enableHighAccuracy: true, timeout: 8000 }
			);
		});
	}

	async function loadState() {
		loading = true;
		errorMsg = '';
		historyLoading = true;
		try {
			karyawanId = $authStore.karyawanId;
			if (!karyawanId) {
				loading = false;
				historyLoading = false;
				return;
			}
			const [log, activeRoutes, checkpoints, areas, historyData, schedulesData] = await Promise.all([
				getActivePatrolLog(karyawanId),
				fetchActiveRoutes(),
				fetchActiveCheckpoints(),
				fetchGaAreasSimple(),
				fetchPatrolLogsHistory(karyawanId),
				fetchSatpamSchedules(karyawanId)
			]);
			activeLog = log;
			routes = activeRoutes;
			allCheckpoints = checkpoints;
			gaAreas = areas;
			patrolHistory = historyData;
			schedules = schedulesData;

			// Background pre-fetch checklist templates for all active checkpoints
			if (allCheckpoints && allCheckpoints.length > 0) {
				for (const cp of allCheckpoints) {
					let templateId = cp.checklist_template_id;
					if (!templateId && cp.area_id) {
						const area = gaAreas.find((a) => Number(a.id) === Number(cp.area_id));
						if (area && area.template_id) {
							templateId = area.template_id;
						}
					}
					if (templateId) {
						fetchTemplateWithItems(Number(templateId)).catch((err) => {
							console.warn(`[Pre-fetch] Gagal pre-fetch template ${templateId}:`, err);
						});
					}
				}
			}

			if (activeLog) {
				let routeId: number | null = null;
				if (activeLog.schedule_id) {
					const sch = schedules.find((s) => s.id === activeLog.schedule_id);
					if (sch) routeId = Number(sch.route_id);
				}
				if (!routeId) {
					const storedRouteId = localStorage.getItem(ROUTE_STORAGE_PREFIX + activeLog.id);
					if (storedRouteId) routeId = Number(storedRouteId);
				}
				if (routeId) {
					selectedRoute = await fetchRouteById(routeId);
				}
				scans = await fetchScansForLog(activeLog.id);
			}
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat data patroli.';
		}
		loading = false;
		historyLoading = false;
	}

	onMount(async () => {
		await loadState();
		await restoreChecklistDraft();
		patrolSettings = await fetchPatrolControlSettings();
		void loadCameraCaptureModal();
		queuedCount = (await getQueuedPatrolSubmissions()).length;
		registerPatrolSubmissionAutoFlush(performPatrolSubmission);
		if (queuedCount > 0 && navigator.onLine) void flushOfflineQueue();
	});

	// Timer visual Two-Tap (2.2.4) — perbarui "X menit lalu" tiap 30 detik.
	onMount(() => {
		const t = setInterval(() => { dwellTick = Date.now(); }, 30_000);
		return () => clearInterval(t);
	});

	// Jaring pengaman (rencana v2, Fase 3, 3.1): titik simpan wajib pagehide & visibilitychange,
	// BUKAN beforeunload — tidak diandalkan di Android saat OS mematikan tab karena RAM habis.
	onMount(() => {
		const flush = () => { saveChecklistDraft(); };
		const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
		window.addEventListener('pagehide', flush);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			window.removeEventListener('pagehide', flush);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});

	function fileToDataURL(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}

	function dataURLToFile(dataUrl: string, filename: string): File {
		const [header, base64] = dataUrl.split(',');
		const mime = header.match(/data:(.*);base64/)?.[1] || 'image/jpeg';
		const bin = atob(base64);
		const arr = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
		return new File([arr], filename, { type: mime });
	}

	let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleDraftSave() {
		if (draftSaveTimer) clearTimeout(draftSaveTimer);
		draftSaveTimer = setTimeout(() => { saveChecklistDraft(); }, 400);
	}

	async function saveChecklistDraft() {
		try {
			if (!showScanModal || !checklistStep) {
				sessionStorage.removeItem(CHECKLIST_DRAFT_KEY);
				return;
			}
			const photoData: Record<number, string> = {};
			for (const [id, file] of Object.entries(checklistPhotos)) {
				photoData[Number(id)] = await fileToDataURL(file);
			}
			const draft = {
				savedAt: Date.now(),
				scanCode, scanKondisi, scanCatatan,
				scanFotoData: scanFoto ? await fileToDataURL(scanFoto) : null,
				checklistCheckpointId: checklistCheckpoint?.id ?? null,
				checklistTemplateId, checklistTemplateName,
				checklistItems, checklistAnswers, photoData,
				pendingScanPayload,
				signature: checklistHasSignature && checklistCanvasEl ? checklistCanvasEl.toDataURL('image/png') : null
			};
			sessionStorage.setItem(CHECKLIST_DRAFT_KEY, JSON.stringify(draft));
			checklistDraftSavedAt = new Date(draft.savedAt);
		} catch {
			// Best-effort: draft persistence tidak boleh menghentikan alur utama (mis. sessionStorage penuh).
		}
	}

	function clearChecklistDraft() {
		checklistDraftSavedAt = null;
		try { sessionStorage.removeItem(CHECKLIST_DRAFT_KEY); } catch {}
	}

	async function restoreChecklistDraft() {
		let raw: string | null = null;
		try { raw = sessionStorage.getItem(CHECKLIST_DRAFT_KEY); } catch { return; }
		if (!raw) return;
		try {
			const draft = JSON.parse(raw);
			if (draft.savedAt && Date.now() - draft.savedAt > CHECKLIST_DRAFT_TTL_MS) {
				clearChecklistDraft();
				return;
			}
			const checkpoint = allCheckpoints.find((c) => c.id === draft.checklistCheckpointId);
			if (!checkpoint) { clearChecklistDraft(); return; }

			checklistDraftSavedAt = draft.savedAt ? new Date(draft.savedAt) : null;
			scanCode = draft.scanCode || '';
			scanKondisi = draft.scanKondisi || 'baik';
			scanCatatan = draft.scanCatatan || '';
			scanFoto = draft.scanFotoData ? dataURLToFile(draft.scanFotoData, 'kondisi.jpg') : null;
			pendingScanPayload = draft.pendingScanPayload || null;

			checklistCheckpoint = checkpoint;
			checklistTemplateId = draft.checklistTemplateId ?? null;
			checklistTemplateName = draft.checklistTemplateName || '';
			checklistItems = draft.checklistItems || [];
			checklistAnswers = draft.checklistAnswers || {};

			const photos: Record<number, File> = {};
			const previews: Record<number, string> = {};
			for (const [id, dataUrl] of Object.entries(draft.photoData || {})) {
				photos[Number(id)] = dataURLToFile(dataUrl as string, `foto_${id}.jpg`);
				previews[Number(id)] = dataUrl as string;
			}
			checklistPhotos = photos;
			checklistPhotoPreviews = previews;

			checklistError = 'Halaman sempat ter-refresh. Data checklist yang sudah diisi telah dipulihkan otomatis.';
			checklistLoading = false;
			checklistStep = true;
			showScanModal = true;

			if (draft.signature) {
				await tick();
				const img = new Image();
				img.onload = () => {
					const ctx = checklistCanvasEl?.getContext('2d');
					if (ctx && checklistCanvasEl) {
						ctx.drawImage(img, 0, 0, checklistCanvasEl.width, checklistCanvasEl.height);
						checklistHasSignature = true;
					}
				};
				img.src = draft.signature;
			}
		} catch {
			clearChecklistDraft();
		}
	}

	const INDO_DAYS = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];

	function getTodaySchedules() {
		const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
		const dayIdx = new Date(todayStr).getDay();
		const dayName = INDO_DAYS[dayIdx];
		
		return schedules.filter((s) => 
			s.tanggal === todayStr || 
			s.setiap_hari || 
			(Array.isArray(s.hari) && s.hari.includes(dayName))
		);
	}

	function getTodayPatrol(scheduleId: number) {
		const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
		return patrolHistory.find((h) => 
			h.schedule_id === scheduleId && 
			h.selesai && 
			new Date(h.mulai).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }) === todayStr
		);
	}

	function getScheduleTimeStatus(jamRonda: string) {
		if (!jamRonda) return { status: 'available', message: '' };
		
		const nowJakarta = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
		const currentHours = nowJakarta.getHours();
		const currentMinutes = nowJakarta.getMinutes();
		const currentMin = currentHours * 60 + currentMinutes;

		const [schHours, schMinutes] = jamRonda.split(':').map(Number);
		const schMin = schHours * 60 + schMinutes;
		const endMin = schMin + 180; // 3-hour window

		if (currentMin < schMin) {
			return { status: 'upcoming', message: `Belum Mulai` };
		} else if (currentMin > endMin) {
			const endHour = Math.floor(endMin / 60) % 24;
			const endMinPart = endMin % 60;
			const endStr = `${String(endHour).padStart(2, '0')}:${String(endMinPart).padStart(2, '0')}`;
			return { status: 'expired', message: `Lewat Jadwal` };
		}
		return { status: 'available', message: 'Aktif' };
	}

	let selectedRouteStatus = $derived.by(() => {
		if (!pickRouteId) return null;
		const todaySchedules = getTodaySchedules();
		const matchingSchedule = todaySchedules.find((s) => Number(s.route_id) === Number(pickRouteId));
		if (!matchingSchedule || !matchingSchedule.jam_ronda) return { status: 'available', message: '' };
		return getScheduleTimeStatus(matchingSchedule.jam_ronda);
	});

	async function mulaiRonda() {
		if (!pickRouteId || !karyawanId) return;

		// Time validation
		const todaySchedules = getTodaySchedules();
		const matchingSchedule = todaySchedules.find((s) => Number(s.route_id) === Number(pickRouteId));
		if (matchingSchedule && matchingSchedule.jam_ronda) {
			const timeStatus = getScheduleTimeStatus(matchingSchedule.jam_ronda);
			if (timeStatus.status === 'upcoming') {
				errorMsg = `Patroli tidak bisa dikerjakan sebelum jadwalnya (${matchingSchedule.jam_ronda}).`;
				return;
			} else if (timeStatus.status === 'expired') {
				errorMsg = `Batas waktu pengisian patroli ini sudah lewat (maksimal 3 jam dari jadwal ${matchingSchedule.jam_ronda}).`;
				return;
			}
		}

		saving = true;
		try {
			const scheduleId = matchingSchedule ? matchingSchedule.id : undefined;

			const log = await startPatrolLog(karyawanId, scheduleId);
			localStorage.setItem(ROUTE_STORAGE_PREFIX + log.id, pickRouteId);
			await loadState();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memulai ronda.';
		}
		saving = false;
	}

	async function pilihRuteLanjutan(routeId: string) {
		if (!routeId || !activeLog) return;
		localStorage.setItem(ROUTE_STORAGE_PREFIX + activeLog.id, routeId);
		selectedRoute = await fetchRouteById(Number(routeId));
	}

	function checkpointName(id: number) {
		const cp = allCheckpoints.find((c) => c.id === id);
		if (!cp) return `#${id}`;
		if (cp.area_id) {
			const area = gaAreas.find((a) => Number(a.id) === Number(cp.area_id));
			if (area && area.area_name) {
				return area.area_name;
			}
		}
		const fallbackName = cp.name || cp.code || `#${id}`;
		return fallbackName.replace(/Checkpoint\s*#/gi, '#');
	}

	function isScanned(checkpointId: number) {
		return scans.some((s) => s.checkpoint_id === checkpointId);
	}

	function openScanModal() {
		clearChecklistDraft();
		scanCode = '';
		scanKondisi = 'baik';
		scanCatatan = '';
		scanFoto = null;
		scanError = '';
		checklistStep = false;
		showCameraScanner = false;
		pendingScanPayload = null;
		checklistTemplateId = null;
		showManualCodeInput = false;
		manualOverrideReason = '';
		cancelManualHold();
		velocityBlocked = false;
		showScanModal = true;
	}

	/** 1.3 Velocity check (anti-speedrun) — jeda minimal antar scan checkpoint. */
	function checkVelocity(): boolean {
		const now = Date.now();
		if (!isVelocityViolation(lastScanCompletedAt, now, patrolSettings.minIntervalSeconds)) return true;
		velocityBlocked = true;
		velocitySecondsLeft = velocitySecondsRemaining(lastScanCompletedAt, now, patrolSettings.minIntervalSeconds);
		return false;
	}

	async function onScanFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0] || null;
		scanFoto = file ? await stampPhoto(file) : null;
		saveChecklistDraft();
	}

	async function submitScan() {
		scanError = '';
		if (!scanCode.trim()) { scanError = 'Masukkan atau scan kode checkpoint.'; return; }
		if (!activeLog) return;

		// 1.3 Velocity check — mode soft: wajib alasan untuk lanjut. Mode hard: tolak total.
		if (!checkVelocity()) {
			if (!manualOverrideReason.trim()) {
				scanError = `Perjalanan antar pos terlalu cepat (tunggu ${velocitySecondsLeft} detik lagi). Periksa area dengan teliti, atau isi alasan untuk melanjutkan.`;
				return;
			}
		}

		// 1.1 Kunci input manual — hanya boleh via override supervisor (tahan 3 detik + alasan).
		if (showManualCodeInput && patrolSettings.manualInputMode !== 'enabled' && !manualOverrideReason.trim()) {
			scanError = 'Input manual butuh alasan (override supervisor) sebelum dilanjutkan.';
			return;
		}

		scanning = true;
		try {
			let checkpoint = allCheckpoints.find((c) => c.code === scanCode.trim());
			if (!checkpoint) {
				checkpoint = await fetchCheckpointByCode(scanCode.trim()) || undefined;
			}
			if (!checkpoint) {
				scanError = 'Kode checkpoint tidak ditemukan atau tidak aktif.';
				scanning = false;
				return;
			}
			if (selectedRoute && !selectedRoute.checkpoint_ids.includes(checkpoint.id)) {
				scanError = 'Peringatan: checkpoint ini bukan bagian dari rute yang dipilih, tapi tetap dicatat.';
			}

			const pos = await getGpsPosition();
			let lat: number | null = null;
			let lng: number | null = null;
			let inRadius = true;
			if (pos) {
				lat = pos.coords.latitude;
				lng = pos.coords.longitude;
				if (checkpoint.lat != null && checkpoint.lng != null) {
					const dist = haversineMeters(lat, lng, checkpoint.lat, checkpoint.lng);
					inRadius = dist <= GPS_TOLERANCE_METERS;
					// 1.6 GPS enforcement configurable — 'hard' tolak scan di luar radius, 'soft'/'off' hanya menandai.
					if (!inRadius && patrolSettings.gpsEnforcement === 'hard') {
						scanError = 'Anda berada di luar radius checkpoint ini. Scan ditolak (GPS wajib).';
						scanning = false;
						return;
					}
				}
			} else if (patrolSettings.gpsEnforcement === 'hard') {
				scanError = 'Akses GPS wajib diaktifkan untuk scan checkpoint ini.';
				scanning = false;
				return;
			}

			let templateId = checkpoint.checklist_template_id;
			if (!templateId && checkpoint.area_id) {
				const area = gaAreas.find((a) => Number(a.id) === Number(checkpoint.area_id));
				if (area && area.template_id) {
					templateId = area.template_id;
				}
			}

			// 2.1/2.2 Two-Tap Kebersihan (Fase 2) — checkpoint role_scope='kebersihan' pakai alur
			// Mulai Kerja / Selesai Kerja, bukan scan sekali jalan seperti satpam/umum.
			if (checkpoint.role_scope === 'kebersihan') {
				const openDwell = findOpenDwellScan(checkpoint.id);
				if (openDwell) {
					// Tap 2 — Selesai Kerja: lanjut ke checklist, tidak buat baris scan baru.
					activeDwellScan = { id: openDwell.id, checkpointId: checkpoint.id, mulaiKerja: openDwell.mulai_kerja };
					pendingScanPayload = null;
					await openChecklistStep(checkpoint, templateId || null);
				} else {
					// Tap 1 — Mulai Kerja: catat baris scan, JANGAN buka checklist dulu.
					await startDwellWork({ patrol_log_id: activeLog.id, checkpoint_id: checkpoint.id, lat, lng, in_radius: inRadius });
					scans = await fetchScansForLog(activeLog.id);
					dwellInfoMsg = `Mulai kerja "${checkpointName(checkpoint.id)}" tercatat pukul ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}. Scan QR yang sama lagi (atau tekan "Selesai Kerja") setelah pekerjaan selesai.`;
					lastScanCompletedAt = Date.now();
					velocityBlocked = false;
					manualOverrideReason = '';
					showManualCodeInput = false;
					showScanModal = false;
				}
				scanning = false;
				return;
			}

			const payload = {
				patrol_log_id: activeLog.id,
				checkpoint_id: checkpoint.id,
				lat, lng,
				foto: null,
				kondisi: 'baik',
				catatan: undefined,
				in_radius: inRadius,
				override_reason: (showManualCodeInput || velocityBlocked) && manualOverrideReason.trim() ? manualOverrideReason.trim() : null
			};

			pendingScanPayload = payload;
			await openChecklistStep(checkpoint, templateId || null);
		} catch (err) {
			scanError = err instanceof Error ? err.message : 'Gagal menyimpan scan.';
		}
		scanning = false;
	}

	/** Tombol "Selesai Kerja" langsung dari daftar checkpoint (tanpa scan ulang QR). */
	async function mulaiSelesaiKerja(checkpointId: number) {
		const checkpoint = allCheckpoints.find((c) => c.id === checkpointId);
		const openDwell = findOpenDwellScan(checkpointId);
		if (!checkpoint || !openDwell) return;
		activeDwellScan = { id: openDwell.id, checkpointId, mulaiKerja: openDwell.mulai_kerja };
		pendingScanPayload = null;
		clearChecklistDraft();
		scanKondisi = 'baik';
		scanCatatan = '';
		scanFoto = null;
		checklistError = '';
		dwellOverrideReason = '';
		let templateId = checkpoint.checklist_template_id;
		if (!templateId && checkpoint.area_id) {
			const area = gaAreas.find((a) => Number(a.id) === Number(checkpoint.area_id));
			if (area && area.template_id) templateId = area.template_id;
		}
		showScanModal = true;
		await openChecklistStep(checkpoint, templateId || null);
	}

	async function openChecklistStep(checkpoint: Checkpoint, resolvedTemplateId: number | null) {
		checklistCheckpoint = checkpoint;
		checklistTemplateId = resolvedTemplateId;
		checklistError = '';
		checklistAnswers = {};
		checklistPhotos = {};
		checklistPhotoPreviews = {};
		checklistHasSignature = false;
		checklistLoading = true;
		checklistStep = true;
		checklistItems = [];
		checklistTemplateName = resolvedTemplateId ? 'Memuat...' : 'Scan Kehadiran (Tanpa Checklist)';
		ruanganCekGate = null;
		ruanganCekSkipReason = '';
		try {
			if (resolvedTemplateId) {
				const tpl = await fetchTemplateWithItems(resolvedTemplateId);
				checklistTemplateName = tpl.name;
				checklistItems = tpl.items;
				for (const it of checklistItems) checklistAnswers[it.id] = { answer: undefined as any, notes: '' };
			} else {
				checklistTemplateName = 'Scan Kehadiran (Tanpa Checklist)';
				checklistItems = [];
			}
			await loadRuanganCekGate(checkpoint);
		} catch (err) {
			checklistError = err instanceof Error ? err.message : 'Gagal memuat checklist pos ini.';
		}
		checklistLoading = false;
	}

	/** Wajib cek kelengkapan ruangan untuk checkpoint kebersihan yang punya barang terdaftar (shadow/soft/hard). */
	async function loadRuanganCekGate(checkpoint: Checkpoint) {
		if (checkpoint.role_scope !== 'kebersihan' || !checkpoint.area_id) return;
		if (patrolSettings.wajibCekRuanganMode === 'shadow') return;
		try {
			const { fetchRuangan } = await import('$lib/services/gaRuangan');
			const data = await fetchRuangan(Number(checkpoint.area_id));
			if (!data.assets || data.assets.length === 0) return;
			const lastIso = data.last_check?.waktu ?? null;
			const hari = lastIso ? Math.floor((Date.now() - new Date(lastIso).getTime()) / 86_400_000) : Infinity;
			const sudahCek = hari < (data.interval_cek_hari ?? 30);
			ruanganCekGate = { wajib: !sudahCek, sudahCek, areaId: Number(checkpoint.area_id) };
		} catch (err) {
			console.error('[patroli] gagal cek gerbang kelengkapan ruangan:', err);
		}
	}

	function checklistGroupedByCategory() {
		const groups: Record<string, ChecklistItemDef[]> = {};
		for (const it of checklistItems) {
			const cat = it.category || 'Lainnya';
			if (!groups[cat]) groups[cat] = [];
			groups[cat].push(it);
		}
		return groups;
	}

	async function onChecklistPhotoChange(itemId: number, e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const stamped = await stampPhoto(file);
		checklistPhotos[itemId] = stamped;
		checklistPhotoPreviews[itemId] = URL.createObjectURL(stamped);
		saveChecklistDraft();
	}

	function setChecklistAnswer(itemId: number, val: 'yes' | 'no' | 'na') {
		checklistAnswers[itemId] = { ...checklistAnswers[itemId], answer: val };
		saveChecklistDraft();
	}

	function checklistGetPos(e: PointerEvent) {
		const rect = checklistCanvasEl.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	function checklistStartDraw(e: PointerEvent) {
		checklistDrawing = true;
		const ctx = checklistCanvasEl.getContext('2d');
		if (!ctx) return;
		const { x, y } = checklistGetPos(e);
		ctx.beginPath();
		ctx.moveTo(x, y);
	}

	function checklistDraw(e: PointerEvent) {
		if (!checklistDrawing) return;
		const ctx = checklistCanvasEl.getContext('2d');
		if (!ctx) return;
		const { x, y } = checklistGetPos(e);
		ctx.lineWidth = 2;
		ctx.lineCap = 'round';
		ctx.strokeStyle = '#111827';
		ctx.lineTo(x, y);
		ctx.stroke();
		checklistHasSignature = true;
	}

	function checklistEndDraw() {
		if (checklistDrawing) saveChecklistDraft();
		checklistDrawing = false;
	}

	function checklistClearSignature() {
		const ctx = checklistCanvasEl.getContext('2d');
		ctx?.clearRect(0, 0, checklistCanvasEl.width, checklistCanvasEl.height);
		checklistHasSignature = false;
	}

	async function submitChecklistStep() {
		checklistError = '';
		if (!checklistCheckpoint || !selectedRoute) return;
		if (!scanFoto) {
			checklistError = 'Foto kondisi wajib diisi.';
			return;
		}
		if (!checklistHasSignature) {
			checklistError = 'Tanda tangan petugas wajib diisi.';
			return;
		}
		if (checklistTemplateId) {
			const unanswered = checklistItems.filter((it) => {
				const ans = checklistAnswers[it.id]?.answer;
				return ans !== 'yes' && ans !== 'no' && ans !== 'na';
			});
			if (unanswered.length > 0) {
				checklistError = 'Semua item checklist wajib diisi.';
				return;
			}
		}
		if (ruanganCekGate?.wajib) {
			if (patrolSettings.wajibCekRuanganMode === 'hard') {
				checklistError = 'Cek kelengkapan ruangan wajib diselesaikan dulu sebelum checklist ini bisa dikirim. Buka "Barang di ruangan ini" untuk cek.';
				return;
			}
			if (patrolSettings.wajibCekRuanganMode === 'soft' && !ruanganCekSkipReason.trim()) {
				checklistError = 'Cek kelengkapan ruangan belum dilakukan. Isi alasan untuk melewati, atau selesaikan cek ruangan terlebih dulu.';
				return;
			}
		}
		// 2.2 Two-Tap Kebersihan — durasi kerja minimal (dwell time) sebelum Tap 2 tanpa alasan.
		if (activeDwellScan && isDwellViolation(new Date(activeDwellScan.mulaiKerja).getTime(), Date.now(), patrolSettings.minDwellMinutes) && !dwellOverrideReason.trim()) {
			checklistError = `Durasi kerja belum mencapai ${patrolSettings.minDwellMinutes} menit. Isi alasan untuk menyelesaikan lebih awal.`;
			return;
		}

		vibrateTap();
		checklistSaving = true;
		try {
			const signature = checklistHasSignature ? checklistCanvasEl.toDataURL('image/png') : null;
			const responses = checklistTemplateId
				? checklistItems.map((it) => ({ item_id: it.id, answer: checklistAnswers[it.id].answer, notes: checklistAnswers[it.id].notes }))
				: null;
			const entry: QueuedPatrolSubmission = {
				client_txn_id: (crypto.randomUUID?.() ?? `patrol-${Date.now()}-${Math.random().toString(36).slice(2)}`),
				patrol_log_id: activeLog.id,
				checkpoint_id: checklistCheckpoint.id,
				checkpoint_code: checklistCheckpoint.code,
				checkpoint_name: checkpointName(checklistCheckpoint.id),
				route_id: checklistTemplateId ? selectedRoute.id : null,
				template_id: checklistTemplateId,
				responses,
				signature,
				checklist_photos: { ...checklistPhotos },
				scan_foto: scanFoto,
				kondisi: scanKondisi,
				catatan: scanCatatan.trim() || undefined,
				lat: pendingScanPayload?.lat ?? null,
				lng: pendingScanPayload?.lng ?? null,
				in_radius: pendingScanPayload?.in_radius ?? true,
				override_reason: pendingScanPayload?.override_reason ?? null,
				ruangan_cek_skip_reason: ruanganCekGate?.wajib ? ruanganCekSkipReason.trim() || undefined : undefined,
				dwell_scan_id: activeDwellScan?.id ?? null,
				dwell_override_reason: activeDwellScan ? dwellOverrideReason.trim() || null : null,
				queued_at: Date.now()
			};

			await performPatrolSubmission(entry);

			scans = await fetchScansForLog(activeLog.id);
			lastScanCompletedAt = Date.now();
			velocityBlocked = false;
			manualOverrideReason = '';
			showManualCodeInput = false;
			ruanganCekGate = null;
			ruanganCekSkipReason = '';
			activeDwellScan = null;
			dwellOverrideReason = '';
			pendingScanPayload = null;
			checklistStep = false;
			showScanModal = false;
			clearChecklistDraft();
		} catch (err) {
			// R1 Offline Queue — gagal karena jaringan (bukan ditolak server): simpan
			// lengkap (termasuk foto & tanda tangan), kirim ulang otomatis saat online.
			if (!navigator.onLine || err instanceof TypeError) {
				try {
					const signature = checklistHasSignature ? checklistCanvasEl.toDataURL('image/png') : null;
					const responses = checklistTemplateId
						? checklistItems.map((it) => ({ item_id: it.id, answer: checklistAnswers[it.id].answer, notes: checklistAnswers[it.id].notes }))
						: null;
					await enqueuePatrolSubmission({
						client_txn_id: (crypto.randomUUID?.() ?? `patrol-${Date.now()}-${Math.random().toString(36).slice(2)}`),
						patrol_log_id: activeLog.id,
						checkpoint_id: checklistCheckpoint.id,
						checkpoint_code: checklistCheckpoint.code,
						checkpoint_name: checkpointName(checklistCheckpoint.id),
						route_id: checklistTemplateId ? selectedRoute.id : null,
						template_id: checklistTemplateId,
						responses,
						signature,
						checklist_photos: { ...checklistPhotos },
						scan_foto: scanFoto,
						kondisi: scanKondisi,
						catatan: scanCatatan.trim() || undefined,
						lat: pendingScanPayload?.lat ?? null,
						lng: pendingScanPayload?.lng ?? null,
						in_radius: pendingScanPayload?.in_radius ?? true,
						override_reason: pendingScanPayload?.override_reason ?? null,
						ruangan_cek_skip_reason: ruanganCekGate?.wajib ? ruanganCekSkipReason.trim() || undefined : undefined,
						dwell_scan_id: activeDwellScan?.id ?? null,
						dwell_override_reason: activeDwellScan ? dwellOverrideReason.trim() || null : null,
						queued_at: Date.now()
					});
					queuedCount = (await getQueuedPatrolSubmissions()).length;
					dwellInfoMsg = 'Koneksi terputus — checklist ini disimpan di perangkat dan akan dikirim otomatis saat online kembali.';
					activeDwellScan = null;
					dwellOverrideReason = '';
					pendingScanPayload = null;
					checklistStep = false;
					showScanModal = false;
					clearChecklistDraft();
				} catch (queueErr) {
					checklistError = queueErr instanceof Error ? queueErr.message : 'Gagal menyimpan checklist offline.';
				}
			} else {
				checklistError = err instanceof Error ? err.message : 'Gagal mengirim checklist pos.';
			}
		}
		checklistSaving = false;
	}

	/** 1.4 Durasi ronda minimal — mode soft: wajib alasan. Mode hard: tolak total. */
	function selesaiRondaDitolakDurasi(): boolean {
		if (!activeLog?.mulai) return false;
		return isPatrolDurationViolation(new Date(activeLog.mulai).getTime(), Date.now(), patrolSettings.minPatrolDurationMinutes);
	}

	/** G_PATROL_SPEEDRUN_SELESAI_RONDA (Fase 3) — sesi dengan scan ber-override (kecepatan/manual). */
	function selesaiRondaAdaAnomaliSpeedrun(): boolean {
		return patrolSettings.speedrunGateMode !== 'shadow' && scans.some((s: any) => !!s.override_reason);
	}

	async function selesaiRonda() {
		if (!activeLog) return;
		const openDwellCount = scans.filter((s: any) => s.mulai_kerja && !s.selesai_kerja).length;
		if (openDwellCount > 0 && !confirm(`Masih ada ${openDwellCount} pekerjaan kebersihan "Sedang Mengerjakan" yang belum ditutup (Tap Selesai Kerja). Tetap selesaikan ronda?`)) {
			return;
		}
		const adaAnomaliSpeedrun = selesaiRondaAdaAnomaliSpeedrun();
		if (adaAnomaliSpeedrun && patrolSettings.speedrunGateMode === 'hard') {
			errorMsg = 'Sesi ronda ini punya scan dengan override (kecepatan/manual) — tidak bisa diselesaikan sendiri, hubungi supervisor.';
			return;
		}
		if (selesaiRondaDitolakDurasi() || adaAnomaliSpeedrun) {
			showDurasiOverrideModal = true;
			return;
		}
		if (!confirm('Selesaikan sesi ronda ini?')) return;
		await doSelesaiRonda(null);
	}

	async function konfirmasiDurasiOverride() {
		if (!durasiOverrideReason.trim()) {
			errorMsg = 'Alasan wajib diisi karena ronda belum mencapai durasi minimal.';
			return;
		}
		showDurasiOverrideModal = false;
		await doSelesaiRonda(durasiOverrideReason.trim());
		durasiOverrideReason = '';
	}

	async function doSelesaiRonda(reason: string | null, gateSec5Reason: string | null = null) {
		if (!activeLog) return;
		saving = true;
		try {
			// Skor kepatuhan & gate G_SEC5 dihitung/dievaluasi di server; alert skor rendah juga dikirim server.
			await finishPatrolLog(activeLog.id, {
				routeId: selectedRoute?.id ?? null,
				durasiOverrideReason: reason,
				gateSec5Reason
			});
			// Kita TIDAK menghapus route_id dari localStorage agar riwayat patroli mandiri di perangkat ini
			// tetap bisa menampilkan nama rute yang benar.
			// localStorage.removeItem(ROUTE_STORAGE_PREFIX + activeLog.id);
			activeLog = null;
			selectedRoute = null;
			scans = [];
			await loadState();
		} catch (err) {
			if (err instanceof Error && (err as any).isGateSec5) {
				// G_SEC5 soft: minta alasan lalu kirim ulang; batal = tetap di ronda untuk scan titik tersisa.
				const alasan = window.prompt(`${err.message}\n\nAlasan tetap menyelesaikan (min. 5 karakter):`, '');
				if (alasan && alasan.trim().length >= 5) {
					saving = false;
					await doSelesaiRonda(reason, alasan.trim());
					return;
				}
			}
			errorMsg = err instanceof Error ? err.message : 'Gagal menyelesaikan ronda.';
		}
		saving = false;
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/satpam')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Patroli/Cleaning</h1>
		</div>

		<!-- Tab Switcher -->
		<div class="flex gap-2 p-1 rounded-xl mb-4" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
			<button 
				class="flex-1 py-2 text-[12px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5"
				style="background: {activeTab === 'patrol' ? 'var(--sys-bg)' : 'transparent'}; color: {activeTab === 'patrol' ? 'var(--sys-label)' : 'var(--sys-label3)'}; box-shadow: {activeTab === 'patrol' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}"
				onclick={() => activeTab = 'patrol'}
			>
				<IconQrcode size={14} /> Ronda & Jadwal
			</button>
			<button 
				class="flex-1 py-2 text-[12px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5"
				style="background: {activeTab === 'gamification' ? 'var(--sys-bg)' : 'transparent'}; color: {activeTab === 'gamification' ? 'var(--sys-label)' : 'var(--sys-label3)'}; box-shadow: {activeTab === 'gamification' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}"
				onclick={() => activeTab = 'gamification'}
			>
				<IconTrophy size={14} /> Papan Prestasi
			</button>
		</div>

		{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rute patroli & data satpam..." />
		</div>
		{:else if errorMsg}
			<div class="rounded-lg p-4 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
		{:else if activeTab === 'patrol'}
			{#if !activeLog}
				<div class="rounded-xl p-4" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					{#if getTodaySchedules().length > 0}
						<div class="mb-3 p-3 rounded-lg border border-red-200 bg-red-50/10">
							<p class="text-[11px] font-bold text-red-600 uppercase tracking-wider mb-2">Jadwal Anda Hari Ini:</p>
							<div class="flex flex-col gap-1.5">
								{#each getTodaySchedules() as sch}
									{@const r = routes.find(rt => rt.id === Number(sch.route_id))}
									{#if r}
										{@const timeStatus = sch.jam_ronda ? getScheduleTimeStatus(sch.jam_ronda) : { status: 'available', message: '' }}
										{@const todayPatrol = getTodayPatrol(sch.id)}
										<div class="flex justify-between items-center text-[12px]" style="color: var(--sys-label)">
											<div class="flex items-center gap-1.5">
												{#if todayPatrol}
													<IconCircleCheck size={14} style="color: var(--ggd)" />
												{/if}
												<span class="font-semibold {todayPatrol ? 'line-through text-gray-500 opacity-60' : ''}">{r.name}</span>
											</div>
											<div class="flex items-center gap-1.5">
												{#if todayPatrol}
													<span class="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-600 font-medium">
														Selesai: {new Date(todayPatrol.selesai).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
													</span>
												{:else}
													<span class="text-[11px] bg-white px-2 py-0.5 rounded border" style="border-color: var(--sys-sep); color: var(--sys-label2)">
														{sch.jam_ronda || sch.shift || 'Jadwal'}
													</span>
													{#if timeStatus.status === 'upcoming'}
														<span class="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">Belum Mulai</span>
													{:else if timeStatus.status === 'expired'}
														<span class="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-500 font-medium">Lewat Jadwal</span>
													{:else}
														<span class="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-500 font-medium">Aktif</span>
													{/if}
												{/if}
											</div>
										</div>
									{/if}
								{/each}
							</div>
						</div>
					{/if}
					<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Pilih Rute Ronda</p>
					<select class="w-full rounded-lg px-3 py-2 text-[13px] mb-3" style="background: var(--sys-bg); border: 1px solid var(--sys-sep); color: var(--sys-label)" bind:value={pickRouteId}>
						<option value="">Pilih rute…</option>
						{#if getTodaySchedules().length > 0}
							<optgroup label="Jadwal Hari Ini">
								{#each routes.filter((r) => getTodaySchedules().some((s) => Number(s.route_id) === r.id)) as r}
									{@const sch = getTodaySchedules().find((s) => Number(s.route_id) === r.id)}
									{@const timeStatus = sch?.jam_ronda ? getScheduleTimeStatus(sch.jam_ronda) : null}
									<option value={r.id} disabled={timeStatus?.status === 'upcoming' || timeStatus?.status === 'expired'}>
										🗓️ {r.name} ({sch?.jam_ronda || sch?.shift || 'Jadwal'}) {timeStatus ? ` - [${timeStatus.message}]` : ''}
									</option>
								{/each}
							</optgroup>
							<optgroup label="Rute Lain (Ronda Mandiri)">
								{#each routes.filter((r) => !getTodaySchedules().some((s) => Number(s.route_id) === r.id)) as r}
									<option value={r.id}>{r.name} ({r.shift || '-'})</option>
								{/each}
							</optgroup>
						{:else}
							{#each routes as r}
								<option value={r.id}>{r.name} ({r.shift || '-'})</option>
							{/each}
						{/if}
					</select>
					<button
						class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
						style="background: #DC2626"
						disabled={!pickRouteId || saving || (selectedRouteStatus && selectedRouteStatus.status !== 'available')}
						onclick={mulaiRonda}
					>
						{#if selectedRouteStatus && selectedRouteStatus.status === 'upcoming'}
							Belum Waktunya
						{:else}
							{saving ? 'Memulai…' : 'Mulai Ronda'}
						{/if}
					</button>
				</div>

				<div class="mt-6">
					<h2 class="text-[14px] font-bold mb-3" style="color: var(--sys-label)">Hasil Patroli Terakhir</h2>
					{#if historyLoading}
						<div class="flex items-center justify-center py-6">
							<IconLoader2 size={20} class="animate-spin" style="color: var(--sys-label3)" />
						</div>
					{:else if patrolHistory.length === 0}
						<div class="rounded-xl p-4 text-center text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label3)">
							Belum ada riwayat patroli.
						</div>
					{:else}
						<div class="flex flex-col gap-3">
							{#each patrolHistory as hist}
								{@const routeId = hist.schedule_id ? (schedules.find(s => s.id === hist.schedule_id)?.route_id) : Number(localStorage.getItem(ROUTE_STORAGE_PREFIX + hist.id))}
								{@const routeObj = routes.find(r => r.id === routeId)}
								{@const routeName = routeObj ? routeObj.name : (hist.schedule_id ? `Jadwal #${hist.schedule_id}` : 'Ronda Mandiri')}
								<div 
									class="rounded-xl p-4 flex flex-col gap-2 cursor-pointer transition-all duration-200" 
									style="background: var(--sys-fill); border: 1px solid var(--sys-sep); transition: background-color 0.2s;"
									onclick={() => toggleExpandLog(hist.id)}
									onkeydown={(e) => e.key === 'Enter' && toggleExpandLog(hist.id)}
									role="button"
									tabindex="0"
								>
									<div class="flex justify-between items-start">
										<div class="flex-1 pr-2">
											<div class="flex items-center gap-1.5">
												<p class="text-[13px] font-bold" style="color: var(--sys-label)">{routeName}</p>
												{#if expandedLogId === hist.id}
													<IconChevronUp size={14} style="color: var(--sys-label2)" />
												{:else}
													<IconChevronDown size={14} style="color: var(--sys-label2)" />
												{/if}
											</div>
											<p class="text-[11px] mt-1" style="color: var(--sys-label3)">
												Mulai: {new Date(hist.mulai).toLocaleString('id-ID')}
											</p>
											{#if hist.selesai}
												<p class="text-[11px]" style="color: var(--sys-label3)">
													Selesai: {new Date(hist.selesai).toLocaleString('id-ID')}
												</p>
											{/if}
										</div>
										<div class="flex flex-col items-end gap-1">
											<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold text-white uppercase tracking-wider" style="background: {hist.status === 'ongoing' ? '#DC2626' : 'var(--ggd)'}">
												{hist.status === 'ongoing' ? 'Berjalan' : 'Selesai'}
											</span>
											{#if hist.skor_kepatuhan !== null}
												<span class="px-2 py-0.5 rounded-full text-[10px] font-bold" style="background: {hist.skor_kepatuhan >= 80 ? 'var(--gg)' : 'var(--rel)'}; color: {hist.skor_kepatuhan >= 80 ? 'var(--ggd)' : 'var(--red)'}">
													Skor: {hist.skor_kepatuhan}%
												</span>
											{/if}
										</div>
									</div>

									{#if expandedLogId === hist.id}
										<div class="mt-3 pt-3 border-t border-dashed" style="border-color: var(--sys-sep)" onclick={(e) => e.stopPropagation()}>
											{#if loadingExpandedScans}
												<div class="flex items-center justify-center py-4">
													<IconLoader2 size={18} class="animate-spin" style="color: var(--sys-label3)" />
												</div>
											{:else if expandedLogScans.length === 0}
												<p class="text-[11px] text-center italic" style="color: var(--sys-label3)">
													Tidak ada scan terekam.
												</p>
											{:else}
												<div class="flex flex-col gap-1.5">
													<p class="text-[11px] font-bold uppercase tracking-wider mb-1" style="color: var(--sys-label3)">Detail Scan Checkpoint:</p>
													{#if routeObj}
														{#each routeObj.checkpoint_ids as cpId, idx}
															{@const matchScan = expandedLogScans.find(s => s.checkpoint_id === cpId)}
															<div class="flex items-center justify-between p-2 rounded text-[11px]" style="background: var(--sys-bg)">
																<div class="flex items-center gap-1.5">
																	{#if matchScan}
																		<IconCircleCheck size={14} style="color: var(--ggd)" />
																	{:else}
																		<IconCircle size={14} style="color: var(--sys-label3)" />
																	{/if}
																	<span style="color: {matchScan ? 'var(--sys-label)' : 'var(--sys-label3)'}">
																		{idx + 1}. {checkpointName(cpId)}
																	</span>
																</div>
																{#if matchScan}
																	<div class="flex items-center gap-1.5 text-right">
																		<span class="font-medium" style="color: {matchScan.kondisi === 'baik' ? 'var(--ggd)' : 'var(--red)'}">
																			{matchScan.kondisi === 'baik' ? 'Baik' : '⚠️'}
																		</span>
																		<span style="color: var(--sys-label3)">
																			{new Date(matchScan.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
																		</span>
																	</div>
																{:else}
																	<span class="italic text-[10px]" style="color: var(--red)">
																		Terlewat
																	</span>
																	{/if}
															</div>
														{/each}
													{:else}
														{#each expandedLogScans as scan, idx}
															<div class="flex items-center justify-between p-2 rounded text-[11px]" style="background: var(--sys-bg)">
																<div class="flex items-center gap-1.5">
																	<IconCircleCheck size={14} style="color: var(--ggd)" />
																	<span style="color: var(--sys-label)">
																		{idx + 1}. {checkpointName(scan.checkpoint_id)}
																	</span>
																</div>
																<div class="flex items-center gap-1.5 text-right">
																	<span class="font-medium" style="color: {scan.kondisi === 'baik' ? 'var(--ggd)' : 'var(--red)'}">
																		{scan.kondisi === 'baik' ? 'Baik' : '⚠️'}
																	</span>
																	<span style="color: var(--sys-label3)">
																		{new Date(scan.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
																	</span>
																</div>
															</div>
														{/each}
													{/if}
												</div>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<div class="rounded-xl p-4 mb-4" style="background: var(--rel); border: 1px solid var(--re)">
					<p class="text-[11px] font-semibold" style="color: #DC2626">Ronda Berjalan</p>
					<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Mulai: {new Date(activeLog.mulai).toLocaleString('id-ID')}</p>
				</div>

				{#if dwellInfoMsg}
					<div class="rounded-lg px-3 py-2 mb-4 text-[11px] flex items-start justify-between gap-2" style="background: rgba(234,179,8,.14); color: #a16207">
						<span>{dwellInfoMsg}</span>
						<button type="button" class="shrink-0 font-semibold" onclick={() => (dwellInfoMsg = '')}>✕</button>
					</div>
				{/if}

				{#if panicSentMsg}
					<div class="rounded-lg px-3 py-2 mb-4 text-[11px] flex items-start justify-between gap-2" style="background: {panicSentMsg.startsWith('Panic terkirim') ? 'var(--gg)' : 'var(--rel)'}; color: {panicSentMsg.startsWith('Panic terkirim') ? 'var(--ggd)' : 'var(--red)'}">
						<span>{panicSentMsg}</span>
						<button type="button" class="shrink-0 font-semibold" onclick={() => (panicSentMsg = '')}>✕</button>
					</div>
				{/if}

				{#if queuedCount > 0}
					<div class="rounded-lg px-3 py-2 mb-4 text-[11px] flex items-center justify-between gap-2" style="background: rgba(59,130,246,.12); color: #1d4ed8">
						<span>📥 {queuedCount} checklist menunggu dikirim (tersimpan offline di perangkat ini).</span>
						<button type="button" class="shrink-0 font-semibold underline disabled:opacity-50" disabled={flushingQueue} onclick={flushOfflineQueue}>
							{flushingQueue ? 'Mengirim…' : 'Kirim Sekarang'}
						</button>
					</div>
				{/if}

				{#if !selectedRoute}
					<div class="rounded-xl p-4 mb-4" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<p class="text-[12px] mb-2" style="color: var(--sys-label3)">Sesi ini belum punya rute di perangkat ini. Pilih rute untuk melanjutkan:</p>
						<select class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep); color: var(--sys-label)" onchange={(e) => pilihRuteLanjutan((e.target as HTMLSelectElement).value)}>
							<option value="">Pilih rute…</option>
							{#each routes as r}
								<option value={r.id}>{r.name}</option>
							{/each}
						</select>
					</div>
				{:else}
					<p class="text-[12px] font-semibold mb-1" style="color: var(--sys-label)">{selectedRoute.name} — {selectedRoute.checkpoint_ids.filter((id) => isScanned(id)).length}/{selectedRoute.checkpoint_ids.length} pos discan</p>
					<p class="text-[10px] mb-2" style="color: var(--sys-label4)">🔀 Urutan pos diacak untuk sesi ini — cek semua pos dengan teliti, bukan sekadar hafalan jalur.</p>
					<div class="flex flex-col gap-2 mb-4">
						{#each shuffledCheckpointIds as cpId, i}
							{@const openDwell = findOpenDwellScan(cpId)}
							<div class="rounded-lg p-3 flex items-center gap-2" style="background: var(--sys-fill)">
								{#if openDwell}
									<span class="text-[14px] shrink-0">🟡</span>
								{:else if isScanned(cpId)}
									<IconCircleCheck size={18} style="color: var(--ggd)" />
								{:else}
									<IconCircle size={18} style="color: var(--sys-label3)" />
								{/if}
								<span class="text-[12px] flex-1" style="color: var(--sys-label)">
									{i + 1}. {checkpointName(cpId)}
									{#if openDwell}
										<span class="block text-[10px]" style="color: #a16207">Sedang mengerjakan — mulai {new Date(openDwell.mulai_kerja).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} ({Math.floor(dwellElapsedMinutes(openDwell.mulai_kerja))} menit lalu)</span>
									{/if}
								</span>
								{#if openDwell}
									<button
										type="button"
										class="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white"
										style="background: #DC2626"
										onclick={() => mulaiSelesaiKerja(cpId)}
									>
										Selesai Kerja
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<button
					class="w-full rounded-lg py-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2 mb-2"
					style="background: var(--g)"
					onclick={openScanModal}
				>
					<IconQrcode size={16} /> Scan Checkpoint
				</button>
				<button
					class="w-full rounded-lg py-2.5 text-[13px] font-semibold disabled:opacity-50"
					style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
					disabled={saving}
					onclick={selesaiRonda}
				>
					{saving ? 'Menyimpan…' : 'Selesai Ronda'}
				</button>
			{/if}
		{:else}
			<!-- Gamification and Leaderboard Page -->
			<!-- Level Progress Card -->
			<div class="rounded-2xl p-5 mb-4 text-white relative overflow-hidden" style="background: linear-gradient(135deg, #1e1b4b 0%, #311042 100%); border: 1px solid rgba(255,255,255,0.08)">
				<div class="absolute -right-6 -bottom-6 opacity-10">
					<IconTrophy size={120} />
				</div>
				<div class="flex items-center gap-3 mb-4">
					<div class="w-12 h-12 rounded-2xl flex items-center justify-center text-[22px] font-bold" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2)">
						{userLevelInfo.level}
					</div>
					<div>
						<p class="text-[11px] uppercase tracking-wider text-purple-300 font-semibold">Level Petugas</p>
						<h2 class="text-[15px] font-bold">{userLevelInfo.title}</h2>
					</div>
				</div>

				<div class="mb-2 flex justify-between text-[11px] text-purple-200">
					<span>XP: {userXp}</span>
					{#if userLevelInfo.level < 4}
						<span>Tersisa {userLevelInfo.maxXp - userXp} XP ke Level {userLevelInfo.level + 1}</span>
					{:else}
						<span>Level Maksimum ✨</span>
					{/if}
				</div>

				{#if userLevelInfo.level < 4}
					{@const percentage = Math.min(100, Math.round((userLevelInfo.currentProgress / (userLevelInfo.maxXp - userLevelInfo.minXp)) * 100))}
					<div class="w-full h-2 rounded-full overflow-hidden" style="background: rgba(255,255,255,0.15)">
						<div class="h-full rounded-full transition-all duration-500" style="width: {percentage}%; background: linear-gradient(90deg, #c084fc, #818cf8)"></div>
					</div>
				{/if}
			</div>

			<!-- Quick Performance Stats -->
			<div class="grid grid-cols-2 gap-3 mb-6">
				<div class="rounded-xl p-4 flex flex-col justify-between" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<div class="flex items-center gap-2 mb-2">
						<IconChartBar size={16} style="color: var(--sys-label2)" />
						<span class="text-[11px] font-semibold" style="color: var(--sys-label2)">Total Ronda</span>
					</div>
					<p class="text-[18px] font-bold" style="color: var(--sys-label)">{stats.totalPatrols} Sesi</p>
				</div>
				<div class="rounded-xl p-4 flex flex-col justify-between" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<div class="flex items-center gap-2 mb-2">
						<IconAward size={16} style="color: var(--sys-label2)" />
						<span class="text-[11px] font-semibold" style="color: var(--sys-label2)">Rata-rata Skor</span>
					</div>
					<p class="text-[18px] font-bold" style="color: var(--sys-label)">{stats.avgScore}%</p>
				</div>
			</div>

			<!-- Weekly Leaderboard -->
			<div class="rounded-xl p-4 mb-6" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<div class="flex items-center gap-2 mb-4">
					<IconTrophy size={16} style="color: var(--sys-label)" />
					<h3 class="text-[13px] font-bold" style="color: var(--sys-label)">Peringkat Minggu Ini</h3>
				</div>

				<div class="flex flex-col gap-2">
					{#each mockLeaderboard as item, idx}
						<div class="flex items-center justify-between p-2.5 rounded-lg text-[12px] transition-all" style="background: {item.isUser ? 'rgba(99, 102, 241, 0.15)' : 'var(--sys-bg)'}; border: 1px solid {item.isUser ? 'rgba(99, 102, 241, 0.3)' : 'var(--sys-sep)'}">
							<div class="flex items-center gap-2.5">
								<span class="font-bold text-[11px] w-4 text-center {idx === 0 ? 'text-yellow-500' : idx === 1 ? 'text-slate-300' : idx === 2 ? 'text-amber-600' : ''}" style="color: {idx < 3 ? '' : 'var(--sys-label2)'}">
									{idx + 1}
								</span>
								<span class="text-[14px]">{item.avatar}</span>
								<span class="font-semibold {item.isUser ? 'text-indigo-400 font-bold' : ''}" style="color: var(--sys-label)">{item.name}</span>
							</div>
							<span class="font-bold" style="color: var(--sys-label)">{item.xp} XP</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Achievements / Badges section -->
			<div>
				<div class="flex items-center gap-2 mb-3">
					<IconStar size={16} style="color: var(--sys-label)" />
					<h3 class="text-[13px] font-bold" style="color: var(--sys-label)">Lencana Pencapaian</h3>
				</div>

				<div class="grid grid-cols-2 gap-3">
					{#each badges as badge}
						<div class="rounded-xl p-3.5 flex flex-col items-center text-center transition-all duration-300 {badge.unlocked ? 'opacity-100' : 'opacity-40 filter grayscale'}" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<div class="w-10 h-10 rounded-full flex items-center justify-center text-[20px] mb-2" style="background: {badge.unlocked ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.05)'}">
								{badge.icon}
							</div>
							<h4 class="text-[11px] font-bold mb-0.5" style="color: var(--sys-label)">{badge.name}</h4>
							<p class="text-[9px]" style="color: var(--sys-label3)">{badge.desc}</p>
							{#if badge.unlocked}
								<span class="mt-2 text-[8px] uppercase tracking-wider font-extrabold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">Tercapai</span>
							{:else}
								<span class="mt-2 text-[8px] uppercase tracking-wider font-extrabold text-gray-500 bg-gray-500/10 px-1.5 py-0.5 rounded">Terkunci</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

{#if showScanModal}
	<div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style="background: rgba(0,0,0,0.4)" onclick={() => { if (!checklistStep) showScanModal = false; }}>
		<div class="bg-white rounded-2xl w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
			{#if !checklistStep}
				<div class="flex items-center justify-between mb-3">
					<h2 class="text-[14px] font-bold" style="color: var(--sys-label)">Scan Checkpoint</h2>
					<button type="button" onclick={() => (showScanModal = false)}><IconX size={18} /></button>
				</div>

				{#if scanError}
					<div class="rounded-lg p-2 mb-3 text-[11px]" style="background: var(--rel); color: var(--red)">{scanError}</div>
				{/if}

				{#if velocityBlocked}
					<div class="rounded-lg p-2 mb-3 text-[11px]" style="background: rgba(234,179,8,.14); color: #a16207">
						Scan sebelumnya baru saja tercatat. Tunggu {velocitySecondsLeft} detik lagi, atau isi alasan di bawah untuk melanjutkan.
					</div>
				{/if}

				{#if patrolSettings.manualInputMode === 'enabled'}
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Kode Checkpoint</label>
					<div class="flex gap-2 mb-3">
						<input
							class="flex-1 rounded-lg px-3 py-2 text-[13px]"
							style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
							placeholder="Ketik kode (mis. CP-01) atau scan QR"
							bind:value={scanCode}
						/>
						<button
							type="button"
							class="rounded-lg px-3 flex items-center justify-center text-white shrink-0"
							style="background: var(--g)"
							onclick={() => { showCameraScanner = true; }}
							title="Buka kamera & scan QR"
						>
							<IconQrcode size={18} />
						</button>
					</div>
				{:else}
					<button
						type="button"
						class="w-full rounded-lg py-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2 mb-3"
						style="background: var(--g)"
						onclick={() => { showCameraScanner = true; }}
					>
						<IconQrcode size={18} /> Buka Kamera & Scan QR
					</button>

					{#if patrolSettings.manualInputMode === 'supervisor_override'}
						{#if !showManualCodeInput}
							<button
								type="button"
								class="w-full rounded-lg py-2 mb-3 text-[11px] font-medium relative overflow-hidden"
								style="background: var(--sys-fill); color: var(--sys-label3); border: 1px solid var(--sys-sep)"
								onpointerdown={startManualHold}
								onpointerup={cancelManualHold}
								onpointerleave={cancelManualHold}
							>
								{#if manualHoldProgress > 0}
									<span class="absolute inset-y-0 left-0" style="width: {manualHoldProgress}%; background: rgba(220,38,38,.15)"></span>
								{/if}
								<span class="relative">QR rusak? Tahan 3 detik untuk override supervisor</span>
							</button>
						{:else}
							<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Kode Checkpoint (Override Supervisor)</label>
							<input
								class="w-full rounded-lg px-3 py-2 text-[13px] mb-2"
								style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
								placeholder="Ketik kode (mis. CP-01)"
								bind:value={scanCode}
							/>
							<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Alasan (wajib)</label>
							<textarea
								rows="2"
								class="w-full rounded-lg px-3 py-2 text-[13px] mb-3"
								style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
								placeholder="Contoh: stiker QR rusak/hilang, dikonfirmasi Danru"
								bind:value={manualOverrideReason}
							></textarea>
						{/if}
					{/if}
				{/if}

				{#if velocityBlocked && !showManualCodeInput}
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Alasan scan cepat (wajib)</label>
					<textarea
						rows="2"
						class="w-full rounded-lg px-3 py-2 text-[13px] mb-3"
						style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
						placeholder="Contoh: pos berdekatan, sudah diperiksa sebelumnya"
						bind:value={manualOverrideReason}
					></textarea>
				{/if}

				<button
					type="button"
					class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
					style="background: var(--g)"
					disabled={scanning || (showManualCodeInput && !scanCode.trim())}
					onclick={submitScan}
				>
					{#if scanning}<IconLoader2 size={16} class="animate-spin" />{:else}<IconQrcode size={16} />{/if}
					{scanning ? 'Memproses…' : 'Lanjut'}
				</button>
			{:else}
				<div class="flex items-center justify-between mb-3">
					<h2 class="text-[14px] font-bold" style="color: var(--sys-label)">
					{activeDwellScan ? 'Selesai Kerja' : 'Checklist Pos'} — {checklistCheckpoint ? checkpointName(checklistCheckpoint.id) : ''}
				</h2>
					<button type="button" onclick={() => {
						const confirmMsg = activeDwellScan
							? 'Batal? Pekerjaan tetap tercatat "Sedang Mengerjakan" — bisa dilanjutkan nanti dari daftar checkpoint.'
							: 'Batal mengisi checklist? Data scan ini tidak akan disimpan.';
						if (confirm(confirmMsg)) {
							checklistStep = false;
							showScanModal = false;
							pendingScanPayload = null;
							activeDwellScan = null;
							dwellOverrideReason = '';
							clearChecklistDraft();
						}
					}}><IconX size={18} /></button>
				</div>

				{#if checklistLoading}
					<div class="flex items-center justify-center py-10">
						<IconLoader2 size={22} class="animate-spin" style="color: var(--sys-label3)" />
					</div>
				{:else}
					{#if checklistError}
						<div class="rounded-lg p-2 mb-3 text-[11px]" style="background: var(--rel); color: var(--red)">{checklistError}</div>
					{/if}
					<p class="text-[11px] mb-3" style="color: var(--sys-label3)">{checklistTemplateName}</p>

					{#each Object.entries(checklistGroupedByCategory()) as [category, catItems]}
						<h3 class="text-[11px] font-semibold mt-3 mb-2" style="color: var(--sys-label)">{category}</h3>
						<div class="flex flex-col gap-2 mb-2">
							{#each catItems as item}
								<div class="rounded-lg p-3" style="background: var(--sys-fill)">
									<p class="text-[12px] font-medium mb-1" style="color: var(--sys-label)">
										{item.item_name}{item.is_critical ? ' *' : ''}
									</p>
									{#if item.description}
										<p class="text-[11px] text-gray-500 mb-2 italic" style="color: var(--sys-label3)">
											{item.description}
										</p>
									{/if}
									<div class="flex gap-1 mb-2">
										{#each [['yes', 'Ya', 'var(--gg)', 'var(--ggd)'], ['no', 'Tidak', 'var(--rel)', 'var(--red)'], ['na', 'N/A', 'var(--sys-fill3)', 'var(--sys-label)']] as [val, label, bg, color]}
											<button
												type="button"
												class="px-3 py-1 rounded-full text-[11px] font-semibold"
												style="background: {checklistAnswers[item.id]?.answer === val ? bg : 'transparent'}; color: {checklistAnswers[item.id]?.answer === val ? color : 'var(--sys-label3)'}"
												onclick={() => setChecklistAnswer(item.id, val as any)}
											>
												{label}
											</button>
										{/each}
									</div>
									{#if checklistAnswers[item.id]?.answer === 'no'}
										<textarea
											rows="2"
											placeholder="Catatan temuan..."
											class="w-full rounded-lg px-2 py-1.5 text-[12px] mb-2"
											style="background: var(--sys-bg); border: 1px solid var(--sys-sep)"
											bind:value={checklistAnswers[item.id].notes}
											oninput={scheduleDraftSave}
										></textarea>
									{/if}
					<div class="flex items-center gap-3">
										<button
											type="button"
											class="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-white bg-zinc-800 px-3 py-1.5 rounded-lg"
											onclick={async () => {
												await saveChecklistDraft();
												await loadCameraCaptureModal();
												showCameraCapture = true;
												cameraCaptureTarget = { itemId: item.id };
											}}
										>
											<IconCamera size={14} />
											{checklistPhotos[item.id] ? 'Ganti foto' : 'Ambil foto'}
										</button>
										{#if patrolSettings.galleryUploadEnabled || cameraLoadFailed}
											<label class="text-[11px] cursor-pointer text-zinc-500 hover:text-zinc-400 underline">
												{cameraLoadFailed ? 'Kamera tidak tersedia — pilih foto' : 'Pilih file'}
												<input type="file" accept="image/*" capture="environment" class="hidden" onchange={(e) => onChecklistPhotoChange(item.id, e)} />
											</label>
										{/if}
									</div>
									{#if checklistPhotoPreviews[item.id]}
										<img src={checklistPhotoPreviews[item.id]} alt="Bukti" class="mt-2 rounded-lg max-h-32 object-cover" />
									{/if}
								</div>
							{/each}
						</div>
					{/each}

					<h3 class="text-[11px] font-semibold mt-3 mb-2" style="color: var(--sys-label)">Kondisi Checkpoint</h3>
					<div class="rounded-lg p-3 mb-3 flex flex-col gap-3" style="background: var(--sys-fill)">
						<div>
							<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Kondisi</label>
							<select class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" bind:value={scanKondisi} onchange={scheduleDraftSave}>
								<option value="baik">Baik</option>
								<option value="perlu_perhatian">Perlu Perhatian</option>
							</select>
						</div>

						<div>
							<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Catatan (opsional)</label>
							<textarea rows="2" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" bind:value={scanCatatan} oninput={scheduleDraftSave}></textarea>
						</div>

						<div>
							<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Foto Kondisi (wajib)</label>
							<div class="flex flex-col gap-2">
								<div class="flex flex-wrap items-center gap-2">
									<button
										type="button"
										class="px-3 py-2 rounded-lg text-[12px] font-semibold text-white flex items-center gap-1.5"
										style="background: var(--g)"
										onclick={async () => {
											await saveChecklistDraft();
											await loadCameraCaptureModal();
											showCameraCapture = true;
											cameraCaptureTarget = 'scanFoto';
										}}
									>
										<IconCamera size={14} /> Ambil Foto Kamera
									</button>
									{#if patrolSettings.galleryUploadEnabled || cameraLoadFailed}
										<span class="text-[11px] text-gray-500">atau</span>
										<input type="file" accept="image/*" capture="environment" onchange={onScanFotoChange} class="text-[12px] max-w-[150px]" />
									{/if}
								</div>
								{#if scanFoto}
									<span class="text-[11px] text-green-500 font-medium">✓ Foto terpasang ({scanFoto.name})</span>
								{/if}
							</div>
						</div>
					</div>

					<h3 class="text-[11px] font-semibold mt-3 mb-2" style="color: var(--sys-label)">Tanda Tangan Petugas</h3>
					<div class="rounded-lg mb-2" style="background: #fff; border: 1px solid var(--sys-sep)">
						<canvas
							bind:this={checklistCanvasEl}
							width="300"
							height="120"
							class="w-full touch-none"
							onpointerdown={checklistStartDraw}
							onpointermove={checklistDraw}
							onpointerup={checklistEndDraw}
							onpointerleave={checklistEndDraw}
						></canvas>
					</div>
					<button type="button" class="flex items-center gap-1 text-[11px] mb-4" style="color: var(--sys-label3)" onclick={checklistClearSignature}>
						<IconTrash size={12} /> Hapus & ulangi
					</button>

					{#if ruanganCekGate?.wajib}
						<div class="rounded-lg p-3 mb-3" style="background: rgba(220,38,38,.1); border: 1px solid rgba(220,38,38,.3)">
							<p class="text-[11px] font-semibold mb-1" style="color: #DC2626">
								Cek kelengkapan ruangan ini belum dilakukan (wajib untuk area kebersihan berbarang).
							</p>
							<a href={`/ruangan/${ruanganCekGate.areaId}/cek`} target="_blank" rel="noopener" class="text-[11px] font-semibold underline" style="color: #DC2626">
								Buka Cek Kelengkapan Ruangan
							</a>
							{#if patrolSettings.wajibCekRuanganMode === 'soft'}
								<label class="text-[11px] font-semibold mt-2 mb-1 block" style="color: var(--sys-label)">Atau isi alasan untuk melewati (wajib)</label>
								<textarea
									rows="2"
									class="w-full rounded-lg px-2.5 py-1.5 text-[12px]"
									style="background: var(--sys-bg); border: 1px solid var(--sys-sep)"
									placeholder="Contoh: sudah dicek pagi ini oleh rekan, tercatat manual"
									bind:value={ruanganCekSkipReason}
								></textarea>
							{/if}
						</div>
					{/if}

					{#if activeDwellScan && isDwellViolation(new Date(activeDwellScan.mulaiKerja).getTime(), Date.now(), patrolSettings.minDwellMinutes)}
						<div class="rounded-lg p-3 mb-3" style="background: rgba(234,179,8,.14)">
							<p class="text-[11px] font-semibold mb-1" style="color: #a16207">
								Baru {Math.floor(dwellElapsedMinutes(activeDwellScan.mulaiKerja))} menit bekerja (minimal {patrolSettings.minDwellMinutes} menit). Isi alasan untuk menyelesaikan lebih awal.
							</p>
							<textarea
								rows="2"
								class="w-full rounded-lg px-2.5 py-1.5 text-[12px]"
								style="background: var(--sys-bg); border: 1px solid var(--sys-sep)"
								placeholder="Contoh: area kecil, sudah selesai lebih cepat dari estimasi"
								bind:value={dwellOverrideReason}
							></textarea>
						</div>
					{/if}

					<button
						type="button"
						class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
						style="background: var(--g)"
						disabled={checklistSaving || (ruanganCekGate?.wajib && patrolSettings.wajibCekRuanganMode === 'hard')}
						onclick={submitChecklistStep}
					>
						{#if checklistSaving}<IconLoader2 size={16} class="animate-spin" />{/if}
						{checklistSaving ? 'Mengirim…' : activeDwellScan ? 'Selesai Kerja' : 'Submit Checklist Pos'}
					</button>
					<div class="flex justify-center mt-2">
						<DraftIndicator savedAt={checklistDraftSavedAt} />
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}

{#if showCameraScanner}
	<QrScannerModal
		onDetect={(value) => { 
			let extracted = value.trim();
			try {
				if (extracted.startsWith('http')) {
					const url = new URL(extracted);
					if (url.searchParams.has('code')) {
						extracted = url.searchParams.get('code')!;
					} else {
						const parts = url.pathname.split('/').filter(Boolean);
						if (parts.length > 0) extracted = parts[parts.length - 1];
					}
				}
			} catch (err) {}

			// Bersihkan prefix khusus (misal "EPI:", "EPI:CP:", atau sejenisnya) jika ada di QR code cetakan
			if (extracted.startsWith('EPI:CP:')) {
				extracted = extracted.replace('EPI:CP:', '');
			} else if (extracted.startsWith('EPI:')) {
				extracted = extracted.replace('EPI:', '');
			}
			
			scanCode = extracted; 
			showCameraScanner = false; 
			
			// Auto submit setelah modal QR tertutup
			setTimeout(() => {
				submitScan();
			}, 300);
		}}
		onClose={() => (showCameraScanner = false)}
	/>
{/if}

{#if showCameraCapture && CameraCaptureModal}
	<CameraCaptureModal
		onCapture={handleCameraCapture}
		onClose={() => { showCameraCapture = false; cameraCaptureTarget = null; }}
	/>
{/if}

{#if showDurasiOverrideModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.4)" onclick={() => (showDurasiOverrideModal = false)}>
		<div class="bg-white rounded-2xl w-full max-w-sm p-5" onclick={(e) => e.stopPropagation()}>
			<h2 class="text-[14px] font-bold mb-2" style="color: var(--sys-label)">
				{selesaiRondaDitolakDurasi() ? 'Ronda Belum Mencapai Durasi Minimal' : 'Anomali Kecepatan Scan Terdeteksi'}
			</h2>
			<p class="text-[12px] mb-3" style="color: var(--sys-label3)">
				{#if selesaiRondaDitolakDurasi()}
					Sesi ronda ini belum mencapai durasi minimal {patrolSettings.minPatrolDurationMinutes} menit.
				{/if}
				{#if selesaiRondaAdaAnomaliSpeedrun()}
					Ada scan dengan override (kecepatan/manual) pada sesi ini.
				{/if}
				Pastikan semua pos sudah diperiksa dengan teliti, lalu isi alasan untuk tetap menyelesaikan.
			</p>
			<textarea
				rows="3"
				class="w-full rounded-lg px-3 py-2 text-[13px] mb-3"
				style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
				placeholder="Alasan menyelesaikan ronda lebih awal..."
				bind:value={durasiOverrideReason}
			></textarea>
			<div class="flex gap-2">
				<button
					type="button"
					class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold"
					style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
					onclick={() => { showDurasiOverrideModal = false; durasiOverrideReason = ''; }}
				>
					Batal
				</button>
				<button
					type="button"
					class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
					style="background: #DC2626"
					disabled={!durasiOverrideReason.trim() || saving}
					onclick={konfirmasiDurasiOverride}
				>
					{saving ? 'Menyimpan…' : 'Selesaikan Ronda'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if activeLog}
	<!-- R4 Panic Button — akses cepat dari alur patroli aktif, tidak perlu pindah halaman. -->
	<button
		type="button"
		class="fixed bottom-24 right-4 z-40 w-14 h-14 rounded-full text-white flex items-center justify-center shadow-lg disabled:opacity-50"
		style="background: #DC2626"
		title="Kirim laporan darurat (PANIC) ke supervisor & HRD"
		disabled={panicSaving}
		onclick={() => (showPanicConfirm = true)}
	>
		{#if panicSaving}
			<IconLoader2 size={22} class="animate-spin" />
		{:else}
			<span class="text-[22px]">🆘</span>
		{/if}
	</button>
{/if}

{#if showPanicConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.5)" onclick={() => (showPanicConfirm = false)}>
		<div class="bg-white rounded-2xl w-full max-w-sm p-5" onclick={(e) => e.stopPropagation()}>
			<h2 class="text-[15px] font-bold mb-2" style="color: #DC2626">🆘 Kirim Laporan Darurat?</h2>
			<p class="text-[12px] mb-4" style="color: var(--sys-label3)">
				Lokasi GPS Anda saat ini akan dikirim bersama notifikasi darurat ke supervisor & HRD secara langsung. Gunakan hanya untuk situasi darurat sesungguhnya.
			</p>
			<div class="flex gap-2">
				<button
					type="button"
					class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold"
					style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
					onclick={() => (showPanicConfirm = false)}
				>
					Batal
				</button>
				<button
					type="button"
					class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold text-white"
					style="background: #DC2626"
					onclick={triggerPanic}
				>
					Ya, Kirim Sekarang
				</button>
			</div>
		</div>
	</div>
{/if}
