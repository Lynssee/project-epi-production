<script lang="ts">
	// Indikator Safe-Spend + chip "dana tertahan di pusat" untuk Project Leader.
	// Indikator = PERSEN saja. Daftar NAMA item tertahan (Fase 3b, keputusan Lead 22 Okt 2026) boleh dilihat Leader, TANPA rupiah, dan dimuat
	// hanya saat dibuka. Sumber: /api/project-finance-pct
	// (cache 60 dtk, dipakai bersama halaman ringkasan & form pengajuan → tidak menambah panggilan sendiri). Informasi, BUKAN pemblokir.
	import { fetchFieldBudgetPct, fetchFieldPendingItems, pingApprover, type FieldBudgetPct, type FieldPendingItems } from '$lib/services/projectFinancePct';
	import { buildSafeSpendView, formatPendingAge, groupPendingItems, describePingResult, type PingFeedback } from '$lib/utils/fieldSafeSpend';
	import { loadProjectSettings, getProjectSetting } from '$lib/services/projectSettings';
	import { IconShieldCheck, IconClockPause, IconAlertTriangle, IconLock, IconHelpCircle, IconInfoCircle, IconChevronDown, IconLoader2, IconBellRinging } from '@tabler/icons-svelte';

	let { projectId } = $props<{ projectId: number | string | null | undefined }>();

	let pagu = $state<FieldBudgetPct | null>(null);
	let showHint = $state(false);
	let enabled = $state(true);

	// Daftar nama item tertahan (Fase 3b) — dimuat HANYA saat dibuka; tanpa rupiah.
	let showItems = $state(false);
	let itemsLoading = $state(false);
	let pending = $state<FieldPendingItems | null>(null);
	let itemsFailed = $state(false);

	// Pengingat approver (Fase 5): status per PA. lock = tombol nonaktif (sudah terkirim / cooldown / tak berlaku); gagal teknis tidak mengunci.
	let pingState = $state<Record<number, { sending: boolean; lock: boolean; feedback: PingFeedback | null }>>({});

	async function sendPing(paId: number | null | undefined) {
		const pid = Number(projectId);
		if (!paId || !pid || pingState[paId]?.sending) return;
		pingState[paId] = { sending: true, lock: false, feedback: null };
		const result = await pingApprover(pid, paId);
		if (Number(projectId) !== pid) return; // proyek berganti selagi menunggu
		const feedback = describePingResult(result);
		pingState[paId] = { sending: false, lock: feedback.lock, feedback };
	}

	async function toggleItems() {
		showItems = !showItems;
		if (!showItems || pending || itemsLoading) return;
		const pid = Number(projectId);
		itemsLoading = true;
		itemsFailed = false;
		const r = await fetchFieldPendingItems(pid);
		if (Number(projectId) === pid) {
			pending = r;
			itemsFailed = r === null;
		}
		itemsLoading = false;
	}

	loadProjectSettings().then(() => {
		enabled = getProjectSetting('project.field_finance.show_unrealized') !== false;
	});

	$effect(() => {
		const pid = projectId ? Number(projectId) : null;
		pagu = null;
		pending = null;
		showItems = false;
		itemsFailed = false;
		pingState = {};
		if (!pid) return;
		fetchFieldBudgetPct(pid).then((r) => {
			if (Number(projectId) === pid) pagu = r;
		});
	});

	let view = $derived(enabled ? buildSafeSpendView(pagu) : null);
	let canShowNames = $derived(!!pagu?.unrealized?.names_enabled && (pagu?.unrealized?.item_count ?? 0) > 0);
	let groups = $derived(groupPendingItems(pending?.items));

	const TONE: Record<string, { box: string; badge: string; text: string }> = {
		ok: { box: 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30', badge: 'bg-emerald-600 text-white', text: 'text-emerald-800 dark:text-emerald-200' },
		warn: { box: 'border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30', badge: 'bg-amber-500 text-white', text: 'text-amber-800 dark:text-amber-200' },
		danger: { box: 'border-rose-300 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/30', badge: 'bg-rose-600 text-white', text: 'text-rose-800 dark:text-rose-200' },
		neutral: { box: 'border-gray-200 dark:border-[#2B3844] bg-gray-50 dark:bg-[#121A22]', badge: 'bg-gray-500 text-white', text: 'text-gray-700 dark:text-gray-300' }
	};
</script>

{#if view}
	{@const t = TONE[view.tone]}
	<div class="rounded-xl border p-3.5 flex items-start gap-3 {t.box}" data-testid="field-safe-spend" role="status">
		<div class="shrink-0 mt-0.5 {t.text}">
			{#if view.state === 'safe'}<IconShieldCheck size={20} />
			{:else if view.state === 'held'}<IconClockPause size={20} />
			{:else if view.state === 'locked'}<IconLock size={20} />
			{:else if view.state === 'unknown'}<IconInfoCircle size={20} />
			{:else}<IconAlertTriangle size={20} />{/if}
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2 flex-wrap">
				<span class="text-[11px] font-bold px-2 py-0.5 rounded-full {t.badge}" data-testid="field-safe-spend-label">{view.label}</span>
				<span class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Safe-Spend</span>
				<button
					type="button"
					class="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5"
					aria-label="Apa arti status ini?"
					aria-expanded={showHint}
					title="Apa arti status ini?"
					onclick={() => (showHint = !showHint)}
				>
					<IconHelpCircle size={16} />
				</button>
			</div>
			<p class="text-xs mt-1 {t.text}">{view.message}</p>
			{#if view.detail}
				<p class="text-[11px] mt-0.5 text-gray-500 dark:text-gray-400">{view.detail}</p>
			{/if}
			{#if canShowNames}
				<button
					type="button"
					class="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
					aria-expanded={showItems}
					aria-controls="field-pending-items"
					title="Lihat dokumen apa saja yang masih tertahan di kantor pusat (tanpa nominal)"
					data-testid="field-pending-toggle"
					onclick={toggleItems}
				>
					{showItems ? 'Sembunyikan' : 'Lihat'} daftar item tertahan ({pagu?.unrealized?.item_count})
					<span class="transition-transform {showItems ? 'rotate-180' : ''}"><IconChevronDown size={13} /></span>
				</button>
				{#if showItems}
					<div id="field-pending-items" class="mt-2 border-t border-black/5 dark:border-white/10 pt-2" data-testid="field-pending-list">
						{#if itemsLoading}
							<p class="text-[11px] text-gray-500 flex items-center gap-1.5"><IconLoader2 size={13} class="animate-spin" /> Memuat daftar…</p>
						{:else if itemsFailed}
							<p class="text-[11px] text-rose-600" role="alert">Daftar item tidak dapat dimuat saat ini. Persen di atas tetap berlaku; coba lagi nanti.</p>
						{:else if pending && !pending.enabled}
							<p class="text-[11px] text-gray-500">Daftar nama item dinonaktifkan oleh Admin. Hubungi Admin/PM untuk rinciannya.</p>
						{:else if pending}
							{#each [['birokrasi', 'Sedang diproses di pusat', groups.birokrasi], ['pipeline', 'Belum diajukan / belum dibukukan', groups.pipeline]] as [key, title, list] (key)}
								{#if list.length > 0}
									<p class="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-1.5 mb-1">{title} ({list.length})</p>
									<ul class="flex flex-col gap-1.5">
										{#each list as it (it.id)}
											<li class="rounded-lg bg-white/70 dark:bg-black/20 border border-black/5 dark:border-white/10 px-2.5 py-1.5">
												<div class="flex items-start justify-between gap-2">
													<div class="min-w-0">
														<p class="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{it.nomor_dokumen || it.judul}</p>
														{#if it.nomor_dokumen && it.judul && it.judul !== it.nomor_dokumen}
															<p class="text-[11px] text-gray-600 dark:text-gray-300 truncate">{it.judul}</p>
														{/if}
													</div>
													<span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#232F3B] text-gray-600 dark:text-gray-300">{it.channel_label}</span>
												</div>
												<p class="text-[11px] mt-0.5 {it.overdue ? 'text-rose-700 dark:text-rose-300 font-medium' : 'text-gray-500 dark:text-gray-400'}">
													{it.status_label}{#if it.tahap && it.tahap !== it.status_label} · {it.tahap}{/if}{#if it.approver} · menunggu {it.approver}{/if}
													· {formatPendingAge(it.age_hours)}{#if it.overdue} · lewat SLA{/if}{#if it.qty_label} · {it.qty_label}{/if}
												</p>
												{#if it.pingable && it.ref_id}
													{@const ps = pingState[it.ref_id]}
													<div class="mt-1.5 flex items-center gap-2 flex-wrap">
														<button
															type="button"
															class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
															title="Kirim pengingat ke approver yang sedang giliran menyetujui pengajuan ini. Sekali per beberapa jam agar tidak mengganggu."
															disabled={ps?.sending || ps?.lock}
															data-testid={'field-ping-' + it.ref_id}
															onclick={() => sendPing(it.ref_id)}
														>
															{#if ps?.sending}<IconLoader2 size={12} class="animate-spin" /> Mengirim…{:else}<IconBellRinging size={12} /> Ingatkan approver{/if}
														</button>
														{#if ps?.feedback}
															<span
																class="text-[11px] {ps.feedback.tone === 'success' ? 'text-emerald-700 dark:text-emerald-300' : ps.feedback.tone === 'error' ? 'text-rose-700 dark:text-rose-300' : 'text-gray-500 dark:text-gray-400'}"
																role={ps.feedback.tone === 'error' ? 'alert' : 'status'}
																data-testid={'field-ping-msg-' + it.ref_id}
															>{ps.feedback.text}</span>
														{/if}
													</div>
												{/if}
											</li>
										{/each}
									</ul>
								{/if}
							{/each}
							{#if pending.truncated}
								<p class="text-[11px] text-gray-500 mt-1.5">+{pending.total - pending.items.length} item lainnya (hubungi Admin untuk daftar lengkap).</p>
							{/if}
							{#if pending.items.length === 0}
								<p class="text-[11px] text-gray-500">Tidak ada item tertahan saat ini.</p>
							{/if}
							<p class="text-[10px] text-gray-400 mt-1.5">Nominal rupiah item tidak ditampilkan.</p>
						{/if}
					</div>
				{/if}
			{/if}
			{#if showHint}
				<p class="text-[11px] mt-1.5 text-gray-600 dark:text-gray-300 border-t border-black/5 dark:border-white/10 pt-1.5">{view.hint}</p>
			{/if}
		</div>
	</div>
{/if}
