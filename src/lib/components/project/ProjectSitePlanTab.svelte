<!-- src/lib/components/project/ProjectSitePlanTab.svelte -->
<!-- Tab Site Plan & Denah Interaktif Proyek di Dashboard Lapangan (project-epi) -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import SitePlanCanvas from './SitePlanCanvas.svelte';

	// Pola toast global repo ini: Toast.svelte lewat window.__showToast (bukan svelte-sonner)
	const toast = {
		success: (m: string) => (window as any).__showToast?.(m, 'success'),
		error: (m: string) => (window as any).__showToast?.(m, 'error'),
		info: (m: string) => (window as any).__showToast?.(m, 'info')
	};
	import {
		SITE_PLAN_PIN_TYPES,
		SITE_PLAN_STATUS_OPTIONS,
		getProjectSitePlanDocuments,
		ensureSitePlanDenah,
		getSitePlanPins,
		saveSitePlanPin,
		deleteSitePlanPin,
		type SitePlanDoc,
		type SitePlanDenah,
		type SitePlanPin
	} from '$lib/services/sitePlanApi';
	import { uploadProjectDocument } from '$lib/services/projectDocumentsApi';

	interface Props {
		projectId: string | number;
		canEdit?: boolean;
	}

	let { projectId, canEdit = true }: Props = $props();

	let loading = $state(true);
	let sitePlanDocs = $state<SitePlanDoc[]>([]);
	let selectedDoc = $state<SitePlanDoc | null>(null);
	let activeDenah = $state<SitePlanDenah | null>(null);
	let pins = $state<SitePlanPin[]>([]);
	let editMode = $state(false);

	// Pin Modal
	let showPinModal = $state(false);
	let isEditingPin = $state(false);
	let savingPin = $state(false);
	let pinForm = $state<SitePlanPin>({
		denah_id: 0,
		tipe: 'zona_kerja',
		label: '',
		x_pct: 50,
		y_pct: 50,
		status: 'planned',
		catatan: ''
	});

	// Upload Modal
	let showUploadModal = $state(false);
	let uploadFile = $state<File | null>(null);
	let uploadNama = $state('');
	let isUploading = $state(false);

	onMount(async () => {
		await loadDocuments();
	});

	async function loadDocuments() {
		if (!projectId) return;
		loading = true;
		try {
			sitePlanDocs = await getProjectSitePlanDocuments(projectId);
			if (sitePlanDocs.length > 0) {
				await selectDocument(sitePlanDocs[0]);
			} else {
				selectedDoc = null;
				activeDenah = null;
				pins = [];
			}
		} catch (err: any) {
			toast.error('Gagal memuat dokumen site plan: ' + err.message);
		} finally {
			loading = false;
		}
	}

	async function selectDocument(doc: SitePlanDoc) {
		if (!doc?.file_id) return;
		selectedDoc = doc;
		loading = true;
		try {
			activeDenah = await ensureSitePlanDenah(projectId, doc.file_id, doc.nama_dokumen);
			await loadPins();
		} catch (err: any) {
			toast.error('Gagal membuka denah: ' + err.message);
		} finally {
			loading = false;
		}
	}

	async function loadPins() {
		if (!activeDenah?.id) {
			pins = [];
			return;
		}
		pins = await getSitePlanPins(activeDenah.id);
	}

	function handleAddPin(coords: { x_pct: number; y_pct: number; denah_id?: number }) {
		if (!activeDenah?.id) return;
		pinForm = {
			denah_id: activeDenah.id,
			tipe: 'zona_kerja',
			label: '',
			x_pct: coords.x_pct,
			y_pct: coords.y_pct,
			status: 'planned',
			catatan: ''
		};
		isEditingPin = false;
		showPinModal = true;
	}

	function handleEditPin(pin: SitePlanPin) {
		pinForm = { ...pin };
		isEditingPin = true;
		showPinModal = true;
	}

	async function handleDeletePin(pin: SitePlanPin) {
		if (!pin.id) return;
		if (!confirm(`Hapus titik "${pin.label}" dari site plan?`)) return;
		try {
			await deleteSitePlanPin(pin.id);
			toast.success(`Titik "${pin.label}" dihapus`);
			await loadPins();
		} catch (err: any) {
			toast.error('Gagal menghapus: ' + err.message);
		}
	}

	async function handleChangeStatus(data: { pin: SitePlanPin; status: string }) {
		try {
			await saveSitePlanPin({ ...data.pin, status: data.status });
			toast.success(`Status "${data.pin.label}" diubah`);
			await loadPins();
		} catch (err: any) {
			toast.error('Gagal ubah status: ' + err.message);
		}
	}

	async function submitPin() {
		if (!pinForm.label.trim()) {
			toast.error('Nama/label titik wajib diisi');
			return;
		}
		savingPin = true;
		try {
			await saveSitePlanPin(pinForm);
			toast.success(isEditingPin ? 'Titik diperbarui' : 'Titik baru disimpan');
			showPinModal = false;
			await loadPins();
		} catch (err: any) {
			toast.error('Gagal menyimpan titik: ' + err.message);
		} finally {
			savingPin = false;
		}
	}

	async function handleUpload() {
		if (!uploadFile) {
			toast.error('Pilih file gambar denah terlebih dahulu');
			return;
		}
		isUploading = true;
		try {
			const res = await uploadProjectDocument(projectId, uploadFile, {
				namaDokumen: uploadNama.trim() || uploadFile.name,
				kategori: 'Gambar Teknis',
				deskripsi: 'Site Plan & Layout Lapangan'
			});
			if (!res.success) throw new Error(res.error || 'Upload gagal');
			toast.success('Site plan berhasil diunggah');
			showUploadModal = false;
			uploadFile = null;
			uploadNama = '';
			await loadDocuments();
		} catch (err: any) {
			toast.error('Gagal upload: ' + err.message);
		} finally {
			isUploading = false;
		}
	}
