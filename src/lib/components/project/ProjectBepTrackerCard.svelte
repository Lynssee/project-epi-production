<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Penajaman Finance CVP — Fase 5. Kartu "Sisa Jatah" biaya proyek untuk Project Leader.
	// Tiga angka: sudah pakai berapa, plafon berapa, posisi terhadap impas. Bahasa yang bisa
	// ditindaklanjuti — bukan CMR. Nominal Rp hanya tampil bila admin membukanya
	// (project.field_bep.show_rupiah).
	import { onMount } from 'svelte';
	import { getProjectCostPosition, type ProjectCostPosition } from '$lib/services/projectCostBehaviorApi';
	import { getProjectSetting } from '$lib/services/projectSettings';
	import { fetchFieldBudgetPct, type FieldBudgetPct } from '$lib/services/projectFinancePct';
	import { worstCaseRemaining, worstCasePositionVsBep } from '$lib/utils/fieldSafeSpend';
	import { IconLoader2, IconAlertTriangle, IconTargetArrow } from '@tabler/icons-svelte';

	let { projectId }: { projectId: number | string } = $props();

	let loading = $state(true);
	let pos = $state<ProjectCostPosition | null>(null);
	// Skenario terburuk (Biaya Belum Terealisasi) — persen saja; null bila fitur mati / data belum terbaca.
	let pagu = $state<FieldBudgetPct | null>(null);
	let showUnrealized = $derived(getProjectSetting('project.field_finance.show_unrealized') !== false);
	let worst = $derived(showUnrealized && (pagu?.unrealized?.pct ?? 0) > 0 ? worstCaseRemaining(pagu) : null);
	// Posisi impas skenario terburuk (perkiraan, persen saja): hanya bila ada overhead teralokasi & dana tertahan > 0.
	let bepWorst = $derived(
		showUnrealized && pos && (pagu?.unrealized?.pct ?? 0) > 0
			? worstCasePositionVsBep({
					contract_billed: pos.contract_billed,
					variable_realized: pos.variable_realized,
					overhead_allocated: pos.overhead_allocated,
					rap_plafon: pos.rap_plafon,
					unrealized_pct: pagu?.unrealized?.pct
				})
			: null
	);

	function rp(n: number): string {
		return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
	}
	function pct(r: number | null): string {
		return r == null ? '—' : `${Math.round(r * 100)}%`;
	}

	let enabled = $derived(getProjectSetting('project.field_bep.enabled') !== false);

	let tone = $derived.by(() => {
		if (!pos || pos.remaining_pct == null) return 'neutral';
		if (pos.remaining_pct < 0) return 'danger';
		if (pos.remaining_pct < 0.15) return 'warn';
		return 'ok';
	});
	const toneCls: Record<string, string> = {
		ok: 'border-emerald-200 bg-emerald-50',
		warn: 'border-amber-300 bg-amber-50',
		danger: 'border-red-300 bg-red-50',
		neutral: 'border-gray-200 bg-white'
	};

	onMount(async () => {
		if (!enabled) {
			loading = false;
			return;
		}
		// Paralel & tidak memblokir kartu: gagal → skenario terburuk tidak tampil (bukan diganti 0%).
		fetchFieldBudgetPct(Number(projectId)).then((r) => (pagu = r));
		try {
			pos = await getProjectCostPosition(Number(projectId));
		} finally {
			loading = false;
		}
	});
</script>

