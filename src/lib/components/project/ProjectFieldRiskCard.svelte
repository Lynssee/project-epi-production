<!-- src/lib/components/project/ProjectFieldRiskCard.svelte -->
<!-- Panel Identitas Proyek, Pagar Pengaman K3/Mutu Lapangan & Kalkulator Dew Point (Fase 3) -->
<script lang="ts">
	import { slide } from 'svelte/transition';
	import { IconShieldCheck, IconAlertTriangle, IconFlame, IconWind, IconDroplet, IconTool, IconChevronDown, IconChevronUp } from '@tabler/icons-svelte';

	interface Props {
		profile: any;
		projectId?: number | string;
	}

	let { profile, projectId }: Props = $props();

	// State Kalkulator Dew Point (ISO 8502-4)
	let showDewPointCalc = $state(false);
	let ambientTemp = $state(30); // Suhu udara (°C)
	let ambientRh = $state(75);   // Relative Humidity (%)
	let substrateTemp = $state(33); // Suhu permukaan baja/lantai (°C)

	// Hitung Dew Point (Formula Magnus-Tetens)
	let calculatedDewPoint = $derived.by(() => {
		const a = 17.625;
		const b = 243.04;
		const t = Number(ambientTemp) || 0;
		const rh = Math.min(100, Math.max(1, Number(ambientRh) || 1));
		const alpha = Math.log(rh / 100) + (a * t) / (b + t);
		const dp = (b * alpha) / (a - alpha);
		return Math.round(dp * 10) / 10;
	});

	let safeMinSubstrateTemp = $derived(Math.round((calculatedDewPoint + 3.0) * 10) / 10);
	let isRhSafe = $derived(Number(ambientRh) <= 85);
	let isSubstrateTempSafe = $derived(Number(substrateTemp) >= safeMinSubstrateTemp);
	let isWeatherSafeToCoat = $derived(isRhSafe && isSubstrateTempSafe);

	let hasConfinedSpace = $derived(profile?.tags?.some((t: any) => t.key === 'CONFINED_SPACE'));
	let hasLivePlant = $derived(profile?.tags?.some((t: any) => t.key === 'LIVE_PLANT'));
	let hasWorkingAtHeight = $derived(profile?.tags?.some((t: any) => t.key === 'WORKING_AT_HEIGHT'));
	let hasBlasting = $derived(profile?.tags?.some((t: any) => t.key === 'ABRASIVE_BLASTING'));
</script>

