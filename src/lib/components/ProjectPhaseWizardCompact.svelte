<!-- src/lib/components/ProjectPhaseWizardCompact.svelte -->
<!-- Project Phase Wizard, sisi Lapangan (Fase B) — stepper horizontal ringkas + checklist. -->
<!-- Leader HANYA bisa centang checklist mobilisasi & closeout; fase lain read-only. -->
<script lang="ts">
	import { authStore } from '$lib/stores/auth';
	import {
		isWizardEnabled,
		getPhaseDefinitions,
		getProjectPhases,
		computeCurrentPhase,
		getPhaseChecklist,
		setPhaseCheck,
		type PhaseDefinition
	} from '$lib/services/projectPhaseApi';
	import { loadProjectSettings } from '$lib/services/projectSettings';

	let { project }: { project: { id: number; status?: string; so_customer_id?: number | string | null } } = $props();

	let enabled = $state(false);
	let loading = $state(true);
	let defs = $state<PhaseDefinition[]>([]);
	let phaseRows = $state<Record<string, any>>({});
	let activeKey = $state('inisiasi');
	let selectedKey = $state('inisiasi');
	let checklist = $state<{ items: any[]; pct: number; passed: boolean; readOnly: boolean }>({ items: [], pct: 0, passed: false, readOnly: true });
	let checklistLoading = $state(false);
	let savingItem = $state<string | null>(null);
	let loadedFor = $state<number | null>(null);

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		(window as any).__showToast?.(message, type);
	}

	function phaseStatus(def: PhaseDefinition): string {
		const row = phaseRows[def.phase_key];
		const activeOrder = defs.find((d) => d.phase_key === activeKey)?.phase_order ?? 0;
		if (row?.status === 'skipped') return 'skipped';
		if (row?.status === 'completed' || def.phase_order < activeOrder) return 'completed';
		if (def.phase_key === activeKey) return 'active';
		return 'upcoming';
	}

	async function load() {
		if (!project?.id) return;
		loading = true;
		try {
			await loadProjectSettings();
			enabled = isWizardEnabled();
			if (!enabled) return;
			defs = await getPhaseDefinitions();
			const [rows, current] = await Promise.all([getProjectPhases(project.id), computeCurrentPhase(project)]);
			phaseRows = rows;
			activeKey = current;
			selectedKey = current;
			await loadChecklist(selectedKey);
		} finally {
			loading = false;
		}
	}

	async function loadChecklist(phaseKey: string) {
		checklistLoading = true;
		try {
			checklist = await getPhaseChecklist(project.id, phaseKey);
		} finally {
			checklistLoading = false;
		}
	}

	function selectPhase(def: PhaseDefinition) {
		selectedKey = def.phase_key;
		loadChecklist(def.phase_key);
	}

	async function toggleItem(item: any) {
		if (checklist.readOnly) return;
		savingItem = item.id;
		try {
			await setPhaseCheck(project.id, selectedKey, item.id, !item.checked, $authStore.karyawanName || 'lapangan');
			await loadChecklist(selectedKey);
			showToast(`Item "${item.label}" diperbarui`);
		} catch (e: any) {
			showToast(e.message || 'Gagal menyimpan item checklist', 'error');
		} finally {
			savingItem = null;
		}
	}

	$effect(() => {
		if (project?.id && project.id !== loadedFor) {
			loadedFor = project.id;
			load();
		}
	});
</script>

{#if enabled && !loading}
	{@const selectedDef = defs.find((d) => d.phase_key === selectedKey)}
	<div class="phase-wizard">
		<div class="phase-stepper">
			{#each defs as def (def.phase_key)}
				{@const status = phaseStatus(def)}
				<button
					class="phase-step {status} {selectedKey === def.phase_key ? 'selected' : ''}"
					style={status === 'active' ? `border-color:${def.phase_color}; background:${def.phase_color}14;` : ''}
					onclick={() => selectPhase(def)}
					title={def.description}
				>
					<span class="phase-icon">{status === 'completed' ? '✅' : status === 'skipped' ? '⏭️' : def.phase_icon}</span>
					<span class="phase-label">{def.phase_label}</span>
				</button>
			{/each}
		</div>

		{#if selectedDef}
			<div class="phase-detail">
				<p class="phase-hint">💡 {selectedDef.hint_text}</p>

				{#if !checklistLoading}
					<div class="phase-progress-bar">
						<div class="phase-progress-fill" style="width:{checklist.pct}%; background:{checklist.passed ? '#16a34a' : checklist.pct >= 50 ? '#d97706' : '#dc2626'};"></div>
					</div>

					{#if checklist.items.length > 0}
						<div class="phase-checklist">
							{#each checklist.items as item (item.id)}
								<button
									class="phase-check-item {item.checked ? 'checked' : ''}"
									disabled={checklist.readOnly || savingItem === item.id}
									onclick={() => toggleItem(item)}
								>
									<span>{item.checked ? '✅' : '⬜'}</span>
									<span class="check-label">{item.label}{item.wajib ? ' *' : ''}</span>
								</button>
							{/each}
						</div>
					{:else if checklist.readOnly}
						<p class="phase-readonly-note">Fase ini dikelola oleh Admin/PM — hubungi kantor untuk detail lebih lanjut.</p>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.phase-wizard {
		background: var(--card-bg, #fff);
		border: 1px solid var(--border, #e5e7eb);
		border-radius: 12px;
		padding: 10px;
		margin-bottom: 10px;
	}
	.phase-stepper {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 2px;
	}
	.phase-step {
		flex: 1 0 auto;
		min-width: 76px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 6px 4px;
		border-radius: 10px;
		border: 2px solid transparent;
		background: #f9fafb;
		opacity: 0.6;
	}
	.phase-step.active,
	.phase-step.completed,
	.phase-step.skipped {
		opacity: 1;
	}
	.phase-step.completed {
		border-color: #16a34a;
		background: #f0fdf4;
	}
	.phase-step.skipped {
		border-color: #9ca3af;
		background: #f9fafb;
	}
	.phase-step.selected {
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.4);
	}
	.phase-icon {
		font-size: 16px;
		line-height: 1;
	}
	.phase-label {
		font-size: 10px;
		font-weight: 700;
		color: #374151;
		text-align: center;
		line-height: 1.1;
	}
	.phase-detail {
		margin-top: 10px;
		padding-top: 8px;
		border-top: 1px solid #f1f5f9;
	}
	.phase-hint {
		font-size: 11px;
		color: #1e40af;
		background: #eff6ff;
		border: 1px solid #dbeafe;
		border-radius: 8px;
		padding: 6px 8px;
		margin: 0 0 8px;
	}
	.phase-progress-bar {
		width: 100%;
		height: 6px;
		background: #f3f4f6;
		border-radius: 999px;
		overflow: hidden;
		margin-bottom: 8px;
	}
	.phase-progress-fill {
		height: 100%;
	}
	.phase-checklist {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.phase-check-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		background: #fff;
		text-align: left;
	}
	.phase-check-item.checked {
		background: #f0fdf4;
		border-color: #bbf7d0;
	}
	.check-label {
		font-size: 12px;
		color: #374151;
	}
	.phase-readonly-note {
		font-size: 11px;
		color: #9ca3af;
		font-style: italic;
	}
</style>
