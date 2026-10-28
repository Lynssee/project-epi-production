<!-- Planning Suite Fase 8 — Ceklist Pra-Mobilisasi K3 (dari syarat Charter) + Monitoring Kuota RAP.
     Dimuat atas permintaan (saat panel dibuka) agar hemat API. Hanya informasi — tidak memblokir pengajuan. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { getProjectQuotaRows, getProjectCharterRequirements, getProjectPersonnelDocs } from '$lib/services/packingList';
	import { computeQuota, buildPreMobChecklist, buildPersonDocMatrix, DOC_FOR_REQUIREMENT, type QuotaRow, type DocState } from '$lib/shared/planningMonitor';

	let { projectId }: { projectId: number | null } = $props();

	let open = $state(false);
	let loading = $state(false);
	let loadedFor = $state<number | null>(null);
	let error = $state('');
	let charter = $state<Record<string, any> | null>(null);
	let rows = $state<any[]>([]);
	let checked = $state<Record<string, boolean>>({});
	let people = $state<Array<{ manpower_id: number; nama: string; jabatan: string }>>([]);
	let docs = $state<any[]>([]);
	let docError = $state('');

	const storageKey = (pid: number) => `premob_check_${pid}`;
	const quota = $derived(computeQuota(rows));
	const checklist = $derived(buildPreMobChecklist(charter, rows));
	const manualItems = $derived(checklist.items.filter((i) => i.kind === 'manual'));
	const docItems = $derived(checklist.items.filter((i) => i.kind === 'doc'));
	const matrix = $derived(buildPersonDocMatrix(docItems.map((i) => i.key), people, docs));
	const doneCount = $derived(manualItems.filter((i) => checked[i.key]).length);

	const DOC_CELL: Record<DocState, { icon: string; cls: string; title: string }> = {
		terverifikasi: { icon: '✓', cls: 'text-emerald-600', title: 'Terverifikasi HRD' },
		menunggu: { icon: '⏳', cls: 'text-amber-600', title: 'Sudah diunggah, menunggu verifikasi HRD' },
		kedaluwarsa: { icon: '⚠', cls: 'text-orange-600', title: 'Dokumen kedaluwarsa — unggah yang baru' },
		ditolak: { icon: '✗', cls: 'text-red-600', title: 'Ditolak HRD — unggah ulang' },
		belum: { icon: '—', cls: 'text-gray-300', title: 'Belum ada dokumen' }
	};

	const STATUS: Record<QuotaRow['status'], { label: string; cls: string }> = {
		belum: { label: 'Belum keluar', cls: 'bg-gray-100 text-gray-600' },
		sebagian: { label: 'Sebagian', cls: 'bg-amber-100 text-amber-700' },
		habis: { label: 'Terpenuhi', cls: 'bg-emerald-100 text-emerald-700' },
		lebih: { label: 'Melebihi kuota', cls: 'bg-red-100 text-red-700' }
	};

	async function load(pid: number) {
		loading = true;
		error = '';
		try {
			const [c, r] = await Promise.all([getProjectCharterRequirements(pid), getProjectQuotaRows(pid)]);
			charter = c;
			rows = r;
			const needKeys = buildPreMobChecklist(c, r).items.filter((i) => i.kind === 'doc').map((i) => DOC_FOR_REQUIREMENT[i.key]).filter(Boolean);
			const pd = await getProjectPersonnelDocs(pid, needKeys);
			people = pd.people;
			docs = pd.docs;
			docError = pd.error;
			loadedFor = pid;
			try { checked = JSON.parse(localStorage.getItem(storageKey(pid)) || '{}'); } catch { checked = {}; }
		} catch (e: any) {
			console.error('[PlanningFieldPanels] gagal memuat:', e);
			error = 'Gagal memuat data perencanaan. Coba tutup lalu buka lagi.';
		} finally {
			loading = false;
		}
	}

	function toggleOpen() {
		open = !open;
		if (open && projectId && loadedFor !== projectId) load(projectId);
	}

	function toggleCheck(key: string) {
		checked = { ...checked, [key]: !checked[key] };
		if (projectId) {
			try { localStorage.setItem(storageKey(projectId), JSON.stringify(checked)); } catch { /* penyimpanan penuh/diblokir: abaikan */ }
		}
	}

	// Ganti proyek → tutup & reset agar tidak menampilkan data proyek sebelumnya.
	$effect(() => {
		if (projectId !== loadedFor) { loadedFor = null; rows = []; charter = null; people = []; docs = []; open = false; }
	});
</script>