{#if profile}
	<div class="rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900 to-slate-850 p-4 text-white shadow-lg space-y-3">
		<!-- Header: Skala & Tingkat Risiko -->
		<div class="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-slate-700/70">
			<div class="flex items-center gap-2 flex-wrap">
				<span class="text-[10px] font-mono uppercase tracking-wider text-slate-400">Identitas Proyek:</span>
				<span class="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-400/40">
					🏢 {profile.scaleLabel}
				</span>
				<span class="px-2.5 py-0.5 rounded-lg text-xs font-bold border {profile.badge.bg} {profile.badge.text} {profile.badge.border}">
					⚠️ Level Risiko: {profile.badge.label.toUpperCase()} ({profile.totalScore}/100)
				</span>
				<span class="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
					🛡️ Gate: {profile.suggestedGateMode.toUpperCase()}
				</span>
			</div>

			<button
				type="button"
				class="text-xs font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
				onclick={() => (showDewPointCalc = !showDewPointCalc)}
			>
				<IconDroplet size={14} class="text-sky-400" />
				<span>Kalkulator Cuaca & Dew Point</span>
				{#if showDewPointCalc}
					<IconChevronUp size={14} />
				{:else}
					<IconChevronDown size={14} />
				{/if}
			</button>
		</div>

		<!-- DNA Karakteristik Tags -->
		<div class="flex items-center gap-1.5 flex-wrap">
			{#each profile.tags as tag}
				<span class="px-2 py-0.5 rounded-md text-[10.5px] font-medium border {tag.color} bg-opacity-20">
					#{tag.label}
				</span>
			{/each}
		</div>

		<!-- Protokol Khusus untuk Proyek Berisiko Tinggi (K3 Lapangan) -->
		{#if hasConfinedSpace || hasLivePlant}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
				{#if hasConfinedSpace}
					<div class="p-3 rounded-xl bg-purple-950/40 border border-purple-800/60 space-y-1.5">
						<div class="flex items-center gap-2 text-purple-300 font-bold text-xs">
							<IconWind size={16} class="text-purple-400" />
							<span>Peringatan Tangki (Confined Space)</span>
						</div>
						<p class="text-[11px] text-slate-300 leading-relaxed">
							Wajib uji kandungan gas O₂ (min 19.5%) & LEL sebelum masuk. Pastikan blower ventilasi menyala terus dan tim standby rescue bertugas di luar lubang tangki.
						</p>
					</div>
				{/if}

				{#if hasLivePlant}
					<div class="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 space-y-1.5">
						<div class="flex items-center gap-2 text-amber-300 font-bold text-xs">
							<IconFlame size={16} class="text-amber-400" />
							<span>Pabrik Beroperasi Aktif (Live Plant)</span>
						</div>
						<p class="text-[11px] text-slate-300 leading-relaxed">
							Wajib perpanjang Permit to Work (PTW) shift pabrik klien. Patuhi zona steril dan jangan lakukan sandblasting tanpa izin Hot Work resmi.
						</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Interactive Dew Point & Weather Calculator (ISO 8502-4) -->
		{#if showDewPointCalc}
			<div transition:slide class="p-3.5 bg-slate-800/90 rounded-xl border border-sky-800/60 space-y-3">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2 text-sky-300 font-bold text-xs">
						<IconDroplet size={16} />
						<span>Kalkulator Standar Sandblasting & Coating (ISO 8502-4)</span>
					</div>
					<span class="text-[10px] text-slate-400 font-mono">Batas RH: Maks. 85% • Syarat Substrat: Min. Dew Point + 3°C</span>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
					<div>
						<label class="text-[11px] text-slate-300 block mb-1">Suhu Udara (°C)</label>
						<input
							type="number"
							step="0.5"
							bind:value={ambientTemp}
							class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-sm font-mono text-white"
						/>
					</div>
					<div>
						<label class="text-[11px] text-slate-300 block mb-1">Kelembaban Udara / RH (%)</label>
						<input
							type="number"
							step="1"
							min="1"
							max="100"
							bind:value={ambientRh}
							class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-sm font-mono text-white"
						/>
					</div>
					<div>
						<label class="text-[11px] text-slate-300 block mb-1">Suhu Permukaan Substrat (°C)</label>
						<input
							type="number"
							step="0.5"
							bind:value={substrateTemp}
							class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-sm font-mono text-white"
						/>
					</div>
				</div>

				<div class="p-2.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 {isWeatherSafeToCoat ? 'bg-emerald-950/50 border-emerald-700/70 text-emerald-300' : 'bg-rose-950/50 border-rose-700/70 text-rose-300'}">
					<div class="space-y-0.5 text-xs">
						<div class="flex items-center gap-2 font-mono">
							<span>Titik Embun (Dew Point): <strong>{calculatedDewPoint}°C</strong></span>
							<span>•</span>
							<span>Batas Min. Substrat: <strong>{safeMinSubstrateTemp}°C</strong></span>
						</div>
						<div class="text-[11px] font-semibold flex items-center gap-1.5">
							{#if isWeatherSafeToCoat}
								<IconShieldCheck size={16} class="text-emerald-400" />
								<span>✅ AMAN UNTUK SANDBLASTING & COATING (Kondisi Ideal, Tidak Ada Kondensasi)</span>
							{:else if !isRhSafe}
								<IconAlertTriangle size={16} class="text-rose-400" />
								<span>⛔ DILARANG BLASPRAY: Kelembaban Udara Terlalu Tinggi ({ambientRh}% &gt; 85%)!</span>
							{:else}
								<IconAlertTriangle size={16} class="text-rose-400" />
								<span>⛔ BAHAYA KONDENSASI: Suhu Permukaan ({substrateTemp}°C) Kurang dari Batas Minimum ({safeMinSubstrateTemp}°C)!</span>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}
