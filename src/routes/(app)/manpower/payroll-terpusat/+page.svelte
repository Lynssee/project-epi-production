<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Payroll Terpusat (Fase 1 Modul Operasional Terpusat) — rekap gajian manpower lintas SEMUA
	// proyek yang dipegang user (leader/wakil), supaya tidak perlu buka proyek satu-satu untuk
	// tahu payroll mana yang menunggu dibayar. Reuse total: getPayrollRunsForProjects dari
	// manpowerPayroll.ts, getProjectsForCurrentUser dari projectScope.ts (least-privilege bawaan),
	// dan ProjectPayrollRecap.svelte (logic buat payroll TIDAK ditulis ulang) di dalam modal.
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconPlus, IconX } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getPayrollRunsForProjects, getPayrollUrgency } from '$lib/services/manpowerPayroll';
	import ProjectPayrollRecap from '$lib/components/project/ProjectPayrollRecap.svelte';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let payrolls = $state<any[]>([]);

	let statusFilter = $state('');
	let projectFilter = $state('');
	// Riwayat gaji per pekerja — sebelumnya tidak ada cara melihat histori slip 1 pekerja lintas
	// periode/proyek dari sisi lapangan (leader harus tanya pekerja atau buka proyek satu-satu).
	// Daftar ini sudah lintas semua proyek yang dipegang leader, jadi tinggal filter nama.
	let pekerjaSearch = $state('');

	let showCreateModal = $state(false);
	let createProjectId = $state('');

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(true)) || [];
			const projectIds = projects.map((p) => p.id);
			const res = await getPayrollRunsForProjects(projectIds, statusFilter ? { status: statusFilter } : {});
			payrolls = res.success ? res.data : [];
		} finally {
			loading = false;
		}
	}

	let rows = $derived(
		payrolls.filter((p) => {
			const pid = typeof p.project_id === 'object' ? p.project_id?.id : p.project_id;
			if (projectFilter && String(pid) !== String(projectFilter)) return false;
			if (pekerjaSearch.trim()) {
				const nm = (typeof p.manpower_id === 'object' ? p.manpower_id?.nama : '') || '';
				if (!nm.toLowerCase().includes(pekerjaSearch.trim().toLowerCase())) return false;
			}
			return true;
		})
	);

	// Gaji tertunda — dulu status urgensi cuma dihitung di dashboard admin (erp-epi), leader di
	// lapangan tidak tahu slip mana yang sudah lewat perkiraan tanggal bayar sampai ditanya
	// pekerja. Logika sama persis dengan getPayrollUrgency() erp-epi.
	function urgencyOf(p: any) {
		const project = typeof p.project_id === 'object' ? p.project_id : null;
		return getPayrollUrgency(p, project);
	}
	let overdueCount = $derived(rows.filter((p) => urgencyOf(p).level === 'overdue').length);

	// Ringkasan riwayat saat pencarian nama aktif dan hasilnya konsisten 1 pekerja — total
	// akumulasi & jumlah slip, supaya leader tidak perlu jumlah manual satu-satu.
	let riwayatSummary = $derived.by(() => {
		if (!pekerjaSearch.trim() || rows.length === 0) return null;
		const namaSet = new Set(rows.map((p) => (typeof p.manpower_id === 'object' ? p.manpower_id?.nama : null) || '-'));
		if (namaSet.size !== 1) return null;
		const totalDiterima = rows.filter((p) => p.status === 'dibayar').reduce((sum, p) => sum + Number(p.total_dibayar || 0), 0);
		return { nama: [...namaSet][0], slipCount: rows.length, dibayarCount: rows.filter((p) => p.status === 'dibayar').length, totalDiterima };
	});

	const PST: Record<string, { l: string; c: string }> = {
		draft: { l: 'Draft', c: 'bg-gray-100 text-gray-600' },
		disetujui: { l: 'Disetujui', c: 'bg-yellow-100 text-yellow-800' },
		dibayar: { l: 'Dibayar', c: 'bg-green-100 text-green-700' }
	};

	const URGENCY: Record<string, { l: string; c: string }> = {
		ontime: { l: 'Tepat waktu', c: 'bg-blue-100 text-blue-700' },
		warning: { l: 'Segera', c: 'bg-amber-100 text-amber-800' },
		overdue: { l: '⚠️ Terlambat', c: 'bg-red-100 text-red-700' },
		unknown: { l: 'Per Termin', c: 'bg-gray-100 text-gray-500' },
		done: { l: '', c: '' }
	};

	function nama(p: any) {
		return typeof p.manpower_id === 'object' ? p.manpower_id?.nama || '-' : `#${p.manpower_id}`;
	}
	function projectNama(p: any) {
		return typeof p.project_id === 'object' ? p.project_id?.name || '-' : `#${p.project_id}`;
	}
	// Fase 3 — konteks kerja (project = default; non-proyek tampil badge).
	const WC_LABEL: Record<string, { l: string; c: string }> = {
		project: { l: 'Proyek', c: 'bg-slate-100 text-slate-600' },
		maintenance: { l: 'Maintenance', c: 'bg-amber-100 text-amber-700' },
		csr: { l: 'CSR', c: 'bg-emerald-100 text-emerald-700' },
		internal: { l: 'Internal', c: 'bg-indigo-100 text-indigo-700' }
	};
	function wcType(p: any) {
		return p.work_context_type || 'project';
	}
	function wcBadge(p: any) {
		return WC_LABEL[wcType(p)] || WC_LABEL.project;
	}
	function projectId(p: any) {
		return typeof p.project_id === 'object' ? p.project_id?.id : p.project_id;
	}
	function fmtRp(v: number) {
		return v == null || isNaN(v) ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(v);
	}
	function fmtDate(d: string) {
		return d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' }) : '-';
	}
	// F4.3: tahap approval PA (manager_proyek/HRD/finance/direktur) untuk rekap yang sudah
	// disetujui — current_stage disinkron live oleh approvalEngine.js di ERP, dibaca apa
	// adanya (bukan dihitung ulang di sini).
	function stageLabel(p: any): string | null {
		if (p.status !== 'disetujui') return null;
		const pa = p.pengajuan_anggaran_id;
		if (!pa || typeof pa !== 'object') return null;
		if (pa.status === 'Approved') return 'Lolos approval — menunggu transfer';
		if (pa.status === 'Rejected') return 'Ditolak di approval';
		return pa.current_stage ? `Menunggu ${pa.current_stage}` : null;
	}

	function openCreateModal() {
		createProjectId = projects[0] ? String(projects[0].id) : '';
		showCreateModal = true;
	}

	function closeCreateModal() {
		// ProjectPayrollRecap tidak mengekspos callback "selesai diproses" ke parent (ia hanya
		// memanggil loadData miliknya sendiri) — jadi refresh daftar terpusat saat modal ditutup,
		// bukan real-time selama modal terbuka.
		showCreateModal = false;
		load();
	}
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
	<div class="flex items-center justify-between gap-3">
		<div>
			<a href="/manpower" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
				<IconArrowLeft size={14} /> Manpower & Project Leader
			</a>
			<h1 class="text-xl font-bold text-gray-900">Payroll Terpusat</h1>
			<p class="text-sm text-gray-500">Rekap gajian manpower dari semua proyek yang Anda pegang.</p>
		</div>
		<button
			class="h-[40px] px-4 rounded-xl bg-green-600 text-white font-semibold text-[13px] hover:bg-green-700 transition-colors flex items-center gap-2 shrink-0 disabled:opacity-50"
			onclick={openCreateModal}
			disabled={projects.length === 0}
		>
			<IconPlus size={16} /> Buat Payroll Baru
		</button>
	</div>

	{#if overdueCount > 0}
		<div class="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 flex items-center gap-2 text-[13px] text-red-800">
			<span class="text-lg">⚠️</span>
			<span><strong>{overdueCount}</strong> gajian sudah lewat perkiraan tanggal bayar (&gt;3 hari dari akhir periode + siklus bayar proyek). Segera proses atau hubungi Finance.</span>
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-2">
		<select bind:value={statusFilter} onchange={load} class="f-select bg-white h-[38px] text-[13px] border-gray-200">
			<option value="">Semua Status</option>
			<option value="draft">Draft</option>
			<option value="disetujui">Disetujui</option>
			<option value="dibayar">Dibayar</option>
		</select>
		<select bind:value={projectFilter} class="f-select bg-white h-[38px] text-[13px] border-gray-200">
			<option value="">Semua Proyek</option>
			{#each projects as p}<option value={String(p.id)}>{p.name}</option>{/each}
		</select>
		<input
			type="text"
			bind:value={pekerjaSearch}
			placeholder="Cari nama pekerja — lihat riwayat gaji lintas proyek/periode"
			class="f-input bg-white h-[38px] text-[13px] border-gray-200 min-w-[220px]"
			title="Ketik nama pekerja untuk melihat semua slip gaji yang pernah diterima, lintas proyek yang Anda pegang"
		/>
	</div>

	{#if riwayatSummary}
		<div class="bg-indigo-50 border border-indigo-200 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px] text-indigo-800">
			<span>📋 Riwayat <strong>{riwayatSummary.nama}</strong></span>
			<span>{riwayatSummary.slipCount} slip ({riwayatSummary.dibayarCount} sudah dibayar)</span>
			<span>Total diterima: <strong>{fmtRp(riwayatSummary.totalDiterima)}</strong></span>
		</div>
	{/if}

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat payroll terpusat..." />
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum memegang proyek sebagai leader/wakil manpower.</p>
		</div>
	{:else if rows.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Belum ada rekap gajian yang cocok dengan filter.</p>
		</div>
	{:else}
		<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
			<table class="w-full text-[13px]">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Manpower</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Periode</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">Total</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Status</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Urgensi</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Proyek</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each rows as p (p.id)}
						<tr class="hover:bg-gray-50">
							<td class="px-4 py-3 font-medium text-gray-800">
							{projectNama(p)}
							{#if wcType(p) !== 'project'}
								<span class="ml-1 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold {wcBadge(p).c}">{wcBadge(p).l}</span>
							{/if}
						</td>
							<td class="px-4 py-3 text-gray-700">{nama(p)}<p class="text-[10px] text-gray-400 font-mono">{p.slip_no}</p></td>
							<td class="px-4 py-3 text-gray-600 text-[12px] whitespace-nowrap">{fmtDate(p.periode_mulai)} – {fmtDate(p.periode_selesai)}</td>
							<td class="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtRp(p.total_dibayar)}</td>
							<td class="px-4 py-3 text-center">
								<span class="px-2.5 py-1 rounded-full text-xs font-semibold {(PST[p.status]||PST.draft).c}">{(PST[p.status]||PST.draft).l}</span>
								{#if stageLabel(p)}
									<p class="text-[10px] text-gray-400 mt-1">{stageLabel(p)}</p>
								{/if}
							</td>
							<td class="px-4 py-3 text-center">
								{#if urgencyOf(p).level !== 'done'}
									<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold {URGENCY[urgencyOf(p).level].c}">{URGENCY[urgencyOf(p).level].l}</span>
								{/if}
							</td>
							<td class="px-4 py-3 text-center">
								<a href={`/proyek/${projectId(p)}?tab=keuangan&sub=gajian`} class="text-[12px] font-semibold text-green-700 hover:underline">Lihat Proyek</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- ── Buat Payroll Baru: pilih proyek, lalu embed ProjectPayrollRecap apa adanya (bukan tulis
     ulang logic) ── -->
{#if showCreateModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-white rounded-2xl w-full max-w-6xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
			<div class="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
				<div class="flex items-center gap-3">
					<h3 class="font-bold text-gray-800 text-[15px]">Buat Payroll Baru</h3>
					<select bind:value={createProjectId} class="f-select bg-gray-50 border-gray-200 h-[34px] text-[13px]">
						{#each projects as p}<option value={String(p.id)}>{p.name}</option>{/each}
					</select>
				</div>
				<button class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors" onclick={closeCreateModal}>
					<IconX size={18} />
				</button>
			</div>
			<div class="p-5 overflow-y-auto grow">
				{#if createProjectId}
					{#key createProjectId}
						<ProjectPayrollRecap
							projectId={Number(createProjectId)}
							projectName={projects.find((p) => String(p.id) === createProjectId)?.name || ''}
						/>
					{/key}
				{/if}
			</div>
		</div>
	</div>
{/if}
