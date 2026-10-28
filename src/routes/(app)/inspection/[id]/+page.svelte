<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { authStore, getUserDisplay } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getProjects, getSoCustomerByProjectId, getSoCustomerById } from '$lib/services/projects';
	import {
		getReport, getPaintLayers, getDftReadings, createDraft, updateReport,
		replacePaintLayers, replaceDftReadings, finalizeReport, validateRequiredForFinalize,
		getPhotos, addPhoto, deletePhoto, uploadFile, dataUrlToFile,
		type InspectionReport, type InspectionPaintLayer, type InspectionWorkshop,
		type InspectionPhoto, type InspectionPhotoCategory
	} from '$lib/services/inspectionApi';
	import { calcPsychrometric, checkHoldPoint, calcDftAverage, validateDft8515 } from '$lib/utils/inspectionCalc';
	import { getCurrentPosition } from '$lib/utils/geoClient';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import { printInspectionReport } from '$lib/utils/printInspectionReport';
	import { IconArrowLeft, IconAlertTriangle, IconPlus, IconTrash, IconLoader2, IconCamera, IconPrinter } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';

	type LayerRow = InspectionPaintLayer & { readings: number[] };

	const idParam = page.params.id;
	const isNew = idParam === 'new';

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_inspection', roles)) {
			goto('/');
		}
	});

	let loading = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');
	let reportId = $state<number | null>(isNew ? null : Number(idParam));
	let reportNo = $state<string | null>(null);
	let status = $state<InspectionReport['status']>('draft');

	// Header
	let workshop = $state<InspectionWorkshop | ''>('');
	let projectId = $state<number | null>(null);
	let projectOptions = $state<any[]>([]);
	let soCustomerId = $state<number | null>(null);
	let sppr = $state('');
	let poNo = $state('');
	let clientName = $state('');
	let partNumber = $state('');
	let partName = $state('');
	let description = $state('');
	let qty = $state<number | null>(null);
	let satuan = $state('');

	// Ambient
	let dryBulb = $state<number | null>(null);
	let wetBulb = $state<number | null>(null);
	let steelTemp = $state<number | null>(null);
	let weather = $state('');
	let measuredAt = $state('');

	// Surface prep
	let prepMethod = $state('');
	let abrasiveType = $state('');
	let dustLevel = $state('');
	let surfaceProfile = $state('');

	// Paint application & signature
	let methodOfApplication = $state('');
	let preparedBy = $state('');
	let inspectedBy = $state('');
	let note = $state('');
	let holdPointJustification = $state('');

	let layers = $state<LayerRow[]>([]);

	// Penyelamatan draf lokal (rencana v2, Fase 3, 3.2 prioritas 4): field yang belum sempat
	// "Simpan Draft" ke server tidak boleh hilang gara-gara tab ter-refresh saat mengisi form
	// panjang ini. Foto TIDAK ikut — sudah diupload langsung ke server per-foto (uploadPhoto),
	// bukan ditahan sebagai File menunggu submit.
	interface InspectionLocalDraft {
		workshop: typeof workshop; projectId: typeof projectId; soCustomerId: typeof soCustomerId;
		sppr: string; poNo: string; clientName: string; partNumber: string; partName: string;
		description: string; qty: number | null; satuan: string;
		dryBulb: number | null; wetBulb: number | null; steelTemp: number | null; weather: string; measuredAt: string;
		prepMethod: string; abrasiveType: string; dustLevel: string; surfaceProfile: string;
		methodOfApplication: string; preparedBy: string; inspectedBy: string; note: string;
		holdPointJustification: string; layers: LayerRow[];
	}
	const localDraftPersist = createFormPersist<InspectionLocalDraft>(`inspection_${idParam}`);
	let localDraftSavedAt = $state<Date | null>(null);
	let localDraftAutoSaveArmed = $state(false);

	function inspectionSnapshot(): InspectionLocalDraft {
		return {
			workshop, projectId, soCustomerId, sppr, poNo, clientName, partNumber, partName,
			description, qty, satuan, dryBulb, wetBulb, steelTemp, weather, measuredAt,
			prepMethod, abrasiveType, dustLevel, surfaceProfile, methodOfApplication,
			preparedBy, inspectedBy, note, holdPointJustification, layers
		};
	}

	function applyInspectionSnapshot(d: InspectionLocalDraft) {
		workshop = d.workshop; projectId = d.projectId; soCustomerId = d.soCustomerId;
		sppr = d.sppr; poNo = d.poNo; clientName = d.clientName; partNumber = d.partNumber; partName = d.partName;
		description = d.description; qty = d.qty; satuan = d.satuan;
		dryBulb = d.dryBulb; wetBulb = d.wetBulb; steelTemp = d.steelTemp; weather = d.weather; measuredAt = d.measuredAt;
		prepMethod = d.prepMethod; abrasiveType = d.abrasiveType; dustLevel = d.dustLevel; surfaceProfile = d.surfaceProfile;
		methodOfApplication = d.methodOfApplication; preparedBy = d.preparedBy; inspectedBy = d.inspectedBy; note = d.note;
		holdPointJustification = d.holdPointJustification;
		if (d.layers && d.layers.length > 0) layers = d.layers;
	}

	// Foto bukti
	let photos = $state<InspectionPhoto[]>([]);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — tiap foto sudah punya geo_lat/geo_lng
	// tersimpan, sebelumnya tidak pernah ditampilkan sebagai peta. Lazy-load (tombol per foto).
	let mapPhotoId = $state<number | null>(null);
	let LocationMap = $state<any>(null);
	async function toggleLocationMapFor(photoId: number) {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		mapPhotoId = mapPhotoId === photoId ? null : photoId;
	}
	let photoFile = $state<File | null>(null);
	let photoPreview = $state('');
	let photoKategori = $state<InspectionPhotoCategory>('ambient');
	let photoCaption = $state('');
	let photoUploading = $state(false);

	// TTD digital
	let preparedSignaturePad: any;
	let inspectedSignaturePad: any;
	let preparedSignatureFileId = $state<string | null>(null);
	let inspectedSignatureFileId = $state<string | null>(null);
	let signingPrepared = $state(false);
	let signingInspected = $state(false);

	let psychro = $derived(calcPsychrometric({ dryBulb, wetBulb }));
	let holdPoint = $derived(checkHoldPoint({ steelTemp, dewPointC: psychro.dewPointC }));

	function newLayer(layerNo: number): LayerRow {
		return {
			layer_no: layerNo, painting_system: '', paint_name: '', paint_colour: '',
			date_application: '', time_application: '', pot_life: '', mixing_ratio: '',
			thinner_name: '', visual_appearance: '', paint_thinner_ratio: '',
			batch_part_a: '', batch_part_b: '', batch_thinner: '',
			dft_spec_min: null, dft_spec_max: null, dft_avg: null, dft_pass_8515: null,
			readings: []
		};
	}

	function addLayer() {
		layers = [...layers, newLayer(layers.length + 1)];
	}

	function removeLayer(idx: number) {
		layers = layers.filter((_, i) => i !== idx).map((l, i) => ({ ...l, layer_no: i + 1 }));
	}

	function addReading(layerIdx: number) {
		layers[layerIdx].readings = [...layers[layerIdx].readings, 0];
	}

	function removeReading(layerIdx: number, readingIdx: number) {
		layers[layerIdx].readings = layers[layerIdx].readings.filter((_, i) => i !== readingIdx);
	}

	function layerDft(layer: LayerRow) {
		return validateDft8515(layer.readings, layer.dft_spec_min, layer.dft_spec_max);
	}

	function onPhotoFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		photoFile = file;
		photoPreview = URL.createObjectURL(file);
	}

	async function uploadPhoto() {
		if (!reportId || !photoFile) return;
		photoUploading = true;
		errorMsg = '';
		try {
			let geo: { lat: number; lng: number } | null = null;
			try {
				const pos = await getCurrentPosition();
				geo = { lat: pos.lat, lng: pos.lng };
			} catch {
				// GPS opsional — lanjut tanpa geo bila ditolak/tidak tersedia
			}
			const compressedPhoto = await compressPhoto(photoFile);
			await addPhoto(reportId, compressedPhoto, photoKategori, photoCaption, geo);
			photos = await getPhotos(reportId);
			photoFile = null;
			photoPreview = '';
			photoCaption = '';
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengupload foto.';
		} finally {
			photoUploading = false;
		}
	}

	async function removePhoto(id: number) {
		if (!reportId) return;
		await deletePhoto(id);
		photos = await getPhotos(reportId);
	}

	async function saveSignature(role: 'prepared' | 'inspected') {
		if (!reportId) { errorMsg = 'Simpan draft terlebih dahulu sebelum menandatangani.'; return; }
		const pad = role === 'prepared' ? preparedSignaturePad : inspectedSignaturePad;
		if (!pad || pad.isEmpty()) { errorMsg = 'Tanda tangan masih kosong.'; return; }
		if (role === 'prepared') signingPrepared = true; else signingInspected = true;
		errorMsg = '';
		try {
			const dataUrl = pad.toDataURL();
			const file = dataUrlToFile(dataUrl, `ttd-${role}-${reportId}.png`);
			const fileId = await uploadFile(file, `inspection_report:${reportId}:${role}_signature`);
			if (!fileId) throw new Error('Gagal mengupload tanda tangan.');
			if (role === 'prepared') {
				preparedSignatureFileId = fileId;
				await updateReport(reportId, { prepared_signature_file: fileId });
			} else {
				inspectedSignatureFileId = fileId;
				await updateReport(reportId, { inspected_signature_file: fileId });
			}
			successMsg = 'Tanda tangan tersimpan.';
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan tanda tangan.';
		} finally {
			signingPrepared = false;
			signingInspected = false;
		}
	}

	async function loadProjectPickers() {
		projectOptions = await getProjects(null, true);
	}

	async function onProjectChange() {
		if (!projectId) { soCustomerId = null; return; }
		// Proyek gabungan punya >1 so_customer dengan project_id ini; getSoCustomerByProjectId (limit 1) bisa memilih PO
		// saudara secara acak -> prioritaskan PO utama proyek (projects.so_customer_id), fallback ke lookup lama.
		const chosen = projectOptions.find((p: any) => String(p.id) === String(projectId));
		const primarySo = typeof chosen?.so_customer_id === 'object' ? chosen?.so_customer_id?.id : chosen?.so_customer_id;
		const so = primarySo ? await getSoCustomerById(primarySo) : await getSoCustomerByProjectId(projectId);
		if (so) {
			soCustomerId = so.id;
			if (!poNo) poNo = so.nomor_po_customer || '';
			if (!clientName) clientName = so.customer_name || '';
		}
	}

	onMount(async () => {
		try {
			await loadProjectPickers();
			const displayName = $authStore.karyawanName || getUserDisplay($authStore.user);
			if (isNew) {
				preparedBy = displayName;
				inspectedBy = displayName;
				layers = [newLayer(1)];
			} else if (reportId) {
				const [report, dbLayers, dbReadings] = await Promise.all([
					getReport(reportId), getPaintLayers(reportId), getDftReadings(reportId)
				]);
				if (!report) throw new Error('Laporan tidak ditemukan.');
				status = report.status;
				reportNo = report.report_no;
				workshop = (report.workshop as InspectionWorkshop) || '';
				projectId = report.project_id;
				soCustomerId = report.so_customer_id;
				sppr = report.sppr_id ? String(report.sppr_id) : '';
				poNo = report.po_no || '';
				clientName = report.client_name || '';
				partNumber = report.part_number || '';
				partName = report.part_name || '';
				description = report.description || '';
				qty = report.qty;
				satuan = report.satuan || '';
				dryBulb = report.dry_bulb;
				wetBulb = report.wet_bulb;
				steelTemp = report.steel_temp;
				weather = report.weather || '';
				measuredAt = report.measured_at ? report.measured_at.slice(0, 16) : '';
				prepMethod = report.prep_method || '';
				abrasiveType = report.abrasive_type || '';
				dustLevel = report.dust_level || '';
				surfaceProfile = report.surface_profile || '';
				methodOfApplication = report.method_of_application || '';
				preparedBy = report.prepared_by || displayName;
				inspectedBy = report.inspected_by || displayName;
				note = report.note || '';
				holdPointJustification = report.hold_point_justification || '';
				preparedSignatureFileId = report.prepared_signature_file || null;
				inspectedSignatureFileId = report.inspected_signature_file || null;
				photos = await getPhotos(reportId);

				layers = (dbLayers.length > 0 ? dbLayers : [newLayer(1)]).map((l) => ({
					...l,
					readings: dbReadings.filter((d) => d.layer_no === l.layer_no).sort((a, b) => a.point_index - b.point_index).map((d) => d.value_um)
				}));
			}
			const localDraft = localDraftPersist.restore();
			if (localDraft) {
				applyInspectionSnapshot(localDraft);
				localDraftSavedAt = new Date();
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat laporan.';
		} finally {
			loading = false;
			// Aktifkan auto-save setelah pemuatan awal (server + draft lokal) selesai, supaya
			// prefill tidak langsung dianggap "perubahan".
			localDraftAutoSaveArmed = true;
		}
	});

	$effect(() => {
		void inspectionSnapshot();
		if (!localDraftAutoSaveArmed) return;
		localDraftPersist.save(inspectionSnapshot());
		localDraftSavedAt = new Date();
	});

	// Jaring pengaman (rencana v2, Fase 3, 3.1): titik simpan wajib pagehide & visibilitychange.
	onMount(() => {
		return registerFormPersistSaveTriggers(localDraftPersist, () => inspectionSnapshot());
	});

	function buildReportPayload(): Partial<InspectionReport> {
		return {
			workshop, project_id: projectId, so_customer_id: soCustomerId,
			sppr_id: sppr ? Number(sppr) : null,
			po_no: poNo, client_name: clientName, part_number: partNumber, part_name: partName,
			description, qty, satuan,
			dry_bulb: dryBulb, wet_bulb: wetBulb, rh_pct: psychro.rhPct, dew_point: psychro.dewPointC,
			steel_temp: steelTemp, weather, measured_at: measuredAt || null,
			prep_method: prepMethod, abrasive_type: abrasiveType, dust_level: dustLevel, surface_profile: surfaceProfile,
			method_of_application: methodOfApplication,
			hold_point_flag: holdPoint.holdPoint, hold_point_justification: holdPointJustification,
			note, prepared_by: preparedBy, inspected_by: inspectedBy,
			prepared_at: new Date().toISOString(), inspected_at: new Date().toISOString()
		};
	}

	function buildLayerPayload(): InspectionPaintLayer[] {
		return layers.map((l) => {
			const dft = layerDft(l);
			const { readings, ...rest } = l;
			return { ...rest, dft_avg: dft.avg, dft_pass_8515: dft.pass };
		});
	}

	async function persistChildren(id: number) {
		await replacePaintLayers(id, buildLayerPayload());
		const dftRows = layers.flatMap((l) =>
			l.readings.map((v, i) => ({ layer_no: l.layer_no, stage: null, unit_no: null, material: null, point_index: i + 1, value_um: v }))
		);
		await replaceDftReadings(id, dftRows);
	}

	async function saveDraft() {
		errorMsg = ''; successMsg = '';
		if (!workshop) { errorMsg = 'Pilih workshop terlebih dahulu.'; return; }
		saving = true;
		try {
			const payload = buildReportPayload();
			if (reportId) {
				await updateReport(reportId, payload);
			} else {
				const displayName = $authStore.karyawanName || getUserDisplay($authStore.user);
				const created = await createDraft(payload, displayName);
				reportId = created.id;
				goto(`/inspection/${reportId}`, { replaceState: true, noScroll: true });
			}
			await persistChildren(reportId as number);
			successMsg = 'Draft tersimpan.';
			localDraftPersist.clear();
			localDraftSavedAt = null;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan draft.';
		} finally {
			saving = false;
		}
	}

	async function finalize() {
		errorMsg = ''; successMsg = '';
		saving = true;
		try {
			await saveDraft();
			if (!reportId) return;
			const finalized = await finalizeReport(reportId, buildReportPayload(), buildLayerPayload());
			status = 'menunggu_approval';
			reportNo = finalized.report_no;
			successMsg = `Laporan dikirim untuk approval. Nomor: ${finalized.report_no}`;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal finalisasi laporan.';
		} finally {
			saving = false;
		}
	}

	let printing = $state(false);

	async function doPrint() {
		if (!reportId) { errorMsg = 'Simpan draft terlebih dahulu sebelum mencetak.'; return; }
		printing = true;
		errorMsg = '';
		try {
			const reportForPrint = { ...buildReportPayload(), id: reportId, report_no: reportNo, status } as InspectionReport;
			const layerPayload = buildLayerPayload();
			const dftMap = new Map<number, any[]>();
			for (const l of layers) {
				dftMap.set(l.layer_no, l.readings.map((v, i) => ({ point_index: i + 1, value_um: v, unit_no: null, material: null })));
			}
			await printInspectionReport(reportForPrint, layerPayload, dftMap);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mencetak laporan.';
		} finally {
			printing = false;
		}
	}

	const isLocked = $derived(status !== 'draft' && !isNew);
</script>

<div class="max-w-4xl mx-auto p-4 md:p-6 pb-24">
	<div class="flex items-center gap-2 mb-4">
		<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/inspection')}>
			<IconArrowLeft size={16} />
		</button>
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">{reportNo || (isNew ? 'Laporan Inspeksi Baru' : `Laporan #${reportId}`)}</h1>
	</div>

	{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
	{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat formulir inspeksi..." />
		</div>
	{:else}
		{#if isLocked}
			<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--sys-fill); color: var(--sys-label3)">
				Laporan berstatus <strong>{status}</strong> — tidak bisa diedit lagi dari sini.
			</div>
		{/if}

		<fieldset disabled={isLocked || saving} class="space-y-5">
			<!-- Header -->
			<section class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
				<h2 class="text-[13px] font-bold mb-2.5" style="color: var(--sys-label)">1. Header</h2>
				<div class="grid grid-cols-2 gap-2">
					<select bind:value={workshop} class="col-span-2 rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<option value="">Pilih Workshop</option>
						<option value="ciketing">Ciketing</option>
						<option value="balaraja">Balaraja</option>
					</select>
					<select bind:value={projectId} onchange={onProjectChange} class="col-span-2 rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<option value={null}>Pilih Proyek (opsional)</option>
						{#each projectOptions as p (p.id)}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
					{#if workshop === 'balaraja'}
						<input bind:value={sppr} placeholder="SPPR ID (wajib untuk Balaraja)" class="col-span-2 rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					{/if}
					<input bind:value={poNo} placeholder="PO No" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={clientName} placeholder="Client" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={partNumber} placeholder="Part Number" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={partName} placeholder="Part Name" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={qty} type="number" placeholder="Qty" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={satuan} placeholder="Satuan" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<textarea bind:value={description} placeholder="Description" rows="2" class="col-span-2 rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"></textarea>
				</div>
			</section>

			<!-- Ambient -->
			<section class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
				<h2 class="text-[13px] font-bold mb-2.5" style="color: var(--sys-label)">2. Ambient Condition</h2>
				<div class="grid grid-cols-2 gap-2">
					<input bind:value={dryBulb} type="number" step="0.1" placeholder="Dry Bulb (°C)" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={wetBulb} type="number" step="0.1" placeholder="Wet Bulb (°C)" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input value={psychro.rhPct ?? '-'} readonly placeholder="RH (%) — auto" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill2, #eef); border: 1px solid var(--sys-sep); opacity: 0.8" />
					<input value={psychro.dewPointC ?? '-'} readonly placeholder="Dew Point (°C) — auto" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill2, #eef); border: 1px solid var(--sys-sep); opacity: 0.8" />
					<input bind:value={steelTemp} type="number" step="0.1" placeholder="Steel Temp (°C)" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={weather} placeholder="Weather" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={measuredAt} type="datetime-local" class="col-span-2 rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
				</div>
				{#if holdPoint.margin !== null}
					{#if holdPoint.holdPoint}
						<div class="mt-2.5 rounded-lg p-2.5 text-[12px]" style="background: var(--rel); color: var(--red)">
							<div class="flex items-center gap-1.5 font-semibold mb-1"><IconAlertTriangle size={14} /> HOLD POINT — margin {holdPoint.margin}°C (min 3°C)</div>
							<p class="mb-1.5">Steel Temp terlalu dekat/dibawah Dew Point. Pengecatan tidak boleh dilanjutkan tanpa justifikasi.</p>
							<textarea bind:value={holdPointJustification} rows="2" placeholder="Catatan justifikasi (wajib)" class="w-full rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep); color: var(--sys-label)"></textarea>
						</div>
					{:else}
						<div class="mt-2.5 text-[11px]" style="color: var(--sys-label4)">Margin steel–dew point: {holdPoint.margin}°C (aman, ≥3°C)</div>
					{/if}
				{/if}
			</section>

			<!-- Surface prep -->
			<section class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
				<h2 class="text-[13px] font-bold mb-2.5" style="color: var(--sys-label)">3. Surface Preparation</h2>
				<div class="grid grid-cols-2 gap-2">
					<input bind:value={prepMethod} placeholder="Method (mis. Sa 2.5)" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={abrasiveType} placeholder="Abrasive Type (mis. Silica 60/80)" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={dustLevel} placeholder="Dust Level" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={surfaceProfile} placeholder="Surface Profile / Test" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
				</div>
			</section>

			<!-- Paint layers -->
			<section class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
				<div class="flex items-center justify-between mb-2.5">
					<h2 class="text-[13px] font-bold" style="color: var(--sys-label)">4. Paint Application & DFT</h2>
					<select bind:value={methodOfApplication} class="rounded-lg px-2 py-1.5 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<option value="">Method of Application</option>
						<option value="airless_spray">Airless Spray</option>
						<option value="conventional">Conventional</option>
					</select>
				</div>

				<div class="space-y-3">
					{#each layers as layer, li (li)}
						{@const dft = layerDft(layer)}
						<div class="rounded-lg p-2.5" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<div class="flex items-center justify-between mb-2">
								<p class="text-[12px] font-semibold" style="color: var(--sys-label)">Layer {layer.layer_no}</p>
								{#if layers.length > 1}
									<button type="button" onclick={() => removeLayer(li)} style="color: var(--red)"><IconTrash size={14} /></button>
								{/if}
							</div>
							<div class="grid grid-cols-2 gap-1.5 mb-2">
								<input bind:value={layer.painting_system} placeholder="Painting System" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.paint_name} placeholder="Paint Name" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.paint_colour} placeholder="Colour" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.date_application} type="date" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.time_application} placeholder="Time" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.pot_life} placeholder="Pot Life (TDS)" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.mixing_ratio} placeholder="Mixing Ratio" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.thinner_name} placeholder="Thinner Name" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.visual_appearance} placeholder="Visual Appearance" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.paint_thinner_ratio} placeholder="Paint/Thinner Ratio" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.batch_part_a} placeholder="Batch Part A" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.batch_part_b} placeholder="Batch Part B" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.batch_thinner} placeholder="Batch Thinner" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.dft_spec_min} type="number" step="0.1" placeholder="DFT Spec Min (µm)" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
								<input bind:value={layer.dft_spec_max} type="number" step="0.1" placeholder="DFT Spec Max (µm)" class="rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
							</div>

							<p class="text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Titik ukur DFT (µm)</p>
							<div class="flex flex-wrap gap-1.5 mb-1.5">
								{#each layer.readings as _, ri}
									<div class="flex items-center gap-0.5">
										<input bind:value={layer.readings[ri]} type="number" step="0.1" class="w-16 rounded px-1.5 py-1 text-[11px] text-center" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
										<button type="button" onclick={() => removeReading(li, ri)} style="color: var(--red)"><IconTrash size={11} /></button>
									</div>
								{/each}
								<button type="button" onclick={() => addReading(li)} class="rounded px-2 py-1 text-[11px] flex items-center gap-1" style="background: var(--sys-bg); border: 1px dashed var(--sys-sep); color: var(--sys-label3)">
									<IconPlus size={11} /> Titik
								</button>
							</div>

							{#if dft.avg !== null}
								<div class="flex items-center gap-2 flex-wrap text-[11px]">
									<span style="color: var(--sys-label3)">Avg: <strong>{dft.avg}µm</strong></span>
									{#if dft.pass !== null}
										{#if dft.pass}
											<span class="px-2 py-0.5 rounded-full font-semibold" style="background: var(--gg); color: var(--ggd)">Lolos 85/15</span>
										{:else}
											<span class="px-2 py-0.5 rounded-full font-semibold" style="background: var(--rel); color: var(--red)">Gagal 85/15</span>
										{/if}
									{/if}
								</div>
								{#if dft.failures.length > 0}
									<ul class="mt-1 text-[10px] list-disc list-inside" style="color: var(--red)">
										{#each dft.failures as f}<li>{f}</li>{/each}
									</ul>
								{/if}
							{/if}
						</div>
					{/each}
				</div>

				<button type="button" onclick={addLayer} class="mt-2.5 w-full rounded-lg py-2 text-[12px] font-semibold flex items-center justify-center gap-1.5" style="background: var(--sys-fill); border: 1px dashed var(--sys-sep); color: var(--sys-label3)">
					<IconPlus size={13} /> Tambah Layer
				</button>
			</section>

			<!-- Signature & note -->
			<section class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
				<h2 class="text-[13px] font-bold mb-2.5" style="color: var(--sys-label)">5. Prepared / Inspected & Catatan</h2>
				<div class="grid grid-cols-2 gap-2 mb-2">
					<input bind:value={preparedBy} placeholder="Prepared by" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					<input bind:value={inspectedBy} placeholder="Inspected by" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
				</div>
				<textarea bind:value={note} placeholder="Note (opsional)" rows="2" class="w-full rounded-lg px-3 py-2 text-[13px] mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"></textarea>

				{#if !reportId}
					<p class="text-[11px]" style="color: var(--sys-label4)">Simpan draft terlebih dahulu untuk mengaktifkan TTD digital.</p>
				{:else}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
						<div>
							<p class="text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">TTD Prepared by</p>
							{#if preparedSignatureFileId}
								<div class="rounded-lg border p-2 text-[11px] flex items-center justify-between" style="border-color: var(--sys-sep); background: var(--gg); color: var(--ggd)">
									<span>Sudah ditandatangani</span>
									<button type="button" onclick={() => (preparedSignatureFileId = null)} class="underline">Ulangi</button>
								</div>
							{:else}
								<SignaturePad bind:this={preparedSignaturePad} height={140} />
								<button type="button" disabled={signingPrepared} onclick={() => saveSignature('prepared')} class="mt-1.5 w-full rounded-lg py-1.5 text-[11px] font-semibold text-white disabled:opacity-50" style="background: var(--g)">
									{signingPrepared ? 'Menyimpan…' : 'Simpan TTD Prepared'}
								</button>
							{/if}
						</div>
						<div>
							<p class="text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">TTD Inspected by</p>
							{#if inspectedSignatureFileId}
								<div class="rounded-lg border p-2 text-[11px] flex items-center justify-between" style="border-color: var(--sys-sep); background: var(--gg); color: var(--ggd)">
									<span>Sudah ditandatangani</span>
									<button type="button" onclick={() => (inspectedSignatureFileId = null)} class="underline">Ulangi</button>
								</div>
							{:else}
								<SignaturePad bind:this={inspectedSignaturePad} height={140} />
								<button type="button" disabled={signingInspected} onclick={() => saveSignature('inspected')} class="mt-1.5 w-full rounded-lg py-1.5 text-[11px] font-semibold text-white disabled:opacity-50" style="background: var(--g)">
									{signingInspected ? 'Menyimpan…' : 'Simpan TTD Inspected'}
								</button>
							{/if}
						</div>
					</div>
				{/if}
				<p class="text-[10px] mt-2" style="color: var(--sys-label4)">Approved (klien) tetap via TTD basah/scan saat cetak — bukan digital.</p>
			</section>

			<!-- Foto Bukti -->
			<section class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
				<h2 class="text-[13px] font-bold mb-2.5" style="color: var(--sys-label)">6. Foto Bukti</h2>
				{#if !reportId}
					<p class="text-[11px]" style="color: var(--sys-label4)">Simpan draft terlebih dahulu untuk mengupload foto.</p>
				{:else}
					<div class="grid grid-cols-2 gap-2 mb-2">
						<select bind:value={photoKategori} class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<option value="ambient">Ambient</option>
							<option value="surface">Surface</option>
							<option value="dft_gauge">DFT Gauge</option>
							<option value="hasil">Hasil</option>
						</select>
						<input bind:value={photoCaption} placeholder="Caption (opsional)" class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
					</div>
					<label class="flex items-center justify-center gap-2 rounded-lg py-2.5 text-[12px] font-semibold cursor-pointer" style="background: var(--sys-fill); border: 1px dashed var(--sys-sep); color: var(--sys-label3)">
						<IconCamera size={15} /> {photoFile ? 'Ganti Foto' : 'Ambil Foto'}
						<input type="file" accept="image/*" capture="environment" class="hidden" onchange={onPhotoFileChange} />
					</label>
					{#if photoPreview}
						<div class="mt-2 flex items-center gap-2">
							<img src={photoPreview} alt="preview" class="w-16 h-16 object-cover rounded-lg" />
							<button type="button" disabled={photoUploading} onclick={uploadPhoto} class="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50" style="background: var(--g)">
								{photoUploading ? 'Mengupload…' : 'Upload Foto Ini'}
							</button>
						</div>
					{/if}

					{#if photos.length > 0}
						<div class="grid grid-cols-3 gap-2 mt-3">
							{#each photos as p (p.id)}
								<div class="relative">
									<img src={`/api/directus/assets/${p.file}?width=200`} alt={p.caption || p.kategori} class="w-full h-20 object-cover rounded-lg" />
									<span class="absolute bottom-0.5 left-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style="background: rgba(0,0,0,0.6); color: #fff">{p.kategori}</span>
									<button type="button" onclick={() => removePhoto(p.id as number)} class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center" style="background: rgba(0,0,0,0.6)">
										<IconTrash size={11} color="#fff" />
									</button>
									{#if p.geo_lat != null && p.geo_lng != null}
										<button
											type="button"
											onclick={() => toggleLocationMapFor(p.id as number)}
											class="absolute bottom-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
											style="background: rgba(0,0,0,0.6)"
											aria-label="Lihat lokasi foto"
										>
											📍
										</button>
									{/if}
								</div>
							{/each}
						</div>
						{#each photos as p (p.id)}
							{#if mapPhotoId === p.id && LocationMap && p.geo_lat != null && p.geo_lng != null}
								<div transition:slide={{ duration: 200 }} class="mt-2">
									<LocationMap lat={p.geo_lat} lng={p.geo_lng} label={p.caption || p.kategori} height="200px" />
								</div>
							{/if}
						{/each}
					{/if}
				{/if}
			</section>
		</fieldset>

		{#if reportId}
			<button
				class="w-full rounded-lg py-2.5 text-[13px] font-semibold mt-4 flex items-center justify-center gap-1.5 disabled:opacity-50"
				style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
				disabled={printing}
				onclick={doPrint}
			>
				<IconPrinter size={14} /> {printing ? 'Menyiapkan…' : 'Cetak PDF'}
			</button>
		{/if}

		{#if !isLocked}
			<div class="flex justify-center mt-3">
				<DraftIndicator savedAt={localDraftSavedAt} />
			</div>
			<div class="flex gap-2 mt-2">
				<button
					class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold disabled:opacity-50"
					style="background: var(--sys-fill); color: var(--sys-label)"
					disabled={saving}
					onclick={saveDraft}
				>
					{saving ? 'Menyimpan…' : 'Simpan Draft'}
				</button>
				<button
					class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
					style="background: var(--g)"
					disabled={saving}
					onclick={finalize}
				>
					{saving ? 'Memproses…' : 'Kirim untuk Approval'}
				</button>
			</div>
		{/if}
	{/if}
</div>
