<!-- src/lib/components/sales/SalesVisitExpenseSection.svelte -->
<!-- Fase 2 Ops Sales Gate & Reimbursement: pencatatan dan bukti bon pengeluaran kunjungan sales -->

<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import {
		getVisitExpenses,
		addVisitExpense,
		deleteVisitExpense,
		type VisitExpenseItem
	} from '$lib/services/sales.ts';
	import { compressPhoto } from '$lib/utils/photoCompress.ts';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import {
		IconReceipt,
		IconPlus,
		IconTrash,
		IconCamera,
		IconLoader2,
		IconX,
		IconCheck,
		IconAlertCircle,
		IconGasStation,
		IconRoad,
		IconParking,
		IconCoffee,
		IconFileDescription
	} from '@tabler/icons-svelte';

	interface Props {
		visitId: number;
		readOnly?: boolean;
		onExpensesChanged?: (total: number, items: VisitExpenseItem[]) => void;
	}

	let { visitId, readOnly = false, onExpensesChanged }: Props = $props();

	let loading = $state(true);
	let errorMsg = $state('');
	let expenses = $state<VisitExpenseItem[]>([]);
	let totalNominal = $state(0);

	// Form input state
	let showAddForm = $state(false);
	let selectedCategory = $state<'bbm' | 'tol' | 'parkir' | 'konsumsi' | 'lain'>('parkir');
	let nominalInput = $state('');
	let catatanInput = $state('');
	let receiptFile = $state<File | null>(null);
	let receiptPreview = $state<string | null>(null);
	let saving = $state(false);
	let deletingId = $state<number | null>(null);
	let showCamera = $state(false);
	let compressingPhoto = $state(false);
	let zoomReceiptUrl = $state<string | null>(null);

	const CATEGORIES = [
		{ id: 'bbm', label: 'BBM', directusJenis: 'bbm', emoji: '⛽' },
		{ id: 'tol', label: 'Tol', directusJenis: 'tol', emoji: '🛣️' },
		{ id: 'parkir', label: 'Parkir', directusJenis: 'parkir', emoji: '🅿️' },
		{ id: 'konsumsi', label: 'Konsumsi', directusJenis: 'lain', emoji: '🍽️' },
		{ id: 'lain', label: 'Lainnya', directusJenis: 'lain', emoji: '📋' }
	] as const;

	function formatRupiah(num: number | null | undefined): string {
		if (!num) return 'Rp 0';
		return 'Rp ' + Math.round(Number(num)).toLocaleString('id-ID');
	}

	async function loadExpenses() {
		loading = true;
		errorMsg = '';
		try {
			const res = await getVisitExpenses(visitId);
			expenses = res.expenses;
			totalNominal = res.totalNominal;
			onExpensesChanged?.(totalNominal, expenses);
		} catch (err: any) {
			console.warn('[SalesVisitExpenseSection] Gagal load expenses:', err);
			// Fail-soft: jika gagal load atau belum ada site_checkin, set kosong
			expenses = [];
			totalNominal = 0;
		} finally {
			loading = false;
		}
	}

	onMount(loadExpenses);

	async function handleCameraCapture(file: File) {
		showCamera = false;
		compressingPhoto = true;
		try {
			const compressed = await compressPhoto(file);
			receiptFile = compressed;
			receiptPreview = URL.createObjectURL(compressed);
		} catch (e) {
			receiptFile = file;
			receiptPreview = URL.createObjectURL(file);
		} finally {
			compressingPhoto = false;
		}
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) {
			handleCameraCapture(file);
		}
	}

	function resetForm() {
		showAddForm = false;
		selectedCategory = 'parkir';
		nominalInput = '';
		catatanInput = '';
		receiptFile = null;
		receiptPreview = null;
		errorMsg = '';
	}

	async function handleSaveExpense() {
		const rawNominal = nominalInput.replace(/\D/g, '');
		const nominal = Number(rawNominal);
		if (!Number.isFinite(nominal) || nominal <= 0) {
			errorMsg = 'Nominal biaya harus lebih dari 0.';
			return;
		}

		const catObj = CATEGORIES.find((c) => c.id === selectedCategory) || CATEGORIES[2];
		const directusJenis = catObj.directusJenis;
		const defaultCatatan = selectedCategory === 'konsumsi' ? 'Konsumsi/Entertain Meeting' : catObj.label;
		const finalCatatan = catatanInput.trim() || defaultCatatan;

		saving = true;
		errorMsg = '';

		try {
			const fd = new FormData();
			fd.append('jenis', directusJenis);
			fd.append('nominal', String(nominal));
			fd.append('catatan', finalCatatan);
			if (receiptFile) {
				fd.append('foto_struk', receiptFile);
			}

			await addVisitExpense(visitId, fd);
			resetForm();
			await loadExpenses();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan catatan biaya.';
		} finally {
			saving = false;
		}
	}

	async function handleDelete(expId: number) {
		if (!confirm('Hapus catatan biaya/bon ini?')) return;
		deletingId = expId;
		try {
			await deleteVisitExpense(visitId, expId);
			await loadExpenses();
		} catch (err: any) {
			alert(err?.message || 'Gagal menghapus biaya.');
		} finally {
			deletingId = null;
		}
	}

	function getCategoryBadge(jenis: string, catatan: string | null) {
		const catLower = (catatan || '').toLowerCase();
		if (catLower.includes('konsumsi') || catLower.includes('makan') || catLower.includes('entertain')) {
			return { label: 'Konsumsi', emoji: '🍽️', color: 'text-amber-700 bg-amber-500/10 border-amber-500/20' };
		}
		if (jenis === 'bbm') {
			return { label: 'BBM', emoji: '⛽', color: 'text-rose-700 bg-rose-500/10 border-rose-500/20' };
		}
		if (jenis === 'tol') {
			return { label: 'Tol', emoji: '🛣️', color: 'text-blue-700 bg-blue-500/10 border-blue-500/20' };
		}
		if (jenis === 'parkir') {
			return { label: 'Parkir', emoji: '🅿️', color: 'text-purple-700 bg-purple-500/10 border-purple-500/20' };
		}
		return { label: 'Lainnya', emoji: '📋', color: 'text-zinc-700 bg-zinc-500/10 border-zinc-500/20' };
	}
