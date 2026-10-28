<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { fetchTemplateWithItems, submitChecklistResponse, verifyCheckpoint, type ChecklistItemDef, type ItemAnswer } from '$lib/services/gaChecklist';
	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	import { IconArrowLeft, IconLoader2, IconCamera, IconTrash, IconQrcode, IconAlertTriangle } from '@tabler/icons-svelte';
	import { getCurrentPosition } from '$lib/utils/geoClient';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import { openDB } from 'idb';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { gaChecklistAnswersSchema } from '$lib/schemas/gaChecklistSubmit';

	// Masa berlaku draf (rencana v2, Fase 3, 3.1) — draf sesi lama tidak boleh dipulihkan diam-diam.
	const GA_DRAFT_TTL_MS = 12 * 60 * 60 * 1000;
	let draftSavedAt = $state<Date | null>(null);

	const areaId = Number(page.url.searchParams.get('area_id'));
	const templateId = Number(page.url.searchParams.get('template_id'));

	let loading = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');
	let templateName = $state('');
	let items = $state<ChecklistItemDef[]>([]);
	let answers = $state<Record<number, { answer: 'yes' | 'no' | 'na'; notes: string }>>({});
	let photos = $state<Record<number, File>>({});
	let photoPreviews = $state<Record<number, string>>({});

	// ---- Gerbang scan QR titik lokasi — wajib sebelum form checklist muncul ----
	let checkpointId = $state<number | null>(null);
	let checkpointName = $state('');
	let showScanner = $state(false);
	let scanError = $state('');
	let verifying = $state(false);
	let showManualInput = $state(false);
	let manualCode = $state('');

	function verifyManualCode() {
		const entered = manualCode.trim();
		if (!entered) {
			scanError = 'Masukkan kode QR titik lokasi terlebih dahulu.';
			return;
		}
		onScanDetect(entered);
	}

	async function onScanDetect(code: string) {
		showScanner = false;
		verifying = true;
		scanError = '';
		try {
			let lat: number | null = null;
			let lng: number | null = null;
			try {
				const pos = await getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
				lat = pos.lat;
				lng = pos.lng;
			} catch (geoErr) {
				throw new Error('Akses GPS/lokasi wajib diaktifkan untuk memverifikasi checkpoint.');
			}

			const result = await verifyCheckpoint(code, areaId, lat, lng);
			checkpointId = result.checkpoint_id;
			checkpointName = result.checkpoint_name;
			await loadTemplate();
		} catch (err) {
			scanError = err instanceof Error ? err.message : 'Gagal memverifikasi QR titik lokasi.';
		}
		verifying = false;
	}

	let canvasEl: HTMLCanvasElement;
	let drawing = false;
	let hasSignature = $state(false);

	let dbPromise: Promise<import('idb').IDBPDatabase> | null = null;
	function getDB() {
		if (!dbPromise) {
			dbPromise = openDB('ga-draft-db', 1, {
				upgrade(db) {
					if (!db.objectStoreNames.contains('drafts')) {
						db.createObjectStore('drafts');
					}
				}
			});
		}
		return dbPromise;
	}

	async function saveDraft() {
		if (!areaId || !templateId) return;
		try {
			const db = await getDB();
			const plainPhotos: Record<number, File> = {};
			for (const key in photos) {
				plainPhotos[key] = photos[key];
			}
			const state = {
				savedAt: Date.now(),
				checkpointId,
				checkpointName,
				answers: $state.snapshot(answers),
				photos: plainPhotos
			};
			await db.put('drafts', state, `${areaId}-${templateId}`);
			draftSavedAt = new Date(state.savedAt);
		} catch (e) {
			console.warn('Gagal menyimpan draft:', e);
		}
	}

	async function loadDraft() {
		try {
			const db = await getDB();
			const state = await db.get('drafts', `${areaId}-${templateId}`);
			if (state) {
				if (state.savedAt && Date.now() - state.savedAt > GA_DRAFT_TTL_MS) {
					await clearDraft();
					return false;
				}
				if (state.checkpointId) checkpointId = state.checkpointId;
				if (state.checkpointName) checkpointName = state.checkpointName;
				if (state.answers) answers = state.answers;
				if (state.photos) {
					photos = state.photos;
					for (const key in photos) {
						photoPreviews[Number(key)] = URL.createObjectURL(photos[key]);
					}
				}
				draftSavedAt = state.savedAt ? new Date(state.savedAt) : null;
				return true;
			}
		} catch (e) {
			console.warn('Gagal memuat draft:', e);
		}
		return false;
	}

	async function clearDraft() {
		draftSavedAt = null;
		try {
			const db = await getDB();
			await db.delete('drafts', `${areaId}-${templateId}`);
		} catch (e) {}
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'access_ga_checklist', roles)) {
			goto('/');
		}
	});

	let draftTimeout: ReturnType<typeof setTimeout>;
	$effect(() => {
		const _a = $state.snapshot(answers);
		const _p = Object.keys(photos);
		const _c = checkpointId;
		if (_c || Object.keys(_a).length > 0 || _p.length > 0) {
			clearTimeout(draftTimeout);
			draftTimeout = setTimeout(() => {
				saveDraft();
			}, 1000);
		}
	});

	async function loadTemplate() {
		loading = true;
		try {
			const tpl = await fetchTemplateWithItems(templateId);
			templateName = tpl.name;
			items = tpl.items;
			for (const it of items) {
				if (!answers[it.id]) {
					answers[it.id] = { answer: 'na', notes: '' };
				}
			}
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat checklist.';
		}
		loading = false;
	}

	// Chip "Barang di ruangan ini" (Fase 2) + banner pengingat cek (Fase 4, mode 'soft').
	// Fase 1 Kontrol Patroli: banner bisa naik jadi WAJIB (soft/hard) via app_settings
	// module='patrol_control' key='wajib_cek_ruangan_mode' — lihat patrolControlSettings.ts.
	// Non-blocking secara UI kalau gagal fetch: chip tetap tampil tanpa angka, banner tidak ditampilkan.
	let showBarangChip = $state(false);
	let barangCount = $state<number | null>(null);
	let showCekBanner = $state(false);
	let cekBannerHari = $state(0);
	let cekWajib = $state(false);
	let cekWajibMode = $state<'shadow' | 'soft' | 'hard'>('soft');
	let ruanganCekSkipReason = $state('');
	let ruanganAreaId = $state<number | null>(null);
	async function loadBarangChip() {
		if (!Number.isFinite(areaId) || areaId <= 0) return;
		try {
			const [{ fetchRuangan }, { fetchPatrolControlSettings }] = await Promise.all([
				import('$lib/services/gaRuangan'),
				import('$lib/services/patrolControl')
			]);
			const [data, patrolSettings] = await Promise.all([fetchRuangan(areaId), fetchPatrolControlSettings()]);
			barangCount = data.summary?.jenis ?? null;
			showBarangChip = true;
			ruanganAreaId = areaId;
			cekWajibMode = patrolSettings.wajibCekRuanganMode;
			if (data.assets.length > 0 && patrolSettings.wajibCekRuanganMode !== 'shadow') {
				const lastIso = data.last_check?.waktu ?? null;
				const hari = lastIso ? Math.floor((Date.now() - new Date(lastIso).getTime()) / 86_400_000) : Infinity;
				if (hari >= data.interval_cek_hari) {
					showCekBanner = true;
					cekBannerHari = Number.isFinite(hari) ? hari : data.interval_cek_hari;
					cekWajib = true;
				}
			}
		} catch {
			showBarangChip = true; // tetap tampilkan pintasannya, tanpa angka
		}
	}

	onMount(async () => {
		if (!areaId || !templateId) {
			errorMsg = 'Parameter area/checklist tidak lengkap.';
			loading = false;
			return;
		}
		void loadBarangChip();
		const hasDraft = await loadDraft();
		if (hasDraft && checkpointId) {
			await loadTemplate();
		}
		loading = false;
	});

	// Jaring pengaman (rencana v2, Fase 3, 3.1): titik simpan wajib pagehide & visibilitychange,
	// BUKAN beforeunload — tidak diandalkan di Android saat OS mematikan tab karena RAM habis.
	onMount(() => {
		const flush = () => { saveDraft(); };
		const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
		window.addEventListener('pagehide', flush);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			window.removeEventListener('pagehide', flush);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});

	function groupedByCategory() {
		const groups: Record<string, ChecklistItemDef[]> = {};
		for (const it of items) {
			const cat = it.category || 'Lainnya';
			if (!groups[cat]) groups[cat] = [];
			groups[cat].push(it);
		}
		return groups;
	}

	async function onPhotoChange(itemId: number, e: Event) {
		const input = e.target as HTMLInputElement;
		const rawFile = input.files?.[0];
		if (!rawFile) return;

		const compressed = await compressPhoto(rawFile);
		// R2 — watermark waktu/GPS ke foto bukti checklist.
		let file = compressed;
		try {
			const pos = await getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 }).catch(() => null);
			const gps = pos ? { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy ?? 0 } : null;
			file = await watermarkPhoto(compressed, gps);
		} catch {
			// best-effort — foto tanpa watermark tetap bisa dipakai
		}

		photos[itemId] = file;
		photoPreviews[itemId] = URL.createObjectURL(file);
	}

	function scoringPreview() {
		const applicable = Object.values(answers).filter((a) => a.answer !== 'na');
		const passed = applicable.filter((a) => a.answer === 'yes');
		return applicable.length ? Math.round((passed.length / applicable.length) * 1000) / 10 : 100;
	}

	function getPos(e: PointerEvent) {
		const rect = canvasEl.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	function startDraw(e: PointerEvent) {
		drawing = true;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;
		const { x, y } = getPos(e);
		ctx.beginPath();
		ctx.moveTo(x, y);
	}

	function draw(e: PointerEvent) {
		if (!drawing) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;
		const { x, y } = getPos(e);
		ctx.lineWidth = 2;
		ctx.lineCap = 'round';
		ctx.strokeStyle = '#111827';
		ctx.lineTo(x, y);
		ctx.stroke();
		hasSignature = true;
	}

	function endDraw() {
		drawing = false;
	}

	function clearSignature() {
		const ctx = canvasEl.getContext('2d');
		ctx?.clearRect(0, 0, canvasEl.width, canvasEl.height);
		hasSignature = false;
	}

	// "Quick Report Kerusakan" (rekomendasi implementation_plan_panduan hrd.md, persona
	// OB/Cleaning): reuse /support (bukan sistem tiket baru) — auto-create tiket Service
	// Desk dgn departemen GA & lokasi checkpoint terisi, tanpa harus buka modul terpisah.
	function reportDamage() {
		const params = new URLSearchParams({
			tipe: 'Komplain',
			departemen: 'GA',
			judul: 'Kerusakan fasilitas ditemukan',
			lokasi: checkpointName || ''
		});
		goto(`/support/baru?${params.toString()}`);
	}

	// R2 (rencana v2 Fase 6, 16 Sep 2026): true setelah petugas menekan "Tetap Kirim" pada
	// dialog konfirmasi submit ganda.
	let confirmResubmit = $state(false);
	// G_CLN2 (mode soft): alasan tetap mengirim checklist yang belum lengkap, diminta setelah
	// server menjawab 422. Foto & jawaban tetap di state, jadi kirim ulang tidak kehilangan data.
	let gateCln2Reason = $state('');

	async function submit() {
		errorMsg = '';
		successMsg = '';
		if (!checkpointId) {
			errorMsg = 'Scan QR titik lokasi terlebih dahulu.';
			return;
		}
		if (!hasSignature) {
			errorMsg = 'Tanda tangan pelaksana wajib diisi.';
			return;
		}
		const unanswered = items.filter((it) => !answers[it.id] || answers[it.id].answer === 'na');
		if (unanswered.length === items.length) {
			errorMsg = 'Isi minimal satu item checklist.';
			return;
		}
		if (cekWajib) {
			if (cekWajibMode === 'hard') {
				errorMsg = 'Cek kelengkapan ruangan wajib diselesaikan dulu sebelum checklist ini bisa dikirim.';
				return;
			}
			if (cekWajibMode === 'soft' && !ruanganCekSkipReason.trim()) {
				errorMsg = 'Cek kelengkapan ruangan belum dilakukan. Isi alasan untuk melewati, atau selesaikan cek ruangan terlebih dulu.';
				return;
			}
		}

		saving = true;
		try {
			const rawResponses = items.map((it) => ({
				item_id: it.id,
				answer: answers[it.id].answer,
				notes: answers[it.id].notes
			}));
			const responsesParsed = gaChecklistAnswersSchema.safeParse(rawResponses);
			if (!responsesParsed.success) {
				errorMsg = responsesParsed.error.issues[0]?.message || 'Data jawaban checklist tidak valid.';
				saving = false;
				return;
			}
			const responses: ItemAnswer[] = responsesParsed.data;
			const signature = canvasEl.toDataURL('image/png');
			const res = await submitChecklistResponse({
				area_id: areaId,
				template_id: templateId,
				checkpoint_id: checkpointId,
				responses,
				signature,
				photos,
				confirmResubmit,
				ruangan_cek_skip_reason: cekWajib ? ruanganCekSkipReason.trim() || undefined : undefined,
					gate_cln2_reason: gateCln2Reason.trim() || undefined
			});
			successMsg = res.queued
				? 'Checklist disimpan lokal — akan dikirim otomatis saat online.'
				: `Checklist terkirim. Skor: ${res.record?.scoring_result ?? '-'}%. Menunggu verifikasi supervisor.`;
			await clearDraft();
		} catch (err) {
			// R2: server menolak dengan 409 bila ruangan ini sudah disubmit hari ini oleh
			// karyawan yang sama -- tawarkan konfirmasi, BUKAN blokir keras (Aturan #6).
			if (err instanceof Error && (err as any).isDuplicateSubmit) {
				if (confirm(`${err.message}\n\nTetap kirim checklist baru ini?`)) {
					confirmResubmit = true;
					saving = false;
					await submit();
					return;
				}
				errorMsg = 'Submit dibatalkan.';
				} else if (err instanceof Error && (err as any).isGateCln2) {
					// G_CLN2 soft: minta alasan lalu kirim ulang; batal = tetap di halaman untuk melengkapi.
					const alasan = window.prompt(`${err.message}\n\nAlasan tetap mengirim (min. 5 karakter):`, '');
					if (alasan && alasan.trim().length >= 5) {
						gateCln2Reason = alasan.trim();
						saving = false;
						await submit();
						return;
					}
					errorMsg = err.message;
			} else {
				errorMsg = err instanceof Error ? err.message : 'Gagal mengirim checklist.';
			}
		} finally {
			saving = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/ga-checklist')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold flex-1" style="color: var(--sys-label)">{templateName || 'Checklist'}</h1>
		</div>

		{#if Number.isFinite(areaId) && areaId > 0 && showBarangChip}
			<!-- Pintasan ke Halaman Ruangan (Barang per Ruangan via QR Patroli). Tab baru
			     supaya draf checklist di halaman ini tidak hilang. -->
			<a
				href={`/ruangan/${areaId}`}
				target="_blank"
				rel="noopener"
				class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 mb-4 text-[12px] font-medium"
				style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
				title="Lihat daftar barang yang tercatat di ruangan ini menurut GA. Membuka tab baru — isian checklist Anda aman."
			>
				🪑 Barang di ruangan ini{barangCount != null ? ` (${barangCount})` : ''}
			</a>
		{/if}

		{#if showCekBanner && !cekWajib}
			<!-- Pengingat LUNAK (mode shadow/off) -- TIDAK memblokir submit checklist. -->
			<div class="rounded-lg px-3 py-2 mb-4 text-[11px] flex items-center justify-between gap-2" style="background: rgba(234,179,8,.14); color: #a16207">
				<span>Barang ruangan ini belum dicek {cekBannerHari} hari. Cek sekarang? (tidak wajib)</span>
				<a href={`/ruangan/${areaId}/cek`} target="_blank" rel="noopener" class="shrink-0 font-semibold underline">Cek</a>
			</div>
		{:else if cekWajib}
			<!-- Kontrol Patroli Fase 1 — WAJIB (soft: bisa dilewati dengan alasan; hard: tidak bisa dilewati). -->
			<div class="rounded-lg p-3 mb-4" style="background: rgba(220,38,38,.1); border: 1px solid rgba(220,38,38,.3)">
				<p class="text-[11px] font-semibold mb-1" style="color: #DC2626">
					Barang ruangan ini belum dicek {cekBannerHari} hari — wajib dicek sebelum checklist ini dikirim.
				</p>
				<a href={`/ruangan/${ruanganAreaId}/cek`} target="_blank" rel="noopener" class="text-[11px] font-semibold underline" style="color: #DC2626">
					Buka Cek Kelengkapan Ruangan
				</a>
				{#if cekWajibMode === 'soft'}
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

		{#if loading || verifying}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat checklist GA & verifikasi..." />
		</div>
		{:else if !checkpointId}
			{#if scanError}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{scanError}</div>
			{/if}
			{#if errorMsg}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
			{:else}
				<div class="rounded-xl p-6 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<IconQrcode size={32} style="color: var(--g); margin: 0 auto 8px" />
					<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">Scan QR Titik Lokasi</p>
					<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Checklist hanya bisa diisi setelah scan QR yang tertempel di lokasi ini, sebagai bukti Anda berada di tempat.</p>
					{#if !showManualInput}
						<div class="flex flex-col items-center gap-2">
							<button
								class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white flex items-center justify-center gap-2"
								style="background: var(--g)"
								onclick={async () => { scanError = ''; await loadQrScannerModal(); showScanner = true; }}
							>
								<IconQrcode size={16} /> Buka Kamera & Scan
							</button>
							<button
								type="button"
								class="text-[11px] font-medium hover:underline"
								style="color: var(--sys-label3)"
								onclick={() => { scanError = ''; showManualInput = true; }}
							>
								Kamera rusak? Masukkan kode secara manual
							</button>
						</div>
					{:else}
						<div class="max-w-xs mx-auto">
							<label for="manualCodeInput" class="block text-left text-[11px] font-semibold mb-1" style="color: var(--sys-label2)">
								Masukkan Kode QR secara manual
							</label>
							<div class="flex gap-2">
								<input
									id="manualCodeInput"
									type="text"
									class="flex-1 px-3 py-2 rounded-lg border text-[13px] bg-transparent"
									style="border-color: var(--sys-sep); color: var(--sys-label)"
									placeholder="Contoh: GA-XXXX"
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
								Kembali ke Scan QR
							</button>
						</div>
					{/if}
				</div>
			{/if}
		{:else}
			<div class="rounded-lg p-2 mb-3 text-[11px] font-semibold" style="background: var(--gg); color: var(--ggd)">
				Titik terverifikasi: {checkpointName}
			</div>

			<button
				class="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 mb-3 text-[11px] font-semibold"
				style="background: var(--rel); color: var(--red); border: 1px solid var(--red)"
				onclick={reportDamage}
			>
				<IconAlertTriangle size={13} /> Lapor Kerusakan Ditemukan
			</button>

			{#if errorMsg}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
			{/if}
			{#if successMsg}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>
			{/if}

			{#if !successMsg}
				{#each Object.entries(groupedByCategory()) as [category, catItems]}
					<h2 class="text-[12px] font-semibold mt-4 mb-2" style="color: var(--sys-label)">{category}</h2>
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
								{#if item.field_type === 'text'}
									<textarea
										rows="2"
										placeholder="Masukkan teks..."
										class="w-full rounded-lg px-2.5 py-2 text-[12px] mb-2 bg-[var(--sys-bg)]"
										style="border: 1px solid var(--sys-sep); color: var(--sys-label)"
										value={answers[item.id]?.notes || ''}
										oninput={(e) => {
											const val = (e.target as HTMLTextAreaElement).value;
											answers[item.id] = { answer: val ? 'yes' : 'na', notes: val };
										}}
									></textarea>
								{:else if item.field_type === 'number'}
									<input
										type="number"
										placeholder="Masukkan angka..."
										class="w-full rounded-lg px-2.5 py-2 text-[12px] mb-2 bg-[var(--sys-bg)]"
										style="border: 1px solid var(--sys-sep); color: var(--sys-label)"
										value={answers[item.id]?.notes || ''}
										oninput={(e) => {
											const val = (e.target as HTMLInputElement).value;
											answers[item.id] = { answer: val ? 'yes' : 'na', notes: val };
										}}
									/>
								{:else}
									<div class="flex gap-1 mb-2">
										{#each [['yes', 'Ya', 'var(--gg)', 'var(--ggd)'], ['no', 'Tidak', 'var(--rel)', 'var(--red)'], ['na', 'N/A', 'transparent', 'var(--sys-label3)']] as [val, label, bg, color]}
											<button
												type="button"
												class="px-3 py-1 rounded-full text-[11px] font-semibold"
												style="background: {answers[item.id]?.answer === val ? bg : 'transparent'}; color: {answers[item.id]?.answer === val ? color : 'var(--sys-label3)'}"
												onclick={() => (answers[item.id] = { ...answers[item.id], answer: val as any })}
											>
												{label}
											</button>
										{/each}
									</div>
									{#if answers[item.id]?.answer === 'no'}
										<textarea
											rows="2"
											placeholder="Catatan temuan..."
											class="w-full rounded-lg px-2 py-1.5 text-[12px] mb-2"
											style="background: var(--sys-bg); border: 1px solid var(--sys-sep)"
											bind:value={answers[item.id].notes}
										></textarea>
									{/if}
								{/if}
								<label class="flex items-center gap-2 text-[11px] cursor-pointer" style="color: var(--sys-label3)">
									<IconCamera size={14} />
									{photos[item.id] ? 'Ganti foto' : 'Ambil foto'}
									<input type="file" accept="image/*" capture="environment" class="hidden" onchange={(e) => onPhotoChange(item.id, e)} />
								</label>
								{#if photoPreviews[item.id]}
									<img src={photoPreviews[item.id]} alt="Bukti" class="mt-2 rounded-lg max-h-32 object-cover" />
								{/if}
							</div>
						{/each}
					</div>
				{/each}

				<div class="rounded-lg p-3 my-4 text-center text-[12px] font-semibold" style="background: var(--gl); color: var(--g)">
					Skor sementara: {scoringPreview()}%
				</div>

				<h2 class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Tanda Tangan Pelaksana</h2>
				<div class="rounded-lg mb-2" style="background: #fff; border: 1px solid var(--sys-sep)">
					<canvas
						bind:this={canvasEl}
						width="343"
						height="140"
						class="w-full touch-none"
						onpointerdown={startDraw}
						onpointermove={draw}
						onpointerup={endDraw}
						onpointerleave={endDraw}
					></canvas>
				</div>
				<button class="flex items-center gap-1 text-[11px] mb-4" style="color: var(--sys-label3)" onclick={clearSignature}>
					<IconTrash size={12} /> Hapus & ulangi
				</button>

				<div class="flex justify-center mb-2">
					<DraftIndicator savedAt={draftSavedAt} />
				</div>

				<button
					class="w-full rounded-lg py-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
					style="background: var(--g)"
					disabled={saving || (cekWajib && cekWajibMode === 'hard')}
					onclick={submit}
				>
					{#if saving}
						<IconLoader2 size={16} class="animate-spin" />
					{/if}
					{saving ? 'Mengirim…' : 'Submit Checklist'}
				</button>
			{/if}
		{/if}
	</div>
</div>

{#if showScanner && QrScannerModal}
	<QrScannerModal onDetect={onScanDetect} onClose={() => (showScanner = false)} expectedPrefix="GA-" />
{/if}
