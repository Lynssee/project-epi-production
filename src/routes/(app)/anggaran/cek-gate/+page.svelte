<!-- src/routes/(app)/anggaran/cek-gate/+page.svelte — "Apakah saya siap mengajukan?"
     Fase 4 Lapangan #1 (Penajaman Pengajuan Anggaran v2, 18 Agu 2026). Endpoint
     /api/pengajuan-preflight sudah ada & fail-soft sejak Fase 3 lama — halaman ini
     murni UI ringkas + link dalam ke tempat yang perlu dilengkapi, nol logic gate baru.

     Fase 4 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — DIROMBAK: bukan lagi
     landing wajib, jadi "Kesiapan Proyek Saya" (tabel semua proyek x G9/G10/G11 dalam
     SATU request batch, /api/pengajuan/readiness-batch) sebagai konten utama. Cek
     skenario manual (kategori/nominal spesifik) yang lama dipertahankan sebagai
     seksi terpisah di bawah untuk kasus yang tidak tercakup readiness proyek saja. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { isDeferredGate, deferredHandlerLabel, contactHint, canRequestDispensasi } from '$lib/utils/paGateStage';
	import GateRequestDispensasi from '$lib/components/anggaran/GateRequestDispensasi.svelte';
	import DispensasiSayaCard from '$lib/components/anggaran/DispensasiSayaCard.svelte';
	import { IconArrowLeft, IconLoader2, IconSearch, IconChevronDown } from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { readItems } from '@directus/sdk';
	import directus from '$lib/services/directus';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { fetchReadinessBatch, invalidateReadinessCache } from '$lib/services/readinessBatch';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getKaryawanByEmail } from '$lib/services/karyawan';
	import { authStore } from '$lib/stores/auth';
	import { getBudgetCategories, type BudgetCategory } from '$lib/services/budgetCategory';

	let loading = $state(true);
	let checking = $state(false);
	let result = $state<any>(null);
	let showManualCheck = $state(false);

	// Fase 4 — Kesiapan Proyek Saya (batch)
	let readinessLoading = $state(true);
	let readiness = $state<any>(null);
	async function loadReadiness(projectList: any[], force = false) {
		readinessLoading = true;
		try {
			// Cache 2 menit (readinessBatch.ts); tombol "Muat ulang" memaksa ambil baru.
			if (force) invalidateReadinessCache();
			const data = await fetchReadinessBatch(projectList.map((p) => p.id), { force, includeSiap: true });
			// Tempelkan nama proyek dari daftar lapangan (readiness-batch hanya kembalikan
			// nama dari sisi admin -- fallback bila beda/kosong).
			const nameById = new Map(projectList.map((p) => [p.id, p.name]));
			readiness = {
				...data,
				projects: (data.projects || []).map((r: any) => ({ ...r, name: r.name || nameById.get(r.project_id) }))
			};
		} catch (e) {
			console.error('Gagal memuat kesiapan proyek:', e);
			readiness = null;
		} finally {
			readinessLoading = false;
		}
	}

	let departments = $state<{ id: number; nama_department: string }[]>([]);
	let departmentId = $state<number | null>(null);
	let projects = $state<any[]>([]);
	let selectedProject = $state('');
	let dispensasiRefresh = $state(0); // naik setelah permintaan terkirim -> kartu status memuat ulang
	let dispensasiGate = $state<string | null>(null); // gate yang sedang dimintakan dispensasi (modal GateRequestDispensasi)
	let kategori = $state('operasional');
	let nominal = $state(0);
	let lampiranAda = $state(false);

	// Fase 3 (Pengajuan Anggaran v3): kategori_belanja dikirim juga supaya hasil cek gate
	// mencerminkan kategori sesungguhnya yang akan dipilih di form /anggaran/baru.
	let categories = $state<BudgetCategory[]>([]);
	let selectedCategoryKode = $state<string | null>(null);
	let selectedCategory = $derived(categories.find((c) => c.kode === selectedCategoryKode) || null);

	onMount(async () => {
		try {
			const auth = $authStore;
			if (auth.user?.email) {
				const kary = await getKaryawanByEmail(auth.user.email);
				if (kary?.divisi) {
					const dRes = (await directus.request(
						readItems('department' as any, { filter: { is_active: { _eq: true } }, fields: ['id', 'nama_department'], limit: -1 })
					)) as any[];
					departments = dRes || [];
					const match = departments.find((d) => d.nama_department.trim().toUpperCase() === kary.divisi.trim().toUpperCase());
					if (match) departmentId = match.id;
				}
			}
			if (departments.length === 0) {
				const dRes = (await directus.request(
					readItems('department' as any, { filter: { is_active: { _eq: true } }, fields: ['id', 'nama_department'], limit: -1 })
				)) as any[];
				departments = dRes || [];
			}
			projects = (await getProjectsForCurrentUser(false)) || [];
			if (projects.length > 0) selectedProject = String(projects[0].id);
			categories = await getBudgetCategories();
		} catch (e) {
			console.error('Gagal memuat data awal:', e);
		} finally {
			loading = false;
		}
		if (projects.length > 0) loadReadiness(projects);
		else readinessLoading = false;
	});

	async function periksa() {
		checking = true;
		result = null;
		try {
			const token = await getIdToken();
			const res = await fetch('/api/pengajuan-preflight', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					department_id: departmentId,
					project_id: selectedProject ? Number(selectedProject) : null,
					kategori,
					kategori_belanja: selectedCategoryKode,
					items: [{ kategori_item: kategori === 'operasional' ? 'operasional' : 'lain_lain', total: Number(nominal) || 0 }],
					tanggal_dibutuhkan: new Date().toISOString().split('T')[0],
					lampiran_count: lampiranAda ? 1 : 0
				})
			});
			result = await res.json().catch(() => ({ available: false, reason: 'Respons tidak valid' }));
		} catch (e) {
			console.error('Gagal memeriksa gate:', e);
			result = { available: false, reason: 'Gagal menghubungi pemeriksa gate' };
		} finally {
			checking = false;
		}
	}

	function formatCurrency(val: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0);
	}

	// Link dalam per gate yang gagal — arahkan langsung ke tempat perbaikan, bukan cuma pesan.
	function linkFor(g: any): { href: string; label: string } | null {
		if (g.gate_key === 'G9' || g.gate_key === 'G10' || g.gate_key === 'G11') {
			return { href: `/project?tab=informasi&id=${selectedProject}`, label: 'Buka data proyek' };
		}
		if (g.gate_key === 'G12') {
			return { href: '/regu', label: 'Buka Regu Saya (isi absensi)' };
		}
		if (g.gate_key === 'G8') {
			return { href: '/anggaran/baru', label: 'Lanjut ke form pengajuan (unggah lampiran)' };
		}
		return null;
	}
