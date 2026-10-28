<!-- src/routes/(app)/proyek/[project_id]/closeout/+page.svelte -->
<!-- Checklist Closeout Leader (rekomendasi Evaluasi & Closing Proyek): daftar syarat yang -->
<!-- Leader lengkapi sebelum closing diajukan Admin — read-only status alur closing (laporan -->
<!-- akhir/evaluasi/dsb tetap dikerjakan Admin di TabClosure.svelte, tidak bisa dari sini). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { getProjectById } from '$lib/services/projects';
	import {
		getClosureStatus,
		getClosureEvaluation,
		getCloseoutChecklist,
		setCloseoutCheck,
		generateCloseoutBast,
		downloadBastFromBase64,
		type ClosureStatus,
		type ClosureEvaluation
	} from '$lib/services/projectClosureLapangan';
	import { loadPaStatus, loadIdleLoans, type PaStatusResponse } from '$lib/services/paStatusLapangan';
	import { IconArrowLeft, IconLoader2, IconFileText } from '@tabler/icons-svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let closure = $state<ClosureStatus | null>(null);
	let evaluation = $state<ClosureEvaluation | null>(null);
	let checklist = $state<Array<{ id: string; label: string; wajib: boolean; checked: boolean }>>([]);
	let togglingItem = $state<string | null>(null);

	// Pemeriksaan OTOMATIS sistem (audit hidden cost #1051): bahan bagi Leader sebelum closing diajukan. Informatif —
	// penegakan ada di Gerbang Closing Admin (setelan project.closure.pa_pending_required / asset_reconciliation_required).
	let autoChecks = $state<{ pa: PaStatusResponse | null; paError: boolean; loansActive: number | null; loansError: boolean }>({
		pa: null,
		paError: false,
		loansActive: null,
		loansError: false
	});
	async function loadAutoChecks() {
		const pid = Number(projectId);
		const [pa, loans] = await Promise.allSettled([loadPaStatus(pid), loadIdleLoans(pid)]);
		autoChecks = {
			pa: pa.status === 'fulfilled' ? pa.value : null,
			paError: pa.status === 'rejected',
			loansActive: loans.status === 'fulfilled' && !loans.value.error ? loans.value.activeCount : null,
			loansError: loans.status === 'rejected' || (loans.status === 'fulfilled' && !!loans.value.error)
		};
	}

	const STAGE_LABEL: Record<string, string> = {
		draft: 'Draft',
		report_generated: 'Laporan Akhir Dibuat',
		evaluated: 'Dievaluasi',
		presented: 'Dipresentasikan',
		approved: 'Disetujui',
		closed: 'Closed'
	};

	onMount(async () => {
		loading = true;
		try {
			const [proj, cl, ev, cs] = await Promise.all([
				getProjectById(projectId),
				getClosureStatus(Number(projectId)),
				getClosureEvaluation(Number(projectId)),
				getCloseoutChecklist(Number(projectId))
			]);
			project = proj;
			closure = cl;
			evaluation = ev;
			checklist = cs;
			loadAutoChecks(); // tidak menahan tampilan checklist
		} finally {
			loading = false;
		}
	});

	async function toggleItem(itemId: string, checked: boolean) {
		togglingItem = itemId;
		try {
			await setCloseoutCheck(Number(projectId), itemId, checked, $authStore.karyawanName || 'lapangan');
			checklist = checklist.map((c) => (c.id === itemId ? { ...c, checked } : c));
		} finally {
			togglingItem = null;
		}
	}

	let wajibDone = $derived(checklist.filter((c) => c.wajib).every((c) => c.checked));

	// Delegasi Peran Fase 5 — Self-Service Dokumen PL
	let showBastForm = $state(false);
	let bastForm = $state({ pihakKedua: '', uraianBarang: '', tanggal: new Date().toISOString().slice(0, 10) });
	let bastGenerating = $state(false);
	let bastResult = $state<{ nomorDokumen: string } | null>(null);
	let bastError = $state('');

	async function handleGenerateBast() {
		if (!bastForm.pihakKedua.trim()) { bastError = 'Nama pihak kedua (penerima) wajib diisi'; return; }
		if (!bastForm.uraianBarang.trim()) { bastError = 'Uraian pekerjaan/barang wajib diisi'; return; }
		bastError = '';
		bastGenerating = true;
		try {
			const result = await generateCloseoutBast({
				projectId: Number(projectId),
				projectName: project?.name || '',
				pihakPertama: `PT Eltama Prima Indo (${$authStore.karyawanName || 'Project Leader'})`,
				pihakKedua: bastForm.pihakKedua.trim(),
				uraianBarang: bastForm.uraianBarang.trim(),
				tanggal: bastForm.tanggal
			});
			downloadBastFromBase64(result.pdfBase64, result.fileName);
			bastResult = { nomorDokumen: result.nomorDokumen };
			showBastForm = false;

			// Kirim notifikasi n8n (fail-soft, non-blocking)
			fetch('/api/proyek/subcon-bast-notify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectId: Number(projectId),
					projectName: project?.name || '',
					pihakKedua: bastForm.pihakKedua.trim(),
					uraianBarang: bastForm.uraianBarang.trim(),
					nomorDokumen: result.nomorDokumen,
					createdBy: $authStore.karyawanName || 'Site Leader'
				})
			}).catch((err) => console.warn('[closeout] Gagal trigger webhook n8n bast:', err));
		} catch (e: any) {
			bastError = e?.message || 'Gagal generate BAST';
		} finally {
			bastGenerating = false;
		}
	}

	async function prepareSubconBast(type: 'subcon' | 'customer' = 'subcon') {
		bastError = '';
		showBastForm = true;
		const defaultName = type === 'subcon' ? 'PT Primantara' : (project?.customer || 'Customer');
		bastForm.pihakKedua = defaultName;

		try {
			const { fetchActiveLoansForProject } = await import('$lib/services/loanChecklist');
			const [loans, stockRes] = await Promise.all([
				fetchActiveLoansForProject(Number(projectId)).catch(() => []),
				fetch(`/api/inventory-proyek/stock-balance?projectId=${projectId}`).then((r) => r.json()).catch(() => ({ rows: [] }))
			]);

			const targetLoans = (loans || []).filter((l) => (l.ownership_type || l.equipment?.ownership_type) === type);
			const targetStock = (stockRes?.rows || []).filter(
				(s: any) => (s.ownership_type || 'eltama') === type && (Number(s.qty_on_hand) || 0) > 0
			);

			let lines: string[] = [];
			lines.push(`Berita Acara Serah Terima Pengembalian Aset & Material ${type === 'subcon' ? 'Subkontraktor' : 'Customer'} (${defaultName})`);
			lines.push(`Proyek: ${project?.name || '-'}`);

			if (targetLoans.length > 0) {
				lines.push('\n[Daftar Peralatan / Unit Kerja]');
				for (const l of targetLoans) {
					lines.push(`- ${l.equipment?.name || 'Unit'} (Kode: ${l.equipment?.code || l.id})`);
				}
			}

			if (targetStock.length > 0) {
				lines.push('\n[Daftar Sisa Material / Bahan]');
				for (const s of targetStock) {
					const name = s.item_id?.nama_barang_lengkap || s.item_name || 'Item';
					const satuan = s.item_id?.satuan || s.item_satuan || '';
					lines.push(`- ${name}: ${s.qty_on_hand} ${satuan}`);
				}
			}

			if (targetLoans.length === 0 && targetStock.length === 0) {
				lines.push(`\nSeluruh alat kerja dan material milik ${defaultName} telah diserahterimakan kembali dalam keadaan baik dan lengkap.`);
			} else {
				lines.push('\nPeralatan dan sisa material di atas telah diserahterimakan kembali dalam keadaan baik dan lengkap di site proyek.');
			}

			bastForm.uraianBarang = lines.join('\n');
		} catch (e: any) {
			bastForm.uraianBarang = `Serah terima pengembalian sisa material dan peralatan milik ${defaultName} di lokasi proyek ${project?.name || ''}.`;
		}
	}
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<button class="mb-3 flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}`)}>
		<IconArrowLeft size={16} /> Kembali ke Proyek
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-12">
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat closeout proyek..." />
	</div>
	{:else}
		<h1 class="text-lg font-bold text-gray-900">Checklist Closeout</h1>
		<!-- PRJ-14 (K11): arti dua status final, agar tidak dipakai bergantian. -->
		<p class="mt-1 text-[11px] text-gray-500">
			<b>Selesai</b> = pekerjaan lapangan selesai (BAST). <b>Closed</b> = closing administrasi &amp; keuangan sudah disetujui. Melengkapi checklist ini membantu Admin menyetujui closing.
		</p>
		<p class="mb-4 text-sm text-gray-500">{project?.name || '-'}</p>

		<div class="mb-4 rounded-lg border p-3 text-xs {closure ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50 text-gray-500'}">
			{#if closure}
				Status alur closing saat ini: <b>{STAGE_LABEL[closure.stage] || closure.stage}</b> (dikelola Admin ERP).
				{#if evaluation}
					<br />Skor evaluasi: <b>{evaluation.total_skor} — Grade {evaluation.grade}</b>
				{/if}
			{:else}
				Closing belum dimulai Admin. Lengkapi checklist di bawah supaya siap saat closing diajukan.
			{/if}
		</div>

		<div class="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
			<h2 class="text-sm font-bold text-gray-800">Syarat Sebelum Closing</h2>
			<p class="mb-2 text-xs text-gray-400">Ditandai Leader — dilihat Admin sebagai bahan sebelum menekan "Mulai Closing".</p>
			{#each checklist as item (item.id)}
				<label class="flex items-center justify-between text-sm">
					<span>{item.label}{#if item.wajib}<span class="ml-1 text-xs text-red-500">*wajib</span>{/if}</span>
					<input
						type="checkbox"
						checked={item.checked}
						disabled={togglingItem === item.id}
						onchange={(e) => toggleItem(item.id, (e.target as HTMLInputElement).checked)}
					/>
				</label>
			{/each}
		</div>

		<div class="mt-4 space-y-1.5 rounded-xl border border-gray-200 bg-white p-4 text-sm" data-testid="closeout-auto-checks">
			<h2 class="text-sm font-bold text-gray-800">Pemeriksaan Otomatis Sistem</h2>
			<p class="mb-2 text-xs text-gray-400">Dihitung dari data terbaru. Bila Admin mengaktifkan Gerbang Closing, temuan di bawah bisa menahan closing.</p>
			{#if autoChecks.paError}
				<div class="text-xs text-red-600">Status pengajuan anggaran gagal dimuat — muat ulang halaman.</div>
			{:else if autoChecks.pa}
				<div class="flex items-start gap-2 {autoChecks.pa.total_count === 0 ? 'text-green-700' : 'text-amber-700'}" data-testid="closeout-pa">
					<span>{autoChecks.pa.total_count === 0 ? '✅' : '⚠️'}</span>
					<span>
						{#if autoChecks.pa.total_count === 0}
							Tidak ada pengajuan anggaran yang masih menunggu persetujuan.
						{:else}
							{autoChecks.pa.total_count} pengajuan anggaran masih menunggu persetujuan{autoChecks.pa.overdue_count > 0 ? ` (${autoChecks.pa.overdue_count} sudah melewati batas waktu)` : ''}.
							Selesaikan dulu agar biaya proyek final — pantau & ingatkan approver di halaman proyek.
						{/if}
					</span>
				</div>
			{:else}
				<div class="text-xs text-gray-400">Memeriksa pengajuan anggaran…</div>
			{/if}
			{#if autoChecks.loansError}
				<div class="text-xs text-red-600">Data alat pinjaman gagal dimuat.</div>
			{:else if autoChecks.loansActive !== null}
				<div class="flex items-start gap-2 {autoChecks.loansActive === 0 ? 'text-green-700' : 'text-amber-700'}" data-testid="closeout-loans">
					<span>{autoChecks.loansActive === 0 ? '✅' : '⚠️'}</span>
					<span>
						{autoChecks.loansActive === 0 ? 'Semua alat pinjaman sudah dikembalikan.' : `${autoChecks.loansActive} alat pinjaman belum dikembalikan ke gudang.`}
					</span>
				</div>
			{/if}
		</div>

		<div class="mt-4 rounded-lg border p-3 text-xs {wajibDone ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}">
			{wajibDone ? '✅ Semua syarat wajib sudah lengkap.' : '⚠️ Masih ada syarat wajib yang belum ditandai.'}
		</div>

		<!-- Delegasi Peran Fase 5 — Self-Service Dokumen PL -->
		<div class="mt-4 rounded-xl border border-gray-200 bg-white p-4">
			<div class="flex items-center justify-between flex-wrap gap-2">
				<h2 class="text-sm font-bold text-gray-800">Berita Acara Serah Terima (BAST)</h2>
				{#if !showBastForm}
					<div class="flex items-center gap-1.5 flex-wrap">
						<button
							class="flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition-all shadow-sm"
							onclick={() => prepareSubconBast('subcon')}
							title="Buat BAST pengembalian sisa material & alat Subcon (Primantara) di site"
						>
							👷 BAST Subcon
						</button>
						<button
							class="flex items-center gap-1 rounded-lg bg-purple-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition-all shadow-sm"
							onclick={() => prepareSubconBast('customer')}
							title="Buat BAST serah-terima pengembalian material/alat Customer di site"
						>
							🤝 BAST Customer
						</button>
						<button
							class="flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-all shadow-sm"
							onclick={() => (showBastForm = true)}
						>
							<IconFileText size={14} /> BAST Umum
						</button>
					</div>
				{/if}
			</div>
			<p class="mt-1 text-xs text-gray-400">Dokumen resmi bernomor, langsung terbit &amp; bisa diunduh — dibuat lewat generator dokumen admin.</p>

			{#if bastResult}
				<div class="mt-2 rounded-lg border border-green-200 bg-green-50 p-2 text-xs text-green-700">
					✅ BAST <b>{bastResult.nomorDokumen}</b> berhasil dibuat &amp; diunduh.
				</div>
			{/if}

			{#if showBastForm}
				<div class="mt-3 space-y-2">
					<div>
						<label class="mb-1 block text-xs font-semibold text-gray-600">Pihak Kedua (Menerima) *</label>
						<input
							type="text"
							bind:value={bastForm.pihakKedua}
							placeholder="mis. PT Klien / nama perwakilan"
							class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs font-semibold text-gray-600">Uraian Barang/Pekerjaan *</label>
						<textarea
							bind:value={bastForm.uraianBarang}
							rows="3"
							placeholder="mis. Pekerjaan instalasi tangki sesuai SPK #..., telah selesai 100%"
							class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						></textarea>
					</div>
					<div>
						<label class="mb-1 block text-xs font-semibold text-gray-600">Tanggal</label>
						<input type="date" bind:value={bastForm.tanggal} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
					</div>
					{#if bastError}
						<p class="text-xs text-red-600">{bastError}</p>
					{/if}
					<div class="flex gap-2 pt-1">
						<button
							class="flex-1 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
							disabled={bastGenerating}
							onclick={handleGenerateBast}
						>
							{bastGenerating ? 'Membuat dokumen...' : 'Generate & Unduh PDF'}
						</button>
						<button
							class="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600"
							disabled={bastGenerating}
							onclick={() => (showBastForm = false)}
						>
							Batal
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
