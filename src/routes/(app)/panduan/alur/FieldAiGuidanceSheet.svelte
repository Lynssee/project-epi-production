<!-- src/routes/(app)/panduan/alur/FieldAiGuidanceSheet.svelte -->
<!-- Mobile Bottom Sheet AI Process Guidance & Gate Assistant untuk Personel Lapangan. -->
<script lang="ts">
	import { askFieldAiNavigator, type FieldAiResult } from '$lib/services/processGuidanceAiApi';

	let {
		open = false,
		initialQuery = '',
		onclose,
		onjump
	}: {
		open: boolean;
		initialQuery?: string;
		onclose: () => void;
		onjump: (flowId: string, nodeId: string) => void;
	} = $props();

	let q = $state('');
	let loading = $state(false);
	let error = $state('');
	let result = $state<FieldAiResult | null>(null);

	const FIELD_PRESETS = [
		{ label: 'Alur Alat Rusak', query: 'Bagaimana alur jika alat sewa atau mesin proyek rusak di site?' },
		{ label: 'Kasbon & Petty Cash', query: 'Alur pengajuan kasbon dan LPJ pengeluaran lapangan' },
		{ label: 'Kirim Sisa Material', query: 'Alur pengembalian sisa material dan cat dari proyek ke gudang' },
		{ label: 'Gate Laporan Harian', query: 'Kenapa laporan harian tertahan gate dan apa syarat lolosnya?' }
	];

	$effect(() => {
		if (open) {
			if (initialQuery && initialQuery !== q) {
				q = initialQuery;
				void cari(initialQuery);
			}
		}
	});

	async function cari(queryText?: string) {
		const term = (queryText ?? q).trim();
		if (term.length < 2) return;

		loading = true;
		error = '';
		result = null;

		const r = await askFieldAiNavigator(term);
		loading = false;
		if (!r.ok) {
			error = r.error || 'Gagal menghubungi asisten lapangan.';
		} else {
			result = r;
		}
	}

	function pilihLangkah(nodeId?: string) {
		if (!result?.matchedFlowKey) return;
		onjump(result.matchedFlowKey, nodeId || '');
		onclose();
	}
</script>

