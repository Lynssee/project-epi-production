<!-- src/lib/components/project/PaStatusCard.svelte -->
<!-- Fase 5 (audit hidden cost #1051 & penajaman birokrasi, 21 Okt 2026):
     Antrean birokrasi lengkap untuk Project Leader:
     (a) Packing List Draft (belum diajukan) & In-Flight (requested/approved belum full SJ)
     (b) Pengajuan Anggaran (PA) yang MENUNGGU persetujuan
     (c) Pembelian Lokal Proyek & Klaim Reimbursement (BBM/Tol)
     (d) Alat pinjaman yang MENGANGGUR
     ⚠️ TANPA nominal rupiah (kebijakan kerahasiaan pagu HPP di lapangan).
     Gagal memuat TIDAK disamarkan sebagai "aman": ditampilkan pesan + tombol coba lagi. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { loadPaStatus, remindApprover, loadIdleLoans, type PaStatusResponse } from '$lib/services/paStatusLapangan';
	import { umurText, type PaLevel, type BirokrasiChannel } from '$lib/utils/paStatusLapangan';
	import type { IdleLoan } from '$lib/utils/idleLoans';
	import {
		IconClockExclamation,
		IconBell,
		IconTools,
		IconRefresh,
		IconLoader2,
		IconPackage,
		IconReceipt2,
		IconShoppingCart,
		IconGasStation,
		IconAlertTriangle,
		IconArrowRight,
		IconChevronRight
	} from '@tabler/icons-svelte';

	let { projectId }: { projectId: number | string } = $props();

	let loading = $state(true);
	let pa = $state<PaStatusResponse | null>(null);
	let paError = $state('');
	let idle = $state<IdleLoan[]>([]);
	let idleDays = $state(0);
	let idleError = $state('');
	let remindingId = $state<string | null>(null);
	let remindMsg = $state<Record<string, string>>({});
	let activeChannelFilter = $state<string>('all');

	const LEVEL: Record<PaLevel, { dot: string; text: string; label: string }> = {
		red: { dot: 'bg-red-500', text: 'text-red-700', label: 'Melewati SLA' },
		yellow: { dot: 'bg-amber-400', text: 'text-amber-700', label: 'Mendekati SLA' },
		green: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Dalam SLA' },
		unknown: { dot: 'bg-gray-300', text: 'text-gray-500', label: 'Umur tidak diketahui' }
	};

	async function refresh() {
		loading = true;
		paError = '';
		idleError = '';
		const pid = Number(projectId);
		const [paRes, idleRes] = await Promise.allSettled([loadPaStatus(pid), loadIdleLoans(pid)]);
		if (paRes.status === 'fulfilled') pa = paRes.value;
		else {
			console.error('Gagal memuat status birokrasi proyek:', paRes.reason);
			pa = null;
			paError = 'Antrean birokrasi & status pengajuan gagal dimuat.';
		}
		if (idleRes.status === 'fulfilled') {
			idle = idleRes.value.idle;
			idleDays = idleRes.value.idleDays;
			idleError = idleRes.value.error || '';
		} else {
			idle = [];
			idleError = 'Data alat menganggur gagal dimuat.';
		}
		loading = false;
	}

	async function remind(requestId: string | null) {
		if (!requestId || remindingId) return;
		remindingId = requestId;
		try {
			const r = await remindApprover(requestId);
			remindMsg = { ...remindMsg, [requestId]: r.message || (r.success ? 'Approver sudah diingatkan via WA.' : 'Belum bisa mengingatkan approver.') };
		} catch (e) {
			console.error('Gagal mengingatkan approver:', e);
			remindMsg = { ...remindMsg, [requestId]: 'Gagal mengingatkan — coba lagi.' };
		} finally {
			remindingId = null;
		}
	}

	let filteredBirokrasi = $derived.by(() => {
		const all = pa?.birokrasi_items || [];
		if (activeChannelFilter === 'all') return all;
		if (activeChannelFilter === 'packing_list') return all.filter((i) => i.channel === 'packing_list_draft' || i.channel === 'packing_list_in_flight');
		if (activeChannelFilter === 'pa') return all.filter((i) => i.channel === 'pa_pending');
		if (activeChannelFilter === 'local_purchase') return all.filter((i) => i.channel === 'pembelian_lokal' || i.channel === 'klaim_reimbursement');
		return all;
	});

	let hasFindings = $derived(
		(pa?.summary?.total_birokrasi_count ?? 0) > 0 || idle.length > 0 || !!paError || !!idleError
	);

	onMount(() => {
		refresh();
	});
</script>

{#if !loading && hasFindings}
	<div class="px-4 pt-3" data-testid="pa-status-card">
		<!-- 1. ALERT BANNER: NUDGE PACKING LIST DRAFT TERTUNDA > 24 JAM -->
		{#if pa?.summary && pa.summary.draft_pl_stale_count > 0}
			<div class="mb-3 rounded-xl border border-amber-400 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/5 p-3.5 shadow-sm text-amber-950 dark:text-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
				<div class="flex items-start gap-2.5">
					<div class="p-2 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5">
						<IconAlertTriangle size={18} />
					</div>
					<div>
						<div class="font-bold text-[13px] text-amber-900 dark:text-amber-200">
							Tindakan Segera: {pa.summary.draft_pl_stale_count} Item Packing List Masih Berstatus Draft (&gt; 24 Jam)
						</div>
						<p class="text-[12px] text-amber-800 dark:text-amber-300/90 mt-0.5 leading-relaxed">
							Barang belum dapat dipersiapkan atau dikirim oleh Gudang sebelum Anda mengajukannya. Segera tinjau dan kirim pengajuan logistik proyek Anda.
						</p>
					</div>
				</div>
				<a
					href="/packing-list/{projectId}"
					class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shadow-xs transition-colors"
				>
					<IconPackage size={14} />
					Buka &amp; Ajukan PL
					<IconArrowRight size={13} />
				</a>
			</div>
		{/if}

		<!-- 2. KARTU UTAMA ANTREAN BIROKRASI -->
		<div class="rounded-xl border {pa && pa.summary.total_overdue_count > 0 ? 'border-red-300 bg-red-50/70 dark:bg-red-950/20' : 'border-amber-300 bg-amber-50/80 dark:bg-amber-950/20'} p-3.5 shadow-xs text-[12px] space-y-3">
			<div class="flex items-start justify-between gap-2">
				<div class="flex items-start gap-2.5">
					<div class="mt-0.5 rounded-lg bg-white/80 dark:bg-slate-800 p-1.5 text-amber-700 dark:text-amber-400 shrink-0 shadow-2xs">
						<IconClockExclamation size={18} />
					</div>
					<div>
						<h3 class="font-bold text-[13px] text-gray-900 dark:text-gray-100">Antrean Birokrasi &amp; Komitmen Tertahan</h3>
						<p class="mt-0.5 text-gray-600 dark:text-gray-400 leading-relaxed text-[11px]">
							Pantau pengajuan anggaran, draft packing list, dan belanja lokal yang masih dalam proses.
							Lampu: hijau (&lt; 50% SLA), kuning (50–100%), merah (melewati batas waktu).
						</p>
					</div>
				</div>
				<button class="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 p-1 shrink-0" title="Segarkan" onclick={refresh}>
					<IconRefresh size={14} />
				</button>
			</div>

			<!-- Filter Chips -->
			{#if pa && pa.summary.total_birokrasi_count > 0}
				<div class="flex flex-wrap gap-1.5 pt-1">
					<button
						class="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors {activeChannelFilter === 'all' ? 'bg-amber-700 text-white shadow-2xs' : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50'}"
						onclick={() => (activeChannelFilter = 'all')}
					>
						Semua Antrean ({pa.summary.total_birokrasi_count})
					</button>
					{#if pa.summary.draft_pl_count > 0 || pa.summary.in_flight_pl_count > 0}
						<button
							class="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors {activeChannelFilter === 'packing_list' ? 'bg-amber-700 text-white shadow-2xs' : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50'}"
							onclick={() => (activeChannelFilter = 'packing_list')}
						>
							📦 Packing List ({pa.summary.draft_pl_count} Draft, {pa.summary.in_flight_pl_count} Proses)
						</button>
					{/if}
					{#if pa.summary.pa_pending_count > 0}
						<button
							class="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors {activeChannelFilter === 'pa' ? 'bg-amber-700 text-white shadow-2xs' : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50'}"
							onclick={() => (activeChannelFilter = 'pa')}
						>
							💳 PA Pending ({pa.summary.pa_pending_count})
						</button>
					{/if}
					{#if pa.summary.pembelian_lokal_count > 0 || pa.summary.reimbursement_count > 0}
						<button
							class="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors {activeChannelFilter === 'local_purchase' ? 'bg-amber-700 text-white shadow-2xs' : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50'}"
							onclick={() => (activeChannelFilter = 'local_purchase')}
						>
							🛒 Belanja/Klaim ({pa.summary.pembelian_lokal_count + pa.summary.reimbursement_count})
						</button>
					{/if}
				</div>
			{/if}

			{#if paError}
				<div class="text-red-700 dark:text-red-400" data-testid="pa-status-error">
					{paError} <button class="underline font-semibold" onclick={refresh}>Coba lagi</button>
				</div>
			{:else if filteredBirokrasi.length > 0}
				<div>
					{#if pa && pa.summary.total_overdue_count > 0}
						<div class="text-red-700 dark:text-red-400 font-bold mb-1.5" data-testid="pa-status-overdue">
							• {pa.summary.total_overdue_count} antrean sudah melewati SLA
						</div>
					{/if}
					{#each pa.warnings as w}
						<div class="text-amber-700 dark:text-amber-400 text-[11px]">⚠ {w}</div>
					{/each}

					<div class="space-y-1.5 mt-2">
						{#each filteredBirokrasi as it (it.id)}
							<div class="rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 p-2.5 shadow-2xs" data-testid="birokrasi-item">
								<div class="flex items-start gap-2.5">
									<!-- Dot status -->
									<span class="mt-1 w-2.5 h-2.5 rounded-full shrink-0 {LEVEL[it.level].dot}" title={LEVEL[it.level].label} data-testid="pa-dot-{it.level}"></span>

									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-1.5 flex-wrap">
											<!-- Channel badge -->
											{#if it.channel === 'packing_list_draft'}
												<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
													PL DRAFT
												</span>
											{:else if it.channel === 'packing_list_in_flight'}
												<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300">
													PL GUDANG
												</span>
											{:else if it.channel === 'pa_pending'}
												<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300">
													PA PENDING
												</span>
											{:else if it.channel === 'pembelian_lokal'}
												<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300">
													BELI LOKAL
												</span>
											{:else if it.channel === 'klaim_reimbursement'}
												<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300">
													REIMBURSE
												</span>
											{/if}

											<span class="font-mono font-bold text-gray-900 dark:text-gray-100 text-[11px]">{it.nomor}</span>
											{#if it.qty != null}
												<span class="text-gray-600 dark:text-gray-400 text-[11px]">({it.qty} {it.unit || 'item'})</span>
											{/if}
										</div>

										<div class="text-gray-700 dark:text-gray-300 font-medium truncate mt-0.5">{it.judul || '—'}</div>

										<div class="{LEVEL[it.level].text} font-semibold mt-0.5 text-[11px]">
											{LEVEL[it.level].label} • {it.status_label}
											{#if it.approver_nama}
												<span class="text-gray-500 dark:text-gray-400 font-normal">({it.approver_nama})</span>
											{/if}
										</div>

										<div class="text-gray-500 dark:text-gray-400 text-[10px] mt-0.5">
											Menunggu {umurText(it.umur_jam)} • batas SLA {it.sla_jam} jam
											{#if it.melewati_sla_jam}
												<span class="text-red-600 dark:text-red-400 font-semibold">• lewat {umurText(it.melewati_sla_jam)}</span>
											{/if}
										</div>

										{#if it.is_stale_draft}
											<div class="text-amber-700 dark:text-amber-300 font-semibold mt-0.5 text-[10px]">
												⚠ Draft belum diajukan &gt; 24 jam. Logistik belum dapat memproses barang ini.
											</div>
										{/if}

										{#if it.request_id && remindMsg[it.request_id]}
											<div class="text-gray-700 dark:text-gray-300 mt-0.5 text-[10px]" data-testid="pa-remind-msg">
												{remindMsg[it.request_id]}
											</div>
										{/if}
									</div>

									<!-- Action Buttons -->
									<div class="shrink-0 flex items-center gap-1.5">
										{#if it.channel === 'packing_list_draft'}
											<a
												href="/packing-list/{projectId}"
												class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold text-[11px] shadow-2xs"
												title="Buka packing list untuk diajukan"
											>
												<IconPackage size={13} />
												Ajukan
											</a>
										{:else if it.channel === 'pa_pending'}
											<button
												class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold text-[11px] hover:bg-indigo-100 disabled:opacity-50"
												disabled={!it.request_id || remindingId === it.request_id}
												title="Kirim pengingat WA ke approver (maksimal 1x per 24 jam setelah melewati SLA)."
												data-testid="pa-remind"
												onclick={() => remind(it.request_id || null)}
											>
												{#if remindingId === it.request_id}
													<IconLoader2 size={13} class="animate-spin" />
												{:else}
													<IconBell size={13} />
												{/if}
												Ingatkan
											</button>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- 3. ALAT MENGANGGUR -->
			{#if idleError}
				<div class="text-amber-700 dark:text-amber-400" data-testid="idle-error">{idleError}</div>
			{:else if idle.length > 0}
				<div class={filteredBirokrasi.length > 0 ? 'pt-2.5 border-t border-amber-200 dark:border-gray-700' : ''}>
					<div class="font-bold text-gray-800 dark:text-gray-200 mb-1.5 flex items-center gap-1.5 text-[12px]">
						<IconTools size={14} class="text-amber-600 dark:text-amber-400" />
						Alat menganggur &ge; {idleDays} hari: {idle.length} unit
					</div>
					<ul class="space-y-1">
						{#each idle as a (a.loan_id)}
							<li class="rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 text-[11px]" data-testid="idle-item">
								<span class="font-semibold text-gray-900 dark:text-gray-100">{a.name}</span>
								{#if a.code}<span class="text-gray-500"> ({a.code})</span>{/if}
								<span class="text-red-700 dark:text-red-400 font-semibold"> • tidak terpakai {a.idle_days} hari</span>
								<span class="text-gray-500">{a.basis === 'laporan_terakhir' ? ` (terakhir di laporan ${a.last_used})` : ' (tidak pernah disebut di laporan sejak dipinjam)'}</span>
							</li>
						{/each}
					</ul>
					<p class="mt-1.5 text-gray-600 dark:text-gray-400 text-[10px]">
						Bila alat sudah tidak dipakai di site, ajukan pengembalian ke gudang agar tidak membebani akrual sewa harian proyek.
					</p>
				</div>
			{/if}
		</div>
	</div>
{/if}
