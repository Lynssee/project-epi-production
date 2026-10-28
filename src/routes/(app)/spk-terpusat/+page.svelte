<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// SPK Jatuh Tempo Terpusat — penugasan manpower (SPK) yang mendekati/lewat tanggal berakhir,
	// lintas SEMUA proyek yang dipegang user. Pola & aging bucket disalin dari Kontrak Jatuh
	// Tempo Terpusat (/kontrak-terpusat) supaya kategori identik lintas laporan terpusat.
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getAssignmentExpiryForProjects, type AssignmentExpiryRow } from '$lib/services/manpowerAssignment';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let assignments = $state<AssignmentExpiryRow[]>([]);
	let agingFilter = $state<'' | 'expired' | 'under7' | 'd7to30' | 'over30'>('');

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(true)) || [];
			const projectIds = projects.map((p) => p.id);
			assignments = await getAssignmentExpiryForProjects(projectIds);
		} finally {
			loading = false;
		}
	}

	function daysUntil(dateStr: string | null) {
		if (!dateStr) return null;
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const target = new Date(dateStr);
		return Math.round((target.getTime() - today.getTime()) / 86400000);
	}

	// SPK biasanya jangka pendek (mingguan/bulanan) — bucket lebih rapat dibanding kontrak
	// proyek-customer (yang tahunan), supaya "segera habis" tidak baru muncul H-1.
	function agingBucket(row: AssignmentExpiryRow): '' | 'expired' | 'under7' | 'd7to30' | 'over30' {
		if (!row.tanggal_selesai) return '';
		const d = daysUntil(row.tanggal_selesai);
		if (d === null) return '';
		if (d < 0) return 'expired';
		if (d < 7) return 'under7';
		if (d <= 30) return 'd7to30';
		return 'over30';
	}

	let rows = $derived(
		assignments
			.map((a) => ({ ...a, _aging: agingBucket(a), _sisaHari: daysUntil(a.tanggal_selesai) }))
			.filter((r) => !agingFilter || r._aging === agingFilter)
	);

	let agingCounts = $derived.by(() => {
		const counts = { expired: 0, under7: 0, d7to30: 0, over30: 0 };
		for (const a of assignments) {
			const bucket = agingBucket(a);
			if (bucket) counts[bucket]++;
		}
		return counts;
	});

	function fmtDate(d: string | null) {
		return d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
	}

	function namaPekerja(row: AssignmentExpiryRow) {
		return row.manpower_id?.nama || `#${row.manpower_id?.id ?? row.manpower_id}`;
	}
	function namaProyek(row: AssignmentExpiryRow) {
		return row.project_id?.name || `Proyek #${row.project_id?.id ?? row.project_id}`;
	}
	function projectIdOf(row: AssignmentExpiryRow) {
		return row.project_id?.id ?? row.project_id;
	}

	const AGING_LABEL: Record<string, string> = { expired: 'Expired', under7: '< 7 Hari', d7to30: '7-30 Hari', over30: '> 30 Hari' };
	const AGING_BADGE: Record<string, string> = {
		expired: 'bg-red-100 text-red-700',
		under7: 'bg-rose-100 text-rose-700',
		d7to30: 'bg-amber-100 text-amber-700',
		over30: 'bg-green-100 text-green-700'
	};
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
	<div>
		<a href="/proyek" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
			<IconArrowLeft size={14} /> List Project
		</a>
		<h1 class="text-xl font-bold text-gray-900">SPK Jatuh Tempo Terpusat</h1>
		<p class="text-sm text-gray-500">Penugasan manpower (SPK) aktif yang mendekati/lewat tanggal berakhir dari semua proyek Anda.</p>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<button
			type="button"
			onclick={() => (agingFilter = '')}
			class="px-3 py-1.5 rounded-xl text-[11px] font-bold border {agingFilter === '' ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}"
		>
			Semua ({assignments.length})
		</button>
		{#each Object.entries(AGING_LABEL) as [key, label]}
			<button
				type="button"
				onclick={() => (agingFilter = key as typeof agingFilter)}
				class="px-3 py-1.5 rounded-xl text-[11px] font-bold border {agingFilter === key ? AGING_BADGE[key] + ' border-transparent' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}"
			>
				{label} ({agingCounts[key as keyof typeof agingCounts]})
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat daftar SPK terpusat..." />
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum ditugaskan ke proyek manapun.</p>
		</div>
	{:else if rows.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Tidak ada SPK yang cocok dengan filter.</p>
		</div>
	{:else}
		<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
			<table class="w-full text-[13px]">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Nomor SPK</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Pekerja</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Jabatan</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Tanggal Berakhir</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Sisa Hari</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Aging</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Aksi</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each rows as r (r.id)}
						<tr class="hover:bg-gray-50">
							<td class="px-4 py-3 font-medium text-gray-800">{namaProyek(r)}</td>
							<td class="px-4 py-3 text-gray-600">{r.nomor_spk || '-'}</td>
							<td class="px-4 py-3 text-gray-700">{namaPekerja(r)}</td>
							<td class="px-4 py-3 text-gray-600">{r.jabatan || '-'}</td>
							<td class="px-4 py-3 text-gray-600">{fmtDate(r.tanggal_selesai)}</td>
							<td class="px-4 py-3 text-center text-gray-700">{r._sisaHari ?? '-'}</td>
							<td class="px-4 py-3 text-center">
								{#if r._aging}
									<span class="px-2.5 py-1 rounded-full text-xs font-semibold {AGING_BADGE[r._aging]}">{AGING_LABEL[r._aging]}</span>
								{:else}
									<span class="text-gray-400">-</span>
								{/if}
							</td>
							<td class="px-4 py-3 text-center">
								<a href={`/proyek/${projectIdOf(r)}?tab=keuangan`} class="text-[12px] font-semibold text-green-700 hover:underline">Lihat Proyek</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
