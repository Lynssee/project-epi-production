<!-- src/routes/(app)/inventory-proyek/opname/+page.svelte -->
<!-- Fase 1 (Rencana Implementasi Inventory Proyek v2.0, 24 Juli 2026): opname fisik pembuka
     untuk proyek pilot. Hasil jadi saldo awal begitu project_stock_ledger dibuat di Fase 2. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import { loadMleSettings, getMleSetting } from '$lib/services/mleSettings';
	import {
		fetchOpnameItems,
		submitOpname,
		signOpname,
		finalizeOpnameLedger,
		fetchOpnameSessions,
		rebuildProjectStockBalance,
		fetchProjectStockBalance,
		type OpnameItem,
		type OpnameSession,
		type ProjectStockBalanceRow
	} from '$lib/services/inventoryProyekOpname';

	let sessions = $state<OpnameSession[]>([]);
	let myPilotIds = $state<number[]>([]);
	let pilotProjects = $state<Array<{ id: number; name: string }>>([]);
	let userProjects = $state<Array<{ id: number; name: string }>>([]);
	let userRole = $state<string>('');
	let userKaryawan = $state<string>('');
	let loadingSessions = $state(true);

	let selectedProjectId = $state<number | null>(null);
	let selectedProjectName = $derived(
		pilotProjects.find((p) => p.id === selectedProjectId)?.name ||
		userProjects.find((p) => p.id === selectedProjectId)?.name ||
		`Proyek #${selectedProjectId}`
	);

	let items = $state<OpnameItem[]>([]);
	let physicalQty = $state<Record<number, string>>({});
	let notes = $state<Record<number, string>>({});
	let loadingItems = $state(false);
	let error = $state('');

	let step: 'pilih_proyek' | 'hitung' | 'ttd' | 'selesai' = $state('pilih_proyek');
	let submitting = $state(false);
	let signaturePad: any;
	let pendingEnvelopeId: number | null = $state(null);

	let searchQuery = $state('');
	let filteredItems = $derived(
		items.filter((it) =>
			it.material_name.toLowerCase().includes(searchQuery.toLowerCase().trim())
		)
	);

	// Stats derivation
	let filledCount = $derived(
		items.filter((it) => physicalQty[it.project_budget_id] !== undefined && physicalQty[it.project_budget_id] !== '').length
	);
	let varianceCount = $derived(
		items.filter((it) => {
			const val = parseFloat(physicalQty[it.project_budget_id]);
			return !isNaN(val) && val !== (it.rab_qty || 0);
		}).length
	);

	let expandedStockProjectId = $state<number | null>(null);
	let stockRows = $state<ProjectStockBalanceRow[]>([]);
	let loadingStock = $state(false);
	let stockError = $state('');
	// Fase 1 MLE (10 Agu 2026, "Lapangan" round): ambang stok menipis dari mle.material.low_stock_default_pct
	let lowStockPct = $state(20);

	/** Menipis = qty_on_hand <= lowStockPct% dari rab_qty (dan rab_qty > 0, supaya tidak salah tandai item tanpa RAB). */
	function isLowStock(r: ProjectStockBalanceRow) {
		const rab = r.rab_qty || 0;
		if (rab <= 0) return false;
		return (r.qty_on_hand ?? 0) <= (rab * lowStockPct) / 100;
	}

	async function loadSessions() {
		loadingSessions = true;
		error = '';
		try {
			const result = await fetchOpnameSessions();
			sessions = result.sessions || [];
			myPilotIds = result.pilotProjectIds || [];
			pilotProjects = result.pilotProjects || [];
			userProjects = result.userProjects || [];
			userRole = result.userRole || '';
			userKaryawan = result.userKaryawan || '';
		} catch (e: any) {
			error = e?.message || 'Gagal memuat riwayat opname';
		} finally {
			loadingSessions = false;
		}
	}

	function sudahOpname(projectId: number) {
		return sessions.some((s) => s.data_snapshot?.projectId === projectId && (s.status === 'selesai' || s.status === 'menunggu'));
	}

	function getSessionForProject(projectId: number) {
		return sessions.find((s) => s.data_snapshot?.projectId === projectId);
	}

	async function toggleStok(projectId: number) {
		if (expandedStockProjectId === projectId) {
			expandedStockProjectId = null;
			return;
		}
		expandedStockProjectId = projectId;
		loadingStock = true;
		stockError = '';
		try {
			await rebuildProjectStockBalance(projectId);
			stockRows = await fetchProjectStockBalance(projectId);
		} catch (e: any) {
			stockError = e?.message || 'Gagal memuat stok proyek';
		} finally {
			loadingStock = false;
		}
	}

	async function pilihProyek(projectId: number) {
		selectedProjectId = projectId;
		loadingItems = true;
		error = '';
		searchQuery = '';
		try {
			items = await fetchOpnameItems(projectId);
			physicalQty = Object.fromEntries(items.map((it) => [it.project_budget_id, '']));
			notes = Object.fromEntries(items.map((it) => [it.project_budget_id, '']));
			step = 'hitung';
		} catch (e: any) {
			error = e?.message || 'Gagal memuat item';
		} finally {
			loadingItems = false;
		}
	}

	function setSemuaSesuaiRAB() {
		for (const it of items) {
			physicalQty[it.project_budget_id] = String(it.rab_qty || 0);
		}
	}

	function lanjutKeTtd() {
		const belumDiisi = items.filter((it) => physicalQty[it.project_budget_id] === undefined || physicalQty[it.project_budget_id] === '');
		if (belumDiisi.length > 0) {
			if (!confirm(`${belumDiisi.length} item belum diisi qty fisiknya. Anggap angka 0? (Bisa disesuaikan kembali nanti)`)) return;
			for (const it of belumDiisi) physicalQty[it.project_budget_id] = '0';
		}
		step = 'ttd';
	}

	async function submitDanTandaTangan() {
		if (!selectedProjectId) return;
		if (!signaturePad || signaturePad.isEmpty()) {
			error = 'Tanda tangan digital wajib diisi.';
			return;
		}
		submitting = true;
		error = '';
		try {
			const payload = items.map((it) => ({
				project_budget_id: it.project_budget_id,
				identitas_barang_id: it.identitas_barang_id,
				material_name: it.material_name,
				unit: it.unit,
				rab_qty: it.rab_qty,
				physical_qty: parseFloat(physicalQty[it.project_budget_id]) || 0,
				notes: notes[it.project_budget_id] || undefined
			}));

			const { envelopeId } = await submitOpname(selectedProjectId, payload);
			pendingEnvelopeId = envelopeId;

			const ttdDataUrl = signaturePad.toDataURL();
			await signOpname(envelopeId, ttdDataUrl);
			await finalizeOpnameLedger(envelopeId).catch((e) => {
				console.error('Gagal finalisasi ledger opname (tanda tangan tetap tersimpan):', e);
			});

			step = 'selesai';
			await loadSessions();
		} catch (e: any) {
			error = e?.message || 'Gagal menyimpan opname.';
		} finally {
			submitting = false;
		}
	}

	function mulaiLagi() {
		step = 'pilih_proyek';
		selectedProjectId = null;
		items = [];
		error = '';
		searchQuery = '';
	}

	onMount(async () => {
		await loadSessions();
		await loadMleSettings();
		lowStockPct = Number(getMleSetting('mle.material.low_stock_default_pct')) || 20;
	});