</script>

<div class="space-y-3">
	<!-- Selector Header Bar -->
	<div class="flex flex-wrap items-center justify-between gap-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-xs">
		<div class="flex items-center gap-2">
			<span class="text-2xl">📐</span>
			<div>
				<h3 class="text-sm font-bold text-slate-900 dark:text-white">Site Plan & Visual Denah</h3>
				<p class="text-xs text-slate-500">Plotting titik kerja, QC & alat lapangan</p>
			</div>
		</div>

		<div class="flex items-center gap-2">
			{#if sitePlanDocs.length > 0}
				<select
					class="text-xs py-1.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 max-w-[180px] truncate"
					value={selectedDoc?.id}
					onchange={(e) => {
						const doc = sitePlanDocs.find((d) => d.id === Number((e.target as HTMLSelectElement).value));
						if (doc) selectDocument(doc);
					}}
				>
					{#each sitePlanDocs as doc}
						<option value={doc.id}>{doc.nama_dokumen || `Drawing #${doc.id}`}</option>
					{/each}
				</select>
			{/if}

			{#if canEdit}
				<button
					type="button"
					onclick={() => (showUploadModal = true)}
					class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1 shadow-xs"
				>
					<span>➕</span>
					<span>Unggah Denah</span>
				</button>
			{/if}
		</div>
	</div>

	<!-- Canvas Render -->
	{#if loading}
		<CircularProgressGauge size={50} strokeWidth={4} label="Memuat denah site plan..." />
	{:else if sitePlanDocs.length === 0}
		<div class="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl p-8 text-center max-w-md mx-auto space-y-3">
			<span class="text-4xl">📐</span>
			<p class="text-sm font-bold text-slate-800 dark:text-slate-200">Belum Ada Site Plan Lapangan</p>
			<p class="text-xs text-slate-400">Unggah foto denah atau gambar kerja untuk memetakan titik di lapangan.</p>
			{#if canEdit}
				<button
					type="button"
					onclick={() => (showUploadModal = true)}
					class="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl shadow"
				>
					Unggah Sekarang
				</button>
			{/if}
		</div>
	{:else}
		<SitePlanCanvas
			denah={activeDenah}
			pins={pins}
			{canEdit}
			bind:editMode
			onaddpin={handleAddPin}
			oneditpin={handleEditPin}
			ondeletepin={handleDeletePin}
			onchangestatus={handleChangeStatus}
			onuploadrequest={() => (showUploadModal = true)}
		/>
	{/if}
</div>

<!-- Modal Pin -->
{#if showPinModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
		<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-sm w-full p-4 space-y-3 text-xs shadow-2xl">
			<div class="flex items-center justify-between border-b pb-2">
				<h4 class="font-bold text-sm text-slate-900 dark:text-white">
					{isEditingPin ? '✏️ Ubah Titik' : '📍 Tambah Titik'}
				</h4>
				<button type="button" onclick={() => (showPinModal = false)} class="text-slate-400">✕</button>
			</div>

			<form onsubmit={(e) => { e.preventDefault(); submitPin(); }} class="space-y-2.5">
				<div>
					<label class="block font-semibold mb-1">Nama / Label Titik *</label>
					<input
						type="text"
						bind:value={pinForm.label}
						required
						placeholder="Misal: Blasting Bay 1, QC DFT 01"
						class="w-full py-1.5 px-3 rounded-xl border bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
					/>
				</div>

				<div>
					<label class="block font-semibold mb-1">Kategori Titik</label>
					<select bind:value={pinForm.tipe} class="w-full py-1.5 px-3 rounded-xl border bg-slate-50 dark:bg-slate-800">
						{#each Object.entries(SITE_PLAN_PIN_TYPES) as [k, t]}
							<option value={k}>{t.icon} {t.label}</option>
						{/each}
					</select>
				</div>

				<div>
					<label class="block font-semibold mb-1">Status Progres</label>
					<select bind:value={pinForm.status} class="w-full py-1.5 px-3 rounded-xl border bg-slate-50 dark:bg-slate-800">
						{#each Object.entries(SITE_PLAN_STATUS_OPTIONS) as [k, s]}
							<option value={k}>{s.label}</option>
						{/each}
					</select>
				</div>

				<div>
					<label class="block font-semibold mb-1">Catatan / Detail Lapangan</label>
					<textarea
						rows="2"
						bind:value={pinForm.catatan}
						placeholder="Spesifikasi, pelaksana, atau instruksi..."
						class="w-full py-1.5 px-3 rounded-xl border bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
					></textarea>
				</div>

				<div class="flex items-center justify-end gap-2 pt-2 border-t">
					<button type="button" onclick={() => (showPinModal = false)} class="px-3 py-1.5 rounded-xl border">Batal</button>
					<button type="submit" disabled={savingPin} class="px-4 py-1.5 bg-blue-600 text-white font-bold rounded-xl">
						{savingPin ? 'Menyimpan...' : 'Simpan'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Modal Upload -->
{#if showUploadModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
		<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-sm w-full p-4 space-y-3 text-xs shadow-2xl">
			<div class="flex items-center justify-between border-b pb-2">
				<h4 class="font-bold text-sm text-slate-900 dark:text-white">📐 Unggah Site Plan Lapangan</h4>
				<button type="button" onclick={() => (showUploadModal = false)} class="text-slate-400">✕</button>
			</div>

			<form onsubmit={(e) => { e.preventDefault(); handleUpload(); }} class="space-y-2.5">
				<div>
					<label class="block font-semibold mb-1">Pilih File Gambar *</label>
					<input
						type="file"
						accept="image/*,application/pdf"
						onchange={(e) => {
							uploadFile = (e.target as HTMLInputElement).files?.[0] || null;
							if (uploadFile && !uploadNama) uploadNama = uploadFile.name.replace(/\.[^/.]+$/, '');
						}}
						required
						class="w-full text-xs"
					/>
				</div>

				<div>
					<label class="block font-semibold mb-1">Nama Denah / Layout</label>
					<input
						type="text"
						bind:value={uploadNama}
						placeholder="Misal: Site Plan Area Fabrikasi"
						class="w-full py-1.5 px-3 rounded-xl border bg-slate-50 dark:bg-slate-800"
					/>
				</div>

				<div class="flex items-center justify-end gap-2 pt-2 border-t">
					<button type="button" onclick={() => (showUploadModal = false)} class="px-3 py-1.5 rounded-xl border">Batal</button>
					<button type="submit" disabled={isUploading} class="px-4 py-1.5 bg-blue-600 text-white font-bold rounded-xl">
						{isUploading ? 'Mengunggah...' : 'Unggah'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
