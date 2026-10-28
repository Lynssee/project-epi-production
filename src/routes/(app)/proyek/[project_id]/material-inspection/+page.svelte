<!-- src/routes/(app)/proyek/[project_id]/material-inspection/+page.svelte -->
<!-- QC material/barang masuk (Quality Management Proyek v2, Fase 3 — 10 Agustus 2026). -->
<!-- condition='reject' otomatis bikin draft NCR tertaut. Belum nyambung ke stock-lapangan -->
<!-- (keputusan user) -- berdiri sendiri dulu. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { getProjectById } from '$lib/services/projects';
	import {
		createMaterialInspection, fetchProjectMaterialInspections, uploadMaterialPhoto
	} from '$lib/services/projectMaterialInspectionApi';
	import { IconArrowLeft, IconLoader2, IconCamera } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let inspections = $state<any[]>([]);

	let showForm = $state(false);
	let saving = $state(false);
	let form = $state({
		materialName: '',
		poNo: '',
		qty: '',
		satuan: '',
		condition: 'baik',
		rejectReason: '',
		ownershipType: 'eltama' as 'eltama' | 'subcon' | 'customer' | 'sewa_vendor',
		ownerName: ''
	});
	let photoFile = $state<File | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let filterOwnership = $state<'all' | 'eltama' | 'subcon' | 'customer' | 'sewa_vendor'>('all');

	// Jaring pengaman draf: material datang difoto dulu (sering di gerbang proyek,
	// sinyal seadanya) sebelum detail PO/qty diketik — tab dibunuh OS di titik itu
	// berarti seluruh isian hilang. Dikunci per proyek.
	interface MaterialDraft {
		showForm: boolean;
		form: {
			materialName: string;
			poNo: string;
			qty: string;
			satuan: string;
			condition: string;
			rejectReason: string;
			ownershipType: 'eltama' | 'subcon' | 'customer' | 'sewa_vendor';
			ownerName: string;
		};
	}
	const MATERIAL_PHOTO_KEY = 'material';
	let materialPersist = $derived(createFormPersist<MaterialDraft>(`material_inspection_${projectId}`));
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function materialSnapshot(): MaterialDraft {
		return { showForm, form };
	}

	function onPhotoPicked(file: File | null) {
		photoFile = file;
		if (file) materialPersist.savePhoto(MATERIAL_PHOTO_KEY, file);
		else materialPersist.clearPhoto(MATERIAL_PHOTO_KEY);
	}

	async function load() {
		loading = true;
		try {
			const [proj, list] = await Promise.all([getProjectById(projectId), fetchProjectMaterialInspections(Number(projectId))]);
			project = proj;
			inspections = list as any[];
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		await load();

		const draft = materialPersist.restore();
		if (draft?.showForm) {
			showForm = true;
			form = {
				...draft.form,
				ownershipType: draft.form.ownershipType || 'eltama',
				ownerName: draft.form.ownerName || ''
			};
			const blob = await materialPersist.restorePhoto(MATERIAL_PHOTO_KEY);
			if (blob) photoFile = new File([blob], 'material.jpg', { type: blob.type || 'image/jpeg' });
			draftSavedAt = new Date();
		}
		draftArmed = true;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void materialSnapshot();
		if (!draftArmed) return;
		materialPersist.save(materialSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(materialPersist, materialSnapshot));

	let filteredInspections = $derived(
		inspections.filter((i) => {
			if (filterOwnership === 'all') return true;
			return (i.ownership_type || 'eltama') === filterOwnership;
		})
	);

	async function submit() {
		if (!form.materialName.trim()) return;
		if (form.condition === 'reject' && !form.rejectReason.trim()) return;
		saving = true;
		try {
			let photoFileId: string | null = null;
			if (photoFile) photoFileId = await uploadMaterialPhoto(await compressPhoto(photoFile));
			await createMaterialInspection({
				projectId: Number(projectId),
				materialName: form.materialName.trim(),
				poNo: form.poNo || undefined,
				qty: form.qty ? Number(form.qty) : undefined,
				satuan: form.satuan || undefined,
				condition: form.condition as any,
				rejectReason: form.rejectReason || undefined,
				photoFileId,
				inspectedById: $authStore.karyawanId || undefined,
				actorName: $authStore.karyawanName || undefined,
				ownershipType: form.ownershipType,
				ownerName: form.ownerName?.trim() || undefined
			});
			// Terkirim — draf lokal (termasuk foto di IndexedDB) sudah tidak relevan.
			materialPersist.clear();
			await materialPersist.clearPhotos();
			draftSavedAt = null;
			form = {
				materialName: '',
				poNo: '',
				qty: '',
				satuan: '',
				condition: 'baik',
				rejectReason: '',
				ownershipType: 'eltama',
				ownerName: ''
			};
			photoFile = null;
			showForm = false;
			await load();
		} finally {
			saving = false;
		}
	}
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<button class="mb-3 flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}`)}>
		<IconArrowLeft size={16} /> Kembali ke Proyek
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-14">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat inspeksi material masuk..." />
	</div>
	{:else}
		<h1 class="text-lg font-bold text-gray-900">Material Inspection</h1>
		<p class="mb-4 text-sm text-gray-500">{project?.name || '-'}</p>

		<div class="mb-4 flex items-center justify-between">
			<span class="text-xs text-gray-400">{inspections.length} inspeksi</span>
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} />
			<button class="text-xs font-semibold text-blue-600" onclick={() => (showForm = !showForm)}>
				{showForm ? 'Batal' : '+ QC Barang Masuk'}
			</button>
		</div>

		{#if showForm}
			<div class="mb-4 space-y-2.5 rounded-xl border border-gray-200 bg-gray-50 p-3.5 shadow-sm">
				<div class="space-y-1">
					<span class="text-[11px] font-semibold text-gray-700">Kepemilikan / Asal Barang:</span>
					<div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
						<button
							type="button"
							class="flex items-center justify-center gap-1 rounded-lg border py-1.5 px-2 text-xs font-medium transition-all {form.ownershipType === 'eltama' ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500 font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}"
							onclick={() => (form.ownershipType = 'eltama')}
						>
							🏢 Milik Eltama
						</button>
						<button
							type="button"
							class="flex items-center justify-center gap-1 rounded-lg border py-1.5 px-2 text-xs font-medium transition-all {form.ownershipType === 'subcon' ? 'border-amber-500 bg-amber-50 text-amber-700 ring-1 ring-amber-500 font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}"
							onclick={() => {
								form.ownershipType = 'subcon';
								if (!form.ownerName) form.ownerName = 'PT Primantara';
							}}
						>
							👷 Milik Subcon
						</button>
						<button
							type="button"
							class="flex items-center justify-center gap-1 rounded-lg border py-1.5 px-2 text-xs font-medium transition-all {form.ownershipType === 'customer' ? 'border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500 font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}"
							onclick={() => {
								form.ownershipType = 'customer';
								if (!form.ownerName && project?.customer) form.ownerName = project.customer;
							}}
						>
							🤝 Milik Customer
						</button>
						<button
							type="button"
							class="flex items-center justify-center gap-1 rounded-lg border py-1.5 px-2 text-xs font-medium transition-all {form.ownershipType === 'sewa_vendor' ? 'border-orange-500 bg-orange-50 text-orange-700 ring-1 ring-orange-500 font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}"
							onclick={() => (form.ownershipType = 'sewa_vendor')}
						>
							🔶 Sewa Vendor
						</button>
					</div>
				</div>

				{#if form.ownershipType === 'subcon'}
					<div class="rounded-lg border border-amber-200 bg-amber-50/80 p-2.5 text-xs text-amber-900 space-y-1.5">
						<div class="flex items-center justify-between">
							<span class="font-semibold text-amber-900">Nama Subkontraktor:</span>
							<span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">Rp 0 HPP Eltama</span>
						</div>
						<input
							type="text"
							class="w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
							placeholder="mis. PT Primantara"
							bind:value={form.ownerName}
						/>
						<p class="text-[11px] leading-relaxed text-amber-800">
							💡 <strong>Barang milik Subcon:</strong> Dicatat terpisah dari persediaan Eltama. Wajib ambil foto kondisi awal saat barang tiba di site sebagai bukti serah terima dan tidak boleh diretur ke gudang Eltama.
						</p>
					</div>
				{:else if form.ownershipType === 'customer'}
					<div class="rounded-lg border border-purple-200 bg-purple-50/80 p-2.5 text-xs text-purple-900 space-y-1.5">
						<div class="flex items-center justify-between">
							<span class="font-semibold text-purple-900">Nama Customer / Pemilik:</span>
							<span class="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-800">Free-Issue Material</span>
						</div>
						<input
							type="text"
							class="w-full rounded-md border border-purple-300 bg-white px-2 py-1.5 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-purple-500"
							placeholder="Nama customer / klien pemilik material"
							bind:value={form.ownerName}
						/>
						<p class="text-[11px] leading-relaxed text-purple-800">
							💡 <strong>Barang titipan Customer:</strong> Tidak membebani HPP Eltama. Sisa material wajib diserahterimakan kembali ke customer saat closing proyek.
						</p>
					</div>
				{/if}

				<input type="text" class="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm bg-white" placeholder="Nama material / barang" bind:value={form.materialName} />
				<input type="text" class="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm bg-white" placeholder="No. PO / Surat Jalan (opsional)" bind:value={form.poNo} />
				<div class="flex gap-2">
					<input type="number" class="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm bg-white" placeholder="Qty" bind:value={form.qty} />
					<input type="text" class="w-24 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm bg-white" placeholder="Satuan" bind:value={form.satuan} />
				</div>
				<select class="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm bg-white" bind:value={form.condition}>
					<option value="baik">Kondisi Baik</option>
					<option value="partial">Kondisi Sebagian (Partial)</option>
					<option value="reject">Reject / Rusak (otomatis dibuatkan NCR)</option>
				</select>
				{#if form.condition === 'reject'}
					<textarea class="w-full rounded-lg border border-red-200 bg-red-50/50 px-2.5 py-1.5 text-sm" rows="2" placeholder="Alasan reject (wajib diisi)" bind:value={form.rejectReason}></textarea>
				{/if}

				<input
					bind:this={fileInputEl}
					type="file"
					accept="image/*"
					capture="environment"
					class="hidden"
					onchange={(e) => onPhotoPicked((e.target as HTMLInputElement).files?.[0] || null)}
				/>
				<button
					class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed {form.ownershipType === 'subcon' || form.ownershipType === 'customer' ? 'border-amber-400 bg-amber-50/40 text-amber-800' : 'border-gray-300 bg-white text-gray-500'} py-2 text-xs font-medium"
					onclick={() => fileInputEl?.click()}
				>
					<IconCamera size={16} />
					{#if photoFile}
						<span class="text-blue-600 font-semibold">{photoFile.name} (terpilih)</span>
					{:else if form.ownershipType === 'subcon' || form.ownershipType === 'customer'}
						<span>Ambil Foto Kondisi Awal (Sangat Dianjurkan)</span>
					{:else}
						<span>Ambil Foto Bukti (opsional)</span>
					{/if}
				</button>

				<button
					class="w-full rounded-lg bg-blue-600 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 transition-all"
					disabled={saving}
					onclick={submit}
				>
					{saving ? 'Menyimpan...' : 'Simpan QC Inspeksi'}
				</button>
			</div>
		{/if}

		<!-- Filter Pill Kepemilikan -->
		<div class="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
			<button
				class="whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-all {filterOwnership === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
				onclick={() => (filterOwnership = 'all')}
			>
				Semua ({inspections.length})
			</button>
			<button
				class="whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-all {filterOwnership === 'eltama' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}"
				onclick={() => (filterOwnership = 'eltama')}
			>
				🏢 Eltama
			</button>
			<button
				class="whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-all {filterOwnership === 'subcon' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}"
				onclick={() => (filterOwnership = 'subcon')}
			>
				👷 Subcon (Primantara)
			</button>
			<button
				class="whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-all {filterOwnership === 'customer' ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'}"
				onclick={() => (filterOwnership = 'customer')}
			>
				🤝 Customer
			</button>
			<button
				class="whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-all {filterOwnership === 'sewa_vendor' ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'}"
				onclick={() => (filterOwnership = 'sewa_vendor')}
			>
				🔶 Sewa
			</button>
		</div>

		<div class="space-y-2">
			{#each filteredInspections as insp (insp.id)}
				<div class="rounded-xl border border-gray-100 bg-white p-3 text-xs shadow-sm space-y-1.5">
					<div class="flex items-start justify-between gap-2">
						<div class="space-y-0.5">
							<div class="flex items-center gap-1.5 flex-wrap">
								<span class="font-bold text-gray-900">{insp.material_name}</span>
								{#if insp.ownership_type === 'subcon'}
									<span class="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.2 text-[10px] font-semibold text-amber-800">
										👷 Subcon: {insp.owner_name || 'Subcon'}
									</span>
								{:else if insp.ownership_type === 'customer'}
									<span class="rounded bg-purple-50 border border-purple-200 px-1.5 py-0.2 text-[10px] font-semibold text-purple-800">
										🤝 Customer: {insp.owner_name || 'Customer'}
									</span>
								{:else if insp.ownership_type === 'sewa_vendor'}
									<span class="rounded bg-orange-50 border border-orange-200 px-1.5 py-0.2 text-[10px] font-semibold text-orange-800">
										🔶 Sewa Vendor
									</span>
								{:else}
									<span class="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.2 text-[10px] font-semibold text-blue-800">
										🏢 Eltama
									</span>
								{/if}
							</div>
							{#if insp.qty != null}
								<p class="text-[11px] text-gray-500">Qty: <strong class="text-gray-700">{insp.qty} {insp.satuan || ''}</strong></p>
							{/if}
						</div>
						<span class="rounded-full px-2 py-0.5 text-[11px] font-bold capitalize {insp.condition === 'reject' ? 'bg-red-100 text-red-700' : insp.condition === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}">
							{insp.condition}
						</span>
					</div>

					<div class="flex items-center justify-between text-gray-400 text-[11px] pt-1 border-t border-gray-50">
						<span>{insp.po_no ? `PO/Ref: ${insp.po_no}` : 'Tanpa PO'}</span>
						{#if insp.photo}
							<span class="text-emerald-600 font-medium flex items-center gap-0.5">📷 Ada Foto</span>
						{/if}
					</div>

					{#if insp.linked_ncr_id}
						<p class="text-red-600 font-medium">⚠️ Tertaut NCR #{insp.linked_ncr_id}</p>
					{/if}
				</div>
			{:else}
				<div class="rounded-xl border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
					{filterOwnership === 'all' ? 'Belum ada material inspection.' : 'Tidak ada material dengan kategori kepemilikan ini.'}
				</div>
			{/each}
		</div>
	{/if}
</div>