</script>

<div class="max-w-4xl mx-auto p-4 md:p-6 space-y-6 text-slate-100">
	<!-- Page Header -->
	<div class="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-sm">
		<div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
			<div>
				<div class="flex items-center gap-2.5">
					<div class="p-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
						📦
					</div>
					<div>
						<h1 class="text-xl font-bold text-white tracking-tight">Opname Fisik Pembuka</h1>
						<p class="text-xs text-slate-400 mt-0.5">
							Pencatatan awal inventory proyek pilot. Hasil opname menjadi Saldo Awal Ledger Proyek resmi.
						</p>
					</div>
				</div>
			</div>
			{#if userKaryawan}
				<div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs shrink-0">
					<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
					<span class="text-slate-300 font-medium">{userKaryawan}</span>
					{#if userRole}
						<span class="px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 text-[10px] uppercase font-semibold border border-blue-700/40">
							{userRole.replace('_', ' ')}
						</span>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Interactive Stepper -->
		<div class="mt-6 pt-5 border-t border-slate-800/80">
			<div class="grid grid-cols-4 gap-2 text-center text-xs font-medium">
				<div class="flex flex-col items-center gap-1.5 {step === 'pilih_proyek' ? 'text-blue-400 font-semibold' : 'text-slate-500'}">
					<div class="w-7 h-7 rounded-full flex items-center justify-center border text-xs transition-all {step === 'pilih_proyek' ? 'bg-blue-600 border-blue-400 text-white shadow-md shadow-blue-600/30 ring-2 ring-blue-500/20' : step !== 'pilih_proyek' ? 'bg-emerald-950 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700'}">
						{step !== 'pilih_proyek' ? '✓' : '1'}
					</div>
					<span>1. Pilih Proyek</span>
				</div>
				<div class="flex flex-col items-center gap-1.5 {step === 'hitung' ? 'text-blue-400 font-semibold' : 'text-slate-500'}">
					<div class="w-7 h-7 rounded-full flex items-center justify-center border text-xs transition-all {step === 'hitung' ? 'bg-blue-600 border-blue-400 text-white shadow-md shadow-blue-600/30 ring-2 ring-blue-500/20' : step === 'ttd' || step === 'selesai' ? 'bg-emerald-950 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700'}">
						{step === 'ttd' || step === 'selesai' ? '✓' : '2'}
					</div>
					<span>2. Hitung Fisik</span>
				</div>
				<div class="flex flex-col items-center gap-1.5 {step === 'ttd' ? 'text-blue-400 font-semibold' : 'text-slate-500'}">
					<div class="w-7 h-7 rounded-full flex items-center justify-center border text-xs transition-all {step === 'ttd' ? 'bg-blue-600 border-blue-400 text-white shadow-md shadow-blue-600/30 ring-2 ring-blue-500/20' : step === 'selesai' ? 'bg-emerald-950 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700'}">
						{step === 'selesai' ? '✓' : '3'}
					</div>
					<span>3. Tanda Tangan</span>
				</div>
				<div class="flex flex-col items-center gap-1.5 {step === 'selesai' ? 'text-emerald-400 font-semibold' : 'text-slate-500'}">
					<div class="w-7 h-7 rounded-full flex items-center justify-center border text-xs transition-all {step === 'selesai' ? 'bg-emerald-600 border-emerald-400 text-white shadow-md shadow-emerald-600/30 ring-2 ring-emerald-500/20' : 'bg-slate-800 border-slate-700'}">
						4
					</div>
					<span>4. Selesai</span>
				</div>
			</div>
		</div>
	</div>

	<!-- Error Alert -->
	{#if error}
		<div class="p-4 rounded-xl bg-red-950/80 border border-red-800/80 text-red-200 text-sm flex items-start gap-3 shadow-lg">
			<span class="text-lg leading-none">⚠️</span>
			<div class="flex-1">{error}</div>
		</div>
	{/if}

	<!-- STEP 1: PILIH PROYEK -->
	{#if step === 'pilih_proyek'}
		{#if loadingSessions}
			<CircularProgressGauge size={52} strokeWidth={4} label="Memuat data opname dan proyek pilot..." />
		{:else if myPilotIds.length === 0}
			<!-- Informative Non-Pilot Guidance Card -->
			<div class="bg-slate-900/90 border border-amber-500/30 rounded-xl p-6 shadow-xl space-y-5">
				<div class="flex items-start gap-4">
					<div class="p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20 shrink-0 text-xl">
						ℹ️
					</div>
					<div class="space-y-1">
						<h2 class="text-lg font-bold text-amber-200">Akses Opname Pembuka Terbatas (Fase 1 Pilot)</h2>
						<p class="text-sm text-slate-300 leading-relaxed">
							Saat ini fitur **Opname Fisik Pembuka** berada pada tahap uji coba terbatas (**Pilot Fase 1**). Hanya Project Leader atau Staff terdaftar pada proyek pilot yang dapat melakukan opname saldo awal.
						</p>
					</div>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
					<!-- Active Pilot Projects -->
					<div class="bg-slate-950/60 border border-slate-800 rounded-lg p-4 space-y-2.5">
						<div class="text-xs font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
							<span>📌 Proyek Pilot Aktif saat ini:</span>
						</div>
						{#if pilotProjects.length > 0}
							<ul class="space-y-1.5 text-xs">
								{#each pilotProjects as p}
									<li class="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800/80">
										<span class="font-medium text-slate-200">{p.name}</span>
										<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/50"># {p.id}</span>
									</li>
								{/each}
							</ul>
						{:else}
							<div class="text-xs text-slate-500">Belum ada proyek pilot terkonfigurasi.</div>
						{/if}
					</div>

					<!-- User Assigned Projects -->
					<div class="bg-slate-950/60 border border-slate-800 rounded-lg p-4 space-y-2.5">
						<div class="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
							<span>👷 Proyek Yang Anda Ampu:</span>
						</div>
						{#if userProjects.length > 0}
							<ul class="space-y-1.5 text-xs">
								{#each userProjects as p}
									<li class="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800/80">
										<span class="font-medium text-slate-300">{p.name}</span>
										<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700"># {p.id}</span>
									</li>
								{/each}
							</ul>
						{:else}
							<div class="text-xs text-slate-500">Anda belum tercatat sebagai Leader aktif di sistem.</div>
						{/if}
					</div>
				</div>

				<div class="p-3.5 bg-slate-950/80 rounded-lg border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
					<span>Diperlukan penambahan proyek Anda ke Fase 1 Pilot?</span>
					<span class="text-blue-400 font-medium">Hubungi Admin Sistem / IT &rarr;</span>
				</div>
			</div>
		{:else}
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wider">Pilih Proyek Pilot Anda ({myPilotIds.length})</h2>
					<button onclick={loadSessions} class="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
						<span>🔄 Refresh Sesi</span>
					</button>
				</div>

				<div class="grid grid-cols-1 gap-3">
					{#each pilotProjects.filter((p) => myPilotIds.includes(p.id)) as p (p.id)}
						{@const isDone = sudahOpname(p.id)}
						{@const sess = getSessionForProject(p.id)}
						<div class="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-xl overflow-hidden shadow-md transition-all">
							<div class="flex flex-col md:flex-row md:items-center justify-between p-4 gap-4">
								<div class="space-y-1 flex-1">
									<div class="flex items-center gap-2">
										<span class="px-2 py-0.5 rounded bg-blue-950 text-blue-300 text-xs font-mono border border-blue-800/60">#{p.id}</span>
										<span class="font-bold text-white text-base">{p.name}</span>
									</div>
									{#if isDone && sess}
										<div class="text-xs text-slate-400 flex items-center gap-3">
											<span>Tercatat oleh: <strong class="text-slate-200">{sess.data_snapshot?.submittedBy || '-'}</strong></span>
											<span>&bull;</span>
											<span>Tanggal: {sess.date_created ? new Date(sess.date_created).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}</span>
										</div>
									{/if}
								</div>

								<div class="flex items-center gap-2 shrink-0">
									{#if isDone}
										<span class="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 font-medium flex items-center gap-1">
											<span>✓</span> Sudah Opname
										</span>
										<button
											onclick={() => toggleStok(p.id)}
											class="text-xs px-3 py-1.5 rounded-lg border border-blue-500/40 bg-blue-950/40 text-blue-300 hover:bg-blue-900/60 transition-all font-medium flex items-center gap-1.5"
										>
											<span>📦</span> {expandedStockProjectId === p.id ? 'Tutup Stok' : 'Lihat Stok'}
										</button>
									{:else}
										<button
											onclick={() => pilihProyek(p.id)}
											disabled={loadingItems}
											class="text-xs px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md shadow-blue-600/30 transition-all flex items-center gap-1.5"
										>
											<span>Mulai Opname</span> &rarr;
										</button>
									{/if}
								</div>
							</div>

							<!-- Expanded Stock Ledger Preview Drawer -->
							{#if expandedStockProjectId === p.id}
								<div class="border-t border-slate-800 bg-slate-950/80 p-4 space-y-3">
									<div class="flex items-center justify-between text-xs text-slate-400">
										<span class="font-semibold text-slate-300">Ringkasan Saldo Stok Proyek ({stockRows.length} material)</span>
										<span>Diperbarui dari project_stock_ledger</span>
									</div>

									{#if loadingStock}
										<div class="text-center py-6 text-slate-400 text-xs">Memuat saldo stok...</div>
									{:else if stockError}
										<div class="text-red-400 text-xs p-3 bg-red-950/50 rounded border border-red-800/60">{stockError}</div>
									{:else if stockRows.length === 0}
										<div class="text-slate-500 text-xs text-center py-6">Belum ada saldo stok tercatat untuk proyek ini.</div>
									{:else}
										<div class="overflow-x-auto">
											<table class="w-full text-xs text-left">
												<thead class="bg-slate-900 text-slate-400 border-b border-slate-800">
													<tr>
														<th class="p-2">Nama Barang</th>
														<th class="p-2 text-right">RAB Qty</th>
														<th class="p-2 text-right">Masuk (GR)</th>
														<th class="p-2 text-right">Terpakai</th>
														<th class="p-2 text-right">Stok Fisik (On Hand)</th>
													</tr>
												</thead>
												<tbody class="divide-y divide-slate-800/60">
													{#each stockRows as r}
														{@const low = isLowStock(r)}
														<tr class="hover:bg-slate-900/50 {low ? 'bg-amber-950/30' : ''}">
															<td class="p-2 font-medium text-slate-200">
															{r.item_id?.nama_barang_lengkap || '-'}
															{#if low}<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-900/60 text-amber-300 border border-amber-700/60 font-semibold ml-1.5">MENIPIS</span>{/if}
														</td>
															<td class="p-2 text-right text-slate-400">{r.rab_qty || 0}</td>
															<td class="p-2 text-right text-emerald-400">+{r.qty_received || 0}</td>
															<td class="p-2 text-right text-amber-400">-{r.qty_used || 0}</td>
															<td class="p-2 text-right font-bold {r.qty_on_hand < 0 ? 'text-red-400' : low ? 'text-amber-300' : 'text-white'}">
																{r.qty_on_hand} {r.item_id?.satuan || ''}
															</td>
														</tr>
													{/each}
												</tbody>
											</table>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

	<!-- STEP 2: HITUNG FISIK -->
	{:else if step === 'hitung'}
		<div class="space-y-4">
			<!-- Header step hitung -->
			<div class="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
				<div>
					<span class="text-xs text-blue-400 font-semibold uppercase tracking-wider">Proyek Terpilih</span>
					<h2 class="text-lg font-bold text-white">{selectedProjectName}</h2>
				</div>
				<div class="flex items-center gap-2">
					<button
						onclick={setSemuaSesuaiRAB}
						class="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
					>
						⚡ Isi Semua Qty = RAB
					</button>
					<button
						onclick={() => (step = 'pilih_proyek')}
						class="text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300"
					>
						&larr; Ganti Proyek
					</button>
				</div>
			</div>

			{#if loadingItems}
				<div class="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400 text-sm">
					Memuat item material proyek...
				</div>
			{:else if items.length === 0}
				<div class="p-5 rounded-xl bg-amber-950/80 border border-amber-800/80 text-amber-200 text-sm space-y-2">
					<p class="font-semibold">Belum Ada Item RAB Terpetakan</p>
					<p class="text-xs text-amber-300/80 leading-relaxed">
						Belum ada item RAB dengan identitas barang untuk proyek ini. Silakan hubungi tim Admin untuk melengkapi pemetaan material (Fase 0.7).
					</p>
				</div>
			{:else}
				<!-- Metrics Summary Bar & Search Filter -->
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
					<div class="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
						<div class="text-xs text-slate-400">Total Item RAB</div>
						<div class="text-lg font-bold text-white">{items.length}</div>
					</div>
					<div class="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
						<div class="text-xs text-slate-400">Sudah Diisi</div>
						<div class="text-lg font-bold text-blue-400">{filledCount} / {items.length}</div>
					</div>
					<div class="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
						<div class="text-xs text-slate-400">Item Ada Selisih (Varian)</div>
						<div class="text-lg font-bold {varianceCount > 0 ? 'text-amber-400' : 'text-emerald-400'}">{varianceCount}</div>
					</div>
				</div>

				<div class="relative">
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="🔍 Cari nama material..."
						class="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all"
					/>
				</div>

				<!-- Material Items Input Cards -->
				<div class="space-y-3 max-h-[500px] overflow-y-auto pr-1">
					{#each filteredItems as it (it.project_budget_id)}
						{@const pQty = parseFloat(physicalQty[it.project_budget_id])}
						{@const hasInput = physicalQty[it.project_budget_id] !== undefined && physicalQty[it.project_budget_id] !== ''}
						{@const selisih = hasInput && !isNaN(pQty) ? pQty - (it.rab_qty || 0) : null}

						<div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3 hover:border-slate-700 transition-all">
							<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
								<div>
									<h3 class="font-bold text-white text-sm">{it.material_name}</h3>
									<span class="text-xs text-slate-400">RAB Targets: <strong class="text-slate-200">{it.rab_qty || 0} {it.unit}</strong></span>
								</div>

								<!-- Variance Badge -->
								{#if selisih !== null}
									<div class="shrink-0">
										{#if selisih === 0}
											<span class="text-[11px] px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 font-medium">
												Sesuai RAB (0)
											</span>
										{:else if selisih > 0}
											<span class="text-[11px] px-2.5 py-1 rounded-full bg-blue-950 text-blue-300 border border-blue-800 font-medium">
												Surplus +{selisih} {it.unit}
											</span>
										{:else}
											<span class="text-[11px] px-2.5 py-1 rounded-full bg-amber-950 text-amber-300 border border-amber-800 font-medium">
												Defisit {Math.abs(selisih)} {it.unit}
											</span>
										{/if}
									</div>
								{/if}
							</div>

							<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
								<div>
									<label class="block text-[11px] text-slate-400 mb-1" for="qty-{it.project_budget_id}">Qty Fisik ({it.unit})</label>
									<input
										id="qty-{it.project_budget_id}"
										type="number"
										step="any"
										bind:value={physicalQty[it.project_budget_id]}
										placeholder="0"
										class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
									/>
								</div>
								<div class="sm:col-span-2">
									<label class="block text-[11px] text-slate-400 mb-1" for="notes-{it.project_budget_id}">Catatan Kondisi / Keterangan (Opsional)</label>
									<input
										id="notes-{it.project_budget_id}"
										type="text"
										bind:value={notes[it.project_budget_id]}
										placeholder="Misal: 2 pcs rusak di gudang site..."
										class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
									/>
								</div>
							</div>
						</div>
					{/each}
				</div>

				<div class="pt-3">
					<button
						onclick={lanjutKeTtd}
						class="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-600/30 transition-all text-sm flex items-center justify-center gap-2"
					>
						<span>Lanjut ke Verifikasi &amp; Tanda Tangan</span> &rarr;
					</button>
				</div>
			{/if}
		</div>

	<!-- STEP 3: TANDA TANGAN -->
	{:else if step === 'ttd'}
		<div class="space-y-5">
			<!-- Review Table -->
			<div class="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
				<h3 class="text-sm font-bold text-white flex items-center gap-2">
					<span>📋 Review Ringkasan Hitungan Opname</span>
				</h3>
				<p class="text-xs text-slate-400">
					Periksa kembali daftar fisik barang di bawah ini sebelum menandatangani snapshot opname secara resmi.
				</p>

				<div class="overflow-x-auto max-h-60 border border-slate-800 rounded-lg">
					<table class="w-full text-xs text-left">
						<thead class="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800">
							<tr>
								<th class="p-2.5">Material</th>
								<th class="p-2.5 text-right">RAB Qty</th>
								<th class="p-2.5 text-right">Qty Fisik</th>
								<th class="p-2.5 text-right">Selisih</th>
								<th class="p-2.5">Catatan</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-800/60">
							{#each items as it}
								{@const pQty = parseFloat(physicalQty[it.project_budget_id]) || 0}
								{@const diff = pQty - (it.rab_qty || 0)}
								<tr class="hover:bg-slate-800/40">
									<td class="p-2.5 font-medium text-slate-200">{it.material_name}</td>
									<td class="p-2.5 text-right text-slate-400">{it.rab_qty || 0} {it.unit}</td>
									<td class="p-2.5 text-right font-bold text-white">{pQty} {it.unit}</td>
									<td class="p-2.5 text-right font-semibold {diff === 0 ? 'text-slate-400' : diff > 0 ? 'text-blue-400' : 'text-amber-400'}">
										{diff > 0 ? `+${diff}` : diff}
									</td>
									<td class="p-2.5 text-slate-400 italic">{notes[it.project_budget_id] || '-'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

			<!-- Signature Pad Area -->
			<div class="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
				<div>
					<h3 class="text-sm font-bold text-white">Tanda Tangan Digital Project Leader</h3>
					<p class="text-xs text-slate-400 mt-0.5">
						Dengan menandatangani, Anda menyatakan hasil hitungan fisik di atas benar dan menjadi saldo awal resmi proyek.
					</p>
				</div>

				<div class="bg-slate-950 border border-slate-800 rounded-lg p-2 overflow-hidden">
					<SignaturePad bind:this={signaturePad} height={180} />
				</div>

				<div class="flex gap-3">
					<button
						onclick={() => (step = 'hitung')}
						disabled={submitting}
						class="flex-1 py-3 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm transition-all"
					>
						&larr; Kembali Edit Qty
					</button>
					<button
						onclick={submitDanTandaTangan}
						disabled={submitting}
						class="flex-1 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
					>
						{#if submitting}
							<span class="animate-spin">⏳</span> Menyimpan...
						{:else}
							<span>✓ Tandatangani &amp; Kirim</span>
						{/if}
					</button>
				</div>
			</div>
		</div>

	<!-- STEP 4: SELESAI -->
	{:else if step === 'selesai'}
		<div class="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-6">
			<div class="w-16 h-16 bg-emerald-950 border border-emerald-500/40 text-emerald-400 text-3xl rounded-full flex items-center justify-center mx-auto shadow-xl shadow-emerald-950">
				✓
			</div>

			<div class="space-y-1">
				<h2 class="text-xl font-bold text-white">Opname Fisik Pembuka Tersimpan!</h2>
				<p class="text-xs text-slate-400">
					Dokumen digital signature envelope #{pendingEnvelopeId || ''} berhasil dibuat dan ditandatangani.
				</p>
			</div>

			<div class="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 max-w-md mx-auto space-y-1 text-left">
				<div class="flex justify-between">
					<span class="text-slate-500">Proyek:</span>
					<span class="font-semibold text-white">{selectedProjectName}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-slate-500">Status Envelope:</span>
					<span class="text-emerald-400 font-semibold">Tersimpan &amp; Ditandatangani</span>
				</div>
			</div>

			<div class="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
				<button
					onclick={mulaiLagi}
					class="px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all"
				>
					Kembali ke Daftar Proyek
				</button>
			</div>
		</div>
	{/if}
</div>