{#if enabled}
	<div class="rounded-xl border p-4 {toneCls[tone]}">
		<div class="flex items-center gap-2 mb-2">
			<IconTargetArrow size={18} class="text-gray-600" />
			<h3 class="text-sm font-semibold text-gray-800">Sisa Jatah Biaya Proyek</h3>
		</div>

		{#if loading}
			<CircularProgressGauge size={44} strokeWidth={3} label="Menghitung estimasi BEP proyek..." />
		{:else if !pos}
			<p class="text-sm text-gray-500">Data biaya proyek belum tersedia.</p>
		{:else}
			<!-- Sisa jatah (bahasa yang bisa ditindaklanjuti) -->
			{#if pos.rap_plafon > 0}
				<p class="text-sm text-gray-800">
					Sudah terpakai <strong>{pct(pos.used_pct)}</strong> dari plafon RAP.
					Sisa <strong>{pct(pos.remaining_pct)}</strong>{#if pos.show_rupiah}
						({rp(pos.remaining)} dari {rp(pos.rap_plafon)}){/if}.
				</p>
				{#if pos.burn_rate_per_day > 0 && pos.days_left != null}
					<p class="text-xs text-gray-600 mt-1">
						Dengan laju {pos.window_days} hari terakhir{#if pos.show_rupiah}
							({rp(pos.burn_rate_per_day)}/hari){/if}, jatah habis dalam
						<strong>±{Math.round(pos.days_left)} hari</strong>.
					</p>
				{/if}
				{#if worst}
					<p
						class="text-xs mt-1 {worst.over ? 'text-red-700 font-medium' : 'text-amber-700'}"
						title="Skenario terburuk: seluruh pengajuan, Packing List, dan akrual yang masih tertahan di kantor pusat dianggap cair semua. Hanya persen; nama item yang tertahan ada di kartu Safe-Spend pada tab Aktualisasi."
						data-testid="bep-worst-case"
					>
						Skenario terburuk (semua dana tertahan di pusat cair):
						{#if worst.over}
							pagu terlewati <strong>{Math.abs(worst.remainingPct).toFixed(0)}%</strong> dari RAP.
						{:else}
							terpakai <strong>{worst.usedPct.toFixed(0)}%</strong>, sisa <strong>{worst.remainingPct.toFixed(0)}%</strong>.
						{/if}
					</p>
				{/if}
			{:else}
				<p class="text-sm text-gray-500">Plafon RAP belum diisi untuk proyek ini.</p>
			{/if}

			<!-- Posisi terhadap impas proyek -->
			<div class="mt-3 pt-3 border-t border-black/5">
				{#if pos.has_overhead && pos.position_vs_bep != null}
					<p class="text-xs text-gray-700">
						<span class="font-medium">Posisi terhadap impas proyek:</span>
						{#if pos.position_vs_bep >= 1}
							<span class="text-emerald-700 font-semibold">di atas impas</span>
							— kontribusi menutup {Math.round(pos.position_vs_bep * 100)}% overhead kantor yang dibebankan.
						{:else}
							<span class="text-amber-700 font-semibold">di bawah impas</span>
							— kontribusi baru menutup {Math.round(pos.position_vs_bep * 100)}% overhead kantor yang dibebankan.
						{/if}
					</p>
					{#if bepWorst}
						<p
							class="text-xs mt-1 {bepWorst.crossesBep ? 'text-red-700 font-medium' : 'text-amber-700'}"
							title="Perkiraan: bila seluruh dana tertahan di kantor pusat cair sebagai biaya, kontribusi proyek terhadap overhead berkurang. Hanya perkiraan (basis RAP admin dan lokal bisa sedikit berbeda)."
							data-testid="bep-worst-position"
						>
							Skenario terburuk (semua dana tertahan cair), perkiraan: kontribusi menutup
							<strong>±{Math.round(Math.max(0, bepWorst.worst) * 100)}%</strong> overhead
							{#if bepWorst.crossesBep}— <strong>turun ke bawah impas</strong>.{:else if bepWorst.belowBep}— tetap di bawah impas.{:else}— masih di atas impas.{/if}
						</p>
					{/if}
					{#if pos.show_overhead_nominal}
						<p class="text-[11px] text-gray-400 mt-0.5">
							Overhead teralokasi: {rp(pos.overhead_allocated)} · tertagih: {rp(pos.contract_billed)}
						</p>
					{/if}
				{:else}
					<p class="text-xs text-gray-400">
						Belum ada overhead kantor yang dialokasikan ke proyek ini — posisi impas belum bisa dihitung.
					</p>
				{/if}
			</div>

			{#if tone === 'danger'}
				<div class="mt-2 flex items-start gap-1.5 text-xs text-red-700">
					<IconAlertTriangle size={14} class="mt-0.5 shrink-0" />
					<span>Realisasi biaya sudah melewati plafon RAP. Koordinasikan dengan Admin/PM.</span>
				</div>
			{/if}
		{/if}
	</div>
{/if}