{#if projectId}
	<div class="card-section" id="pkl-planning-section">
		<button type="button" class="w-full flex items-center justify-between bg-transparent border-none cursor-pointer p-0 text-left" onclick={toggleOpen} aria-expanded={open}
			title="Lihat syarat dari Charter yang perlu disiapkan sebelum berangkat, dan sisa kuota barang dari RAP">
			<h4 class="!m-0">🧭 Persiapan &amp; Kuota Proyek</h4>
			<span class="text-[11px] text-gray-500">{open ? 'Tutup ▴' : 'Lihat ▾'}</span>
		</button>

		{#if open}
			<p class="text-[11px] text-gray-400 mt-1 mb-3">Hanya informasi untuk membantu Anda — tidak menghalangi pengajuan. Status dokumen personil dari data HRD; centang izin/alat hanya tersimpan di perangkat ini.</p>
			{#if loading}
				<CircularProgressGauge size={42} strokeWidth={3} label="Memuat perencanaan pra-mobilisasi..." />
			{:else if error}
				<div class="text-[12px] text-red-600">{error}</div>
			{:else}
				<h5 class="text-[12px] font-bold text-gray-700 mb-1">Ceklist Pra-Mobilisasi {#if checklist.items.length}{#if manualItems.length}<span class="font-normal text-gray-400">({doneCount}/{manualItems.length} izin siap)</span>{/if}{/if}</h5>
				{#if !charter}
					<p class="text-[11px] text-gray-400 mb-2">Charter proyek ini belum ada, jadi syarat belum diketahui. Hubungi admin proyek.</p>
				{:else if checklist.items.length === 0}
					<p class="text-[11px] text-gray-400 mb-2">Charter tidak mensyaratkan dokumen khusus.</p>
				{:else}
					{#if docItems.length}
						<div class="mb-2">
							<p class="text-[11px] text-gray-500 mb-1">Dokumen personil yang diminta Charter ({matrix.completeCount}/{matrix.rows.length} orang lengkap). Status dari data HRD — unggah dokumen lewat menu <a class="underline" href="/manpower">Manpower</a>.</p>
							{#if docError}
								<p class="text-[11px] text-red-600">{docError}</p>
							{:else if matrix.rows.length === 0}
								<p class="text-[11px] text-gray-400">Belum ada personil yang ditugaskan di proyek ini.</p>
							{:else}
								<div class="overflow-x-auto">
									<table class="w-full text-[11px]">
										<thead><tr class="text-gray-500"><th class="text-left py-1 pr-2">Personil</th>{#each docItems as it (it.key)}<th class="px-1 text-center"><Tooltip text={it.hint} position="bottom"><span>{it.label.split(' ')[0]}</span></Tooltip></th>{/each}</tr></thead>
										<tbody>
											{#each matrix.rows as p (p.id)}
												<tr class="border-t border-gray-100"><td class="py-1 pr-2">{p.nama}{#if p.jabatan} <span class="text-gray-400">· {p.jabatan}</span>{/if}</td>
													{#each docItems as it (it.key)}<td class="px-1 text-center {DOC_CELL[p.cells[it.key] ?? 'belum'].cls}" title={DOC_CELL[p.cells[it.key] ?? 'belum'].title}>{DOC_CELL[p.cells[it.key] ?? 'belum'].icon}</td>{/each}
												</tr>
											{/each}
										</tbody>
									</table>
									<p class="mt-1 text-[10px] text-gray-500" data-testid="doc-legend">
										{#each Object.values(DOC_CELL) as d, i}{#if i > 0} · {/if}<span class={d.cls}>{d.icon}</span> {d.title}{/each}
									</p>
								</div>
							{/if}
						</div>
					{/if}
					<div class="space-y-1 mb-2">
						{#each manualItems as it (it.key)}
							<button type="button" class="w-full flex items-start gap-2 p-2 rounded-lg border text-left cursor-pointer {checked[it.key] ? 'border-emerald-300 bg-emerald-50' : 'border-gray-100 bg-white'}" onclick={() => toggleCheck(it.key)}>
								<span class="mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 text-[10px] {checked[it.key] ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300'}">{checked[it.key] ? '✓' : ''}</span>
								<span class="min-w-0"><span class="block text-[12px] font-medium text-gray-800">{it.label}</span><span class="block text-[10.5px] text-gray-400">{it.hint}</span></span>
							</button>
						{/each}
					</div>
				{/if}
				{#if checklist.apd.total > 0}
					<p class="text-[11px] mb-3 {checklist.apd.linked === checklist.apd.total ? 'text-emerald-600' : 'text-amber-600'}">
						🦺 APD di RAP: {checklist.apd.total} item{checklist.apd.linked < checklist.apd.total ? `, ${checklist.apd.total - checklist.apd.linked} belum tertaut barang master (hubungi admin)` : ', semua tertaut'}.
					</p>
				{/if}

				<h5 class="text-[12px] font-bold text-gray-700 mb-1">Kuota Barang RAP <span class="font-normal text-gray-400">({quota.totalPct}% sudah keluar{quota.over ? ` · ${quota.over} melebihi kuota` : ''})</span></h5>
				{#if quota.rows.length === 0}
					<p class="text-[11px] text-gray-400">Belum ada barang ber-qty di RAP proyek ini.</p>
				{:else}
					<div class="space-y-1.5 max-h-[260px] overflow-y-auto">
						{#each quota.rows as q (q.id)}
							<div class="p-2 rounded-lg border border-gray-100 bg-white">
								<div class="flex items-center justify-between gap-2">
									<span class="text-[12px] font-medium text-gray-800 truncate">{q.name}{#if q.fromPlanning} <span class="text-[9px] px-1 rounded-full bg-indigo-100 text-indigo-700 align-middle">Planning</span>{/if}</span>
									<span class="text-[9.5px] px-1.5 py-px rounded-full shrink-0 {STATUS[q.status].cls}">{STATUS[q.status].label}</span>
								</div>
								<div class="h-1.5 bg-gray-100 rounded mt-1 overflow-hidden"><div class="h-full {q.status === 'lebih' ? 'bg-red-500' : 'bg-[var(--g)]'}" style="width:{Math.min(q.pct, 100)}%"></div></div>
								<div class="text-[10.5px] text-gray-500 mt-0.5 tabular-nums">Keluar {q.sent.toLocaleString('id-ID')} dari {q.planned.toLocaleString('id-ID')} {q.unit} · sisa {q.remaining.toLocaleString('id-ID')}</div>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		{/if}
	</div>
{/if}
