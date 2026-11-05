<!-- src/routes/(app)/FetchWaterfallPanel.svelte -->
<!-- Tab "Fetch Halaman" di popover ServerQualityIndicator (khusus Super Admin).
     Menampilkan fetch /api/* yang dipicu halaman yang sedang dibuka (data dari fetchProfiler.ts,
     hanya di memori tab ini): ringkasan, temuan + saran perbaikan, dan waterfall waktu. -->

<script lang="ts">
	import { fetchSessions, clearFetchSessions, analyzeSession, buildReport, setThresholds, type FetchEntry } from './fetchProfiler';
	import ServerProfileView from './ServerProfileView.svelte';

	/** Ambang "lambat" (ms) -- dari app_settings perf.slow_fetch_ms lewat pulse.config */
	let { slowMs = 500, duplicateMin = 3 }: { slowMs?: number; duplicateMin?: number } = $props();

	const MAX_ROWS = 25;
	let selectedId = $state<number | null>(null); // null = sesi terbaru (halaman yang sedang dibuka)
	let copied = $state(false);
	let view = $state<'halaman' | 'server'>('halaman'); // 'halaman' = rekaman browser ini; 'server' = profil server lapangan

	$effect(() => {
		setThresholds({ slowMs, duplicateMin });
	});

	let sessions = $derived($fetchSessions);
	let session = $derived((selectedId != null && sessions.find((s) => s.id === selectedId)) || sessions[sessions.length - 1] || null);
	let analysis = $derived(session ? analyzeSession(session, { slowMs, duplicateMin }) : null);
	let rows = $derived(
		session ? session.entries.filter((e) => e.dur != null).sort((a, b) => a.start - b.start).slice(0, MAX_ROWS) : ([] as FetchEntry[])
	);
	let origin = $derived(rows.length ? Math.min(...rows.map((e) => e.start)) : 0);
	let span = $derived(rows.length ? Math.max(1, Math.max(...rows.map((e) => e.start + (e.dur ?? 0))) - origin) : 1);

	const levelCls: Record<string, string> = {
		bad: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200',
		warn: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200',
		info: 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200',
		ok: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
	};
	const levelIcon: Record<string, string> = { bad: '🔴', warn: '🟠', info: '🔵', ok: '🟢' };

	function barCls(e: FetchEntry): string {
		if (e.ok === false) return 'bg-rose-500';
		if ((e.dur ?? 0) >= slowMs) return 'bg-amber-500';
		if (e.cache === 'HIT' || e.cache === 'COALESCED') return 'bg-emerald-400';
		return 'bg-indigo-500';
	}

	function copyReport() {
		if (!session) return;
		navigator.clipboard.writeText(buildReport(session, analysis ?? undefined));
		copied = true;
		setTimeout(() => (copied = false), 2500);
	}

	const pct = (v: number) => `${Math.max(0, Math.min(100, v))}%`;
</script>

