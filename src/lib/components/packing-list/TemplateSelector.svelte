<!-- TemplateSelector.svelte — Pemilih template packing list dengan preview items dari template tersimpan -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { IconLoader2 } from '@tabler/icons-svelte';
	import {
		getPackingListTemplates,
		loadTemplateToProject,
		type Template
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
	let selectedTemplateName = $state<string>('');
	let currentKaryawanName: string | null = null;

	const unsubAuth = authStore.subscribe((s) => {
		currentKaryawanName = s.karyawanName;
	});

	// Get selected template info
	let selectedTemplateInfo = $derived(
		templates.find(t => t.name === selectedTemplateName)
	);

	onMount(async () => {
		await loadTemplates();
		unsubAuth();
	});

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

	async function handleLoadTemplate() {
		if (!selectedTemplateName) {
			alert('Pilih template terlebih dahulu');
			return;
		}

		if (!projectId) {
			alert('Pilih project terlebih dahulu');
			return;
		}

		if (!confirm(`Load template "${selectedTemplateName}" ke project ini?`)) {
			return;
		}

		loadingTemplate = true;
		try {
			const result = await loadTemplateToProject(
				selectedTemplateName,
				projectId,
				currentKaryawanName || 'Leader'
			);

			if (result.added > 0) {
				alert(`Berhasil! ${result.added} item ditambahkan${result.skipped > 0 ? `, ${result.skipped} item dilewati (duplikat)` : ''}.`);
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

	function getCategoryBadges(categories: string[]): string {
		const categoryMap: Record<string, string> = {
			'packing_supplier': '🎨 Supplier',
			'packing_consumable': '🧴 Consumables',
			'packing_sewa_alat': '🔧 Sewa Alat',
			'packing_operasional': '💰 Operasional',
			'packing_jasa': '👷 Jasa',
			'packing_lain_lain': '📦 Lain-Lain'
		};
		return categories.map(c => categoryMap[c] || c).join(', ');
	}
</script>

{#if loading}
	<CircularProgressGauge size={42} strokeWidth={3} label="Memuat template packing list..." />
{:else if templates.length === 0}
	<div class="text-center py-3 text-gray-400 text-[11px] bg-gray-50 rounded-lg">
		Belum ada template tersedia.
	</div>
{:else}
	<!-- Dropdown Select -->
	<select
		class="f-select"
		bind:value={selectedTemplateName}
	>
		<option value="">-- Pilih Template --</option>
		{#each templates as template}
			<option value={template.name}>
				{template.name} ({template.item_count} item)
			</option>
		{/each}
	</select>

	<!-- Metadata & Load Button (only show when template selected) -->
	{#if selectedTemplateName && selectedTemplateInfo}
		<div class="mt-2 space-y-2">
			<!-- Compact Metadata -->
			<div class="text-[11px] text-gray-500">
				<span class="font-medium">{selectedTemplateInfo.item_count}</span> item ·
				Total <span class="font-medium">{selectedTemplateInfo.total_qty}</span> qty
				{#if selectedTemplateInfo.categories.length > 0}
					<div class="mt-1 text-[10px] text-gray-400">
						{getCategoryBadges(selectedTemplateInfo.categories)}
					</div>
				{/if}
			</div>

			<!-- Load Button -->
			<button
				class="btn-load"
				onclick={handleLoadTemplate}
				disabled={loadingTemplate}
			>
				{#if loadingTemplate}
					<IconLoader2 size={14} class="animate-spin" />
					Loading...
				{:else}
					Load Template
				{/if}
			</button>
		</div>
	{/if}
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

	.f-select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: #f9fafb;
	}

	.btn-load {
		width: 100%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 12px;
		border-radius: 8px;
		background: var(--g);
		color: white;
		font-size: 12px;
		font-weight: 500;
		border: none;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-load:hover:not(:disabled) {
		background: var(--gd);
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(34, 197, 94, 0.3);
	}

	.btn-load:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}
</style>