</script>

<div class="flex-1 flex flex-col h-full">
	{#if loading}
		<CircularProgressGauge size={50} strokeWidth={4} label="Memeriksa status readiness gate..." />
	{:else}
		<div class="scroll-body px-4 py-4 max-w-3xl mx-auto w-full space-y-3">
			<div class="mb-2">
				<button
					type="button"
					onclick={() => goto('/anggaran')}
					class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
				>
					<IconArrowLeft size={16} />
					<span>Kembali ke Anggaran</span>
				</button>
				<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Kesiapan Proyek Saya</h2>
			</div>

			<!-- Fase 4 (Rencana v2 Shift-Left Gate Anggaran) — jawaban langsung "berapa proyek
			     saya yang siap diajukan anggarannya", 1 request batch, tanpa isi form dulu. -->
			<DispensasiSayaCard refreshKey={dispensasiRefresh} projectNames={Object.fromEntries(projects.map((p) => [String(p.id), p.name]))} />

			{#if readinessLoading}
				<div class="card-section flex items-center gap-2 text-[12px] text-gray-400">
					<IconLoader2 size={14} class="animate-spin" /> Memeriksa kesiapan proyek…
				</div>
			{:else if readiness && readiness.projects?.length > 0}
				<div class="card-section space-y-2">
					<div class="flex items-center justify-between">
						<span class="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
							{readiness.siap_count} dari {readiness.total_count} proyek siap diajukan
						</span>
						<button type="button" onclick={() => loadReadiness(projects, true)} class="text-[11px] font-semibold text-[var(--p)]" title="Ambil data terbaru (hasil disimpan 2 menit supaya hemat kuota)">🔄 Muat ulang</button>
					</div>
					<div class="space-y-1.5">
						{#each readiness.projects as p}
							<div class="flex items-center justify-between gap-2 p-2 rounded-lg {p.siap ? 'bg-emerald-50 dark:bg-emerald-950/20' : 'bg-amber-50 dark:bg-amber-950/20'}">
								<div class="min-w-0">
									<p class="text-[12px] font-medium text-slate-800 dark:text-slate-100 truncate">{p.name || `Proyek #${p.project_id}`}</p>
									{#if !p.siap}
										<p class="text-[10px] text-amber-600 mt-0.5">
											Belum: {p.gates.filter((g: any) => g.status === 'failed').map((g: any) => g.label).join(', ')}
										</p>
									{/if}
									{#if p.siap_kickoff?.status === 'failed'}
										<p class="text-[10px] text-slate-500 mt-0.5">
											ℹ️ Persiapan proyek: {p.siap_kickoff.message}
											<a href={`/proyek/${p.project_id}`} class="text-[var(--p)] font-medium hover:underline">→ Lengkapi checklist persiapan</a>
											<em class="block text-slate-400">Peringatan saja — tidak menahan pengajuan.</em>
										</p>
									{/if}
								</div>
								<div class="flex items-center gap-2 shrink-0">
									<span class="text-[11px] font-semibold {p.siap ? 'text-emerald-600' : 'text-amber-600'}">{p.siap ? '✅ Siap' : `${p.pct}%`}</span>
									<button
										type="button"
										onclick={() => goto(`/anggaran/baru?project_id=${p.project_id}`)}
										class="text-[11px] font-semibold px-2 py-1 rounded-lg bg-[var(--p)] text-white"
									>
										Ajukan
									</button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{:else if !readinessLoading && readiness?.available === false}
				<div class="card-section text-[12px] text-gray-500 space-y-1.5">
					<p>Kesiapan proyek belum bisa dimuat saat ini — pengajuan tetap bisa dibuat.</p>
					<button type="button" onclick={() => loadReadiness(projects, true)} class="text-[11px] font-semibold text-[var(--p)]">🔄 Coba lagi</button>
				</div>
			{:else if !readinessLoading}
				<p class="card-section text-[12px] text-gray-400">Anda belum terhubung ke proyek manapun.</p>
			{/if}

			<!-- Cek skenario lain (kategori/nominal spesifik) — bentuk lama, dipertahankan
			     untuk kasus di luar sumbu proyek (mis. sumbu department) atau kategori
			     dengan gate tambahan (G_KOMISI dkk) yang tidak tercakup tabel di atas. -->
			<button
				type="button"
				onclick={() => (showManualCheck = !showManualCheck)}
				class="w-full flex items-center justify-between text-[12px] font-semibold text-slate-500 px-1"
			>
				<span>Cek skenario lain (kategori/nominal spesifik)</span>
				<IconChevronDown size={14} class="transition-transform {showManualCheck ? 'rotate-180' : ''}" />
			</button>

			{#if showManualCheck}
			<div class="card-section space-y-2.5">
				<div>
					<label class="f-label">Departemen</label>
					<select bind:value={departmentId} class="f-select">
						<option value={null}>— Pilih Departemen —</option>
						{#each departments as d}<option value={d.id}>{d.nama_department}</option>{/each}
					</select>
				</div>
				<div>
					<label class="f-label">Proyek (opsional)</label>
					<select bind:value={selectedProject} class="f-select">
						<option value="">— Tidak ada —</option>
						{#each projects as p}<option value={String(p.id)}>{p.name}</option>{/each}
					</select>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div>
						<label class="f-label">Kategori</label>
						{#if categories.length > 0}
							<select
								bind:value={selectedCategoryKode}
								onchange={() => { kategori = selectedCategory?.legacy_kategori || 'operasional'; }}
								class="f-select"
							>
								<option value={null}>— Pilih Kategori —</option>
								{#each categories as c}<option value={c.kode}>{c.icon || ''} {c.nama}</option>{/each}
							</select>
						{:else}
							<select bind:value={kategori} class="f-select">
								<option value="operasional">Operasional</option>
								<option value="jasa">Jasa / Pembayaran Proyek</option>
							</select>
						{/if}
					</div>
					<div>
						<label class="f-label">Estimasi Nominal</label>
						<input type="number" bind:value={nominal} class="f-input" placeholder="0" />
					</div>
				</div>
				{#if selectedCategory ? selectedCategory.requires_attachment : kategori === 'operasional'}
					<label class="flex items-center gap-2 text-[12px] text-gray-600">
						<input type="checkbox" bind:checked={lampiranAda} /> Saya sudah punya lampiran bukti
					</label>
				{/if}
				<button
					class="w-full py-2.5 bg-[var(--p)] text-white rounded-xl text-[13px] font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
					onclick={periksa}
					disabled={checking}
				>
					{#if checking}<IconLoader2 size={16} class="animate-spin" /> Memeriksa...{:else}<IconSearch size={16} /> Periksa Kesiapan{/if}
				</button>
			</div>

			{#if result}
				<div class="card-section">
					{#if result.available === false}
						<p class="text-[12px] text-gray-400">{result.reason || 'Pemeriksaan gate belum tersedia — pengajuan tetap bisa dikirim.'}</p>
					{:else if result.gates}
						<div class="flex items-center justify-between mb-2">
							<h4 class="!mb-0">Hasil Pemeriksaan</h4>
							<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full {result.status === 'complete' ? 'bg-green-100 text-green-700' : result.status === 'blocked' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">
								{result.status === 'complete' ? 'Siap' : result.status === 'blocked' ? 'Terhambat' : 'Perlu Dilengkapi'}
							</span>
						</div>
						<div class="space-y-2">
							{#each result.gates as g}
								{#if g.status !== 'not_applicable'}
									{@const link = g.status === 'failed' ? linkFor(g) : null}
									<div class="flex items-start gap-1.5 text-[12px]">
										<span>{g.status === 'passed' ? '✅' : g.status === 'failed' && isDeferredGate(g) ? '🕓' : g.severity === 'WAJIB' ? '🔴' : '🟡'}</span>
										<div class="min-w-0">
											<span class="text-gray-600"><strong class="text-gray-800">{g.label}:</strong> {g.message}</span>
											{#if g.status === 'failed' && isDeferredGate(g)}
												<em class="block text-[11px] text-slate-500">Ditangani {deferredHandlerLabel(g)} — bukan tugas Anda saat ini.</em>
											{/if}
											{#if contactHint(g)}
												<em class="block text-[11px] text-slate-500">📞 {contactHint(g)}</em>
											{/if}
											{#if link}
												<a href={link.href} class="block text-[11px] text-[var(--p)] font-medium hover:underline mt-0.5">→ {link.label}</a>
											{/if}
											{#if canRequestDispensasi(g) && selectedProject}
												<button type="button" onclick={() => (dispensasiGate = g.gate_key)}
													title="Kirim permintaan kelonggaran gate ini ke GM/Direktur (alasan wajib)"
													class="mt-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-amber-400 text-amber-700">🆘 Minta dispensasi</button>
											{/if}
										</div>
									</div>
								{/if}
							{/each}
						</div>
						{#if result.category_gate_keys?.length > 0}
							<div class="mt-2.5 pt-2.5 border-t border-gray-100">
								<p class="text-[10px] text-gray-400 mb-1">Gate tambahan terdaftar untuk kategori ini (informational):</p>
								<div class="flex flex-wrap gap-1">
									{#each result.category_gate_keys as gk}
										<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{gk}</span>
									{/each}
								</div>
							</div>
						{/if}
						<p class="text-[10px] text-gray-300 mt-3">Mode peringatan — tidak menahan pengiriman. Perbaiki bila memungkinkan.</p>
					{/if}
				</div>
			{/if}
			{/if}
		</div>
	{/if}
</div>

<GateRequestDispensasi
	open={dispensasiGate !== null}
	projectId={selectedProject || null}
	gateKey={dispensasiGate}
	onClose={() => (dispensasiGate = null)}
	onSuccess={() => dispensasiRefresh++}
/>
