<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Audit Log Override Dobel-Proyek — daftar semua kejadian di mana Project Leader tetap
	// menambahkan pekerja ke Laporan Harian walau sistem sudah memperingatkan pekerja itu
	// sudah tercatat absen di proyek lain hari yang sama (lihat addWorkerToRole di
	// laporan/[project_id]/+page.svelte). Supaya override ini bisa direview manajemen,
	// bukan lolos tanpa jejak. Pola sama dengan kontrak-terpusat/spk-terpusat.
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getDobelProyekOverrides, getSpkBentrok, type DobelProyekOverrideRow, type SpkBentrokRow } from '$lib/services/manpowerAbsensi';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let overrides = $state<DobelProyekOverrideRow[]>([]);
	let spkBentrok = $state<SpkBentrokRow[]>([]);

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(false, { limit: -1 })) || [];
			const projectIds = projects.map((p) => p.id);
			[overrides, spkBentrok] = await Promise.all([
				getDobelProyekOverrides(projectIds),
				getSpkBentrok(projectIds)
			]);
		} finally {
			loading = false;
		}
	}

	function fmtDate(d: string | null) {
		return d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
	}
	function namaPekerja(r: DobelProyekOverrideRow) {
		return typeof r.manpower_id === 'object' ? r.manpower_id?.nama || '-' : `#${r.manpower_id}`;
	}
	function namaProyek(r: DobelProyekOverrideRow) {
		return typeof r.project_id === 'object' ? r.project_id?.name || '-' : `#${r.project_id}`;
	}
	function projectIdOf(r: DobelProyekOverrideRow) {
		return typeof r.project_id === 'object' ? r.project_id?.id : r.project_id;
	}
	function namaProyekLain(r: DobelProyekOverrideRow) {
		if (!r.dobel_proyek_proyek_lain_id) return '-';
		return typeof r.dobel_proyek_proyek_lain_id === 'object' ? r.dobel_proyek_proyek_lain_id?.name || '-' : `#${r.dobel_proyek_proyek_lain_id}`;
	}
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
	<div>
		<a href="/proyek" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
			<IconArrowLeft size={14} /> List Project
		</a>
		<h1 class="text-xl font-bold text-gray-900 flex items-center gap-2">
			<IconAlertTriangle size={20} class="text-red-500" /> Audit Log Bentrok Manpower
		</h1>
		<p class="text-sm text-gray-500">Dua lapis deteksi dalam satu halaman: bentrok level absensi harian, dan bentrok level penugasan/SPK (Kapasitas Proyek & Rekomendasi Dashboard v2, Fase 4).</p>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat audit log override..." />
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum ditugaskan ke proyek manapun.</p>
		</div>
	{:else}
		<div>
			<h2 class="text-sm font-bold text-gray-700 mb-2">Bentrok Level Penugasan/SPK</h2>
			{#if spkBentrok.length === 0}
				<div class="text-center py-8 bg-white rounded-2xl border border-gray-100">
					<p class="text-[13px] text-gray-500">Tidak ada bentrok SPK yang tercatat di proyek Anda. 👍</p>
				</div>
			{:else}
				<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
					<table class="w-full text-[13px]">
						<thead class="bg-gray-50">
							<tr>
								<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Pekerja</th>
								<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">SPK A</th>
								<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">SPK B</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-100">
							{#each spkBentrok as r (r.assignment_a.id + '-' + r.assignment_b.id)}
								<tr class="hover:bg-red-50/40">
									<td class="px-4 py-3 font-medium text-gray-800">{r.nama}</td>
									<td class="px-4 py-3">
										<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">{r.assignment_a.nomor_spk || '-'} · {r.assignment_a.nama_proyek}</span>
										<p class="text-[11px] text-gray-400 mt-0.5">{fmtDate(r.assignment_a.tanggal_mulai)} – {r.assignment_a.tanggal_selesai ? fmtDate(r.assignment_a.tanggal_selesai) : 'tanpa batas'}</p>
									</td>
									<td class="px-4 py-3">
										<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">{r.assignment_b.nomor_spk || '-'} · {r.assignment_b.nama_proyek}</span>
										<p class="text-[11px] text-gray-400 mt-0.5">{fmtDate(r.assignment_b.tanggal_mulai)} – {r.assignment_b.tanggal_selesai ? fmtDate(r.assignment_b.tanggal_selesai) : 'tanpa batas'}</p>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<h2 class="text-sm font-bold text-gray-700 mb-2 mt-1">Override Dobel-Proyek (Level Absensi Harian)</h2>
		{#if overrides.length === 0}
			<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
				<p class="text-[14px] text-gray-500">Tidak ada override dobel-proyek yang tercatat. 👍</p>
			</div>
		{:else}
			<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
				<table class="w-full text-[13px]">
					<thead class="bg-gray-50">
						<tr>
							<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Tanggal</th>
							<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Pekerja</th>
							<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek Ini</th>
							<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek Lain (Konflik)</th>
							<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Dicatat Oleh</th>
							<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Aksi</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100">
						{#each overrides as r (r.id)}
							<tr class="hover:bg-red-50/40">
								<td class="px-4 py-3 text-gray-600">{fmtDate(r.tanggal)}</td>
								<td class="px-4 py-3 font-medium text-gray-800">{namaPekerja(r)}</td>
								<td class="px-4 py-3 text-gray-700">{namaProyek(r)}</td>
								<td class="px-4 py-3">
									<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">{namaProyekLain(r)}</span>
								</td>
								<td class="px-4 py-3 text-gray-600">{r.dicatat_oleh || '-'}</td>
								<td class="px-4 py-3 text-center">
									<a href={`/proyek/${projectIdOf(r)}?tab=laporan&sub=laporan-harian`} class="text-[12px] font-semibold text-green-700 hover:underline">Lihat Proyek</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>
