<!-- src/lib/components/project/SubtaskPicker.svelte -->
<!-- Komponen Pemilihan Pekerjaan (Pertajam Search & Seleksi Subtask Lapangan).
     Menggantikan native <select> dengan pencarian instan, filter status (Belum Selesai / Tuntas),
     filter kategori, kartu progres visual, dan high-contrast mobile UX untuk tim lapangan. -->
<script lang="ts">
	import {
		IconSearch, IconX, IconCheck, IconChevronDown,
		IconFolder, IconSparkles, IconAlertTriangle,
		IconPencil, IconClock, IconFilter, IconPlus
	} from '@tabler/icons-svelte';
	import { matchQuery, highlightTokens, tokenize } from '$lib/utils/searchMatch';
	import { hasValidSchedule, hasValidPic } from '$lib/utils/timelineDisiplin.js';

	interface SelectableSubtask {
		id: string; // ID / val to pass to onSelect
		subtaskId: string;
		subtaskName: string;
		categoryId: string | number;
		categoryName: string;
		isWajib: boolean;
		executorType: string | null;
		executorVendorName: string | null;
		externalParty: string | null;
		unit: string;
		target: number;
		prev: number;
		remaining: number;
		pct: number;
		isCompleted: boolean;
		isCategoryOnly?: boolean;
		hasSchedule?: boolean;
		hasPic?: boolean;
	}

	let {
		timelineCategories = [],
		value = '',
		item = null,
		getPreviousProgress,
		onSelect,
		disabled = false,
		placeholder = '— Pilih pekerjaan dari timeline —'
	}: {
		timelineCategories: any[];
		value: string;
		item?: any;
		getPreviousProgress: (subtaskId: string, activityName: string) => number;
		onSelect: (val: string) => void;
		disabled?: boolean;
		placeholder?: string;
	} = $props();

	// SPL-05 (opsi B) — teks bantuan baku untuk kategori timeline yang belum punya subtask.
	const KATEGORI_TANPA_SUBTASK_MSG =
		'Kategori ini belum punya rincian pekerjaan di Timeline. Minta PM menambah subtask dulu.';

	const KUSTOM_WARNING_MSG =
		'Pekerjaan kustom tidak tertaut ke Timeline, sehingga progresnya TIDAK masuk grafik/progres proyek. Bila pekerjaannya bagian dari rencana, minta PM menambah subtask dulu.';

	let open = $state(false);
	let searchQuery = $state('');
	let statusFilter = $state<'all' | 'active' | 'completed'>('all');
	let selectedCategoryFilter = $state<string>('all');
	let searchInputEl = $state<HTMLInputElement | null>(null);

	// Bangun daftar subtask terflatisasi beserta status progres kalkulatif
	let allOptions = $derived.by((): SelectableSubtask[] => {
		const result: SelectableSubtask[] = [];
		if (!timelineCategories || !Array.isArray(timelineCategories)) return result;

		for (const cat of timelineCategories) {
			const subtasks = cat.subtasks || [];
			if (subtasks.length > 0) {
				for (const sub of subtasks) {
					const prev = getPreviousProgress ? getPreviousProgress(sub.id, sub.name) : 0;
					const target = Number(sub.volume) || 0;
					const unit = sub.unit || 'm²';
					const pct = target > 0 ? Math.round((prev / target) * 100) : (prev > 0 ? 100 : 0);
					const remaining = target > 0 ? Math.max(0, target - prev) : 0;
					const isCompleted = target > 0 ? prev >= target : false;

					result.push({
						id: String(sub.id),
						subtaskId: String(sub.id),
						subtaskName: sub.name || 'Tanpa Nama',
						categoryId: cat.id,
						categoryName: cat.name || 'Kategori Tanpa Nama',
						isWajib: !!sub.wajib_key,
						executorType: sub.executor_type || null,
						executorVendorName: sub.executor_vendor_name || null,
						externalParty: sub.external_party || null,
						unit,
						target,
						prev,
						remaining,
						pct,
						isCompleted,
						isCategoryOnly: false,
						hasSchedule: hasValidSchedule(sub),
						hasPic: hasValidPic(sub)
					});
				}
			} else {
				// Kategori langsung tanpa subtask
				const prev = getPreviousProgress ? getPreviousProgress('', cat.name) : 0;
				const target = Number(cat.volume) || 0;
				const unit = cat.unit || 'm²';
				const pct = target > 0 ? Math.round((prev / target) * 100) : (prev > 0 ? 100 : 0);
				const remaining = target > 0 ? Math.max(0, target - prev) : 0;
				const isCompleted = target > 0 ? prev >= target : false;

				result.push({
					id: `__CAT__${cat.id}`,
					subtaskId: '',
					subtaskName: `Laporan langsung kategori: ${cat.name}`,
					categoryId: cat.id,
					categoryName: cat.name || 'Kategori Tanpa Nama',
					isWajib: false,
					executorType: null,
					executorVendorName: null,
					externalParty: null,
					unit,
					target,
					prev,
					remaining,
					pct,
					isCompleted,
					isCategoryOnly: true
				});
			}
		}

		return result;
	});

	// Hitung metrik ringkasan
	let totalCount = $derived(allOptions.length);
	let activeCount = $derived(allOptions.filter((o) => !o.isCompleted).length);
	let completedCount = $derived(allOptions.filter((o) => o.isCompleted).length);

	// Daftar nama kategori unik untuk chip filter
	let uniqueCategories = $derived.by(() => {
		const seen = new Set<string>();
		const list: string[] = [];
		for (const opt of allOptions) {
			if (!seen.has(opt.categoryName)) {
				seen.add(opt.categoryName);
				list.push(opt.categoryName);
			}
		}
		return list;
	});

	// Token pencarian
	let searchTokens = $derived(tokenize(searchQuery));

	// Filter opsi berdasarkan pencarian, status, dan kategori
	let filteredOptions = $derived.by(() => {
		let list = allOptions;

		// 1. Filter Kategori
		if (selectedCategoryFilter !== 'all') {
			list = list.filter((o) => o.categoryName === selectedCategoryFilter);
		}

		// 2. Filter Status
		if (statusFilter === 'active') {
			list = list.filter((o) => !o.isCompleted);
		} else if (statusFilter === 'completed') {
			list = list.filter((o) => o.isCompleted);
		}

		// 3. Filter Pencarian Pertajam
		if (searchQuery.trim()) {
			list = list.filter((o) =>
				matchQuery(searchQuery, [
					o.subtaskName,
					o.categoryName,
					o.executorVendorName,
					o.externalParty,
					o.unit
				])
			);
		}

		return list;
	});

	// Kelompokkan hasil per Kategori
	let groupedResults = $derived.by(() => {
		const groups: {
			categoryName: string;
			categoryId: string | number;
			items: SelectableSubtask[];
			activeInGroup: number;
		}[] = [];

		const map = new Map<string, SelectableSubtask[]>();
		for (const item of filteredOptions) {
			const existing = map.get(item.categoryName);
			if (existing) {
				existing.push(item);
			} else {
				map.set(item.categoryName, [item]);
			}
		}

		for (const [catName, items] of map.entries()) {
			const firstItem = items[0];
			const activeInGroup = items.filter((it) => !it.isCompleted).length;
			groups.push({
				categoryName: catName,
				categoryId: firstItem?.categoryId ?? catName,
				items,
				activeInGroup
			});
		}

		return groups;
	});

	// Detail item yang saat ini terpilih
	let selectedOption = $derived.by((): SelectableSubtask | null => {
		if (!value || value === '__CUSTOM__') return null;
		return allOptions.find((o) => o.id === value) || null;
	});

	let isCustomSelected = $derived(value === '__CUSTOM__' || (item && item.is_custom));

	function openModal() {
		if (disabled) return;
		open = true;
		searchQuery = '';
		// Jika ada item aktif, arahkan filter tab ke 'active' bila ingin cepat, atau 'all' jika belum yakin
		// Biarkan 'all' default agar tidak membingungkan, tapi jika user mau filter tinggal klik chip
		setTimeout(() => {
			if (searchInputEl) {
				searchInputEl.focus();
				searchInputEl.select();
			}
		}, 50);
	}

	function closeModal() {
		open = false;
		searchQuery = '';
	}

	function handleSelect(id: string) {
		// SPL-05 (opsi B): kategori tanpa subtask tidak bisa dipilih — progresnya tidak bisa
		// dihitung server (tidak ada subtask_id). Pencegahan sekunder; tombolnya juga disabled.
		const found = allOptions.find((o) => o.id === id);
		if (found?.isCategoryOnly || id.startsWith('__CAT__')) return;
		onSelect(id);
		closeModal();
	}

	function clearSelection() {
		onSelect('');
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			closeModal();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- TRIGGER / TAMPILAN ELEMEN PEMILIHAN -->
{#if isCustomSelected}
	<!-- State: Pekerjaan Kustom Dipilih -->
	<div class="p-3 rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/30 flex items-center justify-between gap-2 shadow-2xs">
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				<span class="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white flex items-center gap-1">
					<IconSparkles size={11} /> Kustom
				</span>
				<span class="text-[11px] font-semibold text-amber-900 dark:text-amber-200 truncate">
					{item?.activity || 'Pekerjaan Tambahan (Di luar Timeline)'}
				</span>
			</div>
			<p class="text-[10px] text-amber-700/80 dark:text-amber-400 mt-0.5 m-0 truncate">
				Non-timeline • Target: {item?.target_volume || 0} {item?.unit || 'm²'} • ⚠ Tidak masuk progres proyek
			</p>
		</div>
		<div class="flex items-center gap-1 shrink-0">
			<button
				type="button"
				class="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-750 transition-colors cursor-pointer"
				onclick={openModal}
				title="Ganti ke pekerjaan timeline"
			>
				<IconPencil size={12} />
				<span>Ganti</span>
			</button>
			<button
				type="button"
				class="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
				onclick={clearSelection}
				title="Hapus pilihan"
			>
				<IconX size={14} />
			</button>
		</div>
	</div>
{:else if selectedOption}
	<!-- State: Pekerjaan Timeline Dipilih -->
	{#if selectedOption.isCategoryOnly}
		<!-- SPL-05: Peringatan Kategori Tanpa Subtask -->
		<div class="p-3 rounded-xl border border-dashed border-amber-300 dark:border-amber-700/60 bg-amber-50/70 dark:bg-amber-950/30 flex items-start justify-between gap-3 shadow-2xs">
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 text-[11px] font-semibold">
					<IconAlertTriangle size={14} class="text-amber-500 shrink-0" />
					<span>Kategori Belum Punya Rincian Subtask di Timeline</span>
				</div>
				<div class="text-[12.5px] font-bold text-gray-900 dark:text-white leading-snug mt-0.5">
					{selectedOption.categoryName}
				</div>
				<p class="text-[10.5px] text-amber-700 dark:text-amber-400 mt-1 m-0">
					Kategori ini belum punya rincian pekerjaan di Timeline. Minta PM menambah subtask dulu agar progres terhitung di grafik proyek.
				</p>
			</div>
			<div class="flex items-center gap-1 shrink-0 pt-0.5">
				<button
					type="button"
					class="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 transition-colors cursor-pointer"
					onclick={openModal}
					title="Pilih pekerjaan lain"
				>
					<IconPencil size={12} />
					<span>Ganti</span>
				</button>
				<button
					type="button"
					class="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
					onclick={clearSelection}
					title="Hapus pilihan"
				>
					<IconX size={14} />
				</button>
			</div>
		</div>
	{:else}
		<div class="p-3 rounded-xl border border-sky-300 dark:border-sky-800/80 bg-sky-50/50 dark:bg-sky-950/30 flex items-start justify-between gap-3 shadow-2xs">
			<div class="min-w-0 flex-1">
				<!-- Folder Kategori -->
				<div class="flex items-center gap-1 text-[10.5px] font-semibold text-sky-800 dark:text-sky-300 truncate mb-1">
					<IconFolder size={12} class="shrink-0" />
					<span class="truncate">{selectedOption.categoryName}</span>
					{#if selectedOption.isWajib}
						<span class="px-1 py-0.2 rounded bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300 text-[9.5px] font-bold">Wajib</span>
					{/if}
				</div>

			<!-- Nama Subtask / Pekerjaan -->
			<div class="text-[12.5px] font-bold text-gray-900 dark:text-white leading-snug">
				{selectedOption.subtaskName}
				{#if selectedOption.isCategoryOnly}
					<span class="block text-[10.5px] font-semibold text-red-700 dark:text-red-300 mt-1">
						⚠ {KATEGORI_TANPA_SUBTASK_MSG} Klik "Ganti" untuk memilih pekerjaan lain.
					</span>
				{:else if !selectedOption.hasSchedule}
					<span class="inline-flex items-center gap-1 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300 mt-1">
						<IconAlertTriangle size={12} class="shrink-0 text-amber-500" />
						Belum ada jadwal di timeline (jadwal rencana harian masih kosong).
					</span>
				{/if}
			</div>

			<!-- Meta Status Progres & Pelaksana -->
			<div class="flex flex-wrap items-center gap-2 mt-2">
				<!-- Status Badge -->
				{#if selectedOption.isCompleted}
					<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white">
						<IconCheck size={11} stroke={3} /> Tuntas 100%
					</span>
				{:else if selectedOption.pct > 0}
					<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500 text-white">
						<IconClock size={11} /> {selectedOption.pct}% Berjalan
					</span>
				{:else}
					<span class="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300">
						0% Belum Mulai
					</span>
				{/if}

				<!-- Angka Progres Realisasi & Sisa -->
				{#if selectedOption.target > 0}
					<span class="text-[11px] text-gray-600 dark:text-slate-300 font-medium">
						Selesai <strong>{selectedOption.prev}</strong> / {selectedOption.target} {selectedOption.unit}
						{#if selectedOption.remaining > 0}
							• <span class="text-emerald-700 dark:text-emerald-400 font-semibold">Sisa {selectedOption.remaining} {selectedOption.unit}</span>
						{/if}
					</span>
				{/if}

				<!-- Badge Vendor / Eksternal -->
				{#if selectedOption.executorType === 'vendor'}
					<span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
						🤝 Vendor: {selectedOption.executorVendorName || '-'}
					</span>
				{:else if selectedOption.executorType === 'external_prereq'}
					<span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
						⏳ Prasyarat: {selectedOption.externalParty || '-'}
					</span>
				{/if}
			</div>
		</div>

		<!-- Tombol Aksi: Ganti & Hapus -->
		<div class="flex items-center gap-1 shrink-0 pt-0.5">
			<button
				type="button"
				class="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-750 transition-colors cursor-pointer shadow-2xs"
				onclick={openModal}
				title="Ganti pekerjaan lain"
			>
				<IconPencil size={12} />
				<span>Ganti</span>
			</button>
			<button
				type="button"
				class="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
				onclick={clearSelection}
				title="Hapus pilihan pekerjaan"
			>
				<IconX size={14} />
			</button>
		</div>
	</div>
	{/if}
{:else}
	<!-- State: Belum Ada yang Dipilih (Button Trigger) -->
	<button
		type="button"
		class="w-full text-left p-3 rounded-xl border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:border-sky-400 dark:hover:border-sky-600 hover:bg-sky-50/20 dark:hover:bg-slate-750 transition-all cursor-pointer flex items-center justify-between gap-2 shadow-2xs group"
		onclick={openModal}
		{disabled}
	>
		<div class="flex items-center gap-2.5 text-gray-500 dark:text-slate-400 min-w-0">
			<div class="p-1.5 rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 group-hover:bg-sky-100 group-hover:text-sky-700 dark:group-hover:bg-sky-900/50 dark:group-hover:text-sky-300 transition-colors">
				<IconSearch size={15} />
			</div>
			<div class="truncate">
				<span class="text-[13px] font-medium text-gray-700 dark:text-slate-200">
					{placeholder}
				</span>
				<span class="text-[11px] text-gray-400 dark:text-slate-500 block">
					Klik untuk mencari atau filter dari {totalCount} daftar timeline
				</span>
			</div>
		</div>

		<div class="flex items-center gap-1.5 shrink-0 text-gray-400 group-hover:text-sky-600 transition-colors">
			<span class="text-[11px] hidden sm:inline px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 font-mono text-gray-500 dark:text-slate-400">Pilih</span>
			<IconChevronDown size={16} />
		</div>
	</button>
{/if}

<!-- MODAL / SHEET OVERLAY PENCARIAN & SELEKSI PEKERJAAN -->
{#if open}
	<div
		class="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in"
		role="dialog"
		aria-modal="true"
		onclick={(e) => {
			if (e.target === e.currentTarget) closeModal();
		}}
	>
		<div
			class="w-full max-w-2xl max-h-[90vh] sm:max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-2xl overflow-hidden"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- HEADER MODAL -->
			<div class="p-3.5 sm:p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-gray-50/50 dark:bg-slate-850/50">
				<div class="min-w-0">
					<h3 class="text-[14px] font-bold text-gray-900 dark:text-white flex items-center gap-2 m-0">
						<IconFolder size={16} class="text-sky-600 dark:text-sky-400" />
						<span>Pilih Pekerjaan (Timeline Proyek)</span>
					</h3>
					<p class="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 m-0">
						Cari cepat atau saring pekerjaan yang belum selesai hari ini
					</p>
				</div>
				<button
					type="button"
					class="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
					onclick={closeModal}
					title="Tutup (Esc)"
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- SEARCH BAR STICKY -->
			<div class="p-3 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5">
				<div class="relative">
					<IconSearch
						size={16}
						class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 dark:text-slate-500"
					/>
					<input
						bind:this={searchInputEl}
						type="text"
						class="w-full py-2.5 pl-9 pr-8 text-[13px] rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-800/80 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none transition-all"
						placeholder="Ketik untuk mencari (contoh: 172, blasting, primer, top coat, demob)..."
						bind:value={searchQuery}
					/>
					{#if searchQuery}
						<button
							type="button"
							class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
							onclick={() => (searchQuery = '')}
							title="Hapus pencarian"
						>
							<IconX size={13} />
						</button>
					{/if}
				</div>

				<!-- STATUS FILTER CHIPS & TABS -->
				<div class="flex items-center justify-between flex-wrap gap-2 pt-0.5">
					<div class="flex items-center gap-1.5">
						<button
							type="button"
							class="px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer {statusFilter === 'all' ? 'bg-sky-600 text-white shadow-2xs' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-750'}"
							onclick={() => (statusFilter = 'all')}
						>
							Semua ({totalCount})
						</button>
						<button
							type="button"
							class="px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer {statusFilter === 'active' ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/50 hover:bg-emerald-100 dark:hover:bg-emerald-950/70'}"
							onclick={() => (statusFilter = 'active')}
						>
							⚡ Belum Selesai ({activeCount})
						</button>
						<button
							type="button"
							class="px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer {statusFilter === 'completed' ? 'bg-gray-700 text-white shadow-2xs' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-750'}"
							onclick={() => (statusFilter = 'completed')}
						>
							✓ Tuntas ({completedCount})
						</button>
					</div>

					<span class="text-[11px] text-gray-400 dark:text-slate-500">
						{filteredOptions.length} pekerjaan cocok
					</span>
				</div>

				<!-- CATEGORY QUICK FILTER (JIKA LEBIH DARI 1 KATEGORI) -->
				{#if uniqueCategories.length > 1}
					<div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar pt-1 border-t border-gray-100 dark:border-slate-800/80">
						<span class="text-[10px] text-gray-400 dark:text-slate-500 font-medium shrink-0 flex items-center gap-1">
							<IconFilter size={11} /> Kategori:
						</span>
						<button
							type="button"
							class="px-2 py-0.5 text-[10.5px] rounded-md shrink-0 transition-colors cursor-pointer {selectedCategoryFilter === 'all' ? 'bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 font-bold border border-sky-300 dark:border-sky-800' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200'}"
							onclick={() => (selectedCategoryFilter = 'all')}
						>
							Semua
						</button>
						{#each uniqueCategories as catName}
							<button
								type="button"
								class="px-2 py-0.5 text-[10.5px] rounded-md shrink-0 truncate max-w-[200px] transition-colors cursor-pointer {selectedCategoryFilter === catName ? 'bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 font-bold border border-sky-300 dark:border-sky-800' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200'}"
								onclick={() => (selectedCategoryFilter = catName)}
								title={catName}
							>
								{catName}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- DAFTAR HASIL PENCARIAN & KELOMPOK SUBTASK (SCROLLABLE) -->
			<div class="flex-1 overflow-y-auto p-3 space-y-4 max-h-[55vh]">
				{#if groupedResults.length > 0}
					{#each groupedResults as group (group.categoryId)}
						<div class="space-y-1.5">
							<!-- Group Header / Folder -->
							<div class="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-gray-100/70 dark:bg-slate-800/60 border border-gray-200/50 dark:border-slate-700/50">
								<div class="flex items-center gap-1.5 text-[11px] font-bold text-gray-700 dark:text-slate-300 min-w-0">
									<IconFolder size={13} class="text-sky-600 dark:text-sky-400 shrink-0" />
									<span class="truncate">{group.categoryName}</span>
								</div>
								<span class="text-[10px] text-gray-500 dark:text-slate-400 shrink-0">
									{group.activeInGroup > 0 ? `${group.activeInGroup} belum selesai` : 'Semua tuntas'}
								</span>
							</div>

							<!-- Subtask Cards dalam Folder Ini -->
							<div class="space-y-1.5 pl-1">
								{#each group.items as opt (opt.id)}
									{@const isSelected = value === opt.id}
									<button
										type="button"
										class="w-full text-left p-2.5 rounded-xl border transition-all flex items-start justify-between gap-3 {opt.isCategoryOnly ? 'opacity-70 cursor-not-allowed border-dashed border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20' : isSelected ? 'cursor-pointer border-sky-500 bg-sky-50/80 dark:bg-sky-950/40 shadow-xs ring-1 ring-sky-500/30' : 'cursor-pointer border-gray-200/80 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700 bg-white dark:bg-slate-850 hover:bg-gray-50/80 dark:hover:bg-slate-800'}"
										disabled={opt.isCategoryOnly}
										title={opt.isCategoryOnly ? KATEGORI_TANPA_SUBTASK_MSG : undefined}
										onclick={() => handleSelect(opt.id)}
									>
										<div class="min-w-0 flex-1">
											{#if opt.isCategoryOnly}
												<div class="text-[10.5px] font-semibold text-red-700 dark:text-red-300 mb-1 flex items-start gap-1">
													<IconAlertTriangle size={12} class="shrink-0 mt-0.5" />
													<span>{KATEGORI_TANPA_SUBTASK_MSG}</span>
												</div>
											{/if}
											<!-- Judul Subtask dengan Pertajam Highlight Tokens -->
											<div class="text-[12px] font-semibold text-gray-900 dark:text-slate-100 leading-snug">
												{#if opt.isWajib}
													<span class="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300 text-[9.5px] font-bold mr-1">
														🔒 Wajib
													</span>
												{/if}
												{#if searchTokens.length > 0}
													{#each highlightTokens(opt.subtaskName, searchTokens) as seg}
														{#if seg.match}
															<mark class="bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 font-bold rounded-xs px-0.5">{seg.text}</mark>
														{:else}
															<span>{seg.text}</span>
														{/if}
													{/each}
												{:else}
													<span>{opt.subtaskName}</span>
												{/if}
											</div>

											<!-- Metrik Progres & Sisa -->
											<div class="flex flex-wrap items-center gap-2 mt-1.5 text-[10.5px]">
												{#if opt.target > 0}
													<span class="text-gray-500 dark:text-slate-400">
														Plan: <strong class="text-gray-800 dark:text-slate-200">{opt.target} {opt.unit}</strong>
													</span>
													<span class="text-gray-400 dark:text-slate-600">•</span>
													<span class="text-sky-600 dark:text-sky-400">
														Selesai: <strong>{opt.prev} {opt.unit}</strong>
													</span>
													<span class="text-gray-400 dark:text-slate-600">•</span>
													<span class={opt.remaining > 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-gray-400'}>
														Sisa: {opt.remaining} {opt.unit}
													</span>
												{:else}
													<span class="text-gray-400 dark:text-slate-500">
														Realisasi lalu: {opt.prev} {opt.unit}
													</span>
												{/if}

												<!-- Badge Pelaksana -->
												{#if opt.executorType === 'vendor'}
													<span class="text-[9.5px] px-1.5 py-0.2 rounded bg-orange-100 dark:bg-orange-950/50 text-orange-800 dark:text-orange-300 font-medium">
														🤝 Vendor: {opt.executorVendorName || '-'}
													</span>
												{:else if opt.executorType === 'external_prereq'}
													<span class="text-[9.5px] px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300 font-medium">
														⏳ Prasyarat: {opt.externalParty || '-'}
													</span>
												{/if}

												<!-- Badge Status Jadwal -->
												{#if !opt.isCategoryOnly && !opt.hasSchedule}
													<span class="text-[9.5px] px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-medium border border-amber-200 dark:border-amber-800">
														⚠️ Belum Dijadwalkan
													</span>
												{/if}
											</div>

											<!-- Mini Progress Bar Visual -->
											{#if opt.target > 0}
												<div class="w-full max-w-xs h-1.5 bg-gray-100 dark:bg-slate-750 rounded-full overflow-hidden mt-1.5 flex">
													<div
														class="h-full {opt.isCompleted ? 'bg-emerald-500' : 'bg-sky-500'} transition-all"
														style="width: {Math.min(100, opt.pct)}%"
													></div>
												</div>
											{/if}
										</div>

										<!-- Badge Persentase Kanan -->
										<div class="shrink-0 flex items-center gap-1.5 pt-0.5">
											{#if opt.isCompleted}
												<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white flex items-center gap-0.5">
													<IconCheck size={11} stroke={3} /> 100%
												</span>
											{:else if opt.pct > 0}
												<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
													{opt.pct}%
												</span>
											{:else}
												<span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400">
													0%
												</span>
											{/if}

											{#if isSelected}
												<div class="w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center shrink-0">
													<IconCheck size={12} stroke={3} />
												</div>
											{/if}
										</div>
									</button>
								{/each}
							</div>
						</div>
					{/each}
				{:else}
					<!-- Empty State Bila Tidak Ada yang Cocok -->
					<div class="py-8 text-center space-y-2.5">
						<div class="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500 flex items-center justify-center mx-auto">
							<IconSearch size={20} />
						</div>
						<div class="space-y-1">
							<p class="text-[13px] font-semibold text-gray-800 dark:text-slate-200 m-0">
								Tidak ada pekerjaan yang cocok
							</p>
							<p class="text-[11px] text-gray-400 dark:text-slate-500 m-0">
								{#if searchQuery}
									Tidak ditemukan hasil untuk kata kunci "{searchQuery}".
								{:else if statusFilter !== 'all'}
									Tidak ada pekerjaan dengan status filter ini.
								{:else}
									Belum ada daftar subtask di timeline proyek ini.
								{/if}
							</p>
						</div>
						<div class="flex items-center justify-center gap-2 pt-2">
							{#if searchQuery || statusFilter !== 'all' || selectedCategoryFilter !== 'all'}
								<button
									type="button"
									class="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 cursor-pointer"
									onclick={() => {
										searchQuery = '';
										statusFilter = 'all';
										selectedCategoryFilter = 'all';
									}}
								>
									Reset Semua Filter
								</button>
							{/if}
							<button
								type="button"
								class="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors cursor-pointer flex items-center gap-1"
								onclick={() => handleSelect('__CUSTOM__')}
							>
								<IconPlus size={13} />
								<span>Tulis Sebagai Pekerjaan Kustom</span>
							</button>
						</div>
					</div>
				{/if}

				<!-- OPSI PEKERJAAN KUSTOM / NON-TIMELINE -->
				<div class="pt-2 border-t border-gray-100 dark:border-slate-800">
					<button
						type="button"
						class="w-full text-left p-3 rounded-xl border border-dashed border-amber-300 dark:border-amber-800/80 bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors cursor-pointer flex items-center justify-between gap-2"
						onclick={() => handleSelect('__CUSTOM__')}
					>
						<div class="flex items-center gap-2.5">
							<div class="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
								<IconSparkles size={16} />
							</div>
							<div>
								<div class="text-[12px] font-bold text-amber-900 dark:text-amber-200">
									➕ Tulis Pekerjaan Kustom / Tambahan (Di luar Timeline)
								<div class="text-[10.5px] text-amber-700/80 dark:text-amber-400">
									Gunakan jika ada pekerjaan darurat, perbaikan di luar SPK, atau instruksi lisan dari klien. ⚠ {KUSTOM_WARNING_MSG}
								</div>
							</div>
						</div>
						<span class="text-[11px] font-semibold text-amber-700 dark:text-amber-300 shrink-0">
							Pilih →
						</span>
					</button>
				</div>
			</div>

			<!-- FOOTER MODAL -->
			<div class="p-3 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-850/50 flex items-center justify-between text-[11px] text-gray-500 dark:text-slate-400">
				<span>💡 Tips: Ketik nomor tangki atau jenis pekerjaan untuk menyaring cepat</span>
				<button
					type="button"
					class="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 font-medium hover:bg-gray-50 cursor-pointer"
					onclick={closeModal}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Animasi fade in lembut untuk modal */
	@keyframes fadeIn {
		from { opacity: 0; transform: scale(0.98); }
		to { opacity: 1; transform: scale(1); }
	}
	.animate-fade-in {
		animation: fadeIn 0.15s ease-out forwards;
	}

	/* Hilangkan scrollbar horizontal pada kategori chip */
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>
