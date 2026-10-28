<script lang="ts">
	// Badge kesiapan belanja di header: "Siap Belanja" / "Belanja Terkunci" (rencana Dual Gate PA,
	// rekomendasi dashboard lapangan). Hanya untuk pengguna yang dibatasi cakupan proyek (leader);
	// admin/unrestricted & pengguna tanpa proyek tidak melihat badge dan TIDAK memicu fetch apa pun.
	// Gate masih shadow/warn -> tampil kuning "Perlu dilengkapi" (tidak benar-benar menahan pengajuan).
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { getProjectScope, getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { fetchGateSnapshot, type GateSnapshot } from '$lib/services/gateSnapshot';

	let snap = $state<GateSnapshot | null>(null);
	let names = $state<Record<string, string>>({});
	let open = $state(false);
	let started = false;

	async function load(force = false) {
		try {
			const scope = getProjectScope();
			if (scope.unrestricted || scope.kosong) return;
			const projects = await getProjectsForCurrentUser(true);
			names = Object.fromEntries(projects.map((p: any) => [String(p.id), p.name]));
			const s = await fetchGateSnapshot(projects.map((p: any) => p.id), { force });
			snap = s.available === false ? null : s;
		} catch {
			snap = null; // fail-soft: badge tidak tampil
		}
	}

	onMount(() => {
		const onVisible = () => {
			if (document.visibilityState === 'visible' && snap) load();
		};
		document.addEventListener('visibilitychange', onVisible);
		const stop = authStore.subscribe((s) => {
			if (s.checked && s.user && !started) {
				started = true;
				const run = () => load();
				if ('requestIdleCallback' in window) requestIdleCallback(run);
				else setTimeout(run, 1500);
			}
		});
		return () => {
			document.removeEventListener('visibilitychange', onVisible);
			stop();
		};
	});

	let bolong = $derived(
		Object.entries(snap?.projects || {}).filter(([, p]) => p.status === 'failed')
	);
	// MoM sentral global; bila SEMUA proyek saya sedang didispensasi untuk G_MOM_BRIEFING, tidak dianggap masalah.
	let momBelum = $derived(
		snap?.mom?.status === 'failed' &&
			!(Object.keys(names).length > 0 && Object.keys(names).every((pid) => snap?.dispensasi?.[pid]?.includes('G_MOM_BRIEFING')))
	);
	let dispensasiAktif = $derived(Object.values(snap?.projects || {}).filter((p) => p.dispensasi).length > 0);
	let bermasalah = $derived(bolong.length > 0 || momBelum);
	// Gate benar-benar memblokir bila salah satu modenya soft/hard.
	let memblokir = $derived(
		(bolong.length > 0 && ['soft', 'hard'].includes(snap?.modes?.G10_HARIAN || '')) ||
			(momBelum && ['soft', 'hard'].includes(snap?.modes?.G_MOM_BRIEFING || ''))
	);
	const fmt = (d: string) =>
		new Date(d + 'T00:00:00Z').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
</script>

{#if snap}
	<div class="relative">
		<button
			type="button"
			onclick={() => (open = !open)}
			class="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-colors {!bermasalah
				? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900'
				: memblokir
					? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900'
					: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900'}"
			title="Kesiapan mengajukan anggaran proyek: laporan harian lengkap + MoM Briefing Pagi. Klik untuk detail."
			aria-expanded={open}
		>
			<span aria-hidden="true">{!bermasalah ? '🟢' : memblokir ? '🔴' : '🟡'}</span>
			<span class="hidden sm:inline">{!bermasalah ? 'Siap Belanja' : memblokir ? 'Belanja Terkunci' : 'Perlu dilengkapi'}</span>
		</button>

		{#if open}
			<div class="absolute right-0 mt-2 w-72 max-w-[85vw] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-3 z-50 text-[12px]">
				{#if !bermasalah}
					<p class="text-emerald-700 dark:text-emerald-300 font-semibold">{dispensasiAktif ? 'Siap — ada dispensasi GM aktif.' : 'Laporan harian lengkap & MoM sudah ada.'}</p>
					<p class="text-slate-500 mt-1">Anda bisa mengajukan anggaran proyek tanpa terhambat gate laporan.</p>
				{:else}
					{#if !memblokir}
						<p class="text-[11px] text-slate-500 mb-2">Gate masih mode pantau — belum menahan pengajuan, tapi segera lengkapi.</p>
					{/if}
					{#if bolong.length > 0}
						<p class="font-semibold text-slate-800 dark:text-slate-100 mb-1">Laporan harian bolong</p>
						<ul class="space-y-1.5 mb-2">
							{#each bolong as [pid, p]}
								<li>
									<span class="text-slate-700 dark:text-slate-200">{names[pid] || 'Proyek ' + pid}</span>
									<div class="flex flex-wrap gap-1 mt-0.5">
										{#each p.missingDates as d}
											<a href="/laporan/{pid}?tanggal={d}" class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-600 text-white">+ {fmt(d)}</a>
										{/each}
									</div>
								</li>
							{/each}
						</ul>
					{/if}
					{#if momBelum}
						<p class="font-semibold text-slate-800 dark:text-slate-100">MoM Briefing Pagi belum diunggah</p>
						<p class="text-slate-500 mt-0.5">Diunggah oleh Admin/Manajemen. Hubungi Admin bila sudah lewat jam batas.</p>
					{/if}
				{/if}
				<button type="button" class="mt-2 text-[11px] font-medium text-blue-600 hover:underline" onclick={() => load(true)}>🔄 Cek ulang</button>
			</div>
		{/if}
	</div>
{/if}
