<!-- src/routes/(app)/proyek/[project_id]/galeri/+page.svelte -->
<!-- Fase 5 (Penajaman Dokumentasi Foto Proyek, 27 Sep 2026) — Galeri Terstruktur Lapangan.
     Agregasi read-only dari laporan harian (Fase 1-2: toolbox/area_kerja/foto per-item) +
     foto milestone termin (Fase 3). Timeline per tanggal, filter kategori/rentang waktu,
     mode bandingkan (pilih 2 foto untuk before-after). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { getProjectById } from '$lib/services/projects';
	import { getBatchedReports } from '$lib/services/reports';
	import { fetchAllMilestonePhotosForProject } from '$lib/services/projectMilestonePhotosApi';
	import { secureAssetSrc } from '$lib/actions/secureAsset';
	import { IconArrowLeft, IconCamera, IconX, IconArrowsRightLeft } from '@tabler/icons-svelte';

	const projectId = $page.params.project_id as string;

	interface GalleryItem {
		id: string;
		fileId: string;
		category: string;
		categoryLabel: string;
		date: string;
		title: string;
	}

	let loading = $state(true);
	let project = $state<any>(null);
	let items = $state<GalleryItem[]>([]);
	let selectedCategory = $state('all');
	let dateFilter = $state<'all' | '7d' | '30d'>('all');
	let compareMode = $state(false);
	let compareSelection = $state<GalleryItem[]>([]);
	let lightboxItem = $state<GalleryItem | null>(null);

	const CATEGORIES = [
		{ id: 'all', label: 'Semua', emoji: '🖼️' },
		{ id: 'progress', label: 'Progress', emoji: '🏗️' },
		{ id: 'manpower', label: 'Absensi', emoji: '👥' },
		{ id: 'toolbox', label: 'Toolbox', emoji: '🛡️' },
		{ id: 'area_kerja', label: 'Area Kerja', emoji: '🧹' },
		{ id: 'kendala', label: 'Kendala', emoji: '⚠️' },
		{ id: 'milestone', label: 'Milestone', emoji: '📊' }
	];

	// Normalisasi array file ID dari berbagai bentuk data Directus (JSON string, array of
	// strings/objects) — sengaja diduplikasi ringkas di sini (bukan impor dari
	// projectReferencesApi.js, itu file erp-epi/admin, beda repo).
	function parsePhotoList(raw: any): string[] {
		if (!raw) return [];
		let val = raw;
		if (typeof val === 'string') {
			try { val = JSON.parse(val); } catch { return []; }
		}
		if (!Array.isArray(val)) return [];
		return val.map((v: any) => (typeof v === 'string' ? v : v?.id || v?.file_id || v?.directus_files_id)).filter(Boolean);
	}

	async function load() {
		loading = true;
		try {
			const [proj, reports, milestonePhotos] = await Promise.all([
				getProjectById(projectId),
				getBatchedReports([projectId], {
					fields: ['id', 'date', 'prepared_by', 'progress_photos', 'attendance_photos', 'issue_photos', 'toolbox_photos', 'area_kerja_photos', 'progress', 'issues'],
					limit: -1
				}),
				fetchAllMilestonePhotosForProject(projectId)
			]);
			project = proj;

			const list: GalleryItem[] = [];
			const push = (fileId: string, category: string, categoryLabel: string, date: string, title: string, uniqKey: string) => {
				list.push({ id: uniqKey, fileId, category, categoryLabel, date, title });
			};

			for (const rep of reports || []) {
				const dateStr = (rep.date || '').slice(0, 10);
				const leaderName = (rep.prepared_by || '').trim();

				parsePhotoList(rep.progress_photos).forEach((fid, i) => push(fid, 'progress', 'Progress Lapangan', dateStr, 'Progres Pekerjaan Fisik', `lh-prog-${rep.id}-${i}`));
				parsePhotoList(rep.attendance_photos).forEach((fid, i) => push(fid, 'manpower', 'Absensi & Tim', dateStr, `Absensi ${leaderName ? `(${leaderName})` : ''}`, `lh-att-${rep.id}-${i}`));
				parsePhotoList(rep.issue_photos).forEach((fid, i) => push(fid, 'kendala', 'Kendala & Defect', dateStr, 'Kendala Umum', `lh-issue-${rep.id}-${i}`));
				parsePhotoList(rep.toolbox_photos).forEach((fid, i) => push(fid, 'toolbox', 'Toolbox Meeting', dateStr, 'Toolbox Meeting / Safety Briefing', `lh-toolbox-${rep.id}-${i}`));
				parsePhotoList(rep.area_kerja_photos).forEach((fid, i) => push(fid, 'area_kerja', 'Area Kerja', dateStr, 'Kondisi Area Kerja', `lh-areakerja-${rep.id}-${i}`));

				// Fase 2 — foto per baris progress/kendala (tambahan, di luar foto umum di atas)
				let progressRows: any[] = [];
				try { progressRows = typeof rep.progress === 'string' ? JSON.parse(rep.progress) : (rep.progress || []); } catch { progressRows = []; }
				progressRows.forEach((p, pi) => {
					parsePhotoList(p?.foto_bukti).forEach((fid, i) => push(fid, 'progress', 'Progress Lapangan', dateStr, p.notes || p.activity || 'Progress (per item)', `lh-progitem-${rep.id}-${pi}-${i}`));
				});
				let issueRows: any[] = [];
				try { issueRows = typeof rep.issues === 'string' ? JSON.parse(rep.issues) : (rep.issues || []); } catch { issueRows = []; }
				issueRows.forEach((it, ii) => {
					parsePhotoList(it?.foto_kendala).forEach((fid, i) => push(fid, 'kendala', 'Kendala & Defect', dateStr, it.description || 'Kendala (per item)', `lh-kendalaitem-${rep.id}-${ii}-${i}`));
				});
			}

			const PHOTO_TYPE_LABEL: Record<string, string> = { before: 'Before', during: 'During', after: 'After' };
			for (const mp of milestonePhotos || []) {
				if (!mp.file_id) continue;
				const label = `Termin #${mp.milestone_ref} — ${PHOTO_TYPE_LABEL[mp.photo_type] || mp.photo_type}`;
				push(mp.file_id, 'milestone', 'Milestone & Termin', (mp.date_taken || mp.date_created || '').slice(0, 10), label, `milestone-${mp.id}`);
			}

			list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
			items = list;
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let filtered = $derived.by(() => {
		let list = items;
		if (selectedCategory !== 'all') list = list.filter((i) => i.category === selectedCategory);
		if (dateFilter !== 'all') {
			const days = dateFilter === '7d' ? 7 : 30;
			const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
			list = list.filter((i) => i.date >= cutoff);
		}
		return list;
	});

	let grouped = $derived.by(() => {
		const map = new Map<string, GalleryItem[]>();
		for (const it of filtered) {
			const key = it.date || 'Tanpa tanggal';
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(it);
		}
		return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
	});

	function formatDateHeader(dateStr: string) {
		if (!dateStr || dateStr === 'Tanpa tanggal') return 'Tanpa tanggal';
		try {
			return new Date(dateStr).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
		} catch {
			return dateStr;
		}
	}

	function handleItemClick(item: GalleryItem) {
		if (compareMode) {
			const idx = compareSelection.findIndex((i) => i.id === item.id);
			if (idx >= 0) {
				compareSelection = compareSelection.filter((i) => i.id !== item.id);
			} else if (compareSelection.length >= 2) {
				compareSelection = [compareSelection[1], item];
			} else {
				compareSelection = [...compareSelection, item];
			}
			return;
		}
		lightboxItem = item;
	}

	function toggleCompareMode() {
		compareMode = !compareMode;
		compareSelection = [];
	}
</script>

<svelte:head><title>Galeri Foto — {project?.name || 'Proyek'}</title></svelte:head>

<div class="max-w-2xl mx-auto px-4 py-5 pb-24">
	<div class="flex items-center gap-2 mb-3">
		<a href="/proyek/{projectId}" class="p-2 -ml-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
			<IconArrowLeft size={20} />
		</a>
		<div class="flex-1">
			<h1 class="text-lg font-bold text-slate-800 dark:text-slate-100">Galeri Foto</h1>
			<p class="text-xs text-slate-500 dark:text-slate-400">{project?.name || ''}</p>
		</div>
		<button
			type="button"
			class="text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1 {compareMode ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}"
			onclick={toggleCompareMode}
		>
			<IconArrowsRightLeft size={14} /> Bandingkan
		</button>
	</div>

	{#if compareMode}
		<p class="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5 mb-3">
			Pilih 2 foto untuk dibandingkan berdampingan (before-after). Terpilih: {compareSelection.length}/2
		</p>
	{/if}

	<!-- Filter kategori -->
	<div class="flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-4 px-4">
		{#each CATEGORIES as cat}
			<button
				type="button"
				class="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap {selectedCategory === cat.id ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}"
				onclick={() => (selectedCategory = cat.id)}
			>
				{cat.emoji} {cat.label}
			</button>
		{/each}
	</div>

	<!-- Filter rentang tanggal -->
	<div class="flex gap-1.5 mb-4">
		{#each [{ id: 'all', label: 'Semua Waktu' }, { id: '7d', label: '7 Hari' }, { id: '30d', label: '30 Hari' }] as df}
			<button
				type="button"
				class="text-[11px] font-medium px-2.5 py-1 rounded-lg {dateFilter === df.id ? 'bg-slate-700 text-white' : 'bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400'}"
				onclick={() => (dateFilter = df.id as any)}
			>
				{df.label}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-14">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat galeri dokumentasi foto..." />
	</div>
	{:else if filtered.length === 0}
		<div class="text-center py-10 text-slate-400 text-sm">
			<IconCamera size={32} class="mx-auto mb-2 opacity-40" />
			Belum ada foto untuk kategori/rentang waktu ini.
		</div>
	{:else}
		<div class="space-y-5">
			{#each grouped as [dateKey, dateItems] (dateKey)}
				<div>
					<h3 class="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2 sticky top-0 bg-white dark:bg-slate-950 py-1">
						{formatDateHeader(dateKey)}
					</h3>
					<div class="grid grid-cols-3 gap-1.5">
						{#each dateItems as item (item.id)}
							{@const isSelected = compareSelection.some((i) => i.id === item.id)}
							<button
								type="button"
								class="relative aspect-square rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border-2 {isSelected ? 'border-blue-500' : 'border-transparent'}"
								onclick={() => handleItemClick(item)}
							>
								<img use:secureAssetSrc={item.fileId} alt={item.title} class="w-full h-full object-cover" />
								{#if isSelected}
									<div class="absolute top-1 right-1 w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">
										{compareSelection.findIndex((i) => i.id === item.id) + 1}
									</div>
								{/if}
								<div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1">
									<span class="text-[9px] text-white font-medium truncate block">{item.categoryLabel}</span>
								</div>
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Lightbox foto tunggal -->
{#if lightboxItem}
	<div
		class="fixed inset-0 bg-black/85 z-50 flex flex-col"
		role="button"
		tabindex="0"
		onclick={() => (lightboxItem = null)}
		onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') lightboxItem = null; }}
	>
		<div class="flex items-center justify-between p-4 text-white">
			<div>
				<div class="text-sm font-semibold">{lightboxItem.title}</div>
				<div class="text-xs text-slate-300">{lightboxItem.categoryLabel} · {formatDateHeader(lightboxItem.date)}</div>
			</div>
			<button type="button" class="p-2" onclick={() => (lightboxItem = null)}><IconX size={22} /></button>
		</div>
		<div class="flex-1 flex items-center justify-center p-4">
			<img use:secureAssetSrc={lightboxItem.fileId} alt={lightboxItem.title} class="max-w-full max-h-full object-contain rounded-lg" />
		</div>
	</div>
{/if}

<!-- Mode Bandingkan — overlay side-by-side saat 2 foto terpilih -->
{#if compareMode && compareSelection.length === 2}
	<div class="fixed inset-0 bg-black/90 z-50 flex flex-col">
		<div class="flex items-center justify-between p-4 text-white">
			<span class="text-sm font-semibold">Bandingkan Foto</span>
			<button type="button" class="p-2" onclick={() => (compareSelection = [])}><IconX size={22} /></button>
		</div>
		<div class="flex-1 grid grid-cols-2 gap-1">
			{#each compareSelection as item}
				<div class="flex flex-col">
					<div class="flex-1 overflow-hidden">
						<img use:secureAssetSrc={item.fileId} alt={item.title} class="w-full h-full object-contain" />
					</div>
					<div class="text-center text-white text-[11px] py-2 px-2 bg-black/40">
						{item.categoryLabel} · {formatDateHeader(item.date)}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
