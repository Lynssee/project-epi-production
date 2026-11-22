<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconInfoCircle } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser, getProjectScope, getWorkshopScope } from '$lib/services/projectScope';
	import { loadProjectSettings } from '$lib/services/projectSettings';
	import { fetchWorkshops, fetchWorkshopRoster, fetchProjectRoster, fetchRekapBulanan } from '$lib/services/workerRating';
	import { matchWorkshop } from '$lib/utils/bulkRating';
	import { buildRekapTim, monthRange, type RekapBaris, type RekapRingkas } from '$lib/utils/rekapTim';

	// ── Rekap Tim Bulanan — PL / Koordinator Workshop (Laporan Periodik Outsource, Fase 4) ──────────
	// Hanya BACA: kehadiran + rata-rata bintang per pekerja pada bulan terpilih, dan siapa yang belum dinilai.
	// Menilai dilakukan di /manpower/rating. Skor komposit resmi (bobot HRD) dihitung di ERP, bukan di sini.

	type Mode = 'proyek' | 'workshop';
	const now = new Date();
	let loading = $state(true);
	let dataLoading = $state(false);
	let mode = $state<Mode>('proyek');
	let projects = $state<any[]>([]);
	let workshops = $state<{ id: number; code: string | null; name: string | null }[]>([]);
	let selectedProjectId = $state('');
	let selectedWorkshopId = $state('');
	let bulan = $state(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
	let baris = $state<RekapBaris[]>([]);
	let ringkas = $state<RekapRingkas | null>(null);
	let loadError = $state('');
	let seq = 0;

	async function resolveWorkshops() {
		const all = await fetchWorkshops();
		if (getProjectScope().unrestricted) return all;
		return getWorkshopScope().map((key) => matchWorkshop(key, all)).filter((w): w is NonNullable<typeof w> => !!w);
	}

	async function load() {
		const my = ++seq;
		const range = monthRange(bulan);
		if (!range) { loadError = 'Bulan tidak valid'; return; }
		dataLoading = true;
		loadError = '';
		try {
			let roster: { manpowerId: number; nama: string; jabatan: string }[] = [];
			if (mode === 'proyek' && selectedProjectId) roster = await fetchProjectRoster(Number(selectedProjectId));
			else if (mode === 'workshop' && selectedWorkshopId) {
				const r = await fetchWorkshopRoster(Number(selectedWorkshopId));
				roster = r.map((x) => ({ manpowerId: Number(x.manpower_id), nama: x.karyawan_nama, jabatan: x.jabatan || '' }));
			}
			const { absensi, ratings } = await fetchRekapBulanan(roster.map((r) => r.manpowerId), range.from, range.to);
			if (my !== seq) return;
			const hasil = buildRekapTim(roster, absensi, ratings);
			baris = hasil.baris;
			ringkas = hasil.ringkas;
		} catch (e: any) {
			if (my === seq) { baris = []; ringkas = null; loadError = e?.message || 'Gagal memuat rekap tim'; }
		} finally {
			if (my === seq) dataLoading = false;
		}
	}

	function setMode(m: Mode) {
		if (mode === m) return;
		mode = m;
		load();
	}

	onMount(async () => {
		try {
			await loadProjectSettings();
			const [p, w] = await Promise.all([getProjectsForCurrentUser(true), resolveWorkshops()]);
			projects = p || [];
			workshops = w;
			if (projects.length) selectedProjectId = String(projects[0].id);
			if (workshops.length) selectedWorkshopId = String(workshops[0].id);
			if (!projects.length && workshops.length) mode = 'workshop';
			await load();
		} catch (e: any) {
			loadError = e?.message || 'Gagal memuat';
		} finally {
			loading = false;
		}
	});
</script>

<div class="min-h-screen bg-gray-50 pb-8">
	<div class="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-2">
		<a href="/manpower" class="text-gray-500" aria-label="Kembali"><IconArrowLeft size={18} /></a>
		<h1 class="text-[15px] font-bold text-gray-800">Rekap Tim Bulanan</h1>
	</div>

	{#if loading}
		<div class="py-16 flex justify-center"><CircularProgressGauge size={44} strokeWidth={4} label="Memuat..." /></div>
	{:else}
		<div class="p-4 space-y-3 max-w-xl mx-auto">
			<div class="flex gap-2 bg-blue-50 border border-blue-100 text-blue-800 text-[12px] rounded-lg px-3 py-2">
				<IconInfoCircle size={16} class="shrink-0 mt-0.5" />
				<p>Pilih proyek/workshop dan bulan. Kehadiran dihitung dari absensi; bintang adalah rata-rata penilaian bulan itu. Pekerja yang <b>belum dinilai</b> tampil paling atas — nilai lewat <a class="underline font-semibold" href="/manpower/rating">Nilai Pekerja</a>. Nilai ini memengaruhi skor KPI Outsource di ERP.</p>
			</div>

			{#if projects.length && workshops.length}
				<div class="grid grid-cols-2 gap-1 bg-gray-200/70 p-1 rounded-xl" role="tablist">
					<button role="tab" aria-selected={mode === 'proyek'} onclick={() => setMode('proyek')} class="py-1.5 rounded-lg text-[12px] font-semibold {mode === 'proyek' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}">Per Proyek</button>
					<button role="tab" aria-selected={mode === 'workshop'} onclick={() => setMode('workshop')} class="py-1.5 rounded-lg text-[12px] font-semibold {mode === 'workshop' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}">Per Workshop</button>
				</div>
			{/if}

			<div class="bg-white rounded-xl border border-gray-100 p-3 grid grid-cols-3 gap-2">
				<div class="col-span-2">
					<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider" for="rk-ctx">{mode === 'proyek' ? 'Proyek' : 'Workshop'}</label>
					{#if mode === 'proyek'}
						<select id="rk-ctx" bind:value={selectedProjectId} onchange={load} class="w-full mt-1 text-[13px] px-2 py-2 rounded-lg border border-gray-200 bg-white">
							{#each projects as p}<option value={String(p.id)}>{p.name}</option>{/each}
						</select>
					{:else}
						<select id="rk-ctx" bind:value={selectedWorkshopId} onchange={load} class="w-full mt-1 text-[13px] px-2 py-2 rounded-lg border border-gray-200 bg-white">
							{#each workshops as w}<option value={String(w.id)}>{w.name || w.code}</option>{/each}
						</select>
					{/if}
				</div>
				<div>
					<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider" for="rk-bln">Bulan</label>
					<input id="rk-bln" type="month" bind:value={bulan} onchange={load} class="w-full mt-1 text-[13px] px-2 py-2 rounded-lg border border-gray-200 bg-white" />
				</div>
			</div>

			{#if loadError}
				<div class="bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-lg px-3 py-2" role="alert">{loadError} — <button class="underline font-semibold" onclick={load}>coba lagi</button></div>
			{:else if dataLoading}
				<div class="py-10 flex justify-center"><CircularProgressGauge size={40} strokeWidth={4} label="Memuat rekap..." /></div>
			{:else if !baris.length}
				<div class="bg-white rounded-xl border border-gray-100 p-6 text-center text-[13px] text-gray-400">Belum ada pekerja aktif pada pilihan ini.</div>
			{:else}
				{#if ringkas}
					<div class="grid grid-cols-3 gap-2 text-center">
						<div class="bg-white rounded-xl border border-gray-100 p-2.5"><p class="text-[10px] text-gray-400">Pekerja</p><p class="text-lg font-black text-gray-800">{ringkas.totalPekerja}</p></div>
						<div class="bg-white rounded-xl border border-gray-100 p-2.5"><p class="text-[10px] text-gray-400">Rata hadir</p><p class="text-lg font-black text-gray-800">{ringkas.hadirPctRata != null ? `${ringkas.hadirPctRata}%` : '–'}</p></div>
						<div class="bg-white rounded-xl border border-gray-100 p-2.5"><p class="text-[10px] text-gray-400">Rata bintang</p><p class="text-lg font-black text-gray-800">{ringkas.rataNilai != null ? `${ringkas.rataNilai}★` : '–'}</p></div>
					</div>
					{#if ringkas.belumDinilai > 0}
						<div class="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] rounded-lg px-3 py-2 flex items-center justify-between gap-2">
							<span>{ringkas.belumDinilai} pekerja belum dinilai bulan ini.</span>
							<a href="/manpower/rating" class="font-semibold underline whitespace-nowrap">Nilai sekarang</a>
						</div>
					{/if}
				{/if}

				{#each baris as b (b.manpowerId)}
					<div class="bg-white rounded-xl border p-3 {b.perhatian.length ? 'border-amber-300' : 'border-gray-100'}">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="text-[13px] font-semibold text-gray-800 truncate">{b.nama}</p>
								<p class="text-[11px] text-gray-400 truncate">{b.jabatan || '-'}</p>
							</div>
							<div class="text-right text-[12px] whitespace-nowrap">
								<p class="font-semibold text-gray-700">{b.hadirPct != null ? `${b.hadirPct}% hadir` : 'Tanpa absensi'}</p>
								<p class="text-gray-500">{b.rataNilai != null ? `${b.rataNilai}★ (${b.jumlahNilai}x)` : 'Belum dinilai'}</p>
							</div>
						</div>
						{#if b.perhatian.length}
							<p class="mt-1.5 text-[11px] text-amber-700">⚠ {b.perhatian.join(' · ')}</p>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>