{#if open}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 transition-opacity" onclick={onclose}></div>

	<!-- Bottom Sheet Container -->
	<div
		class="fixed inset-x-0 bottom-0 max-h-[88vh] bg-white rounded-t-3xl shadow-2xl z-50 flex flex-col transition-transform duration-200"
		role="dialog"
		aria-modal="true"
		aria-label="Asisten Panduan Lapangan"
	>
		<!-- Handle Bar -->
		<div class="pt-3 pb-1 flex justify-center cursor-grab active:cursor-grabbing">
			<div class="w-12 h-1.5 bg-gray-300 rounded-full"></div>
		</div>

		<!-- Header -->
		<div class="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
			<div class="flex items-center gap-2">
				<span class="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-sm shadow-xs">
					✨
				</span>
				<div>
					<h3 class="text-sm font-bold text-gray-900 flex items-center gap-1.5">
						AI Panduan Lapangan
						<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
							SOP Praktis
						</span>
					</h3>
					<p class="text-[10px] text-gray-500">Tanya solusi alur, kendala gate, dan form lapangan</p>
				</div>
			</div>
			<button
				type="button"
				class="w-7 h-7 rounded-full bg-gray-100 text-gray-500 hover:text-gray-800 flex items-center justify-center text-xs"
				onclick={onclose}
			>
				✕
			</button>
		</div>

		<!-- Input Box -->
		<div class="p-3 border-b border-gray-100 bg-gray-50 space-y-2">
			<form
				onsubmit={(e) => {
					e.preventDefault();
					void cari();
				}}
				class="relative flex items-center"
			>
				<input
					type="search"
					bind:value={q}
					placeholder="Tulis kendala Anda, misal: alat rusak, kasbon..."
					class="w-full text-xs py-2 pl-3 pr-16 rounded-xl border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
					disabled={loading}
				/>
				<button
					type="submit"
					disabled={loading || !q.trim()}
					class="absolute right-1 top-1 bottom-1 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40"
				>
					{loading ? '…' : 'Tanya'}
				</button>
			</form>

			<!-- Quick Preset Chips -->
			<div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-[11px]">
				<span class="text-gray-400 whitespace-nowrap text-[10px]">Pintas:</span>
				{#each FIELD_PRESETS as p}
					<button
						type="button"
						class="px-2.5 py-1 rounded-full bg-white text-gray-700 border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 text-[11px] whitespace-nowrap active:scale-95 transition-all shadow-2xs"
						onclick={() => {
							q = p.query;
							void cari(p.query);
						}}
					>
						{p.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto p-4 space-y-3">
			{#if loading}
				<div class="space-y-2 py-4 animate-pulse">
					<div class="h-4 bg-gray-200 rounded w-1/2"></div>
					<div class="h-14 bg-gray-100 rounded-xl"></div>
					<div class="h-16 bg-gray-100 rounded-xl"></div>
				</div>
			{:else if error}
				<div class="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
					<p class="font-bold">⚠️ Gagal</p>
					<p>{error}</p>
				</div>
			{:else if result}
				{#if !result.found}
					<div class="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-1">
						<p class="text-sm font-bold text-amber-900">Alur Tidak Ditemukan</p>
						<p class="text-xs text-amber-700">{result.message}</p>
					</div>
				{:else}
					<!-- Card Header -->
					<div class="p-3 rounded-2xl bg-emerald-50/80 border border-emerald-200 space-y-1.5">
						<div class="flex items-center justify-between">
							<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-700 text-white">
								{result.sopCode}
							</span>
							<span class="text-[10px] text-gray-500 font-medium">
								{result.source === 'ai' ? '✨ Asisten AI' : '⚡ Direktori Lapangan'}
							</span>
						</div>
						<h4 class="text-xs font-bold text-gray-900">{result.matchedFlowTitle}</h4>
						<p class="text-xs text-gray-700 leading-relaxed bg-white/70 p-2 rounded-lg border border-emerald-100">
							{result.answer}
						</p>

						<button
							type="button"
							class="w-full py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-1 shadow-xs active:scale-95 transition-all"
							onclick={() => pilihLangkah()}
						>
							<span>📖</span>
							<span>Buka Panduan Alur Ini di Halaman</span>
						</button>
					</div>

					<!-- Stages -->
					{#if result.stages && result.stages.length}
						<div class="space-y-1.5">
							<h5 class="text-[11px] font-bold text-gray-700 uppercase tracking-wider">
								Urutan Langkah Lapangan
							</h5>
							<div class="space-y-1.5">
								{#each result.stages as stage, idx}
									<div class="p-2.5 rounded-xl border border-gray-200 bg-white space-y-1 shadow-2xs">
										<div class="flex items-center justify-between">
											<div class="flex items-center gap-1.5">
												<span class="w-4 h-4 rounded-full bg-gray-100 text-[10px] font-bold text-gray-700 flex items-center justify-center border border-gray-300">
													{idx + 1}
												</span>
												<span class="text-xs font-semibold text-gray-800">{stage.label}</span>
											</div>
											<span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
												{stage.pic}
											</span>
										</div>

										<p class="text-[11px] text-gray-600 pl-5.5 leading-snug">{stage.summary}</p>

										{#if stage.gate}
											<div class="pl-5.5 text-[10px] text-purple-700 flex items-center gap-1">
												<span>🛡️ Gate:</span>
												<code class="px-1 rounded bg-purple-50 border border-purple-200 font-mono">
													{stage.gate}
												</code>
											</div>
										{/if}

										{#if stage.actionField}
											<div class="pl-5.5 pt-0.5">
												<a
													href={stage.actionField.href}
													class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-semibold hover:bg-emerald-100"
												>
													<span>📱</span>
													<span>{stage.actionField.label || 'Buka Form'}</span>
													<span>→</span>
												</a>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Quick Tips -->
					{#if result.quickTips}
						<div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-1.5">
							<span class="text-sm">💡</span>
							<p class="text-[11px] leading-relaxed">{result.quickTips}</p>
						</div>
					{/if}
				{/if}
			{:else}
				<div class="py-6 text-center space-y-2">
					<span class="text-2xl block">👷</span>
					<p class="text-xs font-bold text-gray-800">Tanya Panduan Alur Lapangan</p>
					<p class="text-[11px] text-gray-500 max-w-xs mx-auto">
						Tulis masalah atau kendala yang dihadapi di proyek. Asisten akan menunjukkan SOP resmi dan tombol form yang harus diisi.
					</p>
				</div>
			{/if}
		</div>
	</div>
{/if}
