<!-- src/lib/components/project/KendaliHarianCard.svelte
     Fase 4 (Penajaman KPI & Drilldown Detail Dept) — Kartu Kendali Harian Project Leader (mobile-first, satu panggilan API).
     Tiga bagian yang BELUM ada di cockpit: (1) kalender kepatuhan Laporan Harian per tanggal, (2) umur LPJ kasbon/uang muka yang
     belum masuk, (3) deviasi progres vs target Kurva S minggu berjalan. Pagu RAP (Safe-Spend/BEP/Ringkasan) sengaja TIDAK diulang.
     TANPA nominal rupiah. Hanya penanda & jalan pintas: tidak memblokir apa pun. Gagal memuat TIDAK disamarkan sebagai aman. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { loadKendaliHarian, type KendaliHarianRaw } from '$lib/services/kendaliHarianApi';
	import { buildComplianceCalendar, buildLpjAging, buildWeeklyDeviation, type CalendarCellStatus } from '$lib/utils/kendaliHarian';

	let { projectId }: { projectId: number | string } = $props();

	let loading = $state(true);
	let raw = $state<KendaliHarianRaw | null>(null);
	let errorMsg = $state('');
	let hidden = $state(false);
	let showAllLpj = $state(false);

	const LPJ_PREVIEW = 4;

	let ready = $derived(raw && raw.applicable ? raw : null);

	let calendar = $derived(
		ready && ready.show.calendar && ready.reportDates
			? buildComplianceCalendar({
					todayYmd: ready.today,
					windowDays: ready.calendarDays,
					startYmd: ready.startYmd,
					offWeekdays: ready.offWeekdays,
					reportDates: ready.reportDates
				})
			: null
	);
	let lpj = $derived(ready && ready.show.lpj && ready.lpj ? buildLpjAging(ready.lpj, ready.today, ready.lpjGraceDays) : null);
	let weekly = $derived(
		ready && ready.show.scurve && ready.scurve
			? buildWeeklyDeviation({
					baseline: ready.scurve.baseline,
					actual: ready.scurve.actual,
					hasSubtasks: ready.scurve.hasSubtasks,
					todayYmd: ready.today,
					offWeekdays: ready.offWeekdays,
					tolerancePct: ready.scurve.tolerancePct
				})
			: null
	);

	const CELL: Record<CalendarCellStatus, string> = {
		reported: 'background:#16a34a;color:#fff;',
		missed: 'background:#dc2626;color:#fff;',
		off: 'background:#e5e7eb;color:#6b7280;',
		today_pending: 'background:#fbbf24;color:#78350f;',
		pad: 'background:transparent;'
	};
	const CELL_LABEL: Record<CalendarCellStatus, string> = {
		reported: 'sudah lapor',
		missed: 'bolong',
		off: 'libur mingguan',
		today_pending: 'hari ini, belum lapor',
		pad: ''
	};
	const LEVEL_CHIP: Record<string, string> = {
		ok: 'background:#f0fdf4;color:#166534;border-color:#bbf7d0;',
		warn: 'background:#fffbeb;color:#92400e;border-color:#fde68a;',
		bad: 'background:#fef2f2;color:#991b1b;border-color:#fecaca;'
	};
	const TONE_CHIP: Record<string, string> = {
		ahead: LEVEL_CHIP.ok,
		ontrack: 'background:#eff6ff;color:#1e40af;border-color:#bfdbfe;',
		behind: LEVEL_CHIP.bad,
		na: 'background:#f9fafb;color:#6b7280;border-color:#e5e7eb;'
	};

	const fmtPct = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
	const fmtPts = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })} poin`);
	function shortDate(ymd: string): string {
		if (!ymd) return '';
		const d = new Date(`${ymd}T00:00:00Z`);
		return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
	}

	async function refresh(force = false) {
		loading = true;
		errorMsg = '';
		try {
			raw = await loadKendaliHarian(projectId, force);
		} catch (e: any) {
			console.error('Gagal memuat kartu kendali harian:', e);
			raw = null;
			// 403 = bukan pemegang proyek: kartu birokrasi sudah menjelaskan, jangan dobel pesan.
			if (e?.status === 403) hidden = true;
			else errorMsg = 'Kartu kendali harian belum dapat dimuat.';
		} finally {
			loading = false;
		}
	}

	onMount(() => refresh());
</script>

{#if !hidden && !loading && (errorMsg || ready)}
	<div class="px-4 pt-3" data-testid="kendali-harian-card">
		{#if errorMsg}
			<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center justify-between gap-2" data-testid="kendali-harian-error">
				<span>{errorMsg}</span>
				<button class="font-bold underline" onclick={() => refresh(true)}>Coba lagi</button>
			</div>
		{:else if ready}
			<div class="rounded-2xl border p-3.5 shadow-sm flex flex-col gap-4" style="border-color:var(--sys-sep, #e5e7eb); background:var(--card-bg, #fff);">
				<div>
					<p class="text-[13px] font-bold" style="color:var(--sys-label, #111827)">
						🧭 Kendali Harian Proyek
						<Tooltip position="bottom" text="Tiga pantauan harian untuk Leader: (1) hari mana saja laporan harian bolong, (2) kasbon/uang muka yang belum di-LPJ, (3) progres minggu ini dibanding target Kurva S. Hanya penanda & jalan pintas — tidak memblokir pekerjaan. Sisa pagu RAP ada di kartu Safe-Spend di atas.">
							<span aria-label="Penjelasan kartu" role="img">ⓘ</span>
						</Tooltip>
					</p>
					<p class="text-[11px]" style="color:var(--sys-label3, #6b7280)">Cek 30 detik tiap pagi: tutup yang merah, kejar yang tertinggal.</p>
				</div>

				<!-- 1. Kalender kepatuhan Laporan Harian -->
				{#if ready.show.calendar}
					<section data-testid="kendali-calendar" aria-label="Kalender kepatuhan laporan harian">
						<div class="flex items-center justify-between gap-2">
							<p class="text-[12px] font-bold" style="color:var(--sys-label, #111827)">
								📅 Kepatuhan Laporan Harian
								<Tooltip position="bottom" text={`Hijau = ada laporan pada tanggal itu, merah = hari kerja yang bolong, abu = libur mingguan, kuning = hari ini belum lapor (belum dihitung bolong). Rentang ${ready.calendarDays} hari terakhir atau sejak proyek mulai. Atur jendela & hari libur di Settings > Project Management.`}>
									<span role="img" aria-label="Arti warna kalender">ⓘ</span>
								</Tooltip>
							</p>
							{#if calendar?.pct != null}
								<span class="text-[11px] font-bold px-2 py-0.5 rounded-full border" style={LEVEL_CHIP[calendar.pct >= 90 ? 'ok' : calendar.pct >= 60 ? 'warn' : 'bad']} data-testid="kendali-calendar-pct">{calendar.pct}%</span>
							{/if}
						</div>
						{#if ready.reportsFailed || !calendar}
							<p class="text-[11px] mt-1" style="color:var(--sys-label3, #6b7280)" data-testid="kendali-calendar-na">
								{ready.reportsFailed ? 'Data laporan belum dapat dimuat — coba muat ulang.' : 'Belum ada hari kerja yang bisa dinilai (proyek baru mulai).'}
							</p>
						{:else}
							<div class="mt-2 grid grid-cols-7 gap-1 max-w-[300px]" role="grid">
								{#each ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'] as h}
									<span class="text-[9px] text-center font-semibold" style="color:var(--sys-label3, #6b7280)">{h}</span>
								{/each}
								{#each calendar.weeks as week}
									{#each week as cell}
										{#if cell.status === 'pad'}
											<span aria-hidden="true"></span>
										{:else}
											<span
												class="h-7 rounded-md text-[10px] font-semibold flex items-center justify-center"
												style={CELL[cell.status]}
												role="gridcell"
												aria-label={`${shortDate(cell.date)}: ${CELL_LABEL[cell.status]}`}
												data-status={cell.status}
											>{cell.day}</span>
										{/if}
									{/each}
								{/each}
							</div>
							<p class="mt-1.5 text-[11px]" style="color:var(--sys-label2, #374151)">
								{calendar.reported} dari {calendar.required} hari kerja terlapor
								{#if calendar.currentStreak > 0} · berturut-turut terbaru {calendar.currentStreak} hari{/if}
								{#if calendar.longestMissRun > 1} · bolong terpanjang {calendar.longestMissRun} hari{/if}
							</p>
							{#if calendar.missedDates.length > 0}
								<div class="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="kendali-missed">
									<span class="text-[11px] font-semibold text-red-700">Bolong:</span>
									{#each calendar.missedDates.slice(-6) as d}
										<span class="text-[10px] px-1.5 py-0.5 rounded border" style={LEVEL_CHIP.bad}>{shortDate(d)}</span>
									{/each}
									{#if calendar.missedDates.length > 6}<span class="text-[10px]" style="color:var(--sys-label3, #6b7280)">+{calendar.missedDates.length - 6} lebih awal</span>{/if}
								</div>
								<button class="mt-1.5 text-[11px] font-bold underline text-red-700" onclick={() => goto(`/laporan/${projectId}`)}>Isi laporan susulan →</button>
							{:else if !calendar.todayReported}
								<button class="mt-1.5 text-[11px] font-bold underline" style="color:var(--pd, #2563eb)" onclick={() => goto(`/laporan/${projectId}`)}>Laporan hari ini belum ada — isi sekarang →</button>
							{/if}
						{/if}
					</section>
				{/if}

				<!-- 2. Kasbon belum LPJ -->
				{#if ready.show.lpj}
					<section data-testid="kendali-lpj" aria-label="Kasbon belum di-LPJ" class="border-t pt-3" style="border-color:var(--sys-sep, #e5e7eb)">
						<div class="flex items-center justify-between gap-2">
							<p class="text-[12px] font-bold" style="color:var(--sys-label, #111827)">
								🧾 Kasbon Belum di-LPJ
								<Tooltip position="bottom" text={`Dana uang muka yang sudah cair tetapi pertanggungjawabannya (LPJ/SPJ) belum masuk. Umur dihitung sejak dana cair; lewat ${ready.lpjGraceDays} hari = merah. Pengajuan lama tanpa status LPJ tidak dihitung. Nominal tidak ditampilkan di lapangan.`}>
									<span role="img" aria-label="Arti kasbon belum LPJ">ⓘ</span>
								</Tooltip>
							</p>
							{#if lpj}
								<span class="text-[11px] font-bold px-2 py-0.5 rounded-full border" style={LEVEL_CHIP[lpj.level]} data-testid="kendali-lpj-count">{lpj.total} berkas</span>
							{/if}
						</div>
						{#if ready.lpjFailed || !lpj}
							<p class="text-[11px] mt-1" style="color:var(--sys-label3, #6b7280)">Status LPJ belum dapat dimuat — coba muat ulang.</p>
						{:else if lpj.total === 0}
							<p class="text-[11px] mt-1 text-emerald-700" data-testid="kendali-lpj-empty">Tidak ada kasbon yang menunggu LPJ. ✅</p>
						{:else}
							<ul class="mt-2 flex flex-col gap-1.5">
								{#each showAllLpj ? lpj.items : lpj.items.slice(0, LPJ_PREVIEW) as it (it.id)}
									<li class="flex items-start justify-between gap-2 rounded-xl border px-2.5 py-1.5" style={LEVEL_CHIP[it.level]} data-testid="kendali-lpj-item">
										<div class="min-w-0">
											<p class="text-[12px] font-bold truncate">{it.label}</p>
											{#if it.subtitle}<p class="text-[11px] opacity-90 truncate">{it.subtitle}</p>{/if}
											<p class="text-[11px] opacity-90">
												{#if it.ageDays == null}Tanggal cair tidak tercatat{:else}Cair {it.ageDays} hari lalu{#if it.overdue} · lewat tenggang{/if}{/if}
											</p>
										</div>
										<button class="shrink-0 text-[11px] font-bold underline" onclick={() => goto(`/anggaran/${it.id}`)}>Kumpulkan LPJ</button>
									</li>
								{/each}
							</ul>
							{#if lpj.items.length > LPJ_PREVIEW}
								<button class="mt-1.5 text-[11px] font-semibold underline" style="color:var(--sys-label2, #374151)" onclick={() => (showAllLpj = !showAllLpj)}>
									{showAllLpj ? 'Ringkas daftar' : `Lihat ${lpj.items.length - LPJ_PREVIEW} lainnya`}
								</button>
							{/if}
						{/if}
					</section>
				{/if}

				<!-- 3. Deviasi progres vs Kurva S minggu berjalan -->
				{#if ready.show.scurve}
					<section data-testid="kendali-scurve" aria-label="Deviasi progres minggu berjalan" class="border-t pt-3" style="border-color:var(--sys-sep, #e5e7eb)">
						<div class="flex items-center justify-between gap-2">
							<p class="text-[12px] font-bold" style="color:var(--sys-label, #111827)">
								📈 Progres Minggu Ini vs Kurva S
								<Tooltip position="bottom" text="Membandingkan progres fisik kumulatif hari ini dengan target Kurva S dari penawaran yang ditandatangani customer, plus berapa poin yang masih perlu dikejar agar akhir minggu (Senin–Minggu) sesuai rencana. Realisasi dihitung dari progres per subtask di laporan harian.">
									<span role="img" aria-label="Arti deviasi Kurva S">ⓘ</span>
								</Tooltip>
							</p>
							{#if weekly && weekly.status === 'ok'}
								<span class="text-[11px] font-bold px-2 py-0.5 rounded-full border" style={TONE_CHIP[weekly.tone]} data-testid="kendali-scurve-tone">{weekly.tone === 'ontrack' ? 'Sesuai rencana' : weekly.tone === 'ahead' ? 'Di atas rencana' : 'Tertinggal'}</span>
							{/if}
						</div>
						{#if !weekly}
							<p class="text-[11px] mt-1" style="color:var(--sys-label3, #6b7280)">Data progres belum dapat dimuat — coba muat ulang.</p>
						{:else if weekly.status === 'na'}
							<p class="text-[11px] mt-1" style="color:var(--sys-label3, #6b7280)" data-testid="kendali-scurve-na">
								{#if weekly.reason === 'no_baseline'}Belum ada baseline Kurva S (penawaran sumber tanpa jadwal) — minta Admin/Sales melengkapi jadwal penawaran.
								{:else if weekly.reason === 'no_timeline'}Timeline proyek belum punya subtask ber-volume — lengkapi di tab Timeline agar progres bisa dibandingkan.
								{:else}Data belum cukup untuk membandingkan progres.{/if}
							</p>
						{:else}
							<p class="text-[11px] mt-0.5" style="color:var(--sys-label3, #6b7280)">Minggu {shortDate(weekly.weekStart)} – {shortDate(weekly.weekEnd)}</p>
							<div class="mt-2 grid grid-cols-2 gap-2">
								<div class="rounded-xl border px-2.5 py-2" style="border-color:var(--sys-sep, #e5e7eb)">
									<p class="text-[10px] uppercase tracking-wider font-semibold" style="color:var(--sys-label3, #6b7280)">Realisasi s.d. hari ini</p>
									<p class="text-[15px] font-bold" style="color:var(--sys-label, #111827)">{fmtPct(weekly.actualNowPct)}</p>
									<p class="text-[10px]" style="color:var(--sys-label3, #6b7280)">+{fmtPct(weekly.actualWeekPts).replace('%', '')} poin minggu ini</p>
								</div>
								<div class="rounded-xl border px-2.5 py-2" style="border-color:var(--sys-sep, #e5e7eb)">
									<p class="text-[10px] uppercase tracking-wider font-semibold" style="color:var(--sys-label3, #6b7280)">Rencana s.d. hari ini</p>
									<p class="text-[15px] font-bold" style="color:var(--sys-label, #111827)">{fmtPct(weekly.plannedNowPct)}</p>
									<p class="text-[10px]" style="color:var(--sys-label3, #6b7280)">target akhir minggu {fmtPct(weekly.plannedEndPct)}</p>
								</div>
							</div>
							<p class="mt-1.5 text-[11px] font-semibold" style="color:var(--sys-label2, #374151)" data-testid="kendali-scurve-delta">Deviasi: {fmtPts(weekly.deltaPts)} terhadap rencana</p>
							{#if weekly.remainingPts != null && weekly.remainingPts > 0}
								<p class="text-[11px]" style="color:var(--sys-label2, #374151)">
									Agar akhir minggu sesuai rencana, masih perlu +{fmtPct(weekly.remainingPts).replace('%', '')} poin
									{#if weekly.neededPerDayPts != null}(± {fmtPct(weekly.neededPerDayPts).replace('%', '')} poin per hari kerja, {weekly.workdaysLeft} hari tersisa){:else}— hari kerja minggu ini sudah habis{/if}.
								</p>
							{:else}
								<p class="text-[11px] text-emerald-700">Target akhir minggu sudah terpenuhi. ✅</p>
							{/if}
							{#if weekly.tone === 'behind'}
								<button class="mt-1 text-[11px] font-bold underline text-red-700" onclick={() => goto(`/laporan/${projectId}`)}>Lihat rincian per subtask →</button>
							{/if}
						{/if}
					</section>
				{/if}

				{#if ready.warnings.length > 0}
					<p class="text-[10px]" style="color:var(--sys-label3, #6b7280)">{ready.warnings.join(' ')}</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}
