<!-- src/routes/(app)/panduan/alur/NegativeScenariosPanel.svelte -->
<!-- "🚨 Panduan Saat Kendala / ERP Error / Offline": skenario negatif & fallback SOP ini (data dari erp-epi: SOP → Negative Case & Fallback).
     Hemat layar & kuota: lipat secara bawaan; data sudah ikut alur yang dimuat (tanpa permintaan tambahan). Tampil hanya bila SOP punya skenario. -->
<script lang="ts">
	import type { ProcessFlow, ProcessNegativeScenario } from '$lib/data/processGuidance';

	let { flow, onjump }: { flow: ProcessFlow | null; onjump?: (flowId: string) => void } = $props();

	const CATS: Record<string, { icon: string; label: string }> = {
		system_erp_error: { icon: '🖥️', label: 'ERP / Server Error' },
		network_offline: { icon: '📡', label: 'Sinyal Putus / Offline' },
		gate_blocked: { icon: '🛡️', label: 'Tertahan Gate' },
		data_mismatch: { icon: '⚠️', label: 'Selisih Data' },
		operational_reject: { icon: '🔄', label: 'Ditolak / Gagal' },
		force_majeure_k3: { icon: '🚨', label: 'Darurat K3' }
	};
	const SEV: Record<string, string> = {
		critical: 'bg-rose-100 text-rose-800',
		high: 'bg-orange-100 text-orange-800',
		medium: 'bg-amber-100 text-amber-800',
		low: 'bg-gray-100 text-gray-700'
	};

	const items = $derived<ProcessNegativeScenario[]>(flow?.sop?.negative_scenarios ?? []);

	/** Tiket bantuan baru (/support/baru) dengan judul & kronologi terisi dari konteks SOP, langkah, dan gate. */
	function helpHref(s: ProcessNegativeScenario): string {
		const q = new URLSearchParams({
			tipe: 'Permintaan',
			judul: `Kendala SOP ${flow?.sop_code || flow?.id || ''}: ${s.trigger}`.slice(0, 120),
			sop: flow?.sop_code || flow?.id || '',
			step: s.step_label || s.step_id || '',
			gate: s.related_gate_key || ''
		});
		return `/support/baru?${q.toString()}`;
	}
</script>

{#if items.length}
	<details class="bg-rose-50 border border-rose-200 rounded-2xl text-xs" data-testid="negative-panel">
		<summary class="cursor-pointer px-3.5 py-2.5 font-bold text-rose-900 flex items-center gap-2">
			<span>🚨</span>
			<span class="flex-1">Panduan Saat Kendala / ERP Error / Offline</span>
			<span class="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px]">{items.length}</span>
		</summary>
		<div class="px-3 pb-3 space-y-2">
			<p class="text-[11px] text-rose-800">💡 Sistem atau sinyal bermasalah? Pilih kondisi Anda, ikuti langkah darurat, lalu input ulang ke aplikasi sesuai batas waktunya.</p>
			{#each items as s (s.code)}
				<details class="bg-white border border-rose-100 rounded-xl">
					<summary class="cursor-pointer p-2.5 flex items-start gap-1.5">
						<span>{CATS[s.category]?.icon ?? '⚠️'}</span>
						<span class="flex-1">
							<span class="font-semibold text-gray-900 block">{s.trigger}</span>
							<span class="text-[10px] text-gray-500">{CATS[s.category]?.label ?? s.category}{s.step_label ? ` · ${s.step_label}` : ''}</span>
						</span>
						<span class="text-[10px] font-bold px-1.5 py-0.5 rounded {SEV[s.severity] ?? SEV.medium}">{s.severity}</span>
					</summary>
					<div class="px-3 pb-3 space-y-2 text-[11px] text-gray-700">
						{#if s.impact}<p><b>Dampak:</b> {s.impact}</p>{/if}
						<div>
							<b>Langkah darurat:</b>
							<p class="whitespace-pre-line mt-0.5">{s.fallback_action}</p>
						</div>
						{#if s.reconciliation_action}
							<div>
								<b>Setelah sistem pulih:</b>
								<p class="whitespace-pre-line mt-0.5">{s.reconciliation_action}</p>
							</div>
						{/if}
						<p class="text-[10px] text-gray-500">
							{#if s.recovery_sla_hours}⏱ Lapor bila &gt; {s.recovery_sla_hours} jam · {/if}{#if s.reconciliation_sla_hours}🔁 Input ulang ≤ {s.reconciliation_sla_hours} jam{/if}{#if s.escalation_pic} · 👤 {s.escalation_pic}{/if}
						</p>
						<div class="flex flex-wrap gap-2">
							<a href={helpHref(s)} class="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white font-semibold active:scale-95" title="Buka bantuan dengan kode SOP, langkah, dan gate sudah terisi">🎫 Minta Bantuan</a>
							{#if s.fallback_flow_key && onjump}
								<button type="button" class="px-2.5 py-1.5 rounded-lg border border-gray-300 font-semibold active:scale-95" onclick={() => onjump?.(s.fallback_flow_key as string)}>📘 SOP darurat terkait</button>
							{/if}
						</div>
					</div>
				</details>
			{/each}
		</div>
	</details>
{/if}
