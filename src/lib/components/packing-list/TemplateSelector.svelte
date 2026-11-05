<!-- TemplateSelector.svelte — Pemilih template packing list cerdas (Parametrik & Dinamis) -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import {
		IconLoader2,
		IconSparkles,
		IconRulerMeasure,
		IconTool,
		IconPackage,
		IconChevronDown,
		IconChevronUp,
		IconCheck
	} from '@tabler/icons-svelte';
	import {
		getPackingListTemplates,
		getTemplateItems,
		loadTemplateToProject,
		getProjectAreaInfo,
		type Template,
		type TemplateItem,
		type ProjectAreaInfo
	} from '$lib/services/packingList';
	import { authStore } from '$lib/stores/auth';

	interface Props {
		projectId: number;
		onTemplateLoaded?: (result: any) => void;
	}

	let { projectId, onTemplateLoaded }: Props = $props();

	let templates = $state<Template[]>([]);
	let loading = $state(true);
	let loadingTemplate = $state(false);
	let loadingPreview = $state(false);
	let selectedTemplateName = $state<string>('');
	let previewItems = $state<TemplateItem[]>([]);
	let showPreviewDetails = $state(false);
	let currentKaryawanName: string | null = null;

	// Project Area & Parametric states
	let projectInfo = $state<ProjectAreaInfo | null>(null);
	let volume = $state<number>(100);
	let selectedObjectId = $state<number | null>(null);

	const unsubAuth = authStore.subscribe((s) => {
		currentKaryawanName = s.karyawanName;
	});

	// Get selected template metadata
	let selectedTemplateInfo = $derived(
		templates.find((t) => t.name === selectedTemplateName)
	);

	// Perhitungan dinamis preview berdasarkan volume
	let calculatedPreview = $derived(
		previewItems.map((item) => {
			const koef = item.koefisien != null && !isNaN(Number(item.koefisien)) && Number(item.koefisien) > 0
				? Number(item.koefisien)
				: null;
			const isScalable = koef !== null;
			const vol = Math.max(0.01, Number(volume) || 1);
			const computedQty = isScalable
				? Math.round(koef * vol * 100) / 100
				: (Number(item.qty) || 0);

			return {
				...item,
				isScalable,
				computedQty
			};
		})
	);

	let scalableCount = $derived(calculatedPreview.filter((i) => i.isScalable).length);
	let fixedCount = $derived(calculatedPreview.filter((i) => !i.isScalable).length);

	onMount(async () => {
		await Promise.all([loadTemplates(), loadProjectContext()]);
		unsubAuth();
	});

	$effect(() => {
		if (projectId) {
			loadProjectContext();
		}
	});

	$effect(() => {
		if (selectedTemplateName) {
			loadTemplatePreview(selectedTemplateName);
		} else {
			previewItems = [];
		}
	});

	async function loadProjectContext() {
		if (!projectId) return;
		try {
			const info = await getProjectAreaInfo(projectId);
			if (info) {
				projectInfo = info;
				if (info.total_area_m2 && info.total_area_m2 > 0) {
					volume = info.total_area_m2;
				}
			}
		} catch (e) {
			console.warn('Gagal memuat konteks proyek:', e);
		}
	}

	async function loadTemplates() {
		loading = true;
		try {
			const result = await getPackingListTemplates();
			templates = result;
		} catch (e) {
			console.error('Gagal memuat templates:', e);
		} finally {
			loading = false;
		}
	}

	async function loadTemplatePreview(name: string) {
		loadingPreview = true;
		try {
			previewItems = await getTemplateItems(name);
		} catch (e) {
			console.error('Gagal memuat preview template:', e);
			previewItems = [];
		} finally {
			loadingPreview = false;
		}
	}

	function handleObjectChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		const val = target.value;
		if (!val) {
			selectedObjectId = null;
			if (projectInfo?.total_area_m2) {
				volume = projectInfo.total_area_m2;
			}
			return;
		}
		const objId = Number(val);
		selectedObjectId = objId;
		const found = projectInfo?.objects?.find((o) => o.id === objId);
		if (found && found.luas && found.luas > 0) {
			volume = found.luas;
		}
	}

	async function handleLoadTemplate() {
		if (!selectedTemplateName) {
			alert('Pilih template terlebih dahulu');
			return;
		}

		if (!projectId) {
			alert('Pilih project terlebih dahulu');
			return;
		}

		const volNum = Math.max(0.01, Number(volume) || 1);
		const confirmMsg = `Terapkan template "${selectedTemplateName}" dengan volume ${volNum} m²?\n\n` +
			`• ${fixedCount} item alat/tetap\n` +
			`• ${scalableCount} item bahan terhitung otomatis`;

		if (!confirm(confirmMsg)) {
			return;
		}

		loadingTemplate = true;
		try {
			const result = await loadTemplateToProject(
				selectedTemplateName,
				projectId,
				currentKaryawanName || 'Leader',
				volNum
			);

			if (result.added > 0) {
				alert(`Berhasil! ${result.added} item ditambahkan ke draft${result.skipped > 0 ? `, ${result.skipped} item dilewati (sudah ada)` : ''}.`);
				if (onTemplateLoaded) {
					onTemplateLoaded(result);
				}
			} else if (result.skipped > 0) {
				alert(`Semua item (${result.skipped}) sudah ada di project ini.`);
			} else {
				alert('Template kosong atau gagal dimuat.');
			}
		} catch (e) {
			console.error('Gagal load template:', e);
			alert('Gagal memuat template. Silakan coba lagi.');
		} finally {
			loadingTemplate = false;
		}
	}

	function getCategoryBadge(category: string): { label: string; color: string } {
		const clean = category.replace('packing_', '');
		switch (clean) {
			case 'supplier':
			case 'material':
				return { label: 'Material', color: 'bg-blue-50 text-blue-700 border-blue-200' };
			case 'consumable':
				return { label: 'Consumable', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
			case 'safety':
				return { label: 'Safety', color: 'bg-amber-50 text-amber-700 border-amber-200' };
			case 'sewa_alat':
				return { label: 'Alat', color: 'bg-purple-50 text-purple-700 border-purple-200' };
			default:
				return { label: clean, color: 'bg-gray-50 text-gray-700 border-gray-200' };
		}
	}
</script>

{#if loading}
	<CircularProgressGauge size={42} strokeWidth={3} label="Memuat template packing list..." />
{:else if templates.length === 0}
	<div class="text-center py-3 text-gray-400 text-[11px] bg-gray-50 rounded-lg">
		Belum ada template packing list tersedia.
	</div>
{:else}
	<div class="space-y-3">
		<!-- Dropdown Template -->
		<div>
			<label class="block text-[11px] font-medium text-gray-600 mb-1">
				Pilih Jenis Template Pekerjaan:
			</label>
			<select
				class="f-select"
				bind:value={selectedTemplateName}
			>
				<option value="">-- Pilih Template Pekerjaan --</option>
				{#each templates as template}
					<option value={template.name}>
						{template.name} ({template.item_count} item{#if template.has_parametric} · Parametrik{/if})
					</option>
				{/each}
			</select>
		</div>

		{#if selectedTemplateName}
			<!-- Parametric Volume & Object Selector -->
			<div class="p-3 bg-gradient-to-br from-emerald-50/70 to-blue-50/40 border border-emerald-100 rounded-xl space-y-2.5">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-900">
						<IconSparkles size={16} class="text-emerald-600" />
						Kalkulasi Parametrik Luas / Volume
					</div>
					{#if projectInfo?.lokasi}
						<span class="text-[10px] bg-white/80 px-2 py-0.5 rounded-full border border-emerald-200 text-gray-600">
							📍 {projectInfo.lokasi}
						</span>
					{/if}
				</div>

				<!-- Objek Proyek (jika ada) -->
				{#if projectInfo?.objects && projectInfo.objects.length > 0}
					<div>
						<label class="block text-[10px] font-medium text-gray-600 mb-1">
							Pilih Objek Pekerjaan Terdata:
						</label>
						<select
							class="f-select-sm"
							value={selectedObjectId || ''}
							onchange={handleObjectChange}
						>
							<option value="">-- Proyek Keseluruhan ({projectInfo.total_area_m2 || volume} m²) --</option>
							{#each projectInfo.objects as obj}
								<option value={obj.id}>
									{obj.nama_objek} ({obj.luas || 0} {obj.satuan || 'm²'}{#if obj.material} · {obj.material}{/if})
								</option>
							{/each}
						</select>
					</div>
				{/if}

				<!-- Input Volume Langsung -->
				<div class="flex items-center gap-2">
					<div class="flex-1">
						<label class="block text-[10px] font-medium text-gray-600 mb-0.5">
							Luas / Volume Objek (m²):
						</label>
						<div class="relative">
							<input
								type="number"
								min="0.1"
								step="any"
								class="f-input-vol"
								bind:value={volume}
								placeholder="Misal 100"
							/>
							<span class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-gray-400">
								m²
							</span>
						</div>
					</div>
					<!-- Quick chips volume -->
					<div class="flex items-end gap-1 pb-0.5">
						{#each [50, 100, 200, 500] as qv}
							<button
								type="button"
								class="px-2 py-1.5 text-[10px] rounded-lg border border-emerald-200 bg-white hover:bg-emerald-100/50 text-emerald-800 transition-colors"
								onclick={() => (volume = qv)}
							>
								{qv} m²
							</button>
						{/each}
					</div>
				</div>

				<!-- Info Ringkasan Kalkulasi -->
				<div class="flex items-center justify-between text-[11px] text-gray-600 pt-1 border-t border-emerald-200/60">
					<span class="flex items-center gap-1 text-emerald-800 font-medium">
						<IconTool size={13} /> {fixedCount} Alat Tetap
					</span>
					<span class="flex items-center gap-1 text-blue-800 font-medium">
						<IconPackage size={13} /> {scalableCount} Bahan Dihitung Otomatis
					</span>
					<button
						type="button"
						class="text-[11px] text-emerald-700 hover:text-emerald-900 font-medium flex items-center gap-0.5"
						onclick={() => (showPreviewDetails = !showPreviewDetails)}
					>
						{showPreviewDetails ? 'Tutup Preview' : 'Lihat Rincian'}
						{#if showPreviewDetails}
							<IconChevronUp size={13} />
						{:else}
							<IconChevronDown size={13} />
						{/if}
					</button>
				</div>

				<!-- Detail Breakdown Preview (Accordion) -->
				{#if showPreviewDetails}
					<div class="mt-2 pt-2 border-t border-emerald-200/60 max-h-56 overflow-y-auto space-y-1 pr-1">
						{#if loadingPreview}
							<div class="py-2 text-center text-[11px] text-gray-400">Memuat rincian item...</div>
						{:else}
							{#each calculatedPreview as item}
								{@const badge = getCategoryBadge(item.budget_category)}
								<div class="flex items-center justify-between py-1 px-2 rounded-md bg-white/90 border border-gray-100 text-[11px]">
									<div class="flex items-center gap-1.5 min-w-0 pr-2">
										<span class="text-[9px] px-1.5 py-0.2 rounded border {badge.color}">
											{badge.label}
										</span>
										<span class="font-medium text-gray-800 truncate" title={item.material_name}>
											{item.material_name}
										</span>
									</div>
									<div class="flex items-center gap-1.5 shrink-0">
										{#if item.isScalable}
											<span class="text-[10px] text-gray-400">
												({item.koefisien} × {volume}) =
											</span>
											<span class="font-bold text-emerald-700">
												{item.computedQty} {item.unit}
											</span>
										{:else}
											<span class="text-[10px] text-purple-600 bg-purple-50 px-1 rounded">Tetap</span>
											<span class="font-bold text-gray-700">
												{item.computedQty} {item.unit}
											</span>
										{/if}
									</div>
								</div>
							{/each}
						{/if}
					</div>
				{/if}
			</div>

			<!-- Tombol Load Template -->
			<button
				class="btn-load-parametric"
				onclick={handleLoadTemplate}
				disabled={loadingTemplate || !volume || volume <= 0}
			>
				{#if loadingTemplate}
					<IconLoader2 size={15} class="animate-spin" />
					Menerapkan Template...
				{:else}
					<IconCheck size={15} />
					Terapkan Template Parametrik ({calculatedPreview.length} Item)
				{/if}
			</button>
		{/if}
	</div>
{/if}

<style>
	.f-select {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 12px;
		background: white;
		color: #374151;
		transition: all 0.2s;
		cursor: pointer;
	}

	.f-select:focus {
		outline: none;
		border-color: var(--g);
		box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.1);
	}

	.f-select-sm {
		width: 100%;
		padding: 6px 10px;
		border: 1px solid #d1d5db;
		border-radius: 6px;
		font-size: 11px;
		background: white;
		color: #374151;
	}

	.f-input-vol {
		width: 100%;
		padding: 6px 36px 6px 10px;
		border: 1px solid #a7f3d0;
		background: white;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 600;
		color: #065f46;
	}

	.f-input-vol:focus {
		outline: none;
		border-color: #059669;
		box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
	}

	.btn-load-parametric {
		width: 100%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 9px 14px;
		border-radius: 8px;
		background: linear-gradient(135deg, #059669, #047857);
		color: white;
		font-size: 12px;
		font-weight: 600;
		border: none;
		cursor: pointer;
		box-shadow: 0 2px 6px rgba(5, 150, 105, 0.25);
		transition: all 0.2s;
	}

	.btn-load-parametric:hover:not(:disabled) {
		background: linear-gradient(135deg, #047857, #065f46);
		transform: translateY(-1px);
		box-shadow: 0 4px 10px rgba(5, 150, 105, 0.35);
	}

	.btn-load-parametric:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}
</style>
