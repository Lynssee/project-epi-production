<!-- src/routes/(app)/panduan/alur/FieldStateAndGateCard.svelte -->
<!-- "🧭 Siklus Dokumen & Syarat Lolos Gate" — kartu vertikal ringan untuk layar HP: urutan langkah dokumen dari awal sampai selesai,
     siapa yang mengerjakan/memeriksa, pintasan form lapangan, dan syarat gate yang diperiksa sistem agar pengajuan tidak tertahan.
     Hemat kuota: detail gate (mode/pesan/hint/checklist) BARU diunduh saat kartu dibuka (1 panggilan per alur, disimpan di perangkat).
     Deep-link ?alur=<alur>&fokus=<langkah> membuka kartu dan menyorot langkah itu. Sumber gate = admin (/settings/gates) — tidak ada kalimat hardcode. -->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { ProcessFlow } from '$lib/data/processGuidance';
	import { loadGateInfo, type GateInfoResult } from './fieldGateApi';
	import { buildCycle, summarizeCycle, modeMeta, MODE_META, branchSentence } from './gateCardModel';
	import { loadPrep, savePrep, prepItemKey, isPrepGate, prepProgress } from './gatePrep';
	import FlowMiniMap from './FlowMiniMap.svelte';

	let { flow, flowId, fokus = '' }: { flow: ProcessFlow | null; flowId: string; fokus?: string } = $props();

	let open = $state(false);
	let info = $state<GateInfoResult | null>(null);
	let loading = $state(false);
	let openStep = $state('');
	let showMap = $state(false);
	/** Butir checklist yang sudah dicentang user (pengingat pribadi di perangkat; tidak dikirim ke server). */
	let prep = $state<Set<string>>(new Set());

	let steps = $derived(buildCycle(flow, info?.gates));
	let sum = $derived(summarizeCycle(steps));

	// Ganti alur → reset kartu (detail gate dimuat ulang saat dibuka).
	$effect(() => {
		void flowId;
		untrack(() => {
			info = null;
			loading = false;
			openStep = '';
			open = false;
			showMap = false;
			prep = loadPrep(flowId);
		});
	});

	// Tautan ?fokus=<langkah> pada langkah ber-gate → kartu langsung terbuka dan menyorot langkah itu.
	$effect(() => {
		const f = fokus;
		const fl = flow;
		if (f && fl?.nodes?.some((n) => n.id === f && (n.gates?.length ?? 0) > 0)) {
			untrack(() => {
				openStep = f;
				open = true;
			});
		}
	});

	// Muat detail gate hanya saat kartu terbuka dan alur punya gate.
	$effect(() => {
		const id = flowId;
		if (!open || !flow || sum.gates === 0) return;
		untrack(async () => {
			if (info || loading) return;
			loading = true;
			const r = await loadGateInfo(id);
			if (id !== flowId) return; // pengguna sudah pindah alur — abaikan hasil lama
			info = r;
			loading = false;
		});
	});

	// Gulir ke langkah yang disorot setelah kartu tergambar.
	$effect(() => {
		if (open && openStep && steps.length) {
			const target = openStep;
			untrack(async () => {
				await tick();
				document.getElementById(`gc-step-${target}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
			});
		}
	});

	function toggleStep(id: string) {
		openStep = openStep === id ? '' : id;
	}
	/** Ketuk langkah di peta mini / cabang keputusan → buka rincian langkah itu dan gulir ke sana. */
	async function jumpTo(id: string) {
		openStep = id;
		await tick();
		document.getElementById(`gc-step-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}
	function togglePrep(gateKey: string, label: string) {
		const k = prepItemKey(gateKey, label);
		const next = new Set(prep);
		if (next.has(k)) next.delete(k);
		else next.add(k);
		prep = next;
		savePrep(flowId, next);
	}
	function resetPrep(gateKey: string, labels: string[]) {
		const next = new Set(prep);
		for (const l of labels) next.delete(prepItemKey(gateKey, l));
		prep = next;
		savePrep(flowId, next);
	}
	const bypassLabel: Record<string, string> = {
		exception_reason: 'isi alasan pengecualian',
		fast_track: 'jalur cepat (fast track)',
		override_gm: 'persetujuan manajemen (override)',
		grant: 'izin khusus (grant)'
	};
</script>

{#if flow && steps.length > 0}
	<section class="bg-white border border-purple-200 rounded-2xl shadow-xs" data-testid="gate-card" aria-label="Siklus dokumen dan syarat gate">
		<button type="button" class="w-full flex items-start justify-between gap-2 text-left p-3.5" aria-expanded={open} data-testid="gate-card-toggle" onclick={() => (open = !open)}>
			<span class="min-w-0">
				<span class="block text-sm font-bold text-purple-900">🧭 Siklus Dokumen & Syarat Lolos Gate</span>
				<span class="block text-[11px] text-purple-800 mt-0.5">
					{sum.steps} langkah · {sum.gated > 0 ? `${sum.gated} langkah dijaga ${sum.gates} gate` : 'tanpa gate di alur ini'}
					{#if sum.strongest}· terketat: <b>{modeMeta(sum.strongest).short}</b>{/if}
				</span>
			</span>
			<span class="text-purple-700 text-xs mt-1 transition-transform {open ? 'rotate-180' : ''}">▾</span>
		</button>

		{#if open}
			<div class="px-3.5 pb-3.5 space-y-3 border-t border-purple-100 pt-3">
				<p class="text-[11px] text-gray-600 leading-relaxed">
					Urutan langkah dokumen dari awal sampai selesai. <b>Ketuk satu langkah</b> untuk melihat siapa yang mengerjakan, formulirnya, dan <b>syarat gate</b> yang diperiksa sistem agar pengajuan Anda tidak tertahan.
				</p>

				<div class="space-y-2">
					<button type="button" class="px-2.5 py-1.5 rounded-lg border border-purple-300 bg-purple-50 text-purple-900 text-[11px] font-semibold active:scale-95" aria-expanded={showMap} data-testid="gate-map-toggle" title="Gambar alur dari awal sampai selesai, lengkap dengan cabang keputusan. Tidak memakai kuota data." onclick={() => (showMap = !showMap)}>
						🗺️ {showMap ? 'Sembunyikan Diagram Alur' : 'Lihat Diagram Alur'}
					</button>
					{#if showMap}
						<FlowMiniMap {flow} {steps} selected={openStep} onpick={jumpTo} />
					{/if}
				</div>

				{#if sum.gates > 0}
					<div class="flex flex-wrap gap-1.5 text-[10px]" aria-label="Arti tingkat gate">
						{#each Object.entries(MODE_META) as [k, m] (k)}
							<span class="px-1.5 py-0.5 rounded border {m.cls}" title={m.label}>{m.short}</span>
						{/each}
					</div>
					{#if loading}
						<p class="text-[11px] text-gray-400" role="status">Memuat syarat gate…</p>
					{:else if info && !info.available}
						<p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5" role="status" data-testid="gate-unavailable">
							📡 Detail syarat gate belum bisa dimuat sekarang — daftar gate tetap tampil. Coba lagi saat sinyal membaik.
						</p>
					{:else if info?.stale}
						<p class="text-[11px] text-amber-700" role="status" data-testid="gate-stale">📱 Menampilkan salinan terakhir di perangkat ini (mungkin bukan yang terbaru).</p>
					{:else if info?.partial}
						<p class="text-[11px] text-amber-700" role="status">Sebagian detail gate belum termuat.</p>
					{/if}
				{/if}

				<ol class="space-y-2">
					{#each steps as s (s.id)}
						<li id="gc-step-{s.id}" class="rounded-xl border {openStep === s.id ? 'border-purple-400 bg-purple-50/40' : 'border-gray-200 bg-white'} {fokus === s.id ? 'ring-2 ring-purple-300' : ''}">
							<button type="button" class="w-full flex items-center gap-2.5 px-3 py-2.5 text-left" aria-expanded={openStep === s.id} onclick={() => toggleStep(s.id)}>
								<span class="shrink-0 w-6 h-6 rounded-full bg-purple-100 text-purple-800 text-[11px] font-bold flex items-center justify-center" aria-hidden="true">{s.no}</span>
								<span class="flex-1 min-w-0">
									<span class="block text-sm font-semibold text-gray-800">{s.label}</span>
									{#if s.pic}<span class="block text-[10px] text-gray-500">👤 {s.pic}</span>{/if}
								</span>
								{#if s.isDecision}<span class="shrink-0 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">🔶 Keputusan</span>{/if}
								{#if s.gates.length}
									<span class="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border {modeMeta(s.strongest).cls}" title="Gate terketat di langkah ini">🛡️ {s.gates.length}{s.strongest ? ` · ${modeMeta(s.strongest).short}` : ''}</span>
								{/if}
							</button>

							{#if openStep === s.id}
								<div class="px-3 pb-3 space-y-2.5 text-xs text-gray-700">
									<dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
										{#if s.lane}<dt class="text-gray-500">Bagian</dt><dd class="font-medium">{s.lane}</dd>{/if}
										{#if s.pic}<dt class="text-gray-500">Dikerjakan oleh</dt><dd class="font-medium">{s.pic}</dd>{/if}
										{#if s.sla_hours}<dt class="text-gray-500">Target</dt><dd class="font-medium">⏱ {s.sla_hours} jam</dd>{/if}
									</dl>

									{#if s.branches.length}
										<div class="rounded-lg border {s.isDecision ? 'border-amber-300 bg-amber-50/60' : 'border-gray-200 bg-gray-50'} p-2.5 space-y-1.5" data-testid="step-branches">
											<p class="text-[11px] font-bold {s.isDecision ? 'text-amber-900' : 'text-gray-600'}">{s.isDecision ? '🔀 Cabang Keputusan — pilih sesuai kondisi Anda' : '➡️ Setelah langkah ini'}</p>
											<ul class="space-y-1">
												{#each s.branches as br (br.toId)}
													<li>
														<button type="button" class="w-full text-left text-[11px] rounded-lg border px-2.5 py-1.5 {br.backward ? 'border-orange-200 bg-orange-50 text-orange-900' : 'border-gray-200 bg-white text-gray-800'} {br.end ? 'cursor-default' : 'active:scale-[0.99]'}" disabled={br.end} data-testid="branch-item" onclick={() => jumpTo(br.toId)}>
															{br.backward ? '↩ ' : ''}{branchSentence(br)}
														</button>
													</li>
												{/each}
											</ul>
										</div>
									{/if}

									{#if s.fieldActions.length}
										<div class="flex flex-wrap gap-1.5">
											{#each s.fieldActions as a (a.href)}
												<a href={a.href} class="px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-semibold active:scale-95">📝 {a.label}</a>
											{/each}
										</div>
									{/if}

									{#if s.gates.length === 0}
										<p class="text-[11px] text-gray-500">Langkah ini tidak dijaga gate — tidak ada syarat sistem khusus.</p>
									{/if}

									{#each s.gates as g (g.key)}
										<div class="rounded-lg border border-purple-200 bg-white p-2.5 space-y-1.5" data-testid="gate-item">
											<div class="flex items-start justify-between gap-2">
												<p class="font-semibold text-purple-950 leading-snug">{g.info?.nama || g.key}</p>
												{#if g.info}<span class="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border {modeMeta(g.info.mode).cls}">{modeMeta(g.info.mode).label}</span>{/if}
											</div>
											<p class="font-mono text-[10px] text-gray-400">{g.key}</p>
											{#if g.info?.message}<p class="text-[11px] text-rose-800 bg-rose-50 border border-rose-100 rounded px-2 py-1">⚠️ Jika tidak lolos: {g.info.message}</p>{/if}
											{#if g.info?.hint}<p class="text-[11px] text-emerald-900 bg-emerald-50 border border-emerald-100 rounded px-2 py-1">💡 Cara lolos: {g.info.hint}</p>{/if}
											{#if isPrepGate(g.info)}
												{@const pr = prepProgress(g.key, g.info, prep)}
												<div class="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 space-y-1.5" data-testid="gate-prep">
													<div class="flex items-center justify-between gap-2">
														<p class="text-[11px] font-bold text-emerald-900">✅ Cek dulu sebelum mengajukan <span class="font-normal text-emerald-800">({pr.done}/{pr.total} siap)</span></p>
														{#if pr.done > 0}<button type="button" class="text-[10px] text-gray-500 underline" data-testid="gate-prep-reset" onclick={() => resetPrep(g.key, g.info!.checklist.map((c) => c.label))}>Reset</button>{/if}
													</div>
													<ul class="space-y-1">
														{#each g.info.checklist as c (c.label)}
															<li>
																<label class="flex items-start gap-2 text-[11px] py-0.5">
																	<input type="checkbox" class="mt-0.5 w-4 h-4 shrink-0 accent-emerald-600" checked={prep.has(prepItemKey(g.key, c.label))} data-testid="gate-prep-item" onchange={() => togglePrep(g.key, c.label)} />
																	<span>{c.label}{#if !c.wajib} <span class="text-gray-400">(opsional)</span>{:else} <span class="text-rose-600 font-semibold">*</span>{/if}{#if c.tips}<span class="block text-[10px] text-gray-500">{c.tips}</span>{/if}</span>
																</label>
															</li>
														{/each}
													</ul>
													{#if pr.ready}
														<p class="text-[11px] font-semibold text-emerald-800" role="status" data-testid="gate-prep-ready">🎉 Semua syarat wajib sudah Anda siapkan — silakan lanjut ke formulir.</p>
													{:else if pr.wajibTotal > pr.wajibDone}
														<p class="text-[10px] text-gray-600">Masih {pr.wajibTotal - pr.wajibDone} syarat wajib (<span class="text-rose-600 font-semibold">*</span>) belum dicentang.</p>
													{/if}
													<p class="text-[10px] text-gray-400">Pengingat pribadi di HP ini — tidak dikirim ke server. Sistem tetap memeriksa saat Anda mengajukan.</p>
												</div>
											{:else if g.info?.checklist.length}
												<ul class="space-y-0.5">
													{#each g.info.checklist as c (c.label)}
														<li class="flex items-start gap-1.5 text-[11px]"><span class="text-emerald-600 font-bold shrink-0">☑</span><span>{c.label}{#if !c.wajib} <span class="text-gray-400">(opsional)</span>{/if}{#if c.tips}<span class="block text-[10px] text-gray-500">{c.tips}</span>{/if}</span></li>
													{/each}
												</ul>
											{/if}
											{#if g.info?.owner_role}<p class="text-[10px] text-gray-500">👥 Diperiksa / ditangani: {g.info.owner_role}</p>{/if}
											{#if g.info?.bypass}<p class="text-[10px] text-gray-500">🔓 Jika terpaksa: {bypassLabel[g.info.bypass] ?? g.info.bypass}</p>{/if}
											{#if !g.info && !loading}<p class="text-[10px] text-gray-400">Detail syarat belum tersedia{info && !info.available ? ' (offline)' : ''}.</p>{/if}
										</div>
									{/each}
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			</div>
		{/if}
	</section>
{/if}