</script>

<div class="rounded-2xl border p-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
	<!-- Header -->
	<div class="flex items-center justify-between gap-2 mb-3">
		<div class="flex items-center gap-2">
			<div class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
				<IconReceipt size={18} />
			</div>
			<div>
				<h3 class="text-[13px] font-bold" style="color: var(--sys-label)">Biaya Operasional & Bukti Bon</h3>
				<p class="text-[10px]" style="color: var(--sys-label3)">
					Bon BBM, Tol, Parkir & Konsumsi kunjungan untuk reimbursement
				</p>
			</div>
		</div>

		<div class="flex items-center gap-2">
			{#if totalNominal > 0}
				<span class="text-[12px] font-black text-emerald-600 dark:text-emerald-400">
					{formatRupiah(totalNominal)}
				</span>
			{/if}

			{#if !readOnly && !showAddForm}
				<button
					type="button"
					class="px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 text-white shadow-sm transition-transform active:scale-95"
					style="background: var(--p, var(--g))"
					onclick={() => (showAddForm = true)}
				>
					<IconPlus size={14} /> Tambah Bon
				</button>
			{/if}
		</div>
	</div>

	<!-- Form Tambah Biaya Kunjungan -->
	{#if showAddForm}
		<div class="p-3.5 rounded-xl border mb-3 flex flex-col gap-3" style="border-color: var(--sys-sep); background: var(--sys-fill)">
			<div class="flex items-center justify-between">
				<strong class="text-[12px] font-bold" style="color: var(--sys-label)">Catat Pengeluaran Baru</strong>
				<button
					type="button"
					class="text-[11px] p-1 rounded-lg hover:bg-black/5"
					style="color: var(--sys-label3)"
					onclick={resetForm}
				>
					<IconX size={15} />
				</button>
			</div>

			<!-- Kategori Pills -->
			<div>
				<label class="text-[10px] font-bold block mb-1" style="color: var(--sys-label3)">Kategori Biaya</label>
				<div class="flex flex-wrap gap-1.5">
					{#each CATEGORIES as cat}
						<button
							type="button"
							class="px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1 transition-all {selectedCategory === cat.id
								? 'bg-[var(--p,var(--g))] text-white border-transparent font-bold shadow-xs'
								: 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'}"
							onclick={() => (selectedCategory = cat.id)}
						>
							<span>{cat.emoji}</span>
							<span>{cat.label}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Nominal Input -->
			<div>
				<label class="text-[10px] font-bold block mb-1" style="color: var(--sys-label3)">Nominal (Rp) *</label>
				<div class="relative">
					<input
						type="text"
						inputmode="numeric"
						class="w-full h-10 px-3 rounded-xl border text-[13px] font-bold font-mono"
						style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
						placeholder="cth. 10.000"
						value={nominalInput}
						oninput={(e) => {
							const val = (e.target as HTMLInputElement).value.replace(/\D/g, '');
							nominalInput = val ? Number(val).toLocaleString('id-ID') : '';
						}}
					/>
				</div>
			</div>

			<!-- Foto Struk / Bon Capture -->
			<div>
				<label class="text-[10px] font-bold block mb-1" style="color: var(--sys-label3)">Foto Bukti Bon / Struk Fisik *</label>
				{#if receiptPreview}
					<div class="relative h-28 rounded-xl overflow-hidden border" style="border-color: var(--sys-sep)">
						<img src={receiptPreview} alt="Preview Bon" class="w-full h-full object-cover" />
						<button
							type="button"
							class="absolute top-2 right-2 px-2 py-1 rounded-lg text-[10px] font-bold bg-black/60 text-white hover:bg-black/80"
							onclick={() => {
								receiptFile = null;
								receiptPreview = null;
							}}
						>
							Ganti Foto
						</button>
					</div>
				{:else}
					<div class="flex gap-2">
						<button
							type="button"
							class="flex-1 flex items-center justify-center gap-1.5 h-12 rounded-xl border border-dashed text-[11px] font-semibold hover:bg-black/5"
							style="border-color: var(--sys-sep); color: var(--sys-label)"
							disabled={compressingPhoto}
							onclick={() => (showCamera = true)}
						>
							{#if compressingPhoto}
								<IconLoader2 size={16} class="animate-spin" />
							{:else}
								<IconCamera size={16} class="text-amber-600" />
							{/if}
							<span>Foto Kamera Langsung</span>
						</button>

						<label
							class="flex-1 flex items-center justify-center gap-1.5 h-12 rounded-xl border border-dashed text-[11px] font-semibold cursor-pointer hover:bg-black/5"
							style="border-color: var(--sys-sep); color: var(--sys-label)"
						>
							<IconFileDescription size={16} class="text-blue-600" />
							<span>Pilih dari File</span>
							<input type="file" accept="image/*" class="hidden" onchange={handleFileSelect} />
						</label>
					</div>
				{/if}
				<p class="text-[9px] mt-1" style="color: var(--sys-label3)">
					💡 Unggah bon asli untuk memenuhi syarat gate operasional (G_OPS_SALES_BON).
				</p>
			</div>

			<!-- Catatan Input -->
			<div>
				<label class="text-[10px] font-bold block mb-1" style="color: var(--sys-label3)">Keterangan Tambahan (opsional)</label>
				<input
					type="text"
					class="w-full h-9 px-3 rounded-xl border text-[12px]"
					style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
					placeholder="cth. Parkir Kawasan GIIC, Tol Cikampek..."
					bind:value={catatanInput}
				/>
			</div>

			{#if errorMsg}
				<p class="text-[11px] font-semibold text-rose-600">{errorMsg}</p>
			{/if}

			<!-- Action Buttons -->
			<div class="flex items-center gap-2 pt-1">
				<button
					type="button"
					class="flex-1 h-10 rounded-xl text-[12px] font-bold text-white flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
					style="background: var(--p, var(--g))"
					disabled={saving}
					onclick={handleSaveExpense}
				>
					{#if saving}
						<IconLoader2 size={15} class="animate-spin" />
					{:else}
						<IconCheck size={15} />
					{/if}
					<span>Simpan Bon</span>
				</button>
				<button
					type="button"
					class="px-4 h-10 rounded-xl text-[12px] font-medium border"
					style="border-color: var(--sys-sep); color: var(--sys-label3)"
					onclick={resetForm}
				>
					Batal
				</button>
			</div>
		</div>
	{/if}

	<!-- List Catatan Biaya -->
	{#if loading}
		<CircularProgressGauge size={44} strokeWidth={3} label="Memuat data bon & biaya..." />
	{:else if expenses.length === 0}
		<div class="py-5 text-center rounded-xl border border-dashed" style="border-color: var(--sys-sep)">
			<p class="text-[11px] font-medium" style="color: var(--sys-label3)">
				Belum ada bukti bon atau pengeluaran yang dicatat untuk kunjungan ini.
			</p>
			{#if !readOnly}
				<button
					type="button"
					class="mt-2 text-[11px] font-bold underline"
					style="color: var(--p, var(--g))"
					onclick={() => (showAddForm = true)}
				>
					+ Catat Bon Sekarang
				</button>
			{/if}
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			{#each expenses as exp (exp.id)}
				{@const badge = getCategoryBadge(exp.jenis, exp.catatan)}
				<div class="p-2.5 rounded-xl border flex items-center justify-between gap-2.5 transition-all" style="border-color: var(--sys-sep); background: var(--sys-fill)">
					<div class="flex items-center gap-2.5 min-w-0">
						<!-- Struk Thumbnail -->
						{#if exp.foto_struk}
							<button
								type="button"
								class="w-11 h-11 rounded-lg overflow-hidden border shrink-0 hover:opacity-90 relative"
								style="border-color: var(--sys-sep)"
								onclick={() => (zoomReceiptUrl = `/api/directus/assets/${exp.foto_struk}`)}
								title="Klik untuk zoom struk"
							>
								<img
									src={`/api/directus/assets/${exp.foto_struk}?width=120&height=120&fit=cover`}
									alt="Bon"
									class="w-full h-full object-cover"
								/>
							</button>
						{:else}
							<div class="w-11 h-11 rounded-lg border border-dashed shrink-0 flex items-center justify-center text-[16px] bg-black/5">
								{badge.emoji}
							</div>
						{/if}

						<div class="min-w-0">
							<div class="flex items-center gap-1.5 mb-0.5">
								<span class="text-[9px] font-bold px-1.5 py-0.2 rounded border {badge.color}">
									{badge.label}
								</span>
								<span class="text-[12px] font-black" style="color: var(--sys-label)">
									{formatRupiah(exp.nominal)}
								</span>
							</div>
							<p class="text-[11px] truncate font-medium" style="color: var(--sys-label2)">
								{exp.catatan || 'Tanpa keterangan'}
							</p>
						</div>
					</div>

					<div class="flex items-center gap-1 shrink-0">
						{#if !readOnly}
							<button
								type="button"
								class="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
								title="Hapus bon"
								disabled={deletingId === exp.id}
								onclick={() => handleDelete(exp.id)}
							>
								{#if deletingId === exp.id}
									<IconLoader2 size={14} class="animate-spin" />
								{:else}
									<IconTrash size={14} />
								{/if}
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Modal Camera -->
{#if showCamera}
	<CameraCaptureModal
		facing="environment"
		onCapture={handleCameraCapture}
		onClose={() => (showCamera = false)}
	/>
{/if}

<!-- Modal Zoom Bon Struk -->
{#if zoomReceiptUrl}
	<div
		class="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
		onclick={() => (zoomReceiptUrl = null)}
		role="button"
		tabindex="0"
		onkeydown={(e) => e.key === 'Escape' && (zoomReceiptUrl = null)}
	>
		<div class="relative max-w-lg w-full max-h-[90vh] flex flex-col items-center" onclick={(e) => e.stopPropagation()}>
			<img src={zoomReceiptUrl} alt="Bukti Bon Struk" class="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-2xl" />
			<button
				type="button"
				class="mt-3 px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white text-[12px] font-bold"
				onclick={() => (zoomReceiptUrl = null)}
			>
				Tutup
			</button>
		</div>
	</div>
{/if}
