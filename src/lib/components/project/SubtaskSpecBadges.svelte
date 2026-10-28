<!-- src/lib/components/project/SubtaskSpecBadges.svelte -->
<!-- Badge spek teknis + kebutuhan barang/alat per subtask — Standarisasi Timeline v2 (TAJAM),
     Fase 6 (dashboard lapangan). Dibaca dari `sub` yang SUDAH ditarik halaman Timeline
     (timeline_planning JSON v3.1) — nol query tambahan. Hanya tampil bila datanya ada; proyek
     lama tanpa spec/bom/equipment/mob_stage tetap bersih tanpa badge sama sekali. -->
<script lang="ts">
	import { normalizeManpower, subtaskDailyHeadcount } from '$lib/utils/manpowerPlan';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	let { sub, mobStageLabel = null, onVendorClick = null }: { sub: any; mobStageLabel?: string | null; onVendorClick?: ((vendorId: number) => void) | null } = $props();

	let hasSpec = $derived(!!(sub?.spec && Object.keys(sub.spec).length > 0));
	let bomCount = $derived(sub?.bom?.length || 0);
	let equipmentCount = $derived(sub?.equipment?.length || 0);
	let manpowerLines = $derived(normalizeManpower(sub?.manpower));
	let manpowerPerDay = $derived(subtaskDailyHeadcount(sub));
	let hasMobStage = $derived(!!sub?.mob_stage);
	// Executor Partitioning Fase 3 — badge pelaksana (read-only di lapangan; hanya admin ERP
	// yang boleh menandai external_prereq "siap"). null/'internal' = tidak ditampilkan (default lama).
	let executorType = $derived(sub?.executor_type || null);
	let executorBlocked = $derived(
		executorType === 'external_prereq' &&
		!!sub?.target_ready_date &&
		!sub?.actual_ready_date &&
		sub.target_ready_date < new Date().toISOString().slice(0, 10)
	);
	let anyBadge = $derived(hasSpec || bomCount > 0 || equipmentCount > 0 || manpowerLines.length > 0 || hasMobStage || !!executorType);

	function specSummary(spec: Record<string, any>): string {
		return Object.entries(spec)
			.filter(([, v]) => v !== null && v !== undefined && v !== '')
			.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('–') : v}`)
			.join(' · ');
	}
</script>

{#if anyBadge}
	<div class="tl-spec-badges">
		{#if hasSpec}
			<Tooltip text={specSummary(sub.spec)} position="bottom"><span class="tl-spec-badge">🎯 Spek</span></Tooltip>
		{/if}
		{#if bomCount > 0}
			<Tooltip text="{bomCount} material/consumable/APD" position="bottom"><span class="tl-spec-badge">📦 {bomCount}</span></Tooltip>
		{/if}
		{#if equipmentCount > 0}
			<Tooltip text="{equipmentCount} equipment" position="bottom"><span class="tl-spec-badge">🚜 {equipmentCount}</span></Tooltip>
		{/if}
		{#if manpowerLines.length > 0}
			<Tooltip text={manpowerLines.map((m) => `${m.qty} ${m.role}${m.basis === 'per_subtask' ? ' (sekali)' : '/hari'}`).join(', ')} position="bottom">
				<span class="tl-spec-badge">👷 {manpowerPerDay > 0 ? `${manpowerPerDay} org` : `${manpowerLines.length} peran`}</span>
			</Tooltip>
		{/if}
		{#if hasMobStage}
			<Tooltip text="Tahap mobilisasi" position="bottom"><span class="tl-spec-badge">🚚 {mobStageLabel || sub.mob_stage}</span></Tooltip>
		{/if}
		{#if executorType === 'vendor'}
			{#if sub.executor_vendor_id && onVendorClick}
				<button type="button" class="tl-spec-badge tl-spec-badge-clickable" title="Klik untuk lihat kontak vendor{sub.executor_vendor_name ? ': ' + sub.executor_vendor_name : ''}" onclick={() => onVendorClick(sub.executor_vendor_id)}>
					🤝 {sub.executor_vendor_name || 'Vendor'}
				</button>
			{:else}
				<Tooltip text="Dikerjakan vendor/subkon{sub.executor_vendor_name ? ': ' + sub.executor_vendor_name : ''}" position="bottom"><span class="tl-spec-badge">🤝 {sub.executor_vendor_name || 'Vendor'}</span></Tooltip>
			{/if}
		{:else if executorType === 'external_prereq'}
			<Tooltip text="Prasyarat pihak ketiga{sub.external_party ? ': ' + sub.external_party : ''}{executorBlocked ? ' — lewat target tanggal siap' : ''}" position="bottom"><span class="tl-spec-badge {executorBlocked ? 'tl-spec-badge-blocked' : ''}">{executorBlocked ? '🔴' : '⏳'} {sub.external_party || 'Prasyarat Eksternal'}</span></Tooltip>
		{/if}
	</div>
{/if}

<style>
	.tl-spec-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		margin-top: 3px;
	}
	.tl-spec-badge {
		font-size: 9px;
		line-height: 1.4;
		padding: 1px 5px;
		border-radius: 8px;
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		color: #475569;
		white-space: nowrap;
	}
	.tl-spec-badge-blocked {
		background: #fee2e2;
		border-color: #fca5a5;
		color: #b91c1c;
		font-weight: 700;
	}
	.tl-spec-badge-clickable {
		cursor: pointer;
		font-family: inherit;
	}
	.tl-spec-badge-clickable:hover {
		background: #e0f2fe;
		border-color: #7dd3fc;
	}
</style>
