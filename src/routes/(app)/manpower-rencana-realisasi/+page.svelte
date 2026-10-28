<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Manpower Rencana vs Realisasi Terpusat — bandingkan headcount SPK aktif (rencana) dengan
	// jumlah pekerja yang benar-benar tercatat hadir di Laporan Harian (realisasi), per hari,
	// lintas semua proyek yang dipegang user. Pola & gaya sama dengan kontrak-terpusat/
	// spk-terpusat: reuse getProjectsForCurrentUser, tanpa nilai Rp.
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconChevronDown, IconChevronUp, IconBolt } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getActiveAssignmentsForProjects, type ActiveAssignmentRange } from '$lib/services/manpowerAssignment';
	import { getAbsensiForProjectsInRange, type AbsensiRangeRow } from '$lib/services/manpowerAbsensi';
	import ManualAbsensiModal from '$lib/components/project/ManualAbsensiModal.svelte';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let assignments = $state<ActiveAssignmentRange[]>([]);
	let absensi = $state<AbsensiRangeRow[]>([]);
	let expandedProjectId = $state<number | null>(null);
	let quickAttendanceProjectId = $state<number | null>(null);

	// Default 7 hari terakhir — cukup untuk deteksi tren tanpa data terlalu berat dimuat.
	let startDate = $state((() => {
		const d = new Date();
		d.setDate(d.getDate() - 6);
		return d.toISOString().split('T')[0];
	})());
	let endDate = $state(new Date().toISOString().split('T')[0]);

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(true)) || [];
			const projectIds = projects.map((p) => p.id);
			[assignments, absensi] = await Promise.all([
				getActiveAssignmentsForProjects(projectIds),
				getAbsensiForProjectsInRange(projectIds, startDate, endDate)
			]);
		} finally {
			loading = false;
		}
	}

	// Hanya status yang berarti "benar-benar di lapangan hari itu" dihitung sebagai realisasi.
	// izin/sakit/alpha SENGAJA tidak dihitung — itu justru bagian dari gap yang mau dideteksi.
	const PRESENT_STATUSES = new Set(['hadir', 'setengah_hari']);

	let dateList = $derived.by(() => {
		const result: string[] = [];
		const d = new Date(startDate);
		const end = new Date(endDate);
		while (d <= end) {
			result.push(d.toISOString().split('T')[0]);
			d.setDate(d.getDate() + 1);
		}
		return result;
	});

	function projectName(id: number) {
		return projects.find((p) => p.id === id)?.name || `Proyek #${id}`;
	}

	// Per proyek: untuk tiap hari dalam rentang, hitung jumlah SPK aktif yang overlap tanggal
	// itu (rencana) vs jumlah manpower_id unik berstatus hadir/setengah_hari (realisasi).
	let projectRows = $derived.by(() => {
		const byProject = new Map<number, { rencana: number[]; realisasi: number[]; dates: string[] }>();

		for (const pid of projects.map((p) => p.id)) {
			const projAssignments = assignments.filter((a) => Number(a.project_id) === Number(pid));
			const projAbsensi = absensi.filter((a) => Number(a.project_id) === Number(pid));

			const rencana: number[] = [];
			const realisasi: number[] = [];
			for (const day of dateList) {
				const rencanaCount = projAssignments.filter((a) => {
					const mulai = a.tanggal_mulai || '0000-01-01';
					const selesai = a.tanggal_selesai || '9999-12-31';
					return day >= mulai && day <= selesai;
				}).length;
				const realisasiSet = new Set(
					projAbsensi.filter((a) => a.tanggal === day && PRESENT_STATUSES.has(a.status)).map((a) => a.manpower_id)
				);
				rencana.push(rencanaCount);
				realisasi.push(realisasiSet.size);
			}
			byProject.set(pid, { rencana, realisasi, dates: dateList });
		}

		return projects
			.map((p) => {
				const d = byProject.get(p.id) || { rencana: [], realisasi: [], dates: [] };
				const avgRencana = d.rencana.length ? d.rencana.reduce((s, v) => s + v, 0) / d.rencana.length : 0;
				const avgRealisasi = d.realisasi.length ? d.realisasi.reduce((s, v) => s + v, 0) / d.realisasi.length : 0;
				return {
					projectId: p.id,
					projectName: p.name,
					avgRencana,
					avgRealisasi,
					gap: avgRealisasi - avgRencana,
					daily: d.dates.map((day, i) => ({ day, rencana: d.rencana[i], realisasi: d.realisasi[i] }))
				};
			})
			// Hanya tampilkan proyek yang punya SPK aktif atau data absensi di rentang ini.
			.filter((r) => r.avgRencana > 0 || r.avgRealisasi > 0)
			.sort((a, b) => a.gap - b.gap); // paling kekurangan tenaga di atas
	});

	function gapLabel(gap: number, avgRencana: number) {
		if (avgRencana === 0) return { l: '-', c: 'bg-gray-100 text-gray-500' };
		const pct = (gap / avgRencana) * 100;
		if (pct <= -30) return { l: 'Kurang Tenaga', c: 'bg-red-100 text-red-700' };
		if (pct < -10) return { l: 'Sedikit Kurang', c: 'bg-amber-100 text-amber-700' };
		if (pct > 10) return { l: 'Lebih dari Rencana', c: 'bg-blue-100 text-blue-700' };
		return { l: 'Sesuai Rencana', c: 'bg-green-100 text-green-700' };
	}

	function fmt1(v: number) {
		return v.toFixed(1);
	}

	function fmtDateShort(d: string) {
		return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
	}
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
	<div>
		<a href="/proyek" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
			<IconArrowLeft size={14} /> List Project
		</a>
		<h1 class="text-xl font-bold text-gray-900">Manpower Rencana vs Realisasi</h1>
		<p class="text-sm text-gray-500">Perbandingan jumlah SPK aktif (rencana) dengan pekerja yang benar-benar tercatat hadir di Laporan Harian (realisasi), per proyek.</p>
	</div>

	<div class="flex flex-wrap items-end gap-3 bg-white p-3 rounded-xl border border-gray-100">
		<div>
			<label class="block text-[11px] font-semibold text-gray-500 mb-1">Dari Tanggal</label>
			<input type="date" bind:value={startDate} class="text-[13px] border border-gray-200 rounded-lg px-2.5 py-1.5" />
		</div>
		<div>
			<label class="block text-[11px] font-semibold text-gray-500 mb-1">Sampai Tanggal</label>
			<input type="date" bind:value={endDate} class="text-[13px] border border-gray-200 rounded-lg px-2.5 py-1.5" />
		</div>
		<button
			type="button"
			onclick={load}
			class="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50"
			disabled={loading}
		>
			{loading ? 'Memuat...' : 'Terapkan'}
		</button>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rencana vs realisasi manpower..." />
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum ditugaskan ke proyek manapun.</p>
		</div>
	{:else if projectRows.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Tidak ada SPK aktif atau data absensi pada rentang tanggal ini.</p>
		</div>
	{:else}
		<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
			<table class="w-full text-[13px]">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Rencana (org/hari)</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Realisasi (org/hari)</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Selisih</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Status</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Detail</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each projectRows as r (r.projectId)}
						{@const gap = gapLabel(r.gap, r.avgRencana)}
						<tr class="hover:bg-gray-50">
							<td class="px-4 py-3 font-medium text-gray-800">{r.projectName}</td>
							<td class="px-4 py-3 text-center text-gray-700">{fmt1(r.avgRencana)}</td>
							<td class="px-4 py-3 text-center text-gray-700">{fmt1(r.avgRealisasi)}</td>
							<td class="px-4 py-3 text-center font-semibold {r.gap < 0 ? 'text-red-600' : r.gap > 0 ? 'text-blue-600' : 'text-gray-600'}">
								{r.gap > 0 ? '+' : ''}{fmt1(r.gap)}
							</td>
							<td class="px-4 py-3 text-center">
								<span class="px-2.5 py-1 rounded-full text-xs font-semibold {gap.c}">{gap.l}</span>
							</td>
							<td class="px-4 py-3 text-center">
								<button
									type="button"
									onclick={() => (expandedProjectId = expandedProjectId === r.projectId ? null : r.projectId)}
									class="inline-flex items-center gap-1 text-[12px] font-semibold text-green-700 hover:underline"
								>
									{expandedProjectId === r.projectId ? 'Tutup' : 'Per Hari'}
									{#if expandedProjectId === r.projectId}<IconChevronUp size={14} />{:else}<IconChevronDown size={14} />{/if}
								</button>
							</td>
						</tr>
						{#if expandedProjectId === r.projectId}
							<tr>
								<td colspan="6" class="px-4 py-3 bg-gray-50">
									<div class="flex flex-wrap gap-2">
										{#each r.daily as d}
											{@const dGap = d.realisasi - d.rencana}
											<div class="px-3 py-2 rounded-lg border text-center min-w-[72px] {dGap < 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}">
												<p class="text-[10px] text-gray-400">{fmtDateShort(d.day)}</p>
												<p class="text-[13px] font-bold text-gray-800">{d.realisasi}/{d.rencana}</p>
											</div>
										{/each}
									</div>
									<div class="flex items-center gap-3 mt-3">
										<a href={`/proyek/${r.projectId}?tab=laporan&sub=laporan-harian`} class="inline-block text-[12px] font-semibold text-green-700 hover:underline">Lihat Laporan Harian Proyek</a>
										<button
											type="button"
											onclick={() => (quickAttendanceProjectId = r.projectId)}
											class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 transition shadow-xs"
										>
											<IconBolt size={13} /> ⚡ Presensi Cepat Hari Ini
										</button>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

{#if quickAttendanceProjectId}
	<ManualAbsensiModal
		projectId={quickAttendanceProjectId}
		onClose={() => (quickAttendanceProjectId = null)}
		onSuccess={() => {
			quickAttendanceProjectId = null;
			load();
		}}
	/>
{/if}