<div class="space-y-2.5">
	<div class="flex gap-1" role="group" aria-label="Sumber data fetch">
		<button type="button" onclick={() => (view = 'halaman')} aria-pressed={view === 'halaman'}
			class="flex-1 py-1 rounded-lg text-[10px] font-bold cursor-pointer {view === 'halaman' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}"
			title="Fetch yang dipicu halaman yang sedang dibuka di browser ini">Halaman ini</button>
		<button type="button" onclick={() => (view = 'server')} aria-pressed={view === 'server'}
			class="flex-1 py-1 rounded-lg text-[10px] font-bold cursor-pointer {view === 'server' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}"
			title="Profil seluruh pengguna di server lapangan: koleksi & halaman terberat, query lambat">Server (semua user)</button>
	</div>

	{#if view === 'server'}
		<ServerProfileView {slowMs} />
	{:else if !session || !analysis || analysis.count === 0}
		<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
			Belum ada fetch terekam di halaman ini. Perekam aktif sejak aplikasi dimuat — <b>buka sebuah halaman atau muat ulang datanya</b> lalu buka tab ini lagi.
		</div>
	{:else}
		{#if sessions.length > 1}
			<label class="flex items-center gap-2 text-[10px] text-slate-500">
				<span class="shrink-0">Halaman:</span>
				<select
					class="flex-1 min-w-0 px-1.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-mono"
					value={session.id}
					onchange={(ev) => (selectedId = Number(ev.currentTarget.value))}
					title="Pilih halaman yang pernah dibuka di tab ini (4 terakhir)"
				>
					{#each sessions as s (s.id)}
						<option value={s.id}>{s.route}{s.id === sessions[sessions.length - 1].id ? ' (sekarang)' : ''}</option>
					{/each}
				</select>
			</label>
		{/if}

		<!-- Ringkasan -->
		<div class="grid grid-cols-4 gap-1.5 text-center">
			<div class="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750" title="Jumlah fetch /api/* yang dipicu halaman ini">
				<p class="font-mono font-black text-sm">{analysis.count}</p>
				<p class="text-[9px] text-slate-400 uppercase">Fetch</p>
			</div>
			<div class="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750" title="Dari fetch pertama sampai fetch terakhir selesai">
				<p class="font-mono font-black text-sm {analysis.wallMs >= 3000 ? 'text-amber-600' : ''}">{analysis.wallMs}<span class="text-[9px] font-normal">ms</span></p>
				<p class="text-[9px] text-slate-400 uppercase">Tunggu</p>
			</div>
			<div class="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750" title="Persentase pembacaan yang digabung dengan request identik (tidak menembak Directus sendiri)">
				<p class="font-mono font-black text-sm">{analysis.cacheHitPct ?? '-'}{analysis.cacheHitPct != null ? '%' : ''}</p>
				<p class="text-[9px] text-slate-400 uppercase">Cache</p>
			</div>
			<div class="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750" title="Total ukuran badan respons">
				<p class="font-mono font-black text-sm">{Math.round(analysis.bytes / 1024)}<span class="text-[9px] font-normal">KB</span></p>
				<p class="text-[9px] text-slate-400 uppercase">Payload</p>
			</div>
		</div>

		<!-- Temuan & saran -->
		<ul class="space-y-1.5">
			{#each analysis.findings as f}
				<li class="p-2 rounded-lg border text-[11px] leading-snug {levelCls[f.level]}">
					<p class="font-bold">{levelIcon[f.level]} {f.title}</p>
					<p class="opacity-90 mt-0.5">{f.hint}</p>
				</li>
			{/each}
		</ul>

		<!-- Waterfall -->
		<div>
			<div class="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
				<span>Waterfall ({rows.length}{analysis.count > rows.length ? ` dari ${analysis.count}` : ''})</span>
				<span class="font-normal normal-case">skala {span} ms</span>
			</div>
			<div class="space-y-0.5 max-h-52 overflow-y-auto pr-0.5">
				{#each rows as e (e.id)}
					<div
						class="flex items-center gap-1.5 text-[10px]"
						title="{e.method} {e.path} • {e.dur} ms{e.serverMs != null ? ` (server ${Math.round(e.serverMs)} ms)` : ''}{e.cache ? ` • ${e.cache}` : ''} • status {e.status ?? e.error ?? '?'}{e.limit != null ? ` • limit=${e.limit}` : ''}{e.fields ? ` • fields=${e.fields.slice(0, 40)}` : ''}"
					>
						<span class="w-24 shrink-0 truncate font-mono text-slate-600 dark:text-slate-300">
							{#if e.method !== 'GET'}<b class="text-purple-600">{e.method}</b> {/if}{e.label}
						</span>
						<span class="relative flex-1 h-2.5 rounded bg-slate-100 dark:bg-slate-800">
							<span class="absolute top-0 h-full rounded {barCls(e)}" style="left:{pct(((e.start - origin) / span) * 100)}; width:{pct(Math.max(1.5, ((e.dur ?? 0) / span) * 100))}"></span>
						</span>
						<span class="w-14 shrink-0 text-right font-mono {(e.dur ?? 0) >= slowMs ? 'text-amber-600 font-bold' : 'text-slate-500'}">
							{e.dur}ms{#if e.unboundedLimit || e.wildcardFields}<span title="Overfetch (limit=-1 / fields=*)"> ⚠</span>{/if}
						</span>
					</div>
				{/each}
			</div>
			<p class="mt-1 text-[10px] text-slate-400 leading-snug">
				<span class="inline-block w-2 h-2 rounded bg-indigo-500 align-middle"></span> ke Directus
				<span class="inline-block w-2 h-2 rounded bg-emerald-400 align-middle ml-1.5"></span> digabung / cache
				<span class="inline-block w-2 h-2 rounded bg-amber-500 align-middle ml-1.5"></span> lambat (≥ {slowMs} ms)
				<span class="inline-block w-2 h-2 rounded bg-rose-500 align-middle ml-1.5"></span> gagal
			</p>
		</div>

		<div class="flex items-center gap-1.5 pt-1">
			<button type="button" onclick={copyReport} class="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-[11px] transition-colors cursor-pointer" title="Salin ringkasan temuan + 8 fetch terlama (tanpa nilai filter) untuk developer">
				{copied ? '✅ Disalin' : '📋 Salin laporan'}
			</button>
			<button type="button" onclick={clearFetchSessions} class="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-[11px] transition-colors cursor-pointer" title="Hapus rekaman lalu muat ulang halaman untuk mengukur dari awal">
				🧹 Reset
			</button>
		</div>
	{/if}

	<div class="p-2 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-150 dark:border-blue-800/50 text-[11px] text-blue-950 dark:text-blue-200 leading-relaxed">
		<span class="font-bold mr-1">💡 Cara membaca:</span>
		Buka halaman yang terasa lambat → buka tab ini. Baca <b>Temuan</b> dulu (merah = paling mendesak), lalu cari bar panjang di waterfall.
		Bar yang tersusun <i>menurun berurutan</i> berarti fetch menunggu satu per satu.
	</div>
</div>
